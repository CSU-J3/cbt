import "dotenv/config";
import { getDb } from "../../lib/db";

async function main() {
  const db = getDb();
  const q1 = await db.execute(
    `SELECT COUNT(*) AS n FROM bills WHERE summary IS NOT NULL AND stage = 'committee' AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`,
  );
  console.log("getFeedBills committee count (with summary gate + ceremonial gate):", q1.rows[0]?.n);
  const q2 = await db.execute(
    `SELECT COUNT(*) AS n FROM bills WHERE stage = 'committee' AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`,
  );
  console.log("committee non-ceremonial (no summary gate):", q2.rows[0]?.n);
  const q3 = await db.execute(
    `SELECT COUNT(*) AS n FROM bills WHERE summary IS NOT NULL AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`,
  );
  console.log("total summary+non-ceremonial:", q3.rows[0]?.n);
  const q4 = await db.execute(
    `SELECT COUNT(*) AS n FROM bills WHERE summary IS NOT NULL`,
  );
  console.log("total summary IS NOT NULL (all):", q4.rows[0]?.n);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
