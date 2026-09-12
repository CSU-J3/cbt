# HO 715 — committee markup votes: probe findings

> **Diagnostic-only probe, not wired.** Base `main` at `57b71b8`, run 2026-09-12. Request budget: **407 requests, 0 transport errors, 26.6 MB** (row 8). Distilled from `docs/handoffs/715-artifacts/` (repo-ignored, local: raw payloads, PDFs, scripts, per-row outputs, `requests.log`). This file is the findings as delivered at the STEP 0 HALT, given a tracked home by the STEP 0 ruling; SKILL, External data sources, *Committee markup votes*, summarises it and points here. No recommendation on whether to build — the decision line is in `docs/backlog.md`.

Base `main` at `57b71b8` (`git ls-remote`: `main` only, no other heads), 2026-09-12. Diagnostic only: **no product code, no schema, no sync, nothing written to the database** (every DB touch was a `SELECT`). Raw payloads, scripts and per-row outputs are in `docs/handoffs/715-artifacts/` (repo-ignored, local). No recommendation on whether to build. That is Corey's line.

## STEP 0 anchors, re-derived at `57b71b8`

| handoff anchor (as of `9077492`) | at `57b71b8` |
|---|---|
| `scripts/migrate.ts:712-725` `committee_meetings` | holds, `:712-725`; indexes `:726-729` |
| `lib/meetings-sync.ts:105` list, `:151` detail | holds |
| `ApiMeeting` `:130-144` | **`:130-145`** (closing `};` on `:145`) |
| (not cited) | `lib/meetings-sync.ts:173-174` already says *"The messier meetingDocuments PDF-name path is deliberately NOT parsed in v1."* |
| `committee_members` "a roster" | **current-only**: wipe-and-rewrite per committee, `lib/committees-sync.ts:318-367`. No history and no ex officio rows (row 6) |
| roadmap pointer | 716; 715 keeps its number as the 716 ruling recorded |

## Ground truth the probe corrected (flagged, not absorbed)

1. **"record vote … within 48 hours, on its own site."** The rule says *"publicly available in electronic form within 48 hours"*, *"subject to paragraph (k)(7)"*. It names no site (row 7).
2. **"the Senate has no equivalent rule."** It has one: Standing Rules XXVI 7(b)–(c) require the report to tabulate roll-call votes. But the tabulation covers *"each member of the committee who was present"*, and proxies count. So the rule obliges a record that **omits absentees by construction** (rows 5 and 7).
3. **"hundreds of markups in the 119th."** 268 House rows typed `Markup` (246 past and `Scheduled`) across 40 committee codes and 19 parent committees. The Rules Committee's 65 events are all typed `Meeting` and sit outside that population.
4. **"`meetingDocuments[]` … whether any type names a vote tally."** One type does (`Committee Recorded Vote`), but it is **not the whole index**. Appropriations files its roll-call records as `Support Document`.

## Deviations (named)

- **D1 strata.** "≥ 2 per committee" over 40 codes would need 79 samples, so strata are the **19 parent committees** (subcommittees roll up). 3 each, +1 to the three with the most eligible markups (hsap 39, hsif 30, hspw 20) = 60. Eligible means past (`< 2026-09-12`) and `Scheduled`: a future or canceled markup cannot carry a vote. Seeded shuffle (715).
- **D2 row 3 selection.** 18 parents carry a vote file, so 3 each (54) exceeds the 40 cap. Selection was round-robin over parents in code order, one markup per round. Result: 3 files for hlig/hsag/hsas/hsba, 2 for the other 14.
- **D3 five files beyond the 40 cap.** The roll-call records typed `Support Document` on the 5 sampled markups that carry no `Committee Recorded Vote` doc (4 Appropriations, 1 E&C). Without them the largest markup population (39) carried a known-wrong zero in row 4.
- **D4 the Senate rule was fetched and quoted.** Row 7 asks only for the House rule, but the handoff's Senate premise was a claim to read (correction 2).
- **D5 wasted budget.** An attempt to find a House Appropriations *report* by walking `hrpt` details spent **44 API requests (4 list + 40 detail) and found nothing**, because list order does not track date. Abandoned; D3 answered the question instead.
- **D6 instruments.** `pdfinfo` is absent on this box, so PyMuPDF replaced it. **`pdftotext` silently drops `✓` glyphs** (Latin-1 output), so a Ways & Means page read as having no marks while PyMuPDF read 40 `✓`. Marks were read with PyMuPDF throughout. Images were read **by eye** (rendered PNG), not OCR.
- **D7 delivery.** "A copy delivered to chat by the review-ref route": `docs/handoffs/` is repo-ignored and must stay so (SKILL, Pre-flight verification, build-input parity). A ref cannot carry this file without force-adding an ignored path. **Delivered as the chat paste.** STEP 1's roadmap block and SKILL entry carry the figures onto the ref. **Handoff defect**: propose the architect names a tracked home if the file itself must land. *(Ruled at STEP 0, 2026-09-12: the home is this file, `docs/probes/`.)*

