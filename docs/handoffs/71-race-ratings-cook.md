# 71 — Race ratings (Cook, manual seed)

## What this is

Handoff 62 shipped `/race/[id]` as a stub. This handoff layers Cook Political Report ratings on top so the page actually answers "where does this race stand." Ratings ingest via a hand-curated JSON file committed to the repo, not an API — Cook's API is paywalled, and the roadmap explicitly anticipated manual seeding with a quarterly refresh cadence.

Scope is intentionally narrow: Cook ratings only for v1, all Senate races (34 in 2026), competitive House races only (toss-ups + leans, ~30-50 races), all governor races (~36 in 2026). Sabato and Inside Elections layer in later as additional rows.

## In scope

- New `race_ratings` table
- New `data/race-ratings-cook-2026.json` seed file with current Cook ratings
- New `scripts/seed-race-ratings.ts` to read the JSON and upsert
- Query helpers in `lib/queries.ts`: `getRaceRatings(raceId)`, `getMostCompetitiveRaces(limit)`
- Rating chip rendered on `/race/[id]`
- Rating chip extended onto the member hub "Seat up" indicator when applicable
- Migration step
- A `npm run seed:ratings` package.json entry

## Out of scope

- Sabato's Crystal Ball, Inside Elections, 270toWin scraping. Layer in later under the same schema.
- Automated scraping of cookpolitical.com. Terms-of-use risk, not justified for a personal project.
- Historical rating changes ("Lean R → Toss Up on 2026-03-12"). v1 stores the current rating only.
- Solid-rated House districts (370+ rows of "Solid D" / "Solid R" with zero analytical value). Skip them entirely.
- Race ratings dashboard / aggregate view (e.g. "show me all toss-ups"). The data supports it but the UI is its own handoff.

## Race ID assumptions

Handoff 62 introduced the `/race/[id]` route. The roadmap calls out the format as `state-district-cycle` (e.g. `CO-08-2026`). The seed JSON uses that format. **Verify against the actual race ID format used in the existing `races` table before running the seed.** If handoff 62 used a different format (e.g. `2026-CO-08`, `co-08-2026`), update the seed file's `race_id` keys to match. The seed is just data — adapting it is a find-replace, not a code change.

Senate races: `<STATE>-SEN-<CYCLE>` (e.g. `OH-SEN-2026`). Governor races: `<STATE>-GOV-<CYCLE>` (e.g. `OH-GOV-2026`). Verify against the existing races table.

## Schema

```sql
CREATE TABLE race_ratings (
  id TEXT PRIMARY KEY,              -- composite: race_id-source
  race_id TEXT NOT NULL,            -- FK to races.id (no FK constraint; loose link is fine)
  source TEXT NOT NULL,             -- 'cook' | 'sabato' | 'inside_elections'
  rating TEXT NOT NULL,             -- 'Solid D' | 'Likely D' | 'Lean D' | 'Toss Up' | 'Lean R' | 'Likely R' | 'Solid R'
  rating_score INTEGER NOT NULL,    -- -3..+3, see below; lets us sort competitiveness
  rating_date TEXT,                 -- ISO date when this rating was last set per the source
  source_url TEXT,                  -- direct link to the source page for verification
  cycle INTEGER NOT NULL,           -- 2026, 2028, etc.
  updated_at TEXT NOT NULL          -- when our seed last wrote this row
);

CREATE INDEX idx_ratings_race ON race_ratings(race_id);
CREATE INDEX idx_ratings_score ON race_ratings(rating_score);
```

`rating_score` is a numeric stand-in for sorting and querying competitiveness without parsing strings:

| Rating   | Score |
|----------|-------|
| Solid D  | -3    |
| Likely D | -2    |
| Lean D   | -1    |
| Toss Up  |  0    |
| Lean R   |  1    |
| Likely R |  2    |
| Solid R  |  3    |

`ABS(rating_score) <= 1` is the "competitive" filter (toss-ups + leans).

