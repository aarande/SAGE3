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
  type: 'syncwebview-event' | 'syncwebview-snapshot' | 'syncwebview-request-snapshot';
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
  type: 'event' | 'batch' | 'snapshot' | 'config' | 'error';
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
  | { type: 'SNAPSHOT_REQUESTED' }
  | { type: 'SNAPSHOT_RECEIVED'; payload: { snapshot: string; timestamp: number } };