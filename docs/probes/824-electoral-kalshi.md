# HO 824 — why no `/electoral` LIST row opens with a Kalshi line: every Senate row is called, and the helper never leaves the Senate tab

> **Diagnostic-only probe, not wired.** Base `main` at `218c592`. Run Thursday 2026-11-19, Mountain Standard Time (a fixed UTC-7, including for the 2027 dates) with UTC beside.
> - **One run** of `scripts/diagnostic/electoral-kalshi-824.ts` made the database reads, clock 11/19/2026, 4:41:36 PM MST (2026-11-19T23:41:36.591Z), then E's pages (11/19/2026, 4:41:38 PM MST) and F's (11/19/2026, 4:41:54 PM MST).
> - **Prod's database was read by `SELECT` only.** libSQL's client has no read-only open for a remote URL, so the run guards the singleton client. The guard refuses:
>   - any statement that isn't a read, or that carries a write word outside its comments and string literals;
>   - any batch not in `read` mode;
>   - every transaction.
>
>   34 statements passed it, all reads.
> - **Prod's pages were read by GET** in headless Chromium at 1440 × 1200, with the gate cookie and no odds preference (the ON state). They loaded as for any reader, member photos from Congress.gov's image host included.
> - **Kalshi and Ballotpedia were asked nothing.** The store and the crons' own `cron_runs` rows are the evidence.
> - **No product code, no test change, no write.**
>
> STEP 0, the run's JSON and log, and the green and first red runs' logs are in `docs/handoffs/824-artifacts/` (repo-ignored); `44630542152`'s log is in `823-artifacts/`. A recommendation is at the end, for the chat's ruling.

## The cause

**It's cause 1, in a stronger form than the handoff states it: every Senate row is called, all 14.**
- **The tab:** Senate is the list's default tab (`components/RaceListView.tsx:323`), and it's the only one `openRaceWithKalshi` walks.
- **The rule:** a called row's open panel renders no line (R6, `components/RaceOpenRow.tsx:491`).
- **Where the lines are:** the two rows that render one today are on the House tab, at 39 (`MN-01-2026`) and 82 (`NY-01-2026`).
- **Not cause 2:** 465 of the store's 469 `close_time`s are Kalshi's scheduled 2027-11-03 15:00Z, so `kalshiActive` holds for every LIST row.
- **Not cause 3:** the sync wrote at 3:15 PM MST today, and every two hours before that, with no failure from 1:15 PM MST Nov 17 on.

**`S-AK-2026` (row 1) is the one row the evidence shows losing its line in the window.**
- The green run's helper opened it with a line at 7:37 PM MST Nov 17.
- By the red run (3:29 PM MST Nov 18) no row of the 13 had one. S-AK was called, and its odds were still active, so R6 took the line.
- **The date is inferred, not stored.** By the arithmetic of the read queue, its call was first stored by a ballot read between about 1:20 and 3:24 PM MST Nov 18 (D).
- **What the store can't say:** rows 2 to 13 were each read inside the window too, so it can't say whether S-AK's was the last call among them.

## STEP 0

STEP 0 held at `218c592` (`824-artifacts/step0-824.md`):
- `main` is alone on the remote, and the roadmap pointer reads 823.
- The reconcile reads 281 / 396 / 677, 0 mis-struck, 0 live in the archive.
- Every anchor holds, but `RaceListView.tsx:258-272` reads `:259-274`, corrected and flagged; no step depends on it.
- In the three runs, these three tests are the only red ones.

## A. The list as the page builds it

**The inputs.** The run computes the inputs `buildElectoralRows` (`lib/electoral-rows.ts:134`) takes, the way `app/electoral/page.tsx:98-131` does:
- `getRacesIndex(2026)`;
- `getPacIeSpending`;
- `getIncumbentQualifiers` with `incumbentTagsAt`;
- `getGeneralBallots`;
- `getRecentRaceMoves`, `getBallotNews` and `getRaceResults` (election day has passed).

The page's other eight readers feed the board, not the rows. `unstable_cache` is a passthrough (`scripts/diagnostic/next-cache-stub-757.mjs`), so every read is uncached. `nowMs` is the run clock, and `clockMs` is `clockNowMs()` with no `CBT_CLOCK_NOW` set.

**What the list shows.** It renders the rows in the loader's order, filtered by chamber (`RaceListView.tsx:336`) and by tier. The default tier set, `{toss, lean, likely}` (`:324`), is every `Tier` there is (`lib/electoral-rows.ts:36`), so with no filter set every row shows. **The default tab is Senate** (`:323`), and it's the one the helper walks.

**The columns:**
- *result* is `result.kind`, and *called* is `result.called`;
- *odds* is the row's `kalshiOdds` ticker, and *close_time* is its `closeTime`;
- *odds last written* is `kalshi_odds.updated_at`;
- *active* is `kalshiActive(odds, nowMs)`;
- *line* is the page's own rule: not called, and active.

### Senate, 14 rows (the helper walks 1 to 13)

| # | raceId | seat | tier | result | called | odds | close_time (MST) | odds last written (MST) | active | line |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `S-AK-2026` | AK SEN | toss | won | yes | `SENATEAK-26` | Nov 3, 2027, 8:00:00 AM | Nov 17, 2026, 7:15:36 PM | yes | no |
| 2 | `S-IA-2026` | IA SEN | toss | won | yes | `SENATEIA-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 3 | `S-KS-2026` | KS SEN | toss | won | yes | `SENATEKS-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 4 | `S-ME-2026` | ME SEN | toss | won | yes | `SENATEME-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 5 | `S-MI-2026` | MI SEN | toss | won | yes | `SENATEMI-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 11:15:35 PM | yes | no |
| 6 | `S-NH-2026` | NH SEN | toss | won | yes | `SENATENH-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 5:15:35 PM | yes | no |
| 7 | `S-OH-2026` | OH SEN | toss | won | yes | `SENATEOHS-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 8 | `S-TX-2026` | TX SEN | toss | won | yes | `SENATETX-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 9 | `S-GA-2026` | GA SEN | lean | won | yes | `SENATEGA-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 5:15:35 PM | yes | no |
| 10 | `S-MN-2026` | MN SEN | lean | won | yes | `SENATEMN-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 11 | `S-NC-2026` | NC SEN | lean | won | yes | `SENATENC-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 5:15:35 PM | yes | no |
| 12 | `S-NE-2026` | NE SEN | lean | won | yes | `SENATENE-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 1:15:36 AM | yes | no |
| 13 | `S-MS-2026` | MS SEN | likely | won | yes | `SENATEMS-26` | Nov 3, 2027, 8:00:00 AM | Nov 11, 2026, 3:15:34 PM | yes | no |
| 14 | `S-SC-2026` | SC SEN | likely | won | yes | `SENATESC-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |

### House, 91 rows

| # | raceId | seat | tier | result | called | odds | close_time (MST) | odds last written (MST) | active | line |
|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `AZ-01-2026` | AZ-01 | toss | won | yes | `HOUSEAZ1-26` | Nov 3, 2027, 8:00:00 AM | Nov 5, 2026, 9:15:34 AM | yes | no |
| 2 | `AZ-06-2026` | AZ-06 | toss | won | yes | `HOUSEAZ6-26` | Nov 3, 2027, 8:00:00 AM | Nov 5, 2026, 11:15:36 AM | yes | no |
| 3 | `CA-22-2026` | CA-22 | toss | won | yes | `HOUSECA22-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 11:15:36 AM | yes | no |
| 4 | `CO-08-2026` | CO-08 | toss | won | yes | `HOUSECO8-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 5 | `FL-14-2026` | FL-14 | toss | won | yes | `KXHOUSERACE-FL14-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 5:15:35 PM | yes | no |
| 6 | `FL-22-2026` | FL-22 | toss | won | yes | `KXHOUSERACE-FL22-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 7 | `FL-25-2026` | FL-25 | toss | won | yes | `KXHOUSERACE-FL25-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 5:15:35 PM | yes | no |
| 8 | `IA-01-2026` | IA-01 | toss | won | yes | `HOUSEIA1-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 9 | `IA-03-2026` | IA-03 | toss | won | yes | `HOUSEIA3-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 10 | `MI-04-2026` | MI-04 | toss | won | yes | `HOUSEMI4-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 11:15:36 AM | yes | no |
| 11 | `MI-07-2026` | MI-07 | toss | won | yes | `HOUSEMI7-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 11:15:36 AM | yes | no |
| 12 | `MI-10-2026` | MI-10 | toss | won | yes | `HOUSEMI10-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 11:15:36 AM | yes | no |
| 13 | `NC-11-2026` | NC-11 | toss | won | yes | `KXHOUSENC11-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 5:15:35 PM | yes | no |
| 14 | `NY-17-2026` | NY-17 | toss | won | yes | `HOUSENY17-26` | Nov 3, 2027, 8:00:00 AM | Nov 5, 2026, 7:15:36 PM | yes | no |
| 15 | `OH-07-2026` | OH-07 | toss | won | yes | `KXHOUSERACE-OH07-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 11:15:35 PM | yes | no |
| 16 | `OH-09-2026` | OH-09 | toss | won | yes | `HOUSEOH9-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 11:15:35 PM | yes | no |
| 17 | `PA-07-2026` | PA-07 | toss | won | yes | `HOUSEPA7-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 18 | `PA-08-2026` | PA-08 | toss | won | yes | `HOUSEPA8-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 19 | `PA-10-2026` | PA-10 | toss | won | yes | `HOUSEPA10-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 20 | `TX-15-2026` | TX-15 | toss | won | yes | `HOUSETX15-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 21 | `TX-34-2026` | TX-34 | toss | won | yes | `HOUSETX34-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 22 | `TX-35-2026` | TX-35 | toss | won | yes | `KXHOUSETX35-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 11:15:35 PM | yes | no |
| 23 | `VA-01-2026` | VA-01 | toss | won | yes | `HOUSEVA1-26` | Nov 3, 2027, 8:00:00 AM | Nov 5, 2026, 9:15:34 AM | yes | no |
| 24 | `VA-02-2026` | VA-02 | toss | won | yes | `HOUSEVA2-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 25 | `WA-03-2026` | WA-03 | toss | won | yes | `HOUSEWA3-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 11:15:36 AM | yes | no |
| 26 | `WI-03-2026` | WI-03 | toss | won | yes | `HOUSEWI3-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 27 | `AL-02-2026` | AL-02 | lean | won | yes | `KXHOUSERACE-AL02-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 28 | `CA-06-2026` | CA-06 | lean | won | yes | `KXHOUSERACE-CA06-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 11:15:35 PM | yes | no |
| 29 | `CA-13-2026` | CA-13 | lean | won | yes | `HOUSECA13-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 11:15:36 AM | yes | no |
| 30 | `CA-45-2026` | CA-45 | lean | won | yes | `HOUSECA45-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 11:15:35 PM | yes | no |
| 31 | `CA-48-2026` | CA-48 | lean | won | yes | `KXHOUSERACE-CA48-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 5:15:35 PM | yes | no |
| 32 | `CO-04-2026` | CO-04 | lean | won | yes | `KXHOUSERACE-CO04-26` | Nov 3, 2027, 8:00:00 AM | Nov 13, 2026, 1:15:36 PM | yes | no |
| 33 | `CO-05-2026` | CO-05 | lean | won | yes | `KXHOUSERACE-CO05-26` | Nov 3, 2027, 8:00:00 AM | Nov 5, 2026, 1:15:34 PM | yes | no |
| 34 | `FL-13-2026` | FL-13 | lean | won | yes | `HOUSEFL13-26` | Nov 3, 2027, 8:00:00 AM | Nov 5, 2026, 11:15:36 AM | yes | no |
| 35 | `FL-27-2026` | FL-27 | lean | won | yes | `KXHOUSERACE-FL27-26` | Nov 3, 2027, 8:00:00 AM | Nov 10, 2026, 3:15:36 PM | yes | no |
| 36 | `IA-02-2026` | IA-02 | lean | won | yes | `KXHOUSERACE-IA02-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 37 | `KY-06-2026` | KY-06 | lean | won | yes | `KXHOUSERACE-KY06-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 38 | `ME-02-2026` | ME-02 | lean | won | yes | `HOUSEME2-26` | Nov 3, 2027, 8:00:00 AM | Nov 12, 2026, 11:15:36 AM | yes | no |
| 39 | `MN-01-2026` | MN-01 | lean | none | no | `KXHOUSERACE-MN01-26` | Nov 3, 2027, 8:00:00 AM | Nov 19, 2026, 3:15:36 PM | yes | **yes** |
| 40 | `MO-02-2026` | MO-02 | lean | won | yes | `KXHOUSERACE-MO02-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 41 | `MT-01-2026` | MT-01 | lean | won | yes | `HOUSEMT1-26` | Nov 3, 2027, 8:00:00 AM | Nov 5, 2026, 9:15:34 AM | yes | no |
| 42 | `NC-01-2026` | NC-01 | lean | won | yes | `HOUSENC1-26` | Nov 3, 2027, 8:00:00 AM | Nov 5, 2026, 9:15:34 AM | yes | no |
| 43 | `NE-02-2026` | NE-02 | lean | won | yes | `HOUSENE2-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 44 | `NH-01-2026` | NH-01 | lean | won | yes | `HOUSENH1-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 45 | `NJ-07-2026` | NJ-07 | lean | won | yes | `HOUSENJ7-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 46 | `NM-02-2026` | NM-02 | lean | won | yes | `HOUSENM2-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 47 | `NV-01-2026` | NV-01 | lean | won | yes | `HOUSENV1-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 1:15:36 AM | yes | no |
| 48 | `NV-02-2026` | NV-02 | lean | won | yes | `KXHOUSERACE-NV02-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 7:15:36 PM | yes | no |
| 49 | `NV-03-2026` | NV-03 | lean | won | yes | `HOUSENV3-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 1:15:36 AM | yes | no |
| 50 | `NY-03-2026` | NY-03 | lean | won | yes | `HOUSENY3-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 11:15:36 AM | yes | no |
| 51 | `NY-04-2026` | NY-04 | lean | won | yes | `HOUSENY4-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 11:15:36 AM | yes | no |
| 52 | `NY-21-2026` | NY-21 | lean | won | yes | `KXHOUSERACE-NY21-26` | Nov 3, 2027, 8:00:00 AM | Nov 6, 2026, 9:15:34 AM | yes | no |
| 53 | `OH-01-2026` | OH-01 | lean | won | yes | `HOUSEOH1-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 54 | `PA-01-2026` | PA-01 | lean | won | yes | `HOUSEPA1-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 55 | `SC-01-2026` | SC-01 | lean | won | yes | `KXHOUSERACE-SC01-26` | Nov 3, 2027, 8:00:00 AM | Nov 6, 2026, 3:15:34 PM | yes | no |
| 56 | `TX-23-2026` | TX-23 | lean | won | yes | `KXHOUSERACE-TX23-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 57 | `TX-28-2026` | TX-28 | lean | won | yes | `HOUSETX28-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 58 | `VA-05-2026` | VA-05 | lean | won | yes | `KXHOUSERACE-VA05-26` | Nov 3, 2027, 8:00:00 AM | Nov 5, 2026, 9:15:34 AM | yes | no |
| 59 | `WI-01-2026` | WI-01 | lean | won | yes | `HOUSEWI1-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 60 | `AK-AL-2026` | AK-AL | likely | won | yes | `HOUSEAKAL-26` | Nov 3, 2027, 8:00:00 AM | Nov 18, 2026, 7:15:37 PM | yes | no |
| 61 | `AR-02-2026` | AR-02 | likely | won | yes | `KXHOUSERACE-AR02-26` | Nov 3, 2027, 8:00:00 AM | Nov 5, 2026, 9:15:34 AM | yes | no |
| 62 | `AZ-02-2026` | AZ-02 | likely | won | yes | `HOUSEAZ2-26` | Nov 3, 2027, 8:00:00 AM | Nov 9, 2026, 9:15:35 AM | yes | no |
| 63 | `CA-21-2026` | CA-21 | likely | won | yes | `HOUSECA21-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 64 | `CO-03-2026` | CO-03 | likely | won | yes | `HOUSECO3-26` | Nov 3, 2027, 8:00:00 AM | Nov 6, 2026, 9:15:34 AM | yes | no |
| 65 | `FL-07-2026` | FL-07 | likely | won | yes | `KXHOUSERACE-FL07-26` | Nov 3, 2027, 8:00:00 AM | Nov 10, 2026, 11:15:34 AM | yes | no |
| 66 | `FL-09-2026` | FL-09 | likely | won | yes | `KXHOUSERACE-FL09-26` | Nov 3, 2027, 8:00:00 AM | Nov 10, 2026, 11:15:34 AM | yes | no |
| 67 | `FL-12-2026` | FL-12 | likely | won | yes | `KXHOUSERACE-FL12-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 5:15:35 PM | yes | no |
| 68 | `FL-16-2026` | FL-16 | likely | won | yes | `KXHOUSERACE-FL16-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 5:15:35 PM | yes | no |
| 69 | `IN-01-2026` | IN-01 | likely | won | yes | `HOUSEIN1-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 11:15:35 PM | yes | no |
| 70 | `IN-05-2026` | IN-05 | likely | won | yes | `KXHOUSERACE-IN05-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 71 | `KS-02-2026` | KS-02 | likely | won | yes | `KXHOUSERACE-KS02-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 72 | `MD-01-2026` | MD-01 | likely | won | yes | `KXHOUSERACE-MD01-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 73 | `MI-03-2026` | MI-03 | likely | won | yes | `HOUSEMI3-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 74 | `MI-08-2026` | MI-08 | likely | won | yes | `HOUSEMI8-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 11:15:35 PM | yes | no |
| 75 | `MN-02-2026` | MN-02 | likely | won | yes | `HOUSEMN2-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 76 | `NC-03-2026` | NC-03 | likely | won | yes | `KXHOUSERACE-NC03-26` | Nov 3, 2027, 8:00:00 AM | Nov 11, 2026, 5:15:35 PM | yes | no |
| 77 | `NE-01-2026` | NE-01 | likely | won | yes | `KXHOUSERACE-NE01-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 3:15:35 PM | yes | no |
| 78 | `NH-02-2026` | NH-02 | likely | won | yes | `KXHOUSERACE-NH02-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 9:15:35 PM | yes | no |
| 79 | `NJ-02-2026` | NJ-02 | likely | won | yes | `KXHOUSERACE-NJ02-26` | Nov 3, 2027, 8:00:00 AM | Nov 5, 2026, 3:15:35 PM | yes | no |
| 80 | `NJ-09-2026` | NJ-09 | likely | won | yes | `HOUSENJ9-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 11:15:35 PM | yes | no |
| 81 | `NV-04-2026` | NV-04 | likely | won | yes | `HOUSENV4-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 1:15:36 AM | yes | no |
| 82 | `NY-01-2026` | NY-01 | likely | none | no | `KXHOUSERACE-NY01-26` | Nov 3, 2027, 8:00:00 AM | Nov 5, 2026, 9:15:34 AM | yes | **yes** |
| 83 | `NY-19-2026` | NY-19 | likely | won | yes | `HOUSENY19-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 84 | `OH-10-2026` | OH-10 | likely | won | yes | `KXHOUSERACE-OH10-26` | Nov 3, 2027, 8:00:00 AM | Nov 5, 2026, 11:15:36 AM | yes | no |
| 85 | `OH-13-2026` | OH-13 | likely | won | yes | `HOUSEOH13-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 5:15:35 PM | yes | no |
| 86 | `OH-15-2026` | OH-15 | likely | won | yes | `KXHOUSERACE-OH15-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 87 | `OR-05-2026` | OR-05 | likely | won | yes | `HOUSEOR5-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 11:15:35 PM | yes | no |
| 88 | `PA-17-2026` | PA-17 | likely | won | yes | `HOUSEPA17-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 7:15:36 PM | yes | no |
| 89 | `TX-09-2026` | TX-09 | likely | won | yes | `KXHOUSETX9-26` | Nov 3, 2027, 8:00:00 AM | Nov 4, 2026, 11:15:36 AM | yes | no |
| 90 | `VA-07-2026` | VA-07 | likely | won | yes | `HOUSEVA7-26` | Nov 3, 2027, 8:00:00 AM | Nov 3, 2026, 5:15:35 PM | yes | no |
| 91 | `WA-05-2026` | WA-05 | likely | won | yes | `KXHOUSERACE-WA05-26` | Nov 3, 2027, 8:00:00 AM | Nov 9, 2026, 5:15:34 PM | yes | no |

## B. The counts

At the run clock, with A's predicates:

| tab | rows | called | not called | not called, odds | not called, ACTIVE odds | first row with a line (its tab's position) |
|---|---|---|---|---|---|---|
| senate | 14 | 14 | 0 | 0 | 0 | none |
| house | 91 | 89 | 2 | 2 | 2 | House 39 (`MN-01-2026`) |
| all | 105 | 103 | 2 | 2 | 2 | House 39 (`MN-01-2026`) |

**The first row that renders a line is House row 39, `MN-01-2026`.** The Senate tab has none. That line is past row 13 on its own tab, and on a tab the helper never opens: cause 1.

## C. The store and the sync

**`kalshi_odds` holds 469 rows,** all cycle 2026. The newest write was 2026-11-19 22:15:36Z (3:15:36 PM MST). Here is `close_time`, split at the run clock:

| close_time's UTC day | past at the run clock | future | null |
|---|---|---|---|
| 2026-11-04 | 3 | 0 | 0 |
| 2026-11-11 | 1 | 0 | 0 |
| 2027-11-03 | 0 | 465 | 0 |

The four in the past:

| raceId | close_time (MST) | last written (MST) | a LIST row |
|---|---|---|---|
| `TX-31-2026` | Nov 3, 2026, 11:15:14 PM | Nov 3, 2026, 11:15:35 PM | no |
| `SC-02-2026` | Nov 11, 2026, 9:15:13 AM | Nov 11, 2026, 9:15:34 AM | no |
| `OR-04-2026` | Nov 3, 2026, 11:15:06 PM | Nov 3, 2026, 11:15:35 PM | no |
| `MI-12-2026` | Nov 3, 2026, 7:15:06 PM | Nov 3, 2026, 7:15:36 PM | no |

**None of the four is a LIST row.** They carry their real close because the cron wrote them after Kalshi moved the close and before the market left the feed. Every other row's `close_time` is the scheduled 2027-11-03 15:00Z.

When each row was last written (`updated_at`):

| updated_at's UTC day | rows last written that day |
|---|---|
| 2026-06-30 | 9 |
| 2026-11-03 | 5 |
| 2026-11-04 | 402 |
| 2026-11-05 | 23 |
| 2026-11-06 | 9 |
| 2026-11-09 | 2 |
| 2026-11-10 | 4 |
| 2026-11-11 | 2 |
| 2026-11-12 | 2 |
| 2026-11-13 | 1 |
| 2026-11-16 | 1 |
| 2026-11-17 | 1 |
| 2026-11-18 | 1 |
| 2026-11-19 | 7 |

**How the cron writes.** It scans Kalshi's open-events feed (`lib/kalshi.ts:148`, `events?status=open`) and upserts the seats it finds (`app/api/cron/kalshi/route.ts:43-66`). It never deletes:
- a market that closes leaves the feed and keeps its row, at its last price and stored `close_time`;
- **463 of the 469 rows weren't written by the last run;**
- the 459 of them whose `close_time` is still ahead all read active, and the other 4 are past their close.

The rows written since Nov 9 (UTC), newest first:

| raceId | ticker | favorite | close_time | last written (MST) | a LIST row |
|---|---|---|---|---|---|
| `LA-05-2026` | `KXHOUSERACE-LA05-26` | Gabe Firment 94% | 2027-11-03 | Nov 19, 2026, 3:15:36 PM | no |
| `LA-06-2026` | `KXHOUSERACE-LA06-26` | Blake Miguez 92% | 2027-11-03 | Nov 19, 2026, 3:15:36 PM | no |
| `MN-01-2026` | `KXHOUSERACE-MN01-26` | Jake Johnson 97% | 2027-11-03 | Nov 19, 2026, 3:15:36 PM | yes |
| `NC-05-2026` | `KXHOUSERACE-NC05-26` | Chuck Hubbard 99% | 2027-11-03 | Nov 19, 2026, 3:15:36 PM | no |
| `NC-10-2026` | `KXHOUSERACE-NC10-26` | Pat Harrigan 100% | 2027-11-03 | Nov 19, 2026, 3:15:36 PM | no |
| `TN-04-2026` | `KXHOUSERACE-TN04-26` | Victoria Broderick 100% | 2027-11-03 | Nov 19, 2026, 3:15:36 PM | no |
| `AK-AL-2026` | `HOUSEAKAL-26` | Nick Begich III 99% | 2027-11-03 | Nov 18, 2026, 7:15:37 PM | yes |
| `S-AK-2026` | `SENATEAK-26` | Democratic party 100% | 2027-11-03 | Nov 17, 2026, 7:15:36 PM | yes |
| `CA-23-2026` | `KXHOUSERACE-CA23-26` | Jay Obernolte 100% | 2027-11-03 | Nov 16, 2026, 5:15:36 PM | no |
| `NC-07-2026` | `KXHOUSERACE-NC07-26` | David Rouzer 99% | 2027-11-03 | Nov 16, 2026, 1:15:35 PM | no |
| `CO-04-2026` | `KXHOUSERACE-CO04-26` | Eileen Laubacher 100% | 2027-11-03 | Nov 13, 2026, 1:15:36 PM | yes |
| `ME-02-2026` | `HOUSEME2-26` | Paul LePage 100% | 2027-11-03 | Nov 12, 2026, 11:15:36 AM | yes |
| `NC-03-2026` | `KXHOUSERACE-NC03-26` | Raymond Smith Jr. 100% | 2027-11-03 | Nov 11, 2026, 5:15:35 PM | yes |
| `S-MS-2026` | `SENATEMS-26` | Scott Colom 100% | 2027-11-03 | Nov 11, 2026, 3:15:34 PM | yes |
| `SC-02-2026` | `KXHOUSERACE-SC02-26` | Joe Wilson 99% | 2026-11-11 | Nov 11, 2026, 9:15:34 AM | no |
| `FL-27-2026` | `KXHOUSERACE-FL27-26` | Maria Elvira Salazar 96% | 2027-11-03 | Nov 10, 2026, 3:15:36 PM | yes |
| `FL-07-2026` | `KXHOUSERACE-FL07-26` | Ryan Elijah 99% | 2027-11-03 | Nov 10, 2026, 11:15:34 AM | yes |
| `FL-09-2026` | `KXHOUSERACE-FL09-26` | Darren Soto 100% | 2027-11-03 | Nov 10, 2026, 11:15:34 AM | yes |
| `WA-05-2026` | `KXHOUSERACE-WA05-26` | Michael Baumgartner 98% | 2027-11-03 | Nov 9, 2026, 5:15:34 PM | yes |
| `FL-26-2026` | `KXHOUSERACE-FL26-26` | Mario Díaz-Balart 98% | 2027-11-03 | Nov 9, 2026, 1:15:34 PM | no |
| `AZ-02-2026` | `HOUSEAZ2-26` | Eli Crane 99% | 2027-11-03 | Nov 9, 2026, 9:15:35 AM | yes |

**The Kalshi cron's last twelve `cron_runs` rows** (`route = '/api/cron/kalshi'`, newest first):

| id | started (MST) | status | elapsed | seats | polymarketSeats |
|---|---|---|---|---|---|
| 34411 | Nov 19, 2026, 3:15:10 PM | success | 35645 ms | 6 | 0 |
| 34391 | Nov 19, 2026, 1:15:10 PM | success | 34796 ms | 6 | 0 |
| 34371 | Nov 19, 2026, 11:15:10 AM | success | 35607 ms | 6 | 0 |
| 34351 | Nov 19, 2026, 9:15:10 AM | success | 38920 ms | 6 | 0 |
| 34330 | Nov 19, 2026, 7:15:10 AM | success | 35397 ms | 6 | 0 |
| 34309 | Nov 19, 2026, 5:15:10 AM | success | 35518 ms | 6 | 0 |
| 34286 | Nov 19, 2026, 3:15:10 AM | success | 37873 ms | 6 | 0 |
| 34266 | Nov 19, 2026, 1:15:10 AM | success | 34816 ms | 6 | 0 |
| 34244 | Nov 18, 2026, 11:15:10 PM | success | 35399 ms | 6 | 0 |
| 34224 | Nov 18, 2026, 9:15:10 PM | success | 35528 ms | 6 | 0 |
| 34204 | Nov 18, 2026, 7:15:10 PM | success | 37236 ms | 7 | 0 |
| 34184 | Nov 18, 2026, 5:15:10 PM | success | 37016 ms | 7 | 0 |

All twelve succeeded. `seats` counts the markets the feed returned: 7 at 5:15 and 7:15 PM MST Nov 18, then 6 from 9:15 PM on. The seventh was `AK-AL-2026`'s, last written at the 7:15 PM tick. D's table carries the ticks before these. **The sync is still writing,** for the few markets still open.

The ballot reads for the three seats this probe turns on:

| raceId | status | last READ (MST) | rows | marked | last attempt |
|---|---|---|---|---|---|
| `MN-01-2026` | box | Nov 18, 2026, 7:23:36 PM | 2 | 0 | READ |
| `NY-01-2026` | box | Nov 18, 2026, 11:21:17 PM | 2 | 0 | READ |
| `S-AK-2026` | box | Nov 19, 2026, 1:24:18 PM | 6 | 1 | READ |

**The ballot queue holds 470 races.** Their last attempts run from 5:21:37 PM MST Nov 18 to 3:24:29 PM MST Nov 19.

**Neither cause 2 nor cause 3 holds.** No LIST row's `close_time` has passed, and the sync runs every two hours and writes what the feed returns.

## D. What flipped between the two runs

The window runs from the green run's end, 7:42:11 PM MST Nov 17 (02:42:11Z Nov 18), to the red run's start, 3:29:11 PM MST Nov 18 (22:29:11Z).

**No `close_time` passed inside the window:** 0 rows.

**`S-AK-2026` is the one row the evidence shows losing its line:**
- The green run's helper opened it at row 1 with a line at both widths, 7:37:24 and 7:37:25 PM MST, and in the ON control at 7:37:42 PM (`opened AK SEN`, `kalshiVisible=1`). So the seat was uncalled then, and its odds were active.
- That page wasn't serving a stale result: the ballot tick expires `general-ballot` at the end of any run that wrote a READ (`lib/general-ballot.ts:1099`). That includes the run that wrote S-AK's READ before the window, so the page couldn't serve a result older than that READ.
- At the red run none of the 13 carried a line.
- Today it's called (`won`, its ballot marking 1 of 6 rows), and its odds are still active. So the line went on the call (R6), not on a market close.

**When it was called is an inference from the queue, not a stored time.**
- `general_ballot_reads` keeps a race's last READ only, and each READ replaces the race's rows whole (`scripts/migrate.ts:1258-1263`). `S-AK-2026`'s last READ is 1:24:18 PM MST Nov 19, after the window.
- The general-ballot cron's payloads count READs but don't name races.
- **The queue's arithmetic:**
  - it orders every 2026 race least-recently-attempted first (`lib/general-ballot.ts:880-887`);
  - a run READs 40 races every two hours, and every run below READ all 40;
  - with 470 races, each is read about every 23½ hours.
- So S-AK's READ before 1:24 PM Nov 19 fell in the 1:20 PM or 3:20 PM run on Nov 18. Under a strict rotation it's the 3:20 PM run's, at about 3:21 PM. The READ before that one fell in the afternoon of Nov 17 (about 3:20 PM by the queue), before the green run.
- **So by inference the call was first stored by a Nov 18 READ between about 1:20 and 3:24 PM MST,** minutes to two hours before the red run.

**Kalshi's side, for the record.**
- `SENATEAK-26`'s row was last written at 7:15:36 PM MST Nov 17.
- The feed returned 8 seats at that tick and 7 at the next, 9:15 PM, both successful (table below). So no successful tick after 7:15 PM returned it: the market left the open feed between those two ticks, around the green run.
- The row kept "Democratic party 100%" and its 2027 close, so the page still counts its odds active.

The general-ballot runs from 1:00 PM MST Nov 17 to the red run's end. The window holds the ten from 9:20 PM Nov 17 on.

| started (MST) | status | attempted | READ | rows written |
|---|---|---|---|---|
| Nov 17, 2026, 1:20:36 PM | success | 40 | 40 | 111 |
| Nov 17, 2026, 3:20:35 PM | success | 40 | 40 | 123 |
| Nov 17, 2026, 5:20:35 PM | success | 40 | 40 | 104 |
| Nov 17, 2026, 7:20:35 PM | success | 40 | 40 | 123 |
| Nov 17, 2026, 9:20:35 PM | success | 40 | 40 | 119 |
| Nov 17, 2026, 11:20:35 PM | success | 40 | 40 | 108 |
| Nov 18, 2026, 1:20:35 AM | success | 40 | 40 | 96 |
| Nov 18, 2026, 3:20:35 AM | success | 40 | 40 | 165 |
| Nov 18, 2026, 5:20:35 AM | success | 40 | 40 | 112 |
| Nov 18, 2026, 7:20:35 AM | success | 40 | 40 | 128 |
| Nov 18, 2026, 9:20:35 AM | success | 40 | 40 | 90 |
| Nov 18, 2026, 11:20:35 AM | success | 40 | 40 | 118 |
| Nov 18, 2026, 1:20:35 PM | success | 40 | 40 | 120 |
| Nov 18, 2026, 3:20:35 PM | success | 40 | 40 | 111 |

The Kalshi cron over the same span:

| started (MST) | status | seats | polymarketSeats |
|---|---|---|---|
| Nov 17, 2026, 1:15:10 PM | success | 8 | 1 |
| Nov 17, 2026, 3:15:10 PM | success | 8 | 1 |
| Nov 17, 2026, 5:15:10 PM | success | 8 | 1 |
| Nov 17, 2026, 7:15:10 PM | success | 8 | 1 |
| Nov 17, 2026, 9:15:10 PM | success | 7 | 1 |
| Nov 17, 2026, 11:15:10 PM | success | 7 | 1 |
| Nov 18, 2026, 1:15:10 AM | success | 7 | 0 |
| Nov 18, 2026, 3:15:10 AM | success | 7 | 0 |
| Nov 18, 2026, 5:15:10 AM | success | 7 | 0 |
| Nov 18, 2026, 7:15:10 AM | success | 7 | 0 |
| Nov 18, 2026, 9:15:10 AM | success | 7 | 0 |
| Nov 18, 2026, 11:15:10 AM | success | 7 | 0 |
| Nov 18, 2026, 1:15:10 PM | success | 7 | 0 |
| Nov 18, 2026, 3:15:10 PM | success | 7 | 0 |

The first 13 Senate rows, on what the store can date:

| # | raceId | close_time open at green | open at red | called now | last READ (MST) |
|---|---|---|---|---|---|
| 1 | `S-AK-2026` | yes | yes | yes | Nov 19, 2026, 1:24:18 PM |
| 2 | `S-IA-2026` | yes | yes | yes | Nov 19, 2026, 1:24:30 AM |
| 3 | `S-KS-2026` | yes | yes | yes | Nov 19, 2026, 3:20:48 AM |
| 4 | `S-ME-2026` | yes | yes | yes | Nov 19, 2026, 1:24:30 PM |
| 5 | `S-MI-2026` | yes | yes | yes | Nov 19, 2026, 3:21:05 AM |
| 6 | `S-NH-2026` | yes | yes | yes | Nov 19, 2026, 3:21:41 AM |
| 7 | `S-OH-2026` | yes | yes | yes | Nov 19, 2026, 3:21:59 AM |
| 8 | `S-TX-2026` | yes | yes | yes | Nov 19, 2026, 3:22:35 AM |
| 9 | `S-GA-2026` | yes | yes | yes | Nov 19, 2026, 1:24:23 AM |
| 10 | `S-MN-2026` | yes | yes | yes | Nov 19, 2026, 3:21:12 AM |
| 11 | `S-NC-2026` | yes | yes | yes | Nov 19, 2026, 3:21:30 AM |
| 12 | `S-NE-2026` | yes | yes | yes | Nov 19, 2026, 3:21:35 AM |
| 13 | `S-MS-2026` | yes | yes | yes | Nov 19, 2026, 3:21:18 AM |

**All 13 are called now, and no `close_time` changed.**
- Each of rows 2 to 13 had a READ inside the window too: their last READs fall on Nov 19, so the READ before each one falls inside the window.
- So any of them may also have been called in the window, and the store can't say which call was last.
- The green run's helper stopped at row 1.

## E. The control, on the page

Prod `/electoral` at 1440 × 1200, in the ON state (`data-odds` absent), with the gate cookie, 11/19/2026, 4:41:38 PM MST, served `218c592`.

**The first row B says renders a line,** opened on the House tab: `MN-01-2026`: chip `none`, open row present yes, `.racecard-kalshi` 1. **The script and the page agree.**

**The helper's walk,** on a fresh page and the default tab: 14 Senate items; `.race-list-diverge[data-market]:visible` 14; inked (a diverging live market) 0.

| # | raceId | chip `data-result` | `.racecard-kalshi` in the open row |
|---|---|---|---|
| 1 | `S-AK-2026` | won | 0 |
| 2 | `S-IA-2026` | won | 0 |
| 3 | `S-KS-2026` | won | 0 |
| 4 | `S-ME-2026` | won | 0 |
| 5 | `S-MI-2026` | won | 0 |
| 6 | `S-NH-2026` | won | 0 |
| 7 | `S-OH-2026` | won | 0 |
| 8 | `S-TX-2026` | won | 0 |
| 9 | `S-GA-2026` | won | 0 |
| 10 | `S-MN-2026` | won | 0 |
| 11 | `S-NC-2026` | won | 0 |
| 12 | `S-NE-2026` | won | 0 |
| 13 | `S-MS-2026` | won | 0 |

**Every row reads `won` and none carries a line.** That's the red the crawl reads, reproduced. The ◆ cells read 14 visible and 0 inked, so `divergeVisible` 14 counts rows drawn, not live markets, as the handoff said.

## F. The same primitive elsewhere

Prod, ON state, 1440, 11/19/2026, 4:41:54 PM MST.

**`/`'s `.rc-kpline`** (`components/RaceCard.tsx:107`).
- The race cards sit in the races box's RACES panel, which is `display: none` until its tab opens; the box opens on Hearings (`app/page.tsx:218`, `components/RacesBoxTabs.tsx`). So the six lines are in the DOM at load and none is visible.
- With RACES open, all six are visible, each with a Kalshi favorite:

| # | card's seat | visible at load | visible with RACES open | Kalshi half, as read | n/a |
|---|---|---|---|---|---|
| 1 | `S-AK-2026` | no | yes | `KPeltola100%` | no |
| 2 | `S-KS-2026` | no | yes | `KHamilton100%` | no |
| 3 | `S-NH-2026` | no | yes | `KPappas95%` | no |
| 4 | `AZ-01-2026` | no | yes | `KShah100%` | no |
| 5 | `AZ-06-2026` | no | yes | `KMendoza99%` | no |
| 6 | `CO-08-2026` | no | yes | `KRutinel96%` | no |

- **All six are called seats:** `S-AK-2026` called, `S-KS-2026` called, `S-NH-2026` called, `AZ-01-2026` called, `AZ-06-2026` called, `CO-08-2026` called. `RaceCard` gates its favorite on `kalshiActive` alone (`:240`, `:261`) and reads no result, so `/` shows called seats' last prices. `S-AK-2026`'s reads Peltola 100%, from its row last written at 7:15 PM MST Nov 17.
- `/`'s ON control counts `.rc-kpline [data-market]` in the DOM (`e2e/odds-off.spec.ts:220`), not on screen. It would pass with the RACES panel closed, as it is at load, and with every Kalshi half reading n/a.

**The map card** (`components/RaceMapCard.tsx:238`).
- On `/electoral` a state click opens the district modal (`ElectoralBoard` passes `onStatePick`), so the pinned card is reached through the map's search box.
- Each contest row was opened in turn, since the line sits in a row's open body.

| MN: contest (collapsed head) | `.racecard-kalshi` | text |
|---|---|---|
| [D] MN SENTina Smith NOT ON THE BALLOTLean D | 0 | — |
| [R] MN-01Brad FinstadLean R | 1 | KALSHIJohnson 97% |
| ○ MN-02OPENAngie Craig RETIRINGLikely D | 0 | — |

| NY: contest (collapsed head) | `.racecard-kalshi` | text |
|---|---|---|
| [R] NY-01Nick LaLotaLikely R | 1 | KALSHILaLota 98% |
| [D] NY-03Thomas R. SuozziLean D | 0 | — |
| [D] NY-04Laura GillenLean D | 0 | — |
| [R] NY-17Michael LawlerToss Up | 0 | — |
| [D] NY-19Josh RileyLikely D | 0 | — |
| ○ NY-21OPENElise M. Stefanik RETIRINGLean R | 0 | — |

**The district card** (`components/RaceDistrictCard.tsx:120`), in the modal, with each clickable district clicked. The inset maps repeat districts.

| MN: district (map title) | card | `.racecard-kalshi` | text |
|---|---|---|---|
| 02 · Likely D | MN-02Likely DOPEN SEAT2024D+13.4 | 0 | — |
| 01 · Lean R | MN-01Lean R2024R+17.1KALSHIJohns | 1 | KALSHIJohnson 97% |

| NY: district (map title) | card | `.racecard-kalshi` | text |
|---|---|---|---|
| 04 · Lean D | NY-04Lean D2024D+2.3[D] · INCUMB | 0 | — |
| 17 · Toss Up | NY-17Toss Up2024R+6.3[R] · INCUM | 0 | — |
| 01 · Likely R | NY-01Likely R2024R+10.4KALSHILaL | 1 | KALSHILaLota 98% |
| 03 · Lean D | NY-03Lean D2024R+3.6[D] · INCUMB | 0 | — |
| 19 · Likely D | NY-19Likely D2024D+2.3[D] · INCU | 0 | — |
| 21 · Lean R | NY-21Lean ROPEN SEAT2024R+24.0OP | 0 | — |
| 04 · Lean D | NY-04Lean D2024D+2.3[D] · INCUMB | 0 | — |
| 03 · Lean D | NY-03Lean D2024R+3.6[D] · INCUMB | 0 | — |

**`/race/AL-01-2026`:** `.racecard-kalshi` 0; visible `[data-market]` 0. The race page's tree (`RaceHubBody` and its imports) holds no market site, so it reads 0 with or without live markets, and the OFF pass's `race` cell can't go red on market data.

**So the primitive isn't dormant.** It renders today on the two uncalled seats:
- in the LIST's open row (MN-01, by E);
- in the map card (MN-01 and NY-01);
- in the district card (MN-01 and NY-01).

`/`'s line renders on called seats. The site is dormant only where the helper looks.

## G. The runway

- **Uncalled with active odds: 2,** `MN-01-2026` and `NY-01-2026`. Both read `none`: Ballotpedia's box marks no one. MN-01 was read at 7:23 PM MST Nov 18 and NY-01 at 11:21 PM, each with 2 rows and 0 marked.
- **Their markets differ.**
  - MN-01's is live: the feed returned it at 3:15 PM MST today (Johnson 97%).
  - NY-01's left the feed after 9:15:34 AM MST Nov 5, and its line shows that day's price (LaLota 98%) as if it were live.
- **Runoffs: 0.** No LIST row reads `runoff`, and `general_runoff` holds no 2026 box. The feed's six open markets include `LA-05-2026` and `LA-06-2026`, neither of them a LIST row.
- **The latest close:** 2027-11-03 15:00Z (8:00 AM MST Nov 3, 2027), on 465 rows.

**The date.** By the stored `close_time`, both rows run to Nov 3, 2027.
- MN-01's can still move: the cron overwrites `close_time` whenever the feed returns a market, and the four past rows show Kalshi's real close replacing the scheduled one.
- NY-01's is out of the feed and frozen.

In practice the last LIST line goes when Ballotpedia marks winners on MN-01 and NY-01, or earlier if Kalshi sets MN-01's close. The store can't give either date.

## The proposal, for the chat's ruling

**1. The helper finds a live row.**
- **What it changes:**
  - `openRaceWithKalshi` skips rows whose chip reads `data-result="won"` (`RaceListView.tsx:96`). The chip is on the closed row, so no click is needed.
  - When a tab has no row left, it clicks the other tab.
  - Its 13-row cap has to count rows opened, not positions: MN-01 is House row 39, behind 38 `won` rows.
  - Before election day no row carries the chip, so it opens row 1 as it does now.
  - Today that's no row click on the Senate tab, one tab click on HOUSE, then one on MN-01: 2 clicks against 13.
- **What the three assert:** as now. The OFF pass opens a row that has a line and finds no visible marker, and the ON control finds the line visible.
- **If the site goes dormant:** once MN-01 and NY-01 are called, it returns null and the three go red again, as now. Its runway is two seats, and near the end it anchors on NY-01's frozen Nov 5 price.

**2. Dormant on this route: the fixture seam carries a live-market row.**
- **What it changes:**
  - `/electoral` takes `?fixture=max` behind `fixtureRequested` (`lib/fixtures/max-content.ts`, Preview-only via `CBT_FIXTURES`). After the real reads, one typed `ElectoralRow` (uncalled, with a `KalshiOdds` whose `closeTime` is null) is swapped in at the page's prop boundary, as HO 740 does for the bands.
  - The three `/electoral` cells run on `narrow-preview` against the fixture. That job's run line names `narrow` and `touch` only today.
  - On Production, the `/electoral` OFF pass keeps its no-visible-marker assertion over the 14 ◆ cells (site 10) without the open-row step, and the ON control asserts the ◆ cells.
- **What the three assert:**
  - on Preview, the fixture row's line renders in ON and hides in OFF (site 12), hard, with no skip;
  - on prod, site 10 on `/electoral`.
- **If the site goes dormant:** nothing changes, because the fixture row is a constant.
  - What it gives up: prod no longer asserts site 12 on `/electoral`. Review is where a regression lands, and the Preview job asserts it there.
  - It keeps SKILL's forward rule (no skip-on-empty) and HO 740's fixture-seam reasoning (no green that is a statement about the day's data).
- **What it costs:** a fixture constant, a ternary in the page, and three cells added to `narrow-preview`. That job read 168 tests in 6.0m on `44612045407`.

**3. Read a market that left the feed as closed** (suggested by the reads).
- **What it changes:** `kalshiActive` also reads the row's `updated_at`, or the cron marks rows the feed no longer returns. 463 of the 469 rows weren't written by the last run, and the 459 whose close is still ahead all read active.
- **What it does:** NY-01's line goes, frozen since Nov 5, and so do `/`'s six lines on called seats. The LIST's runway drops to MN-01 alone.
- **What the three assert:** unchanged. So it doesn't make them pass, and it shortens 1's runway.
- **Ruling:** it's a product rule, wider than these tests, so the chat rules it.

**4. Tag the three `@nonci` until the next cycle's markets.**
- **What it changes:** the unattended run drops them. SKILL: *"Assert the precondition, or tag the test out of the unattended run."*
- **If the site goes dormant:** nothing goes red, and nothing asserts site 12 anywhere. It needs a close criterion that can expire.

**Recommendation: 2.**
- It's the only remedy whose tests read the same on the day the last market closes as they do today, and the reads put that day close: two uncalled rows, one of them a frozen price.
- 1 is cheapest and would be green within a day of landing, but it buys a runway of two seats. A crawl that goes red again in a week is the cost this handoff opened on.
- 3 is a real defect the reads turned up (NY-01, and `/`'s six lines), but it's a product rule, and it shortens 1's runway instead of lengthening it.
- 4 gives the assertion up.
