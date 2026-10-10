// HO 771 legs: the ratings sync reads daily (§ 1), and a refusal says what it looked like (§ 2).
//
//   npx tsx scripts/diagnostic/ratings-daily-771.ts
//
// § 1, the schedule:
//   the registry   vercel.json's schedule for /api/sync-race-ratings equals CRON_ROUTES's, both
//                  `0 11 * * *`, and the entry is 26h with no windowOnly. The red: 12f4228's pair,
//                  `0 11 * * 3` in both, agree with each other and fail the assertion that the
//                  schedule is daily.
//   the health     computeCronHealth on a `file:` copy built by the real scripts/migrate.ts, with
//                  cron_runs planted relative to now: a ratings `success` 25 hours old reads
//                  healthy. The red: one 27 hours old reads stale, where 12f4228's entry reads the
//                  same row healthy. The control: /api/cron/weekly-report keeps its 9-day window,
//                  so a success 8 days old reads healthy.
//   the guard      (added) isFreshMove on daily runs, the bound's new comment measured: a 1-day and
//                  a 7-day gap read fresh, a week of missed runs (an 8-day gap) reads fresh a second
//                  under the bound and not fresh a second over it, and a 9-day gap reads not fresh.
// § 2, the refusal's shape, fetchSource against servers on 127.0.0.1:
//   - a 403 shaped like Cloudflare's challenge (the body saved at 18:09Z on 10-10, and its three
//     headers): the thrown message carries the status, cf-mitigated, server, cf-ray, the size and
//     the <title>, and no request header. The red: 12f4228's fetchSource throws the status alone.
//     The same message reaches the leg's failure through scrapeChamber.
//   - a <title> carrying a planted token and a planted Bearer value comes out redacted;
//   - a 404 with none of the headers reads as before, plus its size;
//   - a 403 whose body never finishes throws at the cap with its status and headers, not status 0;
//   - the controls: a 200 whose body never finishes, and a host that never answers, still throw
//     status 0 at the cap.
//
// Read-only: no prod, and no fetch beyond 127.0.0.1. A tripwire on fetch fails the run if one
// tries, so nothing reaches centerforpolitics.org. The 12f4228 copies the reds run are written to
// the scratch folder at run time.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer, type IncomingHttpHeaders, type RequestListener } from "node:http";
import { createServer as createTcpServer, type Socket } from "node:net";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { CRON_ROUTES, type CronHealth } from "@/lib/cron-health";
import { isFreshMove, type GuardHorizons, type HistoryRunRow, type SyncRunRow } from "@/lib/move-freshness";
import { fetchSource, scrapeChamber, type ScrapeRun } from "@/lib/race-ratings-scrape";

const ROUTE = "/api/sync-race-ratings";
const BASE = "12f4228";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored, and outside tsc
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const CHALLENGE = path.resolve("docs/handoffs/770-artifacts/ff/origin-check-retry-page.html");
const AGENT = "CBT-ratings-sync/1.0 (+https://github.com/CSU-J3/cbt)"; // lib/race-ratings-scrape.ts USER_AGENT
const CAP_MS = 8_000; // FETCH_TIMEOUT_MS
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

let passes = 0;
let fails = 0;
const check = (label: string, ok: boolean, detail: string) => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
  if (ok) passes++;
  else fails++;
};
const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

// The tripwire: every fetch in this process goes through here, and only 127.0.0.1 is let through.
const realFetch = globalThis.fetch;
const refused: string[] = [];
globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (new URL(href).hostname !== "127.0.0.1") {
    refused.push(href);
    return Promise.reject(new Error(`tripwire: no fetch beyond 127.0.0.1 (${href})`));
  }
  return realFetch(input, init);
}) as typeof fetch;

// A file from 12f4228, written to the scratch folder for a red to import.
function fromBase(file: string, out: string, rewrite: (s: string) => string = (s) => s): string {
  const text = rewrite(execFileSync("git", ["show", `${BASE}:${file}`], { encoding: "utf8" }));
  const dest = path.join(DIR, out);
  writeFileSync(dest, text);
  return dest;
}

// ── § 1, the registry ───────────────────────────────────────────────────────
const isDaily = (expr: string) => {
  const f = expr.trim().split(/\s+/);
  return f.length === 5 && /^\d+$/.test(f[0]!) && /^\d+$/.test(f[1]!) && f[2] === "*" && f[3] === "*" && f[4] === "*";
};
const vercelSchedules = (json: string) =>
  (JSON.parse(json) as { crons: { path: string; schedule: string }[] }).crons.filter((c) => c.path === ROUTE).map((c) => c.schedule);
