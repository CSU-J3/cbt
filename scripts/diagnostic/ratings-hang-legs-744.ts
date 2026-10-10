// HO 744 — the hang legs, re-aimed by HO 770 at the run's one fetch, Sabato's rating-changes page.
// The ratings route, over HTTP, on a LOCAL PRODUCTION BUILD (`next build` then `next start`)
// pointed at a `file:` copy of prod, with the page fetch sent somewhere else by
// ratings-hang-shim-744.cjs. Everything under test is the shipped path end to end: the route,
// wrapCronRoute and its 55s soft timeout, the sync's allSettled, the run's shared page fetch,
// fetchSource's per-fetch cap, the per-chamber parse, the `cron_runs` row, and /api/health's
// reading of it. The only substitutions are the database (a file) and one host.
//
//   npm run build && npx tsx scripts/diagnostic/ratings-hang-legs-744.ts --leg c1
//
//   leg c1  the PAGE hangs           -> both legs fail inside the cap: `error` naming house and
//                                       senate, health reads the route unhealthy, elapsed near
//                                       8s, the hung host reached once (the legs share the fetch)
//   leg c2  the page arrives with    -> the House writes land, `error` naming senate, health red
//           the Senate heading gone     (each chamber parses on its own)
//   leg c3  CONTROL — c1's hang with -> `timeout` near 55s, health reads it healthy, neither
//           the cap removed             chamber wrote: the failure the cap exists to prevent.
//                                       The shim drops fetchSource's signal, which is the cap.
// (HO 744's legs were a/b, one chamber's Ballotpedia widget hanging, and c, the same on a draft
// without the cap. That transport is gone, and with it the per-chamber fetch they hung.)
//
// WHY A PERTURBATION. A chamber whose store is current writes nothing, and "House writes land"
// would read the same whether the leg ran or not (the blind instrument this project keeps
// catching). One `sabato` row per chamber is set back to an EARLIER label in its own chain of
// changes before the run, so that leg wrote if and only if that row went back to its newest
// label. An earlier label, not a planted one: a label the chain never reads is a conflict
// (lib/race-ratings-sync.ts), which the leg sets aside unwritten by design.
//
// SAFETY. Prod is only ever READ (seed and the untouched-check), through a SELECT/WITH guard. The
// server gets `TURSO_DATABASE_URL=file:…` and no token, and nothing is triggered until
// /api/health on that server returns a sentinel row that exists only in the file copy — the
// transport discriminator. One run per process and a fresh file per run (a libsql `file:` handle
// stays locked after close() on this box, HO 724). The server is killed by its own PID tree.
import { spawn, execFileSync } from "node:child_process";
import { createServer, type Socket } from "node:net";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type ResultSet } from "@libsql/client";

config({ path: ".env" });

const ROUTE = "/api/sync-race-ratings";
const PAGE_URL = "https://centerforpolitics.org/crystalball/2026-rating-changes/"; // SABATO_CHANGES_URL
const AGENT = "CBT-ratings-sync/1.0 (+https://github.com/CSU-J3/cbt)"; // USER_AGENT, lib/race-ratings-scrape.ts
const FETCH_CAP_MS = 8_000; // FETCH_TIMEOUT_MS, lib/race-ratings-scrape.ts
const SOFT_TIMEOUT_MS = 55_000; // DEFAULT_SOFT_TIMEOUT_MS, lib/cron-log.ts
const PLATFORM_KILL_MS = 60_000; // maxDuration, app/api/sync-race-ratings/route.ts
const SAVED_PAGE = path.resolve("docs/handoffs/770-artifacts/m4/centerforpolitics.org_crystalball_2026-rating-changes_.html");
// One `sabato` row per chamber, its stored (current) label, and an earlier label from its chain.
const PERTURB = {
  house: { id: "AL-02-2026-sabato", current: "Lean R", earlier: "Likely R", score: 2 },
  senate: { id: "S-GA-2026-sabato", current: "Likely D", earlier: "Lean D", score: -1 },
} as const;

