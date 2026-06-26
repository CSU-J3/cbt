# CBT Oddities & Gotchas

Field notes on the non-obvious things that broke, or nearly broke, while building this. The kind of thing worth recounting when someone asks what was actually hard about it. Newest at the top; append as you go.

Dates are exact where I tracked them live, flagged `~` where approximate, and tagged with a handoff number (HO) where the precise calendar day is best read off git. `git log` the matching `docs/handoffs/` file to pin those down.

---

## A report's outcome-verb color is render-only — it CANNOT live in `content_md` (HO 360, Jun 2026)

The weekly report is one pure-markdown string (`content_md`), and the web render (`components/ReportMarkdown.tsx`) and the `.md` download are meant to be identical — with ONE deliberate exception. `ReportMarkdown` colors floor-vote outcome verbs by **exact-text match** on the bolded token (`PASSED`/`CONFIRMED` → `--stage-enacted`, `ADVANCED` → `--stage-floor`, `FAILED`/`BLOCKED`/`REJECTED` → `--party-republican`; every other `<strong>` stays `--text-secondary`). This color is **render-layer only** — the stored markdown carries just `**FAILED**`, no color/HTML — so a future "make the `.md` match the web" instinct that tries to push the color into `content_md` **can't** (markdown has no color), and shouldn't: the `.md` is plain-bold by design, the web color is the **single** intended divergence. The mechanism is an exact-token map keyed on the strong node's text (not a class or a wrapper element), which is what keeps a bolded prose word from false-matching — and the same rule could later re-color the HO 352 stage-movements ladder's stage labels (banked). This is the report's one deliberate web-vs-file gap; sits beside the HO 352 prose-undercount lesson below.

## The report's section lead miscounts off a sample — feed it the TRUE counts + full named list (HO 352, Jun 2026)

When generating a section's prose lead (stage movements, floor votes), feed the prompt the **true structured counts plus the full named list**, never a sample or a truncated subset. The LLM section lead counts off whatever it is shown, so handing it a sampled list produces an undercounted "N bills advanced" in the prose that then contradicts the section's own structured header (assembly owns the counts — they come from the data; the prose only narrates significance). Same family as the HO 112 no-LLM-invented-counts rule, reached from the other side: don't let a sampled input *become* the count.

## A CASE-based `ORDER BY` defeated the date-index short-circuit — 73s cold `/stale` (HO 350, fix `339f8fc`, Jun 2026)

The stage-led `/stale` base (HO 350) sorts the default past-committee group in legislative-stage order (a `CASE stage WHEN … END DESC`) then furthest-action-first. The ship build forced `idx_bills_latest_action` on that no-stage group — but a CASE / computed `ORDER BY` can't ride a date index for its *primary* key, so the planner scanned the whole `latest_action_date < cutoff` range (~most of the corpus) into a temp b-tree to sort it: **73,492ms**, tripping the 10s `boundedFetch` abort → cold 500. Fix (`339f8fc`): split index + sort by whether a SINGLE stage is picked. Single-stage views (incl. STAGE → COMMITTEE) drop the now-degenerate CASE (all rows share one stage) and order by `latest_action_date ASC` forced onto the selective `idx_bills_latest_action` — the index PROVIDES the order, so the LIMIT short-circuits after 50 (**43ms** even on the 14.8k committee backlog). The default past-committee group instead drives off the selective `idx_bills_summary_stage (stage, is_ceremonial)` to seek the ~845 group rows, then a temp b-tree sorts that small set (~1.6s). **Generalized lesson: a CASE / computed `ORDER BY` can defeat an index short-circuit — for a single-value-filtered view, drop the CASE and let the selective index carry the sort.** Same statless-planner family as the gated-aggregate / cluster row-fetch entries below.

## A `GROUP BY` / `json_each` added to a hinted WHERE can re-plan — re-EXPLAIN after (HO 364/365, Jun 2026)

Same statless-planner family as the CASE-sort entry above and the gated-aggregate / cluster row-fetch entries below. A query that plans onto a selective index as a **bare** WHERE can shift back to a `MULTI-INDEX OR` once you add a `GROUP BY` or a `json_each` join on top — the plan is not stable across that change. The B5 ladder / new-bills breakdown queries validated standalone at ~225ms / ~150ms in the HO 364 probe, but the `INDEXED BY` hint (`idx_bills_stage_changed_at` / `idx_bills_introduced_date`) had to ride the **grouped** form, not just the bare query. Verified pre-ship (HO 365): the ladder EXPLAINs `SEARCH … idx_bills_stage_changed_at` (717ms cold, NOT a MULTI-INDEX OR), new-bills chamber 75ms / topics 28ms. **Lesson: re-run `EXPLAIN QUERY PLAN` after adding `GROUP BY` or `json_each` to a previously-hinted query — the plan can change, and the hint must be on the final grouped shape.**

