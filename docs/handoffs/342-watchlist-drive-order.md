# HO 342 — Fix /watchlist 500 (drive-order) + delete dead getSponsorStates

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 342.

The hardened HO 340 probe caught this by timing: `/watchlist` 500s at ~27s because `getWatchlistBills` drives from the 16k `bills` side and filters by watchlist membership, instead of starting from the few-row watchlist and looking each bill up by PK. Same drive-order trap as the HO 336 news joins, which scanned bills rather than driving from the 227-row news table. It's a live user-facing 500.

Worth knowing why HO 332 cleared it as GOOD ("small driver → bills PK"): the stateless Turso planner has no stats to anchor a drive order, so it can pick the bills-side plan cold even when it showed the small-side plan at audit. A clean EXPLAIN once doesn't guarantee the cold plan. The fix is to force the drive order so it's deterministic, never to trust an observed-good plan.

Don't touch the 10s abort (238).

## Fix the drive order

Make the query drive from the watchlist side. The watchlist is tiny and `bills.id` is the PK, so the fast plan walks the watchlist rows, then `SEARCH bills USING INTEGER PRIMARY KEY` for each. Reorder the join so the watchlist table is the outer (`FROM watchlist w JOIN bills b ON b.id = w.bill_id`), and if the stateless planner still grabs bills, force it with `INDEXED BY` on the watchlist key, the same way HO 336 forced `news_mentions m INDEXED BY idx_news_mentions_published`.

Confirm whether `getWatchlistBills` is wrapped in `unstable_cache`. If it's uncached, the 27s aborts on every cold hit and never self-heals (the populate-is-the-timeout trap); the drive-order fix removes that, but record the cache status in the report.

## Verify by timing

- EXPLAIN drives from the watchlist (SCAN watchlist, the few rows) then SEARCH bills on the PK, not a bills scan.
- Cold prod timing on `getWatchlistBills` drops from ~27s to milliseconds, and `/watchlist` returns 200 cold.

## Delete dead getSponsorStates

Grep-confirmed by HO 340: `getSponsorStates` has no caller (`/members` uses `getMemberStates`). Same call as the HO 331/335 dead helpers. Remove it rather than optimize the 28s scan. Re-confirm zero callers before deleting.

## Docs

- backlog: close the `/watchlist` 500 and the `getSponsorStates` OPEN LOOPs from 340; tombstone 342.
- oddities: add `/watchlist` to the drive-order trap note (drive from the small-table side), alongside the news joins, and the planner-non-determinism point (a clean EXPLAIN doesn't fix a drive order; the forced hint does).

## Ship

- Named `git add`; `tsc` + build clean.
- `git push`; `npm run verify:deploy` until served SHA === HEAD.
- Confirm `/watchlist` 200s fast on prod cold.
