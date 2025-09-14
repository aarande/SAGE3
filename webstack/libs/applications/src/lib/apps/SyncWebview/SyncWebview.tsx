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
  Text,
  VStack
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
} from 'react-icons/md';

import { useAppStore, useUser, processContentURL, useHexColor, useUIStore, useWindowResize } from '@sage3/frontend';
import { App } from '../../schema';
import { state as AppState } from './index';
import { AppWindow, ElectronRequired } from '../../components';
import { SyncWebviewEvent, SyncWebviewWebSocketMessage } from './types';

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

  // Window resize hook
  const isFocused = useUIStore((state) => state.focusedAppId === props._id);
  const { width: winWidth, height: winHeight } = useWindowResize();

  const webviewStyle: React.CSSProperties = {
    width: isFocused ? winWidth + 'px' : props.data.size.width + 'px',
    height: isFocused ? winHeight - 40 + 'px' : props.data.size.height - 40 + 'px', // Account for status bar
    border: 'none',
    background: 'white',
    visibility: boardDragging ? 'hidden' : 'visible',
  };

  return (
    <AppWindow app={props} hideBackgroundIcon={MdSync}>
      {isElectron() ? (
        <VStack spacing={0} height="100%">
          {/* Status Bar */}
          <Box width="100%" p={2} bg="gray.100" borderBottom="1px solid" borderColor="gray.200">
            <HStack justify="space-between">
              <HStack>
                <Text fontSize="sm" color="gray.600">
                  Status:
                </Text>
                {isRecording && (
                  <HStack>
                    <MdRadioButtonChecked color="red" />
                    <Text fontSize="sm" color="red.500">Recording</Text>
                  </HStack>
                )}
                {isReplaying && (
                  <HStack>
                    <MdPlayArrow color="green" />
                    <Text fontSize="sm" color="green.500">Replaying</Text>
                  </HStack>
                )}
                {!isRecording && !isReplaying && (
                  <Text fontSize="sm" color="gray.500">Idle</Text>
                )}
              </HStack>
              <Text fontSize="xs" color="gray.500">
                Zoom: {Math.round(zoom * 100)}%
              </Text>
            </HStack>
          </Box>

          {/* Main Content Area */}
          <Box flex={1} width="100%" position="relative">
            <webview ref={setWebviewRef} style={webviewStyle} allowpopups={'true' as any}></webview>
          </Box>
        </VStack>
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

  // Start/Stop recording
  const toggleRecording = () => {
    const newRecordingState = !s.isRecording;
    updateState(props._id, { 
      isRecording: newRecordingState,
      isReplaying: false, // Stop replaying when starting recording
    });
    
    toast({
      title: newRecordingState ? 'Recording Started' : 'Recording Stopped',
      description: newRecordingState ? 'Capturing interactions for synchronization' : 'Stopped capturing interactions',
      status: newRecordingState ? 'success' : 'info',
      duration: 2000,
    });
  };

  // Start/Stop replaying
  const toggleReplaying = () => {
    const newReplayingState = !s.isReplaying;
    updateState(props._id, { 
      isReplaying: newReplayingState,
      isRecording: false, // Stop recording when starting replay
    });
    
    toast({
      title: newReplayingState ? 'Replaying Started' : 'Replaying Stopped',
      description: newReplayingState ? 'Synchronizing with other participants' : 'Stopped synchronization',
      status: newReplayingState ? 'success' : 'info',
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
    <HStack spacing={2}>
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

          {/* Sync Controls */}
          <ButtonGroup isAttached size="xs" colorScheme="blue">
            <Tooltip label={s.isRecording ? "Stop Recording" : "Start Recording"} placement="top" hasArrow openDelay={400}>
              <Button 
                onClick={toggleRecording} 
                size="xs" 
                px={2}
                variant={s.isRecording ? "solid" : "outline"}
                colorScheme={s.isRecording ? "red" : "blue"}
              >
                {s.isRecording ? <MdStop size="16px" /> : <MdRadioButtonChecked size="16px" />}
              </Button>
            </Tooltip>
            
            <Tooltip label={s.isReplaying ? "Stop Replaying" : "Start Replaying"} placement="top" hasArrow openDelay={400}>
              <Button 
                onClick={toggleReplaying} 
                size="xs" 
                px={2}
                variant={s.isReplaying ? "solid" : "outline"}
                colorScheme={s.isReplaying ? "green" : "blue"}
              >
                <MdPlayArrow size="16px" />
              </Button>
            </Tooltip>
          </ButtonGroup>

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