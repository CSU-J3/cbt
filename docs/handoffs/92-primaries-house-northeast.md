# 92 — Primary tracker phase 2: House Northeast region

## What this is

Phase 2 of the primary candidate tracker. HO 91 covered all 34 Senate 2026 races; this is the first of four House region handoffs, covering the Northeast: 76 districts across 9 states.

Same pattern as Senate: scrape Ballotpedia race pages, parse candidate rosters per party, upsert into the existing `primary_candidates` table, report match rate against `members`.

## In scope

- 9 states: CT (5), ME (2), MA (9), NH (2), NJ (12), NY (26), PA (17), RI (2), VT (1 at-large)
- 76 districts total
- All districts including uncontested
- New constant `HOUSE_DISTRICTS_NORTHEAST_2026` in the same file the Senate state list lives in
- New function `syncHouseCandidates(region: HouseRegion)` in `lib/sync.ts`
- New npm script entry `sync:house-primaries` that takes a `--region=` flag

## Out of scope

- South / Midwest / West (separate handoffs 93, 94, 95)
- Special elections (skip for now; if Ballotpedia returns a special-election page on the normal URL, log and move on — handle in follow-up if any districts hit it)
- Top-two / jungle / top-four parsing (none of those primary systems exist in the Northeast; defer to West/South handoffs)
- Schema changes (table already exists from HO 91)

## URL patterns

Numbered districts:
```
https://ballotpedia.org/{State_With_Underscores}%27s_{N}{ordinal}_Congressional_District_election,_2026
```

Examples:
- `https://ballotpedia.org/New_York%27s_1st_Congressional_District_election,_2026`
- `https://ballotpedia.org/Pennsylvania%27s_17th_Congressional_District_election,_2026`

At-large (VT only in this region):
```
https://ballotpedia.org/Vermont%27s_At-Large_Congressional_District_election,_2026
```

Ordinals: 1st, 2nd, 3rd, 4th–20th, 21st, 22nd, 23rd, 24th–30th. Build with a helper, don't hardcode.

## District counts to verify

| State | Districts |
|-------|-----------|
| CT    | 5         |
| ME    | 2         |
| MA    | 9         |
| NH    | 2         |
| NJ    | 12        |
| NY    | 26        |
| PA    | 17        |
| RI    | 2         |
| VT    | 1 (AL)    |
| **Total** | **76** |

If your scrape parses anything other than 76 attempts, the constant is wrong.

## Reuse from HO 91

- Candidate row parser (the regex / cheerio selector that pulls names + party + status off the Ballotpedia votebox markup) — reuse, don't rewrite
- Runoff deduplication logic — same logic applies; House primaries in some states have runoffs too
- Incumbent match against `members` table — same query, just by `state` + `district` + `cycle` instead of `state` + `cycle`

If the Senate parser is currently `parseSenateRace`, generalize to `parseHouseOrSenateRace(html, raceContext)` rather than copy-pasting. The race context tells the upsert whether to write `chamber='senate'` or `chamber='house'` and whether to set `district` or `null`.

## Validation

Print to stdout at the end of the run:

1. Total districts attempted (should be 76)
2. Districts parsed cleanly (X/76)
3. Districts that returned no candidates (URL miss or genuinely no filings yet — distinguish if possible)
4. Total candidates parsed
5. Incumbent matches against `members` (X/Y where Y is the count of Northeast incumbents in the members table)
6. Any incumbent in the members table for the Northeast that did NOT show up in the candidate scrape — flag for manual review (could be retiring, primary-challenged, redistricted, or scrape failure)

## Acceptance

- 76/76 districts parsed OR a clean failure list with URLs and HTTP status codes
- Candidate count in the same order of magnitude as the Senate run scaled by seat ratio (Senate 246 candidates / 34 races ≈ 7 per race; House Northeast should land roughly 400–600 candidates, less if many incumbents are running unchallenged)
- Incumbent match rate reported and any mismatches enumerated
- Ready to commit as `feat: primary tracker phase 2 - House Northeast (HO 92)`

## Notes

- Rate-limit politely. Ballotpedia tolerates slow scraping. ~1 request/sec is fine.
- Cache parsed HTML to disk during dev so a re-run doesn't hammer them.
- VT at-large URL may differ from the numbered pattern; verify by opening one in a browser first.
- NY-22 and other recently redistricted seats may have stale data. Note any oddities, don't try to fix them in this handoff.
