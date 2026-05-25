// HO 132 Phase 1 — read-only diagnostic for stage + topic bubble design.
// Runs the two queries from the handoff against the live Turso DB and
// prints raw output. No writes. Delete after sign-off.
import "dotenv/config";
import { getDb } from "../../lib/db";

async function main() {
  const db = getDb();

  console.log("\n--- 1. Stage distribution (non-ceremonial) ---");
  const stage = await db.execute(
    `SELECT stage, COUNT(*) AS n
     FROM bills
     WHERE is_ceremonial = 0
     GROUP BY stage
     ORDER BY n DESC`,
  );
  for (const r of stage.rows) {
    console.log(`${r.stage}\t${r.n}`);
  }

  console.log("\n--- 2. Topic distribution (non-ceremonial, json_each on bills.topics) ---");
  const topic = await db.execute(
    `SELECT je.value AS topic, COUNT(*) AS n
     FROM bills, json_each(bills.topics) je
     WHERE bills.topics IS NOT NULL
       AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)
     GROUP BY je.value
     ORDER BY n DESC`,
  );
  for (const r of topic.rows) {
    console.log(`${r.topic}\t${r.n}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
