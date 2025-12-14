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
// Updated pattern to match both /search and /threads/search endpoints
const EDSTEM_SEARCH_PATTERN = /https:\/\/(?:us\.)?edstem\.org\/api\/courses\/(\d+)\/(?:threads\/)?search/;
const EDSTEM_API_PATTERN = /https:\/\/(?:us\.)?edstem\.org\/api\/courses\/(\d+)/;
const SEARCH_DEBOUNCE_MS = 300; // Wait 300ms after user stops typing before searching

// Storage keys
const STORAGE_KEYS = {
  AUTH_TOKEN: 'edstem_auth_token',
  COURSE_ID: 'current_course_id',
  BACKEND_STATUS: 'backend_status',
  SYNC_STATUS: 'sync_status',
};

// Debounce timer for search requests
let searchDebounceTimer: ReturnType<typeof setTimeout> | null = null;

// Message types for communication
export const MESSAGE_TYPES = {
  SEARCH_QUERY: 'SEARCH_QUERY',
  AUTH_TOKEN_CAPTURED: 'AUTH_TOKEN_CAPTURED',
  SYNC_COURSE: 'SYNC_COURSE',
  GET_SYNC_STATUS: 'GET_SYNC_STATUS',
  CHECK_BACKEND: 'CHECK_BACKEND',
  GET_STATE: 'GET_STATE',
  SMART_SEARCH_RESULTS: 'SMART_SEARCH_RESULTS',
  EXTRACT_COURSE_ID: 'EXTRACT_COURSE_ID',
  SET_COURSE_ID: 'SET_COURSE_ID',
};

interface SearchMessage {
  type: typeof MESSAGE_TYPES.SEARCH_QUERY;
  query: string;
  courseId: number;
}

interface SyncMessage {
  type: typeof MESSAGE_TYPES.SYNC_COURSE;
  courseId: number;
  userToken: string | null;
}

interface GetStateMessage {
  type: typeof MESSAGE_TYPES.GET_STATE;
}

interface SetCourseIdMessage {
  type: typeof MESSAGE_TYPES.SET_COURSE_ID;
  courseId: number;
}

type Message = SearchMessage | SyncMessage | GetStateMessage | SetCourseIdMessage | { type: string };

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

  // Verify webRequest API is available
  if (chrome.webRequest && chrome.webRequest.onBeforeSendHeaders) {
    console.log('[EdStem Smart Search] webRequest API is available');
  } else {
    console.error('[EdStem Smart Search] webRequest API is NOT available! Check manifest permissions.');
  }

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

// Listen for web requests to capture auth tokens from any EdStem API call
console.log('[EdStem Smart Search] Registering webRequest listener for:', 'https://*.edstem.org/api/*');

