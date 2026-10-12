// HO 778 legs L and K: Nov 4's two routes, on `file:` copies of prod, each leg red on HEAD first.
//
//   npx tsx scripts/diagnostic/nov4-routes-legs-778.ts --seed --label L     # seed, copies, the preload's map
//   npx tsx scripts/diagnostic/nov4-routes-legs-778.ts --leg K --label L    # in process: HEAD's tick, the tree's
//   npx tsx scripts/diagnostic/nov4-routes-legs-778.ts --leg L --phase red --dir <HEAD worktree> --label L
//   npx tsx scripts/diagnostic/nov4-routes-legs-778.ts --leg L --phase green --dir <tree worktree> --label L
//
// Leg L, `/api/cron/primaries?state=XX` (§ 1): a `next start` of each build, run from a scratch worktree
// built cold (a live read caches the page it read under its cwd's .cache/, so the checkout's dev cache is
// never written), with HO 747's saved pages standing in for Ballotpedia the way HO 761 did it:
// scripts/diagnostic/saved-pages-preload-778.cjs, loaded by NODE_OPTIONS=--require, answers every
// ballotpedia.org request from the saved pages, refuses every other host, and logs each request. Each L
// copy's cursor sits on the first House unit, CT-01, whose 12-district slice holds no LA district, and the
// six house-LA-0N-2026-open rows are blanked (no roster, no date, no type), so a write shows.
//   red    HEAD's build, POST ?state=LA: the cursor tick runs (its row under /api/cron/primaries, its unit
//          not house-target, the cursor moved), and the six rows stay blank
//   green  the tree's build, POST ?state=LA: the row under /api/cron/primaries?state=LA, unit house-target,
//          attempted 6, parsedOk 6; the six rows hold the saved pages' rosters, jungle, 2026-11-03 and
//          2026-12-12; the cursor and every other row unchanged (a whole-table diff outside the six ids);
//          every request answered by the preload. Then ?state=CA and ?state=ZZ answer 400 and write no run
//          row, and no state runs the cursor tick (the control).
// Leg K, the general-ballot route's lock (§ 2), in process through the tick's own seam,
// generalBallotTick(db, io, expire), with an IO that counts requests (every page answered 404 on a virtual
// clock, so a run that reads takes no wall time and fetches nothing):
//   red    HEAD's tick (7a14df1's lib/general-ballot.ts, loaded with git cat-file) beside a planted `running`
//          general-ballot row started 10s ago: it reads (requests > 0)
//   green  the tree's tick, the same plant, its own row after it: it yields, 0 requests, its payload naming
//          the planted id, no flush
//   controls  a plant started 400s ago: it reads; no plant: it reads; a row started after its own (the later
//          id): it reads, the later id being the one that yields; and the route's own wrapper (wrapCronRoute
//          handing the tick its run id) beside a 10s plant: its row closes success, yielded, naming the plant
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed, fingerprinted before and after. Copies are
// `file:${abs}` from paths ending -778-legs.db under the gitignored scratch directory; children get that URL
// with TURSO_AUTH_TOKEN="" (not deleted: dotenv and Next's loader refill a missing key) and a CRON_SECRET
// minted for the run, never prod's. Nothing fetches Ballotpedia or any other host: the preload answers or
// refuses every server request, and leg K's IO answers its own. Every printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const HEAD_SHA = "7a14df1";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/778-artifacts"); // repo-ignored
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const PRELOAD = path.resolve("scripts/diagnostic/saved-pages-preload-778.cjs").replace(/\\/g, "/");
const SAVED = path.resolve("docs/handoffs/747-artifacts/pages/2026-09-25T19-56-59-291Z");
const PORT = 3778;
const BASE = `http://127.0.0.1:${PORT}`;
const SENTINEL_ROUTE = "/api/cron/race-challengers";
const GB_ROUTE = "/api/cron/general-ballot";
const CURSOR_KEY = "primaries_cron_cursor";
// The first House unit: buildScrapeUnits (lib/primaries-sync.ts) puts the calendar, then the 35 Senate
// states, then the House by region, northeast first. Read back from each run's payload (cursorStart and
// house.firstDistrict), not trusted.
const HOUSE_FIRST = 36;
const LA_IDS = [1, 2, 3, 4, 5, 6].map((n) => `house-LA-0${n}-2026-open`);
const WHOLE = ["races", "members", "member_ids", "primaries", "primary_candidates", "dashboard_state", "race_candidates", "general_ballot", "general_ballot_reads"];

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
const say = (s: string) => console.log(redactSecrets(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const failed: string[] = [];
const check = (leg: string, label: string, ok: boolean, detail: string) => {
  say(`  ${ok ? "PASS" : "FAIL"}  [${leg}] ${label}: ${detail}`);
  if (ok) passes++;
  else { fails++; failed.push(`[${leg}] ${label}`); }
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

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
  for (const t of ["race_candidates", "general_ballot", "general_ballot_reads", "primary_candidates", "palestine_scorecard", "member_fundraising"])
    fp[t] = sha(JSON.stringify((await read(`SELECT * FROM ${t} ORDER BY rowid`)).rows.map((r) => Object.values(r))));
  fp.schema = sha(JSON.stringify((await read(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`)).rows.map((r) => Object.values(r))));
  db.close();
  return fp;
}
async function prodUntouched(label: string, fp0: Record<string, string>, t0: string) {
  const fp1 = await prodFingerprint();
  const changed = Object.keys(fp0).filter((k) => fp0[k] !== fp1[k]);
  say(`  prod fingerprint before ${JSON.stringify(fp0)}`);
  say(`  prod fingerprint after  ${JSON.stringify(fp1)}`);
  if (changed.length === 0) { check("seed", `prod untouched (${label})`, true, "fingerprints equal"); return; }
  const db = prodClient();
  const t0m = new Date(Date.parse(t0) - 60 * 60 * 1000).toISOString();
  const runs = (await reader(db)(`SELECT id, route, started_at FROM cron_runs WHERE started_at >= ? OR (started_at >= ? AND (ended_at IS NULL OR ended_at >= ?)) ORDER BY id`, [t0, t0m, t0])).rows.map((r) => `${r.route}#${r.id}`);
  db.close();
  const cronOwned = new Set(["race_candidates", "general_ballot", "general_ballot_reads", "primary_candidates", "member_fundraising"]);
  const unexplained = changed.filter((k) => !cronOwned.has(k) || runs.length === 0);
  check("seed", `prod untouched (${label}): every difference is a prod cron's own run overlapping the window`, unexplained.length === 0, `changed ${changed.join(", ")} · runs ${runs.join("; ") || "none"}${unexplained.length ? ` · UNEXPLAINED ${unexplained.join(", ")}` : ""}`);
}

// ── copies ──────────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-778-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-778-legs.db")) throw new Error(`refused: a copy must be a *-778-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
const sentinelFile = (kind: string) => path.join(DIR, `sentinel-${kind}-${LABEL}-778.txt`);
const mapFile = () => path.join(DIR, `preload-map-${LABEL}-778.json`);
const PAGE = 1500;
async function copyRows(read: ReturnType<typeof reader>, db: Client, table: string, where = "") {
  const cols = new Set((await db.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name)));
  await db.execute(`DELETE FROM ${table}`);
  const cond = where.replace(/^\s*WHERE\s+/i, "");
  let last = -1;
  let n = 0;
  for (;;) {
    const rs = await read(`SELECT rowid AS __rid, * FROM ${table} WHERE rowid > ?${cond ? ` AND (${cond})` : ""} ORDER BY rowid LIMIT ${PAGE}`, [last]);
    if (rs.rows.length === 0) break;
    const use = Object.keys(rs.rows[0]!).filter((c) => c !== "__rid" && cols.has(c));
    const stmts: InStatement[] = rs.rows.map((r) => ({ sql: `INSERT INTO ${table} (${use.join(",")}) VALUES (${use.map(() => "?").join(",")})`, args: use.map((c) => (r as Record<string, unknown>)[c] as never) }));
    for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500), "write");
    n += rs.rows.length;
    last = Number(rs.rows[rs.rows.length - 1]!.__rid);
    if (rs.rows.length < PAGE) break;
  }
  return n;
}

async function seed() {
  mkdirSync(DIR, { recursive: true });
  mkdirSync(ART, { recursive: true });
  say(`\n── the seed`);
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();
  const tpl = copyPath("template");
  if (existsSync(tpl)) rmSync(tpl);
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: { ...process.env, TURSO_DATABASE_URL: copyUrl(tpl), TURSO_AUTH_TOKEN: "" }, encoding: "utf8" });
  if (mig.status !== 0) throw new Error(`migrate against the template failed: ${redactSecrets((mig.stderr || mig.stdout).slice(-600))}`);
  const prod = prodClient();
  const read = reader(prod);
  const counts: string[] = [];
  await withDb(copyUrl(tpl), async (db) => {
    await db.execute("PRAGMA foreign_keys = OFF");
    for (const t of WHOLE) counts.push(`${t} ${await copyRows(read, db, t)}`);
    counts.push(`cron_runs ${await copyRows(read, db, "cron_runs", `WHERE id > (SELECT MAX(id) FROM cron_runs) - 400`)} (the newest 400)`);
  });
  prod.close();
  say(`  template: the real scripts/migrate.ts against file:, seeded from prod · ${counts.join(" · ")}`);
  // The preload's map: every saved page's canonical URL, as the page itself prints it.
  const map: Record<string, string> = {};
  for (const f of readdirSync(SAVED).filter((x) => x.endsWith(".html.gz"))) {
    const html = gunzipSync(readFileSync(path.join(SAVED, f))).toString("utf8");
    const m = html.match(/<link rel="canonical" href="([^"]+)"/);
    if (m && !map[m[1]!]) map[m[1]!] = path.join(SAVED, f).replace(/\\/g, "/");
  }
  writeFileSync(mapFile(), JSON.stringify(map, null, 1));
  say(`  the preload's map: ${Object.keys(map).length} saved pages by canonical URL · LA's six: ${LA_IDS.map((_, i) => (Object.keys(map).some((u) => u.includes(`Louisiana%27s_${["1st", "2nd", "3rd", "4th", "5th", "6th"][i]}_Congressional`)) ? "saved" : "MISSING")).join(", ")}`);
  for (const kind of ["lhead", "ltree", "kred", "kgreen", "kold", "knone", "ktie", "kwrap"]) {
    const abs = copyPath(kind);
    copyFileSync(tpl, abs);
    const at = new Date(Date.now() + ["lhead", "ltree"].indexOf(kind) * 7 + 7).toISOString();
    await withDb(copyUrl(abs), async (db) => {
      // Only a leg's own rows may stand in flight: a prod run copied while `running` is closed on the
      // copy, so no plant but the leg's blocks leg K and no reaper write moves leg L's diff.
      const closed = await db.execute(`UPDATE cron_runs SET status = 'success', ended_at = started_at WHERE status = 'running'`);
      if (closed.rowsAffected) say(`  copy ${path.basename(abs)} · copied rows still running, closed on the copy: ${closed.rowsAffected}`);
      if (kind.startsWith("l")) {
        writeFileSync(sentinelFile(kind), at);
        await db.execute({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 778, 'success', ?)`, args: [SENTINEL_ROUTE, at, at, JSON.stringify({ sentinel: `HO 778 legs, the ${kind} copy only` })] });
        await db.execute({ sql: `INSERT INTO dashboard_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, args: [CURSOR_KEY, String(HOUSE_FIRST), at] });
        const ph = LA_IDS.map(() => "?").join(",");
        const del = await db.execute({ sql: `DELETE FROM primary_candidates WHERE primary_id IN (${ph})`, args: LA_IDS });
        const upd = await db.execute({ sql: `UPDATE primaries SET primary_date = NULL, runoff_date = NULL, primary_type = NULL WHERE id IN (${ph})`, args: LA_IDS });
        say(`  copy ${path.basename(abs)} · sentinel ${at} · cursor ${HOUSE_FIRST} · the six LA rows blanked (${upd.rowsAffected} rows, ${del.rowsAffected} candidates removed)`);
      } else {
        say(`  copy ${path.basename(abs)} · leg K's`);
      }
    });
  }
  await prodUntouched("the seed", fp0, t0);
}

