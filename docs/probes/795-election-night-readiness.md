# HO 795: election-night readiness at `dc491c8`. The Nov 4 runbook at today's lines, its preconditions read on prod and the box, and the HO 777 rehearsal re-run on today's tree: 238 / 9 / 1 first, every FAIL a pre-ruling expectation, then 247 / 0 / 1 after the re-match

> **Probe, read-only.** Base: `main` at `dc491c8`. Read Thursday 2026-10-29, in Mountain Time (MDT, UTC−6) with UTC beside:
> - STEP 0 at 3:03:31 PM (21:03:31Z);
> - the seed from 3:09:39 to 3:10:35 PM;
> - the cold build from 3:11:09 to 3:12:14 PM;
> - the first run, label `795`, from 3:12:36 to 3:14:15 PM;
> - the hand reads from 3:16:42 to 3:17:18 PM;
> - the HALT, then the ruling;
> - the second run, label `795b`, on the same seed and copies after the re-match, from 3:46:12 to 3:47:48 PM.
>
> Prod was read by `SELECT` only, and the rehearsal ran on `file:` copies: no cron call, no write. **The Nov 4 handoff is written from this file on the evening of Tuesday Nov 3, and numbered then.**

**What this found.** The runbook's preconditions hold four days out:
- **The ballot cron:** 84 of 84 rows read `success` over the week, 3,305 READ of 3,307 attempted. Its only UNREADs were two timeouts on Oct 23.
- **The races:** all 470 were read within 24 hours, and 0 are marked.
- **The other crons:** green, except the ratings cron, which is refused as expected.
- **The box:** `.env` carries `CRON_SECRET`.

**The rehearsal.** HO 777's rehearsal on today's tree first read **238 PASS, 9 FAIL, 1 N/A**. Every FAIL was an expectation written before a ruling: seven before HO 779's kept tag, and two before HO 783's dated Georgia runoff. Re-matched to the rulings' text, the same seed and copies read **247 PASS, 0 FAIL, 1 N/A**. No surface FAILed.

## The clock
- **The zones:** Mountain Time is MDT (UTC−6) until 2:00 AM Sunday Nov 1, then MST (UTC−7).
- **The days:** election day is Tuesday Nov 3 (`date -u -d 2026-11-03 +%A`). The first read of results is Wednesday Nov 4 (`date -u -d 2026-11-04 +%A`) at **8:00 AM MST, 15:00Z**.
- **The crons that morning, in MST** (`vercel.json`):

  | Cron | Schedule | Runs at |
  |---|---|---|
  | general-ballot | `20 */2 * * *` (`:140-141`) | :20 of every even UTC hour: 5:20, 7:20, 9:20 AM |
  | kalshi | `15 */2 * * *` (`:116-117`) | :15 of every even UTC hour |
  | primaries | `0 0,12 * * *` (`:88-89`) | 5:00 AM (12:00Z) |
  | race-challengers | `30 12 * * *` (`:92-93`) | 5:30 AM (12:30Z) |
  | `/api/sync` | `0 */6 * * *` (`:64-65`) | 5:00 and 11:00 AM |

- **The windows a manual call stays clear of:**
  - :15 to :35 of an even UTC hour (Kalshi at :15, then the ballot tick at :20 and its four minutes);
  - 00:00 to 00:10Z and 12:00 to 12:10Z (the primaries cron).
- **From 15:00Z,** an odd UTC hour, the next window opens at 16:15Z (9:15 AM MST).
- **The pages turn at 00:00Z Nov 4, which is 5:00 PM MST Nov 3.** The election-day gate counts UTC dates (`daysToElection`, `lib/format.ts:142-148`), and the race page (`raceResultView`, `lib/race-result.ts:264-265`) and the band (`components/Battlefield.tsx:96`) leave their countdown once it reads below 0.
  - From then until Ballotpedia marks, every race page reads *Not yet called*, and the band reads RESULTS with 0 called.
  - That's the gate, not a fault. The band's countdown has its own helper, the hours left rounded up and floored at 0 (`components/Battlefield.tsx:25-27`), and reads *0 DAYS* from 00:00Z Nov 3.

