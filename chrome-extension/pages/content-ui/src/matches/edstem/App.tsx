import { useEffect, useState, useCallback, useRef } from 'react';

// Message types (must match background script)
const MESSAGE_TYPES = {
  SEARCH_QUERY: 'SEARCH_QUERY',
  SMART_SEARCH_RESULTS: 'SMART_SEARCH_RESULTS',
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
  message: string | null;
}

// Skeleton loader component
function SkeletonLoader() {
  return (
    <div className="space-y-3 animate-pulse">
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
        <div className="flex-1 min-w-0">
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
    message: null,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);

  // Extract course ID from URL
  const getCourseIdFromUrl = useCallback(() => {
    const match = window.location.pathname.match(/\/courses\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }, []);

  // Navigate to thread
  const navigateToThread = useCallback(
    (threadId: number) => {
      const courseId = state.courseId || getCourseIdFromUrl();
      if (courseId) {
        window.location.href = `https://edstem.org/us/courses/${courseId}/discussion/${threadId}`;
      }
    },
    [state.courseId, getCourseIdFromUrl]
  );

  // Listen for messages from background script
  useEffect(() => {
    const handleMessage = (message: { type: string; [key: string]: unknown }) => {
      console.log('[EdStem Smart Search] Content UI received message:', message.type);

      switch (message.type) {
        case MESSAGE_TYPES.SEARCH_QUERY:
          // New search started - show loading state
          setState(prev => ({
            ...prev,
            isLoading: true,
            isVisible: true,
            query: message.query as string,
            courseId: message.courseId as number,
            results: [],
            error: null,
            message: null,
          }));
          break;

        case MESSAGE_TYPES.SMART_SEARCH_RESULTS:
          // Results received
          setState(prev => ({
            ...prev,
            isLoading: false,
            results: (message.results as SearchResult[]) || [],
            error: (message.error as string) || null,
            message: (message.message as string) || null,
            // Hide if no results and score threshold wasn't met
            isVisible: ((message.results as SearchResult[]) || []).length > 0 || !!message.error || !!message.message,
          }));
          break;
      }
    };

    chrome.runtime.onMessage.addListener(handleMessage);
    return () => chrome.runtime.onMessage.removeListener(handleMessage);
  }, []);

  // Find and mount to EdStem's search results container
  useEffect(() => {
    if (mountedRef.current) return;

    const findAndMount = () => {
      // Look for the search modal/dropdown in EdStem
      // The search results appear in a modal overlay
      const searchContainer = document.querySelector('[data-test-id="search-modal"]') || document.querySelector('.search-overlay') || document.querySelector('[class*="SearchModal"]');

      if (searchContainer && containerRef.current) {
        // Find the results list
        const resultsList = searchContainer.querySelector('[class*="results"]') || searchContainer.querySelector('ul') || searchContainer.querySelector('[class*="list"]');

        if (resultsList && containerRef.current.parentElement !== resultsList.parentElement) {
          // Insert our container before the native results
          resultsList.parentElement?.insertBefore(containerRef.current, resultsList);
          mountedRef.current = true;
        }
      }
    };

    // Observe DOM changes to detect search modal appearing
    const observer = new MutationObserver(() => {
      if (state.isVisible) {
        findAndMount();
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    return () => observer.disconnect();
  }, [state.isVisible]);

  // Don't render if not visible
  if (!state.isVisible) {
    return null;
  }

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
        {state.isLoading && <span className="text-xs text-gray-400 ml-auto animate-pulse">Searching deeper...</span>}
      </div>

      {/* Content */}
      {state.isLoading ? (
        <SkeletonLoader />
      ) : state.error ? (
        <div className="rounded-lg bg-red-500/10 border border-red-500/30 p-3">
          <p className="text-sm text-red-400">{state.error}</p>
        </div>
      ) : state.message ? (
        <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/30 p-3">
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
