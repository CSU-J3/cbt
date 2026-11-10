# HO 812 — CT's laws against the official list: one law read short of `enacted`, set by hand, and the poster's print read

> **A probe with one prod write.** Base `811-review` at `64aad1d`, built on `812-review`; app code is `main`'s at `1ebc2aa`. Run **Tuesday 2026-11-10**, Mountain Standard Time with UTC beside, inside one window between `/api/sync` runs: #32118 (started 11:00:11 AM MST, 18:00:11Z) was the newest throughout, and the next was due at 5:00 PM MST (00:00Z Nov 11).
> - **Prod took one statement and one flush.** § 1's `UPDATE`, `rowsAffected` 1, at 12:15:56 PM MST (19:15:56Z); the `bills` tag flushed once, 200, at 12:16:07 PM MST (19:16:07Z). Everything else read prod's database by `SELECT` only, or its pages by GET. Every run that read the database, all but the one-statement Gosar count, fingerprinted the schema and read `4e94644350e1d992` before and after.
> - **Congress.gov was read by GET only,** with `CONGRESS_API_KEY` by name in the `X-Api-Key` header.
> - **The instruments:**
>   - the tracked law check, `scripts/diagnostic/laws-vs-official-812.ts`;
>   - HO 811's inline check that preceded it, `docs/handoffs/811-artifacts/laws-check-811.ts`;
>   - the reads, the write, the served-page reads and the Gosar count under `docs/handoffs/812-artifacts/` (repo-ignored), with `before.tsv`, the reversal list.

## The poster, after the fix

The print read (§ 3), 12:18:16 to 12:18:32 PM MST (19:18:16 to 19:18:32Z), read-only:

```
THE DOME, NOV 10, 2026, 12:18 PM MT
BECAME LAW 127 · ON THE PRESIDENT'S DESK 3 · PASSED ONE CHAMBER 565 · REACHED THE FLOOR 245 · NOT REFERRED YET 105 · IN COMMITTEE 15,637
BILLS 16,682 · CEREMONIAL 404 · ALL 17,086
```

- **The dome** is HO 799's statement (`--label print`, its cube as of 12:18:22 PM MST, 19:18:22Z), with calendar placements at `floor` counted as committee, as the printed dome does: floor 293 − 48 = 245, committee 15,589 + 48 = 15,637.
  - BILLS is the dome (`bill_type IN ('hr','s','hjres','sjres') AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`).
  - CEREMONIAL is the law-eligible rows tagged 1, and ALL the law-eligible rows at any tag.
- **The party lines** (HO 810's script, `--label print`, as of 12:18:27 PM MST, 19:18:27Z):
  ```
  REPUBLICANS: 8,588 BILLS · 108 LAWS · 1.26%
  DEMOCRATS: 8,001 BILLS · 19 LAWS · 0.24%
  INDEPENDENTS: 93 BILLS · 0 LAWS · 0.00%
  ```
- **Colorado's lines** (HO 811's script, `--label print`, as of 12:18:32 PM MST, 19:18:32Z):
  - the ten member lines read as at 10:40 AM;
  - COLORADO `358 BILLS · 1 LAWS · 0.28%`;
  - CONGRESS `16,682 BILLS · 127 LAWS · 0.76%`.
- **The printed Nov 5 dome, restated.** The bill was at `committee` before that as-of (STEP 0 claim 5, below), so the printed dome held it among its 15,622.
  - It now reads **127** laws and **15,621** in committee.
  - The other figures stand as printed: 16,664 bills, 105 not referred, 246 at the floor, 565 past one chamber, 0 at the president, 405 ceremonial and 17,069 in all.
- **One hand tag moved** (the hand-row read-back, `--label print`): `119-hr-1945`, which HO 803 set to 1, reads 0.
  - The summarizer re-summarized it on Nov 6 (`summary_updated_at` 2026-11-06T12:10:25Z) and re-tagged it.
  - It's named, not re-set.

## The check: method and counts

- **The official list:** Congress.gov's `/law/119/pub` and `/law/119/priv`. Their shape is the one `scripts/backfill-historical-laws.ts:5-8` verified: items under `bills`, the law number at `laws[].number`, the origin bill at `congress`/`type`/`number`.
  - It lists **138 public laws**, numbered 119-1 to 119-138, none missing.
  - It lists **2 private laws**: Private Law 119-1 (`119-hr-3377`) and 119-2 (`119-hr-7194`).
  - That's 140 bills, all hr, s, hjres or sjres, none of them more than one law.
