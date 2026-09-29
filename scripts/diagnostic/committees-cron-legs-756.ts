// HO 756 legs: the committees cron on its new budget and with steps that fail alone, run
// end to end against a `file:` copy through the REAL route wrapper. The route runs on a
// LOCAL PRODUCTION BUILD (`next build`, then `next start`) whose database is a file copy
// and whose api.congress.gov answers come from committees-cron-shim-756.cjs (synthetic
// bills, delayed, held or hung on command, every delay honouring the abort). Each leg is
// seen red on the old code (HEAD 4ebb191) before it is read green on the new.
//
//   npm run build && npx tsx scripts/diagnostic/committees-cron-legs-756.ts --template --label red
//   npx tsx scripts/diagnostic/committees-cron-legs-756.ts --legs 1,2,3,4 --label red
//
//   1 deadline cap   a bill fetch the shim holds past the budget is cut 3s after it, the
//                    bill stays owed and uncharged, and the tick ends inside the soft
//                    timeout as success (old: the fetch runs its full 8s past the budget
//                    and is charged as a failure)
//   2 steps alone    the shim hangs the committees list fetch until it aborts: the members
//                    step and the bills walk still run, chronicErr names step 1, and the
//                    row reads success (old: the tick errors at 8s with no bill walked)
//   3 capacity       with the shim answering each bill in 0.5s, the budget walks at least
//                    400 bills (old: 45s walks under 90)
//   4 registry       lib/cron-health.ts carries the new schedule and stale limit, matching
//                    vercel.json, and its count comment matches vercel.json
//   5 outage         (from the review) every Congress.gov request 403, or every bill 503:
//                    no owed bill is charged and the tick records error. Its red is the build
//                    before the review's fix, where steps failing alone let the walk charge
//                    every bill on a success row; HEAD errored on the list first
//
// SAFETY. Prod is only READ (SELECT only, a guard refuses anything else), for a fingerprint
// before and after. Every write goes to a file built as `file:${abs}` from a path that must
// end in -756-legs.db; migrate and the server are spawned with that URL and
// TURSO_AUTH_TOKEN="" (a deleted key would be refilled from .env). Before any tick,
// /api/health on the spawned server must return a sentinel row that exists only in the
// copy. Every printed line passes redactSecrets.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InValue, type ResultSet } from "@libsql/client";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const ROUTE = "/api/cron/committees";
const SENTINEL = "2026-09-29T19:00:00.756Z";
const PORT = 3756;
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/756-artifacts");
const SHIM = path.resolve("scripts/diagnostic/committees-cron-shim-756.cjs").replace(/\\/g, "/");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");

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
async function prodFingerprint(): Promise<string> {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("libsql://")) throw new Error("reading prod needs the prod libsql:// URL in .env");
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const read = (sql: string, args: InArgs = []) => { if (!/^\s*SELECT\b/i.test(sql)) throw new Error("prod is read-only here"); return db.execute({ sql, args }); };
  const a = (await read(`SELECT MAX(id) AS id FROM cron_runs WHERE route = ?`, [ROUTE])).rows[0]?.id;
  const b = (await read(`SELECT COUNT(*) AS n, MAX(updated_at) AS mx FROM committee_bills`)).rows[0]!;
  const c = (await read(`SELECT MAX(committees_walked_at) AS w FROM bills`)).rows[0]!;
  db.close();
  return JSON.stringify({ committeesRun: a, committeeBills: [b.n, b.mx], lastWalk: c.w });
}

