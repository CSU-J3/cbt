// HO 477 cron-health watchdog — the shared health module (single source of
// truth for both /api/health and scripts/diagnostic/cron-health-135.ts).
//
// The load-bearing insight (handoff): a cron that silently STOPS FIRING is
// invisible to Vercel's own monitoring — no invocation means no function error
// to alert on — so the only thing that catches it is an external "is the data
// fresh?" PULL against this module.
//
// Liveness rule (HO 477, refined against the HO 139/116 soft-timeout design):
// a `timeout` row PROVES the cron fired and executed — this codebase's
// time-budgeted routes hit the 55s soft cap AFTER the primary work commits (why
// /api/sync reads `timeout` with bills 1.1h fresh). So `timeout` == `success`
// == "fired and alive". A route is unhealthy iff:
//   (a) no success-or-timeout row within its window  → stopped firing / dark, OR
//   (b) its most-recent run is `error` / `orphaned`   → a hard throw / SIGKILL.
// `running` is in-flight (not counted as a failure; the prior alive row carries
// liveness). This deliberately does NOT flag a route that times out forever
// while committing nothing — cron_runs status can't distinguish that from a
// healthy-but-slow route; a general per-route data-freshness layer catches it
// and is BANKED, not this HO.
//
// Markets is the ONE exception: `?source=fmp` and the bare run both log the
// fixed `route="/api/cron/markets"` (markets/route.ts), so cron_runs can't tell
// them apart. Its signal is instead `market_ticks` freshness — the literal "no
// market_ticks write in N hours" the backlog loop asked for — which backstops
// the POLY-SHUTDOWN ghost (a chronic partial-failure `success` row): if ticks
// keep landing it's healthy regardless of the chronicErr string; if they stop,
// unhealthy regardless. A markets `error`/`orphaned` is still a hard failure.
import { getDb } from "@/lib/db";

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

export type CronSignal = "cron_runs" | "market_ticks";

export type CronRoute = {
  path: string;
  schedule: string;
  // ~2× cadence + ~1h grace for sub-daily; ~one-missed-fire + grace for daily;
  // a generous flat window for weekly (windowOnly). A route is stale when its
  // freshness signal exceeds this.
  maxStaleMs: number;
  // Weekly cadence — a flat age would false-alarm on the off-days, so the
  // window is generous (~9d MVP). Window-aware next-fire precision is banked.
  windowOnly?: boolean;
  // Freshness signal. Default "cron_runs" (success/timeout liveness). Markets
  // uses "market_ticks" (MAX(ticked_at) age) because its two Vercel crons share
  // one route string.
  signal?: CronSignal;
};

// The 14 watched route keys (15 vercel.json crons — the two /api/cron/markets
// entries collapse to one route string). Thresholds from vercel.json@45e70f6.
export const CRON_ROUTES: readonly CronRoute[] = [
  { path: "/api/cron/summarize", schedule: "*/10 * * * *", maxStaleMs: 30 * MIN }, // every 10m
  { path: "/api/cron/news", schedule: "*/30 * * * *", maxStaleMs: 70 * MIN }, // every 30m
  { path: "/api/cron/kalshi", schedule: "15 */2 * * *", maxStaleMs: 5 * HOUR }, // every 2h
  { path: "/api/cron/markets", schedule: "0 */4 * * *", maxStaleMs: 9 * HOUR, signal: "market_ticks" }, // bare every 4h
  { path: "/api/sync", schedule: "0 */6 * * *", maxStaleMs: 13 * HOUR }, // every 6h
  { path: "/api/cron/committees", schedule: "0 */12 * * *", maxStaleMs: 25 * HOUR }, // every 12h
  { path: "/api/sync-votes", schedule: "0 10 * * *", maxStaleMs: 26 * HOUR }, // daily
  { path: "/api/cron/primaries", schedule: "0 12 * * *", maxStaleMs: 26 * HOUR }, // daily
  { path: "/api/cron/rating-history", schedule: "0 15 * * *", maxStaleMs: 26 * HOUR }, // daily
  { path: "/api/cron/lda", schedule: "0 8 * * *", maxStaleMs: 26 * HOUR }, // daily
  { path: "/api/cron/amendments", schedule: "0 7 * * *", maxStaleMs: 26 * HOUR }, // daily
  { path: "/api/cron/nominations", schedule: "0 9 * * *", maxStaleMs: 26 * HOUR }, // daily
  { path: "/api/cron/weekly-report", schedule: "30 9 * * 1", maxStaleMs: 9 * DAY, windowOnly: true }, // weekly
  { path: "/api/sync-race-ratings", schedule: "0 11 * * 3", maxStaleMs: 9 * DAY, windowOnly: true }, // weekly (Wed)
];

export type CronRouteHealth = {
  path: string;
  schedule: string;
  signal: CronSignal;
  maxStaleMs: number;
  windowOnly: boolean;
  lastRunAt: string | null; // most-recent cron_runs row, any status
  lastStatus: string | null;
  freshAt: string | null; // liveness timestamp: last success/timeout, or last tick for markets
  ageMs: number | null; // age of freshAt
  healthy: boolean;
  note?: string;
};

export type CronHealth = {
  healthy: boolean;
  checkedAt: string;
  unhealthy: string[];
  routes: CronRouteHealth[];
};

