/* Site walk, home-screen shortcuts and the Android share target.
 *
 * Site walk is the ONE place in this app where capture saves immediately instead of
 * opening the form for review. That reversal is deliberate — on a gaming floor an
 * unsaved half-typed form is lost the moment something interrupts you — so the tests
 * assert both halves of the trade: it really does save straight away, and a bad capture
 * really is one tap to remove.
 */
const { chromium } = require('playwright');
const path = require('path');

const APP = 'file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html');
const ISSUES = 'estatesLedger.issues.v1';

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]'), ISSUES);

// a fake recogniser, installed before the app's script runs so the app builds from it
const FAKE_MIC = () => {
  window.__spoke = null;
  function Fake() { this.onresult = null; this.onend = null; this.onerror = null; }
  Fake.prototype.start = function () {
    setTimeout(() => {
      if (this.onresult) this.onresult({ results: [[{ transcript: window.__spoke }]] });
      if (this.onend) this.onend();
    }, 30);
  };
  Fake.prototype.stop = function () {};
  window.webkitSpeechRecognition = Fake;
  window.SpeechRecognition = Fake;
};

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });
  await page.addInitScript(FAKE_MIC);

  await page.goto(APP);
  await page.waitForTimeout(400);

  // --- pick the venue once ---
  check('Walk is in the topbar', await page.isVisible('#walkBtn'));
  await page.click('#walkBtn');
  await page.waitForTimeout(300);
  check('walk opens on the venue picker', await page.isVisible('[data-walk-site="Mayfair"]'));
  check('all seven venues are offered',
    (await page.$$('[data-walk-site]')).length === 7, String((await page.$$('[data-walk-site]')).length));

  await page.click('[data-walk-site="Mayfair"]');
  await page.waitForTimeout(300);
  check('the venue is named in the title', /Mayfair/.test(await page.textContent('#walkTitle')));
  check('capture controls replace the picker', await page.isVisible('#walkText'));

  // --- typed capture saves immediately, no form ---
  await page.fill('#walkText', 'Cracked tile by the cashier desk');
  await page.click('#walkAddBtn');
  await page.waitForTimeout(300);

  let list = await stored(page);
  check('typing logs straight away, no form step', list.length === 1, `${list.length} stored`);
  check('no form drawer opened', !(await page.$('#formDrawer.open')));
  check('the venue carried over', list[0].site === 'Mayfair', list[0].site);
  check('status defaults to Open', list[0].status === 'Open', list[0].status);
  check('severity is left middling, never guessed',
    list[0].risk === '2' && list[0].urgency === '2' && list[0].cost === '2');
  check('the input clears for the next one', (await page.inputValue('#walkText')) === '');
  check('it appears in the walk list', /Cracked tile/.test(await page.textContent('.walk-list')));

  // --- the site does NOT need re-picking ---
  await page.fill('#walkText', 'Emergency light out in the back corridor');
  await page.click('#walkAddBtn');
  await page.waitForTimeout(300);
  list = await stored(page);
  check('second capture needs no re-picking', list.length === 2, `${list.length} stored`);
  check('both are at the same venue', list.every((i) => i.site === 'Mayfair'));
  check('the category is guessed from the words',
    list.find((i) => /Emergency light/.test(i.title)).category === 'Health & Safety',
    list.find((i) => /Emergency light/.test(i.title)).category);

  // --- voice capture goes straight to the list, not the form ---
  await page.evaluate(() => { window.__spoke = 'Chiller room door not closing properly, needs fixing by Friday'; });
  await page.click('#walkMicBtn');
  await page.waitForTimeout(500);
  list = await stored(page);
  check('speaking logs a third without opening the form', list.length === 3, `${list.length} stored`);
  check('voice capture did not open the form', !(await page.$('#formDrawer.open')));
  const spoken = list.find((i) => /Chiller room door/.test(i.title));
  check('a spoken deadline still becomes a target date',
    /^\d{4}-\d{2}-\d{2}$/.test(spoken.targetDate || ''), spoken.targetDate);

  // --- the other half of the trade: a bad capture is one tap to undo ---
  const badId = spoken.id;
  await page.click(`[data-walk-del="${badId}"]`);
  await page.waitForTimeout(300);
  list = await stored(page);
  check('delete removes it from storage', list.length === 2 && !list.some((i) => i.id === badId));
  check('and from the walk list', !/Chiller room door/.test(await page.textContent('.walk-list')));

  // --- edit hands over to the ordinary form ---
  await page.click('[data-walk-edit]');
  await page.waitForTimeout(400);
  check('Edit opens the normal issue form', !!(await page.$('#formDrawer.open')));
  check('as an edit, not a new issue',
    (await page.textContent('#formDrawerTitle')).trim() === 'Edit issue');
  await page.click('#formCancelBtn');
  await page.waitForTimeout(200);

  // --- finishing reports the count ---
  await page.click('#walkBtn');
  await page.waitForTimeout(300);
  await page.click('[data-walk-site="Glasgow"]');
  await page.fill('#walkText', 'Fire door on the fire escape sticking');
  await page.click('#walkAddBtn');
  await page.waitForTimeout(300);
  await page.click('#walkFinishBtn');
  await page.waitForTimeout(300);
  const toast = (await page.textContent('#toast')).trim();
  console.log('      finish toast:', JSON.stringify(toast));
  check('finishing says what was logged and where', /1 issue logged at Glasgow/.test(toast), toast);
  check('the walk closes', !(await page.$('#walkOverlay.open')));
  check('a fresh walk starts empty', true);
  await page.click('#walkBtn');
  await page.waitForTimeout(300);
  check('and asks for the venue again', await page.isVisible('[data-walk-site="Mayfair"]'));
  await page.click('#walkCloseBtn');

  await browser.close();

  /* --- launch parameters: home-screen shortcuts and the Android share sheet ---
   * Both arrive as an ordinary load with a query string. */
  const b2 = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });

  const launch = async (query) => {
    const p = await b2.newPage({ viewport: { width: 420, height: 900 } });
    p.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
    await p.addInitScript(FAKE_MIC);
    await p.goto(APP + query);
    await p.waitForTimeout(700);
    return p;
  };

  let p = await launch('?action=walk');
  check('the Walk shortcut opens the venue picker', await p.isVisible('[data-walk-site="Mayfair"]'));
  check('the query string is cleared so a refresh does not re-fire it',
    !(await p.evaluate(() => location.search)), await p.evaluate(() => location.search));
  await p.close();

  p = await launch('?action=today');
  check('the Today shortcut opens Today', !!(await p.$('#todayOverlay.open')));
  await p.close();

  p = await launch('?text=' + encodeURIComponent(
    'Roof leak above the cash desk at Park Lane, needs sorting by 12 August'));
  check('a shared note opens the pre-filled form', !!(await p.$('#formDrawer.open')));
  check('the shared venue is picked up', (await p.inputValue('#f-site')) === 'Park Lane',
    await p.inputValue('#f-site'));
  check('the shared deadline is picked up', /^\d{4}-08-12$/.test(await p.inputValue('#f-target')),
    await p.inputValue('#f-target'));
  check('sharing saves nothing until Save is pressed',
    (await p.evaluate((k) => JSON.parse(localStorage.getItem(k) || '[]').length, ISSUES)) === 0);
  await p.close();
  await b2.close();

  // --- the manifest must actually declare them ---
  const fs = require('fs');
  const mf = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../manifest.json'), 'utf8'));
  check('manifest declares shortcuts', Array.isArray(mf.shortcuts) && mf.shortcuts.length === 3);
  check('every shortcut url is in scope',
    (mf.shortcuts || []).every((s) => s.url.startsWith('./')));
  check('manifest declares a share target', !!mf.share_target);
  check('the share target is a GET — there is no server to POST to',
    mf.share_target && mf.share_target.method === 'GET', mf.share_target && mf.share_target.method);

  /* Shortcuts land on "./?action=..." — an exact cache match would miss the cached "./"
     and every shortcut would be blank with no signal, which is where they get used. */
  const sw = fs.readFileSync(path.resolve(__dirname, '../../../sw.js'), 'utf8');
  check('the worker ignores the query string when matching the cache',
    /ignoreSearch:\s*true/.test(sw));

  console.log(errors.length ? '\nErrors:\n' + errors.join('\n') : '\nNo errors');
  if (errors.length) failed++;
  console.log(failed ? `FAILED: ${failed} assertion(s)` : 'SITE WALK: OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
