# CBT Oddities & Gotchas

Field notes on the non-obvious things that broke, or nearly broke, while building this. The kind of thing worth recounting when someone asks what was actually hard about it. Newest at the top; append as you go.

Dates are exact where I tracked them live, flagged `~` where approximate, and tagged with a handoff number (HO) where the precise calendar day is best read off git. `git log` the matching `docs/handoffs/` file to pin those down.

---

## The homepage cold-start 500: a four-layer stack (found Jun 14, fixed Jun 15, 2026)

`/` started intermittently throwing 500s, then got stuck 500ing. The cause wasn't one bug, it was four things stacked, and each fix uncovered the next layer.

1. The bills table carried 27 MB of `raw_json` inline across ~16k rows. The homepage aggregates don't even select that column, but to read any column SQLite has to load the row's page, and those pages are fat with blob. So the first cold scan after Turso evicted its page cache took 8–14s.

2. HO 238's 10s DB abort + retry then turned "slow" into "dead." A cold aggregate can't finish inside 10s, so it aborts, retries (still cold), aborts again, throws. The "20s 500" in the logs was literally 2×10s.

3. `unstable_cache` is populate-on-read, and the read is exactly what couldn't finish cold. The cache could never self-populate, so every request re-ran the same doomed recompute. That's why it was *stuck* 500ing rather than just intermittent. A cron pre-warm didn't help either: the pre-warm runs the same query, hits the same abort, and 504'd the sync.

4. ANALYZE is blocked on hosted Turso (see below), so the planner is statless and was grabbing `idx_bills_is_ceremonial` (where `is_ceremonial=0` matches ~every row, so it scanned the whole table) instead of the selective date index that already existed. The feed queries were 17–20s *even warm*.

The fix ended up tiny: two covering indexes so the aggregates go index-only and never touch the fat table, plus `INDEXED BY` hints on five feed queries to force the planner onto the right existing index. Final diff was 5 hints in one file and 2 new indexes. `/` now heals itself cold through plain populate-on-read.

The real lesson was process, not code: every premise we opened with was wrong, and each got disproven by measuring live state, not by reasoning. The raw_json migration died on VACUUM being blocked; the caching theory died on populate-on-read; "keep the pre-warm as a fallback" died when the pre-warm hit the same abort.

## VACUUM is blocked on hosted Turso (hit Jun 2026, during the abandoned HO 241 migration)

`SQL_PARSE_ERROR: SQL not allowed statement: VACUUM`. You can't reclaim space or repack a table from the client, and the Turso CLI hits the same protocol wall. This killed the clean version of moving `raw_json` out: `DROP COLUMN` rewrites rows but doesn't repack pages, so without VACUUM the only way to actually shrink a table is a full rebuild-and-swap.

## ANALYZE is also blocked (hit Jun 2026, same session)

Same family as VACUUM. No `sqlite_stat1`, so the planner has no statistics and makes bad index choices, and it won't pick a selective index even when one exists. On a fat table that's fatal, because a mis-planned query scans everything. The fix isn't ANALYZE (you can't run it), it's `INDEXED BY` hints to force the planner's hand on the queries it gets wrong.

## FRED works on a laptop and is blocked from Vercel (found Jun 10, 2026, HO 227; resolved HO 228 / Jun 12)

`fredgraph.csv` fetched fine in local dev and timed out for every symbol from Vercel's egress, a cloud-IP block rather than a code bug. The "TNX/VIX already tick in prod" assumption turned out to be a local-run artifact. Lesson: probe third-party endpoints from the actual deployment egress, not your machine.

## A missing env var failed silently in prod (HO 227, Jun 10, 2026)

`FMP_API_KEY` was in local `.env` but never added to Vercel. The markets cron "worked" locally and failed in production with no error, just no data. Env parity is invisible until something quietly returns nothing.

## Route-level `revalidate` does nothing in Next.js 15 for dynamic pages (standing behavior, no fix date)

Exporting `revalidate` from a dynamic route is inert. Caching has to live at the query layer (`unstable_cache` + `revalidateTag`). Easy to set the route export, see no effect, and conclude caching is broken when it was never wired.

## Green build, 200 response, full payload, and an unstyled page (HO 212, Jun 9, 2026)

A drifted `.next` build served a stale CSS hash, so the page 404'd on `layout.css` and rendered completely unstyled while `tsc` passed, the route returned 200, and the JSON was all there. The tell was a 404 on the stylesheet asset, which is not where you'd think to look. `rm -rf .next` and restart fixes it.

## A running graveyard of dead data sources (external deaths OpenSecrets ~Apr 2025 · FMP v4 ~Aug 2025 · Stooq Jun 2026; all hit in CBT building HO 65 / 70 / 227, ~May–Jun 2026)

A surprising share of the dev was sources dying mid-flight: OpenSecrets' API shut down, FMP's `/api/v4/` congress-trading endpoint was deprecated, Stooq's CSV quote endpoint was retired (Stooq is effectively dead as a programmatic source). The pattern: free-tier third-party data is a moving target. "FMP has it" doesn't mean "FMP's free tier still has it at this path." Only `/stable/` endpoints have held up.

## Vercel's free tier keeps no logs past ~30 minutes (standing limit; cron_runs workaround HO 105, May 21, 2026)

You can't go back and read what a cron did an hour ago. All cron validation runs through a `cron_runs` table written to directly, because the logs are gone by the time you'd check them.

## Two race predicates that look interchangeable aren't (May 19, 2026)

`getRacesIndex` (inner-join on a rating existing, ~137 races) and `getMostCompetitiveRaces` (toss-ups only, ABS(score)≤1, ~61 races) answer different questions. Using one where the other belonged (treating either as "the competitive count") caused a bug. Worth a comment wherever a count gets reused.

## The planning copy lags the live repo (ongoing)

More than once, work was scoped against a frozen snapshot of the code and either no-op'd (the thing was already shipped) or nearly re-shipped something already rejected. The discipline that came out of it: trust a live grep of the actual repo, not a snapshot or a frozen handoff file.
