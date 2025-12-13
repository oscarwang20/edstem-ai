import { readFileSync } from 'node:fs';
import type { ManifestType } from '@extension/shared';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

/**
 * EdStem Smart Search Extension Manifest
 *
 * This extension augments EdStem's native search with semantic vector search,
 * helping students find relevant discussion threads based on meaning rather than keywords.
 */
const manifest = {
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_extensionName__',
  browser_specific_settings: {
    gecko: {
      id: 'edstem-smart-search@example.com',
      strict_min_version: '109.0',
    },
  },
  version: packageJson.version,
  description: '__MSG_extensionDescription__',

  // Host permissions for EdStem API interception and backend
  host_permissions: ['https://*.edstem.org/*', 'http://localhost:8000/*'],

  permissions: [
    'storage',
    'scripting',
    'tabs',
    'webRequest', // For intercepting EdStem API calls
  ],

  options_page: 'options/index.html',

  background: {
    service_worker: 'background.js',
    type: 'module',
  },

  action: {
    default_popup: 'popup/index.html',
    default_icon: 'icon-34.png',
  },

  icons: {
    '128': 'icon-128.png',
  },

  // Content scripts - only inject on EdStem pages
  content_scripts: [
    {
      matches: ['https://edstem.org/us/courses/*/discussion*', 'https://us.edstem.org/courses/*/discussion*'],
      js: ['content-ui/edstem.iife.js'],
      css: ['content.css'],
      run_at: 'document_idle',
    },
  ],

  web_accessible_resources: [
    {
      resources: ['*.js', '*.css', '*.svg', 'icon-128.png', 'icon-34.png'],
      matches: ['https://*.edstem.org/*'],
    },
  ],
} satisfies ManifestType;

export default manifest;
