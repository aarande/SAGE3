/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { WebSocketService } from '../WebSocketService';
import { SyncWebviewEvent, MouseMovementBatch, MouseInteractionState } from '../../types';

// Mock SAGE3 SocketAPI
jest.mock('@sage3/frontend', () => ({
  SocketAPI: {
    subscribe: jest.fn(),
    sendRESTMessage: jest.fn(),
  },
}));

describe('WebSocketService', () => {
  let webSocketService: WebSocketService;
  let mockOnEventReceived: jest.Mock;
  let mockOnSnapshotReceived: jest.Mock;
  let mockOnMouseBatchReceived: jest.Mock;
  let mockOnMouseInteractionReceived: jest.Mock;
  let mockOnError: jest.Mock;
  let mockOnSnapshotRequested: jest.Mock;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Create mock callbacks
    mockOnEventReceived = jest.fn();
    mockOnSnapshotReceived = jest.fn();
    mockOnMouseBatchReceived = jest.fn();
    mockOnMouseInteractionReceived = jest.fn();
    mockOnError = jest.fn();
    mockOnSnapshotRequested = jest.fn();

    // Create WebSocketService instance
    webSocketService = new WebSocketService(
      'test-app-id',
      'test-user-id',
      'test-board-id',
      mockOnEventReceived,
      mockOnSnapshotReceived,
      mockOnMouseBatchReceived,
      mockOnMouseInteractionReceived,
      mockOnError,
      mockOnSnapshotRequested
    );
  });

  afterEach(() => {
    webSocketService.destroy();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      const { SocketAPI } = await import('@sage3/frontend');
      (SocketAPI.subscribe as jest.Mock).mockResolvedValue(() => {});

      await webSocketService.initialize();

      expect(webSocketService.getIsInitialized()).toBe(true);
      expect(SocketAPI.subscribe).toHaveBeenCalledWith('/apps', expect.any(Function));
    });

    it('should handle initialization errors', async () => {
      const { SocketAPI } = await import('@sage3/frontend');
      (SocketAPI.subscribe as jest.Mock).mockRejectedValue(new Error('Connection failed'));

      await expect(webSocketService.initialize()).rejects.toThrow('Connection failed');
      expect(mockOnError).toHaveBeenCalledWith(expect.any(Error));
    });
  });

  describe('message broadcasting', () => {
    beforeEach(async () => {
      const { SocketAPI } = await import('@sage3/frontend');
      (SocketAPI.subscribe as jest.Mock).mockResolvedValue(() => {});
      (SocketAPI.sendRESTMessage as jest.Mock).mockResolvedValue({ success: true });
      
      await webSocketService.initialize();
    });

    it('should broadcast rrweb events', async () => {
      const testEvent: SyncWebviewEvent = {
        id: 'test-event-id',
        timestamp: Date.now(),
        type: 'rrweb',
        data: { type: 'click', x: 100, y: 200 },
        userId: 'test-user-id',
        sessionId: 'test-session-id'
      };

      await webSocketService.broadcastEvent(testEvent);

      const { SocketAPI } = await import('@sage3/frontend');
      expect(SocketAPI.sendRESTMessage).toHaveBeenCalledWith(
        '/apps/test-app-id',
        'PUT',
        expect.objectContaining({
          data: {
            state: {
              lastSyncMessage: expect.objectContaining({
                syncwebviewMessage: expect.objectContaining({
                  type: 'syncwebview-event',
                  appId: 'test-app-id',
                  data: testEvent,
                  userId: 'test-user-id'
                })
              })
            }
          }
        })
      );
    });

    it('should broadcast mouse batches', async () => {
      const testBatch: MouseMovementBatch = {
        events: [
          { x: 100, y: 200, timestamp: Date.now() },
          { x: 110, y: 210, timestamp: Date.now() + 10 }
        ],
        startTime: Date.now(),
        endTime: Date.now() + 100,
        interactionContext: {
          isInteracting: false,
          interactionType: 'hover',
          lastSignificantMove: Date.now(),
          velocity: 5,
          element: null
        }
      };

      await webSocketService.broadcastMouseBatch(testBatch);

      const { SocketAPI } = await import('@sage3/frontend');
      expect(SocketAPI.sendRESTMessage).toHaveBeenCalledWith(
        '/apps/test-app-id',
        'PUT',
        expect.objectContaining({
          data: {
            state: {
              lastSyncMessage: expect.objectContaining({
                syncwebviewMessage: expect.objectContaining({
                  type: 'syncwebview-mouse-batch',
                  data: testBatch
                })
              })
            }
          }
        })
      );
    });

    it('should handle broadcast errors with retry', async () => {
      const { SocketAPI } = await import('@sage3/frontend');
      (SocketAPI.sendRESTMessage as jest.Mock)
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValueOnce({ success: true });

      const testEvent: SyncWebviewEvent = {
        id: 'test-event-id',
        timestamp: Date.now(),
        type: 'rrweb',
        data: { type: 'click' },
        userId: 'test-user-id',
        sessionId: 'test-session-id'
      };

      await webSocketService.broadcastEvent(testEvent);

      // Should have retried 3 times total
      expect(SocketAPI.sendRESTMessage).toHaveBeenCalledTimes(3);
    });
  });

  describe('message reception', () => {
    let subscriptionCallback: (message: any) => void;

    beforeEach(async () => {
      const { SocketAPI } = await import('@sage3/frontend');
      (SocketAPI.subscribe as jest.Mock).mockImplementation((route: any, callback: any) => {
        subscriptionCallback = callback;
        return () => {};
      });
      
      await webSocketService.initialize();
    });

    it('should handle incoming SyncWebview events', () => {
      const mockAppStateMessage = {
        type: 'UPDATE',
        doc: {
          _id: 'other-app-id',
          data: {
            type: 'SyncWebview',
            state: {
              lastSyncMessage: {
                timestamp: Date.now(),
                syncwebviewMessage: {
                  type: 'syncwebview-event',
                  appId: 'other-app-id',
                  userId: 'other-user-id',
                  data: {
                    id: 'test-event',
                    type: 'rrweb',
                    data: { type: 'click' }
                  }
                }
              }
            }
          }
        }
      };

      subscriptionCallback(mockAppStateMessage);

      expect(mockOnEventReceived).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'test-event',
          type: 'rrweb'
        })
      );
    });

    it('should ignore messages from the same app', () => {
      const mockAppStateMessage = {
        type: 'UPDATE',
        doc: {
          _id: 'test-app-id', // Same as our app ID
          data: {
            type: 'SyncWebview',
            state: {
              lastSyncMessage: {
                timestamp: Date.now(),
                syncwebviewMessage: {
                  type: 'syncwebview-event',
                  userId: 'test-user-id'
                }
              }
            }
          }
        }
      };

      subscriptionCallback(mockAppStateMessage);

      expect(mockOnEventReceived).not.toHaveBeenCalled();
    });

    it('should ignore messages from the same user', () => {
      const mockAppStateMessage = {
        type: 'UPDATE',
        doc: {
          _id: 'other-app-id',
          data: {
            type: 'SyncWebview',
            state: {
              lastSyncMessage: {
                timestamp: Date.now(),
                syncwebviewMessage: {
                  type: 'syncwebview-event',
                  userId: 'test-user-id' // Same as our user ID
                }
              }
            }
          }
        }
      };

      subscriptionCallback(mockAppStateMessage);

      expect(mockOnEventReceived).not.toHaveBeenCalled();
    });
  });

  describe('connection testing', () => {
    beforeEach(async () => {
      const { SocketAPI } = await import('@sage3/frontend');
      (SocketAPI.subscribe as jest.Mock).mockResolvedValue(() => {});
      (SocketAPI.sendRESTMessage as jest.Mock).mockResolvedValue({ success: true });
      
      await webSocketService.initialize();
    });

    it('should test connection successfully', async () => {
      const result = await webSocketService.testConnection();
      expect(result).toBe(true);
    });

    it('should return connection health status', () => {
      const health = webSocketService.getConnectionHealth();
      
      expect(health).toEqual({
        isConnected: true,
        lastMessageTime: expect.any(Number),
        performanceMetrics: expect.objectContaining({
          eventQueueSize: expect.any(Number),
          networkLatency: expect.any(Number),
          processingDelay: expect.any(Number),
          clientPerformance: expect.any(String)
        })
      });
    });
  });

  describe('cleanup', () => {
    it('should clean up resources properly', async () => {
      const mockUnsubscribe = jest.fn();
      const { SocketAPI } = await import('@sage3/frontend');
      (SocketAPI.subscribe as jest.Mock).mockResolvedValue(mockUnsubscribe);
      
      await webSocketService.initialize();
      webSocketService.destroy();

      expect(mockUnsubscribe).toHaveBeenCalled();
      expect(webSocketService.getIsInitialized()).toBe(false);
    });
  });
});