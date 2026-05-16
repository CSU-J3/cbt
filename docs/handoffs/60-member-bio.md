# 60 — Member bio sync + member hub

## What this is

Capture `bioguide_id` on bills, populate a new `members` table from Congress.gov, ship the `/sponsors/[bioguideId]` detail page wired into the existing `/sponsors` row. The first concrete piece of theme 6 (member depth) — turns the `/sponsors` list from a flat aggregation into the entrance to a real member hub.

Single-handoff bundle: data layer + UI layer together. Invisible commits are demotivating; ship the visible payoff alongside the schema.

No new LLM calls. ~600 Congress.gov API calls for the initial member backfill, well under the free-tier 5000/hr ceiling.

## In scope

- Migration: add `sponsor_bioguide_id TEXT` to `bills` (indexed); add `members` table
- Sync edit (`lib/sync.ts`): extract `sponsors[0].bioguideId` from the detail response, write to `bills.sponsor_bioguide_id` on upsert
- `scripts/backfill-bioguide-ids.ts` — single `UPDATE bills SET sponsor_bioguide_id = json_extract(...)` over `raw_json`
- `scripts/sync-members.ts` — pulls distinct bioguide_ids from bills, fetches `/member/{bioguideId}` from Congress.gov, upserts into `members`. Skips members with `fetched_at` < 30 days old. Run via `pnpm sync:members`.
- Query helpers: `getMember(bioguideId)`, `getMemberStats(bioguideId)`, `getMemberBills(bioguideId, limit)`. Update `getSponsors` to include `sponsor_bioguide_id` in the returned row.
- New route `/sponsors/[bioguideId]` — member hub page (server-rendered)
- `SponsorRow` expanded panel: new `[VIEW DETAIL →]` button (only renders if bioguide_id is present)
- SKILL.md updates

## Out of scope

- Voting record, committee assignments, news mentions on the member page. All future sub-page links.
- Donors, stock trades, caucus/union/advocacy badges. Theme 6 sub-themes, separate handoffs.
- `/race/[bioguideId]` race surface and the "seat up" clickable header bridge. v1 shows next election year as a static chip; race surface (theme 7) wires the click later.
- Cron integration for `sync-members`. Manual `pnpm sync:members` for now; revisit if member bios start drifting.
- Re-aggregating `/sponsors` by `bioguide_id` instead of `sponsor_name`. Existing grouping stays; bioguide_id is added as a returned field, not a grouping key. Avoids breaking the row count semantics during backfill.

## Schema

Add to `scripts/migrate.ts`:

```sql
ALTER TABLE bills ADD COLUMN sponsor_bioguide_id TEXT;
CREATE INDEX IF NOT EXISTS idx_bills_sponsor_bioguide ON bills(sponsor_bioguide_id);

CREATE TABLE IF NOT EXISTS members (
  bioguide_id TEXT PRIMARY KEY,        -- e.g. "S001234"
  name TEXT NOT NULL,                  -- directOrderName from API
  first_name TEXT,
  last_name TEXT,
  party TEXT,                          -- normalized: 'R' | 'D' | 'I'
  state TEXT,                          -- two-letter, e.g. "CA"
  state_name TEXT,                     -- "California"
  district INTEGER,                    -- House only, null for Senate
  chamber TEXT,                        -- 'house' | 'senate'
  birth_year INTEGER,
  depiction_url TEXT,                  -- official photo URL
  current_term_end_year INTEGER,       -- year the current term ends
  next_election_year INTEGER,          -- derived: current_term_end_year - 1
  terms_json TEXT,                     -- raw terms array, for future use
  raw_json TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_members_state ON members(state);
CREATE INDEX IF NOT EXISTS idx_members_next_election ON members(next_election_year);
```

Notes:

- `state` is the two-letter abbreviation (matches `bills.sponsor_state`); `state_name` is the full name from the API.
- `district` is nullable. Senators have no district; House members have a number. At-large districts (e.g. Wyoming) come through as `0` or `1` depending on the API quirk; store whatever the API returns.
- `next_election_year` is computed from `current_term_end_year - 1` because terms end Jan 3 of an odd year and the election is the prior November. Store the derived field rather than computing at query time; saves a CASE expression on every row.
- `chamber` is normalized to lowercase even though the API returns `Senate` / `House of Representatives`.

## Sync changes (`lib/sync.ts`)

In the bill upsert path:

```ts
const sponsorBioguideId = bill.sponsors?.[0]?.bioguideId ?? null;
```

