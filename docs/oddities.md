# CBT Oddities & Gotchas

Field notes on the non-obvious things that broke, or nearly broke, while building this. The kind of thing worth recounting when someone asks what was actually hard about it. Newest at the top; append as you go.

Dates are exact where I tracked them live, flagged `~` where approximate, and tagged with a handoff number (HO) where the precise calendar day is best read off git. `git log` the matching `docs/handoffs/` file to pin those down.

---

## A box taller than the thin tape strips spills onto the nav if dropped downward (HO 294, Jun 2026)

Once the markets-tape hover box was portaled (293), anchoring it below the whole two-strip tape block dropped it over the nav — the nav sits right under the tapes. The box (~80px, 3 lines) is taller than the two thin strips (~76px), so there's no clean "below" that clears both the sibling strip and the nav. The anchor that works for items on either strip: pin the box's BOTTOM ~at the ticker block's bottom and grow it UPWARD (`translateY(-100%)`) so it overlays the strips, never the nav. Lesson: when a popover is taller than its anchor row, "drop below" has nowhere to land — overlay upward instead.

## A hover box nested in a strip is painted over by a sibling strip at the same z-index (HO 293, Jun 2026)

The tape hover box was a CSS-`:hover` span inside `.markets-tape-item`, inside the MARKETS strip (`.markets-tape`, `z-index:30`). The ODDS strip is a sibling `.markets-tape` (also `z-30`), later in the DOM, so it paints over the entire MARKETS subtree — including the box's `z-60`. The box dropped below the item onto the ODDS strip and hid behind it; only the sliver below the strip (the bottom meta line) showed, which is why the screenshot had the name + hook missing. A child's high z-index can't escape its strip's stacking context. Fix: portal the box to `<body>` + `position:fixed` + high z-index + opaque bg, leaving the strip's stacking context entirely.

## Some Kalshi markets carry no date — `parseTickerDate` needs a year-only fallback (HO 290, Jun 2026)

`fetchKalshi` picks the soonest open event in a series by date (strike_date / close_time / a month parsed from the ticker). The recession series `KXRECSSNBER` events (`-26`, `-27`) carry NONE of those — no strike_date, no close_time, and a bare `-26` year with no month — so `parseTickerDate` returned null and the soonest-event selection found nothing, failing the symbol. Fix: a year-only fallback (`-26` → `2026-12-31`). Dated markets (shutdown `-26OCT01`, fed via strike_date) resolve first, so they're unaffected. Verify a new Kalshi series' event shape before assuming the existing date logic covers it.

## Kalshi rate-limits a parallel symbol burst (429) (HO 290, Jun 2026)

The markets cron fetches every same-source symbol in parallel (`Promise.all`), and each Kalshi symbol fires TWO calls (events + markets). With 2 Kalshi symbols (4 calls) it held; adding a 3rd (recession → 6 concurrent calls) tripped the public-API rate limit, failing 2 of 3 per run (a different 2 each time). Fix: retry-on-429/503 with a short jittered backoff inside the Kalshi fetch — the jitter spreads the concurrent symbols' retries so they don't re-collide. The race-odds cron sidesteps this by throttling 250ms between sequential calls; the markets cron is parallel, so it needs the retry.

## CPI/UNEMP don't show the market-CLOSED wash that intraday symbols do (HO 290, Jun 2026)

When US markets are closed, the MARKETS strip washes daily symbols to `--ticker-closed`. CPI/UNEMP (FRED monthly) sit on that same strip but stay in normal color — `itemState` returns `closed:false` for `cadence==='monthly'` regardless of strip kind. Correct: a monthly econ print isn't "closed for trading," so it shouldn't read dormant. Not a bug.

## `_`-prefixed App Router folders are private (non-routable) in Next.js (HO 288, Jun 2026)

A throwaway prod-egress FMP probe route at `app/api/_probe288/route.ts` 404'd live. Next.js treats any folder starting with `_` as a *private folder* — opted out of routing entirely. Renamed to `app/api/probe288/` and it routed. (Context: HO 288's egress probe needed the prod FMP key, which isn't in the preview scope, so the probe deployed to prod main and was reverted after capture.)

## The 281 header type bump moved the one-line threshold to ~1420px (HO 281, Jun 2026)

After bumping the desktop masthead title to 26px / nav to 16px, the header's single-line threshold rose to ~1420px, so a 1366px laptop reflows the counts readout + nav to a clean 2nd line. Acceptable — it wraps, doesn't clip. The only clean lever if 1366 density ever matters is trimming the counts-readout copy.

## B4 tabbed box: RACES anchors height, HEARINGS overlays absolute (HO 282, Jun 2026)

The v2 HEARINGS|RACES tabbed box keeps RACES in normal flow as the height anchor and overlays HEARINGS absolutely on desktop (`display:none`-but-mounted on mobile, which preserves the per-browser MOVES-since-last-open badge state). Both tabs hold the box at 468px so switching doesn't jump. The mounted-but-hidden mobile branch is deliberate — unmounting would reset the badge.