type Leg = "c1" | "c2" | "c3";
const LEGS: Record<Leg, { mode: "hang" | "serve" | "hang-nocap"; expect: "error" | "timeout" }> = {
  c1: { mode: "hang", expect: "error" },
  c2: { mode: "serve", expect: "error" },
  c3: { mode: "hang-nocap", expect: "timeout" },
};
const argAt = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const LEG = (argAt("--leg") ?? "c1") as Leg;
if (!(LEG in LEGS)) throw new Error(`--leg must be c1|c2|c3, got ${LEG}`);
const CFG = LEGS[LEG];
const PORT = Number(argAt("--port") ?? 3744);
const STAMP = Date.now();
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const FILE = path.join(DIR, `legs-770-${LEG}-${STAMP}.db`);
const LOG = path.join(DIR, `legs-770-${LEG}-${STAMP}.server.log`);
const SERVED = path.join(DIR, `legs-770-${LEG}-${STAMP}.page.html`);
const SHIM = path.resolve("scripts/diagnostic/ratings-hang-shim-744.cjs").replace(/\\/g, "/");
// Later than every prod row, so it is the route's newest run on the copy.
const SENTINEL_STARTED_AT = new Date(STAMP - 60_000).toISOString();

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
  // Three weeks of every route is enough for health to evaluate each without
  // throwing; only this route's entry is read.
  const since = new Date(STAMP - 21 * 86_400_000).toISOString().slice(0, 10);
  const runs = await prodRead("SELECT * FROM cron_runs WHERE started_at >= ?", [since]);
  const ticks = await prodRead("SELECT MAX(ticked_at) AS t FROM market_ticks");
  const newest = String((await prodRead("SELECT MAX(started_at) AS t FROM cron_runs WHERE route = ?", [ROUTE])).rows[0]?.t ?? "");
  if (!(newest < SENTINEL_STARTED_AT)) throw new Error(`prod's newest ${ROUTE} run ${newest} is not before the sentinel ${SENTINEL_STARTED_AT}`);
  for (const c of ["house", "senate"] as const) {
    const p = PERTURB[c];
    const row = (await prodRead("SELECT rating FROM race_ratings WHERE id = ?", [p.id])).rows[0];
    if (row?.rating !== p.current) throw new Error(`${p.id} reads ${String(row?.rating)} on prod, not ${p.current}; the perturbation's premise moved`);
  }
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
          VALUES (?, ?, ?, 770, 'success', '{"sentinel":"HO 770 legs, file copy only"}')`,
    args: [ROUTE, SENTINEL_STARTED_AT, SENTINEL_STARTED_AT],
  });
  for (const c of ["house", "senate"] as const) {
    const p = PERTURB[c];
    await local.execute({
      sql: "UPDATE race_ratings SET rating = ?, rating_score = ?, updated_at = '2000-01-01T00:00:00.000Z' WHERE id = ?",
      args: [p.earlier, p.score, p.id],
    });
    const chk = await local.execute({ sql: "SELECT rating FROM race_ratings WHERE id = ?", args: [p.id] });
    if (chk.rows[0]?.rating !== p.earlier) throw new Error(`perturbation did not land on ${p.id}`);
  }
  console.log(
    `  seeded ${FILE}\n    ${races.rows.length} races · ${ratings.rows.length} ratings · ${history.rows.length} history · ` +
      `${runs.rows.length} cron_runs since ${since} (prod read-only) · sentinel ${SENTINEL_STARTED_AT} · ` +
      `${PERTURB.house.id} ${PERTURB.house.current} -> ${PERTURB.house.earlier} · ${PERTURB.senate.id} ${PERTURB.senate.current} -> ${PERTURB.senate.earlier}`,
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
  console.log(`=== LEG ${LEG}: the page fetch ${CFG.mode === "serve" ? "served with the Senate heading removed" : CFG.mode === "hang" ? "hangs" : "hangs with the cap removed"}, expecting \`${CFG.expect}\` · node ${process.version} ===`);
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  const prodBefore = await prodFingerprint();
  await seed();

  // c2's page: the saved one with the "Senate rating changes" heading removed, and nothing else.
  if (CFG.mode === "serve") {
    const html = readFileSync(SAVED_PAGE, "utf8");
    const h2 = [...html.matchAll(/<h2\b[^>]*>[\s\S]*?<\/h2>/gi)].filter((m) => /Senate rating changes/.test(m[0]));
    if (h2.length !== 1) throw new Error(`expected one Senate heading on the saved page, found ${h2.length}`);
    const at = h2[0]!.index ?? 0;
    writeFileSync(SERVED, html.slice(0, at) + html.slice(at + h2[0]![0].length));
    console.log(`  served page: ${SERVED} (the saved page less ${JSON.stringify(h2[0]![0].replace(/<[^>]+>/g, ""))})`);
  }

  // The host that accepts and never answers.
  const sockets: Socket[] = [];
  // What each connection carried: its arrival and its request line, read and never answered.
  const seen: string[] = [];
  // The peer resets these when its fetch aborts or the server dies; that reset
  // is the expected end of a hung connection, not a failure of this run.
  const hang = createServer((s) => {
    s.on("error", () => {});
    const i = sockets.push(s);
    const at = new Date().toISOString();
    seen[i - 1] = `#${i} ${at} (no bytes)`;
    s.once("data", (b: Buffer) => {
      seen[i - 1] = `#${i} ${at} ${JSON.stringify(b.toString("latin1").split("\r\n")[0])}`;
    });
  });
  await new Promise<void>((r) => hang.listen(0, "127.0.0.1", () => r()));
  const hangPort = (hang.address() as { port: number }).port;

  const secret = randomBytes(24).toString("hex"); // local only, never printed
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TURSO_DATABASE_URL: `file:${FILE}`,
    CRON_SECRET: secret,
    NODE_OPTIONS: `--require ${SHIM}`,
    HANG_770_MODE: CFG.mode,
    ...(CFG.mode === "serve" ? { HANG_770_FILE: SERVED } : { HANG_770_PORT: String(hangPort) }),
  };
  delete env.TURSO_AUTH_TOKEN;
  // Next's own fetch cache lives under .next/cache/fetch-cache; this route's fetch is
  // force-dynamic, and the cache is cleared anyway so no run can be answered from another's.
  rmSync(path.resolve(".next/cache/fetch-cache"), { recursive: true, force: true });
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
    console.log(`  route: HTTP ${res.status} after ${wallMs} ms · ${body.slice(0, 600)}`);
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
      sql: `SELECT id, started_at, status, elapsed_ms, error_message, payload FROM cron_runs
            WHERE route = ? ORDER BY started_at DESC LIMIT 1`,
      args: [ROUTE],
    })).rows[0]!;
    const wrote: Record<"house" | "senate", { label: string; at: string; touched: number; history: number }> = {
      house: { label: "", at: "", touched: 0, history: 0 },
      senate: { label: "", at: "", touched: 0, history: 0 },
    };
    for (const c of ["house", "senate"] as const) {
      const p = (await db.execute({ sql: "SELECT rating, updated_at FROM race_ratings WHERE id = ?", args: [PERTURB[c].id] })).rows[0]!;
      const like = c === "senate" ? "S-%" : "%";
      const notLike = c === "senate" ? "" : " AND race_id NOT LIKE 'S-%'";
      const t = (await db.execute({ sql: `SELECT COUNT(*) n FROM race_ratings WHERE race_id LIKE ?${notLike} AND updated_at >= ?`, args: [like, t0Iso] })).rows[0]!;
      const hh = (await db.execute({ sql: `SELECT COUNT(*) n FROM rating_history WHERE race_id LIKE ?${notLike} AND observed_at >= ?`, args: [like, t0Iso.slice(0, 10)] })).rows[0]!;
      wrote[c] = { label: String(p.rating), at: String(p.updated_at), touched: Number(t.n), history: Number(hh.n) };
    }
    db.close();
    const msg = String(run.error_message ?? "");
    const elapsed = Number(run.elapsed_ms);
    const legWrote = (c: "house" | "senate") => wrote[c].label === PERTURB[c].current && wrote[c].at >= t0Iso;
    const untouched = (c: "house" | "senate") => wrote[c].label === PERTURB[c].earlier && wrote[c].touched === 0 && wrote[c].history === 0;
    console.log(
      `  cron_runs #${run.id}: ${run.status} · ${elapsed} ms · ${msg.slice(0, 900)}\n` +
        (["house", "senate"] as const)
          .map((c) => `  ${c}: ${PERTURB[c].id} ${wrote[c].label} @ ${wrote[c].at} · rows touched ${wrote[c].touched} · history rows today ${wrote[c].history}`)
          .join("\n") +
        `\n  hung host: ${sockets.length} connection(s) accepted, 0 answered${seen.length ? ` · ${seen.join(" · ")}` : ""}`,
    );
    const shim = serverOut.split(/\r?\n/).filter((l) => l.includes("[hang-770]") || / leg FAILED/.test(l) || /CONFLICT|sabato \(/.test(l));
    for (const l of shim) console.log(`  server| ${l.trim()}`);
    const fetches = serverOut.split(/\r?\n/).filter((l) => l.includes("[hang-770] page fetch #"));

    check(`recorded \`${CFG.expect}\``, run.status === CFG.expect, String(run.status));
    check(
      "the run fetched the page once, with the shipped agent and Accept: text/html",
      fetches.length === 1 && fetches[0]!.includes(`User-Agent ${JSON.stringify(AGENT)}`) && fetches[0]!.includes(`Accept "text/html"`),
      fetches.map((l) => l.trim()).join(" | ") || "(no page fetch logged)",
    );
    // Requests, not sockets: the HTTP client dials an empty replacement connection when the abort
    // tears the first one down (it carries no bytes), so the count that means "one fetch" is the
    // request lines the host received.
    const requests = seen.filter((s) => s.includes('"GET /hang-770 HTTP/1.1"')).length;
    if (CFG.mode !== "serve") check("the hung host received the page request once: both legs waited on the one fetch", requests === 1, `${requests} request(s) over ${sockets.length} connection(s) · ${seen.join(" · ")}`);
    if (LEG === "c1") {
      const cap = `sabato did not read: fetch ${PAGE_URL} -> 0: no answer within the ${FETCH_CAP_MS}ms per-fetch budget`;
      check("the error names house and senate, each as the per-fetch cap", msg.includes(`house: ${cap}`) && msg.includes(`senate: ${cap}`), msg.slice(0, 200));
      check("…and says nothing was written", msg.includes("No chamber completed.") && (msg.match(/Nothing was written in this leg/g) ?? []).length === 2, "both legs' messages");
      check("elapsed near the cap", elapsed >= FETCH_CAP_MS && elapsed < FETCH_CAP_MS + 10_000, `${elapsed} ms (cap ${FETCH_CAP_MS})`);
      check("health reads the route UNHEALTHY", h?.healthy === false && h?.lastStatus === "error", `healthy=${h?.healthy} lastStatus=${h?.lastStatus}`);
      check("House untouched", untouched("house"), `${PERTURB.house.id} still ${wrote.house.label}`);
      check("Senate untouched", untouched("senate"), `${PERTURB.senate.id} still ${wrote.senate.label}`);
    } else if (LEG === "c2") {
      check(
        "the error names senate, as its own parse of the page",
        msg.includes("senate: sabato did not read: Sabato rating changes (senate): table 0's heading says no chamber and its header says senate"),
        msg.slice(0, 260),
      );
      check("…and carries house OK", msg.includes("house OK (upserted="), /house OK \([^)]*\)/.exec(msg)?.[0] ?? "(no house OK)");
      check("health reads the route UNHEALTHY", h?.healthy === false && h?.lastStatus === "error", `healthy=${h?.healthy} lastStatus=${h?.lastStatus}`);
      check("HOUSE WRITES LANDED", legWrote("house"), `${PERTURB.house.id} ${PERTURB.house.earlier} -> ${wrote.house.label} · ${wrote.house.touched} House rows touched · ${wrote.house.history} House history rows today`);
      check("Senate untouched", untouched("senate"), `${PERTURB.senate.id} still ${wrote.senate.label} · touched ${wrote.senate.touched} · history ${wrote.senate.history}`);
      console.log(`  elapsed ${elapsed} ms (no hang in this leg)`);
    } else {
      check("HTTP 504 from the soft timeout", res.status === 504, `HTTP ${res.status}`);
      check("elapsed near 55s", elapsed >= SOFT_TIMEOUT_MS - 1_000 && elapsed < SOFT_TIMEOUT_MS + 2_000, `${elapsed} ms`);
      check("health reads the route HEALTHY", h?.healthy === true && h?.lastStatus === "timeout", `healthy=${h?.healthy} lastStatus=${h?.lastStatus}`);
      check("House did NOT write", untouched("house"), `${PERTURB.house.id} still ${wrote.house.label}`);
      check("Senate did NOT write", untouched("senate"), `${PERTURB.senate.id} still ${wrote.senate.label}`);
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
