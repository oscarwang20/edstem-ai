import { useEffect, useState, useCallback, useRef } from 'react';

// Message types (must match background script)
const MESSAGE_TYPES = {
  SEARCH_QUERY: 'SEARCH_QUERY',
  SMART_SEARCH_RESULTS: 'SMART_SEARCH_RESULTS',
  SET_COURSE_ID: 'SET_COURSE_ID',
};

interface SearchResult {
  id: number;
  number: number;
  title: string;
  content: string;
  category: string;
  score: number;
}

interface SmartSearchState {
  isLoading: boolean;
  isVisible: boolean;
  results: SearchResult[];
  query: string;
  courseId: number | null;
  error: string | null;
  errorType: string | null;
  message: string | null;
}

// Skeleton loader component
function SkeletonLoader() {
  return (
    <div className="animate-pulse space-y-3">
      {[1, 2, 3].map(i => (
        <div key={i} className="rounded-lg bg-gray-700/50 p-3">
          <div className="mb-2 h-4 w-3/4 rounded bg-gray-600/50"></div>
          <div className="h-3 w-full rounded bg-gray-600/30"></div>
          <div className="mt-1 h-3 w-2/3 rounded bg-gray-600/30"></div>
        </div>
      ))}
    </div>
  );
}

// Search result item component
function SearchResultItem({
  result,
  courseId,
  onClick,
}: {
  result: SearchResult;
  courseId: number | null;
  onClick: () => void;
}) {
  const scoreColor = result.score >= 0.8 ? 'text-green-400' : result.score >= 0.6 ? 'text-yellow-400' : 'text-gray-400';

  return (
    <button
      onClick={onClick}
      className="w-full cursor-pointer rounded-lg bg-gray-700/50 p-3 text-left transition-all hover:bg-gray-600/50 focus:bg-gray-600/50 focus:outline-none focus:ring-2 focus:ring-purple-500"
      role="option"
      aria-label={`${result.title} - Score: ${Math.round(result.score * 100)}%`}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500">#{result.number}</span>
            <h4 className="truncate text-sm font-medium text-gray-100">{result.title}</h4>
          </div>
          <p className="mt-1 line-clamp-2 text-xs text-gray-400">{result.content}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className={`text-xs font-medium ${scoreColor}`}>{Math.round(result.score * 100)}%</span>
          {result.category && (
            <span className="rounded-full bg-purple-500/20 px-2 py-0.5 text-xs text-purple-300">{result.category}</span>
          )}
        </div>
      </div>
    </button>
  );
}

