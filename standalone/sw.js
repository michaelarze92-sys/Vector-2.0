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
  const res = await fetch('./estate-pm.html', { cache: 'no-store' });
  const buf = await res.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const hex = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  return CACHE_PREFIX + hex.slice(0, 16);
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
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

// Stale-while-revalidate: serve from cache instantly (works offline), refresh
// the cache from the network in the background for next time.
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(await cacheNamePromise);
      const cached = await cache.match(event.request);
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })()
  );
});
