/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { useRef, useState, useCallback, useEffect } from 'react';
import { useParams } from 'react-router';

import { 
  Button, 
  ButtonGroup, 
  Tooltip, 
  Input, 
  InputGroup, 
  HStack, 
  useToast, 
  useDisclosure,
  Box,
  Text
} from '@chakra-ui/react';
import {
  MdArrowBack,
  MdArrowForward,
  MdRefresh,
  MdAdd,
  MdRemove,
  MdOutlineSubdirectoryArrowLeft,
  MdOpenInNew,
  MdCopyAll,
  MdPlayArrow,
  MdStop,
  MdRadioButtonChecked,
  MdSync,
  MdSecurity,
} from 'react-icons/md';

import { useAppStore, useUser, processContentURL, useHexColor, useUIStore, useWindowResize } from '@sage3/frontend';
import { App } from '../../schema';
import { state as AppState } from './index';
import { AppWindow, ElectronRequired } from '../../components';
import { SyncWebviewEvent, SyncWebviewWebSocketMessage, MouseMovementBatch, MouseInteractionState } from './types';
import { EventRecorderService } from './services/EventRecorderService';
import { WorkerManagerService } from './services/WorkerManagerService';
import { WebSocketService } from './services/WebSocketService';
import { EventReplayService } from './services/EventReplayService';

// Electron webview type
// @ts-ignore
import { WebviewTag } from 'electron';

/**
 * Check if browser is Electron based on the userAgent.
 * @returns {boolean}
 */
function isElectron(): boolean {
  return typeof navigator === 'object' && typeof navigator.userAgent === 'string' && navigator.userAgent.includes('Electron');
}

/* App component for SyncWebview */

