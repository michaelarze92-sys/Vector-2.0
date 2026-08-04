# `estate-pm.html` — orientation for future sessions

Single self-contained HTML file (~1,800 lines): inline `<style>`, inline `<script>`,
no build step, no framework, no external requests. That's a constraint of the format
it ships in (a Claude Artifact / static GitHub Pages file), not an oversight — keep it
that way. Everything below assumes you're editing this one file.

## How it's organised

The `<script>` is one IIFE, top to bottom, split into banner-commented sections in this
order. Grep for `====` to jump between them:

| Section | Contents |
|---|---|
| ICONS | Every icon is an inline SVG string in the `ICON` object. No icon font, no external SVG sprite. |
| DATE UTILS | ISO-string date helpers (`toISO`, `parseISO`, `addDays`, `daysBetween`, `todayISO`, `fmtShort`/`fmtLong`). All dates in state are `YYYY-MM-DD` strings, never `Date` objects. |
| STATE | `freshState()` (the schema + seed venues), `load()`/`save()` (localStorage key `metroEstatesPM.v1`), and lookup helpers (`projectById`, `venueById`, etc). |
| NAV | Page list, `go(pageId)` / `viewProject(id)` navigation, mobile drawer toggle. |
| QUICK ADD | The always-visible top-bar task quick-add form. |
| DASHBOARD | Overdue / due-this-week / budget alerts. Pulls from `allDatedItems()` (tasks *and* subtasks with due dates, merged) — don't reintroduce a tasks-only view here. |
| GANTT | The custom Gantt: zoom levels, drag-to-reschedule, dependency lines, milestones. `renderTaskRow` and `startDrag` are the two functions to understand before touching this. |
| KANBAN BOARD | `renderKanban()` + `bindKanbanEvents()` — four status columns, HTML5 drag-and-drop between them, filters by project/venue/owner persisted in `state.ui.kanbanFilter`. Same tasks as the Gantt, flow view instead of timeline. |
| PROJECTS LIST & DETAIL | The project list page and per-project detail page: Tasks, then the eleven project logs (see below) — the original nine plus `stageGateLog`/`ribaStageLog`. |
| BUDGET / CALENDAR / DATA & BACKUP | Mostly self-contained; Calendar also pulls subtask due dates in, same pattern as Dashboard. |
| PAGE DISPATCH | `renderPage()` — full re-render of `#content` on every state change, then `bindPageEvents()` re-attaches listeners. No virtual DOM, no diffing. If you add a page, register it in both `PAGES`/dispatch and add its bindings here. |
| TASK MODAL / PROJECT MODAL / COST MODAL | `<dialog>`-based modals, built fresh (innerHTML) each time they open. |
| INIT | The only code that runs outside a function — `renderNav()` + `renderPage()` on load. |

## Data model

`state = { venues, projects, tasks, budgetLines, contacts, qaItems, documents,
decisions, risks, meetingNotes, ui }`. Venues are seeded once and not user-editable.
Everything else starts empty — **never seed this app with example figures**; if you're
importing real-world data (a spreadsheet, another tool's export), map it in but leave
anything not actually known as `null`/empty rather than inventing a plausible value.

Tasks have a `checklist` array (subtasks). Each checklist item can carry its own
`dueDate`, `assigneeName`/`assigneeEmail`, and `notes` — same shape as the parent task's
delegation fields, deliberately, so `allDatedItems()` can treat tasks and subtasks
uniformly.

## The nine project logs (Risk Register, Decisions Log, Q&A Log, Documents Register,
Key Contacts, Meeting Notes, Tender & Procurement Register, Budget Checkpoints,
Lessons Learned)

These all follow one generic pattern, defined once as `PROJECT_LOG_ENTITIES` (in the
PROJECTS LIST & DETAIL section) — an array of `{ key, addAttr, delAttr, editAttr,
fields }`. **Adding another log type means adding one entry to that array plus its
render markup — it does not mean writing new add/delete/edit/import-merge logic.** The
generic handlers in `bindProjectDetailEvents()` and `importBackup()` already iterate
that config. If you ever find yourself hand-writing a delete or edit handler for a new
record type, you've missed the existing pattern.

### Editing an existing row

All nine were add/delete-only until a real gap: no way to fix a typo without deleting
and re-entering the whole row. Fixed generically, not per-log:

