import '@testing-library/jest-dom';

// Mock DOM methods that might not be available in jsdom
Object.defineProperty(window, 'getComputedStyle', {
  value: () => ({
    cursor: 'default',
    getPropertyValue: () => '',
  }),
});

// Mock document methods
Object.defineProperty(document, 'addEventListener', {
  value: jest.fn(),
});

Object.defineProperty(document, 'removeEventListener', {
  value: jest.fn(),
});

// Mock performance API
Object.defineProperty(window, 'performance', {
  value: {
    now: jest.fn(() => Date.now()),
  },
});

// Mock URL.createObjectURL and revokeObjectURL
Object.defineProperty(URL, 'createObjectURL', {
  value: jest.fn(() => 'mock-url'),
});

Object.defineProperty(URL, 'revokeObjectURL', {
  value: jest.fn(),
});

// Mock Worker
Object.defineProperty(window, 'Worker', {
  value: class MockWorker {
    constructor(url: string) {
      // Mock worker implementation
    }
    postMessage = jest.fn();
    terminate = jest.fn();
    onmessage = null;
    onerror = null;
    onmessageerror = null;
  },
});