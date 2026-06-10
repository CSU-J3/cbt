# HO 209 — Primaries data fix: kill false senate contests at the sync + backfill roster gaps

## Why

HO 208's UI guard hides two *different* data problems in the `/primaries` voted block. The guard makes the page look clean; the data underneath isn't. SKILL's "Things to watch for" records both. This handoff fixes them at the source so the page is clean *because the data is*, not because a filter hides it.

The two problems have different severity and get fixed in order:

**Problem 1 — false senate contests (FIX FIRST — wrong information, not missing information).**
HO 91 seeded the `primaries` table for **all 50 states** (D + R) without checking which states actually have a Senate seat up in 2026. The 2026 cycle is **Class II** — roughly 33 states have a Senate election; the other ~17 do not. States like **IN / PA / CA** carry senate primary rows for elections that **do not exist**. A page answering "WTF is going on in Congress" must not display a Pennsylvania Senate primary that isn't happening. Suppress at the seed source, then the UI guard no longer needs to hide them.

**Problem 2 — real-but-unrostered contests (BACKFILL — missing information).**
~35 past primaries are real contests we lack rosters for: **SD / WV senate** (Rounds, Capito — genuine 2026 seats) plus **~25 house** (12 D / 13 R roster-scrape gaps). Honest gaps; the guard correctly hides them until we have data. Fix by backfilling the roster, not suppressing.

Do Problem 1 first and confirm it before touching Problem 2 — removing fictional rows changes the denominator the backfill works against.

## Pre-flight (read, report before changing)

1. Find the senate primary seed logic (HO 91 lineage — likely `lib/primaries-sync.ts` or a seed script). Confirm **where** the all-50-states senate seeding happens and what (if anything) it checks for seat existence. Report the function name and the real loop.
2. Establish the **authoritative 2026 Senate map** — which states have a Class II seat up in 2026 (plus any specials). Source it verifiably, not from memory: the existing `races`/senate data already in the DB (HO 80/171/174 lineage) or a current Senate-class reference. **Report the source and the state count** before filtering — don't introduce a *new* wrong list while removing the old one. If our own DB already knows the 2026 senate seats, that's the join key; use it.
3. Count the spurious rows: how many senate primaries exist for states with **no** 2026 seat (expect IN/PA/CA + others — report the full list, both parties). Confirm the ~35 unrostered real contests (SD/WV senate + house gaps) so Problem 2's scope is exact.

## Fix — Problem 1 (false senate contests)

- At the **seed source**, only create senate primary rows for states with a 2026 Senate seat (the authoritative map from pre-flight #2). Don't seed senate primaries for the ~17 no-seat states.
- **Clean up the existing spurious rows** already in the table (the seed bug already ran). Delete the senate primaries for no-2026-seat states. Key the delete on the verified no-seat list; **print the rows being deleted before deleting** so a wrong map can't silently nuke real contests.
- After cleanup the UI guard's false-contest case is empty — the no-seat rows no longer exist. Leave the guard in place (it still legitimately hides Problem 2's unrostered-real contests), but note in the ship report that its false-contest job is now redundant.

## Fix — Problem 2 (roster backfill)

- Re-scrape rosters for the real-but-unrostered past primaries: **SD / WV senate** + the **~25 house** gaps. Reuse the existing roster scrape (`lib/primary-candidates-scrape.ts` / `lib/primaries-sync.ts`) for the specific primary_ids that came back empty.
- Then run the HO 206 results backfill (`npm run backfill:primary-results`) for those newly-rostered primaries so they get `vote_pct` too (roster and results are separate passes — a fresh roster has NULL vote_pct until the results pass runs).
- Some of the ~25 may genuinely have no Ballotpedia roster (uncontested, or a page-structure miss). Report which backfilled and which are still empty after the re-scrape — don't force-fill, just report the residual.

## Verification

- **No-2026-seat senate primaries are gone** — IN/PA/CA (and any others on the verified list) no longer appear in `primaries`. Print before/after count.
- 2026 senate-seat states still have their primaries intact (the delete didn't over-reach) — spot-check 2-3 real ones (TX, GA, the verified list).
- Re-scraped rosters: SD/WV senate + house gaps now have candidate rows where Ballotpedia had them; report the success/residual split.
- Results backfill ran for the newly-rostered → those that voted now carry `vote_pct`.
- `/primaries` voted block: no false contests; previously-"roster pending" real contests that re-scraped now show real data. Print voted-block row count before/after.
- `tsc` passes; Corey eyeballs the voted block (no fictional senate rows, gaps filled where data exists).

## After ship

- SKILL.md "Things to watch for": flip the data-debt entry — false senate contests **fixed at source** (not guard-hidden); roster gaps backfilled (note any residual that genuinely lacks a Ballotpedia roster). Note the senate seed now gates on the 2026 Class II map.
- If the UI guard's false-contest branch is now fully redundant, note it can be simplified in a future cleanup (don't remove it this handoff — it still serves Problem 2's residual).

## Out of scope

- The primaries map (design-chat arc) and the share bar (shipped — this is upstream data).
- Candidate photos.
- Mobile <700.
- Non-senate seeding (house primaries seed per-district, not part of the false-contest bug — leave alone).

read docs/handoffs/209-primaries-data-fix.md and follow
