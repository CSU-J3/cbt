# HO 787 — the GradShow poster's numbers: each with its predicate, its scope and its as-of time

> **Diagnostic-only probe, not wired.** Base `main` at `88d6327`. Run 2026-10-19, Mountain Time with UTC beside: `--numbers` r4 at **7:54 PM MT (01:54:15Z Oct 20)**, the reading of record; `--crs-pack` 7:54 to 7:56 PM MT (01:54:35 to 01:56:06Z); the `--odds-snapshot` dry run at 7:57 PM MT (01:57:17Z). **Budget:** prod read with `SELECT` only, through `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name, its schema fingerprint `736e6b987bf77620` before and after every mode; **890,762 `rows_read`** over 182 statements in six runs, each statement's hrana pipeline result carrying the field (the run's ledger, `rows-ledger.tsv`); Congress.gov **91 requests**, all 200, with `CONGRESS_API_KEY` by name in a header: the pack's 90, and the completeness read's one at 11:35 AM MT Oct 20 (17:35:41Z, A). The instrument is `scripts/diagnostic/gradshow-numbers-787.ts`; its logs and JSON are under `docs/handoffs/787-artifacts/` (repo-ignored). The CRS spot-check pack is `docs/probes/787-crs-spotcheck.md`. No recommendation beyond the labels.

Base `main` at `88d6327` (`git ls-remote`: `main` only), 2026-10-19. Diagnostic only: **no product code, no schema, no sync, nothing written to the database**, and nothing dated committed. Every count below is read with its predicate, so a later reading can repeat it; the counts move with every sync, so each carries the time it was read. What the reads were as of: `/api/sync` last ran at 6:00 PM MT (#26412, 00:00:10Z, success) and `/api/cron/summarize` at 7:50 PM MT (#26433, 01:50:23Z, success); the newest `update_date` among the bills was 3:04 PM MT (21:04:20Z), the newest `summary_updated_at` 6:10 PM MT (00:10:29Z Oct 20) and the newest `stage_observed_at` Oct 16, 12:00 PM MT (18:00:34Z).

## The table, for the poster chat

One row per poster number. Every database figure was read at 7:54 PM MT Oct 19 (01:54Z Oct 20) unless the row says otherwise; the tree figures are `88d6327`'s.

| Poster number | Value | Scope | As of |
|---|---|---|---|
| Introduced | **18,137** | the non-ceremonial bills CT holds, all summarized; Congress.gov lists 610 more 119th bills (A) | 7:54 PM MT Oct 19 (01:54Z Oct 20) |
| Became law | **120** (0.7%) | same scope; includes one resolution | 7:54 PM MT Oct 19 (01:54Z Oct 20) |
| Became law, bills only | **119** (0.7% of 16,303) | hr, s, hjres, sjres | 7:54 PM MT Oct 19 (01:54Z Oct 20) |
| Resolutions that can't become law | **1,834** of 18,137 (10.1%) | hres, sres, hconres, sconres | 7:54 PM MT Oct 19 (01:54Z Oct 20) |
| Reached the floor | **1,472** (1,407 without 65 kept stages) | same scope as Introduced | 7:54 PM MT Oct 19 (01:54Z Oct 20) |
| Passed at least one chamber | **848 to 885** bills | hr, s, hjres, sjres | 7:54 PM MT Oct 19 (01:54Z Oct 20) |
| Sent to the president | **126** (125 bills) | same scope as Introduced | 7:54 PM MT Oct 19 (01:54Z Oct 20) |
| CRA disapproval | **215** total, **18** enacted | every CRA resolution, any status | 7:54 PM MT Oct 19 (01:54Z Oct 20) |
| CRA share of the enacted | **18 of 120** (15.0%) | the same in both scopes | 7:54 PM MT Oct 19 (01:54Z Oct 20) |
| Top 12 sponsors | **1,551** sponsored, **9** enacted | current members, non-ceremonial, 119th | 7:54 PM MT Oct 19 (01:54Z Oct 20) |
| Handoffs | **786** (787 once this lands) | the roadmap pointer | `88d6327`, 1:11 PM MT Oct 19 (19:11Z) |
| Build began | **May 3, 2026** | the first commit on `main` | `c578e09`, 3:15 PM MT (21:15Z) |
| Commits | **1,656** | `git rev-list --count main` | `88d6327` |
| Cron jobs | **20** schedules over **19** routes | `vercel.json` | `88d6327` |
| Workflows | **3**: CI, design citations, e2e-prod | `.github/workflows` | `88d6327` |
| Rated races (N) | **99** (86 House, 13 Senate) | `/electoral`'s rated index, 2026 | 7:57 PM MT Oct 19 (01:57Z Oct 20) |
| With market odds | Kalshi **99**, Polymarket **13**, both **13**, neither **0** | the same 99 | odds from the 6:15 PM MT tick (00:15Z) |
| CRS spot-check | **30** bills: 3 independent, 27 shown | seed 787, 90 read | 7:56 PM MT Oct 19 (01:56Z Oct 20) |
| Visitors | **not counted** by the code | Vercel Web Analytics, if on | Corey reads it |

**For the poster chat** (the review reply, Oct 20):
- *Passed at least one chamber* prints the lower bound: **at least 848**.
- *Reached the floor* is **1,472** as stored, or **1,407** under today's rule. The poster picks one and says which.
- The corpus as-of is *Congress.gov's updates through 2:05 AM MT Oct 19*.

## STEP 0, re-derived at `88d6327` (a check, HO 768's rule)

| # | Claim | Reading |
|---|---|---|
| 1 | `main` is `88d6327` | holds: `main`, `origin/main` and `ls-remote` read `88d6327`; the tree clean; pointer 786 (`docs/roadmap.md:7050`), highest HO in commit subjects 786 |
| 2 | the six anchors | hold: `app/welcome/page.tsx:213-214` and `:238-240`; `lib/queries.ts:627-653` and `:527-612` (the SQL at `:640-644`, `:571-578`, `:596-603`); `lib/summarize.ts:219`; `scripts/migrate.ts:295`, `:316`; `app/api/cron/kalshi/route.ts:132-137`; no `@vercel/analytics` or Speed Insights (G); 20 cron entries (D); `computeStage` at `lib/enums.ts:103-108` (enacted), `:112-118` (president), `:122`, `:128-129` (other_chamber), `:131`, `:134-139` (floor) |
| 3 | `ALLOWED_STAGES`, and stage only advances | holds: `lib/enums.ts:55-62`; SKILL's heading at `:1918`, the rule at `:1920` |
| 4 | the CRA slug and the Patterns read | holds: `lib/cluster-patterns.ts:13`; `getClusterStats` at `lib/queries.ts:8498`, its SQL `:8513-8518`, `WHERE cluster_id IS NOT NULL`, enacted by `stage = 'enacted'` |
| 5 | the Members panel's read (record) | `app/welcome/panels.tsx:203`; `bills_agg` at `lib/queries.ts:7426-7444`. With `{}`, `billsAggCte(filters.includeCeremonial ?? false)` (`:7512`) makes `${ceremonial}` read ` AND (is_ceremonial = 0 OR is_ceremonial IS NULL)` (`:7423-7425`). **No Congress clause** in the CTE; the members side is `m.is_current = 1` (`:7398`). Claim 8 makes the missing clause moot today. |
| 6 | `bills`' columns | holds: the eight in the DDL (`scripts/migrate.ts:29-45`) and `ensureColumn` (`:1449` `cluster_id`); prod's `pragma_table_info('bills')` lists 32 columns, all eight among them |
| 7 | `docs/probes/` and SKILL's pointers | holds: `715-…` and `747-…` present; SKILL `:73` → 747, `:79` → 715; `/welcome` at `:1975` |
| 8 | Congress clause or none (record) | `congress = 119` (`getCurrentCongress()`) reads **19,106**; no clause reads **19,106**. One Congress, so every count is the 119th's. |

No HALT: 1, 2, 3, 4 and 6 hold, and A1 reproduces the poster's two figures.

## A. The funnel

### A1, the poster's scope: reproduced

`/welcome` prints `corpus.total` and the `enacted` bar (`app/welcome/page.tsx:238-240`). Both reads run through `unstable_cache` (an hour, or a `bills` flush), so the page can lag the table by that much.

| | `/welcome`'s predicate | this probe's |
|---|---|---|
| Introduced | `SELECT COUNT(*) AS total, MAX(update_date) AS last_sync FROM bills INDEXED BY idx_bills_summary_feed WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL) AND summary IS NOT NULL` (`lib/queries.ts:640-644`) | the same statement, run at 7:54 PM MT: **18,137** |
| Became law | `SELECT stage, COUNT(*) AS count FROM bills INDEXED BY idx_bills_summary_stage WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL) AND stage IN ('introduced', 'committee', 'floor', 'other_chamber', 'president', 'enacted') AND summary IS NOT NULL GROUP BY stage` (`:571-578`), its `enacted` bar (`page.tsx:239`) | the same: **120**, so 0.7% (`page.tsx:240`) |

**Within the drift since the poster's read:** the poster's foot read *last sync 2:05 AM MT*, so it rendered after T = 2:05 AM MT (08:05Z). The bills whose summary and `update_date` both predate T, and which are summarized and non-ceremonial now, were in the poster's count: **18,082**. Every other row the poster could have counted changed at or after T, and **59** rows did. So the poster's Introduced lies in **[18,082, 18,141]**, and 18,137 is inside. Enacted the same way, adding `stage_observed_at >= T`: **[120, 120]**. The control is a second computation of both figures, one full pass over `bills` grouped on every dimension below. It reads 18,137 and 120, equal to the page's index-hinted statements.

**The ungated count is the same today.** All non-ceremonial bills, `(is_ceremonial = 0 OR is_ceremonial IS NULL)` with no summary clause, also read **18,137**: at the read no non-ceremonial bill was waiting for a summary. The two part whenever a sync lands bills the summarizer hasn't reached, since a bill awaiting its summary has `is_ceremonial` NULL and counts as non-ceremonial. `bills` holds 19,106 rows, so 969 are ceremonial.

**CT's rows aren't every 119th-Congress bill: Congress.gov lists 610 more.** One request, the review reply's: `GET https://api.congress.gov/v3/bill/119?limit=1&format=json` with the key in the `X-Api-Key` header, at **11:35 AM MT Oct 20 (17:35:41Z)**. It answered 200, `pagination.count` **19,716**. Beside it, CT's `bills` held **19,106** at 7:54 PM MT Oct 19 (01:54Z Oct 20, claim 8). The difference, **610**, is about 20 days of introductions at the Congress's average pace (19,716 over the 655 days since Jan 3, 2025, about 30 a day), so the 16 hours between the reads, about 20 bills at that pace, don't account for it. **So the poster's *Introduced* counts the bills CT holds, not every bill introduced.** Which 610 CT lacks, and why, is unread: the reply ruled one call. It ran from a scratchpad script rather than the instrument, since the reply amends the two docs commits and not `diag`, and it sent the key as F does. Its log and the response body are `completeness-r1.log` and `completeness-r1.json` in the artifacts.

