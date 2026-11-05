# HO 801: the election odds against the results. *Favorites won X of N* for the poster, the last pre-close book race by race, the drift across the three snapshots

> **Diagnostic-only, read-only.** `scripts/diagnostic/odds-results-801.ts --label 801`, run Nov 5, 1:06:58 AM MST (08:06:58Z) on `801-review` from `5e6a040`: prod by `SELECT` only, 5 statements, 6,251 `rows_read`, the schema fingerprint `4e94644350e1d992` before and after. The book is HO 787's third snapshot, `docs/probes/odds-snapshots/2026-11-03-1530-MT.json` (3:30 PM MST Nov 3, 22:30:03Z, the polls still open everywhere), committed by this HO beside the other two (9:30 PM MST Nov 2 and 7:30 AM MST Nov 3). The results are prod's `general_ballot` marks.

## The as-of, and why it will move

- The newest `read_at` among marked rows: Nov 4, 11:24:30 PM MST (06:24:30Z) prod-wide, Nov 4, 11:24:18 PM MST (06:24:18Z) over the rated races; the newest `general_ballot_reads.last_attempt_at`: Nov 4, 11:24:30 PM MST (06:24:30Z).
- Prod holds 387 races decided by one mark and 0 with two or more. **Ballotpedia is still calling races:** 38 of the 105 rated races read no mark at this as-of, so Monday Nov 9's `--label print` run may read more (backlog `:82`).

## For the poster chat

**Kalshi's favorites won 60 of 67** rated races called so far (89.6%): House 49 of 55, Senate 11 of 12. 5 favorites lost, and 2 more are on the hand list below, both of them winners by a nickname the rule won't guess. **Polymarket's won 11 of 12** of its 14 Senate races called. Where both books priced a race they backed the same candidate in 13 of 14, and the 14th is the hand list's S-SC. 38 rated races aren't called yet.

## The matching rule

- **A party favorite** (`favorite_is_party` 1) is matched on party: the winner's one-letter `party` against `favorite_party`.
- **A named favorite** is matched by name. Both names are lower-cased, diacritics folded, a period before a letter joined (*J.D.* is `jd`), other punctuation but hyphens dropped, the suffixes Jr, Sr, II, III and IV dropped, single-letter initials dropped while more than two tokens remain, and the first and the last remaining tokens kept (middle names dropped). Two names match when the last tokens are equal and the first tokens are equal or one is a prefix of the other, so a nickname used as a first name (*Andy* for *Andrew*) doesn't match.
- **The favorite is matched against every candidate on the race's ballot.** Matching the one marked row is *favorite won*; matching another row and not the marked one is *favorite lost*; matching no row, or more than one, is *unmatched* and goes to the hand list with both strings, never guessed. One mark decides the race, two or more make a *runoff*, none is *not called*.
- **The reading taken, flagged.** The handoff leaves open whether a named favorite is matched against the winner only. Under that narrower reading the 5 named losses read *unmatched* instead (Kalshi lost 0, unmatched 7), and *favorites won 60 of 67* doesn't move. This file takes the wider reading: a favorite who is on the ballot and not marked is a positive identification of a loss, not a guess. An independent recompute from the handoff's text (`docs/handoffs/801-artifacts/indep/recompute-801.mjs`) reached the same verdicts under the same reading, and the narrower ones under its own.

## Table 1: the last pre-close book against the marks