const HARD_FAIL = new Set(["error", "orphaned"]);
const ALIVE = new Set(["success", "timeout"]);

function ageHours(ms: number | null): string {
  return ms == null ? "never" : `${(ms / HOUR).toFixed(1)}h`;
}

async function evalCronRunsRoute(route: CronRoute, now: number): Promise<CronRouteHealth> {
  const db = getDb();
  const [lastRunRes, aliveRes] = await Promise.all([
    db.execute({
      sql: `SELECT started_at, status FROM cron_runs
            WHERE route = ? ORDER BY started_at DESC LIMIT 1`,
      args: [route.path],
    }),
    db.execute({
      sql: `SELECT started_at FROM cron_runs
            WHERE route = ? AND status IN ('success','timeout')
            ORDER BY started_at DESC LIMIT 1`,
      args: [route.path],
    }),
  ]);
  const lastRun = lastRunRes.rows[0];
  const alive = aliveRes.rows[0];
  const lastRunAt = lastRun ? String(lastRun.started_at) : null;
  const lastStatus = lastRun ? String(lastRun.status) : null;
  const freshAt = alive ? String(alive.started_at) : null;
  const ageMs = freshAt ? now - Date.parse(freshAt) : null;

  const stale = ageMs == null || ageMs > route.maxStaleMs;
  const hardFail = lastStatus != null && HARD_FAIL.has(lastStatus);
  const healthy = !stale && !hardFail;

  let note: string | undefined;
  if (hardFail) note = `last run ${lastStatus}`;
  else if (stale)
    note = freshAt
      ? `no success/timeout in ${ageHours(ageMs)} (> ${ageHours(route.maxStaleMs)})`
      : `no cron_runs row ever`;

  return {
    path: route.path,
    schedule: route.schedule,
    signal: "cron_runs",
    maxStaleMs: route.maxStaleMs,
    windowOnly: route.windowOnly ?? false,
    lastRunAt,
    lastStatus,
    freshAt,
    ageMs,
    healthy,
    note,
  };
}

async function evalMarketTicksRoute(route: CronRoute, now: number): Promise<CronRouteHealth> {
  const db = getDb();
  // market_ticks is a small table (~74 rows/day, ~4k total) so an unfiltered
  // MAX(ticked_at) is cheap even without a ticked_at-only index. Plus the
  // status side: a markets error/orphaned is a hard failure even if ticks are
  // fresh (a POLY-SHUTDOWN-ghost success is not — it stays status='success').
  const [ticksRes, lastRunRes] = await Promise.all([
    db.execute(`SELECT MAX(ticked_at) AS latest FROM market_ticks`),
    db.execute({
      sql: `SELECT started_at, status, error_message FROM cron_runs
            WHERE route = ? ORDER BY started_at DESC LIMIT 1`,
      args: [route.path],
    }),
  ]);
  const latest = ticksRes.rows[0]?.latest;
  const freshAt = latest != null ? String(latest) : null;
  const ageMs = freshAt ? now - Date.parse(freshAt) : null;
  const lastRun = lastRunRes.rows[0];
  const lastRunAt = lastRun ? String(lastRun.started_at) : null;
  const lastStatus = lastRun ? String(lastRun.status) : null;

  const stale = ageMs == null || ageMs > route.maxStaleMs;
  const hardFail = lastStatus != null && HARD_FAIL.has(lastStatus);
  const healthy = !stale && !hardFail;

  let note: string | undefined;
  if (hardFail) note = `last run ${lastStatus}`;
  else if (stale)
    note = freshAt
      ? `no market_ticks write in ${ageHours(ageMs)} (> ${ageHours(route.maxStaleMs)})`
      : `market_ticks empty`;
  else {
    const ghost =
      lastStatus === "success" &&
      typeof lastRun?.error_message === "string" &&
      lastRun.error_message.includes("POLY-SHUTDOWN");
    note = `market_ticks ${ageHours(ageMs)} fresh${ghost ? " (POLY-SHUTDOWN ghost, ignored)" : ""}`;
  }

  return {
    path: route.path,
    schedule: route.schedule,
    signal: "market_ticks",
    maxStaleMs: route.maxStaleMs,
    windowOnly: route.windowOnly ?? false,
    lastRunAt,
    lastStatus,
    freshAt,
    ageMs,
    healthy,
    note,
  };
}

// Read the fleet's health from cron_runs (+ market_ticks for markets). All reads
// ride existing indexes (idx_cron_runs_route_started; market_ticks is tiny), so
// this is cheap enough to serve on every /api/health poll.
export async function computeCronHealth(): Promise<CronHealth> {
  const now = Date.now();
  const routes = await Promise.all(
    CRON_ROUTES.map((r) =>
      (r.signal === "market_ticks" ? evalMarketTicksRoute : evalCronRunsRoute)(r, now),
    ),
  );
  const unhealthy = routes.filter((r) => !r.healthy).map((r) => r.path);
  return {
    healthy: unhealthy.length === 0,
    checkedAt: new Date(now).toISOString(),
    unhealthy,
    routes,
  };
}

// Exported for the diagnostic's unused-import guard / potential reuse.
export { ALIVE, HARD_FAIL };
