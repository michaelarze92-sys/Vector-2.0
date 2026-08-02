// Every project log (Risk Register, Decisions, Q&A, Documents, Key Contacts, Tender
// Register, Budget Checkpoints, Lessons Learned, Meeting Notes) was add/delete-only —
// there was no way to fix a typo without deleting and re-adding. This verifies the
// edit affordance added to all nine, generically, via editingLogEntry + data-edit-id.
//
// Assert against #content, never document.body — see test_agile_governance.js for why.
const { chromium } = require('playwright');
const path = require('path');
const FILE = 'file://' + path.resolve(__dirname, '..', 'estate-pm.html');

(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push('CONSOLE: ' + m.text()); });
  const ok = (label, cond) => console.log((cond ? 'ok: ' : 'FAILED: ') + label);

  await page.goto(FILE);
  await page.click('[data-nav="projects"]');
  await page.click('[data-action="new-project"]');
  await page.fill('#pName', 'Mayfair Refurb');
  await page.click('#pSave');
  await page.waitForTimeout(200);
  await page.click('.task-row[data-open-project]');
  await page.waitForTimeout(200);

  // Generic add -> edit -> save -> verify -> reload -> verify persisted, per log type.
  async function testTableLog({ label, addForm, editAttr, fields, expectAfterEdit, checkColspan }) {
    for (const [name, value] of Object.entries(fields.add)) {
      const el = page.locator(`form[data-add-${addForm}] [name="${name}"]`);
      const tag = await el.evaluate((n) => n.tagName.toLowerCase()).catch(() => null);
      if (tag === 'select') await page.selectOption(`form[data-add-${addForm}] [name="${name}"]`, value);
      else await page.fill(`form[data-add-${addForm}] [name="${name}"]`, value);
    }
    await page.click(`form[data-add-${addForm}] button[type=submit]`);
    await page.waitForTimeout(200);

    // enter edit mode
    await page.click(`[data-edit-${editAttr}]`);
    await page.waitForTimeout(200);
    let body = await page.textContent('#content');
    ok(label + ': edit mode shows "Save changes"', body.includes('Save changes'));
    ok(label + ': row highlighted while editing', (await page.locator('.log-row-editing, details.note-card[open]').count()) > 0);

    for (const [name, value] of Object.entries(fields.edit)) {
      const el = page.locator(`form[data-add-${addForm}] [name="${name}"]`);
      const tag = await el.evaluate((n) => n.tagName.toLowerCase()).catch(() => null);
      if (tag === 'select') await page.selectOption(`form[data-add-${addForm}] [name="${name}"]`, value);
      else await page.fill(`form[data-add-${addForm}] [name="${name}"]`, value);
    }
    await page.click(`form[data-add-${addForm}] button[type=submit]`);
    await page.waitForTimeout(200);

    body = await page.textContent('#content');
    ok(label + ': edited value visible', body.includes(expectAfterEdit));
    ok(label + ': no duplicate row created', (body.match(new RegExp(expectAfterEdit.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length === 1);

    // reload -> re-open project -> verify persisted
    await page.reload(); await page.waitForTimeout(250);
    await page.click('[data-nav="projects"]'); await page.waitForTimeout(150);
    await page.click('.task-row[data-open-project]'); await page.waitForTimeout(250);
    body = await page.textContent('#content');
    ok(label + ': persisted after reload', body.includes(expectAfterEdit));
  }

  await testTableLog({
    label: 'Risk Register', addForm: 'risk', editAttr: 'risk',
    fields: { add: { risk: 'Asbestos in ceiling void' }, edit: { risk: 'Asbestos in ceiling void (confirmed R&D survey)' } },
    expectAfterEdit: 'Asbestos in ceiling void (confirmed R&D survey)',
  });
  await testTableLog({
    label: 'Decisions Log', addForm: 'decision', editAttr: 'decision',
    fields: { add: { decision: 'Proceed with two-stage tender' }, edit: { decision: 'Proceed with single-stage tender' } },
    expectAfterEdit: 'Proceed with single-stage tender',
  });
  await testTableLog({
    label: 'Q&A Log', addForm: 'qa', editAttr: 'qa',
    fields: { add: { question: 'Is asbestos survey required?' }, edit: { question: 'Is an R&D asbestos survey required?' } },
    expectAfterEdit: 'Is an R&D asbestos survey required?',
  });
  await testTableLog({
    label: 'Documents Register', addForm: 'document', editAttr: 'document',
    fields: { add: { name: 'Asbestos R&D survey' }, edit: { name: 'Asbestos R&D survey v2' } },
    expectAfterEdit: 'Asbestos R&D survey v2',
  });
  await testTableLog({
    label: 'Key Contacts', addForm: 'contact', editAttr: 'contact',
    fields: { add: { name: 'J Smith' }, edit: { name: 'J Smith (WCC Planning)' } },
    expectAfterEdit: 'J Smith (WCC Planning)',
  });
  await testTableLog({
    label: 'Tender Register', addForm: 'tender', editAttr: 'tender',
    fields: { add: { title: 'Chiller replacement ITT' }, edit: { title: 'Chiller replacement ITT (re-issued)' } },
    expectAfterEdit: 'Chiller replacement ITT (re-issued)',
  });
  await testTableLog({
    label: 'Budget Checkpoints', addForm: 'budgetcheckpoint', editAttr: 'budgetcheckpoint',
    fields: { add: { amount: '150000' }, edit: { amount: '162500' } },
    expectAfterEdit: '£162,500',
  });
  await testTableLog({
    label: 'Lessons Learned', addForm: 'lesson', editAttr: 'lesson',
    fields: { add: { whatHappened: 'ITT issued without asbestos survey' }, edit: { whatHappened: 'ITT issued without asbestos survey attached' } },
    expectAfterEdit: 'ITT issued without asbestos survey attached',
  });

  // Meeting Notes: different shape (accordion + textarea), test separately.
  await page.fill('form[data-add-meetingnote] [name="title"]', 'Call with WCC Planning');
  await page.fill('form[data-add-meetingnote] [name="body"]', 'Discussed timeline');
  await page.click('form[data-add-meetingnote] button[type=submit]');
  await page.waitForTimeout(200);
  await page.click('[data-edit-meetingnote]');
  await page.waitForTimeout(200);
  let body = await page.textContent('#content');
  ok('Meeting Notes: edit mode shows "Save changes"', body.includes('Save changes'));
  await page.fill('form[data-add-meetingnote] [name="title"]', 'Call with WCC Planning (follow-up)');
  await page.click('form[data-add-meetingnote] button[type=submit]');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Meeting Notes: edited title visible', body.includes('Call with WCC Planning (follow-up)'));
  await page.reload(); await page.waitForTimeout(250);
  await page.click('[data-nav="projects"]'); await page.waitForTimeout(150);
  await page.click('.task-row[data-open-project]'); await page.waitForTimeout(250);
  body = await page.textContent('#content');
  ok('Meeting Notes: persisted after reload', body.includes('Call with WCC Planning (follow-up)'));

  // --- Cancel button aborts the edit without changing the record ---
  await page.click('[data-edit-risk]');
  await page.waitForTimeout(200);
  await page.fill('form[data-add-risk] [name="risk"]', 'THIS SHOULD NOT SAVE');
  await page.click('[data-cancel-edit="risks"]');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Cancel discards the in-progress edit', !body.includes('THIS SHOULD NOT SAVE'));
  ok('Cancel returns form to "Add" mode', body.includes('Add risk'));

  // --- Deleting the row being edited clears edit mode instead of erroring ---
  await page.click('[data-edit-risk]');
  await page.waitForTimeout(200);
  await page.click('[data-delete-risk]');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Deleting the row under edit clears edit mode cleanly', body.includes('Add risk') && !body.includes('Save changes'));

  // --- Editing state is per-project: switching projects must not leak it ---
  await page.click('[data-edit-decision]');
  await page.waitForTimeout(200);
  await page.click('[data-nav="projects"]');
  await page.click('[data-action="new-project"]');
  await page.fill('#pName', 'Second Project');
  await page.click('#pSave');
  await page.waitForTimeout(200);
  await page.click('.task-row .t-name:has-text("Second Project")');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Switching projects clears stale edit state', !body.includes('Save changes'));

  if (errors.length) { console.log('CONSOLE ERROR'); errors.forEach((e) => console.log('  ' + e)); }
  await browser.close();
})();
