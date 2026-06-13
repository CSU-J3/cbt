# HO 240 — open-loops ledger + fit-and-finish audit

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 240.

## What this is

Process fix plus a one-time sweep. Open loops (validations, soaks, owed eyeballs, dated follow-ups) have been living in chat closings and human memory — the two least durable stores we have — and items have leaked (the prod flush survived three reminders; GOLD was missing from the tape for a day before anyone said it; the masthead count drifted across three values unnoticed). Two commits:

1. Restructure `docs/backlog.md` into a sectioned ledger with an **OPEN LOOPS** section at top, ingest the inventory below, and ground-truth every entry against live state.
2. Run a **measure-only fit-and-finish audit** across every surface and file findings into the ledger. No fixes in this handoff.

Ordering note: HOs 239 (stage guard + repair) and the GOLD probe block are queued ahead of this. If they've landed, ground-truth reflects that; if not, audit findings about stage counts or the tape cross-reference them instead of filing duplicates.

## Commit 1 — restructure + ingest + ground-truth

**New `docs/backlog.md` structure** (migrate all existing entries into the right section; preserve tombstones):

```
# Backlog
## OPEN LOOPS      — dated; each has owner (Corey/Code/cron), close-criterion, instrument
## QUEUED          — next builds, ordered
## BANKED          — gated/dated items, each with its gate stated
## WATCH           — standing observations with what-would-promote-them criteria
## FIT & FINISH    — audit findings, severity-tagged (P1 wrong-data / P2 inconsistent / P3 cosmetic)
## DONE            — one-line tombstones, append-only
```

Top of file, three-line convention header: *OPEN LOOPS is reconciled at every session open and close. Nothing is tracked only in chat. An item leaves OPEN LOOPS only by meeting its close-criterion or being explicitly tombstoned.*

