import "dotenv/config";
import { writeFileSync } from "node:fs";
import { getDb } from "../lib/db";

// HO 356 (A2 of the multi-user arc) — ONE-SHOT destructive migration. The
// watchlist PK is `bill_id` alone (one user per bill); it must become composite
// `(user_id, bill_id)`. SQLite can't ALTER a PK, so this is a table rebuild.
//
// Ordering: run this against prod BEFORE the code deploy. Code that reads/writes
// user_id against the old table would 500 every watchlist read in the gap.
//
// Preconditions (HALT on either):
//   1. users has EXACTLY ONE row — zero means A1 not shipped / not signed in;
//      more than one is ambiguous (which id seeds the existing rows?).
//   2. A backup of the current watchlist is written to scripts/diagnostic/ first.

async function main() {
  const db = getDb();

  // --- Precondition 1: exactly one user ---
  const users = await db.execute("SELECT id FROM users");
  if (users.rows.length === 0) {
    throw new Error(
      "STOP: users table is empty. A1 (HO 355) not shipped, or you haven't signed in on prod yet. The migration needs your users row to seed existing watchlist rows.",
    );
  }
  if (users.rows.length > 1) {
    throw new Error(
      `STOP: users has ${users.rows.length} rows — ambiguous which id should own the existing watchlist rows. Resolve manually before running.`,
    );
  }
  const userId = users.rows[0]!.id as string;
  console.log(`single user confirmed: ${userId}`);

  // --- Precondition 2: backup the current watchlist ---
  const existing = await db.execute("SELECT * FROM watchlist");
  const date = new Date().toISOString().slice(0, 10);
  const backupPath = `scripts/diagnostic/watchlist-backup-${date}.json`;
  writeFileSync(backupPath, JSON.stringify(existing.rows, null, 2));
  console.log(`backed up ${existing.rows.length} watchlist rows → ${backupPath}`);

  // Already migrated? (idempotency guard — re-running is a no-op.)
  const cols = await db.execute("PRAGMA table_info(watchlist)");
  const hasUserId = cols.rows.some((r) => (r.name as string) === "user_id");
  if (hasUserId) {
    console.log("watchlist already has user_id — nothing to do.");
    return;
  }

  // --- Rebuild in one transaction: create composite-PK table, copy existing
  // rows assigning the single user_id, drop old, rename new. ---
  await db.batch(
    [
      `CREATE TABLE watchlist_new (
        user_id TEXT NOT NULL REFERENCES users(id),
        bill_id TEXT NOT NULL REFERENCES bills(id),
        added_at TEXT NOT NULL,
        notes TEXT,
        PRIMARY KEY (user_id, bill_id)
      )`,
      {
        sql: `INSERT INTO watchlist_new (user_id, bill_id, added_at, notes)
              SELECT ?, bill_id, added_at, notes FROM watchlist`,
        args: [userId],
      },
      "DROP TABLE watchlist",
      "ALTER TABLE watchlist_new RENAME TO watchlist",
    ],
    "write",
  );

  // --- Verify ---
  const after = await db.execute("PRAGMA table_info(watchlist)");
  const pkCols = after.rows
    .filter((r) => (r.pk as number) > 0)
    .sort((a, b) => (a.pk as number) - (b.pk as number))
    .map((r) => r.name as string);
  const count = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM watchlist WHERE user_id = ?",
    args: [userId],
  });
  console.log(`watchlist PK is now: (${pkCols.join(", ")})`);
  console.log(`${count.rows[0]?.n} rows now owned by ${userId}`);
  console.log("migration complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
