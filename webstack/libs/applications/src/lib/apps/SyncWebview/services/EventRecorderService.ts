/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { record } from 'rrweb';
import type { eventWithTime, listenerHandler } from 'rrweb/typings/types';
import { SyncWebviewEvent, RecorderConfig, MouseEventContext, MouseMoveEvent, MouseMovementBatch, MouseInteractionState } from '../types';
import { MouseOptimizationService } from './MouseOptimizationService';

/**
 * Event Recorder Service using rrweb
 * Handles DOM mutation recording with privacy controls and performance optimization
 */
export class EventRecorderService {
  private recorder: listenerHandler | null = null;
  private isRecording = false;
  private eventBuffer: eventWithTime[] = [];
  private mouseOptimizationService: MouseOptimizationService | null = null;
  private eventCallback: (event: SyncWebviewEvent) => void;
  private mouseBatchCallback: (batch: MouseMovementBatch) => void;
  private mouseInteractionCallback: (state: MouseInteractionState) => void;
  private userId: string;
  private sessionId: string;

  constructor(
    eventCallback: (event: SyncWebviewEvent) => void,
    userId: string,
    sessionId: string,
    mouseBatchCallback?: (batch: MouseMovementBatch) => void,
    mouseInteractionCallback?: (state: MouseInteractionState) => void
  ) {
    this.eventCallback = eventCallback;
    this.userId = userId;
    this.sessionId = sessionId;
    this.mouseBatchCallback = mouseBatchCallback || (() => {});
    this.mouseInteractionCallback = mouseInteractionCallback || (() => {});
  }

  /**
   * Start recording DOM events
   */
  public startRecording(config?: Partial<RecorderConfig>): void {
    if (this.isRecording) {
      console.warn('EventRecorderService: Already recording');
      return;
    }

    const recordingConfig = this.buildRecordingConfig(config);
    
    try {
      // Initialize mouse optimization service
      this.mouseOptimizationService = new MouseOptimizationService(
        this.handleMouseBatch.bind(this),
        this.handleMouseInteraction.bind(this)
      );

      const stopFn = record(recordingConfig);
      if (stopFn) {
        this.recorder = stopFn;
        this.isRecording = true;
        console.log('EventRecorderService: Recording started with intelligent mouse optimization');
      } else {
        throw new Error('Failed to initialize rrweb recorder');
      }
    } catch (error) {
      console.error('EventRecorderService: Failed to start recording:', error);
      throw error;
    }
  }

  /**
   * Stop recording DOM events
   */
  public stopRecording(): void {
    if (!this.isRecording || !this.recorder) {
      console.warn('EventRecorderService: Not currently recording');
      return;
    }

    try {
      this.recorder();
      this.recorder = null;
      this.isRecording = false;
      this.eventBuffer = [];
      
      // Cleanup mouse optimization service
      if (this.mouseOptimizationService) {
        this.mouseOptimizationService.destroy();
        this.mouseOptimizationService = null;
      }
      
      console.log('EventRecorderService: Recording stopped');
    } catch (error) {
      console.error('EventRecorderService: Error stopping recording:', error);
    }
  }

  /**
   * Check if currently recording
   */
  public getIsRecording(): boolean {
    return this.isRecording;
  }

  /**
   * Build rrweb recording configuration
   */
  private buildRecordingConfig(userConfig?: Partial<RecorderConfig>): any {
    const defaultConfig = {
      emit: this.handleEvent.bind(this),
      sampling: {
        mousemove: false, // We handle mouse movements manually
        mouseInteraction: {
          MouseMove: false, // Handle manually for optimization
          MouseDown: true,
          MouseUp: true,
          Click: true,
          ContextMenu: true,
          DblClick: true,
        },
        scroll: 150, // Throttle scroll events to 150ms
        input: 'last', // Only capture the final input value
      },
      recordCanvas: false, // Disable canvas recording to avoid conflicts
      recordCrossOriginIframes: false, // Only same-origin iframes
      maskAllInputs: false, // We handle masking selectively
      maskInputOptions: {
        password: true, // Always mask password fields
        email: false,
        tel: false,
        text: false,
        search: false,
        url: false,
        number: false,
        range: false,
        color: false,
        date: false,
        'datetime-local': false,
        month: false,
        time: false,
        week: false,
        textarea: false,
        select: false,
      },
      maskTextClass: 'rr-mask',
      blockClass: 'rr-block',
      ignoreClass: 'rr-ignore',
      maskTextSelector: '.rr-mask, [data-rr-mask]',
      blockSelector: '.rr-block, [data-rr-block]',
      // Minimal slimDOM options for stable version
      slimDOMOptions: {
        script: true,
        comment: true,
      },
      // No custom plugins for now
      plugins: [],
    };

    return { ...defaultConfig, ...userConfig };
  }