## The preconditions (STEP 0, read Oct 29; the Nov 4 handoff's STEP 0 re-reads them)
- **The ballot cron's week** (`/api/cron/general-ballot`, rows started from 3:03:31 PM MT Oct 22):
  - **84 rows, all `success`.**
  - **82 ticks read alike:** 40 attempted, 40 READ, stop `cap`, 40 requests, `minGapMs` 6000, 0 runoff boxes, 234,251 to 241,658 ms.
  - **Two stopped on an UNREAD, both timeouts on Oct 23:**
    - #27325: `MA-03-2026`, after 25 READ;
    - #27490: `VT-AL-2026`, its first race.
  - **The sums:** 3,307 attempted, 3,305 READ, 2 UNREAD, 0 NO_PAGE.
  - **No cause names a challenge, a WAF or a 202,** and no tick in the last 48 hours read UNREAD more than 5. Either, on Nov 3, means Ballotpedia may be walling pdx1, and (a) rests on it.
- **The races:**
  - `general_ballot_reads` holds all 470.
  - The oldest `last_attempt_at` is 4:21:36 PM MT Oct 28 (22:21:36Z), 22.7 hours before the read, and the newest is 2:24:31 PM MT Oct 29.
  - Every last attempt was a READ: 463 `box`, 7 `no_box`.
  - **Marked: 0.** No row is marked in `general_ballot` (1,345 rows in 463 races) or in `general_ballot_reads`, and `general_runoff` holds 0 rows. A mark before the polls close would be a fault.
- **The other crons:**
  - **`/api/cron/primaries`:** 14 of 14 `success`. The last `?state=` row is HO 778's #24524 (LA, 6 of 6, 10,960 ms).
  - **`/api/cron/race-challengers`:** 7 of 7 `success`. Oct 29's #28924 wrote 909 rows over 465 races, with jungle 6 races and 0 decided.
  - **`/api/cron/kalshi`:** 24 of 24 in 48 hours. `kalshi_odds` (469 rows) and `polymarket_odds` (34) were written at 2:15:37 PM MT.
  - **`/api/sync-race-ratings`:** 7 of 7 `error`, Sabato's Cloudflare challenge as expected, nothing written.
  - **`/api/sync`:** 28 of 28 `success`. The daily wide ticks enqueued 182, 40, 36 and 320.
- **The box:**
  - `.env` carries `CRON_SECRET`, present and non-empty (by name, never printed).
  - `npx tsx scripts/diagnostic/gradshow-numbers-787.ts` with no mode prints its usage line (`:1035`) and exits 2, so Corey's `--odds-snapshot` runs load on this tree.

## The runbook, in the WATCH line's order: (a), then (c), then (b), then the reads

### (a) The ballot: twelve authorized POSTs of `/api/cron/general-ballot`
- **The call:** `POST` to the Production host `npm run verify:deploy` polls (SKILL `:2826`), `/api/cron/general-ballot`, with `Authorization: Bearer $CRON_SECRET`, the secret read from `.env` by name (`app/api/cron/general-ballot/route.ts:36-49`; GET or POST, `:67-73`).
- **One call is one tick:**
  - at most 40 races (`TICK_CAP`, `lib/general-ballot.ts:76`) in a 240 s budget (`TICK_BUDGET_MS`, `:77`), 6 s start to start (`MIN_START_GAP_MS`, `:70`);
  - under the route's 300 s ceiling (`maxDuration`, `route.ts:34`) with a 290 s soft timeout (`:61`);
  - measured: HO 777's #24309 read 40 of 40 in 234.5 s, and this week's 82 full ticks took 234.3 to 241.7 s.
