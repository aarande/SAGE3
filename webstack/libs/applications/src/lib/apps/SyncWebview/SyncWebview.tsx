/**
 * Copyright (c) SAGE3 Development Team 2024. All Rights Reserved
 * University of Hawaii, University of Illinois Chicago, Virginia Tech
 *
 * Distributed under the terms of the SAGE3 License.  The full license is in
 * the file LICENSE, distributed as part of this software.
 */

import { useRef, useState, useCallback, useEffect, useMemo } from 'react';
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
import { SyncWebviewEvent, SyncWebviewWebSocketMessage, MouseMovementBatch, MouseInteractionState, CompressedSnapshot, SnapshotRequest, NavigationEvent } from './types';
import { EventRecorderService } from './services/EventRecorderService';
import { WorkerManagerService } from './services/WorkerManagerService';
import { WebSocketService } from './services/WebSocketService';
import { EventReplayService } from './services/EventReplayService';
import { StateSynchronizationService } from './services/StateSynchronizationService';

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
  const [canGoBack, setCanGoBack] = useState<boolean>(s.navigation?.canGoBack || false);
  const [canGoForward, setCanGoForward] = useState<boolean>(s.navigation?.canGoForward || false);
  
  // Flag to prevent navigation broadcast loops
  const isNavigatingFromRemote = useRef<boolean>(false);
  
  // Refs for current values to avoid recreating webview callback
  const currentUrl = useRef<string>(url);
  const currentNavigation = useRef(s.navigation);
  
  // Flag to track if webview has been initialized
  const webviewInitialized = useRef<boolean>(false);
  
  // Update refs when values change
  useEffect(() => {
    currentUrl.current = url;
  }, [url]);
  
  useEffect(() => {
    currentNavigation.current = s.navigation;
  }, [s.navigation]);

  // rrweb Services
  const recorderServiceRef = useRef<EventRecorderService | null>(null);
  const workerManagerRef = useRef<WorkerManagerService | null>(null);
  const webSocketServiceRef = useRef<WebSocketService | null>(null);
  const replayServiceRef = useRef<EventReplayService | null>(null);
  const stateSyncServiceRef = useRef<StateSynchronizationService | null>(null);

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
    setCanGoBack(s.navigation?.canGoBack || false);
    setCanGoForward(s.navigation?.canGoForward || false);
  }, [s.url, s.isRecording, s.isReplaying, s.zoom, s.navigation?.canGoBack, s.navigation?.canGoForward]);

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
          handleSnapshotRequested,
          handleNavigationReceived
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

        // Initialize State Synchronization Service
        const stateSyncService = new StateSynchronizationService(
          handleSnapshotGenerated,
          handleStateSyncError
        );
        await stateSyncService.initialize();
        stateSyncServiceRef.current = stateSyncService;

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
      if (stateSyncServiceRef.current) {
        stateSyncServiceRef.current.destroy();
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
            await webSocketServiceRef.current.requestSnapshot(s.url);
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

  // Update navigation state
  const updateNavigationState = useCallback(() => {
    if (!webviewRef.current) return;
    
    const newCanGoBack = webviewRef.current.canGoBack();
    const newCanGoForward = webviewRef.current.canGoForward();
    
    if (newCanGoBack !== canGoBack || newCanGoForward !== canGoForward) {
      setCanGoBack(newCanGoBack);
      setCanGoForward(newCanGoForward);
      
      // Update app state with navigation capabilities
      updateState(props._id, {
        navigation: {
          ...s.navigation,
          canGoBack: newCanGoBack,
          canGoForward: newCanGoForward,
        }
      });
    }
  }, [canGoBack, canGoForward, props._id, updateState, s.navigation]);

  // Stable webview ref callback
  const setWebviewRef = useCallback((node: WebviewTag) => {
    if (!node || webviewInitialized.current) return;

    webviewRef.current = node;
    const webview = node;
    
    // event did-attach callback
    const didAttachCallback = (evt: any) => {
      webview.removeEventListener('did-attach', didAttachCallback);
      setAttached(true);
    };

    // event dom-ready callback
    const domReadyCallback = (evt: any) => {
      webview.removeEventListener('dom-ready', domReadyCallback);
      setDomReady(true);
    };

    // Navigation event handlers
    const didNavigate = (event: any) => {
      console.log('SyncWebview: Navigation completed to:', event.url);
      
      // Update URL in state if it changed
      if (event.url !== currentUrl.current) {
        setUrl(event.url);
        updateState(props._id, { url: event.url });
        
        // Update navigation history
        const currentHistory = currentNavigation.current?.history || [];
        const currentIndex = currentNavigation.current?.currentIndex || 0;
        
        // Add new URL to history (remove any forward history)
        const newHistory = [...currentHistory.slice(0, currentIndex + 1), event.url];
        const newIndex = newHistory.length - 1;
        
        updateState(props._id, {
          navigation: {
            ...currentNavigation.current,
            history: newHistory,
            currentIndex: newIndex,
          }
        });
        
        // Only broadcast navigation event if this wasn't triggered by a remote navigation
        if (!isNavigatingFromRemote.current) {
          const navigationEvent: NavigationEvent = {
            type: 'navigate',
            url: event.url,
            timestamp: Date.now(),
            userId: user?._id || 'anonymous',
            sessionId: props._id
          };
          
          if (webSocketServiceRef.current && webSocketServiceRef.current.getIsInitialized()) {
            webSocketServiceRef.current.broadcastNavigation(navigationEvent);
          }
        } else {
          // Reset the flag after handling remote navigation
          isNavigatingFromRemote.current = false;
        }
      }
      
      // Update navigation state
      setTimeout(updateNavigationState, 100); // Small delay to ensure webview state is updated
    };

    const didNavigateInPage = (event: any) => {
      console.log('SyncWebview: In-page navigation to:', event.url);
      updateNavigationState();
    };

    const titleUpdated = (event: any) => {
      // Update the app title
      update(props._id, { title: event.title });
    };

    try {
      // Set partition for isolation
      const expectedPartition = 'persist:syncwebview_' + props._id;
      webview.partition = expectedPartition;

      // Add event listeners
      webview.addEventListener('dom-ready', domReadyCallback);
      webview.addEventListener('did-attach', didAttachCallback);
      webview.addEventListener('did-navigate', didNavigate);
      webview.addEventListener('did-navigate-in-page', didNavigateInPage);
      webview.addEventListener('page-title-updated', titleUpdated);

      // Navigate to initial URL
      webview.src = currentUrl.current;
      
      // Mark as initialized
      webviewInitialized.current = true;
      
      console.log('SyncWebview: Webview initialized with partition:', expectedPartition);
    } catch (error) {
      console.error('SyncWebview: Error initializing webview:', error);
    }
  }, []); // Empty dependency array - callback never changes

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
        
        // Update app state with new URL
        updateState(props._id, { url: newUrl });
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
  }, [domReady, attached, toast, props._id, updateState]);

  // Update to URL from backend
  useEffect(() => {
    if (s.url !== url) {
      if (isElectron()) {
        // Set flag to prevent broadcasting when URL is updated from backend state
        isNavigatingFromRemote.current = true;
        loadURL(s.url);
      }
      setUrl(s.url);
    }
  }, [s.url, url, loadURL]);

  // Navigation functions
  const goBack = useCallback(() => {
    if (!webviewRef.current || !canGoBack) return;
    
    try {
      webviewRef.current.goBack();
      
      // Broadcast navigation event
      const navigationEvent: NavigationEvent = {
        type: 'back',
        timestamp: Date.now(),
        userId: user?._id || 'anonymous',
        sessionId: props._id
      };
      
      if (webSocketServiceRef.current && webSocketServiceRef.current.getIsInitialized()) {
        webSocketServiceRef.current.broadcastNavigation(navigationEvent);
      }
    } catch (error) {
      console.error('SyncWebview: Error going back:', error);
    }
  }, [canGoBack, user?._id, props._id]);

  const goForward = useCallback(() => {
    if (!webviewRef.current || !canGoForward) return;
    
    try {
      webviewRef.current.goForward();
      
      // Broadcast navigation event
      const navigationEvent: NavigationEvent = {
        type: 'forward',
        timestamp: Date.now(),
        userId: user?._id || 'anonymous',
        sessionId: props._id
      };
      
      if (webSocketServiceRef.current && webSocketServiceRef.current.getIsInitialized()) {
        webSocketServiceRef.current.broadcastNavigation(navigationEvent);
      }
    } catch (error) {
      console.error('SyncWebview: Error going forward:', error);
    }
  }, [canGoForward, user?._id, props._id]);

  const refresh = useCallback(() => {
    if (!webviewRef.current) return;
    
    try {
      webviewRef.current.reload();
      
      // Broadcast navigation event
      const navigationEvent: NavigationEvent = {
        type: 'refresh',
        timestamp: Date.now(),
        userId: user?._id || 'anonymous',
        sessionId: props._id
      };
      
      if (webSocketServiceRef.current && webSocketServiceRef.current.getIsInitialized()) {
        webSocketServiceRef.current.broadcastNavigation(navigationEvent);
      }
    } catch (error) {
      console.error('SyncWebview: Error refreshing:', error);
    }
  }, [user?._id, props._id]);

  // Set zoom when it changes
  useEffect(() => {
    if (domReady === false || attached === false) return;
    if (webviewRef.current && s.zoom) {
      setZoom(s.zoom);
      webviewRef.current.setZoomFactor(s.zoom);
    }
  }, [s.zoom, domReady, attached]);

  // Listen for navigation events from toolbar
  useEffect(() => {
    const handleNavigationEvent = (event: CustomEvent) => {
      const { type, url: navUrl } = event.detail;
      
      switch (type) {
        case 'navigate':
          if (navUrl) {
            // Broadcast navigation event
            const navigationEvent: NavigationEvent = {
              type: 'navigate',
              url: navUrl,
              timestamp: Date.now(),
              userId: user?._id || 'anonymous',
              sessionId: props._id
            };
            
            if (webSocketServiceRef.current && webSocketServiceRef.current.getIsInitialized()) {
              webSocketServiceRef.current.broadcastNavigation(navigationEvent);
            }
          }
          break;
        case 'back':
          goBack();
          break;
        case 'forward':
          goForward();
          break;
        case 'refresh':
          refresh();
          break;
      }
    };

    window.addEventListener('syncwebview-navigate', handleNavigationEvent as EventListener);
    
    return () => {
      window.removeEventListener('syncwebview-navigate', handleNavigationEvent as EventListener);
    };
  }, [goBack, goForward, refresh, user?._id, props._id]);

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

  const handleSnapshotReceived = useCallback((compressedSnapshot: CompressedSnapshot) => {
    console.log('SyncWebview: Received compressed snapshot from other client');
    
    // Apply compressed snapshot to replay service
    if (replayServiceRef.current && replayServiceRef.current.getIsReplaying()) {
      replayServiceRef.current.applyCompressedSnapshot(compressedSnapshot);
    }
    
    // Cache the received snapshot
    if (stateSyncServiceRef.current && stateSyncServiceRef.current.getIsInitialized()) {
      stateSyncServiceRef.current.cacheSnapshot(compressedSnapshot);
    }
    
    // Update last event timestamp
    updateState(props._id, { lastEventTimestamp: compressedSnapshot.timestamp });
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

  const handleSnapshotGenerated = useCallback((snapshot: CompressedSnapshot) => {
    console.log('SyncWebview: Snapshot generated:', {
      size: snapshot.compressedSize,
      compression: snapshot.compressionMethod,
      url: snapshot.url
    });
    
    // Get cache statistics
    const cacheStats = stateSyncServiceRef.current?.getCacheStats();
    const compressionRatio = snapshot.originalSize > 0 ? 
      (snapshot.originalSize - snapshot.compressedSize) / snapshot.originalSize : 0;
    
    // Update app state with snapshot information
    updateState(props._id, { 
      lastEventTimestamp: snapshot.timestamp,
      recordingError: null, // Clear any previous errors
      snapshotCache: {
        lastSnapshotTimestamp: snapshot.timestamp,
        cacheSize: cacheStats?.size || 0,
        compressionRatio: compressionRatio,
      }
    });
  }, [props._id, updateState]);

  const handleStateSyncError = useCallback((error: Error) => {
    console.error('SyncWebview: State synchronization error:', error);
    updateState(props._id, { recordingError: 'State synchronization error' });
    toast({
      title: 'Synchronization Error',
      description: 'Error with state synchronization service',
      status: 'warning',
      duration: 3000,
    });
  }, [props._id, updateState, toast]);

  const handleSnapshotRequested = useCallback(async (request: SnapshotRequest) => {
    console.log('SyncWebview: Snapshot requested by:', request.requesterId);
    
    // Check if we have a cached snapshot first
    if (stateSyncServiceRef.current && stateSyncServiceRef.current.getIsInitialized()) {
      const cachedSnapshot = stateSyncServiceRef.current.getCachedSnapshot(s.url);
      if (cachedSnapshot) {
        console.log('SyncWebview: Sending cached snapshot');
        if (webSocketServiceRef.current && webSocketServiceRef.current.getIsInitialized()) {
          await webSocketServiceRef.current.broadcastSnapshot(cachedSnapshot);
        }
        return;
      }
    }
    
    // Generate new snapshot using recorder service
    if (recorderServiceRef.current && recorderServiceRef.current.getIsRecording() && 
        stateSyncServiceRef.current && stateSyncServiceRef.current.getIsInitialized()) {
      try {
        // Get current recorded events
        const events = recorderServiceRef.current.generateSnapshot(s.url, s.zoom);
        
        // Generate compressed snapshot
        const compressedSnapshot = await stateSyncServiceRef.current.generateSnapshot(
          events,
          s.url,
          s.zoom,
          'gzip' // Use gzip compression by default
        );
        
        // Send snapshot via WebSocket service
        if (webSocketServiceRef.current && webSocketServiceRef.current.getIsInitialized()) {
          await webSocketServiceRef.current.broadcastSnapshot(compressedSnapshot);
          console.log('SyncWebview: Sent generated snapshot to requester');
        }
      } catch (error) {
        console.error('SyncWebview: Failed to generate snapshot:', error);
        updateState(props._id, { recordingError: 'Failed to generate snapshot' });
      }
    }
  }, [s.url, s.zoom, props._id, updateState]);

  const handleNavigationReceived = useCallback((navigation: NavigationEvent) => {
    console.log('SyncWebview: Received navigation event from other client:', navigation);
    
    if (!webviewRef.current || !domReady || !attached) {
      console.warn('SyncWebview: Webview not ready for navigation');
      return;
    }

    try {
      // Set flag to prevent broadcasting when handling remote navigation
      isNavigatingFromRemote.current = true;
      
      switch (navigation.type) {
        case 'navigate':
          if (navigation.url && navigation.url !== url) {
            loadURL(navigation.url);
          } else {
            // Reset flag if we're not actually navigating
            isNavigatingFromRemote.current = false;
          }
          break;
        case 'back':
          if (webviewRef.current.canGoBack()) {
            webviewRef.current.goBack();
          } else {
            isNavigatingFromRemote.current = false;
          }
          break;
        case 'forward':
          if (webviewRef.current.canGoForward()) {
            webviewRef.current.goForward();
          } else {
            isNavigatingFromRemote.current = false;
          }
          break;
        case 'refresh':
          webviewRef.current.reload();
          break;
        default:
          // Reset flag for unknown navigation types
          isNavigatingFromRemote.current = false;
          break;
      }
    } catch (error) {
      console.error('SyncWebview: Error handling navigation event:', error);
      // Reset flag on error to prevent it from getting stuck
      isNavigatingFromRemote.current = false;
    }
  }, [url, loadURL, domReady, attached]);

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

  const webviewStyle: React.CSSProperties = useMemo(() => ({
    width: isFocused ? winWidth + 'px' : props.data.size.width + 'px',
    height: isFocused ? winHeight + 'px' : props.data.size.height + 'px', // Use full application height
    border: 'none',
    background: 'white',
    visibility: boardDragging ? 'hidden' : 'visible',
  }), [isFocused, winWidth, winHeight, props.data.size.width, props.data.size.height, boardDragging]);

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
      
      // Trigger navigation event for synchronization
      const event = new CustomEvent('syncwebview-navigate', { 
        detail: { type: 'navigate', url: validUrl } 
      });
      window.dispatchEvent(event);
      
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
              <Button 
                size="xs" 
                px={2} 
                isDisabled={!s.navigation?.canGoBack}
                onClick={() => {
                  // Trigger navigation in the main component
                  const event = new CustomEvent('syncwebview-navigate', { 
                    detail: { type: 'back' } 
                  });
                  window.dispatchEvent(event);
                }}
              >
                <MdArrowBack size="16px" />
              </Button>
            </Tooltip>
            
            <Tooltip label="Go Forward" placement="top" hasArrow openDelay={400}>
              <Button 
                size="xs" 
                px={2} 
                isDisabled={!s.navigation?.canGoForward}
                onClick={() => {
                  // Trigger navigation in the main component
                  const event = new CustomEvent('syncwebview-navigate', { 
                    detail: { type: 'forward' } 
                  });
                  window.dispatchEvent(event);
                }}
              >
                <MdArrowForward size="16px" />
              </Button>
            </Tooltip>
            
            <Tooltip label="Refresh" placement="top" hasArrow openDelay={400}>
              <Button 
                size="xs" 
                px={2} 
                onClick={() => {
                  // Trigger navigation in the main component
                  const event = new CustomEvent('syncwebview-navigate', { 
                    detail: { type: 'refresh' } 
                  });
                  window.dispatchEvent(event);
                }}
              >
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

            {/* Snapshot Cache Info */}
            {s.snapshotCache && s.snapshotCache.cacheSize > 0 && (
              <Tooltip 
                label={`Snapshot cache: ${s.snapshotCache.cacheSize} entries, ${Math.round(s.snapshotCache.compressionRatio * 100)}% compression`} 
                placement="top" 
                hasArrow
              >
                <Text fontSize="xs" color="blue.500">
                  Cache: {s.snapshotCache.cacheSize}
                </Text>
              </Tooltip>
            )}
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