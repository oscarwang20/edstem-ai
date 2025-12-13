import 'webextension-polyfill';

/**
 * EdStem Smart Search - Background Service Worker
 *
 * Responsibilities:
 * 1. Intercept EdStem search API calls to capture auth tokens
 * 2. Store captured tokens for use by content scripts and popup
 * 3. Forward search queries to content scripts for semantic search
 * 4. Handle backend communication for sync operations
 */

const BACKEND_URL = 'http://localhost:8000';
const EDSTEM_SEARCH_PATTERN = /https:\/\/(?:us\.)?edstem\.org\/api\/courses\/(\d+)\/search/;

// Storage keys
const STORAGE_KEYS = {
  AUTH_TOKEN: 'edstem_auth_token',
  COURSE_ID: 'current_course_id',
  BACKEND_STATUS: 'backend_status',
  SYNC_STATUS: 'sync_status',
};

// Message types for communication
export const MESSAGE_TYPES = {
  SEARCH_QUERY: 'SEARCH_QUERY',
  AUTH_TOKEN_CAPTURED: 'AUTH_TOKEN_CAPTURED',
  SYNC_COURSE: 'SYNC_COURSE',
  GET_SYNC_STATUS: 'GET_SYNC_STATUS',
  CHECK_BACKEND: 'CHECK_BACKEND',
  GET_STATE: 'GET_STATE',
  SMART_SEARCH_RESULTS: 'SMART_SEARCH_RESULTS',
};

interface SearchMessage {
  type: typeof MESSAGE_TYPES.SEARCH_QUERY;
  query: string;
  courseId: number;
}

interface SyncMessage {
  type: typeof MESSAGE_TYPES.SYNC_COURSE;
  courseId: number;
  userToken: string;
}

interface GetStateMessage {
  type: typeof MESSAGE_TYPES.GET_STATE;
}

type Message = SearchMessage | SyncMessage | GetStateMessage | { type: string };

// Initialize extension state
async function initializeState() {
  const result = await chrome.storage.local.get([
    STORAGE_KEYS.AUTH_TOKEN,
    STORAGE_KEYS.COURSE_ID,
    STORAGE_KEYS.BACKEND_STATUS,
  ]);

  console.log('[EdStem Smart Search] Background loaded, current state:', {
    hasToken: !!result[STORAGE_KEYS.AUTH_TOKEN],
    courseId: result[STORAGE_KEYS.COURSE_ID],
    backendStatus: result[STORAGE_KEYS.BACKEND_STATUS],
  });

  // Check backend health on startup
  checkBackendHealth();
}

// Check backend health
async function checkBackendHealth(): Promise<boolean> {
  try {
    const response = await fetch(`${BACKEND_URL}/health`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const isHealthy = response.ok;
    await chrome.storage.local.set({ [STORAGE_KEYS.BACKEND_STATUS]: isHealthy ? 'connected' : 'disconnected' });

    console.log('[EdStem Smart Search] Backend health check:', isHealthy ? 'connected' : 'disconnected');
    return isHealthy;
  } catch (error) {
    await chrome.storage.local.set({ [STORAGE_KEYS.BACKEND_STATUS]: 'disconnected' });
    console.log('[EdStem Smart Search] Backend health check failed:', error);
    return false;
  }
}

// Listen for web requests to capture auth tokens
chrome.webRequest.onBeforeSendHeaders.addListener(
  details => {
    const match = details.url.match(EDSTEM_SEARCH_PATTERN);

    if (match) {
      const courseId = parseInt(match[1], 10);

      // Extract auth token from headers
      const authHeader = details.requestHeaders?.find(h => h.name.toLowerCase() === 'authorization');

      if (authHeader?.value) {
        const token = authHeader.value.replace('Bearer ', '');

        // Store the token and course ID
        chrome.storage.local.set({
          [STORAGE_KEYS.AUTH_TOKEN]: token,
          [STORAGE_KEYS.COURSE_ID]: courseId,
        });

        console.log('[EdStem Smart Search] Captured auth token for course:', courseId);

        // Extract query from URL
        const url = new URL(details.url);
        const query = url.searchParams.get('q');

        if (query && query.trim()) {
          // Notify content script about the search query
          chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (tabs[0]?.id) {
              chrome.tabs.sendMessage(tabs[0].id, {
                type: MESSAGE_TYPES.SEARCH_QUERY,
                query: query,
                courseId: courseId,
              });
            }
          });

          // Perform semantic search
          performSemanticSearch(query, courseId);
        }
      }
    }
  },
  { urls: ['https://*.edstem.org/api/courses/*/search*'] },
  ['requestHeaders']
);

