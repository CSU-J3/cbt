// HO 724 — does `writeReport` keep a stored week summary when the incoming one is
// NULL? COMMITTED. WRITES ONLY TO A LOCAL libSQL FILE IT CREATES; reads prod, never
// writes it.
//
// WHAT IT PROVES. `writeReport` (lib/report-generation.ts) upserts `reports` by slug.
// Two of its three callers carry no `summaryText` (`scripts/generate-report.ts`, the
// `/api/sync` catch-up) and the cron binds NULL on a refusal. This probe captures one
// real prod row into a local copy of the `reports` table and drives the SHIPPED
// `writeReport` over it through `getDb()` itself, so the clause being read is the one
// in the tree, not a transcription of it.
//
// THE VERDICT, `PRESERVES=` (the last line, from leg A alone):
//   no  — a summary-less write over the captured row reads summary_text NULL: the
//         upsert overwrote the stored summary (the pre-HO 724 clause
//         `summary_text = excluded.summary_text`).
//   yes — it reads the captured summary back unchanged, byte for byte, while the
//         same write DID replace content_md and created_at (so one column was
//         kept, not the whole row).
// Legs B, C and D must hold under either verdict, and the exit code is theirs:
//   B — a fresh non-NULL summary still replaces a stored one (nothing freezes);
//   C — a row that never had a summary stays NULL, both omitted and explicit null
//       (the refusal state stays expressible);
//   D — prod's captured row reads the same length after every leg (a write that
//       reached prod would read here first).
// Exit 0 when A's row really updated and B, C, D hold; 1 otherwise; 2 when the
// environment could not be proven local. Cleanup cannot change the exit code.
//
// WHY THE ORDER IS THE SAFETY PROPERTY. `getDb()` (lib/db.ts) reads
// TURSO_DATABASE_URL on its first call and caches the client. So `.env` is loaded
// into locals for a read-only prod client, the env var is OVERWRITTEN with the local
// `file:` URL and the token deleted, and only then is `lib/db` imported. The local
// table is created through that same `getDb()` client and must count 0 before the
// capture lands (prod holds many rows), which proves the lib's client is the file
// before the first `writeReport`. Every prod statement goes through `prodRead`,
// which refuses anything that is not a SELECT.
//
// WINDOWS (HO 724 STEP 0 row 7): `@libsql/client` 0.14 holds the file handle for
// ~150-290ms after `close()`, so an immediate delete is EPERM. The teardown retries
// for up to 10 s and prints what happened. A leftover is harvested by step 2 of the
// next run.
//
// Re-run it whenever `writeReport` or the `reports` schema moves.
//
//   npx tsx scripts/diagnostic/write-report-preserve-724.ts --capture 2026-08-31
import dotenv from "dotenv";
import { createClient, type InArgs } from "@libsql/client";
import { existsSync, rmSync } from "node:fs";

const LOCAL_FILE = "scripts/diagnostic/scratch/write-report-724.db";
const LOCAL_URL = `file:${LOCAL_FILE}`;
const PHANTOM = "2099-01-05"; // never a real week

