/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { SocketAPI } from '@sage3/frontend';
import {
    SyncWebviewEvent,
    SyncWebviewWebSocketMessage,
    MouseMovementBatch,
    MouseInteractionState,
    PerformanceMetrics,
    CompressedSnapshot,
    SnapshotRequest,
    NavigationEvent,
    ConnectionState,
    MessagePriority,
    MessageAcknowledgment,
    QueuedMessage,
    ConnectionHealth,
    MessageValidationResult,
    RecoveryConfig
} from '../types';

/**
 * Enhanced WebSocket communication service for SyncWebview
 * Handles event broadcasting and reception using SAGE3's application state system
 * with message validation, queuing, acknowledgments, and connection recovery
 */
export class WebSocketService {
    private appId: string;
    private userId: string;
    private isInitialized: boolean = false;
    private subscription: (() => void) | null = null;
    private lastMessageTimestamp: number = 0;
    private processedMessageIds: Set<string> = new Set();
    private maxProcessedMessages: number = 1000; // Limit memory usage
    private lastStateUpdateTimestamp: number = 0;
    private stateUpdateDebounceMs: number = 100; // Prevent rapid state updates
    private performanceMetrics: PerformanceMetrics = {
        eventQueueSize: 0,
        networkLatency: 0,
        processingDelay: 0,
        clientPerformance: 'medium'
    };

    // Circuit breaker for infinite loop prevention
    private messageProcessingCount: number = 0;
    private lastMessageProcessingReset: number = 0;
    private maxMessagesPerSecond: number = 50; // Prevent runaway message processing
    private isProcessingBlocked: boolean = false;

    // Enhanced connection management
    private connectionState: ConnectionState = 'disconnected';
    private messageQueue: Map<string, QueuedMessage> = new Map();
    private pendingAcknowledgments: Map<string, MessageAcknowledgment> = new Map();
    private connectionHealth: ConnectionHealth = {
        state: 'disconnected',
        lastConnected: 0,
        lastMessageSent: 0,
        lastMessageReceived: 0,
        reconnectAttempts: 0,
        latency: 0,
        messageQueueSize: 0,
        failedMessages: 0
    };

    // Recovery configuration
    private recoveryConfig: RecoveryConfig = {
        maxReconnectAttempts: 10,
        reconnectInterval: 1000,
        maxReconnectInterval: 30000,
        backoffMultiplier: 1.5,
        messageTimeout: 10000,
        maxQueueSize: 1000,
        queuePersistence: true
    };

    // Timers for connection management
    private reconnectTimer: NodeJS.Timeout | null = null;
    private healthCheckTimer: NodeJS.Timeout | null = null;
    private messageTimeoutTimer: NodeJS.Timeout | null = null;

    constructor(
        appId: string,
        userId: string,
        boardId: string,
        private onEventReceived: (event: SyncWebviewEvent) => void,
        private onSnapshotReceived: (snapshot: CompressedSnapshot) => void,
        private onMouseBatchReceived: (batch: MouseMovementBatch) => void,
        private onMouseInteractionReceived: (interaction: MouseInteractionState) => void,
        private onError: (error: Error) => void,
        private onSnapshotRequested?: (request: SnapshotRequest) => void,
        private onNavigationReceived?: (navigation: NavigationEvent) => void,
        private onConnectionStateChanged?: (state: ConnectionState, health: ConnectionHealth) => void,
        private onMessageAcknowledged?: (ack: MessageAcknowledgment) => void
    ) {
        this.appId = appId;
        this.userId = userId;
        // boardId is kept for potential future use but not currently utilized

        // Load persisted queue if available
        this.loadPersistedQueue();

        // Start health monitoring
        this.startHealthMonitoring();
    }

