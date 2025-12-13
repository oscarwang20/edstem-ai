export const PROJECT_URL_OBJECT = {
  url: 'https://github.com/oscarwang20/edstem-ai',
} as const;

// Backend configuration
export const BACKEND_URL = 'http://localhost:8000';

// Message types for communication between components
export const MESSAGE_TYPES = {
  SEARCH_QUERY: 'SEARCH_QUERY',
  AUTH_TOKEN_CAPTURED: 'AUTH_TOKEN_CAPTURED',
  SYNC_COURSE: 'SYNC_COURSE',
  GET_SYNC_STATUS: 'GET_SYNC_STATUS',
  CHECK_BACKEND: 'CHECK_BACKEND',
  GET_STATE: 'GET_STATE',
  SMART_SEARCH_RESULTS: 'SMART_SEARCH_RESULTS',
} as const;

// Storage keys
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'edstem_auth_token',
  COURSE_ID: 'current_course_id',
  BACKEND_STATUS: 'backend_status',
  SYNC_STATUS: 'sync_status',
} as const;