- **The queue** is the reads table: least recently attempted first, never attempted first of all, `race_id` breaking ties (`selectQueue`, `lib/general-ballot.ts:880-897`), read once at the tick's start. Twelve calls take each of the 470 once: eleven of 40, then one of 30.
- **The stop:** the first UNREAD ends the tick (`stopRule: "first-unread"`, `:1077`; `:1008-1013`). The race is stamped and requeued at the back, so the calls go on until no race's `last_attempt_at` predates the first call.
- **The lock:** a call that finds another general-ballot row `running`, started inside the 300 s ceiling, reads nothing. Its row closes `success` with `stop` `yielded`, and `yieldedTo` names the run it found (`route.ts:21-26`; `runInFlight`, `lib/general-ballot.ts:931-942`; `generalBallotTick`, `:1066-1070`). An older open row doesn't block: the reaper marks it `orphaned` at 5 minutes (`lib/cron-log.ts:26`, `:101-110`).
- **The pause:** the 6 s spacing holds inside a run only (`runGeneralBallot` makes its pacer per run, `lib/general-ballot.ts:946`), so wait 10 s after each run closes.
- **Each call's outcome is its `cron_runs` row,** read before the next call. From this box the POST's client side dropped at 60 s while the run went on to close `success` (HO 777's #24309, `fetch failed`). A dropped call is never re-sent unread.
- **What a READ expires:** a tick that READs expires `general-ballot` once (`:1099`). That reaches every reader the night turns, each of which carries `general-ballot` and `races`:
  - the race page's decided state (`getRaceResult`, `lib/queries.ts:2127-2131`);
  - its roster (`getRaceRoster`, `:2023`, tags `:2121`);
  - the band (`getElectionResults`, `:2151`, tags `:2238`);
  - `/electoral`'s results (`getRaceResults`, `:2294-2298`);
  - the card's tag (`getIncumbentQualifiers`, `:2335-2339`).
- **The timing:** from 15:00Z the twelve end near 15:48Z (8:48 AM MST): eleven full calls of about 245 s each with the pause, and the 30-race call. That's before the 16:15Z window.
- **If nothing happened:** no `/api/cron/general-ballot` row after 15:00Z but the scheduled ones, or rows with `stop` `yielded`. `MAX(last_attempt_at)` stays the 14:20Z tick's, and each page reads what the overnight ticks left: *Not yet called* where Ballotpedia hadn't marked by the race's last read.

### (c) Louisiana: one authorized `POST /api/cron/primaries?state=LA`
- **When:** after the 12:00Z primaries tick and the last ballot call, clear of :15 to :35 of an even UTC hour: from about 15:50Z, 8:50 AM MST.
- **The route** (`app/api/cron/primaries/route.ts:50-54`, its header `:18-23`):
  - `?state=` goes through `resolveHouseTarget` (`lib/primaries-sync.ts:2620`), which refuses with a 400, before any row, a state outside the House list or one with more than 12 districts.
  - `runPrimariesStateTarget` (`:2653`) reads that state's House districts live (`bypassCache`, 1 s pacing): no cursor, no priority pass, no calendar.
  - Its row logs under `/api/cron/primaries?state=LA` (`route.ts:54`), apart from the scheduled tick's.
- **Read its row before (b).** HO 778's #24524 read 6 of 6 in 10,960 ms.
- **Then compare each of the six boxes with Ballotpedia.** `isSettled` (`lib/primaries-sync.ts:662`) freezes a contest on its first winner mark. So a partial call, one advancer marked before the second, would stay a one-winner *Elected*; any such row is corrected by hand from the page.
- **(c) expires no tag:** neither the route nor `lib/primaries-sync.ts` calls `expireTag`. Its writes reach the Louisiana pages through (b)'s `expireTag("races")` (`getRaceResult` carries `races`), which is why (b) comes last.
- **If nothing happened:** no `?state=LA` row after Oct 12's #24524. LA's six primaries carry no winner, the harvest's `jungle` reads 0 decided and 0 runoff, and the six pages read *Not yet called*.

### (b) The harvest: one authorized `POST /api/cron/race-challengers`
- **What it does:** `harvestChallengers()` (`app/api/cron/race-challengers/route.ts:52`) re-derives the published rosters: the ballot's printed rows, and Louisiana's jungle winners as `advanced` (HO 780). Then `expireTag("races")` (`:53`) reaches every reader carrying `races`: those listed under (a), the Louisiana pages (c) wrote, and the readers tagged `races` alone (`getRaceCandidates`, `lib/queries.ts:1965`; `getRaceCandidatesForCycle`, `:2354`).
- **Measured:** HO 777's #24312 was 200 in 2.2 s, 914 rows. Oct 29's scheduled #28924 wrote 909 rows in 2,088 ms.
- **If nothing happened:** the harvest's rows stay the 12:30Z run's, Louisiana's advancers aren't published as *Advanced*, and the readers tagged `races` alone keep their cache to its `revalidate`.

### The reads, on Production, as the WATCH line lists them, with each expectation as ruled
1. **The marked rows by race:** `SELECT race_id, name, party, bioguide_id FROM general_ballot WHERE marked = 1 ORDER BY race_id, name`. One marked printed row decides a box race, and two or more are a runoff (`lib/race-result.ts`).
2. **One decided page:**
   - *Decided · Nov 3, 2026*, with *Elected* on the marked row and only it;
   - the chips dimmed to 0.55 under *final call ·*, the three rater chips still links (HO 775);
   - the provenance *Called by Ballotpedia · read … MT*;
   - the ratings sources line, each rater with its AS OF (HO 784);
   - the card's word, *re-elected* or *defeated*, **only where the incumbent carries no tag** (HO 779).
3. **One not-called page:** *Not yet called*, and *No call on Ballotpedia · read … MT*, or *No general-election box on Ballotpedia* where there's none.
4. **An off-ballot incumbent's tag on a called race** (HO 779, `components/RaceHubBody.tsx:180-188`): the card keeps the tag, with its outcome past election day (`lib/incumbent-tag.ts:23-38`, `:43-50`):
   - **a Senate run:** ELECTED TO THE SENATE, LOST THE SENATE RACE, IN THE SENATE RUNOFF or OUT OF THE SENATE RUNOFF;
   - **a run in another seat:** ELECTED IN, LOST IN, IN THE … RUNOFF or OUT OF THE … RUNOFF, with RUNNING IN <seat> while that seat isn't called;
   - **the five on a governor ballot:** RAN FOR GOVERNOR;
   - **the reasons,** which stand: RETIRING, WITHDREW, LOST PRIMARY, NOT ON THE BALLOT.

   HO 758's word shows only where there's no tag. The rehearsal's are AL-01, ELECTED TO THE SENATE; S-AL, RAN FOR GOVERNOR; GA-13, LOST PRIMARY; IA-02, LOST THE SENATE RACE; S-NH and S-IA, RETIRING; FL-25, RUNNING IN FL-20.
5. **Louisiana's six, after (c) and (b):**
   - **one jungle winner:** *Decided · Nov 3, 2026*, with *Elected* on the winner's row;
   - **two:** *Runoff Dec 12*, both advancers *Advanced*. Where the incumbent is one of the two, there's one *Advanced* row, and the incumbent's card reads *runoff Dec 12* (HO 780's LA-01, `docs/roadmap.md:6365`: Jewett *Advanced*, Scalise's card *runoff Dec 12*).
   - **The first Louisiana seat whose read turns `box` after Nov 3** (the Dec 12 general's box, posted before it is marked) still reads *Runoff Dec 12*, with its advancers as above. On Dec 12, the box's one mark decides it: *Decided · Dec 12, 2026* (HO 780, `docs/roadmap.md:6347`).
6. **Georgia's** (HO 783, `lib/race-result.ts:177-180`, `:272`):
   - a race whose general box reads two marks reads *Runoff Dec 1*;
   - its incumbent among the two reads *runoff Dec 1*;
   - `/electoral`'s row reads RUNOFF;
   - its *General runoff election* box, once posted, lands in `general_runoff`.
7. **The band's RESULTS line:** `RESULTS · NOV 3 · N of M competitive seats called · House R · D[ · other] · K open · Ballotpedia, read … MT`. Its N and House totals equal a `SELECT` over the marks (the rehearsal's `bandExpect`, `scripts/diagnostic/election-night-rehearsal-777.ts:379-407`).
8. **`/electoral`'s LIST, on both tabs** (HO 767):
   - each decided row's chip, `{P} HOLD`, `{P} GAIN` or `{P} WIN`, with its check on the marked name;
   - a two-mark row reads RUNOFF;
   - the column head reads Result;
   - a called seat shows no Kalshi line in its open row or on its MAP card;
   - the folded calendar reads all voted, with no NEXT;
   - the ratings sources line is unchanged by the marks (Sabato *as of 2026-10-20 · direct*, or the newest ingested).
- ***Close*** (the WATCH line's): every decided race's page reads *Decided* with *Elected* on its marked row, and the band's N and House totals equal a `SELECT` over the marks.

## The rehearsal, re-run on today's tree (`scripts/diagnostic/election-night-rehearsal-777.ts`)
- **The seed** (`--seed --label 795`):
  - **Tables:** 22 whole; `bills` (3,988) and `member_votes` (74,710) cut to the 107 members; the newest 400 `cron_runs`.
  - **Prod's fingerprint** was equal before and after (`{"race_candidates":"4cfee3335f9a3b75","general_ballot":"b51a1ec94956b549","general_ballot_reads":"7e3cf488ae2fbffb","primary_candidates":"989dbcc8f1564c5a","palestine_scorecard":"2d837bac82c87af5","member_fundraising":"dfab963663256646","schema":"4e94644350e1d992"}`).
  - **The plants:** HO 777's 17 marks and Louisiana's three jungle winners, all planted. Then the tree's harvest read jungle 6 races, 1 decided, 1 runoff. The band copy got 61 rated seats; unrated R 20, D 19 and other 1; LA-03's Caleb Walker.
  - **STALE:** only S-ME's curated name, as at HO 777, not re-plantable.
- **The build:** cold, the `.next` junction unlinked first, on Node v24.22.2: exit 0, 0 warning lines, build `JVYNrudYscPa3pSDUsrXb`.
- **The first run** (`--run --label 795`): **233 PASS, 9 FAIL, 1 N/A**, and with the seed's 5, **238 / 9 / 1**. Each FAIL was an expectation written at HO 777 (Oct 11), before the ruling that changed its page:
  - **Seven, HO 779** (`c4d116b`, Oct 12): *the card's word reads not on the ballot* on IA-02, S-NH, S-IA, FL-25, GA-13, AL-01 and S-AL. Each card shows the tag the ruling keeps, with no word.
  - **Two, HO 783** (`a86a287`, Oct 13): S-GA's header *Runoff* and card word *runoff*. The page reads *Runoff Dec 1* and *runoff Dec 1*, which HO 783's own leg read as its green.
- **The re-match** (Corey's ruling on the HALT): each expectation is taken from the ruling's code or block, never from a page, and cites it.
  - **The seven shapes** expect the tag, with no word: senate *LOST THE SENATE RACE* (IA-02), retiring *RETIRING* (S-NH, S-IA), moved *RUNNING IN FL-20* (FL-25), lost_primary *LOST PRIMARY* (GA-13), senate *ELECTED TO THE SENATE* (AL-01) and governor *RAN FOR GOVERNOR* (S-AL).
  - **S-GA** expects *Runoff Dec 1* and *runoff dec 1*.
  - **The derivation's record** is `docs/handoffs/795-artifacts/rematch-derivation-795.log`: the seed's facts and the rulings' order and words.
  - **The tautology guard** (`docs/handoffs/795-artifacts/rematch-guard-795.json`): a second derivation, barred from every log and capture and from the first derivation, reached the same eight expectations from the rulings and the copy alone. A review of the check logic read it sound, with the check count per shape unchanged.
  - **The clock's coverage:** four of the seven tags (RETIRING twice, LOST PRIMARY, RUNNING IN FL-20) read the same before and after election day. The run's clock rests on IA-02's LOST THE SENATE RACE, AL-01's ELECTED TO THE SENATE and S-AL's RAN FOR GOVERNOR.
- **The second run** (`--run --label 795b`, the same copies, byte for byte): **242 PASS, 0 FAIL, 1 N/A**, and with the seed's 5, **247 / 0 / 1**.
  - The other 233 checks read as in the first run.
  - The N/A is AL-01's R HOLD, as at HO 777: unrated, so no `/electoral` row.
- **Readings, not FAILs:**
  - **The band at the real clock:** `ELECTION DAY · NOV 3 · 5 DAYS · ~58 competitive seats`.
  - **The band at the Nov 4 clock:** `RESULTS · NOV 3 · 61 of 105 competitive seats called · House R 43 · D 44 · other 1 · 347 open`, equal to its `SELECT`.
  - **The 105 rated seats** against HO 777's 99 are Sabato's moves since HO 777's seed, measured by diffing that seed's copy against this one:
    - eight added: IN-05, KS-02, MD-01, NE-01, NJ-02 and WA-05, dated Oct 20; S-MS, Oct 14; NC-03, Sep 29;
    - two dropped: CT-05 and KS-03.
  - **Data moves since HO 777:**
    - LA-02's Renada Collins prints as I (D at HO 777);
    - S-NE's and S-AK's withdrawn rows are gone from their rosters;
    - S-AL's Moore row is tied (`M001212`).

## The hand reads on the `night` copy, as they PASS under the rulings
- **HO 780, LA-01:** two jungle winners read *Runoff Dec 12*: Jewett's row *Advanced*, and Scalise, the incumbent, on the card with *runoff Dec 12*. That is HO 780's recorded LA-01. **PASS.**
- **HO 780, LA-02:** one jungle winner reads *Decided · Nov 3, 2026*, with *Elected* on Renada Collins's row. **PASS.**
- **HO 783, S-GA:** two marks read *Runoff Dec 1*, the card *runoff Dec 1*, and `/electoral`'s row RUNOFF. **PASS.**
- **HO 784:** a decided race's sources line names its three raters with AS OF, both on MI-04's page and on `/electoral` with S-NH open: *Ratings · Cook · as of 2026-09-29 · via Ballotpedia · Inside Elections · as of 2026-09-22 · via Ballotpedia · Sabato · as of 2026-10-20 · direct*. **PASS.**
- **HO 789:** `/electoral` reads *Sabato · as of 2026-10-20 · direct* on SENATE and HOUSE, the whole line equal to the unmarked copy's. **PASS.**
- **HO 779:** the three called races whose incumbent is off the ballot keep the tag with its outcome: AL-01 ELECTED TO THE SENATE, S-AL RAN FOR GOVERNOR, GA-13 LOST PRIMARY. **PASS.**

The handoff worded LA-01 as two *Advanced* and HO 779 as HO 758's word in the tag's place, both from HO 777's block. As worded, those four read FAIL. The rulings above are what Nov 4 reads.

## The captures' index
The captures are repo-ignored and not committed, under `docs/handoffs/795-artifacts/`:
- **`captures/`, the first run's 28** (1440 and 430 each):
  - `night-race-MI-04-2026` and `night-race-IA-02-2026`, two decided pages;
  - `night-race-CO-08-2026`, the not-called page;
  - `night-electoral-list`, `/electoral`'s LIST full-page on `night`;
  - `band-nov4`, the band's RESULTS line;
  - `night-row-*`, the nine `/electoral` list shapes' open rows.
- **`captures/`, the hand reads' 15 and the FAIL pages' 4** (1440):
  - `hand-780-LA-01` and `hand-780-LA-02`;
  - `hand-783-S-GA`, with `hand-783-row-S-GA-2026` and `hand-783-sources-*`;
  - `hand-784-MI-04`, with `hand-784-row-S-NH-2026` and `hand-784-sources-*`;
  - `hand-789-today-sources-*`, the unmarked copy's line on both tabs;
  - `hand-779-AL-01-2026`, `hand-779-S-AL-2026` and `hand-779-GA-13-2026`;
  - `fail-IA-02-2026`, `fail-S-NH-2026`, `fail-S-IA-2026` and `fail-FL-25-2026`.
- **`captures-795b/`:** the second run's 28, the same names as the first run's.
- **Logs:** `step0-2026-10-29T21-03-31-478Z.log` (claims 4 to 6, the ballot cron tick by tick), `seed-795.log`, `build-795.log`, `run-795.log`, `run-795b.log`, `handreads-795.log` and `rematch-derivation-795.log`.
