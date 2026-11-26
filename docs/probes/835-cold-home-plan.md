# HO 835: a cold `/`, reader by reader, and the plan for HO 836

**Base:** `main` at `710b20a`. A read-only probe: no product file changed, and no store write was made. HO 834's probe (`docs/probes/834-home-store-requests.md`) counted what `/` asks the store. This one says which reader asks what, what a cold or stale load costs the visitor, and which fixes earn a build.

**The runs, MST (UTC beside), Nov 25, 2026:**

| step | MST | UTC (Nov 26) |
|---|---|---|
| § 1.A, a cold load each of `/`, `/electoral` and `/welcome` | 5:52:08 to 5:52:39 PM | 00:52:08 to 00:52:39 |
| § 1.B, a stale `/`, entries aged 2 h and 25 h | 6:06:50 to 6:07:17 PM | 01:06:50 to 01:07:17 |
| § 1.C, Production through the Vercel MCP | about 5:50 to 6:40 PM | about 00:50 to 01:40 |
| § 1.D, the C1 proof (and its re-runs) | 6:11:52 PM (re-runs to 7:29:15) | 01:11:52 (re-runs to 02:29:15) |
| § 1.D, the C2 proof (and its re-runs) | by 6:14:03 PM (to 6:18:41) | by 01:14:03 (to 01:18:41) |

**The guards:**
- **The local server read prod's store behind** `scripts/diagnostic/home-cold-plan-835-preload.cjs`, a copy of HO 834's with full SQL and per-request timing added.
  - HO 824's read rules applied to every statement: it must start `SELECT`, `WITH` or `EXPLAIN` and carry no write word.
  - Only read-only batches passed, and `executeMultiple` was refused.
  - Five controls ran at each load.
  - **Every run: all statements passed as reads, none refused.**
- **The base URL had to be `localhost`.** Nothing was POSTed: no cron, no `/api/sync`, no `/api/revalidate`.
- **The proofs called the shipped readers uncached,** by import, under the same guard.
- **Production was read through the Vercel MCP only,** with no Vercel CLI.
- **Costs are priced by statements and round trips.** Times are local or Production readings, named as such.

**Instruments:**
- **The scripts:** `scripts/diagnostic/home-cold-plan-835.ts` (the driver), `-preload.cjs`, `-attribute.mjs`, `race-pool-batch-835.ts` (C1) and `absence-card-batch-835.ts` (C2).
- **Raw output:** `docs/handoffs/835-artifacts/` (gitignored).

## The plan: HO 836's proposed scope

**What the readings say:**
- **A cold `/`** asks the store 203 times (217 statements). It sends its first byte after 3.5 s locally.
- **Two N+1s and one gate make most of that:**
  - the race pool: 61 statements in 31 serial round trips;
  - the absence band's member cards: 60 statements, 12 members × 5 readers;
  - and the band holds the page's `Promise.all`, so nothing below it starts until 1,577 ms.
- **A stale `/`** (§ 1.B) still costs the store: 124 requests at 2 h idle (62 of them after the response) and 201 at 25 h (114 after), against a cold load's 203. Locally, how much of its wait is the stale entries can't be said.
  - **In Production, the late crawl's first loads after idle waited** 0.97 to 2.3 s (C.1).
  - **Outside crawls,** 17 renders in 7¼ days waited over 2 s, about 2.3 a day (16 slots), a median of 2.9 s (C.2).
  - The metrics can't split a cold function instance from stale entries.
- **Concurrent loads outside crawls** reach 3 at most (C.3).

**Proposed for HO 836, in order** (the chat rules):
1. **C1, batch the race pool.**
   - **The change:** one `race_ratings … IN (…)` read and one `races LEFT JOIN members … IN (…)` read, assembled in the pool's order, with a `rowid` tiebreak added to the ratings order.
   - **Close instrument:**
     - § 1.A's cold count: `/` 203 → about 145 requests; `/electoral` 81 → about 23; `/welcome` 52 → about 30.
     - the pool's 61 → 3 statements, and 31 → 2 serial round trips;
     - `race-pool-batch-835.ts` re-run green against the built function.
2. **C2, a band-only card read,** with C8, the band's two chamber reads run together.
   - **The change:** three `IN (…)` reads over the band's members give `stats.total`, the first three bills and the committee names. `getMemberCardExpansion` stays as it is for `/members`. Add a tiebreak to the bills order.
   - **Close instrument:**
     - § 1.A's cold count: `/` down a further 57, to about 88;
     - § 1.B.1's idle count: 124 → about 67;
     - the band's end on A's timeline (1,577 ms today);
     - `absence-card-batch-835.ts` re-run green once HO 836 re-points it. Its shipped-path gates describe today's band (five readers × 12 members), so they fail by design once C2 ships.
3. **C3, unchain the races block,** with C9, `getPacIeSpending`'s three seat reads in one wave.
   - **The change,** by claim 7's waves:
     - **with the pool:** `getRacesIndex`, `getIncumbentQualifiers`, `getRaceResults`, `getPacIeSpending` and `getDashboardPrimaries`;
     - **then, on the featured ids:** `getRecentRaceMoves` and `getRace` × 6;
     - **then their news.**
   - **Close instrument:** A's timeline: the races block's wall (1,761 ms today) and its chain's round trips (40 today, about 4 after C1 and C3); C.1's first-load duration on Production after the next idle spell.

**For Corey, not proposed as builds:**
- **C5:** keys that survive a deploy.
- **C6:** longer revalidates.
  - Under the handoff's definition no hourly reader is tag-complete. The nearest, `getMemberCommittees`, passes only with the committees cron's HO 756 throw set aside, and `/` bypasses it anyway.
  - Counting scheduled writers only, 19 readers on `/` would save about 22 to 36 requests per idle hour. Whether that saves any wait can't be said.
- **C7:** keep `/` warm.
  - An idle `/` makes the first visitor wait.
  - The handoff's rule asks for a *stale* one, and neither B nor C.1 can split the stale entries from a cold function instance or a fresh server's first request.
  - A scheduled render would answer both, at a store cost every hour.
- **C11:** don't gate the page on the band.

**Skipped:**
- **C4:** concurrent loads outside crawls are 3 at most. One pair waited about 9 s each, with a cause the metrics can't read.
- **C10:** one reader read twice.

