# 62 — Race surface MVP

## What this is

The `/race/[id]` hub. Every current member maps to exactly one race row, auto-derived from `members.next_election_year`, `state`, and `district`. Competitive races get a hand-curated layer (rating + candidate roster); safe seats stay minimal stubs showing incumbent + cycle. Closes the deferred bridge from handoff 60 — the `NEXT ELECTION YYYY` chip on the member hub becomes a link to the race page.

Theme 7 from the roadmap. First entity surface outside bills and members. Same architecture pattern as those: snapshot is the member-hub indicator, hub is `/race/[id]`, sub-pages (polling, fundraising, demographics) come later.

No new LLM calls. ~469 race rows auto-derived in a one-shot migration step.

## In scope

- Migration: `races` and `race_candidates` tables
- `scripts/backfill-races.ts` — derives 469 stub race rows from `members` table
- `data/races-seed.json` — empty scaffold for the hand-curated layer (ratings + candidate rosters)
- `scripts/seed-races.ts` — applies the seed JSON on top of auto-derived stubs
- Query helpers: `getRace(id)`, `getRaceCandidates(raceId)`
- `lib/format.ts` addition: `daysToElection(cycle)` and `electionDay(cycle)`
- New route `/race/[id]` — race hub page (server-rendered)
- New components: `RaceHeader.tsx`, `RaceCandidates.tsx`, `RaceIncumbentCard.tsx`
- `components/MemberHeader.tsx` update: `NEXT ELECTION YYYY` chip becomes a link to `/race/<id>` when the corresponding race row exists
- SKILL.md updates

## Out of scope

- Polling data, fundraising/FEC integration, district demographics. Future sub-pages.
- All 469 hand-curated. Only the ~50 competitive races get rating + candidates in v1; safe seats render as stubs.
- Cron integration for race refresh. Manual quarterly `pnpm seed:races` for now.
- Historical race results (2024 and earlier). Cycle-scoped to current and upcoming only.
- Primaries as separate races. v1 treats primary candidates as `status='running'` rows in the general-election race; primaries-as-pages can come later if signal demands it.
- District redistricting handling. Race IDs encode the current district; if SCOTUS or a state legislature redraws mid-decade, that's a future migration problem.
- Senators not up in the next cycle. Only races with at least one current member mapping get a row.

## Schema

Add to `scripts/migrate.ts`:

```sql
CREATE TABLE IF NOT EXISTS races (
  id TEXT PRIMARY KEY,                       -- "CO-08-2026" | "S-CO-2026"
  cycle INTEGER NOT NULL,                    -- 2026
  chamber TEXT NOT NULL,                     -- 'house' | 'senate'
  state TEXT NOT NULL,                       -- "CO"
  district INTEGER,                          -- null for Senate
  rating TEXT,                               -- 'safe_r' | 'likely_r' | 'lean_r' | 'tossup' | 'lean_d' | 'likely_d' | 'safe_d'
  rating_source TEXT,
  rating_updated_at TEXT,                    -- ISO date
  incumbent_bioguide_id TEXT REFERENCES members(bioguide_id),
  source_url TEXT,
  last_verified TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_races_cycle ON races(cycle);
CREATE INDEX IF NOT EXISTS idx_races_state ON races(state);
CREATE INDEX IF NOT EXISTS idx_races_chamber ON races(chamber);
CREATE INDEX IF NOT EXISTS idx_races_incumbent ON races(incumbent_bioguide_id);
CREATE INDEX IF NOT EXISTS idx_races_rating ON races(rating);

CREATE TABLE IF NOT EXISTS race_candidates (
  race_id TEXT NOT NULL REFERENCES races(id),
  name TEXT NOT NULL,
  party TEXT,                                -- 'R' | 'D' | 'I' | nullable
  bioguide_id TEXT REFERENCES members(bioguide_id),
  status TEXT,                               -- 'declared' | 'running' | 'won_primary' | 'withdrew'
  source_url TEXT,
  PRIMARY KEY (race_id, name)
);

CREATE INDEX IF NOT EXISTS idx_race_candidates_race ON race_candidates(race_id);
CREATE INDEX IF NOT EXISTS idx_race_candidates_bioguide ON race_candidates(bioguide_id);
```

Notes:

