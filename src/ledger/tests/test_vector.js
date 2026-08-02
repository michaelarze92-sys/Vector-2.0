/* Vector: search and analytics.
 *
 * Every assertion is a question Michael might actually type, checked against the answer
 * that comes back. The old search only looked at issues, matched exact substrings,
 * weighted every field the same and refused to answer on a tie — so most of these
 * questions returned "add the site name to narrow it down". That refusal is the specific
 * behaviour being regression-tested against.
 */
const { chromium } = require('playwright');
const path = require('path');

const APP = 'file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html');

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const iso = (o) => { const d = new Date(); d.setDate(d.getDate() + o);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const ISSUES = [
  { id: 'a', title: 'Chiller 2 tripping on high pressure', site: 'Mayfair', category: 'M&E / Plant',
    status: 'Awaiting Contractor', risk: 3, urgency: 3, cost: 3, assigned: 'Dalkia',
    targetDate: iso(-6), dateReported: iso(-40), costEstimate: 12000, actualCost: 0,
    notes: [{ id: 'n1', ts: new Date(Date.now() - 30 * 86400000).toISOString(), kind: 'email',
              direction: 'Received', from: 'dave@dalkia.co.uk', subject: 'Chiller 2',
              text: 'Compressor sounds like a bearing failure, quoting for a replacement unit.' }] },
  { id: 'b', title: 'Gents WC ceiling leak', site: 'Nottingham', category: 'Fabric & Building',
    status: 'Resolved', risk: 2, urgency: 2, cost: 1, assigned: 'Dalkia',
    targetDate: iso(-20), dateReported: iso(-32), resolvedDate: iso(-22), costEstimate: 800, actualCost: 950, notes: [] },
  { id: 'c', title: 'Emergency lighting test overdue', site: 'Glasgow', category: 'Health & Safety',
    status: 'Open', risk: 3, urgency: 3, cost: 1, assigned: 'Spartan Electrical',
    targetDate: iso(-2), dateReported: iso(-9), costEstimate: 400, actualCost: 0, notes: [] },
  { id: 'd', title: 'Gaming floor carpet replacement', site: 'Mayfair', category: 'Capital Project',
    status: 'In Progress', risk: 1, urgency: 1, cost: 3, assigned: 'MG Projects',
    targetDate: iso(30), dateReported: iso(-15), costEstimate: 60000, actualCost: 0, notes: [] },
  { id: 'e', title: 'Extract fan noisy', site: 'Park Lane', category: 'M&E / Plant',
    status: 'Closed', risk: 1, urgency: 1, cost: 1, assigned: 'Dalkia',
    targetDate: iso(-50), dateReported: iso(-60), resolvedDate: iso(-58), costEstimate: 300, actualCost: 275, notes: [] },
];

const SITE_DETAILS = {
  Mayfair: {
    landlord: 'Grosvenor Estates', casinoDirector: 'Helen Marsh', sqft: '24,000 sq ft',
    contacts: [{ id: 'c1', name: 'Dave Jones', role: 'Dalkia Account Manager', phone: '07700 900123', email: 'dave@dalkia.co.uk' }],
    compliance: [
      { id: 'k1', type: 'Fire Risk Assessment', due: iso(20) },
      { id: 'k2', type: 'LOLER lift inspection', due: iso(-5) },
      { id: 'k3', type: 'EICR', due: '' },
    ],
    locations: [],
  },
  Glasgow: {
    contacts: [], locations: [],
    compliance: [{ id: 'k4', type: 'Water hygiene (legionella)', due: iso(75) }],
  },
};

const ask = async (page, q) => {
  await page.fill('#vectorInput', q);
  await page.click('#vectorSendBtn');
  await page.waitForTimeout(250);
  return page.evaluate(() => {
    const msgs = [...document.querySelectorAll('#vectorLog .vlog-vector')];
    return msgs[msgs.length - 1].textContent.trim();
  });
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });

  await page.goto(APP);
  await page.evaluate(([i, s]) => {
    localStorage.setItem('estatesLedger.issues.v1', i);
    localStorage.setItem('estatesLedger.siteDetails.v1', s);
  }, [JSON.stringify(ISSUES), JSON.stringify(SITE_DETAILS)]);
  await page.reload();
  await page.waitForTimeout(400);
  await page.click('#vectorBtn');
  await page.waitForTimeout(300);

  const show = (q, a) => console.log(`      Q: ${q}\n      A: ${a.replace(/\n/g, ' ⏎ ').slice(0, 200)}`);

  // ---------- search: the five faults ----------
  let a = await ask(page, 'what did Dalkia say about the chiller');
  show('what did Dalkia say about the chiller', a);
  check('searches inside logged emails, not just issue fields', /Chiller 2 tripping/.test(a), a.slice(0, 80));

  a = await ask(page, 'chillers');
  check('plurals match the singular', /Chiller 2 tripping/.test(a), a.slice(0, 80));

  a = await ask(page, 'chiler');   // typo
  check('a one-letter typo still finds it', /Chiller 2 tripping/.test(a), a.slice(0, 80));

  a = await ask(page, 'leak');
  check('finds an issue by a title word', /ceiling leak/i.test(a), a.slice(0, 80));

  a = await ask(page, 'Dave Jones phone number');
  show('Dave Jones phone number', a);
  check('finds a contact', /07700 900123/.test(a), a.slice(0, 90));

  a = await ask(page, 'LOLER');
  show('LOLER', a);
  check('finds a compliance register entry', /LOLER/.test(a) && /overdue|days/.test(a), a.slice(0, 90));

  a = await ask(page, 'landlord');
  check('finds site details', /Grosvenor/.test(a), a.slice(0, 90));

  // the regression that matters: it must never fob you off on a tie
  a = await ask(page, 'Dalkia');
  show('Dalkia', a);
  check('never answers "narrow it down"', !/narrow it down/i.test(a), a.slice(0, 90));
  check('leads with a best match and lists the rest', /Also matching/.test(a), a.slice(0, 120));

  // ---------- analytics ----------
  a = await ask(page, 'brief me');
  show('brief me', a);
  check('brief counts overdue', /overdue/.test(a), a.slice(0, 120));
  check('brief names something to start with', /Chiller 2|Emergency lighting/.test(a), a.slice(0, 140));

  a = await ask(page, 'what have we spent across the portfolio');
  show('what have we spent across the portfolio', a);
  check('spend totals actual cost', /£1,225|£1225/.test(a.replace(/\s/g, '')) || /1,225/.test(a), a.slice(0, 160));
  check('spend also reports estimates', /estimated/.test(a));
  check('spend names the largest item', /Largest single item/.test(a));

  a = await ask(page, 'what have we spent at Mayfair');
  show('what have we spent at Mayfair', a);
  check('spend scopes to a named site', /at Mayfair/.test(a), a.slice(0, 100));

  a = await ask(page, 'how is Dalkia performing');
  show('how is Dalkia performing', a);
  check('rates contractors', /Dalkia:/.test(a), a.slice(0, 140));
  check('reports average days to close', /days to close/.test(a));
  check('is honest about what it measures', /logged here/.test(a));

  a = await ask(page, 'what compliance is due in 90 days');
  show('what compliance is due in 90 days', a);
  check('lists compliance inside the horizon', /LOLER/.test(a) && /Fire Risk Assessment/.test(a), a.slice(0, 160));
  check('flags the overdue one', /overdue/.test(a));
  check('flags register entries with no due date', /no due date/.test(a), a.slice(-120));

  a = await ask(page, 'what compliance is due in 30 days');
  check('honours a shorter horizon', /LOLER/.test(a) && !/legionella/i.test(a), a.slice(0, 140));

  a = await ask(page, 'which site is worst');
  show('which site is worst', a);
  check('ranks sites', /Worst on current data is/.test(a), a.slice(0, 160));
  check('shows the ranking basis', /critical, then overdue/.test(a));

  a = await ask(page, 'what is the trend this month');
  show('what is the trend this month', a);
  check('compares month on month', /this month vs/.test(a), a.slice(0, 140));
  check('admits the comparison is partial', /isn'?t finished/.test(a));

  // ---------- the honest boundary ----------
  a = await ask(page, 'should I repair or replace the chiller');
  show('should I repair or replace the chiller', a);
  check('declines the judgement call', /can'?t make that call/i.test(a), a.slice(0, 120));
  check('but still offers the evidence', /issue\(s\)/.test(a));

  a = await ask(page, 'are we legally compliant on fire safety');
  show('are we legally compliant on fire safety', a);
  check('points regulatory questions at a professional', /WorkNest|legal counsel/.test(a), a.slice(0, 160));

  // ---------- dead ends teach ----------
  a = await ask(page, 'zxqv nonsense string');
  show('zxqv nonsense string', a);
  check('a dead end lists what would have worked', /total spend|rate contractors/.test(a), a.slice(0, 140));
  check('and does not just say it did not catch that', !/^I didn'?t catch/.test(a));

  a = await ask(page, 'help');
  check('help covers analysis, lookup and actions',
    /ANALYSIS/.test(a) && /LOOKUP/.test(a) && /ACTIONS/.test(a), a.slice(0, 80));
  check('help is upfront that nothing leaves the device', /nothing leaves this device/.test(a));

  // ---------- still does the old jobs ----------
  a = await ask(page, 'how many overdue at Glasgow');
  check('counting still works', /1 overdue issue at Glasgow/.test(a), a.slice(0, 90));

  await page.fill('#vectorInput', 'log an issue at Mayfair about a burst pipe');
  await page.click('#vectorSendBtn');
  await page.waitForTimeout(400);
  check('logging still opens a pre-filled form', !!(await page.$('#formDrawer.open')));
  check('with the site filled in', (await page.inputValue('#f-site')) === 'Mayfair');
  await page.click('#formCancelBtn');

  console.log(errors.length ? '\nErrors:\n' + errors.join('\n') : '\nNo errors');
  if (errors.length) failed++;
  await browser.close();
  console.log(failed ? `FAILED: ${failed} assertion(s)` : 'VECTOR: OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