async function main(): Promise<number> {
  const ci = process.argv.indexOf("--capture");
  const capture = ci >= 0 ? process.argv[ci + 1] : undefined;
  if (!capture || !/^\d{4}-\d{2}-\d{2}$/.test(capture)) { console.log("--capture YYYY-MM-DD is required"); return 2; }
  if (!existsSync("lib/report-generation.ts")) { console.log("run from the repo root"); return 2; }

  // 1. Prod credentials into locals, then the environment points at the file.
  dotenv.config();
  const prodUrl = process.env.TURSO_DATABASE_URL;
  const prodToken = process.env.TURSO_AUTH_TOKEN;
  if (!prodUrl || prodUrl.startsWith("file:")) { console.log("TURSO_DATABASE_URL from .env is not a remote URL"); return 2; }
  const prod = createClient({ url: prodUrl, authToken: prodToken });
  const prodRead = async (sql: string, args: InArgs = []) => {
    if (!/^\s*SELECT\b/i.test(sql)) throw new Error(`prodRead refuses a non-SELECT: ${sql.slice(0, 40)}`);
    return prod.execute({ sql, args });
  };
  process.env.TURSO_DATABASE_URL = LOCAL_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  console.log(`prod (read-only): ${new URL(prodUrl.replace(/^libsql:/, "https:")).host}`);
  console.log(`local:            ${process.env.TURSO_DATABASE_URL}`);

  const { getDb } = await import("../../lib/db");
  const { writeReport } = await import("../../lib/report-generation");
  if (!process.env.TURSO_DATABASE_URL?.startsWith("file:") || process.env.TURSO_AUTH_TOKEN) {
    console.log("ENV NOT LOCAL: refusing to write"); return 2;
  }

  // 2. A fresh local table: the ten columns migrate.ts gives `reports`.
  rmSync(LOCAL_FILE, { force: true });
  const db = getDb();
  await db.execute(`CREATE TABLE reports (
    slug TEXT PRIMARY KEY, week_start TEXT NOT NULL, week_end TEXT NOT NULL, title TEXT NOT NULL,
    content_md TEXT NOT NULL, created_at TEXT NOT NULL,
    laws_count INTEGER, intro_count INTEGER, moves_count INTEGER, summary_text TEXT)`);
  const c0 = Number((await db.execute("SELECT count(*) AS c FROM reports")).rows[0]!.c);
  console.log(`2. local reports count via getDb(): ${c0}`);
  if (c0 !== 0) { console.log("getDb() is not the fresh local file: refusing to write"); return 2; }

  // 3. Capture one real row, verbatim.
  const COLS = "slug, week_start, week_end, title, content_md, created_at, laws_count, intro_count, moves_count, summary_text";
  const pr = await prodRead(`SELECT ${COLS} FROM reports WHERE slug = ?`, [capture]);
  const row = pr.rows[0];
  if (!row) { console.log(`no prod row for ${capture}`); return 2; }
  if (row.summary_text === null) { console.log(`prod row ${capture} has no summary to preserve; pick a summarized week`); return 2; }
  await db.execute({
    sql: `INSERT INTO reports (${COLS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: COLS.split(", ").map((k) => row[k] ?? null),
  });
  const captured = { text: String(row.summary_text), createdAt: String(row.created_at) };
  const local = async (slug: string) =>
    (await db.execute({ sql: "SELECT length(summary_text) AS n, summary_text AS s, content_md AS c, created_at AS t FROM reports WHERE slug = ?", args: [slug] })).rows[0]!;
  const prodN = async () => (await prodRead("SELECT length(summary_text) AS n FROM reports WHERE slug = ?", [capture])).rows[0]?.n ?? null;
  const baseProd = await prodN();
  const cap = await local(capture);
  console.log(`3. captured ${capture}: local n=${cap.n} · prod n=${baseProd} · agree=${cap.n === baseProd} · content_md ${String(cap.c).length} chars · created_at ${captured.createdAt}`);
  if (cap.n !== baseProd) { console.log("capture disagrees with prod"); return 2; }

  const dRead: boolean[] = [];
  const legD = async (after: string, localN: unknown) => {
    const n = await prodN();
    dRead.push(n === baseProd);
    console.log(`   D after ${after}: prod n=${n} (want ${baseProd}) · local n=${localN} · ${n === baseProd ? "ok" : "PROD MOVED"}`);
  };
  await legD("capture", cap.n);

  const fields = {
    slug: String(row.slug), weekStart: String(row.week_start), weekEnd: String(row.week_end), title: String(row.title),
    lawsCount: row.laws_count === null ? undefined : Number(row.laws_count),
    introCount: row.intro_count === null ? undefined : Number(row.intro_count),
    movesCount: row.moves_count === null ? undefined : Number(row.moves_count),
  };

  // 4. Leg A — the CLI's exact shape: no summaryText.
  await writeReport({ ...fields, contentMd: "HO 724 probe, leg A" });
  const changesA = (await db.execute("SELECT changes() AS n")).rows[0]!.n;
  const a = await local(capture);
  const aUpdated = a.c === "HO 724 probe, leg A" && String(a.t) !== captured.createdAt;
  const preserves = a.s === captured.text;
  console.log(`4. A (no summaryText): summary n=${a.n} · content_md=${JSON.stringify(a.c)} · created_at ${a.t} · changes()=${changesA} · row updated=${aUpdated} · summary kept byte-for-byte=${preserves}`);
  await legD("A", a.n);

  // 5. Leg B — a fresh summary still wins.
  await writeReport({ ...fields, contentMd: "HO 724 probe, leg B", summaryText: "HO 724 probe, leg B" });
  const b = await local(capture);
  const bOk = b.s === "HO 724 probe, leg B";
  console.log(`5. B (fresh summaryText): summary=${JSON.stringify(b.s)} · ${bOk ? "ok" : "FAIL: the fresh summary did not replace the stored one"}`);
  await legD("B", b.n);

  // 6. Leg C — NULL stays representable on a row that never had a summary.
  const phantom = { ...fields, slug: PHANTOM, weekStart: PHANTOM, weekEnd: "2099-01-11", title: "HO 724 probe, leg C" };
  await writeReport({ ...phantom, contentMd: "HO 724 probe, leg C1" });
  const c1 = await local(PHANTOM);
  await writeReport({ ...phantom, contentMd: "HO 724 probe, leg C2", summaryText: null });
  const c2 = await local(PHANTOM);
  const cOk = c1.s === null && c2.s === null && c2.c === "HO 724 probe, leg C2";
  console.log(`6. C (${PHANTOM}): omitted → ${JSON.stringify(c1.s)} · explicit null over it → ${JSON.stringify(c2.s)} (content_md ${JSON.stringify(c2.c)}) · ${cOk ? "ok" : "FAIL"}`);
  await legD("C", c2.n);

  // 7. Leg D is the reads above; 8. the verdict and the exit code, decided BEFORE cleanup.
  const dOk = dRead.every(Boolean);
  const exit = aUpdated && bOk && cOk && dOk ? 0 : 1;
  console.log(`8. A row updated=${aUpdated} · B=${bOk ? "ok" : "FAIL"} · C=${cOk ? "ok" : "FAIL"} · D=${dOk ? `ok (${dRead.length} reads)` : "FAIL"} · exit ${exit}`);

  prod.close();
  db.close();
  const t0 = Date.now();
  let removed = false;
  while (Date.now() - t0 <= 10_000) {
    try { rmSync(LOCAL_FILE, { force: true }); removed = !existsSync(LOCAL_FILE); break; }
    catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  console.log(removed ? `cleanup: removed after ${Date.now() - t0} ms` : "cleanup: file left behind after 10 s (EPERM)");

  console.log(`PRESERVES=${preserves ? "yes" : "no"}`);
  return exit;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(2); });
