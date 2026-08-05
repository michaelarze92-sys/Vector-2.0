/* "Export everything" — the walk-away guarantee.
 *
 * The JSON backup holds everything but only this app can read it. That's fine for
 * restoring; it is not an answer to "what if I stop using this". A tool holding
 * compliance dates and RIDDOR records has to be leavable without needing a developer.
 *
 * So this seeds EVERY table with a distinctive marker and asserts each marker comes out
 * the other side. The failure mode being guarded against is a new store getting added and
 * quietly never reaching the export — discovered on the day someone needs it.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const APP = 'file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html');

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const iso = (o) => { const d = new Date(); d.setDate(d.getDate() + o);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };

const SEED = {
  'estatesLedger.issues.v1': JSON.stringify([{
    id: 'i1', title: 'MARKER_ISSUE chiller tripping', site: 'Mayfair', category: 'M&E / Plant',
    status: 'Awaiting Contractor', risk: 3, urgency: 3, cost: 2, assigned: 'MARKER_CONTRACTOR',
    dateReported: iso(-10), targetDate: iso(5), costEstimate: 12000, actualCost: 0,
    tags: ['MARKER_TAG'], description: 'MARKER_DESC, with a comma and "quotes"',
    notes: [
      { id: 'n1', ts: iso(-5) + 'T09:00:00.000Z', text: 'MARKER_NOTE chased by phone' },
      { id: 'n2', ts: iso(-3) + 'T10:00:00.000Z', kind: 'email', direction: 'Received',
        from: 'MARKER_FROM@dalkia.co.uk', to: 'me@mg.com', subject: 'MARKER_SUBJECT',
        text: 'MARKER_EMAILBODY' },
    ],
  }]),
  'estatesLedger.incidents.v1': JSON.stringify([{
    id: 'x1', ref: 'MARKER_INCREF', date: iso(-2), time: '14:30', site: 'Glasgow', type: 'Injury',
    location: 'MARKER_LOCATION', personType: 'Employee', personRef: 'JS',
    riddor: 'specified', investigationStatus: 'In progress',
    description: 'MARKER_WHATHAPPENED', rootCause: 'MARKER_ROOTCAUSE',
  }]),
  'estatesLedger.siteDetails.v1': JSON.stringify({
    Mayfair: {
      address: 'MARKER_ADDRESS', sqft: '24,000 sq ft', landlord: 'MARKER_LANDLORD',
      tenants: 'MARKER_TENANT', casinoDirector: 'MARKER_DIRECTOR',
      fmContractors: 'MARKER_FM', licenceRef: 'MARKER_LICENCE',
      contacts: [{ id: 'c1', name: 'MARKER_CONTACT', role: 'Account Manager',
                   phone: '07700 900123', email: 'MARKER_EMAIL@x.com' }],
      compliance: [{ id: 'k1', type: 'MARKER_COMPLIANCE', due: iso(20), url: 'MARKER_CERTURL' }],
      locations: [{ id: 'l1', label: 'MARKER_LOCLABEL', words: 'MARKER_W3W' }],
      metrics: {
        complianceSnapshot: { values: { complianceScore: 'MARKER_SCORE', fireRA: 'Current' },
                              refs: [{ label: 'MARKER_METRICREF', url: 'http://x' }] },
      },
      lease: {
        landlordAgent: 'MARKER_AGENT', expiryDate: iso(400), passingRent: '450000',
        breakDate: iso(300), breakNoticeMonths: '6', breakConditions: 'MARKER_BREAKCOND',
        reviewDate: iso(120), repairingObligation: 'FRI (full repairing & insuring)',
        rateableValue: '390000', ratesAppealDeadline: iso(45), notes: 'MARKER_LEASENOTE',
      },
    },
  }),
  'estatesLedger.estateMetrics.v1': JSON.stringify({
    incidentData: { values: { riddorCount: 'MARKER_ESTATEMETRIC' }, refs: [] },
  }),
  'estatesLedger.siteRefs.v1': JSON.stringify({
    Mayfair: [{ id: 'r1', category: 'Drawings', label: 'MARKER_REFLABEL', url: 'MARKER_REFURL' }],
  }),
  'estatesLedger.contractors.v1': JSON.stringify(['MARKER_CONTRACTOR']),
  'estatesLedger.contractorEmails.v1': JSON.stringify({ MARKER_CONTRACTOR: 'MARKER_CONTRACTOREMAIL@x.com' }),
  'estatesLedger.pmBoard.v1': JSON.stringify({
    importedAt: new Date().toISOString(),
    projects: [{ id: 'p1', name: 'MARKER_PROJECT', site: 'Mayfair', owner: 'MARKER_PROJOWNER',
                 status: 'In Progress', budgetAllocated: 250000, spend: 225000 }],
  }),
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });

  await page.goto(APP);
  await page.evaluate((seed) => {
    Object.keys(seed).forEach((k) => localStorage.setItem(k, seed[k]));
  }, SEED);
  // a stored file, so the attachment listing has something in it
  await page.evaluate(() => new Promise((res) => {
    const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' });
    const r = indexedDB.open('estatesLedgerFiles');
    r.onsuccess = () => {
      const tx = r.result.transaction('files', 'readwrite');
      tx.objectStore('files').put({ id: 'f1', issueId: 'i1', name: 'MARKER_FILENAME.png',
        type: 'image/png', size: 3, addedAt: new Date().toISOString(), blob });
      tx.oncomplete = () => res(true); tx.onerror = () => res(false);
    };
    r.onerror = () => res(false);
  }));
  await page.reload();
  await page.waitForTimeout(500);

  await page.click('#menuBtn');
  await page.waitForTimeout(150);
  check('the menu offers a full export', await page.isVisible('#exportAllCsvBtn'));

  const dl = page.waitForEvent('download');
  await page.click('#exportAllCsvBtn');
  const download = await dl;
  check('it downloads a .csv', /\.csv$/.test(download.suggestedFilename()), download.suggestedFilename());
  const csv = fs.readFileSync(await download.path(), 'utf8');
  console.log(`      ${csv.length} chars, ${csv.split('\n').length} lines`);

  // ---------- every block is present ----------
  const BLOCKS = ['ISSUES', 'ACTIVITY LOG', 'INCIDENTS', 'LEASES', 'COMPLIANCE REGISTER',
                  'CONTACTS', 'SITE DETAILS', 'KEY LOCATIONS', 'REFERENCE LINKS',
                  'CAPITAL PROJECTS', 'CONTRACTORS', 'PHOTOS & DOCUMENTS',
                  'BOARD SHE REPORT DATA'];
  BLOCKS.forEach((b) => check(`block present: ${b}`, csv.includes(b)));

  /* ---------- every seeded value survives ----------
     This is the assertion that actually matters. A block heading with nothing under it
     would pass the check above and lose the data anyway. */
  const MARKERS = [
    'MARKER_ISSUE', 'MARKER_CONTRACTOR', 'MARKER_TAG', 'MARKER_DESC',
    'MARKER_NOTE', 'MARKER_FROM', 'MARKER_SUBJECT', 'MARKER_EMAILBODY',
    'MARKER_INCREF', 'MARKER_LOCATION', 'MARKER_WHATHAPPENED', 'MARKER_ROOTCAUSE',
    'MARKER_AGENT', 'MARKER_BREAKCOND', 'MARKER_LEASENOTE',
    'MARKER_COMPLIANCE', 'MARKER_CERTURL',
    'MARKER_CONTACT', 'MARKER_EMAIL',
    'MARKER_ADDRESS', 'MARKER_LANDLORD', 'MARKER_TENANT', 'MARKER_DIRECTOR',
    'MARKER_FM', 'MARKER_LICENCE',
    'MARKER_LOCLABEL', 'MARKER_W3W',
    'MARKER_REFLABEL', 'MARKER_REFURL',
    'MARKER_PROJECT', 'MARKER_PROJOWNER',
    'MARKER_CONTRACTOREMAIL', 'MARKER_FILENAME',
    'MARKER_SCORE', 'MARKER_METRICREF', 'MARKER_ESTATEMETRIC',
  ];
  const missing = MARKERS.filter((m) => !csv.includes(m));
  check(`every seeded value survives the export (${MARKERS.length} checked)`,
    missing.length === 0, missing.length ? 'MISSING: ' + missing.join(', ') : undefined);

  // ---------- the derived number, which is the one that took work ----------
  const expectedNotice = (() => {
    const d = new Date(); d.setDate(d.getDate() + 300);
    const day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() - 6);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  })();
  check('the derived break-notice deadline is exported, not just the break date',
    csv.includes('SERVE NOTICE BY') && csv.includes(expectedNotice), expectedNotice);

  check('the RIDDOR reporting deadline is exported', csv.includes('Report due by'));

  // ---------- CSV correctness ----------
  check('a value containing a comma is quoted', /"MARKER_DESC, with a comma/.test(csv));
  check('embedded quotes are doubled', /""quotes""/.test(csv));
  check('the file starts with a UTF-8 BOM so Excel reads £ correctly', csv.charCodeAt(0) === 0xFEFF);

  // ---------- it is honest about what a CSV can't carry ----------
  check('it says files are listed, not included', /listed, not included/i.test(csv));
  check('and where to actually get them', /JSON backup/.test(csv) && /without this app/.test(csv));

  // ---------- an empty table says so rather than vanishing ----------
  const page2 = await (await browser.newContext()).newPage();
  page2.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  await page2.goto(APP);
  await page2.waitForTimeout(400);
  const dl2 = page2.waitForEvent('download');
  await page2.click('#menuBtn');
  await page2.click('#exportAllCsvBtn');
  const csv2 = fs.readFileSync(await (await dl2).path(), 'utf8');
  check('an empty ledger still exports every block', BLOCKS.every((b) => csv2.includes(b)));
  check('and marks the empty ones rather than dropping them', /\(none recorded\)/.test(csv2));

  /* ---------- the guard against a future store being forgotten ----------
     Every localStorage key the app owns should be represented. lastBackup, schedule,
     theme and chase rules are settings, not records, so they're deliberately excluded. */
  const SETTINGS_ONLY = ['theme', 'lastBackup', 'backupSchedule', 'chaseRules', 'notify',
                         'vectorHistory', 'refCategories', 'emails', 'sites'];
  const keys = await page.evaluate(() =>
    Object.keys(localStorage).filter((k) => k.startsWith('estatesLedger.')));
  const records = keys.filter((k) => !SETTINGS_ONLY.some((s) => k.includes(s)));
  console.log('      record stores:', JSON.stringify(records));
  check('every record store is a known one — a new store needs a block adding here',
    records.every((k) => /issues|incidents|siteDetails|siteRefs|contractors|contractorEmails|pmBoard|estateMetrics/.test(k)),
    JSON.stringify(records));

  console.log(errors.length ? '\nErrors:\n' + errors.join('\n') : '\nNo errors');
  if (errors.length) failed++;
  await browser.close();
  console.log(failed ? `FAILED: ${failed} assertion(s)` : 'EXPORT ALL: OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