    /**
     * Initialize the WebSocket service using SAGE3's subscription system
     */
    async initialize(): Promise<void> {
        try {
            this.setConnectionState('connecting');

            // Subscribe to all apps in the board to listen for SyncWebview messages
            this.subscription = await SocketAPI.subscribe<any>(`/apps`, (message) => {
                this.handleAppStateMessage(message);
            });

            this.isInitialized = true;
            this.setConnectionState('connected');
            this.connectionHealth.lastConnected = Date.now();
            this.connectionHealth.reconnectAttempts = 0;

            // Process any queued messages
            await this.processMessageQueue();

            console.log('SyncWebview WebSocket service initialized with SAGE3 subscriptions');
        } catch (error) {
            console.error('SyncWebview: Failed to initialize WebSocket service:', error);
            this.setConnectionState('error');
            this.onError(new Error('Failed to initialize WebSocket service'));

            // Attempt reconnection
            this.scheduleReconnect();
            throw error;
        }
    }

    /**
     * Handle incoming app state messages from SAGE3 subscription
     */
    private handleAppStateMessage(message: any): void {
        try {
            // Circuit breaker: Check for runaway message processing
            const now = Date.now();
            if (now - this.lastMessageProcessingReset > 1000) {
                // Reset counter every second
                this.messageProcessingCount = 0;
                this.lastMessageProcessingReset = now;
                this.isProcessingBlocked = false;
            }

            this.messageProcessingCount++;

            // If we're processing too many messages per second, block processing temporarily
            if (this.messageProcessingCount > this.maxMessagesPerSecond) {
                if (!this.isProcessingBlocked) {
                    console.warn('SyncWebview: Message processing rate exceeded, temporarily blocking to prevent infinite loop');
                    this.isProcessingBlocked = true;
                }
                return;
            }

            // Update connection health
            this.connectionHealth.lastMessageReceived = now;

            // Check if this is an app update message
            if (message.type !== 'UPDATE') {
                return;
            }

            const appData = message.doc;

            // Enhanced filtering to prevent processing own messages
            if (!appData?.data?.type || appData.data.type !== 'SyncWebview') {
                return;
            }

            if (!appData?.data?.state?.lastSyncMessage) {
                return;
            }

            // Critical: Don't process messages from our own app instance
            if (appData._id === this.appId) {
                console.log('SyncWebview: Skipping own app message to prevent loop');
                return;
            }

            const syncMessage = appData.data.state.lastSyncMessage;

            // Enhanced message ID validation
            const messageId = syncMessage.messageId;
            if (!messageId) {
                console.warn('SyncWebview: Message missing ID, skipping to prevent duplicates');
                return;
            }

            if (this.processedMessageIds.has(messageId)) {
                console.log('SyncWebview: Skipping already processed message:', messageId);
                return;
            }

            // Additional validation: check if message is from our own user in same app
            if (syncMessage.syncwebviewMessage?.appId === this.appId) {
                console.log('SyncWebview: Skipping message from same app ID to prevent echo');
                return;
            }

            // Check if this is a new message (avoid processing duplicates by timestamp)
            if (syncMessage.timestamp > this.lastMessageTimestamp) {
                this.lastMessageTimestamp = syncMessage.timestamp;

                // Validate message before processing
                const validation = this.validateMessage(syncMessage.syncwebviewMessage);
                if (validation.isValid && validation.sanitizedMessage) {
                    // Add message ID to processed set
                    this.processedMessageIds.add(messageId);

                    // Limit memory usage by removing old message IDs
                    if (this.processedMessageIds.size > this.maxProcessedMessages) {
                        const oldestIds = Array.from(this.processedMessageIds).slice(0, 100);
                        oldestIds.forEach(id => this.processedMessageIds.delete(id));
                    }

                    console.log('SyncWebview: Processing valid message:', messageId);
                    this.handleSyncWebviewMessage(validation.sanitizedMessage);
                } else {
                    console.warn('SyncWebview: Invalid message received:', validation.errors);
                }
            }
        } catch (error) {
            console.error('SyncWebview: Error handling app state message:', error);
            this.onError(new Error('Failed to handle incoming message'));
        }
    }

