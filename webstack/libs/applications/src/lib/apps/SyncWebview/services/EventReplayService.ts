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
  ReplayerConfig,
  PerformanceMetrics 
} from '../types';

/**
 * Event replay service for SyncWebview
 * Handles replaying events received from other clients using rrweb
 */
export class EventReplayService {
  private replayer: any = null; // rrweb.Replayer instance
  private isReplaying: boolean = false;
  private eventQueue: SyncWebviewEvent[] = [];
  private isProcessingQueue: boolean = false;
  private targetElement: HTMLElement | null = null;
  private lastEventTimestamp: number = 0;
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
      const rrweb = await import('rrweb');
      
      console.log('SyncWebview: Event replay service initialized');
    } catch (error) {
      console.error('SyncWebview: Failed to initialize replay service:', error);
      this.onReplayError(new Error('Failed to initialize replay service'));
      throw error;
    }
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
      if (!this.targetElement) {
        throw new Error('Target element not set');
      }

      // Import rrweb dynamically
      const rrweb = await import('rrweb');

      // If we have an initial snapshot, use it to initialize the replayer
      let events: any[] = [];
      if (initialSnapshot) {
        try {
          events = JSON.parse(initialSnapshot);
        } catch (error) {
          console.warn('SyncWebview: Failed to parse initial snapshot, starting without it');
        }
      }

      // Create replayer configuration
      const config: ReplayerConfig = {
        target: this.targetElement,
        data: events,
        liveMode: true,
        insertStyleRules: [
          // Add custom styles for replay
          '.rr-replayer { width: 100%; height: 100%; }',
          '.rr-replayer iframe { border: none; }',
        ],
      };

      // Create the replayer instance
      this.replayer = new rrweb.Replayer(config);
      
      // Set up event handlers
      this.setupReplayerEventHandlers();
      
      this.isReplaying = true;
      this.lastEventTimestamp = Date.now();
      
      // Start processing queued events
      this.processEventQueue();
      
      console.log('SyncWebview: Started replaying events');
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
        this.replayer.destroy();
        this.replayer = null;
      }
      
      this.isReplaying = false;
      this.eventQueue = [];
      this.isProcessingQueue = false;
      
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

    // Add event to queue
    this.eventQueue.push(event);
    this.performanceMetrics.eventQueueSize = this.eventQueue.length;
    
    // Process queue if not already processing
    if (!this.isProcessingQueue) {
      this.processEventQueue();
    }
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
        const rrwebEvent = {
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
          if (this.replayer) {
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

      const rrwebEvent = {
        type: 3, // rrweb interaction event
        data: {
          type: eventType,
          x: interaction.position.x,
          y: interaction.position.y,
          id: this.getElementId(interaction.element),
        },
        timestamp: interaction.timestamp,
      };

      this.replayer.addEvent(rrwebEvent);
      
      console.log('SyncWebview: Processed mouse interaction:', interaction.type);
    } catch (error) {
      console.error('SyncWebview: Error handling mouse interaction:', error);
      this.onReplayError(new Error('Failed to handle mouse interaction'));
    }
  }

  /**
   * Apply a DOM snapshot to reset the state
   */
  async applySnapshot(snapshot: string, timestamp: number): Promise<void> {
    if (!this.isReplaying) {
      console.warn('SyncWebview: Cannot apply snapshot, replay service not running');
      return;
    }

    try {
      // Parse the snapshot
      const snapshotData = JSON.parse(snapshot);
      
      // Reset the replayer with the new snapshot
      if (this.replayer) {
        this.replayer.destroy();
      }
      
      // Import rrweb again for new replayer
      const rrweb = await import('rrweb');
      
      const config: ReplayerConfig = {
        target: this.targetElement!,
        data: snapshotData,
        liveMode: true,
        insertStyleRules: [
          '.rr-replayer { width: 100%; height: 100%; }',
          '.rr-replayer iframe { border: none; }',
        ],
      };

      this.replayer = new rrweb.Replayer(config);
      this.setupReplayerEventHandlers();
      
      this.lastEventTimestamp = timestamp;
      
      // Clear event queue since we have a fresh state
      this.eventQueue = [];
      this.performanceMetrics.eventQueueSize = 0;
      
      console.log('SyncWebview: Applied DOM snapshot');
    } catch (error) {
      console.error('SyncWebview: Failed to apply snapshot:', error);
      this.onReplayError(new Error('Failed to apply DOM snapshot'));
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
          // Apply rrweb event directly
          this.replayer.addEvent(event.data);
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
      throw error;
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

    // Handle replayer errors
    this.replayer.on('error', (error: any) => {
      console.error('SyncWebview: Replayer error:', error);
      this.onReplayError(new Error('Replayer encountered an error'));
    });

    // Handle replayer events
    this.replayer.on('event-applied', (event: any) => {
      // Update last event timestamp
      this.lastEventTimestamp = Math.max(this.lastEventTimestamp, event.timestamp || Date.now());
    });
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
}