// Durable cron-run logging (handoff 105). Vercel Hobby tier discards live
// logs after 30 minutes, so a cron tick's only persistent record past that
// window is a row in `cron_runs`. Every cron route calls startCronRun at the
// top (after auth) and finishCronRun at the end; read via the query helpers
// getRecentCronRuns / getLatestCronRun in lib/queries.ts.
//
// Note: lib/db.ts exports getDb() (a lazy singleton), not a `db` const — the
// handoff sketch's `import { db }` does not match the actual module.
import { getDb } from "./db";

export type CronRunStatus = "running" | "success" | "error" | "timeout";

/**
 * Insert a `running` row for a cron tick and return its id. Call this once,
 * after the route's auth check passes — unauthorized probes must not pollute
 * the table.
 */
export async function startCronRun(route: string): Promise<number> {
  const result = await getDb().execute({
    sql: `INSERT INTO cron_runs (route, started_at, status)
          VALUES (?, ?, 'running') RETURNING id`,
    args: [route, new Date().toISOString()],
  });
  const row = result.rows[0];
  if (!row) {
    throw new Error("startCronRun: INSERT ... RETURNING id returned no row");
  }
  return Number(row.id);
}

/**
 * Close out a cron run. `elapsed_ms` is computed DB-side from the stored
 * `started_at` (julianday math) rather than passed in — keeps the API clean
 * and avoids client-clock skew. `payload` is JSON-stringified; pass the route's
 * response body so failure arrays / counts survive past the log window.
 */
export async function finishCronRun(
  id: number,
  status: "success" | "error" | "timeout",
  payload: unknown,
  errorMessage?: string,
): Promise<void> {
  const endedAt = new Date().toISOString();
  await getDb().execute({
    sql: `UPDATE cron_runs
          SET ended_at = ?,
              elapsed_ms = CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER),
              status = ?,
              payload = ?,
              error_message = ?
          WHERE id = ?`,
    args: [
      endedAt,
      endedAt,
      status,
      JSON.stringify(payload ?? null),
      errorMessage ?? null,
      id,
    ],
  });
}
