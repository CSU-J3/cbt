# 63 — Senator next_election_year fix

## What this is

Handoff 62's race backfill produced 51 senate races instead of the ~100 expected. Root cause traced to handoff 60's term derivation: for every senator, `current_term_end_year` is read as `startYear + 6` where `startYear` comes from the most recent term entry — and that entry's startYear is actually the Congress's start year (2025), not the senator's term start. Every current senator collapses to `next_election_year = 2030`, causing 49 collisions on `(state, next_election_year)` in the race backfill's `INSERT OR IGNORE`.

This handoff fixes the derivation, recomputes `next_election_year` for all senators from already-stored `terms_json` (no API calls), drops the stale senate races, re-runs the backfill, and updates `scripts/sync-members.ts` so the fix sticks for future syncs.

Single-handoff bundle. Data-only patch — no schema changes, no UI work, no LLM calls.

## In scope

- Diagnostic step: dump `terms_json` for one known senator to confirm API response shape
- New helper `lib/derive-term.ts` — pure function for senate term start derivation, exported so `sync-members.ts` and the fix-up script share one source of truth
- New script `scripts/fix-senate-term-years.ts` — re-derives and updates `current_term_end_year` + `next_election_year` in place for all senators, then deletes stale senate races
- Update `scripts/sync-members.ts` to use the new helper for future sync runs
- Re-run `npm run backfill:races` (should produce ~49 new senate stubs)
- SKILL.md note: a watch-out under the existing "Things to watch for" about senate term derivation

## Out of scope

- Re-fetching members from the Congress.gov API. `members.raw_json` is stored and sufficient.
- Touching House member records. Two-year House terms align with two-year Congresses, so the current derivation works correctly for them.
- Schema changes. The `current_term_end_year` and `next_election_year` columns already exist.
- Touching the auto-derived `race_candidates` rows. Senate races don't have hand-curated candidates yet (empty `data/races-seed.json`), so the delete-and-recreate flow is safe.

## Diagnostic (do this first)

Run this to see the actual `terms_json` shape for a known long-tenured senator:

```ts
// scripts/inspect-senator-terms.ts (one-off, can delete after)
import 'dotenv/config';
import { getDb } from '../lib/db';

async function main() {
  const db = getDb();
  const res = await db.execute({
    sql: 'SELECT bioguide_id, name, terms_json FROM members WHERE bioguide_id = ?',
    args: ['S000033'], // Bernie Sanders — known long-tenured, last re-elected 2024
  });
  console.log(JSON.stringify(JSON.parse(res.rows[0].terms_json as string), null, 2));
}
main();
```

Or just inline the query in a SQL prompt — the goal is to see what fields each term entry has.

**Two possible shapes:**

1. **Per-Congress (most likely)**: each term entry covers one Congress, so a senator currently in their second term has multiple entries:
   ```json
   [
     { "startYear": 2025, "endYear": 2027, "chamber": "Senate", "congress": 119 },
     { "startYear": 2023, "endYear": 2025, "chamber": "Senate", "congress": 118 },
     { "startYear": 2021, "endYear": 2023, "chamber": "Senate", "congress": 117 },
     { "startYear": 2019, "endYear": 2021, "chamber": "Senate", "congress": 116 }
   ]
   ```
   The senator's actual current term started 2019 (or whenever the gap appears walking back). The fix walks backwards through contiguous entries.

2. **Per-actual-term (less likely, but possible)**: one entry per 6-year senate term:
   ```json
   [
     { "startYear": 2019, "endYear": 2025, "chamber": "Senate" },
     { "startYear": 2013, "endYear": 2019, "chamber": "Senate" }
     ...
   ]
   ```
   If this is the shape, the bug is elsewhere — possibly that `endYear` is being overwritten by the chamber-+-startYear fallback when it's actually present. Investigate why the derivation in `sync-members.ts` isn't picking it up.

**The diagnostic decides which fix branch to write.** Adapt the helper below to match the actual shape.

## Helper (`lib/derive-term.ts`)

Pure functions, no DB access. Pulled out so `sync-members.ts` and the fix-up script can share.

```ts
interface Term {
  startYear: number;
  endYear?: number;
  chamber?: string;
  congress?: number;
}

/**
 * For senators: find the actual current-term start year by walking backwards
 * through contiguous senate term entries. Each Congress is 2 years, so a
 * 6-year senate term may appear as 3 contiguous entries in the API response.
 */
export function senateTermStart(terms: Term[]): number | null {
  const senate = terms
    .filter(t => (t.chamber ?? '').toLowerCase().includes('senate'))
    .sort((a, b) => b.startYear - a.startYear);

  if (senate.length === 0) return null;

  // Walk backwards from the most recent. The current term started where the
  // contiguous run breaks (or at the oldest entry if uninterrupted).
  let termStart = senate[0].startYear;
  for (let i = 1; i < senate.length; i++) {
    const prev = senate[i];
    if (prev.startYear === termStart - 2) {
      termStart = prev.startYear;
    } else {
      break;
    }
  }
  return termStart;
}

/** Senate election year for a term: election is the year before the term ends. */
export function senateNextElection(termStart: number): number {
  return termStart + 5;
}

/** End year of the current senate term: 6 years after term start. */
export function senateTermEnd(termStart: number): number {
  return termStart + 6;
}

/**
 * For House members: derivation matches the existing logic (2-year term = 1 Congress).
 * Exported here so sync-members.ts has one place for all term math.
 */
export function houseTermEnd(latestStartYear: number): number {
  return latestStartYear + 2;
}

export function houseNextElection(termEnd: number): number {
  return termEnd - 1;
}
```

If the diagnostic finds the per-actual-term shape (case 2 above), `senateTermStart` becomes `terms[0].startYear` after the sort. Adjust accordingly.

