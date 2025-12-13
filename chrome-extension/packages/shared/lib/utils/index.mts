import { StrictMode, type ReactNode, createElement } from 'react';
import { createRoot } from 'react-dom/client';

export type ManifestType = chrome.runtime.ManifestV3;

interface InitAppOptions {
  id: string;
  app: ReactNode;
  inlineCss?: string;
}

/**
 * Initialize a React app inside a Shadow DOM for content scripts.
 * This isolates the extension's styles from the host page.
 */
export function initAppWithShadow({ id, app, inlineCss }: InitAppOptions): void {
  // Don't initialize if already exists
  if (document.getElementById(id)) {
    console.log(`[${id}] Already initialized`);
    return;
  }

  // Create container element
  const container = document.createElement('div');
  container.id = id;

  // Create shadow DOM for style isolation
  const shadowRoot = container.attachShadow({ mode: 'open' });

  // Add inline CSS if provided
  if (inlineCss) {
    const style = document.createElement('style');
    style.textContent = inlineCss;
    shadowRoot.appendChild(style);
  }

  // Create root element for React
  const rootElement = document.createElement('div');
  rootElement.id = `${id}-root`;
  shadowRoot.appendChild(rootElement);

  // Mount to DOM
  document.body.appendChild(container);

  // Create React root and render
  const root = createRoot(rootElement);
  root.render(createElement(StrictMode, null, app));

  console.log(`[${id}] Initialized with Shadow DOM`);
}

/**
 * Initialize a React app without Shadow DOM (for popups, options, etc.)
 */
export function initApp({ id, app }: Omit<InitAppOptions, 'inlineCss'>): void {
  const rootElement = document.getElementById(id);
  if (!rootElement) {
    console.error(`[${id}] Root element not found`);
    return;
  }

  const root = createRoot(rootElement);
  root.render(createElement(StrictMode, null, app));

  console.log(`[${id}] Initialized`);
}
