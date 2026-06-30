// HO 382 — create idx_bills_summary_stage_topics (APPROVED DDL) + verify it is
// genuinely COVERING for both filtered distributions. READ-ONLY after the CREATE.
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

function hr(t: string) {
  console.log("\n========== " + t + " ==========");
}

async function explainTimed(label: string, sql: string, args: unknown[] = []) {
  let covering = false;
  let touchesTable = false;
  try {
    const rs = await db.execute({
      sql: "EXPLAIN QUERY PLAN " + sql,
      args: args as never,
    });
    console.log(`\nPLAN ${label}:`);
    for (const r of rs.rows) {
      const d = r.detail as string;
      console.log("   " + d);
      if (/USING COVERING INDEX idx_bills_summary_stage_topics/.test(d))
        covering = true;
      // a non-covering touch of the bills b-tree on the stage_topics index path:
      if (/\bbills\b.*USING INDEX idx_bills_summary_stage_topics/.test(d) &&
          !/COVERING/.test(d))
        touchesTable = true;
      if (/SEARCH bills USING INTEGER PRIMARY KEY/.test(d)) touchesTable = true;
    }
  } catch (e) {
    console.log(`PLAN ${label} EXPLAIN threw: ${(e as Error).message}`);
  }
  const t0 = Date.now();
  try {
    const rs = await db.execute({ sql, args: args as never });
    console.log(
      `OK [${Date.now() - t0}ms] ${label} → ${rs.rows.length} row(s)` +
        `  [covering=${covering} touchesTable=${touchesTable}]`,
    );
  } catch (e) {
    console.log(`THROW [${Date.now() - t0}ms] ${label}: ${(e as Error).message}`);
  }
}

async function main() {
  hr("CREATE INDEX (approved, additive, IF NOT EXISTS)");
  const t0 = Date.now();
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_summary_stage_topics ON bills(stage, is_ceremonial, topics) WHERE summary IS NOT NULL",
  );
  console.log(`created in ${Date.now() - t0}ms`);

  // ---- getTopicDistribution(+stage), gated, FORCED INDEXED BY ----
  hr("getTopicDistribution(+stage) — forced idx_bills_summary_stage_topics");
  const td = (st: string) => ({
    sql: `SELECT je.value AS topic, COUNT(*) AS count
      FROM bills INDEXED BY idx_bills_summary_stage_topics, json_each(bills.topics) je
      WHERE bills.topics IS NOT NULL
        AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)
        AND bills.summary IS NOT NULL AND bills.stage = ?
      GROUP BY je.value ORDER BY count DESC`,
    args: [st],
  });
  for (const st of ["committee", "president", "floor", "other_chamber", "enacted", "introduced"]) {
    const { sql, args } = td(st);
    await explainTimed(`topicDist stage=${st}`, sql, args);
  }

  // ---- getStageDistribution(+topic), gated, FORCED INDEXED BY ----
  hr("getStageDistribution(+topic) — forced idx_bills_summary_stage_topics");
  const sdBars = (tp: string) => ({
    sql: `SELECT stage, COUNT(*) AS count
      FROM bills INDEXED BY idx_bills_summary_stage_topics
      WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
        AND stage IN ('introduced','committee','floor','other_chamber','president','enacted')
        AND summary IS NOT NULL
        AND EXISTS (SELECT 1 FROM json_each(bills.topics) WHERE value = ?)
      GROUP BY stage`,
    args: [tp],
  });
  const sdOff = (tp: string) => ({
    sql: `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_summary_stage_topics
      WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
        AND (stage = 'other' OR stage IS NULL)
        AND summary IS NOT NULL
        AND EXISTS (SELECT 1 FROM json_each(bills.topics) WHERE value = ?)`,
    args: [tp],
  });
  for (const tp of ["defense", "healthcare", "government_operations"]) {
    const b = sdBars(tp);
    await explainTimed(`stageDist.bars topic=${tp}`, b.sql, b.args);
    const o = sdOff(tp);
    await explainTimed(`stageDist.off  topic=${tp}`, o.sql, o.args);
  }
}

main().then(() => process.exit(0));
