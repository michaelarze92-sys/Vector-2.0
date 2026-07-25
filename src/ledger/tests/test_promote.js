const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push('PAGE ERROR: ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text()); });

  await page.goto('file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html'));
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    localStorage.setItem('estatesLedger.issues.v1', JSON.stringify([{
      id: 'iss1', title: 'Chiller 2 replacement', site: 'Mayfair', category: 'Capital Project',
      status: 'Awaiting Contractor', risk: 3, urgency: 3, cost: 3,
      assigned: 'Dalkia', dateReported: '2026-07-01', targetDate: '2026-09-30',
      costEstimate: 85000, description: 'Chiller 2 beyond economic repair; full replacement needed before summer peak.',
      tags: ['chiller','capex']
    }]));
  });
  await page.reload();
  await page.waitForTimeout(300);

  // Open the issue detail (click the row)
  await page.click('.row[data-id="iss1"]');
  await page.waitForTimeout(400);
  const detailOpen = await page.$('#detailDrawer.open');
  console.log('Detail drawer open:', !!detailOpen);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 10000 }),
    page.click('#promoteProjectBtn'),
  ]);
  const filePath = path.join(__dirname, 'promoted-test.json');
  await download.saveAs(filePath);
  console.log('Downloaded as:', download.suggestedFilename());

  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  console.log('Payload:', JSON.stringify(payload, null, 2));

  // Simulate the PM app's import validation contract
  const valid = payload && Array.isArray(payload.projects) && Array.isArray(payload.tasks);
  console.log('Passes PM import validation (projects+tasks arrays):', valid);
  const p = payload.projects[0];
  console.log('venueId correct (v2 = Metropolitan Mayfair):', p.venueId === 'v2');
  console.log('category mapped (Capital Project -> Refurbishment):', p.category === 'Refurbishment');
  console.log('status mapped (Awaiting Contractor -> Blocked):', p.status === 'Blocked');
  console.log('budgetAllocated = 85000:', p.budgetAllocated === 85000);
  console.log('dates carried:', p.startDate === '2026-07-01' && p.targetEndDate === '2026-09-30');
  const t = payload.tasks[0];
  console.log('task linked to project:', t.projectId === p.id);
  console.log('task priority (High risk+urgency -> ?):', t.priority);
  console.log('task notes carry description:', t.notes.includes('beyond economic repair'));

  // Check audit note was logged on the issue
  await page.waitForTimeout(300);
  const noteLogged = await page.evaluate(() => {
    var issues = JSON.parse(localStorage.getItem('estatesLedger.issues.v1'));
    return (issues[0].notes || []).some(n => n.text && n.text.includes('Promoted to Project Board'));
  });
  console.log('Audit note logged on issue:', noteLogged);

  console.log('--- Errors ---');
  console.log(errors.length ? errors.join('\n') : 'No errors');

  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
