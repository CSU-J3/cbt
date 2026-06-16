import "dotenv/config";
import { getDb } from "../../lib/db";
import { getDashboardPrimaries } from "../../lib/queries";

// HO 246 — cold-start offender hunt for the dashboard `/`. The cached helpers
// can't be called outside Next (unstable_cache throws "incrementalCache
// missing"), so we time the RAW SQL each dashboard bills-aggregate runs, plus
// getDashboardPrimaries (the one uncached plain-db helper, callable directly).
// EXPLAIN QUERY PLAN per query shows scan-vs-index. Run before AND after the
// introduced_date index. The new-bills query is timed FIRST so it bears a cold
// bills-table read (the later scanners warm it).

const ON = "(is_ceremonial = 0 OR is_ceremonial IS NULL)";

// Raw SQL mirrors the helpers in lib/queries.ts (getNewBillsThisWeekCount,
// getCorpusStats, getStageDistribution ×2, getTopicDistribution,
// queryEnactedThisWeek). Kept verbatim so the timing reflects the real query.
const QUERIES: { label: string; sql: string }[] = [
  {
    label: "newBills (introduced_date)",
    sql: `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_introduced_date WHERE ${ON} AND introduced_date IS NOT NULL AND introduced_date > date('now', '-7 days')`,
  },
  {
    label: "corpusStats",
    sql: `SELECT COUNT(*) AS total, MAX(update_date) AS last_sync FROM bills WHERE ${ON}`,
  },
  {
    label: "stageDistribution.bars",
    sql: `SELECT stage, COUNT(*) AS count FROM bills WHERE ${ON} AND stage IN ('introduced','committee','floor','other_chamber','president','enacted') GROUP BY stage`,
  },
  {
    label: "stageDistribution.offPath",
    sql: `SELECT COUNT(*) AS n FROM bills WHERE ${ON} AND (stage = 'other' OR stage IS NULL)`,
  },
  {
    label: "topicDistribution",
    sql: `SELECT je.value AS topic, COUNT(*) AS count FROM bills, json_each(bills.topics) je WHERE bills.topics IS NOT NULL AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL) GROUP BY je.value ORDER BY count DESC`,
  },
  {
    label: "enactedThisWeek",
    sql: `SELECT id, bill_type, bill_number FROM bills WHERE ${ON} AND stage = 'enacted' AND stage_changed_at IS NOT NULL AND stage_changed_at > datetime('now', '-7 days') ORDER BY stage_changed_at DESC`,
  },
];

async function main() {
  const db = getDb();

  const idx = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='bills' ORDER BY name",
  );
  console.log("bills indexes:", idx.rows.map((r) => r.name).join(", "));
  console.log("");

  console.log("EXPLAIN QUERY PLAN:");
  for (const q of QUERIES) {
    const p = await db.execute(`EXPLAIN QUERY PLAN ${q.sql}`);
    console.log(`  ${q.label}: ${p.rows.map((r) => r.detail).join(" | ")}`);
  }
  console.log("");

  const results: { label: string; ms: number }[] = [];
  for (const q of QUERIES) {
    const t0 = performance.now();
    await db.execute(q.sql);
    results.push({ label: q.label, ms: Math.round(performance.now() - t0) });
  }
  // getDashboardPrimaries is the one uncached helper; callable directly.
  {
    const t0 = performance.now();
    await getDashboardPrimaries();
    results.push({
      label: "getDashboardPrimaries (uncached helper)",
      ms: Math.round(performance.now() - t0),
    });
  }

  results.sort((a, b) => b.ms - a.ms);
  console.log("cold timings (slowest first):");
  for (const r of results) {
    console.log(`  ${String(r.ms).padStart(6)} ms  ${r.label}`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
