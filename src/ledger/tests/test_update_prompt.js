/* The "newer version is ready" prompt.
 *
 * Two things must both hold, and the second is the easy one to get wrong:
 *   1. after a deploy, a returning user is offered the reload
 *   2. a FIRST-EVER visitor is not — the initial clients.claim() also fires
 *      controllerchange, and prompting there would be nonsense
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');
const SITE = '/tmp/pwa-update-site';
const BASE = '/Vector-2.0/';
const SHELL = ['index.html', 'manifest.json', 'sw.js', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-512-maskable.png'];
const TYPES = { '.html': 'text/html', '.json': 'application/manifest+json', '.js': 'text/javascript', '.png': 'image/png' };

fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(SITE, { recursive: true });
SHELL.forEach((f) => fs.copyFileSync(path.join(REPO, f), path.join(SITE, f)));

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (!rel.startsWith(BASE)) { res.writeHead(404); return res.end(); }
  rel = rel.slice(BASE.length) || 'index.html';
  const file = path.join(SITE, rel);
  if (!fs.existsSync(file)) { res.writeHead(404); return res.end(); }
  const h = { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' };
  if (rel === 'sw.js') h['Cache-Control'] = 'no-cache';
  res.writeHead(200, h); res.end(fs.readFileSync(file));
});

let failed = false;
const check = (label, ok) => { console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}`); if (!ok) failed = true; };

(async () => {
  await new Promise((r) => server.listen(8903, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:8903' + BASE;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await (await browser.newContext()).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });

  // --- first-ever visit: must NOT prompt ---
  await page.goto(origin);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForTimeout(1200);
  check('first visit does not show the update prompt', !(await page.isVisible('#updateBar')));

  // Reload so the page loads WITH a controller already active — that's what a
  // returning user's session looks like, and it's what arms the update check.
  await page.reload();
  await page.waitForTimeout(800);
  check('still no prompt on an ordinary revisit', !(await page.isVisible('#updateBar')));

  // --- deploy a new version ---
  const swNew = fs.readFileSync(path.join(REPO, 'sw.js'), 'utf8')
    .replace(/const CACHE_NAME = 'estates-ledger-[^']*'/, "const CACHE_NAME = 'estates-ledger-NEWDEPLOY'");
  fs.writeFileSync(path.join(SITE, 'sw.js'), swNew);

  // the update check the browser performs on navigation / daily
  await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    await reg.update();
  });
  await page.waitForTimeout(2500);

  check('returning user IS offered the update', await page.isVisible('#updateBar'));
  const text = (await page.textContent('#updateBar')).replace(/\s+/g, ' ').trim();
  console.log('      prompt reads:', JSON.stringify(text));
  check('the new worker took over', (await page.evaluate(() => caches.keys()))
    .includes('estates-ledger-NEWDEPLOY'));

  // --- "Later" dismisses without reloading ---
  const before = page.url();
  await page.click('#updateDismissBtn');
  await page.waitForTimeout(300);
  check('Later hides the prompt', !(await page.isVisible('#updateBar')));
  check('Later did not navigate away', page.url() === before);

  // --- data is untouched by an update taking over ---
  await page.evaluate(() => localStorage.setItem('estatesLedger.issues.v1',
    JSON.stringify([{ id: 'keep', title: 'Survives an update', site: 'Mayfair', status: 'Open' }])));
  await page.reload();
  await page.waitForTimeout(800);
  const kept = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('estatesLedger.issues.v1') || '[]')[0]);
  check('an update does not touch stored data', !!kept && kept.title === 'Survives an update');

  console.log(errors.length ? '\nErrors:\n' + errors.join('\n') : '\nNo errors');
  if (errors.length) failed = true;

  await browser.close(); server.close();
  console.log(failed ? 'UPDATE PROMPT: FAILED' : 'UPDATE PROMPT: OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); server.close(); process.exit(1); });
