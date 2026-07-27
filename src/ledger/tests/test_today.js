/* The Today view and voice capture.
 *
 * Today is pure derivation — it stores nothing of its own — so the assertions are about
 * whether the right issues land in the right bucket, and whether the quick actions
 * actually persist. The "Chase" bucket is the one with no equivalent elsewhere in the
 * app: jobs sitting with a contractor where nothing has moved for a week. Those never
 * show as overdue (their target date can be weeks out) which is exactly why they slip.
 */
const { chromium } = require('playwright');
const path = require('path');

const APP = 'file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html');
const ISSUES = 'estatesLedger.issues.v1';

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const iso = (offset) => {
  const d = new Date(); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + offset);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

const SEED = [
  { id: 'a', title: 'Chiller 2 tripping', site: 'Mayfair', category: 'M&E / Plant', status: 'Open',
    risk: 3, urgency: 3, cost: 2, targetDate: iso(-5), dateReported: iso(-20), notes: [] },
  { id: 'b', title: 'Fire door closer dragging', site: 'Glasgow', category: 'Health & Safety', status: 'In Progress',
    risk: 2, urgency: 2, cost: 1, targetDate: iso(0), dateReported: iso(-3), notes: [] },
  // assigned and due in 2 days: not silent, but too close to leave — the "closing" trigger
  { id: 'c', title: 'Roof leak above cash desk', site: 'Park Lane', category: 'Fabric & Building', status: 'Open',
    risk: 2, urgency: 2, cost: 2, targetDate: iso(2), dateReported: iso(-1), assigned: 'Dalkia', notes: [] },
  { id: 'd', title: 'Lift service overdue', site: 'Manchester', category: 'M&E / Plant', status: 'Awaiting Contractor',
    risk: 3, urgency: 2, cost: 2, targetDate: iso(25), dateReported: iso(-30), notes: [] },
  { id: 'e', title: 'Recently chased extractor clean', site: 'Nottingham', category: 'Other', status: 'Awaiting Contractor',
    risk: 1, urgency: 1, cost: 1, targetDate: iso(20), dateReported: iso(-40),
    notes: [{ id: 'n1', ts: new Date(Date.now() - 2 * 86400000).toISOString(), text: 'Chased by phone' }] },
  { id: 'f', title: 'Signage replacement', site: 'Marble Arch', category: 'Other', status: 'Open',
    risk: 1, urgency: 1, cost: 1, targetDate: '', dateReported: iso(-2), notes: [] },
  { id: 'g', title: 'Closed job that must not appear', site: 'Mayfair', category: 'Other', status: 'Closed',
    risk: 3, urgency: 3, cost: 3, targetDate: iso(-2), dateReported: iso(-10), notes: [] },
];

