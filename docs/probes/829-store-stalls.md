# HO 829 — the Nov 20 stalls: *can't say*, because no Production cron was in flight during any of the three

> **Diagnostic-only probe, not wired.** Base `main` at `7cc2fc9`. Run Sunday 2026-11-22, Mountain Standard Time (a fixed UTC−7; Nov 20 is standard time) with UTC beside.
> - **One run** of `scripts/diagnostic/store-stalls-829.ts` read `cron_runs`, clock 11/22/2026, 2:50:31 PM MST (2026-11-22T21:50:31.964Z). Two earlier runs, on the stalls' first-guess edges and two controls, read the same rows; the final run is the record.
> - **Prod's store was read by `SELECT` only.** libSQL's client has no read-only open for a remote URL, so the run guards the singleton client with HO 824's guard. The guard refuses:
>   - any statement that isn't a read, or that carries a write word outside its comments and string literals;
>   - any batch not in `read` mode;
>   - every transaction.
>
>   14 statements passed it, all reads.
> - **Beyond § 1's letter, Vercel's own record** of the functions' requests to the store's host, read through the Vercel MCP's read-only observability query: 10 queries (`docs/handoffs/829-artifacts/vercel-metrics-829.md`). The host is named there by hash, not spelled out.
> - **The PC's side** is HO 828's own artifacts, swept for every slow and normal reading and checked by a second reader, and Windows' event logs, read with `Get-WinEvent` (log, provider, id, level and time only; no message text).
> - **No product code, no test change, no write.** Nothing was cleared or changed in Windows' logs.
>
> The run's JSON and text, the sweep (`pc-side-828-readings.md`), the event list (`winevents-829.tsv`) and the Vercel readings are in `docs/handoffs/829-artifacts/` (repo-ignored).

## The verdict: *can't say*

**§ 1.C's test reads *the PC's side*, but it can't fire on these stalls.**
- **Every Production cron within 15 minutes of a stall ran inside its slot's 95th percentile,** as every control row did. The windows' slot ratios run 0.71 to 3.11.
  - News at 9:00 PM (S2) reads 3.11, above every control row. It's still inside its slot's p95.
  - **The controls' 0.31 to 2.5 isn't an independent range.** The 2.5 is S1's own 6:00 PM news row, and every `:00` row in the controls is a stall-window row. For the `:00` runs, *usual* rests on A2's slot p95 and on A4's daytime runs, not on the controls.
- **No cron was in flight during any stall's own span.** The top-of-hour runs ended 2.6 to 3.8 minutes before each stall began (6:00:24, 9:00:28 and 10:00:23 PM), and the next run, at `:10`, started after it ended.
- So the rows show what the store did on either side of each stall, not during it. Under guard 3 a verdict the rows don't carry is *can't say*.

**Each stall leans its own way, none of them far:**
- **Stall 1 (6:04:14 to 6:06:50 PM) leans to the store.**
  - **Every statement slowed, the page-reading ones far more,** in two probes on the PC:
    - **6:05:19:** a plain `SELECT 1` answered in 397 ms (173 to 194 ms in the evening's other probes), and a one-row read by index in 151 ms (28 to 34 ms). The old footer count, index-only on `idx_bills_dash_stage`, took 4,958 ms (252 to 259 ms later that night), and the badge's past-committee count, which reads table rows, took 9,934 ms (46 to 699 ms).
    - **6:06:27:** `SELECT 1` 194 ms, the index-only count still 1,698 ms, the past-committee count a normal 234 ms.
  - **The 10 s aborts:** around those two probes, five statements in five separate processes, three tsx scripts and both local servers, hit the 10 s abort seven times, so it wasn't one connection's fault.
  - **Production's one request to the store in the spell,** prod `/stale` at 6:06 PM, took 3,802 ms (Vercel). The PC read that page's first byte at 4.11 s. Prod `/stale`'s other hours that evening peaked at 491 to 1,296 ms, so this one is about 2.9 times the next. The day's other hours above 3.8 s all fall from 1 to 3 PM.
  - **Why the lean stops short:** every reading was taken one after another, never at the same moment, so a PC-side fault lasting seconds could still give this pattern. And one request isn't a cron.
- **Stall 2 (9:03:34 to 9:05:33 PM) reads both ways.**
  - **For the PC:** Windows logged Tcpip 4231 at 9:03:55.563 PM, 0.29 s after the crawl's request for `/stale?chamber=house` went out and never got an answer. Microsoft documents 4231 as this PC's ephemeral TCP ports all in use; the event's own text wasn't read. It's the evening's only Tcpip event.
  - **For the store, and first:** the `?stage=floor` count's request went out about 9:03:34, its first attempt aborted at 10 s (a `[db] timeout, retrying` line, ~9:03:44) and its retry aborted too (the `[stale]` line's `TimeoutError`, ~9:03:54). All of that came about 20 s before the 4231, placed by test order since the log has no clock. The log's other `retrying` line also falls before the `[stale]` line; its statement and time aren't known.
  - **Neutral:** the crawl's other worker loaded its pages at about their usual speed through the 45 s hang. Those routes had loaded earlier in the run, so they may have come from the server's cache without touching the store.
  - **Production's side:** no Vercel function touched the store from 9:01 to 9:05, and no cron was in flight.
