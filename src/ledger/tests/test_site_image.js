const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1200 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push('PAGE ERROR: ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text()); });

  await page.goto('file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html'));
  await page.waitForTimeout(300);

  await page.click('#sitesBtn');
  await page.waitForTimeout(200);
  // click Mayfair row
  await page.click('.site-row[data-key="Mayfair"]');
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shot_site_image_mayfair.png' });

  const mayfairImgSrc = await page.$eval('.site-image-wrap img', img => img.src.slice(0, 40));
  console.log('Mayfair default image src prefix:', mayfairImgSrc);
  const hasRemoveBtn = await page.$('#siteImageRemoveBtn');
  console.log('Mayfair has remove button (should be null - default img):', hasRemoveBtn);

  // Go back and open Glasgow (no default image)
  await page.click('#sitesBackBtn');
  await page.waitForTimeout(200);
  await page.click('.site-row[data-key="Glasgow"]');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shot_site_image_glasgow_empty.png' });

  const zone = await page.$('#siteImageZone');
  console.log('Glasgow shows upload zone:', !!zone);

  // Upload a test image via file chooser
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#siteImageZone'),
  ]);
  await fileChooser.setFiles(path.resolve(__dirname, '../assets/site-images/mayfair.webp'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'shot_site_image_glasgow_uploaded.png' });

  const glasgowImg = await page.$('.site-image-wrap img');
  console.log('Glasgow now has image:', !!glasgowImg);
  const removeBtn = await page.$('#siteImageRemoveBtn');
  console.log('Glasgow has remove button (should exist - uploaded):', !!removeBtn);

  // Remove it
  await page.click('#siteImageRemoveBtn');
  await page.waitForSelector('#confirmOverlay.open', { timeout: 5000 });
  await page.click('#confirmOkBtn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shot_site_image_glasgow_removed.png' });
  const zoneAfterRemove = await page.$('#siteImageZone');
  console.log('Glasgow back to upload zone after remove:', !!zoneAfterRemove);

  console.log('--- Errors ---');
  console.log(errors.length ? errors.join('\n') : 'No errors');

  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
