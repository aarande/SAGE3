/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { 
  SyncWebviewEvent, 
  MouseMovementBatch, 
  MouseInteractionState,
  PerformanceMetrics,
  CompressedSnapshot
} from '../types';

// rrweb type definitions
interface RrwebEvent {
  type: number;
  timestamp: number;
  data?: unknown;
}

interface RrwebReplayer {
  play: (timestamp?: number) => void;
  pause: () => void;
  destroy?: () => void;
  addEvent?: (event: RrwebEvent) => void;
  on?: (event: string, callback: (data: unknown) => void) => void;
}

interface RrwebModule {
  Replayer: new (events: RrwebEvent[], config?: unknown) => RrwebReplayer;
}

/**
 * Event replay service for SyncWebview
 * Handles replaying events received from other clients using rrweb
 */
export class EventReplayService {
  private replayer: RrwebReplayer | null = null; // rrweb.Replayer instance
  private rrweb: RrwebModule | null = null; // rrweb module reference
  private isReplaying: boolean = false;
  private eventQueue: SyncWebviewEvent[] = [];
  private isProcessingQueue: boolean = false;
  private targetElement: HTMLElement | null = null;
  private lastEventTimestamp: number = 0;
  private replayContainer: HTMLElement | null = null;
  private currentEvents: RrwebEvent[] = []; // Store events for replayer
  private isInitialized: boolean = false;
  private performanceMetrics: PerformanceMetrics = {
    eventQueueSize: 0,
    networkLatency: 0,
    processingDelay: 0,
    clientPerformance: 'medium'
  };

  constructor(
    private onReplayError: (error: Error) => void,
    private onReplayComplete: () => void
  ) {}

  /**
   * Initialize the replay service
   */
  async initialize(targetElement: HTMLElement): Promise<void> {
    try {
      this.targetElement = targetElement;
      
      // Import rrweb dynamically to avoid bundling issues
      this.rrweb = await import('rrweb') as RrwebModule;
      
      // Create a container for the replayer within the target element
      this.createReplayContainer();
      
      this.isInitialized = true;
      console.log('SyncWebview: Event replay service initialized');
    } catch (error) {
      console.error('SyncWebview: Failed to initialize replay service:', error);
      this.onReplayError(new Error('Failed to initialize replay service'));
      throw error;
    }
  }