- **Stall 3 (10:02:59 to 10:05:53 PM) leans weakly away from the store, without pointing at the PC.**
  - Run 4's server log has no `[db]` line and no `TimeoutError`, so through two 45 s hangs and nine slow tests no store request from the PC hit the 10 s abort.
  - Run 4 is the only crawl run that began within a second of a cold build's log being last written (23 workers, 10:02:58.96 PM). Run 3, normal, began about a minute after its build.
  - No Vercel request to the store from 10:01 to 10:06, no cron in flight, and nothing in Windows' logs beyond the routine.

## STEP 0

STEP 0 held at `7cc2fc9` (`829-artifacts/step0-829.md`):
- `main` is alone on the remote, and the roadmap pointer reads 828.
- The reconcile reads 283 / 400 / 683.
- The catch and the test read as the handoff says.
- `cron_runs` reaches back to May 21, with 42 rows started from 01:00 to 05:30 UTC Nov 21.

## A. Production's side, from `cron_runs`

**How a row times the store.** `startCronRun` stamps `started_at` from the function's clock before its first statement (`lib/cron-log.ts:48`). `finishCronRun` computes `elapsed_ms` in the store from that stamp to the function's clock before its last statement (`:69-73`). A store that stalls inside a run lengthens it.

### A1. Which crons write rows

All 19 paths in `vercel.json` wrote rows in the baseline week. None is invisible here.

| Path | Schedule | Runs, Nov 13 to 20 |
|---|---|---|
| `/api/cron/summarize` | `*/10 * * * *` | 1,006 |
| `/api/cron/news` | `*/30 * * * *` | 336 |
| `/api/cron/kalshi` · `/api/cron/general-ballot` | `15 */2` · `20 */2` | 84 each |
| `/api/cron/bill-rosters` | `40 */3` | 56 |
| `/api/cron/markets` | `0 */4` | 42 |
| `/api/sync` · `/api/cron/committees` | `0 */6` · `5 */6` | 28 each |
| `/api/cron/committee-meetings` · `/api/cron/primaries` | `50 */12` · `0 0,12` | 14 each |
| nine daily or weekly paths | | 1 to 7 each |

### A2. The baseline

Success rows' `elapsed_ms`, Nov 13 00:00 to Nov 20 00:00 MST. The median is the middle value, or the mean of the middle two; p95 is the nearest rank.

**Read per slot as well (an addition to the handoff's A2).** A route's runs differ by the minute past the hour. Summarize's `:00` run follows news' `:00` run every hour: its all-slot median is 109 ms, but its `:00` slot's is 600 ms. So a ratio to the all-slot median flags every top-of-hour run, and the tables below carry both.

| Slot | Runs | Median | p95 | Max |
|---|---|---|---|---|
| summarize `:00` | 166 | 600 | 2,705 | 15,933 |
| summarize `:10` to `:50` | 168 each | 80 to 113 | 418 to 5,000 | 1,423 to 37,677 |
| news `:00` | 167 | 7,697 | 36,686 | 47,168 |
| news `:30` | 168 | 7,283 | 13,911 | 45,489 |
| markets `:00` | 42 | 4,335.5 | 5,550 | 7,604 |
| kalshi `:15` | 84 | 35,884.5 | 37,889 | 40,308 |
| general-ballot `:20` | 84 | 235,019.5 | 235,801 | 236,804 |
| committee-meetings `:50` | 14 | 16,056.5 | 21,166 | 21,166 |
| bill-rosters `:40` | 56 | 120,821 | 235,159 | 246,903 |

The full table, every route and slot, is in `store-stalls-829.txt`.

### A3. The windows

Each stall's span runs from its first slow reading on the PC to its last (B1). Each window is read 15 minutes either side. *Did* is the run's own payload: bills summarized, feeds read, rows written.

**The controls,** picked from HO 828's artifacts as spans the same evening where the PC read the store normally (the sweep's candidates, `pc-side-828-readings.md`). Each core is clear of every stall's window, but their padding overlaps the stalls'. C1 and S1 share the 5:50 and 6:00 PM runs, C2 and S2 the 9:10, 9:15 and 9:20 PM runs, and C3 and S3 the 9:50 and 10:00 PM runs, so 10 of the stall windows' 18 rows are also control rows. None sits at `:03` to `:06` past an hour, so the controls don't test the minute. The PC read nothing at those minutes of any other hour that evening. Its only normal readings there fall in the stall hours themselves: crawl run 1's tests to ~9:03:34, the other worker's pages during the 9:03:55 hang, `index-rows-828.ts` at 6:06:50 and crawl run 4 from ~10:06. All are too close to a stall to serve as a control.

