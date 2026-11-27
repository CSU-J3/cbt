# HO 837: the Louisiana hand route, rehearsed, and the six boxes compared with the store

**Base:** `main` at `2a93f6c`. A read-only comparison: no product file changed, and no store write was made. The backlog's hand-route line (*The six Louisiana boxes could not be compared with Ballotpedia by hand on Nov 4*, HO 798) asked for a hand route that reads a Ballotpedia page on the day, rehearsed once before Louisiana's Dec 12 general. The chat rehearsed it, and this file compares what it read with what CBT holds and renders, and files the route for Dec 12.

**The times, MST (UTC beside), Nov 26, 2026:**

| step | MST | UTC (Nov 27) |
|---|---|---|
| The readings: the chat's six GETs, all 200 | 7:14:52 to 7:14:53 PM | 02:14:52 to 02:14:53 |
| The store's rows, by guarded `SELECT` (HO 834's guard: 27 store requests, 51 statements, 0 refused) | 7:21:20 PM | 02:21:20 |
| Production's six race pages and `/electoral`, plain GETs | 7:23:20 to 7:24:00 PM | 02:23:20 to 02:24:00 |

**What the store had last read:** the jungle boxes of LA-01 to LA-05 at 9:35:16 AM MST Nov 4 (16:35:16Z, the authorized `?state=LA` call, cron row #30558) and LA-06's at 5:00:22 AM MST Nov 22 (12:00:22Z, the scheduled primaries tick #35055); the Dec 12 boxes at 3:22:12 to 3:22:41 PM MST Nov 26 (22:22Z, the general-ballot tick #36163). All six jungle rows read `isSettled` (`lib/primaries-sync.ts:662`), so no later tick rewrites them.

## The route

- **The browser:** the built-in browser of the Claude desktop app on Corey's computer, reached from a chat session linked to it. The Chrome extension is the fallback. A cloud fetch (an empty 202), the box's own agent (CloudFront's wall, *Error from cloudfront*) and the chat's own fetch (a stale copy) all failed on Nov 4 (HO 798).
- **The tab and origin:** a tab open on `https://ballotpedia.org`, so the six GETs are same-origin and carry the browser's own session.
- **How it runs:** the chat pastes `scripts/diagnostic/la-boxes-837.js` into the browser's javascript tool on that tab. It fetches each seat's page (`Louisiana%27s_<N><st|nd|rd|th>_Congressional_District_election,_2026`) one after another, parses it with `DOMParser`, keeps the outermost `.results_table_container` and `.votebox` elements whose text names a 2026 box, and collapses their whitespace. The rehearsal ran the logic the file now carries (the readings' words, below).
- **What it returns:** one object, keyed `LA-01` to `LA-06`, each `{ status, bytes, read, boxes }`: the HTTP status, the page's length, the read's ISO time, and each 2026 box's text, in page order, with the Dec 12 general's box where the page has one. The record holds those texts with their `read` times.
- **Nothing in CI runs it,** and no `tsc` or lint picks it up: `tsconfig.json`'s `include` names only `.ts` and `.tsx` under `scripts/`, `tsconfig.e2e.json` only `e2e/` and `playwright.config.ts`, and the repo has no ESLint config.

## The readings (the chat's `la-readings-2026-11-26.md`, copied in below its title)

**Read by the chat at 7:14:52 to 7:14:53 PM MST Nov 26, 2026 (02:14:52Z Nov 27)** in the Claude desktop app's built-in browser on Corey's computer. The route was same-origin GETs on a ballotpedia.org tab, the logic that `la-boxes-837.js` now carries. All six pages answered **200**. LA-05's page text was also read whole, through the same pane, a few minutes earlier, and it agrees.

This is the route HO 798 couldn't take on Nov 4: a cloud fetch got an empty 202, and the box's own agent hit CloudFront's wall. The table holds each seat's 2026 boxes as Ballotpedia printed them. ✔ is its winner mark.

| Seat | Dec 12 general box | Nov 3 jungle box |
|---|---|---|
| LA-01 | none | **Steve Scalise (R) ✔ 61.7% 157,776, incumbent, won outright**; Lauren Jewett (D) 32.9% 84,055; Randall Arrington (R) 3.8% 9,692; Liddy Glass (Unaffiliated) 1.6% 4,184. Total 255,707 |
| LA-02 | none | **Troy Carter (D) ✔ 70.9% 47,800, incumbent, won outright**; Peter Williams (R) 24.4% 16,471; Lisa Ballay (L) 2.5% 1,686; Renada Collins (Unaffiliated) 1.1% 751; Walter Beach (Unaffiliated) 1.1% 741. Total 67,449 |
| LA-03 | none | **Clay Higgins (R) ✔ 55.0% 129,203**; John Day (D) 20.9% 49,162; Caleb Walker (D) 8.5% 19,932; Priscilla Gonzalez (D) 7.2% 16,828; Kate Cotten (R) 6.7% 15,661; Tia LeBrun (No Party Affiliation) 1.8% 4,208. Total 234,994. The lead sentence reads *the following candidates ran*, not *won outright*, and doesn't name Higgins as the incumbent |
| LA-04 | none | **Mike Johnson (R) ✔ 58.5% 134,739, incumbent, won outright**; Conrad Cable (D) 23.0% 52,893; Matthew Gromlich (D) 14.3% 32,866; Mike Nichols (R) 3.2% 7,270; Gordon Heslop (R) 1.1% 2,571. Total 230,339 |
| LA-05 | **Pat Moore (D), Gabe Firment (R)**, no incumbent, no mark yet | Pat Moore (D) ✔ 17.9% 40,789; Gabe Firment (R) ✔ 17.2% 39,131; Misti Cordell (R) 14.6% 33,366; Michael Echols (R) 14.4% 32,902; Stewart Cathey (R) 12.4% 28,160; Antonio Wilson (D) 12.0% 27,364; Dan McKay (D) 7.0% 16,047; Austin Magee (R) 3.5% 7,920; Oscar Dantzler (R) 1.0% 2,238. Total 227,917. The page lists Julia Letlow as withdrawn |
| LA-06 | **Chauna Banks (D), Blake Miguez (R)**, no incumbent, no mark yet | Chauna Banks (D) ✔ 19.4% 50,879; Blake Miguez (R) ✔ 19.2% 50,213; Rick Edmonds (R) 18.8% 49,241; Lindsay Garcia (D) 12.8% 33,544; Stephen Wagley (R) 10.8% 28,169; Patrick Forbes (D) 9.1% 23,820; Larry Davis (R) 4.3% 11,357; Monique Appeaning (R) 3.1% 8,109; Rufus Craig (L) 1.3% 3,461; Michael Mebruer (R) 1.2% 3,160. Total 261,953 |

Every 2026 box reads *Vote totals may change until results are certified*.

*Code's note:* the readings came as this file; the snippet's own JSON wasn't delivered with them.

## § 1, the comparison: six MATCH

Each field of the readings against the store or against Production's race page, counted apart from the checks of one source alone (HO 837's comparator, kept with the handoff's artifacts). Its four controls fire: Scalise's 61.7% made 61.8% in a copy of the readings reads LA-01 DIFFERS, and Moore's ✔ removed reads LA-05 DIFFERS, the other five unchanged in each; a candidate joined to the one before with a comma is refused by the parse; and an extra roster row planted in LA-05's page reads LA-05 DIFFERS.

| Seat | Verdict | Fields + checks | The store's jungle read | The store's Dec 12 read | Production (7:23 PM MST) |
|---|---|---|---|---|---|
| LA-01 | **MATCH** | 25 + 2 | 9:35 AM MST Nov 4 | 3:22:12 PM MST Nov 26, `no_box` | *Decided · Nov 3, 2026*; Scalise *re-elected*; *Called by Ballotpedia · read Nov 4, 2026, 9:35 AM MT* |
| LA-02 | **MATCH** | 29 + 2 | 9:35 AM MST Nov 4 | 3:22:18 PM, `no_box` | *Decided · Nov 3, 2026*; Carter *re-elected*; *Called by Ballotpedia* |
| LA-03 | **MATCH** | 32 + 2 | 9:35 AM MST Nov 4 | 3:22:24 PM, `no_box` | *Decided · Nov 3, 2026*; Higgins *re-elected*; *Called by Ballotpedia* |
| LA-04 | **MATCH** | 29 + 2 | 9:35 AM MST Nov 4 | 3:22:30 PM, `no_box` | *Decided · Nov 3, 2026*; Johnson *re-elected*; *Called by Ballotpedia* |
| LA-05 | **MATCH** | 47 + 4 | 9:35 AM MST Nov 4 | 3:22:36 PM, `box`, 2 rows, 0 marked | *Runoff Dec 12*; Firment and Moore *Advanced*; Letlow *ELECTED TO THE SENATE*; *No call on Ballotpedia · read Nov 4, 2026, 9:35 AM MT* |
| LA-06 | **MATCH** | 51 + 4 | 5:00 AM MST Nov 22 | 3:22:41 PM, `box`, 2 rows, 0 marked | *Runoff Dec 12*; Miguez and Banks *Advanced*; Fields *NOT ON THE BALLOT*; *No call on Ballotpedia · read Nov 22, 2026, 5:00 AM MT* |

213 fields compared across sources, and 16 checks of one source.

**The fields, per seat:**
- **The Nov 3 jungle box,** against `primaries` and `primary_candidates` (`house-LA-0N-2026-open`):
  - the candidate set: the same people, the same count;
  - per candidate: the name (exact; no spelling differs), the party (Ballotpedia's word through the reader's `partyLetter`, `lib/primary-candidates-scrape.ts:171`: *Unaffiliated* and *No Party Affiliation* are `I`), the percent (the stored share rounded to the page's one decimal), and the ✔ against `status = 'winner'`;
  - **the votes:** the store keeps no vote count. Its share is Ballotpedia's own bar width at full precision (`:221-237`), so each candidate's votes over the readings' total, ×100, was compared with it: **equal to the last digit for 38 of the 39 candidates, and Mike Johnson's within 7.1e-15**, a floating-point difference. So none of the six jungle boxes has changed since the store read it, on Nov 4 or Nov 22;
  - the incumbent the readings name equals the stored `incumbent` flag (five seats; LA-03's below), and the seat is `isSettled` with its box carrying a mark.
- **The Dec 12 box:** LA-01 to LA-04: `general_ballot_reads.status` `no_box` and no row, as the readings' *none*. LA-05 and LA-06: `box` with 2 rows in `general_ballot` (`box_prefix` *General election*), the same names and parties, `marked` 0 on every row and in the read, and `incumbent_marked` 0.
- **Production:** the header, the winner (the incumbent card's *re-elected*) or the advancers (the *Advanced* rows), the roster's count (*Candidates ( N )* and its rows), on a decided seat the roster's names and parties, and the provenance. The race page prints no percents for anyone, so there are none to compare. None of the six seats, nor any of their candidates, is on `/electoral`; Louisiana appears there only in the map and in the primary calendar's dates.
- **The checks of one source:** the readings' total equals their votes' sum; the readings' Dec 12 rows are their jungle's two ✔; the store's Dec 12 rows are printed and not withdrawn; `general_runoff` holds no row for any of the six.

**LA-03's lead sentence:** it names no incumbent, and neither the store nor the page reads it. The store's `incumbent` flag comes from the row's underline (`/<u>/`, `lib/primary-candidates-scrape.ts:248`), the seat's incumbent from `races.incumbent_bioguide_id` (`H001077`), and a bare grep of `lib/`, `app/`, `components/` and `scripts/` for *won election outright* and *following candidates ran* finds nothing. The ✔ and the 55.0% settle it, and both match.

**Recorded, not compared:**
- LA-02's incumbent card prints *Troy A. Carter* (the members row), and the box *Troy Carter*: the same person (`C001125`).
- The word on LA-05's and LA-06's incumbents (*ELECTED TO THE SENATE* for Julia Letlow, *NOT ON THE BALLOT* for Cleo Fields) is about people neither of the seat's boxes prints as candidates. The readings list Letlow as withdrawn on LA-05's page. The backlog's line *A Louisiana seat with no `box` read gives its off-ballot incumbent HO 758's word* (HO 798) holds the word's rule.
- On LA-01 to LA-04 the jungle's other candidates read *On ballot* under *On the ballot*, after the seat was decided outright.

## The Dec 12 runbook

- **When:** polls close at 8 PM CST (7 PM MST) on Saturday Dec 12. On Nov 4 CBT's ballot tick first read LA-05's Dec 12 box, its two advancers printed, at 1:24 AM MST (HO 798), so Ballotpedia had called that jungle overnight. **The first read is the next morning (Sunday Dec 13), and a second that evening.**
- **The read:** the chat opens a ballotpedia.org tab in the Claude desktop app's built-in browser and runs `scripts/diagnostic/la-boxes-837.js` there, as above, and pastes its JSON, with each seat's `read` time, into the record. The Chrome extension is the fallback.
- **The comparison (Code), as § 1 did, for LA-05 and LA-06:**
  - each Dec 12 box's ✔ against `general_ballot.marked`, with `general_ballot_reads.status`, `rows` and `marked`, and `general_runoff` still empty;
  - each race page: once the box carries one mark, the page reads the box, not the jungle (`lib/race-result.ts:118-119`), and its header names the runoff's day (*Decided · Dec 12, 2026*, HO 780);
  - **the percents are recorded from the page, not compared.** The store keeps no share for a general box (`general_ballot`'s columns, `scripts/migrate.ts:1264`), and the race page prints none;
  - LA-01 to LA-04: their boxes stay as § 1 read them (no Dec 12 box, the jungle settled).
- **The store's read can trail the page.** `/api/cron/general-ballot` reads 40 races a tick (`20 */2 * * *`), one pass of the 470 a day, so the store reads each Louisiana seat about once a day (on Nov 26 at about 3:22 PM MST). Before comparing, Code checks that each seat's `general_ballot_reads.read_at` follows the page's mark. If it doesn't, the comparison waits for the tick that reaches the seat, unless the chat authorizes a call.
- **What to watch:** a box with one mark is a settled two-candidate general, so the check is that the store's winner equals Ballotpedia's ✔. The partial-mark risk the hand-route line named (one advancer marked before the second; HO 798, now in the archive) is a jungle's. A two-candidate general marks one winner, so it doesn't arise on Dec 12.
