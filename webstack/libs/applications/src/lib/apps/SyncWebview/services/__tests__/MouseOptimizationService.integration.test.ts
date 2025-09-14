/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { MouseOptimizationService } from '../MouseOptimizationService';

describe('MouseOptimizationService Integration Tests', () => {
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

  describe('real-world scenarios', () => {
    it('should handle webview elements that might not have standard DOM methods', () => {
      // Simulate a webview element that might have limited DOM API
      const webviewElement = {
        tagName: 'WEBVIEW',
        // Missing matches method - this was causing the original error
      };

      expect(() => {
        // This should not throw the "element.matches is not a function" error
        const strategy = (service as any).getElementMouseStrategy(webviewElement);
        expect(strategy).toBe('standard');
      }).not.toThrow();
    });

    it('should handle text nodes and other non-element targets', () => {
      // Text nodes don't have matches method
      const textNode = {
        nodeType: 3, // TEXT_NODE
        textContent: 'Some text',
        // No tagName, no matches method
      };

      expect(() => {
        const strategy = (service as any).getElementMouseStrategy(textNode);
        expect(strategy).toBe('standard');
      }).not.toThrow();
    });

    it('should handle elements with broken matches method', () => {
      const brokenElement = {
        tagName: 'DIV',
        matches: () => {
          throw new Error('Broken matches implementation');
        },
        hasAttribute: jest.fn(() => false),
        classList: { contains: jest.fn(() => false) },
      };

      expect(() => {
        const strategy = (service as any).getElementMouseStrategy(brokenElement);
        expect(strategy).toBe('standard');
      }).not.toThrow();
    });

    it('should properly identify canvas elements when matches works', () => {
      const canvasElement = {
        tagName: 'CANVAS',
        matches: jest.fn((selector) => selector === 'canvas, svg'),
        hasAttribute: jest.fn(() => false),
        classList: { contains: jest.fn(() => false) },
      };

      const strategy = (service as any).getElementMouseStrategy(canvasElement);
      expect(strategy).toBe('high-fidelity');
      expect(canvasElement.matches).toHaveBeenCalledWith('canvas, svg');
    });
  });
});