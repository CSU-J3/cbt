import "dotenv/config";
import { getDb } from "../lib/db";

async function main() {
  const db = getDb();
  const r = await db.execute(
    "SELECT congress, COUNT(*) AS n FROM bills GROUP BY congress ORDER BY congress",
  );
  console.log("congress | count");
  for (const row of r.rows) {
    console.log(`  ${row.congress} | ${row.n}`);
  }

  const blue = await db.execute(
    `SELECT id, congress, bill_type, bill_number, title, update_date
     FROM bills WHERE title LIKE '%BLUE Pacific%' OR title LIKE '%Blue Pacific%'`,
  );
  console.log(`\nBLUE Pacific matches: ${blue.rows.length}`);
  for (const row of blue.rows) {
    console.log(
      `  ${row.id} congress=${row.congress} ${String(row.bill_type ?? "").toUpperCase()} ${row.bill_number} | update_date=${row.update_date} | ${row.title}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
