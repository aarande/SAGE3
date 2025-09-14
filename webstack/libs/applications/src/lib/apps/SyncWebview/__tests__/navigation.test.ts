/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { NavigationEvent, NavigationState } from '../types';

describe('SyncWebview Navigation', () => {
  describe('NavigationEvent', () => {
    it('should create a valid navigation event', () => {
      const navigationEvent: NavigationEvent = {
        type: 'navigate',
        url: 'https://example.com',
        timestamp: Date.now(),
        userId: 'user123',
        sessionId: 'session123'
      };

      expect(navigationEvent.type).toBe('navigate');
      expect(navigationEvent.url).toBe('https://example.com');
      expect(navigationEvent.userId).toBe('user123');
      expect(navigationEvent.sessionId).toBe('session123');
      expect(typeof navigationEvent.timestamp).toBe('number');
    });

    it('should create back navigation event', () => {
      const navigationEvent: NavigationEvent = {
        type: 'back',
        timestamp: Date.now(),
        userId: 'user123',
        sessionId: 'session123'
      };

      expect(navigationEvent.type).toBe('back');
      expect(navigationEvent.url).toBeUndefined();
    });

    it('should create forward navigation event', () => {
      const navigationEvent: NavigationEvent = {
        type: 'forward',
        timestamp: Date.now(),
        userId: 'user123',
        sessionId: 'session123'
      };

      expect(navigationEvent.type).toBe('forward');
      expect(navigationEvent.url).toBeUndefined();
    });

    it('should create refresh navigation event', () => {
      const navigationEvent: NavigationEvent = {
        type: 'refresh',
        timestamp: Date.now(),
        userId: 'user123',
        sessionId: 'session123'
      };

      expect(navigationEvent.type).toBe('refresh');
      expect(navigationEvent.url).toBeUndefined();
    });
  });

  describe('NavigationState', () => {
    it('should create a valid navigation state', () => {
      const navigationState: NavigationState = {
        canGoBack: true,
        canGoForward: false,
        currentIndex: 2,
        history: ['https://example.com', 'https://google.com', 'https://github.com']
      };

      expect(navigationState.canGoBack).toBe(true);
      expect(navigationState.canGoForward).toBe(false);
      expect(navigationState.currentIndex).toBe(2);
      expect(navigationState.history).toHaveLength(3);
      expect(navigationState.history[navigationState.currentIndex]).toBe('https://github.com');
    });

    it('should handle empty history', () => {
      const navigationState: NavigationState = {
        canGoBack: false,
        canGoForward: false,
        currentIndex: 0,
        history: ['https://example.com']
      };

      expect(navigationState.canGoBack).toBe(false);
      expect(navigationState.canGoForward).toBe(false);
      expect(navigationState.currentIndex).toBe(0);
      expect(navigationState.history).toHaveLength(1);
    });
  });

  describe('Navigation Logic', () => {
    it('should correctly determine canGoBack state', () => {
      const history = ['https://example.com', 'https://google.com', 'https://github.com'];
      
      // At first page
      let currentIndex = 0;
      let canGoBack = currentIndex > 0;
      expect(canGoBack).toBe(false);

      // At middle page
      currentIndex = 1;
      canGoBack = currentIndex > 0;
      expect(canGoBack).toBe(true);

      // At last page
      currentIndex = 2;
      canGoBack = currentIndex > 0;
      expect(canGoBack).toBe(true);
    });

    it('should correctly determine canGoForward state', () => {
      const history = ['https://example.com', 'https://google.com', 'https://github.com'];
      
      // At first page
      let currentIndex = 0;
      let canGoForward = currentIndex < history.length - 1;
      expect(canGoForward).toBe(true);

      // At middle page
      currentIndex = 1;
      canGoForward = currentIndex < history.length - 1;
      expect(canGoForward).toBe(true);

      // At last page
      currentIndex = 2;
      canGoForward = currentIndex < history.length - 1;
      expect(canGoForward).toBe(false);
    });

    it('should handle navigation history updates correctly', () => {
      let history = ['https://example.com'];
      let currentIndex = 0;

      // Navigate to new URL
      const newUrl = 'https://google.com';
      history = [...history.slice(0, currentIndex + 1), newUrl];
      currentIndex = history.length - 1;

      expect(history).toEqual(['https://example.com', 'https://google.com']);
      expect(currentIndex).toBe(1);

      // Navigate to another URL (should remove forward history)
      const anotherUrl = 'https://github.com';
      history = [...history.slice(0, currentIndex + 1), anotherUrl];
      currentIndex = history.length - 1;

      expect(history).toEqual(['https://example.com', 'https://google.com', 'https://github.com']);
      expect(currentIndex).toBe(2);
    });

    it('should handle navigation with forward history removal', () => {
      let history = ['https://example.com', 'https://google.com', 'https://github.com'];
      let currentIndex = 1; // At google.com

      // Navigate to new URL (should remove github.com from history)
      const newUrl = 'https://stackoverflow.com';
      history = [...history.slice(0, currentIndex + 1), newUrl];
      currentIndex = history.length - 1;

      expect(history).toEqual(['https://example.com', 'https://google.com', 'https://stackoverflow.com']);
      expect(currentIndex).toBe(2);
    });
  });
});