// ── leg K: the lock, in process ─────────────────────────────────────────────
type Raw = { kind: "response"; status: number; body: string };
type IOish = { get: (url: string) => Promise<Raw>; sleep: (ms: number) => Promise<void>; now: () => number };
type TickPayload = { stop: string; attempted: number; requests: number; yieldedTo?: { id: number; startedAt: string } };
type Tick = (db: Client, io?: IOish, expire?: (tag: string) => void, opts?: { runId?: number }) => Promise<{ payload: TickPayload; chronicErr?: string }>;
function countingIO() {
  let t = Date.now();
  let n = 0;
  const io: IOish = { now: () => t, sleep: async (ms) => { t += ms; }, get: async () => { n++; return { kind: "response", status: 404, body: "" }; } };
  return { io, requests: () => n };
}
function headModule(file: string): string {
  const src = execFileSync("git", ["cat-file", "-p", `${HEAD_SHA}:${file}`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  const out = path.join(DIR, `head-${path.basename(file, ".ts")}-778.ts`);
  writeFileSync(out, src.replace(/from "\.\/([^"]+)"/g, 'from "@/lib/$1"').replace(/from "\.\.\/([^"]+)"/g, 'from "@/$1"'));
  return out;
}
const isoAgo = (s: number) => new Date(Date.now() - s * 1000).toISOString();
async function insertRun(db: Client, startedAt: string): Promise<number> {
  const rs = await db.execute({ sql: `INSERT INTO cron_runs (route, started_at, status) VALUES (?, ?, 'running') RETURNING id`, args: [GB_ROUTE, startedAt] });
  return Number(rs.rows[0]!.id);
}

async function legK() {
  say(`\n── leg K, the general-ballot route's lock (in process, a counting IO on a virtual clock)`);
  const HEAD = (await import(pathToFileURL(headModule("lib/general-ballot.ts")).href)) as { generalBallotTick: Tick };
  const TREE = (await import("@/lib/general-ballot")) as unknown as { generalBallotTick: Tick };
  const run = async (kind: string, tick: Tick, setup: (db: Client) => Promise<{ plant: number | null; own: number | null }>) =>
    withDb(copyUrl(copyPath(kind)), async (db) => {
      const ids = await setup(db);
      const c = countingIO();
      const flushed: string[] = [];
      const t0 = Date.now();
      const out = await tick(db, c.io, (tag) => flushed.push(tag), ids.own === null ? undefined : { runId: ids.own });
      return { ...ids, requests: c.requests(), payload: out.payload, flushed, ms: Date.now() - t0 };
    });
  const show = (r: { plant: number | null; own: number | null; requests: number; payload: TickPayload; flushed: string[] }) =>
    `plant ${r.plant ?? "none"} · own ${r.own ?? "none"} · requests ${r.requests} · stop ${r.payload.stop} · attempted ${r.payload.attempted} · yieldedTo ${JSON.stringify(r.payload.yieldedTo ?? null)} · flushed ${JSON.stringify(r.flushed)}`;

  const red = await run("kred", HEAD.generalBallotTick, async (db) => ({ plant: await insertRun(db, isoAgo(10)), own: null }));
  check("K red", `HEAD (${HEAD_SHA}): beside a running general-ballot row started 10s ago, the tick reads anyway`, red.requests > 0 && red.payload.stop !== "yielded", show(red));
  const green = await run("kgreen", TREE.generalBallotTick, async (db) => { const plant = await insertRun(db, isoAgo(10)); return { plant, own: await insertRun(db, isoAgo(0)) }; });
  check("K green", "the tree: the same plant, its own row after it: it yields, reads nothing, names the plant, flushes nothing", green.requests === 0 && green.payload.stop === "yielded" && green.payload.yieldedTo?.id === green.plant && green.payload.attempted === 0 && green.flushed.length === 0, show(green));
  const old = await run("kold", TREE.generalBallotTick, async (db) => { const plant = await insertRun(db, isoAgo(400)); return { plant, own: await insertRun(db, isoAgo(0)) }; });
  check("K control", "a plant started 400s ago, outside the 300s ceiling: the tree's tick reads", old.requests > 0 && old.payload.stop !== "yielded", show(old));
  const none = await run("knone", TREE.generalBallotTick, async (db) => ({ plant: null, own: await insertRun(db, isoAgo(0)) }));
  check("K control", "no plant, its own row only: the tree's tick reads (its own row doesn't count)", none.requests > 0 && none.payload.stop !== "yielded", show(none));
  const tie = await run("ktie", TREE.generalBallotTick, async (db) => { const own = await insertRun(db, isoAgo(0)); return { own, plant: await insertRun(db, isoAgo(0)) }; });
  check("K control", "a run started with it but after it (the later id): the tree's tick reads, the later id being the one that yields", tie.requests > 0 && tie.payload.stop !== "yielded" && (tie.plant ?? 0) > (tie.own ?? 0), show(tie));

  // The route's own wrapper, in process against the kwrap copy: getDb() reads the env at its first call.
  process.env.TURSO_DATABASE_URL = copyUrl(copyPath("kwrap"));
  process.env.TURSO_AUTH_TOKEN = "";
  const { getDb } = await import("@/lib/db");
  const { wrapCronRoute } = await import("@/lib/cron-log");
  const db = getDb();
  const plant = await insertRun(db, isoAgo(10));
  const c = countingIO();
  const flushed: string[] = [];
  const out = await wrapCronRoute(GB_ROUTE, ({ runId }) => TREE.generalBallotTick(db, c.io, (tag) => flushed.push(tag), { runId }), { softTimeoutMs: 290_000 });
  const rows = (await db.execute({ sql: `SELECT id, status, payload FROM cron_runs WHERE route = ? AND id > ? ORDER BY id`, args: [GB_ROUTE, plant] })).rows;
  const own = rows[0];
  const p = own ? (JSON.parse(String(own.payload)) as { payload?: TickPayload }) : null;
  check("K control", "the route's wrapper beside a 10s plant: its own row closes success, yielded, naming the plant, nothing read", rows.length === 1 && own?.status === "success" && p?.payload?.stop === "yielded" && p.payload.yieldedTo?.id === plant && c.requests() === 0 && out.httpStatus === 200, `plant ${plant} · its row ${JSON.stringify(rows.map((r) => ({ id: r.id, status: r.status })))} · payload stop ${p?.payload?.stop} yieldedTo ${JSON.stringify(p?.payload?.yieldedTo ?? null)} · requests ${c.requests()} · http ${out.httpStatus}`);
  db.close();
  writeFileSync(path.join(ART, `legK-${LABEL}.json`), JSON.stringify({ red, green, old, none, tie, wrap: { plant, rows } }, null, 1));
}

// ── leg L: the named state, through each build's server ────────────────────
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
async function startServer(dir: string, kind: "lhead" | "ltree", secret: string, shimLog: string) {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  const url = copyUrl(copyPath(kind));
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url, CRON_SECRET: secret, NODE_OPTIONS: `--require ${PRELOAD}`, SHIM_778_MAP: mapFile(), SHIM_778_LOG: shimLog };
  env.TURSO_AUTH_TOKEN = "";
  delete env.CBT_CLOCK_NOW;
  const log = path.join(DIR, `server778-${kind}-${LABEL}-${Date.now()}.log`);
  const out = createWriteStream(log);
  const server = spawn(process.execPath, [path.join(dir, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (b: Buffer) => out.write(b));
  server.stderr.on("data", (b: Buffer) => out.write(b));
  const kill = async () => {
    try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
    out.end();
    for (let i = 0; i < 20 && listeningPids().length; i++) await sleep(250);
    if (listeningPids().length) throw new Error(`port ${PORT} still bound after the kill`);
  };
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`${BASE}/api/health`)).status > 0; } catch { /* not yet */ } }
  if (!up) { await kill(); throw new Error("the server never answered /api/health"); }
  const h = (await (await fetch(`${BASE}/api/health`)).json()) as { routes?: { path?: string; lastRunAt?: string }[] };
  const mine = h.routes?.find((r) => r.path === SENTINEL_ROUTE);
  const want = readFileSync(sentinelFile(kind), "utf8").trim();
  if (mine?.lastRunAt !== want) { await kill(); throw new Error(`transport check failed: lastRunAt ${String(mine?.lastRunAt)} is not the ${kind} copy's sentinel`); }
  say(`  server :${PORT} (pid ${server.pid}, listener ${listeningPids().join(",")}) · cwd ${path.basename(dir)} · ${kind} copy (own sentinel ${want}) · preload ${path.basename(PRELOAD)}`);
  return { kill };
}

