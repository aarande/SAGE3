/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { 
  MouseEventContext, 
  MouseMoveEvent, 
  MouseInteractionState, 
  MouseMovementBatch, 
  PerformanceMetrics,
  AdaptiveSamplingConfig 
} from '../types';

/**
 * Mouse optimization strategies for different element types
 */
export type MouseStrategy = 'high-fidelity' | 'drag-optimized' | 'media-optimized' | 'standard';

/**
 * Intelligent Mouse Movement Optimization Service
 * Implements context-aware mouse event processing with adaptive sampling
 */
export class MouseOptimizationService {
  private mouseContext: MouseEventContext = {
    isInteracting: false,
    interactionType: 'none',
    lastSignificantMove: 0,
    velocity: 0,
    element: null,
  };

  private lastMousePosition = { x: 0, y: 0, timestamp: 0 };
  private mouseEventBuffer: MouseMoveEvent[] = [];
  private interactionStateBuffer: MouseInteractionState[] = [];
  
  private adaptiveSampling: AdaptiveSamplingConfig = {
    mouseSamplingRate: 100, // Default 10fps
    eventDropRate: 0,
    lastAdaptation: Date.now(),
    adaptationInterval: 1000, // Adapt every second
  };

  private performanceMetrics: PerformanceMetrics = {
    eventQueueSize: 0,
    networkLatency: 0,
    processingDelay: 0,
    clientPerformance: 'medium',
  };

  // Configuration constants
  private readonly DISTANCE_THRESHOLD = 5; // Minimum pixel distance for significant movement
  private readonly HIGH_FIDELITY_RATE = 16; // ~60fps for drag operations
  private readonly INTERACTIVE_RATE = 100; // 10fps for interactive elements
  private readonly STANDARD_RATE = 500; // 2fps for general movement
  private readonly MAX_BUFFER_SIZE = 50;
  private readonly VELOCITY_SMOOTHING_FACTOR = 0.3;

  constructor(
    private eventCallback: (batch: MouseMovementBatch) => void,
    private interactionCallback: (state: MouseInteractionState) => void
  ) {
    this.setupMouseListeners();
  }

  /**
   * Setup mouse event listeners with intelligent processing
   */
  private setupMouseListeners(): void {
    // Mouse movement handler with context-aware sampling
    document.addEventListener('mousemove', this.handleMouseMove.bind(this), { passive: true });
    
    // Interaction state handlers
    document.addEventListener('mousedown', this.handleMouseDown.bind(this), { passive: true });
    document.addEventListener('mouseup', this.handleMouseUp.bind(this), { passive: true });
    document.addEventListener('dragstart', this.handleDragStart.bind(this), { passive: true });
    document.addEventListener('dragend', this.handleDragEnd.bind(this), { passive: true });
    
    // Element-specific handlers
    document.addEventListener('mouseenter', this.handleMouseEnter.bind(this), { passive: true });
    document.addEventListener('mouseleave', this.handleMouseLeave.bind(this), { passive: true });
  }

  /**
   * Handle mouse movement with intelligent sampling
   */
  private handleMouseMove(event: MouseEvent): void {
    const now = Date.now();
    const target = event.target as HTMLElement | null;

    // Update mouse context
    this.updateMouseContext(event, target, now);

    // Check if this movement should be recorded
    if (!this.shouldRecordMouseMove(event, now)) {
      return;
    }

    // Create mouse move event
    const mouseEvent: MouseMoveEvent = {
      x: event.clientX,
      y: event.clientY,
      timestamp: now,
      target: this.getElementSelector(target),
    };

    // Add to buffer
    this.mouseEventBuffer.push(mouseEvent);

    // Maintain buffer size
    if (this.mouseEventBuffer.length > this.MAX_BUFFER_SIZE) {
      this.mouseEventBuffer = this.mouseEventBuffer.slice(-this.MAX_BUFFER_SIZE);
    }

    // Update last position
    this.lastMousePosition = {
      x: event.clientX,
      y: event.clientY,
      timestamp: now,
    };

    // Process buffer if needed
    this.processMouseBuffer();
  }