    /**
     * Validate and sanitize incoming messages
     */
    private validateMessage(message: any): MessageValidationResult {
        const errors: string[] = [];

        try {
            // Basic structure validation
            if (!message || typeof message !== 'object') {
                errors.push('Message must be an object');
                return { isValid: false, errors };
            }

            // Required fields validation
            if (!message.type || typeof message.type !== 'string') {
                errors.push('Message type is required and must be a string');
            }

            if (!message.appId || typeof message.appId !== 'string') {
                errors.push('App ID is required and must be a string');
            }

            if (!message.userId || typeof message.userId !== 'string') {
                errors.push('User ID is required and must be a string');
            }

            if (typeof message.timestamp !== 'number' || message.timestamp <= 0) {
                errors.push('Timestamp must be a positive number');
            }

            // Message type validation
            const validTypes = [
                'syncwebview-event',
                'syncwebview-snapshot',
                'syncwebview-request-snapshot',
                'syncwebview-mouse-batch',
                'syncwebview-mouse-interaction',
                'syncwebview-navigation'
            ];

            if (!validTypes.includes(message.type)) {
                errors.push(`Invalid message type: ${message.type}`);
            }

            // Data validation based on message type
            if (!message.data) {
                errors.push('Message data is required');
            }

            // Sanitize message
            const sanitizedMessage: SyncWebviewWebSocketMessage = {
                type: message.type,
                appId: String(message.appId).substring(0, 100), // Limit length
                userId: String(message.userId).substring(0, 100),
                timestamp: Number(message.timestamp),
                data: message.data // TODO: Add deeper data validation based on type
            };

            // Use centralized message processing check
            if (!this.shouldProcessMessage(message)) {
                errors.push('Message should not be processed (duplicate, self-sent, or invalid timing)');
            }

            return {
                isValid: errors.length === 0,
                errors,
                sanitizedMessage: errors.length === 0 ? sanitizedMessage : undefined
            };

        } catch (error) {
            errors.push(`Validation error: ${error instanceof Error ? error.message : 'Unknown error'}`);
            return { isValid: false, errors };
        }
    }

    /**
     * Handle incoming SyncWebview messages
     */
    private handleSyncWebviewMessage(message: SyncWebviewWebSocketMessage): void {
        const startTime = Date.now();

        try {
            // Skip messages from the same app instance to prevent echo
            if (message.appId === this.appId) {
                return;
            }

            switch (message.type) {
                case 'syncwebview-event':
                    this.onEventReceived(message.data as SyncWebviewEvent);
                    break;

                case 'syncwebview-snapshot':
                    this.onSnapshotReceived(message.data as CompressedSnapshot);
                    break;

                case 'syncwebview-request-snapshot':
                    this.handleSnapshotRequest(message);
                    break;

                case 'syncwebview-mouse-batch':
                    this.onMouseBatchReceived(message.data as MouseMovementBatch);
                    break;

                case 'syncwebview-mouse-interaction':
                    this.onMouseInteractionReceived(message.data as MouseInteractionState);
                    break;

                case 'syncwebview-navigation':
                    if (this.onNavigationReceived) {
                        this.onNavigationReceived(message.data as NavigationEvent);
                    }
                    break;

                default:
                    console.warn('SyncWebview: Unknown message type:', message.type);
            }

            // Update performance metrics
            const processingTime = Date.now() - startTime;
            this.updatePerformanceMetrics(processingTime);

        } catch (error) {
            console.error('SyncWebview: Error handling message:', error);
            this.onError(new Error('Failed to handle incoming message'));
        }
    }

    /**
     * Handle snapshot request from other clients
     */
    private handleSnapshotRequest(message: SyncWebviewWebSocketMessage): void {
        console.log('SyncWebview: Snapshot requested by:', message.userId);

        // Create snapshot request object
        const request: SnapshotRequest = {
            requesterId: message.userId,
            timestamp: message.timestamp,
            url: message.data?.url
        };

        // Trigger snapshot generation callback
        if (this.onSnapshotRequested) {
            this.onSnapshotRequested(request);
        }
    }

    /**
     * Broadcast an rrweb event to all other clients
     */
    async broadcastEvent(event: SyncWebviewEvent, priority: MessagePriority = 'normal'): Promise<void> {
        if (!this.isInitialized && this.connectionState !== 'connected') {
            console.warn('SyncWebview: WebSocket service not ready, queuing event');
        }

        try {
            const message: SyncWebviewWebSocketMessage = {
                type: 'syncwebview-event',
                appId: this.appId,
                data: event,
                timestamp: Date.now(),
                userId: this.userId
            };

            await this.sendMessage(message, priority, priority === 'critical');

        } catch (error) {
            console.error('SyncWebview: Failed to broadcast event:', error);
            this.onError(new Error('Failed to broadcast event'));
        }
    }

