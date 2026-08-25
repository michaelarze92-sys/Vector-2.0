# `inspection.html` — orientation for future sessions

Third app in the Metropolitan Estates set. Single self-contained HTML file, one `<style>`
block and one `<script>` IIFE, no framework, no build step, no external requests. Same
constraint as the other two and for the same reason — it has to open on a phone in a
basement plant room with no signal.

Live at `…/Vector-2.0/standalone/inspection.html`.

## What it is

Three inspection templates, chosen at the start and fixed for that inspection:

| Template id | Kind | Control | Score |
|---|---|---|---|
| `condition` | Venue condition survey | Grade 1–5 per element | Average grade (lower is better) |
| `hsaudit` | H&S / statutory audit | Pass / Fail / N/A | Pass rate % of applicable items |
| `ppmqc` | Contractor / PPM quality check | Verified / Rejected / Not sampled | Verified % of sampled items |

`kind` drives the response control, the scoring and what counts as a finding. Adding a
fourth template means adding an entry to `TEMPLATES` — it does not mean writing new UI.
If you find yourself special-casing a template id anywhere outside `TEMPLATES`, you have
missed the pattern.

**N/A and Not sampled are answered but unscored.** They are excluded from the denominator
deliberately: counting a not-applicable item as a pass inflates the score, and counting it
as a fail punishes the venue for not having a kitchen. `countsToScore()` is the one place
that decides this.

## Separation from the Estates Ledger

Enforced, not just intended:

- **`STORE_KEY = "metroInspect.v1"`** and **`PHOTO_DB = "metroInspectPhotos"`**. Nothing
  here can read or write Ledger data.
- Its own service worker (`inspect-sw.js`) scoped to `/standalone/`. The Ledger's root
  worker explicitly refuses anything under `standalone/`, and this one only responds for
  its own three files plus the shared icons. A greedy handler on either side lets one app
  serve stale copies of the other's assets — the classic multi-app PWA failure.
- `CACHE_NAME` in `inspect-sw.js` is **bumped by hand**. There is no build step for this
  app, unlike the Ledger where `build.py` stamps a content hash. Forget, and installed
  phones serve the old file forever.

## The handoff — the only thing tying the apps together

Adverse answers export as an **ISSUES block CSV** in exactly the format the Ledger's
"Merge in data" command reads. That is the whole ecosystem link; the two apps share no
code.

**The column names in `exportLedgerCsv()` must stay in step with `MERGE_BLOCKS` in
`src/ledger/estates-ledger.template.html`.** `test_inspection.js` drives both apps in one
run — export here, merge there — precisely because nothing else would catch a drift.

Two things make re-inspection safe:

- **Venue names are the Ledger's short names** (`Glasgow`, not `Alea Glasgow`, and not the
  Project Board's `v5`). The Ledger dedupes on title + site, so the spelling has to match
  exactly or every re-inspection duplicates.
- **`ledgerTitle()` is `section title — item text`, and deliberately excludes the note.**
  The same defect found again must produce a byte-identical title, or the merge sees a new
  issue. If you ever put the note, a date or a score in the title, re-inspecting a venue
  will double up the register — which is the failure this design exists to prevent.

Severity mapping (`severityFor`) sends grade 5 and any audit fail across as **High**. That
is intentional: downgrading one item on the register is cheap, missing one is not.

## Photos

IndexedDB, never localStorage — a handful of phone snaps would blow the ~5MB quota and
take every inspection with it. Downscaled on capture to 1400px / JPEG 0.72, because a
modern phone JPEG is 4–8MB and nothing here needs more than enough pixels to evidence a
defect.

Photos are **included in the backup JSON**. An inspection backup without its evidence
photos is not a backup of an inspection, it is a list of opinions.

Thumbnails are filled in by `fillThumbs()` *after* render rather than during it: reads are
async, and blocking a re-render on them makes every tap feel slow on a phone.

## Gotchas already paid for

- **`--topbar-h`.** The topbar is `position: sticky; top: 0`. Anything else that sticks
  must clear it or it lands underneath and becomes untappable at the top of the scroll —
  which is exactly where you are when you open a section. The progress bar's Summary
  button was unreachable on a phone because of this.
- **`rerunPreservingScroll()`.** Every tap re-renders the whole page, which is fine, but
  losing your place in a 73-item template is not. It preserves scroll offset and which
  sections are open. Use it instead of `render()` for anything triggered inside the runner.
- **Tapping a selected answer again clears it.** There is no separate "unset" control, and
  a mis-tap on a 5-point scale is common on a phone.
- **`storageHalted`.** Same rule as the Ledger: if saved data fails to parse, stop writing
  and say so rather than starting fresh — the next save would overwrite the only copy. An
  explicit restore is the sanctioned way to clear it.
- **`cache.add` per file, not `cache.addAll`.** `addAll` is atomic, so one missing icon
  would fail the whole install and leave the app with no offline copy at all.

## Tests

`src/ledger/tests/test_inspection.js` (it lives with the Ledger suite because it drives
both apps). Run with the rest: `python3 src/ledger/build.py && bash src/ledger/tests/run-all.sh`.
It asserts the storage namespaces stay separate, that N/A does not inflate the score, that
the export merges into the Ledger, and — the one that matters — that merging the same
findings twice does not duplicate the register.