chrome.webRequest.onBeforeSendHeaders.addListener(
  details => {
    // Log all EdStem API requests for debugging
    if (details.url.includes('edstem.org/api')) {
      console.log('[EdStem Smart Search] Intercepted API request:', details.url);

      // Debug: Log all available headers (first request only to avoid spam)
      if (details.url.includes('/search') && details.requestHeaders) {
        console.log(
          '[EdStem Smart Search] Available headers:',
          details.requestHeaders.map(h => h.name),
        );
      }
    }

    // Try to extract course ID from URL first
    const apiMatch = details.url.match(EDSTEM_API_PATTERN);
    const searchMatch = details.url.match(EDSTEM_SEARCH_PATTERN);

    // Extract auth token from headers (if present) - but don't require it for search
    // EdStem uses X-Token header (not Authorization)
    // Try multiple header name variations
    const authHeader = details.requestHeaders?.find(
      h =>
        h.name.toLowerCase() === 'x-token' || // EdStem uses this
        h.name.toLowerCase() === 'authorization' ||
        h.name.toLowerCase() === 'x-authorization' ||
        h.name.toLowerCase() === 'authorization-token',
    );

    // Extract token - EdStem uses X-Token header directly (no "Bearer " prefix)
    const token = authHeader?.value ? authHeader.value.replace(/^Bearer\s+/, '') : null;

    // If we have a token, store it (for syncing purposes)
    if (token && apiMatch) {
      const courseId = parseInt(apiMatch[1], 10);
      chrome.storage.local.set({
        [STORAGE_KEYS.AUTH_TOKEN]: token,
        [STORAGE_KEYS.COURSE_ID]: courseId,
      });
      console.log('[EdStem Smart Search] Captured auth token for course:', courseId);
    }

    // Handle search requests - proceed even without auth token (backend uses ED_API_KEY)
    if (searchMatch) {
      const courseId = parseInt(searchMatch[1], 10);

      if (!courseId) {
        console.warn('[EdStem Smart Search] Could not extract course ID from URL:', details.url);
        return;
      }

      // Store course ID even if we don't have a token
      if (!token) {
        chrome.storage.local.set({
          [STORAGE_KEYS.COURSE_ID]: courseId,
        });
        console.log('[EdStem Smart Search] No auth token, but proceeding with search for course:', courseId);
      }

      // Extract query from URL
      const url = new URL(details.url);
      // Try both 'q' and 'query' parameters (EdStem might use either)
      const query = url.searchParams.get('q') || url.searchParams.get('query');

      console.log('[EdStem Smart Search] Search request detected:', { query, courseId, url: details.url });

      if (query && query.trim()) {
        // Clear any existing debounce timer
        if (searchDebounceTimer) {
          clearTimeout(searchDebounceTimer);
          searchDebounceTimer = null;
        }

        // Immediately show loading state in content script
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          if (tabs[0]?.id) {
            chrome.tabs
              .sendMessage(tabs[0].id, {
                type: MESSAGE_TYPES.SEARCH_QUERY,
                query: query,
                courseId: courseId,
              })
              .catch(err => {
                console.warn('[EdStem Smart Search] Failed to send SEARCH_QUERY message:', err);
              });
          }
        });

        // Debounce the actual search request (wait 300ms after user stops typing)
        searchDebounceTimer = setTimeout(() => {
          performSemanticSearch(query, courseId);
          searchDebounceTimer = null;
        }, SEARCH_DEBOUNCE_MS);
      } else {
        // Empty query - clear any pending search and hide results
        if (searchDebounceTimer) {
          clearTimeout(searchDebounceTimer);
          searchDebounceTimer = null;
        }
        // Notify content script to hide results
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
          if (tabs[0]?.id) {
            chrome.tabs.sendMessage(tabs[0].id, {
              type: MESSAGE_TYPES.SEARCH_QUERY,
              query: '',
              courseId: courseId,
            });
          }
        });
      }
    } else if (apiMatch && token) {
      // Not a search request, but we have a token - store it
      const courseId = parseInt(apiMatch[1], 10);
      chrome.storage.local.set({
        [STORAGE_KEYS.AUTH_TOKEN]: token,
        [STORAGE_KEYS.COURSE_ID]: courseId,
      });
      console.log('[EdStem Smart Search] Captured auth token for course:', courseId);
    } else if (token) {
      // No course ID in URL, but we can still store the token
      // (it might be a general API call)
      chrome.storage.local.set({
        [STORAGE_KEYS.AUTH_TOKEN]: token,
      });
      console.log('[EdStem Smart Search] Captured auth token (no course ID in URL)');
    }
  },
  { urls: ['https://*.edstem.org/api/*'] },
  ['requestHeaders'],
);

// Perform semantic search and send results to content script
async function performSemanticSearch(query: string, courseId: number) {
  // Skip if query is empty after debounce
  if (!query || !query.trim()) {
    return;
  }

  try {
    // Use min_score of 0.75 as per PRD requirement (hide low-quality matches)
    const response = await fetch(
      `${BACKEND_URL}/search?q=${encodeURIComponent(query)}&course_id=${courseId}&k=5&min_score=0.25`,
      {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      },
    );

    if (!response.ok) {
      throw new Error(`Backend returned ${response.status}`);
    }

    const data = await response.json();

    console.log('[EdStem Smart Search] Backend response:', {
      resultCount: data.results?.length || 0,
      hasMessage: !!data.message,
      fullData: data,
    });

    // Send results to content script
    // Use sendMessage with error handling and retry logic
    const sendToContentScript = async (tabId: number, retries = 3) => {
      const message = {
        type: MESSAGE_TYPES.SMART_SEARCH_RESULTS,
        results: data.results || [],
        query: query,
        courseId: courseId,
        message: data.message,
      };

      console.log('[EdStem Smart Search] Sending message to content script:', {
        type: message.type,
        resultCount: message.results.length,
        tabId: tabId,
        retriesLeft: retries,
      });

      try {
        await chrome.tabs.sendMessage(tabId, message);
        console.log('[EdStem Smart Search] Message sent successfully to content script');
      } catch (err) {
        if (retries > 0) {
          console.warn(`[EdStem Smart Search] Failed to send message, retrying... (${retries} retries left)`);
          // Wait a bit and retry (content script might still be loading)
          setTimeout(() => sendToContentScript(tabId, retries - 1), 500);
        } else {
          console.error('[EdStem Smart Search] Failed to send message to content script after retries:', err);
        }
      }
    };

    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.id) {
        sendToContentScript(tabs[0].id);
      } else {
        console.warn('[EdStem Smart Search] No active tab found to send message to');
      }
    });
  } catch (error) {
    console.error('[EdStem Smart Search] Semantic search failed:', error);

    // Determine error type for better user feedback
    let errorMessage = 'Unknown error';
    let errorType = 'unknown';

    if (error instanceof Error) {
      errorMessage = error.message;

      // Check for specific error types
      if (error.message.includes('503') || error.message.includes('not available')) {
        errorType = 'backend_unavailable';
        errorMessage = 'Backend service unavailable. Please check if the server is running.';
      } else if (error.message.includes('not indexed') || error.message.includes('namespace')) {
        errorType = 'not_indexed';
        errorMessage = 'Course not indexed yet. Click the extension icon to sync this course.';
      } else if (error.message.includes('Failed to fetch') || error.message.includes('NetworkError')) {
        errorType = 'network_error';
        errorMessage = 'Network error. Please check your connection.';
      } else if (error.message.includes('400')) {
        errorType = 'bad_request';
        errorMessage = 'Invalid search request.';
      } else {
        errorType = 'unknown';
        errorMessage = error.message;
      }
    }

    // Send error to content script
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: MESSAGE_TYPES.SMART_SEARCH_RESULTS,
          results: [],
          query: query,
          courseId: courseId,
          error: errorMessage,
          errorType: errorType,
        });
      }
    });
  }
}

