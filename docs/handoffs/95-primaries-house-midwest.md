# 95 — Primary tracker phase 4: House Midwest region

## What this is

Phase 4 of the primary candidate tracker. Same pattern as HO 92/93, applied to the Midwest: 12 states, 91 districts. No parser branches expected — Midwest runs standard closed or semi-closed partisan primaries across all 12 states (no top-two, no jungle, no top-four). Cleanest remaining region.

The matcher fallback from HO 94 is now in place, so any latent redraw mismatches resolve automatically.

## In scope

- 12 states: IL (17), IN (9), IA (4), KS (4), MI (13), MN (8), MO (8), NE (3), ND (1 at-large), OH (15), SD (1 at-large), WI (8)
- 91 districts total
- Populate `HOUSE_DISTRICTS_BY_REGION.midwest` in `scripts/sync-primaries.ts`
- Run via `npm run sync:house-primaries -- --region=midwest`

## Out of scope

- Runoff scraping (none of these states have runoffs anyway)
- House West (HO 96 — AK top-four + CA top-two parser branches)
- LA jungle parser (HO 93.5)

## URL patterns

Same as HO 92/93:

- Numbered: `https://ballotpedia.org/{State_With_Underscores}%27s_{N}{ordinal}_Congressional_District_election,_2026`
- At-large (ND and SD in this region): `https://ballotpedia.org/{State}%27s_At-Large_Congressional_District_election,_2026`

## District count table

| State | Districts |
|-------|-----------|
| IL    | 17        |
| IN    | 9         |
| IA    | 4         |
| KS    | 4         |
| MI    | 13        |
| MN    | 8         |
| MO    | 8         |
| NE    | 3         |
| ND    | 1 (AL)    |
| OH    | 15        |
| SD    | 1 (AL)    |
| WI    | 8         |
| **Total** | **91** |

## Reuse from HO 92/93/94

Everything. No new infrastructure expected:

- `parseCandidatesPage()` unchanged
- `houseDistrictUrl()` and `ordinal()` unchanged
- Retry + HTML cache unchanged
- `primaries` row creation unchanged
- Incumbent matcher with name-within-state fallback from HO 94 — should pick up any redraw cases automatically

If you find yourself touching the parser or matcher, stop and flag. Midwest should be data-and-dispatch only.

## Validation

Same six prints:

1. Districts attempted (91)
2. Parsed cleanly (X/91)
3. Districts with no candidates (URL miss vs genuine data gap)
4. Total candidates parsed (expect ~400-550 at HO 92's ~4.25/district rate, ~450-650 at HO 93's ~6.0/district rate — midwest is somewhere between)
5. Incumbent matches (X/N where N is midwest House incumbents in `members`)
6. Unmatched incumbents — enumerate; should be a short list given (a) no redraws in Midwest and (b) the matcher fallback is now in place

## Acceptance

- 91/91 parsed or a clean failure list with URLs + HTTP codes
- Match rate clearly higher than HO 93's pre-fallback baseline (no redraw drag here)
- Ready to commit as `feat: primary tracker phase 4 - House Midwest (HO 95)`

## Notes

- ND and SD at-large pages: verify URL format once. VT's at-large URL pattern worked in HO 92; same convention should hold.
- IL is the volume state at 17 districts; pacing-wise it's nothing compared to TX-38.
- OH's 15 districts have been stable since 2022. No expected weirdness.
- Watch for the same Ballotpedia race-page-lag pattern (RI-01, AR-01, AR-03, NC-02) — if a few midwestern pages return empty, log them and move on; the SKILL.md note already covers this.
