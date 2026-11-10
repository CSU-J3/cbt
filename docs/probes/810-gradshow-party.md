# HO 810 — the GradShow poster's bills and laws by sponsor's party: each count with its predicate and its as-of

> **Diagnostic-only probe, not wired.** Base `main` at `1ebc2aa`, built on `810-review`. Run **Tuesday 2026-11-10**, Mountain Standard Time with UTC beside. The reading of record is run **810**, 9:49:04 to 9:49:09 AM MST (16:49:04 to 16:49:09Z). **B and C are one read-only transaction**, back at **9:49:09 AM MST (16:49:09Z)**, the as-of every B and C figure carries; the database's clock inside it read 9:49:08 AM MST (16:49:08Z). A was read just before it, at 9:49:08 AM MST (16:49:08Z). **Budget:** prod read with `SELECT` only, through `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name, its schema fingerprint `4e94644350e1d992` before and after (Nov 5's too); **425,666 `rows_read`** over 32 statements (16 single, 16 inside one `BEGIN TRANSACTION READONLY` batch), 34 results carrying the field: one per statement, plus the batch's `BEGIN` and `COMMIT` (`rows-ledger.tsv`). No Congress.gov request, no cron call, no flush, no write. The instrument is `scripts/diagnostic/gradshow-party-810.ts`, a sibling of `gradshow-ceremonial-799.ts` (untouched); its log and JSON are under `docs/handoffs/810-artifacts/` (repo-ignored). The counts are reported, not fixed.

What the reads were as of: `/api/sync` last ran at 5:00:11 AM MST (#32055, 12:00:11Z, success) and `/api/cron/summarize` at 9:40:23 AM MST (#32107, 16:40:23Z, success); the newest `update_date` among the bills was 4:57:03 AM MST (11:57:03Z) and the newest `summary_updated_at` 5:10:26 AM MST (12:10:26Z). The dome's rows hold one Congress: its predicate reads **16,677** rows with `congress = 119` (`getCurrentCongress()`) and without it. (Nov 5's reading found all 19,832 `bills` rows in the 119th; today's reads didn't group the rest of `bills` by Congress.)

## The card, for the poster chat

**HALTs: none.** As of **9:49:09 AM MST Nov 10 (16:49:09Z)**:

```
REPUBLICANS: 8,587 BILLS · 107 LAWS · 1.25%
DEMOCRATS: 7,997 BILLS · 19 LAWS · 0.24%
INDEPENDENTS: 93 BILLS · 0 LAWS · 0.00%
NOV 10, 2026, 9:49 AM MT
```

- **The predicate is the dome's own:** HO 799's A2 (`bill_type IN ('hr','s','hjres','sjres') AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`) with the handoff's `congress = 119` (`getCurrentCongress()`). Party is `bills.sponsor_party`, a law is `stage = 'enacted'`, the rate is laws over bills. The three lines sum to 16,677 bills and 126 laws.
- **The dome's 126 still holds.** Today's dome reads 126 laws, the same 126 by count and stamp: no law in it was observed after Nov 5's reading (C2 lists none), none moved in or out by its tag, and all 139 law-eligible laws today (any tag) were observed by then or never stamped. (Nov 5's artifact lists no ids for its 126.)
- **The dome's bill count moved; its laws didn't.** It reads 16,677 bills against the printed 16,664 (**+13**), net: 12 more law-eligible rows (17,069 → 17,081; nothing deletes bills) and the ceremonial count down one (405 → 404). The run reads counts, not which rows came in or which tags moved. So the card's BILLS add up to 16,677, not the dome's printed 16,664. The card and the dome share their 126 but not their bill total.
- **Two bills sit at `president`**, both R-sponsored and both started in the House; the printed dome had none there. If either becomes law and a sync records it before the print, the dome's 126 and the Republican line's 107 move.
- **When `sponsor_party` is written** (A): Congress.gov's bill detail's first sponsor's party, written at insert and rewritten on every upsert (`lib/sync.ts:324`). But a bill is refetched only when its Congress.gov record moves, so it keeps the party of its last fetch.
- **The one party switcher's earlier bills stayed put** (A). Kevin Kiley (K000401, R → I on 2026-03-09) has 20 bills here at R and 3 at I. Congress.gov updated one of his pre-switch bills seven months after the switch, and its detail still reads R. He's the only sponsor whose bills carry two parties, and none of his 23 is a law. A switcher whose earlier bills Congress.gov did move would carry one party, and these reads can't see one.

