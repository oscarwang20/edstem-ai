import { createStorage, StorageEnum } from '../base/index.js';

// EdStem Smart Search specific storage types
export interface EdStemStateType {
  authToken: string | null;
  courseId: number | null;
  backendStatus: 'connected' | 'disconnected' | 'unknown';
}

// Create EdStem storage
const storage = createStorage<EdStemStateType>(
  'edstem-smart-search-storage',
  {
    authToken: null,
    courseId: null,
    backendStatus: 'unknown',
  },
  {
    storageEnum: StorageEnum.Local,
    liveUpdate: true,
  }
);

export const edStemStorage = {
  ...storage,
  setAuthToken: async (token: string | null) => {
    await storage.set(current => ({
      ...current,
      authToken: token,
    }));
  },
  setCourseId: async (courseId: number | null) => {
    await storage.set(current => ({
      ...current,
      courseId,
    }));
  },
  setBackendStatus: async (status: 'connected' | 'disconnected' | 'unknown') => {
    await storage.set(current => ({
      ...current,
      backendStatus: status,
    }));
  },
};