**After C1 to C3** (estimates, from A's counts and timeline): a cold `/` would ask about 88 requests in place of 203. Its longest chain would lose about 29 of the pool's round trips and about 5 of the band's.

## The candidates

A saving is measured where § 1 measured it, or written `~N (estimate)`. *Per idle hour* counts the store requests a stale refresh of `/` saves after an hour without a load, from § 1.B.1's 124. *The visitor's wait* is the cold load's (§ 1.A) unless named.

| # | candidate | cold requests saved | requests saved per idle hour | the visitor's wait saved | files it touches | other routes it reaches | risk | proposed verdict | evidence |
|---|---|---|---|---|---|---|---|---|---|
| C1 | batch the race pool: one ratings read and one races-and-incumbents read, `IN (…)` over the pool's ids | **58** on `/` (61 → 3); 58 on `/electoral`; 22 on `/welcome` (25 → 3) | 0: the pool is an 86400 reader, so it refreshes at most daily (58 then) | ~0.7 s (estimate): the pool's 31 serial round trips (982 ms of A's timeline) become 2. The proof's walls from the box were 987 → 273 ms | `lib/queries.ts` (`getMostCompetitiveRaces`, `:2930-3006`) | `/electoral` (the same entry, pool 30), `/welcome` (pool 12) | low. The ratings order has ties on `updated_at` in 13 of 30 races (S-TX-2026 a 3-way tie). The batched order matched by observation (SQLite's sort kept rowid order); add a `rowid` tiebreak so the order is defined | **build in 836** | proof `race-pool-batch-835.ts`: PASS for `(2026, 30)` and `(2026, 12)`, deep-equal and byte-equal JSON, controls ok, 0 refused (`proof-c1-final.log`, on the committed script); STEP 0 claim 5 |
| C2 | a band-only card read: three `IN (…)` reads over the band's members (total, first three bills, committee names) | **57** (the band 68 → 11) | **57**: the band is a 3600 reader, so it refreshes in every idle hour | ~0.15 to 0.2 s (estimate): 60 card reads under the store client's 20-in-flight cap (1,324 → 1,577 ms) become one wave of 3 | `lib/queries.ts` (`queryAbsenceWatch` `:5990-6241`, plus a band-only reader) | none: `getAbsenceWatch` is read on `/` only; `/members` keeps `getMemberCardExpansion` | low. The bills order (`latest_action_date DESC NULLS LAST`) has date ties in the first three for 7 of 12 members, matched by observation; add a tiebreak to both reads. Topics and affiliations (24 statements a load) stop being read for nothing | **build in 836, with C8** | proof `absence-card-batch-835.ts`: 12 of 12 PASS, deep-equal and byte-equal, negative controls ok, 0 refused (`proof-c2*.log`); STEP 0 claim 6 |
| C3 | unchain the races block, by claim 7's dependency waves. **Wave 1, with the pool:** `getRacesIndex`, `getIncumbentQualifiers`, `getRaceResults`, `getPacIeSpending` (2 trips with C9) and `getDashboardPrimaries`, plus `Battlefield`'s `getBattlefieldSeats` (and `getElectionResults`) if lifted out of the child. **Wave 2,** on the pool's featured ids: `getRecentRaceMoves` and `getRace` × 6. **Wave 3,** on `getRace`'s incumbent: `getRaceNews` × 6, plus `getRaceCandidates` × 6 as written (it can join wave 2 if the `:144` gate applies after) | 0 | 0 | ~0.3 to 0.7 s (estimate): by dependency the block is 3 waves (claim 7). The reads off the pool's path cost about 0.7 s in HO 834's load, about 0.3 to 0.6 s after C1 | `components/CompetitiveRacesBlock.tsx` (and `components/Battlefield.tsx` if its two reads lift into the wave) | none | low: reads that sit behind the `:89` and `:144` gates would run ahead of them, which costs one wasted read when the pool or a race is empty. No render changes | **build in 836, with C9** | STEP 0 claim 7 (`step0-835-c7.md`); A's timeline (the block's 40 round trips, 1,590 ms of its 1,761 ms wall) |
| C4 | share concurrent misses within one process | 0 on one load | 0 | 0 outside crawls | `lib/` (a request-coalescing layer) | every route | adds a layer for a case Production barely has | **skip** | C.3: the most renders of `/` in a 10-s slot outside a crawl is 3, all warm. The one concurrent pair outside a crawl that waited (Nov 19 10:05:20 PM MST, 8,850 and 9,472 ms, 13½ minutes after an idle load) has a cause the metrics can't read. HO 834's herd of 4 asked 4 × 13 = 52 only under a flush |
| C5 | keys that survive a deploy | ~0 on a load; at a deploy that re-keys, the re-keyed readers' misses (12 to 17 readers at HO 833's) | 0 | at a re-keying deploy only | `lib/queries.ts` (every `unstable_cache` call) or a move off `unstable_cache` | every route | high. `unstable_cache` always keys on the callback's text (`unstable-cache.js:58`, plus its arguments at `:85`). The only way around it inside `unstable_cache` is a bound callback, whose text is constant, with a version in `keyParts`. A forgotten version bump would serve a stale shape across a deploy | **Corey's fork** | STEP 0 claim 10 (`step0-835-c9-10.md`) |
| C6 | longer revalidates where the tags cover every writer | 0 | by the handoff's definition (every writer, scripts by hand included): **0**. The nearest is `getMemberCommittees`, which passes only with the committees cron's deliberate HO 756 throw set aside (it can write `committee_members` and skip its flush), and `/` bypasses its cache anyway. Counting scheduled writers only: **36** per stale refresh, **~22 (estimate)** per idle hour, over 19 readers | can't say. In B.1 these 19 readers' 36 refresh requests ran during the render (211 to 621 ms; first byte at 616 ms), and they held 11 to 15 of the store client's 20 in-flight slots from 292 to 500 ms | `lib/queries.ts` (the revalidate values) | every route reading those readers | the scripts run by hand don't flush, so a longer revalidate lengthens the staleness after one. Among scheduled writers: bill-rosters writes `bills.cosponsor_count` and deliberately doesn't flush `bills`; the committees cron flushes only `committees`; the primaries cron flushes nothing; `members` has no flusher at all (and isn't on `/api/revalidate`'s list) | **Corey's fork**: which writers may lag | `835-artifacts/c6-835.md` (36 readers, every writer named; skeptic-checked) |
| C7 | keep `/` warm with a scheduled render | 0 | adds about 124 requests per hourly render today (§ 1.B.1); about 67 after C1 and C2 | ~0.65 to 2.0 s (estimate) per first load after idle: C.1's first renders (970 to 2,314 ms) less the run's 316 ms warm median; ~2.6 s (estimate) at C.2's 2.9 s median outside crawls. That holds only if a scheduled render removes both causes | a cron route that fetches `/`, and `vercel.json` | none | neither B nor C.1 separates a stale-entry wait from a cold function instance or a fresh server's first request. A keep-warm render would answer both, at a store cost every hour, for about 2.3 slow renders a day | **Corey's fork**. The handoff's rule asks for a *stale* `/` making the visitor wait; the readings show an idle `/` waiting, cause unsplit (flagged) | B (can't say locally), C.1, C.2 |
| C8 | the band's chamber loop (`lib/queries.ts:6039`): two chambers, 3 serial reads each, run one after the other | 0 | 0 | ~0.3 s (estimate, claim 8): the two chambers don't depend on each other | `lib/queries.ts` | none | low | **build, with C2** | STEP 0 claim 8 (`step0-835-c8.md`) |
| C9 | `getPacIeSpending`'s four serial reads (`:2608`, then `:2649`, `:2663`, `:2677` on the first one's seat ids) | 0 | 0 | ~0.06 s (estimate): 4 trips become 2 | `lib/queries.ts` | `/electoral` (`app/electoral/page.tsx:116`), `/race/[id]` (`app/race/[id]/page.tsx:80`) | low | **build, with C3** | STEP 0 claim 7 (R6) |
| C10 | `getLatestMarketTicks` read twice per cold load (two `MarketsTape` renders miss at once) | 2 | 0 | ~0 | `components/DashboardV2Header.tsx` or a request-scoped `cache()` | none | low | **skip**: two statements | A's table |
| C11 | don't gate the page on the band: move `getAbsenceWatch` out of `app/page.tsx:140-152`'s `Promise.all` (its own async component, or the races block started first) | 0 | 0 | up to ~1.1 s (estimate) today: every component's first read waits until 1,640 ms, while the other page-level reads end by about 540 ms. Less after C2 and C8 shorten the band | `app/page.tsx` (and the band's component) | none | medium: it changes the page's structure and when parts of it arrive. `/` has no `Suspense` today | **Corey's fork** | A's timeline; STEP 0 claims 7 and 8 |

