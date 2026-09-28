// HO 753 legs: the committee-bills walk keyed per bill, run end to end against a
// `file:` copy through the REAL route. The route runs on a LOCAL PRODUCTION BUILD
// (`next build`, then `next start`) whose database is a file copy and whose
// api.congress.gov answers come from committees-walk-shim-753.cjs: recorded
// endpoint bodies, failed, delayed or rate-limited on command. `/api/sync`'s writes go
// through the real `scripts/sync.ts` (runSync → upsertBill → UPSERT_SQL) under the
// same shim. Each leg is seen red on the old code before it is read green on the new.
//
//   npx tsx scripts/diagnostic/committees-walk-legs-753.ts --record            live GETs, paced, once
//   npm run build && npx tsx scripts/diagnostic/committees-walk-legs-753.ts --template --label red
//   npx tsx scripts/diagnostic/committees-walk-legs-753.ts --legs 1,2,3,4,5,6,7,8 --label red
//
//   1 failure      a bill's fetch fails once; it is walked on the next tick and its rows land
//   2 truncation   600 bills share one changed_at, cap 500; the other 100 are walked next tick
//   3 race         /api/sync writes a bill below every other bill's update_date after a tick;
//                  the next tick walks it
//   4 deadline     the shim delays so the tick stops at 45s; every walked bill is stamped,
//                  every unwalked one still selected, the row is `success` with `remaining` > 0
//   2b (the architect's order) stamped changes ahead of the never-stamped backlog: one
//                  changed bill among 600 never-stamped ones is walked in the first tick (cap 500)
//   9 (the architect's FTS trigger) a stamp-only update leaves the bill's bills_fts rows
//                  untouched; a title change rewrites them; the real migrate narrows the old
//                  trigger on a copy of HEAD's schema (prod's upgrade path)
//   4b (beyond the eight, named) the deadline between pages: a first page answering after
//                  the deadline starts no second page; the bill is neither stamped nor charged
//   5 page two     119-hr-9821's two recorded pages; 21 committees, not 20
//   6 give-up      a bill failed five ticks running is named in `gaveUp`, not selected on the
//                  sixth, and put back by an /api/sync change
//   7 idempotence  a same-update_date rewrite through UPSERT_SQL leaves changed_at alone and
//                  the bill is not walked again
//   8 repair       the dry run writes nothing (content hash); the write walks every selected
//                  bill; the 752 instrument in both keys then reads candidates 0, lost 0,
//                  stored-short 0, and 119-hr-3857 carries its two activities. Beside it,
//                  named: the repair stopping on a 429 (exit 3), on an outage (exit 4), on a
//                  bill that fails every try (exit 5), and its dry run on a non-200 probe (exit 2).
//
// SAFETY. Prod is only ever READ (SELECT only, a guard refuses anything else). Every
// write goes to a file built as `file:${abs}` from a path that must end in -753-legs.db;
// the server and the CLIs are spawned with that URL and no token, and refuse to spawn
// otherwise. Before any tick, /api/health on the spawned server must return a sentinel
// row that exists only in the copy. Prod's committees fingerprint is read before and
// after. The recorded bodies carry no key; every printed line passes redactSecrets.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { randomBytes, createHash } from "node:crypto";
import { appendFileSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InValue, type ResultSet } from "@libsql/client";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const CONGRESS = 119;
const ROUTE = "/api/cron/committees";
const SENTINEL = "2026-09-28T07:53:00.753Z";
const PORT = 3753;
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/753-artifacts");
const RECORDED = path.join(ART, "recorded");
const SHIM = path.resolve("scripts/diagnostic/committees-walk-shim-753.cjs").replace(/\\/g, "/");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const HR3857 = "119-hr-3857";
const HR9821 = "119-hr-9821";

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
const say = (s: string) => console.log(redactSecrets(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const check = (leg: string, label: string, ok: boolean, detail: string) => {
  say(`  ${ok ? "PASS" : "FAIL"}  [leg ${leg}] ${label}: ${detail}`);
  if (ok) passes++; else fails++;
};

// ── prod, read-only ─────────────────────────────────────────────────────────
function prodDb(): { db: Client; read: (sql: string, args?: InArgs) => Promise<ResultSet> } {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("libsql://")) throw new Error("reading prod needs the prod libsql:// URL in .env");
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return { db, read: (sql, args) => { if (!/^\s*SELECT\b/i.test(sql)) throw new Error("prod is read-only here"); return db.execute({ sql, args: args ?? [] }); } };
}
async function prodFingerprint(): Promise<string> {
  const { db, read } = prodDb();
  const a = (await read(`SELECT MAX(id) AS id FROM cron_runs WHERE route = ?`, [ROUTE])).rows[0]?.id;
  const b = (await read(`SELECT COUNT(*) AS n, MAX(updated_at) AS mx FROM committee_bills`)).rows[0]!;
  const c = (await read(`SELECT value FROM dashboard_state WHERE key = 'committee_bills_sync_cursor'`)).rows[0]?.value;
  const d = (await read(`SELECT COUNT(*) AS n, MAX(update_date) AS mx FROM bills`)).rows[0]!;
  db.close();
  return JSON.stringify({ committeesRun: a, committeeBills: [b.n, b.mx], cursor: c, bills: [d.n, d.mx] });
}

// ── the bills the legs use, fixed once from prod ────────────────────────────
type Pools = { pool: string[]; candidates: string[]; over20: string[]; logNamed: string[]; race: string };
async function pools(): Promise<Pools> {
  const f = path.join(ART, "pools-753.json");
  if (existsSync(f)) return JSON.parse(readFileSync(f, "utf8")) as Pools;
  const { db, read } = prodDb();
  const cursor = String((await read(`SELECT value FROM dashboard_state WHERE key = 'committee_bills_sync_cursor'`)).rows[0]?.value);
  const withRows = (await read(
    `SELECT b.id FROM bills b WHERE b.congress = ? AND json_extract(b.raw_json, '$.committees.count') BETWEEN 1 AND 3
       AND EXISTS (SELECT 1 FROM committee_bills cb WHERE cb.bill_id = b.id) ORDER BY b.id`, [CONGRESS])).rows.map((r) => String(r.id));
  // A fixed, spread sample: every k-th id.
  const k = Math.floor(withRows.length / 60);
  const pool = Array.from({ length: 60 }, (_, i) => withRows[i * k]!);
  const candidates = (await read(
    `SELECT b.id FROM bills b WHERE b.congress = ? AND b.update_date <= ? AND json_extract(b.raw_json, '$.committees.count') > 0
       AND NOT EXISTS (SELECT 1 FROM committee_bills cb WHERE cb.bill_id = b.id) ORDER BY b.id`, [CONGRESS, cursor])).rows.map((r) => String(r.id));
  const over20 = (await read(`SELECT id FROM bills WHERE congress = ? AND json_extract(raw_json, '$.committees.count') > 20 ORDER BY id`, [CONGRESS])).rows.map((r) => String(r.id));
  db.close();
  const race = candidates.find((c) => !over20.includes(c))!;
  const p: Pools = { pool, candidates, over20, logNamed: [HR3857, "119-hr-10385", "119-hr-9174"], race };
  writeFileSync(f, JSON.stringify(p, null, 1));
  return p;
}

// ── 0. record the endpoint bodies, once (live, paced 1.2s, stops on 429) ────
async function record() {
  mkdirSync(RECORDED, { recursive: true });
  const p = await pools();
  const ids = [...new Set([...p.pool, ...p.candidates, ...p.over20, ...p.logNamed, p.race])];
  const key = (process.env.CONGRESS_API_KEY ?? "").trim();
  let n = 0, last = 0;
  const get = async (u: string) => {
    const wait = last + 1200 - Date.now();
    if (wait > 0) await sleep(wait);
    last = Date.now();
    n++;
    const res = await fetch(u, { signal: AbortSignal.timeout(15_000) });
    if (res.status === 429) throw new Error("429: stopped");
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()) as { committees?: unknown[]; pagination?: { next?: string; count?: number } };
  };
  for (const id of ids) {
    const file = path.join(RECORDED, `${id}.json`);
    if (existsSync(file)) continue;
    const [, type, num] = id.split("-");
    const pages: { offset: number; body: unknown }[] = [];
    let url = `https://api.congress.gov/v3/bill/${CONGRESS}/${type}/${num}/committees?api_key=${key}&format=json`;
    let offset = 0;
    for (let i = 0; i < 10; i++) {
      const body = await get(url);
      pages.push({ offset, body });
      const next = body.pagination?.next;
      if (!next) break;
      const u = new URL(next);
      u.searchParams.set("api_key", key);
      offset = Number(u.searchParams.get("offset") ?? 0);
      url = u.href;
    }
    writeFileSync(file, redactSecrets(JSON.stringify({ id, recordedAt: new Date().toISOString(), pages }, null, 1)));
  }
  say(`recorded ${ids.length} bills (${n} GETs this run) into ${path.relative(process.cwd(), RECORDED)}`);
}

