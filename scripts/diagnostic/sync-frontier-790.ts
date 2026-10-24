// HO 790: the sync's frontier and queue (§ 1), the summary reset keyed on substance (§ 2), and the paced pass over the
// bills held behind (§ 3).
//
//   npx tsx scripts/diagnostic/sync-frontier-790.ts --step0
//   npx tsx scripts/diagnostic/sync-frontier-790.ts --seed
//   npx tsx scripts/diagnostic/sync-frontier-790.ts --legs [--only A,F] [--art <dir>] [--label L]
//   npx tsx scripts/diagnostic/sync-frontier-790.ts --census [--label 790a]
//   npx tsx scripts/diagnostic/sync-frontier-790.ts --enqueue --census 790a
//   npx tsx scripts/diagnostic/sync-frontier-790.ts --drain [--reset-cap 150] [--go]
//
// --step0    STEP 0's prod and Congress.gov claims: prod's sqlite_master and sync_state (4); textVersions.count's coverage
//            on bills, MAX(update_date), and /api/sync's last 30 days in cron_runs (6); three Congress.gov reads (7): the
//            list from 48 hours ago sorted updateDate asc, the same list sorted desc as the control that separates asc
//            honoured from asc ignored (the list prints bare days, so five non-decreasing days alone can't), and the detail
//            of the asc list's first entry.
// --seed     the legs' input: 1,000 of prod's 119th bills with a summary, the most recently updated, copied by SELECT to
//            seed-1000.json (ids, dates, raw_json, summaries, stage). Read once, so a red run at the base and a green one
//            at HEAD read the same rows.
// --legs     A to H on a `file:` copy built by the real scripts/migrate.ts, `bills` seeded from seed-1000.json, against a
//            stub Congress.gov on 127.0.0.1:0 that lib/sync.ts reaches through CONGRESS_API_BASE. The stub serves
//            /bill/{congress} from an in-memory fixture: fromDateTime honoured to the second on each entry's instant,
//            sort=updateDate asc|desc, limit, offset, pagination.count, both list dates printed as a bare day (the real
//            list's shape), each detail with the instant to the second; a per-call latency, a hook between list pages,
//            and switches that make the next list page or one bill's detail answer 503. HO 771's fetch tripwire is
//            installed before the stub starts (scripts/diagnostic/ratings-daily-771.ts:63-72): nothing beyond 127.0.0.1
//            is reachable, and .env is never loaded, so the process holds no prod credential. Run from a worktree at
//            b64cc81 with this file copied in, lib/sync.ts there has no CONGRESS_API_BASE seam, so the tripwire rewrites
//            https://api.congress.gov/v3 to the stub and counts each rewrite; only A, E and F run there (the reds).
//            Leg P is added to the handoff's A to H: --enqueue's and --drain's own code (enqueueBackfill, drainRounds)
//            on the copy, the summarizer stood in for by the sleep between rounds.
// --census   the census through the HO 788 instrument: runs `bills-gap-788.ts --census --no-details --label <L>` unless
//            docs/handoffs/788-artifacts/census-<L>.csv already exists, then reads that file: missing and behind, and
//            the behind by list day (today, yesterday, older: the residual a finished pass names).
// --enqueue  every missing and behind row of census-<L>.csv into prod's sync_queue with source 'backfill' and the
//            census row's list day. Idempotent: a row already queued keeps its enqueued_at and its source.
// --drain    rounds of runSync({ source: "backfill", listing: false, maxResets: <cap> }) against prod, no deadline: the
//            cron's own drain on the backfill queue. Each round ends at --reset-cap resets (default 150) and the next
//            starts 90 s past the next 10-minute boundary, after the summarizer's */10 tick; before a round starts the
//            summary hole (bills with summary IS NULL) is read, and while what the pass added to it is over 1% of the
//            corpus the round waits for the next boundary. At the first round boundary at or past 300 drained it
//            projects the run's resets over the queue left: over 2,000 it stops unless --go was given, over 4,000 it
//            stops regardless. Resumable: the queue is the state, so Ctrl-C and the same command continue.
//
// SAFETY. Prod is read through q(), which refuses anything but SELECT or WITH … SELECT and any statement naming a write
// keyword. Prod is written only by --enqueue (sync_queue rows) and --drain (runSync's own statements); each prints the
// database host and pauses five seconds first. TURSO_DATABASE_URL, TURSO_AUTH_TOKEN and CONGRESS_API_KEY are read
// from .env by name, and never by --legs. Congress.gov requests carry the key in the query, as production does; every
// printed or saved line passes redactSecrets, so no URL prints with it. Times print in Mountain Time on a 12-hour clock
// with UTC beside.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type ResultSet, type Row } from "@libsql/client";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getCurrentCongress } from "../../lib/congress";
import { computeStage } from "../../lib/enums";
import { redactSecrets } from "../../lib/redact";

type SyncModule = typeof import("../../lib/sync");
type DbModule = typeof import("../../lib/db");

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const MODES = ["--step0", "--seed", "--legs", "--enqueue", "--drain", "--census"] as const;
type Mode = (typeof MODES)[number];
// --enqueue takes --census <label> as its argument, so it's matched before --census.
const MODE: Mode | undefined = MODES.find((m) => process.argv.includes(m));
const ART = path.resolve(argAt("--art") ?? "docs/handoffs/790-artifacts"); // repo-ignored
const ART788 = path.resolve("docs/handoffs/788-artifacts"); // repo-ignored
const SCRATCH = path.resolve("scripts/diagnostic/scratch"); // gitignored, and outside tsc
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const SEED_FILE = path.join(ART, "seed-1000.json");
const MT = "America/Denver";
const ROUTE = "/api/sync";
const CONGRESS = getCurrentCongress();
const SECOND = 1_000;
const MIN = 60_000;
const HOUR = 3_600_000;
const DAY_MS = 86_400_000;
const LEGS_KEY = "legs-790-not-a-key"; // what runSync sends the stub; never a real key

const out: string[] = [];
const say = (s = "") => { const r = redactSecrets(s); out.push(r); process.stdout.write(`${r}\n`); };
const fmtN = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(2)}%` : "n/a");
const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();
const isoS = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const floorS = (ms: number) => Math.floor(ms / SECOND) * SECOND;
const startOfUtcDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const save = (name: string, body: string) => { mkdirSync(ART, { recursive: true }); writeFileSync(path.join(ART, name), redactSecrets(body)); };
const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const objs = (rs: ResultSet) => rs.rows.map((r: Row) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i] ?? null])) as Record<string, unknown>);
const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "bigint" ? Number(v) : null);
const at = (o: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((v, k) => (v !== null && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), o);
const precision = (s: unknown) => (typeof s !== "string" || !s ? "none" : /^\d{4}-\d{2}-\d{2}$/.test(s) ? "date" : /T\d{2}:\d{2}:\d{2}/.test(s) ? "timestamp" : "other");
// Nearest rank: the p-quantile is the value at rank ceil(p × n).
function quantile(xs: number[], p: number): number | null {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  return a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))]!;
}

// ── time ────────────────────────────────────────────────────────────────────
const mtFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: MT, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit",
});
// "Oct 24, 2026, 2:05:13 PM MT (2026-10-24 20:05:13Z)"
function when(x: unknown): string {
  if (x == null || x === "") return String(x);
  const d = x instanceof Date ? x : new Date(typeof x === "number" ? x : String(x));
  if (Number.isNaN(d.getTime())) return `${String(x)} (unparsed)`;
  return `${mtFmt.format(d)} MT (${d.toISOString().slice(0, 19).replace("T", " ")}Z)`;
}

// ── prod, read-only ─────────────────────────────────────────────────────────
let readDb: Client | null = null;
function prod(): Client {
  if (readDb) return readDb;
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("libsql://")) throw new Error("reading prod needs the prod libsql:// URL in .env (TURSO_DATABASE_URL)");
  readDb = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
    fetch: (i: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(i, { ...init, signal: AbortSignal.timeout(120_000) }),
  });
  return readDb;
}
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|ANALYZE)\b/i;
let stmts = 0;
async function q(label: string, sql: string, args: InArgs = []): Promise<ResultSet> {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql) || WRITE_WORD.test(sql)) throw new Error(`HALT: the read path writes nothing, and this is not a SELECT: ${label}`);
  const t = Date.now();
  const rs = await prod().execute({ sql, args });
  stmts += 1;
  const shownArgs = Array.isArray(args) && args.length ? `  · args ${JSON.stringify(args).slice(0, 300)}` : "";
  say(`  [q] ${label}`);
  say(`      ${oneLine(sql)}${shownArgs}`);
  say(`      → ${fmtN(rs.rows.length)} row(s) · ${Date.now() - t}ms · read ${when(new Date())}`);
  return rs;
}
const dbHost = () => { try { return new URL(process.env.TURSO_DATABASE_URL ?? "").host; } catch { return "(unparsed)"; } };

// ── Congress.gov, the key in the query as production sends it, never printed ───
async function cg(label: string, pathAndQuery: string): Promise<{ status: number; json: unknown; ms: number; at: Date }> {
  const key = (process.env.CONGRESS_API_KEY ?? "").trim();
  if (!key) throw new Error("CONGRESS_API_KEY is not set in .env");
  const url = `https://api.congress.gov/v3${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}format=json&api_key=${encodeURIComponent(key)}`;
  const t0 = Date.now();
  let status = 0;
  let body = "";
  let err = "";
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
    status = res.status;
    body = await res.text();
  } catch (e) {
    err = (e as Error).message;
  }
  const ms = Date.now() - t0;
  say(`    GET ${url} → ${status || "no answer"}${err ? ` (${err})` : ""} · ${fmtN(body.length)} bytes · ${ms}ms · ${label}`);
  let json: unknown = null;
  try { json = JSON.parse(body); } catch { json = null; }
  return { status, json, ms, at: new Date() };
}

