# HO 832: the plans `idx_bills_summary_stage_stale` changed, `/stale`'s row list, and `/bills`' search count under a stage

> **Diagnostic-only probe, not wired.** Base `main` at `79484ad`. Run Tuesday 2026-11-24, 11:11 to 11:37 AM Mountain Standard Time (a fixed UTC−7), with UTC beside where it matters. Two bytecode listings and a plan were added at 12:09 PM, after a review.
> - **One script, `scripts/diagnostic/plans-832.ts`, in modes** (`schema`, `capture`, `diff`, `time`, `tablerows`, `stale`, `walk`, `search`, `slowctx`, `listing`, and `first`, which the others spawn), with its loader calls in `plans-832-calls.ts`.
> - **Prod's store was read by `SELECT` and `EXPLAIN` only,** through HO 824's guard on the singleton client. The guard refuses:
>   - any statement that isn't a read, or that carries a write word outside its comments and string literals;
>   - any batch not in `read` mode;
>   - every transaction, `executeMultiple`, `migrate` and `sync`.
>
>   Two refused controls ran before each mode's first read, and both refused each time. **1,904 statements passed the guard in the final run of each mode, all reads.** That includes the 110 first-run processes at two statements each. The runs that stopped early read the same way: two diffs, one § 2 and a one-statement trial.
> - **The two local copies** hold prod's DDL and no rows. They aren't committed.
> - **Vercel's record** of Production's requests to the store was read through the Vercel MCP's read-only observability query only: 6 queries by hour, then 49 to time each slow request, 55 in all. A 56th, filtering on the duration, was refused with a 400. There was no Vercel CLI call. The store's host is named only by its provider's suffix.
> - **No app code, no index, no write.**
>
> The runs' JSON and text are in `docs/handoffs/832-artifacts/` (repo-ignored): `schema-832`, `capture-832`, `capture-832-others`, `diff-832`, `time-832`, `tablerows-832`, `stale-832`, `walk-832`, `search-832-committee`, `slowctx-832`, `listing-832`, `vercel-stale-7d-832.tsv`, `vercel-drill-832.jsonl`, `slow-slots-832.tsv`, the census (`census-832`, `reach-832`) and the page map (`map-832.md`).

## STEP 0

Every claim held (`832-artifacts/step0-832.md`):
- `main` is at `79484ad`, alone on the remote.
- The roadmap pointer reads 831, and the highest HO in commit subjects is 831.
- The reconcile reads 286 / 400 / 686, with 0 mis-struck and 0 live in the archive.
- `getStaleBills` is at `lib/queries.ts:7334`, with its hints at `:7361-7364`.
- **Prod's `sqlite_master`** lists 22 indexes on `bills`, one of them automatic, with `idx_bills_summary_stage_stale` at rowid 246, and **no `sqlite_stat` table**. Prod's engine is SQLite 3.47.0.

## The method

**The two copies.** `plans-832.ts schema` read prod's whole `sqlite_master` and built two empty local files in its rowid order:
- `copy-with.db` holds every table, index and view;
- `copy-without.db` is the same less `idx_bills_summary_stage_stale`.

Left out of both: triggers, `sqlite_sequence`, the automatic indexes (they come back with their tables) and `bills_fts`' four shadow tables (the virtual table makes them).

Each copy's DDL reads back equal to prod's, statement for statement, and `bills` holds no row. With no rows there are no statistics, so the planner works from the schema alone. Prod's planner does the same, since it has no `sqlite_stat` table.

The copies run the repo's `@libsql/client`, SQLite 3.45.1, against prod's 3.47.0. The control below is what says they plan alike.

**The set, as the app builds it.** `capture` wraps the guarded client in the script's own process and records every statement and its args as the client receives them. It then calls the app's own loaders, with `next/cache` stubbed by HO 757's hook and no app code changed.

