/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import type { eventWithTime } from '@rrweb/types';
import { 
  WorkerMessage, 
  SyncWebviewEvent, 
  MouseMoveEvent, 
  MouseMovementBatch,
  PerformanceMetrics 
} from '../types';

/**
 * Web Worker for processing rrweb events off the main thread
 * Handles event batching, buffering, and optimization
 */

// Worker context
const ctx: Worker = self as any;

class EventProcessor {
  private eventQueue: SyncWebviewEvent[] = [];
  private mouseEventBuffer: MouseMoveEvent[] = [];
  private batchTimer: number | null = null;
  private batchInterval = 100; // Dynamic batching interval
  private readonly MIN_BATCH_INTERVAL = 16; // ~60fps
  private readonly MAX_BATCH_INTERVAL = 500; // 2fps
  private readonly MAX_QUEUE_SIZE = 1000;
  private readonly MAX_MOUSE_BUFFER = 50;
  private performanceMetrics: PerformanceMetrics = {
    eventQueueSize: 0,
    networkLatency: 0,
    processingDelay: 0,
    clientPerformance: 'medium',
  };
  private adaptiveSampling = {
    mouseSamplingRate: 100, // Dynamic mouse sampling rate
    eventDropRate: 0, // Percentage of events to drop under load
    lastAdaptation: Date.now(),
    adaptationInterval: 1000, // Adapt every second
  };

  constructor() {
    this.startBatchProcessor();
  }

