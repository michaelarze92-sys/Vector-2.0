const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1400 } });
  await page.goto('file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html'));
  await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'hybrid'));
  await page.waitForTimeout(300);

  await page.click('#sitesBtn');
  await page.waitForTimeout(200);
  await page.screenshot({ path: 'shot_hyb_sites_list.png', fullPage: true });

  // click into a site profile
  const siteRow = await page.$('.site-row');
  if (siteRow) { await siteRow.click(); await page.waitForTimeout(200); }
  await page.screenshot({ path: 'shot_hyb_site_profile.png', fullPage: true });

  // Board report tab
  const boardTabBtn = await page.$('[data-ptab="board"]');
  if (boardTabBtn) { await boardTabBtn.click(); await page.waitForTimeout(200); }
  await page.screenshot({ path: 'shot_hyb_site_board.png', fullPage: true });

  // open a metric section
  const head = await page.$('[data-toggle-section]');
  if (head) { await head.click(); await page.waitForTimeout(200); }
  await page.screenshot({ path: 'shot_hyb_site_board_section.png', fullPage: true });

  // By Category tab
  await page.click('#sitesBackBtn').catch(()=>{});
  await page.waitForTimeout(150);
  const catTab = await page.$('#tabCategoryBtn');
  if (catTab) { await catTab.click(); await page.waitForTimeout(200); }
  await page.screenshot({ path: 'shot_hyb_sites_category.png', fullPage: true });

  await browser.close();
  console.log('done');
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
