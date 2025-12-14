import '@src/Popup.css';
import { useState, useEffect, useCallback } from 'react';

// Message types (must match background script)
const MESSAGE_TYPES = {
  SYNC_COURSE: 'SYNC_COURSE',
  GET_SYNC_STATUS: 'GET_SYNC_STATUS',
  GET_STATE: 'GET_STATE',
};

interface ExtensionState {
  authToken: string | null;
  courseId: number | null;
  backendConnected: boolean;
  indexStats: {
    course_stats?: {
      indexed_threads: number;
    };
  } | null;
}

interface SyncStatus {
  status: 'starting' | 'fetching' | 'processing' | 'indexing' | 'completed' | 'error' | 'unknown';
  message?: string;
  progress?: number;
  total?: number;
}

function StatusBadge({ connected }: { connected: boolean }) {
  return (
    <div className={`flex items-center gap-2 rounded-full px-3 py-1 text-sm ${connected ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'}`}>
      <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-400' : 'bg-red-400'}`} />
      {connected ? 'Backend Connected' : 'Backend Disconnected'}
    </div>
  );
}

function SyncButton({
  onClick,
  isDisabled,
  syncStatus,
}: {
  onClick: () => void;
  isDisabled: boolean;
  syncStatus: SyncStatus | null;
}) {
  const isInProgress = syncStatus && ['starting', 'fetching', 'processing', 'indexing'].includes(syncStatus.status);

  return (
    <button
      onClick={onClick}
      disabled={isDisabled || isInProgress}
      className={`w-full rounded-lg px-4 py-3 font-medium transition-all ${
        isDisabled
          ? 'cursor-not-allowed bg-gray-700 text-gray-500'
          : isInProgress
            ? 'cursor-wait bg-purple-600/50 text-purple-200'
            : 'bg-purple-600 text-white hover:bg-purple-500 active:bg-purple-700'
      }`}>
      {isInProgress ? (
        <span className="flex items-center justify-center gap-2">
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          {syncStatus?.message || 'Syncing...'}
        </span>
      ) : (
        'Sync Current Course'
      )}
    </button>
  );
}

export default function Popup() {
  const [state, setState] = useState<ExtensionState | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Load extension state
  const loadState = useCallback(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: MESSAGE_TYPES.GET_STATE });
      setState(response as ExtensionState);

      if (response?.courseId) {
        const status = await chrome.runtime.sendMessage({
          type: MESSAGE_TYPES.GET_SYNC_STATUS,
          courseId: response.courseId,
        });
        setSyncStatus(status as SyncStatus);
      }
    } catch (error) {
      console.error('Failed to load state:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Poll for sync status updates
  useEffect(() => {
    loadState();

    const interval = setInterval(async () => {
      if (state?.courseId && syncStatus && ['starting', 'fetching', 'processing', 'indexing'].includes(syncStatus.status)) {
        try {
          const status = await chrome.runtime.sendMessage({
            type: MESSAGE_TYPES.GET_SYNC_STATUS,
            courseId: state.courseId,
          });
          setSyncStatus(status as SyncStatus);

          // Refresh full state when sync completes
          if (status.status === 'completed' || status.status === 'error') {
            loadState();
          }
        } catch (error) {
          console.error('Failed to get sync status:', error);
        }
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [loadState, state?.courseId, syncStatus?.status]);

  // Handle sync button click
  const handleSync = async () => {
    if (!state?.courseId) return;

    try {
      const response = await chrome.runtime.sendMessage({
        type: MESSAGE_TYPES.SYNC_COURSE,
        courseId: state.courseId,
        userToken: state.authToken || null,
      });

      if (response.success) {
        setSyncStatus({ status: 'starting', message: 'Starting sync...' });
      } else {
        setSyncStatus({ status: 'error', message: response.message });
      }
    } catch (error) {
      console.error('Failed to start sync:', error);
      setSyncStatus({ status: 'error', message: 'Failed to start sync' });
    }
  };

  if (isLoading) {
    return (
      <div className="flex h-64 w-80 items-center justify-center bg-[#0f172a]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-purple-500 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="w-80 bg-[#0f172a] p-4 text-white">
      {/* Header */}
      <div className="mb-4 flex items-center gap-3">
        <span className="text-2xl">✨</span>
        <div>
          <h1 className="text-lg font-bold text-white">EdStem Smart Search</h1>
          <p className="text-xs text-gray-400">AI-powered semantic search</p>
        </div>
      </div>

      {/* Status Section */}
      <div className="mb-4 space-y-3">
        <StatusBadge connected={state?.backendConnected ?? false} />

        {/* Course Info */}
        <div className="rounded-lg bg-gray-800/50 p-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-400">Current Course</span>
            <span className="font-mono text-sm text-white">
              {state?.courseId ? `#${state.courseId}` : 'Not detected'}
            </span>
          </div>
          {state?.indexStats?.course_stats && (
            <div className="mt-2 flex items-center justify-between border-t border-gray-700 pt-2">
              <span className="text-sm text-gray-400">Indexed Threads</span>
              <span className="text-sm font-medium text-purple-400">
                {state.indexStats.course_stats.indexed_threads}
              </span>
            </div>
          )}
        </div>

        {/* Sync Status */}
        {syncStatus && syncStatus.status !== 'unknown' && (
          <div
            className={`rounded-lg p-3 ${
              syncStatus.status === 'completed'
                ? 'bg-green-500/10 border border-green-500/30'
                : syncStatus.status === 'error'
                  ? 'bg-red-500/10 border border-red-500/30'
                  : 'bg-purple-500/10 border border-purple-500/30'
            }`}>
            <div className="flex items-center justify-between">
              <span
                className={`text-sm ${
                  syncStatus.status === 'completed'
                    ? 'text-green-400'
                    : syncStatus.status === 'error'
                      ? 'text-red-400'
                      : 'text-purple-400'
                }`}>
                {syncStatus.message || syncStatus.status}
              </span>
              {syncStatus.progress !== undefined && syncStatus.total !== undefined && (
                <span className="text-xs text-gray-400">
                  {syncStatus.progress}/{syncStatus.total}
                </span>
              )}
            </div>
            {syncStatus.progress !== undefined && syncStatus.total !== undefined && (
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-gray-700">
                <div
                  className="h-full rounded-full bg-purple-500 transition-all"
                  style={{ width: `${(syncStatus.progress / syncStatus.total) * 100}%` }}
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Sync Button */}
      <SyncButton
        onClick={handleSync}
        isDisabled={!state?.backendConnected || !state?.courseId}
        syncStatus={syncStatus}
      />

      {/* Help Text */}
      {!state?.authToken && state?.courseId && (
        <p className="mt-3 text-center text-xs text-gray-400">
          Using backend API key for syncing (user token not required)
        </p>
      )}

      {!state?.courseId && (
        <p className="mt-3 text-center text-xs text-gray-400">
          Navigate to an EdStem course discussion page to get started
        </p>
      )}

      {/* Footer */}
      <div className="mt-4 border-t border-gray-800 pt-3">
        <p className="text-center text-xs text-gray-500">
          Powered by Pinecone Vector Search
        </p>
      </div>
    </div>
  );
}