  /**
   * Handle rrweb events and convert to SyncWebview format
   */
  private handleEvent(event: eventWithTime): void {
    if (!this.isRecording) return;

    try {
      // Skip mouse move events as they're handled by MouseOptimizationService
      if (this.isMouseMoveEvent(event)) {
        return;
      }

      // Create SyncWebview event wrapper
      const syncEvent: SyncWebviewEvent = {
        id: this.generateEventId(),
        timestamp: event.timestamp,
        type: 'rrweb',
        data: event,
        userId: this.userId,
        sessionId: this.sessionId,
      };

      // Buffer events for potential batching
      this.eventBuffer.push(event);

      // Emit event immediately for real-time sync
      this.eventCallback(syncEvent);

      // Clean up old buffered events (keep last 100)
      if (this.eventBuffer.length > 100) {
        this.eventBuffer = this.eventBuffer.slice(-100);
      }
    } catch (error) {
      console.warn('EventRecorderService: Error handling event:', error);
      // Continue recording even if individual events fail
    }
  }

  /**
   * Handle optimized mouse movement batches
   */
  private handleMouseBatch(batch: MouseMovementBatch): void {
    if (!this.isRecording) return;

    try {
      // Convert mouse batch to SyncWebview event
      const syncEvent: SyncWebviewEvent = {
        id: this.generateEventId(),
        timestamp: batch.startTime,
        type: 'rrweb',
        data: {
          type: 'mouse-batch',
          batch: batch,
        },
        userId: this.userId,
        sessionId: this.sessionId,
      };

      this.mouseBatchCallback(batch);
      console.log('EventRecorderService: Processed optimized mouse batch with', batch.events.length, 'events');
    } catch (error) {
      console.warn('EventRecorderService: Error handling mouse batch:', error);
    }
  }

  /**
   * Handle mouse interaction state changes
   */
  private handleMouseInteraction(state: MouseInteractionState): void {
    if (!this.isRecording) return;

    try {
      // Convert interaction state to SyncWebview event
      const syncEvent: SyncWebviewEvent = {
        id: this.generateEventId(),
        timestamp: state.timestamp,
        type: 'rrweb',
        data: {
          type: 'mouse-interaction',
          state: state,
        },
        userId: this.userId,
        sessionId: this.sessionId,
      };

      this.mouseInteractionCallback(state);
      console.log('EventRecorderService: Processed mouse interaction:', state.type);
    } catch (error) {
      console.warn('EventRecorderService: Error handling mouse interaction:', error);
    }
  }

  /**
   * Check if event is a mouse move event
   */
  private isMouseMoveEvent(event: eventWithTime): boolean {
    return (
      event.type === 3 && // MouseInteraction event type
      event.data &&
      event.data.source === 2 && // MouseInteraction source
      event.data.type === 0 // MouseMove type
    );
  }



  /**
   * Generate unique event ID
   */
  private generateEventId(): string {
    return `${this.sessionId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update privacy settings
   */
  public updatePrivacySettings(maskPasswords: boolean, maskElements: string[]): void {
    // Privacy settings will be applied on next recording session
    console.log('EventRecorderService: Privacy settings updated', { maskPasswords, maskElements });
  }

  /**
   * Update performance metrics for mouse optimization
   */
  public updatePerformanceMetrics(metrics: any): void {
    if (this.mouseOptimizationService) {
      this.mouseOptimizationService.updatePerformanceMetrics(metrics);
    }
  }

  /**
   * Get current mouse context from optimization service
   */
  public getMouseContext(): MouseEventContext | null {
    return this.mouseOptimizationService ? this.mouseOptimizationService.getMouseContext() : null;
  }

  /**
   * Flush any pending mouse events
   */
  public flushMouseBuffer(): void {
    if (this.mouseOptimizationService) {
      this.mouseOptimizationService.flushMouseBuffer();
    }
  }

  /**
   * Get current event buffer (for debugging)
   */
  public getEventBuffer(): eventWithTime[] {
    return [...this.eventBuffer];
  }

  /**
   * Clear event buffer
   */
  public clearEventBuffer(): void {
    this.eventBuffer = [];
  }
}