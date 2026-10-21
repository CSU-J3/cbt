# HO 788 — the bills Congress.gov lists that CT lacked or held behind: named, their cause read off `/api/sync`'s own ledger as a join, and the ones that changed in substance repaired through `runSync`

> **Probe, then a repair on the architect's ruling.** Base `main` at `7776ea3`. Run 2026-10-20, Mountain Time with UTC beside: STEP 0 2:28 PM (20:28Z); `--ticks` 2:31 PM; census pass 1 2:31 to 3:24 PM (20:31:52 to 21:24:14Z); `--impact` 3:29 PM; then a **HALT before `--repair`** on a reading outside its bound, and the ruling, option 3; repair pass 1 **7:25 to 7:37 PM (01:25:21 to 01:37:17Z Oct 21)**; the second census 7:40 to 7:47 PM; pass 2 7:48 to 7:50 PM; the third census 7:50 to 7:51 PM; the readings 7:51 PM. **Pass 3, on the ruling on flags 1 and 2, Oct 21, 7:11 to 7:41 PM (01:11:20 to 01:41:01Z Oct 22):** census p4, repair r3, census p5, the `--from` pass (r4, which a Cloudflare 520 stopped before it wrote anything, then r5), and the closing census p6. **Budget:** Congress.gov **11,142 requests, all 200 but one** (r4's 520), one in flight at a time, `CONGRESS_API_KEY` by name; quota **19,319** of 20,000 left at the end. Prod through `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name: **`SELECT` only, except the repair's `runSync`, which wrote the allow-set and nothing else**; `rows_read` **737,185** by the instrument (and 107,343 by tapped side reads), `rows_written` **14,551**, every row `runSync`'s; the schema fingerprint `736e6b987bf77620` before and after every run. The instrument is `scripts/diagnostic/bills-gap-788.ts`; its logs, every list page, the census CSVs and the allow-sets are under `docs/handoffs/788-artifacts/` (repo-ignored). No product code, schema or sync code changed.

**What this found.** On Oct 20, Congress.gov listed **19,716** bills for the 119th Congress and CT stored 19,127. The whole-list census read **589 missing and 8,287 behind** (stored `update_date` older than Congress.gov's). Joined to `cron_runs`, **583 of the 589 and 8,021 of the 8,287 were first owed by an `/api/sync` tick that stopped partway**, HO 116's stopped-tick tail (`lib/sync.ts:342-351`), and none by a page-boundary tie, because no tick has ever read a second page. The repair the handoff designed would have written 8,876 bills, ten times its bound, and nulled 8,287 summaries for 370 bills with a newer action, so the HO HALTed. By ruling, it wrote **the 950 bills that changed in substance and sat below the cron's frontier** (585 missing, 365 behind with a newer latest action) through `runSync`'s own upsert, and made the rest of the list read current on the read side only. **After it: 4 missing** (the frontier rule's, named) **and 7,897 behind**, 7,890 of them the control the ruling left unwritten. **That rule was by day, and the cron lists by instant:** the four, and three behind with a newer action, were dated Oct 20 before the watermark, below every tick's `fromDateTime`. On the ruling on flags 1 and 2, **pass 3 wrote all seven** under the rule restated by instant, with a write-time guard. **The closing census: 0 missing,** Congress.gov's 19,716 against CT's 19,716, and **7,902 behind,** every one behind by metadata alone, the control the ruling leaves unwritten.

## STEP 0, a check, re-derived at `7776ea3`

The instrument's `--step0` mode reads claims 1, 2 and 7 off the tree and claims 3 to 6 off prod and Congress.gov (`step0-r1`, 2:28 PM MT, 20:28:04 to 20:28:12Z). Claims 1 and 2 hold, so STEP 0 HALTed nothing. The HO HALTed later, before `--repair`, on a reading outside its bound (below).

| # | Claim | At `7776ea3` |
|---|---|---|
| 1 | the base | **holds.** HEAD, `main` and `origin/main` are `7776ea3`; the pointer reads 787 at `docs/roadmap.md:7153`; the highest HO in commit subjects is 787; the only numbered handoff above 787 is this one. |
| 2 | the anchors | **holds, all 30.** `lib/sync.ts:72-74`, `:98-108`, `:115-118`, `:125-130`, `:195`, `:277`, `:323`, `:342-351`, `:352-359`, `:375-382`, `:386`, `:393-396`, `:398-402`, `:416`, `:434`; `app/api/sync/route.ts:25`, `:100`, `:109`, `:140-154`; `scripts/sync.ts:4`; `scripts/migrate.ts:281-285`, `:501-510`; `lib/cron-log.ts:48`; `lib/congress.ts:1-8`; `lib/db.ts:46`, `:53`, `:70`; and the one `DELETE FROM cron_runs` in a tracked file, `scripts/diagnostic/ratings-daily-771.ts:135`. Two more were read because the prose leans on them: `lib/cron-log.ts:170-171` (correction 1) and the word `sync_state` in `app`, `lib`, `scripts` and `components`, which appears only at `lib/sync.ts:351` and `scripts/migrate.ts:281`. |
| 3 | prod's `bills` (record) | **19,127** rows, all `congress = 119`, at 2:28 PM MT (20:28:07Z). By type, count and `MIN`–`MAX(bill_number)`: hr 10,618, 1–10,854 · s 5,432, 2–5,690 · hres 1,564, 1–1,633 · sres 922, 1–951 · sjres 217, 1–221 · hjres 215, 1–219 · hconres 120, 1–124 · sconres 39, 1–40. `MIN(update_date)` 2025-01-14T09:05:19Z, `MAX(update_date)` 2026-10-20T17:49:25Z (the watermark, 11:49 AM MT, as `lib/sync.ts:126` reads it), `MIN(introduced_date)` 2025-01-03. Every stored `update_date` is 20 characters, a whole-second UTC instant. `sync_state` holds **0 rows**. |
| 4 | the ledger (record) | **481** `/api/sync` rows, the first started 3:03 AM MT May 22 (09:03:01Z), the last 12:00 PM MT Oct 20 (18:00:10Z): 412 `success`, 61 `timeout`, 5 `error`, 3 `orphaned`. At the handoff's path, `$.sync.*`, 6 rows carry it and **0** read budget-stopped; at the path `lib/cron-log.ts:170-171` writes, `$.payload.sync.*`, 406 rows carry it and **126** read budget-stopped. `failed` and `timedOut` sum to 0 at both. The ledger begins at #10 (4:45 PM MT May 22, 22:45:40Z), whose `fromDateTime` is 2026-05-22T08:49:31Z (2:49 AM MT). |
| 5 | Congress.gov's counts (record) | `/bill/119`: **19,716** at 2:28 PM MT (20:28:09Z). The eight types: hr 10,854 · s 5,674 · hres 1,633 · sres 951 · sjres 221 · hjres 219 · hconres 124 · sconres 40, read 20:28:09 to 20:28:11Z. They sum to 19,716, **equal**. |
| 6 | the filter field (record) | **`updateDateIncludingText`.** The newest stored bill whose two dates differ by an hour or more is `119-hr-10841`, and its detail confirmed them: `updateDate` 2026-10-20T08:23:20Z, `updateDateIncludingText` 2026-10-20T09:58:19Z. `/bill/119/hr` with `fromDateTime` and `toDateTime` one second either side of `updateDateIncludingText` listed it (14 bills in the window); the same around `updateDate` listed nothing (0). |
| 7 | probes and SKILL (record) | `docs/probes/` holds `715-…`, `747-…` and the two `787-…`. SKILL: the rate limit `:46`, the `updateDate` gotcha `:90`, Sync logic `:1230`, its steps `:1234-1238`, the HO 135 watch `:1342`, Backfill scripts `:1344`, all as stated; **the local-run line is `:1240`, not `:1241`.** |

## Ground truth the probe corrected (flagged, not absorbed)

1. **Claim 4's path is `$.payload.sync.*`, not `$.sync.*`: the handoff's anchor error, so ruled.** `wrapCronRoute` stores `{ ok, elapsedMs, payload }` (`lib/cron-log.ts:170-171`), so the route's `sync` lands one level down. Claim 4's statements, as written, read 0 budget stops: only 6 rows carry `$.sync`, among them the ledger's first two windows (#10 and #12, May 22). The written path reads 126. Every statement after STEP 0 reads `COALESCE` over both paths, as `scripts/diagnostic/senate-roll-gaps-745.ts:346-348` does, and `scripts/diagnostic/sync-timeout-verify-480.ts:19` says the same thing about `$.payload.timings`.
2. **Congress.gov's list prints its dates as a bare day, not whole seconds.** Claim 6's window listed `119-hr-10841` with `updateDate` "2026-10-20" and `updateDateIncludingText` "2026-10-20"; its detail reads them to the second. The precision count below finds no entry with a time. So a list date can't be compared with `started_at` as an instant, and the census read each missing or behind bill's two dates off one detail request. It has a second consequence, in the sync itself, read from the code and not measured on a bill: `lib/sync.ts:393` compares the stored `update_date`, an instant, with the list's bare day as strings, and `"2026-10-20T09:58:19Z" >= "2026-10-20"` holds. **So the compare runs at day precision:** a bill updated again on the day it was last synced compares as current and is skipped until it updates on a later day. Neither the sync nor a census built on the list can count that population.
3. **69 of the 481 rows name no window.** The 61 `timeout` and 5 `error` rows store the failure body (`{ ok: false, error, status }`), and the 3 `orphaned` rows store none, so none carries `fromDateTime`. The census gives each the last named `fromDateTime` before it, a lower bound on its own, and marks it *inferred*; their class is `errored`, split by status.
4. **SKILL's local-run line is `:1240`** (claim 7), re-derived for the SKILL commit.
5. **The repair's bound was the handoff's estimate, and the estimate was biased** (the HALT, below): *about 900 at HO 752's rate* carried HO 752's 3 of 200 from a sample of committee-walked bills, the recently updated ones; the census read 8,876 to write.

## Deviations (named)

1. **Six modes, not three.** `--step0` runs claims 3 to 6 behind the instrument's guards (`q()`'s refusal, the fingerprint, the tap, the header). `--impact` read what the repair would set going, before the HALT. `--readings` takes the ruling's cheap readings. The handoff's three are as specified, with the changes below.
2. **One detail read per missing or behind bill, in census pass 1: 8,876 requests.** The join needs instants and the list prints days (correction 2), so the reads were forced, but they ran after the class counts had already broken the repair's bound, and they made 7.6 times the HO's whole request budget. They were read-only and stayed under the hourly limit, and no cron failed alongside. The census now gates them on their population (at most 1,200, `MAX_DETAIL_READS`) and skips them with `--no-details`; the second census made none.
3. **The tap paces `runSync`'s Congress.gov requests too.** One request in flight and at least 250 ms between starts applies to every Congress.gov request in the process, `runSync`'s included. It only delays a request.
4. **`--repair`'s tick guard.** As first built it refused within 40 minutes of the next `/api/sync` tick. The ruling set ten minutes either side of a tick, since a run below the frontier can overlap one; the run started 85 minutes after the 6:00 PM MT tick and 275 minutes before the midnight one.
5. **The repair writes an allow-set, not the whole gap** (the ruling, option 3). The handoff's `--repair` wrote every missing and behind bill. The ruled one writes the census's missing and its behind with a newer latest action, each listed before the frontier day (in pass 3, dated before the watermark instant), and makes the rest of `runSync`'s list read current on the read side only.
6. **Two read-side rules the ruling's text doesn't name.** (a) A listed bill outside the allow-set with **no stored row** has no stored `update_date` to take, so the view removes both its dates, and `runSync`'s own check at `:387-391` skips it without a detail fetch. It applied to three of the four missing bills the frontier rule excluded, the three the walks listed; the fourth, `119-hres-1581`, was never listed (below). **The ruling on flags 1 and 2 ratified it:** outside the allow-set, a stored bill reads current and an unstored one reads undated. (b) The frontier rule is applied twice: to the census's dates, to fix the allow-set before the run, and to each entry's date as the walk reads it, so an allow-set bill that moved onto the frontier day mid-run reads as outside. In pass 3 the walk passes an allow-set entry listed on or before the watermark's day, and the write-time guard places it by its detail.
7. **Two classes the handoff did not name.** `after-the-last-tick`: the bill's date is later than the last tick's start, so no tick has owed it yet. `success, no stats`: a `success` row whose stats carry no `budgetStopped` (one row, #10). And `errored` is split by status (`timeout`, `error`, `orphaned`).
8. **The last owed tick's class rides beside the first's,** and the join is run with `updateDate` too. Where they differ, the tables say how often (`census-p1.log`).
9. **`--census --vs` reads a census against the repairs:** the allow-set now, the control now, the gap that is new since the census, and every row stamped since the census's snapshot, inside a repair's window or outside every one.
10. **Pass 3, beyond the ruling's text.** (a) The guard reads a detail's date as the upsert takes it, `updateDateIncludingText ?? updateDate` (`lib/sync.ts:72-74`), which is `updateDateIncludingText` whenever the detail carries it; all seven did. (b) The tick margin is checked as the mode starts and again as `runSync` starts, since placement reads take time between the two. (c) `--census --vs` places the residual outside the control against the last repair's watermark, one detail read a bill, gated at 200 (`VS_PLACEMENTS`); that is how the censuses after pass 3 name what sits at or after the instant. (d) The `--from` pass ran twice: r4 stopped on a Cloudflare 520 at its second list page, before any detail fetch, and r5 repeated it. (e) Four side reads of prod, each a `SELECT`, read the day's ticks, the cron rows not `success`, the seven's stored rows and the crons alongside pass 3 (*Cost*).
11. **A ride-along correction:** pass 2's text said a `--from` pass moves every page boundary. It doesn't, and the text now says so (pass 2, below).

## The ledger: `/api/sync`'s history (`--ticks`)

One statement over `cron_runs WHERE route = '/api/sync'`, read at 2:32 PM MT (20:32Z, `ticks-r2`; r1 at 20:31:04Z read the same and mislabelled one count, fixed before r2). **481 rows**, May 22 (09:03:01Z) to Oct 20 at 12:00 PM MT (18:00:10Z): 412 `success`, 61 `timeout`, 5 `error`, 3 `orphaned`. 411 rows carry `budgetStopped`; counted apart are the 69 that carry no `sync` key (correction 3) and #10, whose stats predate the field.

**126 of the 411 stopped on the budget (30.7%).** By month, MT:

| Month | Rows | With stats | Budget-stopped | Share | Not `success` |
|---|---|---|---|---|---|
| 2026-05 | 14 | 11 | 3 | 27.3% | 2 |
| 2026-06 | 35 | 22 | 12 | 54.5% | 13 |
| 2026-07 | 109 | 65 | 37 | 56.9% | 44 |
| 2026-08 | 124 | 117 | 20 | 17.1% | 7 |
| 2026-09 | 120 | 120 | 35 | 29.2% | 0 |
| 2026-10 | 79 | 76 | 19 | 25.0% | 3 |

**No tick failed a bill and none read a second page.** `failed` and `timedOut` are 0 in all 411 rows, so the `:398-402` comment's case has never fired. `seen` peaks at **240**, under one page of 250, so no tick in the ledger has read a page boundary, and 0 of the 285 ticks that finished clean (`success`, not budget-stopped, 0 failed) read more than one page.

The distributions over the 411, nearest rank:

| Quantity | min | median | p90 | max |
|---|---|---|---|---|
| `seen` | 0 | 25 | 96 | 240 |
| `upserted` | 0 | 20 | 90 | 240 |
| `skipped` | 0 | 0 | 14 | 121 |
| `timings.sync` (ms) | 13 | 13,871 | 30,592 | 39,619 |
| the window, `started_at − fromDateTime` (hours) | 3.0 | 7.9 | 27.9 | 60.8 |

**What a 30 s budget gets through** (the 126 budget-stopped ticks): `seen` median **63**, p90 113, max 240; `upserted` median **57**, p90 108, max 240; `timings.sync` median 30,230 ms. Their windows run 6.0 hours at the least (median 6.9, p90 24.4, max 60.8). Consecutive rows start a median 6.00 hours apart, and 50 intervals run over 6.5 hours (max 24.69).

## Census pass 1: the gap, named (`--census`, label `p1`)

**Prod's snapshot:** 19,127 bills of the 119th, one statement, read 2:32 PM MT (20:32:01Z). Stored `MIN(update_date)` 2025-01-14T09:05:19Z.

**The list, whole:** `/bill/119`, `sort=updateDate desc`, 250 a page, no `fromDateTime`, read 2:32 to 2:40 PM MT (20:32:01 to 20:40:27Z), every page saved.
- The main walk: 79 pages, 19,716 entries, ended on the short page; `pagination.count` read 19,716 on the first page and on the last.
- **It repeated 55 entries,** so it came back short: 19,712 distinct after the tie windows (77 of 78 boundaries tie at the list's day precision, and all 77 were re-read) and after a second full walk at half-page offsets. That half walk was mostly the tie windows' pages again, answered from Congress.gov's cache, plus two new pages (*The list cache*, below). 4 listed bills were never returned by any walk; they are the 4 stored bills the census calls *extra* (the four readings, below).
- No id was read with two different dates across the 235 pages.

**By type** (Congress.gov's count from the eight `/bill/119/{type}?limit=1`):

| Type | Congress.gov | Listed (walk) | Stored | Missing | Behind | Ahead | Extra |
|---|---|---|---|---|---|---|---|
| hr | 10,854 | 10,850 | 10,618 | 236 | 4,721 | 0 | 4 |
| s | 5,674 | 5,674 | 5,432 | 242 | 2,321 | 0 | 0 |
| hres | 1,633 | 1,633 | 1,564 | 69 | 586 | 0 | 0 |
| sres | 951 | 951 | 922 | 29 | 334 | 0 | 0 |
| sjres | 221 | 221 | 217 | 4 | 136 | 0 | 0 |
| hjres | 219 | 219 | 215 | 4 | 109 | 0 | 0 |
| hconres | 124 | 124 | 120 | 4 | 60 | 0 | 0 |
| sconres | 40 | 40 | 39 | 1 | 20 | 0 | 0 |
| **all** | **19,716** | **19,712** | **19,127** | **589** | **8,287** | **0** | **4** |

Current 10,836. The classes are the compare `lib/sync.ts:393` makes, `stored >= listUpdate` with `listUpdate = updateDateIncludingText ?? updateDate`: *missing* is not stored, *behind* fails the compare, *ahead* and *current* pass it (current when the stored date's day is the listed day).

**The missing by number:**
- **hr (236):** 224 in 9088–10544 (214 in 9000–9999, 10 in 10000–10544); the rest 126, 302, 3899 and nine in 8762–8927.
- **s (242):** 237 in 4488–5677 (210 in 4000–4999, 27 in 5000–5677); the rest 137, 733, 1159, 1566 and 1628.
- **hres (69):** 1303–1617. **sres (29):** 725–855.
- **sjres** 194–195, 200, 202 · **hjres** 183, 188, 194, 201 · **hconres** 111, 114, 120–121 · **sconres** 34.
- Every id is in the appendix.

**The missing by month:**

| Month | By `updateDate` | By `latestAction.actionDate` |
|---|---|---|
| 2025-01 to 2025-11 | 0 | 8 |
| 2026-02 | 2 | 0 |
| 2026-04 | 1 | 0 |
| 2026-05 | 3 | 41 |
| 2026-06 | 75 | 357 |
| 2026-07 | 273 | 148 |
| 2026-08 | 103 | 4 |
| 2026-09 | 107 | 27 |
| 2026-10 | 25 | 4 |

**The behind's staleness,** the listed date minus the stored one, to the second off each bill's detail read: n 8,287 · min 0.1 days · median **126.2** · p90 288.1 · max 621.7.

**The exact dates:** 8,876 detail reads, one per missing or behind bill, every one 200 with both dates. The detail's day differed from the list's for 2 bills (`119-s-4784`, `119-hr-4395`), touched between the two reads; for the other 8,874 the list's bare day is the UTC day of the detail's `updateDateIncludingText`.

## The cause: a join on `cron_runs`

Each missing or behind bill's *owed tick* is the first `/api/sync` row whose window `[fromDateTime, started_at)` holds its `updateDateIncludingText` (claim 6's field), compared as instants. 481 rows. 69 name no window (correction 3); 68 of them take the last named `fromDateTime` before them, a lower bound on their own, marked *inferred*, and the ledger's first row precedes any named window and takes none. 1,591 bills' first owed tick is an inferred one.

| Class of the first owed tick | Missing | Behind |
|---|---|---|
| budget-stopped | 347 | 6,666 |
| errored (timeout) | 223 | 1,231 |
| errored (error) | 13 | 124 |
| clean (finished, one page, nothing failed) | 0 | 50 |
| before the ledger (`u` before 2026-05-22T08:49:31Z) | 6 | 196 |
| after the last tick (`u` after 12:00 PM MT Oct 20, 18:00:10Z) | 0 | 20 |
| **all** | **589** | **8,287** |

**The gap takes shape 1, the stopped tick's tail.** 583 of the 589 missing (99.0%) and 8,021 of the 8,287 behind (96.8%) were first owed by a tick that stopped partway: on its 30 s budget, or cut by the route's 55 s ceiling (`timeout`), or failing (`error`). One tick owed most of them (392 of the 589 missing, 6,909 of the 8,287 behind), so the watermark moved past each on the one tick that could have read it. **Shape 2, the page-boundary tie, has never been exposed in a tick:** no `/api/sync` tick in the ledger read a second page (`seen` peaks at 240), so `tie-exposed` is empty. **Shape 3, before the ledger:** 6 missing and 196 behind. The ledger begins at #10's `fromDateTime`, 2026-05-22T08:49:31Z; the stored `MIN(update_date)` is 2025-01-14T09:05:19Z, so the table's first fill sits before any window the ledger can name. **The handoff's fifth reading, unexplained:** 50 behind bills whose first owed tick finished clean on one page with nothing failed. The ledger can't say why. Claim 6 puts the filter on the field the join used, which leaves the handoff's other candidate, an entry that reached the list after its own date, unmeasured. Reading `u` as `updateDate` instead, or classing by the last owed tick instead of the first, moves no class's share by more than five points (every table is in `census-p1.log`).

**What the fix has to handle,** from these readings:
- **The tail:** a tick must not move the frontier past bills it never reached. The resolution `lib/sync.ts:349-351` names, an explicit cursor in `sync_state`, holds 0 rows today (claim 3).
- **The filter field:** `fromDateTime` filters on `updateDateIncludingText`, to the second (claim 6), so a cursor in that field is one the list can resume from.
- **The capacity:** 126 of 411 ticks stopped on the budget (30.7%), and a stopped tick gets through a median 63 `seen` and 57 `upserted` (`--ticks`).
- **The tie exposure:** none in a tick yet, but a catch-up that pages, as the repair did, meets it. The census's main walk repeated 55 entries in 79 pages and lost 4 after every recovery.
- **The day precision:** the list carries no time of day (the precision count, below), so `lib/sync.ts:393` compares an instant with a bare day. A bill updated again on the day CT last stored it reads current and is skipped until a later day. That population can't be counted off the list.

## The HALT before `--repair`, the estimate and its correction, and the ruling

**The bound.** The handoff sized the repair at *about 900 at HO 752's rate* (the 610 missing plus HO 752's 3 of 200 behind, across the stored corpus), *under 1,200 requests* and *half an hour of wall clock*.

**The reading.** Census pass 1 put **8,876** bills to write: 589 missing and 8,287 behind, about ten times the bound. The difference was one of kind too, read by `--impact` (3:29 PM MT, 21:29Z) off the census's saved files and one prod statement:
- **Every behind bill held a summary the upsert nulls** when `update_date` moves (`lib/sync.ts:203-207`): 8,287, of them 7,880 not ceremonial, 43.3% of the Congress's 19,127 summarized bills. Each would drop out of `/welcome`'s gated counts until the summarizer reached it.
- **Only 370 of the 8,287 showed a newer latest action** (4.5%); the other 7,917 had moved on Congress.gov with no newer action date.
- **8,091 name a committee,** so the stamped `changed_at` would owe each a committee walk (`lib/committees-sync.ts:205`).
- **The summarizer's drain:** in the 60 days to Oct 20 it ran 8,640 times and summarized 7,131 bills; one run stopped on its 45 s budget, and it summarized 40. Tokens a bill: 1,453 prompt and 102 output. At 40 a run every 10 minutes the 8,876 would take about 37 hours (an estimate, not a reading).
- **Congress.gov quota:** limit 20,000, remaining 12,950 at 21:29:08Z.

So the HO HALTed before writing, under method.md's *a failed claim, or a reading outside its bound, HALTs as before*, and offered four options: the repair as designed, now; the same at a time Corey picks; only the bills that changed in substance; or no write.

**The estimate and its correction (the ruling).** *The halt was right, and the bound was mine.* The estimate carried HO 752's 3 of 200 forward from a sample of committee-walked bills (*a seeded 200 walked bills with rows*), which are the recently updated ones, so the rate ran low by an order of magnitude for the corpus (oddities). The cause is settled as shape 1, the stopped tick's tail, and *126 of 411 ticks budget-stopped and 61 timed out* is the capacity reading the next HO sizes from.

**The ruling: option 3.** Repair the 589 missing and the behind with a newer latest action; the behind without one are not written by this HO. Two constraints:
1. **Read side only.** The fetch wrapper may rewrite list entries outside the allow-set so `updateDateIncludingText` and `updateDate` equal the bill's stored `update_date`, which the compare at `lib/sync.ts:393` reads as current. Page lengths stay unchanged, so `:434` still walks to the end, and detail fetches are untouched. Nothing marks a bill current in the store, and the second census must still read the unwritten behind bills behind: that is the control. Prod is written by `runSync`'s upsert for the allow-set and by nothing else.
2. **Below the cron's frontier.** The allow-set takes only bills listed strictly before the day of prod's `MAX(update_date)`, read immediately before the run; a bill listed on or after that day is the next tick's. Without it, an upsert carrying today's `updateDateIncludingText` would move `MAX(update_date)` past updates the cron hasn't processed yet, and the repair would drop a tail of its own. With it, the run may overlap a tick, but it doesn't start within ten minutes of one. *(The hole, flagged at the push and ruled: a bill dated on that day but before the watermark instant is no tick's either, since the tick lists from the watermark, to the second; the rule left seven such. The ruling on flags 1 and 2 restated it by instant, and pass 3 wrote the seven, below.)*

**"A newer latest action," the predicate, stated once** (`--impact`'s, and the repair's `buildAllow`): a behind bill's listed `latestAction.actionDate`, off census pass 1's saved pages (the last page listing the bill), is later, compared as `YYYY-MM-DD` strings, than its stored `latest_action_date`, or the stored one is NULL while the listed one is not. `lib/sync.ts:188` is the only writer of `bills.latest_action_date`.

## The repair, pass 1 (`--repair --allow p1`, label `r1`)

**The guards, printed before the run:** the database host `cbt-csu-j3.aws-us-west-2.turso.io` (`TURSO_DATABASE_URL`, by name), the same host SKILL names as the DB primary; `runSync({ fromDateTime: 2025-01-03T00:00:00Z })`, the 119th Congress's first day; the last `/api/sync` tick 6:00 PM MT (00:00Z Oct 21), 85 minutes before, and the next at midnight MT (06:00Z), 275 minutes after.

**The watermark, read immediately before the run** (7:25 PM MT, 01:25:13Z): `MAX(update_date)` **2026-10-20T22:49:19Z** (4:49 PM MT), so the frontier day is 2026-10-20. One tick had run since the census's snapshot: #26680 at 6:00 PM MT (00:00:10Z), `success`, `fromDateTime` 2026-10-20T17:49:25Z, `seen` 53, `upserted` 38, not budget-stopped.

**The allow-set, printed with the watermark:** **950** bills, 585 missing and 365 behind with a newer latest action, each listed before 2026-10-20. Against prod's snapshot at the run (19,127 bills), the predicate read **368** behind with a newer latest action (`--impact` read 370 five hours earlier); the other **7,919** of census p1's 8,287 behind are the control. The rule excluded 7, all listed on Oct 20, and **all seven dated before the watermark instant**, so the next tick, which lists from 22:49:19Z, doesn't list them either:

| Excluded | Class | Its date to the second (census p1's detail read) |
|---|---|---|
| `119-hr-9474` | missing | 2026-10-20T08:05:20Z |
| `119-hres-1545` | missing | 2026-10-20T08:05:18Z |
| `119-hres-1581` | missing | 2026-10-20T08:05:20Z |
| `119-s-4914` | missing | 2026-10-20T15:50:13Z |
| `119-hr-1653` | behind, newer action | 2026-10-20T15:27:01Z |
| `119-hr-3514` | behind, newer action | 2026-10-20T08:05:18Z |
| `119-hr-9640` | behind, newer action | 2026-10-20T08:05:23Z |

None of the allow-set read current in the store before the run. The allow-set, the control and the excluded are saved in `allowset-r1.json`.

**`runSync`:** started 7:25 PM MT (01:25:21Z), returned 7:37 PM MT (01:37:17Z), **11.9 minutes** of wall clock. `seen` **19,716** · `upserted` **944** · `skipped` 18,772 · `failed` **0** · `timedOut` **0** · `budgetStopped` false.

**The read-side view, over `runSync`'s 79 list pages** (78 of 250 and the last of 216, at offset 19,500, so `:434` walked to the end):
- 19,716 entries. **949 passed untouched** (in the allow-set and listed before the frontier day), 944 distinct. **18,763 read current**, both dates set to the stored `update_date`.
- **4 had both dates removed** (listed, outside the allow-set, no stored row), and `runSync` skipped each at `:387-391` with its own *list entry has no update date* line: `119-s-4914`, `119-hr-9474` (listed twice), `119-hres-1545`. The fourth excluded missing bill, `119-hres-1581`, was never listed by this walk.
- No allow-set bill was listed on or after the frontier day by the time the walk read it.

**Detail fetches: 944,** all 200, every one an allow-set bill, none outside it; none carried an `updateDateIncludingText` at or past the watermark.

**The read-back:**
- `MAX(update_date)`: 2026-10-20T22:49:19Z before and after, **unchanged**.
- The Congress's bills: 19,127 before, **19,708** after, **581 new**.
- Rows stamped since the start (`changed_at`, stamped on insert or when `update_date` moves): **944, every one in the allow-set, 0 outside it.** `upserted` 944, so no upsert rewrote a row whose `update_date` didn't move.
- The allow-set's 950: **944 stamped**; **6 never listed by this walk** (below).

**`rows_written` against the allow-set:** **14,352** in all, for 944 of the allow-set's 950 bills.

| Statement | Times | `rows_read` | `rows_written` |
|---|---|---|---|
| `INSERT INTO bills (…) … ON CONFLICT(id) DO UPDATE` (the upsert) | 944 | 363 | **14,164** |
| `INSERT INTO stage_transitions` | 47 | 376 | 188 |
| `SELECT id, update_date FROM bills WHERE id IN (…)` (the page compare) | 79 | 38,847 | 0 |
| `SELECT stage, update_date FROM bills WHERE id = ?` (the prior row) | 944 | 363 | 0 |

`rows_written` counts more than the row a statement names: **15.0 an upsert and 4 a `stage_transitions` insert,** where the handoff expected one each. The difference is what each write carries with it, the FTS triggers among them (`bills_fts_ai` on insert, `bills_fts_au` when `title`, `summary` or `sponsor_name` changes); this run doesn't split it further. 47 behind bills' stage advanced at upsert (HO 383), each logged once. `rows_read` during `runSync`: 39,949.

**Congress.gov during `runSync`:** 1,023 requests, all 200: 79 list pages and 944 details. One in flight at a time; the closest two starts 249 ms apart. `x-ratelimit-remaining` 18,533 of 20,000 at the last answer (7:37 PM MT).

**The residual after pass 1, six allow-set bills the walk never listed:**

| Bill | Class | Listed | Its date to the second |
|---|---|---|---|
| `119-s-4603` | missing | 2026-09-08 | 2026-09-08T18:12:22Z |
| `119-s-4727` | missing | 2026-09-08 | 2026-09-08T18:12:22Z |
| `119-s-4940` | missing | 2026-08-10 | 2026-08-10T11:51:27Z |
| `119-sres-788` | missing | 2026-08-10 | 2026-08-10T11:51:27Z |
| `119-s-4116` | behind | 2026-10-02 | 2026-10-02T11:03:21Z |
| `119-sjres-190` | behind | 2026-08-10 | 2026-08-10T11:58:37Z |

These are the offset walk's losses, the tie exposure the ledger never showed in a tick: the walk passed 5 allow-set entries twice and never reached these 6, and four of them share a timestamp with another of the six.

## Pass 2 (`--repair --allow p1 --residual-of r1 --from 2026-08-10T11:51:26Z`, label `r2`)

The residual's oldest date in claim 6's field is 2026-08-10T11:51:27Z (`119-s-4940` and `119-sres-788`, off census pass 1's detail reads), so pass 2 ran from one second before it. **Corrected at pass 3:** that doesn't move the page boundaries, as the handoff expected. Under `sort=updateDate desc`, `fromDateTime` trims only the list's old end, so a pass's offsets count from the same newest entry as a full walk's; pass 2 listed `119-hr-9474` at offsets 0 and 250, as pass 1 did. Pass 2's walk was shorter, 38 pages in 2.0 minutes, and it listed all six.
- **Printed before the run** (7:48 PM MT, 01:48:14Z): the watermark 2026-10-20T22:49:19Z again, so the frontier day is still Oct 20. The allow-set is r1's 950 less the 944 it stamped: **6**, 4 missing and 2 behind, all listed before the frontier day, none excluded. The control, 7,919, carries over. The last tick was 6:00 PM MT, 108 minutes before; the next was 252 minutes after.
- **`runSync`:** 7:48 to 7:50 PM MT (01:48:20 to 01:50:19Z), **2.0 minutes**. `seen` 9,264 · `upserted` **6** · `skipped` 9,258 · `failed` 0 · `timedOut` 0 · `budgetStopped` false.
- **The view, over 38 list pages** (37 of 250, the last 14 at offset 9,250): 6 entries passed, 9,254 read current, and the same 4 had their dates removed (`119-s-4914`, `119-hr-9474` twice, `119-hres-1545`). Every allow-set bill was listed.
- **Detail fetches 6,** all 200, all in the allow-set; none at or past the watermark.
- **The read-back:** the watermark unchanged; the Congress's bills 19,708 before and **19,712** after, 4 new; 6 rows stamped, all six in the allow-set, 0 outside.
- **`rows_written` 94:** the upsert 6 times, 90 rows (15.0 a bill), and 1 stage advance, 4 rows. Congress.gov: 44 requests, 38 list pages and 6 details, all 200.

**The two passes together: 950 of the allow-set's 950 written,** 585 inserted (581 and 4) and 365 updated (363 and 2), 48 stage advances logged at upsert. `rows_written` 14,446 in all, every row from `runSync`'s statements: the upsert 950 times (14,254) and `stage_transitions` 48 times (192). No pass wrote a bill outside the allow-set, and `MAX(update_date)` read 2026-10-20T22:49:19Z before and after both.

## After the repair: the second census, and the control

**The second census** (`--census --no-details --vs r1`, label `p2`, list read 7:40 to 7:47 PM MT, 01:40:19 to 01:47:31Z) and **the third** (`--vs r1,r2`, label `p3`, list read 7:50 to 7:51 PM MT, 01:50:38 to 01:51:18Z). Each walk was complete after its tie windows, 19,716 distinct against `pagination.count` 19,716, so neither needed a half-offset walk (each main walk repeated 45). Neither made a detail read. The second census's first run stopped at its 24th page, a body cut off mid-read (200 headers, then *terminated* after 54 s, 0 bytes); the instrument now retries a cut-off or unparseable body as it retries a 5xx, and its files are kept as `census-p2-cut`.

| | Census p1 (2:32 PM MT) | p2 (7:40 PM MT, after pass 1) | p3 (7:50 PM MT, after pass 2) |
|---|---|---|---|
| Listed (distinct) | 19,712 | 19,716 | 19,716 |
| Stored | 19,127 | 19,708 | 19,712 |
| **Missing** | **589** | **8** | **4** |
| **Behind** | **8,287** | **7,899** | **7,897** |
| Current | 10,836 | 11,809 | 11,815 |
| Ahead / extra | 0 / 4 | 0 / 0 | 0 / 0 |

**By type, the third census:**

| Type | Congress.gov | Stored | Missing | Behind |
|---|---|---|---|---|
| hr | 10,854 | 10,853 | 1 | 4,436 |
| s | 5,674 | 5,673 | 1 | 2,258 |
| hres | 1,633 | 1,631 | 2 | 577 |
| sres | 951 | 951 | 0 | 326 |
| sjres | 221 | 221 | 0 | 113 |
| hjres | 219 | 219 | 0 | 108 |
| hconres | 124 | 124 | 0 | 59 |
| sconres | 40 | 40 | 0 | 20 |
| **all** | **19,716** | **19,712** | **4** | **7,897** |

**Read against the repairs (p3):**
- **The allow-set, 950 bills: current 950.**
- **The control, 7,919 bills** (census p1's behind without a newer latest action at the repair's read): **behind 7,890**, current 29. The 29 were stamped by the 6:00 PM MT tick (#26680, 00:00:13 to 00:00:19Z), before the repair began; **none was stamped inside either repair's window.** `--impact`'s 7,917 is the same set less two bills that tick wrote between the two reads: `lib/sync.ts`'s upsert is the only writer of `latest_action_date`, and #26680's 38 upserts were the only ones in that interval (every upsert of a behind bill stamps `changed_at`, and 982 rows were stamped between the census's snapshot and the second census, 944 inside the repair and 38 at 00:00Z). So the 7,917 read **7,890 still behind**, and the tick wrote the other 27.
- **Rows stamped since census p1's snapshot: 988.** 950 inside a repair's window, every one in the allow-set; 38 outside every window, all at 00:00:13 to 00:00:19Z, the tick's 38 `upserted` (29 control, and 9 not in the gap, among them the four bills no walk returned, below).
- **The gap that's new since census p1:** missing 0; behind 4, each listed Oct 21 (UTC) against a stored date of Oct 20, so they are the midnight tick's: `119-hr-10355`, `119-hr-10238`, `119-hr-10353`, `119-hr-10371`.

## The residual after passes 1 and 2

**Missing: 4,** each the frontier rule's, listed Oct 20 and dated before the watermark, so no tick lists them either: `119-hr-9474` (2026-10-20T08:05:20Z), `119-hres-1545` (08:05:18Z), `119-hres-1581` (08:05:20Z), `119-s-4914` (15:50:13Z). That is the whole difference between Congress.gov's 19,716 and CT's 19,712. Pass 3 wrote all four (below).

**Behind: 7,897** = the control's 7,890, the frontier rule's three (`119-hr-1653`, `119-hr-3514`, `119-hr-9640`, each listed Oct 20 and dated before the watermark), and the four listed Oct 21. No allow-set bill is in the residual, so nothing was left that two passes failed to fetch.

## The ruling on flags 1 and 2 (Oct 21)

**Flag 1 was a hole in constraint 2.** The ruling wrote the frontier rule by day because the list carries only days, but the cron lists from the watermark instant, to the second. So the seven dated Oct 20 before 22:49:19Z were below every future `fromDateTime`. They were part of the ruled 959, and pass 3 took them.
- **The rule, restated:** the allow-set is (missing ∪ behind with a newer latest action) dated strictly before the watermark instant, read at the run. A bill listed on an earlier day than the watermark's is in on its list date. One listed on the watermark's day is placed by one detail read: its `updateDateIncludingText` before the instant, in; at or after it, the cron's.
- **The write-time guard, in the view:** a detail response dated at or past the instant has its `bill` removed, so `lib/sync.ts:411-414` counts it failed and writes nothing, and each is named. So the watermark can't move, by construction.
- **Flag 2, ratified:** for an entry outside the allow-set with no stored row, removing both dates so `:387-391` skips it is what constraint 1 means. Outside the allow-set, a stored bill reads current (both dates set to its stored date) and an unstored one reads undated (both removed); the sync skips both without a fetch, and page lengths are unchanged.

## Pass 3 (Oct 21 MT, Oct 22 UTC)

As ruled: a fresh census, the watermark read at the run, the repair with the view and the guard, a census, one `--from` pass for any allow-set bill still unwritten, and the closing census. The instrument ran at `079c55e`, the amended `diag` commit. The last `/api/sync` tick was at 6:00 PM MT (00:00Z Oct 22), and the next was due at midnight MT (06:00Z).

**Census p4** (`--census --no-details`, 7:11 to 7:15 PM MT, 01:11:20 to 01:15:07Z): complete after its tie windows, 19,716 of 19,716. **Missing 4, behind 7,905;** current 11,807, ahead 0, extra 0.
- The missing are the frontier rule's four.
- **The day since census p3 added 21 behind and no missing.** All 21 are listed Oct 21, and none has a newer latest action. The day's ticks wrote 13 of p3's gap.
- **So the day's drops held nothing that changed in substance,** and the allow-set is the seven.

**The day's ticks** (a side read of the ledger): the midnight, 6:00 AM and noon MT ticks finished clean (`seen` 14, 5 and 44; none budget-stopped; 0 failed). **The 6:00 PM MT tick (#26948, 00:00:10Z) errored in 0.4 s:** Congress.gov answered its first list page with a Cloudflare 520. So the watermark held at 17:38:45Z, and the next tick lists from there.

**r3, the repair** (`--repair --allow p4`, 7:16 to 7:19 PM MT):
- **The watermark, read at the run (01:16:30Z):** **2026-10-21T17:38:45Z** (11:38 AM MT). No tick had run since census p4's snapshot.
- **The allow-set, by instant: the seven.** Census p4's 4 missing and its 3 behind with a newer latest action are all listed Oct 20, a day before the watermark's, so all are in on their list dates. **None was listed on the watermark's day, so the run made no placement read, and the rule excluded none.** The control, census p4's behind without a newer action, is **7,902**.
- **`runSync`** (01:16:38 to 01:19:13Z, 2.6 minutes): `seen` 19,716 · `upserted` **5** · `skipped` 19,711 · `failed` 0 · `timedOut` 0.
- **The view, over 79 list pages** (78 of 250, the last 216): 5 entries passed and 19,711 read current. **0 read undated:** every unstored entry the walk listed was in the allow-set.
- **Detail fetches:** 5, all 200, all in the allow-set. **The guard removed none:** no detail was dated at or past the instant.
- **The walk never listed `119-hres-1581` or `119-hr-9640`.**
- **The read-back:** the watermark unchanged; 19,712 bills before and 19,715 after, 3 new; 5 rows stamped, all in the allow-set, 0 outside it; `rows_written` 75, 15.0 an upsert, and no stage advance.

**Census p5** (`--vs r3`, 7:19 to 7:22 PM MT): missing 1, behind 7,903.
- **The allow-set:** 5 current; `119-hres-1581` missing; `119-hr-9640` behind.
- **The control:** all 7,902 behind.
- **New since p4:** none.
- **The two, each placed by one detail read:** `119-hres-1581` at 2026-10-20T08:05:20Z and `119-hr-9640` at 08:05:23Z, both before the instant.
- **Rows stamped since p4's snapshot:** 5, all inside r3's window.

**The `--from` pass,** one second before the older date (`--from 2026-10-20T08:05:19Z`, the allow-set r3 left):
- **r4** (7:22 PM MT) read its first list page and stopped at the second. Congress.gov answered offset 250 with a Cloudflare 520, and `runSync`'s `fetchJson` retries a 429 and nothing else (`lib/sync.ts:85-95`), so it threw. **Nothing was written,** and the watermark didn't move.
- **r5** (7:23 PM MT) ran the same pass again: 2 list pages, 250 and 72; `seen` 322 · `upserted` **2** · `skipped` 320 · `failed` 0. Both bills were listed and fetched (200), and the guard removed neither. 19,715 bills before and 19,716 after, 1 new; 2 rows stamped, both in the allow-set; `rows_written` 30; the watermark unchanged.

**The seven, written:**

| Bill | Was | Stored now (`update_date`, the detail's `updateDateIncludingText`) | Pass |
|---|---|---|---|
| `119-hr-9474` | missing | 2026-10-20T08:05:20Z, inserted | r3 |
| `119-hres-1545` | missing | 2026-10-20T08:05:18Z, inserted | r3 |
| `119-s-4914` | missing | 2026-10-20T15:50:13Z, inserted | r3 |
| `119-hr-1653` | behind | 2026-10-20T15:27:01Z | r3 |
| `119-hr-3514` | behind | 2026-10-20T08:05:18Z | r3 |
| `119-hres-1581` | missing | 2026-10-20T08:05:20Z, inserted | r5 |
| `119-hr-9640` | behind | 2026-10-20T08:05:23Z | r5 |

Read back at 7:30 PM MT (01:30:27Z), every one of the seven already held a summary, and its `stage` read *committee*.

**Pass 3's writes:** `rows_written` **105**, every row `runSync`'s upsert, 7 bills at 15.0 each. `MAX(update_date)` read 2026-10-21T17:38:45Z before and after every pass.

**The closing census, p6** (`--vs r3,r4,r5`, 7:37 to 7:41 PM MT, 01:37:32 to 01:41:01Z): complete after its tie windows, 19,716 of 19,716. **Missing 0, behind 7,902;** current 11,814, ahead 0, extra 0, and CT stores 19,716, Congress.gov's count.
- **The allow-set:** all 7 current.
- **The control:** all 7,902 behind, none stamped since census p4.
- **New since p4:** no missing and no behind, so nothing needed placing against the instant.
- **Rows stamped since p4's snapshot:** 7, every one inside a repair's window and in the allow-set; none outside every window.

## The residual, named

**Missing: 0.** Congress.gov lists 19,716 bills for the 119th, and CT stores 19,716 (the closing census, 7:37 PM MT Oct 21).

**Behind: 7,902, every one by metadata alone:** census p4's control, all still behind, and none stamped by pass 3.
- 7,882 of `--impact`'s 7,917 are still behind. Of the other 35, the 6:00 PM MT tick of Oct 20 wrote 27, and the day's ticks wrote 8.
- 20 moved on Congress.gov on Oct 21 without a newer action. One of them, `119-hr-9467`, is a bill pass 1 inserted, so of the 957 the ruling repaired, 956 read current and it reads behind by metadata.

The ruling leaves them unwritten (OPEN LOOPS, *Should a Congress.gov change with no new action null a bill's summary at all?*), and the next HO's paced pass waits on that call. **Nothing else is in the gap:** no bill in it sits outside the control, so nothing needed placing against the instant. The 6:00 PM MT tick's 520 left the watermark at 17:38:45Z, and the midnight MT tick lists from there.

## The four readings the ruling asked for

**The four stored bills no walk in census p1 returned:** one detail read each (`--readings`, 7:51 PM MT, 01:51:41Z), **all four 200, so Congress.gov dropped none. Why no walk returned them is unsettled** (below).

| Bill | Detail | `updateDate` = `updateDateIncludingText` now | Latest action |
|---|---|---|---|
| `119-hr-4981` | 200 | 2026-10-20T20:18:35Z | 2025-08-15 |
| `119-hr-4979` | 200 | 2026-10-20T20:22:31Z | 2025-08-15 |
| `119-hr-4821` | 200 | 2026-10-20T20:24:31Z | 2025-07-29 |
| `119-hr-5224` | 200 | 2026-10-20T20:13:05Z | 2025-09-09 |

**Each was updated 7 to 19 minutes before census p1's main walk read its first page** (20:32:01Z): `119-hr-5224` at 20:13:05Z, 18 min 56 s before it; `119-hr-4981` at 20:18:35Z, 13 min 26 s; `119-hr-4979` at 20:22:31Z, 9 min 30 s; `119-hr-4821` at 20:24:31Z, 7 min 30 s. No walk in census p1 listed any of them. **Two readings fit, and neither is measured:**
- **The walk lost them.** An offset walk passes over a bill whose place in the list moves while it runs.
- **Congress.gov's list lagged its detail.** The handoff's fifth class names it: an entry that appeared in the list after its own `updateDate`. A bill updated minutes before a newest-first walk sits on the walk's first page, so this is the plainer reading.

The 200s fit both. **Telling them apart is the next HO's measurement:** list an id by `fromDateTime` right after its detail changes, and time when it appears. The 6:00 PM MT tick wrote all four (`changed_at` 00:00:16Z), so each stored date now equals Congress.gov's. Census p1's completeness check, 19,712 distinct against 19,716, read short, and these were the short four. The second and third censuses read 19,716 of 19,716 with all four listed.

**The dates' precision, measured off the saved pages:** census p1's 235 pages hold **58,557 entries** (main 19,716 · tie windows 19,250 · half walk 19,591). **0 carry a time in `updateDate`, and 0 in `updateDateIncludingText`;** every one is a bare day. The repair's own list pages read the same: 19,716 entries in pass 1 and 9,264 in pass 2, each date a bare day, and so do the second and third censuses, 19,716 distinct each. This is the next HO's STEP 0 input: `lib/sync.ts:393` compares a stored instant with a bare day, so a bill updated again on the day CT last stored it reads current.

**The predicate behind *a newer latest action*:** stated once, in *The HALT…* above.

**Claim 4's path:** `$.payload.sync.*`, corrected in *Ground truth*, item 1.

## The list cache

**Congress.gov answers a repeated list URL from a cache.** The readings below come from the saved pages, with no request of their own.
- **Census p1 asked 77 offsets twice:** first in the tie windows (a median 3,217 ms), then in the half walk at the same offsets (a median 254 ms). All 77 second answers held the same entries in the same order. The half walk's 2 offsets no tie window had asked took 3,441 and 1,168 ms. **So the half walk was the tie windows again plus two pages, not a second walk,** and p1's completeness check rests on the main walk, the tie windows and those two pages.
- **Each of census p3's 156 pages matched p2's** at the same walk and offset. p3 asked them 3.8 to 10.3 minutes later and was answered at a median 254 ms, against p2's 2,972. So p3's list is p2's (01:40 to 01:47Z Oct 21), read against the store after pass 2.
- **Census p2's first 24 pages answered in under 600 ms.** They are the 24 offsets the cut run had asked about two minutes earlier.
- **Some URLs no HO 788 run had asked came back fast too:** p1's main walk at 7 offsets from 0 to 2,250 (67 to 270 ms), and the cut run at 12 of its first 13. So our own requests aren't the only thing filling the cache, and a page's body can't tell its age.
- **Pass 3:** census p5's pages, asked 7.2 to 8.7 minutes after p4's, matched 138 of 157; those came back at a median 263 ms, and the 19 that differed at a median 4.9 s. But census p4, a day after p3, read its 105 changed pages at a median 321 ms, **so a fast answer isn't by itself a cached one.** Census p6, asked 17.5 to 18.9 minutes after p5, matched 132 of 157. Every one of its 124 pages under 600 ms was among them, and the 25 that differed took a median 5.5 s. Whether a matching page that comes back fast 18 minutes on is a cached copy or the origin's fast answer for an unchanged page, these reads can't tell.

**What it changes:**
- **The repairs' frontier held, whatever their pages' age.** No detail read was at or past the watermark, and the watermark didn't move.
- **The censuses' readings of the allow-sets and the controls stand,** since those bills' list dates predate each run.
- **For the four extras, the cache is a second route to the list-lag reading.** p1's first page (20:32:01Z, 244 ms) is the only read of the list's top 125 places, and a copy of it older than 20:13Z would leave all four out.

**For the next HO:** a cursor that re-lists the same URL after a stopped tick may read a cached page. The cache's age is its STEP 0 measurement.

## Cost

**Congress.gov: 11,142 requests for the HO, all 200 but one:** 10,555 on Oct 20 and 587 in pass 3, where r4's second list page answered 520. One of the 200s, the cut-off page in the second census's first run, is counted by its status, though its body never arrived. `CONGRESS_API_KEY` was read by name: in the `X-Api-Key` header on the instrument's own requests, and in the query on `runSync`'s, as production sends it. One request was in flight at a time, and the closest two starts were 249 ms apart.

| Run (MT; Oct 20 unless marked) | Requests | `rows_read` | `rows_written` |
|---|---|---|---|
| `--step0` r1, 2:28 PM | 12 | 78,912 | 0 |
| `--ticks` r1 and r2, 2:31 PM | 0 | 2,740 | 0 |
| `--census` p1, 2:31 to 3:24 PM | 9,119 | 20,497 | 0 |
| `--impact` r1, 3:29 PM | 1 | 28,656 | 0 |
| `--repair` r1 (pass 1), 7:25 to 7:37 PM | 1,023 | 99,384 | 14,352 |
| `--census` p2, the cut run, 7:37 PM | 24 | 20,596 | 0 |
| `--census` p2, 7:40 to 7:47 PM | 164 | 41,769 | 0 |
| `--repair` r2 (pass 2), 7:48 to 7:50 PM | 44 | 78,556 | 94 |
| `--census` p3, 7:50 to 7:51 PM | 164 | 41,783 | 0 |
| `--readings` r1, 7:51 PM | 4 | 896 | 0 |
| `--census` p4, Oct 21 7:11 to 7:15 PM | 165 | 21,087 | 0 |
| `--repair` r3 (pass 3), Oct 21 7:16 to 7:19 PM | 84 | 99,466 | 75 |
| `--census` p5, Oct 21 7:19 to 7:22 PM | 167 | 40,810 | 0 |
| `--repair` r4, Oct 21 7:22 PM (stopped by a 520) | 2 | 60,536 | 0 |
| `--repair` r5, Oct 21 7:23 PM | 4 | 60,683 | 30 |
| `--census` p6, Oct 21 7:37 to 7:41 PM | 165 | 40,814 | 0 |
| **the instrument, all runs** | **11,142** | **737,185** | **14,551** |
| the cron-window side read, 7:52 PM | 0 | 53,393 | 0 |
| the day's ticks and the seven's rows, Oct 21 7:28 and 7:30 PM | 0 | 26,986 | 0 |
| the crons alongside pass 3, Oct 21 7:41 PM | 0 | 26,964 | 0 |

**By endpoint:** the list without `fromDateTime` 573 (the censuses' pages, and two `limit=1` counts); the list with it 117 (`runSync`'s pages, 79 and 38); the per-type list 34 (32 counts and claim 6's two windows); the detail 9,831 (census p1's 8,876, the repair's 944 and 6, the four readings and claim 6's one). **`x-ratelimit-remaining` 17,629 of 20,000 at the end** (7:51 PM MT, 01:51:42Z). **Pass 3:** the list without `fromDateTime` 471 (the three censuses' pages), the list with it 83 (`runSync`'s pages: r3's 79, r4's 2, one of them the 520, and r5's 2), the per-type list 24 (the censuses' counts) and the detail 9 (the repairs' 7 and census p5's 2 placements); `x-ratelimit-remaining` 19,319 of 20,000 at the end (7:40 PM MT, 01:40:58Z). One more side read, the cron rows not `success` since census p3 (7:28 PM MT Oct 21), ran untapped, so its `rows_read` isn't counted.

**Against the handoff's budgets:**
- **Requests:** the handoff expected under 1,200. Census p1's 8,876 detail reads are the overrun (deviation 2). The repair made 1,067 (1,023 and 44), the ruling's *~1,040* plus pass 2. Pass 3 made 587: the three censuses' 497 and the repairs' 90.
- **Wall clock:** pass 1 took 11.9 minutes and pass 2 took 2.0, inside the handoff's half hour. Pass 3's `runSync` took 2.6 minutes (r3), and its `--from` pass 2.5 seconds (r5).
- **`rows_read`:** the handoff expected under 70,000; the instrument read **413,789**. That is over 57 of its own statements and 2,122 hrana results in all, `runSync`'s included, and every result carried `rows_read` and `rows_written`. The bulk is whole-table reads of `bills`, 19,127 to 19,712 rows a statement: STEP 0's claim 6 candidate scan over `raw_json`, each census's snapshot and stamped-row read, each repair's snapshot, count and read-back. `runSync`'s page compares read 57,367. The cron-window side read scanned `cron_runs` twice (53,393). The HALT's cron-window read (3:30 PM MT, 21:30:27Z) ran untapped and scanned the same table twice, about 53,000 (an estimate). In all, about 0.02% of the plan's 2.5B a month (HO 602). **Pass 3 read 323,396 more** over its six runs, the same shape: each census's snapshot and stamped-row reads, each repair's snapshot, count and read-back, and r3's 79 page compares (39,429). With it the instrument read **737,185** for the HO; with the side reads, about 0.04% of a month's plan.
- **`rows_written`: 14,551,** every row from `runSync`'s statements, for the 957 bills the ruling allowed: the upsert 957 times (14,359 rows; 950 in passes 1 and 2, 7 in pass 3) and `stage_transitions` 48 times (192). The handoff expected one row a statement; the measured rates are 15.0 and 4.
- **The schema fingerprint** read `736e6b987bf77620` before and after each of the seventeen runs.
- **No cron failed alongside.** At the HALT, from 20:25Z: markets 3, news 3, summarize 7, all `success`. From the repair's start (01:25Z) to 7:52 PM MT: news 1 and summarize 3, all `success`, and no row carried an error. `/api/sync` itself didn't run between the 6:00 PM MT tick and the end. **Pass 3:** from census p4's start (01:11Z Oct 22) to the closing census's end (01:41Z), news ran once and summarize three times, all `success`, and `/api/sync` didn't run.

## Appendix: census pass 1's 589 missing, by type, in number order

Each id is `119-<type>-<number>`. Pass 1 inserted 581, pass 2 the four marked ², and the frontier rule excluded the four marked † (listed Oct 20, dated before the watermark), which pass 3 inserted.

- **hr (236):** 126, 302, 3899, 8762, 8763, 8766, 8768, 8835, 8886, 8890, 8903, 8927, 9088, 9089, 9107, 9109, 9110, 9111, 9112, 9114, 9116, 9118, 9120, 9121, 9122, 9123, 9124, 9134, 9135, 9166, 9182, 9184, 9185, 9186, 9187, 9189, 9190, 9193, 9195, 9202, 9204, 9205, 9206, 9207, 9208, 9209, 9212, 9214, 9215, 9218, 9219, 9224, 9233, 9234, 9235, 9239, 9241, 9242, 9244, 9245, 9247, 9248, 9249, 9252, 9254, 9256, 9311, 9312, 9313, 9314, 9315, 9318, 9320, 9322, 9323, 9324, 9387, 9403, 9406, 9412, 9420, 9425, 9427, 9428, 9430, 9440, 9443, 9444, 9448, 9449, 9450, 9451, 9455, 9459, 9460, 9465, 9466, 9467, 9470, 9472, 9473, 9474†, 9475, 9476, 9478, 9479, 9480, 9481, 9484, 9485, 9487, 9502, 9503, 9506, 9508, 9510, 9511, 9512, 9514, 9517, 9518, 9520, 9522, 9523, 9524, 9525, 9526, 9527, 9529, 9531, 9532, 9533, 9534, 9536, 9538, 9541, 9542, 9544, 9545, 9546, 9547, 9548, 9549, 9552, 9555, 9556, 9557, 9558, 9563, 9564, 9565, 9566, 9569, 9612, 9620, 9621, 9622, 9624, 9625, 9626, 9627, 9628, 9629, 9630, 9631, 9632, 9633, 9634, 9635, 9636, 9637, 9639, 9647, 9648, 9649, 9651, 9652, 9653, 9654, 9655, 9657, 9658, 9660, 9664, 9665, 9666, 9668, 9669, 9670, 9675, 9676, 9677, 9678, 9679, 9688, 9691, 9695, 9696, 9743, 9749, 9760, 9761, 9762, 9765, 9766, 9768, 9769, 9775, 9777, 9778, 9781, 9786, 9787, 9791, 9792, 9793, 9836, 9837, 9848, 9853, 9866, 9875, 9881, 9987, 9998, 9999, 10000, 10005, 10010, 10306, 10311, 10439, 10479, 10480, 10483, 10544
- **s (242):** 137, 733, 1159, 1566, 1628, 4488, 4493, 4494, 4496, 4497, 4499, 4501, 4508, 4515, 4516, 4529, 4536, 4540, 4541, 4542, 4544, 4547, 4574, 4575, 4584, 4596, 4602, 4603², 4607, 4609, 4613, 4644, 4645, 4646, 4647, 4648, 4649, 4656, 4657, 4658, 4663, 4669, 4670, 4672, 4674, 4675, 4678, 4679, 4681, 4682, 4683, 4685, 4687, 4690, 4692, 4693, 4694, 4695, 4697, 4698, 4699, 4700, 4701, 4703, 4704, 4706, 4707, 4710, 4712, 4713, 4714, 4716, 4717, 4718, 4719, 4721, 4722, 4725, 4727², 4728, 4729, 4731, 4732, 4733, 4734, 4735, 4736, 4737, 4738, 4739, 4740, 4741, 4743, 4746, 4747, 4750, 4751, 4752, 4753, 4754, 4755, 4756, 4757, 4758, 4759, 4760, 4761, 4762, 4763, 4764, 4766, 4768, 4769, 4770, 4771, 4772, 4773, 4774, 4776, 4777, 4778, 4779, 4780, 4783, 4785, 4788, 4789, 4790, 4791, 4795, 4797, 4799, 4803, 4804, 4805, 4806, 4807, 4810, 4811, 4813, 4815, 4816, 4818, 4821, 4826, 4827, 4829, 4831, 4832, 4835, 4836, 4837, 4840, 4841, 4842, 4848, 4849, 4851, 4852, 4855, 4856, 4857, 4858, 4861, 4864, 4866, 4867, 4868, 4871, 4872, 4874, 4875, 4876, 4877, 4878, 4880, 4882, 4883, 4884, 4885, 4888, 4889, 4891, 4892, 4893, 4894, 4899, 4900, 4901, 4902, 4903, 4904, 4907, 4908, 4909, 4910, 4914†, 4917, 4921, 4922, 4923, 4924, 4925, 4927, 4928, 4930, 4931, 4932, 4935, 4940², 4943, 4945, 4948, 4953, 4995, 5014, 5017, 5019, 5020, 5027, 5029, 5030, 5031, 5080, 5086, 5092, 5095, 5096, 5099, 5119, 5137, 5138, 5139, 5140, 5161, 5166, 5421, 5425, 5432, 5451, 5594, 5677
- **hres (69):** 1303, 1304, 1343, 1346, 1348, 1349, 1350, 1353, 1367, 1368, 1369, 1370, 1378, 1393, 1395, 1396, 1397, 1401, 1402, 1403, 1404, 1405, 1406, 1408, 1410, 1411, 1412, 1413, 1415, 1417, 1421, 1422, 1425, 1427, 1429, 1431, 1433, 1434, 1435, 1437, 1444, 1445, 1446, 1448, 1449, 1450, 1460, 1462, 1463, 1465, 1466, 1467, 1468, 1470, 1471, 1472, 1474, 1531, 1545†, 1547, 1562, 1575, 1579, 1581†, 1583, 1597, 1598, 1600, 1617
- **sres (29):** 725, 726, 727, 756, 757, 759, 770, 771, 773, 774, 776, 777, 779, 780, 782, 784, 785, 787, 788², 789, 792, 793, 794, 795, 800, 804, 806, 812, 855
- **hjres (4):** 183, 188, 194, 201
- **sjres (4):** 194, 195, 200, 202
- **hconres (4):** 111, 114, 120, 121
- **sconres (1):** 34