export default function App() {
  const [state, setState] = useState<SmartSearchState>({
    isLoading: false,
    isVisible: false,
    results: [],
    query: '',
    courseId: null,
    error: null,
    errorType: null,
    message: null,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const shadowRootRef = useRef<HTMLElement | null>(null);

  // Find the shadow DOM root element on mount
  useEffect(() => {
    const rootElement = document.getElementById('edstem-smart-search');
    if (rootElement) {
      shadowRootRef.current = rootElement;
      console.log('[EdStem Smart Search] Found shadow DOM root:', rootElement);
    } else {
      console.warn('[EdStem Smart Search] Shadow DOM root not found!');
    }
  }, []);

  // Extract course ID from URL
  const getCourseIdFromUrl = useCallback(() => {
    const match = window.location.pathname.match(/\/courses\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }, []);

  // Extract and store course ID when component mounts
  useEffect(() => {
    const courseId = getCourseIdFromUrl();
    if (courseId) {
      // Store course ID in background script storage
      chrome.runtime
        .sendMessage({
          type: MESSAGE_TYPES.SET_COURSE_ID,
          courseId: courseId,
        })
        .catch(err => {
          console.error('[EdStem Smart Search] Failed to store course ID:', err);
        });

      // Also update local state
      setState(prev => ({
        ...prev,
        courseId: courseId,
      }));
    }
  }, [getCourseIdFromUrl]);

  // Navigate to thread
  const navigateToThread = useCallback(
    (threadId: number) => {
      const courseId = state.courseId || getCourseIdFromUrl();
      if (courseId) {
        window.location.href = `https://edstem.org/us/courses/${courseId}/discussion/${threadId}`;
      }
    },
    [state.courseId, getCourseIdFromUrl],
  );

  // Listen for messages from background script
  useEffect(() => {
    const handleMessage = (
      message: { type: string; [key: string]: unknown },
      _sender: unknown,
      sendResponse: (response?: unknown) => void,
    ) => {
      console.log('[EdStem Smart Search] Content UI received message:', {
        type: message.type,
        hasResults: !!(message.results as SearchResult[])?.length,
        resultCount: (message.results as SearchResult[])?.length || 0,
        fullMessage: message,
      });

      switch (message.type) {
        case MESSAGE_TYPES.SEARCH_QUERY:
          // New search started - show loading state
          const query = (message.query as string) || '';
          if (query.trim()) {
            // Valid query - show loading state
            setState(prev => ({
              ...prev,
              isLoading: true,
              isVisible: true,
              query: query,
              courseId: message.courseId as number,
              results: [],
              error: null,
              errorType: null,
              message: null,
            }));
            // Reset mounted flag to allow remounting
            mountedRef.current = false;
          } else {
            // Empty query - hide results
            setState(prev => ({
              ...prev,
              isVisible: false,
              isLoading: false,
              query: '',
              results: [],
            }));
          }
          break;

        case MESSAGE_TYPES.SMART_SEARCH_RESULTS:
          // Results received
          const results = (message.results as SearchResult[]) || [];
          const error = (message.error as string) || null;
          const msg = (message.message as string) || null;

          console.log('[EdStem Smart Search] Received search results:', {
            resultCount: results.length,
            hasError: !!error,
            hasMessage: !!msg,
            results: results,
            fullMessage: message,
          });

          // Only show if we have valid results (score >= 0.75 already filtered by backend)
          // or if there's an error/message to display
          const hasValidResults = results.length > 0;
          const shouldShow = hasValidResults || !!error || !!msg;

          console.log('[EdStem Smart Search] Setting visibility:', {
            shouldShow,
            hasValidResults,
            resultCount: results.length,
            error,
            msg,
            willSetVisible: shouldShow,
          });

          setState(prev => {
            const newState = {
              ...prev,
              isLoading: false,
              results: results,
              error: error,
              errorType: (message.errorType as string) || null,
              message: msg,
              isVisible: shouldShow,
            };
            console.log('[EdStem Smart Search] New state after update:', {
              isVisible: newState.isVisible,
              resultCount: newState.results.length,
              isLoading: newState.isLoading,
            });
            return newState;
          });
          break;
      }
    };

    console.log('[EdStem Smart Search] Setting up message listener');
    chrome.runtime.onMessage.addListener(handleMessage);
    console.log('[EdStem Smart Search] Message listener registered');

    return () => {
      console.log('[EdStem Smart Search] Removing message listener');
      chrome.runtime.onMessage.removeListener(handleMessage);
    };
  }, []);

  // Find and mount to EdStem's search results container
  useEffect(() => {
    if (!state.isVisible) return;

    // Get the shadow DOM root element (created by initAppWithShadow)
    const rootElement = document.getElementById('edstem-smart-search');
    if (!rootElement) {
      console.warn('[EdStem Smart Search] Shadow DOM root not found, waiting...');
      return;
    }

    const findAndMount = () => {
      // Multiple selector strategies to find EdStem's search results container
      const searchContainerSelectors = [
        '[data-test-id="search-modal"]',
        '[data-test-id="search-results"]',
        '.search-overlay',
        '[class*="SearchModal"]',
        '[class*="search-modal"]',
        '[class*="SearchOverlay"]',
        '[role="dialog"]', // Search modals often use dialog role
      ];

      const resultsListSelectors = [
        '[class*="results"]',
        '[class*="Results"]',
        'ul[role="listbox"]',
        'ul[role="list"]',
        '[class*="list"]',
        '[class*="List"]',
        'ul',
        'ol',
      ];

      let searchContainer: Element | null = null;
      let resultsList: Element | null = null;

      // Try to find the search container
      for (const selector of searchContainerSelectors) {
        searchContainer = document.querySelector(selector);
        if (searchContainer) {
          console.log('[EdStem Smart Search] Found search container:', selector);
          break;
        }
      }

      // If no specific container found, look for any container with search-related content
      if (!searchContainer) {
        // Look for elements that might contain search results
        const allContainers = document.querySelectorAll(
          '[class*="search"], [class*="Search"], [id*="search"], [id*="Search"]',
        );
        for (const container of allContainers) {
          // Check if it has list-like children (likely results)
          if (container.querySelector('ul, ol, [role="listbox"], [role="list"]')) {
            searchContainer = container;
            console.log('[EdStem Smart Search] Found search container via fallback');
            break;
          }
        }
      }

      // Find the results list within the container
      if (searchContainer) {
        for (const selector of resultsListSelectors) {
          resultsList = searchContainer.querySelector(selector);
          if (resultsList) {
            console.log('[EdStem Smart Search] Found results list:', selector);
            break;
          }
        }

        // If no results list found, use the container itself or its first child
        if (!resultsList) {
          resultsList = searchContainer.firstElementChild || searchContainer;
        }
      }

      // Mount our shadow DOM root element (not the inner containerRef)
      // The shadow DOM root is the element with id 'edstem-smart-search'
      const rootElement = shadowRootRef.current || document.getElementById('edstem-smart-search');

      if (searchContainer && rootElement && resultsList) {
        const currentParent = rootElement.parentElement;
        const targetParent = resultsList.parentElement || searchContainer;

        // Only mount if not already in the right place
        if (currentParent !== targetParent) {
          // Remove from old location if exists
          if (currentParent) {
            currentParent.removeChild(rootElement);
          }

          // Insert before the results list (or as first child if no list)
          if (resultsList.parentElement) {
            resultsList.parentElement.insertBefore(rootElement, resultsList);
            console.log('[EdStem Smart Search] Successfully mounted shadow root before results list');
          } else {
            searchContainer.insertBefore(rootElement, searchContainer.firstChild);
            console.log('[EdStem Smart Search] Successfully mounted shadow root as first child');
          }

          mountedRef.current = true;
          console.log('[EdStem Smart Search] Successfully mounted to DOM');
        } else if (currentParent === targetParent) {
          // Already mounted in the right place
          mountedRef.current = true;
          console.log('[EdStem Smart Search] Already mounted in correct location');
        }
      } else {
        // If we can't find the right container, log for debugging
        if (!rootElement) {
          console.error('[EdStem Smart Search] Shadow DOM root element not found!');
        } else if (!searchContainer) {
          console.warn('[EdStem Smart Search] Could not find search container');
        } else if (!resultsList) {
          console.warn('[EdStem Smart Search] Could not find results list');
        }
      }
    };

    // Try to mount immediately
    findAndMount();

    // Also observe DOM changes to handle dynamic search modal appearance
    const observer = new MutationObserver(() => {
      // Reset mounted flag if our root element was removed
      const rootElement = document.getElementById('edstem-smart-search');
      if (rootElement && !rootElement.parentElement) {
        mountedRef.current = false;
      }
      // Try to mount again if visible but not mounted
      if (state.isVisible && !mountedRef.current) {
        findAndMount();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => {
      observer.disconnect();
      // Don't remove the container on unmount - let it persist if search modal is still open
    };
  }, [state.isVisible]);

  // Debug logging
  useEffect(() => {
    console.log('[EdStem Smart Search] Component state changed:', {
      isVisible: state.isVisible,
      isLoading: state.isLoading,
      resultCount: state.results.length,
      query: state.query,
      error: state.error,
      message: state.message,
      mounted: mountedRef.current,
      hasContainer: !!containerRef.current,
      containerParent: containerRef.current?.parentElement,
    });
  }, [state.isVisible, state.isLoading, state.results.length, state.query, state.error, state.message]);

  // Don't render if not visible
  if (!state.isVisible) {
    console.log('[EdStem Smart Search] Component not visible, returning null. State:', {
      isVisible: state.isVisible,
      resultCount: state.results.length,
      hasError: !!state.error,
      hasMessage: !!state.message,
    });
    return null;
  }

  console.log('[EdStem Smart Search] Rendering component with', state.results.length, 'results');

  return (
    <div
      ref={containerRef}
      className="edstem-smart-search mb-4 rounded-xl border border-purple-500/30 bg-[#1a1a2e] p-4 shadow-lg"
      role="region"
      aria-label="Smart Search Results"
      aria-live="polite">
      {/* Header */}
      <div className="mb-3 flex items-center gap-2">
        <span className="text-lg">✨</span>
        <h3 className="text-sm font-semibold text-purple-300">Smart Matches (AI)</h3>
        {state.isLoading && <span className="ml-auto animate-pulse text-xs text-gray-400">Searching deeper...</span>}
      </div>

      {/* Content */}
      {state.isLoading ? (
        <SkeletonLoader />
      ) : state.error ? (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <p className="text-sm text-red-400">{state.error}</p>
          {state.errorType === 'not_indexed' && (
            <button
              onClick={() => {
                // Open extension popup to trigger sync
                chrome.runtime.sendMessage({ type: 'OPEN_POPUP' }).catch(() => {
                  // Fallback: show message to user
                  alert('Please click the extension icon in your browser toolbar to sync this course.');
                });
              }}
              className="mt-2 text-xs text-red-300 underline hover:text-red-200">
              Sync this course →
            </button>
          )}
        </div>
      ) : state.message ? (
        <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 p-3">
          <p className="text-sm text-yellow-400">{state.message}</p>
        </div>
      ) : state.results.length > 0 ? (
        <div className="space-y-2" role="listbox" aria-label="Smart search results">
          {state.results.map(result => (
            <SearchResultItem
              key={result.id}
              result={result}
              courseId={state.courseId}
              onClick={() => navigateToThread(result.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg bg-gray-700/30 p-3">
          <p className="text-sm text-gray-400">No semantic matches found for this query.</p>
        </div>
      )}

      {/* Footer */}
      {state.query && (
        <div className="mt-3 border-t border-gray-700 pt-2">
          <p className="text-xs text-gray-500">
            Query: "<span className="text-gray-400">{state.query}</span>"
          </p>
        </div>
      )}
    </div>
  );
}