- `editingLogEntry` (top-level, near `viewingProjectId`) holds `{ key, id } | null` —
  which single row, across the *entire app*, is mid-edit right now. Not part of
  `state`; it's UI-only and must never survive navigating away, so `go()` and
  `viewProject()` both clear it. Forgetting that on a future nav function is exactly
  how a stale edit for project A's risk would silently start editing project B's data.
- **Each log's existing add-form doubles as its edit form** — there is no separate
  edit UI. `editingRecord(key)` looks up the record; if found, the form's inputs render
  pre-filled with `value="..."`/`selected` instead of blank/defaults, the submit
  button reads "Save changes" instead of "Add X", and a Cancel button appears
  (`data-cancel-edit="<key>"`). The form carries a `data-edit-id` attribute — the
  record's id in edit mode, empty in add mode — so the one generic submit handler in
  `bindProjectDetailEvents()` knows whether to push a new record or mutate the
  existing one by id. Same handler either way, no branch per log type.
- `selOpts(options, current)` replaces every hand-written `<option selected>` list —
  needed because "which option is selected" now depends on whether a record is being
  edited, not just on which log this is.
- Deleting the row currently being edited clears `editingLogEntry` in the same
  handler, before render — otherwise the form keeps showing values from a record that
  no longer exists in `state`.
- Meeting Notes is the one log with a genuinely different shape (accordion, not a
  table) — it reuses the exact same `editingLogEntry`/`data-edit-id` mechanism, just
  wired into its own markup (`open` on the `<details>` being edited) rather than a
  generic row renderer, since a `<details>` accordion and a `<table>` row don't share
  enough markup to be worth unifying.

Regression coverage: `tests/test_log_editing.js` drives all nine end to end (edit,
save, verify, reload, verify persisted) plus cancel, delete-while-editing, and
cross-project isolation.

## Agile/Kanban borrowings — and what was deliberately not borrowed

Straight Scrum doesn't fit this estate: fixed sprints and velocity are meaningless
against procurement lead times and reactive compliance work, and Scrum has no concept
of a stage gate. What *is* borrowed: continuous Kanban flow (the Board page), a WIP
limit (`WIP_LIMIT` = 5, surfaced as a dashboard banner via `wipByOwner()`), and
retrospectives (the Lessons Learned log). `wipByOwner()` counts in-progress tasks and
*undone delegated subtasks* together — a subtask handed to someone is real load on
them even though it isn't a task in its own right.

Not borrowed, on purpose: sprints, story points, burndown. Don't add them; the app's
cadence anchors are Michael's real reporting deadlines (below), not an artificial
iteration length.

## Governance calendar cadence

`GOVERNANCE_CADENCE` + `governanceEventsForMonth()` overlay Michael's recurring
reporting deadlines onto the Calendar as gold `.cal-gov` chips: monthly FM dashboard,
quarterly SHE pack and ECT Board SHE report (quarters = Jan/Apr/Jul/Oct). The
*cadence* is fixed in code; the day-of-month is **a placeholder, not researched** —
`GOV_DAY_DEFAULTS` is a guess, editable per-row on the Calendar page and stored in
`state.ui.govDays`. `state.ui.hideGovernance` turns the overlay off entirely.

Two things here are load-bearing:

- Governance events **`unshift` onto the day's item list**, never `push` — day cells
  render `slice(0, 3)`, so a board deadline would silently vanish behind three ordinary
  tasks otherwise.
- The day-input handler **blurs the input and defers `renderPage()` by a tick**.
  `renderPage()` replaces `#content` wholesale; doing that synchronously inside a
  `change` handler tears the focused input out mid-blur and Chrome throws on the
  `innerHTML` assignment. Verified: it threw before the fix, clean after.

## Stage gate & RIBA design stage — logged history, not a clickable field

**This replaced an earlier design.** Stage gate started as a single click-to-set field
in the project modal (`#pStageGate`, mirroring `#pStatus`), with the advice to record
*why* in the Decisions Log separately. Michael explicitly rejected that split — he
wants notes captured at the point of the stage change itself, not routed through a
different log — so the click-picker is gone and stage gate is now a **logged history**,
same shape as Budget Checkpoints. Don't reintroduce a directly-editable `stageGate`
field in the project modal; that would recreate the two-sources-of-truth problem this
redesign exists to avoid (see below).