## The staging index is shared across parallel sessions on one tree — `git add` then commit is racy (HO 350 arc, Jun 2026)

Corey runs parallel agents on ONE shared CBT working tree, and `git add` stages into the repo's single shared index. So between your `git add` and your `git commit`, another session's commit can sweep up your staged files (or yours theirs) — it nearly cost HO 350 this arc. **Commit by explicit pathspec (`git commit <files>`) to bypass the shared index entirely**, and re-check HEAD (`git log --oneline`) before push to confirm you shipped exactly what you staged (then `npm run verify:deploy` your own SHA). Never a bare `git add -A` / `git add .` on this tree. (Mirrors the `concurrent-session git race` memory.)

## `USING INDEX` ≠ `USING COVERING INDEX` — a clean-looking seek can row-fetch most of the corpus (HO 340, Jun 2026)

`/patterns` 500'd on `getUnmatchedClusterCount`: `COUNT(*) FROM bills WHERE cluster_id IS NULL AND (is_ceremonial = 0 OR IS NULL)`. EXPLAIN said `SEARCH bills USING INDEX idx_bills_cluster_id (cluster_id=?)` — which reads like a tidy point lookup, and is exactly why the HO 332 audit cleared it. Two traps in one: (1) SQLite renders `cluster_id IS NULL` as `(cluster_id=?)` (NULL bound as a param), so a **low-selectivity** predicate is indistinguishable in the plan from a selective one — and `cluster_id IS NULL` matches **15,117 of 16,538** rows (most bills are unclustered); (2) `idx_bills_cluster_id` is `(cluster_id)` only, so `is_ceremonial` is **row-fetched** for all 15k rows → ~20s, past the abort, never caches → permanent 500. The tell is **`USING INDEX` vs `USING COVERING INDEX`**: only COVERING is index-only. A plain `USING INDEX` in an *unbounded aggregate* (no LIMIT to cap the row-fetch) over a wide predicate is the trap. Fix: a covering index that carries the filtered/aggregated columns — `idx_bills_cluster_agg (cluster_id, is_ceremonial, stage)`, forced `INDEXED BY`, flipped both cluster queries to `USING COVERING INDEX` (20s/4.7s → ~35ms). **EXPLAIN alone can't price this — only timing can.** The `cold-start-audit-332.ts` probe was hardened to WARN this shape and resolve it by timing (`TIME_WARN=1`), which immediately caught two more latent >25s queries (`getWatchlistBills` drive-order, dead `getSponsorStates`). Third sighting of the row-fetch blindspot after the /search LIKE; lesson generalized: a clean plan ≠ a fast query; an unbounded aggregate must be COVERING.

## A leading-`%` LIKE over a fat text column full-scans the corpus — no index saves it; use FTS5 (HO 335/336, Jun 2026)