type State = { tables: Record<string, string>; runs: Record<string, unknown>[]; cursor: string | null; la: Record<string, { type: unknown; date: unknown; runoff: unknown; names: string[] }> };
async function readState(url: string): Promise<State> {
  return withDb(url, async (db) => {
    const six = LA_IDS.map((x) => `'${x}'`).join(",");
    const names = (await db.execute(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).rows.map((r) => String(r.name));
    const tables: Record<string, string> = {};
    for (const t of names) {
      if (t === "cron_runs") continue;
      const where = t === "primaries" ? `WHERE id NOT IN (${six})` : t === "primary_candidates" ? `WHERE primary_id NOT IN (${six})` : "";
      const rows = (await db.execute(`SELECT * FROM ${t} ${where}`)).rows.map((r) => JSON.stringify(Object.values(r))).sort();
      tables[t] = `${rows.length}:${sha(rows.join("\n"))}`;
    }
    const runs = (await db.execute(`SELECT * FROM cron_runs ORDER BY id`)).rows.map((r) => ({ ...r }));
    const cursor = (await db.execute({ sql: `SELECT value FROM dashboard_state WHERE key = ?`, args: [CURSOR_KEY] })).rows[0]?.value ?? null;
    const la: State["la"] = {};
    for (const id of LA_IDS) {
      const p = (await db.execute({ sql: `SELECT primary_type, primary_date, runoff_date FROM primaries WHERE id = ?`, args: [id] })).rows[0];
      const n = (await db.execute({ sql: `SELECT name FROM primary_candidates WHERE primary_id = ? ORDER BY name`, args: [id] })).rows.map((r) => String(r.name));
      la[id] = { type: p?.primary_type ?? null, date: p?.primary_date ?? null, runoff: p?.runoff_date ?? null, names: n };
    }
    return { tables, runs, cursor: cursor == null ? null : String(cursor), la };
  });
}
const newRuns = (a: State, b: State) => { const max = Math.max(0, ...a.runs.map((r) => Number(r.id))); return b.runs.filter((r) => Number(r.id) > max); };
const changedOldRuns = (a: State, b: State) => a.runs.filter((r) => { const x = b.runs.find((y) => Number(y.id) === Number(r.id)); return JSON.stringify(x) !== JSON.stringify(r); }).map((r) => `#${r.id} ${r.route} ${r.status}→${b.runs.find((y) => Number(y.id) === Number(r.id))?.status}`);
const changedTables = (a: State, b: State) => Object.keys({ ...a.tables, ...b.tables }).filter((t) => a.tables[t] !== b.tables[t]);
const shimLines = (log: string, from: number) => (existsSync(log) ? readFileSync(log, "utf8").slice(from).trim().split("\n").filter(Boolean) : []);
const shimSize = (log: string) => (existsSync(log) ? statSync(log).size : 0);
async function post(secret: string, qs: string) {
  const res = await fetch(`${BASE}/api/cron/primaries${qs}`, { method: "POST", headers: { authorization: `Bearer ${secret}` } });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = { raw: text.slice(0, 300) }; }
  return { status: res.status, body };
}
type Payload = { unit?: string; state?: string; cursorStart?: number; cursorEnd?: number; house?: { firstDistrict?: string; lastDistrict?: string; attempted?: number; parsedOk?: number; totalCandidates?: number; settledSkipped?: string[]; rosterDeletesRefused?: string[] }; fetchFailures?: string[]; budgetStopped?: boolean; perUnitMs?: unknown; runoffStrays?: string[] };
const payloadOf = (row: Record<string, unknown> | undefined) => (row?.payload ? ((JSON.parse(String(row.payload)) as { payload?: Payload }).payload ?? null) : null);

