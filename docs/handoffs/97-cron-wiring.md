# 97 — Primaries cron via cursor slices

## What this is

Replaces the original HO 97 draft. Three things changed after Code's pre-flight verification:

1. **Votes cron already exists** (`app/api/sync-votes/route.ts`, shipped in HO 87, wired at `0 10 * * *`). My original handoff missed this; nothing to build there beyond a SKILL.md doc-fix.
2. **The 11:00 slot is taken** by `/api/sync-race-ratings` (Wed 11:00). Primaries moves to 12:00 UTC.
3. **Day-of-week-per-region can't fit 60s.** Code measured West at 152.9s warm-cache, ~200s cold. The 1s `sleep(1000)` per district is intrinsic (104s on West alone, before any fetch or DB work). Slicing by region doesn't rescue any region — CA-only is still ~95s. The cursor approach the original handoff deferred is the only model that actually fits the platform.

So: one cron route, cursor-based slicing, 30 targets per tick, full corpus refreshes every ~2 weeks. Plus the two doc-fix SKILL.md updates as a tail-end commit.

## Pre-flight, already done

Code's measurements (keep these for the commit message and SKILL.md):

| Region    | Districts | Warm-cache time | Cold-cache estimate |
|-----------|-----------|-----------------|---------------------|
| West      | 104       | 152.9s          | ~200s               |
| South     | 152       | (extrapolated)  | ~290s               |
| Midwest   | 91        | (extrapolated)  | ~175s               |
| Northeast | 76        | (extrapolated)  | ~145s               |
| Senate    | 34        | (extrapolated)  | ~65s                |

Even Senate at 34 races barely fits. Every region either blows or grazes the 60s ceiling. Cursor with ~30-target slices fits with headroom regardless of region composition.

## In scope

- `app/api/cron/primaries/route.ts` — new daily cron at 12:00 UTC
- `primary_scrape_state` table (single-row cursor + bookkeeping)
- `migrations/<next>-primary-scrape-state.sql` — schema migration
- Refactor `scrapeSenateCandidates` / `scrapeHouseCandidates` (or wrappers) to accept an explicit target list, not just a region string. The existing CLI path (`npm run sync:primaries -- --region=west`) continues to work by building the target list from the region.
- `vercel.json` cron entry: `{ "path": "/api/cron/primaries", "schedule": "0 12 * * *" }`
- SKILL.md doc-fixes (two of them, see below)

## Out of scope

