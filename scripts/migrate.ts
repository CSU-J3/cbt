import "dotenv/config";
import { getDb } from "../lib/db";

const statements = [
  `CREATE TABLE IF NOT EXISTS bills (
    id TEXT PRIMARY KEY,
    congress INTEGER NOT NULL,
    bill_type TEXT NOT NULL,
    bill_number INTEGER NOT NULL,
    title TEXT NOT NULL,
    introduced_date TEXT,
    latest_action_date TEXT,
    latest_action_text TEXT,
    sponsor_name TEXT,
    sponsor_party TEXT,
    sponsor_state TEXT,
    update_date TEXT NOT NULL,
    raw_json TEXT NOT NULL,
    summary TEXT,
    summary_model TEXT,
    summary_updated_at TEXT,
    topics TEXT,
    stage TEXT
  )`,
  `CREATE INDEX IF NOT EXISTS idx_bills_update_date ON bills(update_date DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_bills_latest_action ON bills(latest_action_date DESC)`,
  `CREATE TABLE IF NOT EXISTS watchlist (
    bill_id TEXT PRIMARY KEY REFERENCES bills(id),
    added_at TEXT NOT NULL,
    notes TEXT
  )`,
];

async function main() {
  const db = getDb();
  for (const sql of statements) {
    await db.execute(sql);
    console.log("ok:", sql.split("\n")[0]);
  }
  console.log("migration complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
