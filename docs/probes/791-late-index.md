# HO 791: the same-day late-index sampler, run 1 of 3: 47 of 500 recently updated bills sit behind Congress.gov by a same-day second update, all from before the frontier

> **Probe, read-only.** Base `main` at `a5ba9ee`. Run 2026-10-26, Mountain Time with UTC beside: `--step0` 5:46:29 PM (23:46:29Z), `--ticks` 5:46:46 PM, `--sample` first run 5:46:53 PM, its control failing on a defect in the class definitions (below), the second run on the same seed 5:49:52 to 5:52 PM (23:49:52 to 23:52Z). **Budget:** Congress.gov 1,001 detail reads, all 200, one in flight at a time, `CONGRESS_API_KEY` by name; quota 19,000 of 20,000 left at the last answer. Prod through `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name, `SELECT` only. The instrument is `scripts/diagnostic/late-index-791.ts`; its logs and the sample's CSV are under `docs/handoffs/791-artifacts/` (repo-ignored). No product code, schema or sync code changed.

**What this found.** Of 500 bills drawn from the 670 whose stored `update_date` fell in the last seven days, **47 are behind Congress.gov by a second update on the same UTC day as the stored one**, with lags from 7 minutes to 17 hours. All 47 were stored by ticks running the old code from Oct 20 to Oct 24. Every one has a detail instant (U2) before 13:53:37Z Oct 24, the instant the frontier bootstrapped from, so no frontier listing ever covered them. 24 of the 47 fell inside the first tick's wide listing (from 13:53:37Z Oct 22), whose day compare reads a same-day second update as current. The other 23 are older than that window. **None is the 15-minute margin's:** the 16 sampled bills stored since the frontier began all read current. HO 790's census 790b read 0 behind because it compares at day precision, and these 47 are exactly what that compare can't see.

## The frontier's model, as the sampler reads it

The frontier moves to a completed listing's start less `FRONTIER_MARGIN_MS`, 15 minutes (`lib/sync.ts:35`, `:763`). So an update Congress.gov indexes more than 15 minutes after its `updateDateIncludingText` falls below the frontier. The one listing left to reach it is the daily wide listing, from the frontier less `WIDE_WINDOW_MS`, 48 hours (`:37`, `:772`), and its compare is by day (`s.slice(0, 10) >= day`, `:566`). A bill stored earlier the same day therefore reads current and isn't queued.

## STEP 0 (`--step0`), the claims the handoff gates on

- **3:** `bills_frontier` `2026-10-26T17:45:10Z` (11:45:10 AM MT), updated 12:00:15 PM MT (18:00:15Z); `bills_wide_at` `2026-10-26T00:00:55.127Z` (6:00:55 PM MT Oct 25), updated then. `sync_queue` 0 rows.
- **4:** every `/api/sync` row since 00:00Z Oct 26 reads `success`: #27983, #28044, #28110, #28183. Nothing has run since.
- **6:** `census-790a.csv` 7,707 behind, 0 missing; `census-790b.csv` 0 behind, 0 missing.
- **10:** one detail read, `x-ratelimit-remaining` 19,999.

## The frontier's ticks (`--ticks`)

Every `/api/sync` row since HO 790's Production READY (1:14:03 PM MT Oct 25, 19:14:03Z): four ticks, about one day. The handoff's "first week" isn't there yet. The columns are the payload's `sync` keys.

| tick | started | status | elapsed_ms | listComplete | pages | listedCount | enqueued | upserted | queueBefore | queueAfter | resets | resetByAction | resetByText | crsOnly | wide | wideComplete | budgetStopped | failed | droppedCount |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| #27983 | 6:00:11 PM MT Oct 25 (00:00:11Z Oct 26) | success | 78,299 | true | 3 | 0 | 182 | 182 | 0 | 0 | 5 | 0 | 5 | 5 | true | true | false | 0 | 0 |
| #28044 | 12:00:11 AM MT Oct 26 (06:00:11Z) | success | 7,119 | true | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | false | false | false | 0 | 0 |
| #28110 | 6:00:10 AM MT (12:00:10Z) | success | 8,536 | true | 1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | false | false | false | 0 | 0 |
| #28183 | 12:00:10 PM MT (18:00:10Z) | success | 22,180 | true | 1 | 26 | 26 | 26 | 0 | 0 | 0 | 0 | 0 | 3 | false | false | false | 0 | 0 |
| **sum** | 4 ticks | | | | 6 | | 208 | 208 | | | 5 | 0 | 5 | 8 | | | | 0 | 0 |

**The CRS meter:** `crsOnly` 8 over `upserted` 208, **3.85%**. Five of the 8 are the first tick's, whose 182 were the wide listing's repair of HO 116's drop. The other three are #28183's, out of 26 writes, the first tick whose frontier listing listed anything. One day's ticks carry it, so the rate is not yet the ongoing one.

**The committee walk** (`/api/cron/committees`, the payload's `bills` keys) since 6:05 PM MT Oct 25 (00:05Z Oct 26):

| tick | started | status | billsWalked | remaining | failed | capHit |
|---|---|---|---|---|---|---|
| #27986 | 6:05:43 PM MT Oct 25 (00:05:43Z Oct 26) | success | 182 | 0 | 0 | false |
| #28046 | 12:05:44 AM MT Oct 26 (06:05:44Z) | success | 500 | 7,023 | 0 | true |
| #28113 | 6:05:43 AM MT (12:05:43Z) | success | 500 | 6,523 | 0 | true |
| #28186 | 12:05:43 PM MT (18:05:43Z) | success | 500 | 6,042 | 0 | true |

At 500 a tick and four ticks a day, 6,042 is 13 more ticks, the last near 6:05 PM MT Oct 29 (00:05Z Oct 30). That's a projection, not a reading. `remaining` fell 481 between the last two ticks, not 500, so bills newly owed a walk join as it goes.

## The sample (`--sample`, seed 1793058413)

- **The population:** every `bills` row with `update_date` at or after 2026-10-19T23:49:52Z (seven days before the run), 670 rows. 500 drawn by a seeded shuffle (mulberry32), so `--seed 1793058413` redraws them from the same population.
- **F**, read once before the first detail read: `2026-10-26T17:45:10Z`. F less 48 hours: `2026-10-24T17:45:10Z`.
- **Reads:** 500 details, 105 s, every one 200, none unread.

### The control, run before any class printed

Five sampled bills read current had U1 moved back one hour in memory, each eligible (U1 at or past 01:00Z so the day holds, and U2 < F). Five others read current had U1 moved back three days, each eligible (U2 < F − 48 h). Nothing was written.

| shift | id | U1 → shifted | U2 | reads |
|---|---|---|---|---|
| −1 h | 119-s-2702 | 2026-10-21T19:19:03Z → 18:19:03Z | 2026-10-21T19:19:03Z | same-day miss |
| −1 h | 119-hr-6025 | 2026-10-20T16:11:29Z → 15:11:29Z | 2026-10-20T16:11:29Z | same-day miss |
| −1 h | 119-hr-7177 | 2026-10-23T02:35:43Z → 01:35:43Z | 2026-10-23T02:35:43Z | same-day miss |
| −1 h | 119-s-3082 | 2026-10-24T11:03:40Z → 10:03:40Z | 2026-10-24T11:03:40Z | same-day miss |
| −1 h | 119-hr-7815 | 2026-10-20T08:05:22Z → 07:05:22Z | 2026-10-20T08:05:22Z | same-day miss |
| −3 d | 119-hr-2940 | 2026-10-23T08:05:41Z → 10-20 | 2026-10-23T08:05:41Z | wide-unreachable |
| −3 d | 119-s-1158 | 2026-10-22T16:27:17Z → 10-19 | 2026-10-22T16:27:17Z | wide-unreachable |
| −3 d | 119-hr-10083 | 2026-10-23T08:05:53Z → 10-20 | 2026-10-23T08:05:53Z | wide-unreachable |
| −3 d | 119-hr-7247 | 2026-10-23T08:05:43Z → 10-20 | 2026-10-23T08:05:43Z | wide-unreachable |
| −3 d | 119-hr-5769 | 2026-10-23T08:06:10Z → 10-20 | 2026-10-23T08:06:10Z | wide-unreachable |

Every other sampled bill read as it did unmodified. **The control passed.** A sampler that compared days would read all ten as current, and so would one never built.

**The first run's control failed, and what it caught.** The handoff's classes overlap: *same-day miss* is U2 > U1, U2 < F and the same day, while *wide-unreachable* is U2 > U1 and U2 < F − 48 h, on any day. The first build checked the window first, so all five −1 h bills, whose U2 is older than F − 48 h, read *wide-unreachable*, and the control said the reading was void before any class printed (`sample-1793058413-control-failed.log`). The second build puts the same day first. Below the frontier, a same-day late index is missed wherever U2 falls: inside the window the day compare passes it over, and beyond it the wide listing never lists it. *Wide-unreachable* is now a later day beyond the window. The reading marks each same-day miss that lies beyond the window.

### The reading, on the stored values

| class | count |
|---|---|
| current | 436 |
| pending (U2 ≥ F: the next frontier listing takes it) | 17 |
| **same-day miss** | **47** |
| wide-reachable | 0 |
| wide-unreachable | 0 |
| ahead | 0 |
| unread | 0 |

**The 47 same-day misses, with U1, U2 and the lag.** All 47 have U2 below F − 48 h, so the next wide listing won't reach them. The 24 marked ◆ are inside the first tick's wide window (U2 ≥ 13:53:37Z Oct 22).

| id | U1 | U2 | lag |
|---|---|---|---|
| 119-s-2316 | 2026-10-20T02:14:27Z | 2026-10-20T19:13:48Z | 16h 59m 21s |
| 119-hr-6223 | 2026-10-20T02:23:02Z | 2026-10-20T19:11:32Z | 16h 48m 30s |
| 119-hr-4724 | 2026-10-20T02:37:40Z | 2026-10-20T19:08:49Z | 16h 31m 09s |
| 119-hres-1630 | 2026-10-20T08:18:26Z | 2026-10-20T18:08:20Z | 9h 49m 54s |
| 119-hres-1632 | 2026-10-20T08:18:26Z | 2026-10-20T15:33:21Z | 7h 14m 55s |
| 119-hr-7412 | 2026-10-20T05:56:16Z | 2026-10-20T13:41:35Z | 7h 45m 19s |
| 119-hr-4615 | 2026-10-20T11:11:18Z | 2026-10-20T18:06:22Z | 6h 55m 04s |
| 119-hr-10375 | 2026-10-20T11:56:15Z | 2026-10-20T18:06:23Z | 6h 10m 08s |
| 119-hr-9718 | 2026-10-20T11:11:19Z | 2026-10-20T13:41:35Z | 2h 30m 16s |
| 119-s-5686 | 2026-10-20T15:30:09Z | 2026-10-20T17:55:11Z | 2h 25m 02s |
| 119-hr-10762 | 2026-10-20T16:37:58Z | 2026-10-20T18:45:37Z | 2h 07m 39s |
| 119-s-5390 | 2026-10-20T17:24:52Z | 2026-10-20T17:49:25Z | 0h 24m 33s |
| 119-hr-3174 | 2026-10-21T10:56:21Z | 2026-10-21T19:26:19Z | 8h 29m 58s |
| 119-hr-2388 | 2026-10-21T12:31:33Z | 2026-10-21T20:55:08Z | 8h 23m 35s |
| 119-hr-2481 | 2026-10-21T12:33:55Z | 2026-10-21T20:55:41Z | 8h 21m 46s |
| 119-hr-3620 | 2026-10-21T12:34:22Z | 2026-10-21T20:56:08Z | 8h 21m 46s |
| 119-hr-10844 | 2026-10-21T05:23:17Z | 2026-10-21T13:06:33Z | 7h 43m 16s |
| 119-hr-6833 | 2026-10-21T05:26:19Z | 2026-10-21T12:06:15Z | 6h 39m 56s |
| 119-s-5690 | 2026-10-21T14:31:32Z | 2026-10-21T21:07:50Z | 6h 36m 18s |
| 119-hr-7683 | 2026-10-21T05:51:21Z | 2026-10-21T12:06:15Z | 6h 14m 54s |
| 119-s-3715 | 2026-10-21T15:37:04Z | 2026-10-21T21:46:58Z | 6h 09m 54s |
| 119-hr-6380 | 2026-10-21T15:38:21Z | 2026-10-21T21:46:58Z | 6h 08m 37s |
| 119-hr-837 | 2026-10-21T15:26:08Z | 2026-10-21T21:14:38Z | 5h 48m 30s |
| ◆ 119-hr-10887 | 2026-10-23T08:23:19Z | 2026-10-23T16:54:55Z | 8h 31m 36s |
| ◆ 119-hr-10858 | 2026-10-23T08:23:19Z | 2026-10-23T16:38:31Z | 8h 15m 12s |
| ◆ 119-hres-1638 | 2026-10-23T08:48:26Z | 2026-10-23T17:02:51Z | 8h 14m 25s |
| ◆ 119-hr-10865 | 2026-10-23T08:23:20Z | 2026-10-23T16:37:20Z | 8h 14m 00s |
| ◆ 119-hr-10874 | 2026-10-23T10:53:24Z | 2026-10-23T16:53:24Z | 6h 00m 00s |
| ◆ 119-hr-10890 | 2026-10-23T08:06:11Z | 2026-10-23T13:58:33Z | 5h 52m 22s |
| ◆ 119-hr-10883 | 2026-10-23T08:06:13Z | 2026-10-23T13:58:33Z | 5h 52m 20s |
| ◆ 119-hjres-220 | 2026-10-23T08:18:23Z | 2026-10-23T13:58:33Z | 5h 40m 10s |
| ◆ 119-hr-10881 | 2026-10-23T08:23:19Z | 2026-10-23T13:58:34Z | 5h 35m 15s |
| ◆ 119-hr-10903 | 2026-10-23T08:23:19Z | 2026-10-23T13:58:34Z | 5h 35m 15s |
| ◆ 119-hr-10859 | 2026-10-23T08:23:19Z | 2026-10-23T13:58:33Z | 5h 35m 14s |
| ◆ 119-hr-10861 | 2026-10-23T08:23:19Z | 2026-10-23T13:58:33Z | 5h 35m 14s |
| ◆ 119-hr-10893 | 2026-10-23T08:23:19Z | 2026-10-23T13:58:33Z | 5h 35m 14s |
| ◆ 119-hr-10894 | 2026-10-23T08:23:19Z | 2026-10-23T13:58:33Z | 5h 35m 14s |
| ◆ 119-hr-10862 | 2026-10-23T08:23:20Z | 2026-10-23T13:58:33Z | 5h 35m 13s |
| ◆ 119-hr-10864 | 2026-10-23T08:23:20Z | 2026-10-23T13:58:33Z | 5h 35m 13s |
| ◆ 119-hr-10866 | 2026-10-23T08:23:20Z | 2026-10-23T13:58:33Z | 5h 35m 13s |
| ◆ 119-hr-10867 | 2026-10-23T08:23:20Z | 2026-10-23T13:58:33Z | 5h 35m 13s |
| ◆ 119-hr-10868 | 2026-10-23T10:53:24Z | 2026-10-23T16:03:01Z | 5h 09m 37s |
| ◆ 119-hr-10869 | 2026-10-23T10:53:24Z | 2026-10-23T13:58:34Z | 3h 05m 10s |
| ◆ 119-hr-10872 | 2026-10-23T10:53:24Z | 2026-10-23T13:58:34Z | 3h 05m 10s |
| ◆ 119-hr-10870 | 2026-10-23T10:53:24Z | 2026-10-23T13:58:33Z | 3h 05m 09s |
| ◆ 119-hr-10873 | 2026-10-23T10:53:24Z | 2026-10-23T13:58:33Z | 3h 05m 09s |
| ◆ 119-s-2787 | 2026-10-24T10:56:35Z | 2026-10-24T11:03:39Z | 0h 07m 04s |

By U2's day: Oct 20, 12; Oct 21, 11; Oct 23, 23; Oct 24, 1. 17 of the 23 on Oct 23 share one instant, 13:58:33Z or 13:58:34Z, a single Congress.gov batch.

**The 17 pending,** each with U2 between 19:25:19Z and 21:39:35Z Oct 26, above F: 119-hr-10827, 119-hr-10847, 119-hres-1629, 119-hr-10852, 119-hr-10845, 119-hr-7022, 119-hr-10849, 119-hr-10840, 119-hr-10841, 119-s-5682, 119-hr-10834, 119-hr-8800, 119-s-5531, 119-hr-10853, 119-hr-10796, 119-s-5687 and 119-hr-952. The next frontier listing takes them, from 6:00 PM MT Oct 26 (00:00Z Oct 27).

**The next tick, read after it** (`SELECT`, 6:04:20 PM MT Oct 26, 00:04:20Z Oct 27). #28252 (00:00:11Z, `success`, 27,904 ms) listed from F, `listedCount` 39, queued and wrote 40, and ran the day's wide listing from 17:45:10Z Oct 24 (`wideComplete` true). It moved the frontier to 23:45:12Z. **All 17 pending now read at their U2, and all 47 same-day misses still read at their U1,** as the reading predicts: the wide listing started above every one of them.

### What the stored rows say (`SELECT`, five of the 47)

`119-hr-10858`, `119-hr-10890`, `119-s-2316`, `119-s-2787` and `119-s-5390` carry `changed_at` from the old-code ticks of 12:00Z Oct 23, 12:00Z Oct 23, 06:00Z Oct 20, 12:00Z Oct 24 and 18:00Z Oct 20. In each, `raw_json`'s `updateDate` and `updateDateIncludingText` both equal the stored `update_date`. So each was written from a detail that read U1 at the time, and Congress.gov moved it again later that day. The old sync's compare (`stored >= listUpdate` against a bare day) read the second update as current, HO 790's leg F, red at `b64cc81`. The frontier began at 13:53:37Z Oct 24, after every U2 here.

## What the reading means

- **For the 15-minute margin: nothing yet.** Only 16 sampled bills had U1 at or after 13:53:37Z Oct 24, the frontier's bootstrap. All 16 read current. That's one day of frontier ticks, too few to measure the margin. The close asks for three monthly runs reading 0, and run 1 reads 47, all from before the frontier.
- **For the residual HO 790's pass left: it exists at second precision.** Census 790b read 0 behind because it compares the list's bare day with the stored day, and every one of the 47 is behind on its own stored day. The census reads this class current whether or not it's there, as backlog `:15` says of it. In the 670-row population the sample's rate is 47 of 500, so about 63 bills, an estimate. The corpus before Oct 20 wasn't sampled, and the old code ran this compare for months, so that population is unmeasured.
- **What reaches them: nothing on the live path.** Every U2 is below F − 48 h, so no frontier listing or wide listing will list them again. Each stays behind until Congress.gov updates it again. The 24 inside the first tick's wide window were in its filter, and its day compare passed over them. That is the `:15` shape running live, on bills the old code had already left behind.
- **The separating measurement for the next HO:** this sampler over a population stored before the frontier, by month, sizes the residual. A frontier-era population of at least a few hundred (a month of ticks) is what measures the margin.

## Not done, by the guards

No prod write, no `/api/sync` call, no enqueue, no change to the margin, the window, the day compare or the route. The 47 are a reading for the next HO.