- **CT's side,** in one read-only transaction:
  - the `enacted` rows among those four types, at any tag;
  - CT's row for every official law's bill.
- **The diff both ways, before the write:** HO 811's check (`--label laws`, as of 11:46:44 AM MST, 18:46:44Z) and STEP 0's re-run (`--label step0`, as of 12:14:31 PM MST, 19:14:31Z) both read:
  - **139** held at `enacted`;
  - **1** short (`119-hr-1043`);
  - **0** not in CT;
  - **0** CT laws the list lacks.
- **After the write:** HO 811's check (`--label after`, as of 12:16:27 PM MST, 19:16:27Z) and the tracked script's record run (`--label 812`, as of 12:22:38 PM MST, 19:22:38Z) both read **140 of 140**, with 0 short, 0 not in CT and 0 CT-only.

## The row: `119-hr-1043`

*La Paz County Solar Energy and Job Creation Act*, *Rep. Gosar, Paul A. [R-AZ-9]* (`G000565`). Its action history comes from Congress.gov (`/bill/119/hr/1043/actions`, 29 actions, saved 11:52 AM MST (18:52Z) by `docs/handoffs/811-artifacts/actions-hr1043-811.ts`):

| Date | Action |
|---|---|
| 2025-02-06 | Introduced in the House; referred to Natural Resources |
| 2025-07-02 | Reported by Natural Resources (H. Rept. 119-183); placed on the Union Calendar |
| 2025-07-21 | Passed the House by voice vote, under suspension |
| 2025-07-22 | Received in the Senate; referred to Energy and Natural Resources |
| 2025-09-11 | Energy and Natural Resources ordered it reported, without amendment |
| 2025-12-16 | The committee discharged by unanimous consent; passed the Senate without amendment by voice vote |
| 2025-12-18 | Presented to the President |
| **2025-12-29** | **Signed by the President; Became Public Law No: 119-68** |
| **2026-02-11** | **By Senator Lee from Committee on Energy and Natural Resources filed written report. Report No. 119-109.** (the latest action) |

**CT's row before the write.** STEP 0's read (as of 12:14:31 PM MST, 19:14:31Z) and `before.tsv` (as of 12:15:56 PM MST, 19:15:56Z) agree on every column the snapshot holds:
- `stage` `committee`; `previous_stage`, `stage_observed_at`, `pending_stage` and `pending_stage_at` all NULL; `is_ceremonial` 0;
- `update_date` 2026-11-06T21:07:16Z, the same as Congress.gov's (STEP 0's law check read both);
- `latest_action_date` 2026-02-11, the Feb 11 report.

STEP 0's read alone adds:
- a summary (`summary_updated_at` 2026-10-29T01:40:44Z);
- the latest action's text, the report;
- `raw_json`'s `$.laws` reading `[{"number":"119-68","type":"Public Law"}]`;
- no `sync_queue` row and no `stage_transitions` row.

**When it was staged (STEP 0 claim 5).** The bill has no `stage_transitions` row and no stamp.
- **Both writers stamp and log every stage move they make.**
  - The summarizer's advance writes `stage_observed_at` and a log row together (`lib/summarize-runner.ts:317-350`).
  - So does the sync's (`lib/sync.ts:416`, `:433`, `:468-476`).
- **So CT set this stage before the log began, or through a stampless one-off.** Observation tracking began 2026-05-11 (`lib/enacted-this-week.ts:42-43`).
- **It was already `committee` at its last summary,** 7:40:44 PM MDT Oct 28 (2026-10-29T01:40:44Z), which left `pending_stage` NULL.
  - Reading `committee` off the latest action, the summarizer would have pended a downgrade from any higher stage, or logged an advance from a lower one (`decideStage`, `lib/summarize-runner.ts:112-124`).
  - So it found the row at `committee`.
- **No logged writer has moved it since.**
- **So it was at `committee` at the printed dome's as-of,** 12:37:44 PM MST Nov 5 (19:37:44Z), and the printed 15,622 held it.

## Why it read `committee`

- **`computeStage` reads the latest action alone** (`lib/enums.ts:97`). This bill's latest action is a Senate committee's written report, filed six weeks after the law was signed, so it reads `committee`.
- **The sync can't correct it.** It advances a stage only when `update_date` moved and the computed stage is higher (`lib/sync.ts:404-416`), and a re-fetch computes `committee` again. CT's record already matched Congress.gov's (the same `update_date`).
- **So the count of `enacted` is a floor** until it's checked against the official list. That's the backlog line this HO files, and the tracked law check is its instrument.