function AppComponent(props: App): JSX.Element {
  // App State
  const s = props.data.state as AppState;
  const update = useAppStore((state) => state.update);
  const updateState = useAppStore((state) => state.updateState);

  // Local State
  const webviewRef = useRef<WebviewTag>();
  const [url, setUrl] = useState<string>(s.url);
  const [isRecording, setIsRecording] = useState<boolean>(s.isRecording);
  const [isReplaying, setIsReplaying] = useState<boolean>(s.isReplaying);
  const [zoom, setZoom] = useState<number>(s.zoom);

  // rrweb Services
  const recorderServiceRef = useRef<EventRecorderService | null>(null);
  const workerManagerRef = useRef<WorkerManagerService | null>(null);
  const webSocketServiceRef = useRef<WebSocketService | null>(null);
  const replayServiceRef = useRef<EventReplayService | null>(null);

  // UI
  const boardDragging = useUIStore((state) => state.boardDragging);

  // User and board info
  const { boardId, roomId } = useParams();
  const { user } = useUser();

  // Toast for notifications
  const toast = useToast();

  // Tracking the dom-ready and did-load events
  const [domReady, setDomReady] = useState(false);
  const [attached, setAttached] = useState(false);

  // Update local state when app state changes
  useEffect(() => {
    setUrl(s.url);
    setIsRecording(s.isRecording);
    setIsReplaying(s.isReplaying);
    setZoom(s.zoom);
  }, [s.url, s.isRecording, s.isReplaying, s.zoom]);

  // Initialize rrweb services
  useEffect(() => {
    if (!isElectron()) return; // Only initialize in Electron

    const initializeServices = async () => {
      try {
        updateState(props._id, { connectionStatus: 'connecting' });

        // Initialize WebSocket Service first
        const webSocketService = new WebSocketService(
          props._id,
          user?._id || 'anonymous',
          boardId || 'unknown',
          handleEventReceived,
          handleSnapshotReceived,
          handleMouseBatchReceived,
          handleMouseInteractionReceived,
          handleWebSocketError,
          handleSnapshotRequested
        );
        await webSocketService.initialize();
        webSocketServiceRef.current = webSocketService;

        // Initialize Event Replay Service
        const replayService = new EventReplayService(
          handleReplayError,
          handleReplayComplete
        );
        // We'll initialize this when we have a target element
        replayServiceRef.current = replayService;

        // Initialize Worker Manager
        const workerManager = new WorkerManagerService(
          handleRecordedEvent,
          handleEventBatch,
          handleWorkerError
        );
        await workerManager.initialize();
        workerManagerRef.current = workerManager;

        // Initialize Event Recorder with mouse optimization callbacks
        const recorder = new EventRecorderService(
          handleRecordedEvent,
          user?.data.name || 'anonymous',
          props._id, // Use app ID as session ID
          handleMouseBatch,
          handleMouseInteraction
        );
        recorderServiceRef.current = recorder;

        updateState(props._id, { connectionStatus: 'connected' });
        console.log('SyncWebview: All services initialized');
      } catch (error) {
        console.error('SyncWebview: Failed to initialize services:', error);
        updateState(props._id, { 
          recordingError: 'Failed to initialize services',
          connectionStatus: 'disconnected'
        });
        toast({
          title: 'Initialization Error',
          description: 'Failed to initialize SyncWebview services',
          status: 'error',
          duration: 5000,
        });
      }
    };

    initializeServices();

    // Cleanup on unmount
    return () => {
      if (recorderServiceRef.current) {
        recorderServiceRef.current.stopRecording();
      }
      if (workerManagerRef.current) {
        workerManagerRef.current.terminate();
      }
      if (webSocketServiceRef.current) {
        webSocketServiceRef.current.destroy();
      }
      if (replayServiceRef.current) {
        replayServiceRef.current.stopReplaying();
      }
    };
  }, [props._id, user?._id, user?.data.name, boardId, toast]);

  // Auto-start recording and replay when webview is ready
  useEffect(() => {
    if (!recorderServiceRef.current || !isElectron() || !domReady || !attached || !webviewRef.current) return;

    const initializeRecordingAndReplay = async () => {
      try {
        // Initialize replay service with webview as target
        if (replayServiceRef.current && !replayServiceRef.current.getIsReplaying()) {
          await replayServiceRef.current.initialize(webviewRef.current!);
          
          // Request snapshot from other clients if this is a late joiner
          if (webSocketServiceRef.current && webSocketServiceRef.current.getIsInitialized()) {
            await webSocketServiceRef.current.requestSnapshot();
          }
          
          // Start replaying
          await replayServiceRef.current.startReplaying();
          updateState(props._id, { isReplaying: true });
        }

        // Start recording automatically when webview is ready
        if (recorderServiceRef.current && !recorderServiceRef.current.getIsRecording()) {
          // Add a small delay to ensure webview is fully loaded
          setTimeout(() => {
            if (recorderServiceRef.current && !recorderServiceRef.current.getIsRecording()) {
              recorderServiceRef.current.startRecording({
                maskInputOptions: {
                  password: s.privacy.maskPasswords,
                },
              });
              // Update state to reflect that recording has started and clear any errors
              updateState(props._id, { 
                isRecording: true,
                recordingError: null
              });
              console.log('SyncWebview: Auto-started recording and replay');
            }
          }, 1000); // 1 second delay
        }
      } catch (error) {
        console.error('SyncWebview: Failed to initialize recording and replay:', error);
        updateState(props._id, { 
          recordingError: 'Failed to start recording and replay',
          isRecording: false, 
          isReplaying: false 
        });
      }
    };

    initializeRecordingAndReplay();
  }, [domReady, attached, s.privacy.maskPasswords, props._id, updateState]);



  // Handle privacy settings changes
  useEffect(() => {
    if (recorderServiceRef.current) {
      recorderServiceRef.current.updatePrivacySettings(
        s.privacy.maskPasswords,
        s.privacy.maskElements
      );
    }
  }, [s.privacy.maskPasswords, s.privacy.maskElements]);

  // Init the webview (Electron only)
  const setWebviewRef = useCallback((node: WebviewTag) => {
    // event did-attach callback
    const didAttachCallback = (evt: any) => {
      webviewRef.current?.removeEventListener('did-attach', didAttachCallback);
      setAttached(true);
    };

    // event dom-ready callback
    const domReadyCallback = (evt: any) => {
      webviewRef.current?.removeEventListener('dom-ready', domReadyCallback);
      setDomReady(true);
    };

    if (node) {
      webviewRef.current = node;
      const webview = webviewRef.current;

      // Set partition for isolation
      webview.partition = 'persist:syncwebview_' + props._id;

      // Callback when the webview is ready
      webview.addEventListener('dom-ready', domReadyCallback);
      webview.addEventListener('did-attach', didAttachCallback);

      const titleUpdated = (event: any) => {
        // Update the app title
        update(props._id, { title: event.title });
      };
      webview.addEventListener('page-title-updated', titleUpdated);

      // After the partition has been set, you can navigate
      webview.src = url;
    }
  }, [props._id, update, url]);

  // Load URL in webview (Electron only)
  const loadURL = useCallback((newUrl: string) => {
    if (domReady === false || attached === false) return;
    if (webviewRef.current) {
      try {
        webviewRef.current.stop();
        webviewRef.current.loadURL(newUrl).catch((err: any) => {
          console.log('SyncWebview> Error loading URL:', newUrl, err);
          if (err.code === 'ERR_ABORTED') return;
          toast({
            title: 'Error loading URL',
            description: 'Failed to load the specified URL',
            status: 'error',
            duration: 3000,
          });
        });
        setUrl(newUrl);
      } catch (error) {
        console.error('SyncWebview> Error loading URL:', newUrl, error);
        toast({
          title: 'Error loading URL',
          description: 'Failed to load the specified URL',
          status: 'error',
          duration: 3000,
        });
      }
    }
  }, [domReady, attached, toast]);

  // Update to URL from backend
  useEffect(() => {
    if (s.url !== url) {
      if (isElectron()) {
        loadURL(s.url);
      }
      setUrl(s.url);
    }
  }, [s.url, url, loadURL]);

  // Set zoom when it changes
  useEffect(() => {
    if (domReady === false || attached === false) return;
    if (webviewRef.current && s.zoom) {
      setZoom(s.zoom);
      webviewRef.current.setZoomFactor(s.zoom);
    }
  }, [s.zoom, domReady, attached]);

  // Event handling functions for rrweb
  const handleRecordedEvent = useCallback((event: SyncWebviewEvent) => {
    // Process event through worker if available
    if (workerManagerRef.current && workerManagerRef.current.getIsInitialized()) {
      workerManagerRef.current.processEvent(event);
    } else {
      // Fallback to direct processing
      broadcastEvent(event);
    }
  }, []);

  const handleEventBatch = useCallback((batch: any) => {
    // Handle batched events from worker
    console.log('SyncWebview: Received event batch from worker:', batch);
    
    // Broadcast regular events
    if (batch.events && batch.events.length > 0) {
      batch.events.forEach((event: SyncWebviewEvent) => {
        broadcastEvent(event);
      });
    }

    // Handle optimized mouse events
    if (batch.mouseEvents) {
      broadcastMouseBatch(batch.mouseEvents);
    }
  }, []);

  const handleWorkerError = useCallback((error: any) => {
    console.error('SyncWebview: Worker error:', error);
    updateState(props._id, { recordingError: 'Worker processing error' });
    toast({
      title: 'Processing Error',
      description: 'Event processing worker encountered an error',
      status: 'warning',
      duration: 3000,
    });
  }, [props._id, updateState, toast]);

  const handleMouseBatch = useCallback((batch: any) => {
    // Handle optimized mouse movement batches
    console.log('SyncWebview: Received optimized mouse batch:', batch);
    
    // Process through worker if available
    if (workerManagerRef.current && workerManagerRef.current.getIsInitialized()) {
      workerManagerRef.current.processBatch(batch.events);
    } else {
      // Fallback to direct broadcasting
      broadcastMouseBatch(batch);
    }
  }, []);

  const handleMouseInteraction = useCallback((state: any) => {
    // Handle mouse interaction state changes
    console.log('SyncWebview: Mouse interaction state changed:', state);
    
    // Broadcast interaction state immediately for real-time feedback
    broadcastMouseInteraction(state);
    
    // Update performance metrics if recorder is available
    if (recorderServiceRef.current) {
      const performanceMetrics = {
        eventQueueSize: 0, // Will be updated by worker
        networkLatency: 0, // Will be updated by worker
        processingDelay: 0,
        clientPerformance: 'medium' as const,
      };
      recorderServiceRef.current.updatePerformanceMetrics(performanceMetrics);
    }
  }, []);

  // WebSocket event handlers
  const handleEventReceived = useCallback((event: SyncWebviewEvent) => {
    console.log('SyncWebview: Received event from other client:', event);
    
    // Add event to replay service
    if (replayServiceRef.current && replayServiceRef.current.getIsReplaying()) {
      replayServiceRef.current.addEvent(event);
    }
    
    // Update last event timestamp
    updateState(props._id, { lastEventTimestamp: event.timestamp });
  }, [props._id, updateState]);

  const handleSnapshotReceived = useCallback((snapshot: string, timestamp: number) => {
    console.log('SyncWebview: Received snapshot from other client');
    
    // Apply snapshot to replay service
    if (replayServiceRef.current && replayServiceRef.current.getIsReplaying()) {
      replayServiceRef.current.applySnapshot(snapshot, timestamp);
    }
    
    // Update last event timestamp
    updateState(props._id, { lastEventTimestamp: timestamp });
  }, [props._id, updateState]);

  const handleMouseBatchReceived = useCallback((batch: MouseMovementBatch) => {
    console.log('SyncWebview: Received mouse batch from other client:', batch);
    
    // Handle mouse batch in replay service
    if (replayServiceRef.current && replayServiceRef.current.getIsReplaying()) {
      replayServiceRef.current.handleMouseBatch(batch);
    }
    
    // Update last event timestamp
    updateState(props._id, { lastEventTimestamp: batch.endTime });
  }, [props._id, updateState]);

  const handleMouseInteractionReceived = useCallback((interaction: MouseInteractionState) => {
    console.log('SyncWebview: Received mouse interaction from other client:', interaction);
    
    // Handle mouse interaction in replay service
    if (replayServiceRef.current && replayServiceRef.current.getIsReplaying()) {
      replayServiceRef.current.handleMouseInteraction(interaction);
    }
    
    // Update last event timestamp
    updateState(props._id, { lastEventTimestamp: interaction.timestamp });
  }, [props._id, updateState]);

  const handleWebSocketError = useCallback((error: Error) => {
    console.error('SyncWebview: WebSocket error:', error);
    updateState(props._id, { connectionStatus: 'disconnected' });
    toast({
      title: 'Connection Error',
      description: 'Lost connection to other clients',
      status: 'error',
      duration: 3000,
    });
  }, [props._id, updateState, toast]);

  const handleReplayError = useCallback((error: Error) => {
    console.error('SyncWebview: Replay error:', error);
    toast({
      title: 'Replay Error',
      description: 'Error replaying events from other clients',
      status: 'warning',
      duration: 3000,
    });
  }, [toast]);

  const handleReplayComplete = useCallback(() => {
    console.log('SyncWebview: Replay completed');
  }, []);

  const handleSnapshotRequested = useCallback(async (requesterId: string) => {
    console.log('SyncWebview: Snapshot requested by:', requesterId);
    
    // Generate snapshot using recorder service
    if (recorderServiceRef.current && recorderServiceRef.current.getIsRecording()) {
      try {
        // This would need to be implemented in EventRecorderService
        // For now, we'll create a placeholder snapshot
        const snapshot = JSON.stringify({
          type: 'snapshot',
          timestamp: Date.now(),
          url: s.url,
          zoom: s.zoom
        });
        
        // Send snapshot via WebSocket service
        if (webSocketServiceRef.current && webSocketServiceRef.current.getIsInitialized()) {
          await webSocketServiceRef.current.broadcastSnapshot(snapshot);
          console.log('SyncWebview: Sent snapshot to requester');
        }
      } catch (error) {
        console.error('SyncWebview: Failed to generate snapshot:', error);
      }
    }
  }, [s.url, s.zoom]);

  const broadcastEvent = useCallback((event: SyncWebviewEvent) => {
    // Broadcast through WebSocket service
    if (webSocketServiceRef.current && webSocketServiceRef.current.getIsInitialized()) {
      webSocketServiceRef.current.broadcastEvent(event);
    } else {
      console.warn('SyncWebview: WebSocket service not available for broadcasting');
    }
    
    // Update last event timestamp
    updateState(props._id, { lastEventTimestamp: event.timestamp });
  }, [props._id, updateState]);

  const broadcastMouseBatch = useCallback((mouseBatch: MouseMovementBatch) => {
    // Broadcast through WebSocket service
    if (webSocketServiceRef.current && webSocketServiceRef.current.getIsInitialized()) {
      webSocketServiceRef.current.broadcastMouseBatch(mouseBatch);
    } else {
      console.warn('SyncWebview: WebSocket service not available for mouse batch broadcasting');
    }
    
    // Update last event timestamp for UI feedback
    updateState(props._id, { lastEventTimestamp: Date.now() });
  }, [props._id, updateState]);

  const broadcastMouseInteraction = useCallback((interaction: MouseInteractionState) => {
    // Broadcast through WebSocket service
    if (webSocketServiceRef.current && webSocketServiceRef.current.getIsInitialized()) {
      webSocketServiceRef.current.broadcastMouseInteraction(interaction);
    } else {
      console.warn('SyncWebview: WebSocket service not available for mouse interaction broadcasting');
    }
    
    // Update last event timestamp for UI feedback
    updateState(props._id, { lastEventTimestamp: Date.now() });
  }, [props._id, updateState]);

  // Window resize hook
  const isFocused = useUIStore((state) => state.focusedAppId === props._id);
  const { width: winWidth, height: winHeight } = useWindowResize();

  const webviewStyle: React.CSSProperties = {
    width: isFocused ? winWidth + 'px' : props.data.size.width + 'px',
    height: isFocused ? winHeight + 'px' : props.data.size.height + 'px', // Use full application height
    border: 'none',
    background: 'white',
    visibility: boardDragging ? 'hidden' : 'visible',
  };

  return (
    <AppWindow app={props} hideBackgroundIcon={MdSync}>
      {isElectron() ? (
        <Box width="100%" height="100%" position="relative">
          <webview ref={setWebviewRef} style={webviewStyle} allowpopups={'true' as any}></webview>
        </Box>
      ) : (
        <ElectronRequired appName={props.data.type} link={s.url} title={props.data.title} />
      )}
    </AppWindow>
  );
}