**What *LAST SYNC* is.** The foot prints `formatMt(corpus.lastSync)` (`page.tsx:477`), and `lastSync` is `MAX(update_date)` over the counted bills (`lib/queries.ts:641`): the newest Congress.gov update among them, not the time CT synced. At this read it would say 3:04 PM MT, while `/api/sync` last ran at 6:00 PM MT. For the poster, the honest as-of is *Congress.gov's updates through 2:05 AM MT Oct 19* (oddities).

| Stage | Count | Reached at least |
|---|---|---|
| introduced | 124 | 18,137 |
| committee | 16,541 | 18,013 |
| floor | 795 | 1,472 |
| other_chamber | 551 | 677 |
| president | 6 | 126 |
| enacted | 120 | 120 |
| other, NULL | 0, 0 | |
| **total** | **18,137** | enacted share **0.7%** |

### A2, all non-ceremonial bills (ungated)

Predicate `(is_ceremonial = 0 OR is_ceremonial IS NULL)`, no Congress clause: **the same table as A1, cell for cell**, 18,137 and 0.7%.

### A3, the bills that can become law

Predicate `bill_type IN ('hr','s','hjres','sjres') AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`, with and without `summary IS NOT NULL`; the two read the same.

| Stage | Count | Reached at least |
|---|---|---|
| introduced | 101 | 16,303 |
| committee | 15,203 | 16,202 |
| floor | 327 | 999 |
| other_chamber | 547 | 672 |
| president | 6 | 125 |
| enacted | 119 | 119 |
| **total** | **16,303** | enacted share **0.7%** |