## Kill lingering dev servers before a clean `.next` restart (HO 282, Jun 2026)

`npm run dev` zombies accumulate across sessions (a killed terminal doesn't always reap the node child), and a stale one can keep serving an old bundle — the HO 212 stale-CSS trap by another door. Before a fresh `rm -rf .next` + restart, `pkill -f "next dev"` (and any `next-server`) first, or you eyeball a stale render and chase a phantom.

## The gated-aggregate mis-plan class — "cold-start 500" was a misnomer (HO 277–279, Jun 2026)

Three live `/members`, `/dashboard-v2`, and `/bills` 500s in a row turned out to be one class, not three bugs. Adding a gating predicate (`summary IS NOT NULL`) to a fat-`bills` COUNT/aggregate makes the statless Turso planner (ANALYZE blocked) intermittently drop it onto a `MULTI-INDEX OR` over `idx_bills_is_ceremonial` (≈ a full table scan, since `(is_ceremonial=0 OR IS NULL)` matches ~every row). The tell that it isn't a cold-start problem: it's **slow even fully warm and wildly nondeterministic** — the dashboard-v2 corpus COUNT swung 112ms ↔ 18s+ across consecutive warm hits. When a roll lands past the 10s DB abort, `boundedFetch` aborts + retries (~20s) and the page 500s; when it lands fast, 200. That variance is exactly the "transient 500, 2 tries then 200" signature. Remedy: a partial/covering index matching the predicate (e.g. `… WHERE summary IS NOT NULL`) **plus** a gated `INDEXED BY` hint — the planner refuses the index unhinted every time. `getFeedStats` (the masthead count) was the sneaky one: it runs on every HeaderBar page, so the same mis-plan was an app-wide 500 risk, not route-local.

## Over-gating an INDEXED BY hint forces the wrong index on a sibling path (HO 279, Jun 2026)

A forced `INDEXED BY` doesn't just fix the path you aimed at — it overrides the planner for *every* query that shares the function, including ones where the planner was already choosing a better index. HO 279's first cut hinted `getFeedBills`'s COUNT onto `idx_bills_summary_feed` for every non-`cluster` path. The bare `/bills` COUNT went 44s → 30ms (the win), but `/bills?stage=` regressed: the planner had been picking `idx_bills_summary_stage` (a clean `SEARCH (stage=?)`, 152ms), and the blanket hint forced a full partial-index SCAN + per-row fetch instead (8.5s cold). The cold test caught it; the fix was narrowing the hint to the *bare* gated case. Lesson: gate a hint to the exact WHERE shape it helps, and **re-measure the filtered/sibling paths after adding it**, not just the target.

## A non-breaking space silently defeated the title-prefix strip (HO 273, Jun 2026)

Committee meeting titles render verbatim from Congress.gov, and Senate ones lead with procedural boilerplate ("Hearings to examine the nomination of…"). `cleanMeetingTitle` strips those lead-ins with literal-space regexes — except a chunk of titles carry a non-breaking space (U+00A0) or narrow NBSP (U+202F) between words (notably between "examine" and the topic), so `to examine ` never matched and the prefix passed through uncleaned. They look identical in a terminal; the tell is only in the bytes. Fix: normalize `[  ] → " "` before any prefix matching. The lesson generalizes — any prefix/substring match against text sourced from a government feed should NBSP-normalize first.

## FRED series lag, and the markets cron diffs a fresh value against a stale prior (HO 274, Jun 2026)

The tape showed WTI 84.65 with −10.89%. The price was the faithful FRED value; the change was a phantom. FRED's `DCOILWTICO` publishes with a multi-day lag (`last_updated` trailing `observation_end` by days), so on every daily tick before it caught up, the newest observation was a week-old 95.0 — and the cron's "prior session" diff (`market_date < new`) compared the fresh 84.65 against that week-stale row, printing a 7-day move as if it were one session (the real intervening sessions 88.62/91.58/93.68/91.90 were never captured). The single-session move was actually −4.5%. Assume the other FRED rate/commodity series lag the same way. The render guard (drop the arrow + change on any daily move beyond ±8%, keep the real price) masks the egregious ones; the real fix — capture the intervening rows or handle the lag in the cron diff — is deferred (see backlog WATCH).

## Battlefield marker and race-card odds can point opposite ways for the same seat (HO 274, Jun 2026)

On `/dashboard-v2`, the battlefield marker's POSITION is the rater-consensus lean (rating-based), while the race card's Kalshi/Polymarket cells are market-based. For ME-SEN the markers sit toward R (ratings call it a Toss-up leaning the incumbent's way) while both markets favor D — so the two surfaces legitimately disagree. The marker COLOR is the incumbent/holder party (matches the card dot), only the position diverges. Expected, not a bug — don't "fix" it by forcing one onto the other; they answer different questions (where forecasters put it vs. where money is).

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