---

## Row 1 — does Congress.gov carry a vote-document pointer per markup

60 details fetched (`r1-details/`). The raw key is **`meetingDocuments[].documentType`**; document keys are `documentType, format, name, url` (13 of 1,931 documents carry no `name`).

| `documentType` | documents | markups carrying it (of 60) |
|---|---:|---:|
| Committee Amendment | 690 | 44 |
| **Committee Recorded Vote** | **465** | **43** |
| Bills and Resolutions | 360 | 56 |
| Support Document | 343 | 57 |
| House or Senate Amendment | 32 | 2 |
| Member Statements | 22 | 7 |
| Hearing: Member Roster | 11 | 11 (unread: may be a roster, not attendance) |
| Hearing: Transcript | 6 | 6 |
| Committee Report | 1 | 1 |
| Hearing: Cover Page | 1 | 1 |

- **Vote-typed URL host:** all 465 are `www.congress.gov/119/meeting/house/{eventId}/documents/{file}`; none on committee sites.
- **Coverage:** `Committee Recorded Vote` on **43/60 (72%)**. Adding roll-call records typed `Support Document` (name matches `roll call votes | vote summary`: 4 Appropriations, 3 E&C "Vote Summary") gives **48/60 (80%)**.
- **Not every vote-typed doc is a roll call.** Read: the E&C Health "Vote Summary" (every item a voice vote), House Administration's organizational "Vote Results" (passed by voice), and Small Business voice votes (3 of 7 docs at 118539, 4 of 15 at 119320, named "…agreed to by voice").
- **Markups with ≥ 1 actual record vote:** **44 of 59 measurable** (119200 unmeasurable: its listed vote file is missing on both hosts, row 2).
- **Counting traps:** `-U1` re-uploads duplicate vote numbers. Compiled files hold many votes (Armed Services `Vote1-35`, `Vote1-23`; Ways & Means `Vote001` = 10 and 17 pages).

## Row 2 — the House Committee Repository: second index, or the same one

60 event pages (`docs.house.gov/Committee/Calendar/ByEvent.aspx?EventID=N`, `r2-pages/`). Documents sit under `<h2>` sections: Support Documents 57 · Text of Legislation 56 · Amendments 46 · **Votes 43** · Hearing Record 15 · Member Statements 7.

- **Same index.** The vote set is identical by filename on **60/60** markups (465 = 465). The repository path is `docs.house.gov/meetings/{CMTE}/{CODE}/{YYYYMMDD}/{eventId}/{file}`. The API mirrors it; neither has a vote document the other lacks.
- **Listable, typed?** Only as HTML sections per event. The API's `documentType` is the typed form of the same index.
- **What the repository adds: an `Added MM/DD/YYYY at HH:MM AM` stamp per file.** Last vote file posted after meeting start, n = 43 markups: **p50 9.9 h · p90 49.4 h · max 1,046 h; 5 of 43 > 48 h**. Stamps read as ET = UTC−4 (±1 h). A stamp may be a re-upload time, not first posting.
- **Mirror failure, 2 of 45 files fetched: HTTP 200 carrying an HTML "Not Found" page at a `.pdf` URL.**
  - Ways & Means 119438 `Vote001`: the congress.gov copy is a cached repository Not Found page stamped `7/8/2026 9:26:21 AM`; the repository serves the real 1.14 MB PDF.
  - Appropriations 119200 `SD001`: **both hosts** serve Not Found with 200 (repository page stamped 2026-09-12 3:30:34 PM).
  - A status check reads both as success; only the `%PDF-` magic separates them.

## Row 3 — parse feasibility per committee (40 files + D3's 5)

