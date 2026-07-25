# Estates Ledger — source, orientation for future sessions

## Read this first: `index.html` is a build output. Never edit it.

The file at the repo root is 2.3MB and **~91% of it is base64 blobs**. It is generated.
The editable source is here:

```
src/ledger/
  estates-ledger.template.html   ← THE SOURCE. ~4,300 lines. Edit this.
  build.py                       ← substitutes assets, writes both outputs
  assets/                        ← raw .woff2 / .png / .mp4 / .webp (not base64)
  tests/                         ← playwright regression suite
```

Build after every change, from the repo root:

```bash
python3 src/ledger/build.py
```

It writes two files from one template:

| Output | Committed? | Why it exists |
|---|---|---|
| `index.html` | yes | GitHub Pages serves this. Full build, includes the background video. |
| `dist/estates-ledger-slim.html` | no (gitignored) | Published as the Claude Artifact. Identical except the `<video>` element is stripped — the artifact viewer fails to render much over ~2MB and the video alone is ~1.6MB of base64. |

If you edit `index.html` directly, the next build silently overwrites you and the
template and the live file diverge permanently. That has to stay a one-way street.

## Design constraints — deliberate, don't "fix" them

- **Single-file output, no external requests.** Fonts, logos, video and the Mayfair
  photo are all base64-inlined. The Artifact CSP blocks CDN/font/script fetches
  outright, and the app has to work offline from a phone home-screen shortcut. This is
  why there's a build step at all: to keep the *source* navigable while the *output*
  stays self-contained.
- **Client-side only.** All data is in that browser's `localStorage` (+ IndexedDB for
  files). No backend, no auth, no sync. Cross-device sync has been raised repeatedly
  and deliberately deferred — it needs a security decision from Michael first.
