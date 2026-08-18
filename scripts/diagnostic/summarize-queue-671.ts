// HO 671 STEP 3 — is the summarize queue actually empty right now? READ-ONLY.
//
// Reading C (a WRITING tick) is the hard one on a drained queue. Before touching
// anything, ask whether the queue is genuinely empty: if even one bill is
// eligible under runSummarize's own predicate, C can be produced by running the
// tick, with no DB manipulation at all.
//
// The predicate is copied from lib/summarize-runner.ts:141-153 — summary IS NULL,
// not failed within FAILURE_DEFER_HOURS (24), and the ceremonial guard (which the
// runner's own comment records as removing zero rows today).
//
//   npx tsx scripts/diagnostic/summarize-queue-671.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

async function main() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_DATABASE_URL required");
  const db = createClient({ url, authToken });

  const eligible = await db.execute(`
    SELECT id, bill_type, bill_number, update_date, summarize_failed_at, summarize_attempts
      FROM bills
     WHERE summary IS NULL
       AND (summarize_failed_at IS NULL OR summarize_failed_at < datetime('now', '-24 hours'))
       AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
     ORDER BY update_date DESC
     LIMIT 20`);

  const deferred = await db.execute(`
    SELECT COUNT(*) AS n FROM bills
     WHERE summary IS NULL
       AND summarize_failed_at IS NOT NULL
       AND summarize_failed_at >= datetime('now', '-24 hours')`);

  const nullSummaries = await db.execute(
    `SELECT COUNT(*) AS n FROM bills WHERE summary IS NULL`,
  );
  // CONTROL: the corpus is not empty and the column is readable — otherwise a
  // zero above would be the query failing, not the queue being drained.
  const total = await db.execute(`SELECT COUNT(*) AS n FROM bills`);
  const withSummary = await db.execute(
    `SELECT COUNT(*) AS n FROM bills WHERE summary IS NOT NULL`,
  );

  console.log("=".repeat(84));
  console.log("HO 671 STEP 3 — summarize queue state (read-only)");
  console.log("=".repeat(84));
  console.log(`  CONTROL bills total            : ${total.rows[0]?.n}`);
  console.log(`  CONTROL bills WITH a summary   : ${withSummary.rows[0]?.n}  (must be > 0)`);
  console.log(`  bills with summary IS NULL     : ${nullSummaries.rows[0]?.n}`);
  console.log(`  of those, deferred (<24h fail) : ${deferred.rows[0]?.n}`);
  console.log(`  ELIGIBLE for the next tick     : ${eligible.rows.length}${eligible.rows.length === 20 ? "+ (capped at 20)" : ""}`);
  for (const r of eligible.rows.slice(0, 10)) {
    console.log(
      `    ${String(r.id).padEnd(20)} updated ${String(r.update_date).slice(0, 10)}` +
        `  attempts ${r.summarize_attempts ?? 0}` +
        (r.summarize_failed_at ? `  lastFail ${String(r.summarize_failed_at).slice(0, 19)}` : ""),
    );
  }
  console.log("");
  console.log(
    eligible.rows.length > 0
      ? "  -> reading C is FREE: run the tick, it will write."
      : "  -> queue drained: reading C needs a bill to summarize, which is a WRITE.",
  );
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
