/* Daily reminders.
 *
 * Served over http://127.0.0.1 (a secure context) so the service worker registers as it
 * does live — notifications are useless without one.
 *
 * The hard constraint being tested: a service worker CANNOT read localStorage, where all
 * this app's data lives. So the page writes a summary to the "digest" object store in
 * IndexedDB on every render, and the worker reads that. If the digest stops being
 * written, background reminders go quiet with no other symptom, so it is asserted
 * directly rather than only through the notification.
 */
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '../../..');
const SITE = '/tmp/reminders-site';
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

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const iso = (o) => { const d = new Date(); d.setDate(d.getDate() + o);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const SEED = [
  { id: 'a', title: 'Chiller 2 tripping', site: 'Mayfair', status: 'Open', risk: 3, urgency: 3, cost: 3,
    targetDate: iso(-4), dateReported: iso(-10), notes: [] },
  { id: 'b', title: 'Fire door closer', site: 'Glasgow', status: 'Open', risk: 2, urgency: 2, cost: 1,
    targetDate: iso(0), dateReported: iso(-2), notes: [] },
];

const readDigest = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('estatesLedgerFiles', 2);
  r.onerror = () => res(null);
  r.onsuccess = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains('digest')) return res(null);
    const g = db.transaction('digest').objectStore('digest').get('current');
    g.onsuccess = () => res(g.result || null);
    g.onerror = () => res(null);
  };
}));

(async () => {
  await new Promise((r) => server.listen(8905, '127.0.0.1', r));
  const origin = 'http://127.0.0.1:8905' + BASE;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });

  await page.goto(origin);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.evaluate((v) => {
    localStorage.setItem('estatesLedger.issues.v1', v);
    /* Pin the backup as just-taken. Otherwise a due backup adds itself to the digest and
       every count below shifts depending on which day the suite happens to run. */
    localStorage.setItem('estatesLedger.lastBackup.v1', new Date().toISOString());
  }, JSON.stringify(SEED));
  await page.reload();
  await page.waitForTimeout(900);

  // --- the digest, which is the only channel to the worker ---
  const d1 = await readDigest(page);
  check('a digest is written to IndexedDB', !!d1, JSON.stringify(d1 && d1.line));
  check('it counts overdue + due today', d1 && d1.count === 2, d1 && String(d1.count));
  check('it carries a readable summary line', d1 && /1 overdue/.test(d1.line) && /1 due today/.test(d1.line), d1 && d1.line);
  check('it names the worst item', d1 && /Chiller 2 tripping — Mayfair/.test(d1.lead), d1 && d1.lead);
  check('reminders start switched off', d1 && d1.enabled === false, d1 && String(d1.enabled));

  // --- the toggle ---
  await page.click('#menuBtn');
  await page.waitForTimeout(200);
  check('the menu offers a reminders toggle', await page.isVisible('#notifyToggleBtn'));
  check('it reads off by default', /off/i.test(await page.textContent('#notifyToggleBtn')),
    (await page.textContent('#notifyToggleBtn')).trim());

  await ctx.grantPermissions(['notifications'], { origin: 'http://127.0.0.1:8905' });
  await page.click('#notifyToggleBtn');
  await page.waitForTimeout(1200);
  check('it now reads ON', /ON/.test(await page.textContent('#notifyToggleBtn')),
    (await page.textContent('#notifyToggleBtn')).trim());
  check('the preference persists', await page.evaluate(() => localStorage.getItem('estatesLedger.notify.v1')) === 'on');

  const d2 = await readDigest(page);
  check('the digest records that reminders are on', d2 && d2.enabled === true);

  // --- the worker can actually raise one from the digest alone ---
  const shown = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    /* Switching reminders on fires one immediately as confirmation. Clear it first or
       the poll below returns THAT one and the worker is never actually tested. */
    (await reg.getNotifications()).forEach((n) => n.close());
    await new Promise((r) => setTimeout(r, 200));
    // clear the once-a-day stamp so the check is not suppressed
    await new Promise((res) => {
      const r = indexedDB.open('estatesLedgerFiles', 2);
      r.onsuccess = () => {
        const tx = r.result.transaction('digest', 'readwrite');
        const store = tx.objectStore('digest');
        const g = store.get('current');
        g.onsuccess = () => { const v = g.result; delete v.notifiedOn; store.put(v); };
        tx.oncomplete = res; tx.onerror = res;
      };
      r.onerror = res;
    });
    reg.active.postMessage({ type: 'check-reminders' });
    for (let i = 0; i < 30; i++) {
      const list = await reg.getNotifications();
      if (list.length) return list.map((n) => ({ title: n.title, body: n.body }));
      await new Promise((r) => setTimeout(r, 100));
    }
    return [];
  });
  check('the service worker raises a notification from the digest', shown.length === 1, JSON.stringify(shown));
  if (shown.length) {
    console.log('      notification:', JSON.stringify(shown[0]));
    check('it says what is outstanding', /1 overdue/.test(shown[0].body), shown[0].body);
    check('it names the lead item', /Chiller 2 tripping/.test(shown[0].body));
  }

  const dStamp = await readDigest(page);
  check('firing stamps the shared once-a-day marker', dStamp && dStamp.notifiedOn === iso(0),
    dStamp && JSON.stringify(dStamp.notifiedOn));

  // --- and does not repeat itself the same day ---
  const second = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    (await reg.getNotifications()).forEach((n) => n.close());
    reg.active.postMessage({ type: 'check-reminders' });
    await new Promise((r) => setTimeout(r, 1500));
    return (await reg.getNotifications()).length;
  });
  check('a second check the same day stays quiet', second === 0, String(second));

  // --- nothing outstanding means nothing to say ---
  await page.evaluate(() => localStorage.setItem('estatesLedger.issues.v1', JSON.stringify([
    { id: 'z', title: 'Nothing urgent', site: 'Mayfair', status: 'Open', risk: 1, urgency: 1, cost: 1, targetDate: '', notes: [] },
  ])));
  await page.reload();
  await page.waitForTimeout(900);
  const d3 = await readDigest(page);
  check('an empty day writes a zero count', d3 && d3.count === 0, d3 && String(d3.count));
  const quiet = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    (await reg.getNotifications()).forEach((n) => n.close());
    await new Promise((res) => {
      const r = indexedDB.open('estatesLedgerFiles', 2);
      r.onsuccess = () => {
        const tx = r.result.transaction('digest', 'readwrite');
        const s = tx.objectStore('digest');
        const g = s.get('current');
        g.onsuccess = () => { const v = g.result; delete v.notifiedOn; s.put(v); };
        tx.oncomplete = res; tx.onerror = res;
      };
      r.onerror = res;
    });
    reg.active.postMessage({ type: 'check-reminders' });
    await new Promise((r) => setTimeout(r, 1500));
    return (await reg.getNotifications()).length;
  });
  check('nothing due means no notification', quiet === 0, String(quiet));

  // --- switching off is honoured by the worker, not just the UI ---
  await page.click('#menuBtn');
  await page.click('#notifyToggleBtn');
  await page.waitForTimeout(600);
  const d4 = await readDigest(page);
  check('switching off reaches the digest', d4 && d4.enabled === false);

  console.log(errors.length ? '\nErrors:\n' + errors.join('\n') : '\nNo errors');
  if (errors.length) failed++;
  await browser.close(); server.close();
  console.log(failed ? `FAILED: ${failed} assertion(s)` : 'REMINDERS: OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); server.close(); process.exit(1); });
