/* Scheduled backups.
 *
 * Two halves, and only one works on Michael's device.
 *
 * The SCHEDULE works everywhere: a weekly slot, and the app knowing when it has passed
 * without a backup. That drives the banner and the notification, and it is what he
 * actually gets on Android.
 *
 * The AUTOMATIC WRITE needs showDirectoryPicker, which is Chrome desktop only — Chrome on
 * Android does not expose it. Headless Chromium doesn't either, so the fallback path is
 * what runs here by default, and the API is stubbed to exercise the other branch. The
 * important assertion is that the unsupported case says so plainly rather than offering
 * an automation that will never fire.
 */
const { chromium } = require('playwright');
const path = require('path');

const APP = 'file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html');
const ISSUES = 'estatesLedger.issues.v1';
const LAST = 'estatesLedger.lastBackup.v1';
const SCHED = 'estatesLedger.backupSchedule.v1';

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const SEED = [{ id: 'i1', title: 'Chiller 2 tripping', site: 'Mayfair', status: 'Open', risk: 3, urgency: 3, cost: 2, notes: [] }];

// the most recent Friday 15:00 at or before now — mirrors lastScheduledSlot()
const lastFridaySlot = () => {
  const now = new Date();
  const s = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 15, 0, 0, 0);
  s.setDate(s.getDate() - ((now.getDay() - 5 + 7) % 7));
  if (s > now) s.setDate(s.getDate() - 7);
  return s;
};

