const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (err) => errors.push('PAGE ERROR: ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text()); });

  const filePath = 'file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html');
  await page.goto(filePath);
  await page.waitForTimeout(300);

  // Build a synthetic (non-sample) CSV row for testing the parser/mapper only — not real data.
  const header = "report_month,report_year,overall_status,compliant_count,total_venues,v1_score,v1_fire,v1_water,v1_elec,v1_incidents,v1_status,v1_ehs,v2_score,v2_fire,v2_water,v2_elec,v2_incidents,v2_status,v2_ehs,v3_score,v3_fire,v3_water,v3_elec,v3_incidents,v3_status,v3_ehs,v4_score,v4_fire,v4_water,v4_elec,v4_incidents,v4_status,v4_ehs,v5_score,v5_fire,v5_water,v5_elec,v5_incidents,v5_status,v5_ehs,v6_score,v6_fire,v6_water,v6_elec,v6_incidents,v6_status,v6_ehs,v7_score,v7_fire,v7_water,v7_elec,v7_incidents,v7_status,v7_ehs,inc1_this,inc1_last,inc1_ytd,inc1_riddor,inc1_near,inc1_trend,inc2_this,inc2_last,inc2_ytd,inc2_riddor,inc2_near,inc2_trend,inc3_this,inc3_last,inc3_ytd,inc3_riddor,inc3_near,inc3_trend,inc4_this,inc4_last,inc4_ytd,inc4_riddor,inc4_near,inc4_trend,inc5_this,inc5_last,inc5_ytd,inc5_riddor,inc5_near,inc5_trend,inc6_this,inc6_last,inc6_ytd,inc6_riddor,inc6_near,inc6_trend,fm1_this,fm1_last,fm1_rag,fm2_this,fm2_last,fm2_rag,fm3_this,fm3_last,fm3_rag,fm4_this,fm4_last,fm4_rag,fm5_this,fm5_last,fm5_rag,action1_desc,action1_owner,action1_date,action1_input";
  const dataRow = "TESTMONTH,2099,SATISFACTORY,7,7,TEST99%,✓,✓,✗,TESTinc,PASS,TEST88%,TEST99%,✓,✓,✓,0,PASS,TEST90%,TEST99%,✓,✓,✓,0,PASS,TEST90%,TEST99%,✓,✗,✓,0,ACTION,TEST85%,TEST99%,✓,✓,✓,0,PASS,TEST90%,TEST99%,✓,✓,✓,0,PASS,TEST90%,TEST99%,✓,✓,✓,0,PASS,TEST90%,TESTTHIS1,TESTLAST1,TESTYTD1,0,0,▼,TESTTHIS2,TESTLAST2,TESTYTD2,0,0,▲,TESTTHIS3,TESTLAST3,TESTYTD3,0,0,→,TESTTHIS4,TESTLAST4,TESTYTD4,0,0,▼,TESTTHIS5,TESTLAST5,TESTYTD5,0,0,→,TESTTHIS6,TESTLAST6,TESTYTD6,0,0,▲,TESTFM1THIS,TESTFM1LAST,GREEN,TESTFM2THIS,TESTFM2LAST,AMBER,TESTFM3THIS,TESTFM3LAST,GREEN,TESTFM4THIS,TESTFM4LAST,GREEN,TESTFM5THIS,TESTFM5LAST,RED,\"TESTACTION, with a comma\",TEST OWNER,2099-12-31,Board approval required";
  const csvText = header + "\n" + dataRow;

  await page.click('#reportsBtn');
  await page.click('[data-rtab="import"]');
  await page.waitForTimeout(200);
  await page.fill('#csvPasteInput', csvText);
  await page.click('#parseCsvBtn');
  await page.waitForTimeout(200);
  console.log('--- After preview ---');
  console.log(errors.length ? errors.join('\n') : 'No errors');
  errors.length = 0;

  const previewText = await page.textContent('#csvPreviewArea');
  console.log('Preview text:', previewText.slice(0, 300));

  await page.click('#confirmImportBtn');
  await page.waitForTimeout(200);
  console.log('--- After confirm import ---');
  console.log(errors.length ? errors.join('\n') : 'No errors');
  errors.length = 0;

  // Now check the dashboard reflects imported data
  await page.click('[data-rtab="dashboard"]');
  await page.waitForTimeout(200);
  const periodText = await page.textContent('.chase-note');
  console.log('Period banner:', periodText);

  await page.click('[data-toggle-dash="complianceSnapshot"]');
  await page.waitForTimeout(200);
  const cellText = await page.$$eval('[data-jump-site="Leicester Square"]', els => els.map(e => e.textContent));
  console.log('Leicester Square compliance cells:', cellText);

  await page.click('[data-toggle-dash="complianceSnapshot"]'); // close
  await page.click('[data-toggle-dash="incidents"]');
  await page.waitForTimeout(200);
  const incVal = await page.inputValue('.est-inc-input[data-idx="0"][data-f="thisMonth"]');
  console.log('Incident row0 thisMonth value:', incVal);

  await page.click('[data-toggle-dash="incidents"]');
  await page.click('[data-toggle-dash="fmPerformance"]');
  await page.waitForTimeout(200);
  const fmVal = await page.inputValue('.est-fm-input[data-idx="0"][data-f="thisQ"]');
  console.log('FM row0 thisQ value:', fmVal);

  await page.click('[data-toggle-dash="fmPerformance"]');
  await page.click('[data-toggle-dash="boardActions"]');
  await page.waitForTimeout(200);
  const actionsText = await page.textContent('#estate-actions-list');
  console.log('Board actions list:', actionsText);

  console.log('--- Final error check ---');
  console.log(errors.length ? errors.join('\n') : 'No errors');

  // Check localStorage was actually written (persistence)
  const ls = await page.evaluate(() => localStorage.getItem('estatesLedger.estateMetrics.v1'));
  console.log('localStorage estateMetrics present:', !!ls);
  const siteDetails = await page.evaluate(() => localStorage.getItem('estatesLedger.siteDetails.v1'));
  console.log('localStorage siteDetails present:', !!siteDetails);

  await browser.close();
})().catch(e => { console.error('SCRIPT FAILED:', e); process.exit(1); });