## Seed file

`data/race-ratings-cook-2026.json`:

```json
{
  "source": "cook",
  "cycle": 2026,
  "source_url_base": "https://www.cookpolitical.com/ratings",
  "ratings": [
    {
      "race_id": "ME-SEN-2026",
      "rating": "Toss Up",
      "rating_date": "2026-04-15",
      "source_url": "https://www.cookpolitical.com/ratings/senate-race-ratings"
    },
    {
      "race_id": "NC-SEN-2026",
      "rating": "Toss Up",
      "rating_date": "2026-04-15",
      "source_url": "https://www.cookpolitical.com/ratings/senate-race-ratings"
    }
  ]
}
```

Populate from:

- **Senate**: https://www.cookpolitical.com/ratings/senate-race-ratings — include all 34 races in the 2026 cycle.
- **House**: https://www.cookpolitical.com/ratings/house-race-ratings — include only races rated Toss Up, Lean D, or Lean R. Skip Solid and Likely on both sides.
- **Governor**: https://www.cookpolitical.com/ratings/governor-race-ratings — include all races in the 2026 cycle.

This is a one-time data entry pass. Open each ratings page side-by-side with the JSON file, populate rows one at a time. Expect 30-60 minutes of typing. Don't try to scrape — the formatting on Cook's site is interactive and not stable enough to script reliably for a one-shot.

`rating_date` is best-effort. If Cook doesn't show a per-race "last updated" timestamp, use the date you copied it. The seed script will store this verbatim.

Commit the JSON file. It's a data source the repo owns going forward.

## Seed script

`scripts/seed-race-ratings.ts`. Loads the JSON, maps each row to a `race_ratings` insert with:

- `id = race_id + '-' + source`
- `source = 'cook'`
- `rating_score` derived from a string→score lookup
- `updated_at = new Date().toISOString()`

Use `INSERT ... ON CONFLICT(id) DO UPDATE SET ...` so re-running the script (e.g. after a quarterly refresh) updates existing rows rather than erroring.

Print a summary at the end: `seeded N Cook ratings for cycle 2026 (X Senate, Y House, Z Governor)`. Useful sanity check.

Add `"seed:ratings": "tsx scripts/seed-race-ratings.ts"` to `package.json`.

## Queries

Add to `lib/queries.ts`:

```ts
export type RaceRating = {
  id: string;
  raceId: string;
  source: 'cook' | 'sabato' | 'inside_elections';
  rating: string;
  ratingScore: number;
  ratingDate: string | null;
  sourceUrl: string | null;
  cycle: number;
  updatedAt: string;
};

export async function getRaceRatings(raceId: string): Promise<RaceRating[]>;

export async function getMostCompetitiveRaces(
  cycle: number,
  limit: number
): Promise<Array<{ raceId: string; ratings: RaceRating[]; competitivenessScore: number }>>;
```

`getMostCompetitiveRaces` orders by `ABS(rating_score) ASC` across all sources, falling back on `updated_at DESC` for ties. Groups multi-source ratings by `race_id`. Returns toss-ups first, then leans, etc. Used later for a "most competitive 2026 races" dashboard cut; ships the query now so it's ready when the UI lands.

Cache both with `unstable_cache` tagged `race-ratings`, revalidate 24h. Manual seed means manual invalidation: a re-seed run should `revalidateTag('race-ratings')` via the existing manual revalidate route (`/api/revalidate?tag=race-ratings`).

Add `race-ratings` to the `ALLOWED_TAGS` constant in `app/api/revalidate/route.ts`.

## UI: `/race/[id]` rating chip

Add a `<RatingChip>` component (`components/RatingChip.tsx`):

```ts
type Props = { rating: RaceRating; size?: 'sm' | 'md' };
```

Rendering:

```
[COOK · TOSS UP]
```

