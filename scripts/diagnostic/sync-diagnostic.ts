import "dotenv/config";
import { getDb } from "../../lib/db";

async function main() {
  const db = getDb();

  console.log("=== Q1: summary_updated_at distribution, last 7 days ===");
  const q1 = await db.execute(`
    SELECT date(summary_updated_at) AS day, COUNT(*) AS bills_summarized
    FROM bills
    WHERE summary_updated_at IS NOT NULL
    GROUP BY day
    ORDER BY day DESC
    LIMIT 7`);
  for (const r of q1.rows) console.log(`  ${r.day}: ${r.bills_summarized}`);

  console.log("\n=== Q2: backlog (summary IS NULL) ===");
  const q2 = await db.execute(
    `SELECT COUNT(*) AS backlog FROM bills WHERE summary IS NULL`,
  );
  console.log(`  backlog: ${q2.rows[0]?.backlog}`);

  console.log("\n=== Q2c: backlog skipped by 24h failure clause ===");
  const q2c = await db.execute(`
    SELECT COUNT(*) AS n FROM bills
    WHERE summary IS NULL
      AND summarize_failed_at IS NOT NULL
      AND summarize_failed_at >= datetime('now','-24 hours')`);
  console.log(`  deferred (failed in last 24h): ${q2c.rows[0]?.n}`);

  console.log("\n=== Q2d: bills with summarize_attempts > 0 ===");
  const q2d = await db.execute(`
    SELECT summarize_attempts, COUNT(*) AS n FROM bills
    WHERE summarize_attempts > 0
    GROUP BY summarize_attempts ORDER BY summarize_attempts`);
  if (q2d.rows.length === 0) console.log("  (none — clean slate)");
  for (const r of q2d.rows) console.log(`  attempts=${r.summarize_attempts}: ${r.n}`);

  console.log("\n=== Q3: cron_runs (last 10) ===");
  const q3 = await db.execute(`
    SELECT route, started_at, ended_at, status, elapsed_ms,
           CASE WHEN error_message IS NULL THEN '' ELSE substr(error_message,1,90) END AS err,
           substr(payload, 1, 160) AS payload_head
    FROM cron_runs ORDER BY started_at DESC LIMIT 10`);
  for (const r of q3.rows) {
    console.log(
      `  ${r.route} | ${r.started_at} | ${r.status} | ${r.elapsed_ms ?? "?"}ms`,
    );
    if (r.err) console.log(`    err: ${r.err}`);
    if (r.payload_head) console.log(`    payload: ${r.payload_head}`);
  }

  console.log("\n=== Q4: bills corpus freshness ===");
  const q4 = await db.execute(`
    SELECT MAX(update_date) AS latest_update,
           MAX(summary_updated_at) AS latest_summary,
           COUNT(*) AS total
    FROM bills`);
  const r4 = q4.rows[0];
  console.log(`  latest update_date:        ${r4?.latest_update}`);
  console.log(`  latest summary_updated_at: ${r4?.latest_summary}`);
  console.log(`  total bills:               ${r4?.total}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
