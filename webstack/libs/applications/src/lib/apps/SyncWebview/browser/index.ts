/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

/**
 * Browser-only barrel for SyncWebview services.
 * Import from this path in webapp code to avoid leaking browser/JSX
 * dependencies into server-side builds.
 *
 * Example:
 *   import { WebSocketService, EventRecorderService } from '@sage3/applications/apps/SyncWebview/browser';
 */
export * from '../services';
export * from '../types';