## The write (§ 1)

- **The snapshot came first:** `docs/handoffs/812-artifacts/before.tsv`, the reversal list, sha256 `de2b07da…`, as of 12:15:56 PM MST (19:15:56Z).
- **One statement,** in one write transaction:
  ```sql
  UPDATE bills
     SET stage = 'enacted',
         previous_stage = NULL,
         stage_observed_at = NULL,
         pending_stage = NULL,
         pending_stage_at = NULL
   WHERE id = '119-hr-1043' AND stage = 'committee'
  ```
  - `rowsAffected` was **1**, committed at 12:15:56 PM MST (19:15:56Z).
  - No row went into `stage_transitions`, and the row carries no stamp (the chat's ruling).
  - Those clocks feed, among others, MOVERS (`lib/queries.ts:7945-7946`), the week summary (`lib/week-summary.ts:88`) and the weekly report: its stage ladder (`lib/report-generation.ts:677-682`) and its enactments (`lib/enacted-in-week.ts:33-37`). With no stamp and no log row, none of them announces a law signed in December.
  - HO 239's repair left its rows the same way (`scripts/repair-impossible-stage-pairs-239.ts:89-91`).
- **The flush, once:** `POST /api/revalidate?tag=bills` on prod (the host in `scripts/verify-deploy.ts:22`), Bearer `CRON_SECRET` by name, no redirect followed. It returned **200** `{"ok":true,"tag":"bills"}` in 423 ms, answered at 12:16:07 PM MST (19:16:07Z).
- **The reversal's shape,** not run: the row back to `before.tsv`'s values, then the same flush.
  ```sql
  UPDATE bills
     SET stage = 'committee',
         previous_stage = NULL,
         stage_observed_at = NULL,
         pending_stage = NULL,
         pending_stage_at = NULL
   WHERE id = '119-hr-1043' AND stage = 'enacted'
  ```
- **How long the hand-set stage holds:** a sync won't undo it, since the sync only advances. The summarizer pends a downgrade and takes it on the second matching proposal (`decideStage`, `lib/summarize-runner.ts:112-124`), so two re-summaries would undo it. The code fix belongs to the backlog line.

## § 2's reads, after the write

- **The row** (as of 12:16:26 PM MST, 19:16:26Z): `enacted`, with the four stamp columns NULL. It has no `stage_transitions` row and no `sync_queue` row.
- **The counts:**
  - **127** laws in the dome's predicate (R 108, D 19);
  - **140** law-eligible laws at any tag (138 public and 2 private).
- **The served pages' own count** uses `getStageDistribution`'s predicate (`lib/queries.ts:570-577`: non-ceremonial, summarized, any bill type). It reads **127**, all of them hr, s, hjres or sjres.
- **The law check again** (`--label after`): 0 short, 0 unknown.
- **Prod's served HTML.**
  - The page read (`served-812.ts`, 12:17:15 to 12:17:25 PM MST, 19:17:15 to 19:17:25Z) fetched `/`, `/welcome`, `/bill/119-hr-1043` and `/members/G000565`: each 200, each a cache miss.
  - Its patterns missed `/welcome`'s and the hub's markup, so a second GET of those two and the bill (`inspect-812.mjs`, 12:17:37 to 12:17:40 PM MST, 19:17:37 to 19:17:40Z) quoted it. That console output is transcribed in `inspect-812.out`. The pages read:
  - `/`, with the gate cookie: the masthead reads **127** *enacted* (`components/DashboardV2Header.tsx:100-103`), and the bill appears nowhere in the page's text.
  - **MOVERS, from the whole HTML.** That text can't speak for MOVERS. `/` opens on NEW THIS WEEK unless that tab is empty or a filter is set (`app/page.tsx:174`), and it renders only the open tab (`components/ActivityTabs.tsx:103-107`). A closed tab's rows travel in the script payload the page read stripped.
    - A second read of `/` took the whole HTML, the payload included (`movers-812.mjs`, 1:05:26 PM MST, 20:05:26Z, a cache miss). NEW THIS WEEK (18) was open.
    - The bill appears 0 times anywhere in the HTML. The MOVERS rows the page ships (`"metricMode":"movers"`, 27 bill ids, the control) don't include it.
    - MOVERS can't list it anyway: its predicate requires a stamp (`lib/queries.ts:7945`), and the row has none.
  - `/welcome`: **127** *Became law* 0.7%.
  - `/bill/119-hr-1043`: the stage ladder's current node (class `cur`) is **ENACTED**, beside the latest action's date, 2026-02-11.
- **Gosar's hub,** `/members/G000565`, reads *Sponsored 27 · Enacted **1** (3.7%)*.
  - By `SELECT` (`gosar-812.ts`, 12:18:00 PM MST, 19:18:00Z, transcribed in `gosar-812.out`), his 27 non-ceremonial bills hold one law, this one.
  - So the hub already read the fix on a cache miss, though the `members` tag wasn't flushed.
- **Prod's schema fingerprint,** before and after: `4e94644350e1d992`, unchanged.

## What moved on the poster

| | The morning reads (9:49 and 10:40 AM) | The print read (12:18 PM) |
|---|---|---|
| The dome's laws | 126 | **127** |
| The dome's bills | 16,677 | **16,682**: five new House-started bills after the 11:00 AM sync (R +1, D +4) |
| At the president | 2 | **3** (one more House-started R bill) |
| REPUBLICANS | 8,587 · 107 · 1.25% | **8,588 · 108 · 1.26%** |
| DEMOCRATS | 7,997 · 19 · 0.24% | **8,001 · 19 · 0.24%** |
| R, started in the House | 5,710 · 65 · 1.14% | **5,711 · 66 · 1.16%** |
| COLORADO | 358 · 1 · 0.28% | 358 · 1 · 0.28% |
| CONGRESS | 16,677 · 126 · 0.76% | **16,682 · 127 · 0.76%** |
| Public laws under Pew's Oct 14 cut | 11 of 120 (Nov 5) | **11 of 121**, beside Pew's 12 of 121 |

## Flagged

1. **`/`'s masthead labels its count *enacted*.** The handoff words both pages as *Became law 127*; `/welcome` says *Became law*.
2. **The party and Colorado scripts print that the dome's 126 doesn't hold, and list no law observed since Nov 5.** That's because the row carries no stamp.
   - HO 810's verdict line ends on an empty list ("(+1): "), since its vocabulary has no hand-set row.
   - Its reconciliation lines carry the case: 140 laws observed by then or never stamped, against Nov 5's 139, and 127 not hollow on Nov 5, against 126.
3. **§ 2's law check ran twice:** HO 811's inline check, as STEP 0 did, and the tracked script's record run. Both read 0 short.
4. **MOVERS was read a second time, at 1:05 PM.** The first page read stripped the script payload, where the closed tab's rows travel, so it couldn't speak for MOVERS. The second read searched the whole HTML. It still fell inside the window: no `/api/sync` had run since 11:00 AM.

## The ledger

Every database read below is `SELECT` only, and the page reads are GETs. Each run that read prod's database fingerprinted the schema before and after, all but the Gosar count, and read `4e94644350e1d992` both times. The flush and the page reads didn't touch the database.

| Run | Start (MST) | Prod | Congress.gov |
|---|---|---|---|
| STEP 0's reads (`reads-812.ts step0`) | 12:14:30 PM | 10 statements | — |
| STEP 0's law check (`laws-check-811.ts --label step0`) | 12:14:30 PM | 8 statements, 1,611 `rows_read` | 3 GETs |
| § 1, the write (`write-812.ts --go`) | 12:15:55 PM | 6 statements: two fingerprints, the snapshot, **the one `UPDATE`**, the read-back and a `stage_transitions` count | — |
| § 1, the flush (`write-812.ts flush`) | 12:16:06 PM | **the one flush** | — |
| § 2's reads (`reads-812.ts after`) | 12:16:26 PM | 10 statements | — |
| § 2's law check (`laws-check-811.ts --label after`) | 12:16:26 PM | 8 statements, 1,614 `rows_read` | 2 GETs |
| § 2's served pages (`served-812.ts`, then `inspect-812.mjs`) | 12:17:15 PM, 12:17:37 PM | GETs of prod's pages: 4, then 3 | — |
| § 2's Gosar count (`gosar-812.ts`) | 12:18:00 PM | 1 statement | — |
| § 2's MOVERS read (`movers-812.mjs`) | 1:05:26 PM | 1 GET of prod's `/` | — |
| § 3's four print runs | 12:18:16 to 12:18:32 PM | 3, 24, 32 and 30 statements | — |
| The tracked law check (`--label 812`) | 12:22:37 PM | 6 statements, 1,729 `rows_read` | 2 GETs |
