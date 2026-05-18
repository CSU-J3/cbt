# 61 — Caucus affiliations + badges

## What this is

Fills in the `MemberAffiliations` stub left by handoff 60 with the first real cut of caucus data. Adds an `affiliations` table, a seed pipeline, a `CaucusBadge` component, and two surfaces on `/sponsors/[bioguideId]`: top-priority badges appended to the header meta line, and a full row below the stats block.

Theme 6 step 11 from the roadmap. Smallest piece in the member-depth arc, biggest immediate visual payoff per the framing: a member name in the dashboard goes from "rep from somewhere" to "Freedom Caucus Republican" or "Progressive Democrat" at a glance.

Four caucuses for v1: Freedom Caucus, Republican Study Committee, Progressive Caucus, New Dem Coalition. Identity caucuses (CBC/CHC/CAPAC) and union/advocacy endorsements are deferred — separate handoffs in theme 6.

No new LLM calls. No Congress.gov API calls. Roster data is hand-entered into a seed JSON, refreshed quarterly by manual sit-down.

## In scope

- Migration: `affiliations` table
- `lib/caucus-config.ts` — the four caucuses, display labels, priority order
- `data/affiliations-seed.json` — empty scaffold; user fills in rosters after build (separate sit-down)
- `scripts/seed-affiliations.ts` — idempotent loader, run via `pnpm seed:affiliations`
- Query helper: `getMemberAffiliations(bioguideId)`
- New component: `components/CaucusBadge.tsx`
- `components/MemberAffiliations.tsx` — replace the "Coming soon" stub with real rendering
- `components/MemberHeader.tsx` — append top-2 badges to the meta line
- SKILL.md updates

## Out of scope

- Populating the seed JSON with real rosters. Build the pipeline; user fills rosters by hand in a follow-up sit-down (looking up four caucus member lists from public sources is faster as a manual task than an instructable one).
- Identity caucuses (CBC, CHC, CAPAC), Problem Solvers, the Squad. v1.5.
- Union endorsements, advocacy alignments. Separate theme 6 sub-handoffs.
- Bill feed integration. Density is already tight; wait for member-hub visit data before adding badges to sponsor names in `BillRow`.
- `/caucus/<org>` member roster pages. Future, if demand surfaces.
- Auto-refresh, scraping, or any external sync. Hand-curated for v1.
- Historical tracking (start_date / end_date on affiliations). YAGNI for current-only.
- Bipartisan-by-design groups (Problem Solvers) where the badge tells you less than the party already does.

## Schema

Add to `scripts/migrate.ts`:

```sql
CREATE TABLE IF NOT EXISTS affiliations (
  bioguide_id TEXT NOT NULL REFERENCES members(bioguide_id),
  org TEXT NOT NULL,                -- 'freedom_caucus' | 'rsc' | 'progressive_caucus' | 'new_dem'
  category TEXT NOT NULL,           -- 'caucus' (only category for now)
  source_url TEXT,
  last_verified TEXT NOT NULL,      -- ISO date
  PRIMARY KEY (bioguide_id, org)
);

CREATE INDEX IF NOT EXISTS idx_affiliations_org ON affiliations(org);
CREATE INDEX IF NOT EXISTS idx_affiliations_bioguide ON affiliations(bioguide_id);
```

Notes:

- `org` is a stable slug, not a display label. Display strings live in `caucus-config.ts` so the data layer doesn't care about typography.
- `category` is `'caucus'` for every row in v1; reserved column for `'union'` / `'advocacy'` when those land. Including it now avoids a migration when those handoffs ship.
- `last_verified` is per-row rather than per-org because a roster refresh may add/remove specific members without re-verifying the whole list.

## Caucus config (`lib/caucus-config.ts`)

