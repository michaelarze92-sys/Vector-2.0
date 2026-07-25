# Copilot prompts for the Estates Ledger

Prompts to paste into Outlook Copilot so its output drops straight into the Ledger's
**Paste email** button (topbar → Paste email → Parse into issue).

The formatting rules in Part 2 aren't arbitrary — each one matches something the parser
looks for. The [Why the rules exist](#why-the-rules-exist) table below says what breaks
without each. If the parser's heuristics ever change, these prompts need changing with
them; the parser lives in `src/ledger/estates-ledger.template.html` under
`/* ---------------- email parsing ---------------- */`.

---

## Prompt A — daily / weekly triage

Gives you a prioritised action list first, then Ledger-ready blocks for each one.

```
You are triaging my Outlook inbox for my role as Property & SHE Manager at
Metropolitan Gaming, a UK casino estate.

Review emails from [the last 24 hours / this week / sender X / folder Y].

PART 1 — ACTION SUMMARY
List only emails needing an action FROM ME. Ignore FYI, newsletters, calendar
invites and anything already closed out. One line each:
  [Venue] — what I need to do — who I'm waiting on — deadline
Order by urgency: safety or statutory deadlines first, then cost, then routine.
End with a count: "X actions, Y urgent."

PART 2 — LEDGER BLOCKS
For each action in Part 1, output a separate block in EXACTLY this format,
with a line of --- between blocks:

Subject: <the problem in under 90 characters, no "Re:" or "Fwd:">
From: <contractor or person who needs to act> <their email if known>

<Venue> — <2-4 sentences: what is happening, where in the building, since
when, and what has already been done.>
Action required by <date>.

Rules for Part 2 — follow exactly:
1. Write the venue as one of these exact words: Mayfair, Park Lane, Leicester
   Square, Marble Arch, Manchester, Glasgow, Nottingham. Not the brand name,
   not the address.
2. Write the deadline as "by <date>" or "due <date>" — the cue word must sit
   immediately before the date. Use "by 12 August", "due 03/09/2026" (UK
   order, day first), or "by Friday". Never a date without one of those words
   in front of it.
3. Put NO other date in the block. No "sent on", no "reported on". The
   deadline only.
4. Where it honestly applies, use one of these words so it files itself:
   chiller / plant / boiler / HVAC / electrical / plumbing / air con
   fire / risk assessment / RIDDOR / H&S
   Dalkia / SLA
   refurb / capital / reformat
   tender / ITT / procurement
   roof / door / window / floor / ceiling / wall / leak
5. Plain text inside the blocks. No bullets, no bold, no markdown.
6. If you don't know something, leave it out. Never invent names, dates,
   costs, job numbers or reference numbers.
7. In Part 2, do not summarise away the specifics — I need the plant item,
   the location and the fault as they were actually written.
```

## Prompt B — one email that's just landed

```
Rewrite this email as a Metropolitan Gaming estates issue, plain text only:

Subject: <problem in under 90 characters>
From: <who needs to act> <email>

<Venue — one of Mayfair, Park Lane, Leicester Square, Marble Arch,
Manchester, Glasgow, Nottingham> — what's happening, where, since when.
Action required by <date, written as "by 12 August" or "due 03/09/2026">.

No invented detail. If something isn't in the email, leave it out.
```

---

## Why the rules exist

| Rule | What breaks without it |
|---|---|
| Exact venue spelling | `guessSiteFromText` matches against the seven known names and returns blank rather than guessing wrong — so you pick the site by hand |
| `by`/`due` immediately before the date | `DEADLINE_PHRASE` only trusts a date sitting next to a cue word; without one it falls back to scanning the whole text and may take the first date it sees |
| One date only | a reported-on date can beat the deadline in the fallback scan |
| UK order | `03/09` is read as 3 September; a US-order date lands three months out |
| Under 90 characters | a subject-less block falls back to the first line, truncated at 90 |
| No markdown | `**bold**` arrives as literal asterisks in the issue title |

## Two things to know

**One block per paste.** The parser reads a single issue. Six blocks means six
paste-and-saves — still much faster than typing, but it isn't a bulk import.

**Category priority is fixed**, and it's where the guess is most often wrong. The rules
are checked in order and the first hit wins:

```
plant  →  safety  →  FM/Dalkia  →  capital  →  tender  →  fabric
```

So "fire door, electrical contractor attending" files as **M&E / Plant**, not Health &
Safety, because `electrical` is checked before `fire`. If it's genuinely a safety matter,
keep plant words out of the block — or just change the dropdown when the form opens.

**Always read the form before saving.** Copilot summarising is the weak link, not the
parser: it drops specifics and occasionally invents a date. The form opening pre-filled
rather than saving straight through exists precisely so that screen is the check.

## What is and isn't sent anywhere

Copilot reads your mailbox under Metropolitan Gaming's own Microsoft tenancy — that part
is Microsoft's, and normal company email-handling rules apply to whatever you paste into
it. The Ledger side sends nothing: parsing is regex in the browser, there is no network
call, and the pasted text is stored only in that browser's `localStorage` (and in your
JSON backup). The full body is kept verbatim, signature blocks and forwarded chains
included — trim anything in the textarea you'd rather not keep before hitting Parse.
