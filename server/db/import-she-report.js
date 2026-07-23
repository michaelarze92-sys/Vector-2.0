// Imports one period's Board SHE report CSV (the format produced by
// generate_report_7venues.js / generate_report.js) into the PM database.
//
// Scope (deliberately limited for Phase 0 — see README for what's deferred):
//   - Section 1 (v*_fire / v*_water / v*_elec) + env3 (AHU) -> compliance_milestones
//     (status snapshot only: the CSV records pass/fail on the day, not a renewal date,
//     so next_due_date/last_completed_date are left NULL for you to fill in)
//   - Section 7 (fm1..fm5, Dalkia scorecard)                -> contractor_kpis
//   - Section 8 (action1..action8, Board actions)           -> tasks
// Not imported yet: occ/pub/food KPI grids (Sections 3/4/6) — these are recurring
// SHE indicators rather than project/task-shaped data; revisit if the reporting
// module in Phase 3 needs them.
//
// USAGE: node db/import-she-report.js <path-to-csv>

const fs = require('fs');
const { getDb } = require('./connection');

function parseCSVLine(line) {
  const result = [];
  let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') { inQ = !inQ; }
    else if (ch === ',' && !inQ) { result.push(cur); cur = ''; }
    else { cur += ch; }
  }
  result.push(cur);
  return result;
}

function loadReportRow(csvPath) {
  const lines = fs.readFileSync(csvPath, 'utf-8').trim().split('\n');
  const headers = parseCSVLine(lines[0]);
  const values = parseCSVLine(lines[1] || '');
  const row = {};
  headers.forEach((h, i) => { row[h.trim()] = (values[i] || '').trim(); });
  return row;
}

const MONTHS = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function parseDate(text) {
  const m = /^(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})$/.exec((text || '').trim());
  if (!m) return null;
  const month = MONTHS[m[2].slice(0, 3).toLowerCase()];
  if (!month) return null;
  const day = String(m[1]).padStart(2, '0');
  const monthStr = String(month).padStart(2, '0');
  return `${m[3]}-${monthStr}-${day}`;
}

// 7-venue full estate. A 4-venue London-only CSV just won't have v5+ columns —
// those keys are skipped automatically since row[...] comes back undefined.
const VENUE_SHORT_CODES = ['v1', 'v2', 'v3', 'v4', 'v5', 'v6', 'v7'];
const VENUE_SUFFIXES = ['empire', 'mayfair', 'parklane', 'sportsman', 'glasgow', 'manchester', 'nottingham'];

const DALKIA_KPIS = [
  ['PPM completion rate', '>98%'],
  ['Reactive works closed within SLA', '>95%'],
  ['Statutory compliance actions on time', '100%'],
  ['Contractor RAMS submitted prior to works', '100%'],
  ['Quoted vs. Actual Expenditure (Variance %)', '<5%'],
];
const FM_KEYS = ['fm1', 'fm2', 'fm3', 'fm4', 'fm5'];

const ACTION_KEYS = ['action1', 'action2', 'action3', 'action4', 'action5', 'action6', 'action7', 'action8'];

function checkRag(value) {
  if (value === '✓') return 'GREEN'; // ✓
  if (value === '✗') return 'RED';   // ✗
  return null;
}

