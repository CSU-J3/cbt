// Durable cron-run logging (handoff 105). Vercel Hobby tier discards live
// logs after 30 minutes, so a cron tick's only persistent record past that
// window is a row in `cron_runs`.
//
// HO 139 layered a wrapper (`wrapCronRoute`) over the original
// startCronRun / finishCronRun helpers: every wrapped tick (a) sweeps stale
// `running` rows to `orphaned` first, (b) races the handler against a 55s
// soft timeout so a Vercel SIGKILL never strands a row, (c) finalizes the
// row before returning. Status vocabulary: `running` (in-flight) →
// `success` (clean), `error` (handler threw), `timeout` (hit soft limit),
// `orphaned` (reaper found a stale row from a prior SIGKILL).
import { getDb } from "./db";

export type CronRunStatus =
  | "running"
  | "success"
  | "error"
  | "timeout"
  | "orphaned";

// HO 139 reaper threshold. 5x the 60s Vercel function ceiling — any
// `running` row older than this can only have come from a SIGKILL that
// pre-empted finishCronRun. The soft-timeout path (55s) finalizes cleanly
// before this fires, so reaching this means the function literally died.
const REAPER_THRESHOLD_MS = 5 * 60_000;

// HO 139 soft timeout. 5s buffer under the 60s ceiling leaves room for the
// finalize-row write to land before Vercel kills the function.
const DEFAULT_SOFT_TIMEOUT_MS = 55_000;

export class CronTimeoutError extends Error {
  constructor(public elapsedMs: number) {
    super(`cron soft timeout after ${elapsedMs}ms`);
    this.name = "CronTimeoutError";
  }
}

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
  status: Exclude<CronRunStatus, "running">,
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

// HO 139 inline reaper. Runs at the top of every wrapped cron route. Any
// `running` row older than the threshold is marked `orphaned` with
// `ended_at = now()`; subsequent finalize writes for those rows are
// impossible because the function that owned them is long dead. Idempotent.
async function reapStaleRows(): Promise<void> {
  await getDb().execute({
    sql: `UPDATE cron_runs
          SET status = 'orphaned',
              ended_at = ?,
              error_message = COALESCE(error_message, 'reaped by wrapCronRoute')
          WHERE status = 'running'
            AND (julianday(?) - julianday(started_at)) * 86400000 > ?`,
    args: [new Date().toISOString(), new Date().toISOString(), REAPER_THRESHOLD_MS],
  });
}

export type CronHandlerResult<T> = {
  payload: T;
  // Surfaces chronic-but-non-fatal conditions (e.g. summarize's
  // chronicFailures list) into cron_runs.error_message on success rows.
  // The /api/cron/news and /api/cron/summarize routes used this pattern
  // pre-HO 139; the wrapper preserves it.
  chronicErr?: string;
};

export type WrapCronResult<T> = {
  body: { ok: true; elapsedMs: number; payload: T } | {
    ok: false;
    elapsedMs: number;
    error: string;
    status: "error" | "timeout";
  };
  httpStatus: 200 | 500 | 504;
};

/**
 * Wrap a cron route handler. Sweeps stale rows, inserts a `running` row,
 * races the handler against a soft timeout, and finalizes the row with
 * `success` / `error` / `timeout` before returning. Callers turn the result
 * into a `NextResponse` — the wrapper is response-shape-agnostic so it can
 * sit under both `throw err` and `return 500` legacy routes.
 *
 * The handler MUST return `{ payload }` (and optionally `chronicErr`). The
 * wrapper does not look inside `payload`.
 */
export async function wrapCronRoute<T>(
  route: string,
  handler: () => Promise<CronHandlerResult<T>>,
  opts: { softTimeoutMs?: number } = {},
): Promise<WrapCronResult<T>> {
  const softTimeoutMs = opts.softTimeoutMs ?? DEFAULT_SOFT_TIMEOUT_MS;

  await reapStaleRows();

  const routeStart = Date.now();
  const runId = await startCronRun(route);

  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, rej) => {
    timeoutHandle = setTimeout(
      () => rej(new CronTimeoutError(Date.now() - routeStart)),
      softTimeoutMs,
    );
  });

  try {
    const result = await Promise.race([handler(), timeoutPromise]);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    const elapsedMs = Date.now() - routeStart;
    const responseBody = { ok: true as const, elapsedMs, payload: result.payload };
    await finishCronRun(runId, "success", responseBody, result.chronicErr);
    return { body: responseBody, httpStatus: 200 };
  } catch (err) {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    const elapsedMs = Date.now() - routeStart;
    const isTimeout = err instanceof CronTimeoutError;
    const status: "error" | "timeout" = isTimeout ? "timeout" : "error";
    const message = err instanceof Error ? err.message : String(err);
    const responseBody = {
      ok: false as const,
      elapsedMs,
      error: message,
      status,
    };
    await finishCronRun(runId, status, responseBody, message);
    return { body: responseBody, httpStatus: isTimeout ? 504 : 500 };
  }
}
