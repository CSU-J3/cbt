# HO 747 — what is on the November ballot: general-box census findings

> **Diagnostic-only probe, not wired.** Base `main` at `0122971`. Run 2026-09-25: Ballotpedia requests **18:58:49Z → 20:35:47Z**, final classification **21:00:28Z**. Request budget: **510 requests to Ballotpedia, 0 transport errors, 0 404s, 151.4 MB** (STEP 0 1 · controls rehearsal 8 · pass 1 113 · pass 2 388; row 1). Prod was read with `SELECT` only, and the controls wrote only to `file:` copies. **The census ran in two passes, and pass 2 is a deviation from the handoff's stop rule, made on the architect's ruling** (D1). Distilled from `docs/handoffs/747-artifacts/` (repo-ignored, local: every page gzipped, `requests.log`, per-race JSON and CSV, each control run). The instrument is `scripts/diagnostic/general-box-census-747.ts`. No recommendation.

Base `main` at `0122971` (`git ls-remote`: `main` only, no other heads), 2026-09-25. Diagnostic only: **no product code, no schema, no sync, nothing written to the database**, and nothing POSTed to a cron route. Every Ballotpedia page the census read is saved; the tables below were classified from those saved bytes against one snapshot of prod, and the snapshot read identical at pass 1 (19:16Z), pass 2 (19:57Z) and the final classification (21:00Z). `cron_runs` for `/api/cron/race-challengers` (`#20020`, 2026-09-25T12:30:25Z) and `/api/cron/primaries` (`#20013`, 12:00:23Z) were unchanged from before pass 1's snapshot to after pass 2's last fetch, so the reading follows those two rows and there is one reading, not two. The general box is read **before the election**, when it lists the ballot; nothing here says what it will say after the polls close.

## STEP 0 anchors, re-derived at `0122971`

| handoff anchor | at `0122971` |
|---|---|
| `lib/primary-candidates-scrape.ts` builders `:106` `:110` `:127`, `USER_AGENT` `:42` | holds (`USER_AGENT` spans `:42-43`) |
| `lib/primaries-sync.ts:905`, `:1255` (slug), `:1257` (pace) | holds; a third slug site at `:641`, not cited |
| `parseCandidatesPage` `:285`, `:300-301`, `:303`, `:338-339`, `:361` | holds |
| `parseVotebox` `:161`, `:173`, `:211`, `:212` | holds; the link regex is `:173-175` and the name `:176` |
| `scrapeHouseCandidates` `:506`, `:510`, `:514-518`, `:495-496`, `:556` | holds |
| `scrapeSenateCandidates` `:414`, special URL on a non-ok response | holds; an **aborted** fetch does not fall back (`:426-428`) |
| `ak-general-box-741.ts` `:25`, `:37-41`, `:59-79`, `:62`, `:110` | holds |
| `lib/harvest-challengers.ts` `:54`, `:76-88`, `:158-167` | holds |
| `vercel.json:82-83`, `30 12 * * *` | holds; `/api/cron/primaries` is `0 0,12 * * *` at `:78-79` |
| `scripts/migrate.ts` `:140`, `:158`, `:454`, `:466`, `:590`, `:1634` | holds; `race_candidates.updated_at` is added at `:1798`; no person URL in `race_candidates`, `primaries` or `primary_candidates` |
| `lib/race-id.ts:43`, at-large is `district = 0` | holds for `races`; `districtToken` maps NULL and 0 to `AL`, and `members` stores at-large as NULL |
| `scripts/sync-crosswalk.ts:121` | holds (from `legislators-current.yaml` only, `:56`) |
| `lib/queries.ts:1910` `getRaceCandidates` | holds; its SQL is `:1914-1934`, and the probe runs it with its nine `--` comment lines (`:1919-1927`) dropped |
| ~470 `races` rows (estimate) | **470**: 435 House, 35 Senate. S-FL and S-OH are the two specials, keyed as plain `S-XX-2026` |
| 60 `top_two` rows / 52 races and 5 `top_four` / 2 publish `advanced`, 218 `won_primary` (HO 741 estimates) | sentinel `advanced` **62 rows / 53 races**, sentinel `won_primary` **463 / 357**, curated **15 rows / 5 races** (AK-AL, NJ-07, PA-10, S-GA, S-ME): **540** rows, none on a non-2026 race, no race mixing the two |
| the falsification set (11 rated CA races at HO 741) | **6**: CA-06, CA-13, CA-21, CA-22, CA-45, CA-48, read after S-AK-2026 and AK-AL-2026 |
| stored incumbents with / without `ballotpedia_title` | House **420 / 13** (2 of the 13 have no `member_ids` row), and 2 races with no stored incumbent (FL-20, TX-23); Senate **34 / 1** |
| `incumbent_running` | never `1` in prod: House NULL 410 / `0` 25, Senate NULL 25 / `0` 10 (`migrate.ts` reserves `1`) |
| pointer | roadmap 746, highest HO in commit subjects 746 → **747** |
| OPEN LOOPS reconcile | 253 live / 297 struck / 550, control `^- \*\*~~` 0 (whole-file counts, as HO 745/746 read them; the section alone is 50 / 70 / 120) |

**The selector check (STEP 0 item 4), on one saved copy of `AK-AL-2026`:** this HO's selector reads two boxes in the section, *General election for U.S. House Alaska At-large District* (`nonpartisan`, 4 rows, 0 marked, a withdrawn block naming John Brendan Williams) and *Nonpartisan primary for …* (`nonpartisan`, 15 rows, 4 marked, a withdrawn block naming Gerald Heikes), and four general boxes outside the section (three historical *General election*, one *Special general election*, all marked). The 741 selector, run over the same bytes, splits thirteen `votebox` divs from the anchor to the end of the page and picks one box as `is2026General`: the same `<h5>` and the same four people (Begich, Hafner, McDermott, Hill). The two agree and the box is inside the section, so there was no halt. The 741 reading also shows the hazard it was retired for: its primary box counts **5** winners where the box marks **4**, because its slice runs past the box into the rest of the page.