    /**
     * Broadcast a mouse movement batch to all other clients
     */
    async broadcastMouseBatch(batch: MouseMovementBatch): Promise<void> {
        try {
            const message: SyncWebviewWebSocketMessage = {
                type: 'syncwebview-mouse-batch',
                appId: this.appId,
                data: batch,
                timestamp: Date.now(),
                userId: this.userId
            };

            // Mouse batches are low priority and don't need acknowledgment
            await this.sendMessage(message, 'low', false);

        } catch (error) {
            console.error('SyncWebview: Failed to broadcast mouse batch:', error);
            this.onError(new Error('Failed to broadcast mouse batch'));
        }
    }

    /**
     * Broadcast a mouse interaction state to all other clients
     */
    async broadcastMouseInteraction(interaction: MouseInteractionState): Promise<void> {
        try {
            const message: SyncWebviewWebSocketMessage = {
                type: 'syncwebview-mouse-interaction',
                appId: this.appId,
                data: interaction,
                timestamp: Date.now(),
                userId: this.userId
            };

            // Mouse interactions are high priority for responsiveness
            await this.sendMessage(message, 'high', false);

        } catch (error) {
            console.error('SyncWebview: Failed to broadcast mouse interaction:', error);
            this.onError(new Error('Failed to broadcast mouse interaction'));
        }
    }

    /**
     * Broadcast a DOM snapshot to all other clients
     */
    async broadcastSnapshot(snapshot: CompressedSnapshot): Promise<void> {
        try {
            const message: SyncWebviewWebSocketMessage = {
                type: 'syncwebview-snapshot',
                appId: this.appId,
                data: snapshot,
                timestamp: Date.now(),
                userId: this.userId
            };

            // Snapshots are critical for new participants
            await this.sendMessage(message, 'critical', true);

        } catch (error) {
            console.error('SyncWebview: Failed to broadcast snapshot:', error);
            this.onError(new Error('Failed to broadcast snapshot'));
        }
    }

    /**
     * Request a snapshot from other clients
     */
    async requestSnapshot(url?: string): Promise<void> {
        try {
            const request: SnapshotRequest = {
                requesterId: this.userId,
                timestamp: Date.now(),
                url
            };

            const message: SyncWebviewWebSocketMessage = {
                type: 'syncwebview-request-snapshot',
                appId: this.appId,
                data: request,
                timestamp: Date.now(),
                userId: this.userId
            };

            // Snapshot requests are high priority
            await this.sendMessage(message, 'high', true);

        } catch (error) {
            console.error('SyncWebview: Failed to request snapshot:', error);
            this.onError(new Error('Failed to request snapshot'));
        }
    }

    /**
     * Broadcast a navigation event to all other clients
     */
    async broadcastNavigation(navigation: NavigationEvent): Promise<void> {
        try {
            const message: SyncWebviewWebSocketMessage = {
                type: 'syncwebview-navigation',
                appId: this.appId,
                data: navigation,
                timestamp: Date.now(),
                userId: this.userId
            };

            // Navigation events are critical for synchronization
            await this.sendMessage(message, 'critical', true);

        } catch (error) {
            console.error('SyncWebview: Failed to broadcast navigation:', error);
            this.onError(new Error('Failed to broadcast navigation'));
        }
    }

    /**
     * Send a message through SAGE3's app state system with enhanced error handling and queuing
     */
    private async sendMessage(
        message: SyncWebviewWebSocketMessage,
        priority: MessagePriority = 'normal',
        requiresAck: boolean = false
    ): Promise<void> {
        // Add unique message ID for tracking
        const messageId = this.generateMessageId();
        const queuedMessage: QueuedMessage = {
            id: messageId,
            message,
            priority,
            timestamp: Date.now(),
            retryCount: 0,
            maxRetries: this.getMaxRetriesForPriority(priority),
            requiresAck,
            timeout: requiresAck ? this.recoveryConfig.messageTimeout : undefined
        };

        // If not connected, queue the message
        if (this.connectionState !== 'connected') {
            this.queueMessage(queuedMessage);
            return;
        }

        try {
            await this.sendMessageDirect(queuedMessage);
        } catch (error) {
            console.error('SyncWebview: Failed to send message directly:', error);

            // Queue message for retry if it's important
            if (priority === 'critical' || priority === 'high') {
                this.queueMessage(queuedMessage);
            } else {
                this.connectionHealth.failedMessages++;
                throw error;
            }
        }
    }

