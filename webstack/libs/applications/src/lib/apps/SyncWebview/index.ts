/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

/**
 * SAGE3 application: SyncWebview
 * created by: SAGE3 Team
 */

import { z } from 'zod';

export const schema = z.object({
  url: z.string().url(),
  isRecording: z.boolean().default(false),
  isReplaying: z.boolean().default(false),
  lastEventTimestamp: z.number().default(0),
  zoom: z.number().default(1.0),
  connectionStatus: z.enum(['disconnected', 'connecting', 'connected']).default('disconnected'),
  recordingError: z.string().nullable().default(null),
  privacy: z.object({
    maskPasswords: z.boolean().default(true),
    maskElements: z.array(z.string()).default([]),
  }).default({}),
  lastSyncMessage: z.object({
    syncwebviewMessage: z.any(),
    timestamp: z.number(),
  }).optional(),
  snapshotCache: z.object({
    lastSnapshotTimestamp: z.number().default(0),
    cacheSize: z.number().default(0),
    compressionRatio: z.number().default(0),
  }).default({}),
  navigation: z.object({
    canGoBack: z.boolean().default(false),
    canGoForward: z.boolean().default(false),
    currentIndex: z.number().default(0),
    history: z.array(z.string()).default([]),
  }).default({}),
});

export type state = z.infer<typeof schema>;

export const init: Partial<state> = {
  url: 'https://example.com/',
  isRecording: true, // Auto-start recording with stable rrweb version
  isReplaying: false,
  lastEventTimestamp: 0,
  zoom: 1.0,
  connectionStatus: 'disconnected',
  recordingError: null,
  privacy: {
    maskPasswords: true,
    maskElements: [],
  },
  snapshotCache: {
    lastSnapshotTimestamp: 0,
    cacheSize: 0,
    compressionRatio: 0,
  },
  navigation: {
    canGoBack: false,
    canGoForward: false,
    currentIndex: 0,
    history: ['https://example.com/'],
  },
};

export const name = 'SyncWebview';

// Export services for external use
export * from './services';
export * from './types';