function importReport(csvPath) {
  const row = loadReportRow(csvPath);
  const periodLabel = `${row.report_month} ${row.report_year}`.trim();
  const db = getDb();

  const alreadyImported = db.prepare(
    `SELECT COUNT(*) AS n FROM contractor_kpis WHERE period_label = ?`
  ).get(periodLabel).n;
  if (periodLabel !== '' && alreadyImported > 0) {
    console.error(
      `Period "${periodLabel}" already has ${alreadyImported} contractor_kpis rows — ` +
      `looks like this file was imported before. Delete those rows first if you want to re-import.`
    );
    db.close();
    process.exit(1);
  }

  const venueByShortCode = new Map(
    db.prepare('SELECT id, short_code FROM venues').all().map(v => [v.short_code, v.id])
  );

  const insertMilestone = db.prepare(`
    INSERT INTO compliance_milestones (venue_id, type, rag_status, notes)
    VALUES (@venue_id, @type, @rag_status, @notes)
  `);
  const insertKpi = db.prepare(`
    INSERT INTO contractor_kpis
      (contractor_name, kpi_name, target_value, this_period_value, last_period_value, rag_status, period_label)
    VALUES (@contractor_name, @kpi_name, @target_value, @this_period_value, @last_period_value, @rag_status, @period_label)
  `);
  const insertTask = db.prepare(`
    INSERT INTO tasks (name, owner_name, due_date, priority, board_input_required, notes)
    VALUES (@name, @owner_name, @due_date, @priority, @board_input_required, @notes)
  `);

  let milestoneCount = 0, kpiCount = 0, taskCount = 0;

  const importMilestone = (shortCode, type, rawValue) => {
    if (!rawValue) return; // blank field — nothing reported for this venue/period
    const venueId = venueByShortCode.get(shortCode);
    if (!venueId) return; // venue not seeded (unexpected — run db/seed.js first)
    insertMilestone.run({
      venue_id: venueId,
      type,
      rag_status: checkRag(rawValue),
      notes: `${periodLabel}: snapshot value "${rawValue}" (no renewal date in source — set next_due_date manually)`,
    });
    milestoneCount++;
  };

  VENUE_SHORT_CODES.forEach((code) => {
    importMilestone(code, 'Fire RA', row[`${code}_fire`]);
    importMilestone(code, 'Water Hygiene L8', row[`${code}_water`]);
    importMilestone(code, 'EICR', row[`${code}_elec`]);
  });
  VENUE_SUFFIXES.forEach((suffix, i) => {
    importMilestone(VENUE_SHORT_CODES[i], 'AHU Service', row[`env3_${suffix}`]);
  });

  FM_KEYS.forEach((key, i) => {
    const thisVal = row[`${key}_this`], lastVal = row[`${key}_last`], rag = row[`${key}_rag`];
    if (!thisVal && !lastVal && !rag) return;
    insertKpi.run({
      contractor_name: 'Dalkia',
      kpi_name: DALKIA_KPIS[i][0],
      target_value: DALKIA_KPIS[i][1],
      this_period_value: thisVal || null,
      last_period_value: lastVal || null,
      rag_status: rag && rag.toUpperCase().startsWith('GREEN') ? 'GREEN'
        : rag && rag.toUpperCase().startsWith('RED') ? 'RED'
        : rag ? 'AMBER' : null,
      period_label: periodLabel,
    });
    kpiCount++;
  });

  ACTION_KEYS.forEach((key) => {
    const desc = row[`${key}_desc`];
    if (!desc) return;
    const owner = row[`${key}_owner`] || null;
    const rawDate = row[`${key}_date`] || '';
    const input = row[`${key}_input`] || '';
    const parsedDate = parseDate(rawDate);
    const notesParts = [];
    if (!parsedDate && rawDate) notesParts.push(`Target: ${rawDate}`);
    if (input) notesParts.push(input);
    insertTask.run({
      name: desc,
      owner_name: owner,
      due_date: parsedDate,
      priority: /urgent/i.test(input) ? 'High' : 'Medium',
      board_input_required: input.trim().toUpperCase().startsWith('YES') ? 1 : 0,
      notes: notesParts.join(' | ') || null,
    });
    taskCount++;
  });

  db.close();
  console.log(
    `Imported "${periodLabel || '(no period label)'}": ` +
    `${milestoneCount} compliance milestones, ${kpiCount} contractor KPIs, ${taskCount} tasks.`
  );
}

const csvPath = process.argv[2];
if (!csvPath) {
  console.error('Usage: node db/import-she-report.js <path-to-csv>');
  process.exit(1);
}
importReport(csvPath);