    /**
     * Send message directly without queuing
     */
    private async sendMessageDirect(queuedMessage: QueuedMessage): Promise<void> {
        const { message, id, requiresAck } = queuedMessage;

        try {
            // Prevent rapid state updates that could cause loops
            const now = Date.now();
            if (now - this.lastStateUpdateTimestamp < this.stateUpdateDebounceMs) {
                console.log('SyncWebview: Debouncing state update to prevent loops');
                await new Promise(resolve => setTimeout(resolve, this.stateUpdateDebounceMs));
            }

            // Add our own message ID to processed set BEFORE sending to prevent self-processing
            this.processedMessageIds.add(id);

            // Create a temporary app state update to broadcast the message
            const messageData = {
                syncwebviewMessage: message,
                timestamp: now,
                messageId: id
            };

            console.log(`SyncWebview: Sending message (ID: ${id}, Type: ${message.type})`);

            // Update our app state with the sync message - this will be broadcast to all clients
            await SocketAPI.sendRESTMessage(`/apps/${this.appId}`, 'PUT', {
                data: {
                    state: {
                        lastSyncMessage: messageData
                    }
                }
            });

            // Update timestamps after successful send
            this.lastStateUpdateTimestamp = now;
            this.connectionHealth.lastMessageSent = now;
            this.performanceMetrics.eventQueueSize++;

            // Handle acknowledgment tracking
            if (requiresAck) {
                const ack: MessageAcknowledgment = {
                    messageId: id,
                    timestamp: now,
                    status: 'sent',
                    retryCount: queuedMessage.retryCount
                };

                this.pendingAcknowledgments.set(id, ack);

                // Set timeout for acknowledgment
                if (queuedMessage.timeout) {
                    setTimeout(() => {
                        this.handleMessageTimeout(id);
                    }, queuedMessage.timeout);
                }
            }

            console.log(`SyncWebview: Message sent successfully (ID: ${id})`);

        } catch (error) {
            // Remove from processed set if send failed
            this.processedMessageIds.delete(id);

            queuedMessage.retryCount++;

            if (queuedMessage.retryCount >= queuedMessage.maxRetries) {
                this.connectionHealth.failedMessages++;
                console.error(`SyncWebview: Message failed after ${queuedMessage.maxRetries} attempts:`, error);
                throw error;
            }

            // Exponential backoff for retry
            const delay = Math.min(
                this.recoveryConfig.reconnectInterval * Math.pow(this.recoveryConfig.backoffMultiplier, queuedMessage.retryCount - 1),
                this.recoveryConfig.maxReconnectInterval
            );

            console.log(`SyncWebview: Retrying message ${id} in ${delay}ms (attempt ${queuedMessage.retryCount})`);
            setTimeout(() => {
                this.sendMessageDirect(queuedMessage).catch(console.error);
            }, delay);
        }
    }

    /**
     * Queue message for later transmission
     */
    private queueMessage(message: QueuedMessage): void {
        // Check queue size limit
        if (this.messageQueue.size >= this.recoveryConfig.maxQueueSize) {
            // Remove oldest low-priority message
            this.removeOldestLowPriorityMessage();
        }

        this.messageQueue.set(message.id, message);
        this.connectionHealth.messageQueueSize = this.messageQueue.size;

        // Persist queue if enabled
        if (this.recoveryConfig.queuePersistence) {
            this.persistQueue();
        }

        console.log(`SyncWebview: Message queued (ID: ${message.id}, Priority: ${message.priority})`);
    }