// ── STEP 0 ──────────────────────────────────────────────────────────────────
async function step0() {
  say(`\n── claim 4: prod's sqlite_master for sync_queue, and sync_state's rows`);
  const sq = objs(await q("4 · sync_queue or its index in sqlite_master", `SELECT type, name FROM sqlite_master WHERE name IN ('sync_queue', 'idx_sync_queue_drain')`));
  say(`  sync_queue in sqlite_master: ${sq.length ? sq.map((r) => `${r.type} ${r.name}`).join(", ") : "absent"}`);
  const ss = objs(await q("4 · sync_state, every row", `SELECT key, value, updated_at FROM sync_state ORDER BY key`));
  say(`  sync_state: ${ss.length} row(s)${ss.length ? `: ${ss.map((r) => `${r.key} = ${String(r.value).slice(0, 60)} (updated ${when(r.updated_at)})`).join(" · ")}` : ""}`);

  say(`\n── claim 6: textVersions.count's coverage, MAX(update_date), and /api/sync's last 30 days`);
  const cov = objs(await q(
    "6 · textVersions.count and summaries.count on bills, by congress",
    `SELECT congress, COUNT(*) AS n,
            SUM(CASE WHEN json_extract(raw_json, '$.textVersions.count') IS NULL THEN 1 ELSE 0 END) AS tv_null,
            SUM(CASE WHEN json_extract(raw_json, '$.textVersions.count') = 0 THEN 1 ELSE 0 END) AS tv_zero,
            SUM(CASE WHEN json_extract(raw_json, '$.textVersions') IS NULL THEN 1 ELSE 0 END) AS tv_absent,
            SUM(CASE WHEN json_extract(raw_json, '$.summaries.count') IS NULL THEN 1 ELSE 0 END) AS crs_null
     FROM bills GROUP BY congress ORDER BY congress`,
  ));
  let n = 0;
  let nulls = 0;
  for (const r of cov) {
    const rn = asNum(r.n) ?? 0;
    const rnull = asNum(r.tv_null) ?? 0;
    n += rn;
    nulls += rnull;
    say(`  congress ${r.congress}: ${fmtN(rn)} rows · textVersions.count null ${fmtN(rnull)} (of them, textVersions absent ${fmtN(asNum(r.tv_absent) ?? 0)}) · = 0 ${fmtN(asNum(r.tv_zero) ?? 0)} · summaries.count null ${fmtN(asNum(r.crs_null) ?? 0)}`);
  }
  const coverage = n ? (n - nulls) / n : 0;
  say(`  textVersions.count non-null on ${fmtN(n - nulls)} of ${fmtN(n)} rows: ${pct(n - nulls, n)} · nulls ${fmtN(nulls)} · ${coverage >= 0.99 ? "at or over 99%" : coverage >= 0.9 ? "UNDER 99%, over 90%: not a HALT, recorded" : "UNDER 90%: HALT, the reset rule needs another signal"}`);
  if (nulls) {
    const sample = objs(await q(
      "6 · up to ten rows whose textVersions.count is null, with their dates",
      `SELECT id, update_date, latest_action_date, json_type(raw_json, '$.textVersions') AS tv_type FROM bills WHERE json_extract(raw_json, '$.textVersions.count') IS NULL ORDER BY update_date DESC LIMIT 10`,
    ));
    say(`  the nulls, newest ten: ${sample.map((r) => `${r.id} (update_date ${r.update_date}, textVersions ${r.tv_type ?? "absent"})`).join("; ")}`);
  }
  const mx = objs(await q("6 · MAX(update_date), the watermark the bootstrap reads", `SELECT MAX(update_date) AS m, COUNT(*) AS n FROM bills`))[0];
  say(`  MAX(update_date) ${mx?.m} = ${when(mx?.m)} · over ${fmtN(asNum(mx?.n) ?? 0)} rows`);

  const since = isoS(Date.now() - 30 * DAY_MS);
  const ticks = objs(await q(
    "6 · /api/sync's rows over the last 30 days",
    `SELECT id, started_at, status, elapsed_ms,
            COALESCE(json_extract(payload, '$.payload.sync.seen'), json_extract(payload, '$.sync.seen')) AS seen,
            COALESCE(json_extract(payload, '$.payload.sync.upserted'), json_extract(payload, '$.sync.upserted')) AS upserted,
            COALESCE(json_extract(payload, '$.payload.sync.budgetStopped'), json_extract(payload, '$.sync.budgetStopped')) AS bs,
            COALESCE(json_extract(payload, '$.payload.timings.sync'), json_extract(payload, '$.timings.sync')) AS sync_ms
     FROM cron_runs WHERE route = ? AND started_at >= ? ORDER BY started_at`,
    [ROUTE, since],
  ));
  const byStatus = new Map<string, number>();
  for (const t of ticks) byStatus.set(String(t.status), (byStatus.get(String(t.status)) ?? 0) + 1);
  const withStats = ticks.filter((t) => asNum(t.seen) !== null);
  const bs = withStats.filter((t) => asNum(t.bs) === 1).length;
  const seen = withStats.map((t) => asNum(t.seen)!);
  const ups = withStats.map((t) => asNum(t.upserted) ?? 0);
  const syncMs = withStats.map((t) => asNum(t.sync_ms)).filter((x): x is number => x !== null);
  const sumSeen = seen.reduce((a, b) => a + b, 0);
  const sumUps = ups.reduce((a, b) => a + b, 0);
  const sumSyncMs = syncMs.reduce((a, b) => a + b, 0);
  say(`  since ${when(since)}: ${fmtN(ticks.length)} rows · by status ${[...byStatus.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")} · ${fmtN(withStats.length)} carry sync stats`);
  say(`  budgetStopped = 1 on ${bs} of ${withStats.length}: ${pct(bs, withStats.length)}`);
  say(`  seen: median ${quantile(seen, 0.5)} · p90 ${quantile(seen, 0.9)} · max ${quantile(seen, 1)} · SUM ${fmtN(sumSeen)} · SUM/30 = ${fmtN(Math.round(sumSeen / 30))} a day (the daily volume floor: a budget-stopped tick lists less than was there)`);
  say(`  upserted: median ${quantile(ups, 0.5)} · p90 ${quantile(ups, 0.9)} · SUM ${fmtN(sumUps)} · runSync's time (timings.sync): median ${quantile(syncMs, 0.5)} ms · p90 ${quantile(syncMs, 0.9)} ms · upserted per second of runSync over the window ${sumSyncMs ? (sumUps / (sumSyncMs / 1000)).toFixed(2) : "n/a"}`);
  const first = ticks[0];
  const last = ticks[ticks.length - 1];
  if (first && last) say(`  the first row ${first.id} at ${when(first.started_at)} · the last ${last.id} at ${when(last.started_at)} (${last.status})`);

  say(`\n── claim 7: Congress.gov from the box, three reads, the key in each URL and in no printed line`);
  const from = isoS(Date.now() - 2 * DAY_MS);
  const asc = await cg("the list from 48 h ago, sort updateDate asc", `/bill/${CONGRESS}?fromDateTime=${from}&sort=updateDate+asc&limit=5&offset=0`);
  const desc = await cg("the control: the same list sorted desc", `/bill/${CONGRESS}?fromDateTime=${from}&sort=updateDate+desc&limit=5&offset=0`);
  type Entry = { congress?: number; type?: string; number?: string; updateDate?: string; updateDateIncludingText?: string };
  const ascBills = (at(asc.json, "bills") as Entry[] | undefined) ?? [];
  const descBills = (at(desc.json, "bills") as Entry[] | undefined) ?? [];
  const show = (bs: Entry[]) => bs.map((b) => `${String(b.type).toLowerCase()}-${b.number} ${b.updateDate} / ${b.updateDateIncludingText}`).join(" · ");
  say(`  asc: ${asc.status} · pagination.count ${JSON.stringify(at(asc.json, "pagination", "count"))} · ${show(ascBills)}`);
  say(`  desc: ${desc.status} · pagination.count ${JSON.stringify(at(desc.json, "pagination", "count"))} · ${show(descBills)}`);
  const ascDays = ascBills.map((b) => b.updateDate ?? "");
  const nonDecreasing = ascDays.every((d, i) => i === 0 || d >= ascDays[i - 1]!);
  const precs = new Map<string, number>();
  for (const b of [...ascBills, ...descBills]) for (const f of ["updateDate", "updateDateIncludingText"] as const) {
    const k = `${f} ${precision(b[f])}`;
    precs.set(k, (precs.get(k) ?? 0) + 1);
  }
  say(`  asc's five updateDates non-decreasing: ${nonDecreasing} · the dates' precision across both reads: ${[...precs.entries()].map(([k, v]) => `${k} ${v}`).join(" · ")}`);
  say(`  the control: asc's first day ${ascDays[0] ?? "-"} against desc's first ${descBills[0]?.updateDate ?? "-"} (asc honoured reads the window's oldest end first, desc its newest)`);
  const f0 = ascBills[0];
  if (f0) {
    const det = await cg(`the detail of asc's first entry, ${String(f0.type).toLowerCase()}-${f0.number}`, `/bill/${f0.congress ?? CONGRESS}/${String(f0.type).toLowerCase()}/${f0.number}`);
    const b = at(det.json, "bill");
    say(`  detail: ${det.status} · updateDate ${JSON.stringify(at(b, "updateDate"))} (${precision(at(b, "updateDate"))}) · updateDateIncludingText ${JSON.stringify(at(b, "updateDateIncludingText"))} (${precision(at(b, "updateDateIncludingText"))}) · textVersions.count ${JSON.stringify(at(b, "textVersions", "count"))} · summaries.count ${JSON.stringify(at(b, "summaries", "count"))} · latestAction ${JSON.stringify(at(b, "latestAction"))}`);
    const udit = at(b, "updateDateIncludingText");
    if (typeof udit === "string") say(`  its instant ${when(udit)} against fromDateTime ${when(from)}: ${Date.parse(udit) >= Date.parse(from) ? "inside the window" : "BEFORE the window"}`);
  }
}

// ── --seed: the legs' input, copied from prod by SELECT ─────────────────────
const SEED_COLS = [
  "id", "congress", "bill_type", "bill_number", "title", "introduced_date", "latest_action_date", "latest_action_text",
  "sponsor_name", "sponsor_party", "sponsor_state", "sponsor_bioguide_id", "update_date", "raw_json", "cluster_id",
  "summary", "summary_model", "summary_updated_at", "topics", "is_ceremonial", "stage", "previous_stage",
  "stage_observed_at", "changed_at", "committee_walk_failures", "summarize_failed_at", "summarize_attempts",
] as const;
type SeedRow = Record<(typeof SEED_COLS)[number], unknown> & { id: string; update_date: string; raw_json: string };

async function seed() {
  say(`\n── the legs' seed: 1,000 of prod's ${CONGRESS}th bills with a summary, the most recently updated`);
  const rows = objs(await q(
    "seed · 1,000 bills by SELECT",
    `SELECT ${SEED_COLS.join(", ")} FROM bills WHERE congress = ? AND summary IS NOT NULL ORDER BY update_date DESC, id LIMIT 1000`,
    [CONGRESS],
  )) as SeedRow[];
  const body = JSON.stringify({ readAt: new Date().toISOString(), congress: CONGRESS, rows }, null, 0);
  save("seed-1000.json", body);
  const tv = rows.filter((r) => asNum(at(JSON.parse(r.raw_json), "textVersions", "count")) !== null).length;
  const dates = rows.map((r) => r.update_date).sort();
  say(`  ${rows.length} rows · update_date ${dates[0]} to ${dates[dates.length - 1]} · textVersions.count present on ${tv} · topics set on ${rows.filter((r) => r.topics !== null).length} · stage set on ${rows.filter((r) => r.stage !== null).length}`);
  say(`  wrote ${SEED_FILE} · ${fmtN(Buffer.byteLength(body))} bytes · sha256 ${sha256(body).slice(0, 16)}`);
}