| Race | Chamber | Kalshi favorite (pct) | Polymarket favorite (pct) | Result | Kalshi | Polymarket |
|---|---|---|---|---|---|---|
| AK-AL-2026 | house | Nick Begich III (81) | — | not called | not called | — |
| AL-02-2026 | house | Shomari Figures (53) | — | Shomari Figures (D) | favorite won | — |
| AR-02-2026 | house | French Hill (76) | — | not called | not called | — |
| AZ-01-2026 | house | Amish Shah (81) | — | not called | not called | — |
| AZ-02-2026 | house | Eli Crane (56) | — | not called | not called | — |
| AZ-06-2026 | house | JoAnna Mendoza (91) | — | not called | not called | — |
| CA-06-2026 | house | Richard Pan (90) | — | Richard Pan (D) | favorite won | — |
| CA-13-2026 | house | Adam Gray (94) | — | Adam Gray (D) | favorite won | — |
| CA-21-2026 | house | Jim Costa (98) | — | Jim Costa (D) | favorite won | — |
| CA-22-2026 | house | Randy Villegas (93) | — | Randy Villegas (D) | favorite won | — |
| CA-45-2026 | house | Derek Tran (94) | — | Derek Tran (D) | favorite won | — |
| CA-48-2026 | house | Marni von Wilpert (96) | — | not called | not called | — |
| CO-03-2026 | house | Jeff Hurd (54) | — | not called | not called | — |
| CO-04-2026 | house | Lauren Boebert (68) | — | not called | not called | — |
| CO-05-2026 | house | Jeff Crank (53) | — | not called | not called | — |
| CO-08-2026 | house | Manny Rutinel (93) | — | Manny Rutinel (D) | favorite won | — |
| FL-07-2026 | house | Ryan Elijah (66) | — | not called | not called | — |
| FL-09-2026 | house | Dan Green (65) | — | not called | not called | — |
| FL-12-2026 | house | Gus Bilirakis (81) | — | Gus M. Bilirakis (R) | favorite won | — |
| FL-13-2026 | house | Anna Paulina Luna (77) | — | not called | not called | — |
| FL-14-2026 | house | Kathy Castor (73) | — | Kathy Castor (D) | favorite won | — |
| FL-16-2026 | house | Sydney Gruters (75) | — | Sydney Gruters (R) | favorite won | — |
| FL-22-2026 | house | Pia Dandiya (62) | — | Pia Dandiya (D) | favorite won | — |
| FL-25-2026 | house | Jared Moskowitz (85) | — | Jared Evan Moskowitz (D) | favorite won | — |
| FL-27-2026 | house | Maria Elvira Salazar (68) | — | not called | not called | — |
| IA-01-2026 | house | Christina Bohannan (93) | — | Christina Bohannan (D) | favorite won | — |
| IA-02-2026 | house | Lindsay James (72) | — | Lindsay James (D) | favorite won | — |
| IA-03-2026 | house | Sarah Trone Garriott (78) | — | Sarah Trone Garriott (D) | favorite won | — |
| IN-01-2026 | house | Frank Mrvan (98) | — | Frank Mrvan (D) | favorite won | — |
| IN-05-2026 | house | Victoria Spartz (74) | — | J.D. Ford (D) | favorite lost | — |
| KS-02-2026 | house | Derek Schmidt (79) | — | Derek Schmidt (R) | favorite won | — |
| KY-06-2026 | house | Zach Dembo (61) | — | Zach Dembo (D) | favorite won | — |
| MD-01-2026 | house | Andy Harris (84) | — | Andrew Harris (R) | unmatched | — |
| ME-02-2026 | house | Paul LePage (60) | — | not called | not called | — |
| MI-03-2026 | house | Hillary Scholten (97) | — | Hillary Scholten (D) | favorite won | — |
| MI-04-2026 | house | Sean McCann (62) | — | not called | not called | — |
| MI-07-2026 | house | William Lawrence (80) | — | not called | not called | — |
| MI-08-2026 | house | Kristen McDonald Rivet (98) | — | Kristen McDonald Rivet (D) | favorite won | — |
| MI-10-2026 | house | Christina Hines (77) | — | not called | not called | — |
| MN-01-2026 | house | Brad Finstad (61) | — | not called | not called | — |
| MN-02-2026 | house | Matt Little (96) | — | Matt Little (D) | favorite won | — |
| MO-02-2026 | house | Ann Wagner (61) | — | Frederick Wellman (D) | favorite lost | — |
| MT-01-2026 | house | Sam Forstag (60) | — | not called | not called | — |
| NC-01-2026 | house | Don Davis (84) | — | not called | not called | — |
| NC-03-2026 | house | Greg Murphy (61) | — | not called | not called | — |
| NC-11-2026 | house | Jamie Ager (88) | — | Jamie Ager (D) | favorite won | — |
| NE-01-2026 | house | Mike Flood (79) | — | not called | not called | — |
| NE-02-2026 | house | Denise Powell (94) | — | Denise Powell (D) | favorite won | — |
| NH-01-2026 | house | Stefany Shaheen (96) | — | Stefany Shaheen (D) | favorite won | — |
| NH-02-2026 | house | Maggie Goodlander (97) | — | Maggie Goodlander (D) | favorite won | — |
| NJ-02-2026 | house | Jeff Van Drew (53) | — | not called | not called | — |
| NJ-07-2026 | house | Rebecca Bennett (95) | — | Rebecca Bennett (D) | favorite won | — |
| NJ-09-2026 | house | Nellie Pou (97) | — | Nellie Pou (D) | favorite won | — |
| NM-02-2026 | house | Gabe Vasquez (93) | — | Gabriel Vasquez (D) | unmatched | — |
| NV-01-2026 | house | Dina Titus (97) | — | Dina Titus (D) | favorite won | — |
| NV-02-2026 | house | David Flippo (52) | — | not called | not called | — |
| NV-03-2026 | house | Susie Lee (94) | — | Susie Lee (D) | favorite won | — |
| NV-04-2026 | house | Steven Horsford (96) | — | Steven Horsford (D) | favorite won | — |
| NY-01-2026 | house | Nick LaLota (82) | — | not called | not called | — |
| NY-03-2026 | house | Tom Suozzi (93) | — | not called | not called | — |
| NY-04-2026 | house | Laura Gillen (96) | — | not called | not called | — |
| NY-17-2026 | house | Mike Lawler (51) | — | not called | not called | — |
| NY-19-2026 | house | Josh Riley (97) | — | Josh Riley (D) | favorite won | — |
| NY-21-2026 | house | Anthony Constantino (70) | — | not called | not called | — |
| OH-01-2026 | house | Greg Landsman (95) | — | Greg Landsman (D) | favorite won | — |
| OH-07-2026 | house | Brian Poindexter (86) | — | Brian Poindexter (D) | favorite won | — |
| OH-09-2026 | house | Marcy Kaptur (84) | — | Marcy Kaptur (D) | favorite won | — |
| OH-10-2026 | house | Mike Turner (70) | — | not called | not called | — |
| OH-13-2026 | house | Emilia Sykes (97) | — | Emilia Sykes (D) | favorite won | — |
| OH-15-2026 | house | Mike Carey (61) | — | Don Leonard (D) | favorite lost | — |
| OR-05-2026 | house | Janelle Bynum (97) | — | Janelle Bynum (D) | favorite won | — |
| PA-01-2026 | house | Bob Harvie (72) | — | Bob Harvie (D) | favorite won | — |
| PA-07-2026 | house | Bob Brooks (90) | — | Bob Brooks (D) | favorite won | — |
| PA-08-2026 | house | Paige Cognetti (87) | — | Paige Cognetti (D) | favorite won | — |
| PA-10-2026 | house | Janelle Stelson (84) | — | Janelle Stelson (D) | favorite won | — |
| PA-17-2026 | house | Chris Deluzio (98) | — | Chris Deluzio (D) | favorite won | — |
| S-AK-2026 | senate | D (Democratic party) (68) | Mary Peltola (70) | not called | not called | not called |
| S-GA-2026 | senate | Jon Ossoff (97) | Jon Ossoff (97) | Jon Ossoff (D) | favorite won | favorite won |
| S-IA-2026 | senate | Josh Turek (51) | Josh Turek (51) | Josh Turek (D) | favorite won | favorite won |
| S-KS-2026 | senate | Adam Hamilton (65) | Adam Hamilton (65) | Adam Hamilton (D) | favorite won | favorite won |
| S-ME-2026 | senate | Troy Jackson (70) | Troy Jackson (71) | Troy Dale Jackson (D) | favorite won | favorite won |
| S-MI-2026 | senate | Abdul El-Sayed (76) | Abdul El-Sayed (77) | Abdul El-Sayed (D) | favorite won | favorite won |
| S-MN-2026 | senate | Peggy Flanagan (91) | Peggy Flanagan (92) | Peggy Flanagan (D) | favorite won | favorite won |
| S-MS-2026 | senate | Cindy Hyde-Smith (87) | Cindy Hyde-Smith (87) | not called | not called | not called |
| S-NC-2026 | senate | Roy Cooper (98) | Roy Cooper (98) | Roy Cooper (D) | favorite won | favorite won |
| S-NE-2026 | senate | Pete Ricketts (72) | Pete Ricketts (72) | Pete Ricketts (R) | favorite won | favorite won |
| S-NH-2026 | senate | Chris Pappas (94) | Chris Pappas (95) | Chris Pappas (D) | favorite won | favorite won |
| S-OH-2026 | senate | Sherrod Brown (72) | Sherrod Brown (73) | Sherrod Brown (D) | favorite won | favorite won |
| S-SC-2026 | senate | Darline Graham (70) | Darline Graham Nordone (70) | Annie Andrews (D) | favorite lost | unmatched |
| S-TX-2026 | senate | James Talarico (75) | James Talarico (77) | James Talarico (D) | favorite won | favorite won |
| SC-01-2026 | house | Jenny Costa Honeycutt (53) | — | not called | not called | — |
| TX-09-2026 | house | Alex Mealer (76) | — | not called | not called | — |
| TX-15-2026 | house | Bobby Pulido (89) | — | Bobby Pulido (D) | favorite won | — |
| TX-23-2026 | house | Brandon Herrera (62) | — | Katy Padilla Stout (D) | favorite lost | — |
| TX-28-2026 | house | Henry Cuellar (93) | — | Henry Cuellar (D) | favorite won | — |
| TX-34-2026 | house | Vicente Gonzalez (92) | — | Vicente Gonzalez Jr. (D) | favorite won | — |
| TX-35-2026 | house | Johnny C. Garcia (75) | — | Johnny Garcia (D) | favorite won | — |
| VA-01-2026 | house | Shannon Taylor (75) | — | not called | not called | — |
| VA-02-2026 | house | Elaine Luria (95) | — | Elaine Luria (D) | favorite won | — |
| VA-05-2026 | house | John McGuire (64) | — | not called | not called | — |
| VA-07-2026 | house | Eugene Vindman (97) | — | Eugene Vindman (D) | favorite won | — |
| WA-03-2026 | house | Marie Gluesenkamp Perez (89) | — | not called | not called | — |
| WA-05-2026 | house | Michael Baumgartner (78) | — | not called | not called | — |
| WI-01-2026 | house | Mitchell Berman (53) | — | Mitchell Berman (D) | favorite won | — |
| WI-03-2026 | house | Rebecca Cooke (88) | — | Rebecca Cooke (D) | favorite won | — |