    /**
     * Process queued messages when connection is restored
     */
    private async processMessageQueue(): Promise<void> {
        if (this.connectionState !== 'connected' || this.messageQueue.size === 0) {
            return;
        }

        console.log(`SyncWebview: Processing ${this.messageQueue.size} queued messages`);

        // Sort messages by priority and timestamp
        const sortedMessages = Array.from(this.messageQueue.values()).sort((a, b) => {
            const priorityOrder = { critical: 0, high: 1, normal: 2, low: 3 };
            const priorityDiff = priorityOrder[a.priority] - priorityOrder[b.priority];
            return priorityDiff !== 0 ? priorityDiff : a.timestamp - b.timestamp;
        });

        // Process messages in batches to avoid overwhelming the system
        const batchSize = 10;
        for (let i = 0; i < sortedMessages.length; i += batchSize) {
            const batch = sortedMessages.slice(i, i + batchSize);

            // Process messages sequentially to avoid Babel compilation issues
            for (const queuedMessage of batch) {
                try {
                    await this.sendMessageDirect(queuedMessage);
                    this.messageQueue.delete(queuedMessage.id);
                } catch (error) {
                    console.error(`SyncWebview: Failed to process queued message ${queuedMessage.id}:`, error);
                }
            }

            // Small delay between batches
            if (i + batchSize < sortedMessages.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        this.connectionHealth.messageQueueSize = this.messageQueue.size;

        // Update persisted queue
        if (this.recoveryConfig.queuePersistence) {
            this.persistQueue();
        }
    }



    /**
     * Set connection state and notify listeners
     */
    private setConnectionState(state: ConnectionState): void {
        if (this.connectionState !== state) {
            this.connectionState = state;
            this.connectionHealth.state = state;

            console.log(`SyncWebview: Connection state changed to ${state}`);

            if (this.onConnectionStateChanged) {
                this.onConnectionStateChanged(state, this.connectionHealth);
            }
        }
    }

    /**
     * Schedule reconnection attempt
     */
    private scheduleReconnect(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
        }

        if (this.connectionHealth.reconnectAttempts >= this.recoveryConfig.maxReconnectAttempts) {
            console.error('SyncWebview: Max reconnection attempts reached');
            this.setConnectionState('error');
            return;
        }

        const delay = Math.min(
            this.recoveryConfig.reconnectInterval * Math.pow(this.recoveryConfig.backoffMultiplier, this.connectionHealth.reconnectAttempts),
            this.recoveryConfig.maxReconnectInterval
        );

        this.reconnectTimer = setTimeout(() => {
            this.attemptReconnect();
        }, delay);

        console.log(`SyncWebview: Reconnection scheduled in ${delay}ms (attempt ${this.connectionHealth.reconnectAttempts + 1})`);
    }

    /**
     * Attempt to reconnect
     */
    private async attemptReconnect(): Promise<void> {
        this.connectionHealth.reconnectAttempts++;
        this.setConnectionState('reconnecting');

        try {
            await this.initialize();
            console.log('SyncWebview: Reconnection successful');
        } catch (error) {
            console.error('SyncWebview: Reconnection failed:', error);
            this.scheduleReconnect();
        }
    }

    /**
     * Start health monitoring
     */
    private startHealthMonitoring(): void {
        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
        }

        this.healthCheckTimer = setInterval(() => {
            this.performHealthCheck();
        }, 30000); // Check every 30 seconds
    }

    /**
     * Perform connection health check
     */
    private performHealthCheck(): void {
        const now = Date.now();
        const timeSinceLastMessage = now - this.connectionHealth.lastMessageReceived;

        // If no messages received for 2 minutes and we think we're connected, test connection
        if (timeSinceLastMessage > 120000 && this.connectionState === 'connected') {
            this.testConnection().then(isHealthy => {
                if (!isHealthy) {
                    console.warn('SyncWebview: Connection health check failed, attempting reconnection');
                    this.setConnectionState('error');
                    this.scheduleReconnect();
                }
            });
        }

        // Calculate latency if we have recent message activity
        if (this.connectionHealth.lastMessageSent > 0 && this.connectionHealth.lastMessageReceived > 0) {
            this.connectionHealth.latency = Math.abs(this.connectionHealth.lastMessageReceived - this.connectionHealth.lastMessageSent);
        }
    }

