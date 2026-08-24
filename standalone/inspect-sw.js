/* Inspections service worker.
 *
 * Scope is /standalone/, which sits BENEATH the Estates Ledger's worker at the Pages
 * root. Two things keep them from fighting:
 *   - the Ledger's worker explicitly refuses to handle anything under standalone/;
 *   - this one only ever responds for its own three files.
 * A greedy handler on either side would let one app serve a stale copy of the other's
 * assets, which is the classic multi-app PWA failure and is miserable to diagnose.
 *
 * Bump CACHE_NAME by hand when you change inspection.html. There is no build step for
 * this app (unlike the Ledger, where build.py stamps the hash automatically), so if you
 * forget, installed phones keep serving the old file indefinitely.
 */
const CACHE_NAME = 'metro-inspections-v1';

const APP_SHELL = [
  './inspection.html',
  './inspect-manifest.json',
  '../icon-192.png',
  '../icon-512.png',
  '../icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  /* Individual puts rather than cache.addAll: addAll is atomic, so one missing icon
     would fail the whole install and leave the app with no offline copy at all. */
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.all(APP_SHELL.map((url) => cache.add(url).catch(() => {})))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('metro-inspections-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

function isOurs(url) {
  if (url.origin !== self.location.origin) return false;
  const base = new URL('./', self.location).pathname;        // e.g. /Vector-2.0/standalone/
  const parent = base.replace(/[^/]+\/$/, '');               // e.g. /Vector-2.0/
  if (url.pathname === base + 'inspection.html') return true;
  if (url.pathname === base + 'inspect-manifest.json') return true;
  /* The icons are shared with the Ledger and live one level up. Caching them here is
     safe — they are immutable files — but nothing else up there is ours to touch. */
  return /^icon-[\w-]+\.png$/.test(url.pathname.slice(parent.length));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  let url;
  try { url = new URL(event.request.url); } catch (e) { return; }
  if (!isOurs(url)) return;

  // Stale-while-revalidate: opens instantly with no signal, refreshes when there is one.
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fromNetwork = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200 && response.type === 'basic') {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fromNetwork;
    })
  );
});
