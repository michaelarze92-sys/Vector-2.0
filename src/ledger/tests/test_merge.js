/* Merge in data — add-only, never destructive.
 *
 * The promise is one sentence: merge only ever ADDS. It never deletes a row, and never
 * overwrites a field that already has a value. Where both sides have something, the
 * device wins.
 *
 * So the central assertion isn't "the new rows arrived" — it's "everything that was
 * already there is byte-identical afterwards". A merge that quietly replaced a lease term
 * or dropped a note would be far worse than one that failed outright.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP = 'file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-merge-'));

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const EXISTING_ISSUES = [{
  id: 'keep1', title: 'Chiller 2 tripping', site: 'Mayfair', category: 'M&E / Plant',
  status: 'Awaiting Contractor', risk: 3, urgency: 3, cost: 2, assigned: 'Dalkia',
  dateReported: '2026-07-01', targetDate: '2026-08-20', costEstimate: 12000, actualCost: 0,
  tags: ['plant'], description: 'Original description that must survive',
  notes: [{ id: 'n1', ts: '2026-07-05T09:00:00.000Z', text: 'Original note that must survive' }],
}];

const EXISTING_DETAILS = {
  Mayfair: {
    address: '1 Old Park Lane', sqft: '24,000 sq ft', landlord: 'Existing Landlord',
    contacts: [{ id: 'c1', name: 'Dave Jones', role: 'Account Manager', phone: '07700 900123', email: 'dave@x.com' }],
    compliance: [{ id: 'k1', type: 'Fire Risk Assessment', due: '2026-09-01', url: '' }],
    locations: [],
    lease: { expiryDate: '2030-03-24', breakDate: '2028-03-24', breakNoticeMonths: '6' },
  },
};

const write = (name, text) => { const p = path.join(TMP, name); fs.writeFileSync(p, text); return p; };

/* Deliberately overlaps the existing data: one duplicate issue, one duplicate contact,
   and lease/site fields that CONFLICT with what's already recorded. */