```ts
export type CaucusOrg = 'freedom_caucus' | 'rsc' | 'progressive_caucus' | 'new_dem';

export interface CaucusInfo {
  display: string;       // short label for badges
  fullName: string;      // long form for hover/aria
  party: 'R' | 'D';
  color: string;         // CSS var
  priority: number;      // lower = higher priority in header truncation
}

export const CAUCUS_CONFIG: Record<CaucusOrg, CaucusInfo> = {
  freedom_caucus: {
    display: 'FREEDOM',
    fullName: 'House Freedom Caucus',
    party: 'R',
    color: 'var(--party-republican)',
    priority: 1,
  },
  rsc: {
    display: 'RSC',
    fullName: 'Republican Study Committee',
    party: 'R',
    color: 'var(--party-republican)',
    priority: 2,
  },
  progressive_caucus: {
    display: 'PROG',
    fullName: 'Congressional Progressive Caucus',
    party: 'D',
    color: 'var(--party-democrat)',
    priority: 3,
  },
  new_dem: {
    display: 'NEW DEM',
    fullName: 'New Democrat Coalition',
    party: 'D',
    color: 'var(--party-democrat)',
    priority: 4,
  },
};

export function isCaucusOrg(s: string): s is CaucusOrg {
  return s in CAUCUS_CONFIG;
}
```

Priority order justification: Freedom Caucus (~30-40 members, highly differentiating) > RSC (~170 members, most of the House R conference, less differentiating) > Progressive Caucus (~100 members, cohesive ideological group) > New Dem (~100 members, moderate default, lowest signal). The badge that tells you the most is the one that shows when truncated.

A member in multiple caucuses (e.g. Freedom + RSC) shows Freedom first.

## Seed data scaffold (`data/affiliations-seed.json`)

```json
{
  "caucuses": [
    {
      "org": "freedom_caucus",
      "category": "caucus",
      "source_url": "https://ballotpedia.org/House_Freedom_Caucus",
      "last_verified": "2026-05-16",
      "members": []
    },
    {
      "org": "rsc",
      "category": "caucus",
      "source_url": "https://rsc-hern.house.gov/about/members",
      "last_verified": "2026-05-16",
      "members": []
    },
    {
      "org": "progressive_caucus",
      "category": "caucus",
      "source_url": "https://progressives.house.gov/members",
      "last_verified": "2026-05-16",
      "members": []
    },
    {
      "org": "new_dem",
      "category": "caucus",
      "source_url": "https://newdemocratcoalition.house.gov/about/membership",
      "last_verified": "2026-05-16",
      "members": []
    }
  ]
}
```

The `members` arrays are bioguide_id strings (e.g. `"S001234"`). Left empty here — user populates after the build by visiting each `source_url` and copying the roster. Freedom Caucus has no official public roster, hence the Ballotpedia URL as a tracked-list proxy.

## Seed script (`scripts/seed-affiliations.ts`)

```ts
import { db } from '../lib/db';
import seed from '../data/affiliations-seed.json';
import { isCaucusOrg } from '../lib/caucus-config';

interface CaucusSeed {
  org: string;
  category: string;
  source_url: string | null;
  last_verified: string;
  members: string[];
}

async function main() {
  const caucuses = seed.caucuses as CaucusSeed[];

  // Validate config slugs
  for (const c of caucuses) {
    if (!isCaucusOrg(c.org)) {
      console.error(`Unknown caucus org '${c.org}' in seed. Aborting.`);
      process.exit(1);
    }
  }

  // Pull member bioguide_ids to validate against
  const memberRes = await db.execute('SELECT bioguide_id FROM members');
  const knownIds = new Set(memberRes.rows.map(r => r.bioguide_id as string));

  let inserted = 0;
  let missing = 0;

  for (const caucus of caucuses) {
    for (const bioguideId of caucus.members) {
      if (!knownIds.has(bioguideId)) {
        console.warn(`  ${caucus.org}: bioguide_id '${bioguideId}' not in members table — skipping`);
        missing++;
        continue;
      }

      await db.execute({
        sql: `INSERT INTO affiliations (bioguide_id, org, category, source_url, last_verified)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(bioguide_id, org) DO UPDATE SET
                category = excluded.category,
                source_url = excluded.source_url,
                last_verified = excluded.last_verified`,
        args: [bioguideId, caucus.org, caucus.category, caucus.source_url, caucus.last_verified],
      });
      inserted++;
    }
  }

  console.log(`Done. inserted/updated=${inserted} missing_members=${missing}`);
}

main().catch(err => { console.error(err); process.exit(1); });
```

Add to `package.json`:

```json
"seed:affiliations": "tsx scripts/seed-affiliations.ts"
```

Run: `pnpm seed:affiliations`. Idempotent — re-running after editing the JSON is the refresh workflow. Members in the JSON but not in the `members` table are warned-and-skipped, not errors (covers the case where a freshman or appointment hasn't been synced yet).

## Query helper (`lib/queries.ts`)

```ts
import { CAUCUS_CONFIG, CaucusOrg } from './caucus-config';

export interface MemberAffiliation {
  org: CaucusOrg;
  category: string;
  source_url: string | null;
  last_verified: string;
}

export async function getMemberAffiliations(bioguideId: string): Promise<MemberAffiliation[]> {
  return unstable_cache(
    async () => {
      const res = await db.execute({
        sql: `SELECT org, category, source_url, last_verified
              FROM affiliations
              WHERE bioguide_id = ?`,
        args: [bioguideId],
      });

      const rows = res.rows
        .map(r => ({
          org: r.org as CaucusOrg,
          category: r.category as string,
          source_url: r.source_url as string | null,
          last_verified: r.last_verified as string,
        }))
        .filter(r => r.org in CAUCUS_CONFIG);

      // Sort by priority asc (lower = higher priority = first)
      rows.sort((a, b) => CAUCUS_CONFIG[a.org].priority - CAUCUS_CONFIG[b.org].priority);

      return rows;
    },
    ['member-affiliations', bioguideId],
    { tags: ['members'], revalidate: 86400 }
  )();
}
```

Shares the `members` cache tag so the existing sync-time invalidation covers it. No separate tag needed.

## Components

### `components/CaucusBadge.tsx`

Server component. Renders a pill with the caucus display label, party-colored border, transparent background.

```tsx
import { CAUCUS_CONFIG, CaucusOrg } from '@/lib/caucus-config';

export function CaucusBadge({ org }: { org: CaucusOrg }) {
  const info = CAUCUS_CONFIG[org];
  return (
    <span
      className="inline-block px-2 py-0.5 text-[12px] uppercase tracking-[0.5px] tabular-nums"
      style={{
        color: info.color,
        border: `1px solid ${info.color}`,
        borderRadius: '2px',
      }}
      title={info.fullName}
    >
      {info.display}
    </span>
  );
}
```

Match the existing topic-tag visual weight: 12px, uppercase, 0.5px tracking. Colored border + colored text on transparent background distinguishes it from topic tags (which use colored text only, no border) so badges don't blur with topics visually.

### `components/MemberAffiliations.tsx` (replace stub)

Currently renders "Coming soon." Replace with:

```tsx
import { getMemberAffiliations } from '@/lib/queries';
import { CaucusBadge } from './CaucusBadge';

export async function MemberAffiliations({ bioguideId }: { bioguideId: string }) {
  const affiliations = await getMemberAffiliations(bioguideId);

  if (affiliations.length === 0) return null;

  return (
    <div className="py-4 border-t border-[var(--border-soft)]">
      <div className="text-[12px] uppercase tracking-[0.5px] text-[var(--text-muted)] mb-2">
        Affiliations
      </div>
      <div className="flex flex-wrap gap-2">
        {affiliations.map(a => (
          <CaucusBadge key={a.org} org={a.org} />
        ))}
      </div>
    </div>
  );
}
```

If a member has zero affiliations: component renders nothing. No empty state, no "Coming soon." Saves vertical space and keeps the page tight for unaffiliated members.

### `components/MemberHeader.tsx` (modify)

After the existing meta line (`● R-OH-12 · BORN 1960 · NEXT ELECTION 2026`), append top-2 badges with `·` separators preserved:

```tsx
const topBadges = affiliations.slice(0, 2);
```

Render inside the meta line, comma-separated wording: existing meta segments end with the next-election chip, then ` · ` then each badge with a space between. Result on a member in both Freedom Caucus and RSC:

```
● R-OH-12 · BORN 1960 · NEXT ELECTION 2026 · [FREEDOM] [RSC]
```

On a member in only New Dem:

```
● D-CA-15 · BORN 1972 · NEXT ELECTION 2026 · [NEW DEM]
```

On a member in zero caucuses: no trailing separator, no append. The line just ends at the election chip.

`MemberHeader` will need to fetch affiliations too (or take them as a prop from the page). Cleanest: page fetches once, passes the array down to both `MemberHeader` and `MemberAffiliations`. Avoid double-fetching.

## Member hub page (`app/sponsors/[bioguideId]/page.tsx`) update

Add a parallel fetch for affiliations alongside the existing `getMember` / `getMemberStats` / `getMemberBills`. Pass the result down to both `MemberHeader` and `MemberAffiliations`.

```tsx
const [member, stats, bills, affiliations] = await Promise.all([
  getMember(bioguideId),
  getMemberStats(bioguideId),
  getMemberBills(bioguideId, 10),
  getMemberAffiliations(bioguideId),
]);
```

Then:

```tsx
<MemberHeader member={member} affiliations={affiliations} />
<MemberStats stats={stats} />
<MemberAffiliations affiliations={affiliations} />  {/* takes prop, not bioguideId */}
```

Switching `MemberAffiliations` to take `affiliations` as a prop (rather than fetching internally) avoids the duplicate query. The version in this handoff with internal fetch is fine if you prefer keeping the component self-contained — `unstable_cache` dedupes the second call within the same request anyway. Either pattern is acceptable; pick one for consistency with how `MemberHeader` and `MemberStats` are wired.

## SKILL.md updates

**Database schema**: add the `affiliations` table block. Note the FK to `members.bioguide_id`.

**Pages** section, under `/sponsors/[bioguideId]`: update to mention the affiliations row below stats and the top-2 badges appended to the header meta line.

**New subsection: "Caucus affiliations"** (under the member-bio sync section or as a sibling):

> v1 covers four caucuses: Freedom Caucus, Republican Study Committee, Progressive Caucus, New Dem Coalition. Rosters are hand-curated in `data/affiliations-seed.json` and loaded via `pnpm seed:affiliations`. Refresh quarterly by editing the JSON and re-running the seed script (idempotent upsert). Identity caucuses (CBC, CHC, CAPAC), Problem Solvers, and the Squad are deferred to v1.5. Union and advocacy endorsements are separate theme 6 sub-handoffs and reuse the same `affiliations` table with different `category` values.

**Backfill scripts subsection**: add `pnpm seed:affiliations` to the list.

**Things to watch for**: add a line — when adding a new caucus, update `CAUCUS_CONFIG` in `lib/caucus-config.ts` (data layer accepts any string; the config governs which orgs render and their display).

## Verification

1. `npm run migrate` — `affiliations` table exists with the right columns and indexes.
2. `pnpm seed:affiliations` against the empty-rosters scaffold — completes with `inserted/updated=0 missing_members=0`.
3. Add 2-3 test bioguide_ids to the `progressive_caucus.members` array in the seed JSON (pick known Progressive Caucus members — AOC `O000172`, Ilhan Omar `O000173`, Pramila Jayapal `J000298`). Re-run `pnpm seed:affiliations` — should report `inserted/updated=3`.
4. Hit `/sponsors/O000172` (AOC). Header meta line shows `[PROG]` after the election chip. Affiliations row below stats shows `[PROG]`.
5. Hit `/sponsors/<a-bioguide-not-in-seed>`. No affiliations row. Header meta line ends cleanly at the election chip (no trailing separator).
6. Add the same test member to a second caucus (e.g. also add AOC to `freedom_caucus` for the sake of testing two-badge layout — silly, but tests truncation). Re-run seed, refresh page. Header shows `[FREEDOM] [PROG]` (Freedom first by priority). Remove the silly test entry before populating real rosters.
7. `SELECT COUNT(*) FROM affiliations GROUP BY org` — counts match the seed JSON.
8. `pnpm build` clean.

## Acceptance

`affiliations` table populated for any rosters in the seed JSON, badges render in the member-hub header and as a dedicated row, the stub from handoff 60 is gone. Pipeline ready for the user's hand-curated roster fill-in as a follow-up.

After this: real roster population (manual sit-down for Corey, not Code). Then next theme 6 sub-handoff (donors or stocks), or news signal (theme 4), or CCBT parity. User picks.
