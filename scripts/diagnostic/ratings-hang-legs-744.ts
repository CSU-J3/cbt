// HO 744 — the hang legs. The ratings route, over HTTP, on a LOCAL PRODUCTION
// BUILD (`next build` then `next start`) pointed at a `file:` copy of prod, with
// one chamber's widget fetch sent to a local server that accepts and never
// answers. Everything under test is the shipped path end to end: the route,
// wrapCronRoute and its 55s soft timeout, the sync's allSettled, fetchHtml's
// per-fetch cap, the `cron_runs` row, and /api/health's reading of it. The only
// substitutions are the database (a file) and one host (ratings-hang-shim-744.cjs).
//
//   npm run build && npx tsx scripts/diagnostic/ratings-hang-legs-744.ts --leg a
//
//   leg a  SENATE widget hangs -> House writes land, the run records `error`
//                                 naming senate, health reads the route
//                                 unhealthy, elapsed near the 8s cap
//   leg b  HOUSE widget hangs  -> the mirror: Senate writes land, `error`
//                                 naming house
//   leg c  CONTROL — leg a's hang on a build with the per-fetch cap REMOVED:
//                                 `timeout` near 55s, health reads it healthy,
//                                 neither chamber wrote. The failure this change
//                                 exists to prevent. Run it on the real build
//                                 too and it must go red: the cap turns it into
//                                 leg a.
//
// WHY A PERTURBATION. The House store is current, so the House leg writes
// nothing on a normal day and "House writes land" would read the same whether
// the leg ran or not (the blind instrument this project keeps catching). One
// House row is set to a label no widget emits before the run; the House leg
// wrote if and only if that row changed. The Senate store is four months stale,
// so the Senate leg writes on its own.
//
// SAFETY. Prod is only ever READ (seed and the untouched-check), through a
// SELECT/WITH guard. The server gets `TURSO_DATABASE_URL=file:…` and no token,
// and nothing is triggered until /api/health on that server returns a sentinel
// row that exists only in the file copy — the transport discriminator. One run
// per process and a fresh file per run (a libsql `file:` handle stays locked
// after close() on this box, HO 724). The server is killed by its own PID tree.
import { spawn, execFileSync } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type ResultSet } from "@libsql/client";

config({ path: ".env" });

const ROUTE = "/api/sync-race-ratings";
const FETCH_CAP_MS = 8_000; // FETCH_TIMEOUT_MS, lib/race-ratings-scrape.ts
const SOFT_TIMEOUT_MS = 55_000; // DEFAULT_SOFT_TIMEOUT_MS, lib/cron-log.ts
const PLATFORM_KILL_MS = 60_000; // maxDuration, app/api/sync-race-ratings/route.ts
const SENTINEL_STARTED_AT = "2026-09-23T12:34:56.744Z";
const PERTURBED_ID = "CO-05-2026-inside_elections";
const PERTURBED_LABEL = "PERTURBED-744";

type Leg = "a" | "b" | "c";
const LEGS: Record<Leg, { hang: "senate" | "house"; expect: "error" | "timeout" }> = {
  a: { hang: "senate", expect: "error" },
  b: { hang: "house", expect: "error" },
  c: { hang: "senate", expect: "timeout" },
};
const argAt = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const LEG = (argAt("--leg") ?? "a") as Leg;
if (!(LEG in LEGS)) throw new Error(`--leg must be a|b|c, got ${LEG}`);
const CFG = LEGS[LEG];
const PORT = Number(argAt("--port") ?? 3744);
const STAMP = Date.now();
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const FILE = path.join(DIR, `legs-744-${LEG}-${STAMP}.db`);
const LOG = path.join(DIR, `legs-744-${LEG}-${STAMP}.server.log`);
const SHIM = path.resolve("scripts/diagnostic/ratings-hang-shim-744.cjs").replace(/\\/g, "/");

let failures = 0;
const ok = (l: string, d: string) => console.log(`  PASS  ${l}: ${d}`);
const bad = (l: string, d: string) => {
  console.log(`  FAIL  ${l}: ${d}`);
  failures++;
};
const check = (l: string, cond: boolean, d: string) => (cond ? ok(l, d) : bad(l, d));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── prod, read-only ─────────────────────────────────────────────────────────
const prodUrl = process.env.TURSO_DATABASE_URL ?? "";
if (!prodUrl.startsWith("libsql://")) throw new Error("seed needs the prod TURSO_DATABASE_URL in .env");
const prod = createClient({ url: prodUrl, authToken: process.env.TURSO_AUTH_TOKEN });
function prodRead(sql: string, args?: InArgs): Promise<ResultSet> {
  const kw = sql.trim().split(/\s+/)[0]!.toUpperCase();
  if (kw !== "SELECT" && kw !== "WITH") throw new Error(`prod is read-only here; refused ${kw}`);
  return prod.execute({ sql, args: args ?? [] });
}
async function prodFingerprint(): Promise<string> {
  const a = await prodRead(`SELECT id, started_at, status FROM cron_runs WHERE route = ? ORDER BY started_at DESC LIMIT 1`, [ROUTE]);
  const b = await prodRead(`SELECT COUNT(*) n, MAX(updated_at) mx FROM race_ratings`);
  const c = await prodRead(`SELECT COUNT(*) n FROM rating_history`);
  return JSON.stringify({ lastRun: a.rows[0], ratings: b.rows[0], history: c.rows[0] });
}

