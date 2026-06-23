// HO 339 — time the /races, /patterns, /reports queries cold vs warm on prod.
// Timing, not EXPLAIN: the cause is connection warm-up / fan-out / row-fetch
// cost, which a plan-only check misses (HO 336 lesson). 60s bound so nothing is
// torn mid-flight; the printed wall-time (cold=first, warm=second) is the signal.
// READ-ONLY.
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
  fetch: (i: any, init?: any) => fetch(i, { ...init, signal: AbortSignal.timeout(60_000) }),
});

async function timed(label: string, fn: () => Promise<unknown>) {
  const s = Date.now();
  let extra = "";
  try { extra = (await fn()) as string ?? ""; } catch (e) { extra = "ERR " + (e as Error).message; }
  console.log(`  ${(Date.now() - s).toString().padStart(6)}ms  ${label}${extra ? "  " + extra : ""}`);
}

async function main() {
  console.log("warm-up (pay the cold connection once):");
  await timed("SELECT 1", async () => { await db.execute("SELECT 1"); return ""; });

  // ---- /patterns ----
  console.log("\n=== /patterns ===");
  const clusterAgg = `SELECT cluster_id, COUNT(*) AS total,
      SUM(CASE WHEN stage IS NOT NULL AND stage <> 'introduced' AND stage <> 'committee' THEN 1 ELSE 0 END) AS past_committee,
      SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted,
      SUM(CASE WHEN is_ceremonial = 1 THEN 1 ELSE 0 END) AS ceremonial
    FROM bills WHERE cluster_id IS NOT NULL GROUP BY cluster_id`;
  const clusteredCount = Number((await db.execute("SELECT COUNT(*) AS n FROM bills WHERE cluster_id IS NOT NULL")).rows[0]?.n ?? 0);
  console.log(`  (clustered bills: ${clusteredCount})`);
  await timed("getClusterStats AGG (cold)", async () => { const r = await db.execute(clusterAgg); return `${r.rows.length} clusters`; });
  await timed("getClusterStats AGG (warm)", async () => { await db.execute(clusterAgg); return ""; });
  // EXPLAIN the agg
  const aggPlan = (await db.execute(`EXPLAIN QUERY PLAN ${clusterAgg}`)).rows.map((r) => r.detail);
  console.log("  AGG plan: " + aggPlan.join(" | "));
  // the per-cluster example fan-out (sequential, as getClusterStats runs it)
  const ids = (await db.execute("SELECT DISTINCT cluster_id FROM bills WHERE cluster_id IS NOT NULL")).rows.map((r) => r.cluster_id as string);
  await timed(`example fan-out: ${ids.length} sequential title lookups`, async () => {
    for (const id of ids) {
      await db.execute({ sql: `SELECT title FROM bills WHERE cluster_id = ? ORDER BY latest_action_date DESC NULLS LAST, id DESC LIMIT 1`, args: [id] });
    }
    return "";
  });
  await timed("getUnmatchedClusterCount", async () => { await db.execute(`SELECT COUNT(*) AS n FROM bills WHERE cluster_id IS NULL AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`); return ""; });

  // ---- /races ----
  console.log("\n=== /races ===");
  const racesIdx = `SELECT r.id FROM races r INNER JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = r.cycle
    LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
    LEFT JOIN member_fundraising mf ON mf.bioguide_id = r.incumbent_bioguide_id AND mf.cycle = r.cycle
    LEFT JOIN kalshi_odds ko ON ko.race_id = r.id
    LEFT JOIN polymarket_odds pm ON pm.race_id = r.id
    WHERE r.cycle = ? GROUP BY r.id`;
  await timed("getRacesIndex (cold)", async () => { const r = await db.execute({ sql: racesIdx, args: [2026] }); return `${r.rows.length} races`; });
  await timed("getRacesIndex (warm)", async () => { await db.execute({ sql: racesIdx, args: [2026] }); return ""; });
  await timed("getRaceCandidatesForCycle", async () => { const r = await db.execute({ sql: `SELECT rc.race_id FROM race_candidates rc JOIN races r ON r.id = rc.race_id WHERE r.cycle = ?`, args: [2026] }); return `${r.rows.length} cands`; });
  await timed("getChamberControl", async () => { await db.execute(`SELECT value FROM dashboard_state WHERE key = 'kalshi_chamber_control' LIMIT 1`); return ""; });

  // ---- /reports ----
  console.log("\n=== /reports ===");
  await timed("getReportCount", async () => { await db.execute("SELECT COUNT(*) AS n FROM reports"); return ""; });
  await timed("getReportsWithLead", async () => { const r = await db.execute({ sql: `SELECT slug, title, week_start, week_end, content_md, laws_count, intro_count, moves_count FROM reports ORDER BY week_start DESC LIMIT ? OFFSET ?`, args: [20, 0] }); return `${r.rows.length} rows`; });
  await timed("laws h118 (historical_laws)", async () => { await db.execute("SELECT enacted_date AS d FROM historical_laws WHERE congress = 118"); return ""; });
  await timed("laws h119 (bills enacted, idx_bills_enacted)", async () => { const r = await db.execute(`SELECT latest_action_date AS d FROM bills INDEXED BY idx_bills_enacted WHERE congress = 119 AND stage = 'enacted' AND latest_action_date IS NOT NULL`); return `${r.rows.length} rows`; });
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
