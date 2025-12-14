# Search Feature Implementation Plan

## Current State Analysis

### ✅ What's Working
1. **Background Script**: Intercepts EdStem search API calls via `chrome.webRequest`
2. **Data Extraction**: Successfully extracts `query`, `course_id`, and `auth_token`
3. **Backend Integration**: Calls `/search` endpoint and receives results
4. **Content Script**: Has UI components (skeleton loader, result items, error states)
5. **Message Passing**: Background ↔ Content script communication works

### ❌ What's Missing/Broken
1. **No Debouncing**: Searches fire on every API call (user types → EdStem fires API → we search immediately)
2. **DOM Mounting Issues**: The `findAndMount()` logic may not reliably find EdStem's search results container
3. **Score Threshold**: Not properly hiding results when score < 0.75 (PRD requirement)
4. **Visibility Logic**: Component may not be showing/hiding at the right times
5. **Error Handling**: Could provide better user feedback

---

## Implementation Plan

### Phase 1: Debouncing (Priority: HIGH)

**Problem**: Every keystroke triggers an EdStem API call, which triggers our search immediately. This causes:
- Too many API calls
- Results flickering as user types
- Poor UX

**Solution**: Add 300ms debounce in background script before calling `performSemanticSearch()`.

**Implementation**:
```typescript
// In background/index.ts
let searchDebounceTimer: number | null = null;

// In webRequest listener, when search detected:
if (searchDebounceTimer) {
  clearTimeout(searchDebounceTimer);
}

searchDebounceTimer = setTimeout(() => {
  performSemanticSearch(query, courseId);
  searchDebounceTimer = null;
}, 300);
```

**Files to Modify**:
- `chrome-extension/chrome-extension/src/background/index.ts`

---

### Phase 2: Fix DOM Mounting (Priority: HIGH)

**Problem**: The current `findAndMount()` uses generic selectors that may not match EdStem's actual DOM structure. The component needs to reliably inject above native results.

**Solution**: 
1. Use more robust selectors based on EdStem's actual structure
2. Add multiple fallback strategies
3. Use `MutationObserver` more effectively
4. Add logging to debug mounting issues

**Implementation Strategy**:
1. **Inspect EdStem DOM**: First, we need to identify the actual selectors EdStem uses for search results
2. **Multiple Selector Strategy**: Try multiple selector patterns in order:
   - `[data-test-id="search-results"]`
   - `.search-results-container`
   - `ul[role="listbox"]` (common for search results)
   - Any container with `results` in class name
3. **Injection Point**: Insert our component as the **first child** of the results container, or as a **sibling before** the results list
4. **Persistence**: Once mounted, don't remount unless container is removed

**Files to Modify**:
- `chrome-extension/pages/content-ui/src/matches/edstem/App.tsx`

**Key Changes**:
```typescript
// Better selector strategy
const searchSelectors = [
  '[data-test-id="search-results"]',
  '[data-test-id="search-modal"] .results',
  '.search-results',
  'ul[role="listbox"]',
  '[class*="Results"]',
  '[class*="results"]'
];

// Try each selector
for (const selector of searchSelectors) {
  const container = document.querySelector(selector);
  if (container) {
    // Inject here
    break;
  }
}
```

---

### Phase 3: Score Threshold & Visibility (Priority: MEDIUM)

**Problem**: PRD states results should be hidden if semantic score < 0.75 to reduce noise. Current code shows results regardless of score.

**Solution**: 
1. Backend already filters by `min_score` (default 0.5), but we should use 0.75 for UI
2. Update visibility logic to hide when no results or all results below threshold
3. Show helpful message when threshold not met

**Implementation**:
```typescript
// In App.tsx, update visibility logic
const hasValidResults = state.results.length > 0 && 
  state.results.some(r => r.score >= 0.75);

setState(prev => ({
  ...prev,
  isVisible: hasValidResults || !!state.error || !!state.message,
}));
```

**Files to Modify**:
- `chrome-extension/pages/content-ui/src/matches/edstem/App.tsx`
- `chrome-extension/chrome-extension/src/background/index.ts` (update min_score param)

---

### Phase 4: Error Handling & User Feedback (Priority: MEDIUM)

**Problem**: Errors may not be clearly communicated to users. Need better feedback.

**Solution**:
1. Distinguish between different error types:
   - Backend disconnected
   - Course not indexed
   - Network error
   - No results (different from error)
2. Show appropriate messages
3. Add retry mechanism for transient errors

**Implementation**:
```typescript
// Error types
enum ErrorType {
  BACKEND_DISCONNECTED = 'backend_disconnected',
  NOT_INDEXED = 'not_indexed',
  NETWORK_ERROR = 'network_error',
  UNKNOWN = 'unknown'
}

// In error display
{state.error && (
  <div className="error-container">
    {state.errorType === ErrorType.NOT_INDEXED && (
      <p>Course not indexed. <button onClick={triggerSync}>Sync now</button></p>
    )}
    {/* ... other error types */}
  </div>
)}
```

**Files to Modify**:
- `chrome-extension/pages/content-ui/src/matches/edstem/App.tsx`
- `chrome-extension/chrome-extension/src/background/index.ts`

---

### Phase 5: Testing & Verification (Priority: HIGH)

**Test Cases**:
1. ✅ Type in search bar → skeleton appears immediately
2. ✅ Stop typing → after 300ms, search executes
3. ✅ Results appear above native results
4. ✅ Low-score results (< 0.75) are hidden
5. ✅ Empty query doesn't trigger search
6. ✅ Error states display correctly
7. ✅ Component unmounts when search modal closes

**Debugging Tools**:
- Add console.log statements at key points
- Use React DevTools to inspect component state
- Use Chrome DevTools Network tab to verify API calls
- Inspect DOM to verify injection point

---

## Implementation Order

1. **Phase 1 (Debouncing)** - Quick win, prevents API spam
2. **Phase 2 (DOM Mounting)** - Critical for visibility
3. **Phase 3 (Score Threshold)** - Improves UX
4. **Phase 4 (Error Handling)** - Polish
5. **Phase 5 (Testing)** - Ongoing throughout

---

## Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **300ms debounce** | PRD requirement, balances responsiveness vs API calls |
| **Score threshold 0.75** | PRD requirement, reduces noise from low-quality matches |
| **Inject above native results** | PRD requirement, maintains visual hierarchy |
| **Skeleton loader** | PRD requirement, masks 1-2s latency |
| **Hide on empty/low scores** | PRD requirement, reduces UI clutter |

---

## Success Criteria

- [ ] Search results appear within 1.5s of user stopping typing
- [ ] Results appear above native EdStem results
- [ ] Only results with score ≥ 0.75 are shown
- [ ] Skeleton loader appears immediately when search starts
- [ ] No flickering or UI jumps
- [ ] Errors are clearly communicated
- [ ] Component properly mounts/unmounts with search modal

---

## Next Steps

1. Start with Phase 1 (Debouncing) - simplest and highest impact
2. Then Phase 2 (DOM Mounting) - most critical for functionality
3. Test thoroughly after each phase
4. Iterate based on real-world EdStem DOM structure