- `COOK` label in 11px uppercase, `--text-muted`, letter-spacing 0.5px
- Rating in 12px (md) or 11px (sm), uppercase, color from the rating-color map below
- Background: transparent with a 1px border in the rating color at 40% opacity
- Optional `title` attribute with `rating_date` for hover detail

Color map (CSS vars):

| Rating   | Color                         |
|----------|-------------------------------|
| Solid D  | `--party-democrat`            |
| Likely D | `--party-democrat`            |
| Lean D   | `--party-democrat`            |
| Toss Up  | `--accent-amber-bright`       |
| Lean R   | `--party-republican`          |
| Likely R | `--party-republican`          |
| Solid R  | `--party-republican`          |

Toss-ups in amber so they pop visually against the partisan colors. The strength of the lean isn't carried in color — it's carried in the rating text itself ("LIKELY D" reads stronger than "LEAN D"). Don't add a third tint axis.

Place the chip in the header area of `/race/[id]`, near the existing seat-up year display. If multiple ratings exist (post-Sabato addition), render them inline separated by `·`: `[COOK · TOSS UP] · [SABATO · LEAN D]`. For v1 with Cook only, just the one chip.

If no rating exists for a race, render nothing — no "Not yet rated" placeholder. Most uncompetitive House districts won't have rows, which is the intended behavior.

## UI: member hub header indicator extension

The "Seat up 2026" indicator currently lives in the member hub header (per the roadmap's race surface description). Extend it: if a Cook rating exists for the member's race, show it inline.

Before:
```
[SEAT UP 2026]
```

After:
```
[SEAT UP 2026 · TOSS UP]
```

The `TOSS UP` segment uses the same rating color from the map above. Don't render the source name here — at the member-hub level it's a glance signal, not a source citation. Clicking the indicator already navigates to `/race/[id]` where the full chip with source attribution renders.

Implementation: extend the existing seat-up indicator component (introduced in handoff 60 or 62) to accept an optional `rating?: RaceRating` prop. The member hub page fetches the rating alongside the seat-up data and passes it through.

## SKILL.md updates

Add to the schema section: the `race_ratings` table.

Add a new subsection under "Frontend design system" → "Information architecture":

> **Race ratings**: source-attributed chips on `/race/[id]`. Member hub shows a glance-level extension on the seat-up indicator without source attribution. Sources currently include Cook (v1). Sabato and Inside Elections layer in as additional rows under the same schema.

Add to "Things to watch for":

- **Race ratings are hand-seeded.** `data/race-ratings-cook-2026.json` is the source of truth. Refresh quarterly by re-checking the three Cook pages (Senate, House, Governor) and updating the JSON, then running `npm run seed:ratings`. Cook updates ratings infrequently between cycles, so quarterly is more than enough.

## Verification

1. Migration runs clean. `race_ratings` table exists.
2. `npm run seed:ratings` runs without errors, prints the summary line.
3. `SELECT COUNT(*) FROM race_ratings WHERE source = 'cook' AND cycle = 2026;` — should land between 65 and 120 depending on how many House toss-ups + leans Cook is currently rating.
4. `/race/ME-SEN-2026` (or whichever Senate race is rated Toss Up) shows the `[COOK · TOSS UP]` chip in the header.
5. The member hub for that race's incumbent shows the extended seat-up indicator.
6. `/race/<some_safe_district>` (or any race without a rating row) renders with no chip — no placeholder, no errors.
7. Re-running `npm run seed:ratings` doesn't create duplicate rows (ON CONFLICT works).

## Don't

- Don't render a "Not yet rated" placeholder. The absence of a chip is the signal.
- Don't include solid-rated House races in the seed. They pad the table and add zero analytical value.
- Don't attempt to scrape cookpolitical.com. One-time manual entry is faster, more reliable, and avoids TOS questions.
- Don't add Sabato or Inside Elections in this handoff. Same schema later, separate seed file.
- Don't write a "all ratings" dashboard view. Query helper is ready; UI is a future handoff.
