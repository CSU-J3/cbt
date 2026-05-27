// HO 135 cron health check. Read-only audit of cron_runs + data freshness
// for the four-cron sequence (HO 115/116/117/119) that shipped without a
// coordinated end-to-end verification. Run: `npx tsx scripts/diagnostic/cron-health-135.ts`.
import "dotenv/config";
import { getDb } from "../../lib/db";

const ROUTES: Array<{ path: string; schedule: string; cadence: "daily" | "weekly" }> = [
  { path: "/api/sync", schedule: "0 9 * * *", cadence: "daily" },
  { path: "/api/cron/weekly-report", schedule: "30 9 * * 1", cadence: "weekly" },
  { path: "/api/sync-votes", schedule: "0 10 * * *", cadence: "daily" },
  { path: "/api/sync-race-ratings", schedule: "0 11 * * 3", cadence: "weekly" },
  { path: "/api/cron/primaries", schedule: "0 12 * * *", cadence: "daily" },
  { path: "/api/cron/summarize", schedule: "0 13 * * *", cadence: "daily" },
  { path: "/api/cron/news", schedule: "0 14 * * *", cadence: "daily" },
];

async function main() {
  const db = getDb();
  const since = "datetime('now','-14 days')";

  console.log("=== Per-route rollup (last 14 days) ===\n");
  for (const route of ROUTES) {
    const rollup = await db.execute({
      sql: `SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN status='success' THEN 1 ELSE 0 END) AS ok,
              SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) AS err,
              SUM(CASE WHEN status='timeout' THEN 1 ELSE 0 END) AS tmo,
              SUM(CASE WHEN status='orphaned' THEN 1 ELSE 0 END) AS orph,
              SUM(CASE WHEN status='running' THEN 1 ELSE 0 END) AS running,
              AVG(elapsed_ms) AS avg_ms,
              MAX(elapsed_ms) AS max_ms
            FROM cron_runs
            WHERE route = ? AND started_at >= datetime('now','-14 days')`,
      args: [route.path],
    });
    const r = rollup.rows[0]!;
    const latest = await db.execute({
      sql: `SELECT started_at, status, elapsed_ms, error_message
            FROM cron_runs
            WHERE route = ?
            ORDER BY started_at DESC LIMIT 1`,
      args: [route.path],
    });
    const lr = latest.rows[0];
    const avg = r.avg_ms ? Math.round(Number(r.avg_ms) / 1000) : 0;
    const max = r.max_ms ? Math.round(Number(r.max_ms) / 1000) : 0;
    console.log(`ROUTE: ${route.path}`);
    console.log(`Schedule: ${route.schedule}  (${route.cadence})`);
    console.log(
      `Runs: total=${r.total}  success=${r.ok}  error=${r.err}  timeout=${r.tmo}  orphaned=${r.orph}  running=${r.running}`,
    );
    console.log(`Duration: avg ${avg}s, max ${max}s`);
    if (lr) {
      console.log(
        `Last run: ${lr.started_at}, ${lr.status}, ${Math.round(Number(lr.elapsed_ms ?? 0) / 1000)}s${lr.error_message ? `  err="${lr.error_message}"` : ""}`,
      );
    } else {
      console.log(`Last run: (no rows ever)`);
    }
    console.log();
  }

  console.log("=== Errors / timeouts / orphans in last 14 days ===\n");
  const bad = await db.execute(`
    SELECT route, started_at, status, elapsed_ms, error_message
    FROM cron_runs
    WHERE started_at >= datetime('now','-14 days')
      AND status IN ('error','timeout','orphaned')
    ORDER BY started_at DESC
    LIMIT 100`);
  if (bad.rows.length === 0) {
    console.log("  (none)\n");
  } else {
    for (const row of bad.rows) {
      console.log(
        `  ${row.started_at} ${row.route} ${row.status} ${Math.round(Number(row.elapsed_ms ?? 0) / 1000)}s  ${row.error_message ?? ""}`,
      );
    }
    console.log();
  }

  console.log("=== Success rows with error_message (chronic-but-OK) ===\n");
  const chronic = await db.execute(`
    SELECT route, started_at, elapsed_ms, error_message
    FROM cron_runs
    WHERE started_at >= datetime('now','-14 days')
      AND status = 'success'
      AND error_message IS NOT NULL
    ORDER BY started_at DESC
    LIMIT 50`);
  if (chronic.rows.length === 0) {
    console.log("  (none)\n");
  } else {
    for (const row of chronic.rows) {
      console.log(
        `  ${row.started_at} ${row.route} ${Math.round(Number(row.elapsed_ms ?? 0) / 1000)}s  ${row.error_message}`,
      );
    }
    console.log();
  }

  console.log("=== Data freshness ===\n");
  const bills = await db.execute(
    `SELECT MAX(update_date) AS latest FROM bills`,
  );
  console.log(`  bills.update_date max:        ${bills.rows[0]?.latest}`);

  const summary = await db.execute(
    `SELECT MAX(summary_updated_at) AS latest FROM bills WHERE summary IS NOT NULL`,
  );
  console.log(`  bills.summary_updated_at max: ${summary.rows[0]?.latest}`);

  const news = await db.execute(
    `SELECT MAX(ingested_at) AS latest_ingest, MAX(published_at) AS latest_pub FROM news_mentions`,
  );
  console.log(`  news_mentions.ingested_at max: ${news.rows[0]?.latest_ingest}`);
  console.log(`  news_mentions.published_at max: ${news.rows[0]?.latest_pub}`);

  // Bonus: per-route durations distribution (over 14d)
  console.log("\n=== Duration buckets (14d, success only) ===\n");
  const buckets = await db.execute(`
    SELECT route,
           SUM(CASE WHEN elapsed_ms < 10000 THEN 1 ELSE 0 END) AS lt10s,
           SUM(CASE WHEN elapsed_ms >= 10000 AND elapsed_ms < 30000 THEN 1 ELSE 0 END) AS lt30s,
           SUM(CASE WHEN elapsed_ms >= 30000 AND elapsed_ms < 50000 THEN 1 ELSE 0 END) AS lt50s,
           SUM(CASE WHEN elapsed_ms >= 50000 AND elapsed_ms < 55000 THEN 1 ELSE 0 END) AS lt55s,
           SUM(CASE WHEN elapsed_ms >= 55000 THEN 1 ELSE 0 END) AS gte55s
    FROM cron_runs
    WHERE started_at >= datetime('now','-14 days') AND status='success'
    GROUP BY route ORDER BY route`);
  for (const row of buckets.rows) {
    console.log(
      `  ${row.route}: <10s=${row.lt10s} 10-30s=${row.lt30s} 30-50s=${row.lt50s} 50-55s=${row.lt55s} >=55s=${row.gte55s}`,
    );
  }
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
