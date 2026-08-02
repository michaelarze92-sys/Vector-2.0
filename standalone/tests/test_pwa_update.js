// Verifies the two update paths an installed PWA depends on:
//   1. sw.js itself changed  -> new worker waits, page prompts, SKIP_WAITING activates it
//   2. only estate-pm.html changed -> SW's background revalidation posts CONTENT_UPDATED
//      and the page prompts anyway. Without (2) a content-only deploy never prompts,
//      because browsers only byte-diff sw.js — an installed PWA sat on a stale version.
// Also checks the app still opens offline, which a rejecting hashCacheName() broke.
//
// Serves over http://127.0.0.1 (a secure context) — service workers do not register
// from file:// URLs.
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const DIR = path.resolve(__dirname, '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/manifest+json', '.png': 'image/png' };

let overrides = {};

function serve(port) {
  const server = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'estate-pm.html';
    if (Object.prototype.hasOwnProperty.call(overrides, name)) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(name)] || 'text/plain', 'Cache-Control': 'no-cache' });
      return res.end(overrides[name]);
    }
    const file = path.join(DIR, name);
    if (!file.startsWith(DIR) || !fs.existsSync(file)) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'text/plain', 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(file));
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

(async () => {
  const PORT = 8931;
  const server = await serve(PORT);
  const base = 'http://127.0.0.1:' + PORT + '/estate-pm.html';
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  const ok = (label, cond) => console.log((cond ? 'ok: ' : 'FAILED: ') + label);

  // --- first visit: worker installs, no prompt (nothing to update yet) ---
  await page.goto(base);
  await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 15000 });
  ok('service worker controls the page', true);
  ok('no update prompt on first visit', !(await page.locator('#updateToast').isVisible()));

  // A real revisit: the prompt only arms on a page that loaded with a controller already.
  await page.reload();
  await page.waitForTimeout(600);

  // --- case 2: content-only change (estate-pm.html differs, sw.js identical) ---
  const html = fs.readFileSync(path.join(DIR, 'estate-pm.html'), 'utf8');
  overrides['estate-pm.html'] = html + '<!-- deploy marker -->';
  await page.reload();
  await page.waitForSelector('#updateToast', { state: 'visible', timeout: 15000 });
  ok('content-only change prompts for update', true);

  // tapping reload with no waiting worker should just reload, not hang
  await page.click('#updateReloadBtn');
  await page.waitForTimeout(1200);
  const gotNew = await page.evaluate(async () => (await (await fetch('./estate-pm.html')).text()).includes('deploy marker'));
  ok('reload picks up the new content', gotNew);

  // --- case 1: sw.js itself changes -> waiting worker + prompt + activation ---
  const sw = fs.readFileSync(path.join(DIR, 'sw.js'), 'utf8');
  overrides['sw.js'] = sw + '\n// deploy ' + Date.now() + '\n';
  await page.reload();
  await page.waitForSelector('#updateToast', { state: 'visible', timeout: 15000 });
  const hasWaiting = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(reg && reg.waiting);
  });
  ok('sw.js change produces a waiting worker + prompt', hasWaiting);
  await page.click('#updateReloadBtn');
  await page.waitForTimeout(1500);
  const activated = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return !!(reg && reg.active && !reg.waiting);
  });
  ok('SKIP_WAITING activates the new worker', activated);

  // --- offline still opens (the bug where hashCacheName() rejected) ---
  overrides = {};
  await page.reload();
  await page.waitForTimeout(800);
  await ctx.setOffline(true);
  await page.reload();
  await page.waitForTimeout(1000);
  const offlineOk = await page.evaluate(() => !!document.querySelector('.nav-item'));
  ok('app still opens offline', offlineOk);
  await ctx.setOffline(false);

  if (errors.length) { console.log('CONSOLE ERROR'); errors.forEach((e) => console.log('  ' + e)); }
  await browser.close();
  server.close();
})();
