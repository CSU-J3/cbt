# HO 206 — Primary results ingestion: backfill + forward sync (Phase 2 of HO 205)

## Why

HO 205 Phase 1 confirmed the source. Ballotpedia carries 2026 primary results in **static HTML** (`<div class="percentage_number">`, precise `width:…%` style, raw vote counts, winner class), at the **exact per-race URLs the scraper already fetches**, with an **exact name-join** (the stored `primary_candidates.name` rows came from this same parse — zero fuzzy matching). Sources B/C were unnecessary.

This handoff lights up `primary_candidates.vote_pct` (currently 0/2,632, 100% NULL), which unblocks two parked consumers at once: the HO 203 candidate-field **share bar** and the design-chat **results-colored primaries map**.

**Premise correction from Phase 1 — scope to the real numbers, not HO 205's "~7 states":** as of 2026-06-05, **22 states have voted; 457/904 primaries (~51%) are past; 422 are past-with-roster.** The immediate backfill is ~422 contests, not ~9. All 904 primaries are dated (0 NULL `primary_date`).

Backfill and forward sync **ship together in this one handoff** — they share the parser. Backfill writes results for the ~422 already-voted rostered primaries; the forward sync writes results for each remaining contest as it votes (May→September). Coverage rises from ~47% today toward ~full by September.

## Two risks from Phase 1 — both MUST be handled, both are scoped below

**1. The votebox gotcha (silent-corruption risk — this is the one that matters).**
Each Ballotpedia race page carries **many identically-marked voteboxes**: the 2026 primary, the 2026 runoff, the 2026 general, AND historical 2024/2022 primary/general/runoff boxes. A naive page-wide `percentage_number` scan pulls the **wrong election** — Phase 1 caught a cached "AL-1 78.4%" that was Barry Moore's **2024 general**, not a 2026 primary.

The fix: **extend the existing votebox isolation, do NOT add a page-wide scan.** The current parser in `lib/primary-candidates-scrape.ts` already isolates the correct 2026 primary votebox (the first non-runoff D/R votebox) — our correct rosters are the proof it picks the right one. Phase 2 adds `vote_pct` extraction *inside that same already-isolated votebox*, reading the per-row `percentage_number` / `width:` cell the parser currently skips. It does not widen the selector scope.

**2. Stale cache (zero-backfill risk).**
The `.cache/ballotpedia/` HTML is from ~May 20, pre-results — its 2026 voteboxes show `pct=0`. Live pages now carry results. The results pass **must re-fetch live** (bust or bypass the cache for this pass) or it backfills zeros. ~900 pages, but the cron already walks them, so the cost profile is known.

## Pre-flight (read before writing, report divergence)

1. `lib/primary-candidates-scrape.ts` — the `parseVotebox` / `ScrapedCandidate` path. Confirm exactly where the 2026-primary votebox is isolated and where per-row name/party/incumbent/isWinner are read, so `vote_pct` extraction slots into that same row loop. Confirm the cell that carries the percentage (`percentage_number` div vs. the `width:` style) and which is higher-precision.
2. `lib/primaries-sync.ts` — the orchestration that calls the scraper and writes `primary_candidates`. Confirm the upsert shape and that a results UPDATE can key on `(primary_id, name)` exact match.
3. `.cache/` mechanism — confirm how to bust/bypass for the results pass (the EROFS-swallowing behavior Phase 1 noted) without breaking the roster-scrape cache path.
4. Confirm `vote_pct REAL` is live in `scripts/migrate.ts` (Phase 1 said present — verify, no migration if so).

## Build

**Parser extension** (`lib/primary-candidates-scrape.ts`):
- Inside the **already-isolated 2026-primary votebox** row loop, also extract the result percentage (prefer the higher-precision source per pre-flight #1) and optionally raw votes. Add `votePct: number | null` (and `votes?: number | null` if cheap) to `ScrapedCandidate`. NULL when the box has no results yet (un-voted primary) — distinguishable from `0`.
- Do **not** broaden the votebox selector. Same isolation, one more cell read.

**Write path** (`lib/primaries-sync.ts`):
- After the roster upsert, UPDATE `primary_candidates SET vote_pct = ? WHERE primary_id = ? AND name = ?` — exact name match, same-source, no normalization.
- Only write when the scraped `votePct` is non-NULL, so un-voted primaries stay NULL rather than getting stomped to 0.

**Cache:** the results pass re-fetches live (bust/bypass per pre-flight #3). Roster scrape can keep its cache; only the results read needs freshness.

**Backfill trigger:** a one-time pass over the ~422 past-with-roster primaries (or just run the extended sync over all rostered primaries — un-voted ones return NULL and no-op the UPDATE, voted ones populate). State which approach in the ship report and the row count touched.

## Verification (the six standard prints + results-specific)

- Rostered primaries processed; of those, how many got ≥1 non-NULL `vote_pct`.
- `vote_pct` populated count (expect ~422 primaries' worth of candidate rows non-NULL after backfill; report the candidate-row number).
- **Spot-check the votebox-isolation fix held:** confirm a known multi-box page (e.g. TX-Senate — Paxton 40.5% / 878,564, headed to a Cornyn runoff) wrote the **2026 primary** percentages, not a historical box. Print the TX-Sen R-primary rows with their `vote_pct`.
- Confirm un-voted primaries (future-date) are still NULL, not 0.
- Confirm no roster rows were lost/duplicated (count before == count after; this is a UPDATE, not an insert).
- Sum-check one race: the 2026-primary `vote_pct`s for a single contest should sum to ~100% (±rounding/minor-candidate truncation).

## After ship

- Update SKILL.md: add the results-ingestion path to the primaries section — Ballotpedia results parse, the **scoped-votebox rule** (2026-primary box only, the historical-box gotcha), the live re-fetch requirement, exact `(primary_id, name)` join, and the coverage reality (~47% today → ~full by September as states vote).
- Note the two now-unblocked consumers: HO 203 share bar and the design-chat results map can both build against populated `vote_pct`.

## Out of scope

- The share-bar UI (HO 203's deferred surface) — unblocks now, separate handoff.
- The primaries map — design-chat spec, separate arc; ship the calendar-geography version first per the HO 205 verdict, layer results-coloring as `vote_pct` fills.
- Raw-vote display, turnout, runoff-result modeling — `vote_pct` is the target; raw votes optional only if free in the same parse.
- The ~35 unrostered-past primaries — those are roster-scrape gaps, a separate fix, not a results problem.

read docs/handoffs/206-primary-results-ingestion.md and follow