const sectionRows = (page, heading) => page.evaluate((h) => {
  const secs = [...document.querySelectorAll('#todayModalBody .today-section')];
  const s = secs.find((x) => x.querySelector('.eyebrow').textContent.startsWith(h));
  return s ? [...s.querySelectorAll('.today-title')].map((t) => t.textContent.trim()) : null;
}, heading);

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });

  await page.goto(APP);
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [ISSUES, JSON.stringify(SEED)]);
  await page.reload();
  await page.waitForTimeout(400);

  check('Today is the first topbar action', await page.isVisible('#todayBtn'));
  await page.click('#todayBtn');
  await page.waitForTimeout(400);
  check('the Today view opens', !!(await page.$('#todayOverlay.open')));

  const headline = (await page.textContent('.today-count')).trim();
  console.log('      headline:', JSON.stringify(headline));
  check('headline counts overdue and due today', /1 overdue/.test(headline) && /1 due today/.test(headline), headline);

  check('overdue bucket', JSON.stringify(await sectionRows(page, 'Overdue')) === '["Chiller 2 tripping"]',
    JSON.stringify(await sectionRows(page, 'Overdue')));
  check('due-today bucket', JSON.stringify(await sectionRows(page, 'Due today')) === '["Fire door closer dragging"]',
    JSON.stringify(await sectionRows(page, 'Due today')));
  check('next-7-days bucket', JSON.stringify(await sectionRows(page, 'Next 7 days')) === '["Roof leak above cash desk"]',
    JSON.stringify(await sectionRows(page, 'Next 7 days')));
  check('undated bucket', JSON.stringify(await sectionRows(page, 'No target date')) === '["Signage replacement"]',
    JSON.stringify(await sectionRows(page, 'No target date')));

  /* --- chase: two independent triggers ---
   * "quiet for N days" alone fired too late — a chase sent on the due date is useless,
   * it's already late. So an approaching target date also lists a job, silent or not. */
  const chase = await sectionRows(page, 'Chase');
  check('chase catches the job that has gone quiet', (chase || []).includes('Lift service overdue'),
    JSON.stringify(chase));
  check('chase ignores one chased two days ago (default quiet = 4)',
    !(chase || []).some((t) => /extractor/.test(t)), JSON.stringify(chase));
  check('chase catches a job whose deadline is closing, even though it is not silent',
    (chase || []).includes('Roof leak above cash desk'), JSON.stringify(chase));

  const chaseBadges = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('#todayModalBody .today-section')];
    const s = secs.find((x) => x.querySelector('.eyebrow').textContent.startsWith('Chase'));
    return [...s.querySelectorAll('.today-badge')].map((b) => b.textContent.trim());
  });
  console.log('      chase badges:', JSON.stringify(chaseBadges));
  check('each row says why it is listed', chaseBadges.every((b) => /quiet \d+d|due/.test(b)),
    JSON.stringify(chaseBadges));

  // the thresholds are the user's to set — the section renders even when empty so they stay reachable
  check('the thresholds are editable in the view', await page.isVisible('#chaseQuietDays'));
  check('quiet days defaults to 4', (await page.inputValue('#chaseQuietDays')) === '4');
  check('lead days defaults to 3', (await page.inputValue('#chaseLeadDays')) === '3');

  await page.fill('#chaseQuietDays', '2');
  await page.dispatchEvent('#chaseQuietDays', 'change');
  await page.waitForTimeout(400);
  const chaseLoose = await sectionRows(page, 'Chase');
  check('loosening to 2 days pulls in the recently-chased job',
    (chaseLoose || []).some((t) => /extractor/.test(t)), JSON.stringify(chaseLoose));
  check('the threshold persists',
    JSON.parse(await page.evaluate(() => localStorage.getItem('estatesLedger.chaseRules.v1'))).quietDays === 2);

  await page.fill('#chaseQuietDays', '4');
  await page.dispatchEvent('#chaseQuietDays', 'change');
  await page.waitForTimeout(400);

  await page.fill('#chaseLeadDays', '0');
  await page.dispatchEvent('#chaseLeadDays', 'change');
  await page.waitForTimeout(400);
  const chaseTight = await sectionRows(page, 'Chase');
  check('dropping lead days to 0 removes the not-yet-due job',
    !(chaseTight || []).some((t) => /Roof leak/.test(t)), JSON.stringify(chaseTight));
  await page.fill('#chaseLeadDays', '3');
  await page.dispatchEvent('#chaseLeadDays', 'change');
  await page.waitForTimeout(400);

  const all = await page.textContent('#todayModalBody');
  check('closed issues never appear', !/must not appear/.test(all));

  // --- quick actions persist ---
  await page.click('.today-row[data-id="a"] [data-act="snooze"]');
  await page.waitForTimeout(400);
  const snoozed = await page.evaluate((k) =>
    JSON.parse(localStorage.getItem(k)).find((i) => i.id === 'a').targetDate, ISSUES);
  check('+1w moves the target date a week on', snoozed === iso(2), `${snoozed} (expected ${iso(2)})`);
  check('and it leaves the overdue bucket', !/Chiller 2/.test(await page.textContent('#todayModalBody')) ||
    JSON.stringify(await sectionRows(page, 'Overdue')) === 'null');

  await page.click('.today-row[data-id="b"] [data-act="done"]');
  await page.waitForTimeout(400);
  const done = await page.evaluate((k) =>
    JSON.parse(localStorage.getItem(k)).find((i) => i.id === 'b'), ISSUES);
  check('Done marks it resolved', done.status === 'Resolved', done.status);
  check('Done stamps the resolved date', done.resolvedDate === iso(0), done.resolvedDate);
  check('and it disappears from Today', !/Fire door closer/.test(await page.textContent('#todayModalBody')));

  // --- a row opens the issue, the action buttons do not ---
  await page.click('.today-row[data-id="c"] .today-title');
  await page.waitForTimeout(400);
  check('clicking a row opens the issue detail', !!(await page.$('#detailDrawer.open')));
  check('and closes Today behind it', !(await page.$('#todayOverlay.open')));
  await page.click('#detailCloseBtn');
  await page.waitForTimeout(300);

  // --- voice capture wiring (the mic itself can't run headless) ---
  check('a voice button sits in the topbar', await page.isVisible('#voiceCaptureBtn'));
  await page.click('#todayBtn');
  await page.waitForTimeout(300);
  check('and one inside Today', await page.isVisible('#todayVoiceBtn'));

  await page.click('#todayVoiceBtn');
  await page.waitForTimeout(300);
  const toast = (await page.textContent('#toast')).trim();
  console.log('      voice toast:', JSON.stringify(toast));
  /* Either outcome is correct and which one you get is a race: "Listening" shows first,
     and where there is no usable microphone the error handler replaces it a moment later.
     What must never happen is silence — a mic button that does nothing visible leaves you
     talking to a screen that isn't recording. */
  check('pressing it gives visible feedback either way',
    /listening/i.test(toast) || /microphone|isn'?t supported|couldn'?t start/i.test(toast), toast);
  await browser.close();

  /* --- the transcript -> form path ---
   * A real mic needs hardware and a network round trip to Google, neither of which
   * exists headless. Swapping the constructor in BEFORE the app's script runs means the
   * app builds its recogniser from the fake and the actual wiring is exercised — rather
   * than exposing internals purely for the test. */
  const b2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p2 = await b2.newPage({ viewport: { width: 1280, height: 1100 } });
  p2.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  await p2.addInitScript(() => {
    window.__spoke = null;
    function Fake() { this.onresult = null; this.onend = null; this.onerror = null; }
    Fake.prototype.start = function () {
      setTimeout(() => {
        if (this.onresult) this.onresult({ results: [[{ transcript: window.__spoke }]] });
        if (this.onend) this.onend();
      }, 30);
    };
    Fake.prototype.stop = function () {};
    window.webkitSpeechRecognition = Fake;
    window.SpeechRecognition = Fake;
  });
  await p2.goto(APP);
  await p2.waitForTimeout(300);

  await p2.evaluate(() => {
    window.__spoke = 'Chiller two in the Mayfair plant room is tripping again, needs an engineer by Friday';
  });
  await p2.click('#voiceCaptureBtn');
  await p2.waitForTimeout(500);

  check('dictating opens the log form', !!(await p2.$('#formDrawer.open')));
  check('it is a new issue, not an edit',
    (await p2.textContent('#formDrawerTitle')).trim() === 'Log issue');
  const vTitle = await p2.inputValue('#f-title');
  check('the words spoken become the title', /Chiller two/.test(vTitle), vTitle);
  check('the venue is picked out of speech', (await p2.inputValue('#f-site')) === 'Mayfair',
    await p2.inputValue('#f-site'));
  check('the category is picked out of speech', (await p2.inputValue('#f-category')) === 'M&E / Plant',
    await p2.inputValue('#f-category'));
  const vTarget = await p2.inputValue('#f-target');
  check('"by Friday" becomes a target date', /^\d{4}-\d{2}-\d{2}$/.test(vTarget), vTarget);
  check('nothing is saved until Save is pressed',
    (await p2.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]').length, ISSUES)) === 0);

  // and the assistant's own mic must still talk to the assistant, not the form
  await p2.click('#formCancelBtn');
  await p2.waitForTimeout(200);
  await p2.evaluate(() => { window.__spoke = 'how many open issues'; });
  await p2.click('#vectorBtn').catch(() => {});
  await p2.waitForTimeout(300);
  if (await p2.isVisible('#vectorMicBtn')) {
    await p2.click('#vectorMicBtn');
    await p2.waitForTimeout(400);
    check('the assistant mic still routes to the assistant, not the issue form',
      !(await p2.$('#formDrawer.open')));
  }
  await b2.close();

  console.log(errors.length ? '\nErrors:\n' + errors.join('\n') : '\nNo errors');
  if (errors.length) failed++;
  console.log(failed ? `FAILED: ${failed} assertion(s)` : 'TODAY: OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
