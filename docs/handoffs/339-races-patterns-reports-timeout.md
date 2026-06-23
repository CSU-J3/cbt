# HO 339 — Diagnose the /races, /patterns, /reports timeouts

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 339.

/races, /patterns, and /reports time out on prod. The 332 audit doesn't cover them. It was scoped to the fat `bills` table, and these three lean on tables it ruled out (races ratings and candidates) or queries it already cleared as GOOD (the cluster helpers on /patterns). So this is probably a different mechanism than the misplan class we just closed, and the fix diverges by cause. Only these three time out, not every inner page, so the shared chrome and feed-stats queries (cached, GOOD since 278) aren't it; the cause is specific to each page. Probe all three and HALT with per-page findings. Don't fix blind.

Prime suspect: these were built in later arcs (races, patterns, reports), after the HO 49 sweep wrapped /sponsors, /stale, /president, /changes, /watchlist in `unstable_cache`. If they're uncached, every cold hit pays the full connection warm-up (the ~8s HO 238 class Code keeps measuring) plus the page's own queries, and once that crosses the 10s abort it 500s and never self-heals, because the populate-on-read is the request timing out (the June 14 trap). Confirm it per page, because if a single query is slow on its own, or the queries fan out sequentially, caching alone won't save it.

Don't touch the 10s abort (238). Use timing here, not just EXPLAIN: a plan-only check is blind to connection warm-up and to fan-out, the way it missed the /search LIKE scan. EXPLAIN only the one query that's slow warm, if there is one.

## Probe — per page

Read each page and its server components and list every query it runs, including the non-bills ones. For each page report the four items below.

What's unique to each, so you time the right thing:
- /races — the races-table queries plus any per-race enrichment (ratings history, candidates, Kalshi/Polymarket odds, FEC). A fan-out across the race set is the suspect here. Confirm which index helper the page actually calls; `getRacesIndex` (INNER JOIN on rating existence, ~137 races) and `getMostCompetitiveRaces` (ABS(score) <= 1, ~61 races) are different queries and have been conflated before, so time the one the page runs, not the wrong one.
- /patterns — the cluster helpers EXPLAINed GOOD in 332, but the page may also run a heavier bubble/similarity aggregate the audit never timed. Find it.
- /reports — the report listing is light (one row per week), so the suspect is a live aggregate behind a stat strip (the HO 242 enactments strip), not the listing. Time the strip queries.

Per page:

1. Cache status. Is each query wrapped in `unstable_cache` + a `revalidateTag`, or uncached? This is the prime suspect, so be explicit per query.

2. Cold vs warm timing on prod. Extend `cold-start-audit-332.ts` or a sibling one-off under `scripts/diagnostic/`, read-only, against prod Turso. Time each query cold (first hit on a fresh process, paying connection warm-up) and warm. The first-query-vs-rest gap is itself signal: it separates the warm-up cost from the per-query cost.

3. Await structure. Are the page's queries in a `Promise.all` or awaited one after another? Sequential cold round-trips stack (the 329 suspect, even though that one turned out parallel).

4. EXPLAIN anything slow warm. A races, cluster, or report query the audit never looked at could carry its own misplan. If so, name the covering index.

## HALT — per page, report:

- the query list with cache status per query
- cold and warm timings, warm-up cost separated from per-query cost
- parallel or sequential
- the dominant cause: uncached-paying-warm-up-every-hit, a single slow query, or sequential fan-out
- the matching fix with rough before/after: `unstable_cache` + `revalidateTag` if uncached and the populate fits under 10s; `Promise.all` if sequential; a covering index + `INDEXED BY` if a single query misplans. Flag any page that needs more than one.

Don't implement. The fix differs by cause, and I want the cause per page visible first, same as 332. Keep the probe under `scripts/diagnostic/`.