  /**
   * Handle mouse down events
   */
  private handleMouseDown(event: MouseEvent): void {
    this.mouseContext.isInteracting = true;
    this.mouseContext.interactionType = 'click';
    
    const interactionState: MouseInteractionState = {
      type: 'mousedown',
      timestamp: Date.now(),
      position: { x: event.clientX, y: event.clientY },
      element: this.getElementSelector(event.target as HTMLElement),
    };

    this.interactionStateBuffer.push(interactionState);
    this.interactionCallback(interactionState);

    // Switch to high-fidelity mode for interactions
    this.adaptiveSampling.mouseSamplingRate = this.getMouseSamplingRate(this.mouseContext);
  }

  /**
   * Handle mouse up events
   */
  private handleMouseUp(event: MouseEvent): void {
    this.mouseContext.isInteracting = false;
    this.mouseContext.interactionType = 'none';
    
    const interactionState: MouseInteractionState = {
      type: 'mouseup',
      timestamp: Date.now(),
      position: { x: event.clientX, y: event.clientY },
      element: this.getElementSelector(event.target as HTMLElement),
    };

    this.interactionStateBuffer.push(interactionState);
    this.interactionCallback(interactionState);

    // Return to standard sampling rate
    this.adaptiveSampling.mouseSamplingRate = this.getMouseSamplingRate(this.mouseContext);
  }

  /**
   * Handle drag start events
   */
  private handleDragStart(event: DragEvent): void {
    this.mouseContext.isInteracting = true;
    this.mouseContext.interactionType = 'drag';
    
    const interactionState: MouseInteractionState = {
      type: 'dragstart',
      timestamp: Date.now(),
      position: { x: event.clientX, y: event.clientY },
      element: this.getElementSelector(event.target as HTMLElement),
    };

    this.interactionStateBuffer.push(interactionState);
    this.interactionCallback(interactionState);

    // Use drag-optimized sampling
    this.adaptiveSampling.mouseSamplingRate = this.HIGH_FIDELITY_RATE;
  }

  /**
   * Handle drag end events
   */
  private handleDragEnd(event: DragEvent): void {
    this.mouseContext.isInteracting = false;
    this.mouseContext.interactionType = 'none';
    
    const interactionState: MouseInteractionState = {
      type: 'dragend',
      timestamp: Date.now(),
      position: { x: event.clientX, y: event.clientY },
      element: this.getElementSelector(event.target as HTMLElement),
    };

    this.interactionStateBuffer.push(interactionState);
    this.interactionCallback(interactionState);

    // Return to standard sampling
    this.adaptiveSampling.mouseSamplingRate = this.getMouseSamplingRate(this.mouseContext);
  }

  /**
   * Handle mouse enter events for element-specific optimization
   */
  private handleMouseEnter(event: MouseEvent): void {
    const target = event.target as HTMLElement;
    
    // Validate that target is a proper HTMLElement
    if (!target || typeof target.matches !== 'function') {
      this.mouseContext.element = null;
      return;
    }
    
    this.mouseContext.element = target;
    
    // Adjust sampling rate based on element type
    const strategy = this.getElementMouseStrategy(target);
    this.adaptiveSampling.mouseSamplingRate = this.getStrategyBasedSamplingRate(strategy);
  }

  /**
   * Handle mouse leave events
   */
  private handleMouseLeave(event: MouseEvent): void {
    this.mouseContext.element = null;
    this.adaptiveSampling.mouseSamplingRate = this.getMouseSamplingRate(this.mouseContext);
  }

  /**
   * Update mouse movement context
   */
  private updateMouseContext(event: MouseEvent, target: HTMLElement | null, timestamp: number): void {
    const timeDelta = timestamp - this.lastMousePosition.timestamp;
    
    if (timeDelta > 0) {
      const distance = Math.sqrt(
        Math.pow(event.clientX - this.lastMousePosition.x, 2) +
        Math.pow(event.clientY - this.lastMousePosition.y, 2)
      );
      
      // Calculate velocity with smoothing
      const instantVelocity = distance / timeDelta;
      this.mouseContext.velocity = 
        this.mouseContext.velocity * (1 - this.VELOCITY_SMOOTHING_FACTOR) +
        instantVelocity * this.VELOCITY_SMOOTHING_FACTOR;
    }

    this.mouseContext.element = target;
    this.mouseContext.lastSignificantMove = timestamp;
  }

