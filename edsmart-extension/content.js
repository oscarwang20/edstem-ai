(function () {
  if (document.getElementById('edsmart-search-container')) return;

  // Create container
  const container = document.createElement('div');
  container.id = 'edsmart-search-container';
  container.innerHTML = `
		<form id="edsmart-search-form" role="search" aria-label="EdSmart semantic search">
			<div id="edsmart-search-bar">
				<input id="edsmart-input" type="search" placeholder="Search threads 
        (semantically)" aria-label="EdSmart search" />
				<button id="edsmart-button" type="submit">Search</button>
			</div>
		</form>
		<div id="edsmart-results" aria-live="polite"></div>
	`;

  // Mounting: try native search input, header controls
  try {
    const selectors = [
      'input[placeholder="Search"]',
      'input[placeholder*="Search"]',
      'input[type="search"]',
      'input[aria-label*="search"]',
      'input[role="search"]',
    ];

    let nativeSearchInput = null;
    for (const s of selectors) {
      const el = document.querySelector(s);
      if (el) {
        nativeSearchInput = el;
        console.debug('EdSmart: found native search input', s);
        break;
      }
    }

    let mounted = false;
    if (nativeSearchInput) {
      const headerTarget = nativeSearchInput.closest('form') || nativeSearchInput.parentElement;
      if (headerTarget && headerTarget.parentElement) {
        headerTarget.parentElement.insertBefore(container, headerTarget.nextSibling);
        mounted = true;
        console.debug('EdSmart: mounted next to native search');
      }
    }

    if (!mounted) {
      const siteHeader = document.querySelector('header');
      if (siteHeader) {
        const rightControls = siteHeader.querySelector(
          '.header-controls, .right-controls, .site-controls');
        if (rightControls) {
          rightControls.appendChild(container);
          mounted = true;
          console.debug('EdSmart: appended to header controls');
        } else {
          siteHeader.appendChild(container);
          mounted = true;
          console.debug('EdSmart: appended to header');
        }
      }
    }

    if (!mounted) {
      const fallback = document.querySelector('main') ||
        document.querySelector("[role='main']") || document.body;
      fallback.prepend(container);
      console.debug('EdSmart: prepended to fallback');
    }
  } catch (err) {
    console.error('EdSmart: mounting error', err);
    try {
      const fallback = document.querySelector('main') || document.querySelector("[role='main']") || document.body;
      fallback.prepend(container);
    } catch (e) {
      console.error('EdSmart: final fallback failed', e);
    }
  }


  container.style.display = container.style.display || 'inline-block';
  container.style.visibility = 'visible';
  const form = container.querySelector('#edsmart-search-form');
  const input = container.querySelector('#edsmart-input');
  const button = container.querySelector('#edsmart-button');
  const resultsDiv = container.querySelector('#edsmart-results');

  // Detect course id
  let courseId = '74827';
  try {
    const m = window.location.pathname.match(/courses\/(\d+)/);
    if (m && m[1]) courseId = m[1];
  } catch (e) {
  }

  // Helper to open a thread using Ed's native navigation when possible
  function openEdThread(threadId) {
    if (!threadId) return;


    const courseMatch = window.location.pathname.match(/courses\/(\d+)/);
    const course = courseMatch ? courseMatch[1] : courseId;
    const regionPrefix = window.location.pathname.startsWith('/us/') ? '/us' : '';
    const href = `${regionPrefix}/courses/${course}/discussion/${threadId}`;

    const link = document.querySelector(`a.discuss-feed-thread[href="${href}"]`);

    if (link) {
      const evt = new MouseEvent('click', {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
      });
      link.dispatchEvent(evt);
      return;
    }
    window.location.href = `${window.location.origin}${href}`;
  }

  async function runSearch(query) {
    const q = (query || input.value || '').trim();
    if (!q) return;
    resultsDiv.innerHTML = `<div class="edsmart-result">Searching...</div>`;
    try {
      const res = await fetch(`http://localhost:8000/search?q=${encodeURIComponent(q)}&k=8&course_id=${encodeURIComponent(courseId)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const results = data.results || [];
      if (results.length === 0) {
        resultsDiv.innerHTML = `<div class="edsmart-result">No results found.</div>`;
        return;
      }
      resultsDiv.innerHTML = '';
      for (const r of results) {
        const div = document.createElement('div');
        div.className = 'edsmart-result';
        div.setAttribute('role', 'button');
        div.setAttribute('tabindex', '0');
        const simPct = (r.similarity * 100).toFixed(1);

        div.innerHTML = `
          <div class="edsmart-title-link">${r.title}</div>
          <div class="edsmart-snippet">${(r.content || '').slice(0, 180)}...</div>
          <div class="edsmart-sim">Similarity: ${simPct}%</div>
        `;

        const threadId = r.id;
        const threadNumber = r.number;

        div.addEventListener('click', (e) => {
          e.preventDefault();
          openEdThread(threadId);
        });
        div.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openEdThread(threadId);
          }
        });

        resultsDiv.appendChild(div);
      }
    } catch (err) {
      console.error('EdSmart search error:', err);
      resultsDiv.innerHTML = `<div class="edsmart-result">Error: ${err.message}</div>`;
    }
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch(input.value);
  });

  button.addEventListener('click', () => runSearch(input.value));

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      runSearch(input.value);
    }
  });

  // Close results when clicking outside
  document.addEventListener('click', (e) => {
    if (!container.contains(e.target)) {
      resultsDiv.innerHTML = '';
    }
  });

})();

