/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { SyncWebviewEvent } from '../types';

/**
 * Compressed snapshot data structure
 */
export interface CompressedSnapshot {
  data: string; // Compressed snapshot data
  timestamp: number;
  url: string;
  zoom: number;
  compressionMethod: 'gzip' | 'lz4' | 'none';
  originalSize: number;
  compressedSize: number;
}

/**
 * Snapshot cache entry
 */
export interface SnapshotCacheEntry {
  snapshot: CompressedSnapshot;
  createdAt: number;
  lastAccessed: number;
  accessCount: number;
}

/**
 * State synchronization service for SyncWebview
 * Handles DOM snapshot generation, compression, and caching for new participants
 */
export class StateSynchronizationService {
  private snapshotCache: Map<string, SnapshotCacheEntry> = new Map();
  private maxCacheSize: number = 5; // Maximum number of cached snapshots
  private maxCacheAge: number = 300000; // 5 minutes in milliseconds
  private compressionWorker: Worker | null = null;
  private isInitialized: boolean = false;

  constructor(
    private onSnapshotGenerated: (snapshot: CompressedSnapshot) => void,
    private onError: (error: Error) => void
  ) {}

  /**
   * Initialize the state synchronization service
   */
  async initialize(): Promise<void> {
    try {
      // Initialize compression worker for background processing
      await this.initializeCompressionWorker();
      
      // Set up periodic cache cleanup
      this.setupCacheCleanup();
      
      this.isInitialized = true;
      console.log('SyncWebview: State synchronization service initialized');
    } catch (error) {
      console.error('SyncWebview: Failed to initialize state synchronization service:', error);
      this.onError(new Error('Failed to initialize state synchronization service'));
      throw error;
    }
  }

  /**
   * Generate a DOM snapshot for late joiners
   */
  async generateSnapshot(
    events: SyncWebviewEvent[],
    url: string,
    zoom: number,
    compressionMethod: 'gzip' | 'lz4' | 'none' = 'gzip'
  ): Promise<CompressedSnapshot> {
    if (!this.isInitialized) {
      throw new Error('State synchronization service not initialized');
    }

    try {
      // Create snapshot data structure
      const snapshotData = {
        events: events.map(event => event.data), // Extract rrweb events
        url,
        zoom,
        timestamp: Date.now(),
        metadata: {
          eventCount: events.length,
          generatedBy: 'StateSynchronizationService',
          version: '1.0'
        }
      };

      // Serialize snapshot data
      const serializedData = JSON.stringify(snapshotData);
      const originalSize = new Blob([serializedData]).size;

      // Compress the snapshot
      const compressedData = await this.compressData(serializedData, compressionMethod);
      const compressedSize = new Blob([compressedData]).size;

      const compressedSnapshot: CompressedSnapshot = {
        data: compressedData,
        timestamp: Date.now(),
        url,
        zoom,
        compressionMethod,
        originalSize,
        compressedSize
      };

      // Cache the snapshot
      await this.cacheSnapshot(compressedSnapshot);

      console.log(`SyncWebview: Generated compressed snapshot (${originalSize} -> ${compressedSize} bytes, ${Math.round((1 - compressedSize / originalSize) * 100)}% reduction)`);
      
      this.onSnapshotGenerated(compressedSnapshot);
      return compressedSnapshot;
    } catch (error) {
      console.error('SyncWebview: Failed to generate snapshot:', error);
      this.onError(new Error('Failed to generate DOM snapshot'));
      throw error;
    }
  }

  /**
   * Decompress and parse a snapshot
   */
  async decompressSnapshot(compressedSnapshot: CompressedSnapshot): Promise<{
    events: any[];
    url: string;
    zoom: number;
    timestamp: number;
    metadata?: any;
  }> {
    try {
      // Decompress the data
      const decompressedData = await this.decompressData(
        compressedSnapshot.data,
        compressedSnapshot.compressionMethod
      );

      // Parse the JSON data
      const snapshotData = JSON.parse(decompressedData);

      // Validate the snapshot structure
      if (!this.validateSnapshotData(snapshotData)) {
        throw new Error('Invalid snapshot data structure');
      }

      console.log(`SyncWebview: Decompressed snapshot with ${snapshotData.events?.length || 0} events`);
      
      return {
        events: snapshotData.events || [],
        url: snapshotData.url || compressedSnapshot.url,
        zoom: snapshotData.zoom || compressedSnapshot.zoom,
        timestamp: snapshotData.timestamp || compressedSnapshot.timestamp,
        metadata: snapshotData.metadata
      };
    } catch (error) {
      console.error('SyncWebview: Failed to decompress snapshot:', error);
      this.onError(new Error('Failed to decompress snapshot'));
      throw error;
    }
  }