const DDL = [
  `CREATE TABLE races (
    id TEXT PRIMARY KEY, cycle INTEGER NOT NULL, chamber TEXT NOT NULL,
    state TEXT NOT NULL, district INTEGER, rating TEXT, rating_source TEXT,
    rating_updated_at TEXT, incumbent_bioguide_id TEXT, source_url TEXT,
    last_verified TEXT NOT NULL)`,
  `CREATE TABLE race_ratings (
    id TEXT PRIMARY KEY, race_id TEXT NOT NULL, source TEXT NOT NULL,
    rating TEXT NOT NULL, rating_score INTEGER NOT NULL, rating_date TEXT,
    source_url TEXT, cycle INTEGER NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE rating_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, race_id TEXT NOT NULL,
    source TEXT NOT NULL, rating_score INTEGER NOT NULL, rating TEXT NOT NULL,
    rating_date TEXT, observed_at TEXT NOT NULL,
    UNIQUE(race_id, source, observed_at))`,
  // scripts/migrate.ts, verbatim shape.
  `CREATE TABLE cron_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT, route TEXT NOT NULL,
    started_at TEXT NOT NULL, ended_at TEXT, elapsed_ms INTEGER,
    status TEXT NOT NULL, payload TEXT, error_message TEXT)`,
  // /api/health reads MAX(ticked_at) for the markets routes; nothing else here.
  `CREATE TABLE market_ticks (ticked_at TEXT)`,
];

async function seed(): Promise<void> {
  if (existsSync(FILE)) rmSync(FILE);
  const races = await prodRead("SELECT * FROM races");
  const ratings = await prodRead("SELECT * FROM race_ratings");
  const history = await prodRead("SELECT * FROM rating_history");
  // Two weeks of every route is enough for health to evaluate each without
  // throwing; only this route's entry is read.
  const runs = await prodRead("SELECT * FROM cron_runs WHERE started_at >= '2026-09-09'");
  const ticks = await prodRead("SELECT MAX(ticked_at) AS t FROM market_ticks");
  const local = createClient({ url: `file:${FILE}` });
  for (const d of DDL) await local.execute(d);
  const ins = (t: string, rows: ResultSet["rows"], cols: string[]) =>
    rows.map((r) => ({
      sql: `INSERT INTO ${t} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`,
      args: cols.map((c) => (r as unknown as Record<string, never>)[c] ?? null),
    }));
  await local.batch(ins("races", races.rows, ["id", "cycle", "chamber", "state", "district", "rating", "rating_source", "rating_updated_at", "incumbent_bioguide_id", "source_url", "last_verified"]), "write");
  await local.batch(ins("race_ratings", ratings.rows, ["id", "race_id", "source", "rating", "rating_score", "rating_date", "source_url", "cycle", "updated_at"]), "write");
  await local.batch(ins("rating_history", history.rows, ["race_id", "source", "rating_score", "rating", "rating_date", "observed_at"]), "write");
  await local.batch(ins("cron_runs", runs.rows, ["id", "route", "started_at", "ended_at", "elapsed_ms", "status", "payload", "error_message"]), "write");
  await local.execute({ sql: "INSERT INTO market_ticks (ticked_at) VALUES (?)", args: [ticks.rows[0]?.t ?? null] });
  // The transport discriminator: a row prod does not have.
  await local.execute({
    sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload)
          VALUES (?, ?, ?, 744, 'success', '{"sentinel":"HO 744 legs, file copy only"}')`,
    args: [ROUTE, SENTINEL_STARTED_AT, SENTINEL_STARTED_AT],
  });
  await local.execute({
    sql: "UPDATE race_ratings SET rating = ?, rating_score = 0, updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
    args: [PERTURBED_LABEL, PERTURBED_ID],
  });
  const chk = await local.execute({ sql: "SELECT rating FROM race_ratings WHERE id = ?", args: [PERTURBED_ID] });
  if (chk.rows[0]?.rating !== PERTURBED_LABEL) throw new Error(`perturbation did not land on ${PERTURBED_ID}`);
  console.log(
    `  seeded ${FILE}\n    ${races.rows.length} races · ${ratings.rows.length} ratings · ${history.rows.length} history · ` +
      `${runs.rows.length} cron_runs (prod read-only) · sentinel ${SENTINEL_STARTED_AT} · ${PERTURBED_ID} -> ${PERTURBED_LABEL}`,
  );
  local.close();
}

async function health(): Promise<Record<string, unknown> | undefined> {
  const res = await fetch(`http://127.0.0.1:${PORT}/api/health`);
  const body = (await res.json()) as { routes?: Record<string, unknown>[] };
  return body.routes?.find((r) => r.path === ROUTE);
}

function listeningPids(): number[] {
  const out = execFileSync(
    "powershell",
    ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`],
    { encoding: "utf8" },
  );
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
function parentOf(pid: number): number | null {
  const out = execFileSync(
    "powershell",
    ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").ParentProcessId`],
    { encoding: "utf8" },
  ).trim();
  return out ? Number(out) : null;
}
function isDescendant(pid: number, root: number): boolean {
  for (let p: number | null = pid, hops = 0; p && hops < 6; p = parentOf(p), hops++) if (p === root) return true;
  return false;
}

