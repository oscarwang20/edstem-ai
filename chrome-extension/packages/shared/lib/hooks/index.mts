import { useState, useEffect, useCallback } from 'react';

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

/**
 * React hook for using Chrome extension storage
 */
export function useStorage<T>(storageItem: StorageItem<T>): {
  value: T | undefined;
  setValue: (value: T) => Promise<void>;
  isLoading: boolean;
  isLight?: boolean; // For theme compatibility
} {
  const [value, setValue] = useState<T | undefined>(undefined);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Load initial value
    storageItem.get().then(val => {
      setValue(val);
      setIsLoading(false);
    });

    // Subscribe to changes
    const unsubscribe = storageItem.subscribe(newValue => {
      setValue(newValue);
    });

    return unsubscribe;
  }, [storageItem]);

  const setValueAsync = useCallback(
    async (newValue: T) => {
      await storageItem.set(newValue);
      setValue(newValue);
    },
    [storageItem]
  );

  // Add isLight for theme compatibility (assuming value is a string like 'light' or 'dark')
  const isLight = typeof value === 'string' ? value === 'light' : undefined;

  return { value, setValue: setValueAsync, isLoading, isLight };
}

/**
 * Debounce hook for search inputs
 */
export function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Hook for sending messages to background script
 */
export function useBackgroundMessage() {
  const sendMessage = useCallback(async <T>(message: { type: string; [key: string]: unknown }): Promise<T> => {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response as T);
        }
      });
    });
  }, []);

  return { sendMessage };
}