const MERGE_CSV = write('merge.csv', [
  'ISSUES',
  'Title,Site,Category,Status,Assigned,Date reported,Target date,Description',
  'Chiller 2 tripping,Mayfair,M&E / Plant,Open,Someone Else,2026-01-01,2026-01-01,SHOULD NOT OVERWRITE',
  'Goods lift end of life,Leicester Square,M&E / Plant,Open,Dalkia,2026-08-04,2026-09-30,Parts hard to source',
  'Gaming floor carpet,Park Lane,Capital Project,In Progress,CD Northern,2026-07-22,2026-10-15,PO 4914',
  '',
  'CONTACTS',
  'Venue,Name,Role,Phone,Email',
  'Mayfair,Dave Jones,Different Role,07999 999999,different@x.com',
  'Leicester Square,Lee Hall,Venue Director,,lee.hall@mg.com',
  'Glasgow,Lynne Stevens,Venue Director,,lynne@mg.com',
  '',
  'COMPLIANCE REGISTER',
  'Venue,Type,Due,Certificate link',
  'Mayfair,Fire Risk Assessment,2099-01-01,',
  'Mayfair,LOLER lift inspection,2026-09-15,',
  'Glasgow,Water Hygiene / Legionella,2026-11-02,',
  '',
  'SITE DETAILS',
  'Venue,Address,Square footage,Landlord,Tenants / sub-lets,Casino Director,FM contractors,Gaming licence ref',
  'Mayfair,SHOULD NOT OVERWRITE,,,,Helen Marsh,,',
  'Glasgow,,18000 sq ft,Glasgow Landlord,,,,',
  '',
  'LEASES',
  'Venue,Term expiry,Break date,Notice months,Passing rent',
  'Mayfair,2099-12-31,2099-12-31,99,450000',
  'Glasgow,2031-06-30,,,120000',
  '',
  'CONTRACTORS',
  'Name,Email on file',
  'Spartan Electrical,info@spartan.co.uk',
  '',
].join('\n'));

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });

  await page.goto(APP);
  await page.evaluate(([i, d]) => {
    localStorage.setItem('estatesLedger.issues.v1', i);
    localStorage.setItem('estatesLedger.siteDetails.v1', d);
  }, [JSON.stringify(EXISTING_ISSUES), JSON.stringify(EXISTING_DETAILS)]);
  await page.reload();
  await page.waitForTimeout(500);

  const before = await page.evaluate(() => ({
    issues: localStorage.getItem('estatesLedger.issues.v1'),
    details: localStorage.getItem('estatesLedger.siteDetails.v1'),
  }));

  await page.click('#menuBtn');
  await page.waitForTimeout(150);
  check('the menu offers merge as a separate command', await page.isVisible('#mergeBtn'));
  const menu = await page.textContent('#menu');
  check('import is labelled as replacing', /REPLACES/.test(menu));
  check('merge is labelled as adding only', /adds only/.test(menu));

  // ---------- the preview must be honest BEFORE anything is written ----------
  await page.setInputFiles('#mergeFile', MERGE_CSV);
  await page.waitForTimeout(600);
  const prompt = (await page.textContent('#confirmOverlay')).replace(/\s+/g, ' ').trim();
  console.log('      prompt:', JSON.stringify(prompt.slice(0, 300)));
  check('it says what will be added', /will ADD:/.test(prompt));
  check('it counts the duplicates it will skip', /already here and will be skipped/.test(prompt), prompt.slice(0, 160));
  check('it promises nothing is changed or removed',
    /Nothing already in your ledger will be changed or removed/.test(prompt));

  const during = await page.evaluate(() => localStorage.getItem('estatesLedger.issues.v1'));
  check('NOTHING is written before you confirm', during === before.issues);

  await page.click('#confirmOkBtn');
  await page.waitForTimeout(800);

  // ---------- the whole point: existing data is untouched ----------
  const after = await page.evaluate(() => ({
    issues: JSON.parse(localStorage.getItem('estatesLedger.issues.v1')),
    details: JSON.parse(localStorage.getItem('estatesLedger.siteDetails.v1')),
    contractors: JSON.parse(localStorage.getItem('estatesLedger.contractors.v1') || '[]'),
  }));
  const kept = after.issues.find((i) => i.id === 'keep1');

  check('the original issue still exists', !!kept);
  check('its description was NOT overwritten by the duplicate',
    kept.description === 'Original description that must survive', kept.description);
  check('its assignee was NOT overwritten', kept.assigned === 'Dalkia', kept.assigned);
  check('its dates were NOT overwritten', kept.targetDate === '2026-08-20', kept.targetDate);
  check('its notes survived', kept.notes.length === 1 && /must survive/.test(kept.notes[0].text));
  check('the duplicate was not added twice',
    after.issues.filter((i) => /Chiller 2 tripping/.test(i.title)).length === 1);

  const may = after.details.Mayfair;
  check('an existing site field was NOT overwritten', may.address === '1 Old Park Lane', may.address);
  check('a blank site field WAS filled', may.casinoDirector === 'Helen Marsh', may.casinoDirector);
  check('an existing lease term was NOT overwritten',
    may.lease.expiryDate === '2030-03-24' && may.lease.breakNoticeMonths === '6',
    JSON.stringify(may.lease));
  check('a blank lease field WAS filled', may.lease.passingRent === '450000', may.lease.passingRent);
  check('a duplicate contact was skipped, not duplicated',
    may.contacts.filter((c) => c.name === 'Dave Jones').length === 1);
  check('and the original contact detail is intact',
    may.contacts[0].phone === '07700 900123' && may.contacts[0].role === 'Account Manager');
  check('a duplicate compliance item was skipped',
    may.compliance.filter((c) => c.type === 'Fire Risk Assessment').length === 1);
  check('and its original due date is intact',
    may.compliance.find((c) => c.type === 'Fire Risk Assessment').due === '2026-09-01');

  // ---------- and the new data actually arrived ----------
  check('new issues were added', after.issues.length === 3, `${after.issues.length}`);
  check('a new venue got its site details', after.details.Glasgow.landlord === 'Glasgow Landlord');
  check('a new venue got its lease', after.details.Glasgow.lease.expiryDate === '2031-06-30');
  check('new contacts were added',
    after.details['Leicester Square'].contacts.length === 1 && after.details.Glasgow.contacts.length === 1);
  check('a new compliance item was added on an existing venue',
    may.compliance.some((c) => /LOLER/.test(c.type)));
  check('a contractor was added', after.contractors.includes('Spartan Electrical'));

  // ---------- repeatable: merging the same file twice adds nothing ----------
  await page.setInputFiles('#mergeFile', MERGE_CSV);
  await page.waitForTimeout(700);
  const secondToast = (await page.textContent('#toast')).trim();
  console.log('      second merge:', JSON.stringify(secondToast));
  check('merging the same file again is a no-op', /Nothing new/.test(secondToast), secondToast);
  check('and no confirm was even offered', !(await page.isVisible('#confirmOverlay')));
  const afterTwice = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('estatesLedger.issues.v1')).length);
  check('the issue count is unchanged', afterTwice === 3, `${afterTwice}`);

  // ---------- a backup JSON merges too, without replacing ----------
  const BACKUP = write('partial-backup.json', JSON.stringify({
    formatVersion: 2, exportedAt: new Date().toISOString(),
    issues: [{ id: 'fromjson', title: 'Emergency lighting battery replacement', site: 'Nottingham',
               category: 'Health & Safety', status: 'Open', risk: 3, urgency: 2, cost: 2,
               assigned: 'Dalkia', dateReported: '2026-08-03', notes: [] }],
    localState: {
      'estatesLedger.siteDetails.v1': JSON.stringify({
        Nottingham: { landlord: 'Notts Landlord', contacts: [], compliance: [], locations: [] } }),
    },
  }));
  await page.setInputFiles('#mergeFile', BACKUP);
  await page.waitForTimeout(600);
  await page.click('#confirmOkBtn');
  await page.waitForTimeout(700);
  const final = await page.evaluate(() => ({
    issues: JSON.parse(localStorage.getItem('estatesLedger.issues.v1')),
    details: JSON.parse(localStorage.getItem('estatesLedger.siteDetails.v1')),
  }));
  check('a backup json merges rather than replacing', final.issues.length === 4, `${final.issues.length}`);
  check('and the earlier data is still there', !!final.issues.find((i) => i.id === 'keep1'));
  check('its site details came too', final.details.Nottingham.landlord === 'Notts Landlord');

  // ---------- the wrong file is refused ----------
  const PM = write('pm.json', JSON.stringify({ source: 'metro-estates-pm', projects: [{ id: 'p1', name: 'x' }], tasks: [] }));
  await page.setInputFiles('#mergeFile', PM);
  await page.waitForTimeout(500);
  check('a Project Board backup is refused', /Project Board backup/.test((await page.textContent('#toast')).trim()));
  check('and changes nothing', (await page.evaluate(() =>
    JSON.parse(localStorage.getItem('estatesLedger.issues.v1')).length)) === 4);

  /* ---------- a real-world tracker, not an export ----------
     The CSVs that actually arrive are assembled from a report, so the headers are the
     report's ("Cost Impact", "Assigned/Contractor", "Cost Estimate (£)"), severities are
     words, money carries a £, and estate-wide items have no venue at all. If any of that
     is silently dropped the merge LOOKS successful while losing rows — the worst outcome. */
  const TRACKER = write('tracker.csv', [
    'ISSUES',
    'Title,Site,Category,Description,Risk,Urgency,Cost Impact,Status,Assigned/Contractor,Date Reported,Target Date,Cost Estimate (£),Tags',
    '"Nottingham fire damper remedials",Nottingham,Health & Safety,"402 days expired",High,High,Medium,Open,Dalkia,,,"£6,231.68","expired-quote,fire-safety"',
    '"Dalkia MSA remains unsigned",,Tender & Contract,"18 months no signed MSA",High,High,High,Open,Dalkia / Procurement,01/02/2025,,,governance',
    '',
  ].join('\n'));
  await page.setInputFiles('#mergeFile', TRACKER);
  await page.waitForTimeout(600);
  await page.click('#confirmOkBtn');
  await page.waitForTimeout(700);
  const tracked = await page.evaluate(() => JSON.parse(localStorage.getItem('estatesLedger.issues.v1')));
  const damper = tracked.find((i) => /fire damper/.test(i.title));
  const msa = tracked.find((i) => /MSA/.test(i.title));
  check('a report-shaped header still maps', !!damper);
  check('"High" became the numeric severity the app stores', damper && damper.risk === '3', damper && damper.risk);
  check('"Medium" cost impact mapped too', damper && damper.cost === '2', damper && damper.cost);
  check('a £-formatted estimate was cleaned', damper && damper.costEstimate === '6231.68', damper && damper.costEstimate);
  check('Assigned/Contractor found the assignee', damper && damper.assigned === 'Dalkia', damper && damper.assigned);
  check('tags split into a list', damper && damper.tags.length === 2, JSON.stringify(damper && damper.tags));
  check('an estate-wide item was kept, not dropped', !!msa);
  check('and filed under Portfolio-wide', msa && msa.site === 'Portfolio-wide', msa && msa.site);
  check('a UK d/m/y date was read correctly', msa && msa.dateReported === '2025-02-01', msa && msa.dateReported);

  console.log(errors.length ? '\nErrors:\n' + errors.join('\n') : '\nNo errors');
  if (errors.length) failed++;
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failed ? `FAILED: ${failed} assertion(s)` : 'MERGE: OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
