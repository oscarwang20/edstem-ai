type StorageType = 'local' | 'sync' | 'session';

interface StorageItem<T> {
  get: () => Promise<T>;
  set: (value: T) => Promise<void>;
  subscribe: (callback: (value: T) => void) => () => void;
}

/**
 * Create a storage item wrapper for Chrome extension storage
 */
export function createStorage<T>(key: string, defaultValue: T, storageType: StorageType = 'local'): StorageItem<T> {
  const storage = chrome.storage[storageType];

  return {
    async get(): Promise<T> {
      const result = await storage.get(key);
      return result[key] ?? defaultValue;
    },

    async set(value: T): Promise<void> {
      await storage.set({ [key]: value });
    },

    subscribe(callback: (value: T) => void): () => void {
      const listener = (changes: { [key: string]: chrome.storage.StorageChange }) => {
        if (changes[key]) {
          callback(changes[key].newValue ?? defaultValue);
        }
      };

      storage.onChanged.addListener(listener);
      return () => storage.onChanged.removeListener(listener);
    },
  };
}

// Theme storage for the extension
export const exampleThemeStorage = createStorage<'light' | 'dark'>('theme', 'light', 'local');

// EdStem Smart Search specific storage
export const edStemStorage = {
  authToken: createStorage<string | null>('edstem_auth_token', null, 'local'),
  courseId: createStorage<number | null>('current_course_id', null, 'local'),
  backendStatus: createStorage<'connected' | 'disconnected' | 'unknown'>('backend_status', 'unknown', 'local'),
  syncStatus: createStorage<Record<number, { status: string; message?: string; progress?: number; total?: number }>>(
    'sync_status',
    {},
    'local'
  ),
};
