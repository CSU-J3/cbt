import "dotenv/config";
import { getDb } from "../lib/db";

type Db = ReturnType<typeof getDb>;

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

async function ensureColumn(
  db: Db,
  table: string,
  column: string,
  ddl: string,
): Promise<void> {
  const r = await db.execute(`PRAGMA table_info(${table})`);
  const exists = r.rows.some((row) => (row.name as string) === column);
  if (exists) {
    console.log(`column ${table}.${column} already exists`);
    return;
  }
  await db.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  console.log(`added column ${table}.${column}`);
}

async function main() {
  const db = getDb();
  for (const sql of statements) {
    await db.execute(sql);
    console.log("ok:", sql.split("\n")[0]);
  }
  await ensureColumn(db, "bills", "sponsor_bioguide_id", "TEXT");
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_sponsor_bioguide ON bills(sponsor_bioguide_id)",
  );
  console.log("ok: idx_bills_sponsor_bioguide");
  await ensureColumn(db, "bills", "previous_stage", "TEXT");
  await ensureColumn(db, "bills", "stage_changed_at", "TEXT");
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_stage_changed_at ON bills(stage_changed_at DESC)",
  );
  console.log("ok: idx_bills_stage_changed_at");
  console.log("migration complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