#### S1: stall 1, 6:04:14 to 6:06:50 PM

From the start of `index-rows-828.ts` (6:04:14; its second statement hit the spell's first 10 s abort at least 10 s later) to the end of Leg D's second re-read (6:06:50, its log's last write; its slow first statement ended about 6:06:46). Read 5:49:14 PM to 6:21:50 PM MST. **In flight during the span itself: 0.**

| Route | Start | End | elapsed_ms | Status | Route median · p95 · ratio | Slot | Slot median · p95 · ratio | Did |
|---|---|---|---|---|---|---|---|---|
| summarize | 5:50:23 PM | 5:50:23 PM | 119 | success | 109 · 1,472 · 1.09 | :50 | 106 · 638 · **1.12** | summarized 0 |
| committee-meetings | 5:50:44 PM | 5:50:57 PM | 13,676 | success | 16,056.5 · 21,166 · 0.85 | :50 | 16,056.5 · 21,166 · **0.85** | refreshed 5 |
| news | 6:00:04 PM | 6:00:23 PM | 19,273 | success | 7,397 · 29,633 · 2.61 | :00 | 7,697 · 36,686 · **2.5** | 3 feeds |
| summarize | 6:00:23 PM | 6:00:24 PM | 852 | success | 109 · 1,472 · 7.82 | :00 | 600 · 2,705 · **1.42** | summarized 0 |
| summarize | 6:10:23 PM | 6:10:23 PM | 127 | success | 109 · 1,472 · 1.17 | :10 | 113 · 5,000 · **1.12** | summarized 0 |
| summarize | 6:20:23 PM | 6:20:23 PM | 101 | success | 109 · 1,472 · 0.93 | :20 | 111 · 486 · **0.91** | summarized 0 |

#### S2: stall 2, 9:03:34 to 9:05:33 PM

Crawl run 1: `/stale?stage=floor` 20.5 s, `?chamber=house` past 45 s, and two tests at 17 s. Read 8:48:34 PM to 9:20:33 PM MST. **In flight during the span itself: 0.**

| Route | Start | End | elapsed_ms | Status | Route median · p95 · ratio | Slot | Slot median · p95 · ratio | Did |
|---|---|---|---|---|---|---|---|---|
| summarize | 8:50:23 PM | 8:50:23 PM | 97 | success | 109 · 1,472 · 0.89 | :50 | 106 · 638 · **0.92** | summarized 0 |
| markets | 9:00:01 PM | 9:00:04 PM | 3,089 | success | 4,335.5 · 5,550 · 0.71 | :00 | 4,335.5 · 5,550 · **0.71** | ticked 9 |
| news | 9:00:04 PM | 9:00:28 PM | 23,959 | success | 7,397 · 29,633 · 3.24 | :00 | 7,697 · 36,686 · **3.11** | 3 feeds |
| summarize | 9:00:23 PM | 9:00:24 PM | 694 | success | 109 · 1,472 · 6.37 | :00 | 600 · 2,705 · **1.16** | summarized 0 |
| summarize | 9:10:23 PM | 9:10:23 PM | 108 | success | 109 · 1,472 · 0.99 | :10 | 113 · 5,000 · **0.96** | summarized 0 |
| kalshi | 9:15:10 PM | 9:15:46 PM | 35,897 | success | 35,884.5 · 37,889 · 1 | :15 | 35,884.5 · 37,889 · **1** | seats 5 |
| summarize | 9:20:23 PM | 9:20:23 PM | 109 | success | 109 · 1,472 · 1 | :20 | 111 · 486 · **0.98** | summarized 0 |

#### S3: stall 3, 10:02:59 to 10:05:53 PM

Crawl run 4's slow start: two `/electoral` documents past 45 s. Read 9:47:59 PM to 10:20:53 PM MST. **In flight during the span itself: 0.**

| Route | Start | End | elapsed_ms | Status | Route median · p95 · ratio | Slot | Slot median · p95 · ratio | Did |
|---|---|---|---|---|---|---|---|---|
| summarize | 9:50:23 PM | 9:50:23 PM | 123 | success | 109 · 1,472 · 1.13 | :50 | 106 · 638 · **1.16** | summarized 0 |
| news | 10:00:04 PM | 10:00:19 PM | 15,044 | success | 7,397 · 29,633 · 2.03 | :00 | 7,697 · 36,686 · **1.95** | 3 feeds |
| summarize | 10:00:23 PM | 10:00:23 PM | 556 | success | 109 · 1,472 · 5.1 | :00 | 600 · 2,705 · **0.93** | summarized 0 |
| summarize | 10:10:23 PM | 10:10:23 PM | 114 | success | 109 · 1,472 · 1.05 | :10 | 113 · 5,000 · **1.01** | summarized 0 |
| summarize | 10:20:23 PM | 10:20:23 PM | 102 | success | 109 · 1,472 · 0.94 | :20 | 111 · 486 · **0.92** | summarized 0 |

#### C1: control 1, 5:36:38 to 5:47:55 PM

Legs E, A, B, C and D, and crawl run 0 (237 of 237). Read 5:21:38 PM to 6:02:55 PM MST. **In flight during the span itself: 2** (bill-rosters 5:40:03 PM, summarize 5:40:24 PM).

| Route | Start | End | elapsed_ms | Status | Route median · p95 · ratio | Slot | Slot median · p95 · ratio | Did |
|---|---|---|---|---|---|---|---|---|
| general-ballot | 5:20:35 PM | 5:24:30 PM | 235,343 | success | 235,019.5 · 235,801 · 1 | :20 | 235,019.5 · 235,801 · **1** | rows written 97 |
| news | 5:30:04 PM | 5:30:14 PM | 9,640 | success | 7,397 · 29,633 · 1.3 | :30 | 7,283 · 13,911 · **1.32** | 3 feeds |
| summarize | 5:30:23 PM | 5:30:23 PM | 74 | success | 109 · 1,472 · 0.68 | :30 | 80 · 418 · **0.93** | summarized 0 |
| bill-rosters | 5:40:03 PM | 5:40:41 PM | 37,937 | success | 120,821 · 235,159 · 0.31 | :40 | 120,821 · 235,159 · **0.31** | changed bills 59 |
| summarize | 5:40:24 PM | 5:40:24 PM | 109 | success | 109 · 1,472 · 1 | :40 | 107 · 707 · **1.02** | summarized 0 |
| summarize | 5:50:23 PM | 5:50:23 PM | 119 | success | 109 · 1,472 · 1.09 | :50 | 106 · 638 · **1.12** | summarized 0 |
| committee-meetings | 5:50:44 PM | 5:50:57 PM | 13,676 | success | 16,056.5 · 21,166 · 0.85 | :50 | 16,056.5 · 21,166 · **0.85** | refreshed 5 |
| news | 6:00:04 PM | 6:00:23 PM | 19,273 | success | 7,397 · 29,633 · 2.61 | :00 | 7,697 · 36,686 · **2.5** | 3 feeds |
| summarize | 6:00:23 PM | 6:00:24 PM | 852 | success | 109 · 1,472 · 7.82 | :00 | 600 · 2,705 · **1.42** | summarized 0 |

#### C2: control 2, 9:21:10 to 9:27:43 PM

The Leg A plants and the day-cross probe. Read 9:06:10 PM to 9:42:43 PM MST. **In flight during the span itself: 1** (general-ballot 9:20:35 PM).

| Route | Start | End | elapsed_ms | Status | Route median · p95 · ratio | Slot | Slot median · p95 · ratio | Did |
|---|---|---|---|---|---|---|---|---|
| summarize | 9:10:23 PM | 9:10:23 PM | 108 | success | 109 · 1,472 · 0.99 | :10 | 113 · 5,000 · **0.96** | summarized 0 |
| kalshi | 9:15:10 PM | 9:15:46 PM | 35,897 | success | 35,884.5 · 37,889 · 1 | :15 | 35,884.5 · 37,889 · **1** | seats 5 |
| summarize | 9:20:23 PM | 9:20:23 PM | 109 | success | 109 · 1,472 · 1 | :20 | 111 · 486 · **0.98** | summarized 0 |
| general-ballot | 9:20:35 PM | 9:24:30 PM | 235,325 | success | 235,019.5 · 235,801 · 1 | :20 | 235,019.5 · 235,801 · **1** | rows written 113 |
| news | 9:30:04 PM | 9:30:13 PM | 8,748 | success | 7,397 · 29,633 · 1.18 | :30 | 7,283 · 13,911 · **1.2** | 3 feeds |
| summarize | 9:30:23 PM | 9:30:23 PM | 77 | success | 109 · 1,472 · 0.71 | :30 | 80 · 418 · **0.96** | summarized 0 |
| summarize | 9:40:23 PM | 9:40:23 PM | 93 | success | 109 · 1,472 · 0.85 | :40 | 107 · 707 · **0.87** | summarized 0 |

#### C3: control 3, 9:37:16 to 9:46:39 PM

The cache-key legs, crawl run 3 (237 of 237), and Legs B and A. Read 9:22:16 PM to 10:01:39 PM MST. **In flight during the span itself: 1** (summarize 9:40:23 PM).

| Route | Start | End | elapsed_ms | Status | Route median · p95 · ratio | Slot | Slot median · p95 · ratio | Did |
|---|---|---|---|---|---|---|---|---|
| general-ballot | 9:20:35 PM | 9:24:30 PM | 235,325 | success | 235,019.5 · 235,801 · 1 | :20 | 235,019.5 · 235,801 · **1** | rows written 113 |
| news | 9:30:04 PM | 9:30:13 PM | 8,748 | success | 7,397 · 29,633 · 1.18 | :30 | 7,283 · 13,911 · **1.2** | 3 feeds |
| summarize | 9:30:23 PM | 9:30:23 PM | 77 | success | 109 · 1,472 · 0.71 | :30 | 80 · 418 · **0.96** | summarized 0 |
| summarize | 9:40:23 PM | 9:40:23 PM | 93 | success | 109 · 1,472 · 0.85 | :40 | 107 · 707 · **0.87** | summarized 0 |
| summarize | 9:50:23 PM | 9:50:23 PM | 123 | success | 109 · 1,472 · 1.13 | :50 | 106 · 638 · **1.16** | summarized 0 |
| news | 10:00:04 PM | 10:00:19 PM | 15,044 | success | 7,397 · 29,633 · 2.03 | :00 | 7,697 · 36,686 · **1.95** | 3 feeds |
| summarize | 10:00:23 PM | 10:00:23 PM | 556 | success | 109 · 1,472 · 5.1 | :00 | 600 · 2,705 · **0.93** | summarized 0 |

### A4. The 24 hours around

**The span: Nov 20 9:00 AM to Nov 21 9:00 AM MST,** centred on the stalls' evening. 250 runs, 41 of them not success or over three times their route's median. **In the stall windows only the `:00` runs are among them, each inside its own slot's p95.**
- **The top-of-hour runs:** most of the 41 are summarize's and news' `:00` runs. Each is over its route's all-slot median, and all but the three news runs below sit inside their own slot's p95 (A2).
- **Runs that did work:** six of summarize's summarized bills: 151 at 5:10 PM (38,372 ms), 24 at 11:10 PM, 4 at 11 PM, 8 at 11:10 AM, 83 at 5:10 AM and 1 at 5 AM. That's Gemini's time, not the store's. Committees at 11:05 PM (106,988 ms, 4.27 times its median, a success) sits inside its slot's p95 (118,521).
- **Off the hour, nothing done:** summarize at 12:20 PM (603 ms) and 7:40 AM (443 ms), each `summarized 0`.
- **Past their slot's p95:** news at 9 AM (44,860 ms), 10 AM (38,407 ms) and 11 AM (46,300 ms, `budgetStopped`), against the `:00` slot's 36,686; and summarize at 12:20 PM (603 ms, summarized 0), against the `:20` slot's 486.
- **The failures:**
  - committees, 11:05 AM: error, *The operation was aborted due to timeout*, 37,889 ms;
  - lda-rollup, 3 PM: soft timeout, 290,233 ms;
  - sync-votes, Nov 21 3 AM: soft timeout, 55,063 ms;
  - sync-race-ratings, Nov 21 4 AM: Sabato's 403, 356 ms.
- **Between 5:30 and 11 PM:** no failed run, and every run in the A3 windows sits inside its slot's p95. A4's filter (three times the route's median) sits below the slot's p95 for summarize's and news' `:00` runs, so none of those passed it unlisted. The probe didn't print news' `:30` runs at 6:30, 7:30, 8:30 and 10:30 PM (slot p95 13,911, under the filter's 22,191) or bill-rosters at 8:40 PM, so whether those passed their slot's p95 isn't read.

### A+. Vercel's own record (beyond § 1's letter)

Every request a function made to the store's host, by minute (`vercel-metrics-829.md`):
- **Stall 1:** one Production request, prod `/stale` at 01:06 UTC (6:06 PM MST): **3,802 ms**. Its 5-minute bucket's p95 reads 3,792, against 25 to 490 in the evening's other Production buckets the tool returned, but one, which read 1,272 at 9:35 PM.
- **Stall 2:** no request from 04:01 to 04:05 UTC.
- **Stall 3:** no request from 05:01 to 05:06 UTC.
- **Prod `/stale`'s own range that day:** the evening's other hours peaked at 491 to 1,296 ms (5, 8 and 9 PM), so 3,802 ms is about 2.9 times the next. The day's hours above 3.8 s all fall from 1 to 3 PM (25,662 ms at 1 PM over two requests with a median of 9,984; 5,958 and 4,481 ms after), around HO 827's deploy (served from about 2:27:52 PM). Noon's maximum was 3,234 ms. So against the evening the one request stands out, and against the day it doesn't; one request can't carry § 1.C either way.

## B. The PC's side

### B1. The slow readings, from HO 828's artifacts

A second reader re-opened every cited `file:line`. 18 of 21 rows held as written, and three held in part (the corrections are applied below). Three readings the first pass left out of its slow table are added: prod `/stale`'s curl at ~6:06:08, run 4's trends test (inside *nine more tests*), and narrow-preview's two fold tests (below). The second reader named three more that aren't rows here: run 4's `/stale?stage=floor` at 5.0 s and the footer test at 3.5 s, both ~10:09:30, about 4 minutes after stall 3, and Leg E's first cold `/stale` at 5:36:55 (first byte 4.18 s), inside C1's span. Times are MST, Nov 20.

| MST | What, and which process | Outcome | `[db]` line | `SELECT 1` nearest |
|---|---|---|---|---|
| 6:04:14 | `index-rows-828.ts` (tsx, fresh process), its second statement | 10 s abort, the retry aborted too | the script's own; its log was overwritten at 6:06:50 | 6:05:19, 397 ms |
| 6:04:46 | `legD-828.ts` re-read (tsx, fresh) | two 10 s aborts; the process threw | yes, `legD-reread.log:2` | 6:05:19, 397 ms |
| 6:05:19 | `store-probe-828.ts` (tsx): `SELECT 1`, then the old footer count | **397 ms**, then **4,958 ms** (252 to 259 ms later that night) | none | the same probe |
| 6:05:24 | the same probe: the past-committee count | **9,934 ms** (46 to 699 ms later); one row by index right after, 151 ms | none | 397 ms |
| 6:05:47 | curl → `next start` :3911, the base's build: uncached `/stale?topics=agriculture` | 500 at 10.03 s; the repeat 200 in 0.06 s | none; Next logged `TimeoutError`, so the abort came while the body was read | 397 ms, 28 s before |
| ~6:05:58 to 6:06:09 | curl → `next start` :3912, HEAD's build: the same page | 200 at 11.19 s | yes, `server-head-2.log:12` | 397 ms and 194 ms |
| ~6:06:08 to 6:06:13 | curl → prod `/stale` | 200, first byte 4.11 s | — | 194 ms, 6:06:27 |
| 6:06:27 | the probe, second run | **`SELECT 1` 194 ms**, the old count **1,698 ms**, the past-committee count 234 ms | none | the same probe |
| 6:06:33 | `legD-828.ts` re-read 2 | 12,786 ms: one 10 s abort, then the retry in ~2.8 s; warm runs 160 and 190 ms | yes, `legD-reread-2.log:2` | 194 ms, 6 s before |
| ~9:03:34 to 9:03:55 | crawl run 1 (Playwright, 2 workers → :3912, `e084e57`'s build): `/stale?stage=floor` | 20.5 s (0.58 to 1.3 s in four other runs; run 4 read 5.0 s) | the log, which has no clock, holds two `[db] timeout, retrying` lines and the `[stale]` count failure with `"stage":"floor"` and a `TimeoutError`. Test order puts one retry line at ~9:03:44 and the `[stale]` line at ~9:03:54; the other retry line's statement and time aren't known | 9:08:09, 173 ms |
| **9:03:55.273** | crawl run 1: the document `GET /stale?chamber=house` | **no response; the 45 s goto timed out.** Its link prefetches had answered in 4 to 11 ms at 9:03:55.24 | none in the 45 s | 9:08:09, 173 ms |
| ~9:03:55 to 9:04:36 | crawl run 1, **the other worker**, during the hang | #164 to #169 (six routes) at 5.5 to 6.0 s (5.4 to 5.9 s in the other runs); #162 `/races`, begun just before the hang, 6.6 s against 5.8 to 5.9 s. All had loaded earlier in the run, so they may have come from the server's cache | none | — |
| ~9:04:46 to 9:05:33 | crawl run 1: four tests (`/welcome` search 17.8 s, dashboard search 17.0 s, two more at 3.2 and 4.3 s) | 2 to 7 times their other runs' slowest | none | 9:08:09, 173 ms |
| ~10:02:59 to 10:03:15 | crawl run 4 (→ :3912, `1837511`'s build, cold, its build's log last written at 10:02:58.96): narrow @430 `/` and `/?stage=introduced` | 15.7 and 15.6 s (6.0 to 6.8 s in other runs) | none in the whole run | 10:13:01, 174 ms |
| **10:03:38.435** and **10:03:39.367** | crawl run 4: narrow @430, the document `GET /electoral`, twice (after `/races`' 308 in 13 ms) | **no response; each 45 s goto timed out** | none | 10:13:01, 174 ms |
| ~10:03:25 to 10:05:53 | crawl run 4: nine more tests (`/news` 20.7 s, `/stale` 36.3 s, `/electoral` 2028 18.2 s, …) | about 2 to 8 times their other runs' slowest | none | 10:13:01, 174 ms |

**No cold build overlaps any stall.** HO 828's 29 build logs ran 28 to 49 s each. The nearest before each stall ended at 5:51:18 PM, 8:56:12 PM and 10:02:58 PM, the last 1 s before crawl run 4 began. After stall 1, the next started at 6:08:06 PM, 76 s after its span.

**Not the PC's:** narrow-preview `44848539882` (GitHub's runner → the Vercel Preview, 6:10 to 6:17 PM) read two fold tests at 19.8 and 23.9 s, against 9.0 and 9.4 s in the later run. Vercel's Preview requests to the store in those minutes read p95 262 and 656 ms.

### B2. Windows' own record

The PC's zone is *Mountain Standard Time*, UTC−7 on Nov 20. **The Nov 22 restart took nothing:** every enabled log that covers Nov 20 still holds the evening (System from Jun 25, Application from Sep 14, Defender from Nov 9).

**Not recorded at all:**
- Task Scheduler's operational log is disabled and empty, so whether a scheduled task started in a window can't be read from Windows.
- The DNS client's operational log is disabled. The System log, where a DNS 1014 timeout is written, has none from Nov 20 noon to Nov 21 6 AM.
- Diagnostics-Performance needs an elevated read, which wasn't taken.

**The evening, 5 to 11:30 PM** (326 events, `winevents-829.tsv`):
- **The routine:** Defender 1160 ×4 every ten minutes at `:x4:20` to `:x4:33`, hcmon 0 and the Defender 1150/1151 pair at `:53`, and Security-SPP start/stop pairs at irregular times.
- **The irregular, all outside the stalls:**
  - a Windows Update install at 5:20 to 5:22 PM, 42 minutes before stall 1, with Defender's intelligence update;
  - a Windows Error Reporting burst of 27 at 5:10 PM and another at 9:52 PM;
  - an update scan at 7:03 PM;
  - 13 AppModel-State 4 events at 6:53:19 PM;
  - Time-Service events at 6:53, 7:10, 7:27, 7:44, 8:01 and 11:26 PM, ending in the evening's one system time change (Kernel-General 1) at 11:26:38 PM.
- **What the logs don't show anywhere:** no Defender scan, no sleep, no network or profile change.

**Per stall:**
- **Stall 1:** only the routine (the SPP pair at 6:04:14 and 6:04:46; 1160 ×4 at 6:04:20 to 29, as every hour).
- **Stall 2: Tcpip 4231 at 9:03:55.563 PM,** 0.29 s after `?chamber=house` went out. It's the evening's only Tcpip event, and nothing else in any window has no counterpart elsewhere in the evening.
  - **What 4231 means:** Microsoft's published Tcpip event list describes it as a failed allocation of an ephemeral TCP port because all are in use: port exhaustion on this PC. That meaning comes from the documentation; the event's own text wasn't read. These logs also can't show whether Windows suppresses a repeat 4231, so *only the routine* in stalls 1 and 3 doesn't rule one out there.
  - **It recurs:** the retained System log holds 16 since Jul 5, among them Nov 6 12:00:51, Nov 13 10:36:19 and Nov 16 12:00:33.
- **Stall 3:** only the routine. Nothing is logged from 9:54:29 to 10:04:20 PM.

## C. The verdict, with the rows

**Can't say.** The rows that carry it:
- **The test can't fire.** A3's in-flight count is 0 for S1, S2 and S3. Every row in the three windows sits inside its slot's p95, as do the controls', so by § 1.C's wording the rows read *the PC's side*. But none was in flight during a stall, so they can't say what the store did then.
- **Stall 1 leans to the store.**
  - **B1's two probes:** at 6:05:19, a 397 ms `SELECT 1` (about twice the evening's other probes) and a 151 ms one-row read (about five times), beside counts of 4,958 ms (index-only) and 9,934 ms (table rows). At 6:06:27, a 194 ms `SELECT 1` beside the index-only count at 1,698 ms.
  - **B1's aborts:** seven 10 s aborts across five statements in five processes (6:04:14, 6:04:46, 6:05:47, ~6:05:58, 6:06:33).
  - **A+:** Production's one store request in the spell took 3,802 ms, about 2.9 times prod `/stale`'s other hours that evening.
  - **Short of a verdict:** the PC's readings came one after another, not at once, and one request isn't a cron.
- **Stall 2 reads both ways.**
  - **For the PC:** B2's Tcpip 4231 at 9:03:55.563, for the 45 s hang.
  - **For the store, and first:** B1's `?stage=floor` count aborted at 10 s, and again on its retry, about 20 s before the 4231.
  - **Neutral:** the other worker's speed (its pages may have come from cache), and A+, with no Production request in the span.
- **Stall 3 leans weakly away from the store.**
  - **No abort:** B1 holds no `[db]` line and no `TimeoutError` in run 4's log through two 45 s hangs, so no store request from the PC reached 10 s. Stalls 1 and 2 each logged aborts.
  - **The build:** run 4 began about 1 s after a cold build's log was last written.
  - **Nothing else:** no Production request, no cron in flight, and only the routine in Windows' logs.

## The chat's two guesses

**1. The top-of-hour crons** (summarize `*/10` and news `*/30` at `:00`; markets at 04:00 UTC).
- **Not supported as load during the stalls.** In each stall's hour the `:00` runs had ended 2.6 to 3.8 minutes before it began:
  - news ended at 6:00:23, 9:00:28 and 10:00:19 PM;
  - summarize at 6:00:24, 9:00:24 and 10:00:23 PM;
  - markets at 9:00:04 PM.
- **Their times were usual for the slot:** ratios 0.71 to 3.11, each inside the slot's p95. Markets' 04:00 UTC run took 3,089 ms (0.71).
- **What the rows can't rule out is an after-effect, and one fact fits an hourly cause.** Each stall began 3 to 4 minutes past an hour and was over by 7 past. The PC read the store at `:03` to `:06` in only three hours that evening, 6, 9 and 10 PM: it read only at 3:37 to 3:39, 5:29 to 6:07 and 8:51 to 10:21 PM (`pc-side-828-readings.md`). It was slow in all three and stalled nowhere else.
  - **A cron after-effect fits:** news' `:00` run sends 442 requests to the store in its first minute (Vercel, 01:00 UTC).
  - **So does an hourly task on the PC,** since Task Scheduler's log is off.
  - **Neither is singled out:** every hour has news' run, and the controls don't sit at `:03` to `:06`, so the rows neither support nor rule out either.

**2. The Microsoft updates and the restarts on Nov 22.**
- **Not supported.** Every update and restart the chat had in mind came after the last stall (10:03 PM Nov 20):
  - Windows Update installed in five groups on Nov 21: 5:45 AM, 6:21 to 6:22 AM (7 updates), 9:20 AM (two installs failed), 6:26 PM and 7:03 PM;
  - on Nov 22 it installed again at 1:04, 9:01 and 9:35 AM;
  - the PC restarted twice on Nov 22, at 12:59 and 1:03 AM, about 27 hours after the last stall.
- On Nov 20 the one update install finished at 5:22 PM, 42 minutes before stall 1, and the PC read the store normally in between (C1).
- No install, scan, sleep or network event falls in any window.
- The restart and the log rollover took none of the evening's record.

## What would settle it

- **Stall 1:** the store's own record for 01:04 to 01:07 UTC Nov 21: Turso's per-database latency or rows-read metrics, read by Corey in Turso's dashboard if it keeps them that long. Or the statement behind prod `/stale`'s 3,802 ms request, if Vercel's runtime log for 01:06 UTC is still kept.
- **Stall 2:** this PC's TCP connections by state through a crawl, to set against Tcpip 4231. HO 829's own crawl counted them every 15 s, 2:53:39 to 3:01:13 PM Nov 22 (237 tests, two workers, no stall): ESTABLISHED 70 to 109, TIME_WAIT 96 to 548, BOUND 55 to 82, the peaks at different moments. That's a baseline, not a finding, and the log is gitignored (`829-artifacts/tcp-states-run1.log`), so these figures are the record. The other half is the 4231 event's own text, which only Corey should read, since it can carry paths.
- **Any stall from now on:** take the readings at the same moment, not one after another. Start a count that reads table pages, and beside it run a `SELECT 1` from the PC every 250 ms until the count returns. Time a prod page that reads the store uncached by Vercel's own duration for it (`vercel.external_api_request.request_duration_ms` on the store's host), not by the PC's first byte, which crosses the PC's network too.
  - **A store slow in its page reads** slows the count and the prod page and spares `SELECT 1`.
  - **A store slow at its front end** slows all three, since the store runs `SELECT 1` too.
  - **A slow PC network** slows the PC's two and spares the prod page.
  - **A stuck local process** slows none of them, only the local pages.