## Table 2: the counts

The share is won over called by one mark; the share of the decided (won over won and lost, the hand list out of the denominator) is beside it.

| Book · scope | Called | Won | Lost | Unmatched | Share | Of the decided | Runoff | Not called |
|---|---|---|---|---|---|---|---|---|
| Kalshi · all 105 | 67 | **60** | 5 | 2 | 89.6% | 92.3% | 0 | 38 |
| Kalshi · House 91 | 55 | **49** | 4 | 2 | 89.1% | 92.5% | 0 | 36 |
| Kalshi · Senate 14 | 12 | **11** | 1 | 0 | 91.7% | 91.7% | 0 | 2 |
| Polymarket · its 14 (Senate) | 12 | **11** | 0 | 1 | 91.7% | 100.0% | 0 | 2 |

By the favorite's `implied_pct` in the last book:

| Band | Kalshi rated · called · won · lost · unmatched · share | Polymarket rated · called · won · lost · unmatched · share |
|---|---|---|
| 50–59 | 10 · 3 · 3 · 0 · 0 · 100.0% | 1 · 1 · 1 · 0 · 0 · 100.0% |
| 60–69 | 17 · 6 · 3 · 3 · 0 · 50.0% | 1 · 1 · 1 · 0 · 0 · 100.0% |
| 70–79 | 23 · 14 · 12 · 2 · 0 · 85.7% | 7 · 6 · 5 · 0 · 1 · 83.3% |
| 80–89 | 17 · 10 · 9 · 0 · 1 · 90.0% | 1 · 0 · 0 · 0 · 0 · n/a |
| 90–100 | 38 · 34 · 33 · 0 · 1 · 97.1% | 4 · 4 · 4 · 0 · 0 · 100.0% |

