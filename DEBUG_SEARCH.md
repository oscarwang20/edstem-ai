# Debugging Search Feature

## Issue: No search logs appearing

The search feature uses Chrome's `webRequest` API which runs in the **background service worker**, not the content script. Logs appear in a different console.

## Steps to Debug

### 1. Check Background Script Console

1. Open Chrome Extensions page: `chrome://extensions/`
2. Find "EdStem Smart Search" extension
3. Click **"service worker"** link (or "Inspect views: service worker")
4. This opens the **background script console** (different from page console!)

You should see logs like:
```
[EdStem Smart Search] Background service worker initialized
[EdStem Smart Search] Listening for EdStem API requests...
[EdStem Smart Search] Registering webRequest listener for: https://*.edstem.org/api/*
```

### 2. Test Search Interception

1. Go to an EdStem course discussion page
2. Type in the search bar
3. Check the **background script console** (not page console) for:
   ```
   [EdStem Smart Search] Intercepted API request: https://us.edstem.org/api/courses/...
   [EdStem Smart Search] Search request detected: { query: "...", courseId: ... }
   ```

### 3. Verify Extension is Loaded

In the background script console, you should see:
- `[EdStem Smart Search] Background service worker initialized`
- `[EdStem Smart Search] webRequest API is available`

If you see "webRequest API is NOT available", the manifest might not be loading correctly.

### 4. Check Network Tab

1. Open DevTools on the EdStem page
2. Go to **Network** tab
3. Type in search bar
4. Look for requests to `https://us.edstem.org/api/courses/*/search*`
5. Verify these requests are being made

### 5. Reload Extension

If nothing appears:
1. Go to `chrome://extensions/`
2. Click **reload** button on the extension
3. Refresh the EdStem page
4. Try searching again

## Common Issues

### Issue: No logs in background console
- **Solution**: Extension might not be loaded. Reload it.

### Issue: "webRequest API is NOT available"
- **Solution**: Check manifest.json has `"webRequest"` in permissions
- **Solution**: Rebuild extension: `pnpm build`

### Issue: API requests not being intercepted
- **Solution**: Check URL pattern matches: `https://*.edstem.org/api/*`
- **Solution**: Verify you're on an EdStem page (not localhost)
- **Solution**: Check Network tab to see if requests are actually being made

### Issue: Content script not receiving messages
- **Solution**: Check content script console (page console) for:
  ```
  [EdStem Smart Search] Content UI received message: SEARCH_QUERY
  ```
- **Solution**: Verify content script is injected (check Sources tab in DevTools)

## Quick Test

1. Open background script console (`chrome://extensions/` → service worker)
2. Type in EdStem search bar
3. You should immediately see: `[EdStem Smart Search] Intercepted API request: ...`
4. If you don't see this, the webRequest listener isn't working

## Next Steps

If logs still don't appear:
1. Share what you see in the background script console
2. Share what you see in the Network tab when searching
3. Verify the extension ID matches what's in the console errors

