const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push('PAGE ERROR: ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text()); });

  const filePath = 'file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html');
  await page.goto(filePath);
  await page.waitForTimeout(500);

  console.log('--- After load ---');
  console.log(errors.length ? errors.join('\n') : 'No errors');
  errors.length = 0;

  // Open Reports overlay
  await page.click('#reportsBtn');
  await page.waitForTimeout(300);
  console.log('--- After clicking Reports ---');
  console.log(errors.length ? errors.join('\n') : 'No errors');
  errors.length = 0;

  // Open each dashboard accordion section
  const sectionKeys = ['complianceSnapshot','incidents','occHealth','publicSafety','environmental','foodSafety','fmPerformance','boardActions'];
  for (const key of sectionKeys) {
    await page.click(`[data-toggle-dash="${key}"]`);
    await page.waitForTimeout(150);
    console.log(`--- After opening section ${key} ---`);
    console.log(errors.length ? errors.join('\n') : 'No errors');
    errors.length = 0;
    // close it again (click header again to collapse) before opening next, to mimic accordion
    await page.click(`[data-toggle-dash="${key}"]`);
    await page.waitForTimeout(100);
  }

  // Test clicking a jump-site cell in a venue grid section
  await page.click('[data-toggle-dash="complianceSnapshot"]');
  await page.waitForTimeout(200);
  const cell = await page.$('[data-jump-site]');
  if (cell) {
    await cell.click();
    await page.waitForTimeout(300);
    console.log('--- After jump-to-site click ---');
    console.log(errors.length ? errors.join('\n') : 'No errors');
    errors.length = 0;
  } else {
    console.log('No jump-site cell found!');
  }

  await browser.close();
})().catch(e => { console.error('SCRIPT FAILED:', e); process.exit(1); });
