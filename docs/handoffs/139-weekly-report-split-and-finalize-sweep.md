# 139 — Split weekly report out of /api/sync + cron_runs finalize sweep

## What this is

Closes the HO 117/118 sequence that was deferred and the cron_runs finalize-row bug surfaced by this session's validation pass.

Two fixes in one handoff because they touch the same files and the new route should be correct from day one:

**Fix 1: Split weekly report into its own cron.** Weekly-report generation currently lives inside `/api/sync` gated to Monday-only. Monday's tick at 09:00 UTC has to do sync + lead + trades + report in one 60s function and hits the ceiling before report code runs. Result: the weekly report cron has never actually fired successfully from a scheduled tick. The five rows in `reports` are a manual backfill clustered on 2026-05-19. Last Monday's 5-25 09:35 `/api/sync` row is orphaned in `cron_runs`.

**Fix 2: cron_runs finalize-row sweep.** Four orphaned `running` rows in the last 4 days. Pattern is the same across `/api/sync` and `/api/cron/primaries`: long-running tick gets killed before the finalize-row write executes. Vercel SIGKILL at 60s means `finally` blocks don't run, so the cron_runs `UPDATE … status='success'` is unreachable on timeout. Need a soft timeout that fires before the ceiling AND a reaper for any rows that still slip through.

Six days of runway before next Monday 6-1 fails the same way.

## Prior art

- **HO 105** — `cron_runs` table introduction
- **HO 115** — `/api/cron/summarize` split out
- **HO 116** — `runSync` time-bounding
- **HO 117** — `/api/cron/news` split out (third cron split, weekly report explicitly deferred)
- **HO 118** — predicted "if /api/sync tips past ~50s, HO 118 splits weekly report" (now lands as HO 139)
- **HO 119** — cron tick validation (the discipline we used to find this)
- **HO 120** — primaries cron topology (one of the routes that needs the finalize sweep)
- **lib/report-generation.ts** — the weekly-report code path being extracted

## In scope

- New route `app/api/cron/weekly-report/route.ts`
- Extract report-generation logic from `app/api/sync/route.ts` into the new route
- Remove the `report` field from `/api/sync`'s timings payload
- Add cron entry to `vercel.json` — recommended Monday 09:30 UTC (30 min after `/api/sync`)
- Audit/refactor the cron_runs wrapper utility (likely `lib/cron-runs.ts`)
- Add a soft-timeout pattern that triggers `cron_runs status='timeout'` before the 60s SIGKILL
- Add a reaper that marks any `running` row older than 5 minutes as `orphaned` at the start of every cron tick
- Backfill the four existing orphaned rows to `status='orphaned'` so they stop polluting future audits
- Apply the wrapper to all 7 cron routes: `/api/sync`, `/api/sync-votes`, `/api/sync-race-ratings`, `/api/cron/primaries`, `/api/cron/summarize`, `/api/cron/news`, `/api/cron/weekly-report` (new)
- SKILL.md updates: cron topology, finalize pattern, reaper behavior

## Out of scope

- Changing what the weekly report generates (report logic stays as-is — pure extraction)
- The `/reports` page UI (HO 75 settled it; will just pick up the new entries naturally once the cron fires)
- Re-running the manual backfill from 5-19 (those rows stay; new Monday ticks produce 5-25 onward)
- Cron schedule changes for the other six routes (only the new weekly-report entry is added)
- Email/webhook notifications on cron failure (separate handoff if needed)
- Moving primaries cursor logic, news LLM matcher, summarize budget — they all stay
- Performance tuning the weekly-report code itself; the split alone gives it a fresh 60s budget

## Phase 1 — Diagnostic (no commits)

Read artifacts. Measure. Propose. Post findings. No code beyond audit.

### Required reads