The calls are the pages' own calls, with the pages' own filter objects, limits and constants. A read-only workflow mapped the page trees and cited `file:line` for each (`map-832.md`).
- **The handoff's set** (256 calls), all against prod:
  - **`/bills`:** with no filter; by chamber, topic, search term, cluster, ceremonial and `sort=introduced`; and each of the six stages, alone and with house, senate, one topic, one search term, one cluster, ceremonial on, and `sort=introduced`, each with the page's topic rail.
  - **`/stale`:** each filter, each of its four stages, and each stage with house.
  - **`/`:** every panel's loaders, unfiltered, by house, by one topic and by each stage.
  - **`/welcome`'s 11 loaders**, **`/electoral`'s ballot facts**, and **`/members`'** list, topic mix, committee roster and expanded card, with a committee and a member read from prod.
  - **`HeaderBar`'s `getCorpusStats(true)`.**
- **Beyond the handoff's list** (39 calls): every other reader the workflow found that can be called read-only.
  - **Other pages:** `/president`, `/changes`, `/patterns`, `/search`, `/bill/[id]` and its panel route, `/committee/[code]`, `/members/[id]`, `/news`, `/amendments`, `/vote/[id]`, `/api/search/card`, `/trends` and `/reports`.
  - **Three crons' exported reads:** news' `getCandidateBills`, committees' `readCommitteeWalkBacklog`, and the weekly report's `buildWeekSummaryPayload`.

**The ids the parameterized pages need were read from prod by helper calls.** They ran under the label of the first call that needed them, so they're in the totals:
- *Others*' lookups (the first bill `/bills` lists, the top-ranked member, the first committee, that member's votes, the news feed, the cluster stats) sent 15 of the 18 statements labeled `getClusterDrilldown`.
- `getMembersRanked(…, 1, 1)` picked the member to expand. Its args, `[…, 1, 0]`, are sent by no page: it is one of the 387 and one of the 316 below, and its `bills` read is hinted (`idx_bills_sponsor_agg`).

All 295 calls returned. They sent 518 statements:
- **199 distinct SQL texts,** 154 of them reading `bills` and 74 with a `bills` reference that names no index;
- **387 distinct with their args,** 316 reading `bills` and 152 with an unhinted reference.

**Not reached: 14 of the census's 74 declarations that read `bills`** (`census-832.txt`, `reach-832.txt`):
- **The crons' reads inside their write paths, or not exported,** or both. The guard would refuse their writes, and the handoff forbids an app change:
  - `/api/sync`'s `getWatermark` and `upsertBill`;
  - summarize's `runSummarize`;
  - committees' `selectBillsToWalk`;
  - bill-rosters' `selectCandidates` and `loadNamed`;
  - LDA's `loadValidBillIds`;
  - news' `ingestNews`;
  - both vote syncs' `upsertVoteAndMembers`;
  - the weekly report's `gatherReportData` and `gatherFloorVotes`.
- **`getWatchlistBills`.** `ACCOUNT_UI` is false, so `/watchlist` calls `notFound()` before any read.
- **`getFeedStats`.** No caller in `app/`, `components/` or `lib/`.

None of the 14 that runs could take the new index unhinted. **This is reasoning, not a reading:** SQLite uses a partial index only when the query's WHERE implies the index's own, and the 14's statements name no `summary` term, with two exceptions:
- **The weekly report's notable-intros read** (`lib/report-generation.ts:818`) is hinted to `idx_bills_introduced_date`.
- **`getFeedStats` with a cluster** is unhinted and gated on `summary IS NOT NULL` (`lib/queries.ts:262`, `:461`), so the new index is eligible there. It has no stage term to seek, and nothing calls it.

Summarize's read is hinted to `idx_bills_summarize_queue`, partial on `summary IS NULL`.

## The control

**Ten statements, read before anything was taken off the copies:** the first ten distinct SQL texts, in capture order, that read `bills` without naming an index. For each, `copy-with.db`'s `EXPLAIN QUERY PLAN` equals prod's, line for line: **10 of 10.** They take in:
- a multi-index OR;
- the full-text join;
- a cluster seek;
- the new index taken unhinted;
- `getFeedBills`' row SELECT with its materialized mention subquery.

