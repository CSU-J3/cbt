# HO 278 — dashboard-v2 corpus mis-plan (clears the swap blocker)

SUPERSEDES the earlier 278. The prior draft framed this as "covering index, not INDEXED BY (option 1 not 2)". That's wrong. 277 proved the stateless Turso planner refuses these indexes unhinted, so the fix is the covering index AND an INDEXED BY hint, every time on this stack. Discard the option-1-vs-option-2 distinction. 277 also changed the index landscape, so re-verify before adding anything.

Run after 277's cold test confirms clean.

## What 277 established

- The planner will not use a covering index for these gated aggregates without an explicit INDEXED BY hint (stateless Turso, ANALYZE blocked). Index plus hint, not either/or.
- 277 shipped `idx_bills_summary_feed` `(is_ceremonial, update_date)` partial `WHERE summary IS NOT NULL`, with INDEXED BY on `getFeedStats` (the masthead count). That index may already serve dashboard-v2's `getCorpusStats(true)`, since both are summary-gated COUNT/MAX over bills.

The 276 timings predate 277's indexes. Don't assume dashboard-v2's three gated queries still breach.

## Step 0 — re-verify against current prod (post-277)

Run EXPLAIN QUERY PLAN plus repeated timing on dashboard-v2's three gated queries as they stand now: `getCorpusStats(true)`, `getStageDistribution(undefined, true)`, `getTopicDistribution(undefined, true)`.

- If `getCorpusStats(true)` already searches `idx_bills_summary_feed` and is sub-second, it's done. Skip it.
- Fix only what still shows `SCAN bills` or still spikes.

## Step 1 — fix what's left

For each query still mis-planning: add a covering index that includes `summary` AND an INDEXED BY hint forcing it. The gated stage/topic distributions are the likely remainders, since `idx_bills_dash_stage` / `idx_bills_dash_topics` carry no summary column. Starting shapes, finalize against EXPLAIN:

- gated stage aggregate: covering `(is_ceremonial, summary, stage, update_date)` + INDEXED BY on getStageDistribution's gated path.
- gated topic aggregate: covering `(is_ceremonial, summary, topics)` + INDEXED BY on getTopicDistribution's gated path.
- if getCorpusStats still breaches: its own covering index including summary + hint, or extend `idx_bills_summary_feed` to cover it.

Mirror 277's conditional-hint care: if a query has a non-gated branch (e.g. a `?cluster=` path) that relies on a different selective index, gate the INDEXED BY so you don't force the wrong index on that branch.

## Step 2 — scout the rest (list only, don't fix)

While you're in the query layer, grep for other summary-gated COUNT/MAX or fat-table GROUP BY aggregates that lack a covering-index-plus-hint. `getFeedStats` (masthead) runs on every page with the HeaderBar, so this class isn't confined to two routes. List what you find with its EXPLAIN plan; don't fix it here. It goes to the backlog as a WATCH for a systemic pass.

## Verify

- EXPLAIN QUERY PLAN shows `SEARCH ... USING INDEX` (not `SCAN bills`) for all three gated queries.
- Each is sub-second and stable on repeated prod hits, including the `Promise.all` cold path.
- /dashboard-v2 cold (after idle / a fresh deploy), repeated: 200 every time, no transient 500.

## Constraints

- Additive DDL only. Don't raise the 10s abort, don't touch the summary-gating or the masthead counts.
- Measure plans against the deployment.

## Ship

Commit each index + hint change separately (named `git add`). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify the cold path holds. Clears the swap blocker; say so in the ship report, and note the backlog BLOCKER should be re-labeled "gated-aggregate mis-plan" (not "cold-start") and the scout list logged as a WATCH, on the next sweep.