`getDashboardPrimaries` is the only uncached reader on `/`. Its 2 statements are what a warm load asks (§ 1.B.2b), and nothing here proposes caching it.

## A. Who asks what, cold

**The runs:**
- **Build:** `710b20a`, built secretless in a scratch worktree: no `.env`, the store and API variables unset, Node 25.5.0, 64 routes.
- **Server:** `next start` on `localhost:3935`, reading prod's store behind `scripts/diagnostic/home-cold-plan-835-preload.cjs`. Every load sent `Cookie: ct_seen=1`.
- **Each URL got a fresh server,** on a data cache emptied first. Emptied means `<worktree>/.next/cache/fetch-cache` removed: 0 files before `/`'s load, 115 before `/electoral`'s and 17 before `/welcome`'s. One load each, 5:52:08 to 5:52:39 PM MST Nov 25 (00:52:08 to 00:52:39 UTC Nov 26):

| URL | status | time to first byte | store requests | statements |
|---|---|---|---|---|
| `/` | 200 | **3,509 ms** | **203** | **217** |
| `/electoral` | 200 | 4,267 ms | 81 | 105 |
| `/welcome` | 200 | 1,668 ms | 52 | 56 |

**`/` matches HO 834 exactly:** 203 and 217, a difference of 0.

These cold runs used the preload before its one-line-per-page-request `req` line was added for § 1.B's stale mode. The read rules and the five controls were the same.

**The attribution:** `scripts/diagnostic/home-cold-plan-835-attribute.mjs` matched each statement to a source literal in `lib/`, `components/` and `app/`, using TypeScript's own parser. It then credited the statement to the cached reader that runs it, by following calls up to the nearest `unstable_cache`.
- **Every one of the 78 distinct statements matched a literal:** 77 as whole patterns, 1 by fixed pieces.
- **Readers:** 69 had one candidate reader. 3 had several, but `/` reaches only one. 6 were settled by reading the code: four `--resolve` flags, recorded with their evidence in `835-artifacts/probe-a/reader-table-home.md`.
- **No request mixes readers.**
- `/electoral`'s and `/welcome`'s per-reader tables are in `835-artifacts/probe-a/reader-table-electoral-welcome.md`.

**The table for `/`.** One row per reader, summing to the load's totals. *Re-keyed at HO 834* reads `y` where HO 834's `compare-keys-834.log` listed the callback as changed.

**HO 834's instrument has a hole:** its bracket walker loses its place at `searchReports`' callback (`lib/queries.ts:9302`). So the log's `CHANGED (no keyParts literal)` row pools 28 call sites that were never compared by name. A reader inside that span reads *can't say*.
- That makes HO 834's *12 of 42 re-keyed* a floor: 12 readers and 33 statements at least, 17 and 56 at most.
- HO 834's FF comparison is unaffected. The pooled row hashed the same in both builds, so nothing in it changed.

**The five card readers are nested and bypassed on `/`.** `getMemberAffiliations`, `getMemberCommittees`, `getSponsorRecentBills`, `getSponsorStats` and `getSponsorTopTopics` run inside `absenceWatchCached`'s callback, which bypasses their own caches (`unstable-cache.js:146-160`, STEP 0 claim 6).
- So their 60 statements run on every regeneration of the band (3600; `votes`, `palestine`).
- Expiring `bills`, `committees` or `members` doesn't refresh the band's copy.
- Their own revalidate and tags, shown in their rows, govern `/members` and the member page, not `/`.

