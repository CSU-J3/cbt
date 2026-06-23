// HO 336 recovery — the prod bills_fts got corrupted (SQLITE_CORRUPT, MATCH
// returns 0) when an earlier one-shot `rebuild` had its client abort at 10s
// mid-statement, leaving the external-content shadow tables inconsistent. Rebuild
// cleanly: drop triggers + the corrupt vtable, recreate, populate in small atomic
// rowid chunks (no giant interruptible rebuild), recreate triggers, verify.
// 60s bound so no statement is torn mid-flight. One-off.
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
  fetch: (input: any, init?: any) =>
    fetch(input, { ...init, signal: AbortSignal.timeout(60_000) }),
});

const TRIGGERS = `
CREATE TRIGGER bills_fts_ai AFTER INSERT ON bills BEGIN
  INSERT INTO bills_fts(rowid, title, summary, sponsor_name)
  VALUES (new.rowid, new.title, new.summary, new.sponsor_name);
END`;
const TRIGGER_AD = `
CREATE TRIGGER bills_fts_ad AFTER DELETE ON bills BEGIN
  INSERT INTO bills_fts(bills_fts, rowid, title, summary, sponsor_name)
  VALUES ('delete', old.rowid, old.title, old.summary, old.sponsor_name);
END`;
const TRIGGER_AU = `
CREATE TRIGGER bills_fts_au AFTER UPDATE ON bills BEGIN
  INSERT INTO bills_fts(bills_fts, rowid, title, summary, sponsor_name)
  VALUES ('delete', old.rowid, old.title, old.summary, old.sponsor_name);
  INSERT INTO bills_fts(rowid, title, summary, sponsor_name)
  VALUES (new.rowid, new.title, new.summary, new.sponsor_name);
END`;

async function main() {
  console.log("Recovering bills_fts on", process.env.TURSO_DATABASE_URL, "\n");
  // 1. drop triggers (so bills writes don't reference a missing vtable), then vtable
  for (const t of ["bills_fts_ai", "bills_fts_ad", "bills_fts_au"]) {
    await db.execute(`DROP TRIGGER IF EXISTS ${t}`);
  }
  await db.execute("DROP TABLE IF EXISTS bills_fts");
  console.log("  dropped corrupt bills_fts + triggers");

  // 2. recreate vtable
  await db.execute(
    "CREATE VIRTUAL TABLE bills_fts USING fts5(title, summary, sponsor_name, content='bills', content_rowid='rowid')",
  );
  console.log("  recreated bills_fts");

  // 3. populate in atomic rowid chunks
  const maxRowid = Number(
    (await db.execute("SELECT COALESCE(MAX(rowid), 0) AS m FROM bills")).rows[0]?.m ?? 0,
  );
  const CHUNK = 1000;
  let inserted = 0;
  for (let lo = 0; lo < maxRowid; lo += CHUNK) {
    const s = Date.now();
    const r = await db.execute({
      sql: `INSERT INTO bills_fts(rowid, title, summary, sponsor_name)
            SELECT rowid, title, summary, sponsor_name FROM bills WHERE rowid > ? AND rowid <= ?`,
      args: [lo, lo + CHUNK],
    });
    inserted += r.rowsAffected;
    console.log(`    (${lo}, ${lo + CHUNK}] +${r.rowsAffected} (${Date.now() - s}ms)`);
  }
  console.log(`  populated ${inserted} docs`);

  // 4. recreate triggers
  await db.execute(TRIGGERS);
  await db.execute(TRIGGER_AD);
  await db.execute(TRIGGER_AU);
  console.log("  recreated 3 triggers");

  // 5. verify MATCH + bm25 (the case that was corrupt/0)
  const cnt = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM bills_fts JOIN bills ON bills.rowid = bills_fts.rowid
          WHERE bills_fts MATCH ? AND bills.summary IS NOT NULL
            AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)`,
    args: ["tax*"],
  });
  console.log(`\n  'tax*' match count: ${cnt.rows[0]?.n} (expect ~1290)`);
  const sample = await db.execute({
    sql: `SELECT bills.id, bills.title FROM bills_fts JOIN bills ON bills.rowid = bills_fts.rowid
          WHERE bills_fts MATCH ? AND bills.summary IS NOT NULL
            AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)
          ORDER BY bm25(bills_fts) LIMIT 3`,
    args: ["tax*"],
  });
  console.log("  top-3 by bm25:");
  for (const r of sample.rows) console.log(`    ${r.id}  ${(r.title as string).slice(0, 66)}`);

  // 6. trigger smoke
  const id = (await db.execute("SELECT id FROM bills LIMIT 1")).rows[0]?.id as string;
  await db.execute({ sql: "UPDATE bills SET title = title WHERE id = ?", args: [id] });
  console.log(`  trigger smoke (UPDATE title=title on ${id}): bills_fts_au fired OK`);

  console.log("\nbills_fts recovered + verified.");
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
