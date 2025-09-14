# SyncWebview Application

SyncWebview is a SAGE3 application that enables synchronized web browsing across multiple clients using rrweb (record and replay web) technology. It allows users to share their web browsing experience in real-time with other participants.

## Architecture Overview

### Core Components

1. **EventRecorderService**: Records user interactions using rrweb
2. **EventReplayService**: Replays events from other clients
3. **WebSocketService**: Handles real-time communication between clients
4. **WorkerManagerService**: Optimizes event processing using Web Workers
5. **MouseOptimizationService**: Optimizes mouse movement events

### WebSocket Communication

The WebSocket communication uses SAGE3's existing application state subscription system rather than custom WebSocket routes. This approach:

- **No Backend Changes**: Uses SAGE3's existing infrastructure
- **Automatic Broadcasting**: Leverages SAGE3's app state system for message distribution
- **Built-in Error Handling**: Includes retry logic and reconnection
- **Echo Prevention**: Filters out messages from the same user/app
- **Message Deduplication**: Timestamp-based filtering

#### Message Flow

1. Client A records an rrweb event
2. Client A updates its app state with `lastSyncMessage` containing the event
3. SAGE3 automatically broadcasts this state change to all other clients
4. Client B receives the state update and extracts the sync message
5. Client B replays the event using rrweb

#### Message Types

- `syncwebview-event`: rrweb events (clicks, scrolls, etc.)
- `syncwebview-snapshot`: DOM snapshots for state synchronization
- `syncwebview-request-snapshot`: Request for current DOM state
- `syncwebview-mouse-batch`: Optimized mouse movement batches
- `syncwebview-mouse-interaction`: Mouse interaction states

### State Management

The application state includes:

```typescript
{
  url: string;                    // Current URL
  isRecording: boolean;           // Recording status
  isReplaying: boolean;           // Replay status
  lastEventTimestamp: number;     // Last sync event time
  zoom: number;                   // Zoom level
  privacy: {                      // Privacy settings
    maskPasswords: boolean;
    maskElements: string[];
  };
  lastSyncMessage?: {             // Latest sync message
    syncwebviewMessage: any;
    timestamp: number;
  };
}
```

## Usage

### Basic Usage

1. Create a SyncWebview application in SAGE3
2. Navigate to a website using the URL input
3. Recording starts automatically when the webview loads
4. Other clients with SyncWebview will see your interactions in real-time

### Privacy Controls

- **Password Masking**: Toggle to hide/show password fields during recording
- **Element Masking**: Configure specific elements to be masked

### Zoom Controls

- **Zoom In/Out**: Adjust the zoom level of the webview
- **Reset Zoom**: Return to 100% zoom

## Testing

The WebSocket communication is thoroughly tested using Jest:

```bash
# Run WebSocket service tests
npx jest --config libs/applications/jest.config.js --testPathPatterns=WebSocketService
```

Tests cover:
- Service initialization and cleanup
- Message broadcasting and reception
- Error handling and retry logic
- Connection health monitoring
- Echo prevention and message deduplication

## Performance Considerations

### Event Optimization

- **Mouse Movement Batching**: Groups mouse movements to reduce network traffic
- **Web Worker Processing**: Offloads event processing to prevent UI blocking
- **Adaptive Sampling**: Adjusts event frequency based on performance

### Network Optimization

- **Retry Logic**: Exponential backoff for failed message sends
- **Message Deduplication**: Prevents processing duplicate events
- **Connection Health Monitoring**: Tracks performance metrics

## Browser Compatibility

- **Electron**: Full functionality with webview support
- **Web Browsers**: Limited to external link opening (no embedded browsing)

## Security Considerations

- **Partition Isolation**: Each SyncWebview instance uses a separate Electron partition
- **Privacy Controls**: Built-in password masking and element hiding
- **Content Security**: Webview runs in isolated context

## Future Enhancements

- **Selective Sync**: Allow users to choose which events to sync
- **Bandwidth Optimization**: Further compression of event data
- **Multi-tab Support**: Support for multiple browser tabs
- **Advanced Privacy**: More granular privacy controls