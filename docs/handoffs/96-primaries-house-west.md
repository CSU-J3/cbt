# 96 — Primary tracker phase 5: House West region

## What this is

Final regional handoff for the House primary tracker. West is 104 districts across 13 states — the largest region by volume (CA alone is 52) and the only one needing new parser branches. Two non-partisan primary systems live in this region:

- **Top-two** (CA, WA): all candidates from all parties on one ballot, top two regardless of party advance.
- **Top-four** (AK): single nonpartisan ballot, top four advance to a ranked-choice general.

Partisan parser from HO 92/93/95 handles the other 10 states unchanged.

After this lands, all four House regions plus Senate (HO 91) are in. Phase 6 work — runoffs, LA jungle (HO 93.5), automated cron — is separate.

## In scope

- 13 states, 104 districts
- Two new parser variants: `parseTopTwoPage()`, `parseTopFourPage()`
- Per-state dispatch in `scrapeHouseCandidates()` selecting the right parser
- Populate `HOUSE_DISTRICTS_BY_REGION.west` in `scripts/sync-primaries.ts`
- Run via `npm run sync:house-primaries -- --region=west`

## Out of scope

- LA jungle parser (HO 93.5, separate)
- Runoff scraping (none of the West states have congressional runoffs)
- Cron wiring (still manual; HO 92 open thread)
- UI changes — primaries surface from HO 91 picks up the new rows automatically

## District count table

| State | Districts | Primary type |
|-------|-----------|--------------|
| AK    | 1 (AL)    | top-four     |
| AZ    | 9         | partisan     |
| CA    | 52        | top-two      |
| CO    | 8         | partisan     |
| HI    | 2         | partisan     |
| ID    | 2         | partisan     |
| MT    | 2         | partisan     |
| NV    | 4         | partisan     |
| NM    | 3         | partisan     |
| OR    | 6         | partisan     |
| UT    | 4         | partisan     |
| WA    | 10        | top-two      |
| WY    | 1 (AL)    | partisan     |
| **Total** | **104** | — |

Top-two: 62 districts (CA 52 + WA 10). Top-four: 1 district (AK AL). Partisan: 41 districts.

## URL patterns

Same convention as HO 92/93/95:

- Numbered: `https://ballotpedia.org/{State_With_Underscores}%27s_{N}{ordinal}_Congressional_District_election,_2026`
- At-large (AK, WY): `https://ballotpedia.org/{State}%27s_At-Large_Congressional_District_election,_2026`

Spot-check before kicking off the regional run:

- `https://ballotpedia.org/California%27s_1st_Congressional_District_election,_2026`
- `https://ballotpedia.org/Washington%27s_3rd_Congressional_District_election,_2026`
- `https://ballotpedia.org/Alaska%27s_At-Large_Congressional_District_election,_2026`

If any of those three return empty or a redirect, flag before writing the full state lists. Ballotpedia's race-page lag pattern from HO 92 (RI-01, AR-01, etc.) likely also catches a few CA pages — log and continue.

## Parser branches

### Existing: partisan (HO 92/93/95)

`parseCandidatesPage()` extracts per-party candidate sections from Ballotpedia's standard "Democratic primary" / "Republican primary" headings. No change. Used by 10 of the 13 West states.

### New: top-two (CA + WA)

Ballotpedia top-two pages don't split candidates by party section — there's a single combined list with party preference shown per candidate (typically as `(D)`, `(R)`, `(NPP)`, etc. in the candidate name or an adjacent column). One `primaries` row per district covers the whole field; `party` per candidate stays meaningful as "party preference" but isn't the partition key the way it is for partisan primaries.

Implementation suggestion (verify against actual page structure):

- New function `parseTopTwoPage(html, state, district, url)` returning a single race with all candidates flagged.
- Extract party preference from the candidate name suffix (`Smith (D)`) or whatever adjacent markup Ballotpedia uses. Fall back to `null` party rather than skipping the candidate.
- Schema check: confirm the existing `primaries` table can hold a single-race-per-district row. If the existing shape is `(district, party)` keyed, you'll need either a sentinel party value (`top-two`) or a schema tweak. Decide once, document the choice.