// Sync course to Pinecone
async function syncCourse(courseId: number, userToken: string | null): Promise<{ success: boolean; message: string }> {
  try {
    const requestBody: { course_id: number; user_token?: string } = {
      course_id: courseId,
    };

    // Only include user_token if we have it (backend will use ED_API_KEY as fallback)
    if (userToken) {
      requestBody.user_token = userToken;
    }

    console.log('[EdStem Smart Search] Sending sync request:', {
      courseId,
      hasUserToken: !!userToken,
      backendUrl: BACKEND_URL,
    });

    const response = await fetch(`${BACKEND_URL}/sync_course`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
    });

    console.log('[EdStem Smart Search] Sync response status:', response.status);

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

// Extract course ID from URL
function extractCourseIdFromUrl(url: string): number | null {
  // Match patterns like:
  // - /courses/12345/discussion
  // - /us/courses/12345/discussion
  // - /api/courses/12345/search
  const match = url.match(/\/courses\/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

// Extract and store course ID from current tab URL
async function extractCourseIdFromCurrentTab(): Promise<number | null> {
  try {
    const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tabs[0]?.url) {
      return null;
    }

    const courseId = extractCourseIdFromUrl(tabs[0].url);
    if (courseId) {
      // Store the course ID
      await chrome.storage.local.set({
        [STORAGE_KEYS.COURSE_ID]: courseId,
      });
      console.log('[EdStem Smart Search] Extracted course ID from URL:', courseId);
      return courseId;
    }

    return null;
  } catch (error) {
    console.error('[EdStem Smart Search] Failed to extract course ID from tab:', error);
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
      console.log('[EdStem Smart Search] Received SYNC_COURSE message:', {
        courseId: syncMsg.courseId,
        hasUserToken: !!syncMsg.userToken,
      });
      syncCourse(syncMsg.courseId, syncMsg.userToken).then(result => {
        console.log('[EdStem Smart Search] Sync result:', result);
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
        let courseId = storage[STORAGE_KEYS.COURSE_ID];

        // If no course ID in storage, try to extract from current tab URL
        if (!courseId) {
          courseId = await extractCourseIdFromCurrentTab();
        }

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

    case MESSAGE_TYPES.EXTRACT_COURSE_ID:
      extractCourseIdFromCurrentTab().then(courseId => {
        sendResponse({ courseId });
      });
      return true;

    case MESSAGE_TYPES.SET_COURSE_ID:
      const setCourseMsg = message as SetCourseIdMessage;
      chrome.storage.local.set({
        [STORAGE_KEYS.COURSE_ID]: setCourseMsg.courseId,
      });
      console.log('[EdStem Smart Search] Course ID set from content script:', setCourseMsg.courseId);
      sendResponse({ success: true });
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
console.log('[EdStem Smart Search] Listening for EdStem API requests...');
console.log('[EdStem Smart Search] Search pattern:', EDSTEM_SEARCH_PATTERN);
console.log('[EdStem Smart Search] API pattern:', EDSTEM_API_PATTERN);
