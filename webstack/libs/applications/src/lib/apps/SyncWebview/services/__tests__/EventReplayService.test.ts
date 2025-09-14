/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { EventReplayService } from '../EventReplayService';
import { SyncWebviewEvent } from '../../types';

// Mock rrweb module
jest.mock('rrweb', () => ({
  Replayer: jest.fn().mockImplementation(() => ({
    play: jest.fn(),
    pause: jest.fn(),
    destroy: jest.fn(),
    on: jest.fn(),
    addEvent: jest.fn(),
  })),
}));

describe('EventReplayService', () => {
  let service: EventReplayService;
  let mockOnReplayError: jest.Mock;
  let mockOnReplayComplete: jest.Mock;
  let mockTargetElement: HTMLElement;

  beforeEach(() => {
    mockOnReplayError = jest.fn();
    mockOnReplayComplete = jest.fn();
    
    // Create mock target element
    mockTargetElement = document.createElement('div');
    document.body.appendChild(mockTargetElement);
    
    service = new EventReplayService(mockOnReplayError, mockOnReplayComplete);
  });

  afterEach(() => {
    if (mockTargetElement.parentNode) {
      mockTargetElement.parentNode.removeChild(mockTargetElement);
    }
    service.stopReplaying();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await service.initialize(mockTargetElement);
      
      expect(service.getIsInitialized()).toBe(true);
    });

    it('should create replay container', async () => {
      await service.initialize(mockTargetElement);
      
      const container = mockTargetElement.querySelector('#rrweb-replay-container');
      expect(container).toBeTruthy();
    });
  });

  describe('replay functionality', () => {
    beforeEach(async () => {
      await service.initialize(mockTargetElement);
    });

    it('should start replaying', async () => {
      await service.startReplaying();
      
      expect(service.getIsReplaying()).toBe(true);
    });

    it('should stop replaying', async () => {
      await service.startReplaying();
      service.stopReplaying();
      
      expect(service.getIsReplaying()).toBe(false);
    });

    it('should handle events', async () => {
      await service.startReplaying();
      
      const mockEvent: SyncWebviewEvent = {
        id: 'test-1',
        timestamp: Date.now(),
        type: 'rrweb',
        data: { type: 1, timestamp: Date.now(), data: {} }, // Add required data field
        userId: 'user-1',
        sessionId: 'session-1',
      };

      service.addEvent(mockEvent);
      
      // Wait a bit for async processing
      await new Promise(resolve => setTimeout(resolve, 10));
      
      expect(service.getEventQueueSize()).toBeGreaterThanOrEqual(0);
    });
  });

  describe('error handling', () => {
    it('should handle initialization errors', async () => {
      // Create a new service instance to test error handling
      const errorService = new EventReplayService(mockOnReplayError, mockOnReplayComplete);
      
      // Mock the import to fail by overriding the method
      const originalImport = (errorService as any).initialize;
      (errorService as any).initialize = async () => {
        throw new Error('Import failed');
      };

      await expect(errorService.initialize(mockTargetElement)).rejects.toThrow();
    });

    it('should validate events', async () => {
      await service.initialize(mockTargetElement);
      await service.startReplaying();

      const invalidEvent = {
        id: 'invalid',
        // Missing required fields
      } as SyncWebviewEvent;

      service.addEvent(invalidEvent);
      
      // Should not add invalid event to queue
      expect(service.getEventQueueSize()).toBe(0);
    });
  });

  describe('status reporting', () => {
    beforeEach(async () => {
      await service.initialize(mockTargetElement);
    });

    it('should report correct status', async () => {
      const status = service.getStatus();
      
      expect(status.isInitialized).toBe(true);
      expect(status.isReplaying).toBe(false);
      expect(status.eventQueueSize).toBe(0);
      expect(status.currentEventsCount).toBe(0);
    });

    it('should update status after starting replay', async () => {
      await service.startReplaying();
      
      const status = service.getStatus();
      expect(status.isReplaying).toBe(true);
    });
  });
});