async function main() {
  console.log(`=== LEG ${LEG}: ${CFG.hang} widget hangs, expecting \`${CFG.expect}\` ===`);
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  const prodBefore = await prodFingerprint();
  await seed();

  // The host that accepts and never answers.
  const sockets: Socket[] = [];
  // The peer resets these when its fetch aborts or the server dies; that reset
  // is the expected end of a hung connection, not a failure of this run.
  const hang = createServer((s) => {
    s.on("error", () => {});
    sockets.push(s);
  });
  await new Promise<void>((r) => hang.listen(0, "127.0.0.1", () => r()));
  const hangPort = (hang.address() as { port: number }).port;

  const secret = randomBytes(24).toString("hex"); // local only, never printed
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TURSO_DATABASE_URL: `file:${FILE}`,
    CRON_SECRET: secret,
    NODE_OPTIONS: `--require ${SHIM}`,
    HANG_744_TARGET: CFG.hang,
    HANG_744_PORT: String(hangPort),
  };
  delete env.TURSO_AUTH_TOKEN;
  const log = createWriteStream(LOG);
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverOut = "";
  const tee = (b: Buffer) => {
    serverOut += b.toString();
    log.write(b);
  };
  server.stdout.on("data", tee);
  server.stderr.on("data", tee);
  const kill = () => {
    try {
      execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" });
    } catch {
      /* already gone */
    }
  };

  try {
    let up = false;
    for (let i = 0; i < 120 && !up; i++) {
      await sleep(500);
      try {
        up = (await fetch(`http://127.0.0.1:${PORT}/api/health`)).status > 0;
      } catch {
        /* not yet */
      }
    }
    if (!up) throw new Error("server never answered /api/health");

    const pids = listeningPids();
    const mine = pids.length > 0 && pids.every((p) => p === server.pid || isDescendant(p, server.pid!));
    console.log(`  bind: :${PORT} LISTEN owned by ${pids.join(",")} · spawned ${server.pid} · ${mine ? "OURS" : "FOREIGN"}`);
    if (!mine) throw new Error("the port is not bound by the server this run spawned; nothing triggered");

    const sentinel = await health();
    if (sentinel?.lastRunAt !== SENTINEL_STARTED_AT) {
      throw new Error(`transport check failed: health lastRunAt ${String(sentinel?.lastRunAt)} is not the file-copy sentinel; nothing triggered`);
    }
    ok("transport", `health on :${PORT} reads the file copy (sentinel ${SENTINEL_STARTED_AT})`);

    const t0 = Date.now();
    const t0Iso = new Date(t0).toISOString();
    const res = await fetch(`http://127.0.0.1:${PORT}${ROUTE}`, { headers: { authorization: `Bearer ${secret}` } });
    const body = await res.text();
    const wallMs = Date.now() - t0;
    console.log(`  route: HTTP ${res.status} after ${wallMs} ms · ${body.slice(0, 400)}`);
    const h = await health();
    console.log(`  health: ${JSON.stringify(h)}`);
    if (CFG.expect === "timeout") {
      // The platform would kill the function at maxDuration; nothing after
      // that point can be counted as having happened.
      const wait = t0 + PLATFORM_KILL_MS - Date.now();
      if (wait > 0) await sleep(wait);
      console.log(`  killed the server at +${Date.now() - t0} ms (maxDuration stand-in)`);
    }
    kill();
    await sleep(800); // HO 724: the file handle releases after the process dies
    hang.close();
    for (const s of sockets) s.destroy();

    const db: Client = createClient({ url: `file:${FILE}` });
    const run = (await db.execute({
      sql: `SELECT id, started_at, status, elapsed_ms, error_message FROM cron_runs
            WHERE route = ? ORDER BY started_at DESC LIMIT 1`,
      args: [ROUTE],
    })).rows[0]!;
    const pert = (await db.execute({ sql: "SELECT rating, updated_at FROM race_ratings WHERE id = ?", args: [PERTURBED_ID] })).rows[0]!;
    const sen = (await db.execute({
      sql: `SELECT COUNT(*) n, SUM(CASE WHEN updated_at >= ? THEN 1 ELSE 0 END) touched FROM race_ratings WHERE race_id LIKE 'S-%'`,
      args: [t0Iso],
    })).rows[0]!;
    const senHist = (await db.execute({
      sql: `SELECT COUNT(*) n FROM rating_history WHERE race_id LIKE 'S-%' AND observed_at >= ?`,
      args: [t0Iso.slice(0, 10)],
    })).rows[0]!;
    db.close();
    const msg = String(run.error_message ?? "");
    const elapsed = Number(run.elapsed_ms);
    const houseWrote = pert.rating !== PERTURBED_LABEL && String(pert.updated_at) >= t0Iso;
    const senateWrote = Number(sen.touched) > 0 || Number(sen.n) !== 105 || Number(senHist.n) > 0;
    console.log(
      `  cron_runs #${run.id}: ${run.status} · ${elapsed} ms · ${msg.slice(0, 600)}\n` +
        `  ${PERTURBED_ID}: ${pert.rating} @ ${pert.updated_at} · Senate rows ${sen.n} (touched ${sen.touched}) · Senate history today ${senHist.n}\n` +
        `  hung host: ${sockets.length} connection(s) accepted, 0 answered`,
    );
    const shim = serverOut.split(/\r?\n/).filter((l) => l.includes("[hang-744]") || / leg FAILED/.test(l));
    for (const l of shim) console.log(`  server| ${l.trim()}`);

    check("the hung host was actually reached", sockets.length >= 1, `${sockets.length} connection(s)`);
    check(`recorded \`${CFG.expect}\``, run.status === CFG.expect, String(run.status));
    if (CFG.expect === "error") {
      const failing = CFG.hang;
      const surviving = failing === "senate" ? "house" : "senate";
      check(`the error names ${failing}`, msg.includes(`${failing}: `), msg.slice(0, 160));
      check("…as the per-fetch cap", msg.includes(`no answer within the ${FETCH_CAP_MS}ms per-fetch budget`), "fetchError text");
      check(`…and carries ${surviving} OK`, msg.includes(`${surviving} OK`), "surviving leg's counts in the message");
      check("elapsed near the cap", elapsed >= FETCH_CAP_MS && elapsed < FETCH_CAP_MS + 10_000, `${elapsed} ms (cap ${FETCH_CAP_MS})`);
      check("health reads the route UNHEALTHY", h?.healthy === false && h?.lastStatus === "error", `healthy=${h?.healthy} lastStatus=${h?.lastStatus}`);
      if (failing === "senate") {
        check("HOUSE WRITES LANDED", houseWrote, `${PERTURBED_ID} ${PERTURBED_LABEL} -> ${pert.rating}`);
        check("Senate untouched", !senateWrote, `rows ${sen.n}, touched ${sen.touched}, history ${senHist.n}`);
      } else {
        check("SENATE WRITES LANDED", senateWrote, `rows 105 -> ${sen.n}, touched ${sen.touched}, history ${senHist.n}`);
        check("House untouched", !houseWrote, `${PERTURBED_ID} still ${pert.rating}`);
      }
    } else {
      check("HTTP 504 from the soft timeout", res.status === 504, `HTTP ${res.status}`);
      check("elapsed near 55s", elapsed >= SOFT_TIMEOUT_MS - 1_000 && elapsed < SOFT_TIMEOUT_MS + 2_000, `${elapsed} ms`);
      check("health reads the route HEALTHY", h?.healthy === true && h?.lastStatus === "timeout", `healthy=${h?.healthy} lastStatus=${h?.lastStatus}`);
      check("House did NOT write", !houseWrote, `${PERTURBED_ID} still ${pert.rating}`);
      check("Senate did NOT write", !senateWrote, `rows ${sen.n}, touched ${sen.touched}, history ${senHist.n}`);
    }
  } finally {
    kill();
    hang.close();
    for (const s of sockets) s.destroy();
    log.end();
  }

  const prodAfter = await prodFingerprint();
  check("prod untouched", prodAfter === prodBefore, prodAfter);
  prod.close();
  console.log(`  server log: ${LOG}`);
  console.log(`\n${failures === 0 ? `LEG ${LEG}: ALL ASSERTIONS HELD` : `LEG ${LEG}: ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