**Widened to every captured statement that reads `bills`, all 316:**
- **296 equal line for line;**
- **20 differ only in the temp b-tree's label.** 3.45.1 prints `USE TEMP B-TREE FOR RIGHT PART OF ORDER BY` where 3.47.0 prints `USE TEMP B-TREE FOR LAST TERM OF ORDER BY`, every other line the same;
- **0 differ otherwise.**

**For every statement kept below:**
- prod's plan equals `copy-with.db`'s;
- the old plan, forced on prod with `INDEXED BY` its index, equals `copy-without.db`'s, line for line.

So the before-plans are prod's planner's, not the copy's: forcing reproduces them on prod.

## § 1, the statements the index changed

**47 of the 387 distinct (SQL, args) plan differently with the new index, in 8 SQL shapes. Every one is `getFeedBills` under a stage filter.**
- **The seven COUNT shapes,** each across all six stages, are the non-search COUNT (`lib/queries.ts:7197-7198`), except shape 5:
  1. bare;
  2. house;
  3. senate;
  4. one topic;
  5. one search term, the search path's COUNT (`:7119-7121`);
  6. one cluster;
  7. ceremonial on.
- **Shape 8 is the row SELECT under `sort=introduced`** (built `:7242-7257`, run `:7259`), for five stages. `stage=committee` is hinted to `idx_bills_introduced_date` by its size.
- **`/president`'s and `/welcome`'s `getFeedBills` calls** build the same statements as `/bills?stage=president` and `/bills?stage=enacted`.

**No other captured reader changed.** Nine more statements name the new index themselves: HO 831's two counts. They can't be prepared without it, so they weren't diffed.

**Before, every one drove from `idx_bills_summary_stage_topics (stage, is_ceremonial, topics) WHERE summary IS NOT NULL`, seeking `(stage=?)`. After, from the new index, the same seek.** That corrects HO 831, which took them to have driven from `idx_bills_summary_stage` (see the oddities entry).

**Both plans hand over the same rows:** a guarded `COUNT(*)` of the seek, `summary IS NOT NULL AND stage = ?`:

| Stage | Rows handed over | Of them non-ceremonial |
|---|---|---|
| introduced | 137 | 112 |
| committee | 18,299 | 16,257 |
| floor | 1,003 | 490 |
| other_chamber | 612 | 589 |
| president | 3 | 2 |
| enacted | 149 | 135 |

**In prod's bytecode the ceremonial test reads the index before any `Column` on the table cursor** (`listing-832.log`, at committee):
- shape 2's old plan tests `is_ceremonial` on the index cursor at addresses 10 to 13 and skips the row when it fails, and its only table read, `bill_type`, is at 31;
- shape 4's new plan does the same at 10 to 13, then reads `topics` from the table at 14.

So where a plan reads a table column, it reads it for the non-ceremonial rows; under a cluster, which drops the ceremonial gate, for every row handed over.

**Each shape:** the table columns read come from `EXPLAIN`'s opcodes on prod, an `OpenRead` on `bills`' root page and each `Column` on that cursor. The timings are in ms.
- **First run:** one per plan, each in a fresh process, at 11:30:29 to 11:32:37 AM. The process's own `SELECT 1` ran first and took the new connection's 140 to 290 ms, so the number is the statement's own. **It isn't a cold run:**
  - each came seconds after the parent process's `COUNT(*)` over the same index seek (the rows-handed-over reads);
  - the capture had run the new form one to three times (41 once, 4 twice, 2 three times), four to seven minutes before, and never the forced old form;
  - nothing here makes the store cold.
- **Warm:** three runs per plan, interleaved, against a `SELECT 1` round trip of 26.6 to 28.1 ms warm.
- **Result:** both plans returned the same count or the same rows in all 47.
- **The reading's bar:** a plan *runs slower warm* when its median exceeds the other's by more than 10 ms. A *pin* reads more table rows or runs slower warm.

