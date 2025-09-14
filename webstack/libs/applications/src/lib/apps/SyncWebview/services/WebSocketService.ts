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
    NavigationEvent
} from '../types';

/**
 * WebSocket communication service for SyncWebview
 * Handles event broadcasting and reception using SAGE3's application state system
 */
export class WebSocketService {
    private appId: string;
    private userId: string;
    private boardId: string;
    private isInitialized: boolean = false;
    private subscription: (() => void) | null = null;
    private lastMessageTimestamp: number = 0;
    private performanceMetrics: PerformanceMetrics = {
        eventQueueSize: 0,
        networkLatency: 0,
        processingDelay: 0,
        clientPerformance: 'medium'
    };

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
        private onNavigationReceived?: (navigation: NavigationEvent) => void
    ) {
        this.appId = appId;
        this.userId = userId;
        this.boardId = boardId;
    }

    /**
     * Initialize the WebSocket service using SAGE3's subscription system
     */
    async initialize(): Promise<void> {
        try {
            // Subscribe to all apps in the board to listen for SyncWebview messages
            this.subscription = await SocketAPI.subscribe<any>(`/apps`, (message) => {
                this.handleAppStateMessage(message);
            });

            this.isInitialized = true;

            console.log('SyncWebview WebSocket service initialized with SAGE3 subscriptions');
        } catch (error) {
            console.error('SyncWebview: Failed to initialize WebSocket service:', error);
            this.onError(new Error('Failed to initialize WebSocket service'));
            throw error;
        }
    }

    /**
     * Handle incoming app state messages from SAGE3 subscription
     */
    private handleAppStateMessage(message: any): void {
        try {
            // Check if this is an app update message
            if (message.type !== 'UPDATE') {
                return;
            }

            const appData = message.doc;

            // Check if this is a SyncWebview app and has sync messages
            if (appData?.data?.type === 'SyncWebview' &&
                appData?.data?.state?.lastSyncMessage &&
                appData._id !== this.appId) { // Don't process our own messages

                const syncMessage = appData.data.state.lastSyncMessage;

                // Check if this is a new message (avoid processing duplicates)
                if (syncMessage.timestamp > this.lastMessageTimestamp) {
                    this.lastMessageTimestamp = syncMessage.timestamp;
                    this.handleSyncWebviewMessage(syncMessage.syncwebviewMessage);
                }
            }
        } catch (error) {
            console.error('SyncWebview: Error handling app state message:', error);
        }
    }

    /**
     * Handle incoming SyncWebview messages
     */
    private handleSyncWebviewMessage(message: SyncWebviewWebSocketMessage): void {
        const startTime = Date.now();

        try {
            // Skip messages from the same user to prevent echo
            if (message.userId === this.userId) {
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
    async broadcastEvent(event: SyncWebviewEvent): Promise<void> {
        if (!this.isInitialized) {
            console.warn('SyncWebview: WebSocket service not initialized');
            return;
        }

        try {
            const message: SyncWebviewWebSocketMessage = {
                type: 'syncwebview-event',
                appId: this.appId,
                data: event,
                timestamp: Date.now(),
                userId: this.userId
            };

            await this.sendMessage(message);

        } catch (error) {
            console.error('SyncWebview: Failed to broadcast event:', error);
            this.onError(new Error('Failed to broadcast event'));
        }
    }

    /**
     * Broadcast a mouse movement batch to all other clients
     */
    async broadcastMouseBatch(batch: MouseMovementBatch): Promise<void> {
        if (!this.isInitialized) {
            console.warn('SyncWebview: WebSocket service not initialized');
            return;
        }

        try {
            const message: SyncWebviewWebSocketMessage = {
                type: 'syncwebview-mouse-batch',
                appId: this.appId,
                data: batch,
                timestamp: Date.now(),
                userId: this.userId
            };

            await this.sendMessage(message);

        } catch (error) {
            console.error('SyncWebview: Failed to broadcast mouse batch:', error);
            this.onError(new Error('Failed to broadcast mouse batch'));
        }
    }

    /**
     * Broadcast a mouse interaction state to all other clients
     */
    async broadcastMouseInteraction(interaction: MouseInteractionState): Promise<void> {
        if (!this.isInitialized) {
            console.warn('SyncWebview: WebSocket service not initialized');
            return;
        }

        try {
            const message: SyncWebviewWebSocketMessage = {
                type: 'syncwebview-mouse-interaction',
                appId: this.appId,
                data: interaction,
                timestamp: Date.now(),
                userId: this.userId
            };

            await this.sendMessage(message);

        } catch (error) {
            console.error('SyncWebview: Failed to broadcast mouse interaction:', error);
            this.onError(new Error('Failed to broadcast mouse interaction'));
        }
    }

    /**
     * Broadcast a DOM snapshot to all other clients
     */
    async broadcastSnapshot(snapshot: CompressedSnapshot): Promise<void> {
        if (!this.isInitialized) {
            console.warn('SyncWebview: WebSocket service not initialized');
            return;
        }

        try {
            const message: SyncWebviewWebSocketMessage = {
                type: 'syncwebview-snapshot',
                appId: this.appId,
                data: snapshot,
                timestamp: Date.now(),
                userId: this.userId
            };

            await this.sendMessage(message);

        } catch (error) {
            console.error('SyncWebview: Failed to broadcast snapshot:', error);
            this.onError(new Error('Failed to broadcast snapshot'));
        }
    }

    /**
     * Request a snapshot from other clients
     */
    async requestSnapshot(url?: string): Promise<void> {
        if (!this.isInitialized) {
            console.warn('SyncWebview: WebSocket service not initialized');
            return;
        }

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

            await this.sendMessage(message);

        } catch (error) {
            console.error('SyncWebview: Failed to request snapshot:', error);
            this.onError(new Error('Failed to request snapshot'));
        }
    }

    /**
     * Broadcast a navigation event to all other clients
     */
    async broadcastNavigation(navigation: NavigationEvent): Promise<void> {
        if (!this.isInitialized) {
            console.warn('SyncWebview: WebSocket service not initialized');
            return;
        }

        try {
            const message: SyncWebviewWebSocketMessage = {
                type: 'syncwebview-navigation',
                appId: this.appId,
                data: navigation,
                timestamp: Date.now(),
                userId: this.userId
            };

            await this.sendMessage(message);

        } catch (error) {
            console.error('SyncWebview: Failed to broadcast navigation:', error);
            this.onError(new Error('Failed to broadcast navigation'));
        }
    }

    /**
     * Send a message through SAGE3's app state system with retry logic
     */
    private async sendMessage(message: SyncWebviewWebSocketMessage): Promise<void> {
        const maxRetries = 3;
        let retryCount = 0;

        while (retryCount < maxRetries) {
            try {
                // Create a temporary app state update to broadcast the message
                const messageData = {
                    syncwebviewMessage: message,
                    timestamp: Date.now()
                };

                // Update our app state with the sync message - this will be broadcast to all clients
                await SocketAPI.sendRESTMessage(`/apps/${this.appId}`, 'PUT', {
                    data: {
                        state: {
                            lastSyncMessage: messageData
                        }
                    }
                });

                // Update performance metrics on success
                this.performanceMetrics.eventQueueSize++;
                return; // Success, exit retry loop

            } catch (error) {
                retryCount++;
                console.error(`SyncWebview: Failed to send message (attempt ${retryCount}/${maxRetries}):`, error);

                if (retryCount >= maxRetries) {
                    // Max retries reached, trigger error callback
                    this.onError(new Error(`Failed to send message after ${maxRetries} attempts`));
                    throw error;
                }

                // Wait before retrying (exponential backoff)
                const delay = Math.min(1000 * Math.pow(2, retryCount - 1), 5000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
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
    getConnectionHealth(): {
        isConnected: boolean;
        lastMessageTime: number;
        performanceMetrics: PerformanceMetrics;
    } {
        return {
            isConnected: this.isInitialized,
            lastMessageTime: this.lastMessageTimestamp,
            performanceMetrics: this.getPerformanceMetrics()
        };
    }

    /**
     * Clean up resources
     */
    destroy(): void {
        if (this.subscription) {
            this.subscription();
            this.subscription = null;
        }

        this.isInitialized = false;

        console.log('SyncWebview: WebSocket service destroyed');
    }
}