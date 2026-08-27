// Statutory compliance register — top priority from the "what's next" review. Tracks
// FRA/WRA/EICR/LOLER etc. per venue, independent of any project. Next-due is always
// *derived* from lastCompletedDate + frequencyMonths (never its own stored field, same
// reasoning as effectiveStageGate()), and surfaces on the Dashboard and Calendar.
//
// Assert against #content, never document.body — see test_agile_governance.js for why.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'estate-pm.html');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const ok = (label, cond) => console.log((cond ? 'ok: ' : 'FAILED: ') + label);

  await page.goto(FILE);
  await page.click('[data-nav="compliance"]');
  await page.waitForTimeout(250);
  let body = await page.textContent('#content');
  ok('Compliance page renders', body.includes('Statutory Compliance Register'));
  ok('No items yet shows empty state', body.includes('No compliance items tracked yet'));

  // Type auto-fills the default frequency (LOLER -> 6 months).
  await page.selectOption('[data-compliance-form] select[name="type"]', 'LOLER (Lifts)');
  await page.waitForTimeout(150);
  const freqVal = await page.locator('[data-compliance-form] [name="frequencyMonths"]').inputValue();
  ok('Selecting LOLER auto-fills 6-month frequency', freqVal === '6');

  // Overdue item: last completed 8 months ago on a 6-month cycle.
  const eightMonthsAgo = new Date(); eightMonthsAgo.setMonth(eightMonthsAgo.getMonth() - 8);
  const overdueDate = eightMonthsAgo.toISOString().slice(0, 10);
  await page.fill('[data-compliance-form] [name="lastCompletedDate"]', overdueDate);
  await page.fill('[data-compliance-form] [name="contractor"]', 'Dalkia');
  await page.fill('[data-compliance-form] [name="certRef"]', 'LOLER-2026-001');
  await page.click('[data-compliance-form] button[type=submit]');
  await page.waitForTimeout(250);
  body = await page.textContent('#content');
  ok('Overdue LOLER item added and flagged Overdue', body.includes('LOLER (Lifts)') && body.includes('Overdue'));

  // Due-soon item: EICR completed such that next-due falls within 60 days (36-month cycle).
  const almostThreeYearsAgo = new Date(); almostThreeYearsAgo.setMonth(almostThreeYearsAgo.getMonth() - 36 + 1);
  const dueSoonDate = almostThreeYearsAgo.toISOString().slice(0, 10);
  await page.selectOption('[data-compliance-form] select[name="type"]', 'EICR (Electrical)');
  await page.waitForTimeout(150);
  const eicrFreq = await page.locator('[data-compliance-form] [name="frequencyMonths"]').inputValue();
  ok('Selecting EICR auto-fills 36-month frequency', eicrFreq === '36');
  await page.fill('[data-compliance-form] [name="lastCompletedDate"]', dueSoonDate);
  await page.click('[data-compliance-form] button[type=submit]');
  await page.waitForTimeout(250);
  body = await page.textContent('#content');
  ok('Due-soon EICR item added and flagged Due soon', body.includes('EICR (Electrical)') && body.includes('Due soon'));

  // Compliant item: FRA completed 1 month ago on a 12-month cycle -> far from due.
  const oneMonthAgo = new Date(); oneMonthAgo.setMonth(oneMonthAgo.getMonth() - 1);
  const compliantDate = oneMonthAgo.toISOString().slice(0, 10);
  await page.selectOption('[data-compliance-form] select[name="type"]', 'Fire Risk Assessment (FRA)');
  await page.fill('[data-compliance-form] [name="lastCompletedDate"]', compliantDate);
  await page.click('[data-compliance-form] button[type=submit]');
  await page.waitForTimeout(250);
  body = await page.textContent('#content');
  ok('Compliant FRA item added and flagged Compliant', body.includes('Fire Risk Assessment (FRA)') && body.includes('Compliant'));

  ok('Stat tiles reflect 1 overdue, 1 due soon', (await page.locator('.stat-tile', { hasText: '1' }).count()) >= 2);

  // Edit the overdue item, change contractor, verify it updates without duplicating.
  await page.click('[data-edit-complianceitem]');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Edit mode shows Save changes', body.includes('Save changes'));
  await page.fill('[data-compliance-form] [name="contractor"]', 'Dalkia (escalated)');
  await page.click('[data-compliance-form] button[type=submit]');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Edited contractor saved', body.includes('Dalkia (escalated)'));
  const itemCount = await page.evaluate(() => JSON.parse(localStorage.getItem('metroEstatesPM.v1')).complianceItems.length);
  ok('No duplicate row created (still 3 items)', itemCount === 3);

  // Venue filter narrows the table.
  const venueId = await page.locator('[data-compliance-form] select[name="venueId"]').inputValue();
  await page.selectOption('[data-compliance-venue-filter]', venueId);
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Venue filter still shows items for that venue', body.includes('LOLER (Lifts)'));

  // --- Dashboard integration ---
  await page.click('[data-nav="dashboard"]');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Dashboard shows compliance overdue banner', body.includes('is overdue'));
  ok('Dashboard Compliance card lists the overdue/due-soon items', body.includes('LOLER (Lifts)') && body.includes('EICR (Electrical)'));
  ok('Compliant item NOT shown on dashboard (only overdue/due-soon)', !body.includes('Fire Risk Assessment (FRA)'));

  // Clicking a dashboard compliance row navigates to the Compliance page.
  await page.click('[data-open-compliance]');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Clicking dashboard compliance row navigates to Compliance page', body.includes('Statutory Compliance Register'));

  // --- Calendar integration ---
  // Set the LOLER item's next-due month as the visible calendar month, confirm chip shows.
  const nextDueMonth = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('metroEstatesPM.v1'));
    const loler = s.complianceItems.find(i => i.type === 'LOLER (Lifts)');
    const d = new Date(loler.lastCompletedDate);
    d.setMonth(d.getMonth() + Number(loler.frequencyMonths));
    return d.toISOString().slice(0, 7);
  });
  await page.evaluate((m) => {
    const s = JSON.parse(localStorage.getItem('metroEstatesPM.v1'));
    s.ui.calMonth = m;
    localStorage.setItem('metroEstatesPM.v1', JSON.stringify(s));
  }, nextDueMonth);
  await page.reload(); await page.waitForTimeout(250);
  await page.click('[data-nav="calendar"]'); await page.waitForTimeout(250);
  body = await page.textContent('#content');
  ok('Calendar shows the compliance due-date chip in its due month', body.includes('LOLER (Lifts)'));

  // Delete flow + edit-state cleanup.
  await page.click('[data-nav="compliance"]'); await page.waitForTimeout(200);
  await page.click('[data-edit-complianceitem]');
  await page.waitForTimeout(150);
  await page.click('[data-delete-complianceitem]');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Deleting the row under edit clears edit mode cleanly', body.includes('Add item') && !body.includes('Save changes'));

  // Persistence.
  await page.reload(); await page.waitForTimeout(250);
  await page.click('[data-nav="compliance"]'); await page.waitForTimeout(200);
  const remaining = await page.evaluate(() => JSON.parse(localStorage.getItem('metroEstatesPM.v1')).complianceItems.length);
  ok('Persisted after reload (2 items remain after the delete)', remaining === 2);

  if (errors.length) { console.log('CONSOLE ERROR'); errors.forEach((e) => console.log('  ' + e)); }
  await browser.close();
})();
