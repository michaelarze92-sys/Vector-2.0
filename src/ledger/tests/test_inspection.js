/* Inspections app — and the handoff that makes it part of the ecosystem.
 *
 * The app itself is easy to test. The thing genuinely worth asserting is the contract
 * BETWEEN the two apps: an inspection's "Export findings for the Ledger" file has to be
 * something the Ledger's merge importer actually reads, and re-inspecting a venue must
 * not duplicate findings already on the register. Those two apps share no code — only a
 * CSV column format — so nothing but a test spanning both will catch a drift.
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');

const INSPECT = 'file://' + path.resolve(__dirname, '../../../standalone/inspection.html');
const LEDGER = 'file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'inspect-'));

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });

  await page.goto(INSPECT);
  await page.waitForTimeout(300);

  // ---------- storage is its own; it cannot reach the Ledger ----------
  const keys = await page.evaluate(() => Object.keys(localStorage));
  check('it uses its own storage namespace',
    keys.every((k) => !k.startsWith('estatesLedger.')), JSON.stringify(keys));

  // ---------- start an H&S audit at Glasgow ----------
  await page.selectOption('#newVenue', 'Glasgow');
  await page.selectOption('#newTemplate', 'hsaudit');
  await page.fill('#newInspector', 'M Arze');
  const blurb = (await page.textContent('#tplBlurb')).trim();
  check('the template explains itself before you start', blurb.length > 20, blurb.slice(0, 60));
  await page.click('#startBtn');
  await page.waitForTimeout(400);

  check('the runner opened', await page.isVisible('.progress-bar'));
  const totalItems = await page.evaluate(() => document.querySelectorAll('[data-item]').length);
  check('the audit template has a real number of items', totalItems > 50, `${totalItems}`);

  // ---------- answering ----------
  const answer = async (itemId, label) => {
    await page.click(`[data-item="${itemId}"] .seg > button:has-text("${label}")`);
    await page.waitForTimeout(120);
  };
  await answer('f4', 'Fail');       // fire doors
  await answer('f1', 'Pass');
  await answer('w3', 'Fail');       // water temperature monitoring
  await answer('x1', 'N/A');

  check('a Fail is visibly recorded',
    (await page.getAttribute('[data-item="f4"] .seg > button:has-text("Fail")', 'aria-pressed')) === 'true');

  // an adverse answer must ask for the detail that makes it actionable
  check('a Fail asks for a target date', await page.isVisible('[data-item="f4"] [data-target]'));
  check('a Fail asks for an owner', await page.isVisible('[data-item="f4"] [data-owner]'));
  check('a Pass does NOT demand a target date', !(await page.isVisible('[data-item="f1"] [data-target]')));

  await page.fill('[data-item="f4"] [data-note]', 'Canteen fire door threshold strip missing, door not latching');
  await page.fill('[data-item="f4"] [data-owner]', 'Dalkia');
  await page.waitForTimeout(200);

  // ---------- N/A must not be counted as a pass ----------
  await page.click('#toSummary');
  await page.waitForTimeout(400);
  const scored = await page.evaluate(() =>
    Number(document.querySelectorAll('.score-tile b')[3].textContent.trim()));
  check('N/A is excluded from the score denominator', scored === 3, `scored=${scored}`);
  const pass = (await page.textContent('.score-tile b')).trim();
  check('the pass rate reflects only applicable items', pass === '33%', pass);
  const findingsCount = await page.evaluate(() =>
    document.querySelectorAll('.rep tbody tr').length);
  check('both fails are listed as findings', findingsCount === 2, `${findingsCount}`);

  // ---------- the note survived a page change ----------
  await page.click('#backToRun');
  await page.waitForTimeout(300);
  const note = await page.inputValue('[data-item="f4"] [data-note]');
  check('notes persist across navigation', /threshold strip/.test(note), note.slice(0, 40));

  // ---------- export for the Ledger ----------
  await page.click('#toSummary');
  await page.waitForTimeout(300);
  const dl = await Promise.all([
    page.waitForEvent('download'),
    page.click('#expLedger'),
  ]);
  const csvPath = path.join(TMP, 'findings.csv');
  await dl[0].saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  console.log('      csv head:', JSON.stringify(csv.split('\r\n').slice(0, 2).join(' | ').slice(0, 170)));

  check('the export is an ISSUES block', csv.startsWith('ISSUES\r\n'));
  check('it carries the venue', /"Glasgow"/.test(csv));
  check('it carries the note into the description', /threshold strip/.test(csv));
  check('it names the inspection as provenance', /H&S \/ statutory audit/.test(csv));
  check('the owner became the assignee', /"Dalkia"/.test(csv));
  check('a fail is filed under Health & Safety', /"Health & Safety"/.test(csv));
  check('it sets a target date', /"\d{4}-\d{2}-\d{2}"/.test(csv));
  check('only the fails were exported', csv.trim().split('\r\n').length === 4, // title + header + 2
    `${csv.trim().split('\r\n').length} lines`);

  // ---------- and the Ledger actually accepts it ----------
  const ledger = await ctx.newPage();
  const lErrors = [];
  ledger.on('pageerror', (e) => lErrors.push('LEDGER PAGE ERROR: ' + e.message));
  await ledger.goto(LEDGER);
  await ledger.waitForTimeout(500);

  await ledger.setInputFiles('#mergeFile', csvPath);
  await ledger.waitForTimeout(700);
  const prompt = (await ledger.textContent('#confirmOverlay')).replace(/\s+/g, ' ').trim();
  console.log('      ledger prompt:', JSON.stringify(prompt.slice(0, 140)));
  check('the Ledger recognises the file and offers to merge', /will ADD: 2 issues/.test(prompt), prompt.slice(0, 80));
  await ledger.click('#confirmOkBtn');
  await ledger.waitForTimeout(700);

  const merged = await ledger.evaluate(() =>
    JSON.parse(localStorage.getItem('estatesLedger.issues.v1') || '[]'));
  check('both findings landed on the register', merged.length === 2, `${merged.length}`);
  const fire = merged.find((i) => /fire door/i.test(i.title));
  check('the finding is identifiable by its title', !!fire, fire && fire.title);
  check('severity came through as the app stores it', fire && fire.risk === '3', fire && fire.risk);
  check('the venue matches the Ledger spelling', fire && fire.site === 'Glasgow', fire && fire.site);
  check('it is tagged as coming from an inspection',
    fire && fire.tags.indexOf('inspection') > -1, JSON.stringify(fire && fire.tags));

  // ---------- THE POINT: re-inspecting must not duplicate ----------
  await ledger.setInputFiles('#mergeFile', csvPath);
  await ledger.waitForTimeout(700);
  const second = (await ledger.textContent('#toast')).trim();
  check('merging the same findings again adds nothing', /Nothing new/.test(second), second);
  const afterTwice = await ledger.evaluate(() =>
    JSON.parse(localStorage.getItem('estatesLedger.issues.v1') || '[]').length);
  check('the register did not double up', afterTwice === 2, `${afterTwice}`);

  // ---------- a condition survey grades rather than passes ----------
  await page.click('#homeBtn');
  await page.waitForTimeout(300);
  await page.selectOption('#newVenue', 'Glasgow');
  await page.selectOption('#newTemplate', 'condition');
  await page.click('#startBtn');
  await page.waitForTimeout(400);
  await page.click('[data-item="vt3"] .seg > button:has-text("5")');   // escalator handrails
  await page.waitForTimeout(200);
  check('grade 5 explains what it means', /End of life/.test(await page.textContent('[data-item="vt3"]')));
  check('grade 5 is treated as a finding', await page.isVisible('[data-item="vt3"] [data-target]'));
  await page.click('[data-item="vt1"] .seg > button:has-text("2")');
  await page.waitForTimeout(200);
  check('grade 2 is not a finding', !(await page.isVisible('[data-item="vt1"] [data-target]')));

  await page.click('#toSummary');
  await page.waitForTimeout(400);
  const avg = (await page.textContent('.score-tile b')).trim();
  check('condition scores as an average grade, not a percentage', avg === '3.5', avg);

  const dl2 = await Promise.all([
    page.waitForEvent('download'),
    page.click('#expLedger'),
  ]);
  const csv2 = path.join(TMP, 'condition.csv');
  await dl2[0].saveAs(csv2);
  const text2 = fs.readFileSync(csv2, 'utf8');
  check('a grade 5 exports as High severity', /"High","High"/.test(text2));
  check('a condition finding is filed under a fabric/plant category',
    /"M&E \/ Plant"|"Fabric & Building"/.test(text2));

  // ---------- backup/restore round trip ----------
  const dl3 = await Promise.all([
    page.waitForEvent('download'),
    (async () => { await page.click('#menuBtn'); await page.click('#mBackup'); })(),
  ]);
  const bk = path.join(TMP, 'backup.json');
  await dl3[0].saveAs(bk);
  const backup = JSON.parse(fs.readFileSync(bk, 'utf8'));
  check('the backup names its own app', backup.app === 'metro-inspections', backup.app);
  check('the backup carries both inspections', backup.inspections.length === 2, `${backup.inspections.length}`);
  check('the backup has a photos section even when empty', !!backup.photos);

  // a Ledger backup must be refused, not half-applied
  const wrong = path.join(TMP, 'wrong.json');
  fs.writeFileSync(wrong, JSON.stringify({ formatVersion: 2, issues: [{ id: 'x', title: 'y' }] }));
  await page.setInputFiles('#restoreFile', wrong);
  await page.waitForTimeout(400);
  const stillTwo = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('metroInspect.v1')).inspections.length);
  check('a foreign backup does not silently wipe inspections', stillTwo === 2, `${stillTwo}`);

  const all = errors.concat(lErrors);
  console.log(all.length ? '\nErrors:\n' + all.join('\n') : '\nNo errors');
  if (all.length) failed++;
  await browser.close();
  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(failed ? `FAILED: ${failed} assertion(s)` : 'INSPECTION: OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
