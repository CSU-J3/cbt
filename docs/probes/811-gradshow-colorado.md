# HO 811 — the GradShow poster's Colorado delegation: each member's bills and laws, with each count's predicate and its as-of

> **Diagnostic-only probe, not wired.** Base `main` at `1ebc2aa`, built on `811-review`, stacked on `810-review` at `f67e7d3` (HO 810's two commits). Run **Tuesday 2026-11-10**, Mountain Standard Time with UTC beside. The reading of record is run **811**, 10:39:50 to 10:40:02 AM MST (17:39:50 to 17:40:02Z). **B and C are one read-only transaction**, back at **10:40:02 AM MST (17:40:02Z)**, the as-of every B and C figure carries; the database's clock inside it read 10:40:00 AM MST (17:40:00Z). A was read just before it, 10:39:51 to 10:40:00 AM MST (17:39:51 to 17:40:00Z). **Budget:** prod read with `SELECT` only, through `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name, its schema fingerprint `4e94644350e1d992` before and after; **309,957 `rows_read`** over 30 statements (12 single, 18 inside one `BEGIN TRANSACTION READONLY` batch), 32 results carrying the field: one per statement, plus the batch's `BEGIN` and `COMMIT` (`rows-ledger.tsv`). No Congress.gov request, no cron call, no flush, no write. The instrument is `scripts/diagnostic/gradshow-colorado-811.ts`, a sibling of `gradshow-ceremonial-799.ts` and `gradshow-party-810.ts` (both untouched); its log and JSON are under `docs/handoffs/811-artifacts/` (repo-ignored). The counts are reported, not fixed.

What the reads were as of: `/api/sync` last ran at 5:00:11 AM MST (#32055, 12:00:11Z, success) and `/api/cron/summarize` at 10:30:23 AM MST (#32114, 17:30:23Z, success). **The `members` roster was fetched Sep 11, 2026, 3:01:05 to 3:04:02 PM MDT (21:01:05 to 21:04:02Z)** by `npm run sync:members`, which runs by hand. So the delegation, `is_current` included, is as of then. The roster has 555 rows, 539 current; Colorado has 10 rows, all current.

**The party probe (HO 810) ran first**, at 9:49 AM MST (16:49Z). As the handoff says, it wasn't rerun, and the two readings don't share an as-of; they're 51 minutes apart.
- **Every `bills` and `members` count both carry reads the same:** the dome's 16,677 bills and 126 laws (0.76%), the law-eligible rows' `is_ceremonial` 16,672 · 404 · 5, the 139 laws, and the roster's 555 and 539.
- **No `/api/sync` ran between them;** #32055 is the newest in both.
- **The summarizer did run between them**, which can move a stage or a tag (#32107 at 9:40:23 AM MST, 16:40:23Z, then #32114 at 10:30:23 AM MST, 17:30:23Z; it runs every 10 minutes). It moved none of these counts.

## The card, for the poster chat

**HALTs: none.** As of **10:40:02 AM MST Nov 10 (17:40:02Z)**:

```
BENNET · D · SEN: 72 BILLS · 0 LAWS
HICKENLOOPER · D · SEN: 35 BILLS · 0 LAWS
DEGETTE · D · CO-1: 14 BILLS · 0 LAWS
NEGUSE · D · CO-2: 89 BILLS · 0 LAWS
HURD · R · CO-3: 27 BILLS · 1 LAWS
BOEBERT · R · CO-4: 20 BILLS · 0 LAWS
CRANK · R · CO-5: 9 BILLS · 0 LAWS
CROW · D · CO-6: 28 BILLS · 0 LAWS
PETTERSEN · D · CO-7: 42 BILLS · 0 LAWS
EVANS · R · CO-8: 22 BILLS · 0 LAWS
COLORADO: 358 BILLS · 1 LAWS · 0.28%
CONGRESS: 16,677 BILLS · 126 LAWS · 0.76%
NOV 10, 2026, 10:40 AM MT
```

- **The predicate** is HO 799's A2 (`bill_type IN ('hr','s','hjres','sjres') AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`) with the handoff's Congress clause, `congress = ?` bound to `getCurrentCongress()` (119 at run time). A member's bills are the ones they sponsor, joined to `members` on `sponsor_bioguide_id = members.bioguide_id`, the key `bills_agg` joins on. A law is `stage = 'enacted'`; the member lines are the ten serving, senators first, then the House by district.
- **The card's BILLS are bills, not resolutions:** hr, s, hjres and sjres, non-ceremonial. CT's `/members` totals count every sponsored type, resolutions included (`bills_agg` has no `bill_type` clause, `lib/queries.ts:7471-7493`). So a judge who looks a member up on CT will see a larger number for the same member.
- **Colorado's one law (B3):** `119-hr-2316`, *Wetlands Conservation and Access Improvement Act of 2025*, *Rep. Hurd, Jeff [R-CO-3]*, latest action 2025-11-25, *Became Public Law No: 119-40.*
- **The dome's 126 still holds** (C1): no law in the dome was observed after Nov 5's reading. Its bill total reads 16,677 against the printed 16,664 (+13), as at 9:49 AM MST (16:49Z).
- **Nobody left:** no Colorado row reads `is_current = 0`, on the roster as of Sep 11, 3:04 PM MDT (21:04Z).
- **The median member (C2)** among members with at least one bill in the dome: a senator **52 bills · 0 laws**, a House member **22 bills · 0 laws**. The same holds for serving voting members only (52 · 0 and 22 · 0).
- **Ceremonial bills, excluded above (B5):** 4 (Bennet 1, Neguse 1, Crow 1, Evans 1); none is a law.
- **Two wording points for the poster chat:** HURD's and COLORADO's lines read `1 LAWS`, the handoff's template, so the print may want `1 LAW`. And the House label `CO-n` is this HO's; the template shows a senator only.

## STEP 0, re-derived at `f67e7d3` (a check)

| # | Claim | Reading |
|---|---|---|
| 1 | the HO number, and the base | **811**. The roadmap pointer reads 809 (`docs/roadmap.md:9277`). The highest HO in commit subjects is 810 (`13a7e02` and `f67e7d3` on `810-review`, not yet on `main`). `main` and `origin/main` read `1ebc2aa`, the remote's one branch head (`ls-remote`, 10:09 AM MST, 17:09Z). `811-review` branches from `810-review`'s tip, so `main` can fast-forward through both |
| 2 | the dome's scope and predicate (HO 799, A2) | holds: `LAW`, `NONC` and `CUBE_SQL` byte-equal to `scripts/diagnostic/gradshow-ceremonial-799.ts:44`, `:47` and `:273-281`, asserted at run time before prod is read (sha256 `LAW` `c98e90acffcc98d1`, `NONC` `59300836bbe7d401`, `CUBE_SQL` `b7ccf45c38097611`). Congress is `getCurrentCongress()` (`lib/congress.ts:1-8`), 119, bound as an argument |
| 3 | the dome as printed, Nov 5: 16,664 bills, 126 `enacted` | holds: HO 799's fourth reading (`docs/handoffs/799-artifacts/run-803.json`, the cube as of 12:37:44 PM MST, 19:37:44.063Z), checked against the copied constants before prod is read |
| 4 | stage only advances (HO 239) | holds for the laws read here, not in the code. Any stage, `enacted` included, can step down on a second matching proposal, except to `introduced` (`lib/summarize-runner.ts:121-122`). No law-eligible bill's last move was out of `enacted` (`previous_stage`, C1's control), and the 139 law-eligible laws (any tag) are Nov 5's 139, none observed since |
| 5 | the delegation comes from `members` by state | holds. `members` is the current Congress's roster, 555 rows with 539 current (`scripts/sync-members.ts:1-25`). `is_current` is membership in Congress.gov's `currentMember=true` roster (`:364`), `chamber` comes from the current term (`:369`), and `state` is that term's state name, abbreviated (`:380`, `:424`). CT's members roster filters on `m.is_current = 1` (`lib/queries.ts:7447`), the mark A reports. The instrument names no one: A reads `state = 'CO' OR state_name = 'Colorado'`, and B and C read `state = 'CO'` |
| 6 | join bills to their sponsor the way `bills_agg` does | holds: `bills_agg` filters on and groups by `sponsor_bioguide_id` (`lib/queries.ts:7491-7492`) and joins on `b.sponsor_bioguide_id = m.bioguide_id` (`:7576`); the instrument's join is the same |
| 7 | the name and title as CT shows them | `members.name` (`components/MemberHeader.tsx:88`) and `bills.title` (`components/BillRow.tsx:161`) |

## A. The delegation

**Read 10:39:51 to 10:40:00 AM MST (17:39:51 to 17:40:00Z)**, over `members`. The roster itself, and so every `is_current`, chamber, district and party below, is as of its fetch: Sep 11, 3:01 to 3:04 PM MDT (21:01 to 21:04Z).

- **The state field is usable.** Over all 555 `members` rows it has 56 distinct values, no row without one, and none that isn't two letters. Colorado's rows read `CO` and `Colorado` alike, ten by code, the same ten by name. (The HALT tests that some row reads `CO`; these statistics print beside it.)
- Every row for Colorado (predicate `state = 'CO' OR state_name = 'Colorado'`). Bills and laws are A's own read, the dome's predicate on each member's sponsorships, ending 10:40:00 AM MST (17:40:00Z), just before the B and C transaction. They equal B1's:

| Name (`members.name`) | Chamber | District | Party | Serving | Bills | Laws |
|---|---|---:|---|---|---:|---:|
| Michael F. Bennet | senate | — | D | yes | 72 | 0 |
| John W. Hickenlooper | senate | — | D | yes | 35 | 0 |
| Diana DeGette | house | 1 | D | yes | 14 | 0 |
| Joe Neguse | house | 2 | D | yes | 89 | 0 |
| Jeff Hurd | house | 3 | R | yes | 27 | 1 |
| Lauren Boebert | house | 4 | R | yes | 20 | 0 |
| Jeff Crank | house | 5 | R | yes | 9 | 0 |
| Jason Crow | house | 6 | D | yes | 28 | 0 |
| Brittany Pettersen | house | 7 | D | yes | 42 | 0 |
| Gabe Evans | house | 8 | R | yes | 22 | 0 |

- **No HALT:** the serving set is **2 senators and 8 representatives**, the representatives holding districts **1 to 8**, one each.
- **Served for Colorado earlier in this Congress and left** (`is_current = 0`, the roster as of Sep 11): **none**.
- Every serving member has a last name and a party, which the chat lines use.

## B. Bills and laws per member

**One read with C**, back at 10:40:02 AM MST (17:40:02Z).

### B1 · each member's bills by stage

Predicate `congress = 119 AND bill_type IN ('hr','s','hjres','sjres') AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`, sponsor only, the sponsor's `members.state = 'CO'`:

| Member | introduced | committee | floor | other_chamber | president | enacted | other | NULL | **Bills** | **Laws** | Furthest |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| Bennet (SEN, D) | 0 | 70 | 2 | 0 | 0 | 0 | 0 | 0 | **72** | **0** | floor |
| Hickenlooper (SEN, D) | 0 | 30 | 5 | 0 | 0 | 0 | 0 | 0 | **35** | **0** | floor |
| DeGette (CO-1, D) | 0 | 13 | 0 | 1 | 0 | 0 | 0 | 0 | **14** | **0** | other_chamber |
| Neguse (CO-2, D) | 0 | 87 | 0 | 2 | 0 | 0 | 0 | 0 | **89** | **0** | other_chamber |
| Hurd (CO-3, R) | 0 | 23 | 0 | 3 | 0 | 1 | 0 | 0 | **27** | **1** | enacted |
| Boebert (CO-4, R) | 0 | 17 | 1 | 2 | 0 | 0 | 0 | 0 | **20** | **0** | other_chamber |
| Crank (CO-5, R) | 0 | 9 | 0 | 0 | 0 | 0 | 0 | 0 | **9** | **0** | committee |
| Crow (CO-6, D) | 0 | 28 | 0 | 0 | 0 | 0 | 0 | 0 | **28** | **0** | committee |
| Pettersen (CO-7, D) | 0 | 41 | 0 | 1 | 0 | 0 | 0 | 0 | **42** | **0** | other_chamber |
| Evans (CO-8, R) | 0 | 14 | 1 | 7 | 0 | 0 | 0 | 0 | **22** | **0** | other_chamber |

- **The floor rows hold no calendar placement**, so the furthest stage reads the same as the printed dome reads it.
- **Every member's bills started in their own chamber.**

### B2 · the delegation's total

**358 bills · 1 law · 0.28%**, the ten serving members. No Colorado row reads `is_current = 0` (the roster as of Sep 11), so there's no with-left total.
- **Control:** one `COUNT` over the delegation's bills reads 358 and 1.
- **Completeness against each bill's own `sponsor_state`.** That column is the Congress.gov detail's first sponsor's state (`lib/sync.ts:449`). The dome's bills with `sponsor_state = 'CO'` read 358 and 1, the same: the `members` join misses none, and none of the join's bills carries another state.

### B3 · the delegation's laws

Predicate B1's `AND stage = 'enacted'`: **one**.

| Id | Title (`bills.title`) | Sponsor | `latest_action_date` |
|---|---|---|---|
| `119-hr-2316` | Wetlands Conservation and Access Improvement Act of 2025 | *Rep. Hurd, Jeff [R-CO-3]* | 2025-11-25 (*Became Public Law No: 119-40.*) |

### B4 · bills at `floor`, `other_chamber` or `president`

Predicate B1's `AND stage IN ('floor','other_chamber','president')`: **25**, more than 15, so counts:

| Member | president | other_chamber | floor |
|---|---:|---:|---:|
| Bennet | 0 | 0 | 2 |
| Hickenlooper | 0 | 0 | 5 |
| DeGette | 0 | 1 | 0 |
| Neguse | 0 | 2 | 0 |
| Hurd | 0 | 3 | 0 |
| Boebert | 0 | 2 | 1 |
| Pettersen | 0 | 1 | 0 |
| Evans | 0 | 7 | 1 |
| **delegation** | **0** | **16** | **9** |

Two `other_chamber` rows (Hurd's `119-hr-2600`, Neguse's `119-hr-3922`) carry the 799 statement's calendar flag (a latest action naming a placement on a calendar; the run read the flag, not the text). They're stored `other_chamber`, and the dome's calendar reading applies at `floor` only, so no count moves.

### B5 · ceremonial bills, excluded above

Predicate `congress = 119 AND bill_type IN ('hr','s','hjres','sjres') AND is_ceremonial = 1`, the sponsor's `members.state = 'CO'`: **4**. Bennet 1, Neguse 1, Crow 1 and Evans 1; the other six 0. None is a law.

## C. Congress, same read

### C1 · all bills and laws

The dome's own statement (HO 799's `CUBE_SQL`, verbatim, no Congress clause) cut to `bill_type IN ('hr','s','hjres','sjres') AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`, as of 10:40:02 AM MST (17:40:02Z): **16,677 bills · 126 laws · 0.76%**.
- **Controls:**
  - One `COUNT` with `congress = 119` reads the same.
  - The dome's rows hold one Congress (119, 16,677).
  - `is_ceremonial` over the law-eligible rows (`bill_type IN ('hr','s','hjres','sjres')`, any tag, no Congress clause) reads integer 0 16,672, integer 1 404 and NULL 5, and nothing else. The dome's 16,677 is the 0s and the NULLs.
- **The dome's 126 holds.** None of its laws was observed after Nov 5's as-of, 12:37:44 PM MST (19:37:44.063Z). All 139 law-eligible laws (any tag) were observed by then or never stamped, and 126 of them aren't among Nov 5's 13 hollow ones. None moved in or out by its tag, and none left `enacted`. The bill total reads 16,677 against the printed 16,664 (+13; HO 810's findings break it down).

### C2 · the median member, per chamber

Among members with at least one bill in the dome, by `members.chamber`:
- **Per member:** `COUNT(*)` and its `enacted`, sponsor only, joined on `bills_agg`'s key.
- **The medians:** the bills median and the laws median are taken separately, and an even count averages the middle two.

| Chamber | Population | Members | Median bills | Median laws |
|---|---|---:|---:|---:|
| Senate | every member with a bill (2 departed included) | 102 | **52** | **0** |
| Senate | serving only | 100 | 52 | 0 |
| House | every member with a bill (departed and the six delegates included) | 447 | **22** | **0** |
| House | serving only | 436 | 22 | 0 |
| House | without the delegates | 441 | 22 | 0 |
| House | serving voting members | 430 | 22 | 0 |

Control: the members' bills sum to 16,677, and no dome bill lacks a `members` row (C1's 16,677). "Serving" and "departed" here take `is_current` from the roster as of Sep 11; every population reads the same medians either way.

## Findings

1. **Colorado has one law in the dome:** Hurd's `119-hr-2316`. That's 1 of 358 bills, 0.28%, against Congress's 0.76% (126 of 16,677).
2. **Against the median member:**
   - Bennet's 72 bills are above the median senator's 52, and Hickenlooper's 35 below it.
   - Five of the eight representatives are at or above the median House member's 22: Neguse 89, Pettersen 42, Crow 28, Hurd 27 and Evans 22. Boebert (20), DeGette (14) and Crank (9) are below.
   - The median member's laws are 0 in both chambers, so Hurd's one law puts him above the median there.
3. **The delegation is as of Sep 11.** `members` was last synced then, by hand. A change in Colorado's delegation since then wouldn't show. HO 810's handoff carries Nov 10 seat counts from the House Press Gallery and senate.gov: 533 seated, which with the six delegates is 539, the roster's current total. That's a total-count match only; a same-count swap wouldn't show.
4. **The dome's 126 holds, and the two probes agree.** Every `bills` and `members` count HO 810 and HO 811 both carry reads the same, 51 minutes apart. No `/api/sync` ran between them; the summarizer did, and moved none of those counts.

## Departures from the handoff's letter, flagged

1. **A sibling script, not a `--colorado` mode** (the handoff allows either). HO 799's and HO 810's scripts stay untouched. The harness is HO 810's, and the dome's predicate and statement are asserted byte-equal to HO 799's before prod is read.
2. **The House label `CO-n`** is this HO's choice; the handoff's template shows a senator only.
3. **The HALTs as coded:**
   - "No usable state field" is tested as "some row reads `CO`". The field's statistics (56 values, none blank, all two letters) print beside it.
   - "8 representatives" is read as the seats: districts 1 to 8, one each, not only eight heads.
   - A code and name that disagree print rather than halt (none did).
4. **The medians:**
   - read as the median of bills and the median of laws, taken separately, per `members.chamber`;
   - the population is every member with a bill in the dome, departed members and the House's six delegates included, as the handoff words it;
   - an even count averages the middle two;
   - controls print beside it. Beside the House median: serving only, without the delegates, and serving voting members. Beside the Senate's: serving only. The run's JSON carries all four for both chambers, and they all read the same here.
5. **Two reads have no Congress clause:** C1's, off HO 799's statement as written, beside a `COUNT` with `congress = 119`; and the `is_ceremonial` values control, over every law-eligible row. Every other `bills` read binds the clause.
6. **Reads beyond the letter:**
   - the completeness check against `bills.sponsor_state`;
   - the calendar placements at `floor` and the furthest stage as the dome reads it;
   - B1's split by the chamber a bill started in;
   - A's bills and laws for the ten serving members, read just before the B and C transaction (ending 10:40:00 AM MST, 17:40:00Z); A asks for counts only for those who left;
   - `is_ceremonial`'s values;
   - the 126's reconciliation;
   - the roster's `fetched_at` and the `cron_runs` freshness;
   - B4's counts grouped by member with their calendar counts.

   None feeds a card number.
7. **A read-only review of the instrument before the record run:** an adversarial workflow, 6 agents, no file or git write, the script not run by it.
   - It raised 15 findings, and 1 was confirmed: the chat block's B3 list lacked titles. That was fixed.
   - Several it refuted as speculative were adopted anyway as cheap hardening: the completeness check, the seats, the calendar reading, the tag control, the medians' labels, and naming those who left in the chat.
   - Its findings are kept in the session's workflow transcripts, not in the repo.
   - This file was then checked read-only against the run's record, the tree and the handoff (4 agents). Every figure matched. The confirmed fixes were scoping (what the summarizer and the Sep 11 roster can and can't move), a missing predicate, the `enacted` step-down wording, and the departures above.
8. **The party probe wasn't rerun,** per the handoff; the readings are 51 minutes apart.
9. **The HO number is 811, not the pointer's next (810).** The handoff takes it from the roadmap pointer (809), but HO 810 was already in flight. `docs/method.md:47`'s rule, the larger of the pointer and the highest HO in commit subjects plus one, gives 811.
10. **No roadmap block and no backlog edit,** as in HO 810. The pointer stays at 809; commit subjects carry 810 and 811, so the same rule gives 812 next.

## The ledger

One run, read-only: **811**, 10:39:50 to 10:40:02 AM MST (17:39:50 to 17:40:02Z), 30 statements (12 single, 18 in one read-only batch), **309,957 `rows_read`**, 32 results carrying the field, the fingerprint `4e94644350e1d992` before and after. The instrument as run is the committed blob (sha256 `fd1bd1e10bf9170ca78d20e82bdabb5ef827331a6397bfa4958b95e23f74de5f`). The run's inputs: `.env`'s `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` by name, and `docs/handoffs/799-artifacts/run-803.json` (repo-ignored), checked against the copied constants before prod is read.
