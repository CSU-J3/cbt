// HO 432 — a lightweight advisory lock for cron routes that must not run two
// drains concurrently. Motivated by the move to Vercel Pro sub-daily cadences:
// Vercel Cron is best-effort *at-least-once*, so a single scheduled tick can be
// delivered twice near-simultaneously. For an idempotent route (news, kalshi)
// that's harmless, but summarize's drain both (a) burns duplicate Gemini spend on
// the same `summary IS NULL` rows and (b) double-writes the append-only
// `stage_transitions` log. This lock lets exactly one invocation proceed.
//
// Turso/libsql is single-writer, so the conditional upsert below is atomic: of N
// concurrent claimants exactly one sees rowsAffected=1. A holder that dies
// mid-run (SIGKILL) self-heals when its claim ages past `ttlMs` — the same
// stale-row idea as the cron_runs reaper (lib/cron-log.ts). Backed by the generic
// `dashboard_state` key/value table (same table kalshi/committees already use),
// so there's no schema/migrate.ts change.
import { getDb } from "./db";

// A timestamp far enough in the past that any `updated_at < staleBefore` check
// treats a released lock as immediately claimable.
const RELEASED_AT = "1970-01-01T00:00:00.000Z";

/**
 * Attempt to claim `key` for up to `ttlMs`. Returns true if this caller won the
 * claim (either the key was free/absent, or a prior claim had aged past ttlMs),
 * false if another caller holds a still-fresh claim. Set `ttlMs` comfortably
 * above the route's worst-case wall-clock (e.g. the 55s cron soft-timeout) so a
 * clean run always releases before its own claim would expire.
 */
export async function claimCronLock(key: string, ttlMs: number): Promise<boolean> {
  const now = Date.now();
  const staleBefore = new Date(now - ttlMs).toISOString();
  // INSERT when absent → claim. On conflict, DO UPDATE only fires (claim, stealing
  // a stale lock) when the existing claim is older than staleBefore; a fresh claim
  // fails the WHERE → 0 rows changed → we lose the race.
  const rs = await getDb().execute({
    sql: `INSERT INTO dashboard_state (key, value, updated_at)
          VALUES (?, 'held', ?)
          ON CONFLICT(key) DO UPDATE
            SET value = 'held', updated_at = excluded.updated_at
            WHERE dashboard_state.updated_at < ?`,
    args: [key, new Date(now).toISOString(), staleBefore],
  });
  return rs.rowsAffected > 0;
}

/**
 * Release `key` so the next tick can claim it immediately. Safe to call in a
 * `finally`; if the function is killed before this runs, the claim's ttl expiry
 * covers it.
 */
export async function releaseCronLock(key: string): Promise<void> {
  await getDb().execute({
    sql: `UPDATE dashboard_state SET value = 'free', updated_at = ? WHERE key = ?`,
    args: [RELEASED_AT, key],
  });
}