## Table 3: the two books side by side

Each favorite was resolved to one candidate on the race's ballot first: a party favorite to the one on-ballot row of its party, a named one to the one row the rule matches. Then the two candidates were compared, never the two strings. The same candidate in **13 of 14**, differed in 0, unresolved in 1:

- **S-SC-2026, unresolved, for the hand list:** Kalshi *Darline Graham* (resolves to Darline Graham), Polymarket *Darline Graham Nordone* (resolves to no one candidate); the result Annie Andrews (D).
- S-AK's Kalshi favorite is the party (D, 68) and Polymarket's is Mary Peltola (70), the race's one D on the ballot: the same candidate, not called yet.

## The hand list (unmatched, never guessed)

- **MD-01-2026, Kalshi:** favorite *Andy Harris* (84). "Andy Harris" matches no ballot row; the winner reads "Andrew Harris". The ballot: Andrew Harris [marked]; Dan Schwartz; Edward Shlikas.
- **NM-02-2026, Kalshi:** favorite *Gabe Vasquez* (93). "Gabe Vasquez" matches no ballot row; the winner reads "Gabriel Vasquez". The ballot: Gabriel Vasquez [marked]; Greg Cunningham.
- **S-SC-2026, Polymarket:** favorite *Darline Graham Nordone* (70). "Darline Graham Nordone" matches no ballot row; the winner reads "Annie Andrews". The ballot: Annie Andrews [marked]; Catherine Fleming Bruce; Darline Graham; Kasie Whitener; Mark Hackett.

