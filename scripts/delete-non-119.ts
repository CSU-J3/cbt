import "dotenv/config";
import { getDb } from "../lib/db";

async function main() {
  const db = getDb();
  const before = await db.execute("SELECT COUNT(*) AS n FROM bills");
  const targets = await db.execute(
    "SELECT id, congress FROM bills WHERE congress != 119 ORDER BY congress, id",
  );
  console.log(`bills before: ${before.rows[0]?.n}`);
  console.log(`rows to delete: ${targets.rows.length}`);
  for (const r of targets.rows) {
    console.log(`  ${r.id} (congress=${r.congress})`);
  }

  if (targets.rows.length === 0) {
    console.log("nothing to delete");
    return;
  }

  await db.execute("DELETE FROM watchlist WHERE bill_id IN (SELECT id FROM bills WHERE congress != 119)");
  const result = await db.execute("DELETE FROM bills WHERE congress != 119");
  console.log(`deleted ${result.rowsAffected} bill rows`);

  const after = await db.execute("SELECT COUNT(*) AS n FROM bills");
  console.log(`bills after: ${after.rows[0]?.n}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
