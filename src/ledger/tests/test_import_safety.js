/* Import safety — the two ways a restore could destroy what it was meant to protect.
 *
 * 1. "No files key" and "files: []" mean different things. The export's fallback path
 *    ("Backup saved without attachments — couldn't read local file storage") writes a
 *    backup with NO files key. That isn't a claim that you have no photos; it's an
 *    admission it couldn't look. Clearing IndexedDB on it is unrecoverable.
 *
 * 2. Both apps export .json. A Project Board backup fed to the Ledger's restore has no
 *    `issues`, so a faithful restore replaces the whole estate with nothing. The confirm
 *    said "Importing 0 issue(s)", which is nowhere near loud enough.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const APP = 'file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html');
const ISSUES = 'estatesLedger.issues.v1';
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-import-'));

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const SEED = [{ id: 'i1', title: 'Chiller 2 tripping', site: 'Mayfair', status: 'Open', risk: 3, urgency: 3, cost: 2, notes: [] }];

const writeFixture = (name, obj) => {
  const p = path.join(TMP, name);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
};

// a backup the export's FALLBACK path would write: no files key at all
const NO_FILES_KEY = writeFixture('no-files-key.json', {
  formatVersion: 2, exportedAt: new Date().toISOString(),
  issues: [{ id: 'r1', title: 'Restored issue', site: 'Glasgow', status: 'Open', risk: 2, urgency: 2, cost: 2, notes: [] }],
  localState: { 'estatesLedger.issues.v1': JSON.stringify([{ id: 'r1', title: 'Restored issue', site: 'Glasgow', status: 'Open', risk: 2, urgency: 2, cost: 2, notes: [] }]) },
});

// a backup from a device that genuinely had none
const EMPTY_FILES = writeFixture('empty-files.json', {
  formatVersion: 2, exportedAt: new Date().toISOString(), files: [],
  issues: [{ id: 'r2', title: 'Another restored issue', site: 'Glasgow', status: 'Open', risk: 2, urgency: 2, cost: 2, notes: [] }],
  localState: {},
});

// the wrong app's backup
const PM_BACKUP = writeFixture('pm-backup.json', {
  source: 'metro-estates-pm', projects: [{ id: 'p1', name: 'Chiller replacement', venueId: 'v2', budgetAllocated: 90000 }],
  tasks: [], budgetLines: [],
});

const NOT_A_BACKUP = writeFixture('random.json', { hello: 'world' });

const seedPhoto = (page) => page.evaluate((b64) => new Promise((res) => {
  const bin = atob(b64), arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  const blob = new Blob([arr], { type: 'image/png' });
  const r = indexedDB.open('estatesLedgerFiles');
  r.onsuccess = () => {
    const tx = r.result.transaction('files', 'readwrite');
    tx.objectStore('files').put({ id: 'f1', issueId: 'i1', name: 'fault.png', type: 'image/png',
      size: blob.size, addedAt: new Date().toISOString(), blob });
    tx.oncomplete = () => res(true);
    tx.onerror = () => res(false);
  };
  r.onerror = () => res(false);
}), PNG);

const fileCount = (page) => page.evaluate(() => new Promise((res) => {
  const r = indexedDB.open('estatesLedgerFiles');
  r.onsuccess = () => {
    const db = r.result;
    if (!db.objectStoreNames.contains('files')) return res(0);
    const g = db.transaction('files').objectStore('files').getAll();
    g.onsuccess = () => res(g.result.length);
    g.onerror = () => res(-1);
  };
  r.onerror = () => res(-1);
}));

const importFile = async (page, fixture) => {
  await page.click('#menuBtn');
  await page.waitForTimeout(150);
  await page.setInputFiles('#importFile', fixture);
  await page.waitForTimeout(500);
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  const fresh = async () => {
    const p = await (await browser.newContext()).newPage({ viewport: { width: 1280, height: 1000 } });
    p.on('pageerror', (e) => { console.log('FAILED: PAGE ERROR ' + e.message); failed++; });
    await p.goto(APP);
    await p.evaluate(([k, v]) => localStorage.setItem(k, v), [ISSUES, JSON.stringify(SEED)]);
    await p.reload();
    await p.waitForTimeout(400);
    await seedPhoto(p);
    return p;
  };

  // ---------- 1. a backup with no files key must not touch stored photos ----------
  let page = await fresh();
  check('starts with a photo stored', (await fileCount(page)) === 1);

  await importFile(page, NO_FILES_KEY);
  const warnText = (await page.textContent('#confirmOverlay')).replace(/\s+/g, ' ').trim();
  console.log('      confirm reads:', JSON.stringify(warnText.slice(0, 260)));
  check('the confirm says the photos will be left alone',
    /carries no photo or document data/.test(warnText) && /left untouched/.test(warnText), warnText.slice(0, 120));

  await page.click('#confirmOkBtn');
  await page.waitForTimeout(900);
  check('the issues were restored', (await page.evaluate((k) =>
    JSON.parse(localStorage.getItem(k))[0].title, ISSUES)) === 'Restored issue');
  check('THE PHOTO SURVIVED', (await fileCount(page)) === 1, `${await fileCount(page)} files`);
  const t1 = (await page.textContent('#toast')).trim();
  check('and the toast says so', /left as they were/.test(t1), t1);
  await page.close();

  // ---------- 2. a backup that genuinely has none says what it will do ----------
  page = await fresh();
  await importFile(page, EMPTY_FILES);
  const warn2 = (await page.textContent('#confirmOverlay')).replace(/\s+/g, ' ').trim();
  console.log('      confirm reads:', JSON.stringify(warn2.slice(0, 260)));
  check('an explicitly empty backup warns the photo WILL be removed',
    /contains no photos or documents/.test(warn2) && /will be removed/.test(warn2), warn2.slice(0, 140));
  await page.click('#confirmOkBtn');
  await page.waitForTimeout(900);
  check('and it is — a faithful restore, but an informed one', (await fileCount(page)) === 0);
  await page.close();

  // ---------- 3. the wrong app's backup is refused ----------
  page = await fresh();
  await importFile(page, PM_BACKUP);
  const t3 = (await page.textContent('#toast')).trim();
  console.log('      toast reads:', JSON.stringify(t3));
  check('a Project Board backup is refused, not applied', /Project Board backup/.test(t3), t3);
  check('and it points at the control that does the right thing', /Reports/.test(t3));
  check('no confirm was even offered', !(await page.isVisible('#confirmOverlay')));
  check('the ledger is untouched', (await page.evaluate((k) =>
    JSON.parse(localStorage.getItem(k)).length, ISSUES)) === 1);
  check('the photo is untouched', (await fileCount(page)) === 1);
  await page.close();

  // ---------- 4. junk is refused ----------
  page = await fresh();
  await importFile(page, NOT_A_BACKUP);
  const t4 = (await page.textContent('#toast')).trim();
  check('an unrelated json is refused', /doesn'?t look like a Ledger backup/.test(t4), t4);
  check('the ledger is untouched', (await page.evaluate((k) =>
    JSON.parse(localStorage.getItem(k)).length, ISSUES)) === 1);
  await page.close();

  // ---------- 5. the Project Board import only writes the project snapshot ----------
  page = await fresh();
  await page.evaluate(() => localStorage.setItem('estatesLedger.siteDetails.v1',
    JSON.stringify({ Mayfair: { landlord: 'Test landlord', contacts: [], compliance: [], locations: [] } })));
  await page.reload();
  await page.waitForTimeout(400);
  await page.click('#reportsBtn');
  await page.click('[data-rtab="import"]');
  await page.waitForTimeout(250);
  await page.setInputFiles('#pmFileInput', PM_BACKUP);
  await page.waitForTimeout(400);
  await page.click('#applyPmImportBtn');
  await page.waitForTimeout(400);

  check('project data landed', await page.evaluate(() =>
    JSON.parse(localStorage.getItem('estatesLedger.pmBoard.v1')).projects.length === 1));
  check('issues untouched by a project import', (await page.evaluate((k) =>
    JSON.parse(localStorage.getItem(k)).length, ISSUES)) === 1);
  check('site profiles untouched', await page.evaluate(() =>
    JSON.parse(localStorage.getItem('estatesLedger.siteDetails.v1')).Mayfair.landlord === 'Test landlord'));
  check('photos untouched by a project import', (await fileCount(page)) === 1, `${await fileCount(page)} files`);
  await page.close();

  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failed ? `\nFAILED: ${failed} assertion(s)` : '\nIMPORT SAFETY: OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