- **Never seed example data.** Michael was explicit: sample figures from earlier
  design rounds were fake and must not ship. New venues/sections start empty. If you're
  mapping in real data (a CSV, another tool's export), leave anything not actually known
  blank rather than inventing a plausible value.
- **RAG severity and workflow status use separate colour palettes** (`--sev-*` vs
  `--st-*`). They were merged once and the clash made the list unreadable. Keep them apart.

## Template layout

One `<style>` block, then markup, then one `<script>` IIFE split by banner comments.
Grep for `/* ----------------` to jump between sections.

| Section | Contents |
|---|---|
| `:root` theme blocks | Four palettes: default dark, `prefers-color-scheme: light`, `[data-theme="dark"]`, `[data-theme="light"]`, plus `[data-theme="hybrid"]`. Hybrid = dark page, light popups; it re-declares the light vars *scoped to* `.drawer/.modal/.lightbox/.toast/.menu`. |
| file storage (IndexedDB) | `openDB`/`idbPut`/`idbGet`/`idbGetByIssue`/`idbDelete`/`idbAll`. Issue attachments **and** per-site property photos both live here (photos keyed `siteImage:<site>`, `kind:"siteImage"`). |
| rendering | `renderAll`, stat tiles, `collectReminders` (7-day issues / 30-day compliance), `renderReminders`. |
| calendar | Month grid over issue `targetDate` + site compliance `due`. Read-only view of existing data — no new storage. |
| sites overview / profile | `renderComparisonTable`; `renderSiteProfile` → `siteProfileMarkup` + `wireSiteProfile` (Overview + Board Report tabs, site details/contacts/compliance/what3words/reference links). |
| board report metrics | `METRIC_SECTIONS` — per-venue sections 1, 3–6. `ESTATE_SECTIONS_INFO` — sections 2, 7, 8 are estate-wide and live in Reports, not per site. `REQUEST_TEMPLATES` — the quarterly chase emails per data owner. |
| estate-wide board metrics | CSV import (`importBoardCsv`) + cross-venue dashboard. Also the Project Board backup import (`importPmBackup`). |
| site property image | Per-site photo; Mayfair ships a baked-in default in `DEFAULT_SITE_IMAGES`, overridable by upload. |
| capital projects | `renderSiteProjects` — read-only table from the imported Project Board snapshot. |
| form / detail drawer | Issue create/edit; detail view is `openDetail` → `issueDetailMarkup` + `wireIssueDetail` (attachments, notes, email log, links, Promote to project). |
| promote issue to Project Board | `promoteIssueToProject` + the `PM_*` maps. See the contract section below. |
| vector assistant | Pattern-matching command parser. **Not an LLM** — it's regex/keyword matching over local data. Don't describe it to Michael as AI. |

## The markup / wiring split

The two big render paths follow a deliberate three-part shape — copy it if you add
another screen, it's what keeps them readable:

```
renderX(...)      ~10 lines  orchestration: set title, innerHTML = xMarkup(...), wireX(...)
xMarkup(...)      pure       takes data, returns an HTML string, touches no DOM
wireX(...)        binds      attaches listeners once that markup is in the document
```

Applied to `renderSiteProfile` / `siteProfileMarkup` / `wireSiteProfile` and
`openDetail` / `issueDetailMarkup` / `wireIssueDetail`. Keeping the markup half pure
means you can reason about (or test) what gets rendered without a DOM.

**Functions deliberately left long — don't "tidy" these:**

- `vectorHandle` (~120 lines) is a flat command dispatcher: ~30 branches, no markup, no
  listeners. A dispatch chain belongs in one place; splitting it into per-command
  functions means jumping around the file to follow a single decision.
- `renderMetricSectionBody` (~137 lines) branches on `section.repeating` into two
  rendering paths that share their tail (supporting-documents block, save handler).
  Splittable, but the halves interleave — lower value than the two above and more
  regression risk. Fine to leave; if you do split it, split on `repeating` and re-run
  the suite.

Line count on its own isn't the trigger. Median function here is ~8 lines across ~160
functions; the two that were split were doing two genuinely different jobs, not merely
long.

## Storage keys

| Key | Holds |
|---|---|
| `estatesLedger.issues.v1` | the issue list |
| `estatesLedger.siteDetails.v1` | per-site details, contacts, compliance, locations, **and** `metrics` (board-report sections 1, 3–6) |
| `estatesLedger.estateMetrics.v1` | estate-wide sections 2, 7, 8 + reporting period |
| `estatesLedger.pmBoard.v1` | imported Project Board snapshot (projects + summed spend) |
| `estatesLedger.sites/contractors/emails/theme/refs.v1` | lookups and prefs |
| IndexedDB `estatesLedgerFiles` | attachments + site photos (blobs) |

Export backup (`⋮ → Export backup`) serialises all of it including blobs as base64 —
if you add a new key, add it to both the export payload and the import handler, or
Michael's backups will silently lose it.

## Cross-app contract with the Project Board

`standalone/estate-pm.html` stores state under `metroEstatesPM.v1`. Two bridges:

- **Ledger → Board**: `promoteIssueToProject` emits `{source, projects[], tasks[],
  budgetLines[]}` matching that app's backup shape, so its existing merge-import accepts
  it untouched. Quoted cost becomes `budgetAllocated`.
- **Board → Ledger**: `importPmBackup` reads a Board backup, sums `budgetLines` per
  project, and stores a read-only snapshot. The Board stays the master.

Both directions map venues through `PM_VENUE_IDS`
(`Leicester Square→v1, Mayfair→v2, Park Lane→v3, Marble Arch→v4, Glasgow→v5,
Manchester→v6, Nottingham→v7`). **If the Board's `SEED_VENUES` ever changes, this map
must change with it** — nothing enforces that at runtime, a mismatch just silently drops
projects onto the wrong site.

## Gotchas that cost real debugging time

- **`<meta charset="UTF-8">` is load-bearing.** Without it the browser mis-decodes the
  file and every `✓`/`✗` comparison in the CSV importer fails — compliance statuses
  import as raw ticks instead of mapping to Current/Overdue. Silent, not an error.
- **`<meta name="viewport">` is load-bearing.** Without it phones render at a ~980px
  virtual viewport and *every* responsive `@media` rule stays dormant.
- **`.sites-table` sets `color: var(--ink)` explicitly.** It doesn't inherit the
  popup-scoped `--ink` override the way sibling elements do, so in hybrid/light themes
  site names rendered in the dark palette's ink inside a light modal. Don't remove it.
- **`#confirmOverlay` needs `z-index: 60`**, above the full-screen Sites/Reports
  overlays (`z-index: 50`) — otherwise a confirm prompt opened from inside Sites renders
  *behind* it and can't be clicked.
- **`window.claude.downloads` can reject** (size cap, extension allowlist). Every
  download path must fall back to a Blob + `<a download>`; `offerDownload` does this.
- **`mailto:` and the mic are unreliable in the Artifact sandbox.** Chase-by-email is
  built around "copy to clipboard" as the primary action for that reason.

## Testing

```bash
python3 src/ledger/build.py && bash src/ledger/tests/run-all.sh
```

Playwright, headless Chromium, driving the built slim file. Each test seeds
`localStorage` directly, exercises a feature, and asserts no page/console errors — the
suite exists because it caught the charset, table-colour and z-index bugs above. Run it
before any push; add a test with any new feature.
