// Kanban board, WIP-overload flag, Lessons Learned log, governance calendar.
//
// Assertions read #content, never document.body — the app's whole <script> lives in
// the body, so a body.textContent check matches its own source code and passes even
// when nothing rendered. That mistake produced four false results while this suite
// was being written; don't reintroduce it.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'estate-pm.html');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('PAGEERROR: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const ok = (label, cond) => console.log((cond ? 'ok: ' : 'FAILED: ') + label);

  await page.goto(FILE);

  // --- setup: a project + tasks ---
  await page.click('[data-nav="projects"]');
  await page.click('[data-action="new-project"]');
  await page.fill('#pName', 'Empire Gaming Floor Reformat');
  await page.click('#pSave');
  await page.waitForTimeout(200);

  // add tasks via quick-add
  async function quickAdd(name) {
    await page.fill('#qaName', name);
    await page.click('#qaSubmit');
    await page.waitForTimeout(150);
  }
  await quickAdd('Order replacement chiller');
  await quickAdd('Book acoustic survey');
  await quickAdd('Chase landlord consent');

  // ================= 1. KANBAN =================
  await page.click('[data-nav="kanban"]');
  await page.waitForTimeout(250);
  let body = await page.textContent('#content');
  ok('Kanban page renders', body.includes('Drag a task between columns'));
  const colCount = await page.locator('[data-kb-col]').count();
  ok('Four status columns', colCount === 4);
  const notStartedCards = await page.locator('[data-kb-col="Not Started"] [data-kb-card]').count();
  ok('Tasks land in Not Started (' + notStartedCards + ')', notStartedCards === 3);

  // drag a card: Not Started -> In Progress (HTML5 DnD via manual event dispatch)
  const cardId = await page.locator('[data-kb-col="Not Started"] [data-kb-card]').first().getAttribute('data-kb-card');
  await page.evaluate((id) => {
    const card = document.querySelector('[data-kb-card="' + id + '"]');
    const target = document.querySelector('[data-kb-col="In Progress"]');
    const dt = new DataTransfer();
    card.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true }));
    target.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true }));
    target.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, cardId);
  await page.waitForTimeout(300);
  const inProgCount = await page.locator('[data-kb-col="In Progress"] [data-kb-card]').count();
  ok('Drag moved card to In Progress', inProgCount === 1);

  // persistence of the move
  await page.reload(); await page.waitForTimeout(200);
  await page.click('[data-nav="kanban"]'); await page.waitForTimeout(250);
  ok('Status change persisted', (await page.locator('[data-kb-col="In Progress"] [data-kb-card]').count()) === 1);

  // filter
  await page.selectOption('[data-kb-filter="projectId"]', { index: 1 });
  await page.waitForTimeout(250);
  ok('Filter applied without error', (await page.locator('[data-kb-card]').count()) >= 0);
  await page.click('[data-kb-clear]');
  await page.waitForTimeout(250);
  ok('Clear filters restores all', (await page.locator('[data-kb-card]').count()) === 3);

  // ================= 2. WIP FLAG =================
  // assign 6 in-progress tasks to one owner
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('metroEstatesPM.v1'));
    raw.tasks = [];
    for (let i = 0; i < 6; i++) {
      raw.tasks.push({ id: 'w' + i, projectId: null, venueId: null, name: 'WIP task ' + i, ownerName: 'Dalkia Site Lead', ownerEmail: '', startDate: '2026-08-01', dueDate: '2026-08-20', status: 'In Progress', priority: 'Medium', dependsOnTaskId: null, boardInputRequired: false, notes: '', checklist: [], progressPct: 0 });
    }
    localStorage.setItem('metroEstatesPM.v1', JSON.stringify(raw));
  });
  await page.reload(); await page.waitForTimeout(300);
  body = await page.textContent('#content');
  ok('WIP overload banner shows', body.includes('Dalkia Site Lead') && body.includes('6 tasks in progress'));

  // under the limit -> no banner
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('metroEstatesPM.v1'));
    raw.tasks = raw.tasks.slice(0, 3);
    localStorage.setItem('metroEstatesPM.v1', JSON.stringify(raw));
  });
  await page.reload(); await page.waitForTimeout(300);
  body = await page.textContent('#content');
  ok('No banner when under WIP limit', !body.includes('tasks in progress at once'));

  // ================= 3. LESSONS LEARNED =================
  await page.click('[data-nav="projects"]'); await page.waitForTimeout(200);
  await page.click('.task-row[data-open-project]'); await page.waitForTimeout(250);
  body = await page.textContent('#content');
  ok('Lessons Learned card renders', body.includes('Lessons Learned'));
  await page.selectOption('form[data-add-lesson] select[name="theme"]', 'Procurement');
  await page.fill('form[data-add-lesson] input[name="whatHappened"]', 'ITT issued without asbestos survey attached');
  await page.fill('form[data-add-lesson] input[name="doDifferently"]', 'Attach survey to ITT pack before issue');
  await page.fill('form[data-add-lesson] input[name="raisedBy"]', 'MA');
  await page.click('form[data-add-lesson] button[type=submit]');
  await page.waitForTimeout(250);
  body = await page.textContent('#content');
  ok('Lesson row added', body.includes('ITT issued without asbestos survey'));
  await page.reload(); await page.waitForTimeout(250);
  await page.click('[data-nav="projects"]'); await page.waitForTimeout(150);
  await page.click('.task-row[data-open-project]'); await page.waitForTimeout(250);
  body = await page.textContent('#content');
  ok('Lesson persisted', body.includes('ITT issued without asbestos survey'));
  await page.click('[data-delete-lesson]'); await page.waitForTimeout(250);
  body = await page.textContent('#content');
  ok('Lesson deleted', !body.includes('ITT issued without asbestos survey'));

  // ================= 4. GOVERNANCE CALENDAR =================
  await page.click('[data-nav="calendar"]'); await page.waitForTimeout(250);
  body = await page.textContent('#content');
  ok('FM dashboard chip shows (monthly)', body.includes('FM dashboard due'));
  ok('Cadence controls render', body.includes('Governance cadence'));

  // Aug 2026 is not a quarter month -> no SHE/Board chips
  const calMonth = await page.evaluate(() => JSON.parse(localStorage.getItem('metroEstatesPM.v1')).ui.calMonth);
  const monthNum = Number(calMonth.split('-')[1]);
  const isQ = [1,4,7,10].includes(monthNum);
  const hasBoardChip = (await page.locator('.cal-gov', { hasText: 'ECT Board' }).count()) > 0;
  ok('Quarterly chips only in quarter months (month=' + monthNum + ', quarter=' + isQ + ', boardChip=' + hasBoardChip + ')', isQ === hasBoardChip);

  // navigate to a quarter month (Oct 2026)
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('metroEstatesPM.v1'));
    raw.ui.calMonth = '2026-10';
    localStorage.setItem('metroEstatesPM.v1', JSON.stringify(raw));
  });
  await page.reload(); await page.waitForTimeout(200);
  await page.click('[data-nav="calendar"]'); await page.waitForTimeout(250);
  body = await page.textContent('#content');
  ok('Quarter month shows SHE pack', body.includes('Quarterly SHE pack'));
  ok('Quarter month shows ECT Board report', body.includes('ECT Board SHE report'));

  // change a governance day
  await page.fill('[data-gov-day="fm"]', '12');
  await page.dispatchEvent('[data-gov-day="fm"]', 'change');
  await page.waitForTimeout(300);
  const savedDay = await page.evaluate(() => JSON.parse(localStorage.getItem('metroEstatesPM.v1')).ui.govDays.fm);
  ok('Governance day saved (' + savedDay + ')', savedDay === 12);

  // hide toggle
  await page.click('[data-gov-toggle]'); await page.waitForTimeout(250);
  body = await page.textContent('#content');
  ok('Hide removes governance chips', !body.includes('FM dashboard due'));
  await page.click('[data-gov-toggle]'); await page.waitForTimeout(250);
  body = await page.textContent('#content');
  ok('Show restores governance chips', body.includes('FM dashboard due'));

  // ================= BACKUP ROUND-TRIP =================
  const exported = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('metroEstatesPM.v1'));
    return { hasLessons: Array.isArray(s.lessons), hasCheckpoints: Array.isArray(s.budgetCheckpoints), hasTenders: Array.isArray(s.tenders) };
  });
  ok('New collections present in saved state', exported.hasLessons && exported.hasCheckpoints && exported.hasTenders);

  // ================= MOBILE VIEWPORT =================
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload(); await page.waitForTimeout(250);
  await page.click('#hamburgerBtn'); await page.waitForTimeout(200);
  await page.click('[data-nav="kanban"]'); await page.waitForTimeout(300);
  const scrollW = await page.evaluate(() => document.documentElement.scrollWidth);
  const clientW = await page.evaluate(() => document.documentElement.clientWidth);
  ok('No horizontal overflow on mobile (' + scrollW + ' vs ' + clientW + ')', scrollW <= clientW + 1);

  if (errors.length) { console.log('CONSOLE ERROR'); errors.forEach(e => console.log('  ' + e)); }
  await browser.close();
})();