`/search?q=` 500'd on common terms (`tax`) warm AND cold, every tab. The cause wasn't a misplan — the plan read fine (a single index SCAN after HO 335's hint). It was the LIKE: `LOWER(title)/LOWER(summary) LIKE '%term%'` can't use ANY index (a leading wildcard isn't a prefix), so it full-scans and reads the (large) summary text of all 16k rows — >10s, past the abort. The HO 332 EXPLAIN audit *passed* this query because **EXPLAIN prices the plan, not the runtime scan** — a full-corpus scan has a clean-looking plan. Lesson 1: **never full-text-search a `bills` text column with `LIKE` — use the `bills_fts` FTS5 index** (HO 336; `MATCH` + `bm25`). Lesson 2 (audit refinement): a plan-only audit is blind to leading-`%` LIKE and unbounded aggregates; those need a runtime timing check.

Two FTS5 gotchas hit while building it (HO 336), both worth not relearning:
- **Don't index `id` in the FTS.** Bill-id tokens (`119`, `hr`, the number) appear in ~every id, so a prefix term like `1*` or `119*` expands to ~the whole index → a `119-hr-1` search 20s-aborted. Index only the prose columns (`title/summary/sponsor_name`). Short query tokens (len 1-2) match exactly, not as prefixes, for the same expansion reason.
- **Don't populate an external-content FTS with a one-shot `INSERT INTO bills_fts(bills_fts) VALUES('rebuild')`.** Reindexing 16k docs is one long statement; the 10s `boundedFetch` (HO 238) aborts it mid-flight and the index lands `SQLITE_CORRUPT` (MATCH then returns 0 or errors). Populate in **small rowid chunks** (500), each well under the bound. And check population with an existence probe (`SELECT 1 FROM bills_fts LIMIT 1`), NOT `SELECT COUNT(*) FROM bills_fts` — a bare fts count iterates the whole index and can itself blow the bound.

The same LIKE 500 also hit `/bills?q=` (the inline feed filter, `buildFeedWhere`); HO 338 wired that path to `bills_fts` too. Note the FTS-vs-sort-index conflict it exposed: `getFeedBills` carries HO 335's forced sort-index hint, but an FTS `MATCH` must drive from `bills_fts` — you can't force the sort index AND drive from FTS, so the query **branches on `q`** (q-present = FTS drive, no hint; q-absent = HO 335 sort-walk). Forcing the sort hint onto the q path silently re-breaks it back to a scan.

## An `OR sponsor_name` fallback on a `bills` query walks the whole fat table (HO 329/331, Jun 2026)

The member-expand `?expanded=` path cold-started a 500. Cause: three sponsor helpers filtered `(sponsor_bioguide_id = ? OR sponsor_name = ?)`. `sponsor_bioguide_id` is indexed; **`sponsor_name` is not** — and SQLite can't do an OR-index-union unless *both* branches are indexed, so the planner fell to a MULTI-INDEX OR over `idx_bills_is_ceremonial` (≈every non-ceremonial row of the 16.5k-row table). Warm ~200ms; cold the HO 277 plan that swings to 18s+ → past the 10s `DB_REQUEST_TIMEOUT_MS` abort → 500. The kicker: the `OR sponsor_name` branch was **provably dead** — the sole caller passes a `bioguide_id`, which never equals a `sponsor_name`, so it matched nothing while wrecking the plan. Fix (HO 331): drop the dead branch, go `sponsor_bioguide_id = ?` only, and **force** the existing covering index (`INDEXED BY idx_bills_sponsor_agg` / `idx_bills_sponsor_topics` — the statless Turso planner won't pick it unhinted). EXPLAIN flipped all three to covering-index point lookups. **Lesson: never add an `OR <unindexed_col>` to a `bills` query** — one unindexed disjunct silently converts a point lookup into a full-table walk that only bites cold. Fourth sighting of this misplan class in one session; probe `scripts/diagnostic/member-expand-329.ts`.

## The `/members` rail shows UPCOMING HEARINGS, not LIVE NOW — the mock can't be built honestly (HO 328, Jun 2026)

The HO 328 design mock (`docs/design/members-committees-live.html`) shows a "LIVE NOW" rail group — committees *in session this minute*. Prod ships **UPCOMING HEARINGS** instead. This is intentional, not drift: the schema has **no hearing end-time / in-progress signal** (`committee_meetings` carries a start `meetingDate` + a raw `meetingStatus`, but no "live now" flag), and the page is **daily-cached**, so "in session now" can't be derived honestly at request time. UPCOMING (real scheduled starts, `getUpcomingMeetings({days:7})`, soonest-per-committee) is the honest surface. A future reader comparing the LIVE NOW mock to prod should know the swap was a deliberate honesty call. (Same family as the hearings ● LIVE badge that's never been exercised against a real streaming meeting — roadmap "Owed eyeball.")

## `MemberTopicBar`'s bar length is dual-scale — same width means two different things (HO 328)

The per-member topic-mix bar on `/members` scales its total length to `pageMax`, which is **the global filtered max on the full ranked list** but **the roster max when a committee is scoped** (`?committee=`). So a bar that fills, say, 60% of the row means "60% of the busiest member in Congress" unscoped, but "60% of the busiest member on THIS committee" scoped — the same rendered width encodes a different denominator in the two states. Intentional (a scoped roster of 10 members would otherwise render as a row of near-empty stubs against the global max), but worth knowing before reading absolute volume off the bar across a scope change.