// ── --legs ──────────────────────────────────────────────────────────────────
// The tripwire: every fetch in this process goes through here, and only 127.0.0.1 is let through. At a base whose
// lib/sync.ts has no CONGRESS_API_BASE seam, Congress.gov's base is rewritten to the stub, and each rewrite is counted.
const refused: string[] = [];
let rewritten = 0;
function installTripwire(stubBase: () => string, rewriteBase: boolean) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const real = "https://api.congress.gov/v3";
    if (rewriteBase && href.startsWith(`${real}/`)) {
      rewritten++;
      return realFetch(`${stubBase()}${href.slice(real.length)}`, init);
    }
    if (new URL(href).hostname !== "127.0.0.1") {
      refused.push(redactSecrets(href));
      return Promise.reject(new Error(`tripwire: no fetch beyond 127.0.0.1 (${redactSecrets(href)})`));
    }
    return realFetch(input, init);
  }) as typeof fetch;
}

type StubBill = {
  id: string; congress: number; type: string; number: string; title: string; instant: number;
  actionDate: string | null; actionText: string | null; textVersions: number | null; summaries: number | null;
  raw: Record<string, unknown>;
};
type ListLog = { at: number; from: string | null; sort: string; offset: number; n: number; status: number };
const stub = {
  bills: new Map<string, StubBill>(),
  listLatencyMs: 0,
  detailLatencyMs: 0,
  failNextList: 0,
  failDetail: new Map<string, number>(),
  afterListPage: null as ((n: number) => void) | null,
  listRequests: 0,
  detailRequests: 0,
  detailById: new Map<string, number>(),
  listLog: [] as ListLog[],
  port: 0,
  update(id: string, patch: Partial<Omit<StubBill, "id">>) {
    const b = this.bills.get(id);
    if (!b) throw new Error(`stub: no ${id}`);
    Object.assign(b, patch);
  },
};
const listEntry = (b: StubBill) => ({
  congress: b.congress, type: b.type, number: b.number, title: b.title,
  updateDate: dayOf(b.instant), updateDateIncludingText: dayOf(b.instant),
  latestAction: { actionDate: b.actionDate ?? undefined, text: b.actionText ?? undefined },
  url: `http://127.0.0.1:${stub.port}/v3/bill/${b.congress}/${b.type.toLowerCase()}/${b.number}?format=json`,
});
function detailOf(b: StubBill): Record<string, unknown> {
  const d: Record<string, unknown> = {
    ...b.raw, congress: b.congress, type: b.type, number: b.number, title: b.title,
    updateDate: isoS(b.instant), updateDateIncludingText: isoS(b.instant),
    latestAction: { actionDate: b.actionDate ?? undefined, text: b.actionText ?? undefined },
  };
  if (b.textVersions === null) delete d.textVersions;
  else d.textVersions = { count: b.textVersions, url: "stub" };
  if (b.summaries === null) delete d.summaries;
  else d.summaries = { count: b.summaries, url: "stub" };
  return d;
}
async function handleStub(req: IncomingMessage, res: ServerResponse) {
  const u = new URL(req.url ?? "/", "http://127.0.0.1");
  const parts = u.pathname.split("/").filter(Boolean);
  const send = (status: number, body: unknown) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
  if (parts[0] !== "v3" || parts[1] !== "bill") return send(404, { error: "not found" });
  if (parts.length === 3) {
    stub.listRequests++;
    const n = stub.listRequests;
    if (stub.listLatencyMs) await sleep(stub.listLatencyMs);
    const from = u.searchParams.get("fromDateTime");
    const sort = u.searchParams.get("sort") ?? "updateDate desc";
    const offset = Number(u.searchParams.get("offset") ?? "0");
    const limit = Number(u.searchParams.get("limit") ?? "20");
    if (stub.failNextList > 0) {
      stub.failNextList--;
      stub.listLog.push({ at: Date.now(), from, sort, offset, n: 0, status: 503 });
      return send(503, { error: { code: 503, message: "Service Unavailable" } });
    }
    const fromMs = from ? Date.parse(from) : Number.NEGATIVE_INFINITY;
    const asc = /\basc$/i.test(sort.trim());
    const all = [...stub.bills.values()]
      .filter((b) => b.instant >= fromMs)
      .sort((a, b) => (asc ? a.instant - b.instant || a.id.localeCompare(b.id) : b.instant - a.instant || b.id.localeCompare(a.id)));
    const page = all.slice(offset, offset + limit);
    const body = {
      bills: page.map(listEntry),
      pagination: { count: all.length, ...(offset + limit < all.length ? { next: `http://127.0.0.1:${stub.port}/v3/bill/${parts[2]}?offset=${offset + limit}` } : {}) },
    };
    stub.listLog.push({ at: Date.now(), from, sort, offset, n: page.length, status: 200 });
    stub.afterListPage?.(n);
    return send(200, body);
  }
  if (parts.length === 5) {
    const id = `${parts[2]}-${String(parts[3]).toLowerCase()}-${parts[4]}`;
    stub.detailRequests++;
    stub.detailById.set(id, (stub.detailById.get(id) ?? 0) + 1);
    if (stub.detailLatencyMs) await sleep(stub.detailLatencyMs);
    const left = stub.failDetail.get(id) ?? 0;
    if (left > 0) {
      stub.failDetail.set(id, left - 1);
      return send(503, { error: { code: 503, message: "Service Unavailable" } });
    }
    const b = stub.bills.get(id);
    if (!b) return send(404, { error: "not found" });
    return send(200, { bill: detailOf(b) });
  }
  return send(404, { error: "not found" });
}

