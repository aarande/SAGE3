/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

/**
 * TypeScript interfaces for SyncWebview application
 */

// rrweb event types and interfaces
export interface SyncWebviewEvent {
  id: string;
  timestamp: number;
  type: 'rrweb' | 'snapshot' | 'control';
  data: any; // rrweb event data
  userId: string;
  sessionId: string;
}

// WebSocket message format for SAGE3 communication
export interface SyncWebviewWebSocketMessage {
  type: 'syncwebview-event' | 'syncwebview-snapshot' | 'syncwebview-request-snapshot' | 'syncwebview-mouse-batch' | 'syncwebview-mouse-interaction' | 'syncwebview-navigation';
  appId: string;
  data: any; // rrweb event data or DOM snapshot
  timestamp: number;
  userId: string;
}

// Mouse movement optimization context
export interface MouseEventContext {
  isInteracting: boolean; // Mouse button is pressed
  interactionType: 'click' | 'drag' | 'hover' | 'none';
  lastSignificantMove: number;
  velocity: number;
  element: HTMLElement | null;
}

// Mouse prediction for interpolation
export interface MousePrediction {
  predictedX: number;
  predictedY: number;
  confidence: number;
  timestamp: number;
}

// Mouse move event for batching
export interface MouseMoveEvent {
  x: number;
  y: number;
  timestamp: number;
  target?: string; // CSS selector of target element
}

// Mouse interaction state broadcasting
export interface MouseInteractionState {
  type: 'mousedown' | 'mouseup' | 'dragstart' | 'dragend';
  timestamp: number;
  position: { x: number; y: number };
  element: string; // CSS selector
}

// Batched mouse movement transmission
export interface MouseMovementBatch {
  events: MouseMoveEvent[];
  startTime: number;
  endTime: number;
  interactionContext: MouseEventContext;
}

// Performance metrics for auto-adjustment
export interface PerformanceMetrics {
  eventQueueSize: number;
  networkLatency: number;
  processingDelay: number;
  clientPerformance: 'high' | 'medium' | 'low';
}

// Event recorder configuration
export interface RecorderConfig {
  emit: (event: any) => void;
  sampling: {
    mousemove: boolean;
    mouseInteraction: Record<string, boolean>;
  };
  plugins: any[];
  maskAllInputs: boolean;
  maskInputOptions: {
    password: boolean;
  };
  blockClass: string;
  maskTextClass: string;
}

// Event replayer configuration
export interface ReplayerConfig {
  target: HTMLElement;
  data: any[];
  liveMode: boolean;
  insertStyleRules: string[];
}

// Web Worker message types
export interface WorkerMessage {
  type: 'event' | 'batch' | 'snapshot' | 'config' | 'error' | 'mouse-batch' | 'mouse-interaction';
  payload: any;
  timestamp: number;
}

// Enhanced performance metrics with adaptive sampling
export interface AdaptiveSamplingConfig {
  mouseSamplingRate: number; // Dynamic mouse sampling rate in ms
  eventDropRate: number; // Percentage of events to drop under load (0-1)
  lastAdaptation: number; // Timestamp of last adaptation
  adaptationInterval: number; // How often to adapt performance in ms
}

// Worker performance metrics
export interface WorkerPerformanceMetrics extends PerformanceMetrics {
  adaptiveSampling: AdaptiveSamplingConfig;
  batchInterval: number; // Current batch processing interval
}

// Mouse optimization strategies for different element types
export type MouseStrategy = 'high-fidelity' | 'drag-optimized' | 'media-optimized' | 'standard';

// Compressed snapshot data structure for state synchronization
export interface CompressedSnapshot {
  data: string; // Compressed snapshot data
  timestamp: number;
  url: string;
  zoom: number;
  compressionMethod: 'gzip' | 'lz4' | 'none';
  originalSize: number;
  compressedSize: number;
}

// Snapshot cache entry for managing cached snapshots
export interface SnapshotCacheEntry {
  snapshot: CompressedSnapshot;
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
}

// Snapshot request/response data structures
export interface SnapshotRequest {
  requesterId: string;
  timestamp: number;
  url?: string; // Optional URL filter
}

export interface SnapshotResponse {
  snapshot: CompressedSnapshot;
  providerId: string;
  timestamp: number;
}

// Navigation state for tracking browser history
export interface NavigationState {
  canGoBack: boolean;
  canGoForward: boolean;
  currentIndex: number;
  history: string[];
}

// Navigation event for synchronization across clients
export interface NavigationEvent {
  type: 'navigate' | 'back' | 'forward' | 'refresh';
  url?: string;
  timestamp: number;
  userId: string;
  sessionId: string;
}

// Connection state for WebSocket management
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

// Message priority levels for queuing
export type MessagePriority = 'critical' | 'high' | 'normal' | 'low';

// Message acknowledgment interface
export interface MessageAcknowledgment {
  messageId: string;
  timestamp: number;
  status: 'sent' | 'delivered' | 'failed' | 'timeout';
  retryCount: number;
}

// Queued message for offline scenarios
export interface QueuedMessage {
  id: string;
  message: SyncWebviewWebSocketMessage;
  priority: MessagePriority;
  timestamp: number;
  retryCount: number;
  maxRetries: number;
  requiresAck: boolean;
  timeout?: number;
}

// Connection health metrics
export interface ConnectionHealth {
  state: ConnectionState;
  lastConnected: number;
  lastMessageSent: number;
  lastMessageReceived: number;
  reconnectAttempts: number;
  latency: number;
  messageQueueSize: number;
  failedMessages: number;
}

// Message validation result
export interface MessageValidationResult {
  isValid: boolean;
  errors: string[];
  sanitizedMessage?: SyncWebviewWebSocketMessage;
}

// Recovery strategy configuration
export interface RecoveryConfig {
  maxReconnectAttempts: number;
  reconnectInterval: number;
  maxReconnectInterval: number;
  backoffMultiplier: number;
  messageTimeout: number;
  maxQueueSize: number;
  queuePersistence: boolean;
}

// Application event types for internal communication
export type SyncWebviewAppEvent =
  | { type: 'START_RECORDING'; payload: { url: string } }
  | { type: 'STOP_RECORDING' }
  | { type: 'START_REPLAYING' }
  | { type: 'STOP_REPLAYING' }
  | { type: 'URL_CHANGED'; payload: { url: string } }
  | { type: 'ZOOM_CHANGED'; payload: { zoom: number } }
  | { type: 'PRIVACY_UPDATED'; payload: { maskPasswords: boolean; maskElements: string[] } }
  | { type: 'EVENT_RECEIVED'; payload: SyncWebviewEvent }
  | { type: 'SNAPSHOT_REQUESTED'; payload: SnapshotRequest }
  | { type: 'SNAPSHOT_RECEIVED'; payload: SnapshotResponse }
  | { type: 'SNAPSHOT_GENERATED'; payload: CompressedSnapshot }
  | { type: 'MOUSE_BATCH_RECEIVED'; payload: MouseMovementBatch }
  | { type: 'MOUSE_INTERACTION_RECEIVED'; payload: MouseInteractionState }
  | { type: 'NAVIGATION_EVENT'; payload: NavigationEvent }
  | { type: 'CONNECTION_STATE_CHANGED'; payload: { state: ConnectionState; health: ConnectionHealth } }
  | { type: 'MESSAGE_ACKNOWLEDGED'; payload: MessageAcknowledgment }
  | { type: 'MESSAGE_FAILED'; payload: { messageId: string; error: string } };