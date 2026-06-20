// HO 284 read-only probe: weekly-report cron failure history.
// Run: npx tsx scripts/diagnostic/report-cron-probe-284.ts
import "dotenv/config";
import { getDb } from "../../lib/db";

async function main() {
  const db = getDb();

  console.log("=== /api/cron/weekly-report — last 30 runs ===\n");
  const runs = await db.execute(
    `SELECT id, started_at, status, elapsed_ms, error_message
     FROM cron_runs
     WHERE route = '/api/cron/weekly-report'
     ORDER BY started_at DESC
     LIMIT 30`,
  );
  for (const r of runs.rows) {
    const err = (r.error_message as string | null) ?? "";
    console.log(
      `#${r.id}  ${r.started_at}  ${String(r.status).padEnd(8)}  ${String(
        r.elapsed_ms ?? "",
      ).padStart(7)}ms  ${err.slice(0, 120)}`,
    );
  }

  console.log("\n=== status rollup (all time) ===\n");
  const rollup = await db.execute(
    `SELECT status, COUNT(*) n, AVG(elapsed_ms) avg_ms, MIN(elapsed_ms) min_ms, MAX(elapsed_ms) max_ms
     FROM cron_runs WHERE route='/api/cron/weekly-report'
     GROUP BY status ORDER BY n DESC`,
  );
  for (const r of rollup.rows) {
    console.log(
      `${String(r.status).padEnd(9)} n=${r.n}  avg=${Math.round(
        Number(r.avg_ms ?? 0),
      )}ms  min=${r.min_ms}  max=${r.max_ms}`,
    );
  }

  console.log("\n=== distinct error_message values + counts ===\n");
  const errs = await db.execute(
    `SELECT error_message, COUNT(*) n, MIN(started_at) first, MAX(started_at) last,
            AVG(elapsed_ms) avg_ms
     FROM cron_runs
     WHERE route='/api/cron/weekly-report' AND error_message IS NOT NULL
     GROUP BY error_message ORDER BY n DESC`,
  );
  for (const r of errs.rows) {
    console.log(
      `n=${r.n}  avg=${Math.round(Number(r.avg_ms ?? 0))}ms  [${r.first} .. ${r.last}]`,
    );
    console.log(`   ${(r.error_message as string).slice(0, 300)}\n`);
  }

  console.log("=== reports actually written (last 12 weeks) ===\n");
  const reps = await db.execute(
    `SELECT slug, created_at, laws_count, intro_count, moves_count
     FROM reports ORDER BY slug DESC LIMIT 12`,
  );
  for (const r of reps.rows) {
    console.log(
      `${r.slug}  created=${r.created_at}  laws=${r.laws_count} intro=${r.intro_count} moves=${r.moves_count}`,
    );
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