let passes = 0;
let fails = 0;
let legFails = 0;
const check = (label: string, ok: boolean, detail: string) => {
  say(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
  if (ok) passes++;
  else { fails++; legFails++; }
};

type Stats = Record<string, unknown>;
type Legs = {
  sync: SyncModule; db: ReturnType<DbModule["getDb"]>; queue: boolean; base: boolean;
  seedRows: SeedRow[]; ids: string[]; baseAt: Map<string, number>; M: number;
};
let L!: Legs;

const S = (s: Stats | undefined, k: string) => (s ? s[k] : undefined);
function fmtStats(s: Stats | undefined): string {
  if (!s) return "(no stats)";
  const keys = ["seen", "enqueued", "upserted", "resets", "resetByAction", "resetByText", "crsMoved", "crsOnly", "titleMoved", "skipped", "failed", "timedOut", "droppedCount", "pages", "listedCount"];
  const parts = keys.filter((k) => k in s).map((k) => `${k} ${String(s[k])}`);
  if ("queueBefore" in s) parts.push(`queue ${String(s.queueBefore)}→${String(s.queueAfter)}`);
  for (const k of ["listComplete", "budgetStopped", "bootstrapped", "wide", "wideComplete"]) if (k in s) parts.push(`${k} ${String(s[k])}`);
  if ("frontierBefore" in s) parts.push(`frontier ${String(s.frontierBefore)}→${String(s.frontierAfter)}`);
  parts.push(`fromDateTime ${String(s.fromDateTime)}`);
  if (s.listError) parts.push(`listError "${String(s.listError)}"`);
  if (Array.isArray(s.dropped) && s.dropped.length) parts.push(`dropped [${s.dropped.join(", ")}]`);
  return parts.join(" · ");
}

async function tick(label: string, opts: Record<string, unknown>) {
  const logs: string[] = [];
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const cap = (...a: unknown[]) => { logs.push(a.map(String).join(" ")); };
  const listFrom = stub.listLog.length;
  const detailBefore = stub.detailRequests;
  const t0 = Date.now();
  let stats: Stats | undefined;
  let err: Error | null = null;
  console.log = cap;
  console.warn = cap;
  console.error = cap;
  try {
    stats = (await L.sync.runSync(opts as Parameters<SyncModule["runSync"]>[0])) as unknown as Stats;
  } catch (e) {
    err = e as Error;
  } finally {
    Object.assign(console, orig);
  }
  const lists = stub.listLog.slice(listFrom);
  const firstListAt = lists[0]?.at ?? null;
  say(`    ${label} (${JSON.stringify(opts)}): ${fmtStats(stats)}`);
  say(`      ${Date.now() - t0} ms · list requests ${lists.length}${lists.length ? ` (${lists.map((l) => `from ${l.from} @${l.offset} → ${l.status === 200 ? l.n : l.status}`).join("; ")})` : ""} · detail requests ${stub.detailRequests - detailBefore}`);
  if (err) say(`      THREW: ${err.message}`);
  return { stats, err, logs, t0, firstListAt };
}

async function storedUpdates(ids: string[]): Promise<Map<string, string>> {
  const m = new Map<string, string>();
  if (!ids.length) return m;
  const r = await L.db.execute({ sql: `SELECT id, update_date FROM bills WHERE id IN (${ids.map(() => "?").join(",")})`, args: ids });
  for (const row of r.rows) m.set(row.id as string, row.update_date as string);
  return m;
}
async function bill(id: string): Promise<Record<string, unknown>> {
  const r = await L.db.execute({ sql: "SELECT * FROM bills WHERE id = ?", args: [id] });
  return (objs(r)[0] ?? {}) as Record<string, unknown>;
}
async function queueRows(): Promise<Record<string, unknown>[]> {
  if (!L.queue) return [];
  return objs(await L.db.execute("SELECT bill_id, list_update_day, source, enqueued_at, attempts, last_error FROM sync_queue ORDER BY bill_id"));
}
async function syncState(): Promise<Map<string, string>> {
  const r = await L.db.execute("SELECT key, value FROM sync_state");
  return new Map(r.rows.map((row) => [row.key as string, row.value as string]));
}
async function setState(key: string, value: string) {
  await L.db.execute({ sql: "INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", args: [key, value, new Date().toISOString()] });
}

// Every leg starts here: the seed stored at its base instants, the stub holding the same bills at the same instants
// (so the store is current), the queue and sync_state empty, then the presets the leg names.
async function setup(o: { frontier?: string; wideAt?: boolean } = {}) {
  stub.bills.clear();
  for (const r of L.seedRows) {
    const raw = JSON.parse(r.raw_json) as Record<string, unknown>;
    stub.bills.set(r.id, {
      id: r.id, congress: Number(r.congress), type: String(raw.type ?? r.bill_type).toUpperCase(), number: String(r.bill_number),
      title: String(r.title), instant: L.baseAt.get(r.id)!,
      actionDate: (r.latest_action_date as string | null) ?? null, actionText: (r.latest_action_text as string | null) ?? null,
      textVersions: asNum(at(raw, "textVersions", "count")), summaries: asNum(at(raw, "summaries", "count")), raw,
    });
  }
  Object.assign(stub, { listLatencyMs: 0, detailLatencyMs: 0, failNextList: 0, afterListPage: null, listRequests: 0, detailRequests: 0, listLog: [] });
  stub.failDetail.clear();
  stub.detailById.clear();
  const batch: Array<string | { sql: string; args: InArgs }> = [];
  if (L.queue) batch.push("DELETE FROM sync_queue");
  batch.push("DELETE FROM sync_state", "DELETE FROM stage_transitions", "DELETE FROM bills");
  for (const r of L.seedRows) {
    batch.push({
      sql: `INSERT INTO bills (${SEED_COLS.join(", ")}) VALUES (${SEED_COLS.map(() => "?").join(", ")})`,
      args: SEED_COLS.map((c) => (c === "update_date" ? isoS(L.baseAt.get(r.id)!) : ((r[c] as string | number | null) ?? null))),
    });
  }
  await L.db.batch(batch, "write");
  if (o.frontier) await setState("bills_frontier", o.frontier);
  if (o.wideAt) await setState("bills_wide_at", new Date().toISOString());
}
const freshCount = async (ids: string[]) => {
  const st = await storedUpdates(ids);
  return ids.filter((id) => st.get(id) === isoS(stub.bills.get(id)!.instant)).length;
};

// ── A ──
async function legA() {
  say(`\n── A, backlog :81's close: a tick cut by its deadline partway through a window of updated bills, then a second tick`);
  say(`  never done (b64cc81): tick 2 lists from tick 1's freshest bill, and the bills tick 1 didn't reach keep their old update_date (HO 116's shape)`);
  await setup({ wideAt: true });
  const ids = L.ids.slice(100, 140);
  const end = floorS(Date.now() - 30 * MIN);
  const step = Math.floor((end - L.M) / 41);
  ids.forEach((id, k) => stub.update(id, { instant: floorS(L.M + (k + 1) * step) }));
  const freshest = Math.max(...ids.map((id) => stub.bills.get(id)!.instant));
  say(`  40 bills moved into the window after MAX(update_date) ${isoS(L.M)}, from ${isoS(stub.bills.get(ids[0]!)!.instant)} to ${isoS(freshest)}; detail latency 200 ms; tick 1's deadline 2.1 s out`);
  stub.detailLatencyMs = 200;
  stub.listLatencyMs = 20;
  const t1 = await tick("tick 1", { deadlineMs: Date.now() + 2_100 });
  const fresh1 = await freshCount(ids);
  const q1 = (await queueRows()).length;
  stub.detailLatencyMs = 0;
  const t2 = await tick("tick 2", {});
  const fresh2 = await freshCount(ids);
  const q2 = await queueRows();
  say(`  the 40 at their new instants: after tick 1 ${fresh1}, after tick 2 ${fresh2} · sync_queue after tick 1 ${L.queue ? q1 : "(no table)"}, after tick 2 ${L.queue ? q2.length : "(no table)"}`);
  say(`  tick 2's fromDateTime ${String(S(t2.stats, "fromDateTime"))} · the window's freshest instant ${isoS(freshest)}`);
  check("all 40 at their new instants after tick 2", fresh2 === 40, `${fresh2} of 40`);
  check("tick 1: listComplete true and budgetStopped true", S(t1.stats, "listComplete") === true && S(t1.stats, "budgetStopped") === true, `listComplete ${String(S(t1.stats, "listComplete"))} · budgetStopped ${String(S(t1.stats, "budgetStopped"))}`);
  const f1 = String(S(t1.stats, "frontierAfter") ?? "");
  const f1Ms = Date.parse(f1) + 15 * MIN;
  check(
    "tick 1 moved the frontier once, to its listing start less 15 minutes",
    S(t1.stats, "frontierBefore") === isoS(L.M) && t1.firstListAt !== null && f1Ms >= floorS(t1.t0) && f1Ms <= t1.firstListAt,
    `frontier ${String(S(t1.stats, "frontierBefore"))} → ${f1 || "-"} · plus 15 min ${Number.isNaN(f1Ms) ? "-" : isoS(f1Ms)} against the tick's start ${isoS(t1.t0)} and its first list request ${t1.firstListAt === null ? "-" : new Date(t1.firstListAt).toISOString()}; tick 2 read it as ${String(S(t2.stats, "frontierBefore"))}`,
  );
  check("sync_queue empty after tick 2", L.queue && q2.length === 0, L.queue ? `${q2.length} row(s)` : "no sync_queue table");
  check("tick 1's queueAfter is about 30 and tick 2 upserted the rest", typeof S(t1.stats, "queueAfter") === "number" && S(t2.stats, "upserted") === S(t1.stats, "queueAfter") && Math.abs(Number(S(t1.stats, "queueAfter")) - 30) <= 5, `queueAfter ${String(S(t1.stats, "queueAfter"))} · tick 2 upserted ${String(S(t2.stats, "upserted"))}`);
}

// ── B ──
async function legB(overlap: number | undefined) {
  const label = overlap === undefined ? "OVERLAP = 25 (the default)" : `overlap ${overlap}, the control`;
  say(`\n── B, a shift across a page boundary, ${label}`);
  say(`  never done: pages that don't overlap lose the entries a re-update shifts across a boundary between two reads`);
  await setup({ wideAt: true, frontier: isoS(L.M + SECOND) });
  const ids = L.ids.slice(0, 600);
  const end = floorS(Date.now() - 30 * MIN);
  const step = Math.floor((end - L.M - SECOND) / 601);
  ids.forEach((id, k) => stub.update(id, { instant: floorS(L.M + SECOND + (k + 1) * step) }));
  const moved = ids.slice(10, 15);
  const now = floorS(Date.now());
  stub.afterListPage = (n) => { if (n === 1) moved.forEach((id, j) => stub.update(id, { instant: now + j * SECOND })); };
  say(`  600 entries after the frontier in asc order; after page 1 is read the stub re-updates 5 of page 1's (positions 10-14) to ${isoS(now)}, the end of the list`);
  const opts: Record<string, unknown> = { maxResets: 0 };
  if (overlap !== undefined) opts.overlap = overlap;
  const t = await tick("the listing (maxResets: 0, so nothing drains)", opts);
  const rows = await queueRows();
  const queued = new Set(rows.map((r) => String(r.bill_id)));
  const lost = ids.filter((id) => !queued.has(id));
  const movedDays = moved.map((id) => String(rows.find((r) => r.bill_id === id)?.list_update_day ?? "absent"));
  say(`  queued ${queued.size} distinct of 600 · lost ${lost.length}${lost.length ? `: ${lost.join(", ")} (positions ${lost.map((id) => ids.indexOf(id)).join(", ")})` : ""} · the 5 re-updated queued with list day ${[...new Set(movedDays)].join(", ")} (today ${dayOf(now)}) · seen ${String(S(t.stats, "seen"))} · enqueued ${String(S(t.stats, "enqueued"))}`);
  if (overlap === undefined) {
    check("all 600 in the queue, none twice", queued.size === 600 && rows.length === 600 && S(t.stats, "enqueued") === 600, `${queued.size} distinct, ${rows.length} rows, enqueued ${String(S(t.stats, "enqueued"))}`);
    check("the 5 re-updated hold their newest day", movedDays.every((d) => d === dayOf(now)), movedDays.join(", "));
    check("three pages, the walk ended on the short one", S(t.stats, "pages") === 3 && S(t.stats, "listComplete") === true, `pages ${String(S(t.stats, "pages"))} · listComplete ${String(S(t.stats, "listComplete"))}`);
  } else {
    const expect = ids.slice(250, 255);
    check("the control loses the five pushed across the boundary", lost.length === 5 && lost.every((id) => expect.includes(id)), `lost ${lost.length}: ${lost.join(", ")}`);
  }
}

// ── C ──
async function legC() {
  say(`\n── C, a listing cut by the budget`);
  say(`  never done: a cut listing moves the frontier anyway, or drops what it read, and the rest of the window is never listed`);
  await setup({ wideAt: true, frontier: isoS(L.M + SECOND) });
  const ids = L.ids.slice(0, 600);
  const end = floorS(Date.now() - 30 * MIN);
  const step = Math.floor((end - L.M - SECOND) / 601);
  ids.forEach((id, k) => stub.update(id, { instant: floorS(L.M + SECOND + (k + 1) * step) }));
  stub.listLatencyMs = 400;
  say(`  600 entries after the frontier, three pages; list latency 400 ms, tick 1's deadline 600 ms out, so it falls while page 2 is in flight`);
  const t1 = await tick("tick 1", { deadlineMs: Date.now() + 600 });
  const rows1 = await queueRows();
  stub.listLatencyMs = 0;
  const t2 = await tick("tick 2", {});
  const fresh = await freshCount(ids);
  const rows2 = await queueRows();
  check("tick 1: listComplete false, budgetStopped true, the frontier unchanged", S(t1.stats, "listComplete") === false && S(t1.stats, "budgetStopped") === true && S(t1.stats, "frontierAfter") === S(t1.stats, "frontierBefore") && (await syncState()).get("bills_frontier") !== undefined, `listComplete ${String(S(t1.stats, "listComplete"))} · budgetStopped ${String(S(t1.stats, "budgetStopped"))} · frontier ${String(S(t1.stats, "frontierBefore"))} → ${String(S(t1.stats, "frontierAfter"))}`);
  check("tick 1 read two pages and the queue holds them (250 + 225 new)", S(t1.stats, "pages") === 2 && rows1.length === 475 && S(t1.stats, "upserted") === 0, `pages ${String(S(t1.stats, "pages"))} · queued ${rows1.length} · upserted ${String(S(t1.stats, "upserted"))}`);
  check("tick 2 re-walks from the same frontier, the INSERT dedupes, the listing completes and the frontier moves", S(t2.stats, "fromDateTime") === S(t1.stats, "fromDateTime") && S(t2.stats, "enqueued") === 125 && S(t2.stats, "listComplete") === true && S(t2.stats, "frontierAfter") !== S(t2.stats, "frontierBefore"), `fromDateTime ${String(S(t2.stats, "fromDateTime"))} · enqueued ${String(S(t2.stats, "enqueued"))} · listComplete ${String(S(t2.stats, "listComplete"))} · frontier ${String(S(t2.stats, "frontierBefore"))} → ${String(S(t2.stats, "frontierAfter"))}`);
  check("tick 2 drains the queue and every bill reads its new instant", rows2.length === 0 && S(t2.stats, "upserted") === 600 && fresh === 600, `queue ${rows2.length} · upserted ${String(S(t2.stats, "upserted"))} · at the new instant ${fresh} of 600`);
}

// ── D ──
async function legD() {
  say(`\n── D, failure shapes`);
  say(`  never done: a failed list page throws out of the tick and nothing queued drains; a detail that never answers costs a fetch every tick forever`);
  say(`  (i) the list's first page answers 503`);
  await setup({ wideAt: true, frontier: isoS(L.M + SECOND) });
  const ids = L.ids.slice(200, 205);
  ids.forEach((id, k) => stub.update(id, { instant: floorS(Date.now() - 2 * HOUR + k * MIN) }));
  await tick("enqueue the 5 (maxResets: 0)", { maxResets: 0 });
  const queued = (await queueRows()).length;
  stub.failNextList = 1;
  const ti = await tick("the 503 tick", {});
  const le = String(S(ti.stats, "listError") ?? "");
  check("listError set and redacted, the frontier unchanged, the tick returns normally", ti.err === null && le.includes("503") && !le.includes(LEGS_KEY) && S(ti.stats, "frontierAfter") === S(ti.stats, "frontierBefore"), `threw ${ti.err ? ti.err.message : "no"} · listError "${le}" · frontier ${String(S(ti.stats, "frontierBefore"))} → ${String(S(ti.stats, "frontierAfter"))}`);
  check("the rows a previous tick queued drain anyway", queued === 5 && S(ti.stats, "upserted") === 5 && S(ti.stats, "queueAfter") === 0 && (await freshCount(ids)) === 5, `queued before ${queued} · upserted ${String(S(ti.stats, "upserted"))} · queueAfter ${String(S(ti.stats, "queueAfter"))}`);

  say(`  (ii) one bill's detail answers 503 on three ticks`);
  await setup({ wideAt: true, frontier: isoS(L.M + SECOND) });
  const bad = L.ids[300]!;
  stub.update(bad, { instant: floorS(Date.now() - 2 * HOUR) });
  stub.failDetail.set(bad, Number.POSITIVE_INFINITY);
  const attempts: string[] = [];
  const failed: string[] = [];
  let last: Stats | undefined;
  for (const k of [1, 2, 3]) {
    const t = await tick(`tick ${k}`, {});
    last = t.stats;
    failed.push(String(S(t.stats, "failed")));
    const row = (await queueRows()).find((r) => r.bill_id === bad);
    attempts.push(row ? `${String(row.attempts)} (${String(row.last_error).slice(0, 80)})` : "gone");
  }
  say(`  after each tick, the row's attempts: ${attempts.join(" · ")} · failed per tick ${failed.join(", ")}`);
  check("attempts 1, then 2, then the row is gone and the id is in dropped", attempts[0]?.startsWith("1 ") === true && attempts[1]?.startsWith("2 ") === true && attempts[2] === "gone" && Array.isArray(S(last, "dropped")) && (S(last, "dropped") as string[]).includes(bad) && S(last, "droppedCount") === 1, `${attempts.join(" · ")} · dropped ${JSON.stringify(S(last, "dropped"))}`);
  check("failed counts each", failed.every((f) => f === "1"), failed.join(", "));
  check("last_error is redacted", !attempts.join(" ").includes(LEGS_KEY), "no key in last_error");

  say(`  (iii) a detail that fails once and succeeds on the next tick`);
  await setup({ wideAt: true, frontier: isoS(L.M + SECOND) });
  const once = L.ids[301]!;
  stub.update(once, { instant: floorS(Date.now() - 2 * HOUR) });
  stub.failDetail.set(once, 1);
  await tick("tick 1", {});
  const r1 = (await queueRows()).find((r) => r.bill_id === once);
  const t2 = await tick("tick 2", {});
  const r2 = (await queueRows()).find((r) => r.bill_id === once);
  check("the row is cleared and its attempts never reach 2", r1?.attempts === 1 && r2 === undefined && S(t2.stats, "upserted") === 1 && (await freshCount([once])) === 1, `attempts after tick 1 ${String(r1?.attempts)} · after tick 2 ${r2 ? String(r2.attempts) : "gone"}`);
}

// ── E ──
async function legE() {
  say(`\n── E, the reset rule (§ 2)`);
  say(`  never done (HO 115's rule): a moved update_date nulls the summary, so case 1, metadata only, loses its summary`);
  await setup({ wideAt: true, frontier: isoS(L.M + SECOND) });
  const ids = L.ids.slice(600, 1000).filter((id) => stub.bills.get(id)!.textVersions !== null).slice(0, 4);
  const [m1, m2, m3, m4] = ids as [string, string, string, string];
  const pre = { summary: "E-LEG SUMMARY", summary_model: "leg-model", summary_updated_at: "2026-10-01T00:00:00Z", topics: '["Health"]', is_ceremonial: 0, summarize_failed_at: "2026-10-02T00:00:00Z", summarize_attempts: 2, changed_at: "2026-10-03T00:00:00Z", committee_walk_failures: 2 };
  const now = floorS(Date.now());
  const sameAt = now - 2 * HOUR;
  for (const id of ids) {
    const b = stub.bills.get(id)!;
    const stage = id === m2 ? "committee" : computeStage(b.actionText);
    await L.db.execute({
      sql: `UPDATE bills SET summary = ?, summary_model = ?, summary_updated_at = ?, topics = ?, is_ceremonial = ?, summarize_failed_at = ?,
              summarize_attempts = ?, changed_at = ?, committee_walk_failures = ?, stage = ?, previous_stage = 'introduced'${id === m4 ? ", update_date = ?" : ""} WHERE id = ?`,
      args: [pre.summary, pre.summary_model, pre.summary_updated_at, pre.topics, pre.is_ceremonial, pre.summarize_failed_at, pre.summarize_attempts, pre.changed_at, pre.committee_walk_failures, stage, ...(id === m4 ? [isoS(sameAt)] : []), id],
    });
  }
  stub.update(m1, { instant: now - HOUR });
  stub.update(m2, { instant: now - HOUR + SECOND, actionDate: dayOf(now), actionText: "Received in the Senate." });
  stub.update(m3, { instant: now - HOUR + 2 * SECOND, textVersions: (stub.bills.get(m3)!.textVersions ?? 0) + 1 });
  stub.update(m4, { instant: sameAt });
  say(`  (1) ${m1} metadata only · (2) ${m2} a new latest action, stored stage committee · (3) ${m3} textVersions.count up by one · (4) ${m4} the same instant, ${isoS(sameAt)}`);
  const t = await tick("the tick", {});
  const r = { 1: await bill(m1), 2: await bill(m2), 3: await bill(m3), 4: await bill(m4) };
  const seven = ["summary", "summary_model", "summary_updated_at", "topics", "is_ceremonial", "summarize_failed_at"] as const;
  const nulled = (x: Record<string, unknown>) => seven.every((c) => x[c] === null) && x.summarize_attempts === 0;
  const kept = (x: Record<string, unknown>) => seven.every((c) => x[c] === (pre as Record<string, unknown>)[c]) && x.summarize_attempts === pre.summarize_attempts;
  const show = (x: Record<string, unknown>) => `summary ${x.summary === null ? "NULL" : JSON.stringify(x.summary)} · topics ${String(x.topics)} · is_ceremonial ${String(x.is_ceremonial)} · summarize_failed_at ${String(x.summarize_failed_at)} · attempts ${String(x.summarize_attempts)} · changed_at ${String(x.changed_at)} · walk failures ${String(x.committee_walk_failures)} · update_date ${String(x.update_date)} · stage ${String(x.stage)} (previous ${String(x.previous_stage)})`;
  for (const k of [1, 2, 3, 4] as const) say(`  (${k}) ${show(r[k])}`);
  const trans = objs(await L.db.execute({ sql: "SELECT bill_id, from_stage, to_stage FROM stage_transitions WHERE bill_id IN (?, ?, ?, ?)", args: ids }));
  say(`  stage_transitions: ${trans.map((x) => `${x.bill_id} ${x.from_stage}→${x.to_stage}`).join("; ") || "none"}`);
  check("(1) metadata only: summary, topics and is_ceremonial kept, changed_at stamped, update_date moved", kept(r[1]) && r[1].changed_at !== pre.changed_at && r[1].committee_walk_failures === 0 && r[1].update_date === isoS(now - HOUR), show(r[1]));
  check("(2) a new latest action: the seven columns nulled, the stage advanced and logged (HO 383)", nulled(r[2]) && r[2].stage === "other_chamber" && r[2].previous_stage === "committee" && trans.some((x) => x.bill_id === m2 && x.from_stage === "committee" && x.to_stage === "other_chamber"), show(r[2]));
  check("(3) textVersions.count up by one, the action unchanged: nulled", nulled(r[3]), show(r[3]));
  check("(4) the same instant: nothing changes, changed_at included", kept(r[4]) && r[4].changed_at === pre.changed_at && r[4].committee_walk_failures === 2 && r[4].update_date === isoS(sameAt), show(r[4]));
  check("the tally: 4 written, 2 resets, 1 by action, 1 by text, no CRS or title move", S(t.stats, "upserted") === 4 && S(t.stats, "resets") === 2 && S(t.stats, "resetByAction") === 1 && S(t.stats, "resetByText") === 1 && S(t.stats, "crsMoved") === 0 && S(t.stats, "titleMoved") === 0, fmtStats(t.stats));
}

// ── F ──
async function legF() {
  say(`\n── F, a same-day second update`);
  say(`  never done (b64cc81): \`stored >= listUpdate\` compares the stored instant with the list's bare day, so a second update the same day reads current and is skipped (HO 788's behind shape)`);
  await setup({ wideAt: true });
  const id = L.ids[400]!;
  const T2 = floorS(Date.now() + 2 * MIN);
  const T = Math.max(startOfUtcDay(T2) + SECOND, T2 - 4 * HOUR);
  stub.update(id, { instant: T });
  say(`  ${id} at T = ${isoS(T)}, then moved to ${isoS(T2)} (T + ${((T2 - T) / HOUR).toFixed(2)} h), both on ${dayOf(T)}`);
  await tick("tick 1", {});
  const s1 = (await storedUpdates([id])).get(id);
  stub.update(id, { instant: T2 });
  const t2 = await tick("tick 2", {});
  const s2 = (await storedUpdates([id])).get(id);
  say(`  stored after tick 1 ${s1} · after tick 2 ${s2} · tick 2's fromDateTime ${String(S(t2.stats, "fromDateTime"))} · detail requests for it ${stub.detailById.get(id) ?? 0}`);
  check("the store reads T + the move after tick 2", s1 === isoS(T) && s2 === isoS(T2) && dayOf(T) === dayOf(T2), `after tick 1 ${s1} · after tick 2 ${s2}`);
}

// ── G ──
async function legG() {
  say(`\n── G, the bootstrap`);
  say(`  never done: no frontier to read, so the first tick lists from nowhere, or from the seven-day default with a table full of bills`);
  await setup({});
  const t = await tick("the first tick, sync_state empty", {});
  const st = await syncState();
  check("fromDateTime is MAX(update_date) normalized, bootstrapped true, the key written", S(t.stats, "fromDateTime") === isoS(L.M) && S(t.stats, "frontierBefore") === isoS(L.M) && S(t.stats, "bootstrapped") === true && st.get("bills_frontier") === S(t.stats, "frontierAfter"), `MAX(update_date) ${isoS(L.M)} · fromDateTime ${String(S(t.stats, "fromDateTime"))} · bootstrapped ${String(S(t.stats, "bootstrapped"))} · bills_frontier ${String(st.get("bills_frontier"))} · wide ${String(S(t.stats, "wide"))} (bills_wide_at was absent)`);
  await L.db.batch(["DELETE FROM sync_queue", "DELETE FROM sync_state", "DELETE FROM bills"], "write");
  stub.bills.clear();
  const before = Date.now() - 7 * DAY_MS;
  const t2 = await tick("the first tick on an empty bills table", {});
  const fb = Date.parse(String(S(t2.stats, "frontierBefore") ?? ""));
  check("on an empty bills table, the 7-day default", S(t2.stats, "bootstrapped") === true && Math.abs(fb - before) <= 5 * SECOND, `frontierBefore ${String(S(t2.stats, "frontierBefore"))} against seven days before the call ${isoS(before)}`);
}

// ── H ──
async function legH() {
  say(`\n── H, the wide listing`);
  say(`  never done: an entry Congress.gov indexed after the frontier passed it is never listed again`);
  let F = floorS(Date.now() - 30 * MIN);
  while (dayOf(F - MIN) !== dayOf(F + MIN)) { say("  (the frontier is within a minute of midnight UTC; waiting 2 minutes)"); await sleep(2 * MIN); F = floorS(Date.now() - 30 * MIN); }
  await setup({ frontier: isoS(F) });
  const [h1, h2, h3] = L.ids.slice(500, 503) as [string, string, string];
  const L1 = floorS(Date.now() - 30 * HOUR);
  const L2 = L1 + 5 * SECOND;
  const S2 = Math.max(startOfUtcDay(L2), L2 - HOUR);
  const S3 = F - MIN;
  const N3 = F + MIN;
  stub.update(h1, { instant: L1 });
  stub.update(h2, { instant: L2 });
  stub.update(h3, { instant: N3 });
  await L.db.execute({ sql: "UPDATE bills SET update_date = ? WHERE id = ?", args: [isoS(S2), h2] });
  await L.db.execute({ sql: "UPDATE bills SET update_date = ? WHERE id = ?", args: [isoS(S3), h3] });
  say(`  frontier ${isoS(F)}, bills_wide_at absent · h1 ${h1} listed ${isoS(L1)}, stored ${isoS(L.baseAt.get(h1)!)} (an older day) · h2 ${h2} listed ${isoS(L2)}, stored ${isoS(S2)} (the same day) · h3 ${h3} stored ${isoS(S3)}, updated ${isoS(N3)} after the frontier, the same day`);
  const t1 = await tick("tick 1, the listings (maxResets: 0)", { maxResets: 0 });
  const queued = new Set((await queueRows()).map((r) => String(r.bill_id)));
  const st = await syncState();
  const wideFrom = isoS(F - 48 * HOUR);
  const fromList = [...new Set(stub.listLog.map((l) => l.from))];
  say(`  list requests' fromDateTime: ${fromList.join(", ")} · queued after tick 1: ${[h1, h2, h3].map((id) => `${id} ${queued.has(id) ? "queued" : "not queued"}`).join(" · ")} · skipped ${String(S(t1.stats, "skipped"))}`);
  check("the wide listing ran from the frontier less 48 hours and wrote bills_wide_at", S(t1.stats, "wide") === true && S(t1.stats, "wideComplete") === true && fromList.includes(wideFrom) && (st.get("bills_wide_at") ?? "").slice(0, 10) === dayOf(Date.now()), `wide ${String(S(t1.stats, "wide"))} · wideComplete ${String(S(t1.stats, "wideComplete"))} · from ${wideFrom} requested ${fromList.includes(wideFrom)} · bills_wide_at ${String(st.get("bills_wide_at"))}`);
  check("an entry stamped 30 h ago whose stored day is older is queued; one whose stored day equals its list day is not", queued.has(h1) && !queued.has(h2) && Number(S(t1.stats, "skipped")) >= 1, `h1 ${queued.has(h1)} · h2 ${queued.has(h2)} · skipped ${String(S(t1.stats, "skipped"))}`);
  check("the frontier listing still queues a same-day second update past the frontier (the wide listing's day compare passes over it: skipped counts h2 and h3)", queued.has(h3) && S(t1.stats, "skipped") === 2, `h3 ${queued.has(h3)} · skipped ${String(S(t1.stats, "skipped"))}`);
  const t2 = await tick("tick 2, the same tick run again", {});
  const st2 = await storedUpdates([h1, h2, h3]);
  check("run again: wide false, and the queue drains h1 and h3, never h2", S(t2.stats, "wide") === false && st2.get(h1) === isoS(L1) && st2.get(h3) === isoS(N3) && st2.get(h2) === isoS(S2) && !stub.detailById.has(h2), `wide ${String(S(t2.stats, "wide"))} · h1 ${st2.get(h1)} · h2 ${st2.get(h2)} (fetched ${stub.detailById.get(h2) ?? 0}) · h3 ${st2.get(h3)}`);
}

// ── P ── added to the handoff's A to H: the pass's own code (enqueueBackfill, drainRounds) on the copy.
async function legP() {
  say(`\n── P, the pass (added to A-H): --enqueue's and --drain's own code on the copy, against the stub`);
  say(`  never done: the box's drain takes the cron's rows or the cron's takes the box's, a round runs past its reset cap, and the summary hole grows past its bound`);
  const now = floorS(Date.now());
  await setup({ wideAt: true, frontier: isoS(now - 6 * HOUR) });
  const ids = L.ids.slice(700, 712);
  const x = ids[0]!;
  const live = L.ids[720]!;
  ids.forEach((id, k) => stub.update(id, { instant: now - 8 * HOUR + k * SECOND }));
  stub.update(x, { instant: now - 2 * HOUR });
  ids.slice(1, 5).forEach((id) => stub.update(id, { actionDate: dayOf(now), actionText: "Received in the Senate." }));
  stub.update(live, { instant: now - 7 * HOUR });
  const rows: CensusRow[] = ids.map((id) => ({ id, cls: "behind", day: dayOf(L.baseAt.get(id)!) }));
  const had1 = await enqueueBackfill(L.db, rows);
  const had2 = await enqueueBackfill(L.db, rows);
  await L.db.execute({ sql: "INSERT INTO sync_queue (bill_id, list_update_day, source, enqueued_at) VALUES (?, ?, 'live', ?)", args: [live, dayOf(now - 7 * HOUR), new Date().toISOString()] });
  const q0 = await queueRows();
  const x0 = q0.find((r) => r.bill_id === x);
  say(`  12 behind rows enqueued as backfill from a census-shaped list (the first ${x} also updated after the frontier, 4 of the rest with a new latest action), and one live row ${live}`);
  check("enqueueBackfill is idempotent", had1 === 0 && had2 === 12 && q0.length === 13 && q0.filter((r) => r.source === "backfill").length === 12, `already queued on the first run ${had1}, on the second ${had2} · rows ${q0.length}`);
  await tick("a live listing that names X (maxResets: 0, so nothing drains)", { maxResets: 0 });
  const x1 = (await queueRows()).find((r) => r.bill_id === x);
  check("the live listing takes the backfill row over, keeps its enqueued_at, and takes the later list day", x1?.source === "live" && x1?.enqueued_at === x0?.enqueued_at && x1?.list_update_day === dayOf(now - 2 * HOUR), `${x}: source ${String(x0?.source)} → ${String(x1?.source)} · enqueued_at ${String(x0?.enqueued_at)} → ${String(x1?.enqueued_at)} · list day ${String(x0?.list_update_day)} → ${String(x1?.list_update_day)}`);

  // The drain, cap 2, the hole's bound 0 above its start; the fake sleep stands in for the summarizer, one bill a call.
  const holeFile = async () => asNum(objs(await L.db.execute("SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_summarize_queue WHERE summary IS NULL"))[0]?.n) ?? 0;
  const h0 = await holeFile();
  const roundResets: number[] = [];
  let sleeps = 0;
  const deps: DrainDeps = {
    runSync: async (o) => { const s = await L.sync.runSync(o); roundResets.push(Number((s as unknown as Stats).resets)); return s; },
    hole: holeFile,
    sleepUntil: async () => { sleeps++; await L.db.execute("UPDATE bills SET summary = 'P-LEG SUMMARIZED' WHERE id = (SELECT id FROM bills WHERE summary IS NULL ORDER BY id LIMIT 1)"); },
  };
  const r = await drainRounds(deps, { cap: 2, go: false, h0, onePct: 0, checkpointAt: 1_000, stopAt: 1e9, haltAt: 1e9 });
  const q2 = await queueRows();
  const fresh = await freshCount(ids.slice(1));
  const keptSeed = await Promise.all(ids.slice(5).map(async (id) => (await bill(id)).summary === L.seedRows.find((s) => s.id === id)?.summary));
  const shown = q2.map((row) => `${String(row.bill_id)} ${String(row.source)}`).join(", ");
  say(`  the drain: ended ${r.ended} · rounds ${r.rounds}, resets a round ${roundResets.join(", ")} · waits on the hole ${r.waits} · sleeps ${sleeps} · queue after ${shown}`);
  check("the box's drain empties the backfill queue and leaves both live rows", r.ended === "empty" && q2.length === 2 && q2.every((row) => row.source === "live") && q2.some((row) => row.bill_id === live) && q2.some((row) => row.bill_id === x), `queue after: ${shown}`);
  check("no round passes the reset cap, and the 4 resets land across the rounds", roundResets.every((n) => n <= 2) && r.sum.resets === 4 && r.sum.written === 11 && fresh === 11, `resets a round ${roundResets.join(", ")} · written ${r.sum.written} · at the new instant ${fresh} of 11`);
  check("a round waits while the hole is past its bound, and the metadata-only writes keep their summaries", r.waits >= 1 && keptSeed.every(Boolean), `waits ${r.waits} · the 7 metadata-only kept their seed summary: ${keptSeed.filter(Boolean).length}`);

  // The checkpoint: stopped without --go, halted past the halt line even with it.
  const more = L.ids.slice(730, 736);
  more.forEach((id, k) => stub.update(id, { instant: now - 8 * HOUR + k * SECOND, actionDate: dayOf(now), actionText: "Received in the Senate." }));
  await enqueueBackfill(L.db, more.map((id) => ({ id, cls: "behind", day: dayOf(L.baseAt.get(id)!) })));
  const free: DrainDeps = { runSync: L.sync.runSync, hole: async () => 0, sleepUntil: async () => {} };
  const s1 = await drainRounds(free, { cap: 1, go: false, h0: 0, onePct: 0, checkpointAt: 1, stopAt: 0, haltAt: 1e9 });
  const left1 = (await queueRows()).filter((row) => row.source === "backfill").length;
  const s2 = await drainRounds(free, { cap: 1, go: true, h0: 0, onePct: 0, checkpointAt: 1, stopAt: 0, haltAt: 0 });
  const left2 = (await queueRows()).filter((row) => row.source === "backfill").length;
  check("the checkpoint stops a run without --go, and halts one past the halt line with it", s1.ended === "stopped" && left1 === 5 && s2.ended === "halted" && left2 === 4, `without --go: ${s1.ended}, ${left1} left · with --go past the halt line: ${s2.ended}, ${left2} left`);
}

async function legs() {
  const base = !readFileSync("lib/sync.ts", "utf8").includes("CONGRESS_API_BASE");
  const self = process.argv[1] ? readFileSync(process.argv[1]) : Buffer.from("");
  if (!existsSync(SEED_FILE)) throw new Error(`no seed at ${SEED_FILE}: run --seed first`);
  const seedText = readFileSync(SEED_FILE, "utf8");
  const seedRows = (JSON.parse(seedText) as { rows: SeedRow[] }).rows;
  const head = spawnSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const dirty = spawnSync("git", ["status", "--porcelain", "--", "lib/sync.ts", "app/api/sync/route.ts", "scripts/migrate.ts"], { encoding: "utf8" }).stdout.split("\n").filter(Boolean);
  say(`  HEAD ${head}${dirty.length ? ` with uncommitted changes to ${dirty.map((l) => l.slice(3)).join(", ")}` : ""} · lib/sync.ts sha256 ${sha256(readFileSync("lib/sync.ts")).slice(0, 16)} · this script sha256 ${sha256(self).slice(0, 16)} · seed sha256 ${sha256(seedText).slice(0, 16)} (${seedRows.length} rows) · ${base ? "BASE: lib/sync.ts has no CONGRESS_API_BASE seam" : "HEAD: lib/sync.ts reads CONGRESS_API_BASE"}`);

  // The tripwire first, then the stub, then the env: no network beyond 127.0.0.1 from here on.
  installTripwire(() => `http://127.0.0.1:${stub.port}/v3`, base);
  // A throw inside the handler answers 500: the list fetch carries no timeout, so an unanswered request would hang the leg.
  const server = createServer((req, res) => {
    handleStub(req, res).catch((e) => { say(`  stub error: ${(e as Error).message}`); if (!res.headersSent) res.writeHead(500); res.end(); });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  stub.port = (server.address() as AddressInfo).port;
  process.env.CONGRESS_API_BASE = `http://127.0.0.1:${stub.port}/v3`;
  process.env.CONGRESS_API_KEY = LEGS_KEY;

  mkdirSync(SCRATCH, { recursive: true });
  const file = path.join(SCRATCH, `legs-790-${base ? "base" : "head"}-${Date.now()}.db`);
  const url = `file:${file}`;
  if (!url.startsWith("file:")) throw new Error("refused: the legs get file: only");
  const env = { ...process.env, TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "", DOTENV_CONFIG_PATH: path.join(SCRATCH, "no-such-790.env"), DOTENV_CONFIG_QUIET: "true" };
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env, encoding: "utf8" });
  if (mig.status !== 0) throw new Error(`migrate against the copy failed: ${(mig.stderr || mig.stdout).slice(-600)}`);
  const migLines = mig.stdout.split(/\r?\n/).filter((l) => /sync_queue|sync_state/.test(l));
  say(`  the copy ${file}, built by scripts/migrate.ts (exit ${mig.status}): ${migLines.join(" · ") || "no sync_queue line"} · the stub on 127.0.0.1:${stub.port}`);
  process.env.TURSO_DATABASE_URL = url;
  process.env.TURSO_AUTH_TOKEN = "";
  const dbm = (await import(pathToFileURL(path.resolve("lib/db.ts")).href)) as DbModule;
  const sync = (await import(pathToFileURL(path.resolve("lib/sync.ts")).href)) as SyncModule;
  const db = dbm.getDb();
  const queue = (await db.execute("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sync_queue'")).rows.length > 0;

  // Base instants: the seed in its own update_date order, spread from 20 days ago to 3 days ago, so every leg's window
  // after MAX(update_date) is empty until the leg moves a bill into it.
  const now0 = floorS(Date.now());
  const ordered = [...seedRows].sort((a, b) => a.update_date.localeCompare(b.update_date) || a.id.localeCompare(b.id));
  const baseAt = new Map<string, number>();
  ordered.forEach((r, i) => baseAt.set(r.id, floorS(now0 - 20 * DAY_MS + Math.floor((i * 17 * DAY_MS) / (ordered.length - 1)))));
  const M = Math.max(...baseAt.values());
  L = { sync, db, queue, base, seedRows, ids: seedRows.map((r) => r.id), baseAt, M };

  const all: Array<[string, () => Promise<void>]> = [
    ["A", legA], ["B", async () => { await legB(undefined); await legB(0); }], ["C", legC], ["D", legD],
    ["E", legE], ["F", legF], ["G", legG], ["H", legH], ["P", legP],
  ];
  const only = argAt("--only")?.split(",").map((s) => s.trim().toUpperCase());
  const pick = all.filter(([k]) => (only ? only.includes(k) : base ? ["A", "E", "F"].includes(k) : true));
  const verdicts: string[] = [];
  for (const [k, fn] of pick) {
    legFails = 0;
    const r0 = refused.length;
    const w0 = rewritten;
    try {
      await fn();
    } catch (e) {
      legFails++;
      fails++;
      say(`  FAIL  leg ${k} threw: ${redactSecrets(String((e as Error).stack ?? e)).split("\n").slice(0, 4).join(" | ")}`);
    }
    say(`  leg ${k}: ${legFails ? `RED (${legFails} check(s) failed)` : "GREEN"} · tripwire: ${refused.length - r0} refused${base ? ` · ${rewritten - w0} rewritten to the stub` : ""}`);
    verdicts.push(`${k} ${legFails ? "red" : "green"}`);
  }
  say(`\n── legs: ${verdicts.join(" · ")} · checks ${passes} passed, ${fails} failed · tripwire ${refused.length} refused in all${refused.length ? `: ${refused.slice(0, 5).join(", ")}` : ""}${base ? ` · ${rewritten} rewritten to the stub` : ""}`);
  server.close();
  db.close();
}

// ── --census ────────────────────────────────────────────────────────────────
type CensusRow = { id: string; cls: string; day: string };
function readCensus(label: string): CensusRow[] {
  const file = path.join(ART788, `census-${label}.csv`);
  const lines = readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean);
  const head = (lines[0] ?? "").split(",");
  const col = (n: string) => { const i = head.indexOf(n); if (i < 0) throw new Error(`census-${label}.csv has no ${n} column`); return i; };
  const [ci, cc, cud, cudit] = [col("id"), col("class"), col("list_updateDate"), col("list_updateDateIncludingText")];
  return lines.slice(1).map((l) => {
    const f = l.split(",");
    return { id: f[ci] ?? "", cls: f[cc] ?? "", day: (f[cudit] || f[cud] || "").slice(0, 10) };
  });
}
async function census() {
  const label = argAt("--label") ?? "790a";
  const file = path.join(ART788, `census-${label}.csv`);
  if (existsSync(file)) {
    say(`\n── census-${label}.csv already on the box (written ${when(statSync(file).mtime)}): read, not re-run`);
  } else {
    say(`\n── running the HO 788 census: bills-gap-788.ts --census --no-details --label ${label}`);
    const r = spawnSync(process.execPath, [TSX, "scripts/diagnostic/bills-gap-788.ts", "--census", "--no-details", "--label", label], { stdio: "inherit" });
    if (r.status !== 0 || !existsSync(file)) throw new Error(`the census exited ${r.status} and wrote ${existsSync(file) ? "its file" : "no file"}`);
  }
  const rows = readCensus(label);
  const today = dayOf(Date.now());
  const yesterday = dayOf(Date.now() - DAY_MS);
  const missing = rows.filter((r) => r.cls === "missing");
  const behind = rows.filter((r) => r.cls === "behind");
  const older = behind.filter((r) => r.day < yesterday);
  say(`  census-${label}: missing ${fmtN(missing.length)} · behind ${fmtN(behind.length)}: listed today (${today}) ${behind.filter((r) => r.day === today).length}, yesterday (${yesterday}) ${behind.filter((r) => r.day === yesterday).length}, older ${fmtN(older.length)}`);
  if (older.length) say(`  behind and listed before yesterday, up to 50 (the residual, if this census follows a finished pass): ${older.slice(0, 50).map((r) => `${r.id} (${r.day})`).join(", ")}`);
  if (missing.length) say(`  missing, up to 50: ${missing.slice(0, 50).map((r) => `${r.id} (${r.day})`).join(", ")}`);
}

