// HO 277 (residual) — getFeedStats (HeaderBar, runs on /members + every inner
// page) is the summary-gated COUNT+MAX over fat bills, the same mis-plan as the
// HO 276 corpus_gated. Test a PARTIAL covering index. Read-only except the
// additive CREATE INDEX. Against prod Turso.
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const feedStats = (hint: string) =>
  `SELECT COUNT(*) AS total, MAX(update_date) AS last FROM bills ${hint} WHERE summary IS NOT NULL AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`;

// Re-check the deployed hinted members aggregate is genuinely fast (attribution).
const membersAgg = `
  WITH bills_agg AS (
    SELECT sponsor_bioguide_id, COUNT(*) AS total,
      SUM(CASE WHEN stage='enacted' THEN 1 ELSE 0 END) AS enacted
    FROM bills INDEXED BY idx_bills_sponsor_agg
    WHERE sponsor_bioguide_id IS NOT NULL AND (is_ceremonial=0 OR is_ceremonial IS NULL)
    GROUP BY sponsor_bioguide_id
  ) SELECT COUNT(*) FROM bills_agg`;

async function go(label: string, sql: string) {
  console.log(`\n--- ${label} ---`);
  const plan = await db.execute(`EXPLAIN QUERY PLAN ${sql}`);
  for (const r of plan.rows) console.log("  " + (r.detail as string));
  for (const t of ["t1", "t2", "t3"]) {
    const s = Date.now();
    await db.execute(sql);
    console.log(`  ${t}: ${Date.now() - s}ms`);
  }
}

async function main() {
  await go("getFeedStats — NO index yet", feedStats(""));
  console.log("\nCreating partial idx_bills_summary_feed (additive)...");
  const s = Date.now();
  await db.execute(
    `CREATE INDEX IF NOT EXISTS idx_bills_summary_feed ON bills(is_ceremonial, update_date) WHERE summary IS NOT NULL`,
  );
  console.log(`  built in ${Date.now() - s}ms`);
  await go("getFeedStats — NO hint (planner take partial index?)", feedStats(""));
  await go("getFeedStats — INDEXED BY idx_bills_summary_feed", feedStats("INDEXED BY idx_bills_summary_feed"));
  await go("membersAgg (deployed hint) — should be fast", membersAgg);
}
main().then(() => process.exit(0));