### By `bill_type`

Non-ceremonial; summarized and all read the same.

| Type | Count | Can become law | Enacted |
|---|---|---|---|
| hr | 10,491 | yes | 52 |
| s | 5,382 | yes | 42 |
| hjres | 214 | yes | 19 |
| sjres | 216 | yes | 6 |
| hconres | 85 | no | 0 |
| sconres | 26 | no | 0 |
| hres | 1,078 | no | 0 |
| sres | 645 | no | **1** |

**1,834 of the 18,137 (10.1%) are resolutions that can't become law.**

### The labels

Corey's draft names six funnel labels; the draft isn't in the repo, so this maps the stages and the two labels the handoff quotes. `computeStage` reads only a bill's latest action (`lib/enums.ts:97`), and `floor` means a bill passed, or had a recorded vote or motion on, its first chamber's floor, so calendar placement is `committee` (`:91-96`). The scope is A1's.

| Label | Mapping | Count | The honest reading |
|---|---|---|---|
| Introduced | every stage | 18,137 | bills and resolutions, ceremonial ones excluded |
| Reached the floor | `floor` or past it | 1,472 | holds 65 bills whose latest action is a calendar placement, kept at `floor` (below): **1,407** without them; bills alone, 934 of 999 |
| Passed one chamber | the draft: `other_chamber` or past it | 677 | **false**: passing one chamber lands in `floor` (`:131`), so this misses every bill still waiting on its second chamber |
| | the handoff: latest action reads *passed house* or *passed senate*, or `other_chamber`+ | 685 | adds only 8, because a passed bill's latest action is usually a later step: of the 327 bills at `floor`, 142 read *Held at the desk*, 31 a motion to reconsider laid on the table and 3 the passage itself, while 37 more read a message between the chambers (*Message on Senate action sent to the House*, *The Chair directed the Clerk to notify the Senate…*) |
| | from each bill's latest action | **848 to 885 bills** | the 672 bills at `other_chamber` or past it, plus the 176 at `floor` above, plus up to the 37 messages; the exact count needs each bill's action history, which CT doesn't store |
| | resolutions | 455 adopted | resolutions at `floor` whose latest action is their adoption (294 *agreed to*, 156 a post-passage motion, 5 *considered passed*); adoption is a simple resolution's last step |
| Sent to the president | `president` or past it | 126 | 125 bills, and the one resolution below |
| Became law | `enacted` | 120 | **119 bills**; the 120th is `119-sres-611` (below) |

