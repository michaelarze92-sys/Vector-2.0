// Cache name is derived from a hash of estate-pm.html's actual bytes, not a manually
// bumped string — forgetting to bump a version string can't leave anyone stuck on a
// stale cache, because there's no version string to forget.
const CACHE_PREFIX = 'estate-pm-';

const APP_SHELL = [
  './estate-pm.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

async function hashCacheName() {
  try {
    const res = await fetch('./estate-pm.html', { cache: 'no-store' });
    if (!res || !res.ok) throw new Error('estate-pm.html fetch failed: ' + (res && res.status));
    const buf = await res.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
    return CACHE_PREFIX + hex.slice(0, 16);
  } catch (e) {
    // Offline, or the network fetch failed. Without this fallback the promise rejects,
    // every `await cacheNamePromise` in the fetch handler rejects with it, and the app
    // fails to open at all — the exact situation installing a PWA is meant to survive.
    // Reuse whatever cache this device already has instead.
    const keys = await caches.keys();
    const existing = keys.filter((key) => key.startsWith(CACHE_PREFIX));
    return existing[0] || CACHE_PREFIX + 'bootstrap';
  }
}

// A module-level promise, not a stored value — the service worker can be terminated
// and restarted between events, which would lose an in-memory variable. Recomputing
// from the (deterministic) file contents converges on the same name every time
// instead of relying on state surviving a restart.
const cacheNamePromise = hashCacheName();

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(await cacheNamePromise);
      await cache.addAll(APP_SHELL);
    })()
  );
  // Don't self.skipWaiting() here — that would activate the new worker (and swap the
  // fetch handler) mid-session. Instead the page offers an "Update available" toast
  // and only sends SKIP_WAITING once the user chooses to reload.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const current = await cacheNamePromise;
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== current).map((key) => caches.delete(key))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener('message', (event) => {
  if (!event.data) return;
  if (event.data.type === 'SKIP_WAITING') { self.skipWaiting(); return; }
  if (event.data.type === 'CHECK_CONTENT_UPDATE') {
    event.waitUntil((async () => {
      const cache = await caches.open(await cacheNamePromise);
      const flag = await cache.match(FLAG_URL);
      if (flag && event.source) event.source.postMessage({ type: 'CONTENT_UPDATED' });
    })());
  }
});

// A *persisted* flag, not just a postMessage. The background revalidation that spots
// new content runs during a navigation — before the incoming page has attached its
// message listener — so a message alone is sent into the void and the prompt never
// appears. Storing it in the cache lets the page ask once it is actually ready.
const FLAG_URL = './__content-update__';

// Both halves are needed, and they cover opposite races:
//   - the flag catches a change detected *before* the page was ready to ask
//   - the broadcast catches one detected *after* it already asked
// With only one of the two, whether the prompt appears depends on whether the
// background revalidation happens to beat the page's load. It usually doesn't.
async function setContentUpdateFlag(cache, updated) {
  if (updated) {
    await cache.put(FLAG_URL, new Response('1'));
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach((client) => client.postMessage({ type: 'CONTENT_UPDATED' }));
  } else {
    await cache.delete(FLAG_URL);
  }
}

// Stale-while-revalidate: serve from cache instantly (works offline), refresh
// the cache from the network in the background for next time.
//
// When the background refresh finds the app HTML has actually changed, tell the open
// page so it can offer the same "Update available" prompt a service-worker update
// gets. Without this, a deploy that changes only estate-pm.html never prompts —
// the browser only byte-diffs sw.js — and an installed PWA can sit on the old
// version until its worker happens to restart. That is exactly what happened once;
// don't remove this and go back to relying on the next page load.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const isAppHtml = event.request.mode === 'navigate' ||
    new URL(event.request.url).pathname.endsWith('estate-pm.html');

  // Hold the worker open until the background revalidation finishes. respondWith()
  // settles the moment the cached copy is handed over, and the browser is then free to
  // terminate the worker mid-flight — killing the very refresh stale-while-revalidate
  // relies on. That is not theoretical: it left an installed PWA serving a stale build
  // indefinitely, because the cache was never actually written. waitUntil must be
  // called synchronously here, while the event is still dispatching.
  let finishBackground;
  event.waitUntil(new Promise((resolve) => { finishBackground = resolve; }));

  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(await cacheNamePromise);
        const cached = await cache.match(event.request);
        // Clone the instant we have it, before `cached` is handed to respondWith().
        // Once the browser starts piping that body to the page, its stream is
        // "disturbed" and a later .clone() throws — silently, into the .catch() below,
        // which is why the comparison was never running at all despite the fetch
        // itself succeeding.
        const cachedForCompare = isAppHtml && cached ? cached.clone() : null;
        const networkFetch = fetch(event.request)
          .then(async (response) => {
            if (response && response.status === 200) {
              if (cachedForCompare) {
                const [oldText, newText] = await Promise.all([cachedForCompare.text(), response.clone().text()]);
                // Clearing on a match matters as much as setting on a difference: it is
                // what stops the prompt reappearing forever once the user has reloaded.
                await setContentUpdateFlag(cache, oldText !== newText);
              }
              await cache.put(event.request, response.clone());
            }
            return response;
          })
          .catch(() => cached)
          .finally(() => finishBackground());
        return cached || networkFetch;
      } catch (e) {
        finishBackground();
        throw e;
      }
    })()
  );
});
