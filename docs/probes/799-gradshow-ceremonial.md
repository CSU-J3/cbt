# HO 799 — the GradShow poster's ceremonial bills by stage: each count with its predicate and its as-of

> **Diagnostic-only probe, not wired.** Base `main` at `281c81d`. Run **Wednesday 2026-11-04**, a day before the handoff's Thursday, as the chat sent it (the file written 11:54 AM MST, 18:54Z); Mountain Standard Time with UTC beside. The reading of record is run **r2, 12:24:16 to 12:24:21 PM MST (19:24:16 to 19:24:21Z)**; r1 at 12:09:28 PM MST (19:09:28Z) read every figure the two share the same and preceded two added reads (the untagged rows by month, the laws dated after the cut). **Budget:** prod read with `SELECT` only, through `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name, its schema fingerprint `4e94644350e1d992` before and after each run; **303,523 `rows_read`** over 24 statements in r2 (269,126 over 21 in r1), each statement's hrana pipeline result carrying the field (`rows-ledger.tsv`). No Congress.gov request, no cron call, no flush, no write. The instrument is `scripts/diagnostic/gradshow-ceremonial-799.ts`, a sibling of `gradshow-numbers-787.ts` (untouched); its logs and JSON are under `docs/handoffs/799-artifacts/` (repo-ignored). The counts are reported, not fixed: a tag that reads wrong is a finding for the chat and the poster, not a reclassification (guard 3).

What the reads were as of: `/api/sync` last ran at 11:00:11 AM MST (#30573, 18:00:11Z, success) and `/api/cron/summarize` at 12:20:23 PM MST (#30591, 19:20:23Z, success); the newest `update_date` among the bills was 10:57:03 AM MST (17:57:03Z) and the newest `summary_updated_at` 11:10:26 AM MST (18:10:26Z). `bills` holds **19,832** rows, all the 119th Congress (HO 787 read 19,106 on Oct 19).

## The table, for the poster chat

Every figure read at 12:24:20 PM MST Nov 4 (19:24:20Z) from one statement's cells (A) unless the row says otherwise. **HALTs: none.**

| Stage | **A1 · hollow:** law-eligible and ceremonial | **A2 · the dome:** law-eligible, not ceremonial or untagged |
|---|---|---|
| introduced | 1 | 105 |
| committee | 154 (46 on a calendar) | 15,785 (567 on a calendar) |
| floor | 7 (0 on a calendar) | 296 (48 on a calendar) |
| other_chamber | 12 (1 on a calendar) | 570 (34 on a calendar) |
| president | 0 | 0 |
| enacted | 3 | 136 |
| other · NULL | 0 · 0 | 0 · 0 |
| **total** | **177** | **16,892** (7,587 tagged not ceremonial, **9,305 untagged**) |

| Figure | Value | Predicate or note |
|---|---|---|
| A3 · ceremonial resolutions | **990** (hres 589, sres 347, hconres 40, sconres 14) | `bill_type IN ('hres','sres','hconres','sconres') AND is_ceremonial = 1` |
| A3 · at `floor` or later | **231** (floor 225, other_chamber 6) | not "agreed to": a concurrent resolution's `other_chamber` is one chamber only |
| A3 · with `agreed` set | **221** | `latest_action_text LIKE '%agreed to%'`, HO 787's value |
| A4 · ceremonial, all types | **1,167** | HO 787's 969 at 7:54 PM MT Oct 19 (01:54Z Oct 20): **+198** |
| A4 · law-eligible ceremonial (A1) · A3 | **177** · **990** | A1 + A3 = 1,167 = control 2 |
| A4 · law-eligible, any tag (A1 + A2) | **17,069** | HO 787's 16,303 + A1 = 16,480: **+589** (A2 16,892 beside 16,303: +589) |
| B · ceremonial laws | **3** | `stage = 'enacted' AND is_ceremonial = 1`, law-eligible |
| B2 · under Pew's cut, `latest_action_date <= '2026-10-14'` | **3 of 122** (2.5%) | Pew: 12 of 121 as of Oct. 14, 2026 (109 substantive); its coders aren't CT's classifier |
| B2 · without the cut | **3 of 139** | 17 laws dated after Oct 14, two of them signed Nov 3 with no public-law number yet |
| C · post-office titles | **123**: 90 ceremonial, 1 not, 32 untagged | `title LIKE '%post office%' OR title LIKE '%facility of the United States Postal Service%'` |
| D · the seed | **799** | mulberry32, a Fisher-Yates shuffle of the id-sorted list (HO 787's CRS-pack method) |

**For the poster chat.** The hollow dots can mark the **177** bills the classifier tagged ceremonial, each in its stage above. But **9,305 of the dome's 16,892 bills carry no tag at all**: all of them were summarized in May 2026, the first batch, and every law-eligible bill summarized since June carries one (A2's untagged rows). Among the 7,764 tagged law-eligible bills the ceremonial share is 2.3% (177 of 7,764); at that rate the May batch would hold about 210 more hollow dots, which nothing here reads. The key "hollow = ceremonial" is true of what it marks and silent about the May batch; whether to run the backfill classifier over the 10,840 untagged rows before Monday is the chat's call (a prod write, not this HO's).