- Touching `/api/sync-votes` — already on cron
- Touching `/api/sync-race-ratings` — already on cron
- Scraper politeness changes (Option 2 from Code's prompt) — not pursued; cursor model avoids the speed problem entirely without changing Ballotpedia request profile
- LA jungle (HO 93.5), runoffs — separate work
- Per-target prioritization / LRU — sequential cursor is fine for the cadence the data needs

## Cursor design

Single ordered list of all primary scrape targets. Cursor is an integer index into that list, persisted in a single-row table. Each tick reads cursor, processes the next N targets, advances cursor, wraps at end.

```sql
CREATE TABLE primary_scrape_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor INTEGER NOT NULL DEFAULT 0,
  last_run_at TEXT,
  last_slice_size INTEGER,
  last_slice_targets TEXT,
  total_targets INTEGER
);
INSERT INTO primary_scrape_state (id, cursor) VALUES (1, 0)
  ON CONFLICT DO NOTHING;
```

Target list shape:

```ts
type SenateTarget = { kind: 'senate'; state: string };
type HouseTarget  = { kind: 'house'; state: string; district: number | 'AL' };
type Target = SenateTarget | HouseTarget;
```

Construction in `lib/primary-targets.ts`:

```ts
export function buildTargetList(): Target[] {
  return [
    ...SENATE_2026_STATES.map(state => ({ kind: 'senate', state })),
    ...HOUSE_DISTRICTS_NE_2026.map(d => ({ kind: 'house', state: d.state, district: d.district })),
    ...HOUSE_DISTRICTS_SOUTH_2026.map(d => ({ kind: 'house', state: d.state, district: d.district })),
    ...HOUSE_DISTRICTS_MIDWEST_2026.map(d => ({ kind: 'house', state: d.state, district: d.district })),
    ...HOUSE_DISTRICTS_WEST_2026.map(d => ({ kind: 'house', state: d.state, district: d.district })),
  ];
}
```

Order is stable (no shuffle). Cursor index N always points to the same target until the underlying constants change. Total: ~457 targets (34 Senate + 76 + 152 + 91 + 104).

Slice size: **30 per tick**. Math: 30 targets × 1s sleep + 30 × ~150ms fetch + DB ≈ 45s. Headroom for the slow-fetch tail. Adjust down to 25 if real ticks come in over 50s.

Refresh cadence: 457 / 30 ≈ **16 days for a full pass**. Fine for primary candidate data, which changes around filing deadlines (discrete events, not continuous).

## Route shape

```ts
// app/api/cron/primaries/route.ts
import { NextRequest } from 'next/server';
import { revalidateTag } from 'next/cache';
import { db } from '@/lib/db';
import { buildTargetList } from '@/lib/primary-targets';
import { scrapeOneTarget } from '@/lib/primary-candidates-scrape';

export const maxDuration = 60;

const SLICE_SIZE = 30;

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization');
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }

  const t0 = Date.now();

  const state = await db.execute('SELECT cursor FROM primary_scrape_state WHERE id = 1');
  const cursor = (state.rows[0]?.cursor as number) ?? 0;

  const targets = buildTargetList();
  const total = targets.length;
  const slice = [];
  for (let i = 0; i < SLICE_SIZE; i++) {
    slice.push(targets[(cursor + i) % total]);
  }

  const results = [];
  for (const target of slice) {
    try {
      const r = await scrapeOneTarget(target);
      results.push({ target, ok: true, ...r });
    } catch (err) {
      results.push({ target, ok: false, error: String(err) });
    }
  }

  const nextCursor = (cursor + SLICE_SIZE) % total;
  await db.execute({
    sql: `UPDATE primary_scrape_state
          SET cursor = ?, last_run_at = ?, last_slice_size = ?,
              last_slice_targets = ?, total_targets = ?
          WHERE id = 1`,
    args: [nextCursor, new Date().toISOString(), slice.length,
           JSON.stringify(slice), total],
  });

  revalidateTag('primaries');

  return Response.json({
    ok: true,
    elapsedMs: Date.now() - t0,
    cursorBefore: cursor,
    cursorAfter: nextCursor,
    sliceSize: slice.length,
    successCount: results.filter(r => r.ok).length,
    failureCount: results.filter(r => !r.ok).length,
    results,
  });
}
```

`scrapeOneTarget(target)` is the new unit-of-work function. Likely lives in `lib/primary-candidates-scrape.ts` alongside the existing region functions. The region functions become thin wrappers: build the per-region target list, loop calling `scrapeOneTarget`. CLI path unchanged. Cron path uses the same primitive.

## Refactor notes

`scrapeSenateCandidates` and `scrapeHouseCandidates` currently each loop over a region's targets, fetch, parse, upsert. The refactor extracts the per-target body into `scrapeOneTarget(target)` and reduces the region functions to:

```ts
export async function scrapeHouseCandidates(region: 'northeast'|'south'|'midwest'|'west') {
  const targets = HOUSE_REGIONS[region];
  const results = [];
  for (const t of targets) {
    results.push(await scrapeOneTarget({ kind: 'house', ...t }));
  }
  return results;
}
```

If the existing functions share state (one DB connection, one HTML cache), make sure `scrapeOneTarget` is idempotent and self-contained — it'll be called from both the CLI loop and the cron route with different surrounding contexts.

## Failure handling

Per-target failures inside a tick: log to the response body, do NOT throw out of the whole route. The cursor still advances by SLICE_SIZE so a poison target doesn't block the cursor.

Full-tick failure (e.g. DB down): the route 5xx's, cursor doesn't advance, next tick retries the same slice. Acceptable.

If a target fails repeatedly across multiple passes, it'll show up in the response body of consecutive ticks. Eyeball the cron history weekly; add a `failure_count` column on a future per-target tracker if this becomes a recurring pain point. Don't build that now.

## vercel.json

Append one entry to the existing `crons` array:

```json
{ "path": "/api/cron/primaries", "schedule": "0 12 * * *" }
```

12:00 UTC avoids the existing `/api/sync` (09:00), `/api/sync-votes` (10:00), and `/api/sync-race-ratings` (Wed 11:00) slots.

## SKILL.md updates (separate from cron work but commit together)

Two corrections to bake in:

### 1. Cron topology section (new or update existing)

Document the four cron routes so the next handoff doesn't repeat the "votes cron is still manual" mistake:

```markdown
### Cron topology

Four Vercel cron jobs, all daily (Hobby cap), staggered by hour:

- `/api/sync` at 09:00 UTC — bills sync + summarize
- `/api/sync-votes` at 10:00 UTC — House + Senate vote rolls (HO 87)
- `/api/sync-race-ratings` at 11:00 UTC, Wednesdays only — race rating refresh
- `/api/cron/primaries` at 12:00 UTC — primary candidate scrape via cursor slicing (HO 97)

Each tick must fit in Vercel Hobby's 60s function ceiling. The bills, votes, and ratings routes self-cap their work per tick. The primaries route uses a cursor in `primary_scrape_state` to process 30 targets per tick out of ~457 total, fully refreshing the corpus every ~16 days.

Vercel removed the per-team cron count limit in January 2026; Hobby projects can now register up to 100 crons. Sub-daily frequency is still blocked on Hobby.
```

### 2. Ballotpedia nonpartisan-primary note (from HO 96)

Wherever the Ballotpedia parsing notes live:

```markdown
Ballotpedia top-two (CA, WA) and top-four (AK) primary pages render with an identical `<div class="race_header nonpartisan">` votebox. No separate parser is needed — `parseCandidatesPage()` routes them via the `open` contest set with per-row party preference extracted from the candidate row markup. Discovered HO 96 after spot-checking CA-01, WA-03, and AK-AL before writing the parser branches the handoff originally requested.
```

## Validation

Local:

1. Run the migration; confirm `primary_scrape_state` exists with `(1, 0, NULL, NULL, NULL, NULL)`
2. CLI path still works: `npm run sync:primaries -- --region=west` produces the same output as HO 96
3. Hit the new route locally with the bearer header; confirm cursor advances from 0 to 30, ~30 targets in the response body, elapsedMs under 50s

Production:

4. Deploy; manually hit `/api/cron/primaries` with bearer; confirm 200 + elapsedMs under 50s + cursor advance
5. Wait a day, check Vercel cron history shows the 12:00 UTC tick fired
6. After ~16 days, confirm cursor wraps to 0 cleanly and no targets were skipped

## Acceptance

- Migration applied; `primary_scrape_state` populated
- `scrapeOneTarget` extracted; region functions still work via CLI
- Route returns 200 with cursor advance + per-target results
- vercel.json has the new entry at 12:00 UTC
- SKILL.md has both new sections
- First production tick fires within 60s budget
- Ready to commit as `feat: primaries cron via cursor slices + SKILL.md fixes (HO 97)`

## Notes

- **Why cursor over Code's option 2 (faster scraper).** Cutting `sleep(1000)` to 200ms and adding concurrency would buy ~80% speedup but changes the Ballotpedia request profile in a way that's hard to validate without actually getting rate-limited or challenged. The cursor approach changes nothing about how the scraper talks to Ballotpedia. Same number of requests per district, same timing per request — just spread across more days.
- **Why cursor over Code's option 3 (many small slices).** Sub-region slicing builds the same per-tick-batching that the cursor already provides, but couples it to a brittle hand-maintained DISPATCH map that has to be updated every time a region's district list changes. Cursor handles district-count changes automatically.
- **Why not option 4 (keep manual).** Primary filings cluster around state filing deadlines, which span the full Q1-Q3 calendar for a midterm cycle. "Run it manually when a deadline passes" requires tracking 50 deadlines. The 16-day cursor pass catches everything with one config.
- **Wrapping behavior.** When cursor advances past `total`, it wraps to 0 cleanly via modulo. No race conditions in the wrap (single-row table, single writer).
- **Target list snapshot.** `total_targets` in the state row is updated on each tick. If `buildTargetList().length` changes (new districts added in HO 93.5 LA jungle, future regions), the cursor doesn't break — it just continues from wherever it is in the new list. Worst case is one tick processes a slice that crosses the old/new boundary; acceptable.
