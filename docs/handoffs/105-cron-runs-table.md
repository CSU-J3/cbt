# 105 — `cron_runs` durable cron logging table

## What this is

Vercel Hobby tier caps live logs at 30 minutes. The 12:00 UTC tick on 2026-05-21 was already outside that window by the time I sat down, and the only escape hatch was a manual re-trigger to read elapsedMs from a fresh request. That works once. It won't work when a tick has already failed and the cursor has already advanced past the broken state, or when we want to look at a streak of runs to spot a degradation trend.

Fix is structural: write every cron run to a Turso table at start and update it at finish. Persistent, queryable, free.

## In scope

- New `cron_runs` table (migration in `scripts/migrate.ts`)
- New helper module `lib/cron-log.ts` with `startCronRun(route)` and `finishCronRun(id, status, payload, errorMessage?)`
- Wire all four existing cron routes:
  - `/api/sync`
  - `/api/sync-votes`
  - `/api/sync-race-ratings`
  - `/api/cron/primaries`
- Two query helpers in `lib/queries.ts`: `getRecentCronRuns(limit)` and `getLatestCronRun(route)`
- SKILL.md update documenting the schema, the helper module, and the Hobby-tier 30-min log retention as the reason it exists

## Out of scope

- Any UI surface for cron runs (no `/cron-runs` admin page in this handoff — file under future polish if useful)
- Alerting on failures (Slack webhook, email, whatever — separate handoff if/when wanted)
- Backfill of historical runs (logs are already gone for past ticks; no value reconstructing)
- Pruning / retention policy on the table itself (will be small for a long time; revisit if it grows past ~10k rows)

## Schema

Add to `scripts/migrate.ts` alongside the existing `bills`, `watchlist`, `members`, etc. table definitions. Use `CREATE TABLE IF NOT EXISTS` so re-running migrate is safe.

```sql
CREATE TABLE IF NOT EXISTS cron_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route TEXT NOT NULL,                  -- '/api/cron/primaries' etc.
  started_at TEXT NOT NULL,             -- ISO timestamp
  ended_at TEXT,                        -- ISO, NULL while running
  elapsed_ms INTEGER,                   -- NULL while running
  status TEXT NOT NULL,                 -- 'running' | 'success' | 'error' | 'timeout'
  payload TEXT,                         -- JSON blob: full response body (failures arrays, counts, etc.)
  error_message TEXT                    -- captured exception string, NULL on success
);

CREATE INDEX IF NOT EXISTS idx_cron_runs_route_started ON cron_runs(route, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_cron_runs_status ON cron_runs(status);
```

Two indexes: one for "show me recent runs of route X" queries, one for "show me everything that failed."

## Helper module

New file `lib/cron-log.ts`:

```ts
import { db } from "./db";

export async function startCronRun(route: string): Promise<number> {
  const result = await db.execute({
    sql: `INSERT INTO cron_runs (route, started_at, status) VALUES (?, ?, 'running') RETURNING id`,
    args: [route, new Date().toISOString()],
  });
  return Number(result.rows[0].id);
}

export async function finishCronRun(
  id: number,
  status: "success" | "error" | "timeout",
  payload: unknown,
  errorMessage?: string
): Promise<void> {
  const endedAt = new Date().toISOString();
  await db.execute({
    sql: `UPDATE cron_runs
          SET ended_at = ?,
              elapsed_ms = CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER),
              status = ?,
              payload = ?,
              error_message = ?
          WHERE id = ?`,
    args: [endedAt, endedAt, status, JSON.stringify(payload ?? null), errorMessage ?? null, id],
  });
}
```

`julianday` math gives elapsed_ms from the stored `started_at` rather than passing it in — keeps the API surface clean and avoids client-clock skew.

## Wiring pattern

Each cron route wraps its existing body in start/finish calls. The existing handlers already return `NextResponse.json({ ok, elapsedMs, ...payload })` — capture that payload and persist it.

Pattern, applied to all four routes:

```ts
import { startCronRun, finishCronRun } from "@/lib/cron-log";

export async function GET(req: Request) {
  // existing auth check stays as-is
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }

  const runId = await startCronRun("/api/cron/primaries"); // route-specific

  try {
    const result = await runTheActualSync(); // existing logic
    await finishCronRun(runId, "success", result);
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishCronRun(runId, "error", null, message);
    throw err; // let Next.js return the 500 as before
  }
}
```

