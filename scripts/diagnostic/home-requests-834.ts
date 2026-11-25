// HO 834 § 1.A — what one load of `/` asks the store: cold, cached, after the
// news tick's flush, and N loads at once after a second flush. The same for
// `/?stage=floor`.
//
// It drives a production build (`next start`) whose store requests are counted
// and guarded by home-requests-834-preload.cjs (passed as NODE_OPTIONS=--require).
// The server reads PROD'S STORE, so:
//   - every store request passes the preload's read-only guard (HO 824's rules)
//     or is refused before it is sent; the guard's log is read after every
//     step, and a refusal stops this script in that step;
//   - the base URL must be localhost: anything else is refused;
//   - the only POST is the local server's own /api/revalidate (CRON_SECRET by
//     name, never printed), which expires a tag in that server's cache and
//     forwards nowhere. No cron and no /api/sync is ever called.
//
//   set -a; . ./.env; set +a      # the store's URL and token, CRON_SECRET, AUTH_SECRET
//   npx tsx scripts/diagnostic/home-requests-834.ts --app <dir with a built .next> \
//     --out <dir> [--port 3934] [--herd 4]
//
// For each URL, on a fresh server whose data cache was emptied first
// (<app>/.next/cache/fetch-cache, named in the output):
//   cold      one load
//   cached    the same URL again, at once
//   tick      POST /api/revalidate for news-breaking, race-news, member-news
//             (the news cron's three tags), then one load
//   herd      the same three flushes again, then N loads at once
//   prefetch  (`/` only; an addition the handoff didn't name) the flushes again,
//             then one RSC prefetch request (headers RSC: 1, Next-Router-Prefetch: 1),
//             then one load
// and, on `/` only, a second addition: after `cached`, `/?stage=floor` once on the
// cache `/` just filled (stage-after-home).
// Each store request is keyed to its page request. That's exact for one load at a
// time. Under the herd the store client queues requests and drains them from
// whichever page request started the queue, so the herd's split by page request
// is approximate and only its total is read. Statements are grouped by their
// first 100 characters.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const opt = (k: string, d?: string) => {
  const i = argv.indexOf(`--${k}`);
  return i >= 0 ? argv[i + 1] : d;
};
const APP = path.resolve(opt("app") ?? "");
const OUT = path.resolve(opt("out") ?? "");
const PORT = Number(opt("port", "3934"));
const HERD = Number(opt("herd", "4"));
if (!opt("app") || !opt("out")) throw new Error("usage: --app <dir> --out <dir> [--port] [--herd]");
if (!existsSync(path.join(APP, ".next", "BUILD_ID"))) throw new Error(`no production build in ${APP}/.next`);
for (const k of ["TURSO_DATABASE_URL", "CRON_SECRET"]) if (!process.env[k]) throw new Error(`${k} is not set (source .env)`);
mkdirSync(OUT, { recursive: true });

const BASE = `http://localhost:${PORT}`;
const host = new URL(BASE).hostname;
if (host !== "localhost" && host !== "127.0.0.1") throw new Error(`refused: base URL ${BASE} isn't localhost`);
const PRELOAD = path.resolve("scripts/diagnostic/home-requests-834-preload.cjs");
const TAGS = ["news-breaking", "race-news", "member-news"];
const CACHE_DIR = path.join(APP, ".next", "cache", "fetch-cache");
const mst = (ms: number) => new Date(ms - 7 * 3_600_000).toISOString().replace("T", " ").replace("Z", "") + " MST";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const report: string[] = [];
const say = (s = "") => {
  report.push(s);
  console.log(s);
};

function countFiles(dir: string): number {
  if (!existsSync(dir)) return 0;
  let n = 0;
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    n += statSync(p).isDirectory() ? countFiles(p) : 1;
  }
  return n;
}

