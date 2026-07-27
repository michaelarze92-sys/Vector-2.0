/* Estates Ledger service worker.
 *
 * CACHE_NAME is rewritten by src/ledger/build.py on every build (it embeds a hash of
 * index.html), so a deploy always invalidates the old cache. Don't hand-edit it —
 * if you do, installed phones can keep serving a stale app forever, which is the
 * classic PWA trap.
 */
const CACHE_NAME = 'estates-ledger-1deaeebf306b';

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

/* ---- Reminders ----
 *
 * There is no backend, so there is no push server, so nothing can be *delivered* to a
 * closed app. periodicsync is the one mechanism a backend-less PWA has for running while
 * closed: Chrome on Android, installed to the home screen, and the browser alone decides
 * when it fires. Treat it as "roughly daily", never as an alarm clock.
 *
 * A service worker cannot read localStorage, so the page writes a summary to the
 * "digest" store in IndexedDB on every render and this reads it back. DB_VERSION must
 * match openDB() in the app, or one of them will trigger an upgrade the other blocks.
 */
const DIGEST_DB = 'estatesLedgerFiles';
const DIGEST_DB_VERSION = 2;

function readDigest() {
  return new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DIGEST_DB, DIGEST_DB_VERSION); }
    catch (e) { return resolve(null); }
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('digest')) return resolve(null);
      const get = db.transaction('digest').objectStore('digest').get('current');
      get.onsuccess = () => resolve(get.result || null);
      get.onerror = () => resolve(null);
    };
  });
}

/* Once a day at most, and only when there is something to say — a reminder that fires
 * with nothing due is one you learn to swipe away without reading. */
function notifyFromDigest() {
  return readDigest().then((d) => {
    if (!d || !d.enabled || !d.count) return;
    const today = new Date().toISOString().slice(0, 10);
    if (d.notifiedOn === today) return;
    return self.registration.showNotification('Estates Ledger', {
      body: d.line + (d.lead ? '\n' + d.lead : ''),
      tag: 'estates-daily',
      icon: './icon-192.png',
      badge: './icon-192.png',
      data: { url: './' },
    }).then(() => new Promise((resolve) => {
      const req = indexedDB.open(DIGEST_DB, DIGEST_DB_VERSION);
      req.onerror = () => resolve();
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('digest')) return resolve();
        const tx = db.transaction('digest', 'readwrite');
        tx.objectStore('digest').put(Object.assign({}, d, { notifiedOn: today }));
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      };
    }));
  });
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'estates-reminders') event.waitUntil(notifyFromDigest());
});

// lets the page (and the test suite) force a check without waiting on the browser
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'check-reminders') event.waitUntil(notifyFromDigest());
});

/* Focus the app if it's already open rather than opening a second copy — two tabs of a
 * localStorage-backed app can overwrite each other's work. */
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const base = new URL('./', self.location).href;
      for (const client of list) {
        if (client.url.startsWith(base) && 'focus' in client) return client.focus();
      }
      return self.clients.openWindow ? self.clients.openWindow('./') : undefined;
    })
  );
});

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
