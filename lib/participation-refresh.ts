// HO 595 — the refresh writer for `member_participation`.
//
// Runs on the ONLY writer of member_votes: /api/sync-votes (cron "0 10 * * *"),
// after both chamber syncs. There is no other writer — lib/votes-sync.ts and
// lib/senate-votes-sync.ts hold the only INSERT/DELETE statements against
// member_votes, and both are reached only from that route. So materializing here
// is freshness-NEUTRAL and marginally better than today: the value publishes at
// sync time instead of up to an hour later, whereas the shipped
// `revalidate: 3600` spends ~23 recomputes a day re-deriving values that cannot
// have changed.
//
// WHY ITS OWN CLIENT, NOT getDb(). getDb() bounds every request at 10s
// (DB_REQUEST_TIMEOUT_MS) with one retry. HO 595 M3 measured this very aggregate
// at 807ms median / 11.95s worst WITH the covering index — i.e. the refresh job
// breaches the same bound it exists to let the request path escape. It therefore
// gets a dedicated 30s client, the same reasoning that made the 14.3s index build
// need a long-timeout apply past migrate.ts's 10s. This does NOT change
// DB_REQUEST_TIMEOUT_MS and does not touch the retry (HO 595 scope guard 2) —
// it is a second client for one job, not a loosened global bound.
//
// WHY 30s AND NOT MORE: the route carries `maxDuration = 60` and the two syncs
// run first, so the refresh is spending whatever is left. 30s is ~2.5x the
// measured worst and still leaves headroom for the function to return. If the
// budget is genuinely gone the refresh fails — and failing is safe here, which is
// the next point.
//
// NON-DESTRUCTIVE BY CONSTRUCTION. The failure mode to design against is HO 552:
// a transient failure became permanent data loss because the exit path stamped
// regardless. So this NEVER does DELETE-then-INSERT-and-hope:
//   1. read the aggregate first; if that throws, we return having written nothing
//   2. refuse to write an empty or implausibly-shrunken result (the guard below)
//   3. write DELETE + all INSERTs in ONE atomic libsql batch, so a mid-flight
//      failure rolls back to the previous contents rather than truncating
// The table therefore either holds the previous good values or the new ones, and
// never a partial state.
//
// THE STAMP IS THE INSTRUMENT. A stale materialized table renders correct-looking
// numbers with no error and no visual tell, so `refreshed_at` is written on every
// row and the outcome is returned for the cron payload (the HO 407
// payload.reportCatchup precedent). A failure also logs the greppable prefix
// `[participation] refresh-failed:`.
import { createClient } from "@libsql/client";

const REFRESH_TIMEOUT_MS = 30_000;

// Refuse to replace a populated table with a result this much smaller — a
// truncated upstream read should surface as a stale table plus a non-advancing
// stamp, never as a silently emptied surface.
const MIN_RETAIN_RATIO = 0.5;

export type ParticipationRefresh = {
  ok: boolean;
  rows: number;
  previousRows: number;
  refreshedAt: string | null;
  ms: number;
  skipped?: string;
  error?: string;
};

function refreshClient() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
    fetch: (input: RequestInfo | URL, init?: RequestInit) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS) }),
  });
}

// TEST SEAM, deliberately shipped. The non-destructive guards below are the whole
// safety argument of this module, and an untriggered guard is UNPROVEN, not
// protection (HO 552's loss happened in a branch nobody had fired). These let
// scripts/diagnostic/participation-falsify-595.ts drive each failure path against
// the REAL table and confirm it keeps its previous values and does not re-stamp.
// Never set from the request path — the only caller passes nothing.
export type RefreshSimulation = "empty" | "shrink" | "throw";

export async function refreshMemberParticipation(
  opts: { simulate?: RefreshSimulation } = {},
): Promise<ParticipationRefresh> {
  const started = Date.now();
  const out: ParticipationRefresh = {
    ok: false,
    rows: 0,
    previousRows: 0,
    refreshedAt: null,
    ms: 0,
  };

  let db: ReturnType<typeof createClient>;
  try {
    db = refreshClient();
  } catch (e) {
    out.error = e instanceof Error ? e.message : String(e);
    out.ms = Date.now() - started;
    return out;
  }

  try {
    const prev = await db.execute("SELECT COUNT(*) AS n FROM member_participation");
    out.previousRows = Number((prev.rows[0] as Record<string, unknown>)?.n ?? 0);

    // The aggregate. INDEXED BY is mandatory here for the same reason it is on the
    // read path (HO 594): the statless Turso planner otherwise picks the older
    // non-covering idx_member_votes_bioguide and row-fetches all 366k rows. On the
    // refresh path that is the difference between ~800ms and ~15s (HO 595 M3).
    const agg = await db.execute(
      `SELECT mv.bioguide_id AS bioguideId,
              COUNT(*) AS total,
              SUM(CASE WHEN mv.position = 'not_voting' THEN 1 ELSE 0 END) AS nv
         FROM member_votes mv INDEXED BY idx_member_votes_participation
        GROUP BY mv.bioguide_id`,
    );

    let rows = agg.rows.map((r) => ({
      bioguideId: String(r.bioguideId ?? ""),
      total: Number(r.total ?? 0),
      nv: Number(r.nv ?? 0),
    }));

    if (opts.simulate === "empty") rows = [];
    if (opts.simulate === "shrink") rows = rows.slice(0, Math.floor(rows.length * 0.1));
    if (opts.simulate === "throw") throw new Error("simulated mid-flight failure (test seam)");

    if (rows.length === 0) {
      out.skipped = "aggregate returned 0 rows — kept previous values";
      out.ms = Date.now() - started;
      console.error(`[participation] refresh-failed: ${out.skipped}`);
      return out;
    }
    if (out.previousRows > 0 && rows.length < out.previousRows * MIN_RETAIN_RATIO) {
      out.skipped = `aggregate returned ${rows.length} rows vs ${out.previousRows} held (< ${MIN_RETAIN_RATIO}x) — kept previous values`;
      out.ms = Date.now() - started;
      console.error(`[participation] refresh-failed: ${out.skipped}`);
      return out;
    }

    const refreshedAt = new Date().toISOString();
    // ONE atomic batch: a mid-flight failure rolls back to the previous contents
    // instead of leaving the table truncated or half-written.
    const stmts: Array<{ sql: string; args: (string | number)[] }> = [
      { sql: "DELETE FROM member_participation", args: [] },
    ];
    for (const r of rows) {
      if (!r.bioguideId) continue;
      stmts.push({
        sql: `INSERT INTO member_participation (bioguide_id, total, not_voting, refreshed_at)
              VALUES (?, ?, ?, ?)`,
        args: [r.bioguideId, r.total, r.nv, refreshedAt],
      });
    }
    await db.batch(stmts, "write");

    out.ok = true;
    out.rows = stmts.length - 1;
    out.refreshedAt = refreshedAt;
    out.ms = Date.now() - started;
    console.log(`[participation] refreshed ${out.rows} rows in ${out.ms}ms at ${refreshedAt}`);
    return out;
  } catch (e) {
    out.error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    out.ms = Date.now() - started;
    console.error(`[participation] refresh-failed: ${out.error}`);
    return out;
  }
}