- `rating` is nullable until hand-curated. Stubs land with no rating; competitive races get rating + source in the seed pass.
- Rating enum is fixed at the seven Sabato categories. If we layer Cook later, store as a separate column rather than overloading.
- `race_candidates.bioguide_id` is filled only for the incumbent (links back to `members`); challengers stay name-only until they win their primary and join Congress.
- Primary key on `(race_id, name)` is the v1 simplification. If two candidates with identical names file in one race, hand-edit the seed to disambiguate ("John Smith (Sr.)" etc.); not worth a synthetic ID for an edge case that won't happen.

## Race ID format

- House: `<STATE>-<DD>-<YYYY>` (zero-padded district), e.g. `CO-08-2026`, `NY-14-2026`
- Senate: `S-<STATE>-<YYYY>`, e.g. `S-CO-2026`

Zero-padding sorts cleanly in list contexts and matches how Cook/Sabato write race names. Slug is descriptive enough to debug in logs without a lookup. Construction is deterministic from `members.state`, `members.district`, `members.chamber`, `members.next_election_year`.

## Backfill (`scripts/backfill-races.ts`)

One-shot derivation from `members`. Run via `pnpm backfill:races` (or `npm run backfill:races`).

```ts
import 'dotenv/config';
import { getDb } from '../lib/db';

async function main() {
  const db = getDb();

  const today = new Date().toISOString().slice(0, 10);

  const before = await db.execute('SELECT COUNT(*) as n FROM races');
  console.log(`Races before: ${before.rows[0].n}`);

  // Derive race rows from every member with a known next_election_year.
  // ON CONFLICT DO NOTHING so re-runs are idempotent and don't clobber
  // hand-curated rating/candidate data.
  const result = await db.execute({
    sql: `
      INSERT OR IGNORE INTO races
        (id, cycle, chamber, state, district, incumbent_bioguide_id, last_verified)
      SELECT
        CASE
          WHEN m.chamber = 'senate' THEN 'S-' || m.state || '-' || m.next_election_year
          ELSE m.state || '-' || printf('%02d', m.district) || '-' || m.next_election_year
        END AS id,
        m.next_election_year,
        m.chamber,
        m.state,
        CASE WHEN m.chamber = 'senate' THEN NULL ELSE m.district END,
        m.bioguide_id,
        ?
      FROM members m
      WHERE m.next_election_year IS NOT NULL
        AND m.state IS NOT NULL
        AND m.chamber IS NOT NULL
    `,
    args: [today],
  });

  console.log(`Inserted: ${result.rowsAffected}`);

  const after = await db.execute('SELECT COUNT(*) as n FROM races');
  console.log(`Races after: ${after.rows[0].n}`);

  // Sanity counts
  const byChamber = await db.execute(`
    SELECT chamber, COUNT(*) as n FROM races GROUP BY chamber
  `);
  for (const row of byChamber.rows) {
    console.log(`  ${row.chamber}: ${row.n}`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
```

Add to `package.json`:

```json
"backfill:races": "tsx scripts/backfill-races.ts"
```

Expected output after first run: ~435 House + ~33 Senate = ~468 race rows. Senate counts vary by cycle (only ~1/3 of seats are up each cycle). Exact numbers depend on how many House districts have an incumbent with `next_election_year` set; vacancies or recently-resigned seats may not map.

## Seed JSON scaffold (`data/races-seed.json`)

```json
{
  "races": []
}
```

Empty by design. User fills in entries hand-curated from Sabato's Crystal Ball (https://centerforpolitics.org/crystalball/2026-house/ and /2026-senate/), one per competitive race:

```json
{
  "id": "PA-01-2026",
  "rating": "tossup",
  "rating_source": "Sabato",
  "rating_updated_at": "2026-05-16",
  "source_url": "https://centerforpolitics.org/crystalball/2026-house/",
  "candidates": [
    { "name": "Brian Fitzpatrick", "party": "R", "bioguide_id": "F000466", "status": "running" },
    { "name": "Ashley Ehasz", "party": "D", "status": "declared" }
  ]
}
```

