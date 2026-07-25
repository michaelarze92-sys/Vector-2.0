/* "Paste email" quick-capture.
 *
 * The point of the feature is that it saves typing without becoming a second way to
 * create an issue — so the assertions here are as much about what it *doesn't* do
 * (save anything, bypass the form, guess a site it isn't sure about) as what it does.
 *
 * Dates are resolved relative to today, so the expected values are recomputed here
 * with the same rules rather than hard-coded — otherwise this test would start failing
 * on a date in the future for no reason.
 */
const { chromium } = require('playwright');
const path = require('path');

let failed = 0;
const check = (label, ok, detail) => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${label}${detail !== undefined ? ' — ' + detail : ''}`);
  if (!ok) failed++;
};

const toISO = (d) => d.getFullYear() + '-' +
  String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const today = new Date(); today.setHours(0, 0, 0, 0);
const addDays = (n) => { const d = new Date(today); d.setDate(d.getDate() + n); return toISO(d); };

// "by Friday" = the coming Friday; landing on today means next week's, never today
const nextFriday = addDays(((5 - today.getDay() + 7) % 7) || 7);
// "12 August" with no year rolls to next year once this year's has passed
const aug12 = (() => { const d = new Date(today.getFullYear(), 7, 12);
  if (d < today) d.setFullYear(d.getFullYear() + 1); return toISO(d); })();

const EMAIL = [
  'Subject: RE: Chiller 2 tripping on high pressure',
  'From: Dave Jones <dave.jones@dalkia.co.uk>',
  'Sent: Monday',
  '',
  'Hi Michael,',
  '',
  'Reported today by the duty manager. Chiller 2 in the Mayfair plant room has tripped',
  'three times this week. Can we have an engineer attend by Friday please.',
  '',
  'Thanks,',
  'Dave',
].join('\n');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGE ERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE ERROR: ' + m.text()); });

  await page.goto('file://' + path.resolve(__dirname, '../../../dist/estates-ledger-slim.html'));
  await page.waitForTimeout(300);

  // --- the button exists and opens a drawer, not a parallel form ---
  check('Paste email button is in the topbar', await page.isVisible('#pasteEmailBtn'));
  await page.click('#pasteEmailBtn');
  await page.waitForTimeout(300);
  check('paste drawer opens', !!(await page.$('#pasteDrawer.open')));
  check('the textarea has focus', await page.evaluate(() => document.activeElement.id) === 'pasteText');

  // --- an empty paste is refused without opening the form ---
  await page.click('#pasteParseBtn');
  await page.waitForTimeout(200);
  check('empty paste does not open the form', !(await page.$('#formDrawer.open')));
  check('paste drawer stays open', !!(await page.$('#pasteDrawer.open')));

  // --- the real parse ---
  await page.fill('#pasteText', EMAIL);
  await page.click('#pasteParseBtn');
  await page.waitForTimeout(400);

  check('paste drawer closed', !(await page.$('#pasteDrawer.open')));
  check('the normal log form opened', !!(await page.$('#formDrawer.open')));
  check('it is the Log issue form, not Edit',
    (await page.textContent('#formDrawerTitle')).trim() === 'Log issue');
  check('no hidden id — this is a new issue',
    (await page.inputValue('#f-id')) === '');

  const val = (sel) => page.inputValue(sel);
  const title = await val('#f-title');
  check('Subject: becomes the title with RE: stripped',
    title === 'Chiller 2 tripping on high pressure', JSON.stringify(title));
  check('site picked out of the body', (await val('#f-site')) === 'Mayfair', await val('#f-site'));
  check('category from the "chiller" keyword',
    (await val('#f-category')) === 'M&E / Plant', await val('#f-category'));
  check('From: name becomes assigned', (await val('#f-assigned')) === 'Dave Jones', await val('#f-assigned'));
  check('"by Friday" beats "reported today"',
    (await val('#f-target')) === nextFriday, `${await val('#f-target')} (expected ${nextFriday})`);
  check('the full email is kept in the description',
    (await val('#f-desc')).includes('duty manager') && (await val('#f-desc')).includes('Dave'));
  check('defaults are untouched where nothing was guessed',
    (await val('#f-status')) === 'Open' && (await val('#f-risk')) === '2');
  check('date reported still defaults to today',
    (await val('#f-reported')) === toISO(today));

  // --- nothing is saved by parsing ---
  const storedAfterParse = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('estatesLedger.issues.v1') || '[]').length);
  check('parsing saves nothing', storedAfterParse === 0, `${storedAfterParse} issues stored`);

  // --- and the ordinary Save path still does the saving ---
  await page.click('#formSaveBtn');
  await page.waitForTimeout(400);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('estatesLedger.issues.v1') || '[]')[0]);
  check('Save creates the issue as normal', !!saved && saved.title === 'Chiller 2 tripping on high pressure');
  check('the guessed fields were saved',
    !!saved && saved.site === 'Mayfair' && saved.assigned === 'Dave Jones' && saved.targetDate === nextFriday);

  // --- the textarea is emptied, so the next paste starts clean ---
  await page.click('#pasteEmailBtn');
  await page.waitForTimeout(300);
  check('textarea cleared after a parse', (await page.inputValue('#pasteText')) === '');

  // --- an explicit textual date, and no recognisable site ---
  await page.fill('#pasteText',
    'Fire door closer on the second floor is dragging. Needs replacing before 12 August.');
  await page.click('#pasteParseBtn');
  await page.waitForTimeout(400);
  check('"before 12 August" parsed', (await val('#f-target')) === aug12, `${await val('#f-target')} (expected ${aug12})`);
  check('no site guessed when none is named', (await val('#f-site')) === '');
  check('focus goes to the site field when it could not be guessed',
    (await page.evaluate(() => document.activeElement.id)) === 'f-site');
  check('first line becomes the title with no Subject: line',
    (await val('#f-title')).startsWith('Fire door closer'));
  check('fire keyword categorises as H&S', (await val('#f-category')) === 'Health & Safety');
  // the form still refuses to save without a site — same validation as any other add
  await page.click('#formSaveBtn');
  await page.waitForTimeout(300);
  const stillOne = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('estatesLedger.issues.v1') || '[]').length);
  check('cannot save without a site, just like a hand-typed issue', stillOne === 1, `${stillOne} issues`);
  await page.click('#formCancelBtn');
  await page.waitForTimeout(200);

  // --- UK date order, and Clear / Cancel ---
  await page.click('#pasteEmailBtn');
  await page.fill('#pasteText', 'Subject: Glasgow lift LOLER inspection\n\nDue 03/09/2026.');
  await page.click('#pasteParseBtn');
  await page.waitForTimeout(400);
  check('03/09/2026 read as 3 September, not 9 March',
    (await val('#f-target')) === '2026-09-03', await val('#f-target'));
  check('Glasgow matched', (await val('#f-site')) === 'Glasgow');
  await page.click('#formCancelBtn');
  await page.waitForTimeout(200);

  await page.click('#pasteEmailBtn');
  await page.fill('#pasteText', 'some text to throw away');
  await page.click('#pasteClearBtn');
  await page.waitForTimeout(150);
  check('Clear empties the textarea', (await page.inputValue('#pasteText')) === '');
  await page.click('#pasteCancelBtn');
  await page.waitForTimeout(300);
  check('Cancel closes the drawer', !(await page.$('#pasteDrawer.open')));
  check('Cancel does not open the form', !(await page.$('#formDrawer.open')));
  const finalCount = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('estatesLedger.issues.v1') || '[]').length);
  check('still exactly one issue at the end', finalCount === 1, `${finalCount}`);

  // --- it must not fire network requests; the whole app is offline-only ---
  let requested = 0;
  page.on('request', (r) => { if (!r.url().startsWith('file:')) requested++; });
  await page.click('#pasteEmailBtn');
  await page.fill('#pasteText', 'Subject: check\n\nMarble Arch leak tomorrow.');
  await page.click('#pasteParseBtn');
  await page.waitForTimeout(500);
  check('parsing makes no network requests', requested === 0, `${requested} requests`);
  check('"tomorrow" resolved', (await val('#f-target')) === addDays(1), await val('#f-target'));

  // --- narrow viewport: the fourth topbar button must not push anything off screen ---
  await page.click('#formCancelBtn');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const overflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check('no horizontal overflow on a phone viewport', overflow <= 0, `${overflow}px`);
  check('Paste email still tappable on mobile', await page.isVisible('#pasteEmailBtn'));
  await page.screenshot({ path: path.join(__dirname, 'shot_paste_mobile_topbar.png'), fullPage: false });
  await page.click('#pasteEmailBtn');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(__dirname, 'shot_paste_drawer_mobile.png') });

  console.log(errors.length ? '\nErrors:\n' + errors.join('\n') : '\nNo errors');
  await browser.close();
  if (failed) console.log(`FAILED: ${failed} assertion(s)`);
  else console.log('PASTE EMAIL: OK');
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('FAILED:', e); process.exit(1); });