// ── the tree's own constants, read from source ─────────────────────────────
function treeBudgetMs(): number {
  const m = readFileSync("app/api/cron/committees/route.ts", "utf8").match(/const BILLS_BUDGET_MS = ([\d_]+);/);
  if (!m) throw new Error("no BILLS_BUDGET_MS in the route");
  return Number(m[1]!.replace(/_/g, ""));
}
function treeState(): string {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const files = ["app/api/cron/committees/route.ts", "lib/committees-sync.ts", "lib/cron-health.ts", "vercel.json"];
  const head = (f: string) => { try { return execFileSync("git", ["rev-parse", `HEAD:${f}`], { encoding: "utf8" }).trim(); } catch { return ""; } };
  const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim();
  const differ = files.filter((f) => blob(f) !== head(f));
  const build = existsSync(".next/BUILD_ID") ? `${readFileSync(".next/BUILD_ID", "utf8").trim()} @ ${statSync(".next/BUILD_ID").mtime.toISOString()}` : "none";
  return `tree ${sha} · ${differ.length ? `${differ.length} of ${files.length} differ from HEAD (${differ.map((f) => path.basename(f)).join(", ")})` : `all ${files.length} at HEAD`} · route ${blob(files[0]!).slice(0, 10)} walk ${blob(files[1]!).slice(0, 10)} · budget ${treeBudgetMs()} ms · build ${build} · driver ${blob("scripts/diagnostic/committees-cron-legs-756.ts").slice(0, 10)} shim ${blob("scripts/diagnostic/committees-cron-shim-756.cjs").slice(0, 10)}`;
}