Target for v1 fill: the ~25-50 races Sabato rates anything other than `safe_r` / `safe_d`. Safe seats keep their auto-derived stub (rating null, no candidate roster beyond the incumbent that's already on `races.incumbent_bioguide_id`).

## Seed script (`scripts/seed-races.ts`)

```ts
import 'dotenv/config';
import { getDb } from '../lib/db';
import seed from '../data/races-seed.json';

const VALID_RATINGS = ['safe_r', 'likely_r', 'lean_r', 'tossup', 'lean_d', 'likely_d', 'safe_d'];

async function main() {
  const db = getDb();

  const knownRaceIds = new Set(
    (await db.execute('SELECT id FROM races')).rows.map(r => r.id as string)
  );

  let updated = 0;
  let candidatesInserted = 0;
  let missingRaces = 0;
  let invalidRatings = 0;

  for (const race of seed.races as any[]) {
    if (!knownRaceIds.has(race.id)) {
      console.warn(`  unknown race id '${race.id}' — skip`);
      missingRaces++;
      continue;
    }

    if (race.rating && !VALID_RATINGS.includes(race.rating)) {
      console.warn(`  ${race.id}: invalid rating '${race.rating}' — skip`);
      invalidRatings++;
      continue;
    }

    await db.execute({
      sql: `
        UPDATE races
        SET rating = ?, rating_source = ?, rating_updated_at = ?, source_url = ?, last_verified = ?
        WHERE id = ?
      `,
      args: [
        race.rating ?? null,
        race.rating_source ?? null,
        race.rating_updated_at ?? null,
        race.source_url ?? null,
        new Date().toISOString().slice(0, 10),
        race.id,
      ],
    });
    updated++;

    for (const c of race.candidates ?? []) {
      await db.execute({
        sql: `
          INSERT INTO race_candidates (race_id, name, party, bioguide_id, status, source_url)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(race_id, name) DO UPDATE SET
            party = excluded.party,
            bioguide_id = excluded.bioguide_id,
            status = excluded.status,
            source_url = excluded.source_url
        `,
        args: [race.id, c.name, c.party ?? null, c.bioguide_id ?? null, c.status ?? null, race.source_url ?? null],
      });
      candidatesInserted++;
    }
  }

  console.log(`Done. races_updated=${updated} candidates=${candidatesInserted} missing_races=${missingRaces} invalid_ratings=${invalidRatings}`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

Add to `package.json`:

```json
"seed:races": "tsx scripts/seed-races.ts"
```

Idempotent — re-running after editing the JSON is the quarterly refresh workflow.

## Date math (`lib/format.ts`)

Add two helpers:

```ts
/** General election day for a given cycle (first Tuesday after first Monday of November). */
export function electionDay(cycle: number): Date {
  // Find Nov 1, then walk to first Tuesday after first Monday.
  const nov1 = new Date(Date.UTC(cycle, 10, 1));
  const dow = nov1.getUTCDay(); // 0=Sun, 1=Mon
  const firstMondayOffset = (dow <= 1) ? (1 - dow) : (8 - dow);
  const firstMonday = new Date(Date.UTC(cycle, 10, 1 + firstMondayOffset));
  const electionDate = new Date(firstMonday);
  electionDate.setUTCDate(firstMonday.getUTCDate() + 1);
  return electionDate;
}

/** Days from today (UTC) to the general election for a cycle. Negative if past. */
export function daysToElection(cycle: number): number {
  const election = electionDay(cycle);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const ms = election.getTime() - today.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}
```

No date-fns. Same convention as `daysSince`.

## Query helpers (`lib/queries.ts`)

```ts
export interface Race {
  id: string;
  cycle: number;
  chamber: 'house' | 'senate';
  state: string;
  district: number | null;
  rating: string | null;
  rating_source: string | null;
  rating_updated_at: string | null;
  incumbent_bioguide_id: string | null;
  source_url: string | null;
  last_verified: string;
}

export interface RaceCandidate {
  race_id: string;
  name: string;
  party: 'R' | 'D' | 'I' | null;
  bioguide_id: string | null;
  status: string | null;
  source_url: string | null;
}

export async function getRace(id: string): Promise<Race | null>;
export async function getRaceCandidates(raceId: string): Promise<RaceCandidate[]>;
```

Both cached: `unstable_cache(..., ['race', id], { tags: ['races'], revalidate: 86400 })`. Tag is `races` (new); seed script can invalidate via the existing `/api/revalidate?tag=races` route — extend the route's allowed tags list to include `races` (currently accepts `bills` and `reports` per the open thread; this handoff bundles that small extension so we don't need yet another cleanup).

`getRace` returns null for unknown IDs. `getRaceCandidates` returns empty array for races without seeded candidates.

## Helper: deriving race ID from a member

`lib/race-id.ts` (new):

```ts
export interface MemberLite {
  chamber: 'house' | 'senate' | null;
  state: string | null;
  district: number | null;
  next_election_year: number | null;
}

export function raceIdFromMember(m: MemberLite): string | null {
  if (!m.chamber || !m.state || !m.next_election_year) return null;
  if (m.chamber === 'senate') return `S-${m.state}-${m.next_election_year}`;
  if (m.district == null) return null;
  return `${m.state}-${String(m.district).padStart(2, '0')}-${m.next_election_year}`;
}
```

Used by `MemberHeader` to build the link target and by the backfill script's SQL CASE expression as the authoritative format (the SQL is a translation of this function — keep them in sync if the format changes).

## Route: `/race/[id]` (`app/race/[id]/page.tsx`)

Server component. Params: `id`. Parallel fetches `getRace`, `getRaceCandidates`. If the race's `incumbent_bioguide_id` is non-null, also fetch `getMember(incumbent_bioguide_id)`.

If `getRace` returns null: render an empty-state block with `← BACK TO FEED` link. Don't use `notFound()`.

Layout:

```
HeaderBar (count area replaced with race name)
─────────────────────────────────────────────────────────────────────
← BACK

COLORADO 8TH CONGRESSIONAL DISTRICT
2026 GENERAL ELECTION · 174 DAYS TO ELECTION

RATING        TOSSUP
SOURCE        Sabato's Crystal Ball · updated 2026-05-08

─────────────────────────────────────────────────────────────────────
INCUMBENT

[PHOTO] GABE EVANS (R-CO-08)
        [VIEW MEMBER PROFILE →]

─────────────────────────────────────────────────────────────────────
CANDIDATES (3)

● R  Gabe Evans         Incumbent
● D  Yadira Caraveo     Declared
● D  Joe Salazar        Considering

─────────────────────────────────────────────────────────────────────
SOURCE: https://centerforpolitics.org/crystalball/2026-house/
Last verified 2026-05-16

FooterLegend
```

Component breakdown:

- **`RaceHeader`** (new) — race name (e.g. "Colorado 8th Congressional District" or "Texas Senate Seat"), cycle line with `daysToElection` countdown. 16px race name, 13px sub-line. If `daysToElection` is negative, show "Election concluded" instead of a negative countdown.
- **Rating block** — 12px uppercase labels (RATING, SOURCE), 14px values. Rating value styled with a colored chip matching party lean (R-leaning ratings use `--party-republican`, D-leaning use `--party-democrat`, tossup uses `--accent-amber`).
- **`RaceIncumbentCard`** (new) — 60x60 photo, name, party badge, `R-CO-08` style locator, button to `/sponsors/[bioguideId]`. Reuses the photo fallback pattern from `MemberHeader`. If `incumbent_bioguide_id` is null (open seat), render "OPEN SEAT" placeholder instead.
- **`RaceCandidates`** (new) — list of `race_candidates` rows. Each row: 3-char party indicator with party color dot, name, status. Reuses party color tokens. Empty state: "Candidate filings forthcoming" when no rows.
- **Footer source line** — `source_url` rendered as a clickable link, `last_verified` date in `--text-dim`.

Race name composition:

```ts
function raceName(r: Race): string {
  if (r.chamber === 'senate') return `${stateName(r.state)} Senate Seat`;
  const dist = String(r.district).padStart(2, '0');
  return `${stateName(r.state)} ${ordinal(r.district!)} Congressional District`;
}
```

`stateName('CO')` → "Colorado" via the same state map used in handoff 60's `sync-members` script. Move it to `lib/states.ts` so this handoff and the future race-page work share one source.

Layout container: full-width fluid, `px-4` gutter, same as `/sponsors/[bioguideId]`.

### Empty / safe states

- **No rating, no candidates** (auto-stub for safe seats): render incumbent block + "INCUMBENT RUNNING FOR RE-ELECTION" in muted text. No rating block, no candidate list, no source line. Single source URL at the bottom: "https://en.wikipedia.org/wiki/<state>'s_<district>th_congressional_district" as a fallback link (or just omit if not derivable).
- **Rating present, no candidates** (rated competitive but filings not yet collected): render rating block + "Candidate filings forthcoming" placeholder.
- **Open seat** (no `incumbent_bioguide_id`): incumbent block shows "OPEN SEAT" + reason if known ("Incumbent retired" / "Incumbent running for higher office"). Reason is free-text, optional `incumbent_note` could be added to schema later if it earns its place. v1 just renders the placeholder.

## Bridge: `MemberHeader` link

In `components/MemberHeader.tsx`, the meta line currently renders `NEXT ELECTION YYYY` as text (or "Former member" if the year is past). Wrap it in a link when a race row exists for that ID:

```tsx
import { raceIdFromMember } from '@/lib/race-id';

const raceId = raceIdFromMember(member);
const electionChip = raceId
  ? <Link href={`/race/${raceId}`} className="hover:text-[var(--accent-amber)]">NEXT ELECTION {member.next_election_year}</Link>
  : <span>NEXT ELECTION {member.next_election_year}</span>;
```

The header doesn't need to verify the race row actually exists — the backfill should produce one for every member with a non-null `next_election_year`. If a 404 happens (race row missing for some reason), the `/race/[id]` empty state handles it gracefully.

"Former member" path is unchanged (no link).

## SKILL.md updates

**Database schema**: add the `races` and `race_candidates` table blocks. Note the FK from `race_candidates.bioguide_id` and `races.incumbent_bioguide_id` to `members`.

**Pages** section: new entry.

> `/race/[id]` — race hub. Race name + cycle + days-to-election countdown. Rating block (from Sabato, hand-curated). Incumbent card linking to `/sponsors/<bioguide_id>`. Candidate roster. Stubs auto-derived from `members.next_election_year` for every current member; competitive races layer rating + candidates via `pnpm seed:races`. ID format: `<STATE>-<DD>-<YYYY>` for House, `S-<STATE>-<YYYY>` for Senate.

**New section: "Race surface"** (sibling to "Caucus affiliations"):

> v1 covers the upcoming cycle for every sitting member's seat. Stubs come from `pnpm backfill:races` (one-shot derivation from `members`). Ratings + candidate rosters are hand-curated in `data/races-seed.json` from Sabato's Crystal Ball, applied via `pnpm seed:races`. Refresh quarterly. Cook and Inside Elections are paywalled — skipped for v1. Polling, FEC fundraising, and district demographics are deferred sub-pages.

**Information architecture**: confirm the race hub thesis ("Who's contesting this seat and where does it stand?") and the now-shipped header bridge from member hubs.

**Backfill scripts**: add `pnpm backfill:races` and `pnpm seed:races`.

**Things to watch for**: add a line —

> Race IDs are derived deterministically from member data via `raceIdFromMember`. The backfill SQL is a translation of that function; if the format changes, update both. Mid-decade redistricting would require a migration to rewrite race IDs.

## Verification

1. `npm run migrate` — `races` and `race_candidates` tables exist with indexes.
2. `npm run backfill:races` — completes with ~468 inserted, `house: ~435 senate: ~33`. Re-running shows `Inserted: 0` (idempotent).
3. `SELECT id, state, district, incumbent_bioguide_id FROM races WHERE state='CO' AND cycle=2026` — should return ~9 rows (8 House + 1 Senate if a CO senator is up).
4. Hit `/race/CO-08-2026` (or whichever CO House race has a known incumbent). Page renders. Auto-stub state: no rating, "INCUMBENT RUNNING FOR RE-ELECTION" placeholder, incumbent card present, source line absent. Click `[VIEW MEMBER PROFILE →]` — lands on the incumbent's member hub.
5. On any member hub (e.g. `/sponsors/O000172`), the `NEXT ELECTION 2026` chip is a link. Hover shows amber. Click lands on the right race page.
6. Add one test entry to `data/races-seed.json` — pick AOC's race (`NY-14-2026`) with `rating: "safe_d"` and two candidates. Run `pnpm seed:races` — reports `races_updated=1 candidates=2`. Refresh `/race/NY-14-2026` — rating chip + candidate list render.
7. Hit `/race/garbage` — empty state with back link, no 500.
8. Visit a Senate race page like `/race/S-CO-2026` if applicable. Race name shows "Colorado Senate Seat", district line absent.
9. `pnpm build` — no warnings. Race route is dynamic (reads DB via params).

## Acceptance

`/race/[id]` resolves for every current member's upcoming election. Member hubs link to their race. Pipeline ready for hand-curated competitive-race fill-in as a follow-up sit-down. `revalidate` route accepts the new `races` tag.

After this: hand-curated competitive race fill-in (Sabato lookup — your sit-down, not Code's), then the next theme handoff. Default candidates per roadmap: one member-depth pipeline (donors via OpenSecrets or stocks via Capitol Trades/Unusual Whales), news signal (theme 4 — multi-handoff arc, unblocks reports' placeholder), or CCBT parity batch port. User picks.
