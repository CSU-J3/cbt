# HO 279 — /bills getFeedBills timeout (active 500 risk)

The 278 scout surfaced a live one: `getFeedBills`'s COUNT runs ~11s cold on every /bills load, past the 10s abort, so /bills carries the same intermittent 500 as /members did (cold first hit -> abort -> retry -> ~22s -> 500). Same gated-aggregate mis-plan class, same proven recipe. Run after 278's cold test confirms; if /bills is visibly flaking, it can jump ahead.

## Premise

This is the class 277 and 278 nailed: a fat-table COUNT the stateless planner mis-plans onto a full bills scan (it lands on a multi-index OR over `idx_bills_is_ceremonial` now), fixed by a covering/partial index plus a gated INDEXED BY hint. The planner refuses the index unhinted, confirmed three times. The scout measured 11s cold. Its exact WHERE clause and the matching index are the per-query work.

## Fix

1. EXPLAIN QUERY PLAN `getFeedBills`'s COUNT against the deployment. Confirm the SCAN and its filter/sort columns.
2. Add a covering/partial index matching that WHERE plus an INDEXED BY hint on `getFeedBills`'s path. Mirror the 278 partials: if it's summary-gated, a partial `WHERE summary IS NOT NULL` over the filter/sort columns; if it filters on something else, cover that instead. Gate the hint to the path carrying the predicate the partial index requires, so any sibling query without that predicate is untouched (the 277/278 conditional-hint pattern).
3. Verify EXPLAIN flips to `SEARCH ... USING INDEX` off the multi-index OR, and `getFeedBills` is sub-second and stable on repeated prod hits.

Then confirm /bills caching covers the cold path (`unstable_cache` / ISR keyed to the cron cadence), same as /members got, so the slow path never runs inside a user request even if it regrows. If /bills already caches, confirm the cold first-hit isn't bypassing it.

## Constraints

- Additive DDL only. Don't raise the 10s abort. Gated-path-only hints; leave sibling queries alone.
- Measure plans against the deployment.

## Ship

Commit the index/hint and any caching change separately (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify /bills cold (after idle / a fresh deploy) holds 200 on repeated hits and `getFeedBills` is sub-second. EXPLAIN output and the index chosen in the ship report.

## Not in this handoff

The other scout finds (`getSponsorsRanked`, the feed main SELECT, `searchBills`) stay in the backlog WATCH. They need their own EXPLAIN, and the row-returning SELECT and the text-search query may want a different remedy than a covering index (the SELECT's index has to cover filter + sort + selected columns; search may be a LIKE over a fat column that won't index and wants FTS or a rethink). That's a deliberate systemic pass later, not a rushed batch onto this one.
