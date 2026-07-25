/* Estates Ledger service worker.
 *
 * CACHE_NAME is rewritten by src/ledger/build.py on every build (it embeds a hash of
 * index.html), so a deploy always invalidates the old cache. Don't hand-edit it —
 * if you do, installed phones can keep serving a stale app forever, which is the
 * classic PWA trap.
 */
const CACHE_NAME = 'estates-ledger-91a972f5ec4f';

/* The app is one self-contained HTML file: fonts, logos, video and photos are all
 * base64-inlined, so there are no other runtime requests to cache. */
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
  './icon-512-maskable.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('estates-ledger-') && k !== CACHE_NAME)
            .map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

/* This worker's scope is the Pages root, which is the PARENT of the Project &
 * Compliance Board at ./standalone/. That app registers its own worker, and a
 * narrower registration wins for pages beneath it — but a greedy fetch handler here
 * could still cache and later serve stale copies of its assets. So: only ever
 * respond for this app's own shell, and let everything else fall through to the
 * network untouched by not calling respondWith at all. */
function isOurs(url) {
  if (url.origin !== self.location.origin) return false;
  const base = new URL('./', self.location).pathname;      // e.g. /Vector-2.0/
  if (!url.pathname.startsWith(base)) return false;
  const rest = url.pathname.slice(base.length);
  if (rest.startsWith('standalone/')) return false;        // the other app — hands off
  return rest === ''
      || rest === 'index.html'
      || rest === 'manifest.json'
      || /^icon-[\w-]+\.png$/.test(rest);
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  let url;
  try { url = new URL(event.request.url); } catch (e) { return; }
  if (!isOurs(url)) return;

  /* Stale-while-revalidate: serve the cached copy immediately so the app opens
   * instantly and works with no signal, then refresh it in the background. */
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
