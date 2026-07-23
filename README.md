# Casino Estate PM Platform

Project & task management for Metropolitan Gaming Group's estate — task delegation,
an ADHD-friendly Gantt chart, budget tracking, and casino-specific portfolio reporting.
See `CLAUDE.md` for the full brief.

## Status: Phase 0 (scaffold)

What exists right now is the foundation, not the app:

- SQLite schema (`server/db/schema.sql`) covering venues, projects, tasks, checklists,
  compliance milestones, contractor KPIs, and budget lines.
- A seed script that loads your 7 venues and your user record — **no project, task,
  budget, or compliance data is pre-filled.** The app ships empty; you build it up
  from real data as you go.
- An import utility (`server/db/import-she-report.js`) that reads a filled Board SHE
  report CSV (the format `generate_report_7venues.js` / `generate_report.js` already
  use) and pulls Section 7 (Dalkia KPIs) and Section 8 (Board actions) in as contractor
  KPIs and tasks, plus a compliance-status snapshot from Section 1 / `env3`.
  **Not yet imported:** the occupational health / public safety / food safety KPI grids
  (Sections 3, 4, 6) — those are recurring SHE indicators, not project/task-shaped data,
  and are a candidate for the Phase 3 reporting module instead.
- A minimal API (venues, users, health check) and a placeholder client page that just
  proves the two talk to each other.

Task management, the Gantt chart, the dashboard, budgets, and reporting are Phase 1+
(see `CLAUDE.md` history in this repo / your conversation with Claude for the phased plan).

## Running it locally

**First time:**

```bash
cd server
npm install
npm run setup      # creates data/app.db from schema.sql, seeds venues + your user
npm run dev         # starts the API on http://localhost:4000
```

In a second terminal:

```bash
cd client
npm install
npm run dev         # starts the app on http://localhost:5173
```

Open http://localhost:5173 — you should see your 7 venues listed. If you see an error
instead, check the server terminal is still running.

**Importing a filled SHE report CSV** (after `npm run setup`):

```bash
cd server
npm run import -- /path/to/your_filled_report.csv
```

Safe to run once per reporting period — it checks whether that period's Dalkia KPIs
are already in the database and refuses to double-import if so.

## Project layout

```
server/
  db/
    schema.sql              table definitions
    connection.js           SQLite connection helper
    init.js                 applies schema.sql to data/app.db
    seed.js                 venues + your user (structural only)
    import-she-report.js    SHE report CSV -> tasks / contractor_kpis / compliance_milestones
  routes/                   Express route handlers
  index.js                  API entry point
client/
  src/
    App.jsx                 placeholder page (Phase 1 replaces this with the dashboard)
    main.jsx
data/
  app.db                    created locally by `npm run setup` — gitignored, never committed
```
