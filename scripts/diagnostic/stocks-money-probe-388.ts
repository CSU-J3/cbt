// Diagnostic (read-only, HO 388): repo + DB state for the stocks & money
// member-depth threads. Reports table presence, row counts, and dead-data
// detection. NO writes. Run: `npx tsx scripts/diagnostic/stocks-money-probe-388.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";

async function tableExists(db: ReturnType<typeof getDb>, name: string): Promise<boolean> {
  const rs = await db.execute({
    sql: `SELECT name FROM sqlite_master WHERE type='table' AND name=?`,
    args: [name],
  });
  return rs.rows.length > 0;
}

async function count(db: ReturnType<typeof getDb>, table: string): Promise<number | string> {
  try {
    const rs = await db.execute(`SELECT COUNT(*) AS n FROM ${table}`);
    return Number(rs.rows[0]?.n ?? 0);
  } catch (e) {
    return `ERR: ${(e as Error).message}`;
  }
}

async function main() {
  const db = getDb();

  console.log("=== HO 388 Step 0 — live DB state ===\n");

  // --- Stocks ---
  const tradeTables = await db.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%trade%'`,
  );
  console.log("Tables LIKE %trade%:", tradeTables.rows.map((r) => r.name).join(", ") || "(none)");

  if (await tableExists(db, "stock_trades")) {
    console.log("\nstock_trades COUNT:", await count(db, "stock_trades"));
    const dist = await db.execute(
      `SELECT chamber,
              COUNT(*) AS n,
              MIN(disclosure_date) AS min_disc,
              MAX(disclosure_date) AS max_disc,
              MAX(ingested_at) AS last_ingest,
              SUM(CASE WHEN bioguide_id IS NULL THEN 1 ELSE 0 END) AS unmatched
       FROM stock_trades GROUP BY chamber`,
    );
    console.table(dist.rows);
  } else {
    console.log("stock_trades: TABLE ABSENT");
  }

  // --- Money ---
  console.log("\n=== Money tables ===");
  for (const t of ["member_fundraising", "member_donors", "member_industries", "fec_totals"]) {
    const exists = await tableExists(db, t);
    console.log(`${t}: ${exists ? "present, COUNT=" + (await count(db, t)) : "ABSENT"}`);
  }

  // fundraising coverage + cycle breakdown
  if (await tableExists(db, "member_fundraising")) {
    const cyc = await db.execute(
      `SELECT cycle, COUNT(*) AS n, MAX(ingested_at) AS last_ingest,
              SUM(CASE WHEN cash_on_hand IS NULL THEN 1 ELSE 0 END) AS null_coh
       FROM member_fundraising GROUP BY cycle ORDER BY cycle`,
    );
    console.log("\nmember_fundraising by cycle:");
    console.table(cyc.rows);
  }

  console.log("\n=== done ===");
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
