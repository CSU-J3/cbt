# 93 — Primary tracker phase 3: House South region

## What this is

Phase 3 of the primary candidate tracker. Same pattern as HO 92, applied to the South: 16 states, 164 districts. Reuse the `parseCandidatesPage` extraction from HO 92; only the district list and a Louisiana sanity check differ.

## In scope

- 16 states: AL (7), AR (4), DE (1 at-large), FL (28), GA (14), KY (6), LA (6), MD (8), MS (4), NC (14), OK (5), SC (7), TN (9), TX (38), VA (11), WV (2)
- 164 districts total
- Populate `HOUSE_DISTRICTS_BY_REGION.south` in `scripts/sync-primaries.ts` (the dispatch table already exists from HO 92; just fill the south key)
- Run via `npm run sync:house-primaries -- --region=south`

## Out of scope

- Runoff scraping. Several southern states (AL, AR, GA, MS, OK, SC, TX) hold runoff primaries if no candidate clears the threshold. Initial filing rosters are what we want; runoffs are a derivative we can handle later if useful.
- Fusion / cross-filing edge cases (not present in this region).
- Midwest / West (HO 94, 95).

## Louisiana — verify before scraping

LA recently changed its federal primary system. Before kicking off the full south run, manually open one LA district page in a browser:

```
https://ballotpedia.org/Louisiana%27s_1st_Congressional_District_election,_2026
```

Three possible states:

1. **Standard closed partisan primary format** (Republican primary section + Democratic primary section, same shape as every other state in the region). Include LA in the main run.
2. **Jungle primary format** (single ballot with all candidates regardless of party, no per-party sections). Skip LA-1 through LA-6 in this handoff and flag for a parser branch in a follow-up HO 93.5. Document the format you saw.
3. **Page exists but is empty / placeholder.** Treat same as RI-01 from HO 92 — log as a data gap, include in attempt count, expect 0 candidates.

Do not scrape LA blind. The 2024 LA legislative session changed this and Ballotpedia may have either format.

## URL patterns

Same as HO 92:

- Numbered: `https://ballotpedia.org/{State_With_Underscores}%27s_{N}{ordinal}_Congressional_District_election,_2026`
- At-large (DE only in this region): `https://ballotpedia.org/Delaware%27s_At-Large_Congressional_District_election,_2026`

TX runs 1 through 38 — the ordinal helper from HO 92 already covers it.

## District count table

| State | Districts |
|-------|-----------|
| AL    | 7         |
| AR    | 4         |
| DE    | 1 (AL)    |
| FL    | 28        |
| GA    | 14        |
| KY    | 6         |
| LA    | 6 (verify first — see above) |
| MD    | 8         |
| MS    | 4         |
| NC    | 14        |
| OK    | 5         |
| SC    | 7         |
| TN    | 9         |
| TX    | 38        |
| VA    | 11        |
| WV    | 2         |
| **Total** | **164** |

If LA gets deferred, the attempt count is 158. Either is acceptable; just print which case applied.

## Reuse from HO 92

- `parseCandidatesPage(html, state, url)` — unchanged
- `houseDistrictUrl()` — unchanged
- `ordinal()` — unchanged
- 3-attempt fetch retry — unchanged
- Disk HTML cache under `.cache/` — unchanged
- Incumbent matcher with last-name + multi-word surname handling from HO 92 — unchanged
- `primaries` row creation alongside `primary_candidates` — unchanged

This handoff should be a data-and-dispatch addition, not a parser change. If you find yourself editing `parseCandidatesPage`, stop and report back — that's a sign LA needs a branch and we should scope it separately.

## Validation

Same six prints as HO 92:

1. Districts attempted (164 or 158 depending on LA decision)
2. Parsed cleanly (X/N)
3. Districts with no candidates (URL miss vs genuine data gap, distinguished)
4. Total candidates parsed
5. Incumbent matches (X/N where N is southern incumbents in `members`)
6. Unmatched incumbents — flag for spot-check (retirements, other-office runs, redistricting)

## Acceptance

- Either 164/164 or 158/158 parsed, with LA decision documented in the run output
- Candidate count in the expected ballpark (HO 92 was 323 over 76 districts ≈ 4.25/district; expect 600-900 for the south, less if LA defers and less still if uncontested-incumbent rate stays high)
- Incumbent match rate reported and any mismatches enumerated
- Ready to commit as `feat: primary tracker phase 3 - House South (HO 93)`

## Notes

- TX at 38 districts is the single largest state. Same scrape pattern, just more volume — should add ~3 minutes to the run.
- WV-2 redistricted aggressively in 2022; expect at most one incumbent match there.
- FL-28 covers a lot of recently-drawn districts; spot-check that the URL pattern works on FL-26, FL-27, FL-28 (the highest numbers).
- If Ballotpedia rate-limits during the TX block specifically, add a per-state pause between states rather than dropping the per-request delay.