// Perform semantic search and send results to content script
async function performSemanticSearch(query: string, courseId: number) {
  try {
    const response = await fetch(`${BACKEND_URL}/search?q=${encodeURIComponent(query)}&course_id=${courseId}&k=3`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const data = await response.json();

    // Send results to content script
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: MESSAGE_TYPES.SMART_SEARCH_RESULTS,
          results: data.results || [],
          query: query,
          courseId: courseId,
          message: data.message,
        });
      }
    });
  } catch (error) {
    console.error('[EdStem Smart Search] Semantic search failed:', error);

    // Send error to content script
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: MESSAGE_TYPES.SMART_SEARCH_RESULTS,
          results: [],
          query: query,
          courseId: courseId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    });
  }
}

// Sync course to Pinecone
async function syncCourse(courseId: number, userToken: string): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`${BACKEND_URL}/sync_course`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        course_id: courseId,
        user_token: userToken,
      }),
    });

    if (!response.ok) {
      throw new Error(`Sync request failed: ${response.status}`);
    }

    const data = await response.json();
    return { success: true, message: data.message || 'Sync started' };
  } catch (error) {
    console.error('[EdStem Smart Search] Sync failed:', error);
    return { success: false, message: error instanceof Error ? error.message : 'Sync failed' };
  }
}

// Get sync status from backend
async function getSyncStatus(courseId: number) {
  try {
    const response = await fetch(`${BACKEND_URL}/sync_status/${courseId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Status request failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[EdStem Smart Search] Get sync status failed:', error);
    return { status: 'error', message: error instanceof Error ? error.message : 'Failed to get status' };
  }
}

// Get index stats for a course
async function getIndexStats(courseId: number) {
  try {
    const response = await fetch(`${BACKEND_URL}/index_stats?course_id=${courseId}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Stats request failed: ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error('[EdStem Smart Search] Get index stats failed:', error);
    return null;
  }
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  console.log('[EdStem Smart Search] Received message:', message.type);

  switch (message.type) {
    case MESSAGE_TYPES.CHECK_BACKEND:
      checkBackendHealth().then(isConnected => {
        sendResponse({ connected: isConnected });
      });
      return true; // Async response

    case MESSAGE_TYPES.SYNC_COURSE:
      const syncMsg = message as SyncMessage;
      syncCourse(syncMsg.courseId, syncMsg.userToken).then(result => {
        sendResponse(result);
      });
      return true;

    case MESSAGE_TYPES.GET_SYNC_STATUS:
      const statusMsg = message as { type: string; courseId: number };
      getSyncStatus(statusMsg.courseId).then(status => {
        sendResponse(status);
      });
      return true;

    case MESSAGE_TYPES.GET_STATE:
      Promise.all([
        chrome.storage.local.get([STORAGE_KEYS.AUTH_TOKEN, STORAGE_KEYS.COURSE_ID, STORAGE_KEYS.BACKEND_STATUS]),
        checkBackendHealth(),
      ]).then(async ([storage, backendConnected]) => {
        const courseId = storage[STORAGE_KEYS.COURSE_ID];
        let indexStats = null;

        if (courseId && backendConnected) {
          indexStats = await getIndexStats(courseId);
        }

        sendResponse({
          authToken: storage[STORAGE_KEYS.AUTH_TOKEN],
          courseId: courseId,
          backendConnected: backendConnected,
          indexStats: indexStats,
        });
      });
      return true;

    default:
      return false;
  }
});

// Periodically check backend health
setInterval(checkBackendHealth, 30000); // Every 30 seconds

// Initialize on load
initializeState();

console.log('[EdStem Smart Search] Background service worker initialized');
