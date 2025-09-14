/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { WorkerMessage, SyncWebviewEvent, MouseMovementBatch, PerformanceMetrics, MouseInteractionState } from '../types';

/**
 * Service to manage the Event Processor Web Worker
 * Handles communication between main thread and worker
 */
export class WorkerManagerService {
  private worker: Worker | null = null;
  private isInitialized = false;
  private messageHandlers: Map<string, (payload: any) => void> = new Map();
  private eventCallback: (event: SyncWebviewEvent) => void;
  private batchCallback: (batch: any) => void;
  private errorCallback: (error: any) => void;
  private performanceMonitor = {
    sentMessages: new Map<string, number>(), // messageId -> timestamp
    networkLatencies: [] as number[],
    maxLatencyHistory: 100,
  };

  constructor(
    eventCallback: (event: SyncWebviewEvent) => void,
    batchCallback: (batch: any) => void,
    errorCallback: (error: any) => void
  ) {
    this.eventCallback = eventCallback;
    this.batchCallback = batchCallback;
    this.errorCallback = errorCallback;
  }

  /**
   * Initialize the Web Worker
   */
  public async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.warn('WorkerManagerService: Already initialized');
      return;
    }

    try {
      // Create worker from inline code since we can't easily load external files in SAGE3
      const workerCode = this.getWorkerCode();
      const blob = new Blob([workerCode], { type: 'application/javascript' });
      const workerUrl = URL.createObjectURL(blob);
      
      this.worker = new Worker(workerUrl);
      this.setupWorkerHandlers();
      this.isInitialized = true;
      
      console.log('WorkerManagerService: Worker initialized');
      
      // Clean up the blob URL
      URL.revokeObjectURL(workerUrl);
    } catch (error) {
      console.error('WorkerManagerService: Failed to initialize worker:', error);
      throw error;
    }
  }

  /**
   * Send event to worker for processing with performance tracking
   */
  public processEvent(event: SyncWebviewEvent): void {
    if (!this.worker || !this.isInitialized) {
      console.warn('WorkerManagerService: Worker not initialized, processing on main thread');
      this.eventCallback(event);
      return;
    }

    const messageId = `${event.id}-${Date.now()}`;
    const message: WorkerMessage = {
      type: 'event',
      payload: { ...event, messageId },
      timestamp: Date.now(),
    };

    // Track message for latency monitoring
    this.performanceMonitor.sentMessages.set(messageId, Date.now());
    
    this.worker.postMessage(message);
  }

  /**
   * Send batch of events to worker
   */
  public processBatch(events: SyncWebviewEvent[]): void {
    if (!this.worker || !this.isInitialized) {
      console.warn('WorkerManagerService: Worker not initialized');
      return;
    }

    const message: WorkerMessage = {
      type: 'batch',
      payload: events,
      timestamp: Date.now(),
    };

    this.worker.postMessage(message);
  }

  /**
   * Send mouse batch to worker for processing
   */
  public processMouseBatch(batch: MouseMovementBatch): void {
    if (!this.worker || !this.isInitialized) {
      console.warn('WorkerManagerService: Worker not initialized');
      return;
    }

    const message: WorkerMessage = {
      type: 'mouse-batch',
      payload: batch,
      timestamp: Date.now(),
    };

    this.worker.postMessage(message);
  }

  /**
   * Send mouse interaction to worker for processing
   */
  public processMouseInteraction(interaction: MouseInteractionState): void {
    if (!this.worker || !this.isInitialized) {
      console.warn('WorkerManagerService: Worker not initialized');
      return;
    }

    const message: WorkerMessage = {
      type: 'mouse-interaction',
      payload: interaction,
      timestamp: Date.now(),
    };

    this.worker.postMessage(message);
  }

  /**
   * Send snapshot to worker for processing
   */
  public processSnapshot(snapshot: any): void {
    if (!this.worker || !this.isInitialized) {
      console.warn('WorkerManagerService: Worker not initialized');
      return;
    }

    const message: WorkerMessage = {
      type: 'snapshot',
      payload: snapshot,
      timestamp: Date.now(),
    };

    this.worker.postMessage(message);
  }

  /**
   * Update worker configuration
   */
  public updateConfig(config: any): void {
    if (!this.worker || !this.isInitialized) {
      console.warn('WorkerManagerService: Worker not initialized');
      return;
    }

    const message: WorkerMessage = {
      type: 'config',
      payload: config,
      timestamp: Date.now(),
    };

    this.worker.postMessage(message);
  }

  /**
   * Terminate the worker
   */
  public terminate(): void {
    if (this.worker) {
      this.worker.terminate();
      this.worker = null;
      this.isInitialized = false;
      console.log('WorkerManagerService: Worker terminated');
    }
  }

  /**
   * Check if worker is initialized
   */
  public getIsInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Setup worker message handlers
   */
  private setupWorkerHandlers(): void {
    if (!this.worker) return;

    this.worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const { type, payload } = event.data;

      // Track network latency if message has ID
      if (payload?.messageId) {
        this.trackNetworkLatency(payload.messageId);
      }

      switch (type) {
        case 'event':
          this.eventCallback(payload as SyncWebviewEvent);
          break;
        case 'batch':
          this.batchCallback(payload);
          break;
        case 'snapshot':
          this.handleSnapshotResponse(payload);
          break;
        case 'mouse-batch':
          this.handleMouseBatchResponse(payload);
          break;
        case 'mouse-interaction':
          this.handleMouseInteractionResponse(payload);
          break;
        case 'error':
          this.errorCallback(payload);
          break;
        default:
          console.warn('WorkerManagerService: Unknown message type from worker:', type);
      }
    };

    this.worker.onerror = (error: ErrorEvent) => {
      console.error('WorkerManagerService: Worker error:', error);
      this.errorCallback({
        message: error.message,
        filename: error.filename,
        lineno: error.lineno,
        colno: error.colno,
      });
    };

    this.worker.onmessageerror = (error: MessageEvent) => {
      console.error('WorkerManagerService: Worker message error:', error);
      this.errorCallback({
        message: 'Message error in worker',
        error: error,
      });
    };
  }

  /**
   * Handle snapshot response from worker
   */
  private handleSnapshotResponse(payload: any): void {
    console.log('WorkerManagerService: Received processed snapshot from worker');
    // Handle the processed snapshot
  }

  /**
   * Handle mouse batch response from worker
   */
  private handleMouseBatchResponse(payload: any): void {
    console.log('WorkerManagerService: Received optimized mouse batch from worker:', payload);
    this.batchCallback(payload);
  }

  /**
   * Handle mouse interaction response from worker
   */
  private handleMouseInteractionResponse(payload: any): void {
    console.log('WorkerManagerService: Received processed mouse interaction from worker:', payload);
    // Handle the processed mouse interaction
  }

  /**
   * Track network latency for performance monitoring
   */
  private trackNetworkLatency(messageId: string): void {
    const sentTime = this.performanceMonitor.sentMessages.get(messageId);
    if (sentTime) {
      const latency = Date.now() - sentTime;
      this.performanceMonitor.networkLatencies.push(latency);
      
      // Keep only recent latencies
      if (this.performanceMonitor.networkLatencies.length > this.performanceMonitor.maxLatencyHistory) {
        this.performanceMonitor.networkLatencies = this.performanceMonitor.networkLatencies.slice(-this.performanceMonitor.maxLatencyHistory);
      }
      
      // Send average latency back to worker
      const avgLatency = this.performanceMonitor.networkLatencies.reduce((a, b) => a + b, 0) / this.performanceMonitor.networkLatencies.length;
      this.updateWorkerNetworkLatency(avgLatency);
      
      // Clean up tracked message
      this.performanceMonitor.sentMessages.delete(messageId);
    }
  }

  /**
   * Update worker with current network latency
   */
  private updateWorkerNetworkLatency(latency: number): void {
    if (!this.worker || !this.isInitialized) return;

    const message: WorkerMessage = {
      type: 'config',
      payload: { networkLatency: latency },
      timestamp: Date.now(),
    };

    this.worker.postMessage(message);
  }

  /**
   * Get current performance metrics
   */
  public getPerformanceMetrics(): any {
    const avgLatency = this.performanceMonitor.networkLatencies.length > 0
      ? this.performanceMonitor.networkLatencies.reduce((a, b) => a + b, 0) / this.performanceMonitor.networkLatencies.length
      : 0;

    return {
      averageNetworkLatency: avgLatency,
      recentLatencies: this.performanceMonitor.networkLatencies.slice(-10),
      pendingMessages: this.performanceMonitor.sentMessages.size,
    };
  }

  /**
   * Get the worker code as a string (inline worker)
   */
  private getWorkerCode(): string {
    return `
      // Inline Web Worker for Event Processing
      class EventProcessor {
        constructor() {
          this.eventQueue = [];
          this.mouseEventBuffer = [];
          this.batchTimer = null;
          this.batchInterval = 100;
          this.MIN_BATCH_INTERVAL = 16;
          this.MAX_BATCH_INTERVAL = 500;
          this.MAX_QUEUE_SIZE = 1000;
          this.MAX_MOUSE_BUFFER = 50;
          this.performanceMetrics = {
            eventQueueSize: 0,
            networkLatency: 0,
            processingDelay: 0,
            clientPerformance: 'medium',
          };
          this.adaptiveSampling = {
            mouseSamplingRate: 100,
            eventDropRate: 0,
            lastAdaptation: Date.now(),
            adaptationInterval: 1000,
          };
          this.startBatchProcessor();
        }

        processEvent(message) {
          const startTime = performance.now();
          
          try {
            switch (message.type) {
              case 'event':
                this.handleEvent(message.payload);
                break;
              case 'batch':
                this.handleBatch(message.payload);
                break;
              case 'snapshot':
                this.handleSnapshot(message.payload);
                break;
              case 'config':
                this.updateConfig(message.payload);
                break;
              case 'mouse-batch':
                this.handleMouseBatch(message.payload);
                break;
              case 'mouse-interaction':
                this.handleMouseInteraction(message.payload);
                break;
              default:
                console.warn('EventProcessor: Unknown message type:', message.type);
            }

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

        handleEvent(event) {
          if (this.shouldDropEvent(event)) {
            return;
          }

          if (this.isMouseMoveEvent(event)) {
            this.bufferMouseEvent(event);
            return;
          }

          this.eventQueue.push(event);

          if (this.eventQueue.length > this.MAX_QUEUE_SIZE) {
            this.eventQueue = this.eventQueue.slice(-this.MAX_QUEUE_SIZE);
          }

          if (this.isHighPriorityEvent(event)) {
            this.sendEvent(event);
            this.removeFromQueue(event);
          }
        }

        handleBatch(events) {
          events.forEach(event => this.handleEvent(event));
        }

        handleSnapshot(payload) {
          const compressedSnapshot = this.compressSnapshot(payload);
          this.postMessage({
            type: 'snapshot',
            payload: compressedSnapshot,
            timestamp: Date.now(),
          });
        }

        handleMouseBatch(batch) {
          // Process mouse batch with additional optimization
          const optimizedBatch = this.optimizeMouseBatch(batch);
          this.postMessage({
            type: 'mouse-batch',
            payload: optimizedBatch,
            timestamp: Date.now(),
          });
        }

        handleMouseInteraction(interaction) {
          // Process mouse interaction state
          this.postMessage({
            type: 'mouse-interaction',
            payload: interaction,
            timestamp: Date.now(),
          });
        }

        updateConfig(config) {
          console.log('EventProcessor: Configuration updated:', config);
          if (config.networkLatency !== undefined) {
            this.performanceMetrics.networkLatency = config.networkLatency;
          }
        }

        isMouseMoveEvent(event) {
          return (
            event.type === 'rrweb' &&
            event.data &&
            event.data.type === 3 &&
            event.data.data &&
            event.data.data.source === 2 &&
            event.data.data.type === 0
          );
        }

        bufferMouseEvent(event) {
          const timeSinceLastMouse = Date.now() - (this.mouseEventBuffer[this.mouseEventBuffer.length - 1]?.timestamp || 0);
          if (timeSinceLastMouse < this.adaptiveSampling.mouseSamplingRate) {
            return;
          }

          const mouseEvent = {
            x: event.data.data.x,
            y: event.data.data.y,
            timestamp: event.timestamp,
            target: event.data.data.id?.toString(),
          };

          this.mouseEventBuffer.push(mouseEvent);

          if (this.mouseEventBuffer.length > this.MAX_MOUSE_BUFFER) {
            this.mouseEventBuffer = this.mouseEventBuffer.slice(-this.MAX_MOUSE_BUFFER);
          }
        }

        isHighPriorityEvent(event) {
          if (event.type !== 'rrweb') return true;

          const eventType = event.data?.type;
          const interactionType = event.data?.data?.type;

          return (
            eventType === 2 ||
            eventType === 4 ||
            eventType === 5 ||
            eventType === 6 ||
            (eventType === 3 && interactionType === 2) ||
            (eventType === 3 && interactionType === 3) ||
            (eventType === 3 && interactionType === 4) ||
            (eventType === 3 && interactionType === 7) ||
            (eventType === 3 && interactionType === 8)
          );
        }

        removeFromQueue(event) {
          const index = this.eventQueue.findIndex(e => e.id === event.id);
          if (index !== -1) {
            this.eventQueue.splice(index, 1);
          }
        }

        sendEvent(event) {
          this.postMessage({
            type: 'event',
            payload: event,
            timestamp: Date.now(),
          });
        }

        startBatchProcessor() {
          this.batchTimer = setInterval(() => {
            this.processBatch();
            this.adaptPerformance();
          }, this.batchInterval);
        }

        restartBatchProcessor() {
          if (this.batchTimer) {
            clearInterval(this.batchTimer);
          }
          this.startBatchProcessor();
        }

        processBatch() {
          if (this.eventQueue.length === 0 && this.mouseEventBuffer.length === 0) {
            return;
          }

          const batch = {
            events: [...this.eventQueue],
            mouseEvents: this.optimizeMouseEvents(),
            timestamp: Date.now(),
            metrics: this.performanceMetrics,
          };

          this.postMessage({
            type: 'batch',
            payload: batch,
            timestamp: Date.now(),
          });

          this.eventQueue = [];
          this.mouseEventBuffer = [];
        }

        optimizeMouseEvents() {
          if (this.mouseEventBuffer.length === 0) return null;

          const sortedEvents = this.mouseEventBuffer.sort((a, b) => a.timestamp - b.timestamp);
          const optimizedEvents = this.removeRedundantMouseMoves(sortedEvents);

          if (optimizedEvents.length === 0) return null;

          return {
            events: optimizedEvents,
            startTime: sortedEvents[0].timestamp,
            endTime: sortedEvents[sortedEvents.length - 1].timestamp,
            interactionContext: {
              isInteracting: false,
              interactionType: 'hover',
              lastSignificantMove: Date.now(),
              velocity: this.calculateAverageVelocity(optimizedEvents),
              element: null,
            },
          };
        }

        removeRedundantMouseMoves(events) {
          if (events.length <= 2) return events;

          const optimized = [events[0]];
          const DISTANCE_THRESHOLD = 5;
          const TIME_THRESHOLD = 50;

          for (let i = 1; i < events.length - 1; i++) {
            const current = events[i];
            const last = optimized[optimized.length - 1];
            
            const distance = Math.sqrt(
              Math.pow(current.x - last.x, 2) + Math.pow(current.y - last.y, 2)
            );
            
            const timeDiff = current.timestamp - last.timestamp;

            if (distance >= DISTANCE_THRESHOLD || timeDiff >= TIME_THRESHOLD) {
              optimized.push(current);
            }
          }

          if (events.length > 1) {
            optimized.push(events[events.length - 1]);
          }

          return optimized;
        }

        calculateAverageVelocity(events) {
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

        optimizeMouseBatch(batch) {
          // Additional optimization for mouse batches from MouseOptimizationService
          const events = batch.events || [];
          
          if (events.length <= 2) return batch;

          // Apply additional compression based on current performance
          const compressionRatio = this.getCompressionRatio();
          const targetEventCount = Math.max(2, Math.floor(events.length * compressionRatio));
          
          if (events.length <= targetEventCount) return batch;

          // Keep first and last events, sample the middle ones
          const optimizedEvents = [events[0]];
          const step = Math.max(1, Math.floor((events.length - 2) / (targetEventCount - 2)));
          
          for (let i = step; i < events.length - 1; i += step) {
            optimizedEvents.push(events[i]);
          }
          
          optimizedEvents.push(events[events.length - 1]);

          return {
            ...batch,
            events: optimizedEvents,
            originalEventCount: events.length,
            optimizedEventCount: optimizedEvents.length,
            compressionRatio: compressionRatio,
          };
        }

        getCompressionRatio() {
          // Adjust compression based on performance metrics
          const { clientPerformance, eventQueueSize, networkLatency } = this.performanceMetrics;
          
          if (clientPerformance === 'low' || eventQueueSize > 500 || networkLatency > 200) {
            return 0.3; // Aggressive compression
          } else if (clientPerformance === 'medium' || eventQueueSize > 200 || networkLatency > 100) {
            return 0.6; // Moderate compression
          } else {
            return 0.8; // Light compression
          }
        }

        compressSnapshot(snapshot) {
          try {
            const jsonString = JSON.stringify(snapshot);
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

        updatePerformanceMetrics(processingTime) {
          this.performanceMetrics.eventQueueSize = this.eventQueue.length;
          this.performanceMetrics.processingDelay = processingTime;
          
          if (processingTime < 5) {
            this.performanceMetrics.clientPerformance = 'high';
          } else if (processingTime < 20) {
            this.performanceMetrics.clientPerformance = 'medium';
          } else {
            this.performanceMetrics.clientPerformance = 'low';
          }
        }

        shouldDropEvent(event) {
          if (this.isHighPriorityEvent(event)) {
            return false;
          }
          return Math.random() < this.adaptiveSampling.eventDropRate;
        }

        adaptPerformance() {
          const now = Date.now();
          
          if (now - this.adaptiveSampling.lastAdaptation < this.adaptiveSampling.adaptationInterval) {
            return;
          }

          const queueSize = this.performanceMetrics.eventQueueSize;
          const processingDelay = this.performanceMetrics.processingDelay;
          const clientPerformance = this.performanceMetrics.clientPerformance;

          let needsRestart = false;
          const oldInterval = this.batchInterval;
          
          if (clientPerformance === 'low' || queueSize > 500) {
            this.batchInterval = Math.min(this.batchInterval * 1.5, this.MAX_BATCH_INTERVAL);
            this.adaptiveSampling.mouseSamplingRate = Math.min(this.adaptiveSampling.mouseSamplingRate * 1.5, 500);
            this.adaptiveSampling.eventDropRate = Math.min(this.adaptiveSampling.eventDropRate + 0.1, 0.5);
          } else if (clientPerformance === 'high' && queueSize < 100) {
            this.batchInterval = Math.max(this.batchInterval * 0.8, this.MIN_BATCH_INTERVAL);
            this.adaptiveSampling.mouseSamplingRate = Math.max(this.adaptiveSampling.mouseSamplingRate * 0.8, 50);
            this.adaptiveSampling.eventDropRate = Math.max(this.adaptiveSampling.eventDropRate - 0.05, 0);
          }

          if (Math.abs(oldInterval - this.batchInterval) > 10) {
            needsRestart = true;
          }

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

        postMessage(message) {
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
          self.postMessage(message);
        }
      }

      const processor = new EventProcessor();

      self.addEventListener('message', (event) => {
        processor.processEvent(event.data);
      });

      self.addEventListener('error', (error) => {
        console.error('EventProcessor Worker Error:', error);
        self.postMessage({
          type: 'error',
          payload: { error: error.message, filename: error.filename, lineno: error.lineno },
          timestamp: Date.now(),
        });
      });
    `;
  }
}