// ── the pass's writes, shared by --enqueue and --drain on prod and by leg P on the copy ─────────────────────────
type Db = Pick<Client, "execute">;
// A census row into sync_queue as 'backfill'. A row already queued keeps its enqueued_at and its source (a live row
// stays the cron's) and takes the later list day. Returns how many were already queued.
async function enqueueBackfill(db: Db, rows: CensusRow[]): Promise<number> {
  const now = new Date().toISOString();
  let had = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const ids = chunk.map((r) => r.id);
    const existing = await db.execute({ sql: `SELECT bill_id FROM sync_queue WHERE bill_id IN (${ids.map(() => "?").join(",")})`, args: ids });
    had += existing.rows.length;
    await db.execute({
      sql: `INSERT INTO sync_queue (bill_id, list_update_day, source, enqueued_at) VALUES ${chunk.map(() => "(?, ?, 'backfill', ?)").join(", ")}
            ON CONFLICT(bill_id) DO UPDATE SET list_update_day = MAX(excluded.list_update_day, sync_queue.list_update_day)`,
      args: chunk.flatMap((r) => [r.id, r.day, now]),
    });
  }
  return had;
}

type DrainSum = { fetched: number; written: number; resets: number; byAction: number; byText: number; crs: number; crsOnly: number; title: number; failed: number; dropped: number };
type DrainDeps = { runSync: SyncModule["runSync"]; hole: () => Promise<number>; sleepUntil: (t: number) => Promise<void> };
type DrainCfg = { cap: number; go: boolean; h0: number; onePct: number; checkpointAt: number; stopAt: number; haltAt: number };
// 90 s past a 10-minute boundary (the summarizer's */10 tick has started by then), the first such instant ahead.
function nextBoundary(): number {
  const t = Math.floor(Date.now() / (10 * MIN)) * 10 * MIN + 90 * SECOND;
  return t > Date.now() ? t : t + 10 * MIN;
}
// Rounds of the cron's drain on the backfill queue, each ending at the reset cap, the next 90 s past the next 10-minute
// boundary, a round held while the pass's addition to the summary hole is over 1% of the corpus; the checkpoint at
// the first round boundary at or past checkpointAt drained.
async function drainRounds(deps: DrainDeps, cfg: DrainCfg): Promise<{ sum: DrainSum; rounds: number; waits: number; ended: "empty" | "stopped" | "halted" }> {
  const sum: DrainSum = { fetched: 0, written: 0, resets: 0, byAction: 0, byText: 0, crs: 0, crsOnly: 0, title: 0, failed: 0, dropped: 0 };
  let checked = false;
  let waits = 0;
  for (let round = 1; ; round++) {
    for (;;) {
      const h = await deps.hole();
      if (h - cfg.h0 <= cfg.onePct) break;
      const t = nextBoundary();
      waits++;
      say(`  round ${round} waits: the hole is ${fmtN(h)}, ${fmtN(h - cfg.h0)} over its start, past ${fmtN(cfg.onePct)}; next look ${when(t)}`);
      await deps.sleepUntil(t);
    }
    const t0 = Date.now();
    const s = (await deps.runSync({ source: "backfill", listing: false, maxResets: cfg.cap })) as unknown as Stats;
    const n = (k: string) => asNum(s[k]) ?? 0;
    const fetched = n("upserted") + n("failed");
    sum.fetched += fetched;
    sum.written += n("upserted");
    sum.resets += n("resets");
    sum.byAction += n("resetByAction");
    sum.byText += n("resetByText");
    sum.crs += n("crsMoved");
    sum.crsOnly += n("crsOnly");
    sum.title += n("titleMoved");
    sum.failed += n("failed");
    sum.dropped += n("droppedCount");
    const left = n("queueAfter");
    say(`  round ${round} · ${when(t0)} · fetched ${fetched} · written ${n("upserted")} · resets ${n("resets")} (by action ${n("resetByAction")}, by text ${n("resetByText")}) · kept ${n("upserted") - n("resets")} · CRS count moved ${n("crsMoved")} (with no reset ${n("crsOnly")}) · title moved ${n("titleMoved")} · failed ${n("failed")} · dropped ${n("droppedCount")}${Array.isArray(s.dropped) && s.dropped.length ? ` [${(s.dropped as string[]).join(", ")}]` : ""} · queue left ${fmtN(left)} · ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    say(`    so far: fetched ${fmtN(sum.fetched)} · written ${fmtN(sum.written)} · resets ${fmtN(sum.resets)} (by action ${sum.byAction}, by text ${sum.byText}, by both ${sum.byAction + sum.byText - sum.resets}) · kept ${fmtN(sum.written - sum.resets)} · CRS count moved ${sum.crs} (with no reset ${sum.crsOnly}) · title moved ${sum.title} · failed ${sum.failed} · dropped ${sum.dropped}`);
    if (!checked && sum.written >= cfg.checkpointAt) {
      checked = true;
      const projected = Math.round(sum.resets + (sum.resets / sum.written) * left);
      say(`  checkpoint, ${fmtN(sum.written)} drained: resets ${sum.resets} of them, projected over the ${fmtN(left)} left: ${fmtN(projected)} for the run`);
      if (projected > cfg.haltAt) { say(`  OVER ${fmtN(cfg.haltAt)}: HALT. The number goes to the architect before anything continues.`); return { sum, rounds: round, waits, ended: "halted" }; }
      if (projected > cfg.stopAt && !cfg.go) { say(`  over ${fmtN(cfg.stopAt)}: stopped. About 1,500 Gemini tokens a reset; continuing is Corey's call, given as --go on the same command.`); return { sum, rounds: round, waits, ended: "stopped" }; }
    }
    if (left === 0) { say(`  the backfill queue is empty`); return { sum, rounds: round, waits, ended: "empty" }; }
    const t = nextBoundary();
    say(`  next round ${when(t)}`);
    await deps.sleepUntil(t);
  }
}

