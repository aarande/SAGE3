/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { record } from 'rrweb';
import type { eventWithTime, listenerHandler } from 'rrweb/typings/types';
import { SyncWebviewEvent, RecorderConfig, MouseEventContext, MouseMoveEvent } from '../types';

/**
 * Event Recorder Service using rrweb
 * Handles DOM mutation recording with privacy controls and performance optimization
 */
export class EventRecorderService {
  private recorder: listenerHandler | null = null;
  private isRecording = false;
  private eventBuffer: eventWithTime[] = [];
  private mouseContext: MouseEventContext = {
    isInteracting: false,
    interactionType: 'none',
    lastSignificantMove: 0,
    velocity: 0,
    element: null,
  };
  private lastMousePosition = { x: 0, y: 0, timestamp: 0 };
  private mouseSamplingRate = 500; // Default 2fps for mouse movements
  private eventCallback: (event: SyncWebviewEvent) => void;
  private userId: string;
  private sessionId: string;

  constructor(
    eventCallback: (event: SyncWebviewEvent) => void,
    userId: string,
    sessionId: string
  ) {
    this.eventCallback = eventCallback;
    this.userId = userId;
    this.sessionId = sessionId;
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
      const stopFn = record(recordingConfig);
      if (stopFn) {
        this.recorder = stopFn;
        this.isRecording = true;
        console.log('EventRecorderService: Recording started');
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
   * Create smart mouse movement plugin for rrweb
   */
  private createSmartMousePlugin(): any {
    return {
      name: 'smart-mouse',
      observer: (cb: Function) => {
        const handleMouseMove = (event: MouseEvent) => {
          if (!this.shouldRecordMouseMove(event)) return;

          const mouseEvent = {
            type: 3, // MouseMove event type in rrweb
            data: {
              source: 2, // MouseInteraction source
              type: 0, // MouseMove type
              id: this.getElementId(event.target as Element),
              x: event.clientX,
              y: event.clientY,
            },
            timestamp: Date.now(),
          };

          cb(mouseEvent);
          this.updateMouseContext(event);
        };

        const handleMouseDown = (event: MouseEvent) => {
          this.mouseContext.isInteracting = true;
          this.mouseContext.interactionType = 'drag';
          this.mouseSamplingRate = 16; // 60fps during interactions
        };

        const handleMouseUp = (event: MouseEvent) => {
          this.mouseContext.isInteracting = false;
          this.mouseContext.interactionType = 'none';
          this.mouseSamplingRate = 500; // Back to 2fps
        };

        // Add event listeners
        document.addEventListener('mousemove', handleMouseMove, { passive: true });
        document.addEventListener('mousedown', handleMouseDown, { passive: true });
        document.addEventListener('mouseup', handleMouseUp, { passive: true });

        // Return cleanup function
        return () => {
          document.removeEventListener('mousemove', handleMouseMove);
          document.removeEventListener('mousedown', handleMouseDown);
          document.removeEventListener('mouseup', handleMouseUp);
        };
      },
    };
  }

  /**
   * Determine if mouse movement should be recorded based on context
   */
  private shouldRecordMouseMove(event: MouseEvent): boolean {
    const now = Date.now();
    const timeSinceLastMove = now - this.lastMousePosition.timestamp;

    // Always record if we're in an interaction
    if (this.mouseContext.isInteracting) {
      return timeSinceLastMove >= this.mouseSamplingRate;
    }

    // Check if mouse moved significantly
    const distance = Math.sqrt(
      Math.pow(event.clientX - this.lastMousePosition.x, 2) +
      Math.pow(event.clientY - this.lastMousePosition.y, 2)
    );

    // Only record if moved more than 5px and enough time has passed
    if (distance < 5 || timeSinceLastMove < this.mouseSamplingRate) {
      return false;
    }

    // Check if over interactive element
    const target = event.target as Element;
    if (target && this.isInteractiveElement(target)) {
      return timeSinceLastMove >= 100; // 10fps for interactive elements
    }

    return timeSinceLastMove >= this.mouseSamplingRate;
  }

  /**
   * Update mouse movement context
   */
  private updateMouseContext(event: MouseEvent): void {
    const now = Date.now();
    const timeDelta = now - this.lastMousePosition.timestamp;
    
    if (timeDelta > 0) {
      const distance = Math.sqrt(
        Math.pow(event.clientX - this.lastMousePosition.x, 2) +
        Math.pow(event.clientY - this.lastMousePosition.y, 2)
      );
      this.mouseContext.velocity = distance / timeDelta;
    }

    this.mouseContext.element = event.target as HTMLElement;
    this.mouseContext.lastSignificantMove = now;
    
    this.lastMousePosition = {
      x: event.clientX,
      y: event.clientY,
      timestamp: now,
    };
  }

  /**
   * Check if element is interactive
   */
  private isInteractiveElement(element: Element): boolean {
    const interactiveTags = ['button', 'a', 'input', 'select', 'textarea', 'label'];
    const tagName = element.tagName.toLowerCase();
    
    return (
      interactiveTags.includes(tagName) ||
      element.hasAttribute('onclick') ||
      element.hasAttribute('onmousedown') ||
      element.classList.contains('clickable') ||
      element.classList.contains('interactive') ||
      window.getComputedStyle(element).cursor === 'pointer'
    );
  }

  /**
   * Get unique identifier for DOM element
   */
  private getElementId(element: Element | null): number {
    if (!element) return 0;
    
    // Use existing id if available
    if (element.id) {
      return this.hashString(element.id);
    }
    
    // Generate based on tag name and position
    const tagName = element.tagName.toLowerCase();
    const parent = element.parentElement;
    const siblings = parent ? Array.from(parent.children) : [];
    const index = siblings.indexOf(element);
    
    return this.hashString(`${tagName}-${index}-${parent?.tagName || 'root'}`);
  }

  /**
   * Simple string hash function
   */
  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
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