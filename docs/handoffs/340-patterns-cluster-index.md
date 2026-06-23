# HO 340 — Fix /patterns 500 (cluster row-fetch) + close the audit blindspot

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 340.

HO 339 timed all three pages on prod. Only /patterns still 500s. /reports was already fixed by HO 335's `idx_bills_enacted` (its enacted query is 32ms now), and /races measured healthy at 3.4s cold-first, well under the abort, not reproducible. Both premises were stale; no work there beyond a watch on /races if it recurs.

/patterns 500s on `getUnmatchedClusterCount`: `COUNT(*) ... WHERE cluster_id IS NULL AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`. `cluster_id IS NULL` matches 15,117 of 16,538 rows. The plan seeks `idx_bills_cluster_id` and then row-fetches `is_ceremonial` for all 15k, because `is_ceremonial` isn't in that index, which runs ~20s and trips the abort. It never completes, so its `unstable_cache` never populates, so it's a permanent 500 (the populate-is-the-timeout trap). EXPLAIN reads clean here (a plain index scan, no `idx_bills_is_ceremonial` MULTI-INDEX OR), which is exactly why HO 332 cleared it. Third time this row-fetch blindspot has bitten, after the HO 336 /search LIKE.

Don't touch the 10s abort (238). The fix is a covering index, same class as 332/335/331.

## The fix — one covering index, forced on both cluster queries

`CREATE INDEX idx_bills_cluster_agg ON bills(cluster_id, is_ceremonial, stage)`, in `scripts/migrate.ts` and applied to prod (the shared instance).

Force it `INDEXED BY` on both:
- `getUnmatchedClusterCount` — leading `cluster_id` serves the `IS NULL` range, `is_ceremonial` reads from the index, so the count goes index-only with no row-fetch. This is the 20s abort.
- the `getClusterStats` aggregate (GROUP BY `cluster_id`) — `is_ceremonial` and `stage` for its SUMs are in the index, so it goes index-only too, killing the 4.7s cold (it's cached, so it doesn't 500 on its own, but it shares the page's `Promise.all` and the fix is free here).

One index closes both. The await structure and caching stay as they are; the cause is the plan, not parallelism or a missing cache.

## Verify by timing, not just EXPLAIN

This is the crux. A clean-looking plan is what let this through 332. The proof has two parts:

- EXPLAIN must say `USING COVERING INDEX idx_bills_cluster_agg`, not `USING INDEX`. The word COVERING is the index-only signal; a plain `USING INDEX` over a low-selectivity predicate is the row-fetch trap.
- A cold prod timing is the ground truth: `getUnmatchedClusterCount` drops from ~20s to tens of ms, and `/patterns` returns 200 cold. Don't close this on EXPLAIN alone.

Also confirm `getClusterStats` agg cold drops from 4.7s.

## Drop the now-redundant idx_bills_cluster_id (gated)

`idx_bills_cluster_agg` leads on `cluster_id`, so a `cluster_id = ?` point lookup seeks it just as well as the old single-column index. That makes `idx_bills_cluster_id` redundant. Before dropping it: grep every consumer (the drilldown's `cluster_id = ?` lookups, `getClusterDrilldown`, anything else), and EXPLAIN each against the new index to confirm it still seeks cleanly. If every consumer moves to `idx_bills_cluster_agg`, drop `idx_bills_cluster_id` in this handoff (one fewer index maintained on every sync). If any consumer doesn't move cleanly, keep both and report which.

## Harden the probe so this class is caught at audit time

The 332 probe cleared `getUnmatchedClusterCount` because its GOOD/BAD classifier only flagged MULTI-INDEX OR, full SCANs, and `idx_bills_is_ceremonial`-driven plans. A non-COVERING `USING INDEX` scan that row-fetches most of the corpus read as GOOD. That's the blindspot that cost us /search and now /patterns.

Upgrade `scripts/diagnostic/cold-start-audit-332.ts`: flag `USING INDEX` (without COVERING) where the indexed predicate matches a large fraction of rows as a row-fetch risk, not a clean plan. It won't be a clean yes/no in every case, so where the probe can't tell COVERING from a wide row-fetch, have it emit a warn rather than a pass, so the query gets a timing check instead of a silent clear.

Update the SKILL rule to match: the bar is an index-only plan (`USING COVERING INDEX`), and a plain index scan over a low-selectivity predicate is the trap that timing catches, not EXPLAIN. This is the same lesson as the /search FTS note, generalized.

## Docs

- backlog: close the /patterns timeout loop and tombstone 340. Record /reports as already fixed by 335 and /races as healthy/transient (watch, no fix), so neither lingers as a phantom open loop.
- oddities: the COVERING-vs-plain-INDEX distinction and why EXPLAIN alone cleared a 20s row-fetch.

## Ship

- Named `git add`; `tsc` + build clean.
- `git push`; `npm run verify:deploy` until served SHA === HEAD.
- Confirm on prod that `/patterns` returns 200 fast cold, and that the cold `getUnmatchedClusterCount` timing is tens of ms.
- Keep `cold-start-audit-332.ts` (now with the hardened classifier).