## GitHub Actions scheduled crons are best-effort — they silently drop most slots (HO 313/314, Jun 2026)

The markets tape froze for ~1.7 days and the leading theory was a dead data source. It wasn't: every source ticked fine when the cron ran. The cron just wasn't running. `markets-tick` (`0,30 13-21 * * 1-5` = 18 weekday slots) was delivering only **~3–5 (~20%)** of them on a good day, firing hours late (a 21:00Z slot landed 23:14Z), and on some weekdays **zero** times — workflow files unchanged + `state: active`, repo public (Actions free/unlimited), so it's purely GitHub's scheduler dropping the events. The control that nailed it: `cron_runs` showed Vercel's declared crons hitting their slots reliably (8+ daily) while the GitHub ones went dark. Lesson: **don't put a freshness-critical pipeline on a GitHub Actions schedule.** Back it with a reliable trigger (HO 314: a Vercel daily cron floor at 21:30 UTC). `gh run list --workflow=<f>` is the source of truth for whether a scheduled Action actually fired.

## Vercel's Data Cache persists across deployments — a redeploy does NOT cold `unstable_cache` (HO 312, Jun 2026)

Chased a "reports index is stale, missing the June 8 report" bug that had already self-resolved. Two things to internalize: (1) `unstable_cache` entries live in Vercel's **Data Cache, which survives redeploys** — shipping a fix does not flush a stale cached query; you need an explicit `revalidateTag`, the entry's TTL to expire, or the next cron that revalidates. (2) To surface a backfilled row on demand there's an affordance: `POST /api/revalidate?tag=<tag>` (Bearer `CRON_SECRET`, tags allow-listed). Don't assume "I redeployed, so the cache is fresh."

## The HO 285 report catch-up absorbs `/api/sync` morning soft-timeouts — a report can land a day late with no bug (HO 312, Jun 2026)

The June 8 report was "missing from the index" because it simply **hadn't been generated yet** — not a cache or predicate fault. The daily `/api/sync` catch-up (HO 285) regenerates the most-recent missing week, but the Jun 19 and Jun 20 *morning* sync runs **soft-timed-out** (the heavy-cron Turso-cold-stall / slow-Gemini family), so the gen didn't complete. It landed on the next successful run (Jun 20 16:57) and that run's `revalidateTag("reports")` flushed the index immediately. So the safety net worked exactly as designed — "retried daily until it lands" — just a day slower than the observer expected. Before diagnosing a "stale report" as a cache/predicate bug, check whether the row even exists yet and when `/api/sync` last completed without a timeout. (Both HO 312 hypotheses — catch-up skips revalidate, index has a status predicate — were refuted by the code: the catch-up path *does* revalidate at `app/api/sync/route.ts`, and the index query has no WHERE filter.)

## Feed-style queries need the full sponsor enrichment or the sponsor card degrades (HO 300, Jun 2026)

The v2 feed-row sponsor hover card reads `depiction_url` / `first_name` / `last_name` / `district` / `cosponsor_count`. `getFeedBills` already projected those (the `SPONSOR_ENRICH` select+join), but the OTHER feed-shaped queries — `getStageChanges` / `getStaleBills` / `getNewBillsThisWeek`, which back the v2 MOVERS / TOP STALLS / NEW THIS WEEK tabs — did not. Without the enrichment the card silently degrades: raw `Last, First` name, wrong district, initials instead of the photo, no cosponsors. Fix is a JOIN-projection add (the same `SPONSOR_ENRICH_SELECT`/`JOIN`), not a plan change, so the `INDEXED BY` hints stay untouched. Lesson: any query that feeds a row component must carry that component's FULL column dependency, or the row degrades without erroring.

## A bare `fr` grid track won't shrink — ellipsis is inert without `minmax(0, …)` (HO 297, Jun 2026)

A `fr` grid column defaults to `min-width: auto`, which means it refuses to shrink below its content's intrinsic width — so a long unbreakable title in an `1fr` track blows the track wide instead of ellipsizing, and the `text-overflow: ellipsis` you set never fires (the box never gets narrow enough to overflow). Fix: `minmax(0, 1fr)` (or `minmax(0, auto)`) to let the track shrink below content. The tell is "my ellipsis does nothing" on a grid child — it's the track, not the text rule.

## `scripts/**` is in tsconfig — a throwaway probe that doesn't typecheck fails the Vercel build (HO 297, Jun 2026)