**Inventory to ingest (planning-chat dump as of 2026-06-12 — verify each against live state; some may already be closed or already present from earlier banking commits; dedupe, don't double-enter):**

OPEN LOOPS:
- HO 238 soak (opened Jun 11): prod `/` watch through ~Jun 16. Close: no 5-minute-burn 504 recurrence. Fast `[db] timeout, retrying` warns are healthy. Instrument: probe script + opportunistic 30-min log window.
- CCBT daily-tick check (due Jun 13, post-09:00 UTC): scheduled `/api/sync` end-to-end pass vs mid-summarize 504; re-run CCBT's `scripts/freshness-check.ts` for the backlog drain rate (refines the 60s-fit port scope). Lives in the CCBT repo; the *check obligation* is logged here for visibility.
- CA certification re-ingest (early July): `npm run reingest:primary-slate -- CA 2026-06-02` to lock mid-count shares. (Already in the CA tombstone — promote the dated obligation to OPEN LOOPS, leave the tombstone.)
- `stage_transitions` validator: routine spot-check; post-HO-239 it doubles as the guard's regression check.
- HO 238 region move egress: confirmed clean Jun 12 for all crons — close this loop in the ledger with that note (example of a loop entering and exiting properly).

QUEUED:
- HO 239 — stage monotonicity guard + repair (delivered, may be unrun).
- GOLD re-add probe block (delivered, may be unrun).
- Masthead count + stamp coherence diagnostic (NEW): three observed counts — 16,193 "BILLS TRACKED" (dashboard), 15,179 "BILLS" (inner pages, Jun 12), 15,398 (inner, Jun 11) — plus label variance (TRACKED vs BILLS) and stamp variance ("LAST SYNC 4:03 AM CT" on dashboard vs "UPDATED 3:03 AM MT" on inner pages — label AND timezone differ by surface). One diagnostic enumerating the count predicate and stamp source per surface; donors HO 47 (count honesty) and HO 134 (count consistency).
- EOD-advance check (NEW, small): the FRED EOD set (WTI/NATGAS/TNX/VIX/BTC) showed identical values Jun 11 evening and Jun 12 1:22 PM CT. Likely legitimate one-business-day lag; verify once that `market_ticks` rows actually advanced a business day across those crons.

BANKED (verify present; these were committed across HOs 235, e3504b7, dbb6b86):
- MOVERS from→to display + hop-count rank — gate: `stage_transitions` accrual (planted 2026-06-11).
- AWAITING RESULTS / date-driven VOTED classification — `cartogram-data.ts:180` + card surfaces; 482-past vs 407-voted gap.
- Forward-sync re-poll of voted-but-NULL contests (~6-week window).
- `primaries.race_id` backfill-or-drop (3/907 populated).
- Deterministic action-code pre-classifier tier (banked by HO 239 — confirm it landed there; if 239 hasn't run, enter it here now so it exists regardless).
- News-linkage arc (race→news pipeline; heavy).
- Dashboard fan-out/caching pass (the latency-watch graduate that 238's bounding didn't address: per-request query count on `/`, `getDashboardPrimaries` uncached among them).

WATCH:
- CD06 ◑ — Sacramento renders 16px inside the valley metro panel (below the 22px floor, geographically stranded within the 2-panel cap). Promote if it ever bothers anyone; fix is config.
- Maps-band duplication across the two district modals (noted in-code for future extraction).
- 7 NO-MATCH Ballotpedia votebox names from the CA re-ingest (drift/write-ins, unattachable; recorded in the tombstone).

HOUSEKEEPING (resolve during this commit, don't ledger it):
- `scripts/diagnostic/divergence-count.ts` — untracked limbo. Read what it does; track it with a one-line header comment if it has a reuse story (the validator/freshness precedent), delete it if it doesn't. Decide, report which.

**Ground-truth pass:** for every entry above and every migrated entry, one live check (grep, query, or file read) that it's still real, still open, and not duplicated. Anything already satisfied gets tombstoned with a one-liner instead of carried.

**Commit:** `docs: restructure backlog into open-loops ledger + ingest 2026-06-12 inventory (HO 240)`

## Commit 2 — fit-and-finish audit (measure-only)

Walk every primary surface against a fixed checklist and file findings into FIT & FINISH with severity. **No fixes, no refactors — findings only.** Where a finding is already queued/banked (stage counts → HO 239; tape symbol set → GOLD block), cross-reference instead of duplicating.

**Surfaces:** `/` (dashboard), `/bills`, `/news`, `/changes`, `/members`, one member page, `/races` MAP and LIST, one race hub, `/primaries` (+ one state modal on each of races/primaries), `/patterns`, `/reports` + one report, `/watchlist`, `/committees` + one committee, one bill page, search.

**Per-surface checklist:**
1. Headline numbers vs a direct DB query (counts, totals, percentages) — exact match or explained predicate.
2. Stamps: label, timezone, and value coherent with actual sync truth, consistent with sibling surfaces.
3. Empty states: render intentionally (designed empties like ENACTED · NONE) vs accidental blanks.
4. Interactions: clicks, hovers, expanders, modals, Esc — function, no dead affordances.
5. Console: zero errors; warnings noted.
6. Dead or placeholder UI: anything rendering that no longer has a data path, anything data has outgrown.
7. Tape correct on that page (single line, symbols, AS OF, closed/stale state as appropriate to the clock).

**Severity:** P1 = wrong data shown; P2 = inconsistent across surfaces or misleading; P3 = cosmetic. Each finding one line: surface · what · expected vs observed · severity.

**Commit:** `docs: fit-and-finish audit findings 2026-06-12 (HO 240)`

## Ship report

End with: OPEN LOOPS count, QUEUED count, P1/P2/P3 finding counts, and the three oldest items in the whole ledger by date. That snapshot is the new session-close baseline.

## Constraints

- Doc-only except the divergence-count.ts disposition (a `git add` or `git rm` is the entire allowed code-tree touch). If the audit finds something actively on fire (P1 wrong-data with user-visible damage), report it at the top of the ship report — still don't fix it here.
- Named `git add` per commit.
