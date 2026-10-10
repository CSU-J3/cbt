// HO 769 leg C: the tracker's House matcher (scripts/sync-palestine.ts, § 2), run as shipped.
//
//   npx tsx scripts/diagnostic/tracker-match-769.ts
//
//   C1   the dry run on prod: House 212 graded, 212 matched, 0 unmatched; Lucy McBath printed
//        "matched by state: the tracker's CD GA-07, members' GA-06"; Senate 47 of 47; nobody twice.
//   red  the same dry run under 140aa77's matcher (git show into the scratch folder, nothing else
//        changed): 210 and 2, the two rows HO 768's write left unmatched.
//   C2   `--write` on a `file:` copy (the real scripts/migrate.ts, then members, palestine_scorecard
//        and dashboard_state seeded from prod by SELECT, Adelita Grijalva's and Lucy McBath's rows
//        removed if prod already holds them): both land, Adelita on G000606 and not Raúl's G000551,
//        McBath on her own M001208, each with the grade and rank of her row in the live sheet.
//   ctl  the copy's dry run with one planted House row (tracker-plant-shim-769.cjs): a CD and a
//        surname no member holds stay unmatched, and the other 212 still match.
//   *    prod's palestine_scorecard and pools key fingerprint the same before and after.
//
// Prod is read through a SELECT guard; the children that write get `file:` only.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PALESTINE_POOLS_KEY, PALESTINE_TRACKER_HOUSE_GID, PALESTINE_TRACKER_SHEET } from "@/lib/palestine-config";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/769-artifacts"); // repo-ignored
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const SHIM = path.resolve("scripts/diagnostic/tracker-plant-shim-769.cjs").replace(/\\/g, "/");
const SHIPPED = "scripts/sync-palestine.ts";
const RED = path.join(DIR, "sync-palestine-140aa77-769.ts");
const COPY = path.join(DIR, `tracker-769-legC-${Date.now()}.db`);
const PLANT = "F,999,Planted,Zzyzx,WY-07,0,0,0";
const ADELITA = "G000606";
const RAUL = "G000551";
const MCBATH = "M001208";

const log: string[] = [];
const say = (s: string) => {
  const line = redactSecrets(s);
  console.log(line);
  log.push(line);
};
let passes = 0;
let fails = 0;
const check = (leg: string, label: string, ok: boolean, detail: string) => {
  say(`  ${ok ? "PASS" : "FAIL"}  [${leg}] ${label}: ${detail}`);
  if (ok) passes++;
  else fails++;
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── prod, read-only ─────────────────────────────────────────────────────────
function prodClient(): Client {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("libsql://")) throw new Error("reading prod needs the prod libsql:// URL in .env");
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}
const reader = (db: Client) => (sql: string, args: InArgs = []) => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("prod is read-only here");
  return db.execute({ sql, args });
};
async function prodFingerprint(): Promise<Record<string, string>> {
  const db = prodClient();
  const read = reader(db);
  const fp: Record<string, string> = {};
  fp.palestine_scorecard = sha(JSON.stringify((await read(`SELECT * FROM palestine_scorecard ORDER BY bioguide_id`)).rows.map((r) => Object.values(r))));
  fp.pools = sha(JSON.stringify((await read(`SELECT value, updated_at FROM dashboard_state WHERE key = ?`, [PALESTINE_POOLS_KEY])).rows.map((r) => Object.values(r))));
  db.close();
  return fp;
}

