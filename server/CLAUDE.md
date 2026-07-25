# `server/` (+ `client/`) — orientation for future sessions

**Status: Phase 0 scaffold, not the active track.** `standalone/estate-pm.html` is
where actual feature work happens right now. This exists as the future path to a real
hosted, multi-device, multi-user version — build it out when that becomes an actual
need, not speculatively ahead of it. See the root `README.md` comparison table for why
both tracks exist side by side.

## Conventions

- **Schema-first, no ORM.** `db/schema.sql` is the single source of truth for the data
  model — plain SQL, `CREATE TABLE IF NOT EXISTS`, applied via `better-sqlite3`
  (`db/init.js`). If the data model changes, edit the schema, don't bolt migrations
  logic on top of a growing scaffold.
- **`db/seed.js` ships no fabricated data.** It seeds the 7 venues (structural,
  matches the existing SHE report's `v1`–`v7` keys) and one user row. Projects, tasks,
  budget lines: none. Keep it that way — this app is meant to reflect real data the
  user enters, never a plausible-looking demo.
- **`db/import-she-report.js`** is the reference pattern for bringing in an external
  CSV: parse with the same `parseCSVLine` logic the existing
  `generate_report_7venues.js` script uses (so it stays compatible with that separate,
  already-in-use report generator), map only fields with real signal, leave the rest
  null rather than guessing. It's also idempotent per reporting period — check
  `contractor_kpis` for an existing `period_label` before inserting, refuse to
  double-import silently.
- **Routes are thin.** `routes/*.js` are one file per resource, direct `better-sqlite3`
  queries, no service/repository layer — appropriate at this scale, revisit if the
  route count grows past a handful.

## Running it

```
cd server && npm install && npm run setup && npm run dev   # API on :4000
cd client && npm install && npm run dev                     # app on :5173
```

`npm run setup` (re)applies `schema.sql` and seeds venues/user into `data/app.db`,
which is gitignored — never committed, always regenerated locally.

## What's not built yet

Task/project CRUD beyond the seed data, the Gantt, dashboard, budget UI — all of it.
`client/src/App.jsx` is currently just a connectivity check (fetches `/api/health` and
`/api/venues` and lists them), not the real app. If you're picking this track back up,
treat `standalone/estate-pm.html`'s feature set and data model as the spec to port,
not something to redesign from scratch — the two `checklist`/subtask fields, the six
project-log entities (risks, decisions, qaItems, documents, contacts, meetingNotes),
and the merge-not-replace import behavior all apply here too if this becomes the live
version.
