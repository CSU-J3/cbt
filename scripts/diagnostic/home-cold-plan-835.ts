// HO 835 § 1 — a read-only plan probe of a cold `/`, copied from HO 834's
// home-requests-834.ts (which stays as it was). It drives a production build
// (`next start`) whose store requests are guarded and logged by
// home-cold-plan-835-preload.cjs (NODE_OPTIONS=--require): HO 824's read rules on
// every statement, read-only batches only, executeMultiple refused, five controls at
// load. The server reads PROD'S STORE, so:
//   - a refusal stops the probe: the guard's log is read after every step;
//   - the base URL must be localhost: anything else is refused;
//   - nothing is POSTed: no cron, no /api/sync, no /api/revalidate.
//
//   set -a; . ./.env; set +a      # the store's URL and token (by name, never printed)
//   npx tsx scripts/diagnostic/home-cold-plan-835.ts --app <dir with a built .next> \
//     --out <dir> --mode cold [--urls /,/electoral,/welcome] [--port 3935]
//   npx tsx scripts/diagnostic/home-cold-plan-835.ts --app <dir> --out <dir> --mode stale
//
// cold (§ 1.A): for each URL, a fresh server on an emptied data cache
//   (<app>/.next/cache/fetch-cache, named in the output), one document load with
//   Cookie: ct_seen=1, then the server stops. Every store request is logged with its
//   full SQL and its start and end relative to the page request's start.
// stale (§ 1.B): warm `/` with one load on an emptied cache, wait for its writes, stop
//   the server and prove it stopped; set every entry's mtime 2 hours back (ageEntries,
//   below, per STEP 0 claim 9) and start a fresh server, so no in-memory cache
//   survives; one load (B.1), the same URL at once (B.2), and once more after B.1's
//   refreshes have rewritten their files (B.2b, an addition); stop; set every mtime 25
//   hours back, start, one load (B.3); stop.
// Each load records its time to first byte (fetch's headers) and its total time.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const APP = path.resolve(opt("app") ?? "");
const OUT = path.resolve(opt("out") ?? "");
const PORT = Number(opt("port", "3935"));
const MODE = opt("mode", "cold");
const URLS = (opt("urls", "/,/electoral,/welcome") ?? "").split(",").filter(Boolean);
if (!opt("app") || !opt("out")) throw new Error("usage: --app <dir> --out <dir> --mode cold|stale [--urls] [--port]");
if (!existsSync(path.join(APP, ".next", "BUILD_ID"))) throw new Error(`no production build in ${APP}/.next`);
if (!process.env.TURSO_DATABASE_URL) throw new Error("TURSO_DATABASE_URL is not set (source .env)");
mkdirSync(OUT, { recursive: true });

const BASE = `http://localhost:${PORT}`;
const host = new URL(BASE).hostname;
if (host !== "localhost" && host !== "127.0.0.1") throw new Error(`refused: base URL ${BASE} isn't localhost`);
const PRELOAD = path.resolve("scripts/diagnostic/home-cold-plan-835-preload.cjs");
const CACHE_DIR = path.join(APP, ".next", "cache", "fetch-cache");
const mst = (ms: number) => new Date(ms - 7 * 3_600_000).toISOString().replace("T", " ").replace("Z", "") + " MST";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const report: string[] = [];
const say = (s = "") => {
  report.push(s);
  console.log(s);
};

function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}
function emptyCache(label: string) {
  const before = listFiles(CACHE_DIR).length;
  rmSync(CACHE_DIR, { recursive: true, force: true });
  say(`[${label}] emptied ${path.relative(process.cwd(), CACHE_DIR) || CACHE_DIR} (${before} files before; ${listFiles(CACHE_DIR).length} after)`);
}