**Text layer 31 · image 9.** The 9 images:
- Judiciary ×2: scanned form, handwritten ticks.
- Intelligence ×3: scanned form, handwritten running tally numbers.
- House Administration ×1: scanned, handwritten ticks.
- Foreign Affairs ×2: **screenshot of the electronic vote board, the vote encoded only in tile colour** (green yea, red nay, yellow abstain, white not voted).
- E&C Health ×1: image of a voice-vote summary.

| parent | files | class | layout family | name form | generic parser v3 (pages) |
|---|---|---|---|---|---|
| hlig00 | 3 | image, handwritten | single-column grid, 2 party blocks | `Mr. Surname`, `Chairman X` | image (hand 3/3) |
| hsag00 | 3 | text | single-column grid + side metadata box | `Mr. Surname`, `Mr. Jackson of Texas` | 3 MATCH |
| hsas00 | 3 (2 compiled) | text | two-half grid, Aye/No/Present | `Mr. Surname (ST)`, `Dr.` | 59 MATCH |
| hsba00 | 3 | text | two-half grid + Not Voting column | `Mr. Surname (ST)` | 3 MATCH |
| hsbu00 | 2 | text, form-fill `l` characters | two-half grid, Answer Present | `SURNAME (ST)` | 2 no readable total (hand 2/2) |
| hsed00 | 2 | text; **1 Caesar-shifted text layer** | two-half grid + Not Voting | `Mr. SURNAME (ST)` | 1 MATCH, 1 MISS |
| hsfa00 | 2 | image, colour tiles | vote-board screenshot | bare surname, `RM Meeks`, `J.Jackson` | image (hand 2/2) |
| hsgo00 | 2 | text | two-half grid by party, absence = blank row | `MR. SURNAME (ST)` | 2 MATCH |
| hsha00 | 2 | 1 text (voice results), 1 image | single grid | `Mr. Surname` | no header / image (hand 1) |
| hshm00 | 2 | text | **mark before name**: X left = yea, X right = nay | `Mr. Surname, State` | 2 unreadable (hand 2/2) |
| hsif00 | 2: IF17 text, IF14 image | text grid; IF14 a voice-vote summary | two-half grid | `Mr. Surname` | 1 MATCH, 2 image pages (no roll call) |
| hsii00 | 2 | text | two-half grid Yea/Nay/Pres | `Mr. Surname, ST` | 2 MISS by one nay (hand 2/2) |
| hsju00 | 2 | image, handwritten | two-half grid by party | `MR. SURNAME (ST)` | image (hand 2/2) |
| hspw00 | 2 | text | two-half grid, single letter-coded `Y`/`N` column, prints Not Voting total | `Mr. Surname (of ST)` | 1 MATCH, 1 MISS by one, 1 blank page |
| hssm00 | 2 | text | single grid + result box; 1 of the 2 a voice vote | `Mr. Surname (ST-DD)` | 1 MATCH, 1 no total (voice) |
| hssy00 | 2 | text (Excel) | single column, digit `1` marks, the word `Present` as a mark | `Full Name, State` | 2 MISS (column assignment; hand 2/2) |
| hsvr00 | 2 | text | numbered list, majority/minority blocks | `N. Full Name, ST` | 2 MATCH |
| hswm00 | 2 (compiled 10 + 17 pp) | text, `✓` glyphs | two-half grid under a "VOTES OF THE COMMITTEE" report statement | `Mr. Surname (ST)`; **no state on 2025 pages** | 21 MATCH, 3 MISS, 3 empty grids |
| hsap00 (D3) | 3 PDFs + 1 missing | text | **voters-only name lists** (rule XIII 3(b) format), no absentees printed | `Mr. Surname` | separate count: 27/27 roll calls printed tally = listed names |

- **One generic coordinate parser, no per-committee configuration, three generic fixes** (prose tallies mistaken for headers; layout-order totals; two totals phrasings). Over 123 pages: **94 MATCH the page's own printed tally · 9 MISS · 8 no readable total · 11 image (1 of them blank) · 1 no header**. The printed tally is the control that can fail: v1 read 11 MATCH / 25 MISS.
- **Misses concentrate in 5 committees:** II, SY, WM, PW, ED.
- **Unreachable by any text parser:** 4 committees' images (JU, IG, FA, one HA).
- **Format is not stable per committee.** House Administration posted a text PDF in 2025 and a handwritten scan in 2026.
- **Oddity candidates:**
  - Ways & Means prints **empty vote grids for votes that never happened** (3 of 17 pages: amendment withdrawn, or ruled not germane).
  - The Education & Workforce text layer is **Caesar-shifted** (`0U :$/%(5* 0, &KDLUPDQ` = `Mr. WALBERG (MI), Chairman`).
  - Agriculture's form reads `Date: May 14, 2024` on a 2025-05-13 markup.
  - Science reads `Deborah Ross, New Carolina` and `Illinios`.
  - Veterans' Affairs numbering skips 4.
  - The mirror's HTTP-200 Not Found PDFs (row 2).

