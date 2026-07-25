const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

/* Serves the repo root over http://127.0.0.1 — a secure context, so service
 * workers register exactly as they do on GitHub Pages. Mounted under /Vector-2.0/
 * to reproduce the real subpath, since that's where scope bugs hide. */
const REPO = path.resolve(__dirname, '../../..');
const BASE = '/Vector-2.0/';
const TYPES = { '.html': 'text/html', '.json': 'application/manifest+json',
                '.js': 'text/javascript', '.png': 'image/png' };

let offline = false;

const server = http.createServer((req, res) => {
  if (offline) { req.socket.destroy(); return; }
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (!rel.startsWith(BASE)) { res.writeHead(404); return res.end('nope'); }
  rel = rel.slice(BASE.length) || 'index.html';
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.join(REPO, rel);
  if (!file.startsWith(REPO) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); return res.end('not found');
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((r) => server.listen(8899, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:8899' + BASE;

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });

  await page.goto(origin);
  await page.waitForTimeout(300);

  // --- manifest wired into the document, and actually reachable ---
  console.log('manifest <link> present:', !!(await page.$('link[rel="manifest"]')));
  console.log('theme-color set:', await page.getAttribute('meta[name="theme-color"]', 'content'));
  const mf = await page.evaluate(async () => {
    const r = await fetch('manifest.json');
    return r.ok ? r.json() : null;
  });
  console.log('manifest fetches:', !!mf, '| short_name:', mf && mf.short_name);
  console.log('has 192 + 512 + maskable:',
    !!mf && ['192x192', '512x512'].every((s) => mf.icons.some((i) => i.sizes === s))
        && mf.icons.some((i) => i.purpose === 'maskable'));

  const iconsOk = await page.evaluate(async () => {
    const names = ['icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png'];
    const res = await Promise.all(names.map((n) => fetch(n).then((r) => r.ok).catch(() => false)));
    return res.every(Boolean);
  });
  console.log('all icons reachable:', iconsOk);

  // --- service worker registers and takes control ---
  const reg = await page.evaluate(() =>
    navigator.serviceWorker.ready.then((r) => ({
      scope: r.scope,
      active: !!r.active,
    })).catch((e) => ({ error: String(e) }))
  );
  console.log('service worker:', JSON.stringify(reg));

  const cache = await page.evaluate(async () => {
    const keys = await caches.keys();
    const k = keys.find((x) => x.startsWith('estates-ledger-'));
    if (!k) return { keys };
    const c = await caches.open(k);
    return { name: k, entries: (await c.keys()).map((r) => new URL(r.url).pathname) };
  }).catch(() => null);
  console.log('cache:', JSON.stringify(cache));

  // --- the real test: does it work with the network gone? ---
  offline = true;
  errors.length = 0;   // from here on, network failures are expected — that's the test
  await page.reload();
  await page.waitForTimeout(600);
  const offlineOk = await page.evaluate(() => {
    const wm = document.querySelector('.topbar .mark');
    return { rendered: wm ? wm.textContent : null, hasApp: !!document.querySelector('#stats') };
  });
  console.log('OFFLINE reload rendered app:', JSON.stringify(offlineOk));

  // --- scope discipline: must not have cached the other app ---
  const touchedOther = await page.evaluate(async () => {
    const keys = await caches.keys();
    for (const k of keys) {
      const c = await caches.open(k);
      const urls = (await c.keys()).map((r) => r.url);
      if (urls.some((u) => u.includes('/standalone/'))) return true;
    }
    return false;
  });
  console.log('did NOT cache the Project Board (must be false):', touchedOther);

  offline = false;
  console.log('--- Errors ---');
  console.log(errors.length ? errors.join('\n') : 'No errors');

  await browser.close();
  server.close();

  const pass = reg && reg.active && offlineOk.hasApp && !touchedOther && iconsOk && !!mf;
  console.log('PWA READY:', !!pass);
  if (!pass) process.exitCode = 1;
})().catch((e) => { console.error('FAILED:', e); server.close(); process.exit(1); });