async function start(label: string): Promise<{ child: ChildProcess; log: string }> {
  const before = countFiles(CACHE_DIR);
  rmSync(CACHE_DIR, { recursive: true, force: true });
  say(`[${label}] emptied ${path.relative(process.cwd(), CACHE_DIR) || CACHE_DIR} (${before} files before; ${countFiles(CACHE_DIR)} after)`);
  const log = path.join(OUT, `home-requests-834-${label}.jsonl`);
  rmSync(log, { force: true });
  const child = spawn(process.execPath, [path.join(APP, "node_modules", "next", "dist", "bin", "next"), "start", "-p", String(PORT)], {
    cwd: APP,
    env: { ...process.env, NODE_OPTIONS: `--require ${PRELOAD}`, HOME_PROBE_LOG: log, NODE_ENV: "production" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const serverLog = path.join(OUT, `server-834-${label}.log`);
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

type Load = { step: string; url: string; status: number; ms: number; t0: number; bytes: number; kind: "doc" | "prefetch" };
async function load(step: string, url: string, kind: "doc" | "prefetch" = "doc"): Promise<Load> {
  const t0 = Date.now();
  const headers: Record<string, string> = { Cookie: "ct_seen=1" };
  if (kind === "prefetch") Object.assign(headers, { RSC: "1", "Next-Router-Prefetch": "1" });
  // A document load doesn't follow redirects, so the gate's 307 to /welcome would
  // show. A prefetch does: Next 16 answers an RSC request without its `_rsc`
  // parameter with a 307 to the same path carrying it, and the router follows it.
  const r = await fetch(`${BASE}${url}`, { headers, redirect: kind === "prefetch" ? "follow" : "manual" });
  const body = await r.text();
  return { step, url: kind === "prefetch" ? `${url} → ${new URL(r.url).pathname}${new URL(r.url).search}` : url, status: r.status, ms: Date.now() - t0, t0, bytes: body.length, kind };
}
async function flush(step: string) {
  for (const tag of TAGS) {
    const r = await fetch(`${BASE}/api/revalidate?tag=${encodeURIComponent(tag)}`, { method: "POST", headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } });
    const j = await r.text();
    if (r.status !== 200) throw new Error(`[${step}] /api/revalidate ${tag} answered ${r.status}: ${j.slice(0, 100)}`);
  }
}
const SETTLE_MS = 4000;

type Line = { kind: string; t: string; req: string; n?: number; stmts?: string[]; ms?: number; status?: number; refused?: string[]; passed?: number };
function readLog(log: string): Line[] {
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Line);
}

const results: Record<string, unknown>[] = [];
async function runUrl(label: string, url: string) {
  const { child, log } = await start(label);
  const loads: Load[] = [];
  const steps: { step: string; from: number; to: number }[] = [];
  const mark = async (step: string, fn: () => Promise<void>) => {
    const from = Date.now();
    await fn();
    await sleep(SETTLE_MS);
    steps.push({ step, from, to: Date.now() });
    // A refusal stops the probe in the step it happened in: the log is read after
    // every step, and the `finally` below stops the server.
    const refusedNow = readLog(log).filter((l) => l.kind === "refused");
    if (refusedNow.length) {
      say(`[${label}] REFUSED ${refusedNow.length} by the end of ${step}: ${JSON.stringify(refusedNow.map((r) => r.refused))}`);
      throw new Error("the guard refused a store request: the probe stops");
    }
  };
  try {
    await mark("cold", async () => { loads.push(await load("cold", url)); });
    await mark("cached", async () => { loads.push(await load("cached", url)); });
    if (url === "/") {
      // An addition the handoff didn't name: `/?stage=floor` once, on the cache `/`
      // just filled, which is what each of the crawl's stage loads met.
      await mark("stage-after-home", async () => { loads.push(await load("stage-after-home", "/?stage=floor")); });
    }
    await mark("tick", async () => { await flush("tick"); loads.push(await load("tick", url)); });
    await mark("herd", async () => {
      await flush("herd");
      const all = await Promise.all(Array.from({ length: HERD }, () => load("herd", url)));
      loads.push(...all);
    });
    if (url === "/") {
      await mark("prefetch", async () => {
        await flush("prefetch");
        loads.push(await load("prefetch", url, "prefetch"));
        loads.push(await load("prefetch-then-doc", url));
      });
    }
  } finally {
    await stop(child);
  }
  const lines = readLog(log);
  const refusals = lines.filter((l) => l.kind === "refused");
  if (refusals.length) {
    say(`[${label}] REFUSED ${refusals.length}: ${JSON.stringify(refusals.map((r) => r.refused))}`);
    throw new Error("the guard refused a store request: the probe stops");
  }
  const store = lines.filter((l) => l.kind === "store" || l.kind === "store-error");
  // A page request's id is `<seq> <METHOD> <url>`. Map each load to its id by order
  // within the URL and method; the herd's loads share a URL, so take them by id.
  const reqIds = [...new Set(store.map((l) => l.req))];
  say(`\n## ${label}: ${url}`);
  say(`page requests that reached the store: ${reqIds.length}; store requests in all: ${store.length}; statements: ${store.reduce((a, l) => a + (l.n ?? 0), 0)}`);
  for (const s of steps) {
    const inStep = store.filter((l) => {
      const t = Date.parse(l.t);
      return t >= s.from && t < s.to;
    });
    const stepLoads = loads.filter((l) => l.t0 >= s.from && l.t0 < s.to);
    const byReq = new Map<string, Line[]>();
    for (const l of inStep) byReq.set(l.req, [...(byReq.get(l.req) ?? []), l]);
    const groups = new Map<string, number>();
    for (const l of inStep) for (const q of l.stmts ?? []) groups.set(q, (groups.get(q) ?? 0) + 1);
    const stmts = inStep.reduce((a, l) => a + (l.n ?? 0), 0);
    say(`\n### ${s.step} (${mst(s.from)} to ${mst(s.to)})`);
    say(`loads: ${stepLoads.map((l) => `${l.kind} ${l.status} ${l.ms} ms ${l.bytes} B`).join(" · ")}`);
    say(`store requests: ${inStep.length}; statements: ${stmts}; by page request: ${[...byReq.entries()].map(([k, v]) => `${k} → ${v.length} req / ${v.reduce((a, l) => a + (l.n ?? 0), 0)} stmts`).join("; ") || "none"}`);
    say(`store request duration: max ${Math.max(0, ...inStep.map((l) => l.ms ?? 0))} ms, sum ${inStep.reduce((a, l) => a + (l.ms ?? 0), 0)} ms`);
    say(`statements grouped by their first 100 characters (${groups.size} shapes):`);
    for (const [q, n] of [...groups.entries()].sort((a, b) => b[1] - a[1])) say(`  ${String(n).padStart(4)} × ${q}`);
    results.push({ label, url, step: s.step, from: s.from, to: s.to, loads: stepLoads, storeRequests: inStep.length, statements: stmts, byReq: Object.fromEntries([...byReq.entries()].map(([k, v]) => [k, { requests: v.length, statements: v.reduce((a, l) => a + (l.n ?? 0), 0) }])), groups: Object.fromEntries(groups) });
  }
  const last = store.at(-1);
  say(`\nguard (from the preload's running tally): ${last?.passed ?? 0} statements passed, all reads; refused 0`);
}

say(`HO 834 § 1.A · app ${APP} · base ${BASE} · herd N=${HERD} · started ${mst(Date.now())}`);
await runUrl("home", "/");
await runUrl("floor", "/?stage=floor");
writeFileSync(path.join(OUT, "home-requests-834.json"), JSON.stringify(results, null, 2));
writeFileSync(path.join(OUT, "home-requests-834.txt"), report.join("\n") + "\n");
say(`done ${mst(Date.now())}`);
process.exit(0);