| # | Site and inputs | Before → after | Table columns read, before → after | Committee: first run, old / new | Committee: warm, old → new | Other stages: warm medians, old → new | Reading |
|---|---|---|---|---|---|---|---|
| 1 | COUNT, bare: `?stage=` (×6), `/president`, `/welcome`'s enacted panel | `USING INDEX …_topics (stage=?)` → `USING COVERING INDEX …_stale (stage=?)` | none (the table cursor opened, one `DeferredSeek`, no `Column`) → the table isn't opened | 85 / 92 | 30, 28.7, 28.9 → 31.8, 31.9, 31 | introduced 27.1 → 26.9; floor 26.8 → 27.4; other_chamber 26.9 → 27; president 30.7 → 28.6; enacted 26.8 → 27.1 | **leave** |
| 2 | COUNT, `?stage=…&chamber=house` (×6) | same seek | `bill_type` (the non-ceremonial rows: 16,257 at committee) → the table isn't opened | 640 / 99 | 72.2, 72.4, 74.3 → 33.6, 33.6, 38.8 | 30.6 → 27.1; 30.4 → 27.1; 27.8 → 27.7; 26.9 → 28; 27.7 → 28.7 | **leave** (reads less) |
| 3 | COUNT, `?stage=…&chamber=senate` (×6) | same seek | `bill_type` (non-ceremonial rows) → the table isn't opened | 132 / 97 | 74, 74.2, 74.1 → 34.3, 34.1, 35.1 | 27 → 26.9; 29.7 → 28.4; 29.3 → 27.3; 26.8 → 27; 26.9 → 30.1 | **leave** (reads less) |
| 4 | COUNT, `?stage=…&topics=healthcare` (×6) | `USING INDEX …_topics` → `USING INDEX …_stale` | none → **`topics`, for every non-ceremonial row: 16,257 at committee** | 88 / 148 | 30.1, 39.7, 29.9 → **90, 102.5, 75.4** | 26.9 → 27.6; 31.4 → 30.1; 27.8 → 28.1; 29.3 → 28.4; 27.4 → 27.5 | **pin to `idx_bills_summary_stage_topics`**: it reads 2 to 16,257 more table rows a stage, and runs about 60 ms slower warm at committee |
| 5 | COUNT, the search path, `?stage=…&q=tax` (×6) | `SEARCH …_topics` then a `bills_fts` probe per row → `SEARCH …_stale` (covering) then the same probe | none → the table isn't opened | 5,221 / 5,511 | 5,567, 5,647, 5,152 → 5,374, 5,593, 5,422 | 54.7 → 53.9; 160.1 → 167.6; 192.7 → 191.6; 27.3 → 27.2; 58 → 57.6 | **leave**: the index doesn't matter here, the join order does (§ 3) |
| 6 | COUNT, `?stage=…&cluster=facility-naming` (×6) | `USING INDEX …_topics` → `USING INDEX …_stale` | `cluster_id`, every row handed over (18,299 at committee) → the same | 142 / 191 | 77.7, 79.2, 78.8 → 83.7, 82.4, 84.2 | 26.9 → 27.6; 28.3 → 28.4; 27.8 → 27.4; 26.9 → 27; 26.8 → 26.8 | **leave**: the same column for the same rows; the committee median is 4.9 ms slower, under the 10 ms bar, in 3 of 3 runs |
| 7 | COUNT, `?stage=…&ceremonial=1` (×6) | `USING INDEX …_topics` → `USING COVERING INDEX …_stale` | none → the table isn't opened | 118 / 113 | 28.1, 28.1, 27.8 → 30.2, 29.5, 30 | 26.7 → 27.2; 28.9 → 27.1; 27.2 → 30.6; 27.7 → 27.3; 26.9 → 27.1 | **leave** |
| 8 | row SELECT, `?stage=…&sort=introduced` (×5, not committee) | `SEARCH …_topics`, a temp b-tree for the ORDER BY → `SEARCH …_stale`, the same sort | every matching row's select list either way; 16 columns, among them `bill_type`, `latest_action_date` and `summary` → 14, among them `topics` | (not run at committee) | (n/a) | introduced 32.8 → 33.1; floor 33.4 → 33.1; other_chamber 33.4 → 33.5; president 30.1 → 29.4; enacted 31.2 → 31.8 | **leave** |

