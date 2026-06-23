# HO 277 — /members route timeout (digest 4101894172)

Live outage: /members 500s on most loads (`code: 23` TIMEOUT_ERR, digest `4101894172`). The 200s you still see are Vercel Runtime Cache hits masking it. Same class as the 276 dashboard-v2 finding: a Turso query exceeding the 10s DB abort (two attempts, ~20s total, then the 500). This is the urgent one; run it before 278.

## Premise (established, don't re-confirm)

The Vercel logs already pin the failure: first attempt `[db] timeout, retrying`, second aborts at ~20s with digest `4101894172`, execution 20.05s against a 5-minute ceiling, two POSTs to the Turso pipeline (call + retry). So it's a 10s-abort timeout on the /members query, not the Vercel ceiling.

Upgrading is ruled out and not the fix: the function died on the app's own 10s abort (not Vercel's 5min), Turso usage is well within quota (147M/500M reads, 148MB/5GB storage, not BLOCKED), and no higher tier re-plans the query. Do not raise the 10s abort (HO 238) either; that trades the 500 for a 20-40s hang.

What's NOT yet known is the query's shape. That's the probe.

## Step 1 — locate and profile

Find the /members App Router handler and the exact query/queries it runs (the members list plus whatever it aggregates: votes, sponsor counts, scorecard, coverage). Grep. Also find the DB client wrapper with the timeout + retry (search `AbortSignal.timeout`, the retry helper, the `[db] timeout, retrying` log).

Run `EXPLAIN QUERY PLAN` on each /members query against the deployment's Turso DB (plan behavior is hosted-specific; local won't match, ANALYZE is blocked). Report the plans. Classify into the same three buckets as 276:

- `SCAN` on a fat table / mis-plan -> covering index on the filter/join/order columns. If the planner won't take it (the dashboard-v2 case, where a covering index that includes the gating predicate was needed), force it with an INDEXED BY hint.
- N+1 (a query per member in a loop over ~540 members) -> collapse to one query or a batched call. Each round-trip to Turso is the cost, and a 540-iteration loop is how this reaches 10s.
- heavy single aggregate/join -> covering index on the columns it filters and groups by.

## Step 2 — fix per the plan

Apply the matching remedy. Verify `EXPLAIN QUERY PLAN` shows `SEARCH ... USING INDEX`, not `SCAN`, and the query returns sub-second and stable across repeated hits. If the plan turns out to be a subtle mis-plan like dashboard-v2's (the obvious index doesn't take), iterate to a covering index until EXPLAIN flips and the timing holds, before shipping.

Then add deliberate caching for /members (`unstable_cache` or route ISR) keyed to the cron refresh cadence, so the slow path never runs inside a user request even if a future query slows. The cache becomes the default instead of a coin flip.

## Constraints

- Additive DDL only for indexes (CREATE INDEX). If the fix is a query rewrite (collapsing N+1), commit it on its own so it's trivially revertible, and confirm the returned data is unchanged.
- Don't raise the abort, don't upgrade anything.
- Measure plans against the deployment.

## Ship

Commit the index/rewrite and the caching separately (named `git add`, eyeball first). `git push`, `npm run verify:deploy`, served SHA === HEAD. Live-verify /members with the cache bypassed: repeated hits, zero 500s, query sub-second. Put the `EXPLAIN QUERY PLAN` output and the remedy you chose in the ship report.