    /**
     * Handle message timeout
     */
    private handleMessageTimeout(messageId: string): void {
        const ack = this.pendingAcknowledgments.get(messageId);
        if (ack && ack.status === 'sent') {
            ack.status = 'timeout';
            console.warn(`SyncWebview: Message timeout (ID: ${messageId})`);

            if (this.onMessageAcknowledged) {
                this.onMessageAcknowledged(ack);
            }

            this.pendingAcknowledgments.delete(messageId);
        }
    }

    /**
     * Get max retries based on message priority
     */
    private getMaxRetriesForPriority(priority: MessagePriority): number {
        switch (priority) {
            case 'critical': return 5;
            case 'high': return 3;
            case 'normal': return 2;
            case 'low': return 1;
            default: return 2;
        }
    }

    /**
     * Remove oldest low-priority message from queue
     */
    private removeOldestLowPriorityMessage(): void {
        let oldestLowPriority: QueuedMessage | null = null;
        let oldestId: string | null = null;

        this.messageQueue.forEach((message, id) => {
            if (message.priority === 'low' || message.priority === 'normal') {
                if (!oldestLowPriority || message.timestamp < oldestLowPriority.timestamp) {
                    oldestLowPriority = message;
                    oldestId = id;
                }
            }
        });

        if (oldestId) {
            this.messageQueue.delete(oldestId);
            console.log(`SyncWebview: Removed oldest low-priority message from queue (ID: ${oldestId})`);
        }
    }

    /**
     * Persist message queue to local storage
     */
    private persistQueue(): void {
        try {
            const queueData = Array.from(this.messageQueue.entries());
            localStorage.setItem(`syncwebview_queue_${this.appId}`, JSON.stringify(queueData));
        } catch (error) {
            console.warn('SyncWebview: Failed to persist message queue:', error);
        }
    }

    /**
     * Load persisted message queue from local storage
     */
    private loadPersistedQueue(): void {
        try {
            const queueData = localStorage.getItem(`syncwebview_queue_${this.appId}`);
            if (queueData) {
                const entries: [string, QueuedMessage][] = JSON.parse(queueData);
                this.messageQueue = new Map(entries);
                this.connectionHealth.messageQueueSize = this.messageQueue.size;

                console.log(`SyncWebview: Loaded ${this.messageQueue.size} messages from persisted queue`);
            }
        } catch (error) {
            console.warn('SyncWebview: Failed to load persisted message queue:', error);
        }
    }

    /**
     * Update performance metrics
     */
    private updatePerformanceMetrics(processingTime: number): void {
        this.performanceMetrics.processingDelay = processingTime;
        this.performanceMetrics.eventQueueSize = Math.max(0, this.performanceMetrics.eventQueueSize - 1);

        // Simple performance classification based on processing time
        if (processingTime < 10) {
            this.performanceMetrics.clientPerformance = 'high';
        } else if (processingTime < 50) {
            this.performanceMetrics.clientPerformance = 'medium';
        } else {
            this.performanceMetrics.clientPerformance = 'low';
        }
    }