## Ground truth the probe corrected (flagged, not absorbed)

1. **The falsification set's California part is six races, not eleven.** The handoff's query, run at STEP 0, returns CA-06, CA-13, CA-21, CA-22, CA-45 and CA-48; with S-AK-2026 and AK-AL-2026 the set is eight.
2. **HO 736's "AK Senate incumbent twice, under two spellings" is two people.** S-AK-2026's general box lists *Daniel S. Sullivan* (`Daniel_S._Sullivan_(United_States_Senator_from_Alaska)`, underlined) and *Dan Sullivan* (`Dan_Sullivan_(Alaska_U.S._Senate_candidate)`), and both are marked advancers in the top-four box. `primary_candidates` gives both the senator's `S001198` (the second at `incumbent = 0`, 2.5%), because the Senate matcher takes a sitting senator whose name contains the candidate's surname (`buildSenateMatcher`, `lib/primaries-sync.ts:516-523`). The harvest's bioguide exclusion then drops a real advancer (rows 3 and 4, and *Found outside the lines*).
3. **The kalshi ruling's quoted clause is half true at the tree.** *"SKILL:1879 and the HO 219 helper comment already describe the null"*: `SKILL.md:1879` states the null on the read side only (*"null-safe per chamber → cell shows `—`"*); the write-side null is in the helper's comments at `lib/kalshi.ts:177-180` and `:206-208`, which came in with HO 219's `976478a` without the tag. The conclusion, that the route comment is the lone outlier, holds. The annotation lands verbatim with a dated note beside it (D11).
4. **The election-night line's *"No product code reads a 2026 result"* is false for Louisiana.** Ballotpedia files all six Louisiana House races as a *Nonpartisan primary* dated November 3 (the section's `<h4>` says *General election*, the box's `<h5>` says *Nonpartisan primary election*, and none of the six carries a 2026 general box; LA-02 and LA-05 carry historical ones under District history), `parseCandidatesPage` keeps that box, and `HOUSE_PRIMARY_OVERRIDES` dates it 2026-11-03 (`lib/primaries-sync.ts:195`), so `/api/cron/primaries` will read those results after the polls close. The line lands with its first sentence amended (D12).
5. **The rest of both verbatim texts holds**: `RaceHeader.tsx:32-38` (strictly `< 0`, so it reads *Election today* through the UTC day of 2026-11-03 and *Election concluded* from 2026-11-04T00:00Z), `lib/format.ts:139`, `Battlefield.tsx:19-21` (the band sits in the RACES tab, which is not the default tab), `RacesHeroBand.tsx:60`, the HO 744 headers line covering `app/api/cron/kalshi/route.ts`, the kalshi line's close (1), and `scripts/backfill-2024-margin.ts` as the only general-box reader outside `scripts/diagnostic/`. 2026-11-03 is a Tuesday (`date -u -d 2026-11-03 +%A`).

## Deviations (named)