async function legL() {
  const phase = argAt("--phase");
  const dir = path.resolve(argAt("--dir") ?? "");
  if (phase !== "red" && phase !== "green") throw new Error("--phase red|green");
  if (!existsSync(path.join(dir, ".next", "BUILD_ID"))) throw new Error(`no build in ${dir}`);
  const wtSha = execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const built = statSync(path.join(dir, ".next", "BUILD_ID")).mtime.toISOString();
  say(`\n── leg L, ${phase} · the build at ${wtSha} (${path.basename(dir)}, BUILD_ID ${readFileSync(path.join(dir, ".next", "BUILD_ID"), "utf8").trim()} @ ${built})`);
  const kind = phase === "red" ? "lhead" : "ltree";
  const url = copyUrl(copyPath(kind));
  const secret = randomBytes(18).toString("hex"); // this run's own; prod's never reaches a child
  const shimLog = path.join(ART, `preload-${phase}-${LABEL}.log`);
  if (existsSync(shimLog)) rmSync(shimLog);
  const srv = await startServer(dir, kind, secret, shimLog);
  const out: Record<string, unknown> = { phase, wtSha };
  try {
    if (phase === "red") {
      const s0 = await readState(url);
      const z = shimSize(shimLog);
      const r = await post(secret, "?state=LA");
      const s1 = await readState(url);
      const fresh = newRuns(s0, s1);
      const p = payloadOf(fresh[0]);
      const lines = shimLines(shimLog, z);
      say(`  POST ?state=LA → ${r.status} · new rows ${JSON.stringify(fresh.map((x) => `${x.route}#${x.id} ${x.status}`))} · payload unit ${p?.unit} cursor ${p?.cursorStart}→${p?.cursorEnd} slice ${p?.house?.firstDistrict}..${p?.house?.lastDistrict} attempted ${p?.house?.attempted}`);
      check("L red", "HEAD's build: POST ?state=LA runs the cursor tick: its row under /api/cron/primaries", fresh.length === 1 && fresh[0]!.route === "/api/cron/primaries", JSON.stringify(fresh.map((x) => x.route)));
      check("L red", "HEAD's build: the payload's unit isn't house-target (the cursor tick's House slice from CT-01)", p?.unit !== "house-target" && p?.unit === "house" && p?.cursorStart === HOUSE_FIRST && p?.house?.firstDistrict === "CT-01", `unit ${p?.unit} · cursorStart ${p?.cursorStart} · first ${p?.house?.firstDistrict}`);
      check("L red", "HEAD's build: the cursor moves", s0.cursor === String(HOUSE_FIRST) && s1.cursor !== s0.cursor, `${s0.cursor} → ${s1.cursor}`);
      check("L red", "HEAD's build: the six LA rows stay blank (nothing read LA)", LA_IDS.every((id) => s1.la[id]!.names.length === 0 && s1.la[id]!.type === null), LA_IDS.map((id) => `${id.slice(6, 11)} ${s1.la[id]!.names.length}/${String(s1.la[id]!.type)}`).join(" · "));
      check("L red", "the preload answered every request, and refused none", lines.length > 0 && lines.every((l) => / (200|404) https:\/\/ballotpedia\.org\//.test(l)), `${lines.length} requests: ${lines.filter((l) => / 200 /.test(l)).length} saved, ${lines.filter((l) => / 404 /.test(l)).length} not saved, ${lines.filter((l) => /REFUSED/.test(l)).length} refused`);
      out.red = { status: r.status, fresh, payload: p, cursor: [s0.cursor, s1.cursor], shim: lines };
    } else {
      const { parseCandidatesPage } = await import("@/lib/primary-candidates-scrape");
      const map = JSON.parse(readFileSync(mapFile(), "utf8")) as Record<string, string>;
      const expected: Record<string, string[]> = {};
      for (const [i, id] of LA_IDS.entries()) {
        const u = Object.keys(map).find((k) => k.includes(`Louisiana%27s_${["1st", "2nd", "3rd", "4th", "5th", "6th"][i]}_Congressional_District_election,_2026`))!;
        const parsed = parseCandidatesPage(gunzipSync(readFileSync(map[u]!)).toString("utf8"), "LA", u);
        expected[id] = parsed.candidates.filter((c) => c.contest === "open").map((c) => c.name).sort();
      }
      // the target
      const s0 = await readState(url);
      const z = shimSize(shimLog);
      const r = await post(secret, "?state=LA");
      const s1 = await readState(url);
      const fresh = newRuns(s0, s1);
      const p = payloadOf(fresh[0]);
      const lines = shimLines(shimLog, z);
      say(`  POST ?state=LA → ${r.status} · new rows ${JSON.stringify(fresh.map((x) => `${x.route}#${x.id} ${x.status}`))} · payload ${JSON.stringify({ unit: p?.unit, state: p?.state, house: p?.house && { attempted: p.house.attempted, parsedOk: p.house.parsedOk, totalCandidates: p.house.totalCandidates, settledSkipped: p.house.settledSkipped, rosterDeletesRefused: p.house.rosterDeletesRefused }, budgetStopped: p?.budgetStopped, fetchFailures: p?.fetchFailures, runoffStrays: p?.runoffStrays?.length })}`);
      check("L green", "the tree's build: POST ?state=LA logs its row under /api/cron/primaries?state=LA, success", fresh.length === 1 && fresh[0]!.route === "/api/cron/primaries?state=LA" && fresh[0]!.status === "success" && r.status === 200, JSON.stringify(fresh.map((x) => `${x.route} ${x.status}`)));
      check("L green", "unit house-target, LA, attempted 6, parsedOk 6", p?.unit === "house-target" && p?.state === "LA" && p?.house?.attempted === 6 && p?.house?.parsedOk === 6, `unit ${p?.unit} · state ${p?.state} · attempted ${p?.house?.attempted} · parsedOk ${p?.house?.parsedOk}`);
      for (const id of LA_IDS) {
        const x = s1.la[id]!;
        check("L green", `${id}: the saved page's roster, jungle, 2026-11-03 and 2026-12-12`, x.type === "jungle" && x.date === "2026-11-03" && x.runoff === "2026-12-12" && JSON.stringify(x.names) === JSON.stringify(expected[id]), `${String(x.type)} ${String(x.date)} ${String(x.runoff)} · ${x.names.length} rows ${JSON.stringify(x.names)}${JSON.stringify(x.names) === JSON.stringify(expected[id]) ? "" : ` · saved page ${JSON.stringify(expected[id])}`}`);
      }
      check("L green", "the cursor unchanged", s1.cursor === s0.cursor && s0.cursor === String(HOUSE_FIRST), `${s0.cursor} → ${s1.cursor}`);
      const ct = changedTables(s0, s1);
      const cr = changedOldRuns(s0, s1);
      check("L green", "every other row unchanged: a whole-table diff outside the six ids, cron_runs gaining only the run's row", ct.length === 0 && cr.length === 0 && fresh.length === 1, `${Object.keys(s0.tables).length} tables compared · changed ${ct.join(", ") || "none"} · older cron_runs rows changed ${cr.join("; ") || "none"}`);
      const laUrls = lines.filter((l) => /Louisiana%27s_\d(st|nd|rd|th)_Congressional_District_election,_2026 <- /.test(l) && / 200 /.test(l));
      check("L green", "every request answered by the preload: the six LA pages, from the saved pages, and nothing else", lines.length === 6 && laUrls.length === 6, `${lines.length} requests · ${laUrls.length} LA pages served · ${lines.filter((l) => /REFUSED/.test(l)).length} refused · ${lines.filter((l) => / 404 /.test(l)).length} not saved`);
      out.target = { status: r.status, fresh, payload: p, shim: lines, cursor: [s0.cursor, s1.cursor], changedTables: ct, changedOldRuns: cr, la: s1.la, expected };
      // the refusals
      for (const st of ["CA", "ZZ"]) {
        const a = await readState(url);
        const zz = shimSize(shimLog);
        const rr = await post(secret, `?state=${st}`);
        const b = await readState(url);
        const fr = newRuns(a, b);
        check("L green", `?state=${st} answers 400 and writes no run row`, rr.status === 400 && fr.length === 0 && changedTables(a, b).length === 0 && shimLines(shimLog, zz).length === 0, `${rr.status} ${JSON.stringify(rr.body)} · new rows ${fr.length} · requests ${shimLines(shimLog, zz).length}`);
      }
      // the control
      const c0 = await readState(url);
      const zc = shimSize(shimLog);
      const rc = await post(secret, "");
      const c1 = await readState(url);
      const fc = newRuns(c0, c1);
      const pc = payloadOf(fc[0]);
      check("L control", "no state on the tree's build: the cursor tick runs, its row under /api/cron/primaries, the cursor moved", rc.status === 200 && fc.length === 1 && fc[0]!.route === "/api/cron/primaries" && pc?.unit === "house" && pc?.cursorStart === HOUSE_FIRST && pc?.house?.firstDistrict === "CT-01" && c1.cursor !== c0.cursor, `${rc.status} · ${JSON.stringify(fc.map((x) => x.route))} · unit ${pc?.unit} · cursor ${c0.cursor} → ${c1.cursor} · slice ${pc?.house?.firstDistrict}..${pc?.house?.lastDistrict} · ${shimLines(shimLog, zc).length} requests`);
      out.control = { status: rc.status, fresh: fc, payload: pc, cursor: [c0.cursor, c1.cursor] };
    }
  } finally {
    await srv.kill();
  }
  writeFileSync(path.join(ART, `legL-${phase}-${LABEL}.json`), JSON.stringify(out, null, 1));
}

async function main() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  say(`=== HO 778 legs · ${LABEL} · ${new Date().toISOString()} · tree ${tree} ===`);
  if (process.argv.includes("--seed")) await seed();
  if (argAt("--leg") === "K") await legK();
  if (argAt("--leg") === "L") await legL();
  say(`\n${LABEL}: ${passes} PASS · ${fails} FAIL${failed.length ? `\n  FAIL ${failed.join("\n  FAIL ")}` : ""}`);
}
main().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
