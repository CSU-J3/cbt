# 73 — Sabato + Inside Elections rating sources

## What this is

Layers two more rater sources into `race_ratings` so race pages show multi-source agreement and disagreement at a glance. Same schema as handoff 71, just additional rows. Both seed files are pre-built and sourced from Wikipedia's 2026 Senate elections table (Sabato Jan 29 snapshot, IE Jan 12 snapshot).

Three small lift points beyond seeding:

1. The seed script reads one specific file. It needs to glob multiple.
2. Sabato uses `Safe` instead of `Solid` (e.g. `Safe R` instead of `Solid R`). The rating-to-score map and the rating-color map need to handle it.
3. Inside Elections uses `Tilt` as a tier between `Toss Up` and `Lean` (e.g. `Tilt D`). Same maps need to handle it.

## In scope

- Two new seed JSON files (provided as artifacts, drop in `data/`):
  - `data/race-ratings-sabato-2026.json`
  - `data/race-ratings-inside-elections-2026.json`
- Update `scripts/seed-race-ratings.ts` to glob `data/race-ratings-*.json` instead of reading one file
- Extend the rating-to-score map to handle `Safe D`/`Safe R` and `Tilt D`/`Tilt R`
- Extend the rating-color map in `RatingChip` to handle the new strings
- Update SKILL.md with the new rating tiers

## Out of scope

- House and Governor ratings for either source (still Senate-only, mirrors handoff 71)
- A fourth source. Three is enough for v1 consensus signal.
- Consensus calculation across sources (e.g. "all three call it Toss Up"). Defer until a races index page exists where the aggregate would actually surface.
- Updating the `getMostCompetitiveRaces` ordering. Current `MIN(ABS(rating_score))` already picks the most competitive rating across sources for tie-breaking.

## Rating-to-score additions

Existing 7-tier map:

| Rating   | Score |
|----------|-------|
| Solid D  | -3    |
| Likely D | -2    |
| Lean D   | -1    |
| Toss Up  |  0    |
| Lean R   |  1    |
| Likely R |  2    |
| Solid R  |  3    |

Add:

| Rating   | Score | Notes |
|----------|-------|-------|
| Safe D   | -3    | Sabato's label for Solid D — equivalent meaning |
| Safe R   |  3    | Same |
| Tilt D   | -1    | IE's tier between Toss Up and Lean; collapse with Lean for score purposes |
| Tilt R   |  1    | Same |

Tilt is functionally between Toss Up and Lean. We collapse to Lean for the integer score because (a) the column is INT, (b) the `ABS(rating_score) <= 1` competitive filter still catches it, and (c) the tie-breaker on `updated_at DESC` handles any ordering ambiguity within the same score. The rating string is preserved verbatim in the `rating` field, so chips still display `TILT D` to the user.

## Rating-color additions

The existing color map (per handoff 71):

| Rating   | Color                |
|----------|----------------------|
| Solid D  | `--party-democrat`   |
| Likely D | `--party-democrat`   |
| Lean D   | `--party-democrat`   |
| Toss Up  | `--accent-amber-bright` |
| Lean R   | `--party-republican` |
| Likely R | `--party-republican` |
| Solid R  | `--party-republican` |

Add:

| Rating   | Color                |
|----------|----------------------|
| Safe D   | `--party-democrat`   |
| Safe R   | `--party-republican` |
| Tilt D   | `--party-democrat`   |
| Tilt R   | `--party-republican` |

Same lean-direction color strategy. Tilt rows are still partisan-leaning, just more weakly. Toss Up remains the only amber state.

## Seed script update

`scripts/seed-race-ratings.ts` currently reads `data/race-ratings-cook-2026.json`. Change it to:

1. `glob('data/race-ratings-*.json')` — match any file with that prefix and `.json` extension
2. For each file, read the `source` field from the JSON top level
3. Upsert all rows for that source
4. Print a per-source summary line: `seeded N Cook ratings`, `seeded N Sabato ratings`, `seeded N Inside Elections ratings`
5. Print a final aggregate: `total: X rows across Y sources`

Unknown rating strings (anything not in the score map) should warn and skip, same as the current 71 behavior. After this handoff, unknown strings probably mean a fourth source got dropped in with a new vocabulary — that's a signal to update the score map, not a silent failure.

The `--source` CLI flag is unnecessary. The seed script being idempotent over the whole `data/` directory is simpler.

## File placement

The two seed files are pre-built and provided as artifacts in this handoff package. Drop them in `data/`:

- `data/race-ratings-sabato-2026.json`
- `data/race-ratings-inside-elections-2026.json`

Then run:

```
npm run seed:ratings
```

Same command as before. The script picks up all three files via the glob.

## Race ID alignment

Both seed files use the same `S-<STATE>-2026` format that handoff 71 settled on (post find-replace from the original `<STATE>-SEN-2026`). FL and OH specials already collapse to `S-FL-2026` and `S-OH-2026` because both states only have one Senate race in 2026. No find-replace needed for these seeds.

If 71's seed somehow used a different format than what these expect, both seeds need the same find-replace before running. Verify with one `cat data/race-ratings-cook-2026.json | head -20` if uncertain.

## UI: nothing changes

`RatingChip` from 71 already renders source-attributed chips. With three sources seeded, `/race/S-OH-2026` will render three chips in a row separated by `·`:

```
[COOK · TOSS UP] · [SABATO · LEAN R] · [IE · LEAN R]
```

Cook moved OH to Toss-Up on April 13; Sabato and IE were still calling it Lean R as of late January. That disagreement is the actual analytical signal — multi-source rendering surfaces it without adding any UI.

The `CompetitiveRacesBlock` from handoff 72 also auto-renders multi-source chips because the row's chip cell uses the same `RatingChip` mapping with no chip-count cap. With three sources, rows in that block become wider. That's fine; the rating cell is the dense end of the row and 180px fits three chips at `size='sm'`. If overflow shows up on narrow viewports, increase the chip cell to 240px and pull from the title cell.

## Verification

1. `npm run seed:ratings` prints three per-source summary lines plus an aggregate.
2. `SELECT source, COUNT(*) FROM race_ratings GROUP BY source ORDER BY source;` shows three rows: `cook=35`, `inside_elections=35`, `sabato=35`.
3. `/race/S-OH-2026` shows three chips: Cook Toss Up, Sabato Lean R, IE Lean R.
4. `/race/S-ME-2026` shows three chips: Cook Toss Up, Sabato Toss Up, IE Tilt R. The IE chip renders the `TILT R` text in red (republican color).
5. `/race/S-CO-2026` shows three chips, all safe/solid D — colored partisan blue regardless of source label.
6. The home dashboard `CompetitiveRacesBlock` rows now show three chips each; no row layout breaks.
7. `getMostCompetitiveRaces` ordering still puts toss-ups first. Tilt R rows (currently just ME via IE) sort with the leans.

## Don't

- Don't try to compute a "consensus" rating column. The disagreement between sources is the signal; collapsing it loses information.
- Don't add a fourth source. Three covers the major raters; more becomes noise.
- Don't backfill House or Governor ratings here. Same scope discipline as 71.
- Don't change the rating-score column to a decimal type to accommodate Tilt's "between" semantic. Integer + collapse-to-Lean is simpler and the sort behavior matches user intuition.
- Don't rename Sabato's `Safe` to `Solid` on ingest. Preserving the source's own vocabulary in the chip is part of why we attribute by source name.