    /**
     * Generate a unique message ID
     */
    private generateMessageId(): string {
        return `syncwebview_${this.appId}_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    /**
     * Check if we should process this message (prevent loops and duplicates)
     */
    private shouldProcessMessage(message: any, messageId?: string): boolean {
        // Don't process messages from our own app instance
        if (message.appId === this.appId) {
            return false;
        }

        // Don't process messages we've already seen
        if (messageId && this.processedMessageIds.has(messageId)) {
            return false;
        }

        // Don't process messages that are too old (prevent replay attacks and stale messages)
        const messageAge = Date.now() - message.timestamp;
        if (messageAge > 300000) { // 5 minutes
            console.warn('SyncWebview: Ignoring old message:', messageAge);
            return false;
        }

        // Don't process messages from the future (clock skew protection)
        if (messageAge < -60000) { // 1 minute in future
            console.warn('SyncWebview: Ignoring future message:', messageAge);
            return false;
        }

        return true;
    }

    /**
     * Get current performance metrics
     */
    getPerformanceMetrics(): PerformanceMetrics {
        return { ...this.performanceMetrics };
    }

    /**
     * Get initialization status
     */
    getIsInitialized(): boolean {
        return this.isInitialized;
    }

    /**
     * Test the connection by sending a ping message
     */
    async testConnection(): Promise<boolean> {
        if (!this.isInitialized) {
            return false;
        }

        try {
            const testMessage: SyncWebviewWebSocketMessage = {
                type: 'syncwebview-event',
                appId: this.appId,
                data: {
                    id: this.generateMessageId(),
                    timestamp: Date.now(),
                    type: 'control',
                    data: { action: 'ping' },
                    userId: this.userId,
                    sessionId: this.appId
                },
                timestamp: Date.now(),
                userId: this.userId
            };

            await this.sendMessage(testMessage);
            console.log('SyncWebview: Connection test successful');
            return true;
        } catch (error) {
            console.error('SyncWebview: Connection test failed:', error);
            return false;
        }
    }

    /**
     * Get connection health status
     */
    getConnectionHealth(): ConnectionHealth {
        return { ...this.connectionHealth };
    }

    /**
     * Get connection state
     */
    getConnectionState(): ConnectionState {
        return this.connectionState;
    }

    /**
     * Get message queue status
     */
    getMessageQueueStatus(): {
        size: number;
        pendingAcknowledgments: number;
        oldestMessage?: number;
    } {
        let oldestTimestamp: number | undefined;

        if (this.messageQueue.size > 0) {
            oldestTimestamp = Math.min(...Array.from(this.messageQueue.values()).map(m => m.timestamp));
        }

        return {
            size: this.messageQueue.size,
            pendingAcknowledgments: this.pendingAcknowledgments.size,
            oldestMessage: oldestTimestamp
        };
    }

    /**
     * Force reconnection
     */
    async forceReconnect(): Promise<void> {
        console.log('SyncWebview: Forcing reconnection');

        // Clean up current connection
        if (this.subscription) {
            this.subscription();
            this.subscription = null;
        }

        this.isInitialized = false;
        this.setConnectionState('disconnected');

        // Reset reconnection attempts
        this.connectionHealth.reconnectAttempts = 0;

        // Attempt to reconnect
        await this.attemptReconnect();
    }

    /**
     * Clear message queue
     */
    clearMessageQueue(): void {
        const queueSize = this.messageQueue.size;
        this.messageQueue.clear();
        this.connectionHealth.messageQueueSize = 0;

        // Clear persisted queue
        if (this.recoveryConfig.queuePersistence) {
            try {
                localStorage.removeItem(`syncwebview_queue_${this.appId}`);
            } catch (error) {
                console.warn('SyncWebview: Failed to clear persisted queue:', error);
            }
        }

        console.log(`SyncWebview: Cleared ${queueSize} messages from queue`);
    }

    /**
     * Update recovery configuration
     */
    updateRecoveryConfig(config: Partial<RecoveryConfig>): void {
        this.recoveryConfig = { ...this.recoveryConfig, ...config };
        console.log('SyncWebview: Recovery configuration updated:', this.recoveryConfig);
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        // Clean up subscription
        if (this.subscription) {
            this.subscription();
            this.subscription = null;
        }

        // Clear timers
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        if (this.healthCheckTimer) {
            clearInterval(this.healthCheckTimer);
            this.healthCheckTimer = null;
        }

        if (this.messageTimeoutTimer) {
            clearTimeout(this.messageTimeoutTimer);
            this.messageTimeoutTimer = null;
        }

        // Clear queues and acknowledgments
        this.messageQueue.clear();
        this.pendingAcknowledgments.clear();
        this.processedMessageIds.clear();

        // Clear persisted queue
        if (this.recoveryConfig.queuePersistence) {
            try {
                localStorage.removeItem(`syncwebview_queue_${this.appId}`);
            } catch (error) {
                console.warn('SyncWebview: Failed to clear persisted queue:', error);
            }
        }

        // Reset state
        this.isInitialized = false;
        this.setConnectionState('disconnected');
        this.setConnectionState('disconnected');

        console.log('SyncWebview: WebSocket service destroyed');
    }
}