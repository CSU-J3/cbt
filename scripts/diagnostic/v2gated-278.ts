// HO 278 Step 0 — re-verify dashboard-v2's three summary-gated aggregates against
// prod Turso AS THEY STAND post-277 (no new indexes yet). EXPLAIN + repeated
// timing. Read-only. Run: npx tsx scripts/diagnostic/v2gated-278.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const CER = "(is_ceremonial = 0 OR is_ceremonial IS NULL)";
const FUNNEL = "'introduced','committee','floor','other_chamber','president','enacted'";

const QUERIES: Array<{ name: string; sql: string }> = [
  {
    name: "getCorpusStats(true)",
    sql: `SELECT COUNT(*) AS total, MAX(update_date) AS last_sync FROM bills WHERE ${CER} AND summary IS NOT NULL`,
  },
  {
    name: "getStageDistribution gated — stage GROUP BY",
    sql: `SELECT stage, COUNT(*) AS count FROM bills WHERE ${CER} AND stage IN (${FUNNEL}) AND summary IS NOT NULL GROUP BY stage`,
  },
  {
    name: "getStageDistribution gated — offPath",
    sql: `SELECT COUNT(*) AS n FROM bills WHERE ${CER} AND (stage = 'other' OR stage IS NULL) AND summary IS NOT NULL`,
  },
  {
    name: "getTopicDistribution gated",
    sql: `SELECT je.value AS topic, COUNT(*) AS count FROM bills, json_each(bills.topics) je WHERE bills.topics IS NOT NULL AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL) AND bills.summary IS NOT NULL GROUP BY je.value ORDER BY count DESC`,
  },
];

async function main() {
  for (const q of QUERIES) {
    console.log(`\n========== ${q.name} ==========`);
    const plan = await db.execute(`EXPLAIN QUERY PLAN ${q.sql}`);
    for (const r of plan.rows) console.log("  " + (r.detail as string));
    for (const t of ["t1", "t2", "t3"]) {
      const s = Date.now();
      const rs = await db.execute(q.sql);
      console.log(`  ${t}: ${Date.now() - s}ms (rows=${rs.rows.length})`);
    }
  }
}
main().then(() => process.exit(0));
