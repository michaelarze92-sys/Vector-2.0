const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// 1x1 red PNG — stands in for a photo off the camera
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

(async () => {
  const photoPath = path.join(__dirname, 'camera-shot.png');
  fs.writeFileSync(photoPath, PHOTO);

  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });

  await page.goto('file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html'));
  await page.waitForTimeout(300);

  // --- the camera input must ask the OS for the rear camera ---
  const capture = await page.getAttribute('#cameraInput', 'capture');
  const accept = await page.getAttribute('#cameraInput', 'accept');
  console.log('capture attr is "environment":', capture === 'environment');
  console.log('accept is image/*:', accept === 'image/*');

  // --- flow 1: log form -> camera -> photo held until save ---
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click("#fabAdd").then(()=>page.waitForTimeout(200)).then(()=>page.click("#formCameraBtn")),
  ]);
  await chooser.setFiles(photoPath);
  await page.waitForTimeout(400);

  console.log('form drawer open:', !!(await page.$('#formDrawer.open')));
  console.log('pending-photo banner visible:', await page.isVisible('#photoPending'));
  console.log('banner text:', (await page.textContent('#photoPendingText')).trim());
  const thumb = await page.getAttribute('#photoPendingThumb', 'src');
  console.log('thumbnail rendered from blob:', !!thumb && thumb.startsWith('blob:'));

  // nothing should be persisted until the issue is actually saved
  const beforeSave = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('estatesLedgerFiles');
    r.onsuccess = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('files')) return res(0);
      const g = db.transaction('files').objectStore('files').getAll();
      g.onsuccess = () => res(g.result.length);
      g.onerror = () => res(-1);
    };
    r.onerror = () => res(-1);
  }));
  console.log('files stored before save (should be 0):', beforeSave);

  await page.fill('#f-title', 'Cracked tile by cashier desk');
  await page.selectOption('#f-site', 'Mayfair');
  await page.click('#formSaveBtn');
  await page.waitForTimeout(600);

  const afterSave = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('estatesLedgerFiles');
    r.onsuccess = () => {
      const g = r.result.transaction('files').objectStore('files').getAll();
      g.onsuccess = () => res(g.result.map((f) => ({ issueId: f.issueId, type: f.type })));
      g.onerror = () => res([]);
    };
  }));
  console.log('files stored after save:', JSON.stringify(afterSave));
  const issueId = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('estatesLedger.issues.v1'))[0].id);
  console.log('photo attached to the new issue:', afterSave.length === 1 && afterSave[0].issueId === issueId);
  console.log('banner cleared after save:', !(await page.isVisible('#photoPending')));

  // --- flow 2: camera from inside an existing issue's detail drawer ---
  await page.click(`.row[data-id="${issueId}"]`);
  await page.waitForTimeout(400);
  const [chooser2] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click('#detailCameraBtn'),
  ]);
  await chooser2.setFiles(photoPath);
  await page.waitForTimeout(600);
  const afterSecond = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('estatesLedgerFiles');
    r.onsuccess = () => {
      const g = r.result.transaction('files').objectStore('files').getAll();
      g.onsuccess = () => res(g.result.length);
    };
  }));
  console.log('second photo attached to existing issue (expect 2):', afterSecond === 2);

  // --- flow 3: discarding a held photo leaves nothing behind ---
  await page.click('#detailCloseBtn');
  await page.waitForTimeout(200);
  const [chooser3] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.click("#fabAdd").then(()=>page.waitForTimeout(200)).then(()=>page.click("#formCameraBtn")),
  ]);
  await chooser3.setFiles(photoPath);
  await page.waitForTimeout(400);
  await page.click('#photoPendingClear');
  await page.waitForTimeout(200);
  console.log('banner hidden after discard:', !(await page.isVisible('#photoPending')));
  await page.click('#formCancelBtn');
  await page.waitForTimeout(300);
  const afterDiscard = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('estatesLedgerFiles');
    r.onsuccess = () => {
      const g = r.result.transaction('files').objectStore('files').getAll();
      g.onsuccess = () => res(g.result.length);
    };
  }));
  console.log('no orphan file written by discard (still 2):', afterDiscard === 2);

  console.log('--- Errors ---');
  console.log(errors.length ? errors.join('\n') : 'No errors');

  fs.unlinkSync(photoPath);
  await browser.close();
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
