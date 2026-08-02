/* Leases — written from the OCCUPIER's side.
 *
 * The single most valuable thing in this module is derived, not entered: the date notice
 * must be served, which is the break date minus the notice period. That is typically
 * 6–12 months before the date written on the lease, it is the date that actually matters,
 * and missing it forfeits the break for the rest of the term. Most of this file exists to
 * pin that calculation down.
 *
 * The rest asserts the tenant framing — exposure flagged as exposure, not recorded as a
 * neutral fact. A landlord-side module would hold the same dates and draw the opposite
 * conclusions from them.
 */
const { chromium } = require('playwright');
const path = require('path');

const APP = 'file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html');
const SITE_DETAILS = 'estatesLedger.siteDetails.v1';

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const iso = (o) => { const d = new Date(); d.setDate(d.getDate() + o);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

/* Mayfair: a break 10 months out needing 6 months' notice — so the date that matters is
   about 4 months away, not 10. FRI with no schedule of condition, upward-only review,
   uncapped service charge, consent needed for alterations, contracted out. Every trap. */
const DETAILS = {
  Mayfair: {
    contacts: [], compliance: [], locations: [],
    lease: {
      landlordAgent: 'Gerald Eve', ourAgent: 'Cushman', demise: 'Ground and basement',
      startDate: '2016-03-25', expiryDate: iso(400), passingRent: '450000',
      securityOfTenure: 'Contracted out',
      breakType: 'Tenant only', breakDate: iso(300), breakNoticeMonths: '6',
      breakConditions: 'rent paid up to date and vacant possession',
      reviewDate: iso(120), reviewBasis: 'Open market', reviewUpwardOnly: 'Yes',
      repairingObligation: 'FRI (full repairing & insuring)', scheduleOfCondition: 'No',
      dilapsProvision: '', alterationsConsent: 'Required',
      serviceCharge: '85000', serviceChargeCap: '',
      rateableValue: '390000', ratesAppealDeadline: iso(45),
    },
  },
  // Glasgow: the well-run counterexample — nothing should be flagged
  Glasgow: {
    contacts: [], compliance: [], locations: [],
    lease: {
      expiryDate: iso(2000), passingRent: '120000', securityOfTenure: 'Protected (1954 Act)',
      breakType: 'None', repairingObligation: 'Internal repairing only',
      scheduleOfCondition: 'Yes', reviewUpwardOnly: 'No',
      serviceCharge: '20000', serviceChargeCap: '£25,000', alterationsConsent: 'Not required',
    },
  },
};

const openLease = async (page, site) => {
  await page.click('#sitesBtn');
  await page.waitForTimeout(250);
  await page.click(`.site-row[data-key="${site}"]`);
  await page.waitForTimeout(400);
  await page.click('[data-ptab="lease"]');
  await page.waitForTimeout(300);
};

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
  await page.evaluate(([k, v]) => localStorage.setItem(k, v), [SITE_DETAILS, JSON.stringify(DETAILS)]);
  await page.reload();
  await page.waitForTimeout(400);

  await openLease(page, 'Mayfair');
  check('the site profile has a Lease tab', await page.isVisible('#profileLeasePane'));

  const pane = await page.textContent('#profileLeasePane');
  check('framed from the occupier side', /occupier/i.test(pane));

  // ---------- the derived notice date, which is the point ----------
  const alerts = await page.evaluate(() =>
    [...document.querySelectorAll('.lease-alert')].map((a) => a.textContent.replace(/\s+/g, ' ').trim()));
  console.log('      key dates:', JSON.stringify(alerts, null, 0).slice(0, 320));

  const notice = alerts.find((a) => /Serve break notice/.test(a));
  check('a break notice deadline is derived', !!notice, notice);

  // break is 300 days out with 6 months' notice: the deadline is ~4 months from now,
  // NOT the break date — the whole reason this module exists
  const noticeDays = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.lease-alert')].find((a) => /Serve break notice/.test(a.textContent));
    return parseInt(el.querySelector('.la-when').textContent.replace(/\D+/g, ''), 10);
  });
  check('the notice deadline is months BEFORE the break date',
    noticeDays > 100 && noticeDays < 160, `${noticeDays} days away (break is 300 days away)`);
  check('it is flagged as the critical one',
    await page.evaluate(() => !![...document.querySelectorAll('.lease-alert.critical')]
      .find((a) => /Serve break notice/.test(a.textContent))));
  check('the notice period is shown alongside', /6 months' notice/.test(notice), notice);

  check('lease expiry is tracked', alerts.some((a) => /Lease expires/.test(a)));
  check('rent review is tracked', alerts.some((a) => /Rent review/.test(a)));
  check('rates appeal deadline is tracked', alerts.some((a) => /Rates appeal/.test(a)));

  // ---------- exposure, stated as exposure ----------
  const risks = await page.evaluate(() =>
    [...document.querySelectorAll('.lease-risk')].map((r) => r.textContent.trim()));
  console.log('      exposure flags:', risks.length);
  risks.forEach((r) => console.log('        · ' + r.slice(0, 110)));

  check('FRI with no schedule of condition is flagged',
    risks.some((r) => /no schedule of condition/i.test(r) && /open-ended/i.test(r)));
  check('the conditional break is flagged as a risk of losing it',
    risks.some((r) => /conditional/i.test(r) && /technicalit/i.test(r)));
  check('upward-only review is flagged as one-way',
    risks.some((r) => /[Uu]pward-only/.test(r) && /cannot fall/i.test(r)));
  check('uncapped service charge is flagged as unbounded',
    risks.some((r) => /no cap/i.test(r) && /unbounded/i.test(r)));
  check('consent for alterations is tied to the refit programme',
    risks.some((r) => /consent/i.test(r) && /critical path|reformat/i.test(r)));
  check('contracting out is flagged as no right to renew',
    risks.some((r) => /1954/.test(r) && /no automatic right/i.test(r)));
  check('it does not claim to be legal advice', /not legal advice/i.test(pane));

  // ---------- the well-run lease raises nothing ----------
  await page.click('#sitesCloseBtn');
  await page.waitForTimeout(200);
  await openLease(page, 'Glasgow');
  const gRisks = await page.evaluate(() => document.querySelectorAll('.lease-risk').length);
  check('a lease with none of the traps flags nothing', gRisks === 0, `${gRisks} flags`);

  // ---------- editing recalculates ----------
  await page.click('#sitesCloseBtn');
  await page.waitForTimeout(200);
  await openLease(page, 'Mayfair');
  await page.fill('#lz-breakNoticeMonths', '12');
  await page.click('#saveLeaseBtn');
  await page.waitForTimeout(500);
  /* A break 10 months away needing 12 months' notice cannot be exercised — the deadline
     is already behind you. That is the exact scenario that loses a break, so the app has
     to show it as past rather than quietly rendering a positive number. */
  const noticeWhen = await page.evaluate(() => {
    const el = [...document.querySelectorAll('.lease-alert')].find((a) => /Serve break notice/.test(a.textContent));
    return el ? el.querySelector('.la-when').textContent.trim() : null;
  });
  check('12 months notice on a 10-month break shows the deadline as already gone',
    /ago/.test(noticeWhen || ''), `${noticeWhen} (was "in ${noticeDays} days" at 6 months)`);
  check('it persists', await page.evaluate((k) =>
    JSON.parse(localStorage.getItem(k)).Mayfair.lease.breakNoticeMonths === '12', SITE_DETAILS));

  // a break with no notice period recorded is itself the risk
  await page.fill('#lz-breakNoticeMonths', '');
  await page.click('#saveLeaseBtn');
  await page.waitForTimeout(500);
  check('a break with no notice period is flagged as unknowable',
    await page.evaluate(() => [...document.querySelectorAll('.lease-risk')]
      .some((r) => /no notice period/i.test(r.textContent) && /forfeited/i.test(r.textContent))));
  await page.fill('#lz-breakNoticeMonths', '6');
  await page.click('#saveLeaseBtn');
  await page.waitForTimeout(500);
  await page.click('#sitesCloseBtn');
  await page.waitForTimeout(200);

  // ---------- it reaches Today, where he'll actually see it ----------
  await page.click('#todayBtn');
  await page.waitForTimeout(400);
  const today = await page.textContent('#todayModalBody');
  check('lease deadlines appear in Today', /Lease & estate/.test(today) || /Lease &amp; estate/.test(today));
  check('with the derived notice date, not the break date', /Serve break notice/.test(today));
  check('the headline counts near-term lease deadlines',
    /lease deadline/.test(await page.textContent('.today-count')),
    (await page.textContent('.today-count')).trim());

  await page.click('[data-lease-site="Mayfair"]');
  await page.waitForTimeout(600);
  check('clicking one opens that site on its Lease tab', await page.isVisible('#profileLeasePane'));
  await page.click('#sitesCloseBtn');
  await page.waitForTimeout(200);

  // ---------- Vector ----------
  await page.click('#vectorBtn');
  await page.waitForTimeout(300);

  let a = await ask(page, 'what lease deadlines are coming up');
  console.log('      Q: what lease deadlines are coming up\n      A:', a.slice(0, 200));
  check('Vector lists lease deadlines', /lease deadline/.test(a), a.slice(0, 90));
  check('and says why breaks show so far out', /rest of the term/.test(a));

  a = await ask(page, 'tell me about the Mayfair lease');
  console.log('      Q: tell me about the Mayfair lease\n      A:', a.slice(0, 220));
  check('Vector summarises a named lease', /Mayfair — term expires/.test(a), a.slice(0, 90));
  check('including the passing rent', /£450,000/.test(a));
  check('and surfaces the exposure', /Exposure:/.test(a));

  a = await ask(page, 'when does the Mayfair lease expire');
  check('a lease question is not swallowed by the compliance answer',
    !/register/.test(a) && /Mayfair/.test(a), a.slice(0, 90));

  a = await ask(page, 'what compliance is due in 90 days');
  check('compliance questions still reach the compliance answer',
    /compliance registers|item\(s\) due within/.test(a), a.slice(0, 90));

  a = await ask(page, 'brief me');
  check('the brief mentions lease deadlines', /lease deadline/.test(a), a.slice(0, 160));

  // ---------- a site with no lease says so plainly ----------
  a = await ask(page, 'tell me about the Nottingham lease');
  check('an empty lease says what to do about it', /No lease recorded for Nottingham/.test(a), a.slice(0, 90));

  // ---------- and it survives a backup round trip ----------
  check('lease data rides in siteDetails, already covered by BACKUP_KEYS',
    await page.evaluate((k) => !!JSON.parse(localStorage.getItem(k)).Mayfair.lease.breakDate, SITE_DETAILS));

  console.log(errors.length ? '\nErrors:\n' + errors.join('\n') : '\nNo errors');
  if (errors.length) failed++;
  await browser.close();
  console.log(failed ? `FAILED: ${failed} assertion(s)` : 'LEASE: OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