  /**
   * Determine if mouse movement should be recorded
   */
  private shouldRecordMouseMove(event: MouseEvent, timestamp: number): boolean {
    const timeSinceLastMove = timestamp - this.lastMousePosition.timestamp;

    // Always record if we're in an interaction
    if (this.mouseContext.isInteracting) {
      return timeSinceLastMove >= this.adaptiveSampling.mouseSamplingRate;
    }

    // Check movement significance
    const distance = Math.sqrt(
      Math.pow(event.clientX - this.lastMousePosition.x, 2) +
      Math.pow(event.clientY - this.lastMousePosition.y, 2)
    );

    // Skip if movement is too small or too frequent
    if (distance < this.DISTANCE_THRESHOLD || timeSinceLastMove < this.adaptiveSampling.mouseSamplingRate) {
      return false;
    }

    // Check element-specific requirements
    const target = event.target as HTMLElement | null;
    const strategy = this.getElementMouseStrategy(target);
    const requiredRate = this.getStrategyBasedSamplingRate(strategy);

    return timeSinceLastMove >= requiredRate;
  }

  /**
   * Get mouse sampling rate based on context
   */
  private getMouseSamplingRate(context: MouseEventContext): number {
    if (context.isInteracting) {
      switch (context.interactionType) {
        case 'drag':
          return this.HIGH_FIDELITY_RATE;
        case 'click':
          return this.HIGH_FIDELITY_RATE;
        default:
          return this.INTERACTIVE_RATE;
      }
    }

    if (context.element && this.isInteractiveElement(context.element)) {
      return this.INTERACTIVE_RATE;
    }

    return this.STANDARD_RATE;
  }

  /**
   * Get element-specific mouse handling strategy
   */
  private getElementMouseStrategy(element: HTMLElement | null): MouseStrategy {
    // Check if element exists and has the matches method
    if (!element || typeof element.matches !== 'function') {
      return 'standard'; // Default optimization for invalid elements
    }

    try {
      if (element.matches('canvas, svg')) {
        return 'high-fidelity'; // Drawing/graphics applications need precise tracking
      } else if (element.matches('[draggable], .draggable')) {
        return 'drag-optimized'; // Drag operations need continuous tracking
      } else if (element.matches('video, audio')) {
        return 'media-optimized'; // Media controls need responsive tracking
      } else {
        return 'standard'; // Default optimization
      }
    } catch (error) {
      console.warn('MouseOptimizationService: Error checking element strategy:', error);
      return 'standard'; // Fallback to standard strategy
    }
  }

  /**
   * Get sampling rate based on strategy
   */
  private getStrategyBasedSamplingRate(strategy: MouseStrategy): number {
    switch (strategy) {
      case 'high-fidelity':
        return this.HIGH_FIDELITY_RATE;
      case 'drag-optimized':
        return this.HIGH_FIDELITY_RATE;
      case 'media-optimized':
        return this.INTERACTIVE_RATE;
      case 'standard':
      default:
        return this.STANDARD_RATE;
    }
  }

  /**
   * Check if element is interactive
   */
  private isInteractiveElement(element: HTMLElement | null): boolean {
    if (!element || !element.tagName) {
      return false;
    }

    try {
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
    } catch (error) {
      console.warn('MouseOptimizationService: Error checking interactive element:', error);
      return false;
    }
  }

  /**
   * Get CSS selector for element
   */
  private getElementSelector(element: HTMLElement | null): string {
    if (!element) return '';
    
    // Use existing id if available
    if (element.id) {
      return `#${element.id}`;
    }
    
    // Generate based on tag name and position
    const tagName = element.tagName.toLowerCase();
    const parent = element.parentElement;
    
    if (parent) {
      const siblings = Array.from(parent.children);
      const index = siblings.indexOf(element);
      return `${parent.tagName.toLowerCase()} > ${tagName}:nth-child(${index + 1})`;
    }
    
    return tagName;
  }