/* App toolbar component for SyncWebview */

function ToolbarComponent(props: App): JSX.Element {
  const s = props.data.state as AppState;
  const updateState = useAppStore((state) => state.updateState);

  // Local state for URL input
  const [urlInput, setUrlInput] = useState(s.url);

  // Toast for notifications
  const toast = useToast();

  // Room and board info
  const { roomId } = useParams();

  // Check if running in Electron
  const clientIsElectron = isElectron();

  // Get status information from app state
  const connectionStatus = s.connectionStatus || 'disconnected';
  const recordingError = s.recordingError || null;
  const isRecording = s.isRecording;
  const lastEventTimestamp = s.lastEventTimestamp;
  const zoom = s.zoom;

  // Update local URL input when state changes
  useEffect(() => {
    setUrlInput(s.url);
  }, [s.url]);

  // Handle URL input change
  const handleUrlChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    setUrlInput(event.target.value);
  };

  // Navigate to new URL
  const navigateToUrl = (evt?: React.FormEvent) => {
    if (evt) evt.preventDefault();
    
    let url = urlInput.trim();
    
    // Handle search queries vs URLs
    if (url.indexOf(' ') !== -1) {
      url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
    } else if (url.indexOf(' ') === -1 && url.indexOf('.') === -1 && url.indexOf('localhost') === -1) {
      url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
    } else {
      if (!url.startsWith('http')) {
        url = 'https://' + url;
      }
    }

    try {
      const validUrl = new URL(url).toString();
      updateState(props._id, { url: validUrl });
      toast({
        title: 'Navigating',
        description: 'Loading new URL',
        status: 'info',
        duration: 2000,
      });
    } catch (error) {
      console.error('SyncWebview> Invalid URL', url);
      toast({
        title: 'Invalid URL',
        description: 'Please enter a valid URL',
        status: 'error',
        duration: 3000,
      });
    }
  };



  // Toggle password masking
  const togglePasswordMasking = () => {
    updateState(props._id, {
      privacy: {
        ...s.privacy,
        maskPasswords: !s.privacy.maskPasswords,
      },
    });
    
    toast({
      title: s.privacy.maskPasswords ? 'Password Masking Disabled' : 'Password Masking Enabled',
      description: s.privacy.maskPasswords ? 'Password fields will be visible' : 'Password fields will be masked',
      status: 'info',
      duration: 2000,
    });
  };

  // Zoom controls
  const handleZoom = (direction: 'in' | 'out' | 'reset') => {
    let newZoom = s.zoom;
    
    switch (direction) {
      case 'in':
        newZoom = Math.min(s.zoom + 0.1, 3.0);
        break;
      case 'out':
        newZoom = Math.max(s.zoom - 0.1, 0.1);
        break;
      case 'reset':
        newZoom = 1.0;
        break;
    }
    
    updateState(props._id, { zoom: newZoom });
  };

  // Copy URL to clipboard
  const copyUrl = () => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(s.url);
      toast({
        title: 'URL Copied',
        description: 'URL copied to clipboard',
        status: 'success',
        duration: 2000,
      });
    }
  };

  // Open URL in new tab/window
  const openExternal = () => {
    if (clientIsElectron) {
      window.electron.send('open-external-url', { url: s.url });
    } else {
      window.open(s.url, '_blank');
    }
  };

  return (
    <HStack spacing={2} width="100%">
      {clientIsElectron ? (
        <>
          {/* Navigation Controls - Only in Electron */}
          <ButtonGroup isAttached size="xs" colorScheme="teal">
            <Tooltip label="Go Back" placement="top" hasArrow openDelay={400}>
              <Button size="xs" px={2} isDisabled>
                <MdArrowBack size="16px" />
              </Button>
            </Tooltip>
            
            <Tooltip label="Go Forward" placement="top" hasArrow openDelay={400}>
              <Button size="xs" px={2} isDisabled>
                <MdArrowForward size="16px" />
              </Button>
            </Tooltip>
            
            <Tooltip label="Refresh" placement="top" hasArrow openDelay={400}>
              <Button size="xs" px={2} onClick={() => updateState(props._id, { url: s.url })}>
                <MdRefresh size="16px" />
              </Button>
            </Tooltip>
          </ButtonGroup>

          {/* URL Input */}
          <form onSubmit={navigateToUrl}>
            <InputGroup size="xs" minWidth="200px">
              <Input
                placeholder="Enter URL or search term"
                value={urlInput}
                onChange={handleUrlChange}
                backgroundColor="whiteAlpha.300"
              />
            </InputGroup>
          </form>

          <Tooltip label="Navigate" placement="top" hasArrow openDelay={400}>
            <Button onClick={navigateToUrl} size="xs" colorScheme="teal" px={2}>
              <MdOutlineSubdirectoryArrowLeft size="16px" />
            </Button>
          </Tooltip>

          {/* Privacy Controls */}
          <Tooltip 
            label={s.privacy.maskPasswords ? "Password masking enabled" : "Password masking disabled"} 
            placement="top" 
            hasArrow 
            openDelay={400}
          >
            <Button 
              onClick={togglePasswordMasking} 
              size="xs" 
              px={2}
              variant={s.privacy.maskPasswords ? "solid" : "outline"}
              colorScheme={s.privacy.maskPasswords ? "green" : "gray"}
            >
              <MdSecurity size="16px" />
            </Button>
          </Tooltip>

          {/* Zoom Controls */}
          <ButtonGroup isAttached size="xs" colorScheme="teal">
            <Tooltip label="Zoom In" placement="top" hasArrow openDelay={400}>
              <Button onClick={() => handleZoom('in')} size="xs" px={2}>
                <MdAdd size="16px" />
              </Button>
            </Tooltip>
            
            <Tooltip label="Zoom Out" placement="top" hasArrow openDelay={400}>
              <Button onClick={() => handleZoom('out')} size="xs" px={2}>
                <MdRemove size="16px" />
              </Button>
            </Tooltip>
          </ButtonGroup>

          {/* Utility Controls */}
          <ButtonGroup isAttached size="xs" colorScheme="teal">
            <Tooltip label="Copy URL" placement="top" hasArrow openDelay={400}>
              <Button onClick={copyUrl} size="xs" px={2}>
                <MdCopyAll size="16px" />
              </Button>
            </Tooltip>
            
            <Tooltip label="Open in Desktop" placement="top" hasArrow openDelay={400}>
              <Button onClick={openExternal} size="xs" px={2}>
                <MdOpenInNew size="16px" />
              </Button>
            </Tooltip>
          </ButtonGroup>

          {/* Status Information */}
          <HStack spacing={2} ml="auto">
            {/* Connection Status Indicator */}
            <HStack spacing={1}>
              {recordingError ? (
                <Tooltip label={`Error: ${recordingError}`} placement="top" hasArrow>
                  <HStack>
                    <MdSync color="red" />
                    <Text fontSize="xs" color="red.500">Error</Text>
                  </HStack>
                </Tooltip>
              ) : connectionStatus === 'connected' && isRecording ? (
                <Tooltip label="Sync Active" placement="top" hasArrow>
                  <HStack>
                    <MdSync color="green" />
                    <Text fontSize="xs" color="green.500">Active</Text>
                  </HStack>
                </Tooltip>
              ) : connectionStatus === 'connecting' ? (
                <Tooltip label="Connecting" placement="top" hasArrow>
                  <HStack>
                    <MdSync color="orange" />
                    <Text fontSize="xs" color="orange.500">Connecting</Text>
                  </HStack>
                </Tooltip>
              ) : connectionStatus === 'disconnected' ? (
                <Tooltip label="Disconnected" placement="top" hasArrow>
                  <Text fontSize="xs" color="red.500">Disconnected</Text>
                </Tooltip>
              ) : (
                <Tooltip label="Ready" placement="top" hasArrow>
                  <Text fontSize="xs" color="gray.500">Ready</Text>
                </Tooltip>
              )}
            </HStack>

            {/* Last Sync Time */}
            {lastEventTimestamp > 0 && (
              <Tooltip label="Last synchronization time" placement="top" hasArrow>
                <Text fontSize="xs" color="gray.500">
                  {new Date(lastEventTimestamp).toLocaleTimeString()}
                </Text>
              </Tooltip>
            )}

            {/* Zoom Level */}
            <Tooltip label="Current zoom level" placement="top" hasArrow>
              <Text fontSize="xs" color="gray.500">
                {Math.round(zoom * 100)}%
              </Text>
            </Tooltip>
          </HStack>
        </>
      ) : (
        <>
          {/* Browser-only controls */}
          <Tooltip label="Open page in new tab" placement="top" hasArrow openDelay={400}>
            <Button onClick={openExternal} size="xs" variant="solid" colorScheme="teal">
              Open
            </Button>
          </Tooltip>
          <Tooltip label="Copy URL" placement="top" hasArrow openDelay={400}>
            <Button onClick={copyUrl} size="xs" variant="solid" colorScheme="teal">
              Copy
            </Button>
          </Tooltip>
        </>
      )}
    </HStack>
  );
}

/**
 * Grouped App toolbar component, this component will display when a group of apps are selected
 * @returns JSX.Element | null
 */
const GroupedToolbarComponent = () => {
  return null;
};

export default { AppComponent, ToolbarComponent, GroupedToolbarComponent };