| reader | statements per load | store requests | calls per load | revalidate | tags | who expires each tag, and when | tables read | re-keyed at HO 834 (y/n) |
|---|---|---|---|---|---|---|---|---|
| `getMostCompetitiveRaces` (`lib/queries.ts:2930`) | 61 | 61 | 1: the pool read once (`:2934`), then 2 reads per pool row (`:2954`-`:2964`) × 30 rows; called once, `CompetitiveRacesBlock.tsx:87` (POOL 30) | 86400 | `race-ratings` | `race-ratings`: no cron since HO 834; /api/sync-race-ratings by hand, and scripts/sync-race-ratings.ts posts it with `--flush`; POST | members, race_ratings, races | n |
| `getMemberAffiliations` (`lib/queries.ts:1407`) | 12 | 12 | 12: once per band member; `getMemberCardExpansion` (`:8127`, its five readers `:8131`-`:8137`) runs per member at `:6203` | 86400 | `members` | `members`: nothing expires it, and it is not on the POST list | affiliations | n |
| `getMemberCommittees` (key `member-committees`) (`lib/queries.ts:10522`) | 12 | 12 | 12: as above | 3600 | `committees` | `committees`: /api/cron/committees `5 */6` every run; not on the POST list | committee_members, committees | can't say: inside the log's `CHANGED (no keyParts literal)` row (note 10) |
| `getSponsorRecentBills` (`lib/queries.ts:7987`) | 12 | 12 | 12: as above | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills | y |
| `getSponsorStats` (`lib/queries.ts:8026`) | 12 | 12 | 12: as above | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills | n |
| `getSponsorTopTopics` (`lib/queries.ts:8065`) | 12 | 12 | 12: as above | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills | n |
| `absenceWatchCached` (key `getAbsenceWatch`) (`lib/queries.ts:6241`, called by `getAbsenceWatch` (`lib/queries.ts:6261`); callback `queryAbsenceWatch` `:5990`) | 8 | 8 | 1: roster 1 + 3 per chamber × 2 chambers (`:6039` loop) + scores 1, each awaited in turn; called once, `page.tsx:151` → `getAbsenceWatch` `:6261` | 3600 | `votes`, `palestine` | `votes`: /api/sync-votes `0 10` when either chamber's sync returned without throwing (`:75` tests the two stats objects, not their inserts); /api/cron/amendments `0 7` when Senate rows changed or House links were inserted; POST<br>`palestine`: POST only (by hand, after `sync:palestine`) | member_participation, member_votes, members, palestine_scorecard, votes | n |
| `getRace` (`lib/queries.ts:1934`) | 6 | 6 | 6: one per featured race, `CompetitiveRacesBlock.tsx:143` | 86400 | `races` | `races`: /api/cron/kalshi `15 */2` every run; /api/cron/race-challengers `30 12` every run; POST (scripts/sync-pac-ie.ts posts it) | races | n |
| `getRaceCandidates` (`lib/queries.ts:1969`) | 6 | 6 | 6: one per featured race, `CompetitiveRacesBlock.tsx:151` | 86400 | `races` | `races`: /api/cron/kalshi `15 */2` every run; /api/cron/race-challengers `30 12` every run; POST (scripts/sync-pac-ie.ts posts it) | race_candidates | n |
| `getRaceNews` (`lib/queries.ts:2841`) | 6 | 6 | 6: one per featured race with an incumbent (all six), `CompetitiveRacesBlock.tsx:153` | 3600 | `race-news` | `race-news`: /api/cron/news `*/30` every run; POST | observation_entities, observations | n |
| `getRaceResults` (`lib/queries.ts:2298`) | 5 | 1 | 1: one batch of 5; `CompetitiveRacesBlock.tsx:106` (past election day) | 3600 | `general-ballot`, `races` | `general-ballot`: /api/cron/general-ballot `20 */2` when it wrote a READ, or on a throw; POST<br>`races`: /api/cron/kalshi `15 */2` every run; /api/cron/race-challengers `30 12` every run; POST (scripts/sync-pac-ie.ts posts it) | general_ballot, general_ballot_reads, general_runoff, members, primaries, primary_candidates, race_ratings, races | n |
| `getElectionResults` (`lib/queries.ts:2155`) | 4 | 1 | 1: one batch of 4; `Battlefield.tsx:96` | 3600 | `general-ballot`, `races` | `general-ballot`: /api/cron/general-ballot `20 */2` when it wrote a READ, or on a throw; POST<br>`races`: /api/cron/kalshi `15 */2` every run; /api/cron/race-challengers `30 12` every run; POST (scripts/sync-pac-ie.ts posts it) | general_ballot, general_ballot_reads, general_runoff, primaries, primary_candidates, race_ratings, races | n |
| `getIncumbentQualifiers` (`lib/queries.ts:2339`) | 4 | 1 | 1: one batch of 4; `CompetitiveRacesBlock.tsx:97` | 86400 | `general-ballot`, `races` | `general-ballot`: /api/cron/general-ballot `20 */2` when it wrote a READ, or on a throw; POST<br>`races`: /api/cron/kalshi `15 */2` every run; /api/cron/race-challengers `30 12` every run; POST (scripts/sync-pac-ie.ts posts it) | general_ballot, general_ballot_reads, general_runoff, member_ids, members, primaries, primary_candidates, races | n |
| `getLatestMarketTicks` (key `market-ticks-latest`) (`lib/queries.ts:10678`) | 4 | 4 | 2: two `MarketsTape` renders (`DashboardV2Header.tsx:198`, `:205`), the same key; both missed at once (1689 and 1691 ms) | 86400 | `markets` | `markets`: /api/cron/markets `0 */4` every run; not on the POST list | market_ticks | can't say: inside the log's `CHANGED (no keyParts literal)` row (note 10) |
| `getPacIeSpending` (`lib/queries.ts:2605`) | 4 | 4 | 1: four reads awaited in turn (`:2608`, `:2649`, `:2663`, `:2677`); `CompetitiveRacesBlock.tsx:126` | 3600 | `races`, `general-ballot` | `races`: /api/cron/kalshi `15 */2` every run; /api/cron/race-challengers `30 12` every run; POST (scripts/sync-pac-ie.ts posts it)<br>`general-ballot`: /api/cron/general-ballot `20 */2` when it wrote a READ, or on a throw; POST | general_ballot, general_ballot_reads, pac_ie_spending, primaries, primary_candidates, race_candidates, races | n |
| `getRecentRaceMoves` (`lib/queries.ts:2575`) | 4 | 1 | 1: one batch of 4; `CompetitiveRacesBlock.tsx:121` | 3600 | `races` | `races`: /api/cron/kalshi `15 */2` every run; /api/cron/race-challengers `30 12` every run; POST (scripts/sync-pac-ie.ts posts it) | cron_runs, rating_history | n |
| `getStageChangesCount` (`lib/queries.ts:8205`) | 4 | 4 | 2: `page.tsx:146` and `WeeklyBand.tsx:114` (`({}, 7)`, a second key); 2 reads per call in turn (`:8230`-`:8237`), so 4 ÷ 2. `ActivityTicker.tsx:73` passes `page.tsx:146`'s arguments and ran no third pair | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills | y |
| `getStageDistribution` (`lib/queries.ts:513`) | 4 | 4 | 2: `page.tsx:142` and `:143`, two keys; 2 reads per call (`:558`, `:585`) | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills | y |
| `getRecentMeetings` (`lib/queries.ts:10161`) | 3 | 3 | 1: `HearingsTab.tsx:27`; its read, then `attachMeetingBills`' two (`:10084`, `:10091`) | 3600 | `meetings` | `meetings`: /api/cron/committee-meetings `50 */12` every run; POST | bills, committee_meeting_documents, committee_meetings, meeting_bills, news_mentions | can't say: inside the log's `CHANGED (no keyParts literal)` row (note 10) |
| `getUpcomingMeetings` (`lib/queries.ts:10127`) | 3 | 3 | 1: `HearingsTab.tsx:26`; same shape | 3600 | `meetings` | `meetings`: /api/cron/committee-meetings `50 */12` every run; POST | bills, committee_meeting_documents, committee_meetings, meeting_bills, news_mentions | can't say: inside the log's `CHANGED (no keyParts literal)` row (note 10) |
| `getWeeklyBandPriorWeek` (`lib/queries.ts:8273`) | 3 | 3 | 1: `WeeklyBand.tsx:118`; three COUNTs at once (`:8283`-`:8295`, one through `lib/enacted-this-week.ts:100`) | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills | y |
| `getCorpusStats` (`lib/queries.ts:624`) | 2 | 1 | 1: one batch of 2; `page.tsx:141` | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills, cron_runs | n |
| `getNewBillsThisWeekCount` (`lib/queries.ts:671`) | 2 | 2 | 2: `page.tsx:147` `(chamber)` and `WeeklyBand.tsx:115` `()`, two keys; `NewThisWeek.tsx:39` shares `page.tsx`'s | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills | y |
| `getWeeklyBandHearings` (`lib/queries.ts:8324`) | 2 | 2 | 1: `WeeklyBand.tsx:116`; `countWindow` runs twice per call (`:8338`-`:8341`), so 2 statements are 1 call | 3600 | `meetings` | `meetings`: /api/cron/committee-meetings `50 */12` every run; POST | committee_meetings | n |
| `getWeeklyBandHistory` (`lib/queries.ts:8493`) | 2 | 2 | 1: `WeeklyBand.tsx:120` | 3600 | `reports`, `meetings` | `reports`: /api/cron/weekly-report `30 9 * * 1`; /api/sync `0 */6` when it generated a missing week; POST<br>`meetings`: /api/cron/committee-meetings `50 */12` every run; POST | committee_meetings, reports | n |
| `getWeeklyBandNewBillsBreakdown` (`lib/queries.ts:8393`) | 2 | 2 | 1: `WeeklyBand.tsx:122` | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills | y |
| `getDashboardPrimaries`, uncached (`lib/queries.ts:1804`) | 2 | 2 | 1: `CompetitiveRacesBlock.tsx:163`; no cache, so it runs on every load, warm ones too (`:1800`-`:1803` says why) | none | none | n/a: nothing caches it | members, primaries, primary_candidates, race_ratings | n/a (uncached) |
| `getBattlefieldSeats` (`lib/queries.ts:3335`) | 1 | 1 | 1: `Battlefield.tsx:92` | 3600 | `race-ratings`, `races` | `race-ratings`: no cron since HO 834; /api/sync-race-ratings by hand, and scripts/sync-race-ratings.ts posts it with `--flush`; POST<br>`races`: /api/cron/kalshi `15 */2` every run; /api/cron/race-challengers `30 12` every run; POST (scripts/sync-pac-ie.ts posts it) | members, race_ratings, races | n |
| `getBreakingNewsForHome` (`lib/queries.ts:6397`) | 1 | 1 | 1: `BreakingNewsBlock.tsx:34` | 600 | `news-breaking` | `news-breaking`: /api/cron/news `*/30` every run; POST | bills, news_mentions | n |
| `getBreakingNewsForHomeCount` (`lib/queries.ts:6513`) | 1 | 1 | 1: `page.tsx:145`; `BreakingNewsBlock.tsx`'s own call has the same arguments | 600 | `news-breaking` | `news-breaking`: /api/cron/news `*/30` every run; POST | bills, news_mentions | n |
| `getCommitteesIndex` (key `committees-index`) (`lib/queries.ts:10426`) | 1 | 1 | 1: `HearingsTab.tsx:28` | 3600 | `committees` | `committees`: /api/cron/committees `5 */6` every run; not on the POST list | committee_bills, committee_members, committees | can't say: inside the log's `CHANGED (no keyParts literal)` row (note 10) |
| `getDashboardReportSnapshot` (`lib/queries.ts:1237`) | 1 | 1 | 1: `WeeklyBand.tsx:119` | 3600 | `reports` | `reports`: /api/cron/weekly-report `30 9 * * 1`; /api/sync `0 */6` when it generated a missing week; POST | reports | n |
| `getEnactedThisWeek` (`lib/queries.ts:8254`) | 1 | 1 | 1: `WeeklyBand.tsx:113` | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills | n |
| `getMostRecentEnacted` (`lib/queries.ts:8542`) | 1 | 1 | 1: `WeeklyBand.tsx:124` | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills | n |
| `getNewBillsThisWeek` (`lib/queries.ts:737`) | 1 | 1 | 1: `NewThisWeek.tsx:38` | 3600 | `bills`, `news-breaking` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST<br>`news-breaking`: /api/cron/news `*/30` every run; POST | bills, members, news_mentions | y |
| `getRacesIndex` (`lib/queries.ts:3101`) | 1 | 1 | 1: `CompetitiveRacesBlock.tsx:97` | 3600 | `race-ratings`, `races` | `race-ratings`: no cron since HO 834; /api/sync-race-ratings by hand, and scripts/sync-race-ratings.ts posts it with `--flush`; POST<br>`races`: /api/cron/kalshi `15 */2` every run; /api/cron/race-challengers `30 12` every run; POST (scripts/sync-pac-ie.ts posts it) | kalshi_odds, member_fundraising, members, polymarket_odds, race_ratings, races | n |
| `getStageChanges` (`lib/queries.ts:8169`) | 1 | 1 | 1: `ActivityTicker.tsx:54` | 3600 | `bills`, `news-breaking` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST<br>`news-breaking`: /api/cron/news `*/30` every run; POST | bills, members, news_mentions | y |
| `getStaleBills` (`lib/queries.ts:7516`) | 1 | 1 | 1: `TopStalls.tsx:49` | 3600 | `bills`, `news-breaking` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST<br>`news-breaking`: /api/cron/news `*/30` every run; POST | bills, committee_meetings, meeting_bills, members, news_mentions | y |
| `getStaleBillsCount` (`lib/queries.ts:7406`) | 1 | 1 | 1: `page.tsx:150` | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills | n |
| `getTopicDistribution` (`lib/queries.ts:792`) | 1 | 1 | 1: `page.tsx:144` | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills | n |
| `getWeeklyBandFiller` (`lib/queries.ts:714`) | 1 | 1 | 1: `WeeklyBand.tsx:117` | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills | y |
| `getWeeklyBandHearingBreakdown` (`lib/queries.ts:8453`) | 1 | 1 | 1: `WeeklyBand.tsx:123` | 3600 | `meetings` | `meetings`: /api/cron/committee-meetings `50 */12` every run; POST | committee_meetings | y |
| `getWeeklyBandTransitionLadder` (`lib/queries.ts:8364`) | 1 | 1 | 1: `WeeklyBand.tsx:121` | 3600 | `bills` | `bills`: /api/sync `0 */6` every run; /api/cron/summarize `*/10` when it summarized ≥1 bill; POST | bills | y |
| **sum (43 readers)** | **217** | **203** | | | | | | |