Add `sponsor_bioguide_id` to the upsert column list. `ON CONFLICT` should set `sponsor_bioguide_id = excluded.sponsor_bioguide_id` so future syncs refresh it (sponsor bioguide_id shouldn't change, but the cost of nulling and re-writing is zero).

## bioguide_id backfill (`scripts/backfill-bioguide-ids.ts`)

```ts
import { db } from '../lib/db';

async function main() {
  const before = await db.execute(
    `SELECT COUNT(*) as n FROM bills WHERE sponsor_bioguide_id IS NULL`
  );
  console.log(`Bills with NULL sponsor_bioguide_id before: ${before.rows[0].n}`);

  const result = await db.execute(`
    UPDATE bills
    SET sponsor_bioguide_id = json_extract(raw_json, '$.sponsors[0].bioguideId')
    WHERE sponsor_bioguide_id IS NULL
      AND json_extract(raw_json, '$.sponsors[0].bioguideId') IS NOT NULL
  `);
  console.log(`Rows updated: ${result.rowsAffected}`);

  const after = await db.execute(
    `SELECT COUNT(*) as n FROM bills WHERE sponsor_bioguide_id IS NULL`
  );
  console.log(`Bills with NULL sponsor_bioguide_id after: ${after.rows[0].n}`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

Add `"backfill:bioguide-ids": "tsx scripts/backfill-bioguide-ids.ts"` to `package.json`.

JSON path verification: handoff 59 found that `$.bill.cosponsors.count` returned NULL because the sync stores `detailRes.bill` directly. Same applies here — verify with `SELECT json_extract(raw_json, '$.sponsors[0].bioguideId') FROM bills LIMIT 5` before running. Adjust path if needed.

Expected coverage: near 100% (every bill has a sponsor, every sponsor has a bioguide_id in modern data).

## Member sync script (`scripts/sync-members.ts`)

```ts
import { db } from '../lib/db';

const CONGRESS_API_KEY = process.env.CONGRESS_API_KEY!;
const STALE_DAYS = 30;
const DELAY_MS = 150;

async function fetchMember(bioguideId: string) {
  const url = `https://api.congress.gov/v3/member/${bioguideId}?api_key=${CONGRESS_API_KEY}&format=json`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${bioguideId}: HTTP ${res.status}`);
  const data = await res.json();
  return data.member;
}

function normalizeParty(partyName: string | null): 'R' | 'D' | 'I' | null {
  if (!partyName) return null;
  const p = partyName.toLowerCase();
  if (p.includes('republican')) return 'R';
  if (p.includes('democrat')) return 'D';
  return 'I';
}

function pickCurrentTerm(terms: any[]): any | null {
  if (!terms?.length) return null;
  // Sort by startYear desc, take the first
  return [...terms].sort((a, b) => (b.startYear ?? 0) - (a.startYear ?? 0))[0];
}

function deriveChamber(term: any): 'house' | 'senate' | null {
  const c = (term?.chamber ?? '').toLowerCase();
  if (c.includes('senate')) return 'senate';
  if (c.includes('house')) return 'house';
  return null;
}

async function main() {
  const distinctRes = await db.execute(`
    SELECT DISTINCT sponsor_bioguide_id
    FROM bills
    WHERE sponsor_bioguide_id IS NOT NULL
  `);
  const bioguideIds = distinctRes.rows.map(r => r.sponsor_bioguide_id as string);
  console.log(`Distinct sponsors: ${bioguideIds.length}`);

  let fetched = 0, skipped = 0, failed = 0;

  for (const bioguideId of bioguideIds) {
    // Staleness check
    const existing = await db.execute({
      sql: `SELECT fetched_at FROM members WHERE bioguide_id = ?`,
      args: [bioguideId],
    });
    if (existing.rows.length > 0) {
      const ageDays = (Date.now() - new Date(existing.rows[0].fetched_at as string).getTime()) / 86400000;
      if (ageDays < STALE_DAYS) {
        skipped++;
        continue;
      }
    }

    try {
      const member = await fetchMember(bioguideId);
      const terms = member.terms?.item ?? [];
      const currentTerm = pickCurrentTerm(terms);
      const currentTermEndYear = currentTerm?.endYear ?? null;
      const nextElectionYear = currentTermEndYear ? currentTermEndYear - 1 : null;
      const chamber = deriveChamber(currentTerm);

      await db.execute({
        sql: `
          INSERT INTO members (
            bioguide_id, name, first_name, last_name, party, state, state_name,
            district, chamber, birth_year, depiction_url,
            current_term_end_year, next_election_year, terms_json,
            raw_json, fetched_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(bioguide_id) DO UPDATE SET
            name = excluded.name,
            first_name = excluded.first_name,
            last_name = excluded.last_name,
            party = excluded.party,
            state = excluded.state,
            state_name = excluded.state_name,
            district = excluded.district,
            chamber = excluded.chamber,
            birth_year = excluded.birth_year,
            depiction_url = excluded.depiction_url,
            current_term_end_year = excluded.current_term_end_year,
            next_election_year = excluded.next_election_year,
            terms_json = excluded.terms_json,
            raw_json = excluded.raw_json,
            fetched_at = excluded.fetched_at
        `,
        args: [
          bioguideId,
          member.directOrderName ?? `${member.firstName} ${member.lastName}`,
          member.firstName ?? null,
          member.lastName ?? null,
          normalizeParty(member.partyName ?? currentTerm?.partyName),
          /* two-letter state — see below */ stateAbbrFromName(member.state ?? currentTerm?.stateName),
          member.state ?? currentTerm?.stateName ?? null,
          currentTerm?.district ?? null,
          chamber,
          member.birthYear ? parseInt(member.birthYear) : null,
          member.depiction?.imageUrl ?? null,
          currentTermEndYear,
          nextElectionYear,
          JSON.stringify(terms),
          JSON.stringify(member),
          new Date().toISOString(),
        ],
      });
      fetched++;
      console.log(`${bioguideId}: ${member.directOrderName}`);
    } catch (err) {
      failed++;
      console.warn(`${bioguideId}: failed`, err);
    }

    await new Promise(r => setTimeout(r, DELAY_MS));
  }

  console.log(`Done. fetched=${fetched} skipped=${skipped} failed=${failed}`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

The state-name-to-abbreviation map lives in a small lookup table at the top of the file (`{ "California": "CA", "Texas": "TX", ... }`, 50 states + DC + territories). If you have a util for this elsewhere reuse it; otherwise inline the map.

Add to `package.json`:

```json
"sync:members": "tsx scripts/sync-members.ts"
```

Run: `pnpm sync:members`. First run takes ~90 seconds for ~600 members. Subsequent runs are near-instant (30-day staleness skip).

## Query helpers (`lib/queries.ts`)

```ts
export async function getMember(bioguideId: string): Promise<Member | null>;

export async function getMemberStats(bioguideId: string): Promise<{
  billsSponsored: number;
  billsEnacted: number;
  enactedRate: number;        // 0-1
  avgCosponsorCount: number | null;  // null if no bills have cosponsor data
}>;

export async function getMemberBills(
  bioguideId: string,
  limit: number = 10
): Promise<Bill[]>;
```

`getMember` selects from `members` by `bioguide_id`. Cache with `unstable_cache(..., ['member', bioguideId], { tags: ['members'], revalidate: 86400 })`.

`getMemberStats` queries `bills WHERE sponsor_bioguide_id = ?`:

```sql
SELECT
  COUNT(*) AS bills_sponsored,
  SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS bills_enacted,
  AVG(cosponsor_count) AS avg_cosponsor_count
FROM bills
WHERE sponsor_bioguide_id = ?
  AND (is_ceremonial = 0 OR is_ceremonial IS NULL);
```

Excludes ceremonial bills so the enacted rate reflects substantive work. Cache same as `getMember`.

`getMemberBills` returns the most recent bills sponsored by this member, ceremonial bills included but with the existing `is_ceremonial` flag so the UI can dim them.

Update `getSponsors` to include `sponsor_bioguide_id` in the SELECT (use `MAX(sponsor_bioguide_id) AS sponsor_bioguide_id` since it's a GROUP BY query). The detail-page link is null-safe — if a sponsor group has no bioguide_id (during backfill), the button doesn't render.

## Routes

### `/sponsors/[bioguideId]` (`app/sponsors/[bioguideId]/page.tsx`)

Server component. Params: `bioguideId`. Reads `getMember`, `getMemberStats`, `getMemberBills` in parallel.

If `getMember` returns null: render a 404-style empty state with a `← BACK TO SPONSORS` link. Don't use `notFound()`.

Layout (uses existing CSS vars and typography tiers):

```
HeaderBar (variant feed, count area replaced with member name)
─────────────────────────────────────────────────────────────────────
← BACK TO SPONSORS

┌────────┐
│ [PHOTO]│   JOHN DOE
│        │   ● R-OH-12 · BORN 1960 · NEXT ELECTION 2026
└────────┘

─────────────────────────────────────────────────────────────────────
BILLS SPONSORED      47
BILLS ENACTED        2 (4.3%)
AVG COSPONSORS       12
─────────────────────────────────────────────────────────────────────

AFFILIATIONS
Coming soon.

─────────────────────────────────────────────────────────────────────

SPONSORED BILLS (TOP 10)
[uses existing BillRow component, no daysSinceMode, no expand support]

[VIEW ALL 47 BILLS →]   (links to /?sponsor=<urlencoded name>)

FooterLegend
```

Component breakdown:

- **`MemberHeader`** (new, `components/MemberHeader.tsx`) — server component. Renders photo (with `next/image` if depiction_url is present, fallback to a neutral placeholder), name in 16px, meta line in 13px with party-colored dot and chip-style `NEXT ELECTION YYYY`. Tabular metadata.
- **`MemberStats`** (new, `components/MemberStats.tsx`) — three labeled stats in a `flex` row, 12px uppercase labels above 14px values. Right-aligned within their columns. Matches the dashboard's stat block aesthetic.
- **`MemberAffiliations`** (new placeholder, `components/MemberAffiliations.tsx`) — renders "Coming soon." in muted text. Stub that gets fleshed out when caucus/badge data lands.
- **Sponsored bills list** — reuse `BillRow` directly with no special mode.

Layout container: same full-width fluid pattern as other pages. `px-4` gutter.

Photo: 80x80px desktop, 60x60px mobile. `next/image` with priority loading (it's above the fold). Fallback if `depiction_url` is null: a `--bg-row-hover` square with the member's initials in `--text-secondary`.

### SponsorRow update (`components/SponsorRow.tsx`)

In the expanded panel, add a new button to the existing action row:

```
[VIEW DETAIL →]  [VIEW ALL N BILLS →]
```

`[VIEW DETAIL →]` only renders if `sponsor.sponsor_bioguide_id` is non-null. Links to `/sponsors/${sponsor_bioguide_id}`. Same button styling as the existing `[VIEW ALL N BILLS →]`.

The change to `SponsorRow` is purely additive — no existing behavior changes.

## SKILL.md updates

**Database schema**: add the `members` table block. Add `sponsor_bioguide_id` to the `bills` block. Mention the new index.

**Pages** section: add a new entry.

> `/sponsors/[bioguideId]` — member hub. Photo, name, party + state + district, next-election year. Stat block (bills sponsored, enacted, avg cosponsor count). Affiliations placeholder. Top 10 sponsored bills with `[VIEW ALL N BILLS →]` link to filtered feed. Reads from `members` table populated by `pnpm sync:members`.

**Sync logic**: add a line under step 4 noting `sponsor_bioguide_id` capture. Add a new subsection:

> **Member sync (separate script).** `pnpm sync:members` reads distinct `sponsor_bioguide_id` from `bills`, fetches `/member/{bioguideId}` from Congress.gov, upserts into `members`. Skips members with `fetched_at < 30 days`. Not in the cron — run manually after backfill, refresh monthly. ~600 API calls, ~90 seconds.

**Query helpers**: add `getMember`, `getMemberStats`, `getMemberBills`. Note that `getSponsors` now returns `sponsor_bioguide_id`.

**Information architecture**: confirm the member hub thesis ("What does this person work on in Congress?") and the seat-up indicator as the planned bridge to theme 7's race surface.

**Backfill scripts** subsection: add `pnpm backfill:bioguide-ids` to the list.

**Things to watch for**: add a note about `next_election_year` being derived from `current_term_end_year - 1` (term ends Jan 3 odd year, election prior November). Members appointed mid-term may have non-standard `endYear` values; spot-check after sync.

## Verification

1. `npm run migrate` — `sponsor_bioguide_id` column on `bills`, `members` table exists with all columns.
2. `SELECT json_extract(raw_json, '$.sponsors[0].bioguideId') FROM bills LIMIT 5` — confirm path returns strings. Adjust backfill UPDATE if needed.
3. `pnpm backfill:bioguide-ids` — reports ~100% coverage. Spot-check: `SELECT id, sponsor_name, sponsor_bioguide_id FROM bills WHERE sponsor_name LIKE 'Sanders%' LIMIT 5` — should return Bernie Sanders' bioguide_id (S000033) on Senate bills.
4. `pnpm sync:members` — completes in ~90 sec. Final log line shows `fetched ≈ 600 skipped=0 failed=<small>`. If `failed` is more than a handful, inspect — the API spec may have shifted.
5. `SELECT COUNT(*) FROM members` — should be ~535 active + however many historical 119th members appear in bills (likely 600-700 total).
6. `SELECT bioguide_id, name, party, state, district, chamber, next_election_year FROM members ORDER BY name LIMIT 10` — spot-check. Senator rows should have `district` NULL; House rows should have a number; `next_election_year` should be 2026 for all House members and 2026/2028/2030 for senators.
7. Hit `/sponsors/S000033` (Sanders). Page renders. Photo loads from Congress.gov. Stats look plausible.
8. Hit `/sponsors/garbage`. Empty state renders with back link, no 500.
9. Go to `/sponsors`. Click any row to expand. The `[VIEW DETAIL →]` button is present and links to the right detail page.
10. `pnpm build` — no warnings. Detail page is dynamic (it reads the DB via params).

## Acceptance

`/sponsors` rows are clickable into real member hubs. `members` table populated, refreshable via the standalone script. Schema in place for affiliations, donors, and the race-surface bridge that come later.

After this: the unblocked work is caucus/affiliation badges (next in theme 6 sequence — small public data, biggest visual payoff per the roadmap), or news signal (theme 4 — bigger payoff, multi-handoff arc), or CCBT parity. User picks.
