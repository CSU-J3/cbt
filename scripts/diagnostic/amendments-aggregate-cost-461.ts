// HO 461 Step 0 — cold-cost gate for the /amendments aggregate surface. Times the
// three UNBOUNDED summary cuts against prod Turso before any surface code is
// written, to decide live-vs-blob (the /nominations bills-scale-live call, vs the
// lda_* precompute one). NO WRITES. Sibling to amendments-coverage-447.ts /
// amendments-actions-probe-452.ts (same DB idiom).
//
// The risk cut is #1: `disposition` is display-only-derived (HO 452 killed the
// persisted column), so the corpus disposition breakdown scans latest_action_text
// (unindexed) — a full table SCAN whose pages each carry raw_json (the LDA-style
// row-major bloat). #2/#3 are expected index-only via idx_amendments_bill/sponsor.
//
// Decision rule (report before building):
//   all three < ~2s            → proceed live (expected).
//   only #1 slow (raw_json SCAN)→ add partial covering idx_amendments_acted, re-measure.
//   #1 still slow / caps blow   → STOP, pivot to a rollup blob.
//
//   npx tsx scripts/diagnostic/amendments-aggregate-cost-461.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

// Fresh client, no warm cache — the cold posture the gate needs.
const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const DISPOSITION_SQL =
  "SELECT latest_action_text FROM amendments WHERE latest_action_text IS NOT NULL";
const BY_BILL_SQL =
  "SELECT amended_bill_id, COUNT(*) AS n FROM amendments WHERE amended_bill_id IS NOT NULL GROUP BY amended_bill_id ORDER BY n DESC LIMIT 15";
const BY_SPONSOR_SQL =
  "SELECT sponsor_bioguide_id, COUNT(*) AS n FROM amendments WHERE sponsor_bioguide_id IS NOT NULL GROUP BY sponsor_bioguide_id ORDER BY n DESC LIMIT 15";

async function timed(label: string, sql: string): Promise<{ ms: number; rows: number }> {
  const t0 = performance.now();
  const rs = await db.execute(sql);
  const ms = performance.now() - t0;
  console.log(`  ${label}: ${ms.toFixed(0)}ms  (${rs.rows.length} rows)`);
  return { ms, rows: rs.rows.length };
}

async function main() {
  console.log("=== HO 461 Step 0 — /amendments aggregate cold-cost gate (prod Turso) ===\n");

  const total = Number((await db.execute("SELECT COUNT(*) AS n FROM amendments")).rows[0]?.n ?? 0);
  console.log(`corpus: ${total} amendments\n`);

  // EXPLAIN QUERY PLAN for the risk cut — confirm SCAN vs index use.
  console.log("EXPLAIN QUERY PLAN — cut 1 (disposition scan):");
  const plan = await db.execute(`EXPLAIN QUERY PLAN ${DISPOSITION_SQL}`);
  for (const r of plan.rows) console.log(`  ${r.detail}`);
  console.log("");

  console.log("cold wall-clock (fresh client, first execution of each cut):");
  const c1 = await timed("cut 1  disposition SCAN ", DISPOSITION_SQL);
  const c2 = await timed("cut 2  by-bill GROUP BY  ", BY_BILL_SQL);
  const c3 = await timed("cut 3  by-sponsor GROUPBY", BY_SPONSOR_SQL);

  // sanity readouts (the numbers the surface will show)
  const acted = c1.rows;
  console.log(`\nsanity: acted=${acted} (${((100 * acted) / total).toFixed(1)}% carry latest_action_text) · filedOnly=${total - acted}`);
  const topBill = (await db.execute(BY_BILL_SQL)).rows[0];
  const topSpon = (await db.execute(BY_SPONSOR_SQL)).rows[0];
  console.log(`sanity: top bill ${topBill?.amended_bill_id} = ${topBill?.n} amendments · top sponsor ${topSpon?.sponsor_bioguide_id} = ${topSpon?.n}`);

  const worst = Math.max(c1.ms, c2.ms, c3.ms);
  console.log(`\n=== VERDICT: worst cut ${worst.toFixed(0)}ms ===`);
  if (worst < 2000) {
    console.log("→ all three under ~2s: PROCEED LIVE (no index needed).");
  } else if (c2.ms < 2000 && c3.ms < 2000) {
    console.log("→ only cut 1 slow (raw_json SCAN): add partial idx_amendments_acted and re-measure.");
    console.log("   CREATE INDEX IF NOT EXISTS idx_amendments_acted ON amendments(latest_action_text) WHERE latest_action_text IS NOT NULL");
    // measure the would-be index-only path right here (index not yet created — this
    // just confirms the ~584-row shape a covering index would serve).
  } else {
    console.log("→ a GROUP BY is slow too: STOP, pivot to a rollup blob (amendments_rollup).");
  }

  db.close();
}

main().catch((e) => {
  console.error(`cost gate failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
