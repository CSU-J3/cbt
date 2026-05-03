import "dotenv/config";
import { getDb } from "../lib/db";

async function main() {
  const db = getDb();
  const total = await db.execute("SELECT COUNT(*) AS n FROM bills");
  const summarized = await db.execute(
    "SELECT COUNT(*) AS n FROM bills WHERE summary IS NOT NULL",
  );
  console.log(`total: ${total.rows[0]?.n}, summarized: ${summarized.rows[0]?.n}`);

  console.log(`\nbill_type breakdown of summarized rows:`);
  const breakdown = await db.execute(
    `SELECT bill_type, COUNT(*) AS n FROM bills
     WHERE summary IS NOT NULL GROUP BY bill_type ORDER BY n DESC`,
  );
  for (const r of breakdown.rows) {
    console.log(`  ${r.bill_type}: ${r.n}`);
  }

  console.log(`\nstage breakdown:`);
  const stageBreakdown = await db.execute(
    `SELECT stage, COUNT(*) AS n FROM bills
     WHERE summary IS NOT NULL GROUP BY stage ORDER BY n DESC`,
  );
  for (const r of stageBreakdown.rows) {
    console.log(`  ${r.stage ?? "(null)"}: ${r.n}`);
  }

  console.log(`\n--- 5 random samples across bill types ---`);
  const types = breakdown.rows.map((r) => r.bill_type as string);
  const pickedTypes = types.slice(0, 5);
  while (pickedTypes.length < 5 && types.length > 0) {
    pickedTypes.push(types[0]!);
  }
  for (const t of pickedTypes) {
    const r = await db.execute({
      sql: `SELECT id, bill_type, title, summary, topics, stage
            FROM bills WHERE summary IS NOT NULL AND bill_type = ?
            ORDER BY RANDOM() LIMIT 1`,
      args: [t],
    });
    const row = r.rows[0];
    if (!row) continue;
    console.log(`\n[${row.id}] (${row.bill_type}) ${row.title}`);
    console.log(`SUMMARY: ${row.summary}`);
    console.log(`TOPICS:  ${row.topics}`);
    console.log(`STAGE:   ${row.stage}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