- **D1 · pass 2, the ruled completion.** Pass 1 ran on the handoff's rules and stopped on its stop rule at FL-05-2026 (row 1). The architect ruled a second pass, verbatim, in the HO 747 Code session on 2026-09-25, answering the stop question: *"option 1, amended as below. Pass 1 stands exactly as it stopped. … Pass 2 is a deviation from the handoff's stop rule. Name it in the findings header and the roadmap block, with this ruling as its authority."* Its terms, which pass 2 followed: cool down at least 15 minutes, then refetch `AK-AL-2026` as the only refetch and control; *"One request every 6 seconds, fixed. Never faster."*; *"No quick retries. A 202 marks the page UNREAD for now and moves it to the back of the queue, where it gets one more try at the end of the pass."*; five UNREAD in a row pauses the pass 15 minutes, once, and the next UNREAD stops it; the order is the five seats' and the falsification set's unread pages, then the `DISPLAY_STALE_STATES` states plus TN, then the rest; no page pass 1 read is refetched; and the wall's shape is recorded. The pass-2 queue logic was fired on stub responses before any request (*Controls*). The ruling's own line on a second stop (report and wait for a ruling) was not needed: pass 2 ran to the end.
- **D2 · pass 1's pause read as once per run.** *"pause 60s once"* was implemented as one pause for the whole run, so a second streak of five after the pause stopped it. That reading is what stopped pass 1 at FL-05 rather than pausing again.
- **D3 · UNREAD's causes, widened.** The handoff names a 2xx without the anchor after three attempts, or a timeout. A non-404 non-2xx after three attempts, or a fetch that throws three times, also reads UNREAD, with the cause named (`http-N`, `network`); a timeout is not retried, as `scrapeHouseCandidates` does not retry one (`:536-547`). None fired: every UNREAD was `no-anchor-202`.
- **D4 · the 8s cap covers the body.** The scraper's cap ends when the headers arrive; the probe's ends when the body does, so a hung body cannot hang the census.
- **D5 · two name routes, widened after reading.** The stored incumbent's name route (surname and first initial) accepts the initial from `first_name`, from the first word of `members.name`, or from a nickname `members.name` quotes (AR-01's `Eric A. "Rick" Crawford` is *Rick Crawford* on his ballot). Two or more name hits resolve to the single underlined one (`name+underline`, used once, at S-AK-2026) or to none. Published rows gain a third route after href and normalized name, **surname and first initial, taken only when exactly one ballot row passes**; it matched exactly two pairs, CA-10's *Jeffrey Frese* (*Jeff Frese* in both of today's boxes) and S-ME's curated *Troy Jackson* (*Troy Dale Jackson*), and every pair carries its route.
- **D6 · rows 3, 4 and 6 carry decompositions the handoff did not list**: where the page puts each divergent person (runoff box, convention box, dropped primary, withdrawn block), the ballot row's party and write-in marker, namesakes and name splits, and an own-ballot residue check for `on-no-ballot`. The handoff's classes are unchanged; `agree` gains two sub-classes, `withdrew-and-off-ballot` (a published `withdrew` row not on the ballot) and `is-the-stored-incumbent`.
- **D7 · a page with two or more general boxes** would be compared against the one whose prefix is exactly *General election*, else read `ambiguous-general` and not compared. No page carried two.
- **D8 · the controls' forced consequences.** C3's *"nothing else moves"* cannot hold for `agree`, because the deleted row agreed: `agree −1` is asserted as the forced consequence. C4's first race also gains `on-ballot-not-published +1`, because its real incumbent is no longer removed from its ballot; reported, not asserted against.
- **D9 · the tables come from a re-classification of the saved pages.** Pass 2's own in-process report classified with the code as it stood at 19:57Z. Several changes came after it: D5's nickname and third route; row 3's placement, party and write-in breakdowns; row 6's own-ballot residue check; the `is-the-stored-incumbent` sub-class; D14's printed party; and, for row 7, an article-only sentence reader that also decodes numeric entities (the first quoted the site navigation's *Redistricting* menu item as a sentence, and printed `&#10004;` for ✔). Row 4's namesake and name-split lines and the `withdrew-and-off-ballot` sub-class were already in pass 1's and pass 2's reports. The final code re-fired C1–C4 on the union's saved pages (18 of 18 held), then classified them against a fresh snapshot, identical to pass 1's (`--controls`, `--reclassify`, no network, 21:00Z). Before that, an adversarial check of this file against the artifacts (six readers, a refuter on each claimed error) confirmed 15 errors in the first draft, and each is corrected here.
- **D10 · a rehearsal preceded pass 1.** `--only-fset` fetched the falsification set (8 requests, 19:13Z) and ran the controls, three minutes before pass 1. Those 8 requests are counted in the wall's context (row 1).
- **D11 · the kalshi annotation** lands verbatim, followed by a dated STEP 0 note on the quoted clause (correction 3).
- **D12 · the election-night line** lands with its first sentence amended for Louisiana, and a parenthetical in *Reads if never done* for the same six races (correction 4). The rest is verbatim.
- **D13 · STEP 0 did not halt**, per the handoff's STEP 0 item 5 (*"proceed without a halt. The probe is read-only and its scope is fixed"*), rather than `docs/method.md`'s enumerate-first HALT.
- **D14 · the party the ballot prints, beside the ingest's letter.** The ingest's letter (`openContestParty`) reads a New York or Oregon fusion line, *"(D / Working Families Party)"* beside a bare thumbnail wrapper, as `I`. Row 5 reports both, and row 3's party split uses the printed party (a fusion line's first party). 43 rows differ, all of them fusion lines. Added after the adversarial check caught it.

---

## Controls, seen red before the prod reading

Each was read unperturbed, then perturbed; the delta is the reading. **C1–C4 held three times**, 18 checks of 18 each time: in the rehearsal, in pass 1 (before its census went past the falsification set), and on the final code against the union's saved pages (`controls-2026-09-25T21-00-24-465Z.txt`). **The three pass-2 stub controls ran once**, at the start of pass 2 and before its first request, and held there.

| control | unperturbed | perturbed | expected, and read |
|---|---|---|---|
| C1a, `AK-AL-2026`'s saved page, general box deleted (4,643 bytes) | `compared`, 1 general box, 4 outside the section | `no-general-box`, 0, 4 | `no-general-box`, outside count unchanged and > 0 ✓ |
| C1b, the box's `<h5>` renamed | `compared` | `no-general-box`; the markup census lists *Qwerty contest* as unrecognized | ✓ |
| C2, a stub 202 without the anchor (House) | — | `UNREAD` (`no-anchor-202`) after 3 attempts | `UNREAD`, not `no-general-box` ✓ |
| C2, a stub 404 (House) | — | `NO_PAGE` after 1 attempt | ✓ |
| C2, a stub 404, then 404 on the special URL (Senate) | — | `NO_PAGE`, fallback taken, 2 attempts | ✓ |
| C3, on a `file:` copy: delete AK-AL-2026's *Bill Hill* (`advanced`, on the ballot), insert *ZZ Control Candidate* `won_primary` with the sentinel | `agree` 4 | `agree` 3, `published-not-on-ballot/absent` +1, `on-ballot-not-published/marked-in-primary` +1 | +1 / +1 on that race, nothing on any other falsification-set race, no incumbent bucket moved ✓ (D8) |
| C4, on a second copy: point CA-13's incumbent at CA-21's (Adam Gray, Jim Costa, both `on-own-ballot`) | CA-13 `on-own-ballot` | CA-13 `on-other-ballot → CA-21-2026`, its own *Adam Gray* now `underlined-not-stored-incumbent`; CA-21 unmoved | ✓ (D8) |
| pass-2 queue, stubs: `[202, 200]`, `[404]`, `[202, 202]` | — | `01 UNREAD · 02 NO_PAGE · 03 UNREAD · 01 retry READ · 03 retry UNREAD`, 5 requests | deferred to the back, one more try, no quick retries ✓ |
| pass-2 stop, stubs: seven 202s | — | one 15-minute pause, stopped at the sixth, the seventh never fetched | ✓ |
| pass-2 once per pass: five 202s, a read, five 202s | — | one pause, the read clears the streak, the second streak stops the pass | ✓ |