## Row 4 — yield

- **Record votes per markup:** all 60 sampled markups.
  - Distinct vote numbers per filename, `-U` collapsed, voice-named docs dropped.
  - Compiled and non-roll-call files replaced by their read count.
  - Ways & Means 119328 **estimated** (not downloaded; mean of the two read WM files).
  - Appropriations 119200 unmeasurable.
- **Sample total:** **572 record votes** in 59 measurable markups.
- **Not voting per record vote:** **142 readings.**
  - 94 parser-MATCH pages.
  - 23 hand readings (images, parser misses, Budget's garbled totals).
  - 25 derived: Appropriations full committee, 63 current roster rows − listed voters.
  - **Pooled mean 2.73 · median 2 · max 27 · 43 of 142 zero.**
- **Heavy tail:** the two Judiciary readings are **18 and 27 of 44 not voting**; Natural Resources 14 and 9; Science 10 and 10.

| parent | 119th eligible markups | votes / markup | NV readings | NV / vote | est. NV rows, 119th to date |
|---|---:|---:|---:|---:|---:|
| hsju00 | 17 | 6.0 | 2 | 22.5 | 2,295 |
| hsba00 | 13 | 23.3 | 3 | 7.0 | 2,123 |
| hsfa00 | 8 | 42.0 | 2 | 4.0 | 1,344 |
| hsed00 | 17 | 17.0 | 2 | 3.0 | 867 |
| hsap00 | 39 | 9.0 | 27 | 2.4 | 858 |
| hswm00 | 12 | 12.0 | 24 | 5.0 | 714 |
| hsgo00 | 13 | 13.0 | 2 | 2.5 | 422 |
| hssy00 | 8 | 4.0 | 2 | 10.0 | 320 |
| hsii00 | 18 | 1.3 | 2 | 11.5 | 276 |
| hsif00 | 30 | 2.8 | 1 | 2.0 | 165 |
| hsvr00 | 12 | 5.3 | 2 | 2.0 | 128 |
| hssm00 | 6 | 6.0 | 1 | 3.0 | 108 |
| hshm00 | 7 | 2.7 | 2 | 5.0 | 93 |
| hsha00 | 11 | 3.3 | 1 | 2.0 | 73 |
| hsas00 | 4 | 19.7 | 59 | 0.7 | 59 |
| hspw00 | 20 | 0.8 | 2 | 2.0 | 30 |
| hlig00 | 3 | 4.3 | 3 | 2.0 | 26 |
| hsag00 | 4 | 9.3 | 3 | 0.0 | 0 |
| hsbu00 | 4 | 7.7 | 2 | 0.0 | 0 |

**Estimate: ~9,900 member-not-voting rows over the 119th to date (2025-01-03 → 2026-09-12, 1.69 y), bootstrap 90% [7,242, 12,917]. Per year ~5,900 [4,287, 7,646]. Record votes ~2,160 to date, ~1,280/yr.**

**Uncertainty the bootstrap does not carry:**
- Judiciary (the largest term) rests on 2 votes.
- 14 parents have ≤ 3 NV readings.
- Appropriations NV is derived from a current-only roster.
- Parser NV counts table-label lines as names where they slipped through (`VACANCY` on Oversight: ±1).
- The population excludes the Rules Committee's 60 past `Meeting`-typed events and a handful of mistyped markups, so on that axis it is a **lower bound**.
- Population control: the API list's `pagination.count` 1,601 vs 1,603 DB rows, so the table is complete.

## Row 5 — Senate

- **119th Senate reports:** **132** (`srpt` 1–133); 60 sampled evenly by number.
- **Denominator:** 55 on measures (5 are activity or allocation reports).
- **Roll-call tallies with names: 5 of 55 (9%).**
  - Appropriations ×3: voters-only `Yeas` / `Nays` name lists.
  - Intelligence ×2: every senator `--aye` / `--no`, *"in person or by proxy"*, so **a proxy vote masks absence**.
- **Voice only: 49.** This includes 4 Commerce reports my first detector flagged that were quoting *House* committee roll calls in their legislative history; corrected by hand.
- **Stub: 1** (S. Rept. 119-55, htm 1.6 KB).
- **Oddity candidate:** Veterans' Affairs reports carry a *"TABULATION OF VOTES CAST IN COMMITTEE"* section whose content is an en bloc voice vote.
- **Parsed sample, S. Rept. 119-38 (Legislative Branch appropriations):**
  - Printed `recorded vote of 26-1`; parsed 26 yeas, 1 nay. 26 of 27 names resolve to the `ssap00` roster; Mullin is off the current roster.
  - **The report names no absentee.** Roster − voters = Husted and Murphy, but the roster is current-only, so that derivation inherits drift.
- **Lag, "ordered reported" date in text → issue date:** n = 39, **p50 131 days, p90 257**. Appropriations 0 (same day). Some Indian Affairs reports cite a prior Congress's markup (431–1,204 days).

## Row 6 — name resolution against `committee_members`, no crosswalk

The row covers distinct printed names on text-layer pages, joined to the vote's own committee code. Images are excluded (9 files), and Homeland Security is effectively excluded (its layout defeated the parser: 4 name lines).

- **555 hit** (exactly one roster member).
- **5 ambiguous:** Ways & Means 2025 pages print `Mr./Ms. Moore`, `Mr./Mrs. Miller`, `Mr. Smith` with no state.
- **10 off the current roster:**
  - On a vote form but not on today's roster for that committee (each resolves to a House member; *why* each left was not checked): LaMalfa, Sherrill, Greene, LaLota, Downing, Conaway, Summer Lee (Oversight), `Mr. Scott` (Financial Services, 3 House Scotts).
  - **Ex officio: Pallone and Guthrie on an E&C subcommittee.** `committee_members` has no ex officio rows. The same shows on Appropriations subcommittee votes, which list **2 more voters than roster rows** (15 vs 13, 17 vs 15).
- **15 unresolved:**
  - 7 table labels the name filter let through (`Noes`, `Recorded`, `VACANCY`, `YEAS`, …).
  - 6 parser fragments of wrapped names (King-Hinds `(Del.-` / `CNMI)`, Van Duyne `Ms. Van`, …).
  - 2 Caesar-shifted Education & Workforce names.
- **Rate: 555 / 578 name lines = 96.0%; 555 / 570 whole names = 97.4%.** Every non-hit class is structural (roster history, ex officio, stateless surnames, layout), not noise.

## Row 7 — the rules, quoted

**House, Rule XI cl. 2(e)(1)**, from *Rules of the House of Representatives, One Hundred Nineteenth Congress*, prepared by the Clerk, January 16, 2025 (Rev. 1-16-25), `rules.house.gov/…/houserules119thupdated.pdf`; the same text is in GovInfo `HMAN-119`:

> (A) Each committee shall keep a complete record of all committee action which shall include— … (ii) a record of the votes on any question on which a record vote is taken. (B)(i) Except as provided in item (ii) and subject to paragraph (k)(7), the result of each such record vote shall be made publicly available in electronic form within 48 hours of such record vote. Information so available shall include a description of the amendment, motion, order, or other proposition, the name of each member voting for and each member voting against such amendment, motion, order, or proposition, and the names of those members of the committee present but not voting. (ii) The result of any record vote taken in executive session in the Committee on Ethics may not be made publicly available without an affirmative vote of a majority of the members of the committee.

**Two notes on that text:**
- **The obligation names members *present* but not voting. An absent member appears in no required field.** Most House forms list the whole committee anyway, which is what makes absence readable. Appropriations' format does not.
- **Rule XI cl. 2(k)(7):** *"Evidence or testimony taken in executive session, and proceedings conducted in executive session, may be released or used in public sessions only when authorized by the committee, a majority being present."*

**House, Rule XIII cl. 3(b)** (the Appropriations format):

> With respect to each record vote on a motion to report a measure or matter of a public nature, and on any amendment offered to the measure or matter, the total number of votes cast for and against, and the names of members voting for and against, shall be included in the committee report.

**Senate, Rule XXVI 7(b)–(c)**, *Standing Rules of the Senate*, S. Doc. 113-18, revised to January 24, 2013 (the current document `rules.senate.gov` serves):

> (b) Each committee (except the Committee on Appropriations) shall keep a complete record of all committee action. Such record shall include a record of the votes on any question on which a record vote is demanded. The results of rollcall votes taken in any meeting of any committee upon any measure, or any amendment thereto, shall be announced in the committee report on that measure unless previously announced by the committee, and such announcement shall include a tabulation of the votes cast in favor of and the votes cast in opposition to each such measure and amendment by each member of the committee who was present at that meeting. (c) Whenever any committee by rollcall vote reports any measure or matter, the report of the committee upon such measure or matter shall include a tabulation of the votes cast by each member of the committee in favor of and in opposition to such measure or matter. Nothing contained in this subparagraph shall abrogate the power of any committee to adopt rules— (1) providing for proxy voting on all matters other than the reporting of a measure or matter, …

## Row 8 — the probe's own cost

**407 requests, 0 transport errors, 26.6 MB** (`requests.log`, one line per request; two curl lines' byte counts were added from curl's own `size_download`).

| host | requests | bytes |
|---|---:|---:|
| api.congress.gov | 227 (r1 61 · r5 121 · r0 1 · **D5 wasted 44**) | 1.47 MB |
| www.congress.gov | 106 (40 + 5 vote PDFs, 60 Senate report htm, 1 control) | 13.79 MB |
| docs.house.gov | 65 (60 event pages + controls and fallbacks) | 6.79 MB |
| www.govinfo.gov | 2 | 3.42 MB |
| www.rules.senate.gov | 2 | 0.73 MB |
| rules.house.gov | 3 | 0.40 MB |
| clerk.house.gov | 2 (404s) | < 0.01 MB |

- **Congress.gov key ceiling:** `x-ratelimit-limit: 20000`, **per hour** (SKILL, Congress.gov API). I read only the `x-ratelimit-limit` / `-remaining` pair, so no daily ceiling was observed. `x-ratelimit-remaining` read 19,766 at the first call and 19,661 at the last, over a 29-minute window shared with the crons.

## Sizing the scraper arc (no recommendation)

- **Discovery is cheap and already paid for.** `lib/meetings-sync.ts` fetches every House detail and discards `meetingDocuments`. The vote pointer is `documentType = 'Committee Recorded Vote'` plus a name match for records typed `Support Document`, and the repository is the same index.
- **Unmeasured:** whether a document added after the meeting moves the event's `updateDate`, which the sync's cursor needs to see it.
- **Parsing is the arc.** Across 19 committees there are at least **6 text layout families** (two-half grid; single column; mark-before-name; letter/digit-coded column; voters-only lists; report-statement grid) and **2 image classes no text parser reaches**:
  - scanned handwriting: Judiciary, Intelligence, sometimes House Administration;
  - colour-tile vote-board screenshots: Foreign Affairs.
- **One generic coordinate parser matched 94 of 103 text pages with a readable total.** The remaining text committees each need a fix of their own, and some formats change between years.
- **Image classes** need OCR plus mark detection (handwritten ticks, tally numbers) or colour sampling (Foreign Affairs), per committee.
- **The 48-hour clock is mostly kept** (posting p50 ~10 h, p90 ~49 h), so a daily walk would see most votes within a day or two.
- **The join is honest at ~96–97% of printed names but not without a crosswalk.** It needs:
  - committee roster **history** (the current-only table already misses departures);
  - **ex officio** members;
  - a state or party disambiguator for Ways & Means' stateless surnames.
  - And the rules only oblige naming members *present*. Absence is readable because most forms list the full committee, and **unreadable where a committee prints voters only** (Appropriations), unless derived against a historical roster.
- **The yield is several thousand not-voting rows a year (~5.9k, 90% [4.3k, 7.6k]) on ~1.3k record votes**, heavy-tailed by committee, with a median of 2 absentees per vote and 30% of votes at zero.
- **The Senate offers ~no absentee object:** 9% of measure reports carry named tallies, and those are voters-only or proxy-masked. Reports lag the vote a median 131 days (n = 39, mostly voice-vote reports; Appropriations same day).
- **Design note for the ledger line, as the handoff asked: it cannot ride Phase A.** Committee votes run on a markup clock (0–99 roll calls a markup, weeks apart), and absence there is routine rather than exceptional, so it would be a separate tier or readout.