**Does a simple resolution agreed to in one chamber land in `enacted`?** Not by `computeStage`: *agreed to* reads `floor` (`lib/enums.ts:143-154`). Stored, **0 hres** sit at `enacted` (the ten-row read returned none; the same read for `hr` returned three, the control), and **1 sres** does: `119-sres-611`, *Submitted in the Senate, considered, and agreed to … by Unanimous Consent* (2026-02-12). It has no `previous_stage`, no `stage_observed_at` and no `pending_stage`, and was summarized 2026-05-11, before `computeStage` became the authority, so its `enacted` is the old model's. `computeStage` reads it `floor` today, and stage only advances, so nothing moves it (backlog, filed by this HO).

**Does calendar placement read as `committee`?** Yes, by `computeStage` (`lib/enums.ts:167`). Of the 689 rows whose latest action places them on a calendar, any scope, it reads 657 `committee` and 32 `other_chamber` (*Received in the Senate … Placed on …*). Stored, 591 are `committee`, 33 `other_chamber`, and **65 `floor`**: the old model's reading, which the advance-only guard keeps (SKILL `:1918-1922`). They are the BANKED *Deferred ~75-bill downward stage correction (HO 385)*, 65 today, all bills and all in the poster's scope.

**One more reading of the floor rung.** `computeStage` reads *Message on Senate action sent to the House* and *The Chair directed the Clerk to notify the Senate…* as `introduced` (no rule names them), where the chamber has acted. The 45 rows at `floor` whose latest action is such a message (37 bills, 8 resolutions) keep `floor` because a downgrade to `introduced` is rejected (SKILL `:1923`). A bill first seen with one would be stored `introduced`.

## B. The CRA check

`getClusterStats`'s own statement (`lib/queries.ts:8513-8518`), ungated: **CRA disapproval 215 total, 18 enacted**, 43 past committee, 0 ceremonial. That reproduces the Patterns row.

