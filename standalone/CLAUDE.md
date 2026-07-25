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
| PROJECTS LIST & DETAIL | The project list page and per-project detail page: Tasks, then the six project logs (see below). |
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

## The six project logs (Risk Register, Decisions Log, Q&A Log, Documents Register,
Key Contacts, Meeting Notes)

These all follow one generic pattern, defined once as `PROJECT_LOG_ENTITIES` (in the
PROJECTS LIST & DETAIL section) — an array of `{ key, addAttr, delAttr, fields }`.
**Adding a seventh log type means adding one entry to that array plus its render
markup — it does not mean writing new add/delete/import-merge logic.** The generic
handlers in `bindProjectDetailEvents()` and `importBackup()` already iterate that
config. If you ever find yourself hand-writing a delete handler for a new record type,
you've missed the existing pattern.

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

## Testing

There's no bundled test framework. This file has been verified with ad hoc Playwright
scripts run against it directly via a `file://` URL (headless Chromium at
`/opt/pw-browsers` in the dev sandbox) — add a project, add tasks/subtasks, exercise
each modal, check dark mode and a ~390px mobile viewport, reload the page to confirm
`localStorage` persistence. Those scripts weren't checked into the repo (they were
scratch files); recreate them rather than assuming they exist somewhere.

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