Before writing the parser, fetch one CA page and one WA page (web_fetch or curl) and look at the actual section structure. Don't pattern-match off memory.

### New: top-four (AK)

Same shape as top-two but a single nonpartisan primary feeding a ranked-choice general. AK has exactly one district (at-large), so this branch runs once. Even if it's slightly broken, the blast radius is one race.

- New function `parseTopFourPage(html, state, district, url)` — likely a near-clone of `parseTopTwoPage()` with no top-N cap on candidate count. Top-four is the general's seat count, not a primary cap; the primary lists everyone who filed.
- If the AK page structure turns out to be identical to CA/WA, collapse the two parsers into one `parseNonpartisanPage()` and key behavior off state. Don't write two functions if one fits.

### Dispatch

In `scrapeHouseCandidates()` (or wherever the region loop lives):

```ts
function pickParser(state: string) {
  if (state === 'CA' || state === 'WA') return parseTopTwoPage;
  if (state === 'AK') return parseTopFourPage; // or parseNonpartisanPage
  return parseCandidatesPage;
}
```

Keep this in one place. Don't sprinkle state checks through the loop.

## Reuse from HO 92/93/94/95

- `houseDistrictUrl()` and `ordinal()` unchanged
- Retry + HTML cache unchanged (huge for CA — 52 districts, a parser bug shouldn't re-hit the network)
- Incumbent matcher with name-within-state fallback from HO 94 — should clear most edge cases automatically
- Existing `primaries` upsert logic — adjust only if the schema needs a sentinel party value for top-two/top-four

## Validation

Standard six prints, plus three sanity checks for the new branches:

1. Districts attempted (104)
2. Parsed cleanly (X/104)
3. Districts with no candidates (URL miss vs genuine data gap)
4. Total candidates parsed (CA dominates — expect 200-400 from CA alone if top-two pages list 4-8 per district)
5. Incumbent matches (X/N where N is West House incumbents in `members`)
6. Unmatched incumbents — enumerate; report short

Plus:

7. **CA-only**: rows-parsed / rows-expected ≥ 50/52
8. **WA-only**: rows-parsed / rows-expected ≥ 9/10
9. **AK**: confirm exactly one race, candidate count ≥ 3 (Sullivan-era Senate top-four pulled 5-7 candidates; House should be similar)

If any of those three drops below threshold, the parser branch likely has a bug and CA's 52 races aren't a place to debug blindly. Stop and flag.

## Acceptance

- 104/104 parsed or a clean failure list with URLs + HTTP codes
- CA, WA, AK match rates against per-state expectations above
- Match rate against `members` clearly above HO 93's pre-fallback baseline (West has no known mid-decade redraw, so this should be the cleanest match rate of the four regions)
- Ready to commit as `feat: primary tracker phase 5 - House West (HO 96)`

## Notes

- **CA volume.** 52 districts is the biggest single-state load in the project. Run with the standard pacing; the cache will save you on re-runs.
- **CA redistricting.** Independent commission map, stable since 2022. No expected redraw drag on match rate.
- **WA top-two structure.** Identical system to CA but the Ballotpedia page templates may have drifted. Verify one WA page structure matches one CA page structure before writing one parser to cover both.
- **AK at-large URL.** Verify the at-large URL pattern from HO 92 (VT) and HO 95 (ND/SD/WY) holds for AK. Likely yes.
- **HI, NV closed primaries.** Same partisan structure as everywhere else; the closed/open distinction matters for voters, not for parser logic.
- **Higher-office exits.** 2026 cycle has several West House members running for Senate, Governor, or retiring. Expect a handful of unmatched incumbents that are legitimate exits, not parser failures (HO 95 pattern).
- **End of regional phase.** With this in, the four-region House sweep is complete. Phase 6 candidate work (LA jungle, runoffs, cron) sits in its own queue.
