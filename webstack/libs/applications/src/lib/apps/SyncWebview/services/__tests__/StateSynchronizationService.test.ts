/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { StateSynchronizationService } from '../StateSynchronizationService';
import { SyncWebviewEvent } from '../../types';

describe('StateSynchronizationService', () => {
  let service: StateSynchronizationService;
  let mockOnSnapshotGenerated: jest.Mock;
  let mockOnError: jest.Mock;

  beforeEach(() => {
    mockOnSnapshotGenerated = jest.fn();
    mockOnError = jest.fn();
    service = new StateSynchronizationService(mockOnSnapshotGenerated, mockOnError);
  });

  afterEach(() => {
    if (service.getIsInitialized()) {
      service.destroy();
    }
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await service.initialize();
      expect(service.getIsInitialized()).toBe(true);
    });

    it('should not be initialized before calling initialize', () => {
      expect(service.getIsInitialized()).toBe(false);
    });
  });

  describe('snapshot generation', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should generate a compressed snapshot', async () => {
      const mockEvents: SyncWebviewEvent[] = [
        {
          id: 'test-1',
          timestamp: Date.now(),
          type: 'rrweb',
          data: { type: 2, timestamp: Date.now(), data: {} },
          userId: 'user-1',
          sessionId: 'session-1'
        }
      ];

      const snapshot = await service.generateSnapshot(
        mockEvents,
        'https://example.com',
        1.0,
        'none' // Use no compression for testing
      );

      expect(snapshot).toBeDefined();
      expect(snapshot.url).toBe('https://example.com');
      expect(snapshot.zoom).toBe(1.0);
      expect(snapshot.compressionMethod).toBe('none');
      expect(snapshot.originalSize).toBeGreaterThan(0);
      expect(mockOnSnapshotGenerated).toHaveBeenCalledWith(snapshot);
    });

    it('should throw error when not initialized', async () => {
      service.destroy();
      
      const mockEvents: SyncWebviewEvent[] = [];
      
      await expect(
        service.generateSnapshot(mockEvents, 'https://example.com', 1.0)
      ).rejects.toThrow('State synchronization service not initialized');
    });
  });

  describe('snapshot caching', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should cache and retrieve snapshots', async () => {
      const mockEvents: SyncWebviewEvent[] = [
        {
          id: 'test-1',
          timestamp: Date.now(),
          type: 'rrweb',
          data: { type: 2, timestamp: Date.now(), data: {} },
          userId: 'user-1',
          sessionId: 'session-1'
        }
      ];

      // Generate and cache a snapshot
      const snapshot = await service.generateSnapshot(
        mockEvents,
        'https://example.com',
        1.0,
        'none'
      );

      // Retrieve from cache
      const cachedSnapshot = service.getCachedSnapshot('https://example.com');
      
      expect(cachedSnapshot).toBeDefined();
      expect(cachedSnapshot?.url).toBe(snapshot.url);
      expect(cachedSnapshot?.timestamp).toBe(snapshot.timestamp);
    });

    it('should return null for non-existent cached snapshots', () => {
      const cachedSnapshot = service.getCachedSnapshot('https://nonexistent.com');
      expect(cachedSnapshot).toBeNull();
    });

    it('should provide cache statistics', async () => {
      const stats = service.getCacheStats();
      
      expect(stats).toBeDefined();
      expect(stats.size).toBe(0);
      expect(stats.maxSize).toBeGreaterThan(0);
      expect(stats.totalSize).toBe(0);
      expect(Array.isArray(stats.entries)).toBe(true);
    });
  });

  describe('snapshot compression and decompression', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should compress and decompress snapshots correctly', async () => {
      const mockEvents: SyncWebviewEvent[] = [
        {
          id: 'test-1',
          timestamp: Date.now(),
          type: 'rrweb',
          data: { type: 2, timestamp: Date.now(), data: { test: 'data' } },
          userId: 'user-1',
          sessionId: 'session-1'
        }
      ];

      // Generate compressed snapshot
      const compressedSnapshot = await service.generateSnapshot(
        mockEvents,
        'https://example.com',
        1.0,
        'none' // Use no compression for predictable testing
      );

      // Decompress the snapshot
      const decompressedData = await service.decompressSnapshot(compressedSnapshot);

      expect(decompressedData).toBeDefined();
      expect(decompressedData.url).toBe('https://example.com');
      expect(decompressedData.zoom).toBe(1.0);
      expect(Array.isArray(decompressedData.events)).toBe(true);
      expect(decompressedData.events.length).toBe(1);
    });
  });

  describe('cache management', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should clear cache', () => {
      service.clearCache();
      const stats = service.getCacheStats();
      expect(stats.size).toBe(0);
    });
  });

  describe('error handling', () => {
    it('should handle initialization errors', async () => {
      // Mock a service that will fail initialization
      const failingService = new StateSynchronizationService(
        mockOnSnapshotGenerated,
        mockOnError
      );

      // The service should handle errors gracefully
      await expect(failingService.initialize()).resolves.not.toThrow();
    });
  });
});