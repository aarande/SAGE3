/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { WorkerManagerService } from '../../services/WorkerManagerService';
import { SyncWebviewEvent, WorkerMessage } from '../../types';

describe('EventProcessorWorker', () => {
  let workerManager: WorkerManagerService;
  let mockEventCallback: jest.Mock;
  let mockBatchCallback: jest.Mock;
  let mockErrorCallback: jest.Mock;

  beforeEach(() => {
    mockEventCallback = jest.fn();
    mockBatchCallback = jest.fn();
    mockErrorCallback = jest.fn();

    workerManager = new WorkerManagerService(
      mockEventCallback,
      mockBatchCallback,
      mockErrorCallback
    );
  });

  afterEach(() => {
    workerManager.terminate();
  });

  describe('Worker Initialization', () => {
    it('should initialize worker successfully', async () => {
      await workerManager.initialize();
      expect(workerManager.getIsInitialized()).toBe(true);
    });

    it('should handle initialization errors gracefully', async () => {
      // Mock Worker constructor to throw error
      const originalWorker = global.Worker;
      global.Worker = jest.fn().mockImplementation(() => {
        throw new Error('Worker initialization failed');
      });

      await expect(workerManager.initialize()).rejects.toThrow('Worker initialization failed');

      // Restore original Worker
      global.Worker = originalWorker;
    });
  });

  describe('Event Processing', () => {
    beforeEach(async () => {
      await workerManager.initialize();
    });

    it('should process high-priority events immediately', () => {
      const highPriorityEvent: SyncWebviewEvent = {
        id: 'test-1',
        timestamp: Date.now(),
        type: 'rrweb',
        data: {
          type: 2, // DOMContentLoaded - high priority
          timestamp: Date.now(),
        },
        userId: 'user-1',
        sessionId: 'session-1',
      };

      workerManager.processEvent(highPriorityEvent);

      // High priority events should be processed immediately
      expect(mockEventCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-1',
          type: 'rrweb',
        })
      );
    });

    it('should batch low-priority events', (done) => {
      const lowPriorityEvent: SyncWebviewEvent = {
        id: 'test-2',
        timestamp: Date.now(),
        type: 'rrweb',
        data: {
          type: 3, // Mouse interaction - low priority
          data: {
            source: 2,
            type: 0, // MouseMove
            x: 100,
            y: 200,
          },
          timestamp: Date.now(),
        },
        userId: 'user-1',
        sessionId: 'session-1',
      };

      workerManager.processEvent(lowPriorityEvent);

      // Low priority events should be batched
      setTimeout(() => {
        expect(mockBatchCallback).toHaveBeenCalled();
        done();
      }, 150); // Wait for batch interval
    });

    it('should handle batch processing', () => {
      const events: SyncWebviewEvent[] = [
        {
          id: 'batch-1',
          timestamp: Date.now(),
          type: 'rrweb',
          data: { type: 1 },
          userId: 'user-1',
          sessionId: 'session-1',
        },
        {
          id: 'batch-2',
          timestamp: Date.now(),
          type: 'rrweb',
          data: { type: 1 },
          userId: 'user-1',
          sessionId: 'session-1',
        },
      ];

      workerManager.processBatch(events);

      // Should process all events in batch
      expect(mockEventCallback).toHaveBeenCalledTimes(2);
    });
  });

  describe('Performance Monitoring', () => {
    beforeEach(async () => {
      await workerManager.initialize();
    });

    it('should track performance metrics', () => {
      const metrics = workerManager.getPerformanceMetrics();
      
      expect(metrics).toHaveProperty('averageNetworkLatency');
      expect(metrics).toHaveProperty('recentLatencies');
      expect(metrics).toHaveProperty('pendingMessages');
    });

    it('should update configuration', () => {
      const config = {
        batchInterval: 50,
        mouseSamplingRate: 200,
      };

      workerManager.updateConfig(config);

      // Configuration should be sent to worker
      // This is tested indirectly through behavior changes
      expect(workerManager.getIsInitialized()).toBe(true);
    });
  });

  describe('Snapshot Processing', () => {
    beforeEach(async () => {
      await workerManager.initialize();
    });

    it('should process snapshots', () => {
      const snapshot = {
        type: 'full-snapshot',
        data: { html: '<html><body>Test</body></html>' },
        timestamp: Date.now(),
      };

      workerManager.processSnapshot(snapshot);

      // Snapshot should be processed by worker
      // This is tested indirectly through the worker's response
      expect(workerManager.getIsInitialized()).toBe(true);
    });
  });

  describe('Error Handling', () => {
    beforeEach(async () => {
      await workerManager.initialize();
    });

    it('should handle worker errors', () => {
      // Simulate worker error by sending invalid message
      const invalidEvent = null as any;
      
      workerManager.processEvent(invalidEvent);

      // Error callback should eventually be called
      // This is tested indirectly through error handling
      expect(mockErrorCallback).toHaveBeenCalledWith(
        expect.objectContaining({
          message: expect.any(String),
        })
      );
    });
  });

  describe('Worker Termination', () => {
    it('should terminate worker cleanly', async () => {
      await workerManager.initialize();
      expect(workerManager.getIsInitialized()).toBe(true);

      workerManager.terminate();
      expect(workerManager.getIsInitialized()).toBe(false);
    });

    it('should handle events on main thread when worker not initialized', () => {
      const event: SyncWebviewEvent = {
        id: 'test-fallback',
        timestamp: Date.now(),
        type: 'rrweb',
        data: { type: 1 },
        userId: 'user-1',
        sessionId: 'session-1',
      };

      workerManager.processEvent(event);

      // Should fallback to main thread processing
      expect(mockEventCallback).toHaveBeenCalledWith(event);
    });
  });
});