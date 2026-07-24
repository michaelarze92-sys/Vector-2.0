# Standalone browser version

A single self-contained HTML file — dashboard, Gantt, budget, calendar, quick-add,
JSON export/import. No build step, no server, no database: everything runs in the
browser and saves to that browser's local storage.

This is a different track from `server/` + `client/` (the Node/Express/SQLite app).
That version has a real database and is meant to run on your own machine. This
version trades that for something you can open from a link on any device —
data stays local to whichever browser opens it, and you move it between devices
with the export/import backup buttons on the Data & Backup page.

**Run it**: open `estate-pm.html` directly in a browser (double-click it, or
`open estate-pm.html` / drag it into a browser tab). No install, no dependencies.

Currently published at: https://claude.ai/code/artifact/1a77aa8e-b7ff-4a6c-9672-d7d1a96d52d9

Seeded with the 7 venues only — no fabricated projects, tasks, or figures.

**Not yet in this version** (candidates for a later pass): the SHE report CSV
import that `server/db/import-she-report.js` does, and PDF-style exportable
reports.
