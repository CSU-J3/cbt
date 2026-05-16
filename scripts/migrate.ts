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
  // Key-value store for cron-generated dashboard content. Flexible so future
  // dashboard state (other generated text, cached aggregates) needs no further
  // migration. Currently holds key = 'weekly_lead'.
  `CREATE TABLE IF NOT EXISTS dashboard_state (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  // Weekly cron-generated reports. One row per calendar week (Mon-Sun),
  // keyed by the ISO week-start date.
  `CREATE TABLE IF NOT EXISTS reports (
    slug TEXT PRIMARY KEY,
    week_start TEXT NOT NULL,
    week_end TEXT NOT NULL,
    title TEXT NOT NULL,
    content_md TEXT NOT NULL,
    created_at TEXT NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reports_week_start ON reports(week_start DESC)`,
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
  await ensureColumn(db, "bills", "is_ceremonial", "INTEGER");
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_is_ceremonial ON bills(is_ceremonial)",
  );
  console.log("ok: idx_bills_is_ceremonial");
  await ensureColumn(db, "bills", "cluster_id", "TEXT");
  await db.execute(
    "CREATE INDEX IF NOT EXISTS idx_bills_cluster_id ON bills(cluster_id)",
  );
  console.log("ok: idx_bills_cluster_id");
  // handoff 59: enrichment fields. Both nullable; NULL = "not yet populated"
  // (distinguishable from 0, which is a real "no cosponsors" / "empty text").
  await ensureColumn(db, "bills", "cosponsor_count", "INTEGER");
  await ensureColumn(db, "bills", "text_length", "INTEGER");
  console.log("migration complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