**(unattributed):** none. No statement went unmatched, so the row would read 0 statements and 0 store requests, and no SQL is listed below it.

**How "calls per load" was derived.** A cold call runs every unconditional statement of its reader once, so the script's count of calls is the smallest count among a reader's distinct statements (`attr-home.txt`, column *calls (min count)*). Each was then checked against the code, with the call sites named in the cell. Two corrections, where one call issues the same SQL text twice: `getStageChangesCount` (its total and filtered reads are byte-identical with no chamber or filter, `:8230`-`:8237`: 4 statements are 2 calls) and `getWeeklyBandHearings` (`countWindow` twice, `:8338`-`:8341`: 2 statements are 1 call). Line numbers without a file are `lib/queries.ts`.

**The expiry column's key.** Crons are vercel.json's, in UTC. *Every run* means every run that reaches the call: a run that throws earlier expires nothing. *POST* means `POST /api/revalidate?tag=…` (`app/api/revalidate/route.ts:71`, the tag on its `ALLOWED_TAGS` list), by hand with the cron secret. A POST with no `?tag=` expires `bills` (`route.ts:64`), which three scripts rely on (the `bills` row below).

| tag | call sites (file:line), and when they run |
|---|---|
| `bills` | `app/api/sync/route.ts:116`, after `runSync`, every tick of `0 */6 * * *`; `app/api/cron/summarize/route.ts:121`, `if (stats.ok > 0)`, `*/10 * * * *`; POST (allowed); `scripts/reconcile-cosponsor-count-677.ts:135` posts it when run; and three tagless POSTs that land on `bills` because the route defaults to it (`app/api/revalidate/route.ts:64`, `?? "bills"`): `scripts/backfill-clusters.ts:29`, `scripts/classify-ceremonial.ts:305` and `:329` (unless `--no-revalidate`) |
| `committees` | `app/api/cron/committees/route.ts:137`, every tick of `5 */6 * * *`; not on `ALLOWED_TAGS` |
| `general-ballot` | `lib/general-ballot.ts:1084` (on a throw) and `:1099` (`r.verdicts.READ > 0`), through `generalBallotTick`'s `expire` parameter (defaulted to `expireTag`, `:1063`), from `/api/cron/general-ballot` `20 */2 * * *`; POST (allowed) |
| `markets` | `app/api/cron/markets/route.ts:136`, every tick of `0 */4 * * *`; not on `ALLOWED_TAGS` |
| `meetings` | `app/api/cron/committee-meetings/route.ts:56`, every tick of `50 */12 * * *`; POST (allowed) |
| `members` | none in `lib/`, `app/` or `scripts/` (outside `scripts/diagnostic/`); not on `ALLOWED_TAGS`. Entries end only at `revalidate` |
| `news-breaking` | `app/api/cron/news/route.ts:86`, every tick of `*/30 * * * *`; POST (allowed) |
| `palestine` | no code call; POST (allowed), which `scripts/sync-palestine.ts:423` prints for a human to run |
| `race-news` | `app/api/cron/news/route.ts:90`, every tick of `*/30 * * * *`; POST (allowed) |
| `race-ratings` | `app/api/sync-race-ratings/route.ts:112`; the route has no vercel.json cron since HO 834 (`c973775`), so only a by-hand call reaches it; `scripts/sync-race-ratings.ts:73` posts the tag only with `--flush`, and only when a leg wrote (`:107`-`:109`); POST (allowed) |
| `races` | `app/api/cron/kalshi/route.ts:130`, every tick of `15 */2 * * *`; `app/api/cron/race-challengers/route.ts:53`, every tick of `30 12 * * *`; POST (allowed); `scripts/sync-pac-ie.ts:189` posts it when run without `--dry-run`; `scripts/backfill-2024-margin.ts:219` and `scripts/backfill-race-challengers.ts:68` print it |
| `reports` | `app/api/cron/weekly-report/route.ts:110`, `30 9 * * 1` (Mondays); `app/api/sync/route.ts:89`, `if (catchup.generated)`, `0 */6 * * *`; POST (allowed); `scripts/backfill-report-counts.ts:125` posts it when run |
| `votes` | `app/api/sync-votes/route.ts:75`, `if (house || senate)`, `0 10 * * *`: `house` and `senate` are the two syncs' stats objects (`null` only when that chamber threw, `:46`-`:58`), so every run where either chamber's sync returns flushes, inserts or not; `app/api/cron/amendments/route.ts:84` (`senateMat.changed > 0`) and `:107` (`walk.linksInserted > 0`), `0 7 * * *`; POST (allowed) |

