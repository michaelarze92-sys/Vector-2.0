const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Synthetic Project Board backup matching metroEstatesPM.v1's export shape
const backup = {
  venues: [],
  projects: [
    { id: 'p1', name: 'Gaming floor reformat', venueId: 'v2', category: 'Refurbishment', owner: 'MG Projects',
      status: 'In Progress', budgetAllocated: 250000, startDate: '2026-05-01', targetEndDate: '2026-11-30' },
    { id: 'p2', name: 'Chiller replacement', venueId: 'v2', category: 'Contractor-Managed', owner: 'Dalkia',
      status: 'Not Started', budgetAllocated: 90000, startDate: '2026-08-01', targetEndDate: '2026-10-15' },
    { id: 'p3', name: 'Kitchen extraction overhaul', venueId: 'v5', category: 'Compliance', owner: 'Dalkia',
      status: 'In Progress', budgetAllocated: 40000, startDate: '2026-06-01', targetEndDate: '2026-09-01' }
  ],
  tasks: [],
  budgetLines: [
    { id: 'b1', projectId: 'p1', amount: 120000, dateLogged: '2026-06-10' },
    { id: 'b2', projectId: 'p1', amount: 105000, dateLogged: '2026-07-01' },
    { id: 'b3', projectId: 'p3', amount: 12000, dateLogged: '2026-07-05' }
  ]
};

(async () => {
  const backupPath = path.join(__dirname, 'pm-backup-test.json');
  fs.writeFileSync(backupPath, JSON.stringify(backup));

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push('PAGE ERROR: ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text()); });

  await page.goto('file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html'));
  await page.waitForTimeout(300);

  // Import the backup via the Reports > Import UI
  await page.click('#reportsBtn');
  await page.click('[data-rtab="import"]');
  await page.waitForTimeout(200);

  /* The controls must be VISIBLE, not merely present. setInputFiles below works on a
     hidden input, which is why this test passed for months while the import pane was
     unusable in the browser: a global `input[type=file]{display:none}` — written for the
     inputs that are fired from a styled button — was hiding these two as well, leaving a
     label with nothing under it. Anything asserted only via setInputFiles needs this
     check alongside it. */
  for (const sel of ['#csvFileInput', '#pmFileInput']) {
    const shown = await page.isVisible(sel);
    console.log(`${shown ? 'ok  ' : 'FAILED:'} ${sel} is visible to a real user`);
    if (!shown) process.exitCode = 1;
  }

  await page.setInputFiles('#pmFileInput', backupPath);
  await page.waitForTimeout(300);
  const previewText = await page.textContent('#pmPreviewArea');
  console.log('Preview:', previewText.replace(/\s+/g, ' ').trim());
  await page.click('#applyPmImportBtn');
  await page.waitForTimeout(200);

  // Open Mayfair profile (v2) — should show 2 projects
  await page.click('#reportsCloseBtn');
  await page.click('#sitesBtn');
  await page.waitForTimeout(200);
  await page.click('.site-row[data-key="Mayfair"]');
  await page.waitForTimeout(400);
  const sectionText = await page.textContent('#siteProjectsSection');
  console.log('Mayfair projects section:', sectionText.replace(/\s+/g, ' ').trim());
  await page.screenshot({ path: 'shot_pm_projects_mayfair.png' });

  const checks = {
    'shows both Mayfair projects': sectionText.includes('Gaming floor reformat') && sectionText.includes('Chiller replacement'),
    'excludes Glasgow project': !sectionText.includes('Kitchen extraction'),
    'burn 90% for p1 (225k/250k)': sectionText.includes('90%'),
    'total allocated 340k': sectionText.includes('340,000'),
  };
  Object.entries(checks).forEach(([k, v]) => console.log(k + ':', v));

  // Glasgow should show only its project
  await page.click('#sitesBackBtn');
  await page.waitForTimeout(200);
  await page.click('.site-row[data-key="Glasgow"]');
  await page.waitForTimeout(300);
  const glasgowText = await page.textContent('#siteProjectsSection');
  console.log('Glasgow shows only its project:', glasgowText.includes('Kitchen extraction') && !glasgowText.includes('Gaming floor'));

  // A site with no projects shows the empty message
  await page.click('#sitesBackBtn');
  await page.waitForTimeout(200);
  await page.click('.site-row[data-key="Nottingham"]');
  await page.waitForTimeout(300);
  const nottsText = await page.textContent('#siteProjectsSection');
  console.log('Nottingham empty message:', nottsText.includes('No projects at this site'));

  // Persistence across reload
  await page.reload();
  await page.waitForTimeout(300);
  await page.click('#sitesBtn');
  await page.waitForTimeout(200);
  await page.click('.site-row[data-key="Mayfair"]');
  await page.waitForTimeout(300);
  const afterReload = await page.textContent('#siteProjectsSection');
  console.log('Survives reload:', afterReload.includes('Gaming floor reformat'));

  console.log('--- Errors ---');
  console.log(errors.length ? errors.join('\n') : 'No errors');

  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