Notes:
- `route` string is hardcoded per file; don't try to infer from `req.url` (works locally, gets weird with Vercel's request rewrites).
- `startCronRun` runs *after* the auth check. We don't want to log unauthorized probe attempts to the runs table — that's a different concern and would pollute the data.
- Wrap the *entire* sync logic in the try block. If you have multi-phase syncs (e.g., `/api/sync` runs sync-then-summarize), one outer try catches anything from either phase. Status reflects the worst case — partial success with a phase-2 error still goes to `'error'`.

## Query helpers

Add to `lib/queries.ts`. Both follow the existing query-helper pattern (libsql `db.execute`, parameterized args, typed return shape).

```ts
export interface CronRun {
  id: number;
  route: string;
  started_at: string;
  ended_at: string | null;
  elapsed_ms: number | null;
  status: "running" | "success" | "error" | "timeout";
  payload: unknown;
  error_message: string | null;
}

export async function getRecentCronRuns(limit = 50): Promise<CronRun[]>;
export async function getLatestCronRun(route: string): Promise<CronRun | null>;
```

`payload` comes back as a JSON-parsed `unknown` — let callers narrow it. Don't type it as `Record<string, unknown>`; each route returns a different shape and pretending it's uniform is a lie.

## Timeout handling

Vercel kills the function at 60s. The `'timeout'` status case is therefore a row that never gets updated past `'running'` — the request was murdered mid-flight, `finishCronRun` never executed.

Don't try to detect this inside the route (you can't; you're dead). Instead, add a small reconciliation: any row stuck in `'running'` for more than 120 seconds is implicitly a timeout. Two ways to handle:

- **Lazy:** in `getRecentCronRuns`, post-process rows where `status='running' AND started_at < now() - 120s` to show as `'timeout'` in the UI without mutating the DB. Cheap, no extra write path.
- **Active:** at the top of every cron route, before the auth check, run a single UPDATE that flips orphaned-running rows to `'timeout'`. Bounded work, but pushes writes onto every tick.

Go lazy. The DB is the source of truth for what actually happened (`status='running'` literally means "we don't know"). Display logic can present it as timeout without claiming certainty.

## SKILL.md update

Two additions:

1. In **Database schema** section, append the `cron_runs` CREATE TABLE block.
2. In **Things to watch for**, add:

   > **Vercel Hobby tier caps live logs at 30 minutes.** Past that window, the only record of a cron tick is the `cron_runs` table. Every cron route writes to it via `lib/cron-log.ts` (`startCronRun` / `finishCronRun`); read with `getRecentCronRuns` or `getLatestCronRun` from `lib/queries.ts`. Rows stuck at `status='running'` for over 120s are implicit timeouts — the Vercel runtime killed the function before `finishCronRun` could fire.

## Acceptance

1. `npm run migrate` runs clean against the dev DB (idempotent — re-running doesn't error).
2. Manually trigger `/api/cron/primaries`:

   ```powershell
   $secret = (Get-Content .env | Select-String "CRON_SECRET").Line.Split("=")[1]
   $headers = @{ "Authorization" = "Bearer $secret" }
   Invoke-WebRequest -Uri "https://cbt-chi-silk.vercel.app/api/cron/primaries" -Method GET -Headers $headers -UseBasicParsing
   ```

3. Inspect Turso:

   ```powershell
   turso db shell cbt "SELECT id, route, started_at, elapsed_ms, status FROM cron_runs ORDER BY id DESC LIMIT 5"
   ```

   Expect one row with status='success', elapsed_ms populated, route='/api/cron/primaries'.

4. Repeat for `/api/sync-votes`, `/api/sync-race-ratings`, and `/api/sync`. Each should write its own row. (For the daily sync, slice it small or run against staging if you don't want a full sync tick fired manually — alternative: skip manual verification for /api/sync, rely on tomorrow's 09:00 UTC cron to write the row organically.)

5. Force an error path to verify the catch branch: temporarily break one cron (e.g., bad SQL in a query), trigger, confirm `status='error'` and `error_message` populated. Revert the break.

6. SKILL.md reflects both additions.

7. Commit + push as one commit: `feat: cron_runs table for durable cron logging (HO 105)`.

## Out-of-scope reminders, do not chase

- Don't build a `/cron-runs` admin route in this handoff. The CLI Turso query is enough until we have a reason for a UI.
- Don't add Slack/email alerting on `status='error'`. Separate handoff.
- Don't backfill any historical runs. Logs are gone, no recovery path.
