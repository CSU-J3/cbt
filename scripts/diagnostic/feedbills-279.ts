import "dotenv/config";
import { createClient } from "@libsql/client";
const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const CER = "(is_ceremonial = 0 OR is_ceremonial IS NULL)";
const Q: Array<[string,string,(string|number)[]]> = [
  ["default — NO hint (current, the 11s breacher)",
   `SELECT COUNT(*) AS n FROM bills WHERE summary IS NOT NULL AND ${CER}`, []],
  ["default — INDEXED BY idx_bills_summary_feed",
   `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_summary_feed WHERE summary IS NOT NULL AND ${CER}`, []],
  ["stage filter — INDEXED BY (post-filter bounded)",
   `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_summary_feed WHERE summary IS NOT NULL AND ${CER} AND stage = ?`, ["committee"]],
  ["cluster — NO hint (keeps cluster index, untouched)",
   `SELECT COUNT(*) AS n FROM bills WHERE summary IS NOT NULL AND cluster_id = ?`, ["postoffice"]],
];
for (const [label, sql, args] of Q) {
  console.log("\n=== " + label + " ===");
  const p = await db.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args });
  p.rows.forEach((r) => console.log("  " + (r.detail as string)));
  for (const t of ["t1","t2"]) { const s = Date.now(); const rs = await db.execute({sql,args}); console.log(`  ${t}: ${Date.now()-s}ms total=${rs.rows[0]?.n}`); }
}
process.exit(0);