  /**
   * Process incoming events from main thread
   */
  public processEvent(message: WorkerMessage): void {
    const startTime = performance.now();

    try {
      switch (message.type) {
        case 'event':
          this.handleEvent(message.payload as SyncWebviewEvent);
          break;
        case 'batch':
          this.handleBatch(message.payload as SyncWebviewEvent[]);
          break;
        case 'snapshot':
          this.handleSnapshot(message.payload);
          break;
        case 'config':
          this.updateConfig(message.payload);
          break;
        default:
          console.warn('EventProcessor: Unknown message type:', message.type);
      }

      // Update performance metrics
      const processingTime = performance.now() - startTime;
      this.updatePerformanceMetrics(processingTime);

    } catch (error) {
      console.error('EventProcessor: Error processing event:', error);
      this.postMessage({
        type: 'error',
        payload: { error: error.message, timestamp: Date.now() },
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Handle individual events with adaptive sampling
   */
  private handleEvent(event: SyncWebviewEvent): void {
    // Apply adaptive sampling - drop events if under load
    if (this.shouldDropEvent(event)) {
      return;
    }

    // Check if it's a mouse movement event that needs special handling
    if (this.isMouseMoveEvent(event)) {
      this.bufferMouseEvent(event);
      return;
    }

    // Add to queue for batching
    this.eventQueue.push(event);

    // Check queue size limits
    if (this.eventQueue.length > this.MAX_QUEUE_SIZE) {
      console.warn('EventProcessor: Queue size exceeded, dropping oldest events');
      this.eventQueue = this.eventQueue.slice(-this.MAX_QUEUE_SIZE);
    }

    // For high-priority events, send immediately
    if (this.isHighPriorityEvent(event)) {
      this.sendEvent(event);
      this.removeFromQueue(event);
    }
  }

  /**
   * Handle batch of events
   */
  private handleBatch(events: SyncWebviewEvent[]): void {
    events.forEach(event => this.handleEvent(event));
  }

  /**
   * Handle snapshot requests
   */
  private handleSnapshot(payload: any): void {
    // Process and compress snapshot data
    const compressedSnapshot = this.compressSnapshot(payload);
    
    this.postMessage({
      type: 'snapshot',
      payload: compressedSnapshot,
      timestamp: Date.now(),
    });
  }

  /**
   * Update worker configuration
   */
  private updateConfig(config: any): void {
    console.log('EventProcessor: Configuration updated:', config);
    // Apply configuration changes
  }

  /**
   * Check if event is a mouse movement
   */
  private isMouseMoveEvent(event: SyncWebviewEvent): boolean {
    return (
      event.type === 'rrweb' &&
      event.data &&
      event.data.type === 3 && // MouseMove event type
      event.data.data &&
      event.data.data.source === 2 && // MouseInteraction source
      event.data.data.type === 0 // MouseMove type
    );
  }

  /**
   * Buffer mouse events for intelligent batching with adaptive sampling
   */
  private bufferMouseEvent(event: SyncWebviewEvent): void {
    // Apply adaptive mouse sampling
    const timeSinceLastMouse = Date.now() - (this.mouseEventBuffer[this.mouseEventBuffer.length - 1]?.timestamp || 0);
    if (timeSinceLastMouse < this.adaptiveSampling.mouseSamplingRate) {
      // Skip this mouse event due to sampling rate
      return;
    }

    const mouseEvent: MouseMoveEvent = {
      x: event.data.data.x,
      y: event.data.data.y,
      timestamp: event.timestamp,
      target: event.data.data.id?.toString(),
    };

    this.mouseEventBuffer.push(mouseEvent);

    // Limit buffer size
    if (this.mouseEventBuffer.length > this.MAX_MOUSE_BUFFER) {
      this.mouseEventBuffer = this.mouseEventBuffer.slice(-this.MAX_MOUSE_BUFFER);
    }
  }

  /**
   * Check if event should be sent immediately
   */
  private isHighPriorityEvent(event: SyncWebviewEvent): boolean {
    if (event.type !== 'rrweb') return true;

    const eventType = event.data?.type;
    const interactionType = event.data?.data?.type;

    // High priority events that need immediate transmission
    return (
      eventType === 2 || // DOMContentLoaded
      eventType === 4 || // IncrementalSnapshot
      eventType === 5 || // Meta
      eventType === 6 || // FullSnapshot
      (eventType === 3 && interactionType === 2) || // Click
      (eventType === 3 && interactionType === 3) || // ContextMenu
      (eventType === 3 && interactionType === 4) || // DblClick
      (eventType === 3 && interactionType === 7) || // Focus
      (eventType === 3 && interactionType === 8)    // Blur
    );
  }

  /**
   * Remove event from queue
   */
  private removeFromQueue(event: SyncWebviewEvent): void {
    const index = this.eventQueue.findIndex(e => e.id === event.id);
    if (index !== -1) {
      this.eventQueue.splice(index, 1);
    }
  }

  /**
   * Start the batch processor timer with adaptive interval
   */
  private startBatchProcessor(): void {
    this.batchTimer = setInterval(() => {
      this.processBatch();
      this.adaptPerformance();
    }, this.batchInterval) as any;
  }

  /**
   * Restart batch processor with new interval
   */
  private restartBatchProcessor(): void {
    if (this.batchTimer) {
      clearInterval(this.batchTimer);
    }
    this.startBatchProcessor();
  }

  /**
   * Process and send batched events
   */
  private processBatch(): void {
    if (this.eventQueue.length === 0 && this.mouseEventBuffer.length === 0) {
      return;
    }

    const batch: any = {
      events: [...this.eventQueue],
      mouseEvents: this.optimizeMouseEvents(),
      timestamp: Date.now(),
      metrics: this.performanceMetrics,
    };

    // Send batch to main thread
    this.postMessage({
      type: 'batch',
      payload: batch,
      timestamp: Date.now(),
    });

    // Clear processed events
    this.eventQueue = [];
    this.mouseEventBuffer = [];
  }

  /**
   * Optimize mouse events by removing redundant movements
   */
  private optimizeMouseEvents(): MouseMovementBatch | null {
    if (this.mouseEventBuffer.length === 0) return null;

    // Sort by timestamp
    const sortedEvents = this.mouseEventBuffer.sort((a, b) => a.timestamp - b.timestamp);
    
    // Remove redundant movements (keep only significant changes)
    const optimizedEvents = this.removeRedundantMouseMoves(sortedEvents);

    if (optimizedEvents.length === 0) return null;

    return {
      events: optimizedEvents,
      startTime: sortedEvents[0].timestamp,
      endTime: sortedEvents[sortedEvents.length - 1].timestamp,
      interactionContext: {
        isInteracting: false, // Will be determined by main thread
        interactionType: 'hover',
        lastSignificantMove: Date.now(),
        velocity: this.calculateAverageVelocity(optimizedEvents),
        element: null,
      },
    };
  }

  /**
   * Remove redundant mouse movements
   */
  private removeRedundantMouseMoves(events: MouseMoveEvent[]): MouseMoveEvent[] {
    if (events.length <= 2) return events;

    const optimized: MouseMoveEvent[] = [events[0]]; // Always keep first event
    const DISTANCE_THRESHOLD = 5; // Minimum pixel distance
    const TIME_THRESHOLD = 50; // Minimum time difference (ms)

    for (let i = 1; i < events.length - 1; i++) {
      const current = events[i];
      const last = optimized[optimized.length - 1];
      
      const distance = Math.sqrt(
        Math.pow(current.x - last.x, 2) + Math.pow(current.y - last.y, 2)
      );
      
      const timeDiff = current.timestamp - last.timestamp;

      // Keep event if it moved significantly or enough time passed
      if (distance >= DISTANCE_THRESHOLD || timeDiff >= TIME_THRESHOLD) {
        optimized.push(current);
      }
    }

    // Always keep last event
    if (events.length > 1) {
      optimized.push(events[events.length - 1]);
    }

    return optimized;
  }

  /**
   * Calculate average velocity of mouse movements
   */
  private calculateAverageVelocity(events: MouseMoveEvent[]): number {
    if (events.length < 2) return 0;

    let totalVelocity = 0;
    let validMeasurements = 0;

    for (let i = 1; i < events.length; i++) {
      const current = events[i];
      const previous = events[i - 1];
      
      const distance = Math.sqrt(
        Math.pow(current.x - previous.x, 2) + Math.pow(current.y - previous.y, 2)
      );
      
      const timeDiff = current.timestamp - previous.timestamp;
      
      if (timeDiff > 0) {
        totalVelocity += distance / timeDiff;
        validMeasurements++;
      }
    }

    return validMeasurements > 0 ? totalVelocity / validMeasurements : 0;
  }

  /**
   * Compress snapshot data
   */
  private compressSnapshot(snapshot: any): any {
    // Simple compression - in production, could use more sophisticated methods
    try {
      const jsonString = JSON.stringify(snapshot);
      // For now, just return as-is. Could implement LZ compression here
      return {
        data: jsonString,
        compressed: false,
        originalSize: jsonString.length,
        compressedSize: jsonString.length,
      };
    } catch (error) {
      console.error('EventProcessor: Error compressing snapshot:', error);
      return { data: null, error: error.message };
    }
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(processingTime: number): void {
    this.performanceMetrics.eventQueueSize = this.eventQueue.length;
    this.performanceMetrics.processingDelay = processingTime;
    
    // Determine client performance based on processing time
    if (processingTime < 5) {
      this.performanceMetrics.clientPerformance = 'high';
    } else if (processingTime < 20) {
      this.performanceMetrics.clientPerformance = 'medium';
    } else {
      this.performanceMetrics.clientPerformance = 'low';
    }
  }

  /**
   * Adaptive performance optimization based on current metrics
   */
  private adaptPerformance(): void {
    const now = Date.now();
    
    // Only adapt every second to avoid thrashing
    if (now - this.adaptiveSampling.lastAdaptation < this.adaptiveSampling.adaptationInterval) {
      return;
    }

    const queueSize = this.performanceMetrics.eventQueueSize;
    const processingDelay = this.performanceMetrics.processingDelay;
    const clientPerformance = this.performanceMetrics.clientPerformance;

    let needsRestart = false;

    // Adapt batch interval based on performance
    const oldInterval = this.batchInterval;
    
    if (clientPerformance === 'low' || queueSize > 500) {
      // Reduce frequency under load
      this.batchInterval = Math.min(this.batchInterval * 1.5, this.MAX_BATCH_INTERVAL);
      this.adaptiveSampling.mouseSamplingRate = Math.min(this.adaptiveSampling.mouseSamplingRate * 1.5, 500);
      this.adaptiveSampling.eventDropRate = Math.min(this.adaptiveSampling.eventDropRate + 0.1, 0.5);
    } else if (clientPerformance === 'high' && queueSize < 100) {
      // Increase frequency when performance is good
      this.batchInterval = Math.max(this.batchInterval * 0.8, this.MIN_BATCH_INTERVAL);
      this.adaptiveSampling.mouseSamplingRate = Math.max(this.adaptiveSampling.mouseSamplingRate * 0.8, 50);
      this.adaptiveSampling.eventDropRate = Math.max(this.adaptiveSampling.eventDropRate - 0.05, 0);
    }

    // Restart timer if interval changed significantly
    if (Math.abs(oldInterval - this.batchInterval) > 10) {
      needsRestart = true;
    }

    // Emergency throttling for extreme load
    if (queueSize > 800 || processingDelay > 100) {
      this.batchInterval = this.MAX_BATCH_INTERVAL;
      this.adaptiveSampling.eventDropRate = 0.7;
      needsRestart = true;
      
      console.warn('EventProcessor: Emergency throttling activated', {
        queueSize,
        processingDelay,
        newInterval: this.batchInterval,
        dropRate: this.adaptiveSampling.eventDropRate
      });
    }

    if (needsRestart) {
      this.restartBatchProcessor();
    }

    this.adaptiveSampling.lastAdaptation = now;

    // Log adaptation for debugging
    if (oldInterval !== this.batchInterval) {
      console.log('EventProcessor: Performance adapted', {
        oldInterval,
        newInterval: this.batchInterval,
        mouseSamplingRate: this.adaptiveSampling.mouseSamplingRate,
        eventDropRate: this.adaptiveSampling.eventDropRate,
        queueSize,
        clientPerformance
      });
    }
  }

  /**
   * Check if event should be dropped due to adaptive sampling
   */
  private shouldDropEvent(event: SyncWebviewEvent): boolean {
    // Never drop high-priority events
    if (this.isHighPriorityEvent(event)) {
      return false;
    }

    // Apply drop rate for low-priority events
    return Math.random() < this.adaptiveSampling.eventDropRate;
  }

  /**
   * Send message to main thread with performance tracking
   */
  private postMessage(message: WorkerMessage): void {
    // Add performance metrics to outgoing messages
    if (message.type === 'batch' || message.type === 'event') {
      message.payload = {
        ...message.payload,
        workerMetrics: {
          ...this.performanceMetrics,
          adaptiveSampling: this.adaptiveSampling,
          batchInterval: this.batchInterval,
        }
      };
    }
    
    ctx.postMessage(message);
  }

  /**
   * Update network latency from main thread feedback
   */
  public updateNetworkLatency(latency: number): void {
    this.performanceMetrics.networkLatency = latency;
  }
}

// Initialize the event processor
const processor = new EventProcessor();

// Handle messages from main thread
ctx.addEventListener('message', (event: MessageEvent<WorkerMessage>) => {
  processor.processEvent(event.data);
});

// Handle worker errors
ctx.addEventListener('error', (error: ErrorEvent) => {
  console.error('EventProcessor Worker Error:', error);
  ctx.postMessage({
    type: 'error',
    payload: { error: error.message, filename: error.filename, lineno: error.lineno },
    timestamp: Date.now(),
  });
});

// Export for TypeScript (won't be used in worker context)
export default processor;