// ── templates, copies, seeding ──────────────────────────────────────────────
const templatePath = (label: string) => path.join(DIR, `template-${label}-756-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-756-legs.db")) throw new Error(`refused: a copy must be a *-756-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
function childEnv(url: string): NodeJS.ProcessEnv {
  if (!url.startsWith("file:")) throw new Error("refused: children get file: only");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url };
  env.TURSO_AUTH_TOKEN = ""; // not deleted: dotenv and Next's env loader would refill a missing key from .env
  return env;
}
function template(label: string) {
  mkdirSync(DIR, { recursive: true });
  const abs = templatePath(label);
  const url = copyUrl(abs);
  if (existsSync(abs)) rmSync(abs);
  const out = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: childEnv(url), encoding: "utf8" });
  if (out.status !== 0) throw new Error(`migrate against the template failed: ${redactSecrets((out.stderr || out.stdout).slice(-600))}`);
  say(`template ${label}: ${abs} (the real scripts/migrate.ts against file:) · ${treeState()}`);
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: writes go to file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
// n synthetic owed bills (number 90001..), each committees.count 1 and changed_at set.
async function newCopy(leg: string, n: number): Promise<{ abs: string; url: string; ids: string[] }> {
  const abs = path.join(DIR, `leg${leg}-${LABEL}-${Date.now()}-756-legs.db`);
  copyFileSync(templatePath(LABEL), abs);
  const url = copyUrl(abs);
  const ids = Array.from({ length: n }, (_, i) => `119-hr-${90001 + i}`);
  await withDb(url, async (db) => {
    const stmts: { sql: string; args: InValue[] }[] = ids.map((id, i) => ({
      sql: `INSERT INTO bills (id, congress, bill_type, bill_number, title, update_date, raw_json, changed_at) VALUES (?, 119, 'hr', ?, ?, ?, ?, ?)`,
      args: [id, 90001 + i, `HO 756 synthetic ${id}`, "2026-09-01T00:00:00Z", JSON.stringify({ committees: { count: 1 }, title: `HO 756 synthetic ${id}` }), `2026-09-01T00:00:${String(i % 60).padStart(2, "0")}.${String(i).padStart(3, "0").slice(-3)}Z`],
    }));
    stmts.push({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 756, 'success', '{"sentinel":"HO 756 legs, file copy only"}')`, args: [ROUTE, SENTINEL, SENTINEL] });
    for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400), "write");
  });
  say(`  copy ${path.basename(abs)} · file: · ${n} synthetic owed bills`);
  return { abs, url, ids };
}

// ── the shim's control and log, the server ──────────────────────────────────
type Shim = { control: string; log: string; set: (c: Record<string, unknown>) => void; mark: () => number; since: (m: number) => string[] };
function shimFor(leg: string): Shim {
  const control = path.join(DIR, `shim756-${leg}-${LABEL}-${Date.now()}.json`);
  const log = path.join(DIR, `shim756-${leg}-${LABEL}-${Date.now()}.log`);
  writeFileSync(control, "{}");
  writeFileSync(log, "");
  return { control, log, set: (c) => writeFileSync(control, JSON.stringify(c)), mark: () => readFileSync(log, "utf8").length, since: (m) => readFileSync(log, "utf8").slice(m).split(/\r?\n/).filter(Boolean) };
}
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
type Tick = { http: number; ms: number; t0: number; lines: string[] };
type Server = { tick: (label: string) => Promise<Tick>; health: () => Promise<{ status: number; body: Record<string, unknown> }>; kill: () => Promise<void> };
async function startServer(url: string, shim: Shim, leg: string): Promise<Server> {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  const secret = randomBytes(24).toString("hex"); // local only, never printed
  const env = { ...childEnv(url), NODE_OPTIONS: `--require ${SHIM}`, SHIM_756_CONTROL: shim.control, SHIM_756_LOG: shim.log, CRON_SECRET: secret };
  const logFile = path.join(DIR, `server756-${leg}-${LABEL}-${Date.now()}.log`);
  const out = createWriteStream(logFile);
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (b: Buffer) => out.write(b));
  server.stderr.on("data", (b: Buffer) => out.write(b));
  const kill = async () => {
    try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
    out.end();
    await sleep(900);
  };
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    await sleep(500);
    try { up = (await fetch(`http://127.0.0.1:${PORT}/api/health`)).status > 0; } catch { /* not yet */ }
  }
  if (!up) { await kill(); throw new Error("the server never answered /api/health"); }
  const h = (await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json()) as { routes?: { path?: string; lastRunAt?: string }[] };
  const mine = h.routes?.find((r) => r.path === ROUTE);
  if (mine?.lastRunAt !== SENTINEL) { await kill(); throw new Error(`transport check failed: lastRunAt ${String(mine?.lastRunAt)} is not the sentinel`); }
  say(`  server :${PORT} (pid ${server.pid}) reads the copy: /api/health's ${ROUTE} lastRunAt is the sentinel`);
  return {
    kill,
    health: async () => { const r = await fetch(`http://127.0.0.1:${PORT}/api/health`); return { status: r.status, body: (await r.json()) as Record<string, unknown> }; },
    tick: async (label) => {
      const m = shim.mark();
      const t0 = Date.now();
      const res = await fetch(`http://127.0.0.1:${PORT}${ROUTE}`, { method: "POST", headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(400_000) });
      await res.text();
      const ms = Date.now() - t0;
      const lines = shim.since(m);
      say(`    ${label}: HTTP ${res.status} in ${ms} ms · shim ${lines.filter((l) => l.includes(" committees ")).length} bill answer(s), ${lines.filter((l) => l.includes("committee list")).length} list`);
      return { http: res.status, ms, t0, lines };
    },
  };
}
type Run = { status: string; elapsed: number; error: string | null; p: { steps?: Record<string, string>; timings?: Record<string, number>; bills?: { billsWalked?: number; billsProcessed?: number; deadlineHit?: boolean; remaining?: number; failed?: { count: number; ids: string[] } } } | null };
async function lastRun(url: string): Promise<Run> {
  return withDb(url, async (db) => {
    const r = (await db.execute({ sql: `SELECT status, elapsed_ms, payload, error_message FROM cron_runs WHERE route = ? ORDER BY id DESC LIMIT 1`, args: [ROUTE] })).rows[0]!;
    let p: Run["p"] = null;
    try { p = (JSON.parse(String(r.payload)) as { payload?: Run["p"] }).payload ?? null; } catch { /* none */ }
    return { status: String(r.status), elapsed: Number(r.elapsed_ms), error: r.error_message == null ? null : String(r.error_message), p };
  });
}
async function billState(url: string, ids: string[]) {
  return withDb(url, async (db) => {
    const rs = await db.execute({ sql: `SELECT id, committees_walked_at, committee_walk_failures FROM bills WHERE id IN (${ids.map(() => "?").join(",")})`, args: ids });
    return new Map(rs.rows.map((r) => [String(r.id), { walked: r.committees_walked_at == null ? null : String(r.committees_walked_at), failures: Number(r.committee_walk_failures ?? 0) }]));
  });
}

// ── the legs ────────────────────────────────────────────────────────────────
async function leg1() {
  const budget = treeBudgetMs();
  const cp = await newCopy("1", Math.ceil(budget / 600) + 120);
  const shim = shimFor("1");
  const srv = await startServer(cp.url, shim, "1");
  try {
    // Each bill answers in 0.6s, and a fetch that starts in the 2.5s before the budget is
    // held 30s more, so one is in flight when the deadline passes.
    const holdFrom = Date.now() + budget - 2500;
    shim.set({ delayMs: 600, holdFrom, holdMs: 30_000 });
    const t = await srv.tick(`one tick, each bill 0.6s, a fetch held from ${budget - 2500} ms`);
    const run = await lastRun(cp.url);
    const tm = run.p?.timings ?? {};
    const stepEnd = (tm.list ?? 0) + (tm.members ?? 0) + (tm.bills ?? 0);
    const over = stepEnd - budget;
    const held = t.lines.filter((l) => l.includes("(held")).map((l) => l.match(/committees (\S+) -> (.*)$/)).filter(Boolean) as RegExpMatchArray[];
    const heldIds = held.map((m) => m[1]!);
    const st = await billState(cp.url, heldIds);
    const heldAbort = held.map((m) => `${m[1]} ${m[2]}`);
    // Review: the floor is 2.5s, so a cut AT the deadline (a zero grace) fails too; the held
    // fetch starts inside the last 2.5s, so a 3s grace cuts it about 3s past the budget.
    check("1", "the held fetch is cut 3s past the budget, not at it and not after its own 8s", over >= 2_500 && over <= 3_600, `bills step ends ${(over / 1000).toFixed(2)}s past the ${budget / 1000}s budget · held: ${heldAbort.join(" | ") || "none"}`);
    check("1", "the cut bill stays owed and uncharged", heldIds.length > 0 && heldIds.every((id) => st.get(id)?.walked == null && st.get(id)?.failures === 0), heldIds.map((id) => `${id} walked ${st.get(id)?.walked ?? "no"} failures ${st.get(id)?.failures}`).join(" · ") || "no held bill");
    check("1", "the tick ends inside the soft timeout as success", run.status === "success", `status ${run.status} · elapsed ${run.elapsed} ms · walked ${run.p?.bills?.billsWalked} · deadlineHit ${run.p?.bills?.deadlineHit} · error ${run.error ?? "none"}`);
  } finally { await srv.kill(); }
}
async function leg2() {
  const cp = await newCopy("2", 5);
  const shim = shimFor("2");
  const srv = await startServer(cp.url, shim, "2");
  try {
    shim.set({ hangListMs: 60_000 });
    const t = await srv.tick("one tick, the committees list fetch hangs");
    const run = await lastRun(cp.url);
    const st = await billState(cp.url, cp.ids);
    const walked = [...st.values()].filter((b) => b.walked != null).length;
    check("2", "the list fetch really aborts", t.lines.some((l) => l.includes("committee list -> aborted")), t.lines.filter((l) => l.includes("committee list")).map((l) => l.split("pid ")[1]).join(" | "));
    check("2", "the bills walk still runs, and every owed bill is walked", walked === 5 && run.p?.steps?.bills === "ran", `walked ${walked} of 5 · steps ${JSON.stringify(run.p?.steps ?? null)}`);
    check("2", "the row reads success and chronicErr names the list step", run.status === "success" && /committees list step failed/.test(run.error ?? ""), `status ${run.status} · elapsed ${run.elapsed} ms · error_message ${run.error ?? "none"}`);
    const h = await srv.health();
    const r = ((h.body.routes as { path: string; schedule: string; maxStaleMs: number }[] | undefined) ?? []).find((x) => x.path === ROUTE);
    say(`    /api/health on this build: ${ROUTE} schedule ${r?.schedule} · maxStaleMs ${r?.maxStaleMs}`);
  } finally { await srv.kill(); }
}
async function leg3() {
  const budget = treeBudgetMs();
  const cp = await newCopy("3", 600);
  const shim = shimFor("3");
  const srv = await startServer(cp.url, shim, "3");
  try {
    shim.set({ delayMs: 500 });
    await srv.tick("one tick, each bill 0.5s");
    const run = await lastRun(cp.url);
    const walked = run.p?.bills?.billsWalked ?? 0;
    check("3", "the budget walks at least 400 bills at 0.5s each", walked >= 400, `walked ${walked} in ${((run.p?.timings?.bills ?? 0) / 1000).toFixed(1)}s on a ${budget / 1000}s budget · status ${run.status} · deadlineHit ${run.p?.bills?.deadlineHit} · remaining ${run.p?.bills?.remaining}`);
  } finally { await srv.kill(); }
}
// 5 (from the review): an outage must not charge the owed bills. (a) every Congress.gov
// request answers 403, a bad or missing key; (b) the list answers but every bill answers
// 503. Either way no bill may be charged, and the tick records `error` so /api/health sees it.
async function leg5() {
  for (const [sub, ctl, label] of [
    ["a", { listStatus: 403, billStatus: 403 }, "every request 403"],
    ["b", { billStatus: 503 }, "the list answers, every bill 503"],
  ] as const) {
    const cp = await newCopy(`5${sub}`, 12);
    const shim = shimFor(`5${sub}`);
    const srv = await startServer(cp.url, shim, `5${sub}`);
    try {
      shim.set(ctl);
      const t = await srv.tick(`one tick, ${label}`);
      const run = await lastRun(cp.url);
      const st = await billState(cp.url, cp.ids);
      const charged = [...st.values()].filter((b) => b.failures > 0).length;
      const asked = t.lines.filter((l) => l.includes(" committees ")).length;
      check("5", `(${sub}) ${label}: no owed bill is charged`, charged === 0, `charged ${charged} of 12 · bill requests ${asked}`);
      check("5", `(${sub}) ${label}: the tick records error, so /api/health sees it`, run.status === "error", `status ${run.status} · elapsed ${run.elapsed} ms · error_message ${(run.error ?? "none").slice(0, 160)}`);
    } finally { await srv.kill(); }
  }
}
function leg4() {
  const health = readFileSync("lib/cron-health.ts", "utf8");
  const vj = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[] };
  const entry = health.match(/\{ path: "\/api\/cron\/committees", schedule: "([^"]+)", maxStaleMs: (\d+) \* HOUR \}/);
  const vSched = vj.crons.find((c) => c.path === ROUTE)?.schedule;
  check("4", "the registry carries the new schedule and a 13h stale limit, matching vercel.json", !!entry && entry[1] === "5 */6 * * *" && entry[2] === "13" && vSched === entry[1], `registry ${entry ? `${entry[1]} · ${entry[2]}h` : "absent"} · vercel.json ${vSched}`);
  const keys = (health.match(/\{ path: "\/api/g) ?? []).length;
  const strings = new Set(vj.crons.map((c) => c.path.split("?")[0])).size;
  const crons = vj.crons.length;
  const comment = health.match(/The (\d+) watched route keys, against (\d+) distinct route strings across (\d+)/);
  check("4", "the count comment matches vercel.json", !!comment && Number(comment[1]) === keys && Number(comment[2]) === strings && Number(comment[3]) === crons, `comment ${comment ? `${comment[1]} / ${comment[2]} / ${comment[3]}` : "absent"} · counted ${keys} keys / ${strings} strings / ${crons} crons`);
}

(async () => {
  if (process.argv.includes("--template")) { template(LABEL); return; }
  const legs = (argAt("--legs") ?? "").split(",").filter(Boolean);
  if (!legs.length) throw new Error("one of --template, --legs");
  if (legs.some((l) => l !== "4") && !existsSync(templatePath(LABEL))) throw new Error(`no template for ${LABEL}; run --template --label ${LABEL} after the build`);
  mkdirSync(DIR, { recursive: true });
  const before = await prodFingerprint();
  say(`=== HO 756 legs · ${LABEL} · ${new Date().toISOString()} · ${treeState()} ===`);
  for (const leg of legs) {
    say(`\n── leg ${leg}`);
    const t = Date.now();
    try {
      if (leg === "1") await leg1();
      else if (leg === "2") await leg2();
      else if (leg === "3") await leg3();
      else if (leg === "4") leg4();
      else if (leg === "5") await leg5();
      else throw new Error(`no leg ${leg}`);
    } catch (e) {
      check(leg, "the leg ran to its checks", false, redactSecrets(e instanceof Error ? e.message : String(e)));
    }
    say(`  (${Math.round((Date.now() - t) / 1000)}s)`);
  }
  const after = await prodFingerprint();
  check("*", "prod untouched", after === before, after);
  say(`\n${LABEL}: ${passes} PASS · ${fails} FAIL`);
  appendFileSync(path.join(ART, `legs-${LABEL}.summary.txt`), `${new Date().toISOString()} legs ${legs.join(",")} · ${passes} PASS · ${fails} FAIL\n`);
})().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(2); });