  /**
   * Cache a snapshot for future use
   */
  async cacheSnapshot(snapshot: CompressedSnapshot): Promise<void> {
    try {
      const cacheKey = this.generateCacheKey(snapshot.url, snapshot.timestamp);
      
      const cacheEntry: SnapshotCacheEntry = {
        snapshot,
        createdAt: Date.now(),
        lastAccessed: Date.now(),
        accessCount: 0
      };

      // Add to cache
      this.snapshotCache.set(cacheKey, cacheEntry);

      // Enforce cache size limit
      await this.enforceCacheLimit();

      console.log(`SyncWebview: Cached snapshot with key: ${cacheKey}`);
    } catch (error) {
      console.error('SyncWebview: Failed to cache snapshot:', error);
      // Don't throw here as caching is not critical
    }
  }

  /**
   * Retrieve a cached snapshot
   */
  getCachedSnapshot(url: string, maxAge: number = this.maxCacheAge): CompressedSnapshot | null {
    try {
      const now = Date.now();
      
      // Find the most recent snapshot for the URL that's not too old
      let bestMatch: SnapshotCacheEntry | null = null;
      let bestMatchKey: string | null = null;

      for (const [key, entry] of this.snapshotCache.entries()) {
        if (entry.snapshot.url === url && (now - entry.createdAt) <= maxAge) {
          if (!bestMatch || entry.createdAt > bestMatch.createdAt) {
            bestMatch = entry;
            bestMatchKey = key;
          }
        }
      }

      if (bestMatch && bestMatchKey) {
        // Update access statistics
        bestMatch.lastAccessed = now;
        bestMatch.accessCount++;
        
        console.log(`SyncWebview: Retrieved cached snapshot for URL: ${url}`);
        return bestMatch.snapshot;
      }

      return null;
    } catch (error) {
      console.error('SyncWebview: Failed to retrieve cached snapshot:', error);
      return null;
    }
  }

  /**
   * Clear all cached snapshots
   */
  clearCache(): void {
    this.snapshotCache.clear();
    console.log('SyncWebview: Snapshot cache cleared');
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    maxSize: number;
    totalSize: number;
    entries: Array<{
      url: string;
      timestamp: number;
      size: number;
      accessCount: number;
      age: number;
    }>;
  } {
    const now = Date.now();
    let totalSize = 0;
    const entries: Array<{
      url: string;
      timestamp: number;
      size: number;
      accessCount: number;
      age: number;
    }> = [];

    for (const [key, entry] of this.snapshotCache.entries()) {
      const size = entry.snapshot.compressedSize;
      totalSize += size;
      
      entries.push({
        url: entry.snapshot.url,
        timestamp: entry.snapshot.timestamp,
        size,
        accessCount: entry.accessCount,
        age: now - entry.createdAt
      });
    }

    return {
      size: this.snapshotCache.size,
      maxSize: this.maxCacheSize,
      totalSize,
      entries: entries.sort((a, b) => b.timestamp - a.timestamp)
    };
  }

  /**
   * Initialize compression worker for background processing
   */
  private async initializeCompressionWorker(): Promise<void> {
    try {
      // Create a simple compression worker using built-in compression
      // For now, we'll use synchronous compression but this could be moved to a worker
      console.log('SyncWebview: Compression worker initialized (synchronous mode)');
    } catch (error) {
      console.warn('SyncWebview: Failed to initialize compression worker, using synchronous compression:', error);
      // Continue without worker - compression will be synchronous
    }
  }

  /**
   * Compress data using the specified method
   */
  private async compressData(data: string, method: 'gzip' | 'lz4' | 'none'): Promise<string> {
    switch (method) {
      case 'gzip':
        return await this.compressWithGzip(data);
      case 'lz4':
        // LZ4 compression would require additional library
        console.warn('SyncWebview: LZ4 compression not implemented, falling back to gzip');
        return await this.compressWithGzip(data);
      case 'none':
        return data;
      default:
        throw new Error(`Unsupported compression method: ${method}`);
    }
  }

  /**
   * Decompress data using the specified method
   */
  private async decompressData(data: string, method: 'gzip' | 'lz4' | 'none'): Promise<string> {
    switch (method) {
      case 'gzip':
        return await this.decompressWithGzip(data);
      case 'lz4':
        // LZ4 decompression would require additional library
        console.warn('SyncWebview: LZ4 decompression not implemented, falling back to gzip');
        return await this.decompressWithGzip(data);
      case 'none':
        return data;
      default:
        throw new Error(`Unsupported compression method: ${method}`);
    }
  }

