const { chromium, devices } = require('playwright');
const path = require('path');

(async () => {
  const iphone = devices['iPhone 13'];
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const context = await browser.newContext({ ...iphone });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push('PAGE ERROR: ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text()); });

  await page.goto('file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'mobile_1_home.png' });

  await page.click('#sitesBtn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'mobile_2_sites_list.png' });

  await page.click('.site-row');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'mobile_3_site_profile.png' });

  const boardTab = await page.$('[data-ptab="board"]');
  if (boardTab) { await boardTab.click(); await page.waitForTimeout(200); }
  await page.screenshot({ path: 'mobile_4_board_report.png' });

  await page.click('#sitesCloseBtn');
  await page.waitForTimeout(200);
  await page.click('#reportsBtn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'mobile_5_reports_dashboard.png' });

  await page.click('[data-toggle-dash="complianceSnapshot"]');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'mobile_6_reports_grid.png' });

  await page.click('#reportsCloseBtn');
  await page.waitForTimeout(200);
  await page.click('#fabAdd');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'mobile_7_log_issue_drawer.png' });

  await page.click('#formCloseBtn');
  await page.waitForTimeout(200);
  await page.click('#vectorBtn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'mobile_8_vector_panel.png' });

  console.log('viewport:', iphone.viewport);
  console.log('--- Errors ---');
  console.log(errors.length ? errors.join('\n') : 'No errors');

  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
