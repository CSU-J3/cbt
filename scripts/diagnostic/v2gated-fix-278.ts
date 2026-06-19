// HO 278 Step 1 — test covering indexes + INDEXED BY for the gated v2 aggregates.
// Additive CREATE INDEX (idempotent). Against prod Turso.
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const CER = "(is_ceremonial = 0 OR is_ceremonial IS NULL)";
const FUNNEL = "'introduced','committee','floor','other_chamber','president','enacted'";

async function go(label: string, sql: string) {
  console.log(`\n--- ${label} ---`);
  const plan = await db.execute(`EXPLAIN QUERY PLAN ${sql}`);
  for (const r of plan.rows) console.log("  " + (r.detail as string));
  for (const t of ["t1", "t2", "t3"]) {
    const s = Date.now();
    const rs = await db.execute(sql);
    console.log(`  ${t}: ${Date.now() - s}ms (rows=${rs.rows.length})`);
  }
}

async function main() {
  // (1) getCorpusStats(true) — reuse the 277 partial index idx_bills_summary_feed.
  await go(
    "corpus(true) + INDEXED BY idx_bills_summary_feed",
    `SELECT COUNT(*) AS total, MAX(update_date) AS last_sync FROM bills INDEXED BY idx_bills_summary_feed WHERE ${CER} AND summary IS NOT NULL`,
  );

  // (2) gated stage — new partial covering index keyed on stage (kills temp-b-tree GROUP BY).
  console.log("\nCreating idx_bills_summary_stage (stage, is_ceremonial) WHERE summary IS NOT NULL...");
  let s = Date.now();
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_bills_summary_stage ON bills(stage, is_ceremonial) WHERE summary IS NOT NULL`);
  console.log(`  built ${Date.now() - s}ms`);
  await go(
    "stage GROUP BY — no hint",
    `SELECT stage, COUNT(*) AS count FROM bills WHERE ${CER} AND stage IN (${FUNNEL}) AND summary IS NOT NULL GROUP BY stage`,
  );
  await go(
    "stage GROUP BY — INDEXED BY idx_bills_summary_stage",
    `SELECT stage, COUNT(*) AS count FROM bills INDEXED BY idx_bills_summary_stage WHERE ${CER} AND stage IN (${FUNNEL}) AND summary IS NOT NULL GROUP BY stage`,
  );
  await go(
    "offPath — INDEXED BY idx_bills_summary_stage",
    `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_summary_stage WHERE ${CER} AND (stage = 'other' OR stage IS NULL) AND summary IS NOT NULL`,
  );

  // (3) gated topic — new partial covering index incl. topics for the json_each feed.
  console.log("\nCreating idx_bills_summary_topics (is_ceremonial, topics) WHERE summary IS NOT NULL...");
  s = Date.now();
  await db.execute(`CREATE INDEX IF NOT EXISTS idx_bills_summary_topics ON bills(is_ceremonial, topics) WHERE summary IS NOT NULL`);
  console.log(`  built ${Date.now() - s}ms`);
  await go(
    "topic — no hint",
    `SELECT je.value AS topic, COUNT(*) AS count FROM bills, json_each(bills.topics) je WHERE bills.topics IS NOT NULL AND ${CER.replace(/is_ceremonial/g, "bills.is_ceremonial")} AND bills.summary IS NOT NULL GROUP BY je.value ORDER BY count DESC`,
  );
  await go(
    "topic — INDEXED BY idx_bills_summary_topics",
    `SELECT je.value AS topic, COUNT(*) AS count FROM bills INDEXED BY idx_bills_summary_topics, json_each(bills.topics) je WHERE bills.topics IS NOT NULL AND ${CER.replace(/is_ceremonial/g, "bills.is_ceremonial")} AND bills.summary IS NOT NULL GROUP BY je.value ORDER BY count DESC`,
  );
}
main().then(() => process.exit(0));