  /**
   * Compress data using gzip (browser-compatible implementation)
   */
  private async compressWithGzip(data: string): Promise<string> {
    try {
      // Use CompressionStream if available (modern browsers)
      if (typeof CompressionStream !== 'undefined') {
        const stream = new CompressionStream('gzip');
        const writer = stream.writable.getWriter();
        const reader = stream.readable.getReader();
        
        // Write data to compression stream
        await writer.write(new TextEncoder().encode(data));
        await writer.close();
        
        // Read compressed data
        const chunks: Uint8Array[] = [];
        let done = false;
        
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            chunks.push(value);
          }
        }
        
        // Convert to base64 string for storage
        const compressed = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          compressed.set(chunk, offset);
          offset += chunk.length;
        }
        
        return btoa(String.fromCharCode(...compressed));
      } else {
        // Fallback: simple base64 encoding (not actual compression)
        console.warn('SyncWebview: CompressionStream not available, using base64 encoding');
        return btoa(data);
      }
    } catch (error) {
      console.warn('SyncWebview: Gzip compression failed, using uncompressed data:', error);
      return data;
    }
  }

  /**
   * Decompress gzip data
   */
  private async decompressWithGzip(data: string): Promise<string> {
    try {
      // Use DecompressionStream if available (modern browsers)
      if (typeof DecompressionStream !== 'undefined') {
        // Convert from base64
        const binaryString = atob(data);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        
        const stream = new DecompressionStream('gzip');
        const writer = stream.writable.getWriter();
        const reader = stream.readable.getReader();
        
        // Write compressed data to decompression stream
        await writer.write(bytes);
        await writer.close();
        
        // Read decompressed data
        const chunks: Uint8Array[] = [];
        let done = false;
        
        while (!done) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            chunks.push(value);
          }
        }
        
        // Convert back to string
        const decompressed = new Uint8Array(chunks.reduce((acc, chunk) => acc + chunk.length, 0));
        let offset = 0;
        for (const chunk of chunks) {
          decompressed.set(chunk, offset);
          offset += chunk.length;
        }
        
        return new TextDecoder().decode(decompressed);
      } else {
        // Fallback: assume it's base64 encoded
        console.warn('SyncWebview: DecompressionStream not available, using base64 decoding');
        return atob(data);
      }
    } catch (error) {
      console.warn('SyncWebview: Gzip decompression failed, treating as uncompressed:', error);
      return data;
    }
  }

  /**
   * Validate snapshot data structure
   */
  private validateSnapshotData(data: any): boolean {
    if (!data || typeof data !== 'object') {
      return false;
    }

    // Check required fields
    if (!Array.isArray(data.events)) {
      return false;
    }

    if (typeof data.url !== 'string' || typeof data.timestamp !== 'number') {
      return false;
    }

    return true;
  }

  /**
   * Generate cache key for snapshot
   */
  private generateCacheKey(url: string, timestamp: number): string {
    return `${url}_${timestamp}`;
  }

  /**
   * Enforce cache size limit by removing oldest entries
   */
  private async enforceCacheLimit(): Promise<void> {
    if (this.snapshotCache.size <= this.maxCacheSize) {
      return;
    }

    // Sort entries by last accessed time (oldest first)
    const entries = Array.from(this.snapshotCache.entries()).sort(
      ([, a], [, b]) => a.lastAccessed - b.lastAccessed
    );

    // Remove oldest entries until we're under the limit
    const entriesToRemove = entries.slice(0, this.snapshotCache.size - this.maxCacheSize);
    
    for (const [key] of entriesToRemove) {
      this.snapshotCache.delete(key);
      console.log(`SyncWebview: Removed cached snapshot: ${key}`);
    }
  }

  /**
   * Set up periodic cache cleanup
   */
  private setupCacheCleanup(): void {
    // Clean up expired entries every 5 minutes
    setInterval(() => {
      this.cleanupExpiredEntries();
    }, 300000);
  }

  /**
   * Clean up expired cache entries
   */
  private cleanupExpiredEntries(): void {
    const now = Date.now();
    const expiredKeys: string[] = [];

    for (const [key, entry] of this.snapshotCache.entries()) {
      if (now - entry.createdAt > this.maxCacheAge) {
        expiredKeys.push(key);
      }
    }

    for (const key of expiredKeys) {
      this.snapshotCache.delete(key);
      console.log(`SyncWebview: Removed expired cached snapshot: ${key}`);
    }

    if (expiredKeys.length > 0) {
      console.log(`SyncWebview: Cleaned up ${expiredKeys.length} expired cache entries`);
    }
  }

  /**
   * Get initialization status
   */
  getIsInitialized(): boolean {
    return this.isInitialized;
  }

  /**
   * Destroy the service and clean up resources
   */
  destroy(): void {
    if (this.compressionWorker) {
      this.compressionWorker.terminate();
      this.compressionWorker = null;
    }

    this.clearCache();
    this.isInitialized = false;

    console.log('SyncWebview: State synchronization service destroyed');
  }
}