# HO 335 — Close the cold-start audit (fix the 10)

Confirm next free number: `ls docs/handoffs/ | sort -V | tail`. Body assumes 335.

HO 332's audit EXPLAINed all 53 bills/news_mentions statements against prod. Every previously-fixed path (241/246/277/278/279/331) still plans correctly, so nothing regressed. It surfaced 10 genuine live cold-start risks, 3 low-severity ones on the dead `/dashboard-classic` route, and 3 dead helpers. This closes the 10 and deletes the dead code. The 3 low-severity ones ride the existing `/dashboard-classic` sunset loop; don't spend an index on a route slated to die.

The principle behind the new-index calls, since 332 left it open: when a BAD-plan query exceeds the 10s abort cold, it 500s. Worse, it can't self-heal, because the populate-on-read that would cache it is the read that's timing out (the June 14 homepage saga). A cached cold-500 is permanent, not transient. So "it's cached, accept it" is the wrong call here. Fix all 10. Spend indexes carefully, though: hint an existing index wherever one serves the query without a fat row-fetch, add a new index only where nothing existing avoids a table scan, and prefer partial indexes so sync write-cost stays low.

Same hard rules as the audit: don't touch the 10s abort (HO 238 is intentional). VACUUM and ANALYZE stay blocked, the planner is permanently stateless, so every fix is a forced `INDEXED BY` or a covering index, proven by the EXPLAIN flip and never trusted to the planner. The target plan is index-only (covering-index point lookup, index range, or covering-index scan); the failure signal is an `idx_bills_is_ceremonial` MULTI-INDEX OR or a SCAN that row-fetches the fat table.

## A. Drive-order hints — existing index, zero new cost (the 331 pattern)

Four queries drive from the 16k `bills` side when they should ride an index that already exists. Copy the hint the GOOD sibling already carries:

- `getNewsFeed` (all 3 statements: count, breakingCount, rows) and `searchNews` — both SEARCH the 227-row `news_mentions` but drive from `bills` via `idx_bills_is_ceremonial`. Add `news_mentions m INDEXED BY idx_news_mentions_published`, the exact hint `getBreakingNewsForHome` carries and plans GOOD with.
- `searchBills` — MULTI-INDEX OR + LIKE. Hint `idx_bills_summary_feed` to collapse it to a single index scan. The LIKE row-fetch is unavoidable, same as `getStaleCount`'s rows path.

EXPLAIN-flip each: target index present, no `idx_bills_is_ceremonial` MULTI-INDEX OR.

## B. getFeedBills bare SELECT — sort-conditional hint (do this first, highest traffic)

`/bills` default rows: the highest-traffic BAD and the row-SELECT the HO 279 comment explicitly left as WATCH. Plan is MULTI-INDEX OR `idx_bills_is_ceremonial` plus a TEMP B-TREE sort over ~14k. The fix is a pre-ordered index walk the LIMIT short-circuits, but the right index depends on the active sort:

- action sort -> `INDEXED BY idx_bills_latest_action`
- introduced sort -> `INDEXED BY idx_bills_introduced_date`

The hint is conditional on the sort key. The query builder picks the `INDEXED BY` clause from the same sort param that sets the `ORDER BY`. Confirm both indexes are ordered DESC so the walk feeds the LIMIT with no re-sort. EXPLAIN-flip both sort paths: index walk, no TEMP B-TREE.

## C. New indexes — only where nothing existing serves it

Six queries scan or full-row-fetch because no index covers them. Add the index, partial where the query carries a stable filter:

- `getLawsEnactedBySessionWeek` (`/reports`) — a full SCAN of 16k for the ~95 enacted rows, the worst plan in the set. A partial `(stage) WHERE stage = 'enacted'` (or `(congress, stage)` if the congress filter is fixed) turns it into a ~95-row lookup. Cheapest index, biggest drop. Do this one first of the C set. Guard: this is `getLawsEnactedBySessionWeek`, NOT `queryEnactedThisWeek` (the home ENACTED banner, already GOOD on `idx_bills_dash_stage`). Leave that one alone.
- `getStaleCount` (`/stale`) — HO 241's banked case, now confirmed. Partial `(stage, latest_action_date, is_ceremonial) WHERE summary IS NOT NULL` for an index-only count. Closes the 241 open loop.
- `getFeedBills` ?chamber count (`/bills?chamber=`) — partial `(bill_type, is_ceremonial) WHERE summary IS NOT NULL`, index-only count.
- `getTopicMixByChamber`, `getBillsByMonth`, `getIntroductionsByMonth` (`/trends`) — full-corpus aggregates with no selective filter, so they touch every non-ceremonial row regardless. The goal is index-only, so the scan carries no random row I/O. Try the existing-index hint first (`idx_bills_dash_topics` for topic-mix, `idx_bills_introduced_date` for the two month histograms). If the EXPLAIN still row-fetches the grouped columns (bill_type / congress / topics) across the whole corpus, add the covering index that makes it index-only. Your call per query; default to covering if the hint still row-fetches 16k rows.

Every new index goes in `scripts/migrate.ts` AND gets applied to prod (the single Turso instance dev and prod share). Each index is maintained on every sync write, so don't add one a hint already solves.

## D. Delete the dead code — don't index it

Grep-confirmed zero callers (the planner flagged them, but they're unreachable). Same call HO 331 made on the dead `OR sponsor_name` branch: remove, don't optimize.

- `getBreakingNews` (only comments reference it; the live home block is `getBreakingNewsForHome`)
- `getSponsorsRanked`, `getSponsorCount`, `getSponsors`, `getSponsorPassRates` (orphaned by the HO 328 members/committees merge)

## Verify

- EXPLAIN-flip on every A/B/C fix: target index in the plan, no `idx_bills_is_ceremonial` MULTI-INDEX OR, no TEMP B-TREE on the sort path.
- A cold prod hit on the two worst offenders, `getLawsEnactedBySessionWeek` (was a full scan) and `getFeedBills` bare SELECT (highest traffic), on an evicted cache, returning tens of ms rather than seconds.
- `tsc` + build clean.

## Docs — install the discipline so this doesn't regrow

The 10 are symptoms. The cause is that a new bills-table query can ship without anyone checking its plan. Close that:

- SKILL.md: any query touching `bills` must EXPLAIN to an index-only plan (covering-index lookup, range, or scan), never an `idx_bills_is_ceremonial` MULTI-INDEX OR or a fat-table SCAN. The standing probe is `scripts/diagnostic/cold-start-audit-332.ts`; run it after adding or changing a bills query. That's the merge-time check that ends the whack-a-mole.
- oddities: the drive-order trap (news/search queries driving from the 16k bills side instead of the 227-row news side) plus the fix hint, so it isn't reintroduced.
- backlog OPEN LOOPS: close `getStaleCount` (the 241 banked partial-index case, now fixed) and the `getFeedBills` bare-SELECT WATCH (279). Note `/dashboard-classic`'s 3 low-severity index-only scans as riding the existing sunset loop; they vanish when the route does.

## Ship

- Named `git add` per change group; `tsc` + build clean.
- `git push`; `npm run verify:deploy` until served SHA === HEAD.
- Keep `scripts/diagnostic/cold-start-audit-332.ts`. It's now the standing regression probe for this class.