// ── --enqueue ───────────────────────────────────────────────────────────────
async function enqueueCensus() {
  const label = argAt("--census");
  if (!label) throw new Error("--enqueue needs --census <label>");
  const rows = readCensus(label).filter((r) => r.cls === "missing" || r.cls === "behind");
  const undated = rows.filter((r) => !/^\d{4}-\d{2}-\d{2}$/.test(r.day));
  if (undated.length) throw new Error(`census-${label}.csv: ${undated.length} row(s) with no list day, e.g. ${undated.slice(0, 5).map((r) => r.id).join(", ")}`);
  const before = objs(await q("enqueue · the queue before, by source", "SELECT source, COUNT(*) AS n FROM sync_queue GROUP BY source"));
  say(`\n── enqueue census-${label}: ${fmtN(rows.length)} rows (missing ${rows.filter((r) => r.cls === "missing").length}, behind ${rows.filter((r) => r.cls === "behind").length}) into sync_queue with source 'backfill'`);
  say(`  the queue before: ${before.map((r) => `${r.source} ${r.n}`).join(" · ") || "empty"}`);
  say(`  WRITING to ${dbHost()} (TURSO_DATABASE_URL) in five seconds: Ctrl-C now to stop`);
  await sleep(5_000);
  const had = await enqueueBackfill(prod(), rows);
  const after = objs(await q("enqueue · the queue after, by source", "SELECT source, COUNT(*) AS n FROM sync_queue GROUP BY source"));
  const ids = rows.map((r) => r.id);
  let present = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const part = ids.slice(i, i + 500);
    present += asNum(objs(await prod().execute({ sql: `SELECT COUNT(*) AS n FROM sync_queue WHERE bill_id IN (${part.map(() => "?").join(",")})`, args: part }))[0]?.n) ?? 0;
  }
  say(`  newly queued ${fmtN(rows.length - had)} · already queued ${fmtN(had)} (kept their source and enqueued_at) · the queue after: ${after.map((r) => `${r.source} ${r.n}`).join(" · ")} · the census's ids in the queue now ${fmtN(present)} of ${fmtN(rows.length)}`);
}