**The first-run column** has two single outliers, labeled as what the store had cached then: shape 2's old 640 ms at committee, and shape 1's new 1,095 ms at `other_chamber` against 83 ms old.

## § 2, `/stale`'s row list

`getStaleBills` was captured dry here, so this mode ran no statement before its timed first run (11:36 AM). It wasn't the statement's first run on prod:
- the capture had run five of the six at about 11:25:57 AM, all but `stage=committee` for senate;
- within the mode, each later form's first run followed the earlier forms' warm runs, pieces and candidate over the same index.

Then the plan and opcodes, three warm runs, the rows handed over, three warm runs of each piece, and the candidate (`stale-832.log`, `walk-832.log`).

| Form | Plan (the `bills` line) | Table columns read | Rows the index hands over | Rows matching the WHERE | Returns | First run (fresh process) | Warm |
|---|---|---|---|---|---|---|---|
| default group, all | `SEARCH … idx_bills_summary_stage (stage=?)`, `stage IN (floor, other_chamber, president)`, then a temp b-tree for the ORDER BY | `latest_action_date`, `bill_type`, then the select list's 15 | 1,618 | 802 | 50 | 158 | 62, 36.5, 38 |
| default group, house | same | `bill_type`, `latest_action_date`, then 15 | 1,618 | 594 | 50 | 123 | 62.3, 36.5, 34.9 |
| default group, senate | same | same | 1,618 | 208 | 50 | 131 | 59, 34.1, 35 |
| `stage=committee`, all | `SEARCH … idx_bills_latest_action (latest_action_date>? AND latest_action_date<?)`, `LAST TERM OF ORDER BY` | `summary`, `stage`, `is_ceremonial`, `bill_type`, then 14 | the range holds 18,978, **the walk reads 161** (every entry dated on or before the 50th row's, 2025-01-03) | 14,947 | 50 | 123 | 62.1, 32.3, 33.6 |
| `stage=committee`, house | same | same | the walk reads 161 | 9,643 | 50 | 123 | 65.8, 33, 34.5 |
| `stage=committee`, senate | same | same | the walk reads 385 (to 2025-01-13) | 5,304 | 50 | 124 | 58.1, 34.2, 33.5 |

**Where the default group's time goes** (warm, three runs each, all chambers):
- the `COUNT(*)` of the WHERE, no joins: 28.5, 33.6, 28.5;
- `SELECT id` with the WHERE, ORDER BY and LIMIT, no joins: 30.3, 33.3, 30;
- the same with the statement's joins: 30.9, 31.6, 30.7;
- the whole statement: 36.5 to 38 after its first warm run.

**Against a 28 ms round trip (28.1 and 28.8 warm in this mode), the store's work is a few ms, and the sort is the 802 rows, not about 845.** The comment at `lib/queries.ts:7350-7352` (*a temp-b-tree sorts that small set (~1.6s)*) is no longer today's reading.

**The candidate, read only: the same statements `INDEXED BY idx_bills_summary_stage_stale`.**
- **The default group, all three:**
  - the same plan shape, on the new index;
  - the table columns read drop to the select list's 14 (no `latest_action_date`, `bill_type` or `summary`);
  - the same 1,618 rows handed over;
  - warm 36.7, 33.5, 36 · 35.3, 33.6, 36.1 · 36.8, 33.1, 34.5;
  - **the 50 ids and their order equal the current form's.**
- **`stage=committee`, all three:** `SEARCH … (stage=?)` hands over 18,299 rows and sorts all 14,947 matches (`USE TEMP B-TREE FOR ORDER BY`), against the current form's walk of 161:
  - warm 238, 92, 89.3 (all) · 69.7, 77.3, 75.2 (house) · 68, 60.4, 60.9 (senate);
  - the 50 ids and their order equal the current form's.

**Production's store requests on `/stale`, Nov 17 11:00 AM to Nov 24 11:00 AM MST** (18:00Z to 18:00Z), through the Vercel MCP:
- 108 requests in 26 of the 168 hours.
- p95 is the query engine's, which reads a hair under the max where a hour holds one slow request.

| Hour (MST) | Requests | p95 | Max |
|---|---|---|---|
| Nov 17 1 PM | 3 | 15,808 | 15,845 |
| Nov 17 3 PM | 2 | 167 | 167 |
| Nov 17 7 PM | 2 | 414 | 415 |
| Nov 17 8 PM | 1 | 812 | 815 |
| Nov 18 3 PM | 2 | 134 | 134 |
| Nov 19 12 PM | 4 | 130 | 130 |
| Nov 19 3 PM | 4 | 4,288 | 4,311 |
| Nov 19 5 PM | 3 | 3,168 | 3,172 |
| Nov 20 10 AM | 3 | 3,632 | 3,635 |
| Nov 20 12 PM | 3 | 3,232 | 3,234 |
| Nov 20 1 PM | 2 | 25,600 | 25,662 |
| Nov 20 2 PM | 4 | 5,952 | 5,958 |
| Nov 20 3 PM | 5 | 4,480 | 4,481 |
| Nov 20 5 PM | 5 | 1,296 | 1,296 |
| Nov 20 6 PM | 1 | 3,792 | 3,802 |
| Nov 20 8 PM | 4 | 490 | 491 |
| Nov 20 9 PM | 4 | 1,272 | 1,277 |
| Nov 21 1 PM | 3 | 3,296 | 3,302 |
| Nov 21 4 PM | 8 | 1,920 | 1,926 |
| Nov 22 1 PM | 2 | 1,720 | 1,722 |
| Nov 22 2 PM | 7 | 4,128 | 4,136 |
| Nov 22 3 PM | 8 | 3,216 | 3,226 |
| Nov 23 2 PM | 9 | 24,960 | 25,047 |
| Nov 23 7 PM | 8 | 370 | 371 |
| Nov 24 9 AM | 8 | 4,608 | 4,620 |
| Nov 24 10 AM | 3 | 560 | 560 |

**Every request past 2 s, by 10-second slot: 19 slots, 20 to 22 requests, in 15 episodes.**

How each was found and read:
- `request_duration_ms` isn't a filterable dimension, so each slow hour was read by minute, and each slow minute by 10-second slot: max, count, and min where a slot held two or more.
- Beside each episode: the Production deploy that ended in the ten minutes before it (GitHub's deployment records, the success status), the `e2e-prod` run it fell in, and `cron_runs`, read guarded.

| Slot start (MST) | Requests past 2 s (ms) | A deploy ended before it | The crawl it fell in | The bills sync (`/api/sync`) ended in the 10 min before |
|---|---|---|---|---|
| Nov 17 1:02:10 to 1:02:20 PM | 10,001, 5,924, 15,845 | `5829418`, 2.9 min | `e2e-prod` `44164447529` (post-deploy) | no |
| Nov 19 3:43:40 PM | 4,311 | `218c592`, 5.1 min | `44630542152` (post-deploy) and `44629993494` (scheduled), both in flight | no |
| Nov 19 5:56:10 PM | 3,172 | `cf05fd5`, 8.7 min | `44648645537` (post-deploy) | no |
| Nov 20 10:27:00 AM | 3,635 | `9f88d6b`, 6.4 min | `44782386373` (post-deploy) | no |
| Nov 20 12:59:30 PM | 3,234 | `464cc91`, 6.1 min | `44806326017` (post-deploy) | no |
| Nov 20 1:00:30 to 1:00:40 PM | 10,002, 25,662 | `464cc91`, 7.1 min | `44806326017` (post-deploy) | no |
| Nov 20 2:33:30 PM | 5,958 | `5d9c184`, 5.8 min | `44820520382` (post-deploy) | no |
| Nov 20 3:13:50 PM | 4,481 | none (46 min) | `44826363532` (scheduled) | no |
| Nov 20 6:06:00 PM | 3,802 | none | none; inside HO 829's stall 1 (6:04:14 to 6:06:50 PM) | no |
| Nov 21 1:53:20 PM | 3,302 | none | `44948142973` (scheduled) | no |
| Nov 22 2:02:00 PM | 4,136 | none | `45069224687` (scheduled) | no |
| Nov 22 3:45:50 PM | 2,255 | `c5341bc`, 1.2 min | `45079405099` (post-deploy) | no |
| Nov 22 3:50:30 PM | 3,226 | `c5341bc`, 5.9 min | `45079405099` (post-deploy) | no |
| Nov 23 2:05:30 to 2:05:50 PM | 10,001, 6,564 (with 1,203 and one unknown), 25,047 | `fbea540`, 6.3 min | `45264962875` (post-deploy) | no |
| Nov 24 9:56:20 AM | 4,620 (with 99 and one unknown) | `79484ad`, 5.7 min | `45441822341` (post-deploy) | no |

**The pattern:**
- **The bills sync** ended in the ten minutes before none of them.
- **The summarizer,** which writes `bills` every ten minutes, ended before all 19, in 78 to 867 ms.
- **The news cron's `:00` run** (12.1 to 24.5 s) ended before the three longest episodes, each a few minutes past the hour. A `:00` news run (7.8 to 19.3 s) also came before two shorter ones, Nov 20 6:06 PM and Nov 22 2:02 PM.
- **The crawls:** 11 of the 15 episodes came 1.2 to 8.7 minutes after a Production deploy, inside that deploy's `e2e-prod` crawl, and three more inside a scheduled crawl. The crawl is most of `/stale`'s traffic, so the clustering says where the requests come from at least as much as when the store is slow.
- **The one slow request outside any crawl** fell inside HO 829's Nov 20 stall 1.
- **What the requests were:** the metric is by route, so which statement each was isn't read. `/stale`'s row list reads 32 to 158 ms here, warm and on a fresh process, and its two counts are index-only since HO 831.

## § 3, `/bills`' search count under a stage filter

The statement, `getFeedBills`' search-path COUNT (`lib/queries.ts:7119-7121`), was captured dry here for `stage=committee`. The `tax` form had already run on prod in the capture (11:25 AM) and in § 1's timing (11:30 to 11:31 AM).

```sql
SELECT COUNT(*) AS n FROM bills_fts JOIN bills ON bills.rowid = bills_fts.rowid
WHERE bills_fts MATCH ? AND bills.summary IS NOT NULL AND bills.stage = ?
  AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)
-- args ["tax*", "committee"]
```

**The two plans:**
- **As the planner picks it:** `SEARCH bills USING COVERING INDEX idx_bills_summary_stage_stale (stage=?)` then `SCAN bills_fts VIRTUAL TABLE INDEX 0:=M3`. It walks the committee rows and runs the full-text match once per row, constrained to that row.
- **With the full-text index driving:** `SCAN bills_fts VIRTUAL TABLE INDEX 0:M3` then `SEARCH bills USING INTEGER PRIMARY KEY (rowid=?)`.

**The page's row SELECT for the same inputs already plans the second way on prod:** `SCAN bills_fts VIRTUAL TABLE INDEX 0:M3`, then `SEARCH bills USING INTEGER PRIMARY KEY (rowid=?)` (`listing-832.log`). Only the COUNT runs in the other order. Why is inference, not a reading: the COUNT can read `bills` from a covering index, which the planner may price below a probe.

| Term | Count, planner / FTS | First run (fresh process), planner / FTS | Warm, planner | Warm, FTS driving |
|---|---|---|---|---|
| tax | 1,650 / 1,650 | 5,755 / 122 | 5,838, 5,569, 5,452 | 96, 91, 98 |
| veterans | 796 / 796 | 1,778 / 133 | 1,853, 1,783, 1,749 | 33, 38, 29 |
| border | 227 / 227 | 968 / 99 | 888, 887, 905 | 28, 30, 28 |
| energy | 641 / 641 | 1,473 / 121 | 1,417, 1,443, 1,560 | 28, 44, 29 |
| water | 532 / 532 | 1,701 / 142 | 1,753, 1,637, 1,671 | 29, 29, 133 |

**The counts are equal on all five terms.** Each full-text first run came 1 to 6 s after the planner's first run of the same term, which had probed `bills_fts` for that term on every committee row. So the full-text first run follows a read of the same full-text index; it isn't a first touch.

**What it would take.** Any of three edits to the count's SQL makes the planner drive from the full-text side, and each reads the same plan on prod (`EXPLAIN QUERY PLAN` only):
- `FROM bills_fts CROSS JOIN bills ON …` (SQLite keeps a `CROSS JOIN`'s left table outer);
- `JOIN bills NOT INDEXED ON …`;
- a unary `+` on the stage term, `+bills.stage = ?`.

`CROSS JOIN` touches only the join and leaves every filter term as it is. Under the old index the plan was the same shape: § 1's shape 5 reads 5.2 to 5.6 s at committee either way.

## What the readings support

Recommendations only; nothing is built.

1. **§ 1, shape 4 (`getFeedBills`' COUNT under a stage and a topic): pin to `idx_bills_summary_stage_topics`.**
   - **Before:** it read no table column, since the old index holds `topics`.
   - **After:** the new index doesn't hold `topics`, so the count reads it from the table for every non-ceremonial row: 16,257 at committee, 2 to 589 at the other stages.
   - **Warm at committee:** about 30 ms became 75 to 102.
   - **HO 831's 8.7 and 3.8 s first runs** were this statement on the new index.
   - **The fix:** `INDEXED BY idx_bills_summary_stage_topics` on the non-search COUNT when a topic is set with a stage. Its plan on prod is § 1's forced-old plan, and its result equals the current one in all six stages.
2. **§ 1, shapes 1, 2, 3, 5, 6, 7 and 8: leave.**
   - Shapes 2 and 3 read less (`bill_type` came off the table).
   - Shapes 1 and 7 went from index-only in fact to the table unopened.
   - Shape 8 reads the same rows.
   - Shape 6 reads the same column for the same rows, 4.9 ms slower at committee. If shape 4 gets its hint, shape 6 can take the same one at no cost. The index that seeks the cluster, `idx_bills_cluster_agg`, wasn't read for it.
   - Shape 5's cost is the join order (item 4).
3. **§ 2, `/stale`'s row list: leave both forms on their hints.**
   - **The candidate equals the default group** in plan shape, time and ids, so it's no gain there.
   - **It's worse for a single stage:** it sorts 14,947 rows where the date walk reads 161.
   - **The comment at `lib/queries.ts:7350-7352` is stale:** 802 rows, a few ms of store work, not about 845 in about 1.6 s.
   - **Nothing read here makes the row list the 4,620 ms request:** it reads 32 to 158 ms warm and on a fresh process.
   - **That request's statement stays unread,** as do the other 18 slots'. They cluster in the first minutes of a crawl after a deploy, never after the bills sync. That's an observation, not a cause.
4. **§ 3: drive the search count from the full-text index.**
   - `CROSS JOIN` in the search path's COUNT took it from 0.89 to 5.8 s to 27 to 133 ms warm at committee (14 of the 15 runs under 100 ms), with equal counts on five terms.
   - It's the smallest of the three edits: the join keyword only.