## STEP 0, re-derived at `281c81d` (a check)

| # | Claim | Reading |
|---|---|---|
| 1 | `main` is `281c81d` on the remote and the box | holds, 12:01 PM MST (19:01Z): `main`, `origin/main` and `ls-remote` read `281c81d781c33fb18f7c3a2ba9a5f9ce6399eb29`, the remote's one head; pointer 798 at `docs/roadmap.md:8540`; highest HO in commit subjects 798; the tree clean but for `docs/probes/odds-snapshots/`; reconcile `^- ` 647, `^- ~~` 362, `^- **~~` 0, so **285 / 362 on 647**, mis-struck 0 |
| 2 | the ladder, `other` and NULL off path, stage only advances | holds: `ALLOWED_STAGES` at `lib/enums.ts:55-62`, the six in order. The HO 239 guard (`decideStage`, `lib/summarize-runner.ts:112-124`) advances a forward move or a first observation past introduced, rejects any downgrade to `introduced`, and takes another downgrade only when the same stage is proposed twice running (`:122`). Prod stores committee 17,993 · enacted 140 · floor 970 · introduced 137 · other_chamber 592; no `other`, no NULL, no `president`, none off the ladder |
| 3 | `is_ceremonial` is 1, 0 or NULL | holds: written at `lib/summarize-runner.ts:306` (null, 1 or 0) by the UPDATEs at `:323` and `:379`, at `scripts/classify-ceremonial.ts:40-41` (1 or 0), and reset to NULL with the summary at `lib/sync.ts:351`. Prod by `typeof` and value: integer 0 **7,825** · integer 1 **1,167** · NULL **10,840**; nothing else |
| 4 | the dome's scope and predicate | holds: `docs/probes/787-gradshow-numbers.md:89` (`bill_type IN ('hr','s','hjres','sjres') AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`) and `:66` (the predicate, and the 969) |
| 5 | `119-sres-611` (record) | stored `enacted`, `is_ceremonial` **NULL**, summarized May 11, 2026, 1:18:07 AM MDT (07:18:07Z), no `previous_stage`, no `stage_observed_at`, latest action 2026-02-12 *Submitted in the Senate, considered, and agreed to without amendment…* So it is not in A3 (the tag is NULL, never counted ceremonial) and not in A2 (a simple resolution), and it still sits at `enacted` by the old model (HO 787's backlog line stands) |
| 6 | no approval date for a 119th law | holds: `historical_laws` stores the 118th only (`scripts/migrate.ts:498-500`); prod's `pragma_table_info('bills')` lists 32 columns, nine of them date-like (`introduced_date`, `latest_action_date`, `update_date`, `summary_updated_at`, `summarize_failed_at`, `pending_stage_at`, `stage_observed_at`, `changed_at`, `committees_walked_at`) and none an approval date, so B2's cut uses `latest_action_date` |
| 7 | `cal`, `agreed`, the usage line, SKILL's list (record) | `cubeSql` at `gradshow-numbers-787.ts:244`, `cal` at `:248`, `agreed` at `:249`, the usage line at `:1035`; SKILL's scripts list carries `late-index-791.ts` (`:1387`) and the rehearsal (`:1389`) and not `gradshow-numbers-787.ts` (0 hits), so this sibling isn't listed either |

No HALT: 2, 3 and 4 hold; 1 holds; 5, 6 and 7 are records.

## A. Ceremonial by stage

**One statement**, run at 12:24:20 PM MST (19:24:20Z), 119 cells; every table below is a sum over its cells, so they share that as-of:

```
SELECT bill_type, stage, is_ceremonial,
       (summary IS NOT NULL) AS gated,
       COALESCE(latest_action_text LIKE '%placed on%' AND latest_action_text LIKE '%calendar%', 0) AS cal,
       COALESCE(latest_action_text LIKE '%agreed to%', 0) AS agreed,
       COUNT(*) AS n,
       MAX(update_date) AS max_upd, MAX(summary_updated_at) AS max_sum
  FROM bills
 WHERE id IS NOT NULL
 GROUP BY 1, 2, 3, 4, 5, 6
```

`cal` and `agreed` are `gradshow-numbers-787.ts:248-249`'s values, copied, not imported. `WHERE id IS NOT NULL` keeps the statement's `rows_read` honest (HO 624's trap), and every row meets it.

**The controls** (two separate statements straight after the cube, read 1): `SELECT COUNT(*) FROM bills WHERE bill_type IN ('hr','s','hjres','sjres')` read **17,069** = A1 + A2 (177 + 16,892); `SELECT COUNT(*) FROM bills WHERE is_ceremonial = 1` read **1,167** = A1 + A3 (177 + 990); every cell's `bill_type` among the eight (hr 10,953 · s 5,674 · hjres 221 · sjres 221 · hres 1,647 · sres 951 · hconres 125 · sconres 40). Equal on the first read, so no re-read and no HALT.

### A1 · law-eligible and ceremonial

Predicate `bill_type IN ('hr','s','hjres','sjres') AND is_ceremonial = 1`.

| Stage | Count | Of which `cal` | Reached at least |
|---|---|---|---|
| introduced | 1 | 0 | 177 |
| committee | 154 | 46 | 176 |
| floor | 7 | 0 | 22 |
| other_chamber | 12 | 1 | 15 |
| president | 0 | 0 | 3 |
| enacted | 3 | 0 | 3 |
| other · NULL | 0 · 0 | | |
| **total** | **177** | | |

On the `floor` row none is a calendar placement (HO 787 found 65 such rows kept at `floor` in the non-ceremonial scope; the dome holds 48 today). The 46 at `committee` on a calendar are what `computeStage` reads a calendar placement as.

### A2 · the dome's own predicate

Predicate `bill_type IN ('hr','s','hjres','sjres') AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`: the dome's counts on the same as-of.

| Stage | Count | Of which `cal` | Reached at least |
|---|---|---|---|
| introduced | 105 | 0 | 16,892 |
| committee | 15,785 | 567 | 16,787 |
| floor | 296 | 48 | 1,002 |
| other_chamber | 570 | 34 | 706 |
| president | 0 | 0 | 136 |
| enacted | 136 | 0 | 136 |
| other · NULL | 0 · 0 | | |
| **total** | **16,892** | | |

**The unclassified inside it:** `is_ceremonial IS NULL` **9,305**, every one with a summary (`gated` 9,305, awaiting one 0); tagged not ceremonial (`is_ceremonial = 0`) **7,587**. The enacted share is 136 of 16,892, 0.8% (HO 787: 119 of 16,303, 0.7%).

**The untagged rows, read once more** (a finding's evidence, not one of A's cells): by the summarizer's model and the month summarized, the untagged law-eligible rows are **2026-05 gemini-2.5-flash 9,305**, and nothing else; the tagged ones (the control, the same grouping) are 2026-05 576 · 2026-06 81 · 2026-07 1,231 · 2026-08 1,118 · 2026-09 1,447 · 2026-10 3,248 · 2026-11 63, all gemini-2.5-flash. The summarizer asks for `is_ceremonial` in its JSON (`lib/summarize.ts:20`, `:28`) and stores NULL when the answer isn't a boolean (`:194-197`, *Don't guess*), leaving the row to `scripts/classify-ceremonial.ts`, which reads `WHERE is_ceremonial IS NULL` (`:17`) and hasn't been run over them; the sync resets the tag whenever it resets the summary (`lib/sync.ts:351`). So the May 2026 batch, the corpus's first summarization, never got an answer, and every bill summarized or re-summarized since June has one.

### A3 · the other four types and ceremonial

Predicate `bill_type IN ('hres','sres','hconres','sconres') AND is_ceremonial = 1`: **990** (hres 589, sres 347, hconres 40, sconres 14). By stage: introduced 9 · committee 750 · floor 225 · other_chamber 6 · president 0 · enacted 0 · other 0 · NULL 0. **At `floor` or later: 231**; **with `agreed` set: 221**. They aren't the same number and neither is "agreed to": a resolution's adoption reads `floor`, a concurrent resolution's `other_chamber` means one chamber only, and `agreed` is a substring of the latest action (HO 787, non-ceremonial scope: 468 at floor, 455 adopted). These types can never become law: **990 of the 1,167 ceremonial rows (84.8%) aren't bills at all.**

### A4 · totals

| Total | Now | HO 787 (7:54 PM MT Oct 19, 01:54Z Oct 20) | Drift |
|---|---|---|---|
| ceremonial across all types | **1,167** | 969 | +198 |
| law-eligible ceremonial (A1) | **177** | | |
| A3 | **990** | | |
| law-eligible, any tag (A1 + A2) | **17,069** | 16,303 + A1 = 16,480 | +589 |
| the dome (A2) | **16,892** | 16,303 | +589 |
| rows held | **19,832** | 19,106 | +726 |
| the dome's enacted | **136** (hollow 3 beside) | 119 | +17 |

Both HO 787 figures predate HOs 788 to 794, which added rows and re-summarized others, so neither was expected to hold; the drift is theirs.

## B. Ceremonial laws

**B1.** Predicate `bill_type IN ('hr','s','hjres','sjres') AND stage = 'enacted' AND is_ceremonial = 1`, read 12:24:20 PM MST (19:24:20Z): **3 rows**, each a *Became Public Law* action.

| Id | Latest action date | Title | Latest action |
|---|---|---|---|
| `119-s-1596` | 2025-07-24 | Jocelyn Nungaray National Wildlife Refuge Act | Became Public Law No: 119-30. |
| `119-s-2283` | 2025-12-18 | A bill to designate the facility of the United States Postal Service located at 201 West Oklahoma Avenue in Guthrie, Oklahoma, as the "Oscar J. Upham Post Office". | Became Public Law No: 119-59. |
| `119-s-790` | 2026-09-25 | A bill to redesignate the National Historic Trails Interpretive Center in Casper, Wyoming, as the "Barbara L. Cubin National Historic Trails Interpretive Center". | Became Public Law No: 119-117. |

**B2.** The cut `latest_action_date <= '2026-10-14'` (the proxy: `bills` stores no approval date, STEP 0's claim 6; for a *Became Public Law* action the two are the same day). The same list under the cut: **3**. The denominator, every law-eligible bill at `enacted` under the cut, any tag: **122** (tagged not ceremonial 106, ceremonial 3, untagged 13). **CT: 3 of 122 (2.5%)**, beside **Pew Research Center: 12 of 121** laws as of Oct. 14, 2026 (109 substantive). Pew's definition is *"intended primarily to honor or recognize an individual, group or cause"*, and its coders aren't CT's classifier; and 13 of CT's 122 have no tag. Without the cut: **3 of 139**. **Dated after the cut: 17**, all tagged not ceremonial: `119-s-240`, `119-s-2403`, `119-s-283` (Oct 15), `119-hr-1721`, `119-hr-227`, `119-hr-2388`, `119-hr-2481`, `119-hr-3620`, `119-hr-4307`, `119-hr-4467`, `119-hr-6380`, `119-hr-7831`, `119-hr-837` (Oct 20), `119-hr-7022`, `119-hr-952` (Oct 22), and **`119-hr-1744` and `119-hr-8205`, whose latest action is *Signed by President.* (Nov 3), not yet a *Became Public Law* action**, so their date is the signing date (the flag the handoff asked for; none of B1's three needs it).

**B3.** The reconcile HO (CT's laws against the Archives) hadn't landed as of `281c81d`, so B1 is re-derived here, not cited. A re-run at a HEAD where it has landed cites its list instead.

## C. The label's example

The poster's label says ceremonial means things "like naming a post office". Predicate `bill_type IN ('hr','s','hjres','sjres') AND (title LIKE '%post office%' OR title LIKE '%facility of the United States Postal Service%')` (SQLite's `LIKE` is case-insensitive for ASCII): **123** titles, **90 tagged ceremonial, 1 tagged not, 32 untagged**. The one tagged not ceremonial, drawn as in D from a pool of one (the id list's sha256 `359cbce76c52ab33`, seed 799): **`119-hr-10442`**, *To require the Ronald A. Robinson Post Office in Little Rock, Arkansas, to replace certain exterior signage, and for other purposes* (`committee`). It directs an agency, which the summarizer's prompt reads as substantive (`lib/summarize.ts:20`), so the tag reads right; the label's example holds for the 90, and the 32 untagged are the May batch's.

## D. Ten for Corey to eyeball

Seed **799**: mulberry32 over the id-sorted candidate list, a Fisher-Yates shuffle, the first five taken (HO 787's CRS-pack method, `gradshow-numbers-787.ts:732-784`); the draw reproduces only against the same list, so each list's sha256 is printed.

**Five law-eligible ceremonial bills at `floor` or later** (22 candidates, the id list's sha256 `9af0762904188c0e`; the first ten drawn: 119-s-1596, 119-s-567, 119-hr-9191, 119-s-2682, 119-hr-4288, 119-hr-1461, 119-hr-4647, 119-hr-9570, 119-hr-6006, 119-s-790):

| Id | Stage | Title |
|---|---|---|
| `119-s-1596` | enacted | Jocelyn Nungaray National Wildlife Refuge Act |
| `119-s-567` | floor | First Rhode Island Regiment Congressional Gold Medal Act |
| `119-hr-9191` | other_chamber | National Fossil Act of 2026 |
| `119-s-2682` | floor | Captain Paul W. 'Bud' Bucha VA Medical Center Act of 2025 |
| `119-hr-4288` | other_chamber | To name the Department of Veterans Affairs community-based outpatient clinic in San Jose, California, as the "Corporal Patrick D. Tillman VA Clinic". |

**Five still in `committee`** (154 candidates, the id list's sha256 `e4447bf2093d2928`; the first ten drawn: 119-hr-8562, 119-hr-9871, 119-hr-7313, 119-hr-10114, 119-hr-5309, 119-hr-10141, 119-hr-7809, 119-hr-10755, 119-hr-3671, 119-hr-8909):

| Id | Stage | Title |
|---|---|---|
| `119-hr-8562` | committee | To designate a building of the Chancery of the United States in Pristina, Kosovo, as the "Eliot L. Engel Building". |
| `119-hr-9871` | committee | To name the Department of Veterans Affairs community-based outpatient clinic, Saint Thomas, United States Virgin Islands, as the "Sergeant First Class Floyd E. Lake Department of Veterans Affairs Community-Based Outpatient Clinic". |
| `119-hr-7313` | committee | To designate the facility of the United States Postal Service located at 3135 1st Avenue North in St. Petersburg, Florida, as the "Poul Hornsleth Post Office". |
| `119-hr-10114` | committee | To designate the facility of the United States Postal Service located at 15642 Sand Canyon Avenue in Irvine, California, as the "Mary Kageyama Nomura Post Office Building". |
| `119-hr-5309` | committee | Congressional Tribute to Constance Baker Motley Act of 2025 |

Whether *National Fossil Act of 2026* (a designation) reads right is Corey's to say; nothing here reclassifies.

## After HO 800's backfill (as of 3:13:54 PM MST Nov 4, 22:13:54Z)

> **HO 800** ran the backfill classifier (`npm run classify-ceremonial`, gemini-2.5-flash on each bill's title and latest action) over the 10,840 rows reading `is_ceremonial` NULL, by Corey's ruling (*"backfill"*, Nov 4, 1:54 PM MST): the NULL ids snapshotted first at 2:51:41 PM MST (21:51:41Z; `docs/handoffs/800-artifacts/null-ids-before.tsv`, repo-ignored, the reversal list), a 200-row pilot, then the full run, 2:53:53 to 3:09:56 PM MST (21:53:53 to 22:09:56Z). **9,720 rows were tagged; 1,120 still read NULL**: 1,105 refused by the project's gemini-2.5-flash quota of 10,000 generate requests a day (Tier 1), which began refusing at 3:09:47 PM MST (22:09:47Z) and resets at 1:00 AM MST Nov 5 (08:00Z), and 15 parse-fails. The residue is sres 567, s 390, sjres 135, sconres 19 and hr 9, so the batch's 567 Senate simple resolutions (of 951) are still untagged; its resume is an OPEN LOOPS line, dated before Monday Nov 9. Below, this file's script re-read afterwards, `--label 800`, read-only (3:13:52 to 3:13:54 PM MST, 22:13:52 to 22:13:54Z; 24 statements, 314,347 `rows_read`; the fingerprint `4e94644350e1d992` before and after), beside the 12:24 PM MST reading above. No sync ran between the two (`/api/sync` last at 11:00:11 AM MST, #30573) and no summary was written (the newest `summary_updated_at` still 11:10:26 AM MST). The controls hold: A1 + A2 = 17,069 and A1 + A3 = 2,066, the two separate counts, on the first read. Nothing above this section is edited.

| Stage | **A1 · hollow** after (799, Δ) | **A2 · the dome** after (799, Δ) |
|---|---|---|
| introduced | 1 (1, 0) | 105 (105, 0) |
| committee | 353 (154, **+199**), 49 on a calendar (46) | 15,586 (15,785, −199), 564 on a calendar (567) |
| floor | 8 (7, +1), 1 on a calendar (0) | 295 (296, −1), 47 on a calendar (48) |
| other_chamber | 14 (12, +2), 1 on a calendar (1) | 568 (570, −2), 34 on a calendar (34) |
| president | 0 (0, 0) | 0 (0, 0) |
| enacted | 7 (3, +4) | 132 (136, −4) |
| other · NULL | 0 · 0 | 0 · 0 |
| **total** | **383** (177, **+206**) | **16,686** (16,892, −206): 16,152 tagged not ceremonial (7,587, +8,565), **534 untagged** (9,305, −8,771), every one with a summary |

| Figure | After HO 800 | HO 799 (12:24 PM MST) | Δ |
|---|---|---|---|
| A3 · ceremonial resolutions | **1,683** (hres 1,248, sres 347, hconres 74, sconres 14) | 990 (589, 347, 40, 14) | +693 (hres +659, hconres +34; sres and sconres are in the residue) |
| A3 · at `floor` or later | **254** | 231 | +23 |
| A3 · with `agreed` set | **244** | 221 | +23 |
| A4 · ceremonial, all types | **2,066** | 1,167 | +899 (HO 787's 969: +1,097) |
| A4 · law-eligible, any tag (A1 + A2) | **17,069** | 17,069 | 0 |
| B · ceremonial laws | **7** | 3 | +4: `119-hr-2170` (the Leonard G. "Bud" Lomell VA Clinic, Public Law 119-35), `119-hr-452` (the Miracle on Ice Congressional Gold Medal, 119-53), `119-s-4138` (a posthumous honorary promotion's notice waived, 119-80), `119-hr-7194` (the Nicholas Dockery Medal of Honor Act, **Private Law 119-2**, which B flags as not a *Became Public Law* action) |
| B2 · under Pew's cut | **7 of 122** (5.7%), every one of the 122 now tagged | 3 of 122, 13 untagged | +4: up toward Pew's 12 of 121 and still short of it; one of the 7 is the private law |
| B2 · without the cut | **7 of 139** | 3 of 139 | +4; none of the 17 laws dated after Oct 14 is ceremonial |
| C · post-office titles | **123**: 117 ceremonial, 5 not, 1 untagged | 90, 1, 32 | the 32 untagged: 27 tagged ceremonial, 4 tagged not, 1 in the residue |
| D · the seed | 799, the lists now 29 at `floor` or later (22) and 353 in committee (154) | | the draws move with the lists (the run's log carries both) |

**The four post-office titles the backfill tagged not ceremonial** are each substantive by its title, as HO 799's signage bill is: two direct the Postal Service (`119-hr-3958`, notice when a post office suspends operations; `119-hr-6523`, a post office established in Mountain House, California), one transfers land to it for a post office's construction (`119-hr-4716`), and `119-hr-287` is the Mobile Post Office Relief Act, an act's name alone, for Corey's eye.

**For the poster chat.** The hollow dots now mark **383** law-eligible bills against the dome's 16,686, every stage's count above. 534 of the dome's bills are still untagged: 525 Senate bills and joint resolutions refused or unparsed (s 390, sjres 135) and 9 House bills that failed to parse. About 6 of them would be hollow at the rates by type (s 34 of 2,859 in this backfill, 1.2%; sjres 1 of 86 among the tagged), 12 or 13 at the pooled 2.3% (206 of 8,771). The resume after 1:00 AM MST Nov 5 tags them, and Monday Nov 9's re-run reads the poster's figures after it. CT's ceremonial laws read 7 of 122 under Pew's Oct 14 cut (Pew: 12 of 121); with every law now tagged, the gap is the two classifiers' definitions, not CT's coverage.

### The second reading, after HO 801's resume (as of 1:06:08 AM MST Nov 5, 08:06:08Z)

> **HO 801** resumed the residue after the quota reset: `npm run classify-ceremonial -- --label full-2 --concurrency 5`, 1:02:23 to 1:05:16 AM MST Nov 5 (08:02:23 to 08:05:16Z). It saw the 1,120 rows still NULL and tagged 1,115 (494 ceremonial, 621 not), with 5 parse-fails, 0 errors and 0 429s. Production's `/api/revalidate?tag=bills` was flushed by hand at 1:05:33 AM MST (200). **The batch's residue is the 5 parse-fails:** `119-hr-1536`, `119-hr-4561`, `119-hr-5696`, `119-s-2883`, `119-s-928`, all law-eligible. Across HO 800 and HO 801, NULL went from 10,840 to 5, a drop of 10,835, which equals the four logs' ok rows. Seven of those rows were re-summarized by Production's summarizer afterwards and carry its tag; none is unexplained. This file's script re-read once more, `--label 801`, read-only (1:06:07 to 1:06:09 AM MST, 08:06:07 to 08:06:09Z; 24 statements, 315,964 `rows_read`; the fingerprint `4e94644350e1d992` before and after). Beside it is the first reading above, with the deltas. A sync (#30703, 11:00 PM MST Nov 4) and the summarizer ran between the two; the law-eligible count, 17,069, didn't move. The controls hold: A1 + A2 = 17,069 and A1 + A3 = 2,560.

| Stage | **A1 · hollow** now (first reading, Δ) | **A2 · the dome** now (first reading, Δ) |
|---|---|---|
| introduced | 1 (1, 0) | 105 (105, 0) |
| committee | 364 (353, **+11**), 49 on a calendar (49) | 15,575 (15,586, −11), 564 on a calendar (564) |
| floor | 8 (8, 0) | 295 (295, 0) |
| other_chamber | 14 (14, 0) | 568 (568, 0) |
| president | 0 | 0 |
| enacted | 7 (7, 0) | 132 (132, 0) |
| **total** | **394** (383, **+11**) | **16,675** (16,686, −11): 16,670 tagged not ceremonial (+518), **5 untagged** (534, −529), the 5 parse-fails |

| Figure | Now | First reading | Δ |
|---|---|---|---|
| A3 · ceremonial resolutions | **2,166** (hres 1,248, sres 814, hconres 74, sconres 30) | 1,683 | +483: the batch's Senate resolutions now counted (sres +467, sconres +16) |
| A3 · at `floor` or later | **495** | 254 | +241 |
| A3 · with `agreed` set | **480** | 244 | +236 |
| A3 · at `enacted` | **1** | 0 | `119-sres-611`, now tagged ceremonial (HO 799's claim 5 read it untagged) |
| A4 · ceremonial, all types | **2,560** | 2,066 | +494 (HO 787's 969: +1,591) |
| B · ceremonial laws, under Pew's cut | **7 of 122** | 7 of 122 | 0: every law under the cut was tagged by the first reading |
| C · post-office titles | 123: **118 ceremonial, 5 not, 0 untagged** | 117, 5, 1 | the last untagged one tagged ceremonial |
| D · the seed's lists | 29 at `floor` or later (29), 364 in committee (353) | | the committee draw moves |

**For the poster chat.** The hollow dots mark **394** of the dome's 16,675 law-eligible bills; 5 bills stay untagged, the classifier's parse-fails, too few to move a dot. The Senate's ceremonial resolutions are now in A3: 2,166 in all, 495 at `floor` or later. The ceremonial laws still read 7 of 122 under Pew's Oct 14 cut (Pew: 12 of 121). Monday Nov 9's `--label print` re-run is the poster's as-of.

## Findings

1. **The May 2026 batch has no tag.** 9,305 of the dome's 16,892 bills (55%) carry `is_ceremonial` NULL with a summary, all summarized in May 2026 by gemini-2.5-flash; every law-eligible bill summarized since June carries a tag (A2's untagged rows, with the control). The hollow dots can mark the 177 tagged; the May batch's share is unknown (about 210 at the tagged rows' 2.3%). The backfill classifier exists (`scripts/classify-ceremonial.ts`, Gemini over `WHERE is_ceremonial IS NULL`, 10,840 rows across all types) and is a prod write, so it is the chat's call, not this HO's; filed here and in the block, with no backlog line of its own (the handoff fixes the backlog to one line and the `:42` note).
2. **Two laws signed Nov 3 have no public-law number yet.** `119-hr-1744` and `119-hr-8205` read `enacted` on *Signed by President.* (2026-11-03); their `latest_action_date` is the signing date until Congress.gov posts the *Became Public Law* action (B2's flag). Neither is under the cut; both are in the no-cut 139.
3. **No bill sits at `president`** in either scope (HO 787 read 6 on Oct 19): every bill that reached the president's desk by this read had become law or been signed.
4. **The dome's calendar rows at `floor` are 48** (HO 787's 65 then), and A1 has none at `floor`: hollow and solid alike, the poster's floor rung carries the kept calendar placements, 48 today.
5. **`119-sres-611` is untagged**, so A3 never counts it; it still sits at `enacted` by the old model, as HO 787 filed.
6. **CT's law count under Pew's cut is 122 against Pew's 121**, with 13 of the 122 untagged, so CT's *3 of 122* is a floor on the ceremonial share, not a comparison with Pew's 12.

## Departures from the handoff's letter, flagged

1. **Run on Wednesday Nov 4, not Thursday Nov 5**, as the chat sent it at 11:54 AM MST (18:54Z). The backlog note the handoff words as *HO 799 (2026-11-05) … no reply as of Nov 5* is written as **2026-11-04 … no reply as of Nov 4**, the day it was read (Corey's word in the chat at HO 798's FF go); the OPEN LOOPS line is opened 2026-11-04.
2. **Two reads beyond A to D:** the untagged rows by model and month (with the tagged rows as the control) and the laws dated after the cut. A's tables stay sums over the one statement; the two are evidence for findings 1 and 2.
3. **Two runs:** r1 at 12:09 PM MST (19:09Z) before those reads existed, r2 at 12:24 PM MST (19:24Z) with them, the record. Every figure the two share reads the same (one summarize tick, #30591, ran between them and moved nothing the cube counts).
4. **A read-only review of the script before the record run** (an adversarial workflow, 15 agents, no file or git write, the script not run by it): 0 findings confirmed; three nits taken anyway: the B2 numerator's NULL-date semantics aligned with the SQL cut, the precondition on bills' columns not worded as a HALT, and B3 worded as dated rather than as a claim about the current HEAD.
5. **The `cal` column prints on every stage**, not only `floor`, since the sum costs nothing; the handoff's floor reading is the one called out.
6. **`119-sres-611` falls in no A table** (a simple resolution with a NULL tag), which the handoff's claim 5 anticipated ("A3 follows the tag").

## The ledger

Two runs, both read-only, both with the schema fingerprint `4e94644350e1d992` before and after: r1 12:09:28 to 12:09:33 PM MST (19:09:28 to 19:09:33Z), 21 statements, 269,126 `rows_read`; **r2 12:24:16 to 12:24:21 PM MST (19:24:16 to 19:24:21Z), 24 statements, 303,523 `rows_read`**, the record. 572,649 in all, about 0.02% of the plan's 2.5B a month (HO 602); every statement's pipeline result carried the field. The run's inputs: `.env`'s `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name; nothing else.

**Monday Nov 9, before the poster prints:** `npx tsx scripts/diagnostic/gradshow-ceremonial-799.ts --label print` once more, read-only; its as-of pasted to the chat and to the poster chat; no commit unless a figure the poster carries has moved (the backlog line).
