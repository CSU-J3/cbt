# HO 834: what `/` asks the store, and why it asked 427 times in 20 s at HO 833's FF. One cold load asks 203, a warm one 2, one after the news tick 13. The deployment's first two loads read nearly a cold load each, because `/` had sat unrendered for about 16 hours and the deploy re-keyed part of its reads. The burst *precedes* the spell.

> **Diagnostic-only probe, not wired.** Base `main` at `9b965e5`. Run Wednesday 2026-11-25, Mountain Standard Time (a fixed UTC−7) with UTC beside.
> - **§ 1.B, Production, read first,** 1:52 to 1:58 PM MST (20:52 to 20:58Z), with one more pair of hourly reads at about 2:45 PM. It went through the Vercel MCP's read-only `create_observability_query` and `get_runtime_logs`, with no Vercel CLI call.
>   - The window is 12:29:30 to 12:32:00 PM MST (19:29:30 to 19:32:00Z), plus HO 832's comparable point on Nov 24. Retention held for both (`docs/handoffs/834-artifacts/b-834-mcp.md`).
> - **§ 1.A, one load locally:** `scripts/diagnostic/home-requests-834.ts` drove a production build of `9b965e5` (`next start`, Node v25.5.0) against prod's store, with `Cookie: ct_seen=1`.
>   - **The record is run 4,** 2:49:36 to 2:50:28 PM MST (21:49:36 to 21:50:28Z), on the driver and preload as committed.
>   - **Run 1** (2:08:41 to 2:09:03) had the guard refuse 8 store requests before they were sent: one in each load of `/` that reached the store, each a read-mode batch's wrapper (below). Its driver read the guard's log only after `/`'s last step. It stopped there, before `/?stage=floor`. 84 other store requests, all reads, went out meanwhile.
>   - **The guard was corrected to HO 824's batch rule,** and the driver now reads the log after every step. Runs 2 (2:10:19) and 3 (2:12:29) read the same counts as run 4.
> - **The guard:** the preload (`home-requests-834-preload.cjs`) wraps fetch for the store's host and refuses any request carrying a statement that isn't a read by HO 824's rules.
>   - **A batch passes only in read mode, as HO 824's guard lets it** (`store-stalls-829.ts:111-114`). On the wire that's the exact wrapper `BEGIN TRANSACTION READONLY` … `COMMIT`, `ROLLBACK`, and every statement inside is checked.
>   - **A sequence (`executeMultiple`) is refused outright,** as HO 824 refuses it (`:116-120`).
>   - **Five controls run at load:** a lone write, a deferred batch, a write inside a read-only batch and a sequence of reads are refused, and a read-only read passes.
>   - **Run 4:** 307 and 284 statements passed, all reads, none refused.
> - **The local server's only POST** was its own `/api/revalidate`, which expires a tag in that server and forwards nowhere. No cron and no `/api/sync` was called. The script refuses a base URL that isn't `localhost`.
> - **No product code changed, and nothing was written to the store.** STEP 0's store reads went through guarded `SELECT` and `EXPLAIN`.
>
> Raw output is in `docs/handoffs/834-artifacts/` (repo-ignored): `probe-a/`, `probe-a.log`, `probe-a-run1-refused.log`, `b-834-mcp.md`, `c-834-crawl.txt`, `compare-keys-834.log`, `compare-keys-834-getNewBillsThisWeek.txt`.

## The verdict

**1. What one load of `/` asks the store** (§ 1.A, run 4; `/?stage=floor` reads the same at every step):

