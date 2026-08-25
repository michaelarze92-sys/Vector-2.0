// CSV import for tasks — recurring workflow (colleague trackers), as opposed to the
// existing one-off JSON backup import. Covers: RFC4180-style quoted-field parsing
// (commas inside quotes must not split the row), auto column-guessing, status-word
// normalization, flexible date parsing (ISO, UK D/M/Y, and deliberately-bad input that
// must stay blank rather than guess), missing-project auto-create vs. matching an
// existing project by name, the required-field guard, and cancel discarding cleanly.
//
// Assert against #content, never document.body — see test_agile_governance.js for why.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const os = require('os');
const FILE = 'file://' + path.resolve(__dirname, '..', 'estate-pm.html');

const CSV = [
  'Task,Project,Site,Assignee,Due,Status,Priority,Comments',
  '"Order chiller, phase 2",Mayfair Refurb,Metropolitan Mayfair,J Smith,05/08/2026,In Progress,High,Lead time confirmed',
  'Book acoustic survey,Mayfair Refurb,Metropolitan Mayfair,K Jones,2026-08-12,Complete,Medium,',
  'Chase landlord consent,Existing Project,Metropolitan Mayfair,M Arze,not a date,Awaiting reply,,Escalated to MD',
  ',Mayfair Refurb,,,,,,Should be skipped - no task name',
].join('\r\n');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const ok = (label, cond) => console.log((cond ? 'ok: ' : 'FAILED: ') + label);

  const tmpCsv = path.join(os.tmpdir(), 'tracker-test-' + Date.now() + '.csv');
  fs.writeFileSync(tmpCsv, CSV);

  await page.goto(FILE);

  // Pre-create "Existing Project" so the importer should link to it, not duplicate it.
  await page.click('[data-nav="projects"]');
  await page.click('[data-action="new-project"]');
  await page.fill('#pName', 'Existing Project');
  await page.click('#pSave');
  await page.waitForTimeout(200);

  await page.click('[data-nav="data"]');
  await page.waitForTimeout(200);
  let body = await page.textContent('#content');
  ok('CSV import card renders', body.includes('Import tasks from CSV'));

  await page.setInputFiles('#csvFile', tmpCsv);
  await page.waitForTimeout(300);
  body = await page.textContent('#content');
  ok('Wizard shows mapping UI after file pick', body.includes('Map each column'));

  // Auto-guess: "Task"->name, "Project"->projectName, "Assignee"->ownerName, "Due"->dueDate, "Status"->status
  const nameSel = await page.locator('select[data-csv-map="name"]').inputValue();
  const projSel = await page.locator('select[data-csv-map="projectName"]').inputValue();
  const ownerSel = await page.locator('select[data-csv-map="ownerName"]').inputValue();
  ok('Auto-guessed "Task" column for task name', nameSel === '0');
  ok('Auto-guessed "Project" column', projSel === '1');
  ok('Auto-guessed "Assignee" column for owner (not exact "owner" match, still found)', ownerSel === '3');

  // Preview correctness
  ok('Quoted field with embedded comma parsed as one task, not split', body.includes('Order chiller, phase 2'));
  ok('ISO date parsed correctly', body.includes('12 Aug') || body.includes('Aug 12'));
  ok('UK D/M/Y date parsed correctly', body.includes('5 Aug') || body.includes('Aug 5'));
  ok('Unparseable date flagged, not guessed', body.includes('unreadable: "not a date"'));
  ok('"Complete" normalized to Done', (await page.locator('td:has-text("Done")').count()) > 0);
  ok('Unrecognized status text defaults to Not Started, with provenance shown', body.includes('(from "Awaiting reply")'));
  ok('New project flagged for creation', body.includes('1 new project will be created: Mayfair Refurb'));
  ok('Existing project NOT flagged for creation', !body.includes('Existing Project'.concat('')) || !body.includes('will be created: Existing Project') );

  const beforeProjectCount = await page.evaluate(() => JSON.parse(localStorage.getItem('metroEstatesPM.v1')).projects.length);

  await page.click('[data-action="commit-csv-import"]');
  await page.waitForTimeout(300);
  body = await page.textContent('#content');
  ok('Import succeeds and returns to plain Data page', body.includes('Import tasks from CSV') && !body.includes('Map each column'));

  const afterProjectCount = await page.evaluate(() => JSON.parse(localStorage.getItem('metroEstatesPM.v1')).projects.length);
  ok('Exactly one new project created (Mayfair Refurb), not two', afterProjectCount === beforeProjectCount + 1);

  // Row with no task name must be skipped, not imported as a blank task.
  const taskCount = await page.evaluate(() => JSON.parse(localStorage.getItem('metroEstatesPM.v1')).tasks.length);
  ok('Blank-name row skipped (3 tasks imported, not 4)', taskCount === 3);

  // Task linked to the pre-existing project should reuse its id, not a new one.
  const linkedCorrectly = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('metroEstatesPM.v1'));
    const existing = s.projects.find(p => p.name === 'Existing Project');
    const task = s.tasks.find(t => t.name === 'Chase landlord consent');
    return !!existing && !!task && task.projectId === existing.id;
  });
  ok('Task with an existing project name links to it, does not duplicate', linkedCorrectly);

  // Owner name mapped from "Assignee" column actually landed on the task.
  const ownerLanded = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('metroEstatesPM.v1'));
    const t = s.tasks.find(t => t.name.includes('Order chiller'));
    return t && t.ownerName === 'J Smith' && t.priority === 'High';
  });
  ok('Owner and priority mapped correctly onto the task', ownerLanded);

  // Persistence
  await page.reload(); await page.waitForTimeout(250);
  const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem('metroEstatesPM.v1')).tasks.length === 3);
  ok('Imported tasks persisted after reload', persisted);

  // --- Required-field guard: unmap "name" -> Import must be blocked ---
  await page.click('[data-nav="data"]'); await page.waitForTimeout(200);
  await page.setInputFiles('#csvFile', tmpCsv);
  await page.waitForTimeout(300);
  await page.selectOption('select[data-csv-map="name"]', '-1');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Unmapping the required field shows the warning', body.includes('Map "Task name" to a column'));
  const importDisabled = await page.locator('[data-action="commit-csv-import"]').isDisabled();
  ok('Import button disabled without task name mapped', importDisabled);

  // --- Cancel discards the wizard cleanly ---
  await page.click('[data-action="cancel-csv-import"]');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Cancel returns to the plain file-picker card', body.includes('Choose CSV file'));

  fs.unlinkSync(tmpCsv);
  if (errors.length) { console.log('CONSOLE ERROR'); errors.forEach((e) => console.log('  ' + e)); }
  await browser.close();
})();