async function start(label: string): Promise<{ child: ChildProcess; log: string }> {
  const log = path.join(OUT, `cold-plan-835-${label}.jsonl`);
  rmSync(log, { force: true });
  const child = spawn(process.execPath, [path.join(APP, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], {
    cwd: APP,
    env: { ...process.env, NODE_OPTIONS: `--require ${PRELOAD}`, HOME_PROBE_LOG: log, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const serverLog = path.join(OUT, `server-835-${label}.log`);
  const chunks: string[] = [];
  child.stdout!.on("data", (d) => chunks.push(String(d)));
  child.stderr!.on("data", (d) => chunks.push(String(d)));
  child.on("exit", () => writeFileSync(serverLog, chunks.join("")));
  for (let i = 0; i < 120; i++) {
    try {
      const r = await fetch(`${BASE}/api/version`);
      if (r.ok) {
        say(`[${label}] server ready at ${mst(Date.now())} (pid ${child.pid})`);
        return { child, log };
      }
    } catch {
      /* not up yet */
    }
    await sleep(500);
  }
  child.kill();
  throw new Error("the server didn't come up");
}
async function stop(child: ChildProcess) {
  child.kill();
  for (let i = 0; i < 40 && child.exitCode === null && child.signalCode === null; i++) await sleep(250);
}

type Load = { step: string; url: string; status: number; ttfb: number; ms: number; t0: number; bytes: number };
async function load(step: string, url: string): Promise<Load> {
  const t0 = Date.now();
  const r = await fetch(`${BASE}${url}`, { headers: { Cookie: "ct_seen=1" }, redirect: "manual" });
  const ttfb = Date.now() - t0;
  const body = await r.text();
  return { step, url, status: r.status, ttfb, ms: Date.now() - t0, t0, bytes: body.length };
}
const SETTLE_MS = 6000;

type Line = { kind: string; t: string; req: string; rel0?: number | null; rel1?: number | null; n?: number; sql?: string[]; ms?: number; status?: number; refused?: string[]; passed?: number };
function readLog(log: string): Line[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Line);
}
function checkRefused(log: string, label: string, step: string) {
  const refusedNow = readLog(log).filter((l) => l.kind === "refused");
  if (refusedNow.length) {
    say(`[${label}] REFUSED ${refusedNow.length} by the end of ${step}: ${JSON.stringify(refusedNow.map((r) => r.refused))}`);
    throw new Error("the guard refused a store request: the probe stops");
  }
}

const results: Record<string, unknown>[] = [];
function summarize(label: string, step: string, log: string, from: number, to: number, loads: Load[]) {
  const store = readLog(log).filter((l) => (l.kind === "store" || l.kind === "store-error") && Date.parse(l.t) >= from && Date.parse(l.t) < to);
  const stmts = store.reduce((a, l) => a + (l.n ?? 0), 0);
  const byReq = new Map<string, Line[]>();
  for (const l of store) byReq.set(l.req, [...(byReq.get(l.req) ?? []), l]);
  say(`\n### ${label} · ${step} (${mst(from)} to ${mst(to)})`);
  say(`loads: ${loads.map((l) => `${l.url} ${l.status} ttfb ${l.ttfb} ms total ${l.ms} ms ${l.bytes} B`).join(" · ")}`);
  say(`store requests: ${store.length}; statements: ${stmts}; errors: ${store.filter((l) => l.kind === "store-error").length}`);
  say(`by page request: ${[...byReq.entries()].map(([k, v]) => `${k} → ${v.length} req / ${v.reduce((a, l) => a + (l.n ?? 0), 0)} stmts, last end ${Math.max(...v.map((x) => x.rel1 ?? 0))} ms`).join("; ") || "none"}`);
  say(`store request duration: max ${Math.max(0, ...store.map((l) => l.ms ?? 0))} ms, sum ${store.reduce((a, l) => a + (l.ms ?? 0), 0)} ms`);
  results.push({ label, step, from, to, loads, storeRequests: store.length, statements: stmts, store });
}

async function cold(url: string) {
  const label = `cold-${url === "/" ? "home" : url.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-")}`;
  emptyCache(label);
  const { child, log } = await start(label);
  const from = Date.now();
  let loads: Load[] = [];
  try {
    loads = [await load("cold", url)];
    await sleep(SETTLE_MS);
    checkRefused(log, label, "cold");
  } finally {
    await stop(child);
  }
  summarize(label, "cold", log, from, Date.now(), loads);
}

// ---- the stale mode (§ 1.B), per STEP 0 claim 9 (835-artifacts/step0-835-c9-10.md § 9.5) --
// next@16.3.4's file-system cache takes an entry's lastModified from its file's mtime
// (file-system-cache.js:109, :114); nothing inside the file holds a time. A stale entry
// is returned at once (unstable-cache.js:216-219); its refresh starts then, during the
// render (:188-204), the response doesn't wait for it, and waitUntil keeps it running
// past the response. A refresh rewrites its file in place with a fresh mtime. A process-wide
// LRU sits in front of the files and tag expiry lives in memory only, so each aged run
// starts a fresh server. Nothing here POSTs: a flush would turn aged entries into misses.
function mtimes(): number[] {
  return listFiles(CACHE_DIR).map((f) => statSync(f).mtimeMs);
}
// Wait until a listing returns the same count twice, a few seconds apart (the warm
// load's writes land after its response), or until the count of files rewritten after
// `since` stops moving (an aged run's refreshes rewrite files in place).
async function settle(label: string, since?: number) {
  let prev = -1;
  for (let i = 0; i < 20; i++) {
    const m = mtimes();
    const n = since === undefined ? m.length : m.filter((t) => t > since).length;
    if (n === prev) {
      say(`[${label}] settled: ${since === undefined ? `${n} files` : `${n} of ${m.length} files rewritten since ${mst(since)}`}`);
      return n;
    }
    prev = n;
    await sleep(3000);
  }
  say(`[${label}] did not settle in 60 s (last ${prev})`);
  return prev;
}
async function proveStopped(label: string) {
  let refused = false;
  try {
    await fetch(`${BASE}/api/version`);
  } catch {
    refused = true;
  }
  say(`[${label}] server stopped: ${refused ? "port refuses connections" : "PORT STILL ANSWERS"}`);
  if (!refused) throw new Error("the server is still up");
}
function ageEntries(hours: number, label: string): number {
  const t = new Date(Date.now() - hours * 3_600_000);
  const files = listFiles(CACHE_DIR);
  for (const f of files) utimesSync(f, t, t);
  const m = mtimes();
  say(`[${label}] aged ${files.length} files under ${path.relative(process.cwd(), CACHE_DIR)} to ${mst(t.getTime())} (${hours} h back; mtime and atime only, contents untouched); read back: min ${mst(Math.min(...m))}, max ${mst(Math.max(...m))}`);
  return t.getTime();
}
// The page request ids of this server's document loads of `url`, in order (the
// preload's `req` lines).
function reqIds(log: string, url: string): string[] {
  return readLog(log).filter((l) => l.kind === "req" && (l as unknown as { id: string }).id.endsWith(` GET ${url}`)).map((l) => (l as unknown as { id: string }).id);
}
function summarizeByReq(label: string, step: string, log: string, id: string | undefined, ld: Load) {
  if (!id) throw new Error(`[${label}] no page request line for ${step}: the probe stops`);
  const store = readLog(log).filter((l) => (l.kind === "store" || l.kind === "store-error") && l.req === id);
  const stmts = store.reduce((a, l) => a + (l.n ?? 0), 0);
  const afterResponse = store.filter((l) => Date.parse(l.t) >= ld.t0 + ld.ms).length;
  say(`\n### ${label} · ${step} (page request ${id})`);
  say(`load: ${ld.url} ${ld.status} ttfb ${ld.ttfb} ms total ${ld.ms} ms ${ld.bytes} B`);
  say(`store requests: ${store.length} (${afterResponse} started after the response ended); statements: ${stmts}; errors: ${store.filter((l) => l.kind === "store-error").length}`);
  say(`store request duration: max ${Math.max(0, ...store.map((l) => l.ms ?? 0))} ms, sum ${store.reduce((a, l) => a + (l.ms ?? 0), 0)} ms; last end ${Math.max(0, ...store.map((l) => l.rel1 ?? 0))} ms after the page request began`);
  results.push({ label, step, req: id, loads: [ld], storeRequests: store.length, afterResponse, statements: stmts, store });
}

async function stale() {
  const url = "/";
  emptyCache("stale-warm");
  {
    const { child, log } = await start("stale-warm");
    try {
      const ld = await load("warm", url);
      await settle("stale-warm");
      checkRefused(log, "stale-warm", "warm");
      summarizeByReq("stale-warm", "warm (cold cache)", log, reqIds(log, url)[0], ld);
    } finally {
      await stop(child);
    }
    await proveStopped("stale-warm");
  }
  let agedTo = ageEntries(2, "stale-2h");
  {
    const { child, log } = await start("stale-2h");
    try {
      const l1 = await load("B.1 aged 2 h", url);
      const l2 = await load("B.2 at once", url);
      await settle("stale-2h", agedTo);
      const l3 = await load("B.2b after the refreshes landed", url);
      await settle("stale-2h", agedTo);
      checkRefused(log, "stale-2h", "B.1-B.2b");
      const ids = reqIds(log, url);
      summarizeByReq("stale-2h", "B.1 aged 2 h", log, ids[0], l1);
      summarizeByReq("stale-2h", "B.2 the same URL at once", log, ids[1], l2);
      summarizeByReq("stale-2h", "B.2b after B.1's refreshes landed", log, ids[2], l3);
    } finally {
      await stop(child);
    }
    await proveStopped("stale-2h");
  }
  agedTo = ageEntries(25, "stale-25h");
  {
    const { child, log } = await start("stale-25h");
    try {
      const ld = await load("B.3 aged 25 h", url);
      await settle("stale-25h", agedTo);
      checkRefused(log, "stale-25h", "B.3");
      summarizeByReq("stale-25h", "B.3 aged 25 h", log, reqIds(log, url)[0], ld);
    } finally {
      await stop(child);
    }
    await proveStopped("stale-25h");
  }
}

say(`HO 835 § 1 · mode ${MODE} · app ${APP} · base ${BASE} · started ${mst(Date.now())}`);
if (MODE === "cold") for (const u of URLS) await cold(u);
else if (MODE === "stale") await stale();
else throw new Error(`unknown mode ${MODE}`);
const last = results.flatMap((r) => (r.store as Line[]) ?? []).at(-1);
say(`\nguard (the preload's running tally, last line of the last log): ${last?.passed ?? 0} statements passed, all reads; refused 0`);
writeFileSync(path.join(OUT, `cold-plan-835-${MODE}.json`), JSON.stringify(results, null, 2));
writeFileSync(path.join(OUT, `cold-plan-835-${MODE}.txt`), report.join("\n") + "\n");
say(`done ${mst(Date.now())}`);
process.exit(0);
