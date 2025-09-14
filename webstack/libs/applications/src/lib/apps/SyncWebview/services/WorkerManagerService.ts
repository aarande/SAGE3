/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { WorkerMessage, SyncWebviewEvent, MouseMovementBatch, PerformanceMetrics } from '../types';

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
   * Send event to worker for processing
   */
  public processEvent(event: SyncWebviewEvent): void {
    if (!this.worker || !this.isInitialized) {
      console.warn('WorkerManagerService: Worker not initialized, processing on main thread');
      this.eventCallback(event);
      return;
    }

    const message: WorkerMessage = {
      type: 'event',
      payload: event,
      timestamp: Date.now(),
    };

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
          this.BATCH_INTERVAL = 100;
          this.MAX_QUEUE_SIZE = 1000;
          this.MAX_MOUSE_BUFFER = 50;
          this.performanceMetrics = {
            eventQueueSize: 0,
            networkLatency: 0,
            processingDelay: 0,
            clientPerformance: 'medium',
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

        updateConfig(config) {
          console.log('EventProcessor: Configuration updated:', config);
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
          }, this.BATCH_INTERVAL);
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

        postMessage(message) {
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