For the hand, not decided here: the first two read as the marked winner under a nickname (*Andy* for *Andrew*, *Gabe* for *Gabriel*); if the hand rules them the same people, Kalshi's count is 62 of 67. The third reads as the Kalshi favorite *Darline Graham*, on the ballot and unmarked, under a longer name; if the hand rules her the same person, Polymarket's count is 11 of 12 with 1 lost.

## Table 4: the drift across the three snapshots

The Kalshi favorite changed at one of the three snapshots (9:30 PM MST Nov 2, 7:30 AM and 3:30 PM MST Nov 3) in these rated races:

| Race | | The three favorites and implied_pct | Result |
|---|---|---|---|
| AL-02-2026 | end to end | Rhett Marques 51 → Shomari Figures 54 → Shomari Figures 53 | favorite won |
| CO-03-2026 | and back | Jeff Hurd 62 → Dwayne Romero 51 → Jeff Hurd 54 | not called |
| NY-17-2026 | end to end | Cait Conley 55 → Cait Conley 57 → Mike Lawler 51 | not called |

The ten biggest moves in `implied_pct` (the 3:30 PM Nov 3 number less the 9:30 PM Nov 2 one, each the favorite's own number at the time; every race tied with the tenth kept):

| Race | 9:30 PM Nov 2 → 7:30 AM → 3:30 PM Nov 3 | Move | Result |
|---|---|---|---|
| NJ-02-2026 | 68 → 58 → 53 | -15 | not called |
| NV-02-2026 | 65 → 66 → 52 | -13 | not called |
| FL-22-2026 | 72 → 67 → 62 | -10 | favorite won |
| FL-13-2026 | 68 → 78 → 77 | +9 | not called |
| TX-09-2026 | 67 → 74 → 76 | +9 | not called |
| CO-03-2026 | 62 → 51 → 54 | -8 | not called |
| VA-01-2026 | 68 → 75 → 75 | +7 | not called |
| FL-27-2026 | 62 → 65 → 68 | +6 | not called |
| IA-03-2026 | 84 → 84 → 78 | -6 | favorite won |
| PA-01-2026 | 66 → 64 → 72 | +6 | favorite won |
| TX-23-2026 | 56 → 64 → 62 | +6 | favorite lost |

A star (`*`) marks a race whose two end numbers are two candidates'; 0 of the 11 printed are. CO-03's 51 is Dwayne Romero's, the middle snapshot only.

## The controls

- In each snapshot, the rated index's length equals `counts.rated_index.N` (105), the Kalshi rows `counts.kalshi_odds` (469) and the Polymarket rows `counts.polymarket_odds` (34); the rated index is the same 105 races in all three.
- Planted in memory, never written: a favorite's name altered (AL-02-2026) read *unmatched*; the winner's own name planted read *favorite won*; a party favorite set against the winner's party (AL-02-2026) read *favorite lost*, and set to it, *favorite won*. All four as required.
- The matcher's own vectors: 17 of 17 as expected (`docs/handoffs/801-artifacts/name-vectors.ts`), among them *Nick Begich III* ~ *Nick Begich*, *C. Mia Pettus* ~ *Mia Pettus*, *J.D. Ford* not ~ *David Ford*, *Andy Harris* not ~ *Andrew Harris*.

## The ledger

The record run: 5 statements, 6,251 `rows_read`, the fingerprint unchanged. Its input rows are kept beside its log (`docs/handoffs/801-artifacts/odds-801-ballot.tsv`), so the verdicts can be recomputed without prod. A dev run (`--label dev`, 6:35 PM MST Nov 4) and its review preceded it; the record supersedes them.