- **`stageGateLog`** (`STAGE_GATES = ["Concept", "Business Case", "Approved",
  "Procurement/Tender", "Delivery", "Close-out"]`) and **`ribaStageLog`**
  (`RIBA_STAGES` — the RIBA Plan of Work 2020 spine, 0 through 7, with two practical
  checkpoints inserted that RIBA doesn't number as their own stage: `"Planning
  Submission"` and `"Planning Consent Granted"`, sitting between stage 3 and stage 4).
  Both are ordinary `PROJECT_LOG_ENTITIES` entries — `{ stage, date, notes }` — fully
  add/edit/delete capable via the generic mechanism, nothing bespoke.
- **The displayed chip is never a stored value — it's derived.** `effectiveStageGate(p)`
  and `effectiveRibaStage(p)` return the *last entry* in that project's log. This is
  deliberate: there is exactly one source of truth (the log), so the chip shown on the
  project list, the detail header, and anywhere else can never drift out of sync with
  the history that explains it. Don't add a separately-settable "current stage" field
  alongside the log — that's exactly the bug this design avoids.
- **`p.stageGate` still exists on the project object, but only as a fallback** for
  projects that had a stage set via the old click-picker before this log existed and
  haven't logged anything since. `effectiveStageGate()` checks the log first, and only
  reads `p.stageGate` when the log is empty. There is no equivalent fallback for RIBA —
  it's a new field, so `effectiveRibaStage()` just defaults to `RIBA_STAGES[0]`.
- **RIBA is gated behind `project.designLed`** (a toggle in the project modal, same
  pattern as `licenceRiskFlag`/`gamingFloorDisruption`), and the whole RIBA Design
  Stage Log card is omitted from the page when it's off — a like-for-like plant
  replacement has no design phase, and showing RIBA stages on it would be noise, not
  signal. Turning it off doesn't delete `ribaStageLog` entries, only hides the card;
  turning it back on shows the same history (`test_stage_logs.js` asserts this
  specifically).
- Both logs sort by **date**, not by stage order (unlike Budget Checkpoints, which
  sorts by `STAGE_GATES.indexOf`). A project can legitimately revisit an earlier stage
  (sent back for revision), and gate-order sorting would clump those non-chronologically
  — a log is a timeline, read it as one.
- `historyChip(stage, stages, label)` is the one chip renderer both `stageGateChip()`
  and `ribaStageChip()` call — colour banding by fractional position in the stages
  array, not hardcoded per-stage. Adding a stage to either list doesn't need a matching
  edit to the chip colour logic.

## Budget Checkpoints (`budgetCheckpoints`)

Sits alongside `stageGate`, not inside the existing Budget page's allocated-vs-spent
tracking — different question. The Budget page (`budgetLines`) answers "what have we
actually spent against the pot." `budgetCheckpoints` answers "how has the estimate
itself evolved as this moved through governance" — an indicative figure at Business
Case, a signed-off number at Approved, a contracted sum at Procurement/Tender, an
actual at Close-out. Each checkpoint records `{ stage, amount, date, notes }`; the
render sorts by `STAGE_GATES.indexOf(stage)` rather than entry order, so the trail
always reads in gate order even if someone logs a later stage before backfilling an
earlier one. `amount` is stored as the raw string `FormData` gives it (same as every
other `PROJECT_LOG_ENTITIES` field) — `money()` coerces it with `Number(n) || 0` at
render time, so don't add a parseFloat step here that the rest of the file doesn't have.

The Tender & Procurement Register (`tenders`) was added to
track ITTs/tenders per project (route, status, issue/return dates, est. value, owner)
now that the Ledger's "Tender & Contract" issue category can promote into a
"Contractor-Managed" project. It reuses `logStatusChip()` (extended with
Draft/Issued/Questions/Evaluation/Awarded/Cancelled) rather than inventing a second
status-chip renderer.

## Import/export

`exportBackup()` dumps the whole `state` object as JSON (via the `downloads` capability
when available, a plain `<a download>` fallback otherwise). `importBackup()` **merges**
into existing data — it does not replace it. It reassigns any colliding id to a fresh
one and fixes up cross-references (`projectId`, `dependsOnTaskId`). This was a
deliberate fix (see git history: "Make backup import merge instead of silently
replacing everything") — do not revert to a wholesale `state = parsed` replace.

## Theme

Light/dark is a **display setting, not app data** — stored separately in
`localStorage["metroEstatesPM.theme"]` (`"light"` | `"dark"` | absent = follow the OS via
`prefers-color-scheme`), not inside `state`, so switching theme never touches
`exportBackup()`/`importBackup()`. `getTheme()`/`applyTheme()`/`setTheme()` sit right
after `save()` in the STATE section; the toggle itself renders inside `renderNav()`
(`navFoot`) with a delegated click listener next to the nav-list one. `--felt`/
`--felt-ink` (the sidebar's dark green) are intentionally the same in both themes — it's
the brand colour, not something "light mode" should flatten — only `--page`/`--surface`/
`--ink`/`--accent` etc. actually swap.

## Manifest `id` and install identity vs. the Ledger

`id` was `"/standalone/estate-pm.html"` — a leading slash resolves against the
**origin root**, not the manifest's own directory, so on GitHub Pages (served from a
`/Vector-2.0/` subpath, not domain root) it pointed at a page that doesn't exist,
missing the repo prefix entirely. Now a fully-qualified absolute URL, to remove any
resolution ambiguity rather than trade one relative-path mistake for another.

That fixes a real bug, but it is not sufficient on its own to guarantee Android treats
this as a distinct installable app from the Ledger, and don't represent it that way to
Michael. The Ledger's manifest `scope` is `/Vector-2.0/` — the repo root — and this
app's own URL (`/Vector-2.0/standalone/estate-pm.html`) sits structurally *inside* that
scope. A manifest `scope` is a plain URL-prefix match with no way to carve out a
sub-path exception, so that containment is unavoidable given the current directory
layout (this app living inside the Ledger's tree), not something a manifest tweak can
fully resolve. Per spec, per-page `id`/manifest-link identity is supposed to let two
apps install separately despite nested scopes — the `id` bug above worked against that
— but real Android/WebAPK behaviour with nested scopes has known rough edges beyond
spec compliance. If install confusion recurs after this fix, the actual fix is
structural (separate subdomains, or a build that publishes this app outside the
Ledger's scope), not another manifest field.

## PWA update mechanism (`sw.js` + the update toast)

`sw.js`'s cache name is a SHA-256 hash of `estate-pm.html`'s bytes (`hashCacheName()`),
not a manually-bumped string — there's nothing to forget to bump, so a stale cache can't
survive a deploy by omission. Because the hash lives in a module-level *promise*
(`cacheNamePromise`) rather than a stored value, it's re-derived safely even if the
worker gets terminated and restarted between `install`/`activate`/`fetch` events.

Note the mechanism this actually catches: normal content-only edits to `estate-pm.html`
are already kept fresh by the existing stale-while-revalidate `fetch` handler, updating
the *same* cache object in the background — no new install cycle needed. The
hash-rename + update-toast path exists for the other case: browsers only detect a
service worker *update* by byte-diffing `sw.js` itself, so it fires when `sw.js`'s own
logic changes (a caching-strategy fix, this kind of edit) — that's when you'd otherwise
risk instance getting stuck on an old worker indefinitely.

**Two bugs found and fixed by writing `tests/test_pwa_update.js`, both real — this
history matters if the fetch handler gets touched again:**

1. **`event.respondWith(cached)` does not keep the worker alive for the background
   refetch.** It settles the instant the cached copy is handed over, and the browser
   is then free to terminate the worker — killing the very network request
   stale-while-revalidate depends on. The fix wraps a manually-resolved promise in
   `event.waitUntil()`, called synchronously in the `fetch` handler (must happen while
   the event is still dispatching), resolved from the background fetch's `.finally()`.
   Verified: without this, a content-only deploy could sit uncached indefinitely on an
   installed PWA that never gets fully closed — which is exactly what happened.
2. **`cached.clone()` throwing "Response body is already used."** `cached` is the same
   Response object handed to `respondWith()`; once the browser starts piping its body
   to the page, the stream is disturbed and a later `.clone()` throws. The fix clones
   immediately after `cache.match()`, before `cached` is ever returned. This one is
   nastier than it sounds — it lands in a `.catch()` and fails *silently*, so the
   background revalidation looks like it's running (no errors surfaced) while actually
   doing nothing.

Content-only changes (editing `estate-pm.html` without touching `sw.js`) still can't
trigger a *service-worker* update — browsers only byte-diff `sw.js` for that — so
there's a second signalling path for this case: the background revalidation above
diffs old vs. new HTML text, and on a real difference writes a flag into the cache
(`FLAG_URL = './__content-update__'`) *and* broadcasts `{type:'CONTENT_UPDATED'}` to
open clients. Both halves are required, not redundant — they cover opposite races. The
flag catches a change spotted before the page was ready to listen (the common case: the
revalidation runs during the very navigation that loaded the page); the broadcast
catches one spotted after. The page asks via `CHECK_CONTENT_UPDATE` once
`navigator.serviceWorker.ready` resolves. `showUpdateToast(null)` (no registration) is
the content-only path — the reload button falls back to a plain `location.reload()`
since there's no waiting worker to `SKIP_WAITING`.

`sw.js` does **not** call `self.skipWaiting()` in `install` — a new worker sits
`waiting` until the page's "Update available" toast (`estate-pm.html`, wired up where
the SW registers) gets tapped, which posts `{type:"SKIP_WAITING"}` and reloads once
`controllerchange` fires. Deliberately not automatic: this app gets used mid-task on a
gaming floor, and an unprompted reload could drop whatever someone's mid-typing.

Verified end-to-end with a local static server (not `file://` — service workers need a
secure context) by editing `sw.js` on disk to simulate a deploy, confirming the toast
appears, and confirming the reload swaps to the new cache — see git history around this
CLAUDE.md entry for the throwaway test script if you need to re-verify after a future
change to this flow.

## Paste-an-email import ("Paste email" button, topbar)

`openEmailImportModal()` takes pasted free text (an email, or a Copilot summary of
one) and heuristically guesses a task's title, due date, sender/delegate, and matching
project — then opens the ordinary task modal pre-filled via `openTaskModal(null,
prefill)`, so nothing is ever saved until the person reviews and hits Save there. This
exists as the no-IT-dependency half of a bigger ask (auto-triaging Outlook/Copilot into
this app and the Estates Ledger): a real Microsoft Graph integration needs an Azure AD
app registration and admin consent from the org's IT/security team, which wasn't
confirmed as available — this heuristic bridge needs nothing from IT and works today.

`parseEmailText()`/`guessDateFromText()` are regex/keyword heuristics only — there is
**no AI or network call** involved (this file makes none, by design, the same as
everywhere else in it). Don't expect them to be always right; they're meant to save
typing on the obvious cases (a "Subject:" line, a "From: Name <email>" header, "by
Friday", explicit dates), not to replace judgement. If this needs to get smarter later,
the natural next step is the Power Automate bridge already discussed with the user
(tag/flag an email in Outlook → logged to a CSV/Excel/SharePoint list → import that),
not more regex here.

## Testing

`standalone/tests/` holds a Playwright regression suite, same shape as the Ledger's:

```bash
cd standalone/tests && npm install   # first time only
bash standalone/tests/run-all.sh     # runs every test_*.js, from anywhere
```

The runner greps output for `FAILED:`/`PAGEERROR`/`CONSOLE ERROR`, so tests just print
`ok: <label>` / `FAILED: <label>` and let it decide. Chromium is preinstalled at
`/opt/pw-browsers/chromium` in Claude Code web sessions — never run
`playwright install`.

**Assert against `#content`, never `document.body`.** The entire app `<script>` lives
inside `<body>`, so `page.textContent('body')` returns the source code too — a check
like `body.includes('Lessons Learned')` passes against the string literal in the
source even when the feature rendered nothing at all. Four assertions silently passed
this way while the suite was being written. Anything not inside `#content` (the
top-bar quick-add, the nav) needs an element locator rather than a text match.

Areas older than the suite (Gantt drag, modals, theme, PWA update) are still only
covered by ad hoc scripts — extend `tests/` rather than writing new throwaway ones.

## Gotchas hit once already — don't reintroduce these

- **A generic `input { width: 100% }` rule reaches checkboxes too.** A checkbox with
  `flex-basis: auto` resolves its flex-basis from the specified `width`, so it can
  silently eat the whole row. Any new flex row mixing checkboxes/buttons with text
  inputs needs an explicit `flex: none; width: auto` on the non-text-input children.
- **Absolutely-positioned decorative overlays need `pointer-events: none`.** The Gantt
  "Today" marker line originally blocked clicks on anything sitting under it.
- **Size absolutely-positioned children with an explicit `height`, not `top` +
  `bottom`.** `bottom` is relative to the *containing block* (here, the whole Gantt
  timeline, not the row) — combining an inline `top` with a stylesheet `bottom` silently
  stretched a task bar down through every row below it.
- **`registration.update()` only re-fetches and byte-diffs `sw.js` itself** — editing
  only `estate-pm.html` and calling it does nothing (no `updatefound`, no toast). That's
  correct, not a bug: content-only changes are already covered by the SW's
  stale-while-revalidate `fetch` handler. To test the update-toast path, the file that
  has to change is `sw.js`.