// ── the copy ────────────────────────────────────────────────────────────────
function childEnv(url: string, extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  if (!url.startsWith("file:")) throw new Error("refused: children that may write get file: only");
  return { ...process.env, ...extra, TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "" };
}
async function withCopy<T>(fn: (db: Client) => Promise<T>): Promise<T> {
  const db = createClient({ url: `file:${COPY}` });
  try {
    return await fn(db);
  } finally {
    db.close();
    await sleep(400); // a libsql file handle stays locked briefly after close() on this box (HO 724)
  }
}
async function copyRows(read: ReturnType<typeof reader>, db: Client, table: string): Promise<number> {
  const cols = new Set((await db.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name)));
  await db.execute(`DELETE FROM ${table}`);
  const rs = await read(`SELECT * FROM ${table}`);
  if (rs.rows.length === 0) return 0;
  const use = Object.keys(rs.rows[0]!).filter((c) => cols.has(c));
  const stmts: InStatement[] = rs.rows.map((r) => ({
    sql: `INSERT INTO ${table} (${use.join(",")}) VALUES (${use.map(() => "?").join(",")})`,
    args: use.map((c) => (r as Record<string, unknown>)[c] as never),
  }));
  for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500), "write");
  return rs.rows.length;
}

// ── the tracker, as a child ─────────────────────────────────────────────────
function runTracker(label: string, script: string, args: string[], env: NodeJS.ProcessEnv) {
  const r = spawnSync(process.execPath, [TSX, script, ...args], { env, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = redactSecrets(r.stdout ?? "");
  const err = redactSecrets(r.stderr ?? "");
  writeFileSync(path.join(ART, `legC-${label}.txt`), `$ ${path.basename(script)} ${args.join(" ")}\n${out}${err ? `\n--- stderr\n${err}` : ""}`);
  return { status: r.status, out, err };
}
type MissLine = { name: string; place: string; line: number; reason: string };
function tab(out: string, which: "senate" | "house") {
  const block = out.split(/\n== /).find((b) => b.startsWith(`${which} tab`)) ?? "";
  const num = (re: RegExp) => Number(re.exec(block)?.[1] ?? Number.NaN);
  const misses: MissLine[] = [...block.matchAll(/^ {4}(.+?) \(([A-Z]{2}-[0-9A-Z]+)\), row (\d+): (.+)$/gm)].map((m) => ({
    name: m[1]!,
    place: m[2]!,
    line: Number(m[3]),
    reason: m[4]!,
  }));
  return {
    header: /header check: pass/.test(block),
    graded: num(/^ {2}graded: (\d+)/m),
    matched: num(/^ {2}matched: (\d+)/m),
    unmatched: num(/^ {2}unmatched graded: (\d+)/m),
    notes: [...block.matchAll(/^ {4}(.+?), row (\d+): (matched by state: .+)$/gm)].map((m) => `${m[1]}, row ${m[2]}: ${m[3]}`),
    misses,
    stored: /stored rows: (.+)$/m.exec(block)?.[1] ?? "?",
  };
}
const twice = (out: string) => Number(/members matched twice: (\d+)/.exec(out)?.[1] ?? Number.NaN);

// The live sheet's own row for a member, by its first four cells: grade and rank.
async function sheetRow(first: string, last: string, cd: string): Promise<{ grade: string; rank: string } | null> {
  const res = await fetch(`${PALESTINE_TRACKER_SHEET}/export?format=csv&gid=${PALESTINE_TRACKER_HOUSE_GID}`);
  if (!res.ok) throw new Error(`House tab fetch: HTTP ${res.status}`);
  const line = (await res.text()).split(/\r?\n/).find((l) => l.includes(`,${first},${last},${cd},`));
  if (!line) return null;
  const [grade, rank] = line.split(",");
  return { grade: (grade ?? "").trim(), rank: (rank ?? "").trim() };
}

async function main() {
  mkdirSync(ART, { recursive: true });
  say(`HO 769 leg C · ${new Date().toISOString()} · node ${process.version} · the matcher at ${execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()} (working tree)`);
  const fp0 = await prodFingerprint();

  // C1: the shipped dry run on prod.
  say(`\n── C1, the dry run on prod (${SHIPPED} as built)`);
  const c1 = runTracker("dry-run-prod", SHIPPED, [], { ...process.env });
  const h1 = tab(c1.out, "house");
  const s1 = tab(c1.out, "senate");
  check("C1", "exit 0, both header checks pass", c1.status === 0 && h1.header && s1.header, `exit ${c1.status} · House header ${h1.header} · Senate header ${s1.header}`);
  check("C1", "House 212 graded, 212 matched, 0 unmatched", h1.graded === 212 && h1.matched === 212 && h1.unmatched === 0, `graded ${h1.graded} · matched ${h1.matched} · unmatched ${h1.unmatched}${h1.misses.length ? ` · ${h1.misses.map((m) => `${m.name} (${m.place}): ${m.reason}`).join(" | ")}` : ""}`);
  check("C1", "Lucy McBath matched by state, GA-07 to GA-06", h1.notes.length === 1 && h1.notes[0] === "Lucy McBath, row 195: matched by state: the tracker's CD GA-07, members' GA-06", h1.notes.join(" | ") || "(no note)");
  check("C1", "Senate 47 of 47, nobody matched twice", s1.matched === 47 && s1.unmatched === 0 && twice(c1.out) === 0, `Senate matched ${s1.matched} · unmatched ${s1.unmatched} · twice ${twice(c1.out)}`);
  say(`  House stored rows: ${h1.stored}`);

  // red: 140aa77's matcher, same dry run.
  say(`\n── red, the dry run on prod under 140aa77's matcher`);
  const old = execFileSync("git", ["show", "140aa77:scripts/sync-palestine.ts"], { encoding: "utf8" });
  const redSrc = `// HO 769 leg C's red: scripts/sync-palestine.ts at 140aa77, imports moved for scripts/diagnostic/scratch/, a dry run whatever the flags.\n${old
    .replace(/from "\.\.\/lib\//g, 'from "../../../lib/')
    .replace(`const WRITE = process.argv.includes("--write");`, "const WRITE = false;")}`;
  if (!redSrc.includes("const WRITE = false;")) throw new Error("red: the WRITE line moved; refusing to run 140aa77's script");
  writeFileSync(RED, redSrc);
  const red = runTracker("red-140aa77-dry-run-prod", RED, [], { ...process.env });
  const hr = tab(red.out, "house");
  const redAdelita = hr.misses.find((m) => m.name === "Adelita Grijalva" && m.place === "AZ-07");
  const redMcBath = hr.misses.find((m) => m.name === "Lucy McBath" && m.place === "GA-07");
  check("red", "140aa77 reads House 210 matched and 2 unmatched: Adelita Grijalva (two at AZ-07) and Lucy McBath (none at GA-07)", red.status === 0 && hr.matched === 210 && hr.unmatched === 2 && !!redAdelita && /2 House members at AZ-07 match/.test(redAdelita.reason) && !!redMcBath && /GA-07 holds .*; no "McBath"/.test(redMcBath.reason), `exit ${red.status} · matched ${hr.matched} · unmatched ${hr.unmatched} · ${hr.misses.map((m) => `${m.name} (${m.place}): ${m.reason}`).join(" | ")}`);

  // C2: --write on a copy.
  say(`\n── C2, \`--write\` on a file: copy`);
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: childEnv(`file:${COPY}`), encoding: "utf8" });
  if (mig.status !== 0) throw new Error(`migrate against the copy failed: ${redactSecrets((mig.stderr || mig.stdout).slice(-600))}`);
  const prod = prodClient();
  const read = reader(prod);
  const seeded = await withCopy(async (db) => {
    await db.execute("PRAGMA foreign_keys = OFF");
    const n: string[] = [];
    for (const t of ["members", "palestine_scorecard", "dashboard_state"]) n.push(`${t} ${await copyRows(read, db, t)}`);
    const del = await db.execute({ sql: `DELETE FROM palestine_scorecard WHERE bioguide_id IN (?, ?)`, args: [ADELITA, MCBATH] });
    n.push(`removed before the write: ${del.rowsAffected} of ${ADELITA}/${MCBATH}`);
    return n.join(" · ");
  });
  prod.close();
  say(`  copy: the real scripts/migrate.ts against file:, seeded from prod · ${seeded}`);
  const c2 = runTracker("write-copy", SHIPPED, ["--write"], childEnv(`file:${COPY}`));
  const h2 = tab(c2.out, "house");
  check("C2", "exit 0; House 212 matched and written in one batch; the two rows new", c2.status === 0 && h2.matched === 212 && /wrote house: 212 rows affected in one batch of 212/.test(c2.out) && /; 2 new$/.test(h2.stored), `exit ${c2.status} · matched ${h2.matched} · stored ${h2.stored} · ${/wrote house: [^\n]+/.exec(c2.out)?.[0] ?? "(no house write line)"}`);
  const rows = await withCopy(async (db) =>
    (await db.execute({ sql: `SELECT bioguide_id, grade, rank FROM palestine_scorecard WHERE bioguide_id IN (?, ?, ?)`, args: [ADELITA, RAUL, MCBATH] })).rows.map((r) => ({ id: String(r.bioguide_id), grade: String(r.grade), rank: r.rank == null ? "" : String(r.rank) })),
  );
  const [adelitaSheet, mcbathSheet] = [await sheetRow("Adelita", "Grijalva", "AZ-07"), await sheetRow("Lucy", "McBath", "GA-07")];
  const a = rows.find((r) => r.id === ADELITA);
  const m = rows.find((r) => r.id === MCBATH);
  check("C2", `Adelita Grijalva on ${ADELITA}, with her sheet row's grade and rank; nothing on Raúl's ${RAUL}`, !!a && !!adelitaSheet && a.grade === adelitaSheet.grade && a.rank === adelitaSheet.rank && !rows.some((r) => r.id === RAUL), `copy ${JSON.stringify(a ?? null)} · sheet ${JSON.stringify(adelitaSheet)} · ${RAUL} rows ${rows.filter((r) => r.id === RAUL).length}`);
  check("C2", `Lucy McBath on her own ${MCBATH} (matched by state), with her sheet row's grade and rank`, !!m && !!mcbathSheet && m.grade === mcbathSheet.grade && m.rank === mcbathSheet.rank, `copy ${JSON.stringify(m ?? null)} · sheet ${JSON.stringify(mcbathSheet)}`);

  // ctl: a planted row, on the copy, dry.
  say(`\n── control, a planted House row on the copy (dry run): ${PLANT}`);
  const ctl = runTracker("control-planted-row-copy", SHIPPED, [], childEnv(`file:${COPY}`, { NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${SHIM}`.trim(), PLANT_ROW_GID: PALESTINE_TRACKER_HOUSE_GID, PLANT_ROW_CSV: PLANT }));
  const hc = tab(ctl.out, "house");
  const planted = hc.misses.find((x) => x.name === "Planted Zzyzx" && x.place === "WY-07");
  check("ctl", "the shim planted the row in the House tab only", /\[tracker-plant-shim-769\] appended to gid 1984730710/.test(ctl.err) && (ctl.err.match(/\[tracker-plant-shim-769\]/g) ?? []).length === 1, (ctl.err.match(/\[tracker-plant-shim-769\][^\n]*/g) ?? []).join(" | ") || "(no shim line)");
  check("ctl", "the planted row stays unmatched, and the other 212 still match", ctl.status === 0 && hc.graded === 213 && hc.matched === 212 && hc.unmatched === 1 && !!planted && planted.reason === "no House member at WY-07, nor anywhere in WY", `exit ${ctl.status} · graded ${hc.graded} · matched ${hc.matched} · unmatched ${hc.unmatched} · ${planted ? `row ${planted.line}: ${planted.reason}` : "(planted row not listed)"}`);

  const fp1 = await prodFingerprint();
  const changed = Object.keys(fp0).filter((k) => fp0[k] !== fp1[k]);
  check("*", "prod's palestine_scorecard and pools key untouched", changed.length === 0, changed.length ? `changed: ${changed.join(", ")}` : `fingerprints equal · ${JSON.stringify(fp1)}`);

  say(`\nleg C: ${passes} PASS · ${fails} FAIL`);
  writeFileSync(path.join(ART, "legC.txt"), log.join("\n") + "\n");
  if (fails) process.exitCode = 1;
}

main().catch((e) => {
  console.error(redactSecrets(String(e?.stack ?? e)));
  process.exitCode = 1;
});