// ── templates, copies, seeding ──────────────────────────────────────────────
const templatePath = (label: string) => path.join(DIR, `template-${label}-753-legs.db`);
function copyPath(abs: string) {
  if (!abs.endsWith("-753-legs.db")) throw new Error(`refused: a copy must be a *-753-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
function treeState(): string {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const files = ["lib/committees-sync.ts", "lib/sync.ts", "scripts/migrate.ts", "app/api/cron/committees/route.ts"];
  const head = (f: string) => { try { return execFileSync("git", ["rev-parse", `HEAD:${f}`], { encoding: "utf8" }).trim(); } catch { return ""; } };
  const differ = files.filter((f) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim() !== head(f));
  const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim().slice(0, 10);
  const pin = (f: string) => (existsSync(f) ? execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim().slice(0, 10) : "absent");
  const legsCode = `driver ${pin("scripts/diagnostic/committees-walk-legs-753.ts")} shim ${pin("scripts/diagnostic/committees-walk-shim-753.cjs")} repair ${pin("scripts/repair-committee-bills.ts")} instrument ${pin("scripts/diagnostic/committees-cursor-752.ts")}`;
  const build = existsSync(".next/BUILD_ID") ? `${readFileSync(".next/BUILD_ID", "utf8").trim()} @ ${statSync(".next/BUILD_ID").mtime.toISOString()}` : "none";
  return `tree ${sha} · the walk's files: ${differ.length ? `${differ.length} of 4 differ from HEAD (${differ.map((f) => path.basename(f)).join(", ")})` : "all 4 at HEAD"} · blobs committees-sync ${blob(files[0]!)} sync ${blob(files[1]!)} migrate ${blob(files[2]!)} route ${blob(files[3]!)} · build ${build} · ${legsCode}`;
}
function template(label: string) {
  mkdirSync(DIR, { recursive: true });
  const abs = templatePath(label);
  const url = copyPath(abs);
  if (existsSync(abs)) rmSync(abs);
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url };
  delete env.TURSO_AUTH_TOKEN;
  const out = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env, encoding: "utf8" });
  if (out.status !== 0) throw new Error(`migrate against the template failed: ${redactSecrets((out.stderr || out.stdout).slice(-600))}`);
  say(`template ${label}: ${abs} (the real scripts/migrate.ts against scheme ${url.split(":")[0]}:) · ${treeState()}`);
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error(`refused: writes go to file: only (got ${url.split(":")[0]}:)`);
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
async function cols(url: string, table: string): Promise<Set<string>> {
  return withDb(url, async (db) => new Set((await db.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name))));
}
type Seed = { real?: string[]; rowsFor?: string[]; synthetic?: { id: string; update_date: string; changed_at?: string | null }[]; cursor?: string; changedAt?: Record<string, string>; updateDate?: Record<string, string> };
async function newCopy(leg: string, seed: Seed): Promise<{ abs: string; url: string }> {
  const abs = path.join(DIR, `leg${leg}-${LABEL}-${Date.now()}-753-legs.db`);
  copyFileSync(templatePath(LABEL), abs);
  const url = copyPath(abs);
  const bc = await cols(url, "bills");
  const { db: prod, read } = prodDb();
  const real = seed.real ?? [];
  const rows = real.length ? (await read(`SELECT id, congress, bill_type, bill_number, title, update_date, raw_json FROM bills WHERE id IN (${real.map(() => "?").join(",")})`, real)).rows : [];
  const cbRows = seed.rowsFor?.length ? (await read(`SELECT bill_id, committee_system_code, activity_type, activity_date, updated_at FROM committee_bills WHERE bill_id IN (${seed.rowsFor.map(() => "?").join(",")})`, seed.rowsFor)).rows : [];
  prod.close();
  if (rows.length !== real.length) throw new Error(`seed: ${real.length - rows.length} real bills not found`);
  await withDb(url, async (db) => {
    const stmts: { sql: string; args: InValue[] }[] = [];
    const put = (id: string, congress: number, type: string, num: number, title: string, ud: string, raw: string) => {
      const c: string[] = ["id", "congress", "bill_type", "bill_number", "title", "update_date", "raw_json"];
      const v: InValue[] = [id, congress, type, num, title, seed.updateDate?.[id] ?? ud, raw];
      if (bc.has("changed_at") && seed.changedAt?.[id] !== undefined) { c.push("changed_at"); v.push(seed.changedAt[id]!); }
      stmts.push({ sql: `INSERT INTO bills (${c.join(",")}) VALUES (${c.map(() => "?").join(",")})`, args: v });
    };
    for (const r of rows) put(String(r.id), Number(r.congress), String(r.bill_type), Number(r.bill_number), String(r.title), String(r.update_date), String(r.raw_json));
    for (const s of seed.synthetic ?? []) {
      const [, type, num] = s.id.split("-");
      if (s.changed_at !== undefined && s.changed_at !== null) (seed.changedAt ??= {})[s.id] = s.changed_at;
      put(s.id, CONGRESS, type!, Number(num), `HO 753 synthetic ${s.id}`, s.update_date, JSON.stringify({ committees: { count: 1 }, title: `HO 753 synthetic ${s.id}` }));
    }
    for (const r of cbRows) stmts.push({ sql: `INSERT INTO committee_bills (bill_id, committee_system_code, activity_type, activity_date, updated_at) VALUES (?, ?, ?, ?, ?)`, args: [r.bill_id, r.committee_system_code, r.activity_type, r.activity_date, r.updated_at] as InValue[] });
    stmts.push({ sql: `INSERT INTO dashboard_state (key, value, updated_at) VALUES ('committee_bills_sync_cursor', ?, ?)`, args: [seed.cursor ?? "2026-01-01T00:00:00Z", new Date().toISOString()] });
    stmts.push({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 753, 'success', '{"sentinel":"HO 753 legs, file copy only"}')`, args: [ROUTE, SENTINEL, SENTINEL] });
    for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400), "write");
  });
  say(`  copy ${path.basename(abs)} · scheme file: · seeded ${rows.length} real + ${(seed.synthetic ?? []).length} synthetic bills, ${cbRows.length} committee_bills rows, cursor ${seed.cursor ?? "2026-01-01T00:00:00Z"} · bills columns: changed_at ${bc.has("changed_at")}, committees_walked_at ${bc.has("committees_walked_at")}, committee_walk_failures ${bc.has("committee_walk_failures")}`);
  return { abs, url };
}

// ── the shim's control and log, the server, the CLIs ────────────────────────
type Shim = { control: string; log: string; set: (c: Record<string, unknown>) => void; mark: () => number; since: (m: number) => string[] };
function shimFor(leg: string): Shim {
  const control = path.join(DIR, `shim-${leg}-${LABEL}-${Date.now()}.json`);
  const log = path.join(DIR, `shim-${leg}-${LABEL}-${Date.now()}.log`);
  writeFileSync(control, "{}");
  writeFileSync(log, "");
  return {
    control, log,
    set: (c) => writeFileSync(control, JSON.stringify(c)),
    mark: () => readFileSync(log, "utf8").length,
    since: (m) => readFileSync(log, "utf8").slice(m).split(/\r?\n/).filter(Boolean),
  };
}
function shimEnv(url: string, shim: Shim): NodeJS.ProcessEnv {
  if (!url.startsWith("file:")) throw new Error("refused: spawn against file: only");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url, NODE_OPTIONS: `--require ${SHIM}`, SHIM_753_CONTROL: shim.control, SHIM_753_RECORDED: RECORDED, SHIM_753_LOG: shim.log };
  delete env.TURSO_AUTH_TOKEN;
  return env;
}
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
type Server = { tick: (label: string) => Promise<{ http: number; ms: number; lines: string[] }>; kill: () => Promise<void> };
async function startServer(url: string, shim: Shim, leg: string): Promise<Server> {
  if (listingOrThrow()) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  const secret = randomBytes(24).toString("hex"); // local only, never printed
  const env = { ...shimEnv(url, shim), CRON_SECRET: secret };
  const logFile = path.join(DIR, `server-${leg}-${LABEL}-${Date.now()}.log`);
  const out = createWriteStream(logFile);
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (b: Buffer) => out.write(b));
  server.stderr.on("data", (b: Buffer) => out.write(b));
  const kill = async () => {
    try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
    out.end();
    await sleep(900); // HO 724: the file handle releases after the process dies
  };
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    await sleep(500);
    try { up = (await fetch(`http://127.0.0.1:${PORT}/api/health`)).status > 0; } catch { /* not yet */ }
  }
  if (!up) { await kill(); throw new Error("the server never answered /api/health"); }
  const health = (await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json()) as { routes?: { path?: string; lastRunAt?: string }[] };
  const mine = health.routes?.find((r) => r.path === ROUTE);
  if (mine?.lastRunAt !== SENTINEL) { await kill(); throw new Error(`transport check failed: health lastRunAt ${String(mine?.lastRunAt)} is not the copy's sentinel; nothing triggered`); }
  say(`  server :${PORT} (pid ${server.pid}) reads the copy: /api/health's ${ROUTE} lastRunAt is the sentinel ${SENTINEL}`);
  return {
    kill,
    tick: async (label) => {
      const m = shim.mark();
      const t0 = Date.now();
      const res = await fetch(`http://127.0.0.1:${PORT}${ROUTE}`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(90_000) });
      await res.text();
      const ms = Date.now() - t0;
      const lines = shim.since(m).filter((l) => l.includes(" committees "));
      say(`    ${label}: HTTP ${res.status} in ${ms} ms · shim served ${lines.length} committees request(s)`);
      return { http: res.status, ms, lines };
    },
  };
}
function listingOrThrow(): boolean { return listeningPids().length > 0; }
function runSyncCli(url: string, shim: Shim, label: string): string[] {
  const out = spawnSync(process.execPath, [TSX, "scripts/sync.ts"], { env: shimEnv(url, shim), encoding: "utf8" });
  const lines = `${out.stdout}${out.stderr}`.split(/\r?\n/).filter((l) => /^done:|^syncing bills|^failed|^skip|^page offset/.test(l));
  for (const l of lines) say(`    sync| ${l}`);
  say(`    ${label}: scripts/sync.ts exit ${out.status}`);
  return lines;
}
function runCli(url: string, shim: Shim, args: string[], label: string): { status: number | null; out: string } {
  const script = args[0]!;
  if (!existsSync(script)) { say(`    ${label}: ${script} does not exist`); return { status: null, out: "" }; }
  const r = spawnSync(process.execPath, [TSX, ...args], { env: shimEnv(url, shim), encoding: "utf8", timeout: 900_000 });
  const out = redactSecrets(`${r.stdout}${r.stderr}`);
  say(`    ${label}: exit ${r.status}`);
  for (const l of out.split(/\r?\n/).filter(Boolean).slice(-14)) say(`      | ${l}`);
  return { status: r.status, out };
}

// ── readings of a copy ──────────────────────────────────────────────────────
async function lastRun(url: string) {
  return withDb(url, async (db) => {
    const r = (await db.execute({ sql: `SELECT id, status, payload, error_message FROM cron_runs WHERE route = ? ORDER BY id DESC LIMIT 1`, args: [ROUTE] })).rows[0]!;
    let bills: Record<string, unknown> | null = null;
    try { bills = (JSON.parse(String(r.payload)) as { payload?: { bills?: Record<string, unknown> } }).payload?.bills ?? null; } catch { /* none */ }
    return { id: Number(r.id), status: String(r.status), bills, error: r.error_message == null ? null : String(r.error_message) };
  });
}
async function rowCount(url: string, ids: string[]): Promise<Map<string, number>> {
  return withDb(url, async (db) => {
    const m = new Map(ids.map((i) => [i, 0]));
    for (let i = 0; i < ids.length; i += 400) {
      const part = ids.slice(i, i + 400);
      const rs = await db.execute({ sql: `SELECT bill_id, COUNT(DISTINCT committee_system_code) AS n FROM committee_bills WHERE bill_id IN (${part.map(() => "?").join(",")}) GROUP BY bill_id`, args: part });
      for (const r of rs.rows) m.set(String(r.bill_id), Number(r.n));
    }
    return m;
  });
}
async function billState(url: string, id: string) {
  const bc = await cols(url, "bills");
  return withDb(url, async (db) => {
    const extra = ["changed_at", "committees_walked_at", "committee_walk_failures"].filter((c) => bc.has(c));
    const r = (await db.execute({ sql: `SELECT id, update_date, title${extra.map((c) => `, ${c}`).join("")} FROM bills WHERE id = ?`, args: [id] })).rows[0];
    return r ? Object.fromEntries(Object.entries(r).filter(([k]) => isNaN(Number(k)))) as Record<string, unknown> : null;
  });
}
// Selected by the NEW rule, where the columns exist; by the OLD cursor otherwise.
async function selected(url: string, ids: string[]): Promise<{ rule: string; ids: Set<string> }> {
  const bc = await cols(url, "bills");
  return withDb(url, async (db) => {
    const ph = ids.map(() => "?").join(",");
    if (bc.has("committees_walked_at")) {
      const rs = await db.execute({ sql: `SELECT id FROM bills WHERE id IN (${ph}) AND (committees_walked_at IS NULL OR committees_walked_at < changed_at) AND COALESCE(committee_walk_failures, 0) < 5`, args: ids });
      return { rule: "walk key", ids: new Set(rs.rows.map((r) => String(r.id))) };
    }
    const cur = String((await db.execute(`SELECT value FROM dashboard_state WHERE key = 'committee_bills_sync_cursor'`)).rows[0]?.value);
    const rs = await db.execute({ sql: `SELECT id FROM bills WHERE id IN (${ph}) AND update_date > ?`, args: [...ids, cur] });
    return { rule: `old cursor ${cur}`, ids: new Set(rs.rows.map((r) => String(r.id))) };
  });
}
const fetched = (lines: string[], id: string) => lines.filter((l) => l.includes(` committees ${id} `));
async function prodRaw(id: string): Promise<Record<string, unknown>> {
  const { db, read } = prodDb();
  const r = (await read(`SELECT raw_json FROM bills WHERE id = ?`, [id])).rows[0];
  db.close();
  return JSON.parse(String(r!.raw_json)) as Record<string, unknown>;
}
const listItem = (id: string, updateDate: string) => { const [c, t, n] = id.split("-"); return { congress: Number(c), type: t!.toUpperCase(), number: n, updateDate, updateDateIncludingText: updateDate }; };

// ── the legs ────────────────────────────────────────────────────────────────
async function leg1(p: Pools) {
  const [a, b, c] = p.pool.slice(40, 43).sort() as [string, string, string];
  const cp = await newCopy("1", { real: [a, b, c], updateDate: { [a]: "2026-09-01T00:00:01Z", [b]: "2026-09-01T00:00:02Z", [c]: "2026-09-01T00:00:03Z" }, cursor: "2026-08-31T00:00:00Z" });
  const shim = shimFor("1");
  const srv = await startServer(cp.url, shim, "1");
  try {
    shim.set({ failBills: [b] });
    const t1 = await srv.tick("tick 1, the shim failing " + b);
    const r1 = await rowCount(cp.url, [a, b, c]);
    shim.set({});
    const t2 = await srv.tick("tick 2, the shim serving " + b);
    const r2 = await rowCount(cp.url, [a, b, c]);
    const sel = await selected(cp.url, [a, b, c]);
    check("1", "tick 1: the failure is real and the others walk", fetched(t1.lines, b).some((l) => l.includes("-> 500")) && r1.get(a)! > 0 && r1.get(c)! > 0 && r1.get(b) === 0, `${b} ${fetched(t1.lines, b).map((l) => l.split("-> ")[1]).join(",")} · rows ${a} ${r1.get(a)} ${b} ${r1.get(b)} ${c} ${r1.get(c)}`);
    check("1", `tick 2 fetches ${b} again`, fetched(t2.lines, b).length > 0, `${fetched(t2.lines, b).length} request(s) for it`);
    check("1", `${b}'s rows land`, r2.get(b)! > 0, `rows ${r1.get(b)} → ${r2.get(b)} · still selected by ${sel.rule}: ${[...sel.ids].join(",") || "none"}`);
  } finally { await srv.kill(); }
}
async function leg2() {
  const syn = Array.from({ length: 600 }, (_, i) => ({ id: `${CONGRESS}-hr-${90001 + i}`, update_date: "2026-09-01T00:00:00Z", changed_at: "2026-09-01T00:00:00.000Z" }));
  const cp = await newCopy("2", { synthetic: syn, cursor: "2026-08-31T00:00:00Z" });
  const shim = shimFor("2");
  const srv = await startServer(cp.url, shim, "2");
  const ids = syn.map((s) => s.id);
  try {
    const t1 = await srv.tick("tick 1");
    const r1 = [...(await rowCount(cp.url, ids)).values()].filter((n) => n > 0).length;
    const run1 = await lastRun(cp.url);
    const t2 = await srv.tick("tick 2");
    const r2 = [...(await rowCount(cp.url, ids)).values()].filter((n) => n > 0).length;
    const sel = await selected(cp.url, ids);
    check("2", "tick 1 stops short of the 600 (the cap or the deadline)", r1 < 600 && r1 > 0, `${r1} walked · ${t1.lines.length} requests · payload ${JSON.stringify(run1.bills).slice(0, 220)}`);
    check("2", "tick 2 walks the rest", r2 === 600, `${r1} → ${r2} of 600 with rows · tick 2 made ${t2.lines.length} requests · still selected by ${sel.rule}: ${sel.ids.size}`);
  } finally { await srv.kill(); }
}
async function leg3(p: Pools) {
  const qs = p.pool.slice(43, 46).sort();
  // R is walked on tick 1, then /api/sync moves it forward but still below every other
  // bill (the re-walk branch: committees_walked_at < changed_at). R2 is new, written below.
  const R = p.race;
  const R2 = p.candidates.find((c) => c !== R && !p.over20.includes(c))!;
  const cp = await newCopy("3", { real: [...qs, R], updateDate: { ...Object.fromEntries(qs.map((q, i) => [q, `2026-09-10T00:00:0${i}Z`])), [R]: "2026-01-10T00:00:00Z" }, cursor: "2026-01-01T00:00:00Z" });
  const shim = shimFor("3");
  const srv = await startServer(cp.url, shim, "3");
  try {
    const t1 = await srv.tick("tick 1");
    const r1 = await rowCount(cp.url, [R]);
    // Both below every other bill's update_date and below the old cursor tick 1 leaves (2026-09-10).
    const D1 = "2026-01-15T00:00:00Z", D2 = "2026-01-12T00:00:00Z";
    shim.set({
      syncList: [listItem(R, D1), listItem(R2, D2)],
      syncDetail: { [R]: { ...(await prodRaw(R)), updateDate: D1, updateDateIncludingText: D1 }, [R2]: { ...(await prodRaw(R2)), updateDate: D2, updateDateIncludingText: D2 } },
    });
    runSyncCli(cp.url, shim, `/api/sync moves ${R} to ${D1} and writes the new ${R2} at ${D2}`);
    const st = await billState(cp.url, R), st2 = await billState(cp.url, R2);
    shim.set({});
    const t2 = await srv.tick("tick 2");
    const after = await billState(cp.url, R);
    const r2 = await rowCount(cp.url, [R2]);
    check("3", "tick 1 walked R", fetched(t1.lines, R).length > 0 && r1.get(R)! > 0, `${fetched(t1.lines, R).length} request(s), rows ${r1.get(R)}`);
    const oth = await withDb(cp.url, async (db) => (await db.execute({ sql: "SELECT COUNT(*) AS n, MIN(update_date) AS mn FROM bills WHERE id NOT IN (?, ?)", args: [R, R2] })).rows[0]!);
    check("3", "both late writes landed through UPSERT_SQL, below every other bill", st?.update_date === D1 && st2?.update_date === D2 && D1 < String(oth.mn) && D2 < String(oth.mn), `${R} at ${String(st?.update_date)} · ${R2} at ${String(st2?.update_date)} · the other ${String(oth.n)} bills from ${String(oth.mn)}`);
    check("3", `${R}'s changed_at is newer than its walk`, typeof st?.changed_at === "string" && typeof st?.committees_walked_at === "string" && String(st.committees_walked_at) < String(st.changed_at), `walked ${String(st?.committees_walked_at)} · changed ${String(st?.changed_at)}`);
    check("3", `tick 2 re-walks ${R}`, fetched(t2.lines, R).length > 0 && String(after?.committees_walked_at ?? "") > String(st?.changed_at ?? "~"), `${fetched(t2.lines, R).length} request(s) · walked ${String(after?.committees_walked_at)}`);
    check("3", `tick 2 walks the new ${R2}, and its rows land`, fetched(t2.lines, R2).length > 0 && r2.get(R2)! > 0, `${fetched(t2.lines, R2).length} request(s), rows ${r2.get(R2)}`);
  } finally { await srv.kill(); }
}
async function leg4() {
  // 40 bills sharing ONE update_date, so any stop short of 40 splits the group.
  const syn = Array.from({ length: 40 }, (_, i) => ({ id: `${CONGRESS}-hr-${91001 + i}`, update_date: "2026-09-02T00:00:00Z" }));
  const cp = await newCopy("4", { synthetic: syn, cursor: "2026-09-01T00:00:00Z" });
  const shim = shimFor("4");
  const srv = await startServer(cp.url, shim, "4");
  const ids = syn.map((s) => s.id);
  try {
    shim.set({ delayMs: 2500 });
    const t = await srv.tick("the tick, every bill fetch delayed 2.5s");
    const run = await lastRun(cp.url);
    const rows = await rowCount(cp.url, ids);
    const walked = ids.filter((i) => rows.get(i)! > 0);
    const unwalked = ids.filter((i) => rows.get(i) === 0);
    const sel = await selected(cp.url, ids);
    const bc = await cols(cp.url, "bills");
    let stampedIffWalked = false, stampDetail = "no committees_walked_at column";
    if (bc.has("committees_walked_at")) {
      const st = await withDb(cp.url, async (db) => (await db.execute({ sql: `SELECT id, committees_walked_at FROM bills WHERE id IN (${ids.map(() => "?").join(",")})`, args: ids })).rows);
      const stamped = new Set(st.filter((r) => r.committees_walked_at != null).map((r) => String(r.id)));
      stampedIffWalked = walked.every((i) => stamped.has(i)) && unwalked.every((i) => !stamped.has(i));
      stampDetail = `${stamped.size} stamped, ${walked.length} walked`;
    }
    const uds = await withDb(cp.url, async (db) => (await db.execute({ sql: `SELECT DISTINCT update_date FROM bills WHERE id IN (${ids.map(() => "?").join(",")})`, args: ids })).rows.map((r) => String(r.update_date)));
    check("4", "(precondition) the stop split one update_date group", walked.length > 0 && unwalked.length > 0 && uds.length === 1, `${walked.length} walked and ${unwalked.length} not, all at ${uds.join(", ")}`);
    check("4", "the tick stopped at its deadline and recorded success", run.status === "success" && run.bills?.deadlineHit === true && walked.length > 0 && unwalked.length > 0, `cron_runs #${run.id} ${run.status} · deadlineHit ${String(run.bills?.deadlineHit)} · HTTP ${t.http} in ${t.ms} ms · ${walked.length} walked, ${unwalked.length} not`);
    check("4", "every walked bill is stamped and no other", stampedIffWalked, stampDetail);
    check("4", "every unwalked bill is still selected", unwalked.every((i) => sel.ids.has(i)), `${unwalked.filter((i) => sel.ids.has(i)).length} of ${unwalked.length} unwalked still selected by ${sel.rule}`);
    check("4", "the payload carries remaining > 0", typeof run.bills?.remaining === "number" && (run.bills.remaining as number) > 0, `remaining ${JSON.stringify(run.bills?.remaining)}`);
  } finally { await srv.kill(); }
}
async function leg2b(p: Pools) {
  // The architect's order: (changed_at IS NULL), changed_at, id. A bill that changed is walked
  // ahead of the never-stamped backlog, even when the backlog fills the cap.
  const S = p.pool[0]!;
  const syn = Array.from({ length: 600 }, (_, i) => ({ id: `${CONGRESS}-hr-${92001 + i}`, update_date: "2026-09-01T00:00:00Z" }));
  const cp = await newCopy("2b", { real: [S], synthetic: syn, changedAt: { [S]: "2026-09-27T00:00:00.000Z" }, updateDate: { [S]: "2026-09-27T00:00:00Z" }, cursor: "2026-08-31T00:00:00Z" });
  const shim = shimFor("2b");
  const srv = await startServer(cp.url, shim, "2b");
  try {
    const t1 = await srv.tick("tick 1, cap 500 over 600 never-stamped bills and one stamped change");
    const r = await rowCount(cp.url, [S]);
    const st = await billState(cp.url, S);
    check("2b", "(precondition) the backlog fills the cap", t1.lines.length === 500, `${t1.lines.length} requests in tick 1 · ${S} changed_at ${String(st?.changed_at)}`);
    check("2b", `the stamped change ${S} is walked in the first tick`, fetched(t1.lines, S).length > 0 && r.get(S)! > 0, `${fetched(t1.lines, S).length} request(s), rows ${r.get(S)}, walked ${String(st?.committees_walked_at)}`);
  } finally { await srv.kill(); }
}
// FTS5 keeps an external-content index in shadow tables; any rewrite of a row changes them.
async function ftsHash(url: string): Promise<string> {
  return withDb(url, async (db) => {
    const h = createHash("sha256");
    for (const t of ["bills_fts_data", "bills_fts_idx", "bills_fts_docsize"]) {
      for (const r of (await db.execute(`SELECT * FROM ${t} ORDER BY 1`)).rows) h.update(JSON.stringify(Object.values(r)));
    }
    return h.digest("hex").slice(0, 16);
  });
}
async function leg9(p: Pools) {
  const B = p.pool[1]!;
  const cp = await newCopy("9", { real: [B], cursor: "2026-09-01T00:00:00Z" });
  const trig = await withDb(cp.url, async (db) => String((await db.execute("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'bills_fts_au'")).rows[0]?.sql ?? ""));
  const bc = await cols(cp.url, "bills");
  const h0 = await ftsHash(cp.url);
  // A stamp-only update: the walk's two columns where they exist, and today's cosponsor write.
  const stampSet = ["cosponsor_count = COALESCE(cosponsor_count, 0) + 1", ...(bc.has("committees_walked_at") ? ["committees_walked_at = '2026-09-28T00:00:00.000Z'", "committee_walk_failures = 0"] : [])];
  await withDb(cp.url, (db) => db.execute({ sql: `UPDATE bills SET ${stampSet.join(", ")} WHERE id = ?`, args: [B] }));
  const h1 = await ftsHash(cp.url);
  await withDb(cp.url, (db) => db.execute({ sql: "UPDATE bills SET title = title || ' zzqfts753' WHERE id = ?", args: [B] }));
  const h2 = await ftsHash(cp.url);
  const hit = await withDb(cp.url, async (db) => (await db.execute("SELECT b.id FROM bills_fts JOIN bills b ON b.rowid = bills_fts.rowid WHERE bills_fts MATCH 'zzqfts753'")).rows.map((r) => String(r.id)));
  say(`  trigger: ${trig.replace(/\s+/g, " ").slice(0, 120)}`);
  check("9", "a stamp-only update leaves the bill's bills_fts rows untouched", h1 === h0, `shadow hash ${h0} → ${h1} after SET ${stampSet.map((x) => x.split(" =")[0]).join(", ")}`);
  check("9", "(control) a title change rewrites them, and the new title is searchable", h2 !== h1 && hit.includes(B), `shadow hash ${h1} → ${h2} · MATCH finds ${hit.join(",") || "nothing"}`);
  // Prod's path: its trigger is today's. The real migrate over a copy of HEAD's schema must narrow it.
  const headTpl = templatePath("red");
  if (!existsSync(headTpl)) { check("9", "the upgrade path (needs the red template, HEAD's schema)", false, "no template-red"); return; }
  const up = path.join(DIR, `leg9up-${LABEL}-${Date.now()}-753-legs.db`);
  copyFileSync(headTpl, up);
  const upUrl = copyPath(up);
  const before = await withDb(upUrl, async (db) => String((await db.execute("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'bills_fts_au'")).rows[0]?.sql ?? ""));
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: upUrl };
  delete env.TURSO_AUTH_TOKEN;
  const runs = [1, 2].map(() => spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env, encoding: "utf8" }));
  const after = await withDb(upUrl, async (db) => String((await db.execute("SELECT sql FROM sqlite_master WHERE type = 'trigger' AND name = 'bills_fts_au'")).rows[0]?.sql ?? ""));
  const lines = runs.map((r) => `${r.stdout}${r.stderr}`.split(/\r?\n/).filter((l) => /bills_fts_au|changed_at|committees_walked_at|committee_walk_failures/.test(l)).join(" | "));
  const narrowed = /AFTER UPDATE OF title, summary, sponsor_name ON bills/i.test(after);
  check("9", "the real migrate narrows HEAD's trigger, and a second run leaves it", runs.every((r) => r.status === 0) && !/UPDATE OF/i.test(before) && narrowed, `before: ${before.replace(/\s+/g, " ").slice(0, 60)} · after: ${after.replace(/\s+/g, " ").slice(0, 80)} · run 1: ${lines[0]!.slice(0, 200)} · run 2: ${lines[1]!.slice(0, 200)}`);
}
async function leg4b() {
  // The deadline between pages: 119-hr-9821's first page answers 46s into the tick, after the 45s
  // deadline. No second page may start; the bill is neither stamped nor charged, and stays selected.
  const cp = await newCopy("4b", { real: [HR9821], updateDate: { [HR9821]: "2026-09-10T00:00:00Z" }, cursor: "2026-09-01T00:00:00Z" });
  const shim = shimFor("4b");
  const srv = await startServer(cp.url, shim, "4b");
  try {
    shim.set({ delayBills: { [HR9821]: 46_000 } });
    const t = await srv.tick("the tick, the first page answering at 46s");
    const reqs = fetched(t.lines, HR9821).map((l) => l.slice(l.indexOf(" committees ") + 12));
    const st = await billState(cp.url, HR9821);
    const rows = await rowCount(cp.url, [HR9821]);
    const run = await lastRun(cp.url);
    const sel = await selected(cp.url, [HR9821]);
    const failed = (run.bills?.failed as { count?: number } | undefined)?.count;
    check("4b", "only the first page was requested", reqs.length === 1 && reqs[0]!.includes("@0 -> 200"), reqs.join(" | ") || "none");
    check("4b", "the bill is neither stamped nor charged, and no rows land", st?.committees_walked_at == null && Number(st?.committee_walk_failures ?? 0) === 0 && rows.get(HR9821) === 0 && "committees_walked_at" in (st ?? {}), `walked ${String(st?.committees_walked_at)} · failures ${String(st?.committee_walk_failures)} · rows ${rows.get(HR9821)}`);
    check("4b", "the row is success with deadlineHit, no failure, nothing processed", run.status === "success" && run.bills?.deadlineHit === true && failed === 0 && run.bills?.fetchErrors === 0 && run.bills?.billsProcessed === 0, `cron_runs #${run.id} ${run.status} · ${JSON.stringify(run.bills).slice(0, 240)}`);
    check("4b", "it stays selected", sel.ids.has(HR9821), `selected by ${sel.rule}: ${sel.ids.has(HR9821)}`);
  } finally { await srv.kill(); }
}
async function leg5() {
  const cp = await newCopy("5", { real: [HR9821], updateDate: { [HR9821]: "2026-09-10T00:00:00Z" }, cursor: "2026-09-01T00:00:00Z" });
  const shim = shimFor("5");
  const srv = await startServer(cp.url, shim, "5");
  try {
    const t = await srv.tick("the tick");
    const r = await rowCount(cp.url, [HR9821]);
    const hsif = await withDb(cp.url, async (db) => Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM committee_bills WHERE bill_id = ? AND committee_system_code = 'hsif00'`, args: [HR9821] })).rows[0]?.n));
    const reqs = fetched(t.lines, HR9821).map((l) => l.slice(l.indexOf(" committees ") + 12));
    check("5", `${HR9821} ends with 21 committees`, r.get(HR9821) === 21, `${r.get(HR9821)} distinct committees · hsif00 rows ${hsif}`);
    check("5", "both pages were requested with the key and answered", reqs.length === 2 && reqs[0]!.includes("@0 -> 200") && reqs[1]!.includes("@20 -> 200"), reqs.join(" | "))
  } finally { await srv.kill(); }
}
async function leg6(p: Pools) {
  const [G, G2] = p.pool.slice(46, 48).sort() as [string, string];
  const cp = await newCopy("6", { real: [G, G2], updateDate: { [G]: "2026-09-10T00:00:01Z", [G2]: "2026-09-10T00:00:02Z" }, cursor: "2026-09-01T00:00:00Z" });
  const shim = shimFor("6");
  const srv = await startServer(cp.url, shim, "6");
  try {
    shim.set({ failBills: [G] });
    const per: number[] = [];
    let run5: Awaited<ReturnType<typeof lastRun>> | null = null;
    for (let k = 1; k <= 5; k++) {
      const t = await srv.tick(`tick ${k}, the shim failing ${G}`);
      per.push(fetched(t.lines, G).length);
      if (k === 5) run5 = await lastRun(cp.url);
    }
    const t6 = await srv.tick(`tick 6, the shim still failing ${G}`);
    const gave = JSON.stringify(run5?.bills?.gaveUp ?? null);
    // Forward of the stored 2026-09-10T00:00:01Z: runSync writes only a bill whose listed date is newer.
    const D = "2026-09-20T00:00:00Z";
    const detail = { ...(await prodRaw(G)), updateDate: D, updateDateIncludingText: D };
    shim.set({ syncList: [listItem(G, D)], syncDetail: { [G]: detail } });
    const pre = await billState(cp.url, G);
    runSyncCli(cp.url, shim, `/api/sync changes ${G}'s update_date to ${D}`);
    const st = await billState(cp.url, G);
    shim.set({});
    const t7 = await srv.tick("tick 7, the shim serving " + G);
    const r = await rowCount(cp.url, [G]);
    check("6", `${G} is tried on each of ticks 1-5`, per.every((n) => n > 0), `requests per tick ${per.join(",")}`);
    check("6", `after tick 5 the payload names ${G} in gaveUp`, gave.includes(G), `gaveUp ${gave}`);
    check("6", `tick 6 does not select ${G}`, fetched(t6.lines, G).length === 0, `${fetched(t6.lines, G).length} request(s)`);
    check("6", "the /api/sync change resets its count and stamps changed_at", st?.update_date === D && Number(st?.committee_walk_failures ?? -1) === 0 && typeof st?.changed_at === "string" && pre?.changed_at == null && Number(pre?.committee_walk_failures ?? -1) === 5, `changed_at ${String(pre?.changed_at)} → ${String(st?.changed_at)} · failures ${String(pre?.committee_walk_failures)} → ${String(st?.committee_walk_failures)} · update_date ${String(st?.update_date)}`);
    check("6", `tick 7 walks ${G} and its rows land`, fetched(t7.lines, G).length > 0 && r.get(G)! > 0, `${fetched(t7.lines, G).length} request(s), rows ${r.get(G)}`);
  } finally { await srv.kill(); }
}
async function leg7(p: Pools) {
  const [I, I2] = p.pool.slice(48, 50).sort() as [string, string];
  const T0 = "2026-09-01T00:00:00.000Z";
  const cp = await newCopy("7", { real: [I, I2], changedAt: { [I]: T0, [I2]: T0 }, updateDate: { [I]: "2026-09-10T00:00:01Z", [I2]: "2026-09-10T00:00:02Z" }, cursor: "2026-09-01T00:00:00Z" });
  const shim = shimFor("7");
  const srv = await startServer(cp.url, shim, "7");
  try {
    await srv.tick("tick 1");
    const before = await billState(cp.url, I);
    const same = String(before?.update_date);
    const listed = new Date(Date.parse(same) + 1000).toISOString().replace(".000Z", "Z");
    const detail = { ...(await prodRaw(I)), title: `${String(before?.title)} [HO 753 leg 7]`, updateDate: same, updateDateIncludingText: same };
    shim.set({ syncList: [listItem(I, listed)], syncDetail: { [I]: detail } });
    runSyncCli(cp.url, shim, `/api/sync rewrites ${I} with its own update_date (the list says ${listed}, the detail ${same})`);
    const after = await billState(cp.url, I);
    shim.set({});
    const t2 = await srv.tick("tick 2");
    check("7", "the rewrite landed through UPSERT_SQL with the same update_date", String(after?.title).endsWith("[HO 753 leg 7]") && after?.update_date === same, JSON.stringify(after));
    check("7", "changed_at is left alone", "changed_at" in (after ?? {}) && after?.changed_at === T0 && before?.changed_at === T0, `changed_at ${String(before?.changed_at)} → ${String(after?.changed_at)}`);
    check("7", `tick 2 does not walk ${I} again`, fetched(t2.lines, I).length === 0, `${fetched(t2.lines, I).length} request(s)`);
  } finally { await srv.kill(); }
}
async function tableHash(url: string): Promise<string> {
  const bc = await cols(url, "bills");
  const extra = ["changed_at", "committees_walked_at", "committee_walk_failures"].filter((c) => bc.has(c));
  return withDb(url, async (db) => {
    const h = createHash("sha256");
    for (const r of (await db.execute(`SELECT id, update_date${extra.map((c) => `, ${c}`).join("")} FROM bills ORDER BY id`)).rows) h.update(JSON.stringify(r));
    for (const r of (await db.execute(`SELECT bill_id, committee_system_code, activity_type, activity_date, updated_at FROM committee_bills ORDER BY bill_id, committee_system_code, activity_type, activity_date`)).rows) h.update(JSON.stringify(r));
    return h.digest("hex").slice(0, 16);
  });
}
function instrument(url: string, shim: Shim, key: string): { candidates: number; lost: number; short: number; out: string } {
  const outDir = path.join(ART, `leg8-${LABEL}-${key}`);
  const r = spawnSync(process.execPath, [TSX, "scripts/diagnostic/committees-cursor-752.ts", "--prod", "--db", url, "--key", key, "--only", "bills", "--out", outDir], { env: shimEnv(url, shim), encoding: "utf8", timeout: 600_000 });
  const out = redactSecrets(`${r.stdout}${r.stderr}`);
  const m = out.match(/candidates (\d+)[^\n]*?lost (\d+)/);
  const s = out.match(/fall short of committees\.count \(no GETs\): (\d+)/);
  const line = out.split(/\r?\n/).find((l) => l.startsWith("bills:")) ?? out.split(/\r?\n/).slice(-3).join(" | ");
  say(`    752 instrument --key ${key} (exit ${r.status}): ${line.slice(0, 300)}`);
  return { candidates: m ? Number(m[1]) : -1, lost: m ? Number(m[2]) : -1, short: s ? Number(s[1]) : -1, out };
}
async function leg8(p: Pools) {
  const set = [...new Set([...p.candidates, ...p.over20, ...p.logNamed, ...p.pool.slice(0, 40)])];
  const withRows = set.filter((i) => !p.candidates.includes(i));
  const { db, read } = prodDb();
  const cursor = String((await read(`SELECT value FROM dashboard_state WHERE key = 'committee_bills_sync_cursor'`)).rows[0]?.value);
  db.close();
  const cp = await newCopy("8", { real: set, rowsFor: withRows, cursor });
  const shim = shimFor("8");
  const before = await tableHash(cp.url);
  const dry = runCli(cp.url, shim, ["scripts/repair-committee-bills.ts"], "the repair, dry");
  const afterDry = await tableHash(cp.url);
  check("8", "the dry run writes nothing (content hash)", dry.status === 0 && afterDry === before, `exit ${dry.status} · hash ${before} → ${afterDry}`);
  const m0 = shim.mark();
  const wr = runCli(cp.url, shim, ["scripts/repair-committee-bills.ts", "--write"], "the repair, --write");
  const served = shim.since(m0).filter((l) => l.includes(" committees "));
  const afterWrite = await tableHash(cp.url);
  const sel = await selected(cp.url, set);
  check("8", "the write walks every selected bill", wr.status === 0 && afterWrite !== before && sel.ids.size === 0, `exit ${wr.status} · ${served.length} committees requests · still selected ${sel.ids.size} of ${set.length} by ${sel.rule}`);
  const iCur = instrument(cp.url, shim, "cursor");
  const iKey = instrument(cp.url, shim, "changed_at");
  check("8", "the instrument keyed on the cursor reads candidates 0, lost 0, stored-short 0", iCur.candidates === 0 && iCur.lost === 0 && iCur.short === 0, `candidates ${iCur.candidates} · lost ${iCur.lost} · stored-short ${iCur.short}`);
  check("8", "the instrument keyed on changed_at reads candidates 0, lost 0, stored-short 0", iKey.candidates === 0 && iKey.lost === 0 && iKey.short === 0, `candidates ${iKey.candidates} · lost ${iKey.lost} · stored-short ${iKey.short}`);
  const acts = await withDb(cp.url, async (db) => (await db.execute({ sql: `SELECT activity_type, activity_date FROM committee_bills WHERE bill_id = ? AND committee_system_code = 'sseg00' ORDER BY activity_date`, args: [HR3857] })).rows.map((r) => `${r.activity_type} ${r.activity_date}`));
  check("8", `${HR3857} carries its two activities`, acts.includes("Reported By 2026-09-17T20:33:30Z") && acts.includes("Markup By 2026-06-10T13:30:00Z"), acts.join("; "));
  // Beside the eight, named: the repair stops on a 429.
  const cp2 = await newCopy("8b", { real: p.pool.slice(50, 60), cursor: "2026-09-01T00:00:00Z", updateDate: Object.fromEntries(p.pool.slice(50, 60).map((x, i) => [x, `2026-09-10T00:00:0${i}Z`])) });
  const shim2 = shimFor("8b");
  shim2.set({ rateLimitAfter: 3 });
  const rl = runCli(cp2.url, shim2, ["scripts/repair-committee-bills.ts", "--write"], "the repair, --write, the shim answering 429 after 3");
  const walked2 = [...(await rowCount(cp2.url, p.pool.slice(50, 60))).values()].filter((n) => n > 0).length;
  const sel2 = await selected(cp2.url, p.pool.slice(50, 60));
  const f2 = await withDb(cp2.url, async (db) => Number((await db.execute(`SELECT COALESCE(SUM(COALESCE(committee_walk_failures, 0)), -1) AS s FROM bills`)).rows[0]?.s));
  check("8", "(extra) the repair stops on a 429, counts no failure, and what it did not walk stays selected", rl.status === 3 && /429/.test(rl.out) && walked2 === 3 && sel2.ids.size === 7 && f2 === 0, `exit ${rl.status} · walked ${walked2} · still selected ${sel2.ids.size} · failures counted ${f2}`);
  // Beside it, named: an outage (every fetch 500) stops the repair after one round, with nothing counted.
  const ids3 = p.pool.slice(50, 60);
  const cp3 = await newCopy("8c", { real: ids3, cursor: "2026-09-01T00:00:00Z", updateDate: Object.fromEntries(ids3.map((x, i) => [x, `2026-09-10T00:00:0${i}Z`])) });
  const shim3 = shimFor("8c");
  shim3.set({ failBills: ids3 });
  const dry3 = runCli(cp3.url, shim3, ["scripts/repair-committee-bills.ts"], "the repair, dry, every fetch failing");
  check("8", "(extra) the dry run exits 2 when its probe does not answer 200", dry3.status === 2 && /did not answer 200/.test(dry3.out), `exit ${dry3.status}`);
  const ou = runCli(cp3.url, shim3, ["scripts/repair-committee-bills.ts", "--write"], "the repair, --write, every fetch failing");
  const sel3 = await selected(cp3.url, ids3);
  const f3 = await withDb(cp3.url, async (db) => Number((await db.execute(`SELECT COALESCE(SUM(COALESCE(committee_walk_failures, 0)), -1) AS s FROM bills`)).rows[0]?.s));
  // Beside it, named: one bill that fails every try, the rest walking. The run ends with exit 5 and names it.
  const ids4 = p.pool.slice(50, 60);
  const cp4 = await newCopy("8d", { real: ids4, cursor: "2026-09-01T00:00:00Z", updateDate: Object.fromEntries(ids4.map((x, i) => [x, `2026-09-10T00:00:0${i}Z`])) });
  const shim4 = shimFor("8d");
  shim4.set({ failBills: [ids4[4]] });
  const st4 = runCli(cp4.url, shim4, ["scripts/repair-committee-bills.ts", "--write"], `the repair, --write, ${ids4[4]} failing every try`);
  const walked4 = [...(await rowCount(cp4.url, ids4)).values()].filter((n) => n > 0).length;
  check("8", "(extra) a bill that fails every try ends the run with exit 5, named, after the rest walked", st4.status === 5 && st4.out.includes(ids4[4]!) && /failed on every try/.test(st4.out) && walked4 === 9, `exit ${st4.status} · walked ${walked4} of 10`);
  check("8", "(extra) an outage stops the repair after one round, counts no failure, and leaves every bill selected", ou.status === 4 && /nothing landed/.test(ou.out) && sel3.ids.size === 10 && f3 === 0, `exit ${ou.status} · still selected ${sel3.ids.size} of 10 · failures counted ${f3}`);
}

(async () => {
  if (process.argv.includes("--record")) { await record(); return; }
  if (process.argv.includes("--template")) { template(LABEL); return; }
  const legs = (argAt("--legs") ?? "").split(",").filter(Boolean);
  if (!legs.length) throw new Error("one of --record, --template, --legs");
  if (!existsSync(templatePath(LABEL))) throw new Error(`no template for ${LABEL}; run --template --label ${LABEL} after the build`);
  mkdirSync(DIR, { recursive: true });
  const p = await pools();
  const prodBefore = await prodFingerprint();
  say(`=== HO 753 legs · ${LABEL} · ${new Date().toISOString()} · ${treeState()} ===`);
  for (const leg of legs) {
    say(`\n── leg ${leg}`);
    const t = Date.now();
    try {
      if (leg === "1") await leg1(p);
      else if (leg === "2") await leg2();
      else if (leg === "3") await leg3(p);
      else if (leg === "4") await leg4();
      else if (leg === "4b") await leg4b();
      else if (leg === "5") await leg5();
      else if (leg === "6") await leg6(p);
      else if (leg === "7") await leg7(p);
      else if (leg === "8") await leg8(p);
      else if (leg === "2b") await leg2b(p);
      else if (leg === "9") await leg9(p);
      else throw new Error(`no leg ${leg}`);
    } catch (e) {
      check(leg, "the leg ran to its checks", false, redactSecrets(e instanceof Error ? e.message : String(e)));
    }
    say(`  (${Math.round((Date.now() - t) / 1000)}s)`);
  }
  const prodAfter = await prodFingerprint();
  check("*", "prod untouched", prodAfter === prodBefore, prodAfter);
  say(`\n${LABEL}: ${passes} PASS · ${fails} FAIL`);
  appendFileSync(path.join(ART, `legs-${LABEL}.summary.txt`), `${new Date().toISOString()} legs ${legs.join(",")} · ${passes} PASS · ${fails} FAIL\n`);
})().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(2); });