### The timeline (the cold load of `/`)

- **The load:** time to first byte 3,509 ms, total 3,523 ms. The first store request starts at 210 ms and the last ends at 3,481 ms.
- **No streaming:** `/` has no `loading.tsx` and no `Suspense` on the path, so the first byte waits on the whole tree.
- **The page-level reads** (`app/page.tsx:140-152`'s `Promise.all`) start at 210 to 236 ms. All but one end by about 540 ms.
- **The absence band holds the page until 1,577 ms.** Its reader, `absenceWatchCached`, runs 8 serial reads, 236 to 1,316 ms: the roster, a loop over two chambers with 3 reads each, then the scores. Then come its 60 member-card reads: 12 members, 5 readers each, 1,324 to 1,577 ms.
  - The store client allows 20 requests in flight (`lib/db.ts:70` sets none, so the default holds), and this load reached 20 at 1,326 ms.
  - **Nothing below the page-level `Promise.all` starts until the band ends:** every component's first store read starts at 1,640 ms or later.
- **The races block runs 1,643 to 3,404 ms:** 1,761 ms of wall time.
  - **Its store time along its chain is 1,590 ms, over 40 round trips:** 90% of the wall.
  - The pool alone is 31 of those round trips, 1,643 to 2,625 ms.
  - `Battlefield`, its child, adds 2 serial reads to 3,481 ms.
- **The longest serial chain the load's end waits on:** walking back from the request that ends last to the one that ended latest before it started, at any gap:
  - **53 round trips and 2,934 ms of store time,** plus 244 ms of gaps over 5 ms;
  - it runs through the band's serial reads, its cards, the pool's 31 round trips, the races block's tail and `Battlefield`;
  - with the 236 ms before its first link, 67 ms of gaps of 5 ms or less and the 28 ms after the last, it accounts for the 3,509 ms (236 + 2,934 + 244 + 67 + 28).
- **Each reader's first start and last end,** in ms from the page request's start, sorted by first start:

| first start | last end | reader | requests | statements |
|---|---|---|---|---|
| 210 | 506 | getCorpusStats | 1 | 2 |
| 226 | 482 | getStageDistribution | 4 | 4 |
| 229 | 536 | getTopicDistribution | 1 | 1 |
| 231 | 401 | getBreakingNewsForHomeCount | 1 | 1 |
| 233 | 1782 | getStageChangesCount | 4 | 4 |
| 234 | 1687 | getNewBillsThisWeekCount | 2 | 2 |
| 235 | 407 | getStaleBillsCount | 1 | 1 |
| 236 | 1316 | absenceWatchCached | 8 | 8 |
| 1324 | 1513 | getSponsorStats | 12 | 12 |
| 1324 | 1515 | getSponsorTopTopics | 12 | 12 |
| 1324 | 1548 | getMemberCommittees | 12 | 12 |
| 1324 | 1571 | getSponsorRecentBills | 12 | 12 |
| 1324 | 1577 | getMemberAffiliations | 12 | 12 |
| 1640 | 1992 | getRecentMeetings | 3 | 3 |
| 1641 | 1967 | getUpcomingMeetings | 3 | 3 |
| 1642 | 2165 | getCommitteesIndex | 1 | 1 |
| 1643 | 1690 | getEnactedThisWeek | 1 | 1 |
| 1643 | 2625 | getMostCompetitiveRaces | 61 | 61 |
| 1646 | 1685 | getWeeklyBandHearings | 2 | 2 |
| 1647 | 1693 | getWeeklyBandFiller | 1 | 1 |
| 1648 | 1708 | getWeeklyBandPriorWeek | 3 | 3 |
| 1649 | 1703 | getDashboardReportSnapshot | 1 | 1 |
| 1649 | 1737 | getWeeklyBandHistory | 2 | 2 |
| 1650 | 1698 | getWeeklyBandTransitionLadder | 1 | 1 |
| 1651 | 1695 | getWeeklyBandNewBillsBreakdown | 2 | 2 |
| 1652 | 1702 | getWeeklyBandHearingBreakdown | 1 | 1 |
| 1652 | 1708 | getMostRecentEnacted | 1 | 1 |
| 1683 | 1718 | getBreakingNewsForHome | 1 | 1 |
| 1685 | 1965 | getStageChanges | 1 | 1 |
| 1686 | 2540 | getStaleBills | 1 | 1 |
| 1688 | 1966 | getNewBillsThisWeek | 1 | 1 |
| 1689 | 1769 | getLatestMarketTicks | 4 | 4 |
| 2627 | 2694 | getRacesIndex | 1 | 1 |
| 2629 | 2820 | getIncumbentQualifiers | 1 | 4 |
| 2900 | 2933 | getRaceResults | 1 | 5 |
| 2958 | 3138 | getRecentRaceMoves | 1 | 4 |
| 3149 | 3280 | getPacIeSpending | 4 | 4 |
| 3285 | 3339 | uncached: getDashboardPrimaries | 2 | 2 |
| 3286 | 3323 | getRace | 6 | 6 |
| 3317 | 3360 | getRaceCandidates | 6 | 6 |
| 3318 | 3404 | getRaceNews | 6 | 6 |
| 3414 | 3442 | getBattlefieldSeats | 1 | 1 |
| 3446 | 3481 | getElectionResults | 1 | 4 |

## B. A stale load, locally

**How an entry ages (STEP 0 claim 9):**
- next@16.3.4's file cache takes an entry's age from its file's mtime (`file-system-cache.js:109`, `:114`). Nothing inside the file holds a time.
- An entry older than its reader's revalidate is stale (`incremental-cache/index.js:406-408`).
- On a force-dynamic page, a stale entry is returned at once (`unstable-cache.js:216-219`). Its refresh starts then, during the render (`:188-204`). The response doesn't wait for it, and `waitUntil` keeps it running past the response.
- A process-wide memory cache sits in front of the files, and tag expiry lives only in memory. So each aged run starts a fresh server.

**The runs:** the same build and server, 6:06:50 to 6:07:17 PM MST Nov 25 (01:06:50 to 01:07:17 UTC Nov 26).
- **The warm-up:** one load of `/` on an emptied cache wrote 115 files. Then the server was stopped, and its port refused connections.
- **Aging:** every file's mtime was set 2 hours back, then later 25 hours back. Contents were untouched, and a read-back showed every mtime at the target.
- Nothing was POSTed, since a flush would turn aged entries into misses.

| load | time to first byte | total time | store requests | started after the response | statements |
|---|---|---|---|---|---|
| warm-up, cold cache, fresh server | 3,005 ms | 3,018 ms | 203 | 0 | 217 |
| **B.1** aged 2 h, fresh server | **616 ms** | 631 ms | 124 | 62 | 135 |
| **B.2** the same URL at once | 125 ms | 135 ms | 75 | 67 | 75 |
| B.2b once B.1's refreshes had rewritten their files (an addition) | 256 ms | 265 ms | **2** | 0 | 2 |
| **B.3** aged 25 h, fresh server | **684 ms** | 731 ms | 201 | 114 | 215 |

- **Aged 2 h, 100 of the 115 entries were rewritten.**
  - 88 are the entries at revalidate 600 or 3600. 12 readers in `lib/queries.ts` carry 600, which § 1.B's bound left out.
  - The other 12 are `getMemberAffiliations`' entries at 86400, which the band's refresh re-runs through its nested call and rewrites.
  - The other 15 entries, all 86400, stayed fresh.
- **B.2 met stale entries again.** B.1's refreshes hadn't landed, and nothing shares a refresh across requests (claim 9). Once they had (B.2b), a load asked the store twice: the uncached `getDashboardPrimaries`.
- **Aged 25 h, every reader went stale.** The load asked 201 times, 114 of them after the response.
- **B.1 and B.3 are attributed reader by reader,** with every statement matched, in `835-artifacts/probe-b/attr-b1.txt` and `attr-b3.txt`.
  - B.1's band reads are split with B.2's within about ±2: overlapping page requests share the store client's limiter.
  - B.3's 43 rows sum to 215 and 201.

**So, does a stale `/` make the visitor wait? Locally, can't say.**
- The first stale load's first byte came at 616 ms (2 h) or 684 ms (25 h), against 256 ms fresh (B.2b) and 3,005 ms cold.
- **But B.1 and B.3 were each the first load on a freshly started server,** and B.2b ran on a warm one. Every fresh server's first store request started about 200 ms in, against about 30 ms on the warm process.
- B.2, stale on the warm process, sent its first byte at 125 ms.
- B ran no fresh server on fresh entries, so the gap can't be split between the process starting and the stale entries.
- **The store work is 124 to 201 requests,** against a cold load's 203. Half (2 h) to 57% (25 h) of it started after the visitor had the page.

## C. Production, through the Vercel MCP (read-only)

Read about 5:50 to 6:40 PM MST Nov 25 (00:50 to 01:40 UTC Nov 26): 91 queries with a skeptic's 42 re-runs, plus `list_deployments`, `get_deployment` and GitHub's run and job records.
- Every query but the two `ttfb_ms` reads (their ids are in C.1) is listed by id in `835-artifacts/c-835-mcp.md`.
- Retention held the whole window, Nov 18 19:00 UTC to Nov 26 01:00 UTC.
- A "render" is a function invocation of `/` with `route` `/` that returned 200, so the `/index` prefetches and the gate's 307s are out.

**C.1, the late scheduled run's first renders.** This is `e2e-prod` `45721650229`, whose `smoke` job ran 4:28:40 to 4:37:36 PM MST Nov 25. It rendered `/` on the old deployment `dpl_CzQ2…`, whose keys hadn't changed. `/` had gone at least 3 h 36 m without a rendering load: HO 833's re-run crawl ended at 12:52:27 PM.
- **The first slot,** 4:29:20 PM (23:29:20 UTC), held 4 renders, all 200s.
  - **Durations:** 970, 977, 1,860 and 2,314 ms.
  - **Time to first byte:** 969 to 2,244 ms (`ttfb_ms`, queryIds 3609081436 and 941990652).
  - **Store requests:** 235 in that slot.
- **The run's 75 later 200s:** a median of 316 ms, max 721 ms.
- **So the first loads ran 3.1 to 7.3 times the warm median.** That understates a fully idle `/`: a `/welcome` load at 4:23 PM had warmed six of the one-hour readers the two pages share.
- **These durations include any cold start of the function,** which the metrics can't separate from waiting on stale entries.

**C.2, seven days of `/`: how often does a person, not the crawl, wait?**
- **The window held 1,867 document loads of `/`:** about 1,795 renders, the rest the gate's 307s.
- **25 ten-second slots held a render over 2 s.** Classified:
  - 4 **deploy**, within 15 minutes of a Production deploy;
  - 19 **idle**, with no rendering load of `/` in the hour before;
  - 2 **other**.
- **9 fell inside an `e2e-prod` smoke job.** All 4 deploy slots are among them, 3 of them the crawl's own first loads. 9 of the 13 Production deploys produced no slot over 2 s.
- **Outside any crawl: 16 slots and 17 renders in 7¼ days,** about 2.2 slots or 2.3 renders a day, with at least one on every MST day from Nov 18 to Nov 24.
  - 14 of the 16 were idle. The 2 others came within the hour: one 57 minutes after a crawl (7,422 ms), and a pair 13½ minutes after an idle load (8,850 and 9,472 ms).
  - **Their waits:** a median of **2,940 ms**, max **9,472 ms**.
  - About 1 in 3 of the renders outside crawls waited over 2 s: 17 of 46 to 48.
- **The metrics have no user-agent dimension,** so *not a crawl* means outside a smoke job's window, not *a person*.

**C.3, concurrent loads outside a crawl:** the most renders of `/` in any 10-s slot outside a smoke job was **3** (Nov 24 10:00:40 AM MST, all warm, 308 to 428 ms). Counting the gate's 307s, which render nothing, it was 4 requests.
- One concurrent pair outside a crawl did wait: Nov 19 10:05:20 PM MST (Nov 20 05:05:20 UTC), 8,850 and 9,472 ms, 13½ minutes after an idle load.
- The metrics can't say why.

## What it doesn't show

- **Whether a first load's wait after idle is stale entries, or a cold function instance or a fresh server's first request.** Function duration and time to first byte include any cold start. § 1.B can't isolate the stale part either:
  - B.1 was a fresh server's first load (616 ms, against 256 fresh on a warm process);
  - B.2, stale on a warm process, took 125 ms.
- **Who sends the renders outside crawls.** The metrics have no user-agent dimension, so *not a crawl* means outside a smoke job's window.
- **Production's cache handler.** § 1.B ran `next start`'s file cache, whose tag expiry lives in memory. Vercel runs Next in minimal mode with its own handler (claim 9). C.1 is the Production reading.
- **A defined order for the two batched reads.** C1's ratings and C2's bills both have ties on their sort keys. The proofs matched the shipped order by observation, and HO 836 should add a tiebreak.
- **How often the crons actually reached their flushes.** C6 reads the code, not `cron_runs`.
- **The re-keying of 5 readers at HO 833's deploy** (HO 834's instrument skipped them).