  /**
   * Create a container element for the rrweb replayer
   */
  private createReplayContainer(): void {
    if (!this.targetElement) {
      throw new Error('Target element not set');
    }

    // Create a container div for the replayer
    this.replayContainer = document.createElement('div');
    this.replayContainer.id = 'rrweb-replay-container';
    this.replayContainer.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 1000;
      background: transparent;
    `;

    // Append to target element
    this.targetElement.appendChild(this.replayContainer);
  }

  /**
   * Start replaying events in live mode
   */
  async startReplaying(initialSnapshot?: string): Promise<void> {
    if (this.isReplaying) {
      console.warn('SyncWebview: Replay service is already running');
      return;
    }

    try {
      if (!this.isInitialized || !this.rrweb) {
        throw new Error('Replay service not initialized');
      }

      if (!this.replayContainer) {
        throw new Error('Replay container not created');
      }

      // Initialize events array
      this.currentEvents = [];

      // If we have an initial snapshot, parse and use it
      if (initialSnapshot) {
        try {
          const snapshotData = JSON.parse(initialSnapshot);
          if (Array.isArray(snapshotData)) {
            this.currentEvents = snapshotData;
          } else if (snapshotData.events && Array.isArray(snapshotData.events)) {
            this.currentEvents = snapshotData.events;
          }
          console.log('SyncWebview: Loaded initial snapshot with', this.currentEvents.length, 'events');
        } catch (error) {
          console.warn('SyncWebview: Failed to parse initial snapshot, starting without it:', error);
        }
      }

      // rrweb.Replayer requires at least 2 events to initialize
      // If we don't have enough events, we'll defer replayer creation until we do
      if (this.currentEvents.length >= 2) {
        // Create replayer configuration for live mode
        const config = {
          target: this.replayContainer,
          props: {
            events: this.currentEvents,
            autoPlay: false, // We'll control playback manually for live mode
            showController: false,
            showWarning: false,
            pauseAnimation: false,
          },
          insertStyleRules: [
            '.rr-replayer { width: 100% !important; height: 100% !important; }',
            '.rr-replayer iframe { border: none !important; width: 100% !important; height: 100% !important; }',
            '.rr-replayer .rr-controller { display: none !important; }',
          ],
        };

        if (this.rrweb) {
          this.replayer = new this.rrweb.Replayer(this.currentEvents, config);
          this.setupReplayerEventHandlers();
          
          // Start the replayer in live mode
          if (this.replayer) {
            this.replayer.play();
            // Seek to the end to be ready for new events
            this.replayer.play(this.currentEvents[this.currentEvents.length - 1].timestamp);
          }
        }
      } else {
        console.log('SyncWebview: Deferring replayer creation until we have at least 2 events');
      }
      
      this.isReplaying = true;
      this.lastEventTimestamp = Date.now();
      
      // Start processing queued events
      this.processEventQueue();
      
      console.log('SyncWebview: Started replaying events in live mode (replayer will be created when events arrive)');
    } catch (error) {
      console.error('SyncWebview: Failed to start replaying:', error);
      this.onReplayError(new Error('Failed to start replaying events'));
      throw error;
    }
  }

  /**
   * Stop replaying events
   */
  stopReplaying(): void {
    if (!this.isReplaying) {
      return;
    }

    try {
      if (this.replayer) {
        // Pause and destroy the replayer
        this.replayer.pause();
        if (typeof this.replayer.destroy === 'function') {
          this.replayer.destroy();
        }
        this.replayer = null;
      }
      
      // Clean up replay container
      if (this.replayContainer && this.replayContainer.parentNode) {
        this.replayContainer.parentNode.removeChild(this.replayContainer);
        this.replayContainer = null;
      }
      
      this.isReplaying = false;
      this.eventQueue = [];
      this.isProcessingQueue = false;
      this.currentEvents = [];
      
      console.log('SyncWebview: Stopped replaying events');
      this.onReplayComplete();
    } catch (error) {
      console.error('SyncWebview: Error stopping replay:', error);
      this.onReplayError(new Error('Failed to stop replaying'));
    }
  }

  /**
   * Add an event to the replay queue
   */
  addEvent(event: SyncWebviewEvent): void {
    if (!this.isReplaying) {
      console.warn('SyncWebview: Cannot add event, replay service not running');
      return;
    }

    // Validate event before adding to queue
    if (!this.validateEvent(event)) {
      console.warn('SyncWebview: Invalid event received, skipping:', event);
      return;
    }

    // Add event to queue
    this.eventQueue.push(event);
    this.performanceMetrics.eventQueueSize = this.eventQueue.length;
    
    // Process queue if not already processing
    if (!this.isProcessingQueue) {
      this.processEventQueue();
    }
  }

  /**
   * Validate an event before processing
   */
  private validateEvent(event: SyncWebviewEvent): boolean {
    if (!event || typeof event !== 'object') {
      return false;
    }

    // Check required fields
    if (!event.id || !event.timestamp || !event.type || !event.data) {
      return false;
    }

    // Check event age (reject events older than 5 minutes)
    const eventAge = Date.now() - event.timestamp;
    if (eventAge > 300000) {
      console.warn('SyncWebview: Event too old:', eventAge, 'ms');
      return false;
    }

    // Validate event type
    if (!['rrweb', 'snapshot', 'control'].includes(event.type)) {
      return false;
    }

    return true;
  }

  /**
   * Handle mouse movement batch from other clients
   */
  handleMouseBatch(batch: MouseMovementBatch): void {
    if (!this.isReplaying || !this.replayer) {
      return;
    }

    try {
      // Convert mouse batch to rrweb events and replay them
      batch.events.forEach((mouseEvent, index) => {
        const rrwebEvent: RrwebEvent = {
          type: 3, // rrweb mouse move event type
          data: {
            type: 0, // mouse move
            x: mouseEvent.x,
            y: mouseEvent.y,
          },
          timestamp: mouseEvent.timestamp,
        };

        // Add small delay between events to smooth animation
        setTimeout(() => {
          if (this.replayer && this.replayer.addEvent) {
            this.replayer.addEvent(rrwebEvent);
          }
        }, index * 16); // ~60fps
      });
      
      console.log('SyncWebview: Processed mouse batch with', batch.events.length, 'events');
    } catch (error) {
      console.error('SyncWebview: Error handling mouse batch:', error);
      this.onReplayError(new Error('Failed to handle mouse batch'));
    }
  }

  /**
   * Handle mouse interaction state from other clients
   */
  handleMouseInteraction(interaction: MouseInteractionState): void {
    if (!this.isReplaying || !this.replayer) {
      return;
    }

    try {
      // Convert interaction to rrweb event
      let eventType: number;
      switch (interaction.type) {
        case 'mousedown':
          eventType = 2; // rrweb mouse down
          break;
        case 'mouseup':
          eventType = 3; // rrweb mouse up
          break;
        case 'dragstart':
          eventType = 4; // rrweb drag start
          break;
        case 'dragend':
          eventType = 5; // rrweb drag end
          break;
        default:
          console.warn('SyncWebview: Unknown interaction type:', interaction.type);
          return;
      }

      const rrwebEvent: RrwebEvent = {
        type: 3, // rrweb interaction event
        data: {
          type: eventType,
          x: interaction.position.x,
          y: interaction.position.y,
          id: this.getElementId(interaction.element),
        },
        timestamp: interaction.timestamp,
      };

      this.replayer?.addEvent?.(rrwebEvent);
      
      console.log('SyncWebview: Processed mouse interaction:', interaction.type);
    } catch (error) {
      console.error('SyncWebview: Error handling mouse interaction:', error);
      this.onReplayError(new Error('Failed to handle mouse interaction'));
    }
  }

  /**
   * Apply a compressed DOM snapshot to reset the state
   */
  async applyCompressedSnapshot(compressedSnapshot: CompressedSnapshot): Promise<void> {
    if (!this.isReplaying) {
      console.warn('SyncWebview: Cannot apply snapshot, replay service not running');
      return;
    }

    try {
      // Import StateSynchronizationService for decompression
      const { StateSynchronizationService } = await import('./StateSynchronizationService');
      
      // Create a temporary service instance for decompression
      const tempService = new StateSynchronizationService(
        () => {}, // onSnapshotGenerated - not needed for decompression
        (error) => console.error('Temp service error:', error) // onError
      );
      
      await tempService.initialize();
      
      // Decompress the snapshot
      const decompressedData = await tempService.decompressSnapshot(compressedSnapshot);
      
      // Clean up temp service
      tempService.destroy();
      
      // Apply the decompressed snapshot
      await this.applyDecompressedSnapshot(decompressedData.events, decompressedData.timestamp);
      
      console.log(`SyncWebview: Applied compressed snapshot (${compressedSnapshot.compressionMethod}, ${compressedSnapshot.compressedSize} bytes)`);
    } catch (error) {
      console.error('SyncWebview: Failed to apply compressed snapshot:', error);
      this.onReplayError(new Error('Failed to apply compressed snapshot'));
    }
  }

  /**
   * Apply a DOM snapshot to reset the state (legacy method for backward compatibility)
   */
  async applySnapshot(snapshot: string, timestamp: number): Promise<void> {
    if (!this.isReplaying) {
      console.warn('SyncWebview: Cannot apply snapshot, replay service not running');
      return;
    }

    try {
      // Parse the snapshot
      let snapshotData: RrwebEvent[];
      try {
        const parsed = JSON.parse(snapshot);
        if (Array.isArray(parsed)) {
          snapshotData = parsed;
        } else if (parsed.events && Array.isArray(parsed.events)) {
          snapshotData = parsed.events;
        } else {
          throw new Error('Invalid snapshot format');
        }
      } catch (parseError) {
        console.error('SyncWebview: Failed to parse snapshot:', parseError);
        this.onReplayError(new Error('Invalid snapshot format'));
        return;
      }

      // Validate snapshot data
      if (!this.validateSnapshotData(snapshotData)) {
        console.error('SyncWebview: Invalid snapshot data');
        this.onReplayError(new Error('Invalid snapshot data'));
        return;
      }
      
      // Stop current replayer
      if (this.replayer) {
        this.replayer.pause();
        if (typeof this.replayer.destroy === 'function') {
          this.replayer.destroy();
        }
      }
      
      // Update current events with snapshot
      this.currentEvents = snapshotData;
      
      // Create new replayer with snapshot data
      const config = {
        target: this.replayContainer!,
        props: {
          events: this.currentEvents,
          autoPlay: false,
          showController: false,
          showWarning: false,
          pauseAnimation: false,
        },
        insertStyleRules: [
          '.rr-replayer { width: 100% !important; height: 100% !important; }',
          '.rr-replayer iframe { border: none !important; width: 100% !important; height: 100% !important; }',
          '.rr-replayer .rr-controller { display: none !important; }',
        ],
      };

      if (this.rrweb) {
        this.replayer = new this.rrweb.Replayer(this.currentEvents, config);
        this.setupReplayerEventHandlers();
        
        // Start playback and seek to end for live mode
        if (this.currentEvents.length > 0 && this.replayer) {
          this.replayer.play();
          this.replayer.play(this.currentEvents[this.currentEvents.length - 1].timestamp);
        }
      }
      
      this.lastEventTimestamp = timestamp;
      
      // Clear event queue since we have a fresh state
      this.eventQueue = [];
      this.performanceMetrics.eventQueueSize = 0;
      
      console.log('SyncWebview: Applied DOM snapshot with', snapshotData.length, 'events');
    } catch (error) {
      console.error('SyncWebview: Failed to apply snapshot:', error);
      this.onReplayError(new Error('Failed to apply DOM snapshot'));
      
      // Attempt recovery by restarting with empty state
      this.recoverFromSnapshotError();
    }
  }

  /**
   * Apply decompressed snapshot data
   */
  private async applyDecompressedSnapshot(events: RrwebEvent[], timestamp: number): Promise<void> {
    try {
      // Validate snapshot data
      if (!this.validateSnapshotData(events)) {
        console.error('SyncWebview: Invalid decompressed snapshot data');
        this.onReplayError(new Error('Invalid decompressed snapshot data'));
        return;
      }
      
      // Stop current replayer
      if (this.replayer) {
        this.replayer.pause();
        if (typeof this.replayer.destroy === 'function') {
          this.replayer.destroy();
        }
      }
      
      // Update current events with snapshot
      this.currentEvents = events;
      
      // Create new replayer with snapshot data
      const config = {
        target: this.replayContainer!,
        props: {
          events: this.currentEvents,
          autoPlay: false,
          showController: false,
          showWarning: false,
          pauseAnimation: false,
        },
        insertStyleRules: [
          '.rr-replayer { width: 100% !important; height: 100% !important; }',
          '.rr-replayer iframe { border: none !important; width: 100% !important; height: 100% !important; }',
          '.rr-replayer .rr-controller { display: none !important; }',
        ],
      };

      if (this.rrweb) {
        this.replayer = new this.rrweb.Replayer(this.currentEvents, config);
        this.setupReplayerEventHandlers();
        
        // Start playback and seek to end for live mode
        if (this.currentEvents.length > 0 && this.replayer) {
          this.replayer.play();
          this.replayer.play(this.currentEvents[this.currentEvents.length - 1].timestamp);
        }
      }
      
      this.lastEventTimestamp = timestamp;
      
      // Clear event queue since we have a fresh state
      this.eventQueue = [];
      this.performanceMetrics.eventQueueSize = 0;
      
      console.log('SyncWebview: Applied decompressed snapshot with', events.length, 'events');
    } catch (error) {
      console.error('SyncWebview: Failed to apply decompressed snapshot:', error);
      this.onReplayError(new Error('Failed to apply decompressed snapshot'));
      
      // Attempt recovery by restarting with empty state
      this.recoverFromSnapshotError();
    }
  }

  /**
   * Validate snapshot data structure
   */
  private validateSnapshotData(data: unknown[]): boolean {
    if (!Array.isArray(data)) {
      return false;
    }

    // Check if it looks like rrweb events
    for (const event of data.slice(0, 5)) { // Check first 5 events
      if (!event || typeof event !== 'object') {
        return false;
      }
      const eventObj = event as Record<string, unknown>;
      if (typeof eventObj.type !== 'number' || typeof eventObj.timestamp !== 'number') {
        return false;
      }
    }

    return true;
  }

  /**
   * Recover from snapshot application error
   */
  private recoverFromSnapshotError(): void {
    try {
      console.log('SyncWebview: Attempting recovery from snapshot error');
      
      // Reset to empty state
      this.currentEvents = [];
      
      if (this.replayer) {
        this.replayer.pause();
        if (typeof this.replayer.destroy === 'function') {
          this.replayer.destroy();
        }
        this.replayer = null;
      }
      
      // Clear event queue
      this.eventQueue = [];
      this.performanceMetrics.eventQueueSize = 0;
      
      console.log('SyncWebview: Recovery completed, ready for new events');
    } catch (recoveryError) {
      console.error('SyncWebview: Recovery failed:', recoveryError);
      this.onReplayError(new Error('Failed to recover from snapshot error'));
    }
  }

  /**
   * Process the event queue
   */
  private async processEventQueue(): Promise<void> {
    if (this.isProcessingQueue || this.eventQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;
    const startTime = Date.now();

    try {
      while (this.eventQueue.length > 0 && this.isReplaying) {
        const event = this.eventQueue.shift();
        if (!event) continue;

        // Skip events that are too old (more than 30 seconds)
        const eventAge = Date.now() - event.timestamp;
        if (eventAge > 30000) {
          console.warn('SyncWebview: Skipping old event:', eventAge, 'ms old');
          continue;
        }

        // Apply the event
        await this.applyEvent(event);
        
        // Update timestamp
        this.lastEventTimestamp = Math.max(this.lastEventTimestamp, event.timestamp);
        
        // Small delay to prevent overwhelming the UI
        await new Promise(resolve => setTimeout(resolve, 1));
      }
    } catch (error) {
      console.error('SyncWebview: Error processing event queue:', error);
      this.onReplayError(new Error('Failed to process event queue'));
    } finally {
      this.isProcessingQueue = false;
      this.performanceMetrics.eventQueueSize = this.eventQueue.length;
      
      // Update performance metrics
      const processingTime = Date.now() - startTime;
      this.updatePerformanceMetrics(processingTime);
    }
  }

  /**
   * Apply a single event to the replayer
   */
  private async applyEvent(event: SyncWebviewEvent): Promise<void> {
    if (!this.replayer) {
      throw new Error('Replayer not initialized');
    }

    try {
      switch (event.type) {
        case 'rrweb':
          // Validate and apply rrweb event
          if (this.validateRrwebEvent(event.data)) {
            await this.applyRrwebEvent(event.data);
          } else {
            console.warn('SyncWebview: Invalid rrweb event data:', event.data);
          }
          break;
          
        case 'snapshot':
          // Handle snapshot event
          await this.applySnapshot(event.data, event.timestamp);
          break;
          
        case 'control':
          // Handle control events (navigation, etc.)
          this.handleControlEvent(event);
          break;
          
        default:
          console.warn('SyncWebview: Unknown event type:', event.type);
      }
    } catch (error) {
      console.error('SyncWebview: Failed to apply event:', error);
      
      // Attempt to recover from event application error
      await this.recoverFromEventError(error, event);
      throw error;
    }
  }

  /**
   * Apply an rrweb event to the replayer
   */
  private async applyRrwebEvent(rrwebEvent: RrwebEvent): Promise<void> {
    try {
      // Add event to current events array
      this.currentEvents.push(rrwebEvent);
      
      // Sort events by timestamp to maintain order
      this.currentEvents.sort((a, b) => a.timestamp - b.timestamp);
      
      // If we don't have a replayer yet and now have at least 1 event, create it
      if (!this.replayer && this.currentEvents.length >= 1) {
        await this.createReplayerWithCurrentEvents();
      }
      
      // Apply event to replayer using addEvent if available
      if (this.replayer && typeof this.replayer.addEvent === 'function') {
        this.replayer.addEvent(rrwebEvent);
      } else if (this.replayer) {
        // Fallback: recreate replayer with updated events
        await this.recreateReplayerWithEvents();
      }
      
      console.log('SyncWebview: Applied rrweb event type:', rrwebEvent.type);
    } catch (error) {
      console.error('SyncWebview: Failed to apply rrweb event:', error);
      throw error;
    }
  }

  /**
   * Create replayer with current events when we have enough events
   */
  private async createReplayerWithCurrentEvents(): Promise<void> {
    if (!this.replayContainer || !this.rrweb) {
      return;
    }

    try {
      // Ensure we have at least 2 events for rrweb.Replayer
      if (this.currentEvents.length < 2) {
        // Create a minimal snapshot event to bootstrap the replayer
        const now = Date.now();
        const dummySnapshot: RrwebEvent = {
          type: 2, // rrweb snapshot event type
          timestamp: now - 1000,
          data: {
            node: {
              type: 0,
              childNodes: [],
              id: 1
            },
            initialOffset: { left: 0, top: 0 }
          }
        };
        
        this.currentEvents.unshift(dummySnapshot);
        console.log('SyncWebview: Added dummy snapshot event to bootstrap replayer');
      }

      console.log('SyncWebview: Creating replayer with', this.currentEvents.length, 'events');

      // Create replayer configuration for live mode
      const config = {
        target: this.replayContainer,
        props: {
          events: this.currentEvents,
          autoPlay: false,
          showController: false,
          showWarning: false,
          pauseAnimation: false,
        },
        insertStyleRules: [
          '.rr-replayer { width: 100% !important; height: 100% !important; }',
          '.rr-replayer iframe { border: none !important; width: 100% !important; height: 100% !important; }',
          '.rr-replayer .rr-controller { display: none !important; }',
        ],
      };

      this.replayer = new this.rrweb.Replayer(this.currentEvents, config);
      this.setupReplayerEventHandlers();

      // Start playback and seek to end for live mode
      if (this.replayer) {
        this.replayer.play();
        if (this.currentEvents.length > 1) {
          this.replayer.play(this.currentEvents[this.currentEvents.length - 1].timestamp);
        }
      }

      console.log('SyncWebview: Replayer created successfully');
    } catch (error) {
      console.error('SyncWebview: Failed to create replayer:', error);
      throw error;
    }
  }

  /**
   * Recreate the replayer with current events (fallback method)
   */
  private async recreateReplayerWithEvents(): Promise<void> {
    if (!this.replayContainer || !this.rrweb) {
      throw new Error('Replay container or rrweb not available');
    }

    try {
      // Pause and destroy current replayer
      if (this.replayer) {
        this.replayer.pause();
        if (typeof this.replayer.destroy === 'function') {
          this.replayer.destroy();
        }
      }

      // Ensure we have at least 2 events for rrweb.Replayer
      if (this.currentEvents.length < 2) {
        // Create a minimal snapshot event to bootstrap the replayer
        const now = Date.now();
        const dummySnapshot: RrwebEvent = {
          type: 2, // rrweb snapshot event type
          timestamp: now - 1000,
          data: {
            node: {
              type: 0,
              childNodes: [],
              id: 1
            },
            initialOffset: { left: 0, top: 0 }
          }
        };
        
        this.currentEvents.unshift(dummySnapshot);
        console.log('SyncWebview: Added dummy snapshot event for replayer recreation');
      }

      // Create new replayer with updated events
      const config = {
        target: this.replayContainer,
        props: {
          events: this.currentEvents,
          autoPlay: false,
          showController: false,
          showWarning: false,
          pauseAnimation: false,
        },
        insertStyleRules: [
          '.rr-replayer { width: 100% !important; height: 100% !important; }',
          '.rr-replayer iframe { border: none !important; width: 100% !important; height: 100% !important; }',
          '.rr-replayer .rr-controller { display: none !important; }',
        ],
      };

      if (this.rrweb) {
        this.replayer = new this.rrweb.Replayer(this.currentEvents, config);
        this.setupReplayerEventHandlers();

        // Start playback and seek to end for live mode
        if (this.currentEvents.length > 0 && this.replayer) {
          this.replayer.play();
          this.replayer.play(this.currentEvents[this.currentEvents.length - 1].timestamp);
        }
      }

      console.log('SyncWebview: Recreated replayer with', this.currentEvents.length, 'events');
    } catch (error) {
      console.error('SyncWebview: Failed to recreate replayer:', error);
      throw error;
    }
  }

  /**
   * Validate rrweb event structure
   */
  private validateRrwebEvent(event: unknown): event is RrwebEvent {
    if (!event || typeof event !== 'object') {
      return false;
    }

    const eventObj = event as Record<string, unknown>;

    // Check required rrweb event fields
    if (typeof eventObj.type !== 'number' || typeof eventObj.timestamp !== 'number') {
      return false;
    }

    // Validate event data exists
    if (eventObj.data === undefined || eventObj.data === null) {
      return false;
    }

    return true;
  }

  /**
   * Recover from event application error
   */
  private async recoverFromEventError(error: unknown, event: SyncWebviewEvent): Promise<void> {
    try {
      console.log('SyncWebview: Attempting recovery from event error:', error instanceof Error ? error.message : String(error));
      
      // Remove the problematic event from current events if it was added
      const eventIndex = this.currentEvents.findIndex(e => 
        e.timestamp === event.timestamp && e.type === (event.data as RrwebEvent)?.type
      );
      
      if (eventIndex !== -1) {
        this.currentEvents.splice(eventIndex, 1);
        console.log('SyncWebview: Removed problematic event from replay queue');
      }
      
      // If replayer is in a bad state, try to recreate it
      if (this.replayer && this.currentEvents.length > 0) {
        await this.recreateReplayerWithEvents();
      }
      
      console.log('SyncWebview: Recovery from event error completed');
    } catch (recoveryError) {
      console.error('SyncWebview: Recovery from event error failed:', recoveryError);
      // Don't throw here to avoid cascading failures
    }
  }

  /**
   * Handle control events (navigation, zoom, etc.)
   */
  private handleControlEvent(event: SyncWebviewEvent): void {
    try {
      const controlData = event.data;
      
      switch (controlData.action) {
        case 'navigate':
          // Handle navigation event
          console.log('SyncWebview: Navigation event received:', controlData.url);
          break;
          
        case 'zoom':
          // Handle zoom event
          console.log('SyncWebview: Zoom event received:', controlData.zoom);
          break;
          
        default:
          console.warn('SyncWebview: Unknown control action:', controlData.action);
      }
    } catch (error) {
      console.error('SyncWebview: Error handling control event:', error);
    }
  }

  /**
   * Set up event handlers for the replayer
   */
  private setupReplayerEventHandlers(): void {
    if (!this.replayer) return;

    try {
      // Handle replayer errors
      if (typeof this.replayer.on === 'function') {
        this.replayer.on('error', (error: unknown) => {
          console.error('SyncWebview: Replayer error:', error);
          this.handleReplayerError(error);
        });

        // Handle replayer state changes
        this.replayer.on('state-change', (state: unknown) => {
          console.log('SyncWebview: Replayer state changed:', state);
        });

        // Handle replayer events
        this.replayer.on('event-cast', (event: unknown) => {
          // Update last event timestamp
          this.lastEventTimestamp = Math.max(this.lastEventTimestamp, (event as RrwebEvent)?.timestamp || Date.now());
        });

        // Handle replayer finish
        this.replayer.on('finish', () => {
          console.log('SyncWebview: Replayer finished playback');
        });
      }

      // Set up DOM event listeners for additional error handling
      if (this.replayContainer) {
        this.replayContainer.addEventListener('error', (event) => {
          console.error('SyncWebview: Replay container error:', event);
          this.handleReplayerError(new Error('Replay container error'));
        });
      }

      console.log('SyncWebview: Replayer event handlers set up');
    } catch (error) {
      console.error('SyncWebview: Failed to set up replayer event handlers:', error);
    }
  }

  /**
   * Handle replayer errors with recovery attempts
   */
  private handleReplayerError(error: unknown): void {
    console.error('SyncWebview: Handling replayer error:', error);
    
    try {
      // Attempt to recover based on error type
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage && errorMessage.includes('DOM')) {
        // DOM-related error - try to recreate replayer
        this.recoverFromDOMError();
      } else if (errorMessage && errorMessage.includes('event')) {
        // Event-related error - clear problematic events
        this.recoverFromEventCorruption();
      } else {
        // Generic error - full restart
        this.recoverFromGenericError();
      }
    } catch (recoveryError) {
      console.error('SyncWebview: Recovery attempt failed:', recoveryError);
      this.onReplayError(new Error('Replayer error and recovery failed'));
    }
  }

  /**
   * Recover from DOM-related errors
   */
  private async recoverFromDOMError(): Promise<void> {
    try {
      console.log('SyncWebview: Recovering from DOM error');
      
      // Recreate the replay container
      if (this.replayContainer && this.replayContainer.parentNode) {
        this.replayContainer.parentNode.removeChild(this.replayContainer);
      }
      this.createReplayContainer();
      
      // Recreate replayer with current events
      if (this.currentEvents.length > 0) {
        await this.recreateReplayerWithEvents();
      }
      
      console.log('SyncWebview: DOM error recovery completed');
    } catch (error) {
      console.error('SyncWebview: DOM error recovery failed:', error);
      throw error;
    }
  }

  /**
   * Recover from event corruption
   */
  private recoverFromEventCorruption(): void {
    try {
      console.log('SyncWebview: Recovering from event corruption');
      
      // Remove recent events that might be corrupted
      const recentThreshold = Date.now() - 10000; // Last 10 seconds
      this.currentEvents = this.currentEvents.filter(event => 
        event.timestamp < recentThreshold
      );
      
      // Clear event queue
      this.eventQueue = [];
      this.performanceMetrics.eventQueueSize = 0;
      
      console.log('SyncWebview: Event corruption recovery completed');
    } catch (error) {
      console.error('SyncWebview: Event corruption recovery failed:', error);
      throw error;
    }
  }

  /**
   * Recover from generic errors
   */
  private recoverFromGenericError(): void {
    try {
      console.log('SyncWebview: Recovering from generic error');
      
      // Stop current replayer
      if (this.replayer) {
        this.replayer.pause();
        if (typeof this.replayer.destroy === 'function') {
          this.replayer.destroy();
        }
        this.replayer = null;
      }
      
      // Clear all state
      this.currentEvents = [];
      this.eventQueue = [];
      this.performanceMetrics.eventQueueSize = 0;
      
      console.log('SyncWebview: Generic error recovery completed');
    } catch (error) {
      console.error('SyncWebview: Generic error recovery failed:', error);
      throw error;
    }
  }

  /**
   * Get element ID from CSS selector
   */
  private getElementId(selector: string): number {
    // This is a simplified implementation
    // In a real implementation, you'd need to map CSS selectors to rrweb element IDs
    return Math.abs(selector.split('').reduce((a, b) => {
      a = ((a << 5) - a) + b.charCodeAt(0);
      return a & a;
    }, 0));
  }

  /**
   * Update performance metrics
   */
  private updatePerformanceMetrics(processingTime: number): void {
    this.performanceMetrics.processingDelay = processingTime;
    
    // Simple performance classification
    if (processingTime < 50) {
      this.performanceMetrics.clientPerformance = 'high';
    } else if (processingTime < 200) {
      this.performanceMetrics.clientPerformance = 'medium';
    } else {
      this.performanceMetrics.clientPerformance = 'low';
    }
  }

  /**
   * Get current performance metrics
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics };
  }

  /**
   * Get replay status
   */
  getIsReplaying(): boolean {
    return this.isReplaying;
  }

  /**
   * Get last event timestamp
   */
  getLastEventTimestamp(): number {
    return this.lastEventTimestamp;
  }

  /**
   * Get event queue size
   */
  getEventQueueSize(): number {
    return this.eventQueue.length;
  }

  /**
   * Get initialization status
   */
  getIsInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Get current events count
   */
  getCurrentEventsCount(): number {
    return this.currentEvents.length;
  }

  /**
   * Clear all events and reset state
   */
  clearAllEvents(): void {
    try {
      this.currentEvents = [];
      this.eventQueue = [];
      this.performanceMetrics.eventQueueSize = 0;
      
      if (this.replayer && this.isReplaying) {
        this.replayer.pause();
      }
      
      console.log('SyncWebview: Cleared all events');
    } catch (error) {
      console.error('SyncWebview: Failed to clear events:', error);
    }
  }

  /**
   * Get replayer status information
   */
  getStatus(): {
    isReplaying: boolean;
    isInitialized: boolean;
    eventQueueSize: number;
    currentEventsCount: number;
    lastEventTimestamp: number;
    performanceMetrics: PerformanceMetrics;
  } {
    return {
      isReplaying: this.isReplaying,
      isInitialized: this.isInitialized,
      eventQueueSize: this.eventQueue.length,
      currentEventsCount: this.currentEvents.length,
      lastEventTimestamp: this.lastEventTimestamp,
      performanceMetrics: { ...this.performanceMetrics },
    };
  }
}