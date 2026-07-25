const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (err) => errors.push('PAGE ERROR: ' + err.message));
  page.on('console', (msg) => { if (msg.type() === 'error') errors.push('CONSOLE ERROR: ' + msg.text()); });

  await page.goto('file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html'));
  await page.waitForTimeout(300);

  // Seed an issue with a target date via localStorage directly (fast, deterministic)
  await page.evaluate(() => {
    var today = new Date();
    var target = new Date(today.getFullYear(), today.getMonth(), 15);
    var targetISO = target.toISOString().slice(0,10);
    var issues = [{
      id: 'test-issue-1', title: 'Chiller inspection', site: 'Mayfair', category: 'M&E / Plant',
      status: 'Open', risk: 'High', urgency: 'High', targetDate: targetISO,
      dateReported: today.toISOString().slice(0,10)
    }];
    localStorage.setItem('estatesLedger.issues.v1', JSON.stringify(issues));

    var siteDetails = {};
    siteDetails['Glasgow'] = { compliance: [{ id: 'comp-1', type: 'Fire Risk Assessment', due: targetISO, url: '' }] };
    localStorage.setItem('estatesLedger.siteDetails.v1', JSON.stringify(siteDetails));
  });
  await page.reload();
  await page.waitForTimeout(300);

  await page.click('#calendarBtn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: 'shot_calendar_month.png' });

  // Click the day with items (the 15th)
  const today = new Date();
  const targetDay = 15;
  const cell = await page.$(`.cal-day[data-date$="-${String(targetDay).padStart(2,'0')}"]:not(.other-month)`);
  if (cell) {
    await cell.click();
    await page.waitForTimeout(200);
  } else {
    console.log('Could not find target day cell!');
  }
  await page.screenshot({ path: 'shot_calendar_daypanel.png' });

  const panelText = await page.textContent('#calDayPanel');
  console.log('Day panel text:', panelText.replace(/\s+/g,' ').trim());

  // Click the issue item to jump to detail (dispatch directly - avoids flakiness from
  // Playwright's strict visibility checks on a nested-scroll container; wiring is what's under test)
  const jobClicked = await page.evaluate(() => {
    var el = document.querySelector('#calDayPanel .reminder-row[data-kind="job"] .reminder-main');
    if (!el) return false;
    el.click();
    return true;
  });
  console.log('Job row found and clicked:', jobClicked);
  await page.waitForTimeout(300);
  if (jobClicked) {
    const detailOpen = await page.$('#detailDrawer.open');
    console.log('Issue detail drawer opened after click:', !!detailOpen);
    const detailTitle = await page.textContent('#detailBody').catch(()=>null);
    console.log('Detail contains issue title:', detailTitle && detailTitle.includes('Chiller inspection'));
  }

  // Reopen calendar, test month nav
  await page.click('#detailCloseBtn').catch(()=>{});
  await page.waitForTimeout(200);
  await page.click('#calendarBtn');
  await page.waitForTimeout(200);
  await page.click('#calNextBtn');
  await page.waitForTimeout(150);
  await page.click('#calPrevBtn');
  await page.waitForTimeout(150);
  await page.click('#calTodayBtn');
  await page.waitForTimeout(150);

  // Click the compliance item's day and jump to site
  const cell2 = await page.$(`.cal-day[data-date$="-${String(targetDay).padStart(2,'0')}"]:not(.other-month)`);
  if (cell2) { await cell2.click(); await page.waitForTimeout(200); }
  const complianceClicked = await page.evaluate(() => {
    var el = document.querySelector('#calDayPanel .reminder-row[data-kind="compliance"] .reminder-main');
    if (!el) return false;
    el.click();
    return true;
  });
  console.log('Compliance row found and clicked:', complianceClicked);
  await page.waitForTimeout(300);
  if (complianceClicked) {
    const sitesOpen = await page.$('#sitesOverlay.open');
    console.log('Sites overlay opened after compliance click:', !!sitesOpen);
    const title = await page.textContent('#sitesModalTitle').catch(()=>null);
    console.log('Site profile title:', title);
  }

  console.log('--- Errors ---');
  console.log(errors.length ? errors.join('\n') : 'No errors');

  await browser.close();
})().catch(e => { console.error('FAILED:', e); process.exit(1); });