| Load | Store requests | Statements | What it reads |
|---|---|---|---|
| **cold** (a fresh server, `.next/cache/fetch-cache` emptied) | **203** | **217** | Every cached read misses: 69 groups of statements by their first 100 characters (the log keeps only that much). They include the races block's fan-out: 30 × two reads over the 30-race pool, and 6 × three reads for the 6 featured races. |
| **cached** (again, at once) | **2** | 2 | `getDashboardPrimaries`' two reads, which have no cache |
| **after the tick** (the news cron's three tags flushed, then one load) | **13** | 13 | the 2 above, 6 × `getRaceNews` (one per featured race), and 5 reads under `news-breaking` |
| herd: N = 4 at once after a second flush | **52**, which is 4 × 13 | 52 | Concurrent misses aren't coalesced: each load reads the 13 on its own. |
| (added) `/?stage=floor` on the cache `/` just filled | **10** | 10 | 8 stage-keyed reads and the 2 uncached ones |
| (added) one RSC prefetch of `/`, after a flush | **0** | 0 | 200 in 8 ms, 211 bytes. The document load after it still read 13. |

**2. Why 427 landed in 20 s: (c), something else, in two named parts.**
- **The two parts:**
  - `/` had gone about 16 hours without a rendering load, so its one-hour entries were all stale.
  - The deploy re-keyed 12 of its 42 cached readers.

  Either part makes a load go back to the store. The metric can't say how the 376 splits between them.
- **The arithmetic, 12:30:00 to 12:30:20 PM: 427 = 354 + 73.**
  - **354:** `/`'s first two document loads (`route` `/`), the crawl's first two tests (`/` and `/?stage=introduced`, on two workers, from 12:29:57.7). They ran up to 8,952 ms.
    - With the 22 they made in the slot before, that's **376**, against two cold loads' 2 × 203 = 406.
    - Two loads at once can share a few entries the other fills first.
  - **73:** six `/?stage=…` document loads from 12:30:10 to 12:30:18 (C).
    - At about 10 each on the cache the first two had filled (8 stage-keyed misses and the 2 uncached reads; floor's, measured), that's 60.
    - The flush, at about 12:30:15.5, came before two of them, `enacted` (12:30:17.7) and `filtered-max` (12:30:17.9). Each of those adds what the flush expired and a stage load doesn't already read: 6 × `getRaceNews` and 2 bill rows, about 8.
    - That's about **68 to 76**, against 73.
  - **`route` `/index`:** 55 of the window's 64 requests to `/`. Their slowest per 10-s slot read 9 to 130 ms (per-slot maxima, not each request's time). A prefetch locally reads 0, and `/`'s store requests are 0 in every slot where only `/index` ran.
- **Why the first two loads read so much: part one, the stale cache.**
  - `/`'s readers mostly hold their entries an hour (`revalidate: 3600`). A stale entry is served and refreshed in the background, and that refresh is a store request on `origin_route` `/`, the same as a miss.
  - **Before the FF, `/`'s last rendering load came in the 03:00Z hour of Nov 25:** one document load and 5 `/index`, 143 store requests. The two `route` `/` invocations in the 10:00Z hour made 0 store requests, so they didn't render the page. Nothing else reached `/` until 12:29:57.7 PM MST (B15, B16).
  - **Single loads after idle hours, with no deploy, read heavily too:** 130 store requests in the 20:00Z hour of Nov 24 (one document load) and 143 in the 03:00Z hour of Nov 25.
- **Why the first two loads read so much: part two, re-keying.**
  - next@16.3.4's `unstable_cache` keys an entry on `${cb.toString()}-${keyParts}` and its arguments (`node_modules/next/dist/server/web/spec-extension/unstable-cache.js:58`, `:85`).
  - **Production builds of `3eb0291` and `9b965e5` differ in 31 of 112 named cached callbacks' bundled text** (`compare-keys-834.log`; its *32 of 113* also counts one row that pools call sites with no literal keyParts).
  - **Of `/`'s 42 cached readers, 12 are among them** (one nested): `getStageDistribution`, `getStageChangesCount`, `getNewBillsThisWeekCount`, `getSponsorRecentBills`, five `getWeeklyBand*` readers, `getStageChanges`, `getStaleBills` and `getNewBillsThisWeek`.
  - **The other 30 kept their keys,** among them the races pool (`getMostCompetitiveRaces`) and the featured races' reads. So re-keying is part of the cold, not all of it.
  - `getNewBillsThisWeek`'s first difference: minified module-level identifiers inside it, `az`→`aB` and `aA`→`aC` (`compare-keys-834-getNewBillsThisWeek.txt`). HO 833 added module-level names to `lib/queries.ts`, which fits, though the minifier's renaming wasn't traced.
- **HO 832's FF, for contrast:**
  - `/`'s previous rendering load came in the 20:00Z hour of Nov 24, about an hour before.
  - HO 832 changed nothing under `lib/`, `app/`, `components/` or `package.json`.
  - Its crawl's first eight loads made 83 store requests (23 + 60 at 2:02:40 and 2:02:50 PM): about one load after the 2:00 tick plus seven stage loads.
  - Its first two `route` `/` invocations, at 2:01:50 PM before the crawl, made 0, so they didn't render the page. A render reads at least `getDashboardPrimaries`' 2 uncached statements. The gate's redirect fits, but their status wasn't read.
- **Not (a):** the tick's flush can't have made the 354.
  - The news cron ran from 12:30:05.1 to 12:30:15.5 (`cron_runs`: 10,350 ms, `success`, 0 mentions inserted). It expires its three tags after its per-feed log, so at about 12:30:15.5.
  - The 354 sits in the slot before that.
  - After a flush, a load reads 13, not 200. The flush's share is in the 73 at most.
- **Not (b) alone:** the fan-out costs only when its entries are stale or missing. A fresh load reads 2, and one after the tick 13.

**3. Whether the burst made the spell: *precedes*.**

| 10-s slot (MST) | store requests, every route (HO 833's query 9, 1541686556) | p50 (B10) | max (HO 833's query 8, 1514237539) |
|---|---|---|---|
| 12:29:50 | 22 | 86 | 1,969 |
| **12:30:00** | **458** | **30.25** | 3,580 |
| **12:30:10** | **414** | **6.9** | 284 |
| 12:30:20 | 26 | 66 | 2,556 |
| 12:30:30 | 14 | 199 | **33,959** |
| 12:30:40 | 1 | **10,000** | **10,000** |
| 12:30:50 | 2 | 48 | 9,198 |
| 12:31:00 | 0 | – | – |
| 12:31:10 | 13 | 170 | 6,766 |
| 12:31:20 | 7 | **2,072** | 7,231 |
| 12:31:30 | 7 | 16 | 1,526 |
| 12:31:40 | 27 | 45 | 2,124 |
| 12:31:50 | 36 | 58 | 5,040 |

- **The store answered the burst fast.** Its p50 read 30 and 7 ms through its 872 requests.
- **The slow store began in the next slot but one,** 12:30:30, and ran to 12:31:50, at 1 to 36 requests a slot. The routes whose slowest request is named are `/electoral`, `/stale` and `/news` (HO 833's records). None is `/`.
- **One instance can't carry *caused*.** The burst came first and ended before the spell began.

## A. One load, locally (`probe-a.log`, `probe-a/home-requests-834.json`)

- **Store requests are keyed to the page request** they ran under, through an AsyncLocalStorage entered at `http.Server`'s `request` event.
  - That's exact for one load at a time.
  - **In the herd the store client queues requests and drains them from whichever page request started the queue.** So the four loads' split read 26 / 20 / 2 / 4, and only the total, 52, is read.
- **The cold load's 69 groups** are statements grouped by their first 100 characters, not their full SQL; they're listed in full in `probe-a.log`. The largest:
  - 30 × a race and its incumbent, and 30 × `race_ratings`: the races block's 30-race pool;
  - 15 × a bills row prefix that several readers share, 12 of them `getSponsorRecentBills`;
  - 12 × each of the absence band's other per-member reads (12 members).

    Those five per-member readers are nested in the band's cache and bypass their own.
  - 6 × each of the featured races' race, candidates and news.
- **After the tick:** 6 × the observation news read (`getRaceNews`, tag `race-news`), 3 × a bills row read and 2 news reads under `news-breaking`, and the 2 uncached reads.
- **The prefetch:** Next 16 answers an RSC request without its `_rsc` parameter with a 307 to the same path carrying it. Run 2 didn't follow that and read the 307. Runs 3 and 4 follow it as the router does.

## B. Production (`b-834-mcp.md`)

- **The metrics allow:**
  - `request_path`, `http_status`, `request_method` and `cache_result` on requests;
  - `route` and `request_path` on function invocations;
  - `origin_route` and `deployment_id` on store requests.
- **They refuse `request_query` and `request_id` (400).** So a store request can't be tied to its page request, and a query string can't be read.
- **The finest granularity is 10 s, not 5 s.** So the herd's N couldn't be read off B and is the handoff's fallback, 4. The most document loads in any 10-s slot was 6.
- **Requests to `/`, 12:29:30 to 12:32:00:** 64 answered 200 (plus 2 × 307 in 12:29, the gate). By function `route`, that's 9 document loads (`/`) and 55 `/index`.
  - Ten nav-linked paths took the same count or within 1, slot by slot in the slots the truncated result shows (64 or 65 each over the window). That fits the nav links' RSC prefetches; it's an inference.
- **Store requests by route:** `/` 22 · 354 · 73 in 12:29:50 · 12:30:00 · 12:30:10, then 0 until 5 at 12:31:50. `/api/cron/news` made 104 · 341 in 12:30:00 · 12:30:10.
- **The news cron's run:** started 12:30:05.1 and ended 12:30:15.5 (`cron_runs`). Its runtime log, request id stamped 12:30:04.3, reads *0 mentions inserted across 3 sources* at 12:30:15.5.
- **The minute's other flusher didn't fire.** `/api/cron/summarize` (`*/10`) expires `bills` only when it summarized a bill (`if (stats.ok > 0)`, `app/api/cron/summarize/route.ts:121`). Its 12:30 tick logged *processing 0 bill(s)* and `final: ok=0` at 12:30:24.5. So at 12:30 only the news cron's three tags were expired.
- **HO 832's comparable point** (Nov 24, ready 2:01:51.5 PM, crawl from 2:02:43): `/`'s first two document invocations at 2:01:50 made 0 store requests; 8 more from 2:02:40 made 23 + 60; and there were 70 `/index`.
- **`/` hour by hour, Nov 24 14:00Z to Nov 25 20:00Z (B15, B16):**
  - **Document loads:** 84 at 16:00Z, 3, 2, then 1 at 20:00Z; 82 at 21:00Z (HO 832's FF); 1; 81 at 23:00Z; 1 at 00:00Z; 1 at 03:00Z; 2 at 10:00Z; then 162 at 19:00Z Nov 25.
  - **Store requests on `/`:** 421 · 31 · 149 · 0 · 130 · 225 · 0 · 350 · 0 · 0 · 0 · 143 (03:00Z), then 0 every hour from 04:00Z to 18:00Z, and 783 at 19:00Z.

## C. The crawl's side (`e2e-prod` `45685640929` attempt 1, `c-834-crawl.txt`)

**Two workers.** Narrow @430's first eight tests loaded `/`:

| Test | MST |
|---|---|
| `home (/)` | 12:29:57.5 to 12:30:10.0 |
| `home-stage-introduced` | 12:29:57.5 to 12:30:10.0 |
| `home-stage-floor` | 12:30:10.0 to 12:30:14.0 |
| `home-stage-committee` | 12:30:10.0 to 12:30:14.3 |
| `home-stage-other_chamber` | 12:30:14.0 to 12:30:17.7 |
| `home-stage-president` | 12:30:14.3 to 12:30:17.9 |
| `home-stage-enacted` | 12:30:17.7 to 12:30:21.5 |
| `home-filtered-max` (`/?stage=other_chamber&topics=government_operations`) | 12:30:17.9 to 12:30:21.6 |

The next tests (`/search`, `/welcome`, `/bills`, `/members`, `/members/pass-rate`) ran to 12:30:34.5, and then `/electoral` and `/races`.

## What it doesn't show

- **How the 376 splits between stale refreshes and re-keyed misses.** Both are store requests on `/` and the metric can't tell them apart. Nor which statement each request carried: it has no statement or request dimension, so the 376 is matched to two loads by count and timing, not by id.
- **Whether every deploy that touches `lib/queries.ts` re-keys `/`'s reads.** Two builds were compared. How far an edit renames identifiers depends on the minifier.
- **Whether the burst slowed the store.** The store's p50 stayed low through it, and the spell came after. *Precedes* is all one instance carries.
