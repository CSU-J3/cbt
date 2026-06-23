// HO 335 cleanup — drop idx_bills_stale_count from prod. It was created early in
// HO 335 before getStaleCount was found to be dead code (zero callers since HO
// 323/326). The function was deleted instead of indexed, so this index now
// serves nothing and only adds sync write-maintenance cost. Run once:
//   npx tsx scripts/diagnostic/drop-stale-index-335.ts
// Then this file can be deleted. (DROP INDEX IF EXISTS is idempotent + safe.)
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

async function main() {
  await db.execute("DROP INDEX IF EXISTS idx_bills_stale_count");
  const r = await db.execute(
    "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_bills_stale_count'",
  );
  console.log(
    r.rows.length > 0
      ? "STILL PRESENT — drop failed"
      : "dropped: idx_bills_stale_count no longer on prod",
  );
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