const registrySchedules = (ts: string) =>
  [...ts.matchAll(/\{\s*path:\s*"\/api\/sync-race-ratings",\s*schedule:\s*"([^"]+)"/g)].map((m) => m[1]!);

function registry() {
  console.log(`\n── § 1, the registry and the schedule`);
  const cron = vercelSchedules(readFileSync("vercel.json", "utf8"));
  const entry = CRON_ROUTES.find((r) => r.path === ROUTE);
  check(
    "vercel.json's schedule for the route equals CRON_ROUTES's, and both are daily",
    cron.length === 1 && entry?.schedule === cron[0] && isDaily(cron[0]!),
    `vercel.json ${JSON.stringify(cron)} · CRON_ROUTES ${JSON.stringify(entry?.schedule)} · daily ${cron.length === 1 && isDaily(cron[0]!)}`,
  );
  check(
    "the entry is 26h with no windowOnly, like the daily routes beside it",
    entry?.maxStaleMs === 26 * HOUR && !entry?.windowOnly && entry?.signal === undefined,
    `maxStaleMs ${entry ? entry.maxStaleMs / HOUR : "-"}h · windowOnly ${entry?.windowOnly ?? "absent"}`,
  );
  const oldCron = vercelSchedules(execFileSync("git", ["show", `${BASE}:vercel.json`], { encoding: "utf8" }));
  const oldEntry = registrySchedules(execFileSync("git", ["show", `${BASE}:lib/cron-health.ts`], { encoding: "utf8" }));
  check(
    `the red: ${BASE}'s pair agrees with itself and fails the assertion that the schedule is daily`,
    oldCron.length === 1 && oldEntry.length === 1 && oldCron[0] === oldEntry[0] && !isDaily(oldCron[0]!),
    `vercel.json ${JSON.stringify(oldCron)} · CRON_ROUTES ${JSON.stringify(oldEntry)} · daily ${oldCron.length === 1 && isDaily(oldCron[0]!)}`,
  );
}

// ── § 1, the health ─────────────────────────────────────────────────────────
async function health() {
  console.log(`\n── § 1, computeCronHealth on planted cron_runs`);
  const file = path.join(DIR, `legs-771-health-${Date.now()}.db`);
  const url = `file:${file}`;
  if (!url.startsWith("file:")) throw new Error("refused: the health leg gets file: only");
  const env = { ...process.env, TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "" };
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env, encoding: "utf8" });
  if (mig.status !== 0) throw new Error(`migrate against the copy failed: ${(mig.stderr || mig.stdout).slice(-600)}`);
  // getDb() is lazy and reads the env on its first call, which is below: this process's client is file: too.
  process.env.TURSO_DATABASE_URL = url;
  process.env.TURSO_AUTH_TOKEN = "";
  const { getDb } = await import("@/lib/db");
  const { computeCronHealth } = await import("@/lib/cron-health");
  const old = (await import(pathToFileURL(fromBase("lib/cron-health.ts", "cron-health-12f4228-771.ts")).href)) as {
    computeCronHealth: () => Promise<CronHealth>;
  };
  const db = getDb();
  const plant = async (rows: { route: string; agoMs: number }[]) => {
    const now = Date.now();
    await db.execute("DELETE FROM cron_runs");
    for (const r of rows) {
      const started = new Date(now - r.agoMs).toISOString();
      await db.execute({
        sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status) VALUES (?, ?, ?, 1000, 'success')`,
        args: [r.route, started, started],
      });
    }
  };
  const read = (h: CronHealth, p: string) => {
    const r = h.routes.find((x) => x.path === p);
    return { healthy: r?.healthy, line: r ? `${r.healthy ? "healthy" : "UNHEALTHY"} · age ${r.ageMs == null ? "-" : (r.ageMs / HOUR).toFixed(2) + "h"} · window ${r.maxStaleMs / HOUR}h${r.windowOnly ? " windowOnly" : ""}${r.note ? ` · ${r.note}` : ""}` : "absent" };
  };
  const weekly = { route: "/api/cron/weekly-report", agoMs: 8 * DAY };

  await plant([{ route: ROUTE, agoMs: 25 * HOUR }, weekly]);
  const a = await computeCronHealth();
  const a1 = read(a, ROUTE);
  const aw = read(a, weekly.route);
  check("a ratings success 25 hours old reads healthy", a1.healthy === true, a1.line);
  check("the control: weekly-report keeps its 9-day window, so a success 8 days old reads healthy", aw.healthy === true, aw.line);

  await plant([{ route: ROUTE, agoMs: 27 * HOUR }, weekly]);
  const b = await computeCronHealth();
  const b1 = read(b, ROUTE);
  const bOld = read(await old.computeCronHealth(), ROUTE);
  check("the red: a ratings success 27 hours old reads stale", b1.healthy === false && /no success\/timeout in 27\.0h \(> 26\.0h\)/.test(b1.line), b1.line);
  check(`…where ${BASE}'s entry reads that same row healthy`, bOld.healthy === true, bOld.line);
  check("…and weekly-report still reads healthy beside it", read(b, weekly.route).healthy === true, read(b, weekly.route).line);
  db.close();
}

// ── § 1, the guard on daily runs (added) ────────────────────────────────────
function guard() {
  console.log(`\n── § 1, the MOVED guard on daily runs (the bound's new comment, measured)`);
  const T = Date.parse("2026-11-02T00:00:00Z");
  const iso = (ms: number) => new Date(ms).toISOString();
  const leg = (ms: number): SyncRunRow => ({
    startedAt: iso(ms),
    status: "success",
    payload: JSON.stringify({ payload: { chambers: { house: { ok: true, stats: { scraped: 136, raters: { sabato: { ok: true, scraped: 136 } } } } } } }),
  });
  // History ticks every day at 15:00Z, and sync runs every day at 11:00:40Z up to the gap.
  const history: HistoryRunRow[] = [];
  for (let d = -30; d <= 0; d++) history.push({ startedAt: iso(T + d * DAY + 15 * HOUR), status: "success" });
  const daysBefore = (lastDay: number) => {
    const runs: SyncRunRow[] = [];
    for (let d = -30; d <= lastDay; d++) runs.push(leg(T + d * DAY + 11 * HOUR + 40_000));
    return runs;
  };
  const horizons: GuardHorizons = { sync: iso(T - 30 * DAY + 11 * HOUR + 40_000), history: iso(T - 30 * DAY + 15 * HOUR) };
  const cases: { label: string; runs: SyncRunRow[]; want: boolean }[] = [
    { label: "an ordinary day (a 1-day gap) reads fresh", runs: daysBefore(0), want: true },
    { label: "six missed runs (a 7-day gap) read fresh", runs: [...daysBefore(-7), leg(T + 11 * HOUR + 40_000)], want: true },
    { label: "a week of missed runs (an 8-day gap) a second under the bound reads fresh", runs: [...daysBefore(-8), leg(T + 11 * HOUR + 39_000)], want: true },
    { label: "the same week a second over the bound reads not fresh", runs: [...daysBefore(-8), leg(T + 11 * HOUR + 41_000)], want: false },
    { label: "eight missed runs (a 9-day gap) read not fresh", runs: [...daysBefore(-9), leg(T + 11 * HOUR + 40_000)], want: false },
  ];
  for (const c of cases) {
    const got = isFreshMove("2026-11-02", "house", c.runs, history, horizons, "sabato");
    const gap = (() => {
      const t = c.runs.map((r) => Date.parse(r.startedAt)).sort((x, y) => x - y);
      const s = t[t.length - 1]!;
      return s - t[t.length - 2]!;
    })();
    check(c.label, got === c.want, `S − S' = ${(gap / DAY).toFixed(5)} days · ${got ? "fresh" : "not fresh"}`);
  }
}

// ── § 2, the refusal's shape ────────────────────────────────────────────────
async function serve(handler: RequestListener) {
  const server = createHttpServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/crystalball/2026-rating-changes/`;
  return { url, close: () => { server.closeAllConnections(); server.close(); } };
}
const thrown = async (fn: () => Promise<unknown>) => {
  const t0 = Date.now();
  try {
    await fn();
    return { message: "(no throw)", ms: Date.now() - t0 };
  } catch (e) {
    return { message: messageOf(e), ms: Date.now() - t0 };
  }
};
const CF_HEADERS = { "cf-mitigated": "challenge", server: "cloudflare", "cf-ray": "a487939fd8215380-SEA" };

async function refusals() {
  console.log(`\n── § 2, what a refusal looked like`);
  const page = readFileSync(CHALLENGE);
  const oldPath = fromBase("lib/race-ratings-scrape.ts", "race-ratings-scrape-12f4228-771.ts", (s) =>
    s.replace(/from "\.\/states"/g, 'from "@/lib/states"').replace(/from "\.\/redact"/g, 'from "@/lib/redact"'),
  );
  if (/from "\.\//.test(readFileSync(oldPath, "utf8"))) throw new Error(`${oldPath} still has a relative import`);
  const old = (await import(pathToFileURL(oldPath).href)) as { fetchSource: typeof fetchSource };

  let seen: IncomingHttpHeaders | null = null;
  const challenge = await serve((req, res) => {
    seen = req.headers;
    res.writeHead(403, { "content-type": "text/html; charset=UTF-8", "content-length": page.byteLength, ...CF_HEADERS }).end(page);
  });
  const want = `fetch ${challenge.url} -> 403: cf-mitigated challenge, server cloudflare, cf-ray a487939fd8215380-SEA, ${page.byteLength.toLocaleString("en-US")} bytes, "Just a moment..."`;
  const now = await thrown(() => fetchSource(challenge.url, "text/html"));
  check("a 403 shaped like Cloudflare's challenge: the message carries every field", now.message === want, JSON.stringify(now.message));
  const h = seen as IncomingHttpHeaders | null;
  check(
    "…from a request that carried the shipped agent and Accept, neither of which is in the message",
    h?.["user-agent"] === AGENT && h?.accept === "text/html" && !now.message.includes(AGENT) && !now.message.includes("text/html"),
    `User-Agent ${JSON.stringify(h?.["user-agent"])} · Accept ${JSON.stringify(h?.accept)}`,
  );
  const was = await thrown(() => old.fetchSource(challenge.url, "text/html"));
  check(`the red: ${BASE}'s fetchSource throws the status alone`, was.message === `fetch ${challenge.url} -> 403`, JSON.stringify(was.message));
  const run: ScrapeRun = { get: (_url, accept) => fetchSource(challenge.url, accept) };
  const leg = await scrapeChamber("house", run);
  check(
    "the same message reaches the leg's failure through scrapeChamber",
    leg.reads.length === 0 && leg.failures.length === 1 && leg.failures[0]?.source === "sabato" && leg.failures[0]?.error === want,
    JSON.stringify(leg.failures),
  );
  challenge.close();

  const planted = await serve((_req, res) => {
    res.writeHead(403, { "content-type": "text/html" }).end("<html><head><title>Blocked /x?token=FAKEparam0123 Bearer FAKEbearer012345</title></head></html>");
  });
  const red = await thrown(() => fetchSource(planted.url, "text/html"));
  planted.close();
  check(
    "a <title> carrying a planted token and Bearer value comes out redacted",
    !red.message.includes("FAKEparam0123") && !red.message.includes("FAKEbearer012345") && red.message.includes("Bearer [REDACTED]"),
    JSON.stringify(red.message),
  );

  const plain = await serve((_req, res) => {
    res.writeHead(404, { "content-type": "text/plain" }).end("not here");
  });
  const p404 = await thrown(() => fetchSource(plain.url, "text/html"));
  plain.close();
  check("a 404 with none of the headers reads as before, plus its size", p404.message === `fetch ${plain.url} -> 404: 8 bytes`, JSON.stringify(p404.message));

  const stalled = await serve((_req, res) => {
    res.writeHead(403, { "content-type": "text/html", ...CF_HEADERS });
    res.write("<html><head><title>Just a mom"); // and never another byte
  });
  const s403 = await thrown(() => fetchSource(stalled.url, "text/html"));
  stalled.close();
  check(
    "a 403 whose body never finishes throws at the cap with its status and headers, not status 0",
    s403.message === `fetch ${stalled.url} -> 403: cf-mitigated challenge, server cloudflare, cf-ray a487939fd8215380-SEA, body not read within the ${CAP_MS}ms budget` &&
      s403.ms >= CAP_MS && s403.ms < CAP_MS + 1_500,
    `${s403.ms} ms · ${JSON.stringify(s403.message)}`,
  );

  const slow = await serve((_req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.write("<html>"); // a 200 whose body never finishes
  });
  const s200 = await thrown(() => fetchSource(slow.url, "text/html"));
  slow.close();
  check(
    "the control: a 200 whose body never finishes still throws status 0 at the cap",
    s200.message === `fetch ${slow.url} -> 0: no answer within the ${CAP_MS}ms per-fetch budget` && s200.ms >= CAP_MS && s200.ms < CAP_MS + 1_500,
    `${s200.ms} ms · ${JSON.stringify(s200.message)}`,
  );

  const sockets: Socket[] = [];
  const tcp = createTcpServer((s) => {
    s.on("error", () => {});
    sockets.push(s);
  });
  await new Promise<void>((r) => tcp.listen(0, "127.0.0.1", () => r()));
  const urlHang = `http://127.0.0.1:${(tcp.address() as AddressInfo).port}/hang`;
  const hang = await thrown(() => fetchSource(urlHang, "text/html"));
  tcp.close();
  for (const s of sockets) s.destroy();
  check(
    "the control: a host that never answers still throws status 0 at the cap",
    hang.message === `fetch ${urlHang} -> 0: no answer within the ${CAP_MS}ms per-fetch budget` && hang.ms >= CAP_MS && hang.ms < CAP_MS + 1_500,
    `${hang.ms} ms · ${JSON.stringify(hang.message)}`,
  );
}

async function main() {
  registry();
  await health();
  guard();
  await refusals();
  check("the tripwire: nothing was fetched beyond 127.0.0.1", refused.length === 0, refused.length ? refused.join(" · ") : "0 refused");
  console.log(`\n${passes} PASS · ${fails} FAIL`);
  process.exitCode = fails ? 1 : 0;
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 2;
});