  /**
   * Process mouse buffer and create optimized batch
   */
  private processMouseBuffer(): void {
    if (this.mouseEventBuffer.length === 0) return;

    // Create batch with optimized events
    const optimizedEvents = this.optimizeMouseEvents(this.mouseEventBuffer);
    
    if (optimizedEvents.length > 0) {
      const batch: MouseMovementBatch = {
        events: optimizedEvents,
        startTime: this.mouseEventBuffer[0].timestamp,
        endTime: this.mouseEventBuffer[this.mouseEventBuffer.length - 1].timestamp,
        interactionContext: { ...this.mouseContext },
      };

      this.eventCallback(batch);
    }

    // Clear buffer after processing
    this.mouseEventBuffer = [];
  }

  /**
   * Optimize mouse events by removing redundant movements
   */
  private optimizeMouseEvents(events: MouseMoveEvent[]): MouseMoveEvent[] {
    if (events.length <= 2) return events;

    const optimized = [events[0]]; // Always keep first event
    const TIME_THRESHOLD = 50; // Minimum time between events

    for (let i = 1; i < events.length - 1; i++) {
      const current = events[i];
      const last = optimized[optimized.length - 1];
      
      const distance = Math.sqrt(
        Math.pow(current.x - last.x, 2) + Math.pow(current.y - last.y, 2)
      );
      
      const timeDiff = current.timestamp - last.timestamp;

      // Keep event if it's significant in distance or time
      if (distance >= this.DISTANCE_THRESHOLD || timeDiff >= TIME_THRESHOLD) {
        optimized.push(current);
      }
    }

    // Always keep last event if there are multiple events
    if (events.length > 1) {
      optimized.push(events[events.length - 1]);
    }

    return optimized;
  }

  /**
   * Update performance metrics for adaptive optimization
   */
  public updatePerformanceMetrics(metrics: PerformanceMetrics): void {
    this.performanceMetrics = { ...metrics };
    this.adaptPerformance();
  }

  /**
   * Adapt performance based on current metrics
   */
  private adaptPerformance(): void {
    const now = Date.now();
    
    if (now - this.adaptiveSampling.lastAdaptation < this.adaptiveSampling.adaptationInterval) {
      return;
    }

    const { eventQueueSize, networkLatency, clientPerformance } = this.performanceMetrics;

    // Adjust sampling based on performance
    if (clientPerformance === 'low' || eventQueueSize > 500 || networkLatency > 200) {
      // Reduce mouse event frequency
      this.adaptiveSampling.mouseSamplingRate = Math.min(
        this.adaptiveSampling.mouseSamplingRate * 1.5,
        this.STANDARD_RATE
      );
      this.adaptiveSampling.eventDropRate = Math.min(
        this.adaptiveSampling.eventDropRate + 0.1,
        0.5
      );
    } else if (clientPerformance === 'high' && eventQueueSize < 100 && networkLatency < 50) {
      // Allow higher fidelity
      this.adaptiveSampling.mouseSamplingRate = Math.max(
        this.adaptiveSampling.mouseSamplingRate * 0.8,
        this.HIGH_FIDELITY_RATE
      );
      this.adaptiveSampling.eventDropRate = Math.max(
        this.adaptiveSampling.eventDropRate - 0.05,
        0
      );
    }

    this.adaptiveSampling.lastAdaptation = now;
  }

  /**
   * Get current mouse context
   */
  public getMouseContext(): MouseEventContext {
    return { ...this.mouseContext };
  }

  /**
   * Get current adaptive sampling configuration
   */
  public getAdaptiveSampling(): AdaptiveSamplingConfig {
    return { ...this.adaptiveSampling };
  }

  /**
   * Force process current mouse buffer
   */
  public flushMouseBuffer(): void {
    this.processMouseBuffer();
  }

  /**
   * Cleanup event listeners
   */
  public destroy(): void {
    document.removeEventListener('mousemove', this.handleMouseMove.bind(this));
    document.removeEventListener('mousedown', this.handleMouseDown.bind(this));
    document.removeEventListener('mouseup', this.handleMouseUp.bind(this));
    document.removeEventListener('dragstart', this.handleDragStart.bind(this));
    document.removeEventListener('dragend', this.handleDragEnd.bind(this));
    document.removeEventListener('mouseenter', this.handleMouseEnter.bind(this));
    document.removeEventListener('mouseleave', this.handleMouseLeave.bind(this));
  }
}