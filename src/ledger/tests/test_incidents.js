/* Incidents and RIDDOR clocks.
 *
 * The point of separating incidents from issues is that one of them starts a statutory
 * clock. So the assertions are mostly about the clock: that it counts from the incident
 * date, that the windows differ by type, that an overdue report says OVERDUE rather than
 * quietly showing a negative number, and — the one that actually loses people — that an
 * incident nobody has assessed for RIDDOR cannot sit silently.
 *
 * The app must NOT decide reportability. That is the user's call with WorkNest, and the
 * UI has to say so.
 */
const { chromium } = require('playwright');
const path = require('path');

const APP = 'file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html');
const KEY = 'estatesLedger.incidents.v1';

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const iso = (o) => { const d = new Date(); d.setDate(d.getDate() + o);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const SEED = [
  // specified injury 2 days ago: 10-day window, so 8 days left
  { id: 'a', ref: 'INC-2026-001', date: iso(-2), site: 'Mayfair', type: 'Injury',
    location: 'Gaming floor', personType: 'Employee', personRef: 'JS',
    riddor: 'specified', investigationStatus: 'In progress' },
  // over-7-day 12 days ago: 15-day window, so 3 days left
  { id: 'b', ref: 'INC-2026-002', date: iso(-12), site: 'Glasgow', type: 'Injury',
    personType: 'Employee', personRef: 'Duty Manager',
    riddor: 'over7', investigationStatus: 'In progress' },
  // dangerous occurrence 14 days ago, 10-day window: 4 days OVERDUE
  { id: 'c', ref: 'INC-2026-003', date: iso(-14), site: 'Park Lane', type: 'Dangerous occurrence',
    riddor: 'dangerous', investigationStatus: 'Actions outstanding' },
  // never assessed — the silent one
  { id: 'd', ref: 'INC-2026-004', date: iso(-4), site: 'Nottingham', type: 'Near miss',
    riddor: 'unassessed', investigationStatus: 'Not started' },
  // reported already: no clock
  { id: 'e', ref: 'INC-2026-005', date: iso(-30), site: 'Manchester', type: 'Injury',
    riddor: 'over7', riddorReportedDate: iso(-25), riddorRef: 'HSE-12345', investigationStatus: 'Closed' },
  // not reportable, closed: silent
  { id: 'f', ref: 'INC-2026-006', date: iso(-40), site: 'Mayfair', type: 'Near miss',
    riddor: 'none', investigationStatus: 'Closed' },
];

/* Scoped to the "All incidents" section on purpose. The "Needs action" rows above also
   contain the reference but carry no badge, so an unscoped search finds those first and
   every badge assertion reads null. */
const rowFor = (page, ref) => page.evaluate((r) => {
  const secs = [...document.querySelectorAll('#incidentBody .today-section')];
  const all = secs.find((x) => x.querySelector('.eyebrow').textContent.startsWith('All incidents'));
  const row = [...all.querySelectorAll('.today-row')].find((x) => x.textContent.includes(r));
  return row ? { text: row.textContent.replace(/\s+/g, ' ').trim(), badge: row.querySelector('.today-badge') ? row.querySelector('.today-badge').textContent.trim() : null } : null;
}, ref);

const ask = async (page, q) => {
  await page.fill('#vectorInput', q);
  await page.click('#vectorSendBtn');
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const m = [...document.querySelectorAll('#vectorLog .vlog-vector')];
    return m[m.length - 1].textContent.trim();
  });
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1100 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });

  await page.goto(APP);
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, JSON.stringify(SEED)]);
  await page.reload();
  await page.waitForTimeout(400);

  check('Incidents is in the topbar', await page.isVisible('#incidentsBtn'));
  await page.click('#incidentsBtn');
  await page.waitForTimeout(400);

  const intro = await page.textContent('#incidentBody');
  check('it says the app does not decide reportability',
    /does not decide whether something is reportable/i.test(intro));
  check('it points the decision at WorkNest', /WorkNest/.test(intro));
  check('it warns against names and medical detail', /names and medical detail/i.test(intro));

  // ---------- the clocks ----------
  const a = await rowFor(page, 'INC-2026-001');
  console.log('      specified injury, 2 days ago:', a.badge);
  check('10-day window counts from the incident date', a.badge === 'report in 8d', a.badge);

  const b = await rowFor(page, 'INC-2026-002');
  console.log('      over-7-day, 12 days ago:', b.badge);
  check('over-7-day gets 15 days, not 10', b.badge === 'report in 3d', b.badge);

  const c = await rowFor(page, 'INC-2026-003');
  console.log('      dangerous occurrence, 14 days ago:', c.badge);
  check('a missed deadline says OVERDUE, not a negative number',
    /OVERDUE/.test(c.badge) && /4d/.test(c.badge), c.badge);

  const d = await rowFor(page, 'INC-2026-004');
  check('an unassessed incident is flagged, not left blank', d.badge === 'not assessed', d.badge);

  const e = await rowFor(page, 'INC-2026-005');
  check('a reported incident stops its clock', /^reported /.test(e.badge), e.badge);

  const f = await rowFor(page, 'INC-2026-006');
  check('a non-reportable one runs no clock', f.badge === 'not reportable', f.badge);

  // ---------- the action list ----------
  const actions = await page.evaluate(() => {
    const secs = [...document.querySelectorAll('#incidentBody .today-section')];
    const s = secs.find((x) => x.querySelector('.eyebrow').textContent.startsWith('Needs action'));
    return [...s.querySelectorAll('.today-title')].map((t) => t.textContent.trim());
  });
  console.log('      needs action:', JSON.stringify(actions));
  check('the overdue report is top of the list', /OVERDUE/.test(actions[0]), actions[0]);
  check('the unassessed one is on the list', actions.some((x) => /not assessed/i.test(x)));
  check('a long-open investigation is on the list', actions.some((x) => /Investigation still open/.test(x)));
  check('closed and reported incidents are not', actions.length === 5, `${actions.length}`);
  check('one incident can raise two different actions — an overdue report and a stale investigation',
    actions.filter((x) => /OVERDUE|Investigation still open/.test(x)).length === 2);

  // ---------- stats for the Board report ----------
  const stats = await page.evaluate(() =>
    [...document.querySelectorAll('.inc-stat')].map((s) => s.querySelector('.l').textContent + '=' + s.querySelector('.n').textContent));
  console.log('      stats:', JSON.stringify(stats));
  check('RIDDOR YTD is counted separately', stats.some((s) => /RIDDOR YTD=/.test(s)));
  check('near misses are counted', stats.some((s) => /Near misses=2/.test(s)), JSON.stringify(stats));
  check('open investigations are counted', stats.some((s) => /Open investigations=4/.test(s)), JSON.stringify(stats));

  // ---------- recording one ----------
  await page.click('#newIncidentBtn');
  await page.waitForTimeout(300);
  check('the form defaults the date to today', (await page.inputValue('#in-date')) === iso(0));
  check('and RIDDOR to not-yet-assessed', (await page.inputValue('#in-riddor')) === 'unassessed');
  check('the person field steers away from full names',
    /not full names/i.test(await page.getAttribute('#in-personRef', 'placeholder')),
    await page.getAttribute('#in-personRef', 'placeholder'));

  // the date drives the clock, so it cannot be optional
  await page.selectOption('#in-site', 'Mayfair');
  await page.fill('#in-date', '');
  await page.click('#saveIncidentBtn');
  await page.waitForTimeout(250);
  check('saving without a date is refused, because the date IS the clock',
    /reporting clock/.test((await page.textContent('#toast')).trim()),
    (await page.textContent('#toast')).trim());

  await page.fill('#in-date', iso(-1));
  await page.selectOption('#in-type', 'Injury');
  await page.selectOption('#in-riddor', 'specified');
  await page.fill('#in-location', 'Back of house stairs');
  await page.click('#saveIncidentBtn');
  await page.waitForTimeout(500);

  const toast = (await page.textContent('#toast')).trim();
  console.log('      save toast:', JSON.stringify(toast));
  check('saving tells you the reporting deadline', /RIDDOR report due/.test(toast), toast);
  check('and that this type is notifiable without delay too',
    /without delay/.test(toast), toast);
  check('a reference is allocated', /INC-\d{4}-\d{3}/.test(toast), toast);

  const saved = await page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
  check('it persists', saved.length === 7, `${saved.length}`);
  check('the reference is unique', new Set(saved.map((i) => i.ref)).size === 7);

  // ---------- Today, where he will actually see it ----------
  await page.click('#incidentCloseBtn');
  await page.waitForTimeout(200);
  await page.click('#todayBtn');
  await page.waitForTimeout(400);
  const today = await page.textContent('#todayModalBody');
  check('incidents appear in Today', /RIDDOR/.test(today));

  const order = await page.evaluate(() =>
    [...document.querySelectorAll('#todayModalBody .eyebrow')].map((e) => e.textContent.trim()));
  console.log('      Today sections:', JSON.stringify(order));
  check('incidents sit above overdue jobs — a regulator outranks a leaking roof',
    order.findIndex((x) => /Incidents/.test(x)) === 0, JSON.stringify(order));
  check('the headline counts incident actions',
    /incident action/.test(await page.textContent('.today-count')),
    (await page.textContent('.today-count')).trim());

  await page.click('#todayModalBody [data-incident-id]');
  await page.waitForTimeout(500);
  check('clicking one opens that incident', await page.isVisible('#in-riddor'));
  await page.click('#incidentCloseBtn');
  await page.waitForTimeout(200);

  // ---------- Vector ----------
  await page.click('#vectorBtn');
  await page.waitForTimeout(300);
  let ans = await ask(page, 'how many incidents this year');
  console.log('      Q: how many incidents this year\n      A:', ans.slice(0, 220));
  check('Vector reports incident counts', /incident\(s\) year to date/.test(ans), ans.slice(0, 80));
  check('separating RIDDOR reportable', /RIDDOR reportable YTD/.test(ans));
  check('and flags the unassessed as the thing to clear first',
    /not yet assessed/.test(ans) && /unmade decision/.test(ans), ans.slice(-140));

  ans = await ask(page, 'any near misses');
  check('near misses are answerable', /near miss/.test(ans), ans.slice(0, 80));

  ans = await ask(page, 'brief me');
  check('the brief leads with incident actions', /incident action/.test(ans), ans.slice(0, 140));

  // ---------- backup coverage ----------
  check('incidents are in BACKUP_KEYS',
    await page.evaluate(() => {
      const raw = localStorage.getItem('estatesLedger.incidents.v1');
      return !!raw;
    }));
  await page.click('#vectorCloseBtn');   // its overlay blocks the ⋮ menu
  await page.waitForTimeout(300);
  const dl = page.waitForEvent('download').catch(() => null);
  await page.click('#menuBtn');
  await page.click('#exportJsonBtn');
  const d2 = await dl;
  if (d2) {
    const fs = require('fs');
    const p = await d2.path();
    const payload = JSON.parse(fs.readFileSync(p, 'utf8'));
    check('and they ride in the exported backup',
      !!payload.localState && !!payload.localState['estatesLedger.incidents.v1'],
      Object.keys(payload.localState || {}).length + ' keys in localState');
  } else {
    check('backup download produced a file', false);
  }

  console.log(errors.length ? '\nErrors:\n' + errors.join('\n') : '\nNo errors');
  if (errors.length) failed++;
  await browser.close();
  console.log(failed ? `FAILED: ${failed} assertion(s)` : 'INCIDENTS: OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