The copies' URLs were built as `file:${abs}` from paths that must end in `-747-control.db`, every write went through a function that refuses any other scheme and prints `file:`, and the seed read prod with `SELECT` only (races 470, `race_candidates` 540, `race_ratings` 262, `members` 468, `member_ids` 466).

## 1. Read census

| | window (UTC) | attempted | READ | UNREAD | NO_PAGE | requests | retries | bytes | stop |
|---|---|---|---|---|---|---|---|---|---|
| **pass 1** (the handoff's rules: 1s between requests, 3 attempts 2.5s apart) | 19:16:26 → 19:20:24 | 93 | 83 | **10**, all `no-anchor-202` | 0 | 113 | 20 | 25.9 MB | 60s pause used; **stopped at FL-05-2026** |
| **pass 2** (ruled: 6s start to start, 1 attempt, requeue once) | 19:57:00 → 20:35:47 | 387 | **387** | 0 | 0 | 388 (1 is the control) | 0 | 122.0 MB | pause not used; ran to the end |
| **union** | | **470 of 470** | **470** (83 from pass 1, 387 from pass 2) | 0 | 0 | | | | |

- **Pass 1's ten UNREAD** were CA-17, CA-18, CA-19, CA-20, CA-23 and FL-01 through FL-05. None became `no-general-box`; pass 2 read all ten.
- **The wall.** It is Ballotpedia's JavaScript challenge (*"we need to verify that you're not a robot"*), served as a 2,023-byte 202, and a retry 2.5s later got the same 202 in about 10ms. In pass 1 it **began at request #43** (CA-17-2026, 19:17:25.177Z): 15 refused requests, then a page read at 19:18:56.022Z (CA-24-2026), **91s after it began**, the 60s pause included. It **began again at request #99** (FL-01-2026, 19:19:55.248Z), **41 requests after it cleared**, and was not read again in the pass. This box had sent 8 requests in the 10 minutes before pass 1 (the rehearsal) and 1 at STEP 0 (18:58:49Z). So at 1s from this box the wall arrives after about 40 to 50 requests. At 6s it did not arrive at all: 388 requests in 38m46s, every one a 200, minimum start-to-start gap **6.00s**, median 6.01s.
- **The control** (`AK-AL-2026`, 19:57:00Z) read the same four names as pass 1's copy: Begich, Hafner, McDermott, Hill.
- Senate fallbacks used: **0**. Special-election pages by `<title>`: **S-FL-2026, S-OH-2026**, both served at the regular URL. Transport errors, timeouts and 404s: **0**.

## 2. Markup census (470 READ pages)

In-section boxes: **1,355**. General **463**, kept primary **752**, runoff **33**, dropped primary **32** (third parties' primaries, which the ingest does not read), unrecognized **75**.

| `<h5>` prefix | class modifier | kind | boxes |
|---|---|---|---|
| General election | `nonpartisan` | general | 451 |
| General election | (bare) | general | 10 |
| Special general election | `nonpartisan` | general | 2 |
| Democratic primary · Republican primary | `democratic` · `republican` | kept | 345 · 330 |
| Nonpartisan primary | `nonpartisan` | kept | 66 |
| Nonpartisan primary election | (bare) | kept | 6 (Louisiana) |
| Special Republican primary · Special Democratic primary | party | kept | 3 · 2 |
| Democratic · Republican · Special Republican primary runoff | party | runoff | 17 · 15 · 1 |
| Libertarian, Green, Libertarian Party, Legal Marijuana Now Party, No Labels Party, Working Class Party, Special Libertarian primary | various | dropped | 20, 4, 2, 2, 2, 1, 1 |

- **Unrecognized prefixes, all conventions**: Libertarian 25, Green 19, Working Class Party 8, U.S. Taxpayers Party 7, Democratic 5, Republican 4, Alliance Party 2, and one each of Constitution, Forward Party, Independent American Party of Utah, Libertarian Party and Utah Forward Party.
- **Pages by 2026 general boxes**: 1 on **463**, 0 on **7**, 2+ on none. The seven: **LA-01 to LA-06**, whose only 2026 box is the Nov-3 *Nonpartisan primary election*, and **FL-10**, whose section reads *"The general election was canceled. Maxwell Alejandro Frost (D) won without appearing on the ballot."*
- **A page-wide selector would take extra boxes on 465 of 470 pages** (1,420 historical and special general boxes outside the section). **Seven of them carry no marked row, on three pages (CA-40 ×1, ME-01 ×3, ME-02 ×3)**, and the 741 selector's `winners === 0` predicate accepts all seven today, before any 2026 box marks a winner. Its `find` already returns a historical box on ME-01 and ME-02. There, its slice of the 2026 box runs on through Maine's ranked-choice primary markup and counts three `winner` matches in inline CSS, so it rejects the 2026 box. On CA-40 it returns the 2026 box only because that box comes first. (Run with the 741 code's own slicing over all 470 saved pages, by the adversarial check in D9.)
- **Party-token routes**, general-box rows: wrapper **1,134**, neither **146**, `(X)` suffix **61**.
- **Write-in markers**: **82** general-box rows carry one (`(Write-in)`, with and without a trailing `&#160;`), and none of the 82 is published.
- General-box rows with no person link: **0**. **Withdrawn blocks** after a general box: **181** boxes, **289** names, all headed *Withdrawn or disqualified candidates*.
- **Marked rows in any 2026 general box: 0**, as expected before the election.
- The kept-primary rows equal `parseCandidatesPage`'s own output, keyed as it dedups, on **all 470** pages, so every href route through the primary box starts from the ingest's own box.

## 3. Divergence

463 races compared; the 7 with no general box are not compared (and carry no published rows). Candidates:

| class | sub-class | n |
|---|---|---|
| **agree** | | **500** |
| | of which a published `withdrew` row off the ballot | 7 |
| | of which the published row **is the stored incumbent** | 2 |
| **published-not-on-ballot** | absent | **36** |
| | withdrawn-listed | **4** |
| **on-ballot-not-published** | in-no-primary-box | **469** |
| | marked-in-primary | **8** |
| | unmarked-in-primary | **6** |
| **withdrew-but-on-ballot** | | **0** |

**Races with any non-agree candidate: 269 of 463.**

By roster source: `agree` harvested 486 / curated 14; `published-not-on-ballot` harvested 39 / curated 1; `on-ballot-not-published` on harvested races 392, on curated 10, on races with no roster **81**. By published status: `agree` is `won_primary` 426, `advanced` 63, `withdrew` 7, `nominee` 1, `running` 1, and 2 at `is-the-stored-incumbent` (1 `won_primary`, 1 `advanced`); `published-not-on-ballot` is `won_primary` 38, `advanced` 1, `running` 1.

**Where the page puts the 40 published people who are not on the ballot:**

| | n | races |
|---|---|---|
| marked in a D or R primary box that marks two or more, **then unmarked in the runoff box** | **32** | TX 17, Senate 7, GA 4, SC 3, AL 1 |
| marked in a D or R primary box that marks two or more, **and no 2026 runoff was held** | **4** | TX-23 Tony Gonzales, TX-32 Ryan Binkley, OK-01 Jackson Lahmeyer (each section: *"The Republican primary runoff election was canceled"*, the published person listed withdrawn from it); AL-01 Rhett Marques (*"the primaries originally scheduled for May 19, 2026 … results were voided"*, and the `primaries` row the harvest reads is the voided May 19 one) |
| **withdrawn and listed** under the general box | **4** | S-AK David Leslie (`advanced`), S-ID David Roth, S-NE Cindy Burbank, S-SC **Lindsey Graham** (`won_primary`) |

So **36 of the 40 are first-round runoff advancers**, 35 published by the harvest as `won_primary` and one as a curated `running` row (S-GA's Derek Dooley). Ballotpedia ticks both runoff advancers in the first-round box, the ingest keeps that box and never reads the runoff box beside it (`lib/primary-candidates-scrape.ts:361`), so `primary_candidates` carries both as `winner`, and the harvest publishes both. `primaries` holds 3 runoff rows in all (S-LA's two and S-GA's one), their candidates all at `running`, so no runoff row supplies a `winner`. Among them are two of the five seats' incumbents: **Al Green is published on TX-18 and Julie Johnson on TX-33**, each as `won_primary`, each a first-round advancer who lost that runoff.

**The 483 ballot rows we do not publish**, by the party the ballot prints (D14): neither D nor R **409** (independent, unaffiliated or a minor party 287, 69 of them write-ins; Libertarian 90; Green 32), Republican 43 (7 write-ins), Democratic 31 (6 write-ins). Of the 469 in no primary box, 96 appear in another box on the page: 67 in a party's convention box and 29 in a third party's own primary, which the ingest drops. The other 373 appear in no other box (77 of them write-ins). **Fifty-four D or R ballot rows are in no primary box and are not write-ins.** Five are Utah convention nominees (UT-01 Riley Owen, UT-02 Peter Crosby, UT-03 Kent Udell, UT-04 Mike Kennedy and Jonny Larsen). One is NC-11's Jennifer Balkcom, whose party's primary Chuck Edwards won; Edwards is on no ballot and she replaced him, which is the HO 741 class. The other 48 have no 2026 primary box for their party on the page (an unopposed or canceled primary): AL 2, AR 2, CT 3, FL 6, KY 2, ME 3, NC 3, **NY 17** (16 Republicans and one Democrat, 14 of the 17 on a fusion line), OK 1, SC 3, SD 1, VA 5.

**Marked in a primary and unpublished (8):** S-AK *Dan Sullivan* (correction 2); IL-04 *Patty Garcia*, who carries the retiring incumbent's `G000586` and is excluded as him; FL-20 *Debbie Wasserman Schultz*, excluded because FL-20 has no stored incumbent and `W000797 <> NULL` is NULL; DE-AL *Joseph Arminio* and S-DE *Michael Katz*, whose races carry no roster; HI-01 *Nathan Berning* and HI-02 *Edward Codelia* (Hawaii's nonpartisan primary); and WA-09 *D. Adam Smith*, the stored incumbent himself (row 6). **Unmarked in a primary and on the ballot (6):** S-AK *Gerald Heikes*, the replacement for the withdrawn Leslie (McDermott's shape at HO 741), and five who were unmarked in a party primary and are on the general ballot outside a party, four of them as write-ins (DE-AL, NY-15, S-DE, S-WV, TX-27). **The published row is the stored incumbent (2):** CA-14 *Aisha Wahab* and S-SC *Darline Graham*, whose own `primary_candidates` rows carry no bioguide.

Every non-agree candidate is in `candidates-reclassify-2026-09-25T21-00-28-042Z.csv` (523 of its 1,023 rows, `cls != agree`), with its route, the boxes it appears in, its printed party and its write-in marker.

## 4. Identity

- **Same href, different anchor text** between a general box and a kept primary box on one page: **0 pairs**.
- One normalized name under two or more hrefs on a page: **0**. **Namesakes of the stored incumbent** (rows passing its name route under 2+ hrefs): **1 page, S-AK-2026**, the two Sullivans (correction 2). The handoff expected table 4 might explain HO 736's duplicate, and this is that reading.
- **Match route for every published row on a compared race**: href **491**, normalized name **0**, surname-and-initial **2** (D5), unmatched **47** (the 40 above and the 7 `withdrew` rows).
- Of the 463 compared races, the stored incumbent was taken off its own ballot by identity at **325**, by name at **41** and by name+underline at **1**. It was on no row of its own ballot at **94**, and the other **2** (FL-20, TX-23) store no incumbent.

## 5. Ballot size

463 general boxes, **1,341** candidates: **min 1, median 2, max 10**. By size: 2 on 236, 3 on 119, 4 on 56, 5 on 28, 6 on 8, 7 on 5, 8 on 4, 10 on 2, 9 on 1, and **1 on 4** (MA-02, MA-05, MA-07, WI-02, each the incumbent alone). **Neither D nor R, by the party the ballot prints: 412 of 1,341 (30.7%)**, in 225 of the 463 boxes; by letter D 473, R 456, `I` 289, L 91, G 32. By the ingest's letter the same count is 455 (33.9%, in 247 boxes), because the letter reads a fusion line as `I`. The **43** rows where the two differ are all fusion lines: *R / Conservative Party* 21, *D / Working Families Party* 16, *D / Independent Party of Oregon* 2, *R / L* 2, and one each of *R / Queens United Party* and *R / Taxpayer Rights Party*. Every general-box row prints a party. Against those 1,341 ballot rows, incumbents included, the compared races publish **533** non-`withdrew` rows.

## 6. Incumbents

`ballotpedia_title`: House 420 of 433 stored incumbents (13 without: 11 with an empty title, 2 with no `member_ids` row); Senate 34 of 35. Races with no stored incumbent: FL-20, TX-23.

| bucket | House | Senate |
|---|---|---|
| on-own-ballot | **307** | **18** |
| title-mismatch (identity fails, the name route passes) | 31 | 3 |
| on-other-ballot | **15** | 0 |
| no-title | 13 | 1 |
| on-no-ballot, `incumbent_running` NULL | 47 | 3 |
| on-no-ballot, `incumbent_running` 0 | 20 | 10 |
| on-no-ballot, `incumbent_running` 1 | 0 | 0 |

- **`on-other-ballot`, the House 15**: moved to another House district in the same state, **CA** Kiley CA-03→CA-06, Bera CA-06→CA-03, Sánchez CA-38→CA-41, Calvert CA-41→CA-40; **FL** Frankel FL-22→FL-23, Moskowitz FL-23→FL-25, Wasserman Schultz FL-25→FL-20; **UT** Maloy UT-02→UT-03. Running for the Senate: GA-10 Collins, IA-02 Hinson, KY-06 Barr, LA-05 Letlow, NH-01 Pappas, OK-01 Hern, WY-AL Hageman. Four more are found on another ballot by the name route alone and sit in their own buckets: UT-01 Blake Moore→UT-02, UT-03 Kennedy→UT-04 and TX-35 Casar→TX-37 (`no-title`), and AL-01 Barry Moore→S-AL (`title-mismatch`).
- **`underlined-not-stored-incumbent` (12)**, the underlined rows the instrument did not match to the race's stored incumbent. **Eleven are another race's incumbent**: CA-03 (Bera), CA-06 (Kiley), CA-40 (Calvert), CA-41 (Sánchez), FL-20 (Wasserman Schultz; FL-20 stores no incumbent), FL-23 (Frankel), FL-25 (Moskowitz), TX-37 (Casar), UT-02 (Blake Moore), UT-03 (Maloy) and UT-04 (Kennedy). **The twelfth is a miss**: WA-09's *D. Adam Smith* is WA-09's own stored incumbent, and the name route does not match him.
- **Per state**, for every state with either: CA own 41 · other 4 · none 3 · no-title 2 · mismatch 2; **FL** own 17 · none 7 · other 3 · mismatch 1; UT no-title 2 · none 1 · other 1; TX own 20 · none 11 · no-title 4 · mismatch 3; WA own 6 · none 2 · no-title 1 · mismatch 1; and, by a Senate run alone, GA, IA, KY, LA, NH, OK and WY. **Florida is not in `DISPLAY_STALE_STATES` and carries three incumbents on another district's ballot.**
- **`on-no-ballot` includes five page shapes rather than people**: four Louisiana incumbents, Scalise, Carter, Higgins and Johnson, whose names are in their pages' Nov-3 primary box because a Louisiana House page has no 2026 general box; and FL-10's Frost, whose general was canceled. LA-06's Cleo Fields is a real reading: he is listed withdrawn under the Nov-3 box, and the page says he *"announced he would retire to run for a seat in the Louisiana Legislature"*. (Letlow is on the Louisiana Senate page's general box.) **The own-ballot residue check** (an underlined or same-surname row on the incumbent's own ballot) fired on 4 of the 80 `on-no-ballot`: **WA-09 is a miss**, where Adam Smith is on his own ballot as *D. Adam Smith* and the first initial *D* fails the name route, and IL-04 (Patty Garcia, a different person), TX-37 (Casar, underlined) and UT-04 (Kennedy, underlined) read correctly.

## 7. The five seats

| seat | stored incumbent | bucket | the ballot | the page |
|---|---|---|---|---|
| **CA-01** | James Gallagher (R), no title | no-title → **own ballot** | <u>Gallagher</u> (R) · McGuire (D) | *"Incumbent James Gallagher and Mike McGuire are running in the general election"*; *"A map of the district before and after redistricting ahead of the 2026 election."* |
| **MO-05** | Emanuel Cleaver (D) | **on-own-ballot** | <u>Cleaver</u> (D) · Brattin (R) · Langkraehr (L) | *"Incumbent Emanuel Cleaver, Rick Brattin, and Randy Langkraehr are running"*; *"the ongoing redistricting effort in Missouri"* |
| **TN-09** | Steve Cohen (D), running 0 | on-no-ballot | Pearson (D) · Taylor (R) · Clark (I) · Head (I) | *"Withdrawn or disqualified candidates Steve Cohen (D)"*; *"mid-decade redistricting ahead of the 2026 elections"*; the page cites the *Callais* ruling on a second majority-minority district |
| **TX-09** | Al Green (D) | on-no-ballot | Gutierrez (D) · Mealer (R) | *"Christian Menefee (D) and Al Green (D) — ran against each other in the redrawn 18th district."* Green is on no 2026 general ballot in Texas, and TX-18's roster publishes him as `won_primary` (row 3). |
| **TX-32** | Julie Johnson (D) | on-no-ballot | Barrios (D) · Yarbrough (R) | In the article body, Johnson appears only as an endorser (*"Congresswoman Julie Johnson"*) and in past results; the page's delegation footer lists her as District 32's sitting member. She is on no 2026 general ballot in Texas, and TX-33's roster publishes her as `won_primary` (row 3). |

Every one of the five pages links the mid-decade redraw and shows a before-and-after district map. **Two of the five (CA-01, MO-05) carry the incumbent on the seat's own ballot**, where the rating reads the new map's lean against an incumbent who is running in it. **Three (TN-09, TX-09, TX-32) carry a stored incumbent who is on no 2026 general ballot anywhere.** Across the census the class is wider than the five. 15 House incumbents are on another ballot (8 on a moved House seat in CA, FL and UT, 7 on a Senate ballot). The name route finds 4 more: 3 on a moved House seat, and AL-01's Barry Moore on the Senate ballot. 11 underlined ballot rows are another race's incumbent, and Florida is among them without a flag in `DISPLAY_STALE_STATES`. The quoted sentences are capped at 200 characters and taken from the article body only (D9). All of them are in `report-reclassify-2026-09-25T21-00-28-042Z.txt` §7, and the `redistrict` ones are also in `races-reclassify-2026-09-25T21-00-28-042Z.json`.

## 8. The falsification set

| race | roster | reading |
|---|---|---|
| **S-AK-2026** | harvested: Peltola, Leslie (`advanced`) | **three divergences.** Leslie is published `advanced` and listed withdrawn; *Gerald Heikes* is on the ballot, unmarked in the top-four box (the replacement); *Dan Sullivan*, a marked advancer and a different person from the senator, is on the ballot and unpublished (correction 2). Peltola agrees. Ballot: <u>Daniel S. Sullivan</u> · Peltola · Heikes · Dan Sullivan. The incumbent reads `title-mismatch` (stored title *Daniel S. Sullivan*, page title *…(United_States_Senator_from_Alaska)*) and was taken off the ballot by `name+underline`. |
| **AK-AL-2026** | curated, HO 741's seed | **the seed set against today's ballot agrees on all four**: Hafner, McDermott and Hill `advanced` and on the ballot; Williams `withdrew`, off the ballot, listed withdrawn. Ballot: <u>Begich</u> · Hafner · McDermott · Hill. |
| CA-06-2026 | Kiley, Pan (`advanced`) | agree, both. The stored incumbent, Bera, is on CA-03's ballot, and Kiley, underlined here, is CA-03's stored incumbent. |
| CA-13-2026 | Lincoln (`advanced`) | agree; Gray `on-own-ballot` |
| CA-21-2026 | Kirkland (`advanced`) | agree; Costa `on-own-ballot` |
| CA-22-2026 | Villegas (`advanced`) | agree; Valadao `title-mismatch` (stored *David G. Valadao*, page `David_Valadao`), on his own ballot |
| CA-45-2026 | Vo (`advanced`) | agree; Tran `on-own-ballot` |
| CA-48-2026 | Desmond, von Wilpert (`advanced`) | agree, both; Issa (running 0) on no ballot |

**The six California `top_two` races agree on every published row. The divergence in the set is Alaska's Senate race.** Beyond the set, the census found more of the class the handoff predicted (3 withdrawn-and-listed outside it, 4 counting S-AK's Leslie) and a larger class it did not name (36 runoff advancers, row 3).

## Found outside the lines' mechanisms (flagged in the paste-back, not filed)

Items 1 to 4 were read at the source and confirmed by `SELECT`s against `primaries`, `primary_candidates` and `races` (saved as `evidence-*.txt` beside the artifacts). Item 5 was read in code, and item 6 is a STEP 0 `SELECT`. None is a mechanism the HO 741, HO 743 or HO 744 lines name.

1. **The harvest publishes first-round runoff advancers as `won_primary`.** 35 harvested rows over TX, the Senate, GA, SC, AL and OK, plus one curated S-GA row at `running` (row 3). The HO 741 line's class is an advancer leaving the ballot after the primary; this is the harvest reading a runoff's first round as its result.
2. **A surname match puts a sitting member's bioguide on a different candidate, and the harvest then drops that candidate as the incumbent.** S-AK *Dan Sullivan* (Senate matcher, `lib/primaries-sync.ts:516-523`) and IL-04 *Patty Garcia* (House, `G000586`, the retiring Chuy García's). Both are the nominee or an advancer and both are on the ballot.
3. **A race with no stored incumbent drops every winner who carries a bioguide**: `pc.bioguide_id <> r.incumbent_bioguide_id` is NULL when the right side is, so FL-20's Wasserman Schultz (`W000797`, the D nominee) is not published. TX-23, the other race with no stored incumbent, publishes Tony Gonzales because his row carries no bioguide.
4. **An incumbent whose own `primary_candidates` row lacks a bioguide is published as her own challenger**: CA-14 Aisha Wahab (`advanced`), S-SC Darline Graham (`won_primary`). S-SC's roster also carries Lindsey Graham (`won_primary`, listed withdrawn) and Ralph Norman (lost the special primary's runoff).
5. **Louisiana's Nov-3 contest is read as a primary, and the harvest's CASE would publish its winners as `won_primary`.** `jungle` falls to the CASE's `ELSE` (`lib/harvest-challengers.ts:162-163`), and nothing in `HARVEST_FROM_WHERE` excludes it. Today the six rows carry 0 winners and 0 published rows. Read in code, not measured.
6. **`incumbent_running` is never `1` in prod**, so the `on-no-ballot` split by it has an empty `1` column by construction. **Ruled not a defect (review, ruling 6):** `.claude/skills/cbt/SKILL.md:320` (HO 221) reserves `1` and makes NULL the honest default, so no line is filed.

## Rulings, 2026-09-25

The architect reviewed `747-review` at `5dbfe0a` the same day and confirmed D11 and D12 as landed. A second `docs(HO 747)` commit files the rulings below. Every line named here is in `docs/backlog.md` OPEN LOOPS; the backlog moved **9+/3−**, and OPEN LOOPS reads 254 live / 297 struck / 551 before it and **258 / 299 / 557** after.

| flag | disposition | where |
|---|---|---|
| 1 · runoff advancers | **No new line.** They are the largest instance of the HO 741 harvest line, whose close, a general-box reader the harvest yields to, removes them. That line gains one sentence naming the ingest's half: `lib/primary-candidates-scrape.ts:361` drops the runoff box, and the 3 runoff rows in `primaries` mark no winner. The line is marked **high**. | *The challenger harvest publishes a primary result…* (HO 741), rewritten in place |
| 2 and 4 · surname-assigned bioguides; incumbents published as their own challenger | **One new line**, owner Code. It names the Senate and House matchers with their lines, and every other reader of `primary_candidates.bioguide_id`. Its close is both readings at 0 on a census re-read. It records as the architect's direction, not the close, that the census matched 325 stored incumbents by `ballotpedia_title` identity. | *The harvest's incumbent exclusion trusts a bioguide the ingest assigns by surname…* (HO 747), new |
| HO 736's two-spellings line | **Struck.** Two people, not one under two spellings; the defect is the line above. | *New (HO 736) · `primary_candidates` carries the AK Senate incumbent twice…*, struck |
| 3 · a race with no stored incumbent | **Its own line**, owner Code, **high**. Close: a null-safe predicate, with a leg on a `file:` copy that reads red on today's predicate. | *A race that stores no incumbent drops from its roster every primary winner who carries a bioguide…* (HO 747), new |
| 5 · Louisiana's Nov-3 contest | **Its own line, dated** before the `0 0,12 * * *` tick of Wednesday 2026-11-04 12:00 UTC. Polls close at 02:00Z that day, because daylight time ends Sunday 2026-11-01. Close: the harvest skips `jungle` rows until the election-night line is ruled, with a leg on a `file:` copy carrying a marked jungle winner. | *Louisiana's six House races are decided on 2026-11-03…* (HO 747), new |
| 6 · `incumbent_running` never `1` | **Not a defect**: `SKILL.md:320` (HO 221). No line. | above, beside the flag |
| the five-seat WATCH | **Struck: the class is confirmed and wider than the five.** The class is filed as its own line, counted from row 6 net of the 34 curated `incumbent_running = 0`, the five page shapes and WA-09's miss: **61**. That is 58 House (43 on no ballot including TX-09 and TX-32, 11 on another House seat, 4 running for the Senate) and 3 Senate. Owner Code for the data and Corey for the copy. | *WATCH (HO 743) · five seats…*, struck; *A race card names a stored incumbent who is not on that seat's 2026 ballot…* (HO 747), new |
| `DISPLAY_STALE_STATES` | **Its own line**, owner Code, low. The saved pages carry their own before-and-after map on every House page in ten states, and the list names six; it misses **AL, FL, LA and TN**. Nothing reads the flag today. | *`DISPLAY_STALE_STATES` names six mid-decade redraw states…* (HO 747), new |
| the four unexplained marked-in-primary rows | **Explained by `SELECT`s and filed as one new line**, because no existing line's mechanism covers them. **Hawaii:** HI-01's Berning and HI-02's Codelia are marked in a *Nonpartisan primary* box that the House sync drops in any state outside `NONPARTISAN_HOUSE_STATES` (`lib/primaries-sync.ts:152`, `:1312`, `:1326-1334`); no `house-HI-0N-2026-open` row exists. **Delaware:** DE-AL's Arminio and S-DE's Katz are still `running`. S-DE's candidate rows were last written 23 seconds after Delaware's polls closed on 2026-09-16 (00:00:23Z), and DE-AL's on 2026-09-06, before the 09-15 primary. A regular primary is re-read only when the cursor next passes. | *A winner the page marks can miss `primary_candidates` two ways…* (HO 747), new |

The evidence for the review's `SELECT`s and page readings is in `docs/handoffs/747-artifacts/` (`evidence-ruling9.txt`, `evidence-ruling8.txt`, `review-facts.txt`).
