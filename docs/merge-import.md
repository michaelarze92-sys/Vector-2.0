# Merging data into the Ledger

Two commands in the menu, and they are not the same thing:

| Command | What it does |
|---|---|
| **Import backup (.json) — REPLACES** | Wipes what's on the device and restores the file. For moving to a new phone, or rolling back. |
| **Merge in data (.json / .csv) — adds only** | Never deletes a row. Never overwrites a field that already has a value. Where both sides have something, **the device wins.** |

Merge shows a preview before writing anything — *"will ADD: 12 issues, 3 contacts… 4 rows are already here and will be skipped"*. Nothing is saved until you confirm.

## Preparing a CSV

Start from `merge-import-template.csv`, or from **Reports → Export everything** if you want the current data in front of you. Only fill in the blocks you have data for — delete the rest, or leave them empty.

Rules for the file:

- Each block starts with its **title on its own line**, then the header row, then data rows.
- Blocks can be in any order, and you can repeat one.
- Blank cells are ignored — they never blank out something already recorded.

### Headers don't have to be exact

The parser normalises case, punctuation and any trailing unit in brackets, and knows some aliases. All of these land on the same field:

- `Assigned` / `Assigned/Contractor` / `Contractor` / `Owner`
- `Cost estimate` / `Cost Estimate (£)` / `Quote` / `Value`
- `Date reported` / `Date Logged` / `Reported`
- `Target date` / `Due date` / `Target`
- `Site` / `Venue` / `Property`

A block's own column name always wins over an alias, so `Venue` in CONTACTS still means the venue.

### Values it will tidy up for you

| Field | Accepts |
|---|---|
| Risk / Urgency / Cost impact | `Low` / `Medium` / `High`, or `1` / `2` / `3` |
| Cost estimate, Actual cost | `£6,231.68` → `6231.68` |
| Any date | `2026-08-04` or `04/08/2026` (UK day-first). Anything else is left blank rather than guessed. |
| Category, Status | Matched to the app's list; an unknown category becomes `Other`, an unknown status becomes `Open`. |
| Tags | Comma or semicolon separated |

An issue with **no venue** — an unsigned MSA, a group budget review — is filed under **Portfolio-wide** rather than dropped.

## How duplicates are detected

| Block | Matched on |
|---|---|
| Issues | Title + venue, case-insensitive |
| Incidents | Id, or reference, or date + venue + type |
| Contacts | Name, within the venue |
| Compliance | Type, within the venue |
| Key locations, reference links | Label, within the venue |
| Site fields, lease fields | Filled only where the device's value is blank |
| Contractors | Name |

**This is exact matching, not fuzzy.** "Empire lift 1 out of service" and "Empire Passenger Lift 1 — disputed root cause" are two different issues as far as the merge is concerned, and you will get both. The skip count in the preview is the check: if it says 0 skipped and you expected overlap, the wording differs somewhere.
