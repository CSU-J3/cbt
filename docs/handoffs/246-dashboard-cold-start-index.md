# HO 246 — dashboard cold-start: index the introduced_date scan + measure the residual

Confirm the next free number before saving: `ls docs/handoffs/ | sort | tail`. Body assumes 246.

## What this is

HO 245 surfaced a cold-start 500 on `/`: on a cold `.next`/cache, the first request hits the 10s `DB_REQUEST_TIMEOUT_MS` (HO 238) on an uncached aggregate and 500s, then serves 200 once `unstable_cache` warms. HO 244's `getNewBillsThisWeekCount` adds to it — it scans `introduced_date`, which has no index, unlike the other dashboard aggregates that ride covering indexes.

This handoff does the cheap, certain part (index the scan) and measures whether that alone clears the 500. It does NOT assume `getNewBillsThisWeekCount` is the sole offender — the cold-start trait predates HO 244. This is the targeted first move on the banked dashboard fan-out/caching pass, not the whole pass. If indexing doesn't clear the cold-start 500, the residual feeds that pass (caching the remaining uncached aggregates — `getDashboardPrimaries` among them) as a separate, larger scope this handoff does NOT build.

## Resolved premises (don't re-derive)

- HO 238 already fast-fails at 10s with a retry. The retry also times out cold because the query is genuinely >10s on a cold connection — so "add a retry" isn't the fix, the query cost is.
- This is the same surface as the open HO 238 soak (dashboard `/` cold-start). This finding is a data point for that soak — a single self-healing 500, milder than the sustained 5-minute 504 burn 238 targeted. Cross-reference the soak; don't open a duplicate loop.

## Measure first (before touching the index)

On a cold start (`rm -rf .next`, restart, first `/` request), instrument the dashboard's uncached aggregates with per-query timing and report which one(s) exceed or approach the 10s budget. The report said "one uncached aggregate hits the 10s" — name it. Don't assume it's `getNewBillsThisWeekCount`; confirm it. List the cold timings.

## The fix — index introduced_date

Add an index covering `getNewBillsThisWeekCount`'s `introduced_date` filter — a plain index on `introduced_date`, or fold it onto an existing covering index if one fits the predicate. Through the project's standard migration path. Confirm with `EXPLAIN QUERY PLAN` that the query now uses the index and the cold timing drops below the timeout.

This is worth doing whether or not it's the sole offender — an unindexed date scan on a 16k-row table is a standing smell.

**Commit:** `perf: index introduced_date for the dashboard new-bills aggregate (HO 246)`

## Re-measure + report

Cold-start `/` again. Does the first request now serve 200?
- Yes → done; the regression HO 244 introduced is closed.
- Still 500s → name the residual offender(s) and their cold timings. That's the explicit input to the fan-out/caching pass (cache the remaining uncached aggregates), which this handoff does NOT build — report it, don't start it.

## Constraints

- One index plus measurement. No caching changes, no fan-out restructure (that's the escalation, separately scoped).
- The index migration is reversible (a drop); no HALT. Run it through the standard migration script. Named `git add`.
- `npm run build` clean.

## Ship report

The cold-start offender list (which aggregate(s) blew the budget, with timings), the index added + `EXPLAIN` confirming its use + the before/after cold timing for the indexed query, and the re-measure verdict (first request 200, or the named residual). If a residual remains, state it as the input to the fan-out/caching pass.
