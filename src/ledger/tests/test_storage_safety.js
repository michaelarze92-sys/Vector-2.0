/* The four data-safety guarantees. These are the ones where being wrong loses work
 * permanently rather than merely annoying someone, so each is asserted from the
 * outside — what a user would actually see — not by calling internals.
 *
 *   1. unreadable stored data is never overwritten, and says so loudly
 *   2. a failed write halts saving instead of pretending it worked
 *   3. the app nags when a backup is overdue
 *   4. a download reports what actually happened
 */
const { chromium } = require('playwright');
const path = require('path');

const APP = 'file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html');
const ISSUES = 'estatesLedger.issues.v1';
const LAST_BACKUP = 'estatesLedger.lastBackup.v1';

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const anIssue = { id: 'i1', title: 'Chiller 2 tripping', site: 'Mayfair', status: 'Open', risk: 3, urgency: 3, cost: 2 };

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext();
  const page = await ctx.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });

  // ---------- 1. corrupted data is preserved, not silently replaced ----------
  await page.goto(APP);
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [ISSUES, '{"broken": [not json']);
  await page.reload();
  await page.waitForTimeout(500);

  check('corrupt data raises the storage alarm', await page.isVisible('#storageAlert'));
  const alarm = (await page.textContent('#storageAlert')).replace(/\s+/g, ' ').trim();
  console.log('      alarm reads:', JSON.stringify(alarm.slice(0, 120)));
  check('the alarm says nothing was deleted', /nothing has been deleted/i.test(alarm));

  // the critical bit: the app must not have written its empty in-memory state over it
  await page.click('#fabAdd');
  await page.waitForTimeout(200);
  await page.fill('#f-title', 'Something typed while broken');
  await page.selectOption('#f-site', 'Glasgow');
  await page.click('#formSaveBtn');
  await page.waitForTimeout(400);
  const stillCorrupt = await page.evaluate((k) => localStorage.getItem(k), ISSUES);
  check('the unreadable bytes are still intact after a save attempt',
    stillCorrupt === '{"broken": [not json', JSON.stringify(stillCorrupt));

  await page.reload();
  await page.waitForTimeout(400);
  const afterReload = await page.evaluate((k) => localStorage.getItem(k), ISSUES);
  check('and still intact after a reload', afterReload === '{"broken": [not json');
  check('alarm is still up on the next visit', await page.isVisible('#storageAlert'));
  check('the alarm cannot be dismissed away', (await page.$('#storageAlert button')) !== null
    && (await page.$$('#storageAlert button')).length === 1);

  // ---------- 2. a failed write halts, it does not carry on ----------
  const page2 = await (await browser.newContext()).newPage();
  page2.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  await page2.goto(APP);
  await page2.evaluate(() => {
    localStorage.setItem('estatesLedger.issues.v1', '[]');
  });
  await page2.reload();
  await page2.waitForTimeout(400);
  check('a healthy start shows no alarm', !(await page2.isVisible('#storageAlert')));

  // make every write throw, the way a full quota does
  await page2.evaluate(() => {
    const real = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) {
      if (String(k).startsWith('estatesLedger.')) {
        const err = new Error('QuotaExceededError'); err.name = 'QuotaExceededError'; throw err;
      }
      return real.call(this, k, v);
    };
  });
  await page2.click('#fabAdd');
  await page2.waitForTimeout(200);
  await page2.fill('#f-title', 'Roof leak above cash desk');
  await page2.selectOption('#f-site', 'Park Lane');
  await page2.click('#formSaveBtn');
  await page2.waitForTimeout(400);

  check('a failed write raises the alarm', await page2.isVisible('#storageAlert'));
  const quotaText = (await page2.textContent('#storageAlertText')).replace(/\s+/g, ' ').trim();
  console.log('      alarm reads:', JSON.stringify(quotaText));
  check('the alarm explains the data is only on screen', /only on screen/i.test(quotaText));
  check('an export button is offered as the way out', await page2.isVisible('#storageAlertExportBtn'));

  // ---------- 3. backup nudge ----------
  const page3 = await (await browser.newContext()).newPage();
  page3.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));

  // (a) no issues yet — nothing to lose, so no nagging
  await page3.goto(APP);
  await page3.waitForTimeout(400);
  check('no nudge on an empty ledger', !(await page3.isVisible('#backupNudge')));

  // (b) issues but never backed up
  await page3.evaluate(([k, v]) => localStorage.setItem(k, v), [ISSUES, JSON.stringify([anIssue])]);
  await page3.reload();
  await page3.waitForTimeout(400);
  check('nudge appears once there is data and no backup', await page3.isVisible('#backupNudge'));
  check('it says never', /never/i.test(await page3.textContent('#backupNudgeText')));

  // (c) backed up today — quiet
  await page3.evaluate(([k]) => localStorage.setItem(k, new Date().toISOString()), [LAST_BACKUP]);
  await page3.reload();
  await page3.waitForTimeout(400);
  check('a fresh backup silences the nudge', !(await page3.isVisible('#backupNudge')));
  await page3.click('#menuBtn');
  await page3.waitForTimeout(150);
  check('the menu reports the backup age', /last backup today/i.test(await page3.textContent('#menuBackupNote')));
  await page3.keyboard.press('Escape');

  // (d) 20 days stale — nag again
  await page3.evaluate(([k]) => {
    const d = new Date(); d.setDate(d.getDate() - 20);
    localStorage.setItem(k, d.toISOString());
  }, [LAST_BACKUP]);
  await page3.reload();
  await page3.waitForTimeout(400);
  check('a 20-day-old backup brings the nudge back', await page3.isVisible('#backupNudge'));
  check('it states the age', /20 days ago/.test(await page3.textContent('#backupNudgeText')),
    (await page3.textContent('#backupNudgeText')).trim());

  // (e) dismiss is for this session only — it must return next time
  await page3.click('#backupNudgeDismiss');
  await page3.waitForTimeout(200);
  check('dismiss hides it', !(await page3.isVisible('#backupNudge')));
  await page3.reload();
  await page3.waitForTimeout(400);
  check('dismiss does not persist across a reload', await page3.isVisible('#backupNudge'));

  // (f) taking a backup records the date and clears the nudge
  const dl = page3.waitForEvent('download').catch(() => null);
  await page3.click('#backupNudgeBtn');
  await dl;
  await page3.waitForTimeout(900);
  const recorded = await page3.evaluate((k) => localStorage.getItem(k), LAST_BACKUP);
  check('exporting records the backup date', !!recorded && recorded.slice(0, 4) >= '2020', recorded);
  check('and the nudge clears', !(await page3.isVisible('#backupNudge')));

  // ---------- 4. downloads report what happened ----------
  const page4 = await (await browser.newContext()).newPage();
  page4.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  await page4.goto(APP);
  await page4.evaluate(([k, v]) => localStorage.setItem(k, v), [ISSUES, JSON.stringify([anIssue])]);
  await page4.reload();
  await page4.waitForTimeout(400);

  // a working download must not claim more than it knows
  const dl4 = page4.waitForEvent('download').catch(() => null);
  await page4.click('#menuBtn');
  await page4.click('#exportJsonBtn');
  await dl4;
  await page4.waitForTimeout(900);
  const okToast = (await page4.textContent('#toast')).trim();
  console.log('      toast reads:', JSON.stringify(okToast));
  check('a started download does not claim to be complete', !/^Downloaded/i.test(okToast), okToast);

  // a download the browser refuses must say so, not report success
  await page4.evaluate(() => {
    URL.createObjectURL = function () { throw new Error('blocked'); };
  });
  await page4.click('#menuBtn');
  await page4.click('#exportJsonBtn');
  await page4.waitForTimeout(1200);
  const failToast = (await page4.textContent('#toast')).trim();
  console.log('      toast reads:', JSON.stringify(failToast));
  check('a blocked download is reported as a failure', /couldn'?t start/i.test(failToast), failToast);

  console.log(errors.length ? '\nErrors:\n' + errors.join('\n') : '\nNo errors');
  if (errors.length) failed++;
  await browser.close();
  console.log(failed ? `FAILED: ${failed} assertion(s)` : 'STORAGE SAFETY: OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
