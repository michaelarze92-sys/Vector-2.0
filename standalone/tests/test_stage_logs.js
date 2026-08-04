// Stage gate went from a single click-to-set field to a logged history with notes
// (Governance Log), and RIBA design stages were added the same way, gated behind a
// per-project "designLed" toggle so non-design projects (like-for-like replacement
// work) don't get RIBA noise. Covers: RIBA card hidden/shown correctly, chips derive
// from the log's latest entry (not a separately-editable field), backward-compat
// fallback for projects with an old stageGate value and no log yet, notes persist and
// are editable, and the Planning Submission/Consent checkpoints exist.
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
  await page.fill('#pName', 'Empire Gaming Floor Reformat');
  await page.click('#pSave');
  await page.waitForTimeout(200);
  await page.click('.task-row[data-open-project]');
  await page.waitForTimeout(200);

  let body = await page.textContent('#content');
  ok('Stage gate picker removed from project page (Governance Log replaces it)', body.includes('Governance Log'));
  ok('RIBA card absent by default (not design-led)', !body.includes('RIBA Design Stage Log'));
  ok('New project defaults to Concept chip', body.includes('Concept'));

  // Log a stage-gate entry with notes and confirm the chip updates from it.
  await page.selectOption('form[data-add-stagegatelog] select[name="stage"]', 'Business Case');
  await page.fill('form[data-add-stagegatelog] [name="notes"]', 'Indicative cost approved by Ops Director');
  await page.click('form[data-add-stagegatelog] button[type=submit]');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Governance Log entry with notes saved', body.includes('Indicative cost approved by Ops Director'));
  ok('Header chip reflects latest logged stage', (await page.locator('.page-actions .chip', { hasText: 'Business Case' }).count()) > 0);

  // Edit that log entry (reuses the generic edit mechanism from last session).
  await page.click('[data-edit-stagegatelog]');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Governance Log entry is editable', body.includes('Save changes'));
  await page.fill('form[data-add-stagegatelog] [name="notes"]', 'Indicative cost approved by Ops Director — revised 5%');
  await page.click('form[data-add-stagegatelog] button[type=submit]');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Edited note persists', body.includes('revised 5%'));

  // Turn on design-led -> RIBA card appears, defaults to stage 0.
  await page.click('[data-action="edit-project"]');
  await page.waitForTimeout(200);
  await page.click('label:has(#pDesignLed) .track');
  await page.click('#pSave');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('RIBA card appears once design-led is on', body.includes('RIBA Design Stage Log'));
  ok('Planning Submission stage available', body.includes('Planning Submission'));
  ok('Planning Consent Granted stage available', body.includes('Planning Consent Granted'));

  // Log through to the planning checkpoint with a note — the whole point of adding it.
  await page.selectOption('form[data-add-ribastagelog] select[name="stage"]', '3 – Spatial Coordination');
  await page.fill('form[data-add-ribastagelog] [name="notes"]', 'Concept drawings issued to WCC pre-app');
  await page.click('form[data-add-ribastagelog] button[type=submit]');
  await page.waitForTimeout(200);
  await page.selectOption('form[data-add-ribastagelog] select[name="stage"]', 'Planning Submission');
  await page.fill('form[data-add-ribastagelog] [name="notes"]', 'Submitted to WCC, ref 26/01234/FUL');
  await page.click('form[data-add-ribastagelog] button[type=submit]');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Planning submission logged with reference', body.includes('26/01234/FUL'));
  ok('Header RIBA chip shows Planning Submission', (await page.locator('.page-actions .chip', { hasText: 'Planning Submission' }).count()) > 0);

  // Turn design-led off again -> card disappears (doesn't delete the data, just hides it).
  await page.click('[data-action="edit-project"]');
  await page.waitForTimeout(200);
  await page.click('label:has(#pDesignLed) .track');
  await page.click('#pSave');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('RIBA card hides again when toggled off', !body.includes('RIBA Design Stage Log'));

  await page.click('[data-action="edit-project"]');
  await page.waitForTimeout(200);
  await page.click('label:has(#pDesignLed) .track');
  await page.click('#pSave');
  await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Turning design-led back on does not lose earlier RIBA history', body.includes('26/01234/FUL'));

  // Reload -> everything persisted.
  await page.reload(); await page.waitForTimeout(250);
  await page.click('[data-nav="projects"]'); await page.waitForTimeout(150);
  await page.click('.task-row[data-open-project]'); await page.waitForTimeout(250);
  body = await page.textContent('#content');
  ok('Governance + RIBA history persisted after reload', body.includes('revised 5%') && body.includes('26/01234/FUL'));

  // --- Backward compatibility: an old project with stageGate set directly (pre-log
  // era) and no stageGateLog entries must still show a sensible chip, not crash. ---
  await page.evaluate(() => {
    const raw = JSON.parse(localStorage.getItem('metroEstatesPM.v1'));
    raw.projects.push({ id: 'legacy1', name: 'Legacy Project', venueId: raw.venues[0].id, category: 'Other', owner: '', status: 'In Progress', stageGate: 'Delivery', budgetAllocated: 0 });
    localStorage.setItem('metroEstatesPM.v1', JSON.stringify(raw));
  });
  await page.reload(); await page.waitForTimeout(250);
  await page.click('[data-nav="projects"]'); await page.waitForTimeout(200);
  body = await page.textContent('#content');
  ok('Legacy project (no log, old stageGate field) falls back correctly', body.includes('Legacy Project') && body.includes('Delivery'));

  if (errors.length) { console.log('CONSOLE ERROR'); errors.forEach((e) => console.log('  ' + e)); }
  await browser.close();
})();