Of the enacted bills with `cluster_id = 'cra-disapproval'`: **18** in `getClusterStats`'s scope (any ceremonial flag, summarized or not; equal to the statement above, the control), and **18 of 120 (15.0%)** in the poster's scope, where all 215 CRA resolutions sit. **So the poster's *18 of 120* mixes an ungated 18 with a gated 120, and today the mix changes nothing:** every CRA resolution is non-ceremonial and summarized. It would part only if one weren't.

## C. The sponsors

`getMembersRanked({}, "volume", 1, 12)` as the page runs it (claim 5's statement, `lib/queries.ts:7511-7538` with both CTEs spliced in), at 7:54 PM MT:

| # | Member | Chamber | Sponsored | Enacted |
|---|---|---|---|---|
| 1 | Rick Scott (R-FL) | Senate | 170 | 0 |
| 2 | Edward J. Markey (D-MA) | Senate | 147 | 0 |
| 3 | Marsha Blackburn (R-TN) | Senate | 135 | 2 |
| 4 | Mike Lee (R-UT) | Senate | 132 | 0 |
| 5 | Richard J. Durbin (D-IL) | Senate | 128 | 0 |
| 6 | Ted Cruz (R-TX) | Senate | 126 | 4 |
| 7 | John Cornyn (R-TX) | Senate | 122 | 3 |
| 8 | Jeff Merkley (D-OR) | Senate | 121 | 0 |
| 9 | Cory A. Booker (D-NJ) | Senate | 120 | 0 |
| 10 | Richard Blumenthal (D-CT) | Senate | 119 | 0 |
| 11 | Catherine Cortez Masto (D-NV) | Senate | 116 | 0 |
| 12 | Michael Lawler (R-NY) | House | 115 | 0 |
| | **sums** | | **1,551** | **9** |

The poster's 1,551 and 9 reproduce. **The line it prints:** *Top 12 sponsors: 1,551 bills and resolutions, 9 enacted (current members, non-ceremonial, 119th Congress).* The count includes resolutions (every `bill_type`) and isn't summary-gated. The CTE has no Congress clause; it reads as the 119th's because the table holds only the 119th (claim 8).

## D. The build-protocol numbers

- **Handoffs:** the roadmap pointer reads **786** (`docs/roadmap.md:7050`, *Also notes now run through HO 786*), as does the highest HO in `main`'s commit subjects. 787 once this lands.
- **When the build began:** the first commit on `main` is `c578e09`, *Initial commit*, **May 3, 2026, 3:15 PM MT (21:15:01Z)**. The roadmap's first dated entry is 2026-05-12 (`:52`, the site assessment), so the first commit is the earlier. Its smallest date string, 2000-01-01 at `:669`, is a stamp inside an entry, not an entry's date. **The handoff's command doesn't read it:** `git log --reverse --format='%h %ad' --date=iso -1` prints `88d6327 2026-10-19 13:11:53 -0600`, HEAD, because `-1` limits the walk before `--reverse` orders it (oddities). `git rev-list --max-parents=0 main` names `c578e09`.
- **Commits:** `git rev-list --count main` reads **1,656** at `88d6327`.
- **Cron:** `vercel.json` carries **20 entries over 19 routes**, `/api/cron/markets` running on two schedules. The poster's *19 cron jobs* counts routes; *20 schedules* counts what fires. Every entry, its expression and its time in Mountain Time (MDT through Oct 31, MST from Nov 1):

| Route | Schedule | In words |
|---|---|---|
| `/api/sync` | `0 */6 * * *` | every 6 hours on the hour (00:00, 06:00, 12:00, 18:00 UTC) |
| `/api/cron/weekly-report` | `30 9 * * 1` | Mondays at 09:30 UTC: 3:30 AM MDT, 2:30 AM MST |
| `/api/sync-votes` | `0 10 * * *` | daily at 10:00 UTC: 4:00 AM MDT, 3:00 AM MST |
| `/api/sync-race-ratings` | `0 11 * * *` | daily at 11:00 UTC: 5:00 AM MDT, 4:00 AM MST |
| `/api/cron/committees` | `5 */6 * * *` | every 6 hours at :05 |
| `/api/cron/committee-meetings` | `50 */12 * * *` | every 12 hours at :50 (00:50, 12:50 UTC) |
| `/api/cron/primaries` | `0 0,12 * * *` | twice daily, 00:00 and 12:00 UTC: 6:00 PM and 6:00 AM MDT, 5:00 PM and 5:00 AM MST |
| `/api/cron/race-challengers` | `30 12 * * *` | daily at 12:30 UTC: 6:30 AM MDT, 5:30 AM MST |
| `/api/cron/summarize` | `*/10 * * * *` | every 10 minutes |
| `/api/cron/news` | `*/30 * * * *` | every 30 minutes |
| `/api/cron/rating-history` | `0 15 * * *` | daily at 15:00 UTC: 9:00 AM MDT, 8:00 AM MST |
| `/api/cron/markets` | `0 */4 * * *` | every 4 hours on the hour |
| `/api/cron/markets?source=fmp` | `0,30 13-21 * * 1-5` | weekdays, every 30 minutes from 13:00 to 21:30 UTC: 7:00 AM to 3:30 PM MDT, 6:00 AM to 2:30 PM MST |
| `/api/cron/kalshi` | `15 */2 * * *` | every 2 hours at :15 |
| `/api/cron/lda` | `0 8 * * *` | daily at 08:00 UTC: 2:00 AM MDT, 1:00 AM MST |
| `/api/cron/lda-rollup` | `0 22 * * *` | daily at 22:00 UTC: 4:00 PM MDT, 3:00 PM MST |
| `/api/cron/amendments` | `0 7 * * *` | daily at 07:00 UTC: 1:00 AM MDT, 12:00 AM MST |
| `/api/cron/nominations` | `0 9 * * *` | daily at 09:00 UTC: 3:00 AM MDT, 2:00 AM MST |
| `/api/cron/bill-rosters` | `40 */3 * * *` | every 3 hours at :40 |
| `/api/cron/general-ballot` | `20 */2 * * *` | every 2 hours at :20 |

- **The poster's seven cron claims:** the handoff quotes one, *19 cron jobs*, read above. The other six are in Corey's draft, which is chat-side, so the table carries every entry to check each one against.
- **The three workflows:**
  - **CI** (`ci.yml`): on pull requests and pushes to `main`, skipped when every changed path is under `docs/**`, `.claude/**`, `**/*.md` or `LICENSE`. It runs `npm ci`, the typecheck (`tsc` over the app, then over the e2e config), the odds-site allowlist and `next build`. It's secretless.
  - **design citations** (`design-citations.yml`): on every push to any ref, on pull requests and by hand. It runs `check:design-citations`.
  - **e2e-prod** (`e2e-prod.yml`): on `deployment_status`, daily at 15:00 UTC and by hand. `smoke` runs on a successful Production deployment, the schedule and dispatch: `smoke.spec`, `odds-off.spec` and `narrow.spec` against prod, with retries 2. `narrow-preview` runs on a successful Preview deployment: `narrow.spec` against that Preview's own URL, with no retries.

## E. Race odds, and the snapshot that covers Nov 3

- **The two tables** (`scripts/migrate.ts`):
  - `kalshi_odds` (`:294-305`): `race_id TEXT PRIMARY KEY`, `cycle`, `event_ticker`, `implied_pct`, `favorite_label`, `favorite_is_party`, `favorite_party`, `open_interest`, `close_time`, `updated_at`.
  - `polymarket_odds` (`:315-327`): `race_id TEXT PRIMARY KEY`, `cycle`, `slug`, `implied_pct`, `favorite_label`, `favorite_is_party`, `favorite_party`, `volume`, `liquidity`, `end_date`, `updated_at`.
  - Each keeps one row per race, upserted on `race_id` by `/api/cron/kalshi` (`app/api/cron/kalshi/route.ts:43-69`, `:97-125`), every 2 hours at :15 UTC, which never deletes one. On prod every row of both carries its `updated_at`: the snapshot's read-back reads it on all 503.
- **No append-only odds table:**
  - `grep -n odds scripts/migrate.ts` finds 6 lines, all the two tables'.
  - On prod, the tables whose names say *odds*, *kalshi*, *polymarket*, *market*, *tick*, *snapshot* or *history* are those two, `market_ticks` (the tapes' symbols, appended, not per race), `rating_history` (ratings) and `polarization_history` (ideology).
- **`dashboard_state` holds 9 keys, not only `kalshi_chamber_control`.** The other eight: `committee_bills_sync_cursor`, `cron_lock:summarize`, `lda_bill_drill`, `lda_lobbying_rollup`, `lda_top_firms`, `lda_topic_crosswalk`, `palestine_tracker_pools`, `primaries_cron_cursor`, as `scripts/migrate.ts:78-82` says. `kalshi_chamber_control` is its only odds key, and it holds chamber control, not races (138 bytes, written 6:15 PM MT).
- **The kalshi cron's newest payload** (#26417, success, 6:15 PM MT, 00:15:10Z to 00:15:49Z): `{"ok":true,"elapsedMs":39513,"payload":{"seats":460,"polymarketSeats":34,"house":{"favParty":"D","favPct":90,"otherParty":"R","otherPct":10},"senate":{"favParty":"D","favPct":62,"otherParty":"R","otherPct":38}}}`. The tick's counts and chamber control, **no per-race field**.
- **N, as of 7:57 PM MT (01:57Z):**
  - **99** 2026 races in the rated index (86 House, 13 Senate), joined as `/electoral`'s `getRacesIndex(2026)` joins them (`lib/queries.ts:3122-3130`; 2026 is `sanitizeCycle`'s default, `:382-387`).
  - Kalshi odds 99, Polymarket 13, both 13, Kalshi only 86, neither 0.
  - All 99 Kalshi rows were written by the newest tick.
- **The snapshot, built and dry-run once.**
  - `--odds-snapshot` writes `docs/probes/odds-snapshots/<YYYY-MM-DD-HHMM-MT>.json`, its time MT on a 24-hour clock so the names sort. It never overwrites one.
  - The file holds every row of both tables with its `updated_at`, the run's time in MT and UTC, the kalshi cron's newest run and newest success, the counts above and the rated index's 99 race ids, so the later N is this N.
  - **The dry run wrote `2026-10-19-1957-MT.json`** (192,299 bytes, 7:57 PM MT). Read back, its rows equal the tables' counts, **469 and 34**.
  - Written at or after the newest successful tick's start (#26417, 6:15 PM MT): **460 of 469** Kalshi rows and 34 of 34 Polymarket rows. The 9 older are California seats last written Jun 30, 10:32 AM MT (16:32Z). The cron upserts what Kalshi lists and never deletes, so a market Kalshi dropped keeps its last row. None is in the rated index.
  - The file was then deleted, and a separate process read it gone, the folder with it.
- **The three runs Corey makes** (Mountain Time is MST from Sunday Nov 1, UTC−7), each just after a :15 tick, as the review reply set them:
  - **When:** **Monday Nov 2 at 9:30 PM**, **Tuesday Nov 3 at 7:30 AM** and **Tuesday Nov 3 at 3:30 PM** MST, which are 04:30Z, 14:30Z and 22:30Z Nov 3 (`date -u -d 2026-11-02 +%A` reads Monday). The cron writes at :15 past every odd MST hour: on Nov 2 at 5:15, 7:15, 9:15 and 11:15 PM (00:15, 02:15, 04:15, 06:15Z Nov 3); on Nov 3 at 5:15, 7:15, 9:15 and 11:15 AM, and 1:15 and 3:15 PM (12:15Z to 22:15Z, every two hours).
  - **The third follows the last tick before any poll closes.** The reply puts the first closures at 6 PM ET, which is 4:00 PM MST (23:00Z), Eastern being on EST from Nov 1. The 3:15 PM MST tick (22:15Z) is the last before it; the next, 5:15 PM MST (00:15Z Nov 4), comes after.
  - Run each at least 5 minutes after its tick: `npx tsx scripts/diagnostic/gradshow-numbers-787.ts --odds-snapshot`, from the repo root, with `.env` in place.
  - **What to check** in the lines it prints: the read-back's two counts *equal*, the newest tick a *success*, and every Kalshi row the rated index uses written by that tick. A row older than the tick is named, and the later count leaves it out of N.
  - The next HO after the results commits the three files and computes *favorites won X of N* over the rated index each file carries.
- **The open loop:** CT keeps no per-race odds history; the snapshot covers Nov 3 by hand, and whether a history table is wanted is a product call (backlog, owner Corey).

## F. The spot-check pack

- **The input:** the summarizer's prompt carries the title, the latest action, the CRS summary when one exists, and the bill text truncated (`lib/summarize.ts:217-220`). It fetches the CRS summaries and takes the newest by `actionDate` (`:151-161`), and SKILL records it (`:1887`, `:1900`). So a CT summary written after a CRS summary existed was written with it in view.
- **The draw:**
  - Seed 787 over the 18,137 non-ceremonial bills with a CT summary, read until 30 were independent or 90 were read: **90 read, 3 independent, 31 shown, 56 with no CRS summary yet.**
  - The pack is the 3 independent bills and the first 27 shown ones.
  - **62% of the bills read have no CRS summary, and of the 34 that do, 31 (91%) had it in the prompt.**
  - Every bill read carries one CRS version, so the handoff's rule and the pack's stricter one agree on all 90.
- **The cost:** Congress.gov took 90 requests, all 200, one in flight and at least 1s apart. Prod took 93 statements and 37,254 `rows_read`.
- `docs/probes/787-crs-spotcheck.md` carries each bill's CT summary beside the CRS text, with the two grading lines blank. Corey grades.

## G. Usage

- **The tree holds nothing that counts visitors.**
  - `package.json`'s 29 dependencies include no `@vercel/analytics` or `@vercel/speed-insights`.
  - In `app`, `components` and `lib`, 332 source files carry none of `@vercel/analytics`, `@vercel/speed-insights`, `<Analytics`, `<SpeedInsights` or `injectSpeedInsights`. The control: the same walk finds `unstable_cache` in 19.
- **Where a count could come from:** Vercel Web Analytics in the project's dashboard, if it's on. Corey reads it. Nothing was added.

## Deviations (named)

1. **Three commits, as the Commits section lists them** (`diag`, `docs`, `docs(skill)`). The Docs section's *committed alone* for each probe file is read as *a docs commit, apart from code*. HO 715 and HO 747 each committed their probe file in one docs commit with the roadmap and backlog.
2. **F's rule is stricter than the handoff's:** a bill is independent only when every CRS version postdates the CT summary, not only the newest. It changed no bill here.
3. **The pack's rule paragraph gained one sentence after the run**, on what `updateDate` is. The script carries the same sentence for any re-run.
4. **D's first commit comes from `git rev-list --max-parents=0 main`,** since the handoff's command prints HEAD.
5. **The snapshot's name uses MT on a 24-hour clock** so the names sort. Its contents print 12-hour MT with UTC beside.
6. **Congress.gov's pacing:** SKILL sets its rate limit (20,000 an hour, `:46`), not a probe cadence, so the probe ran one request in flight, at least 1s between starts.
7. **`--numbers` ran four times** (r1 to r4) as the instrument grew: the `sres` row, the floor rung's classes, the workflows' triggers. Every number the runs share reads the same, and r4 is the reading of record. All six runs are in the `rows_read` total.
8. **A count with no other predicate reads `WHERE id IS NOT NULL`,** which every row meets, so its `rows_read` is honest. A bare `COUNT(*)` under-reports its cost (HO 624's trap).
9. **The completeness read ran from a scratchpad script,** not the instrument: the review reply amends the two docs commits, so `diag` stays as committed. It made one request and sent the key as F does (A). Which 610 CT lacks, and why, is an OPEN LOOPS line (Code), and the two reads that would split them are the next HO's STEP 0.

## Ground truth the probe corrected (flagged, not absorbed)

1. **`dashboard_state` holds nine keys** (E). *Only `kalshi_chamber_control`* is true of its odds keys.
2. **The handoff's first-commit command prints HEAD** (D).
3. **The handoff's *Passed one chamber* rule undercounts:** a passed bill's latest action is usually a later step (A, the labels).
4. **The poster's *Became law 120* includes a Senate resolution** stored at `enacted` by the old model (A).
5. **The summarizer takes the newest CRS summary by `actionDate`,** not by `updateDate` (F).
6. **The poster's 18,137 is the summary-gated count, and at this read the ungated count is the same** (A1).
7. **The *last sync* on the poster's foot is the newest Congress.gov update, not the sync's time** (A1).
8. **`786-close.md` doesn't exist.** HO 786's FF records were read from `docs/handoffs/786-artifacts/ff/paste-786-ff.md`, whose `verify:deploy` line reads *first match at 0s*, where the handoff says 1s.
9. **CT's `bills` isn't every 119th-Congress bill:** Congress.gov lists 19,716 where CT held 19,106, so the poster's *Introduced* counts the bills CT holds (A).
