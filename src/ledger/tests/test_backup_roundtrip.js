const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

// Simulates moving to a new device: fill device A, export, import on a clean
// profile (device B), and confirm nothing was silently dropped.
const APP = '../../../dist/estates-ledger-slim.html';

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const errors = [];
  const watch = (p) => {
    p.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });
  };

  // ---------- device A ----------
  const ctxA = await browser.newContext({ acceptDownloads: true });
  const a = await ctxA.newPage(); watch(a);
  await a.goto('file://' + path.resolve(__dirname, APP));
  await a.waitForTimeout(300);

  await a.evaluate(() => {
    localStorage.setItem('estatesLedger.issues.v1', JSON.stringify([{
      id: 'i1', title: 'Extraction fan noise', site: 'Mayfair', category: 'M&E / Plant',
      status: 'Open', risk: 3, urgency: 2, cost: 2, dateReported: '2026-07-01',
      targetDate: '2026-09-01', costEstimate: 4200, notes: []
    }]));
    // the things a v1 backup silently lost
    localStorage.setItem('estatesLedger.siteDetails.v1', JSON.stringify({
      Mayfair: {
        address: '10 Old Park Lane', landlord: 'Grosvenor', casinoDirector: 'A. Director',
        contacts: [{ id: 'c1', name: 'Duty Manager', phone: '020 7000 0000' }],
        compliance: [{ id: 'cp1', type: 'Fire Risk Assessment', due: '2026-11-30' }],
        locations: [{ id: 'w1', label: 'Plant room', words: 'table.chair.lamp' }],
        metrics: { complianceSnapshot: { values: { ehsAuditScore: '93%', fireRA: 'Current' } } }
      }
    }));
    localStorage.setItem('estatesLedger.estateMetrics.v1', JSON.stringify({
      incidents: { rows: [{ id: 'x1', category: 'Slip / Trip / Fall (Staff & Guest)', thisMonth: '3' }], refs: [] },
      fmPerformance: { rows: [], refs: [] }, boardActions: { rows: [], refs: [] },
      summary: {}, reportPeriod: { month: 'July', year: '2026', importedAt: '2026-07-24T00:00:00.000Z' }
    }));
    localStorage.setItem('estatesLedger.pmBoard.v1', JSON.stringify({
      importedAt: '2026-07-24T00:00:00.000Z',
      projects: [{ id: 'p1', name: 'Chiller replacement', site: 'Mayfair', budgetAllocated: 90000, spend: 12000 }]
    }));
    localStorage.setItem('estatesLedger.siteRefs.v1', JSON.stringify({
      Mayfair: [{ id: 'r1', title: 'Head lease', url: 'https://example.com/lease' }]
    }));
  });
  await a.reload();
  await a.waitForTimeout(300);

  // an attachment + a site photo, both blobs in IndexedDB
  await a.evaluate(async () => {
    const png = new Blob([Uint8Array.from(atob(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    ), (c) => c.charCodeAt(0))], { type: 'image/png' });
    /* No version number on purpose: opens whatever the app created. Pinning it to 1 here
       silently broke this test the day openDB() went to 2 for the reminders digest —
       opening below the current version throws VersionError and the promise never
       settles, which surfaces as "promise garbage collected", not as a version error. */
    const db = await new Promise((res) => { const r = indexedDB.open('estatesLedgerFiles'); r.onsuccess = () => res(r.result); });
    const tx = db.transaction('files', 'readwrite');
    tx.objectStore('files').put({ id: 'f1', issueId: 'i1', name: 'fan.png', type: 'image/png', size: png.size, addedAt: '2026-07-01T00:00:00.000Z', blob: png });
    tx.objectStore('files').put({ id: 'siteImage:Mayfair', kind: 'siteImage', site: 'Mayfair', name: 'front.png', type: 'image/png', size: png.size, addedAt: '2026-07-01T00:00:00.000Z', blob: png });
    await new Promise((res) => { tx.oncomplete = res; });
  });

  const [dl] = await Promise.all([
    a.waitForEvent('download'),
    a.click('#menuBtn').then(() => a.click('#exportJsonBtn')),
  ]);
  const backupPath = path.join(__dirname, 'roundtrip-backup.json');
  await dl.saveAs(backupPath);
  const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));

  console.log('formatVersion:', backup.formatVersion);
  console.log('keys carried in localState:', Object.keys(backup.localState || {}).length);
  console.log('  siteDetails present:', !!(backup.localState || {})['estatesLedger.siteDetails.v1']);
  console.log('  estateMetrics present:', !!(backup.localState || {})['estatesLedger.estateMetrics.v1']);
  console.log('  pmBoard present:', !!(backup.localState || {})['estatesLedger.pmBoard.v1']);
  console.log('  siteRefs present:', !!(backup.localState || {})['estatesLedger.siteRefs.v1']);
  console.log('files carried:', (backup.files || []).length,
    '| site photo included:', (backup.files || []).some((f) => f.kind === 'siteImage'));

  // ---------- device B: clean profile ----------
  const ctxB = await browser.newContext();
  const b = await ctxB.newPage(); watch(b);
  await b.goto('file://' + path.resolve(__dirname, APP));
  await b.waitForTimeout(300);
  console.log('device B starts empty:',
    await b.evaluate(() => !localStorage.getItem('estatesLedger.siteDetails.v1')));

  await b.click('#menuBtn');
  await b.setInputFiles('#importFile', backupPath);
  await b.waitForSelector('#confirmOverlay.open', { timeout: 5000 });
  await b.click('#confirmOkBtn');
  await b.waitForTimeout(900);

  const restored = await b.evaluate(() => {
    const sd = JSON.parse(localStorage.getItem('estatesLedger.siteDetails.v1') || '{}');
    const em = JSON.parse(localStorage.getItem('estatesLedger.estateMetrics.v1') || '{}');
    const pm = JSON.parse(localStorage.getItem('estatesLedger.pmBoard.v1') || '{}');
    const rf = JSON.parse(localStorage.getItem('estatesLedger.siteRefs.v1') || '{}');
    return {
      issues: JSON.parse(localStorage.getItem('estatesLedger.issues.v1') || '[]').length,
      address: sd.Mayfair && sd.Mayfair.address,
      contacts: sd.Mayfair && sd.Mayfair.contacts.length,
      compliance: sd.Mayfair && sd.Mayfair.compliance[0].type,
      w3w: sd.Mayfair && sd.Mayfair.locations[0].words,
      boardMetric: sd.Mayfair && sd.Mayfair.metrics.complianceSnapshot.values.ehsAuditScore,
      incidents: em.incidents && em.incidents.rows[0].thisMonth,
      project: pm.projects && pm.projects[0].name,
      refs: rf.Mayfair && rf.Mayfair[0].title,
    };
  });
  console.log('restored on device B:', JSON.stringify(restored));

  const files = await b.evaluate(() => new Promise((res) => {
    const r = indexedDB.open('estatesLedgerFiles');
    r.onsuccess = () => {
      const g = r.result.transaction('files').objectStore('files').getAll();
      g.onsuccess = () => res(g.result.map((f) => ({ id: f.id, kind: f.kind, bytes: f.blob && f.blob.size })));
    };
  }));
  console.log('files restored:', JSON.stringify(files));

  const ok = restored.issues === 1 && restored.address === '10 Old Park Lane' &&
    restored.contacts === 1 && restored.compliance === 'Fire Risk Assessment' &&
    restored.w3w === 'table.chair.lamp' && restored.boardMetric === '93%' &&
    restored.incidents === '3' && restored.project === 'Chiller replacement' &&
    restored.refs === 'Head lease' && files.length === 2 &&
    files.some((f) => f.kind === 'siteImage' && f.bytes > 0);
  console.log('EVERYTHING SURVIVED THE MOVE:', ok);

  // site photo must actually render on device B, not just exist as a row
  await b.click('#sitesBtn');
  await b.waitForTimeout(300);
  await b.click('.site-row[data-key="Mayfair"]');
  await b.waitForTimeout(500);
  const imgSrc = await b.getAttribute('.site-image-wrap img', 'src');
  // Mayfair has a baked-in default photo, so only a blob: URL proves the restored one won
  console.log('site photo on device B is the restored blob (not the built-in default):',
    !!imgSrc && imgSrc.startsWith('blob:'));
  await b.waitForFunction(
    () => (document.getElementById('complianceList') || {}).textContent !== undefined, null, { timeout: 5000 });
  await b.waitForTimeout(400);
  const cl = await b.textContent('#complianceList');
  const complianceOk = (cl || '').includes('Fire Risk Assessment');
  console.log('compliance register renders the restored item:', complianceOk);
  if (!complianceOk) process.exitCode = 1;

  console.log('--- Errors ---');
  console.log(errors.length ? errors.join('\n') : 'No errors');

  fs.unlinkSync(backupPath);
  await browser.close();
  if (!ok) process.exit(1);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