B2, the chamber a bill started in (same predicate, same as-of):

| Party | House bills | House laws | House rate | Senate bills | Senate laws | Senate rate |
|---|---:|---:|---:|---:|---:|---:|
| R | 5,710 | 65 | 1.14% | 2,877 | 42 | 1.46% |
| D | 5,171 | 14 | 0.27% | 2,826 | 5 | 0.18% |
| I | 3 | 0 | 0.00% | 90 | 0 | 0.00% |

## STEP 0, re-derived at `1ebc2aa` (a check)

The handoff carries its premises resolved, so STEP 0 checks them and goes on; none failed.

| # | Claim | Reading |
|---|---|---|
| 1 | the HO number, and `main` | **810**: pointer 809 (`docs/roadmap.md:9277`, *Also notes now run through HO 809*), highest HO in commit subjects 809. `main`, `origin/main` and `ls-remote` read `1ebc2aa7f7bd95a7bc57f2d6bfefe8068dbefe44`, the remote's one branch head, at 9:10 AM MST (16:10Z); the tree clean but for `docs/probes/odds-snapshots/` (two untracked files); reconcile `^- ` 658, `^- ~~` 389, `^- **~~` 0, so **269 / 389 on 658** |
| 2 | the dome's scope and predicate (HO 799, A2) | holds: `LAW` and `NONC` at `scripts/diagnostic/gradshow-ceremonial-799.ts:44` and `:47`, `CUBE_SQL` at `:273-281`, each **byte-equal** to the instrument's copy, asserted at run time before prod is read (sha256 `LAW` `c98e90acffcc98d1`, `NONC` `59300836bbe7d401`, `CUBE_SQL` `b7ccf45c38097611`). Congress is `getCurrentCongress()` (`lib/congress.ts:1-8`), 119, bound as an argument |
| 3 | the dome as printed, Nov 5, 12:37 PM MT (19:37Z) | holds, with one reading. The handoff's figures are HO 799's fourth reading (`run-803.json`, the cube as of **12:37:44 PM MST, 19:37:44.063Z**; `docs/probes/799-gradshow-ceremonial.md:345-353`) except floor and committee: that reading stores floor **294** and committee **15,574**, and the handoff's **246** and **15,622** are those with the 48 calendar placements at floor counted as committee (294 − 48, 15,574 + 48). The 16,664, 126, 0 `president`, 565 `other_chamber`, 105 `introduced`, 405 ceremonial and 17,069 hold as given. C1 prints both readings |
| 4 | stage only advances (HO 239) | holds for `enacted`. `decideStage` (`lib/summarize-runner.ts:112-124`) advances a forward move, rejects a downgrade to `introduced`, and takes another downgrade when the same lower stage is proposed twice running (`:122`), so a stage can step down that way. No law-eligible bill has left `enacted` (C2's control). The ladder is `ALLOWED_STAGES` (`lib/enums.ts:55-62`) |
| 5 | party is `bills.sponsor_party`; `members.party` is normalized to R, D and I | holds. `members.party` is the member's latest party (`pickCurrentParty`, `scripts/sync-members.ts:198-204`, `:391`) through `normalizeParty` (`:130-141`, bound at `:423`). Over every `members` row, read at 9:49:08 AM MST (16:49:08Z): R 274 · D 262 · I 3 current and R 9 · D 7 former, no NULL. `bills.sponsor_party` isn't normalized when written (`lib/sync.ts:448` binds the detail's value as given); A reads its values |
| 6 | the 119th's majorities (House Press Gallery and senate.gov, Nov 10) | not re-read (no outside request). Consistent by count: the 539 current `members` rows are the handoff's 533 seated members (218 + 214 + 1 + 53 + 45 + 2) plus the six non-voting House delegates, and the 3 current I match its 1 + 2. The run read `members` by party and `is_current`, not by chamber |
| 7 | the members probe's findings file (B5) | **absent** from `docs/probes/` (B5) |

## A. The party field

**Read at 9:49:08 AM MST (16:49:08Z)**, one statement, predicate `congress = 119 AND bill_type IN ('hr','s','hjres','sjres') AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`:

| `sponsor_party` | Rows | SQLite type, length, bytes |
|---|---:|---|
| `R` | **8,587** | text, 1, `52` |
| `D` | **7,997** | text, 1, `44` |
| `I` | **93** | text, 1, `49` |
| NULL | **0** | |
| `''` (the empty string) | **0** | |
| **total** | **16,677** | equal to a separate `COUNT(*)` over the same predicate |

**No HALT:** R, D and I only, and NULL plus empty 0 of 16,677 (0.000%, against the 0.5% bound). The same two conditions hold on B1's own read (B's check 4), so the card's numbers meet them too.

**Where `sponsor_party` comes from, and when it's written** (the tree at `1ebc2aa`):
- **One writer.** `UPSERT_SQL` (`lib/sync.ts:311-369`) inserts the column (`:312`, `:315`) and, on conflict, sets it again with no condition: `sponsor_party = excluded.sponsor_party` (`:318`, `:324`). Outside `scripts/diagnostic`, no other statement writes it or inserts into `bills` (`git grep`: `:312` and `:324` only).
- **The value** is Congress.gov's bill detail's first sponsor's party, as given: `const sponsor = detail.sponsors?.[0]` (`:393`), bound as `sponsor?.party ?? null` (`:448`). No trim or mapping, and a missing party writes NULL. On all 16,677 rows the column equals `raw_json`'s `$.sponsors[0].party`, the detail it was written from (0 invalid).
- **Rewritten on every upsert, not once.** What waits on `update_date` moving is `changed_at` and `committee_walk_failures` (`:336-337`), the seven summary-reset columns through `substantive` (`:432`, computed only when `update_date` moved, `:424`) and the stage trio through `stageAdvanced` (`:416`, used at `:433-434`). `sponsor_party` waits on nothing.
- **But an existing bill is upserted again only when it's queued.** The drain upserts (`lib/sync.ts:589`) and deletes the queue row (`:602`) only for ids in `sync_queue`. The listings fill it (`enqueue`, `:263`; `walkList`, `:514`):
  - the frontier listing runs every `/api/sync` tick (`app/api/sync/route.ts:106`; `vercel.json`, `0 */6 * * *`) and lists the bills whose Congress.gov update date moved (`lib/sync.ts:745`);
  - the wide listing runs once a UTC day and re-lists everything updated in the 48 hours behind the frontier (`lib/sync.ts:40`, `:752-753`, `:756`).

  Beyond the cron: `npm run sync` (`scripts/sync.ts:11`), and the box's `--enqueue` (`scripts/diagnostic/sync-frontier-790.ts:1010`), which fills the backfill queue its `--drain` (`:1052`) upserts. `bills-gap-788.ts:1362` (`--repair`) is superseded. **A bill whose Congress.gov record stops changing keeps the party of its last fetch.**

**What the rows say: for the one switcher they show, Congress.gov kept his earlier bills at his earlier party.** One sponsor's bills in the dome carry two parties (the read, same predicate):

| Sponsor | `sponsor_party` | Bills | Introduced | Newest `update_date` | Newest `changed_at` |
|---|---|---:|---|---|---|
| K000401, *Rep. Kiley, Kevin [R-CA-3]* | R | 20 | 2025-01-06 to 2026-02-20 | Oct 15, 2:44:11 PM MDT (20:44:11Z) | **Oct 25, 7:10:00 PM MDT (Oct 26, 01:10:00Z)** |
| K000401, *Rep. Kiley, Kevin [I-CA-3]* | I | 3 | 2026-04-13 to 2026-07-16 | Sep 19, 5:32:01 PM MDT (23:32:01Z) | Oct 25, 7:18:10 PM MDT (Oct 26, 01:18:10Z) |

His `members` row reads I, with `partyHistory` I from 2026 and R 2023 to 2026; he switched on 2026-03-09 (`docs/backlog.md:202`, `docs/oddities.md:286`). `changed_at` is stamped only when an upsert inserts the bill or moves its `update_date` (`lib/sync.ts:316`, `:336`, bound at `:455`), and every upsert writes `sponsor_party`. So at least one of his pre-switch bills was written on Oct 25, 7:10 PM MDT (Oct 26, 01:10Z), seven months after the switch, from a detail that said R. It could be a first write or a rewrite; the run doesn't say which.

The Oct 24 prod seed (`docs/handoffs/790-artifacts/seed-1000.json`, read 2:19:11 PM MDT, 20:19:11Z) holds a rewrite: `119-hr-3495`, introduced 2025-05-19.
- Its Congress.gov update is dated Oct 15, 2:44:11 PM MDT (20:44:11Z), and it was written Oct 15, 6:00:20 PM MDT (Oct 16, 00:00:20Z). It reads R in the column and in `raw_json`.
- The row predates that write. It reads `committee` with no `stage_observed_at`, and a first insert is staged by the summarizer's stamping advance (`lib/summarize-runner.ts:318-322`).

So Congress.gov updated a pre-switch bill seven months after the switch and still reported R. His bills split at the switch date, and a refetch didn't move the earlier ones. That settles the question `docs/oddities.md:4851` left open ("at introduction or at ingestion") for his bills: at introduction.

These reads can't see a switcher whose earlier bills Congress.gov did move, since those would carry one party. Kiley is the only sponsor whose `sponsor_party` differs from `members.party` at any stage. None of his 23 bills is a law: none of his R bills is among B4's 126, and B1's I row has no law. On this card his 20 pre-switch bills count Republican and his 3 later ones Independent.

## B. Bills and laws by sponsor's party

**One read with C**, back at 9:49:09 AM MST (16:49:09Z).

### B1 · party by stage

Predicate `congress = 119 AND bill_type IN ('hr','s','hjres','sjres') AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`.

| Party | introduced | committee | floor | other_chamber | president | enacted | other | NULL | **Total** | **Enacted share** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| R | 41 | 7,835 | 164 | 438 | 2 | **107** | 0 | 0 | **8,587** | **1.25%** |
| D | 64 | 7,659 | 128 | 127 | 0 | **19** | 0 | 0 | **7,997** | **0.24%** |
| I | 0 | 92 | 1 | 0 | 0 | **0** | 0 | 0 | **93** | **0.00%** |
| **column total** | 105 | 15,586 | 293 | 565 | 2 | **126** | 0 | 0 | **16,677** | 0.76% |
| C1, the dome's own statement | 105 | 15,586 | 293 | 565 | 2 | 126 | 0 | 0 | 16,677 | |

B5 (beside the enacted column): no members probe findings file sits in `docs/probes/` (below), so there is no A.3 row to set here.

### B2 · by the chamber a bill started in

Predicate B1's, `AND bill_type IN ('hr','hjres')` for the House and `AND bill_type IN ('s','sjres')` for the Senate; each its own statement.

| House | introduced | committee | floor | other_chamber | president | enacted | Total | Share |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| R | 32 | 5,117 | 58 | 436 | 2 | **65** | **5,710** | **1.14%** |
| D | 60 | 4,967 | 4 | 126 | 0 | **14** | **5,171** | **0.27%** |
| I | 0 | 3 | 0 | 0 | 0 | **0** | **3** | **0.00%** |
| **total** | 92 | 10,087 | 62 | 562 | 2 | **79** | **10,884** | 0.73% |

| Senate | introduced | committee | floor | other_chamber | president | enacted | Total | Share |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| R | 9 | 2,718 | 106 | 2 | 0 | **42** | **2,877** | **1.46%** |
| D | 4 | 2,692 | 124 | 1 | 0 | **5** | **2,826** | **0.18%** |
| I | 0 | 89 | 1 | 0 | 0 | **0** | **90** | **0.00%** |
| **total** | 13 | 5,499 | 231 | 3 | 0 | **47** | **5,793** | 0.81% |

`other` and NULL read 0 in every cell of both tables.

### B3 · bills an independent sponsored, at `floor` or later

Predicate B1's `AND sponsor_party = 'I' AND stage IN ('floor','other_chamber','president','enacted')`: **one**.

| Id | Sponsor | Stage |
|---|---|---|
| `119-sjres-82` | *Sen. King, Angus S., Jr. [I-ME]* | `floor` (latest action 2025-12-18; not a calendar placement) |

### B4 · the laws' sponsors against `members.party`

The 126 laws (B1's predicate `AND stage = 'enacted'`) joined to `members` on `sponsor_bioguide_id = members.bioguide_id`, the key `bills_agg` joins on (`lib/queries.ts:7491`, `:7576`): **none** differs. Every law has a `sponsor_bioguide_id`, and every one has a `members` row.

### B5 · the members probe's A.3 split

**Not in `docs/probes/`.** Its eleven findings files include none named for members. The lines naming A3 or A.3 are HO 787's *A3, the bills that can become law* (`docs/probes/787-gradshow-numbers.md:87`), whose 119 enacted (Oct 19) is the count the handoff names but which has no party split, and HO 799's A3, the ceremonial resolutions. Nothing under `docs/` but this HO's own handoff names a members probe (a `grep -r` that reads ignored files too). So no row sits beside B1's enacted column.

### The HALTs

1. **B1's column totals against C1** (the dome's own statement, from the same read): equal in every column, 16,677 in all. **No HALT.**
2. **B2's two tables against B1:** sum to B1 in every cell (3 parties × 8 stages), 10,884 + 5,793 = 16,677. **No HALT.**
3. **Added: B2's tables against C1's cells by chamber** (C1's `hr` and `hjres` cells, its `s` and `sjres` cells): equal in every column.
4. **Added: A's two conditions on B1's own parties:** R, D and I only, NULL plus empty 0.

What each can catch. Check 2, as the handoff words it, can't fire on any database state inside one snapshot: the two predicates split the four types, so it checks the instrument's own aggregation, not the rows. Check 3 compares B2 with an independent statement and can. Check 1 can fire on a Congress the clause drops, a row with a NULL `id`, or a tag the JavaScript and SQL predicates read differently. The `COUNT` control (16,677) is an identity of B1 in the same snapshot.

## C. The dome, same read

### C1 · today's per-stage counts beside Nov 5

The dome's own statement (HO 799's `CUBE_SQL`, verbatim, no Congress clause) cut to `bill_type IN ('hr','s','hjres','sjres') AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`, as of 9:49:09 AM MST Nov 10 (16:49:09Z), beside the reading of 12:37:44 PM MST Nov 5 (19:37:44Z):

| Stage | Nov 5, stored | Today, stored | Δ | Nov 5, as the handoff carries it | Today, read the same way | Δ |
|---|---:|---:|---:|---:|---:|---:|
| introduced | 105 | 105 | 0 | 105 | 105 | 0 |
| committee | 15,574 | 15,586 | **+12** | 15,622 | 15,634 | **+12** |
| floor | 294 | 293 | **−1** | 246 | 245 | **−1** |
| other_chamber | 565 | 565 | 0 | 565 | 565 | 0 |
| president | 0 | 2 | **+2** | 0 | 2 | **+2** |
| enacted | **126** | **126** | **0** | **126** | **126** | **0** |
| other · NULL | 0 · 0 | 0 · 0 | 0 | | | |
| **total** | **16,664** | **16,677** | **+13** | **16,664** | **16,677** | **+13** |

- **"Read the same way"** moves the calendar placements at `floor` down to `committee`, the reading the handoff's Nov 5 figures take. They're 48 on both days (`COALESCE(latest_action_text LIKE '%placed on%' AND latest_action_text LIKE '%calendar%', 0)`, the 799 statement's flag).
- **Ceremonial**, law-eligible (`bill_type IN ('hr','s','hjres','sjres') AND is_ceremonial = 1`): **404**, Nov 5's 405 **−1**.
- **Law-eligible, any tag** (`bill_type IN ('hr','s','hjres','sjres')`): **17,081**, Nov 5's 17,069 **+12**.
- **Untagged inside the dome** (`is_ceremonial IS NULL`): **5**, every one with a summary, as on Nov 5 (a count; the ids weren't compared).
- **`is_ceremonial`'s values**, law-eligible: integer 0 16,672 · integer 1 404 · NULL 5; nothing else (HO 799's claim 3).

### C2 · laws the printed dome doesn't show

Predicate `congress = 119 AND bill_type IN ('hr','s','hjres','sjres') AND (is_ceremonial = 0 OR is_ceremonial IS NULL) AND stage = 'enacted' AND stage_observed_at > '2026-11-05T19:37:44.063Z'`: **none**.

- **The boundary is the Nov 5 cube's own as-of**, 12:37:44 PM MST (19:37:44.063Z), not the handoff's minute: a law observed between 12:37:00 and 12:37:44 PM MST (19:37:00 to 19:37:44Z) was in the printed dome. That window holds none either.
- **The controls:** the same count by `julianday()` reads 0. No law-eligible bill has left `enacted` (`previous_stage = 'enacted'`).
- **The 126, reconciled** over every law-eligible law, any tag (`congress = 119 AND bill_type IN ('hr','s','hjres','sjres') AND stage = 'enacted'`): **139 today**, all observed at or before Nov 5's as-of or never stamped. That's Nov 5's 139: the **13 laws hollow** on Nov 5 (still tagged ceremonial) and **126** others, all still in the dome. Nothing moved in, nothing moved out, and none carries a latest action dated after Nov 5.
- **Who stamps:** both live writers, the sync and the summarizer, stamp `stage_observed_at` whenever they advance a stage (`lib/sync.ts:367`, `lib/summarize-runner.ts:318-322`). Two one-off scripts set stages without a stamp (`scripts/backfill-stage-384.ts:172`, `scripts/repair-impossible-stage-pairs-239.ts:89-91`), which is where the never-stamped laws come from.

**So the dome's 126 holds**, as of 9:49 AM MST Nov 10 (16:49Z). `/api/sync` next runs at 11:00 AM MST (18:00Z), then at 5:00 PM and 11:00 PM MST (Nov 11, 00:00 and 06:00Z), and at 5:00 AM MST Nov 11 (12:00Z). A law landing in any of those, starting with the two bills at `president`, moves it.

## Findings

1. **The dome's 126 holds, but its bill total doesn't.** The 126 are the same 126 by count and stamp. The dome itself reads 16,677 bills against the printed 16,664 (+12 law-eligible rows; the ceremonial count down one, net). The card's BILLS sum to today's total, so beside the Nov 5 dome they read 13 over its count.
2. **Two R-sponsored bills sit at `president`**, both House-started. The printed dome showed none there (HO 799's third finding). They're the likeliest movers of the 126 before the print.
3. **The one party switch the data shows didn't reach earlier bills.** The column is rewritten from Congress.gov on every upsert, but a bill is refetched only when its Congress.gov record moves.
   - For Kiley, Congress.gov's detail kept the party his earlier bills were introduced under: `119-hr-3495`, updated upstream seven months after his switch, still reads R.
   - On the card, his 20 earlier bills count R and his 3 later ones I.
   - This answers `docs/oddities.md:4851`'s open question for him. The reads can't see a switcher whose bills all moved.
4. **The handoff's B2 HALT can't fire inside one snapshot** (the predicates split the four types). The instrument keeps it, as the handoff asks, and adds a check against the dome's own statement by chamber, which can (HALT check 3).
5. **The handoff's Nov 5 floor and committee are calendar-adjusted.** 246 and 15,622 aren't HO 799's stored 294 and 15,574 but those with the 48 calendar placements at floor counted as committee. C1 prints both readings; the laws, the totals and the other stages agree either way.

## Departures from the handoff's letter, flagged

1. **A sibling script, not a `--party` mode** (the handoff allows either). HO 799's script stays untouched, as HO 799 left HO 787's, and the instrument asserts its predicate and the dome's statement byte-equal to HO 799's before prod is read.
2. **C1 is read off HO 799's statement as written (no Congress clause); B1 and B2 carry `congress = ?`**, as the handoff's "Congress comes from `getCurrentCongress()`" asks. HALT check 1 compares them, and the by-congress control reads 16,677 either way.
3. **C2's boundary** is the Nov 5 cube's as-of to the millisecond, with the handoff's minute read as a control.
4. **Two checks added to B's HALT** (3 and 4 above), and a fourth `is_ceremonial` value would have stopped the run, as HO 799's script would have (`scripts/diagnostic/gradshow-ceremonial-799.ts:222`).
5. **Reads beyond the letter:**
   - A's evidence: the two-party sponsor with dates and `partyHistory`, sponsors against `members.party` at any stage, and the column against `raw_json`;
   - C2's first transitions to `enacted` and the laws that left it;
   - the reconciliation over all 139 laws;
   - B3's calendar flag;
   - the untagged count.

   None feeds a card number.
6. **A read-only review of the instrument before the record run:** an adversarial workflow, 8 agents, no file or git write, the script not run by it.
   - It raised 15 findings; 4 were confirmed, all minor or nit, none touching read-only safety.
   - Fixed before the run: a B HALT now stops before C and the poster block. A's `update_date` anchor was relabeled (it had left out the seven summary-reset columns) and the refetch path anchored. The reconciliation's always-true clause was replaced by named lists. B2 is now checked against the dome by chamber.
   - Its independent trace of `sponsor_party`'s writers matched the code reading above, and found the Kiley seed row.
   - This file was then checked read-only against the run's record, the tree and the handoff (6 agents). Every figure matched. The confirmed fixes were wording, citations and time zones, and the party-switch lines were narrowed to the one member the data shows.
7. **No roadmap block and no backlog edit.** The handoff's Output names two commits. The roadmap pointer stays at 809, and commit subjects carry HO 810, so `docs/method.md`'s max rule gives 811 next. Backlog `:86`, the print-morning re-run of HO 799's script dated Monday Nov 9, is still open: HO 799's ledger ends at label 803. C1 here is a fresh reading of the dome's counts, but it isn't that run.

## The ledger

One run, read-only: **810**, 9:49:04 to 9:49:09 AM MST (16:49:04 to 16:49:09Z), 32 statements (16 single, 16 in one read-only batch), **425,666 `rows_read`**, 34 results carrying the field, the fingerprint `4e94644350e1d992` before and after. The instrument as run is the committed blob (sha256 `304f0f6715f97f164ad30129c839a208bf78aca627c9974e47650a70c932ac69`). The run's inputs: `.env`'s `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name, and `docs/handoffs/799-artifacts/run-803.json` (repo-ignored), whose cube as-of, stored stages, calendar count, 139 laws and 13 hollow ids the instrument checked against its copied constants before reading prod.