// ── --drain ─────────────────────────────────────────────────────────────────
async function drainPass() {
  const cap = Number(argAt("--reset-cap") ?? "150");
  const go = process.argv.includes("--go");
  if (!Number.isInteger(cap) || cap < 1) throw new Error("--reset-cap takes a positive integer");
  // The hole through the summarizer's own partial index (idx_bills_summarize_queue, WHERE summary IS NULL), so a
  // read costs about the hole's size rather than the table's; the corpus is read once.
  const hole = async () => asNum(objs(await q("drain · the summary hole", "SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_summarize_queue WHERE summary IS NULL"))[0]?.n) ?? 0;
  const depth = async () => asNum(objs(await q("drain · the backfill queue's depth", "SELECT COUNT(*) AS n FROM sync_queue WHERE source = 'backfill'"))[0]?.n) ?? 0;
  const corpus = asNum(objs(await q("drain · the corpus", "SELECT COUNT(*) AS n FROM bills"))[0]?.n) ?? 0;
  const h0 = await hole();
  const onePct = Math.round(corpus / 100);
  const d0 = await depth();
  say(`\n── drain the backfill queue: ${fmtN(d0)} rows · reset cap ${cap} a round · the hole at the start ${fmtN(h0)} of ${fmtN(corpus)} bills; a round waits while the pass's addition is over ${fmtN(onePct)} (1%)${go ? " · --go given" : ""}`);
  if (d0 === 0) return;
  say(`  WRITING to ${dbHost()} (TURSO_DATABASE_URL) through runSync in five seconds: Ctrl-C now to stop`);
  await sleep(5_000);
  const { runSync } = (await import("../../lib/sync")) as SyncModule;
  const r = await drainRounds(
    { runSync, hole, sleepUntil: (t) => sleep(Math.max(0, t - Date.now())) },
    { cap, go, h0, onePct, checkpointAt: 300, stopAt: 2_000, haltAt: 4_000 },
  );
  say(`  the run ended ${r.ended} after ${r.rounds} round(s), ${r.waits} wait(s) on the hole · the backfill queue now ${fmtN(await depth())}`);
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!MODE) {
    console.error("usage: npx tsx scripts/diagnostic/sync-frontier-790.ts --step0 | --seed | --legs [--only A,F] | --census [--label L] | --enqueue --census L | --drain [--reset-cap N] [--go]");
    process.exitCode = 2;
    return;
  }
  if (MODE !== "--legs") config({ path: ".env", quiet: true });
  const start = new Date();
  const label = argAt("--label");
  say(`HO 790 ${MODE}${label ? ` · label ${label}` : ""} · start ${when(start)} · the ${CONGRESS}th Congress · node ${process.version}`);
  let failure: Error | null = null;
  try {
    if (MODE === "--step0") await step0();
    else if (MODE === "--seed") await seed();
    else if (MODE === "--legs") await legs();
    else if (MODE === "--enqueue") await enqueueCensus();
    else if (MODE === "--drain") await drainPass();
    else await census();
  } catch (e) {
    failure = e as Error;
    say(`\n  ${redactSecrets(String(failure.stack ?? failure.message)).split("\n").slice(0, 6).join("\n  ")}`);
  } finally {
    say(`\n  prod statements ${stmts} · end ${when(new Date())} · ${((Date.now() - start.getTime()) / 1000).toFixed(1)} s`);
    save(`${MODE.slice(2)}${label ? `-${label}` : ""}-${start.toISOString().replace(/[:.]/g, "").slice(0, 15)}.log`, `${out.join("\n")}\n`);
    readDb?.close();
  }
  if (failure || fails) process.exitCode = 1;
}

main().catch((e) => {
  console.error(redactSecrets(String((e as Error)?.stack ?? e)));
  process.exitCode = 1;
});