1. **`app/api/sync/route.ts`** — full route. Find the Monday-gate condition for report generation, the call site for `generateWeeklyReport()` (or whatever it's named), the timings recording for `report`, and any imports specific to report generation. We need to know exactly what gets extracted versus what stays
2. **`lib/report-generation.ts`** — the report logic being extracted. Confirm signature, dependencies, and whether anything in `/api/sync` does setup the new route would also need
3. **`lib/cron-runs.ts`** (or wherever the cron_runs wrapper lives) — current pattern. Is there already a shared `wrapCronRoute()` utility, or does each route inline its own try/catch and final UPDATE? This determines whether the finalize sweep is a single-file edit or a 7-route migration
4. **`app/api/cron/primaries/route.ts`** — sample route. Confirm the current cron_runs write pattern (where the INSERT happens, where the UPDATE happens, what `status` values are in use)
5. **`vercel.json`** — current cron entries (already pulled this session: 6 entries, weekly-report needs to be added)
6. **`schema` (via `\d cron_runs` or migrate.ts)** — confirm columns. Today we know: `route`, `status`, `started_at`, `elapsed_ms`, `payload`. Need to confirm whether a `finished_at` or `timeout_at` column exists, or whether we add one

### Confirmations to post

Each gets a recommendation. Sign-off picks per item.

1. **Cron schedule for `/api/cron/weekly-report`.** Recommend Monday 09:30 UTC. Reasons: (a) `/api/sync` runs 09:00 — by 09:30 it's either done or orphaned, either way the weekly-report function has a clean 60s budget; (b) stays before the noon primaries tick so report errors don't cascade into other crons; (c) Monday alignment matches the existing gate logic. Flag if Phase 1 finds report-generation depends on data that only lands later in the morning (e.g. needs the news cron's Sunday output, which fires at 14:00 UTC daily — Sunday 14:00 is 19 hours before Monday 09:30, so should be fine, but confirm).

2. **Soft-timeout strategy.** Recommend `Promise.race()` with a 55s timeout promise that throws a `CronTimeoutError`. The catch block writes `cron_runs status='timeout'` and returns 504. Reasons: (a) `AbortController` requires every downstream API call to honor the abort signal — fine for `fetch` but not for libsql queries or Gemini SDK calls; `Promise.race()` works at the wrapper level regardless of what the inner code does; (b) 5s buffer before the 60s ceiling is enough for the finalize write to complete; (c) explicit error type makes the catch clean. Confirm against the existing wrapper pattern.

3. **Reaper placement.** Two options:
   - (a) **Inline at start of every cron tick** — first thing every route does is `UPDATE cron_runs SET status='orphaned' WHERE status='running' AND started_at < datetime('now', '-5 minutes')`. Cheap, self-healing, no extra cron needed.
   - (b) **Dedicated `/api/cron/reaper`** — separate route, runs every cron tick or once per day. Cleaner separation but adds a route to maintain.
   - Recommend (a). Cheap to inline, automatic coverage, doesn't add to vercel.json's cron list.

4. **Reaper threshold.** Recommend 5 minutes. Reasons: (a) longest legitimate cron run is ~60s; 5x that gives plenty of margin for slow ticks without false-positive cleanups; (b) all 7 routes share the threshold — no per-route tuning needed.

5. **New status value.** Recommend `'orphaned'` (distinct from `'timeout'` and `'failed'`). Reasons: (a) `'timeout'` means we hit our soft 55s limit and finalized cleanly; (b) `'failed'` means the code threw an exception we caught; (c) `'orphaned'` means SIGKILL happened, the row was never finalized by the function itself, and the reaper found it later. Three distinct failure modes worth distinguishing.

6. **Backfill the 4 existing orphans.** Recommend yes — update the four known `running` rows (5-22 09:03 `/api/sync`, 5-22 12:43 `/api/cron/primaries`, 5-23 12:00 `/api/cron/primaries`, 5-25 09:35 `/api/sync`) to `status='orphaned'` with a backfill comment in payload (`{"backfilled":true,"reason":"pre-HO-139"}`). Cleans the slate; otherwise these rows pollute every future cron_runs query.

7. **Finished-at column.** Recommend adding `finished_at TEXT` to `cron_runs` if it doesn't exist. Lets us compute clean (`finished_at - started_at`) elapsed times retroactively even when the function tracked time wrong, and makes orphan detection trivially `WHERE finished_at IS NULL AND started_at < datetime('now', '-5 minutes')`. Confirm against current schema in Phase 1.

8. **Weekly-report payload shape.** Recommend matching the existing /api/sync payload contract: `{ok: true, elapsedMs, timings: {fetchBills, lead, render}, report: {slug, weekStart, weekEnd, newRowsInserted}}`. Lets cron_runs queries surface report state without parsing markdown content.

### HALT

End Phase 1 with: read summary, all 8 confirmations with picks, schema check on `cron_runs` columns. Wait for sign-off on every numbered pick before Phase 2.

## Phase 2 — Implementation (after sign-off)

Shape depends on Phase 1 picks. Sketch only.

### Schema migration (if needed per Phase 1 pick 7)

Add to `scripts/migrate.ts`:

```sql
ALTER TABLE cron_runs ADD COLUMN finished_at TEXT;
```

(Existing rows get NULL — that's fine, the new wrapper writes it going forward.)

### Wrapper refactor (`lib/cron-runs.ts`)

```ts
class CronTimeoutError extends Error {
  constructor() { super('cron soft timeout'); this.name = 'CronTimeoutError'; }
}

export async function wrapCronRoute<T>(
  route: string,
  handler: () => Promise<T>,
  opts: { softTimeoutMs?: number } = {}
): Promise<{ payload: T | null; status: 'success' | 'timeout' | 'failed' }> {
  const softTimeoutMs = opts.softTimeoutMs ?? 55_000;

  // Reaper pass — mark stale running rows as orphaned
  await db.execute({
    sql: `UPDATE cron_runs SET status='orphaned', finished_at=datetime('now')
          WHERE status='running' AND started_at < datetime('now', '-5 minutes')`,
    args: [],
  });

  const startedAt = new Date().toISOString();
  const runId = await insertRunningRow(route, startedAt);

  const timeoutPromise = new Promise<never>((_, rej) =>
    setTimeout(() => rej(new CronTimeoutError()), softTimeoutMs)
  );

  try {
    const payload = await Promise.race([handler(), timeoutPromise]);
    await finalizeRow(runId, 'success', payload, startedAt);
    return { payload, status: 'success' };
  } catch (err) {
    const status = err instanceof CronTimeoutError ? 'timeout' : 'failed';
    await finalizeRow(runId, status, { error: String(err) }, startedAt);
    return { payload: null, status };
  }
}
```

### New route `app/api/cron/weekly-report/route.ts`

```ts
import { wrapCronRoute } from '@/lib/cron-runs';
import { generateWeeklyReport } from '@/lib/report-generation';

export async function GET(req: Request) {
  // standard CRON_SECRET auth check
  const result = await wrapCronRoute('/api/cron/weekly-report', async () => {
    const report = await generateWeeklyReport();
    return { ok: true, report };
  });
  return Response.json(result.payload ?? { ok: false }, {
    status: result.status === 'success' ? 200 : 504,
  });
}
```

### `/api/sync/route.ts` modifications

- Drop the Monday gate and the `generateWeeklyReport()` call site
- Remove `report` from the `timings` object
- Drop the report-generation import

### `vercel.json` addition

```json
{
  "path": "/api/cron/weekly-report",
  "schedule": "30 9 * * 1"
}
```

Monday 09:30 UTC. Adds to the existing 6-cron list.

### Apply wrapper to remaining 6 routes

Each route's existing inline cron_runs logic gets replaced with a `wrapCronRoute()` call. Touch in this order: `/api/sync` (changes anyway), `/api/cron/primaries`, `/api/cron/summarize`, `/api/cron/news`, `/api/sync-votes`, `/api/sync-race-ratings`. Per-route logic stays identical inside the handler — just the wrapping changes.

### Backfill orphans

One-off SQL (or scripted) update:

```sql
UPDATE cron_runs
SET status='orphaned',
    finished_at=datetime('now'),
    payload='{"backfilled":true,"reason":"pre-HO-139"}'
WHERE status='running';
```

Run after the schema migration. Safe to run more than once.

## Verification

1. `cron_runs` schema has `finished_at` column (if Phase 1 picked yes on item 7)
2. The four pre-existing orphaned rows show `status='orphaned'` with `finished_at` populated
3. `vercel.json` has 7 cron entries, weekly-report on Monday 09:30 UTC
4. Manually invoke `/api/cron/weekly-report` — a new `reports` row appears with this week's slug, and the cron_runs row finalizes as `success`
5. Manually invoke `/api/sync` — payload `timings` no longer contains `report`, completes in well under 60s on a Monday
6. Force a soft timeout (set `softTimeoutMs: 100` and a slow handler) — cron_runs row finalizes as `timeout` with a `finished_at` value
7. Force a thrown error in a handler — cron_runs row finalizes as `failed`
8. Leave a `running` row in the DB manually, invoke any cron route — the reaper at the start of that route marks the stale row as `orphaned` before proceeding
9. All 7 routes use `wrapCronRoute()` — grep confirms no inline cron_runs INSERT/UPDATE outside the wrapper
10. Type-check clean, no console errors, working tree clean

## Acceptance

1. Phase 1 diagnostic posted with all 8 picks + schema check
2. Sign-off received on every numbered pick before any commits
3. Phase 2 ships per signed-off spec
4. All 10 verification items pass
5. SKILL.md updated:
   - Cron topology section gains `/api/cron/weekly-report` entry
   - New subsection on the `wrapCronRoute()` pattern + soft timeout + reaper
   - Status vocabulary noted: `running` / `success` / `timeout` / `failed` / `orphaned`
6. Type-check clean, working tree clean, pushed
7. Commit: `feat(cron): split weekly report + finalize-row sweep (HO 139)`

## Don't

- Don't change what the weekly report generates. Pure extraction — same input, same output, different route. Behavior changes belong in a separate handoff.
- Don't skip the soft timeout in favor of "just wrap in try/finally." Vercel SIGKILL at 60s means the finally never runs. The soft timeout is the only thing that lets the row finalize cleanly.
- Don't make the reaper a separate cron route. Inlining at the start of every wrapped route gives automatic coverage with no schedule to maintain.
- Don't tune `softTimeoutMs` per-route in v1. One default (55s) across all 7 routes. Per-route tuning is a future handoff if the data demands it.
- Don't pre-load the new route with non-report work. It does one thing.
- Don't introduce a `node-cron` dependency or anything in-process. Vercel Cron stays the trigger.
- Don't reorder the existing cron schedules. Only adds an entry.
- Don't ship the schema migration in a separate handoff. The wrapper depends on `finished_at` (if Phase 1 confirms it's needed). Bundle.
- Don't drop the `report: null` field from older cron_runs payloads. New rows omit it; old rows stay as historical record.

## Notes

- Last Monday's 5-25 09:35 orphan is exactly the failure mode HO 117 deferred and HO 118 predicted. This handoff is the third and final cron split from that arc.
- Six days of runway. Monday 6-1 09:30 UTC is the validation point. If the new route fires successfully and produces a "Week of May 25, 2026" report row, the arc is closed.
- The reaper threshold (5 minutes) is conservative. If a legitimately slow tick ever exceeds 5 minutes without finalizing (shouldn't happen — soft timeout fires at 55s), the reaper would falsely mark it `orphaned`. Worth flagging in SKILL.md.
- Weekly reports theme on the roadmap moves from "95% (overstated)" to "90-95% (real)" once this lands. The remaining gap is the report-generation logic itself if it ever needs revisits — but for cron wiring, this closes it.

read docs/handoffs/139-weekly-report-split-and-finalize-sweep.md and follow
