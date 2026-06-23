// HO 336 Step 1 — probe FTS5 support on the prod Turso instance before building.
// Don't assume hosted Turso has fts5 compiled in (the FRED/FMP burn). Also
// confirms bm25() ranking and that bills has an integer rowid (external-content
// FTS5 keys on content_rowid='rowid'). All probe objects are dropped. READ-ONLY
// w.r.t. real data (only creates/drops a throwaway _fts_probe table).
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  console.log("Probing FTS5 on", process.env.TURSO_DATABASE_URL, "\n");

  // 1. FTS5 compiled in?
  try {
    await db.execute("CREATE VIRTUAL TABLE IF NOT EXISTS _fts_probe USING fts5(x)");
    await db.execute("INSERT INTO _fts_probe(x) VALUES ('alpha beta gamma'), ('beta delta')");
    const m = await db.execute("SELECT COUNT(*) AS n FROM _fts_probe WHERE _fts_probe MATCH 'bet*'");
    console.log(`  FTS5: OK — virtual table + MATCH 'bet*' → ${m.rows[0]?.n} rows`);
    // bm25 ranking
    const r = await db.execute("SELECT x, bm25(_fts_probe) AS rank FROM _fts_probe WHERE _fts_probe MATCH 'beta' ORDER BY bm25(_fts_probe)");
    console.log(`  bm25(): OK — ${r.rows.map((row) => `${(row.x as string).slice(0,11)}@${(row.rank as number).toFixed(3)}`).join(", ")}`);
    await db.execute("DROP TABLE _fts_probe");
    console.log("  probe table dropped");
  } catch (e) {
    console.log(`  FTS5: UNAVAILABLE — ${(e as Error).message}`);
    console.log("  HALT: fall back to a bounded-count mitigation (separate handoff).");
    process.exit(2);
  }

  // 2. bills rowid (external-content FTS keys on it)
  const rr = await db.execute("SELECT rowid, id FROM bills LIMIT 1");
  console.log(`\n  bills.rowid: ${rr.rows[0]?.rowid} (id=${rr.rows[0]?.id}) — integer rowid present`);
  const cnt = await db.execute("SELECT COUNT(*) AS n FROM bills");
  console.log(`  bills rows: ${cnt.rows[0]?.n}`);

  console.log("\nFTS5 + bm25 + rowid all OK → proceed to build (Step 2).");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
