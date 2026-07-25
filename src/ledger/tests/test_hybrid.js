const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push('PAGE ERROR: ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text()); });

  await page.goto('file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html'));
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'hybrid'));
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shot_hybrid_home.png' });

  // Open the add-issue drawer (a popup)
  await page.click('#fabAdd');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shot_hybrid_drawer.png' });
  await page.click('#formCloseBtn');
  await page.waitForTimeout(200);

  // Open sites overlay modal
  await page.click('#sitesBtn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shot_hybrid_modal.png' });
  await page.click('#sitesCloseBtn');
  await page.waitForTimeout(200);

  // Open menu dropdown
  await page.click('#menuBtn');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'shot_hybrid_menu.png' });

  console.log('--- Errors ---');
  console.log(errors.length ? errors.join('\n') : 'No errors');

  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