`scripts/` is inside the `tsconfig.json` include, so `tsc` (and the Vercel build's typecheck) compiles every diagnostic/probe script — even ones that never run in prod and exist only to capture a number. A throwaway probe with a type error reds the whole deploy. Keep probe scripts compiling (or delete them before pushing). The build doesn't care that the script is "just a throwaway."

## Backticks in a commit message trigger shell command substitution (HO 297, Jun 2026)

Passing `git commit -m "...\`getFeedBills\`..."` through a shell runs the backticked text as a command (substitution) and mangles the message — or errors. Commit via a message FILE (`git commit -F msgfile` / a heredoc) when the message contains backticks (which CBT's code-referencing messages always do). The bash tool's commit guidance bans backtick `git commit -m` for exactly this reason.

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

## Kill lingering dev servers before a clean `.next` restart (HO 282, reaffirmed HO 300, Jun 2026)

`npm run dev` zombies accumulate across sessions (a killed terminal doesn't always reap the node child), and a stale one can keep serving an old bundle — the HO 212 stale-CSS trap by another door. Before a fresh `rm -rf .next` + restart, `pkill -f "next dev"` (and any `next-server`) first, or you eyeball a stale render and chase a phantom. **HO 300 recurrence + nuance:** an over-broad `pkill node` (vs the scoped `pkill -f "next dev"`) is its own trap — on Windows/Git-Bash it can leave a half-killed process **holding the port**, so the next `npm run dev` binds 3001+ and you eyeball the wrong server. Clean with `taskkill` (`taskkill //F //IM node.exe` when nothing else needs node) and verify the restart is actually on a fresh server + the expected port.

## The gated-aggregate mis-plan class — "cold-start 500" was a misnomer (HO 277–279, Jun 2026)

Three live `/members`, `/dashboard-v2`, and `/bills` 500s in a row turned out to be one class, not three bugs. Adding a gating predicate (`summary IS NOT NULL`) to a fat-`bills` COUNT/aggregate makes the statless Turso planner (ANALYZE blocked) intermittently drop it onto a `MULTI-INDEX OR` over `idx_bills_is_ceremonial` (≈ a full table scan, since `(is_ceremonial=0 OR IS NULL)` matches ~every row). The tell that it isn't a cold-start problem: it's **slow even fully warm and wildly nondeterministic** — the dashboard-v2 corpus COUNT swung 112ms ↔ 18s+ across consecutive warm hits. When a roll lands past the 10s DB abort, `boundedFetch` aborts + retries (~20s) and the page 500s; when it lands fast, 200. That variance is exactly the "transient 500, 2 tries then 200" signature. Remedy: a partial/covering index matching the predicate (e.g. `… WHERE summary IS NOT NULL`) **plus** a gated `INDEXED BY` hint — the planner refuses the index unhinted every time. `getFeedStats` (the masthead count) was the sneaky one: it ran on every HeaderBar page, so the same mis-plan was an app-wide 500 risk, not route-local. *(HO 326 note: `HeaderBar` no longer calls `getFeedStats` — the inner-page count was removed; the app-wide exposure now rides `getCorpusStats(true)`, the HO 325 sync-subhead source, which shares the same `idx_bills_summary_feed` index, so the lesson holds.)*

## Over-gating an INDEXED BY hint forces the wrong index on a sibling path (HO 279, Jun 2026)

A forced `INDEXED BY` doesn't just fix the path you aimed at — it overrides the planner for *every* query that shares the function, including ones where the planner was already choosing a better index. HO 279's first cut hinted `getFeedBills`'s COUNT onto `idx_bills_summary_feed` for every non-`cluster` path. The bare `/bills` COUNT went 44s → 30ms (the win), but `/bills?stage=` regressed: the planner had been picking `idx_bills_summary_stage` (a clean `SEARCH (stage=?)`, 152ms), and the blanket hint forced a full partial-index SCAN + per-row fetch instead (8.5s cold). The cold test caught it; the fix was narrowing the hint to the *bare* gated case. Lesson: gate a hint to the exact WHERE shape it helps, and **re-measure the filtered/sibling paths after adding it**, not just the target.

## The drive-order trap: a news/search join drives from the 16k bills side, not the 227-row news side (HO 332/335, Jun 2026)

`news_mentions` is tiny (227 rows) and the bills table is fat (16.5k). A query like `FROM news_mentions m INNER JOIN bills b ON b.id = m.bill_id WHERE <m.published_at window> AND (b.is_ceremonial = 0 OR IS NULL)` *should* drive from `m` (227 rows, filtered further by the window) and join `bills` by PK. But the statless Turso planner (no ANALYZE) instead drove from **`bills` via `idx_bills_is_ceremonial`** — a MULTI-INDEX OR over ~every non-ceremonial row, ~16k join probes — because it has no row-count stats telling it `news_mentions` is the small side. Same cold-abort class as the gated-aggregate mis-plan, just reached through the join. The HO 332 audit caught it on `getNewsFeed`, `searchNews`, and the dead `getBreakingNews`; `getBreakingNewsForHome` was already immune because HO 241 had hinted it. **Fix (HO 335): force the small side as the driver** — `FROM news_mentions m INDEXED BY idx_news_mentions_published`. The plan flips to `SCAN m USING idx_news_mentions_published` + `SEARCH bills … (id=?)` PK. **Lesson: on a small⟗fat join, never trust the statless planner to pick the small driver — hint the small table's index** (and re-EXPLAIN; the win is invisible warm, fatal cold). Probe: `scripts/diagnostic/cold-start-audit-332.ts`.

**Same trap, `/watchlist` (HO 342 → absorbed into HO 356, Jun 2026).** `getWatchlistBills` joined `FROM bills b INNER JOIN watchlist w` and the statless planner drove from the 16k bills side (`SCAN bills`), SEARCHing the tiny watchlist per bill — ~27s cold, and (being `unstable_cache`d) the timeout never populated → permanent 500. The HO 342 fix was written but **never shipped** (HO 354 found the doc untracked, no commit, the tree still bills-first). HO 356 (per-user watchlist) rewrote the same query and folded the fix in: drive `FROM watchlist w INDEXED BY sqlite_autoindex_watchlist_1 INNER JOIN bills b ON b.id = w.bill_id WHERE w.user_id = ?` — the composite PK leads on `user_id`, so the lookup is `USING COVERING INDEX` and bills join by PK (`sqlite_autoindex_bills_1 (id=?)`). The helper is also UNCACHED now, which is its own standing trap worth stating plainly: **all three watchlist read helpers — `getWatchlistBills`, `getWatchedBillIds`, `isInWatchlist` — CANNOT be `unstable_cache`-wrapped once they read `auth()` internally.** `unstable_cache` has no request-scoped cookie access (so `auth()` resolves wrong/empty inside it), and a single global cache key would **bleed one user's stars to another**. Uncached is required here, not a perf regression to "fix" — and as a bonus the cache-masks-the-timeout half of the drive-order trap above is gone too (the timeout can no longer hide behind a populated cache). The write helpers stay the asymmetric counterpart: they take an explicit `userId` and never read the session.

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

**Mechanism facts lag worst (HO 316–318).** The most expensive version isn't a stale *feature* claim — it's a stale **mechanism** claim: *what's stored* and *how state works*. The HO 317 handoff carried three — "cosponsors are skipped," "schema has state, not district," "/bills uses `?expanded=` URL state" — and each cost a correction round mid-build. A 30-second live check disproved all three: `bills.cosponsor_count` is stored (in `SPONSOR_ENRICH_SELECT`), district comes from the `SPONSOR_ENRICH` members-join (`msp.district`), and `/bills` expand is React `useState` via `useSingleOpenPanel` (no URL param). Notably, **SKILL was already correct on all three** — the staleness was in the *handoff*, not the doc — so "fix the stale SKILL premises" itself needs verifying before you trust it. Before scoping any panel/query/state work: grep the schema (`scripts/migrate.ts` / the `SELECT` lists) and the state model (the actual hook/component), don't trust the prose. Verify the premise that says a premise is stale, too.

**A window/period is a live-code fact too, not a mock inference (HO 365).** Same lesson, one more axis: a design mock showing `WEEK OF JUN 22` with a partial-looking current bar does **not** tell you the underlying window. The live `WeeklyBand` is **trailing-7-day** (`[now-7d, now)` in the helpers), but the HO 365 handoff assumed **calendar week-to-date** from the mock — which would read ▼ every day until Sunday (partial-vs-full), a daily false "down" signal. Code caught the contradiction in plan mode before build, but it cost a cycle. When a handoff asserts a window/period, confirm it against the live helper (`getWeeklyBandPriorWeek` etc.) before building, don't take the mock's visual as the period.
