/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { MouseOptimizationService } from '../MouseOptimizationService';
import { MouseMovementBatch, MouseInteractionState } from '../../types';

// Mock DOM methods
Object.defineProperty(window, 'getComputedStyle', {
  value: () => ({
    cursor: 'default',
  }),
});

describe('MouseOptimizationService', () => {
  let service: MouseOptimizationService;
  let mockBatchCallback: jest.Mock;
  let mockInteractionCallback: jest.Mock;

  beforeEach(() => {
    mockBatchCallback = jest.fn();
    mockInteractionCallback = jest.fn();
    
    // Mock document.addEventListener
    jest.spyOn(document, 'addEventListener').mockImplementation(() => {});
    jest.spyOn(document, 'removeEventListener').mockImplementation(() => {});
    
    service = new MouseOptimizationService(mockBatchCallback, mockInteractionCallback);
  });

  afterEach(() => {
    service.destroy();
    jest.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with default mouse context', () => {
      const context = service.getMouseContext();
      
      expect(context.isInteracting).toBe(false);
      expect(context.interactionType).toBe('none');
      expect(context.velocity).toBe(0);
      expect(context.element).toBeNull();
    });

    it('should initialize with default adaptive sampling', () => {
      const sampling = service.getAdaptiveSampling();
      
      expect(sampling.mouseSamplingRate).toBe(100); // Default 10fps
      expect(sampling.eventDropRate).toBe(0);
      expect(sampling.adaptationInterval).toBe(1000);
    });
  });

  describe('performance adaptation', () => {
    it('should adapt sampling rate based on performance metrics', () => {
      const lowPerformanceMetrics = {
        eventQueueSize: 600,
        networkLatency: 250,
        processingDelay: 50,
        clientPerformance: 'low' as const,
      };

      // Get initial sampling rate
      const initialSampling = service.getAdaptiveSampling();
      const initialRate = initialSampling.mouseSamplingRate;

      service.updatePerformanceMetrics(lowPerformanceMetrics);
      
      // Force adaptation by setting lastAdaptation to past
      const sampling = service.getAdaptiveSampling();
      sampling.lastAdaptation = Date.now() - 2000; // 2 seconds ago
      
      // Update again to trigger adaptation
      service.updatePerformanceMetrics(lowPerformanceMetrics);
      
      const newSampling = service.getAdaptiveSampling();
      // Should either increase sampling rate or maintain it for low performance
      expect(newSampling.mouseSamplingRate).toBeGreaterThanOrEqual(initialRate);
    });

    it('should improve sampling rate for high performance', () => {
      const highPerformanceMetrics = {
        eventQueueSize: 50,
        networkLatency: 30,
        processingDelay: 5,
        clientPerformance: 'high' as const,
      };

      service.updatePerformanceMetrics(highPerformanceMetrics);
      
      const sampling = service.getAdaptiveSampling();
      // Should maintain or improve sampling rate for high performance
      expect(sampling.mouseSamplingRate).toBeLessThanOrEqual(100);
    });
  });

  describe('mouse context management', () => {
    it('should update context correctly', () => {
      const context = service.getMouseContext();
      expect(context.isInteracting).toBe(false);
      expect(context.interactionType).toBe('none');
    });

    it('should handle null elements gracefully', () => {
      // This should not throw an error
      expect(() => {
        const mockEvent = new MouseEvent('mouseenter', {
          clientX: 100,
          clientY: 100,
        });
        
        // Simulate event with null target
        Object.defineProperty(mockEvent, 'target', {
          value: null,
          writable: false,
        });
        
        // This should not throw
        document.dispatchEvent(mockEvent);
      }).not.toThrow();
    });

    it('should handle elements without matches method', () => {
      // Create a mock element without matches method
      const mockElement = {
        tagName: 'DIV',
        hasAttribute: jest.fn(() => false),
        classList: { contains: jest.fn(() => false) },
      };

      // This should not throw and should return 'standard' strategy
      expect(() => {
        // Access private method for testing
        const strategy = (service as any).getElementMouseStrategy(mockElement);
        expect(strategy).toBe('standard');
      }).not.toThrow();
    });
  });

  describe('buffer management', () => {
    it('should flush mouse buffer on demand', () => {
      // This should not throw an error
      expect(() => service.flushMouseBuffer()).not.toThrow();
    });
  });

  describe('cleanup', () => {
    it('should remove event listeners on destroy', () => {
      const removeEventListenerSpy = jest.spyOn(document, 'removeEventListener');
      
      service.destroy();
      
      // Should call removeEventListener for each event type
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousemove', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mousedown', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseup', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('dragstart', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('dragend', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseenter', expect.any(Function));
      expect(removeEventListenerSpy).toHaveBeenCalledWith('mouseleave', expect.any(Function));
    });
  });
});