## Fix-up script (`scripts/fix-senate-term-years.ts`)

```ts
import 'dotenv/config';
import { getDb } from '../lib/db';
import { senateTermStart, senateNextElection, senateTermEnd } from '../lib/derive-term';

async function main() {
  const db = getDb();

  const res = await db.execute(`
    SELECT bioguide_id, name, terms_json
    FROM members
    WHERE chamber = 'senate'
  `);

  console.log(`Processing ${res.rows.length} senators`);

  let updated = 0;
  let skipped = 0;

  for (const row of res.rows) {
    const termsJsonRaw = row.terms_json as string | null;
    if (!termsJsonRaw) {
      console.warn(`  ${row.bioguide_id} (${row.name}): no terms_json — skip`);
      skipped++;
      continue;
    }

    const terms = JSON.parse(termsJsonRaw);
    const termStart = senateTermStart(terms);

    if (termStart === null) {
      console.warn(`  ${row.bioguide_id} (${row.name}): no senate terms — skip`);
      skipped++;
      continue;
    }

    const termEnd = senateTermEnd(termStart);
    const nextElection = senateNextElection(termStart);

    await db.execute({
      sql: `
        UPDATE members
        SET current_term_end_year = ?, next_election_year = ?
        WHERE bioguide_id = ?
      `,
      args: [termEnd, nextElection, row.bioguide_id],
    });
    updated++;
  }

  console.log(`Updated ${updated} senators, skipped ${skipped}`);

  // Drop stale senate races whose id no longer matches any senator's corrected
  // (state, next_election_year). Safe because senate races have no hand-curated
  // candidates yet (data/races-seed.json is empty for senate races).
  const dropRes = await db.execute(`
    DELETE FROM races
    WHERE chamber = 'senate'
      AND id NOT IN (
        SELECT 'S-' || state || '-' || next_election_year
        FROM members
        WHERE chamber = 'senate' AND state IS NOT NULL AND next_election_year IS NOT NULL
      )
  `);
  console.log(`Dropped ${dropRes.rowsAffected} stale senate race rows`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

Add to `package.json`:

```json
"fix:senate-term-years": "tsx scripts/fix-senate-term-years.ts"
```

## Update sync-members.ts

In `scripts/sync-members.ts`, replace the inline term-derivation block with imports from `lib/derive-term.ts`. For house members, use `houseTermEnd` + `houseNextElection`. For senate members, use `senateTermStart` + `senateTermEnd` + `senateNextElection`.

Keep the existing `pickCurrentTerm` for chamber detection (it's used to determine whether to branch into senate or house derivation), but stop using its return value for the year math.

Pseudocode for the relevant section:

```ts
import { senateTermStart, senateTermEnd, senateNextElection, houseTermEnd, houseNextElection } from '../lib/derive-term';

// ...inside the loop, after fetching terms:
const chamber = deriveChamber(pickCurrentTerm(terms));

let currentTermEndYear: number | null = null;
let nextElectionYear: number | null = null;

if (chamber === 'senate') {
  const ts = senateTermStart(terms);
  if (ts !== null) {
    currentTermEndYear = senateTermEnd(ts);
    nextElectionYear = senateNextElection(ts);
  }
} else if (chamber === 'house') {
  const latestStart = pickCurrentTerm(terms)?.startYear;
  if (latestStart !== undefined) {
    currentTermEndYear = houseTermEnd(latestStart);
    nextElectionYear = houseNextElection(currentTermEndYear);
  }
}
```

This is the bug-prevention piece — without it, the next `pnpm sync:members` run would regress the fix.

## SKILL.md update

Under the existing **Things to watch for**, add a line:

> Senate term derivation is non-trivial: the Congress.gov `/member/{bioguideId}` endpoint returns one term entry per Congress (2 years), not one per 6-year senate term. Use `lib/derive-term.ts` helpers, not raw `startYear + 6` math. Verified by the count `SELECT COUNT(*) FROM races WHERE chamber='senate'` — should be ~100 for current cycle coverage.

## Verification

1. Run the diagnostic step. Confirm `terms_json` shape (per-Congress vs per-actual-term). Adapt `senateTermStart` if needed.
2. `npm run fix:senate-term-years` — `Updated 100 senators, skipped 0`, then `Dropped 51 stale senate race rows`.
3. `SELECT next_election_year, COUNT(*) FROM members WHERE chamber='senate' GROUP BY next_election_year ORDER BY next_election_year` — should return three buckets (roughly 33, 33, 34) across 2026, 2028, 2030. Slight skew is expected from mid-term appointments.
4. `SELECT state, next_election_year, COUNT(*) FROM members WHERE chamber='senate' GROUP BY state, next_election_year HAVING COUNT(*) > 1` — should return 0 rows.
5. `npm run backfill:races` — `Inserted: ~100`. Final senate race count should be near 100.
6. `SELECT COUNT(*) FROM races WHERE chamber='senate'` — verify ~100.
7. Hit `/race/S-CA-2028` (Padilla's seat, if he's Class 1) or any senator's race page from a known state+year. Page renders with the right incumbent.
8. On a member hub for a senator, click the `NEXT ELECTION YYYY` link — lands on the right race.
9. `npm run typecheck` — clean.
10. `npm run build` — clean.

## Acceptance

100 senate races stubbed (≈two per state, one per cycle), no `(state, year)` collisions. `sync-members.ts` uses the corrected derivation going forward. `lib/derive-term.ts` is the single source of truth for term math.

After this: back to the open theme work. Browser verification for handoff 62 is still on your plate, plus the Sabato fill-in for competitive races. Next theme handoff candidates remain: donors/stocks (theme 6 continued), news signal (theme 4), or CCBT parity batch.
