# HO 838 § 2: the C4 scope table, the rendered Congress labels over numbers that aren't Congress-scoped

**Read-only.** Read at `0aec365` (HO 837's head) on Nov 27, 2026, re-grepped at HEAD. The counts are from guarded `SELECT`s behind HO 834's guard (`docs/handoffs/838-artifacts/store-838e.log`; 7 statements, 0 refused). **Every scope below is a proposal for the chat to rule on.** HO 839 builds the rulings before Jan 3. HO 838 changes none of these labels except the laws chart's, which move with C1.

**What the line counts and what HEAD holds.** The backlog's C4 item (`docs/backlog.md:118`) says *twelve*. A bare re-grep at HEAD finds eight rendered `119th` strings:
- `app/nominations/page.tsx:106`;
- `app/lobbying/page.tsx:275` (the line says `:268`);
- `components/AbsenceCardBack.tsx:154` (the line says `:152`);
- `components/LawsEnactedComparison.tsx:86`, `:141` and `:180`;
- `components/PolarizationOverTime.tsx:258`;
- `components/RaceOpenRow.tsx:393`, which isn't on the line.

Beside those, the table covers:
- the laws chart's two `118th` strings (`:151`, `:181`);
- the two `PolarizationOverTime` constants the line names;
- two sites a read-only sweep found: `/reports`' section heading over the laws chart (`app/reports/page.tsx:69`, *Productivity vs. the 118th*), and the polarization chart's hardcoded 2025 end (`:30`, `:123`, `:154`).

**What the data holds today:**
- `bills`: congress 119 only.
- `votes`: 119 only (House 689 rolls, Senate 938).
- `member_participation`: 119, 556 rows.
- `member_ideology`: 119, 552 rows.
- `nominations`: congress 119 only, 985 civilian and 1,448 military.
- `lda_filings`: filing years 2025 (85,989) and 2026 (57,503); the rollup counts 143,492, generated Nov 26 at 22:00Z.
- `polarization_history`: congresses 25 to 119 per chamber.

**On Jan 4, 2027:**
- `getCurrentCongress()` is 120.
- `bills` and `votes` hold two Congresses: the 119th whole, and the 120th's first handful.
- `member_ideology` stays 119 until Voteview publishes `HS120_members.csv`.

## The table

| # | Site at HEAD | Rendered | The number beneath, and its query | Scoped to | Today | Jan 4 | **Proposed scope** (proposal) |
|---|---|---|---|---|---|---|---|
| 1 | `app/nominations/page.tsx:106` | *Bulk military service promotions are excluded; the 119th filed {militaryTotal} of them.* | `summary.militaryTotal`, from `getNominationsSummary` (`lib/queries.ts:5266`): `SELECT is_military, COUNT(*) AS n FROM nominations GROUP BY is_military`, with no `WHERE`. The page's civilian total, facets and list are unfiltered too. | nothing (the table has a `congress` column no read uses) | 1,448, all congress 119: true | Still 1,448 plus any 120th military PN the 09:00Z ticks of Jan 3 and 4 pick up. It turns false with the first 120th promotion list. | **The current Congress.** Nominations belong to one Congress: unconfirmed ones go back at its end, and the page's subject is who the President is nominating now. Filter the summary and the list to `congress = getCurrentCongress()`, passed into the cache as an argument, and take the label from it. The `:54` empty state then shows until the first 120th civilian nomination, which needs copy. `getCommitteeNominations` (`:5388`) takes the same ruling. |
| 2 | `app/lobbying/page.tsx:275` | *LD-2 quarterly lobbying reports for the 119th, bucketed by issue area…* | The header readout above it (filings, activities, registrants, clients, % naming a bill), from `getLobbyingRollup` (`lib/queries.ts:3852`), a blob that `writeLdaRollup` builds from `SELECT … FROM lda_filings` with no `WHERE` | nothing (`lda_filings` has `filing_year` and no `congress`; only the sync's ingest window, `lib/lda-sync.ts:427-430`, scopes it) | 143,492 filings, years 2025 and 2026: close to the 119th, as that Congress to date | Unchanged (no 2027 LD-2 exists before Apr 20). It turns false when Q1 2027 lands under *the 119th*. | **A filing year.** LD-2s are filed by calendar quarter, and Q4 2026's arrive after the rollover. The label that stays true is the span the corpus holds (*2025–2026 filings*), carried in the rollup blob so label and number come from the same `generatedAt`. |
| 3 | `components/AbsenceCardBack.tsx:154` | *SPONSORED, 119TH* | Up to 3 bill ids and a *+N*, from `readAbsenceCards` (`lib/queries.ts:6038`): `COUNT(*) … FROM bills INDEXED BY idx_bills_sponsor_agg WHERE sponsor_bioguide_id IN (…)` and a `ROW_NUMBER()` list, with no `congress` predicate (HO 836 matched them to `getSponsorStats` and `getSponsorRecentBills`) | nothing | `bills` is 119 only: true | *+N* counts 119th and 120th bills together, and a 120th bill can enter the list under *119TH* | **All-time.** Relabel *SPONSORED*, with no query change. `/members`' expanded panel labels the same list *Recent bills* without a Congress (`SponsorExpandedPanel.tsx:368`), and filtering would break HO 836's reader parity and empty the block in January. |
| 4 | `components/RaceOpenRow.tsx:393` (not on the line) | *Missed · 119th* | The member's missed-vote %, from `readMemberFacts` (`lib/electoral-general.ts:461-465`), `… AND vote_id IN (SELECT id FROM votes WHERE congress = ?)` bound to `getCurrentCongress()` via `getBallotMemberFacts` (`lib/queries.ts:2270`). The sub-line's median is from `member_participation`. | **the current Congress** (the query already is) | 119th rolls: true | The value counts the 120th's few rolls (or reads *—*) under *119th* | **The current Congress, label from the data.** Only the literal moves. Take it from the Congress the read used, as the hub's *Missed* does (`getMemberVoteStats`, labelled from its data since HO 712). `getBallotMemberFacts`' cache key omits the Congress, so a clock-derived label could sit over a cached 119th entry between 00:00Z and the day's flush. |
| 5 | `components/PolarizationOverTime.tsx:258` | *GAP · 119TH* | The selected chamber's gap (`cur.gap`), from `getPolarizationBand` (`lib/queries.ts`). **At HO 838's tip it takes `mi.congress = (SELECT MAX(congress) FROM member_ideology)`** (the HO 838 ruling 4), the condition the strip takes. | **the scores' Congress** at the tip (nothing at `0aec365`) | The House hint reads 0.92 (`polarization_history`'s 119th House row is D −0.3935, R 0.531), all rows 119: true | Unchanged and true. `member_ideology` stays 119 until HS120. | **The scores' Congress, label from the data.** Give the band the `MAX(congress)` it filters on, as the strip returns it (HO 712), and render `GAP · ${ordinal(n).toUpperCase()}`. The label then can't name another Congress than the dots' data, before or after HS120. (The scope pass proposed `getCurrentCongress()`. Under ruling 4 that would hide the dot from Jan 3 until HS120 lands, and the data-derived label keeps it true.) |
| 6 | `components/PolarizationOverTime.tsx:36` | (no text) `LINE_END_CONGRESS = 118` | Cuts `getPolarizationHistory`'s rows (`SELECT … FROM polarization_history`, all rows) to congresses 46 to 118, client-side. It feeds the D/R lines, the shaded gap, the *midcentury low · gap* label and the hover tooltip. Not the axis or a label. | congress, by a fixed range | Line 1879 to 2023, the 119th kept off it so it isn't drawn twice (HO 428): true | Still true. The dot is still the 119th's. | **The Congress before the dot's.** End the line at the band's scores' Congress − 1, computed on the server. While the dot is the 119th's, that's 118, as today. When HS120 lands, the line takes the 119th from `polarization_history` (written to 119, a mid-Congress snapshot: re-run `sync:polarization-history` after the 119th closes) and meets the 120th dot with no hole. |
| 7 | `components/PolarizationOverTime.tsx:37` | (no text) `CURRENT_YEAR = 2025` | An x-coordinate, the dot pair's, the gap numeral's and *GAP · 119TH*'s, at `xs(2025)`, the plot's right edge | nothing (a coordinate on the band's output) | True | True (the dot's data is still the 119th's) | **The dot's Congress's start year.** `congressTermDates(n).start` for the band's scores' Congress `n`, beside row 5. It has to move with row 8, or the dot and label fall off the plot: `xs(2027)` is past the 1070 edge and the label would clip past the 1140 viewBox. |
| 8 | `components/PolarizationOverTime.tsx:30`, `:123`, `:154` (found by the sweep) | `X_DOM [1879, 2025]`; *POLARIZATION OVER TIME · 1879–2025*; aria *… 1879 to 2025* | The chart's x-domain, title and aria label | nothing | True | True | **Rides with row 7:** the end year from the same Congress, in all three. |
| 9 | `app/reports/page.tsx:69` (found by the sweep) | *Productivity vs. the 118th* | The section heading over `LawsEnactedComparison` | **moves with C1** | True | **False at HO 838's tip.** From 00:00Z Jan 3 the chart draws the 120th against the 119th, and the heading still says *the 118th*. | **The previous Congress, from the chart's pair:** *Productivity vs. the {ordinal(previous)}*. It's outside HO 838's Leg D list (`app/reports/page.tsx`), so HO 838 leaves it (flagged). HO 839 builds it, or the chat lets it ride HO 838. |
| 10 | `components/LawsEnactedComparison.tsx:86` | aria *…, 119th Congress versus 118th, …* | The chart, from `getLawsEnactedBySessionWeek` | congress | True | Moved: *120th Congress versus 119th* | **Moved with C1 (HO 838).** From the reader's returned pair, by `ordinal()`. |
| 11 | `…:141` | *119th · wk {n} · {laws} laws* | The marker line | congress | True | Moved: *120th · wk 0 · no laws yet* until the 120th's first law | **Moved with C1 (HO 838).** |
| 12 | `…:151` | *118th by wk {n}: {laws}* | The reference line | congress | True | Moved: *119th by wk 0: 0* | **Moved with C1 (HO 838).** |
| 13 | `…:180` | *119th (current)* | The legend | congress | True | Moved: *120th (current)* | **Moved with C1 (HO 838).** |
| 14 | `…:181` | *118th (2023–25)* | The legend | congress | True | Moved: *119th (2025–27)*, the years from `congressTermDates` | **Moved with C1 (HO 838).** |

## What the rulings would also want to know

- **Rows 1 and 2 have a data gap behind the label.** The last 119th tick of the nominations sync is 09:00Z Jan 2, and of the LDA sync 08:00Z Jan 2. After that both list only the new Congress's window. So 119th nominations returned at the session's end, and Q4 2026 LD-2s (due Jan 20), are never ingested. That's the vote syncs' line 71 defect in two more syncs, not a label question. Filed in the HO 838 paste as a flag, not built.
- **Rows 5 to 8 belong together.** They place one dot and one line on one axis, so a ruling that moves one moves all four.
- **Row 4's chamber median** is `member_participation`'s. It keeps its previous rows when the new Congress's aggregate is empty or under half the held count (`lib/participation-refresh.ts`). So on Jan 4 a 119th median can sit beside a 120th rate. That's the participation trigger (`docs/backlog.md:119`), outside C4.
- **The sweep found nothing else.** It ran 15 searches over `app/`, `components/` and `lib/`: case-insensitive `119th`/`118th`/`120th`, bare `119`/`118` in `.tsx`, *Congress* near a number, and `ordinal(` with a literal. Everything else either derives from `getCurrentCongress()` or the data, or is a comment.