const open = async (browser, setup) => {
  const p = await (await browser.newContext()).newPage({ viewport: { width: 1280, height: 1000 } });
  p.on('pageerror', (e) => { console.log('FAILED: PAGE ERROR ' + e.message); failed++; });
  await p.goto(APP);
  await p.evaluate(([k, v]) => localStorage.setItem(k, v), [ISSUES, JSON.stringify(SEED)]);
  if (setup) await setup(p);
  await p.reload();
  await p.waitForTimeout(500);
  return p;
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  // ---------- the schedule ----------
  // backed up an hour before the slot => the slot has since passed => due
  let page = await open(browser, (p) => p.evaluate(([k, t]) => localStorage.setItem(k, t),
    [LAST, new Date(lastFridaySlot().getTime() - 3600e3).toISOString()]));
  check('a backup older than the last scheduled slot is due', await page.isVisible('#backupNudge'));
  let txt = (await page.textContent('#backupNudgeText')).trim();
  console.log('      nudge reads:', JSON.stringify(txt));
  check('the banner names the day', /Friday backup is due/.test(txt), txt);
  await page.close();

  // backed up an hour after the slot => not due
  page = await open(browser, (p) => p.evaluate(([k, t]) => localStorage.setItem(k, t),
    [LAST, new Date(lastFridaySlot().getTime() + 3600e3).toISOString()]));
  check('a backup taken after the slot is not due', !(await page.isVisible('#backupNudge')));
  await page.close();

  // never backed up, with data => due
  page = await open(browser);
  check('never backed up with data in it is due', await page.isVisible('#backupNudge'));
  check('and says so', /never exported one/.test(await page.textContent('#backupNudgeText')));
  await page.close();

  // an empty ledger is not nagged
  page = await (await browser.newContext()).newPage();
  await page.goto(APP);
  await page.waitForTimeout(400);
  check('an empty ledger is never nagged', !(await page.isVisible('#backupNudge')));
  await page.close();

  // scheduling off falls back to the 14-day staleness rule
  page = await open(browser, (p) => p.evaluate(([k, s, lk, t]) => {
    localStorage.setItem(k, s);
    localStorage.setItem(lk, t);
  }, [SCHED, JSON.stringify({ enabled: false, day: 5, hour: 15 }), LAST, new Date(Date.now() - 3 * 86400e3).toISOString()]));
  check('with the schedule off, a 3-day-old backup is left alone', !(await page.isVisible('#backupNudge')));
  await page.close();

  // ---------- the settings panel ----------
  page = await open(browser);
  /* Headless Chromium exposes showDirectoryPicker; Chrome on Android does not. Removing
     it here is how the phone's branch gets tested at all. */
  await page.evaluate(() => { delete window.showDirectoryPicker; });
  await page.click('#menuBtn');
  await page.waitForTimeout(150);
  check('the menu offers scheduled backups', await page.isVisible('#backupSettingsBtn'));
  await page.click('#backupSettingsBtn');
  await page.waitForTimeout(300);
  check('it defaults to Friday', (await page.inputValue('#bs-day')) === '5');
  check('and to the afternoon', (await page.inputValue('#bs-hour')) === '15');

  const note = await page.textContent('#backupSettingsBody');
  console.log('      panel says:', JSON.stringify(note.replace(/\s+/g, ' ').slice(0, 240)));
  check('an unsupported browser says so plainly rather than pretending',
    /can'?t write backups to a folder automatically/i.test(note), note.slice(0, 100));
  check('it names Android Chrome as the reason', /Android/.test(note));
  check('and offers no folder button it cannot honour', !(await page.$('#bs-folder')));
  check('it promises not to delete old backups', /never deleted for you/i.test(note));

  await page.selectOption('#bs-day', '1');
  await page.waitForTimeout(300);
  check('changing the day persists', await page.evaluate((k) =>
    JSON.parse(localStorage.getItem(k)).day === 1, SCHED));
  check('and the banner follows it', /Monday backup is due/.test(await page.textContent('#backupNudgeText')),
    (await page.textContent('#backupNudgeText')).trim());
  await page.close();

  // ---------- the folder path, with the API stubbed in ----------
  const ctx = await browser.newContext();
  const p2 = await ctx.newPage({ viewport: { width: 1280, height: 1000 } });
  p2.on('pageerror', (e) => { console.log('FAILED: PAGE ERROR ' + e.message); failed++; });
  await p2.addInitScript(() => {
    window.__written = [];
    const dir = {
      name: 'EstatesBackups',
      queryPermission: () => Promise.resolve('granted'),
      requestPermission: () => Promise.resolve('granted'),
      getFileHandle: (name) => Promise.resolve({
        createWritable: () => Promise.resolve({
          write: (t) => { window.__written.push({ name, length: t.length, text: t }); return Promise.resolve(); },
          close: () => Promise.resolve(),
        }),
      }),
    };
    window.showDirectoryPicker = () => Promise.resolve(dir);
  });
  await p2.goto(APP);
  await p2.evaluate(([k, v]) => localStorage.setItem(k, v), [ISSUES, JSON.stringify(SEED)]);
  await p2.reload();
  await p2.waitForTimeout(500);

  await p2.click('#menuBtn');
  await p2.click('#backupSettingsBtn');
  await p2.waitForTimeout(300);
  check('a browser that CAN write offers the folder button', await p2.isVisible('#bs-folder'));
  check('and describes the hands-off behaviour', /saves without asking/i.test(await p2.textContent('#backupSettingsBody')));

  await p2.click('#bs-folder');
  await p2.waitForTimeout(900);
  const written = await p2.evaluate(() => window.__written);
  console.log('      wrote:', JSON.stringify(written.map((w) => w.name)));
  check('choosing a folder writes a backup straight away', written.length === 1, `${written.length}`);
  check('the filename carries the date', /^estates-ledger-\d{4}-\d{2}-\d{2}\.json$/.test(written[0].name), written[0].name);
  const payload = JSON.parse(written[0].text);
  check('the written file is a real backup', payload.formatVersion === 2 && Array.isArray(payload.issues));
  check('it carries the localState every key rides in', !!payload.localState);
  check('and it records the backup as taken', !!(await p2.evaluate((k) => localStorage.getItem(k), LAST)));
  check('so the banner clears', !(await p2.isVisible('#backupNudge')));

  /* Being overdue in the same session writes again with no prompt. The across-reload
     case genuinely can't be tested here: it reads the handle back from IndexedDB, and a
     stub with methods on it isn't structured-cloneable the way a real
     FileSystemDirectoryHandle is. Verified in-session only — flagged rather than faked. */
  await p2.evaluate(([k, t]) => localStorage.setItem(k, t),
    [LAST, new Date(Date.now() - 30 * 86400e3).toISOString()]);
  await p2.click('#backupSettingsCloseBtn');   // its overlay covers the ⋮ menu
  await p2.waitForTimeout(200);
  await p2.click('#menuBtn');
  await p2.click('#backupSettingsBtn');
  await p2.waitForTimeout(250);
  await p2.click('#bs-folder');
  await p2.waitForTimeout(900);
  const written2 = await p2.evaluate(() => window.__written);
  check('an overdue backup writes again with no prompt', written2.length === 2, `${written2.length}`);
  check('and clears the banner without being asked', !(await p2.isVisible('#backupNudge')));
  await p2.close();

  // a lapsed permission must NOT silently do nothing forever — the banner takes over
  const p3 = await (await browser.newContext()).newPage({ viewport: { width: 1280, height: 1000 } });
  await p3.addInitScript(() => {
    window.__written = [];
    window.showDirectoryPicker = () => Promise.resolve({
      name: 'EstatesBackups',
      queryPermission: () => Promise.resolve('prompt'),   // lapsed
      getFileHandle: () => Promise.reject(new Error('no permission')),
    });
  });
  await p3.goto(APP);
  await p3.evaluate(([k, v]) => localStorage.setItem(k, v), [ISSUES, JSON.stringify(SEED)]);
  await p3.click('#menuBtn');
  await p3.click('#backupSettingsBtn');
  await p3.waitForTimeout(200);
  await p3.click('#bs-folder');
  await p3.waitForTimeout(600);
  await p3.reload();
  await p3.waitForTimeout(900);
  check('a lapsed folder permission writes nothing', (await p3.evaluate(() => window.__written)).length === 0);
  check('and the banner asks instead of failing silently', await p3.isVisible('#backupNudge'));
  await p3.close();

  await browser.close();
  console.log(failed ? `\nFAILED: ${failed} assertion(s)` : '\nBACKUP SCHEDULE: OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
