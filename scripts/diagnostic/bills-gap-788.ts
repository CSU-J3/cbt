// HO 788: the bills Congress.gov lists for the current Congress that CT lacks or holds behind, named by type and
// number; each one's cause read off /api/sync's own ledger (cron_runs), a join rather than an inference; and the gap
// repaired through the sync's own code. Read-only except --repair.
//
//   npx tsx scripts/diagnostic/bills-gap-788.ts --step0    [--label L]
//   npx tsx scripts/diagnostic/bills-gap-788.ts --ticks    [--label L]
//   npx tsx scripts/diagnostic/bills-gap-788.ts --census   [--no-details] [--vs <repair label>[,<repair label>…]] [--label L]
//   npx tsx scripts/diagnostic/bills-gap-788.ts --impact   [--of <census label>] [--label L]
//   npx tsx scripts/diagnostic/bills-gap-788.ts --repair   --allow <census label> [--residual-of <repair label>] [--from <ISO>] [--label L]
//   npx tsx scripts/diagnostic/bills-gap-788.ts --readings [--of <census label>] [--label L]
//
// --step0    STEP 0: claims 1 and 2 re-derived from the tree; prod's bills and sync_state (3); /api/sync's ledger, read
//            at the handoff's JSON path and at the one lib/cron-log.ts writes (4); Congress.gov's count for the
//            Congress and for each of its eight types (5); the field the list's fromDateTime filters on (6); claim 7's
//            SKILL anchors.
// --ticks    /api/sync's history, one statement over cron_runs: the count, by status, the budget stops by month, the
//            distributions of runSync's stats and of each tick's window (started_at minus fromDateTime), and what a
//            budget-stopped tick gets through.
// --census   prod's snapshot of the Congress's bills; Congress.gov's whole list (sort=updateDate desc, 250 a page, no
//            fromDateTime, every page saved, each tied page boundary re-read in one window centred on it, HO 752);
//            each listed bill classed missing, behind, ahead or current by the compare lib/sync.ts makes (:386,
//            :392-396); stored bills not listed as extra; each missing or behind bill's two dates to the second off one
//            detail read (the list prints only the day), gated on the population (MAX_DETAIL_READS) and skipped with
//            --no-details; and, given those dates, its owed tick, the first cron_runs row whose window
//            [fromDateTime, started_at) holds its date. Writes census-<label>.csv. --vs reads the census against the
//            repairs named: the allow-set now, the control now, and every row stamped since the first one started.
// --impact   what --repair would set going, read before it runs off a census's saved files: the behind bills holding a
//            summary the upsert nulls, those with a newer latest action, the committee walks owed, the summarizer's
//            measured throughput and tokens, and the Congress.gov quota left. Read-only.
// --repair   the HO 788 ruling's repair: runSync({ fromDateTime: <the Congress's first day> }) from lib/sync.ts, in
//            process, with no deadline, writing the allow-set and nothing else. The allow-set is the census's missing
//            and its behind with a newer latest action (the predicate at buildAllow), each dated strictly before the
//            watermark instant, MAX(update_date) read immediately before the run (the frontier, restated at flags 1 and
//            2: a bill listed on an earlier day than the watermark's is in on its list date; one listed on the
//            watermark's day is placed by one detail read, before the instant in, at or after it the cron's). The rest
//            of the list is shaped on the read side only (the tap's repairView): a stored bill outside the allow-set
//            reads current, an unstored one reads undated; nothing marks a bill current in the store. A write-time
//            guard in the same view removes `bill` from any detail response dated at or past the instant, so the
//            watermark cannot move. It prints the database host beside the one SKILL names as the DB primary, the
//            watermark, the frontier-day placements and the allow-set's size, pauses five seconds, runs, then reads
//            back what it stamped (changed_at) against the allow-set. --residual-of repairs what an earlier run's
//            allow-set left unstamped; --from <ISO> sets fromDateTime by hand (pass 2).
// --readings the stored bills a census's walks never returned, one detail read each (200: Congress.gov still has it,
//            so it was not dropped, and why no walk returned it is unsettled, the walk losing it or the list lagging
//            its detail; 404: Congress.gov dropped it), and the precision of the dates on the census's saved pages.
//
// SAFETY. Prod is written by --repair's runSync and by nothing else: every statement the instrument itself runs goes
// through q(), which refuses anything but SELECT or WITH … SELECT and any statement naming a write keyword; prod's
// schema is fingerprinted before and after every mode. One globalThis.fetch wrapper, installed before the first
// database call, taps every request the process makes, runSync's included (lib/db.ts:70 hands its client
// boundedFetch, which calls the global fetch at :46 and :53): rows_read and rows_written are summed off each hrana
// pipeline result, and each Congress.gov request is counted by endpoint and status, one in flight and at least 250 ms
// between starts. TURSO_DATABASE_URL, TURSO_AUTH_TOKEN and CONGRESS_API_KEY are read from .env by name. The
// instrument's own Congress.gov requests carry the key in the X-Api-Key header, never a URL; runSync's carry it in the
// query, as production does, and the tap prints none of their URLs. Every printed or saved line passes redactSecrets.
// Times print in Mountain Time on a 12-hour clock with UTC beside.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type ResultSet, type Row } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getCurrentCongress, ordinal } from "@/lib/congress";
import { redactSecrets } from "@/lib/redact";
import { runSync, type SyncStats } from "@/lib/sync";

config({ path: ".env", quiet: true });

const ART = path.resolve("docs/handoffs/788-artifacts"); // repo-ignored
const LEDGER = path.join(ART, "rows-ledger.tsv");
const MT = "America/Denver";
const API = "https://api.congress.gov/v3";
const ROUTE = "/api/sync";
const PAGE = 250; // lib/sync.ts:8, the sync's own page size
const GAP_MS = 250; // Congress.gov: one request in flight, at least 250 ms between starts
const BILL_TYPES = ["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"] as const;
const CONGRESS = getCurrentCongress();
// The Congress's first day, derived from the Congress as lib/congress.ts:1-8 derives the Congress from the date: the
// 119th began 2025-01-03, and each later one two years on.
const FIRST_DAY = new Date(Date.UTC(2025 + 2 * (CONGRESS - 119), 0, 3)).toISOString().replace(/\.\d{3}Z$/, "Z");
// The ruling's guard: a repair starts no nearer than ten minutes to an /api/sync tick, before or after it. Its writes stay
// below the watermark instant, so a tick it overlaps writes other bills and reads the same watermark.
const TICK_MARGIN_MS = 10 * 60_000;
// A census's per-bill detail reads are gated on their population first: pass 1 ran 8,876 of them past a broken bound.
const MAX_DETAIL_READS = 1_200;
// The residual a census --vs places against the watermark, one detail read a bill, gated the same way.
const VS_PLACEMENTS = 200;

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const MODES = ["--step0", "--ticks", "--census", "--impact", "--repair", "--readings"] as const;
type Mode = (typeof MODES)[number];
const MODE: Mode | undefined = MODES.find((m) => process.argv.includes(m));
const LABEL = argAt("--label") ?? "r1";

const out: string[] = [];
const say = (s = "") => { const r = redactSecrets(s); out.push(r); process.stdout.write(`${r}\n`); };
const results: Record<string, unknown> = {};
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const fmtN = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();
const save = (name: string, body: string) => { mkdirSync(ART, { recursive: true }); writeFileSync(path.join(ART, name), redactSecrets(body)); };
const billId = (congress: number | string, type: string, number: number | string) => `${congress}-${String(type).toLowerCase()}-${number}`;
const iso = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const at = (o: unknown, ...keys: string[]): unknown =>
  keys.reduce<unknown>((v, k) => (v !== null && typeof v === "object" ? (v as Record<string, unknown>)[k] : undefined), o);
const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const asStr = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const asBool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : v === 1 ? true : v === 0 ? false : null);
// A Congress.gov date as an instant: a bare date is that day's 00:00Z, a timestamp is itself.
function instant(s: string | null | undefined): number | null {
  if (!s) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  return Number.isNaN(t) ? null : t;
}
const precision = (s: string | null | undefined) => (!s ? "none" : /^\d{4}-\d{2}-\d{2}$/.test(s) ? "date" : /T\d{2}:\d{2}:\d{2}/.test(s) ? "timestamp" : "other");
// Nearest rank: the p-quantile is the value at rank ceil(p × n).
function quantiles(xs: number[]) {
  const a = xs.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  if (!a.length) return null;
  const rank = (p: number) => a[Math.min(a.length - 1, Math.max(0, Math.ceil(p * a.length) - 1))]!;
  return { n: a.length, min: a[0]!, median: rank(0.5), p90: rank(0.9), max: a[a.length - 1]! };
}
const qStr = (xs: number[], digits = 0) => {
  const d = quantiles(xs);
  const f = (x: number) => (digits ? x.toFixed(digits) : fmtN(x));
  return d ? `n ${fmtN(d.n)} · min ${f(d.min)} · median ${f(d.median)} · p90 ${f(d.p90)} · max ${f(d.max)}` : "n 0";
};
function table(head: string[], rows: Array<Array<string | number | null>>) {
  const cells = [head, ...rows.map((r) => r.map((c) => (c === null ? "–" : typeof c === "number" ? fmtN(c) : c)))];
  const w = head.map((_, i) => Math.max(...cells.map((r) => String(r[i] ?? "").length)));
  cells.forEach((r, k) => {
    say(`    ${r.map((c, i) => String(c ?? "").padEnd(w[i] ?? 0)).join("  ").trimEnd()}`);
    if (k === 0) say(`    ${w.map((n) => "-".repeat(n)).join("  ")}`);
  });
}
const tally = <K extends string>(xs: K[]) => xs.reduce((m, k) => m.set(k, (m.get(k) ?? 0) + 1), new Map<K, number>());

// ── time ────────────────────────────────────────────────────────────────────
const mtFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: MT, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});
const mtMonth = new Intl.DateTimeFormat("en-CA", { timeZone: MT, year: "numeric", month: "2-digit" });
// "Oct 20, 2026, 2:05 PM MT (2026-10-20 20:05:13Z)"
function when(x: unknown): string {
  if (x == null || x === "") return String(x);
  const d = x instanceof Date ? x : new Date(String(x));
  if (Number.isNaN(d.getTime())) return `${String(x)} (unparsed)`;
  return `${mtFmt.format(d)} MT (${d.toISOString().slice(0, 19).replace("T", " ")}Z)`;
}

// ── the tap: every request this process makes, runSync's included ──────────
const DB_HOST = (() => { try { return new URL(process.env.TURSO_DATABASE_URL ?? "").host; } catch { return ""; } })();
const realFetch: typeof fetch = globalThis.fetch.bind(globalThis);
const tap = {
  db: { requests: 0, results: 0, rowsRead: 0, rowsWritten: 0, noRead: 0, noWritten: 0 },
  // rows_read and rows_written by statement: each result paired by position with the statement its request body sent
  dbBy: new Map<string, { n: number; read: number; written: number }>(),
  cg: {
    requests: 0, inFlight: 0, maxInFlight: 0, minGapMs: Number.POSITIVE_INFINITY, lastStart: 0,
    byEndpoint: new Map<string, number>(), byStatus: new Map<string, number>(), byEndpointStatus: new Map<string, number>(),
    quota: { limit: null as string | null, remaining: null as string | null, at: "" },
  },
  other: 0,
};
// The repair's read-side view (the ruling's constraint 1, with flag 2's clause), live only while --repair's runSync
// runs. On each page of runSync's own list (/bill/{congress} with fromDateTime) a stored entry outside the allow-set
// reads current: both dates set to the bill's stored update_date, so the compare at lib/sync.ts:393 skips it. An
// unstored entry outside the allow-set reads undated: both its dates are removed, so :387-391 skips it. An allow-set
// entry listed after the watermark's day reads as outside (the frontier, applied as the walk reads it); one listed on
// it passes, and the guard places it. Page lengths are unchanged, so :434 walks to the end. The write-time guard: a
// detail response whose date as the upsert takes it (updateDateIncludingText ?? updateDate, :72-74) is at or past the
// watermark instant has its `bill` removed, so :411-414 counts it failed and writes nothing; each is named. Every other
// detail response passes untouched, and each one's id and dates are recorded.
type RepairTap = {
  allow: Set<string>; stored: Map<string, string>; wDay: string; wMs: number;
  entries: number; passed: number; rewritten: number; cleared: number;
  passedIds: Map<string, string>; frontierLive: string[]; clearedIds: string[]; guarded: string[]; precision: Map<string, number>;
  pages: Array<{ offset: string | null; n: number; passed: number; rewritten: number; cleared: number }>;
  details: Array<{ id: string; status: number; ud: string | null; udit: string | null; guarded: boolean }>;
};
let repairTap: RepairTap | null = null;
const bump = (m: Map<string, number>, k: string) => m.set(k, (m.get(k) ?? 0) + 1);
function urlOf(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return (input as { url: string }).url;
}
// "/bill/{congress}/{type}/{number}", with " ?fromDateTime" when the request carries one.
function endpointOf(u: URL): string {
  const parts = u.pathname.replace(/^\/v3\/?/, "").split("/").filter(Boolean);
  const names = ["bill", "{congress}", "{type}", "{number}"];
  const ep = parts[0] === "bill" ? `/${parts.map((p, i) => names[i] ?? p).join("/")}` : `/${parts.join("/")}`;
  return u.searchParams.has("fromDateTime") ? `${ep} ?fromDateTime` : ep;
}
// A statement's key: one line, a run of placeholders folded, cut to 72 characters.
const sqlKey = (sql: string) => oneLine(sql).replace(/\?(\s*,\s*\?)+/g, "?…").slice(0, 72);
function addDb(r: unknown, key: string) {
  if (r === null || typeof r !== "object") return;
  tap.db.results += 1;
  const rr = (r as { rows_read?: unknown }).rows_read;
  const rw = (r as { rows_written?: unknown }).rows_written;
  if (typeof rr === "number") tap.db.rowsRead += rr; else tap.db.noRead += 1;
  if (typeof rw === "number") tap.db.rowsWritten += rw; else tap.db.noWritten += 1;
  const b = tap.dbBy.get(key) ?? { n: 0, read: 0, written: 0 };
  b.n += 1;
  b.read += typeof rr === "number" ? rr : 0;
  b.written += typeof rw === "number" ? rw : 0;
  tap.dbBy.set(key, b);
}
type HranaReq = { type?: string; stmt?: { sql?: string }; batch?: { steps?: Array<{ stmt?: { sql?: string } }> } };
// The hrana client sends a Request whose body is the pipeline's JSON (@libsql/hrana-client http/stream.js:305); a clone
// is read, so the request itself goes out unconsumed.
async function requestsOf(input: RequestInfo | URL, init?: RequestInit): Promise<HranaReq[]> {
  try {
    const body = typeof (input as Request).clone === "function" ? await (input as Request).clone().text() : typeof init?.body === "string" ? init.body : "";
    return body ? ((JSON.parse(body) as { requests?: HranaReq[] }).requests ?? []) : [];
  } catch {
    return [];
  }
}
async function repairView(rt: RepairTap, u: URL, parts: string[], res: Response): Promise<Response> {
  if (parts.length === 2 && parts[0] === "bill" && u.searchParams.has("fromDateTime") && res.status === 200) {
    const text = await res.text();
    const headers = new Headers(res.headers);
    for (const h of ["content-length", "content-encoding", "transfer-encoding"]) headers.delete(h);
    let j: { bills?: ListEntry[] } | null = null;
    try { j = JSON.parse(text) as { bills?: ListEntry[] }; } catch { j = null; }
    if (!j || !Array.isArray(j.bills)) return new Response(text, { status: res.status, statusText: res.statusText, headers });
    const page = { offset: u.searchParams.get("offset"), n: j.bills.length, passed: 0, rewritten: 0, cleared: 0 };
    for (const e of j.bills) {
      rt.entries += 1;
      bump(rt.precision, `updateDate ${precision(e.updateDate)}`);
      bump(rt.precision, `updateDateIncludingText ${precision(e.updateDateIncludingText)}`);
      const id = billId(e.congress ?? CONGRESS, e.type ?? "?", e.number ?? "?");
      const listed = e.updateDateIncludingText ?? e.updateDate ?? null;
      const allowed = rt.allow.has(id);
      if (allowed && listed !== null && listed.slice(0, 10) <= rt.wDay) {
        rt.passed += 1;
        page.passed += 1;
        rt.passedIds.set(id, listed);
        continue;
      }
      if (allowed) rt.frontierLive.push(`${id} (listed ${listed})`);
      const s = rt.stored.get(id);
      if (s) {
        e.updateDate = s;
        e.updateDateIncludingText = s;
        rt.rewritten += 1;
        page.rewritten += 1;
      } else {
        delete e.updateDate;
        delete e.updateDateIncludingText;
        rt.cleared += 1;
        page.cleared += 1;
        rt.clearedIds.push(`${id} (listed ${listed})`);
      }
    }
    rt.pages.push(page);
    return new Response(JSON.stringify(j), { status: res.status, statusText: res.statusText, headers });
  }
  if (parts.length === 4 && parts[0] === "bill") {
    const id = billId(parts[1] ?? "?", parts[2] ?? "?", parts[3] ?? "?");
    if (res.status !== 200) {
      rt.details.push({ id, status: res.status, ud: null, udit: null, guarded: false });
      return res;
    }
    const text = await res.text();
    const headers = new Headers(res.headers);
    for (const h of ["content-length", "content-encoding", "transfer-encoding"]) headers.delete(h);
    let j: Record<string, unknown> | null = null;
    try { j = JSON.parse(text) as Record<string, unknown>; } catch { j = null; }
    const ud = asStr(at(j, "bill", "updateDate"));
    const udit = asStr(at(j, "bill", "updateDateIncludingText"));
    const t = instant(udit ?? ud);
    const guarded = j !== null && t !== null && t >= rt.wMs;
    rt.details.push({ id, status: res.status, ud, udit, guarded });
    if (j && guarded) {
      delete j.bill;
      rt.guarded.push(`${id} (${udit ?? ud})`);
      say(`    [guard] ${id}: its detail reads ${udit ?? ud}, at or past the watermark ${iso(rt.wMs)}; \`bill\` removed, so runSync counts it failed and writes nothing`);
      return new Response(JSON.stringify(j), { status: res.status, statusText: res.statusText, headers });
    }
    return new Response(text, { status: res.status, statusText: res.statusText, headers });
  }
  return res;
}
let cgChain: Promise<unknown> = Promise.resolve();
async function tapped(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  let u: URL | null = null;
  try { u = new URL(urlOf(input)); } catch { u = null; }
  if (u && DB_HOST && u.host === DB_HOST) {
    tap.db.requests += 1;
    const reqs = await requestsOf(input, init);
    const res = await realFetch(input, init);
    try {
      const j = (await res.clone().json()) as { results?: Array<{ response?: { type?: string; result?: unknown } }> };
      (j.results ?? []).forEach((r, i) => {
        const resp = r?.response;
        const rq = reqs[i];
        if (resp?.type === "execute") addDb(resp.result, rq?.stmt?.sql ? sqlKey(rq.stmt.sql) : "(unattributed)");
        else if (resp?.type === "batch") {
          ((at(resp.result, "step_results") as unknown[] | undefined) ?? []).forEach((s, k) => {
            const sql = rq?.batch?.steps?.[k]?.stmt?.sql;
            addDb(s, sql ? sqlKey(sql) : "(unattributed)");
          });
        }
      });
    } catch {
      /* not a pipeline response */
    }
    return res;
  }
  if (u && u.host === "api.congress.gov") {
    const url = u;
    const ep = endpointOf(url);
    const parts = url.pathname.replace(/^\/v3\/?/, "").split("/").filter(Boolean);
    const run = async (): Promise<Response> => {
      const wait = tap.cg.lastStart + GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      const now = Date.now();
      if (tap.cg.lastStart) tap.cg.minGapMs = Math.min(tap.cg.minGapMs, now - tap.cg.lastStart);
      tap.cg.lastStart = now;
      tap.cg.requests += 1;
      tap.cg.inFlight += 1;
      tap.cg.maxInFlight = Math.max(tap.cg.maxInFlight, tap.cg.inFlight);
      bump(tap.cg.byEndpoint, ep);
      try {
        const res = await realFetch(input, init);
        bump(tap.cg.byStatus, String(res.status));
        bump(tap.cg.byEndpointStatus, `${ep} → ${res.status}`);
        const remaining = res.headers.get("x-ratelimit-remaining");
        if (remaining !== null) tap.cg.quota = { limit: res.headers.get("x-ratelimit-limit"), remaining, at: new Date().toISOString() };
        return repairTap ? await repairView(repairTap, url, parts, res) : res;
      } catch (e) {
        bump(tap.cg.byStatus, "no answer");
        bump(tap.cg.byEndpointStatus, `${ep} → no answer`);
        throw e;
      } finally {
        tap.cg.inFlight -= 1;
      }
    };
    const p = cgChain.then(run, run);
    cgChain = p.catch(() => undefined);
    return p;
  }
  tap.other += 1;
  return realFetch(input, init);
}
globalThis.fetch = tapped as typeof fetch;

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
  if (!/^\s*(SELECT|WITH)\b/i.test(sql) || WRITE_WORD.test(sql)) throw new Error(`HALT: the instrument writes nothing, and this is not a SELECT: ${label}`);
  const before = tap.db.rowsRead;
  const t = Date.now();
  const rs = await prod().execute({ sql, args });
  stmts += 1;
  const shownArgs = Array.isArray(args) && args.length ? `  · args ${JSON.stringify(args)}` : "";
  say(`  [q] ${label}`);
  say(`      ${oneLine(sql)}${shownArgs}`);
  say(`      → ${fmtN(rs.rows.length)} row(s) · rows_read ${fmtN(tap.db.rowsRead - before)} · ${Date.now() - t}ms · read ${when(new Date())}`);
  return rs;
}
const objs = (rs: ResultSet) => rs.rows.map((r: Row) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i] ?? null])) as Record<string, unknown>);
async function schemaPrint(): Promise<string> {
  const rs = await q("the schema fingerprint (sqlite_master)", `SELECT type, name, sql FROM sqlite_master ORDER BY type, name`);
  return createHash("sha256").update(JSON.stringify(rs.rows.map((r) => [r.type, r.name, r.sql]))).digest("hex").slice(0, 16);
}

// ── Congress.gov, the instrument's own requests ─────────────────────────────
const KEY = (process.env.CONGRESS_API_KEY ?? "").trim();
let useHeader = true;
let ownCalls = 0;
type Got = { status: number; json: unknown; bytes: number; ms: number; at: Date; limit: string | null; remaining: string | null };
async function cg(label: string, pathAndQuery: string): Promise<Got> {
  if (!KEY) throw new Error("CONGRESS_API_KEY is not set in .env");
  const url = `${API}${pathAndQuery}${pathAndQuery.includes("?") ? "&" : "?"}format=json`;
  for (let attempt = 1; ; attempt++) {
    const t0 = Date.now();
    let status = 0;
    let body = "";
    let err = "";
    let limit: string | null = null;
    let remaining: string | null = null;
    try {
      const res = useHeader
        ? await fetch(url, { headers: { "X-Api-Key": KEY, Accept: "application/json" }, signal: AbortSignal.timeout(60_000) })
        : await fetch(`${url}&api_key=${encodeURIComponent(KEY)}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(60_000) });
      status = res.status;
      limit = res.headers.get("x-ratelimit-limit");
      remaining = res.headers.get("x-ratelimit-remaining");
      body = await res.text();
    } catch (e) {
      err = (e as Error).message;
    }
    ownCalls += 1;
    const ms = Date.now() - t0;
    say(`    GET ${url} → ${status || "no answer"}${err ? ` (${err})` : ""} · ${fmtN(body.length)} bytes · ${ms}ms · ${label}${attempt > 1 ? ` · attempt ${attempt}` : ""}${useHeader ? "" : " · key in the query, redacted"}`);
    if (status === 403 && useHeader && ownCalls === 1) {
      useHeader = false;
      say(`    the X-Api-Key header was refused; the key rides the query string from here, and redactSecrets strips it from every printed line`);
      continue;
    }
    if (status === 200 && !err) {
      let json: unknown = null;
      try { json = JSON.parse(body); } catch { json = null; }
      if (json !== null) return { status, json, bytes: body.length, ms, at: new Date(), limit, remaining };
    }
    // A body cut off mid-read (200 headers, then "terminated") or one that doesn't parse is retried like a 5xx: the
    // second census's first run stopped on one at its 24th page.
    if ((status === 0 || status === 429 || status >= 500 || status === 200) && attempt < 3) { await sleep(5000 * attempt); continue; }
    return { status, json: null, bytes: body.length, ms, at: new Date(), limit, remaining };
  }
}
type ListEntry = {
  congress?: number; type?: string; number?: string; title?: string;
  updateDate?: string; updateDateIncludingText?: string; latestAction?: { actionDate?: string; text?: string };
};
const billsOf = (j: unknown) => ((at(j, "bills") as ListEntry[] | undefined) ?? []);
const countOf = (j: unknown) => asNum(at(j, "pagination", "count"));

// ── STEP 0: the tree ────────────────────────────────────────────────────────
const treeLines = (file: string) => readFileSync(file, "utf8").split(/\r?\n/);
const findLines = (file: string, re: RegExp) => treeLines(file).flatMap((l, i) => (re.test(l) ? [i + 1] : []));
let anchorsDiffer = 0;
function anchor(file: string, from: number, to: number, re: RegExp, what: string) {
  const ls = treeLines(file).slice(from - 1, to);
  const ok = re.test(ls.join("\n"));
  if (!ok) anchorsDiffer += 1;
  say(`  ${ok ? "as stated" : "DIFFERS  "} · ${file}:${to === from ? from : `${from}-${to}`} · ${what}`);
  if (!ok) ls.forEach((l, i) => say(`        ${from + i}: ${l}`));
}
function claims1and2() {
  say(`\n── claim 1: the base`);
  const head = git(["rev-parse", "HEAD"]);
  const main = git(["rev-parse", "main"]);
  const originMain = git(["rev-parse", "origin/main"]);
  say(`  HEAD ${head} (${git(["branch", "--show-current"])}) · main ${main} · origin/main ${originMain}`);
  const roadmap = treeLines("docs/roadmap.md");
  const pointers = roadmap.flatMap((l, i) => { const m = /Also notes now run through HO (\d+)/.exec(l); return m ? [{ line: i + 1, ho: Number(m[1]) }] : []; });
  const last = pointers[pointers.length - 1];
  say(`  the roadmap pointer, the last "Also notes now run through HO N": HO ${last?.ho} at docs/roadmap.md:${last?.line} (the file is ${fmtN(roadmap.length)} lines)`);
  const hos = git(["log", "--format=%s"]).split("\n").flatMap((s) => [...s.matchAll(/\bHO (\d+)\b/g)].map((m) => Number(m[1])));
  const top = hos.reduce((a, b) => Math.max(a, b), 0);
  say(`  the highest HO in commit subjects: ${top}`);
  const numbered = readdirSync("docs/handoffs").flatMap((f) => { const m = /^(\d+)-/.exec(f); return m && Number(m[1]) > 787 ? [f] : []; });
  say(`  numbered handoff files above 787: ${numbered.join(", ") || "none"}`);
  results.claim1 = { head, main, originMain, pointer: last, highestSubjectHo: top, numberedAbove787: numbered };

  say(`\n── claim 2: the anchors, at HEAD ${head.slice(0, 7)}`);
  const S = "lib/sync.ts";
  anchor(S, 72, 74, /function effectiveUpdate[\s\S]*b\.updateDateIncludingText \?\? b\.updateDate/, "effectiveUpdate: updateDateIncludingText ?? updateDate");
  anchor(S, 98, 108, /function listUrl[\s\S]*fromDateTime,[\s\S]*sort: "updateDate desc"[\s\S]*limit: String\(PAGE_SIZE\)[\s\S]*\/bill\/\$\{getCurrentCongress\(\)\}/, "listUrl: /bill/{getCurrentCongress()}, fromDateTime, sort updateDate desc, 250 a page");
  anchor(S, 115, 118, /function defaultFromDateTime[\s\S]*7 \* 24 \* 60 \* 60 \* 1000/, "an empty table's watermark: seven days ago");
  anchor(S, 125, 130, /async function getWatermark[\s\S]*SELECT MAX\(update_date\) AS m FROM bills"/, "the watermark: MAX(update_date) over bills, no Congress clause");
  anchor(S, 195, 195, /update_date = excluded\.update_date/, "the upsert writes update_date");
  anchor(S, 277, 277, /^\s*update,\s*$/, "the upsert's update_date argument is effectiveUpdate(detail)");
  anchor(S, 323, 323, /const fromDateTime = opts\.fromDateTime \?\? \(await getWatermark\(db\)\)/, "fromDateTime: opts.fromDateTime ?? the watermark");
  anchor(S, 342, 351, /HO 116 caveat[\s\S]*skipped until\s+\/\/ they update again on their own[\s\S]*explicit cursor in `sync_state`/, "HO 116's caveat, and the resolution it names");
  anchor(S, 352, 359, /pageLoop: while \(true\)[\s\S]*Date\.now\(\) >= deadlineMs[\s\S]*budgetStopped = true[\s\S]*break;/, "the deadline check before each page");
  anchor(S, 375, 382, /Date\.now\(\) >= deadlineMs[\s\S]*budgetStopped = true[\s\S]*break pageLoop;/, "the deadline check before each bill");
  anchor(S, 386, 386, /const listUpdate = effectiveUpdate\(lb\);/, "the list's date, effectiveUpdate(lb)");
  anchor(S, 393, 396, /if \(stored && stored >= listUpdate\) \{[\s\S]*skipped\+\+;[\s\S]*continue;/, "the stored compare, a string >=");
  anchor(S, 398, 402, /re-attempted naturally on the next tick/, "the comment: a timed-out bill is re-attempted naturally on the next tick");
  anchor(S, 416, 416, /await upsertBill\(db, detail\);/, "each bill is written as it goes");
  anchor(S, 434, 434, /if \(bills\.length < PAGE_SIZE\) break;/, "the last page is the short one");
  const R = "app/api/sync/route.ts";
  anchor(R, 25, 25, /const SYNC_BUDGET_MS = 30_000;/, "SYNC_BUDGET_MS = 30_000");
  anchor(R, 100, 100, /runSync\(\{ deadlineMs: routeStart \+ SYNC_BUDGET_MS \}\)/, "the route passes a deadline and nothing else");
  anchor(R, 109, 109, /expireTag\("bills"\)/, "the route expires the bills tag");
  anchor(R, 140, 154, /payload: \{[\s\S]*timings,[\s\S]*sync,[\s\S]*reportCatchup:[\s\S]*tradesPlanCap,/, "the route's payload: timings, sync, reportCatchup, tradesPlanCap");
  anchor("scripts/sync.ts", 4, 4, /runSync\(\)\.catch/, "scripts/sync.ts passes nothing");
  anchor("scripts/migrate.ts", 281, 285, /CREATE TABLE IF NOT EXISTS sync_state \([\s\S]*key TEXT PRIMARY KEY/, "sync_state, a key/value table");
  anchor("scripts/migrate.ts", 501, 510, /CREATE TABLE IF NOT EXISTS cron_runs \([\s\S]*route TEXT NOT NULL,[\s\S]*started_at TEXT NOT NULL,[\s\S]*status TEXT NOT NULL,[\s\S]*payload TEXT,/, "cron_runs: route, started_at, ended_at, status, payload");
  anchor("scripts/diagnostic/ratings-daily-771.ts", 135, 135, /DELETE FROM cron_runs/, "the one DELETE FROM cron_runs, on a file: copy");
  const deletes = git(["grep", "-n", "DELETE FROM cron_runs"]).split("\n").filter(Boolean);
  say(`  ${deletes.length === 1 ? "as stated" : "DIFFERS  "} · git grep "DELETE FROM cron_runs" (tracked files): ${deletes.join(" | ")}`);
  if (deletes.length !== 1) anchorsDiffer += 1;
  anchor("lib/cron-log.ts", 48, 48, /new Date\(\)\.toISOString\(\)/, "started_at is written with milliseconds");
  anchor("lib/congress.ts", 1, 8, /export function getCurrentCongress[\s\S]*Date\.UTC\(year, 0, 3\)/, "getCurrentCongress");
  anchor("lib/db.ts", 46, 46, /return await fetch\(input,/, "boundedFetch calls the global fetch");
  anchor("lib/db.ts", 53, 53, /return await fetch\(retryInput,/, "and again on its retry");
  anchor("lib/db.ts", 70, 70, /_db = createClient\(\{ url, authToken, fetch: boundedFetch \}\);/, "runSync's client is handed boundedFetch");
  // Two things the handoff's prose leans on, read rather than carried in:
  anchor("lib/cron-log.ts", 170, 171, /const responseBody = \{ ok: true as const, elapsedMs, payload: result\.payload \};[\s\S]*finishCronRun\(runId, "success", responseBody/, "a success row's payload column holds { ok, elapsedMs, payload }, so the route's sync lands at $.payload.sync");
  const syncState = git(["grep", "-n", "-w", "sync_state", "--", "app", "lib", "scripts", "components"]).split("\n").filter(Boolean);
  say(`  read      · the word sync_state in app, lib, scripts and components: ${syncState.join(" | ")}`);
  results.claim2 = { anchorsDiffer };
  say(`  claim 2: ${anchorsDiffer === 0 ? "every anchor reads as stated" : `${anchorsDiffer} anchor(s) DIFFER: HALT`}`);
}
function claim7() {
  say(`\n── claim 7: docs/probes and SKILL's anchors (not gating; re-derived for the SKILL commit)`);
  say(`  docs/probes: ${readdirSync("docs/probes").join(", ")}`);
  const K = ".claude/skills/cbt/SKILL.md";
  const checks: Array<[string, number, RegExp]> = [
    ["the rate limit", 46, /Rate limit is \*\*20,000 requests per hour\*\*/],
    ["the updateDate gotcha", 90, /^- `updateDate` and `updateDateIncludingText` are different fields/],
    ["Sync logic", 1230, /^## Sync logic$/],
    ["its step 1", 1234, /^1\. Read `MAX\(update_date\)`/],
    ["its step 5", 1238, /^5\. Find rows where `summary IS NULL`/],
    ["the local-run line", 1241, /^Run via `pnpm tsx scripts\/sync\.ts` locally/],
    ["the HO 135 watch", 1342, /^\*\*HO 135 watch\.\*\*/],
    ["Backfill scripts", 1344, /^### Backfill scripts$/],
  ];
  const found: Record<string, number[]> = {};
  for (const [what, stated, re] of checks) {
    const lines = findLines(K, re);
    found[what] = lines;
    say(`  ${lines.length === 1 && lines[0] === stated ? "as stated" : "MOVED    "} · ${what}: stated :${stated}, read :${lines.join(", :") || "none"}`);
  }
  results.claim7 = { probes: readdirSync("docs/probes"), skill: found };
}

// ── STEP 0: prod ────────────────────────────────────────────────────────────
async function claim3() {
  say(`\n── claim 3: prod's bills and sync_state (record)`);
  const byType = objs(await q(
    "3 · bills by Congress and type: COUNT, MIN and MAX of bill_number, MIN and MAX update_date, MIN introduced_date",
    `SELECT congress, bill_type, COUNT(*) AS n, MIN(bill_number) AS min_num, MAX(bill_number) AS max_num,
            MIN(update_date) AS min_upd, MAX(update_date) AS max_upd, MIN(introduced_date) AS min_intro
     FROM bills GROUP BY congress, bill_type ORDER BY congress, bill_type`,
  ));
  const all = byType.reduce((s, r) => s + Number(r.n), 0);
  const mine = byType.filter((r) => Number(r.congress) === CONGRESS);
  const inCongress = mine.reduce((s, r) => s + Number(r.n), 0);
  say(`  COUNT(*) of bills: ${fmtN(all)} · of bills WHERE congress = ${CONGRESS}: ${fmtN(inCongress)}`);
  table(["congress", "type", "count", "MIN(bill_number)", "MAX(bill_number)"], byType.map((r) => [String(r.congress), String(r.bill_type), Number(r.n), Number(r.min_num), Number(r.max_num)]));
  const minOf = (k: string) => mine.map((r) => r[k]).filter((v): v is string => typeof v === "string").sort()[0] ?? null;
  const maxOf = (k: string) => mine.map((r) => r[k]).filter((v): v is string => typeof v === "string").sort().pop() ?? null;
  say(`  the ${ordinal(CONGRESS)} Congress: MIN(update_date) ${minOf("min_upd")} · MAX(update_date) ${maxOf("max_upd")} · MIN(introduced_date) ${minOf("min_intro")}`);
  const wm = objs(await q("3 · the watermark, as lib/sync.ts:126 reads it (no Congress clause)", `SELECT MAX(update_date) AS m FROM bills`))[0];
  say(`  the watermark: ${String(wm?.m)} = ${when(wm?.m)}`);
  const months = objs(await q(
    "3 · the Congress's bills by month of update_date (substr 1-7), and by the stored date's length",
    `SELECT substr(update_date, 1, 7) AS month, length(update_date) AS len, COUNT(*) AS n FROM bills WHERE congress = ? GROUP BY month, len ORDER BY month, len`,
    [CONGRESS],
  ));
  table(["month", "length", "bills"], months.map((r) => [String(r.month), Number(r.len), Number(r.n)]));
  const ss = objs(await q("3 · sync_state, whole", `SELECT * FROM sync_state`));
  say(`  sync_state: ${ss.length} row(s)${ss.length ? `: ${JSON.stringify(ss)}` : ""}`);
  results.claim3 = { all, inCongress, byType, watermark: wm?.m ?? null, months, syncState: ss };
}
async function claim4() {
  say(`\n── claim 4: /api/sync's ledger (record)`);
  const a = objs(await q(
    "4 · the route's rows: count, first and last started_at; the handoff's path ($.sync.*) beside the path lib/cron-log.ts:170-171 writes ($.payload.sync.*)",
    `SELECT COUNT(*) AS n, MIN(started_at) AS first, MAX(started_at) AS last,
       SUM(json_type(payload, '$.sync') IS NOT NULL) AS rows_top,
       SUM(json_extract(payload, '$.sync.budgetStopped') = 1) AS bs_top,
       SUM(json_extract(payload, '$.sync.failed')) AS failed_top,
       SUM(json_extract(payload, '$.sync.timedOut')) AS timedout_top,
       SUM(json_type(payload, '$.payload.sync') IS NOT NULL) AS rows_wrapped,
       SUM(json_extract(payload, '$.payload.sync.budgetStopped') = 1) AS bs_wrapped,
       SUM(json_extract(payload, '$.payload.sync.failed')) AS failed_wrapped,
       SUM(json_extract(payload, '$.payload.sync.timedOut')) AS timedout_wrapped
     FROM cron_runs WHERE route = ?`,
    [ROUTE],
  ))[0] ?? {};
  const v = (x: unknown) => (x === null || x === undefined ? "NULL" : fmtN(Number(x)));
  say(`  rows ${v(a.n)} · first started_at ${when(a.first)} · last ${when(a.last)}`);
  say(`  the handoff's path, $.sync.*:          rows carrying it ${v(a.rows_top)} · budgetStopped = 1 ${v(a.bs_top)} · SUM(failed) ${v(a.failed_top)} · SUM(timedOut) ${v(a.timedout_top)}`);
  say(`  the path written, $.payload.sync.*:    rows carrying it ${v(a.rows_wrapped)} · budgetStopped = 1 ${v(a.bs_wrapped)} · SUM(failed) ${v(a.failed_wrapped)} · SUM(timedOut) ${v(a.timedout_wrapped)}`);
  const st = objs(await q("4 · by status", `SELECT status, COUNT(*) AS n, MIN(started_at) AS first, MAX(started_at) AS last FROM cron_runs WHERE route = ? GROUP BY status ORDER BY n DESC`, [ROUTE]));
  table(["status", "rows", "first", "last"], st.map((r) => [String(r.status), Number(r.n), when(r.first), when(r.last)]));
  const head = objs(await q(
    "4 · where the ledger begins: the first three rows, fromDateTime at both paths",
    `SELECT id, started_at, status, json_extract(payload, '$.sync.fromDateTime') AS from_top, json_extract(payload, '$.payload.sync.fromDateTime') AS from_wrapped
     FROM cron_runs WHERE route = ? ORDER BY started_at LIMIT 3`,
    [ROUTE],
  ));
  for (const r of head) say(`  #${r.id} · ${when(r.started_at)} · ${r.status} · $.sync.fromDateTime ${String(r.from_top)} · $.payload.sync.fromDateTime ${String(r.from_wrapped)}`);
  const firstKnown = objs(await q(
    "4 · the first row that names its window",
    `SELECT id, started_at, status, COALESCE(json_extract(payload, '$.payload.sync.fromDateTime'), json_extract(payload, '$.sync.fromDateTime')) AS from_dt
     FROM cron_runs WHERE route = ? AND COALESCE(json_extract(payload, '$.payload.sync.fromDateTime'), json_extract(payload, '$.sync.fromDateTime')) IS NOT NULL
     ORDER BY started_at LIMIT 1`,
    [ROUTE],
  ))[0];
  say(`  the ledger begins: #${firstKnown?.id} started ${when(firstKnown?.started_at)}, its fromDateTime ${String(firstKnown?.from_dt)} = ${when(firstKnown?.from_dt)}`);
  results.claim4 = { totals: a, byStatus: st, head, firstKnown };
}
async function claim5() {
  say(`\n── claim 5: Congress.gov's counts (record)`);
  const one = await cg(`5 · the ${ordinal(CONGRESS)} Congress`, `/bill/${CONGRESS}?limit=1`);
  const total = countOf(one.json);
  const first = billsOf(one.json)[0];
  say(`  /bill/${CONGRESS}: pagination.count ${total === null ? "unread" : fmtN(total)} · read ${when(one.at)}${first ? ` · its entry: updateDate "${first.updateDate}", updateDateIncludingText "${first.updateDateIncludingText}"` : ""}`);
  const per: Record<string, number | null> = {};
  for (const t of BILL_TYPES) {
    const r = await cg(`5 · ${t}`, `/bill/${CONGRESS}/${t}?limit=1`);
    per[t] = countOf(r.json);
    const e = billsOf(r.json)[0];
    say(`  /bill/${CONGRESS}/${t}: pagination.count ${per[t] === null ? "unread" : fmtN(per[t]!)} · read ${when(r.at)}${e ? ` · its entry: updateDate "${e.updateDate}", updateDateIncludingText "${e.updateDateIncludingText}"` : ""}`);
  }
  const sum = Object.values(per).reduce<number>((s, n) => s + (n ?? 0), 0);
  const unread = Object.values(per).filter((n) => n === null).length;
  say(`  the eight sum to ${fmtN(sum)}${unread ? ` (${unread} unread)` : ""}; the one reads ${total === null ? "unread" : fmtN(total)}: ${total !== null && !unread ? (sum === total ? "equal" : `a difference of ${fmtN(sum - total)}`) : "not comparable"}`);
  results.claim5 = { total, totalAt: one.at.toISOString(), perType: per, sum };
}
async function claim6() {
  say(`\n── claim 6: the field the list's fromDateTime filters on (record; the reading is the next HO's)`);
  const cands = objs(await q(
    "6 · candidates: stored bills whose raw_json updateDateIncludingText and updateDate differ by an hour or more, the newest update_date first",
    `SELECT id, bill_type, bill_number, update_date,
            json_extract(raw_json, '$.updateDate') AS ud, json_extract(raw_json, '$.updateDateIncludingText') AS udit
     FROM bills
     WHERE congress = ?
       AND abs(julianday(json_extract(raw_json, '$.updateDateIncludingText')) - julianday(json_extract(raw_json, '$.updateDate'))) * 24 >= 1
     ORDER BY update_date DESC LIMIT 10`,
    [CONGRESS],
  ));
  for (const r of cands) say(`    ${r.id} · stored update_date ${r.update_date} · raw_json updateDate ${r.ud} · updateDateIncludingText ${r.udit}`);
  let chosen: { id: string; type: string; number: string; ud: string; udit: string } | null = null;
  for (const r of cands.slice(0, 3)) {
    const d = await cg(`6 · ${r.id}'s detail, the two dates as they stand now`, `/bill/${CONGRESS}/${r.bill_type}/${r.bill_number}`);
    const ud = asStr(at(d.json, "bill", "updateDate"));
    const udit = asStr(at(d.json, "bill", "updateDateIncludingText"));
    say(`    ${r.id} now: updateDate ${ud} · updateDateIncludingText ${udit}`);
    const a = instant(ud);
    const b = instant(udit);
    if (ud && udit && a !== null && b !== null && Math.abs(b - a) >= 3_600_000) {
      chosen = { id: String(r.id), type: String(r.bill_type), number: String(r.bill_number), ud, udit };
      break;
    }
    say(`    the two no longer differ by an hour; the next candidate`);
  }
  if (!chosen) {
    say(`  no candidate holds two dates an hour apart; claim 6 is unread`);
    results.claim6 = { verdict: "unread", candidates: cands };
    return;
  }
  const c = chosen;
  say(`  the bill: ${c.id} · updateDate ${c.ud} · updateDateIncludingText ${c.udit}`);
  const windowRead = async (field: "updateDateIncludingText" | "updateDate", d: string, halfMs: number) => {
    const ms = instant(d)!;
    const from = iso(ms - halfMs);
    const to = iso(ms + halfMs);
    const entries: ListEntry[] = [];
    let count: number | null = null;
    for (let offset = 0; offset < 50 * PAGE; offset += PAGE) {
      const qs = new URLSearchParams({ fromDateTime: from, toDateTime: to, limit: String(PAGE), offset: String(offset) });
      const r = await cg(`6 · D = its ${field} ± ${halfMs / 1000}s`, `/bill/${CONGRESS}/${c.type}?${qs.toString()}`);
      if (r.status !== 200) break;
      count ??= countOf(r.json);
      const page = billsOf(r.json);
      entries.push(...page);
      if (page.length < PAGE) break;
    }
    const hit = entries.find((e) => String(e.number) === c.number);
    say(`    D = ${field} ${d}, [${from}, ${to}]: pagination.count ${count ?? "unread"} · ${fmtN(entries.length)} read · ${hit ? `lists ${c.id} (updateDate "${hit.updateDate}", updateDateIncludingText "${hit.updateDateIncludingText}")` : `does not list ${c.id}`}`);
    return { field, from, to, count, read: entries.length, lists: Boolean(hit), entry: hit ?? null };
  };
  let half = 1000;
  let a = await windowRead("updateDateIncludingText", c.udit, half);
  let b = await windowRead("updateDate", c.ud, half);
  if (!a.lists && !b.lists) {
    half = 60_000;
    say(`  neither window lists it; widened once, to ± 60 s`);
    a = await windowRead("updateDateIncludingText", c.udit, half);
    b = await windowRead("updateDate", c.ud, half);
  }
  const verdict = a.lists && b.lists ? "either" : a.lists ? "updateDateIncludingText" : b.lists ? "updateDate" : "neither";
  say(`  claim 6: fromDateTime filters on ${verdict === "either" ? "either field (both windows list it)" : verdict === "neither" ? "neither field within ± 60 s" : verdict} (windows ± ${half / 1000}s)`);
  results.claim6 = { verdict, half, bill: c, byText: a, byUpdate: b, candidates: cands };
}

// ── --ticks ─────────────────────────────────────────────────────────────────
type Tick = {
  id: number; started: string; startedMs: number; status: string; elapsed: number | null; shape: string;
  seen: number | null; upserted: number | null; skipped: number | null; failed: number | null; timedOut: number | null;
  budgetStopped: boolean | null; from: string | null; fromMs: number | null; tSync: number | null;
};
function parseTick(r: Record<string, unknown>): Tick {
  const payload = asStr(r.payload);
  let j: unknown = null;
  let shape = payload ? "unparsed" : "no payload";
  if (payload) { try { j = JSON.parse(payload); } catch { j = null; } }
  let sync: unknown = null;
  let tSync: unknown = null;
  if (j !== null && typeof j === "object") {
    if (at(j, "payload", "sync")) { shape = "$.payload.sync"; sync = at(j, "payload", "sync"); tSync = at(j, "payload", "timings", "sync"); }
    else if (at(j, "sync")) { shape = "$.sync"; sync = at(j, "sync"); tSync = at(j, "timings", "sync"); }
    else if (at(j, "ok") === false) shape = "failure body, no sync key";
    else shape = "no sync key";
  }
  const from = asStr(at(sync, "fromDateTime"));
  const fromMs = from ? Date.parse(from) : null;
  return {
    id: Number(r.id), started: String(r.started_at), startedMs: Date.parse(String(r.started_at)), status: String(r.status),
    elapsed: asNum(r.elapsed_ms), shape,
    seen: asNum(at(sync, "seen")), upserted: asNum(at(sync, "upserted")), skipped: asNum(at(sync, "skipped")),
    failed: asNum(at(sync, "failed")), timedOut: asNum(at(sync, "timedOut")), budgetStopped: asBool(at(sync, "budgetStopped")),
    from, fromMs: fromMs !== null && Number.isNaN(fromMs) ? null : fromMs, tSync: asNum(tSync),
  };
}
async function ticks() {
  say(`\n── the ledger: /api/sync's history`);
  const rows = objs(await q(
    "every /api/sync row, in order",
    `SELECT id, started_at, ended_at, elapsed_ms, status, payload FROM cron_runs WHERE route = ? ORDER BY started_at`,
    [ROUTE],
  )).map(parseTick);
  const n = rows.length;
  say(`  ${fmtN(n)} rows · first started ${when(rows[0]?.started)} · last ${when(rows[n - 1]?.started)}`);
  table(["status", "rows"], [...tally(rows.map((r) => r.status)).entries()].sort((x, y) => y[1] - x[1]).map(([k, v]) => [k, v]));
  say(`  where the sync's stats sit in the payload column:`);
  table(["shape", "status", "rows"], [...tally(rows.map((r) => `${r.shape}\t${r.status}`)).entries()].sort().map(([k, v]) => [...k.split("\t"), v] as [string, string, number]));
  const withStats = rows.filter((r) => r.budgetStopped !== null);
  const stopped = withStats.filter((r) => r.budgetStopped);
  const syncKey = rows.filter((r) => r.shape === "$.payload.sync" || r.shape === "$.sync");
  say(`  rows whose stats carry budgetStopped: ${fmtN(withStats.length)} · budget-stopped ${fmtN(stopped.length)} (${pct(stopped.length, withStats.length)}) · counted apart: rows with no sync key ${fmtN(n - syncKey.length)}, rows with a sync key but no budgetStopped ${fmtN(syncKey.length - withStats.length)}${syncKey.length - withStats.length ? ` (${syncKey.filter((r) => r.budgetStopped === null).map((r) => `#${r.id} ${when(r.started)}, ${r.shape}`).join("; ")})` : ""}`);
  const months = [...new Set(rows.map((r) => mtMonth.format(new Date(r.startedMs))))].sort();
  say(`  by month (MT, of started_at):`);
  table(["month", "rows", "with stats", "budget-stopped", "share", "failed > 0", "timedOut > 0", "seen > 250", "not success"], months.map((m) => {
    const inM = rows.filter((r) => mtMonth.format(new Date(r.startedMs)) === m);
    const ws = inM.filter((r) => r.budgetStopped !== null);
    const bs = ws.filter((r) => r.budgetStopped).length;
    return [m, inM.length, ws.length, bs, pct(bs, ws.length), ws.filter((r) => (r.failed ?? 0) > 0).length, ws.filter((r) => (r.timedOut ?? 0) > 0).length, ws.filter((r) => (r.seen ?? 0) > PAGE).length, inM.filter((r) => r.status !== "success").length];
  }));
  const nums = (f: (r: Tick) => number | null, xs: Tick[] = withStats) => xs.map(f).filter((x): x is number => x !== null);
  const windowH = (r: Tick) => (r.fromMs === null ? null : (r.startedMs - r.fromMs) / 3_600_000);
  say(`  the distributions over the ${fmtN(withStats.length)} rows carrying stats (nearest rank):`);
  say(`    seen        ${qStr(nums((r) => r.seen))}`);
  say(`    upserted    ${qStr(nums((r) => r.upserted))}`);
  say(`    skipped     ${qStr(nums((r) => r.skipped))}`);
  say(`    failed      ${qStr(nums((r) => r.failed))}`);
  say(`    timedOut    ${qStr(nums((r) => r.timedOut))}`);
  say(`    timings.sync (ms) ${qStr(nums((r) => r.tSync))}`);
  say(`    the window, started_at − fromDateTime (hours) ${qStr(nums(windowH), 1)}`);
  say(`  the budget-stopped ticks alone, what 30 s gets through:`);
  say(`    seen        ${qStr(nums((r) => r.seen, stopped))}`);
  say(`    upserted    ${qStr(nums((r) => r.upserted, stopped))}`);
  say(`    timings.sync (ms) ${qStr(nums((r) => r.tSync, stopped))}`);
  say(`    the window (hours) ${qStr(nums(windowH, stopped), 1)}`);
  const finishedClean = withStats.filter((r) => r.status === "success" && !r.budgetStopped && !(r.failed ?? 0) && !(r.timedOut ?? 0));
  say(`  finished clean (success, not budget-stopped, 0 failed, 0 timed out): ${fmtN(finishedClean.length)} · of them more than one page (seen > ${PAGE}): ${fmtN(finishedClean.filter((r) => (r.seen ?? 0) > PAGE).length)}`);
  const gaps = rows.slice(1).map((r, i) => (r.startedMs - rows[i]!.startedMs) / 3_600_000);
  say(`  the interval between consecutive rows' started_at (hours) ${qStr(gaps, 2)} · intervals over 6.5 h: ${gaps.filter((g) => g > 6.5).length}`);
  const notSuccess = rows.filter((r) => r.status !== "success");
  say(`  the rows not success (${notSuccess.length}):`);
  for (const r of notSuccess.slice(0, 40)) say(`    #${r.id} · ${when(r.started)} · ${r.status} · ${r.elapsed ?? "–"} ms · ${r.shape}`);
  if (notSuccess.length > 40) say(`    … and ${notSuccess.length - 40} more`);
  const firstFrom = rows.find((r) => r.from !== null);
  say(`  the ledger begins: #${firstFrom?.id} started ${when(firstFrom?.started)}, fromDateTime ${firstFrom?.from} = ${when(firstFrom?.from)}`);
  results.ticks = {
    rows: n, withStats: withStats.length, budgetStopped: stopped.length, byStatus: Object.fromEntries(tally(rows.map((r) => r.status))),
    byShape: Object.fromEntries(tally(rows.map((r) => r.shape))),
    capacity: { seen: quantiles(nums((r) => r.seen, stopped)), upserted: quantiles(nums((r) => r.upserted, stopped)) },
    window: quantiles(nums(windowH)), finishedClean: finishedClean.length,
    finishedCleanMultiPage: finishedClean.filter((r) => (r.seen ?? 0) > PAGE).length, ledgerBegins: firstFrom ?? null,
    notSuccess: notSuccess.map((r) => ({ id: r.id, started: r.started, status: r.status })),
  };
}

// ── --census ────────────────────────────────────────────────────────────────
type SavedPage = { walk: "main" | "tie" | "half"; offset: number; count: number | null; at: string; ms: number; bills: ListEntry[] };
async function listPage(walk: SavedPage["walk"], offset: number, note = ""): Promise<SavedPage> {
  const qs = new URLSearchParams({ sort: "updateDate desc", limit: String(PAGE), offset: String(offset) });
  const r = await cg(`${walk} @${offset}${note}`, `/bill/${CONGRESS}?${qs.toString()}`);
  if (r.status !== 200 || r.json === null) throw new Error(`the list @${offset} answered ${r.status || "nothing"}; stopping rather than class bills off a partial list`);
  return { walk, offset, count: countOf(r.json), at: r.at.toISOString(), ms: r.ms, bills: billsOf(r.json) };
}
async function walkFrom(walk: "main" | "half", start: number) {
  const pages: SavedPage[] = [];
  for (let offset = start; pages.length < 400; offset += PAGE) {
    const p = await listPage(walk, offset);
    pages.push(p);
    if (p.bills.length < PAGE) return { pages, ended: true };
  }
  return { pages, ended: false };
}
type OwedTick = {
  id: number; started: string; startedMs: number; status: string; from: string | null; fromMs: number | null; inferred: boolean;
  bs: boolean | null; failed: number | null; timedOut: number | null; seen: number | null;
};
function tickClass(t: OwedTick): string {
  if (t.status !== "success") return `errored (${t.status})`;
  if (t.bs === null) return "success, no stats";
  if (t.bs) return "budget-stopped";
  if ((t.failed ?? 0) > 0 || (t.timedOut ?? 0) > 0) return "failed";
  if ((t.seen ?? 0) > PAGE) return "tie-exposed";
  return "clean";
}
type Owed = { cls: string; first: OwedTick | null; last: OwedTick | null; n: number; lastCls: string };
function owedFor(u: number | null, ticksIn: OwedTick[], ledgerStart: number | null): Owed {
  const none = (cls: string): Owed => ({ cls, first: null, last: null, n: 0, lastCls: cls });
  if (u === null) return none("no date");
  const owing = ticksIn.filter((t) => t.fromMs !== null && t.fromMs <= u && u < t.startedMs);
  if (owing.length) {
    const first = owing[0]!;
    const last = owing[owing.length - 1]!;
    return { cls: tickClass(first), first, last, n: owing.length, lastCls: tickClass(last) };
  }
  if (ledgerStart !== null && u < ledgerStart) return none("before-the-ledger");
  const lastTick = ticksIn[ticksIn.length - 1];
  if (lastTick && u >= lastTick.startedMs) return none("after-the-last-tick");
  return none("uncovered");
}
function ranges(ns: number[]): string {
  const a = [...new Set(ns)].sort((x, y) => x - y);
  const parts: string[] = [];
  let s = a[0];
  let p = a[0];
  for (let i = 1; i <= a.length; i++) {
    const v = a[i];
    if (v !== undefined && p !== undefined && v === p + 1) { p = v; continue; }
    if (s !== undefined && p !== undefined) parts.push(s === p ? `${s}` : `${s}–${p}`);
    s = v;
    p = v;
  }
  return parts.join(", ");
}
async function census() {
  say(`\n── 1. prod's snapshot`);
  const snapRs = await q("1 · the Congress's bills, id, type, number and update_date", `SELECT id, bill_type, bill_number, update_date FROM bills WHERE congress = ?`, [CONGRESS]);
  const snapAt = new Date();
  const stored = new Map<string, { type: string; number: number; upd: string | null }>();
  for (const r of objs(snapRs)) stored.set(String(r.id), { type: String(r.bill_type), number: Number(r.bill_number), upd: asStr(r.update_date) });
  const storedMin = [...stored.values()].map((s) => s.upd).filter((x): x is string => x !== null).sort()[0] ?? null;
  say(`  stored: ${fmtN(stored.size)} bills · read ${when(snapAt)} · MIN(update_date) ${storedMin}`);

  say(`\n── 2. the list, whole: /bill/${CONGRESS}, sort updateDate desc, ${PAGE} a page, no fromDateTime`);
  const t0 = new Date();
  const main = await walkFrom("main", 0);
  const firstCount = main.pages[0]?.count ?? null;
  const lastCount = main.pages[main.pages.length - 1]?.count ?? null;
  const raw = main.pages.flatMap((p) => p.bills);
  const tied: number[] = [];
  for (let b = PAGE; b < raw.length; b += PAGE) if (raw[b - 1]?.updateDate && raw[b - 1]!.updateDate === raw[b]?.updateDate) tied.push(b);
  say(`  the main walk: ${main.pages.length} pages · ${fmtN(raw.length)} entries · paging ${main.ended ? "ended on the short page" : "DID NOT END"} · pagination.count ${firstCount} on the first page, ${lastCount} on the last · tied boundaries (equal updateDate across the boundary): ${tied.length} of ${Math.max(0, main.pages.length - 1)}`);
  const tiePages: SavedPage[] = [];
  for (const b of tied) tiePages.push(await listPage("tie", Math.max(0, b - PAGE / 2), ` (the boundary at ${b}, updateDate ${raw[b]?.updateDate})`));
  const pages: SavedPage[] = [...main.pages, ...tiePages];
  const distinct = () => new Set(pages.flatMap((p) => p.bills.map((e) => billId(e.congress ?? CONGRESS, e.type ?? "?", e.number ?? "?")))).size;
  let complete = main.ended && firstCount !== null && distinct() >= firstCount;
  let half: { pages: SavedPage[]; ended: boolean } | null = null;
  say(`  after the tie windows: ${fmtN(distinct())} distinct ids against pagination.count ${firstCount}: ${complete ? "complete" : "SHORT"}`);
  if (!complete) {
    say(`  short: a second full walk at half-page offsets (${PAGE / 2}, ${PAGE + PAGE / 2}, …), and the union`);
    half = await walkFrom("half", PAGE / 2);
    pages.push(...half.pages);
    complete = main.ended && half.ended && firstCount !== null && distinct() >= firstCount;
    say(`  after the half walk: ${fmtN(distinct())} distinct ids: ${complete ? "complete" : "STILL SHORT"}`);
  }
  const t1 = new Date();
  save(`census-${LABEL}-list.json`, JSON.stringify({ congress: CONGRESS, start: t0.toISOString(), end: t1.toISOString(), firstCount, lastCount, tied, complete, pages }, null, 1));
  say(`  the list read ${when(t0)} to ${when(t1)} · ${pages.length} pages saved to docs/handoffs/788-artifacts/census-${LABEL}-list.json`);

  // The union, one entry an id. An id listed twice with two dates keeps the later (Congress.gov touched it mid-walk).
  type Listed = { id: string; type: string; number: number; ud: string | null; udit: string | null; lu: string | null; action: string | null; times: number };
  const listed = new Map<string, Listed>();
  let conflicts = 0;
  for (const p of pages) for (const e of p.bills) {
    const id = billId(e.congress ?? CONGRESS, e.type ?? "?", e.number ?? "?");
    const lu = e.updateDateIncludingText ?? e.updateDate ?? null; // lib/sync.ts:72-74, :386
    const prev = listed.get(id);
    if (!prev) { listed.set(id, { id, type: String(e.type ?? "?").toLowerCase(), number: Number(e.number), ud: e.updateDate ?? null, udit: e.updateDateIncludingText ?? null, lu, action: e.latestAction?.actionDate ?? null, times: 1 }); continue; }
    prev.times += 1;
    if (prev.lu !== lu) {
      conflicts += 1;
      if ((lu ?? "") > (prev.lu ?? "")) Object.assign(prev, { ud: e.updateDate ?? null, udit: e.updateDateIncludingText ?? null, lu, action: e.latestAction?.actionDate ?? null });
    }
  }
  const mainIds = main.pages.flatMap((p) => p.bills.map((e) => billId(e.congress ?? CONGRESS, e.type ?? "?", e.number ?? "?")));
  const mainDupes = mainIds.length - new Set(mainIds).size;
  say(`  the union: ${fmtN(listed.size)} distinct · listed more than once in the main walk: ${mainDupes} · ids read with two dates: ${conflicts}`);
  const prec = tally([...listed.values()].flatMap((l) => [`updateDate ${precision(l.ud)}`, `updateDateIncludingText ${precision(l.udit)}`]));
  say(`  the list's dates by precision: ${[...prec.entries()].map(([k, v]) => `${k} ${fmtN(v)}`).join(" · ")}`);

  say(`\n── Congress.gov's count per type (the eight /bill/${CONGRESS}/{type}?limit=1)`);
  const perType: Record<string, number | null> = {};
  for (const t of BILL_TYPES) perType[t] = countOf((await cg(`count ${t}`, `/bill/${CONGRESS}/${t}?limit=1`)).json);

  say(`\n── 3. the classes, by the compare lib/sync.ts:392-396 makes (stored >= listUpdate skips; listUpdate = updateDateIncludingText ?? updateDate)`);
  type Cls = "missing" | "behind" | "ahead" | "current" | "no list date";
  const cls = new Map<string, Cls>();
  for (const l of listed.values()) {
    const s = stored.get(l.id);
    if (!s) { cls.set(l.id, "missing"); continue; }
    if (!l.lu) { cls.set(l.id, "no list date"); continue; }
    if (!s.upd || !(s.upd >= l.lu)) { cls.set(l.id, "behind"); continue; }
    // A skip. Current or ahead is read at the list's precision: a bare date against the stored date's day.
    const sp = precision(l.lu) === "date" ? s.upd.slice(0, 10) : s.upd;
    const same = precision(l.lu) === "date" ? sp === l.lu : instant(sp) === instant(l.lu);
    cls.set(l.id, same ? "current" : "ahead");
  }
  const extra = [...stored.keys()].filter((id) => !listed.has(id));
  const byCls = (c: Cls) => [...listed.values()].filter((l) => cls.get(l.id) === c);
  const missing = byCls("missing");
  const behind = byCls("behind");
  const ahead = byCls("ahead");
  say(`  listed ${fmtN(listed.size)} · stored ${fmtN(stored.size)} · missing ${fmtN(missing.length)} · behind ${fmtN(behind.length)} · ahead ${fmtN(ahead.length)} · current ${fmtN(byCls("current").length)} · no list date ${fmtN(byCls("no list date").length)} · extra (stored, not listed) ${fmtN(extra.length)}`);
  const typeRows = BILL_TYPES.map((t) => {
    const lt = [...listed.values()].filter((l) => l.type === t);
    return [t, perType[t] ?? null, lt.length, [...stored.values()].filter((s) => s.type === t).length, lt.filter((l) => cls.get(l.id) === "missing").length, lt.filter((l) => cls.get(l.id) === "behind").length, lt.filter((l) => cls.get(l.id) === "ahead").length, extra.filter((id) => stored.get(id)?.type === t).length] as Array<string | number | null>;
  });
  const sumCol = (i: number) => typeRows.reduce((s, r) => s + (typeof r[i] === "number" ? (r[i] as number) : 0), 0);
  table(["type", "Congress.gov count", "listed (walk)", "stored", "missing", "behind", "ahead", "extra"], [...typeRows, ["all", sumCol(1), sumCol(2), sumCol(3), sumCol(4), sumCol(5), sumCol(6), sumCol(7)]]);
  if (ahead.length) say(`  ahead, up to ten: ${ahead.slice(0, 10).map((l) => `${l.id} (stored ${stored.get(l.id)?.upd}, listed ${l.lu})`).join("; ")}`);
  if (extra.length) say(`  extra, up to ten: ${extra.slice(0, 10).map((id) => `${id} (stored ${stored.get(id)?.upd})`).join("; ")}`);
  const vs = argAt("--vs");
  if (vs) {
    await versus(vs.split(","), (id) => cls.get(id) ?? (stored.has(id) ? "extra (stored, not listed)" : "not listed, not stored"), (id) => listed.get(id)?.lu ?? null,
      (id) => stored.get(id)?.upd ?? null, { missing: missing.map((l) => l.id), behind: behind.map((l) => l.id) });
  }

  // The list prints both dates as a bare day (claim 6's windows read "2026-10-20" for a bill whose detail reads
  // 2026-10-20T09:58:19Z), so a list date cannot be compared with started_at as an instant. One detail read per
  // missing or behind bill gives the two dates to the second, as the filter and the stored compare see them; the reads
  // are gated on their population before the first one goes out.
  type Exact = { status: number; ud: string | null; udit: string | null; at: string };
  const exact = new Map<string, Exact>();
  const population = missing.length + behind.length;
  if (process.argv.includes("--no-details") || population > MAX_DETAIL_READS) {
    say(`\n── 3b. the exact dates: not read (${process.argv.includes("--no-details") ? "--no-details" : `${fmtN(population)} missing or behind is over the ${fmtN(MAX_DETAIL_READS)} per-bill reads a census may make`}); every date stays the list's day`);
  } else {
    say(`\n── 3b. the exact dates: one detail read per missing or behind bill (the list carries only the day), ${fmtN(population)} of them`);
    for (const l of [...missing, ...behind]) {
      const r = await cg(`detail ${l.id} (${cls.get(l.id)})`, `/bill/${CONGRESS}/${l.type}/${l.number}`);
      exact.set(l.id, { status: r.status, ud: asStr(at(r.json, "bill", "updateDate")), udit: asStr(at(r.json, "bill", "updateDateIncludingText")), at: r.at.toISOString() });
    }
  }
  const unread = [...exact.entries()].filter(([, e]) => e.status !== 200 || !e.udit);
  const dayMoved = [...missing, ...behind].filter((l) => { const e = exact.get(l.id); return e?.udit && l.udit && e.udit.slice(0, 10) !== l.udit; });
  if (exact.size) {
    say(`  ${fmtN(exact.size)} detail reads · unread or dateless ${unread.length}${unread.length ? `: ${unread.slice(0, 20).map(([id, e]) => `${id} (${e.status})`).join(", ")}` : ""} · the detail's day differs from the list's (touched between the reads) ${dayMoved.length}${dayMoved.length ? `: ${dayMoved.slice(0, 20).map((l) => l.id).join(", ")}` : ""}`);
    save(`census-${LABEL}-details.json`, JSON.stringify(Object.fromEntries(exact), null, 1));
  }

  say(`\n── 4. the owed tick: the first /api/sync row whose window [fromDateTime, started_at) holds the bill's date`);
  const ledger = objs(await q(
    "4 · the ledger's windows",
    `SELECT id, started_at, status,
            COALESCE(json_extract(payload, '$.payload.sync.fromDateTime'), json_extract(payload, '$.sync.fromDateTime')) AS from_dt,
            COALESCE(json_extract(payload, '$.payload.sync.budgetStopped'), json_extract(payload, '$.sync.budgetStopped')) AS bs,
            COALESCE(json_extract(payload, '$.payload.sync.failed'), json_extract(payload, '$.sync.failed')) AS failed,
            COALESCE(json_extract(payload, '$.payload.sync.timedOut'), json_extract(payload, '$.sync.timedOut')) AS timed_out,
            COALESCE(json_extract(payload, '$.payload.sync.seen'), json_extract(payload, '$.sync.seen')) AS seen
     FROM cron_runs WHERE route = ? ORDER BY started_at`,
    [ROUTE],
  ));
  // A row that names no window (a timeout, an error, a row still running) is given the last named fromDateTime before
  // it, a lower bound on its own, and marked inferred.
  let lastFrom: string | null = null;
  const owedTicks: OwedTick[] = ledger.map((r) => {
    const from = asStr(r.from_dt);
    const inferred = from === null && lastFrom !== null;
    if (from !== null) lastFrom = from;
    const f = from ?? (inferred ? lastFrom : null);
    return {
      id: Number(r.id), started: String(r.started_at), startedMs: Date.parse(String(r.started_at)), status: String(r.status),
      from: f, fromMs: f === null ? null : Date.parse(f), inferred,
      bs: asBool(r.bs), failed: asNum(r.failed), timedOut: asNum(r.timed_out), seen: asNum(r.seen),
    };
  });
  const ledgerStart = owedTicks.find((t) => t.from !== null && !t.inferred)?.fromMs ?? null;
  say(`  ${fmtN(owedTicks.length)} rows · ${owedTicks.filter((t) => t.inferred).length} with an inferred window · the ledger begins at ${ledgerStart === null ? "unread" : `${iso(ledgerStart)} = ${when(iso(ledgerStart))}`} (the first named fromDateTime) · stored MIN(update_date) ${storedMin}`);
  type Field = "updateDate" | "updateDateIncludingText";
  // u: the bill's date in the field, to the second off its detail read; the list's bare day only where that is unread.
  const uOf = (l: Listed, f: Field) => {
    const e = exact.get(l.id);
    return f === "updateDate" ? (e?.ud ?? l.ud) : (e?.udit ?? e?.ud ?? l.udit ?? l.ud);
  };
  // Without detail reads no date is an instant, and a bare day joined to started_at would class by its midnight.
  const owedOf = (l: Listed, f: Field) => owedFor(exact.size ? instant(uOf(l, f)) : null, owedTicks, ledgerStart);
  const gap = [...missing, ...behind];
  const owed = new Map<string, Record<Field, Owed>>();
  for (const l of gap) owed.set(l.id, { updateDate: owedOf(l, "updateDate"), updateDateIncludingText: owedOf(l, "updateDateIncludingText") });
  const CLASSES = ["budget-stopped", "failed", "errored (timeout)", "errored (error)", "errored (orphaned)", "errored (running)", "tie-exposed", "clean",
    "success, no stats", "before-the-ledger", "after-the-last-tick", "uncovered", "no date"];
  const clsTable = (pick: (o: Record<Field, Owed>) => string) => {
    const m = tally(missing.map((l) => pick(owed.get(l.id)!)));
    const b = tally(behind.map((l) => pick(owed.get(l.id)!)));
    const seenKeys = [...new Set([...m.keys(), ...b.keys()])];
    const keys = [...CLASSES.filter((c) => seenKeys.includes(c)), ...seenKeys.filter((c) => !CLASSES.includes(c))];
    table(["class", "missing", "behind"], [...keys.map((c) => [c, m.get(c) ?? 0, b.get(c) ?? 0] as [string, number, number]), ["all", missing.length, behind.length]]);
    return { missing: Object.fromEntries(m), behind: Object.fromEntries(b) };
  };
  let classes: Record<string, unknown> | null = null;
  if (!exact.size) say(`  no detail reads in this census: the join is not made, every bill reads "no date", and the CSV's owed columns stay blank`);
  else {
    say(`  the class of the FIRST owed tick, u = updateDateIncludingText (claim 6's field), to the second:`);
    const firstUdit = clsTable((o) => o.updateDateIncludingText.cls);
    say(`  the class of the FIRST owed tick, u = updateDate, to the second:`);
    const firstUd = clsTable((o) => o.updateDate.cls);
    say(`  the class of the LAST owed tick (the last whose window held it), u = updateDateIncludingText:`);
    const lastUdit = clsTable((o) => o.updateDateIncludingText.lastCls);
    say(`  the class of the LAST owed tick, u = updateDate:`);
    const lastUd = clsTable((o) => o.updateDate.lastCls);
    classes = { firstUdit, firstUd, lastUdit, lastUd };
    const owedCounts = (f: Field, xs: Listed[]) => [...tally(xs.map((l) => String(owed.get(l.id)![f].n))).entries()].sort((x, y) => Number(x[0]) - Number(y[0])).map(([k, v]) => `${k} tick(s) ${fmtN(v)}`).join(" · ");
    say(`  how many ticks owed each bill, u = updateDateIncludingText: missing ${owedCounts("updateDateIncludingText", missing)} | behind ${owedCounts("updateDateIncludingText", behind)}`);
    say(`  how many ticks owed each bill, u = updateDate: missing ${owedCounts("updateDate", missing)} | behind ${owedCounts("updateDate", behind)}`);
    const inferredFirst = gap.filter((l) => owed.get(l.id)!.updateDateIncludingText.first?.inferred).length;
    say(`  bills whose first owed tick (u = updateDateIncludingText) has an inferred window: ${inferredFirst}`);
  }

  say(`\n── the missing, by month`);
  const mUd = tally(missing.map((l) => (l.ud ?? "none").slice(0, 7)));
  const mAct = tally(missing.map((l) => (l.action ?? "none").slice(0, 7)));
  const monthsAll = [...new Set([...mUd.keys(), ...mAct.keys()])].sort();
  table(["month", "by updateDate", "by latestAction.actionDate"], monthsAll.map((m) => [m, mUd.get(m) ?? 0, mAct.get(m) ?? 0]));
  say(`  the stored MIN(update_date) ${storedMin} · the ledger's first fromDateTime ${ledgerStart === null ? "unread" : iso(ledgerStart)}`);

  say(`\n── the behind's staleness, listed minus stored (days; the listed date ${exact.size ? "to the second, off the detail read" : "at the list's day, read as 00:00Z"})`);
  const stale = behind.map((l) => { const a = instant(uOf(l, "updateDateIncludingText")); const b = instant(stored.get(l.id)?.upd); return a !== null && b !== null ? (a - b) / 86_400_000 : NaN; });
  say(`    ${qStr(stale, 1)}`);

  say(`\n── the missing bill numbers, per type`);
  for (const t of BILL_TYPES) {
    const ns = missing.filter((l) => l.type === t).map((l) => l.number);
    if (!ns.length) continue;
    const bands = [...tally(ns.map((n) => String(Math.floor(n / 1000) * 1000))).entries()].sort((x, y) => Number(x[0]) - Number(y[0])).map(([k, v]) => `${k}–${Number(k) + 999}: ${v}`).join(" · ");
    say(`  ${t} (${ns.length}): ${ranges(ns)}`);
    say(`    per thousand: ${bands}`);
  }

  // The CSV: one row a missing or behind bill.
  // owed_* is claim 6's field (updateDateIncludingText); the updateDate reading rides beside it.
  const head = ["id", "type", "number", "class", "list_updateDate", "list_updateDateIncludingText", "detail_updateDate", "detail_updateDateIncludingText",
    "stored_update_date", "latestAction_actionDate", "owed_tick_id", "owed_started_at", "owed_status", "owed_budgetStopped", "owed_failed", "owed_seen",
    "owed_inferred", "owed_count", "owed_class", "last_owed_tick_id", "last_owed_class", "owed_class_by_updateDate", "owed_count_by_updateDate"];
  const csv = [head.join(",")];
  for (const l of [...gap].sort((x, y) => x.type.localeCompare(y.type) || x.number - y.number)) {
    const o = owed.get(l.id)!;
    const p = o.updateDateIncludingText;
    const f = p.first;
    const e = exact.get(l.id);
    csv.push([l.id, l.type, l.number, cls.get(l.id), l.ud ?? "", l.udit ?? "", e?.ud ?? "", e?.udit ?? "", stored.get(l.id)?.upd ?? "", l.action ?? "",
      f?.id ?? "", f?.started ?? "", f?.status ?? "", f?.bs ?? "", f?.failed ?? "", f?.seen ?? "", f ? f.inferred : "", p.n, p.cls,
      p.last?.id ?? "", p.lastCls, o.updateDate.cls, o.updateDate.n].map((v) => String(v ?? "")).join(","));
  }
  save(`census-${LABEL}.csv`, `${csv.join("\n")}\n`);
  say(`\n  wrote docs/handoffs/788-artifacts/census-${LABEL}.csv: ${fmtN(csv.length - 1)} rows (the missing and the behind)`);

  say(`\n── appendix: every missing id, by type, in number order`);
  for (const t of BILL_TYPES) {
    const ids = missing.filter((l) => l.type === t).sort((x, y) => x.number - y.number).map((l) => l.id);
    if (ids.length) say(`  ${t} (${ids.length}): ${ids.join(", ")}`);
  }
  if (behind.length <= 400) {
    say(`\n── appendix: every behind id, with its stored and listed dates`);
    for (const l of [...behind].sort((x, y) => x.type.localeCompare(y.type) || x.number - y.number)) say(`  ${l.id} · stored ${stored.get(l.id)?.upd} · listed ${l.lu} · detail ${uOf(l, "updateDateIncludingText")}`);
  }
  results.census = {
    snapAt: snapAt.toISOString(), stored: stored.size, storedMin, listStart: t0.toISOString(), listEnd: t1.toISOString(),
    firstCount, lastCount, mainPages: main.pages.length, tied: tied.length, tiePages: tiePages.length, halfPages: half?.pages.length ?? 0,
    complete, listed: listed.size, mainDupes, conflicts, precision: Object.fromEntries(prec), perType,
    missing: missing.length, behind: behind.length, ahead: ahead.length, current: byCls("current").length, noListDate: byCls("no list date").length, extra: extra.length,
    extraIds: extra.slice(0, 50), aheadIds: ahead.slice(0, 10).map((l) => l.id),
    details: exact.size, detailsUnread: unread.map(([id]) => id), dayMoved: dayMoved.map((l) => l.id),
    classes, staleness: quantiles(stale), ledgerStart: ledgerStart === null ? null : iso(ledgerStart),
    missingIds: missing.map((l) => l.id), behindIds: behind.map((l) => l.id),
  };
}

// ── --impact ────────────────────────────────────────────────────────────────
// What --repair would set going, read before it runs, off a census's saved files: of the behind bills, how many hold a
// summary the upsert nulls when update_date moves (lib/sync.ts:203) and how many show a newer latest action; the
// committee walks the stamped changed_at owes (lib/committees-sync.ts:205); the summarizer's measured throughput and
// tokens from its own ledger; and the Congress.gov quota left.
async function impact() {
  const label = argAt("--of") ?? "p1";
  const csvFile = path.join(ART, `census-${label}.csv`);
  const listFile = path.join(ART, `census-${label}-list.json`);
  if (!existsSync(csvFile) || !existsSync(listFile)) throw new Error(`--impact reads census ${label}'s saved files, and one is absent`);
  const lines = readFileSync(csvFile, "utf8").trim().split(/\r?\n/);
  const head = (lines[0] ?? "").split(",");
  const iId = head.indexOf("id");
  const iCls = head.indexOf("class");
  const gap = lines.slice(1).map((l) => l.split(",")).map((r) => ({ id: r[iId] ?? "", cls: r[iCls] ?? "" }));
  const behind = new Set(gap.filter((g) => g.cls === "behind").map((g) => g.id));
  const missing = new Set(gap.filter((g) => g.cls === "missing").map((g) => g.id));
  const saved = JSON.parse(readFileSync(listFile, "utf8")) as { pages: Array<{ bills: ListEntry[] }> };
  const listAction = new Map<string, string | null>();
  for (const p of saved.pages) for (const e of p.bills) listAction.set(billId(e.congress ?? CONGRESS, e.type ?? "?", e.number ?? "?"), e.latestAction?.actionDate ?? null);
  say(`\n── what --repair would write, read off census ${label}: ${fmtN(missing.size)} missing, ${fmtN(behind.size)} behind`);
  const rows = objs(await q(
    "impact · the Congress's bills: latest_action_date, whether a summary is held, is_ceremonial, whether raw_json names a committee",
    `SELECT id, latest_action_date, summary IS NOT NULL AS summarized, is_ceremonial, json_extract(raw_json, '$.committees.count') > 0 AS has_committee
     FROM bills WHERE congress = ?`,
    [CONGRESS],
  ));
  const b = rows.filter((r) => behind.has(String(r.id)));
  const summarized = b.filter((r) => Number(r.summarized) === 1);
  const ceremonial = summarized.filter((r) => Number(r.is_ceremonial) === 1).length;
  const newerAction = b.filter((r) => { const l = listAction.get(String(r.id)); const s = asStr(r.latest_action_date); return l !== null && l !== undefined && (s === null || l > s); }).length;
  const committee = b.filter((r) => Number(r.has_committee) === 1).length;
  const storedSummarized = rows.filter((r) => Number(r.summarized) === 1).length;
  say(`  behind ${fmtN(b.length)} (stored rows found ${fmtN(b.length)} of ${fmtN(behind.size)}):`);
  say(`    hold a summary now, which the upsert nulls: ${fmtN(summarized.length)} (${fmtN(summarized.length - ceremonial)} not ceremonial, ${fmtN(ceremonial)} ceremonial) · of the Congress's ${fmtN(storedSummarized)} summarized bills, ${pct(summarized.length, storedSummarized)}`);
  say(`    whose listed latestAction.actionDate is later than the stored latest_action_date: ${fmtN(newerAction)} (${pct(newerAction, b.length)}); the rest moved without a newer action date`);
  say(`    whose raw_json names a committee, so the stamped changed_at owes a committee walk: ${fmtN(committee)}`);
  say(`  missing ${fmtN(missing.size)}: new rows, summary NULL until the summarizer reaches them; their committees are unread until the detail`);

  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const runs = objs(await q(
    "impact · the summarizer's ledger, the last 60 days",
    `SELECT started_at, status, json_extract(payload, '$.payload.summarized') AS s, json_extract(payload, '$.payload.budgetStopped') AS bs,
            json_extract(payload, '$.payload.promptTokens') AS pt, json_extract(payload, '$.payload.outputTokens') AS ot
     FROM cron_runs WHERE route = '/api/cron/summarize' AND started_at >= ? ORDER BY started_at`,
    [since],
  ));
  const worked = runs.filter((r) => Number(r.s ?? 0) > 0);
  const stopped = runs.filter((r) => Number(r.bs ?? 0) === 1);
  const perStopped = stopped.map((r) => Number(r.s ?? 0));
  const sumS = worked.reduce((a, r) => a + Number(r.s ?? 0), 0);
  const sumPt = worked.reduce((a, r) => a + Number(r.pt ?? 0), 0);
  const sumOt = worked.reduce((a, r) => a + Number(r.ot ?? 0), 0);
  say(`  the summarizer since ${since.slice(0, 10)}: ${fmtN(runs.length)} runs · ${fmtN(worked.length)} summarized at least one bill (${fmtN(sumS)} bills) · ${fmtN(stopped.length)} stopped on the 45 s budget, the runs with a queue to drain`);
  say(`    summarized per budget-stopped run: ${qStr(perStopped)}`);
  say(`    tokens per summarized bill: prompt ${sumS ? fmtN(Math.round(sumPt / sumS)) : "n/a"}, output ${sumS ? fmtN(Math.round(sumOt / sumS)) : "n/a"}`);
  const queue = summarized.length + missing.size;
  const med = quantiles(perStopped)?.median ?? null;
  say(`    the queue the repair would leave: ${fmtN(queue)} bills · at the median budget-stopped run, one run every 10 minutes: ~${med ? ((queue / med) * 10 / 60).toFixed(1) : "?"} hours to drain (an estimate from the median, not a reading)`);

  const quota = await cg("impact · the quota", `/bill/${CONGRESS}?limit=1`);
  say(`  Congress.gov: x-ratelimit-limit ${quota.limit ?? "unread"} · x-ratelimit-remaining ${quota.remaining ?? "unread"} at ${when(quota.at)}`);
  results.impact = {
    census: label, missing: missing.size, behind: behind.size, behindSummarized: summarized.length, behindCeremonial: ceremonial,
    newerAction, committee, storedSummarized, summarizer: { runs: runs.length, worked: worked.length, stopped: stopped.length, perStopped: quantiles(perStopped), sumS, sumPt, sumOt },
    queue, quota: { limit: quota.limit, remaining: quota.remaining, at: quota.at.toISOString() },
  };
}

// ── --repair ────────────────────────────────────────────────────────────────
// The /api/sync ticks either side of now, off vercel.json's schedule ("M */N * * *").
function syncTicks(now = new Date()): { prev: Date | null; next: Date | null } {
  const v = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons?: Array<{ path?: string; schedule?: string }> };
  const s = v.crons?.find((c) => c.path === ROUTE)?.schedule ?? "";
  const m = /^(\d+) \*\/(\d+) \* \* \*$/.exec(s);
  if (!m) return { prev: null, next: null };
  const minute = Number(m[1]);
  const step = Number(m[2]);
  const day0 = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 86_400_000;
  let prev: Date | null = null;
  for (let h = 0; h < 72; h++) {
    const t = new Date(day0 + h * 3_600_000 + minute * 60_000);
    if (t.getUTCHours() % step !== 0) continue;
    if (t.getTime() > now.getTime()) return { prev, next: t };
    prev = t;
  }
  return { prev, next: null };
}
function captureConsole() {
  const orig = { log: console.log, warn: console.warn, error: console.error };
  const lines: string[] = [];
  for (const k of ["log", "warn", "error"] as const) {
    console[k] = (...a: unknown[]) => {
      const line = a.map((x) => (typeof x === "string" ? x : x instanceof Error ? x.message : JSON.stringify(x))).join(" ");
      lines.push(line);
      say(`    [runSync ${k}] ${line}`);
    };
  }
  return { lines, restore: () => Object.assign(console, orig) };
}
// The allow-set as a run saved it: what a later pass repairs from and what --census --vs reads back.
type AllowFile = {
  label: string; census: string; residualOf: string | null; watermark: string; frontierDay: string; readAt: string;
  newerActionNow: number | null; allow: string[]; control: string[];
  excluded: Array<{ id: string; cls: string; listed: string | null; detail: string | null }>;
  placements?: Placement[];
  run?: { start: string; end: string; stamped: string[] };
};
// One detail read places a bill against the watermark instant, by its date as the filter and the upsert take it
// (updateDateIncludingText ?? updateDate, lib/sync.ts:72-74), to the second: before it, or at or after it (the cron's).
type Placement = { id: string; cls: string; listed: string | null; status: number; ud: string | null; udit: string | null; at: string; side: "before" | "at or after" | "unread" };
async function place(g: { id: string; cls: string; listed: string | null }, wMs: number): Promise<Placement> {
  const [, type, number] = g.id.split("-");
  const r = await cg(`placement ${g.id} (${g.cls}, listed ${g.listed})`, `/bill/${CONGRESS}/${type}/${number}`);
  const ud = asStr(at(r.json, "bill", "updateDate"));
  const udit = asStr(at(r.json, "bill", "updateDateIncludingText"));
  const t = instant(udit ?? ud);
  const side = r.status !== 200 || t === null ? "unread" : t < wMs ? "before" : "at or after";
  return { id: g.id, cls: g.cls, listed: g.listed, status: r.status, ud, udit, at: r.at.toISOString(), side };
}
const placementLine = (p: Placement) =>
  `${p.id} (${p.cls}) · listed ${p.listed} · ${p.status === 200 ? `updateDateIncludingText ${p.udit}, updateDate ${p.ud}` : `detail ${p.status || "no answer"}`} · ${p.side === "before" ? "before the instant: in" : p.side === "at or after" ? "at or after the instant: the cron's" : "unread: out"}`;
const readAllow = (label: string) => JSON.parse(readFileSync(path.join(ART, `allowset-${label}.json`), "utf8")) as AllowFile;
type GapRow = { id: string; cls: string; listed: string | null; detail: string | null };
function readGap(censusLabel: string): GapRow[] {
  const file = path.join(ART, `census-${censusLabel}.csv`);
  if (!existsSync(file)) throw new Error(`census ${censusLabel}'s CSV is absent`);
  const lines = readFileSync(file, "utf8").trim().split(/\r?\n/);
  const head = (lines[0] ?? "").split(",");
  const col = (r: string[], k: string) => r[head.indexOf(k)] ?? "";
  return lines.slice(1).map((l) => l.split(",")).map((r) => ({
    id: col(r, "id"), cls: col(r, "class"),
    listed: col(r, "list_updateDateIncludingText") || col(r, "list_updateDate") || null,
    detail: col(r, "detail_updateDateIncludingText") || col(r, "detail_updateDate") || null,
  }));
}
// The ruling's allow-set, restated at flags 1 and 2: (the census's missing ∪ its behind with a newer latest action),
// each dated strictly before the watermark instant, MAX(update_date) read immediately before the run. A bill listed on
// an earlier day than the watermark's is in on its list date; one listed on the watermark's day is placed by one detail
// read (place()), before the instant in, at or after it the cron's; one listed later is the cron's. The rule was by day
// until pass 3: the cron lists from the instant, to the second, so a bill dated on the watermark's day but before the
// instant was below every tick's fromDateTime and was excluded all the same (pass 1's seven). --residual-of takes an
// earlier run's allow-set less what that run stamped.
async function buildAllow(watermark: string, frontierDay: string, lad: Map<string, string | null>, stored: Map<string, string>): Promise<AllowFile> {
  const censusLabel = argAt("--allow") ?? "";
  const residualOf = argAt("--residual-of") ?? null;
  const gap = readGap(censusLabel);
  const byId = new Map(gap.map((g) => [g.id, g]));
  const missing = gap.filter((g) => g.cls === "missing");
  const behind = gap.filter((g) => g.cls === "behind");
  let candidates: GapRow[];
  let control: string[];
  let newerActionNow: number | null = null;
  if (residualOf) {
    const prev = readAllow(residualOf);
    const stamped = new Set(prev.run?.stamped ?? []);
    candidates = prev.allow.filter((id) => !stamped.has(id)).map((id) => byId.get(id) ?? { id, cls: "?", listed: null, detail: null });
    control = prev.control;
    say(`  --residual-of ${residualOf}: its allow-set ${fmtN(prev.allow.length)}, stamped by it ${fmtN(stamped.size)}, left ${fmtN(candidates.length)} · the control carried over, ${fmtN(control.length)}`);
  } else {
    // "A newer latest action", --impact's predicate, stated once: the census's listed latestAction.actionDate (off its
    // saved pages, the last page listing the bill) is later, compared as YYYY-MM-DD strings, than the stored
    // latest_action_date, or the stored one is NULL while the listed one is not.
    const listFile = path.join(ART, `census-${censusLabel}-list.json`);
    if (!existsSync(listFile)) throw new Error(`census ${censusLabel}'s saved pages are absent`);
    const saved = JSON.parse(readFileSync(listFile, "utf8")) as { pages: Array<{ bills: ListEntry[] }> };
    const listAction = new Map<string, string | null>();
    for (const p of saved.pages) for (const e of p.bills) listAction.set(billId(e.congress ?? CONGRESS, e.type ?? "?", e.number ?? "?"), e.latestAction?.actionDate ?? null);
    const newer = (id: string) => { const l = listAction.get(id) ?? null; const s = lad.get(id) ?? null; return l !== null && (s === null || l > s); };
    const newerNow = behind.filter((g) => newer(g.id));
    newerActionNow = newerNow.length;
    candidates = [...missing, ...newerNow];
    control = behind.filter((g) => !newer(g.id)).map((g) => g.id);
    const impactFile = path.join(ART, "impact-r1.json");
    const impactRead = existsSync(impactFile) ? asNum(at(JSON.parse(readFileSync(impactFile, "utf8")), "impact", "newerAction")) : null;
    say(`  census ${censusLabel}: missing ${fmtN(missing.length)} · behind ${fmtN(behind.length)}, of them with a newer latest action now ${fmtN(newerNow.length)} (--impact read ${impactRead === null ? "unread" : fmtN(impactRead)}), without one ${fmtN(control.length)}: the control`);
  }
  const wMs = Date.parse(watermark);
  const day = (g: GapRow) => (g.listed === null ? null : g.listed.slice(0, 10));
  const earlier = candidates.filter((g) => { const d = day(g); return d !== null && d < frontierDay; });
  const onDay = candidates.filter((g) => day(g) === frontierDay);
  const later = candidates.filter((g) => { const d = day(g); return d === null || d > frontierDay; });
  say(`  the candidates, ${fmtN(candidates.length)}: listed before the watermark's day ${frontierDay} ${fmtN(earlier.length)} (in on the list date) · on it ${fmtN(onDay.length)} (placed by one detail read each) · after it ${fmtN(later.filter((g) => day(g) !== null).length)} (the cron's) · with no list date in census ${censusLabel} ${fmtN(later.filter((g) => day(g) === null).length)} (out)`);
  if (onDay.length > MAX_DETAIL_READS) throw new Error(`HALT: ${fmtN(onDay.length)} frontier-day placements is over the ${fmtN(MAX_DETAIL_READS)} per-bill reads, and nothing has been written`);
  const placements: Placement[] = [];
  for (const g of onDay) placements.push(await place(g, wMs));
  say(`  the frontier-day placements against ${watermark}: ${placements.length ? "" : "none"}`);
  for (const p of placements) say(`    ${placementLine(p)}`);
  const placedIn = new Set(placements.filter((p) => p.side === "before").map((p) => p.id));
  const allow = [...earlier, ...onDay.filter((g) => placedIn.has(g.id))];
  const excluded = [...onDay.filter((g) => !placedIn.has(g.id)), ...later];
  say(`  the allow-set: ${fmtN(allow.length)} (missing ${fmtN(allow.filter((g) => g.cls === "missing").length)} · behind with a newer latest action ${fmtN(allow.filter((g) => g.cls === "behind").length)}), each dated before ${watermark} · the rule excludes ${fmtN(excluded.length)}`);
  const exMissing = excluded.filter((g) => g.cls === "missing");
  say(`  missing bills the rule excludes: ${exMissing.length ? exMissing.map((g) => `${g.id} (listed ${g.listed})`).join(", ") : "none"}`);
  const exBehind = excluded.filter((g) => g.cls !== "missing");
  if (exBehind.length) say(`  behind bills with a newer latest action the rule excludes (${exBehind.length}): ${exBehind.slice(0, 40).map((g) => `${g.id} (listed ${g.listed})`).join(", ")}${exBehind.length > 40 ? ", …" : ""}`);
  const current = allow.filter((g) => { const s = stored.get(g.id); return s !== undefined && g.listed !== null && s >= g.listed; });
  say(`  of the allow-set, reading current in the store already (written since the census): ${fmtN(current.length)}${current.length ? `: ${current.slice(0, 40).map((g) => `${g.id} → ${stored.get(g.id)}`).join(", ")}` : ""}`);
  return {
    label: LABEL, census: censusLabel, residualOf, watermark, frontierDay, readAt: new Date().toISOString(), newerActionNow,
    allow: allow.map((g) => g.id), control, excluded, placements,
  };
}
async function repair() {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  const skillLine = treeLines(".claude/skills/cbt/SKILL.md").find((l) => /\*\*DB primary:/.test(l)) ?? "";
  const skillHost = /libsql:\/\/([^`\s)]+)/.exec(skillLine)?.[1] ?? "";
  const from = argAt("--from") ?? FIRST_DAY;
  const censusLabel = argAt("--allow");
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(from)) throw new Error(`--from takes a whole-second UTC instant (YYYY-MM-DDTHH:MM:SSZ), not ${from}`);
  if (!censusLabel) throw new Error("--repair takes --allow <census label>: the ruling repairs the allow-set, and nothing else is written");
  say(`\n── the repair`);
  say(`  WRITES PROD · database host ${DB_HOST || "(none)"} (TURSO_DATABASE_URL, by name) · SKILL's DB primary reads ${skillHost || "(not found)"}: ${DB_HOST && DB_HOST === skillHost ? "the same host" : "NOT THE SAME HOST"}`);
  say(`  runSync({ fromDateTime: ${from} }) from lib/sync.ts, in process, no deadline · the ${ordinal(CONGRESS)} Congress's first day is ${FIRST_DAY}${from === FIRST_DAY ? "" : ` (--from moves it to ${from})`}`);
  if (!url.startsWith("libsql://") || !DB_HOST || DB_HOST !== skillHost) throw new Error("HALT: the host line does not name prod");
  // Checked as the mode starts and again as runSync starts, since the placements take time between the two.
  const tickMargin = (what: string) => {
    const { prev, next } = syncTicks();
    const sincePrev = prev ? Date.now() - prev.getTime() : null;
    const toNext = next ? next.getTime() - Date.now() : null;
    say(`  /api/sync's ticks (vercel.json), ${what}: the last ${prev ? `${when(prev)}, ${Math.round((sincePrev ?? 0) / 60_000)} min ago` : "unread"} · the next ${next ? `${when(next)}, in ${Math.round((toNext ?? 0) / 60_000)} min` : "unread"}`);
    if ((sincePrev !== null && sincePrev < TICK_MARGIN_MS) || (toNext !== null && toNext < TICK_MARGIN_MS)) throw new Error(`refused: an /api/sync tick is within ${TICK_MARGIN_MS / 60_000} min`);
  };
  tickMargin("as the mode starts");

  say(`\n── the watermark, read immediately before the run, and the allow-set`);
  const watermark = asStr(objs(await q("repair · the watermark, as lib/sync.ts:126 reads it", `SELECT MAX(update_date) AS m FROM bills`))[0]?.m);
  if (!watermark) throw new Error("HALT: the watermark is unread");
  const frontierDay = watermark.slice(0, 10);
  const wMs = Date.parse(watermark);
  if (Number.isNaN(wMs)) throw new Error(`HALT: the watermark ${watermark} does not parse as an instant`);
  say(`  MAX(update_date) ${watermark} = ${when(watermark)} · the instant the next tick lists from, to the second: a bill dated at or after it is the cron's · the watermark's day ${frontierDay}`);
  const censusJson = path.join(ART, `census-${censusLabel}.json`);
  const snapAt = existsSync(censusJson) ? asStr(at(JSON.parse(readFileSync(censusJson, "utf8")), "census", "snapAt")) : null;
  if (snapAt) {
    const since = objs(await q(
      "repair · /api/sync's rows since the census's snapshot",
      `SELECT id, started_at, status,
              COALESCE(json_extract(payload, '$.payload.sync.fromDateTime'), json_extract(payload, '$.sync.fromDateTime')) AS from_dt,
              COALESCE(json_extract(payload, '$.payload.sync.seen'), json_extract(payload, '$.sync.seen')) AS seen,
              COALESCE(json_extract(payload, '$.payload.sync.upserted'), json_extract(payload, '$.sync.upserted')) AS upserted,
              COALESCE(json_extract(payload, '$.payload.sync.budgetStopped'), json_extract(payload, '$.sync.budgetStopped')) AS bs
       FROM cron_runs WHERE route = ? AND started_at >= ? ORDER BY started_at`,
      [ROUTE, snapAt],
    ));
    say(`  /api/sync since the census's snapshot, ${when(snapAt)}: ${since.length ? "" : "none"}`);
    for (const r of since) say(`    #${r.id} · ${when(r.started_at)} · ${r.status} · fromDateTime ${String(r.from_dt)} · seen ${String(r.seen)} · upserted ${String(r.upserted)} · budgetStopped ${String(r.bs)}`);
  }
  const snap = objs(await q(
    "repair · the Congress's bills: update_date for the read-side view, latest_action_date for the predicate",
    `SELECT id, update_date, latest_action_date FROM bills WHERE congress = ?`,
    [CONGRESS],
  ));
  const stored = new Map<string, string>();
  const lad = new Map<string, string | null>();
  for (const r of snap) {
    const id = String(r.id);
    const ud = asStr(r.update_date);
    if (ud) stored.set(id, ud);
    lad.set(id, asStr(r.latest_action_date));
  }
  say(`  the snapshot: ${fmtN(snap.length)} bills, ${fmtN(stored.size)} with an update_date`);
  const file = await buildAllow(watermark, frontierDay, lad, stored);
  save(`allowset-${LABEL}.json`, JSON.stringify(file, null, 1));
  say(`  the watermark ${watermark} · the allow-set ${fmtN(file.allow.length)} · the frontier-day placements ${fmtN(file.placements?.length ?? 0)} (in ${fmtN(file.placements?.filter((p) => p.side === "before").length ?? 0)}) · saved to docs/handoffs/788-artifacts/allowset-${LABEL}.json`);
  const allow = new Set(file.allow);

  tickMargin("as runSync starts");
  say(`  starting in 5 s`);
  await sleep(5000);
  const by0 = new Map([...tap.dbBy].map(([k, v]) => [k, { ...v }]));
  const start = new Date();
  const startIso = start.toISOString();
  const rr0 = tap.db.rowsRead;
  const rw0 = tap.db.rowsWritten;
  const cg0 = tap.cg.requests;
  say(`  runSync started ${when(start)}`);
  const rt: RepairTap = {
    allow, stored, wDay: frontierDay, wMs, entries: 0, passed: 0, rewritten: 0, cleared: 0,
    passedIds: new Map(), frontierLive: [], clearedIds: [], guarded: [], precision: new Map(), pages: [], details: [],
  };
  const cap = captureConsole();
  let stats: SyncStats | null = null;
  let err: Error | null = null;
  repairTap = rt;
  try {
    stats = await runSync({ fromDateTime: from });
  } catch (e) {
    err = e as Error;
  } finally {
    repairTap = null;
    cap.restore();
  }
  const end = new Date();
  const by1 = new Map([...tap.dbBy].map(([k, v]) => [k, { ...v }]));
  const ms = end.getTime() - start.getTime();
  const rowsRead = tap.db.rowsRead - rr0;
  const rowsWritten = tap.db.rowsWritten - rw0;
  const cgRequests = tap.cg.requests - cg0;
  say(`  runSync ${err ? `THREW: ${err.message}` : "returned"} ${when(end)} · wall clock ${(ms / 60_000).toFixed(1)} min`);
  if (stats) say(`  stats: seen ${fmtN(stats.seen)} · upserted ${fmtN(stats.upserted)} · skipped ${fmtN(stats.skipped)} · failed ${fmtN(stats.failed)} · timedOut ${fmtN(stats.timedOut)} · budgetStopped ${stats.budgetStopped} · fromDateTime ${stats.fromDateTime}`);
  say(`  during runSync: rows_read ${fmtN(rowsRead)} · rows_written ${fmtN(rowsWritten)} · Congress.gov requests ${fmtN(cgRequests)}`);
  const failLines = cap.lines.filter((l) => /^(failed|timeout) /.test(l) || /^skip \S+: detail/.test(l));
  const failIds = new Set(failLines.map((l) => /^\S+ (\S+?):/.exec(l)?.[1] ?? ""));
  if (failLines.length) { say(`  runSync's failure lines (${failLines.length}):`); for (const l of failLines) say(`    ${l}`); }

  say(`\n── the read-side view, over runSync's ${rt.pages.length} list pages`);
  say(`  entries ${fmtN(rt.entries)} · passed untouched (in the allow-set, listed on or before ${frontierDay}) ${fmtN(rt.passed)}, ${fmtN(rt.passedIds.size)} distinct · read current (stored, outside the allow-set: both dates set to the stored update_date) ${fmtN(rt.rewritten)} · read undated (not stored, outside the allow-set: both dates removed) ${fmtN(rt.cleared)}${rt.clearedIds.length ? `: ${rt.clearedIds.join(", ")}` : ""}`);
  say(`  allow-set bills listed after ${frontierDay} by the time the walk read them, so read as outside: ${rt.frontierLive.length ? rt.frontierLive.join(", ") : "none"}`);
  const lens = tally(rt.pages.map((p) => String(p.n)));
  say(`  page lengths: ${[...lens.entries()].map(([k, v]) => `${fmtN(v)} of ${k}`).join(" · ")} · the last ${rt.pages[rt.pages.length - 1]?.n ?? "none"}, at offset ${rt.pages[rt.pages.length - 1]?.offset ?? "–"}`);
  say(`  the dates' precision on runSync's pages, read before the view: ${[...rt.precision.entries()].sort().map(([k, v]) => `${k} ${fmtN(v)}`).join(" · ")}`);
  const dIds = rt.details.map((d) => d.id);
  const dOutside = [...new Set(dIds)].filter((id) => !allow.has(id));
  say(`  detail fetches ${fmtN(rt.details.length)} · distinct ${fmtN(new Set(dIds).size)} · outside the allow-set ${dOutside.length}${dOutside.length ? ` (${dOutside.join(", ")})` : ""} · by status ${[...tally(rt.details.map((d) => String(d.status))).entries()].map(([k, v]) => `${k} ${fmtN(v)}`).join(" · ")}`);
  const pastWm = rt.details.filter((d) => { const t = instant(d.udit ?? d.ud); return t !== null && t >= wMs; });
  say(`  detail dates (updateDateIncludingText ?? updateDate) at or past the watermark: ${pastWm.length}${pastWm.length ? `: ${pastWm.map((d) => `${d.id} ${d.udit ?? d.ud}`).join(", ")}` : ""} · the write-time guard removed \`bill\` from ${rt.guarded.length}${rt.guarded.length ? `: ${rt.guarded.join(", ")}` : ""}`);
  const guardedIds = new Set(rt.details.filter((d) => d.guarded).map((d) => d.id));
  const liveIds = new Set(rt.frontierLive.map((s) => s.split(" ")[0] ?? ""));
  const unseen = file.allow.filter((id) => !rt.passedIds.has(id) && !liveIds.has(id));
  say(`  allow-set bills this walk never listed: ${unseen.length}${unseen.length ? `: ${unseen.join(", ")}` : ""}`);

  say(`\n── the read-back`);
  const afterWm = asStr(objs(await q("repair · the watermark after", `SELECT MAX(update_date) AS m FROM bills`))[0]?.m);
  say(`  MAX(update_date): before ${watermark} · after ${afterWm} · ${afterWm === watermark ? "unchanged" : "MOVED"}`);
  if (afterWm !== watermark) for (const r of objs(await q("repair · the row now at the watermark", `SELECT id, update_date, changed_at FROM bills WHERE update_date = ?`, [afterWm]))) say(`    ${r.id} · update_date ${r.update_date} · changed_at ${r.changed_at}`);
  const afterN = Number(objs(await q("repair · the Congress's bill count after", `SELECT COUNT(*) AS n FROM bills WHERE congress = ?`, [CONGRESS]))[0]?.n);
  say(`  the Congress's bills: ${fmtN(snap.length)} before, ${fmtN(afterN)} after, ${fmtN(afterN - snap.length)} new`);
  const written = objs(await q("repair · the rows stamped since the start (changed_at: on insert, or when update_date moves)", `SELECT id, update_date, changed_at FROM bills WHERE changed_at >= ? ORDER BY id`, [startIso]));
  const wIds = written.map((r) => String(r.id));
  const wSet = new Set(wIds);
  const wOutside = wIds.filter((id) => !allow.has(id));
  say(`  rows stamped since ${startIso}: ${fmtN(written.length)} · in the allow-set ${fmtN(written.length - wOutside.length)} · outside it ${wOutside.length}${wOutside.length ? ` (${wOutside.map((id) => `${id} at ${written.find((r) => String(r.id) === id)?.changed_at}`).join(", ")})` : ""}${stats ? ` · upserted ${fmtN(stats.upserted)}, so ${fmtN(stats.upserted - written.length)} upsert(s) rewrote a row whose update_date did not move` : ""}`);
  const outcome = (id: string) =>
    wSet.has(id) ? "stamped by this run"
      : liveIds.has(id) ? "listed after the watermark's day, read as outside"
        : !rt.passedIds.has(id) ? "never listed by this walk"
          : guardedIds.has(id) ? "its detail at or past the instant: the guard removed it"
            : failIds.has(id) ? "listed, its detail failed"
              : "listed, not stamped (the compare read it current)";
  say(`  the allow-set's ${fmtN(file.allow.length)} bills:`);
  table(["outcome", "bills"], [...tally(file.allow.map(outcome)).entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v]));
  const notStamped = file.allow.filter((id) => !wSet.has(id));
  if (notStamped.length) say(`    not stamped: ${notStamped.slice(0, 60).map((id) => `${id} (${outcome(id)})`).join(", ")}${notStamped.length > 60 ? ", …" : ""}`);

  say(`\n── rows_read and rows_written during runSync, by statement`);
  const delta = [...by1.entries()].map(([k, v]) => {
    const b = by0.get(k) ?? { n: 0, read: 0, written: 0 };
    return [k, v.n - b.n, v.read - b.read, v.written - b.written] as [string, number, number, number];
  }).filter((r) => r[1] > 0).sort((a, b) => b[3] - a[3] || b[2] - a[2]);
  table(["statement", "times", "rows_read", "rows_written"], delta);
  const ups = delta.find((r) => r[0].startsWith("INSERT INTO bills"));
  const trans = delta.find((r) => r[0].startsWith("INSERT INTO stage_transitions"));
  say(`  rows_written ${fmtN(rowsWritten)} against the allow-set's ${fmtN(file.allow.length)}: ${fmtN(written.length - wOutside.length)} of its bills stamped · the upsert ${ups ? `${fmtN(ups[1])} times, ${fmtN(ups[3])} rows (${(ups[3] / Math.max(1, ups[1])).toFixed(2)} an upsert)` : "never"} · stage_transitions ${trans ? `${fmtN(trans[1])} inserts, ${fmtN(trans[3])} rows` : "none"}`);

  const residual = file.allow.filter((id) => !wSet.has(id));
  let pass2From: string | null = null;
  if (residual.length) {
    // Each residual bill's date to the second, from the reads this run holds: its placement, runSync's detail fetch, the
    // census's detail reads; otherwise its list day, read as that day's 00:00Z.
    const detFile = path.join(ART, `census-${file.census}-details.json`);
    const det = existsSync(detFile) ? (JSON.parse(readFileSync(detFile, "utf8")) as Record<string, { udit?: string | null; ud?: string | null }>) : {};
    const placedAt = new Map((file.placements ?? []).map((p) => [p.id, p.udit ?? p.ud]));
    const fetchedAt = new Map(rt.details.map((d) => [d.id, d.udit ?? d.ud]));
    const listedAt = new Map(file.excluded.concat(readGap(file.census)).map((g) => [g.id, g.listed]));
    const dateOf = (id: string) => placedAt.get(id) ?? fetchedAt.get(id) ?? det[id]?.udit ?? det[id]?.ud ?? listedAt.get(id) ?? null;
    for (const id of residual) say(`    residual ${id} · its date ${dateOf(id) ?? "unread"} · ${outcome(id)}`);
    const oldest = residual.map(dateOf).filter((x): x is string => x !== null).map((x) => instant(x)).filter((t): t is number => t !== null).sort((a, b) => a - b)[0];
    pass2From = oldest === undefined ? null : iso(oldest - 1000);
    say(`\n  the residual: ${residual.length} · the oldest one's date ${oldest === undefined ? "unread" : iso(oldest)} · the next pass: --residual-of ${LABEL} --from ${pass2From ?? "?"}`);
  }
  file.run = { start: startIso, end: end.toISOString(), stamped: wIds.filter((id) => allow.has(id)) };
  save(`allowset-${LABEL}.json`, JSON.stringify(file, null, 1));
  results.repair = {
    host: DB_HOST, from, watermark, frontierDay, allow: file.allow.length, start: startIso, end: end.toISOString(), wallClockMs: ms, stats,
    error: err?.message ?? null, rowsRead, rowsWritten, cgRequests, beforeN: snap.length, afterN, stamped: written.length, stampedOutside: wOutside,
    view: { pages: rt.pages.length, entries: rt.entries, passed: rt.passed, passedDistinct: rt.passedIds.size, rewritten: rt.rewritten, cleared: rt.cleared, clearedIds: rt.clearedIds, frontierLive: rt.frontierLive, precision: Object.fromEntries(rt.precision), pageLengths: Object.fromEntries(lens) },
    details: { n: rt.details.length, outside: dOutside, byStatus: Object.fromEntries(tally(rt.details.map((d) => String(d.status)))), pastWatermark: pastWm, guarded: rt.guarded },
    placements: file.placements ?? [],
    watermarkAfter: afterWm, outcomes: Object.fromEntries(tally(file.allow.map(outcome))), unseen, residual, pass2From, byStatement: delta, failLines,
  };
  if (err) throw err;
}

// The census against the repairs named: the allow-set's bills now, the control's now (the census's behind without a
// newer latest action, which the ruling leaves unwritten), the gap that is new since the census, and every row stamped
// since the first repair started, inside a repair's window or outside every one.
async function versus(labels: string[], stateOf: (id: string) => string, listedOf: (id: string) => string | null, storedOf: (id: string) => string | null, now: { missing: string[]; behind: string[] }) {
  const files = labels.map(readAllow);
  const first = files[0];
  if (!first) return;
  const allow = new Set(files.flatMap((f) => f.allow));
  const control = new Set(first.control);
  const windows = files.flatMap((f) => (f.run ? [{ label: f.label, start: f.run.start, end: f.run.end }] : []));
  say(`\n── against the repair${labels.length > 1 ? "s" : ""} ${labels.join(", ")}: ${windows.map((w) => `${w.label} ran ${when(w.start)} to ${when(w.end)}`).join("; ") || "no run recorded"}`);
  const line = (ids: Iterable<string>) => [...tally([...ids].map(stateOf)).entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${fmtN(v)}`).join(" · ");
  say(`  the allow-set, ${fmtN(allow.size)} bills, now: ${line(allow)}`);
  const notCurrent = [...allow].filter((id) => stateOf(id) !== "current");
  if (notCurrent.length) say(`    not current: ${notCurrent.slice(0, 60).map((id) => `${id} (${stateOf(id)}; listed ${listedOf(id)}, stored ${storedOf(id)})`).join(", ")}${notCurrent.length > 60 ? ", …" : ""}`);
  say(`  the control, ${fmtN(control.size)} bills (census ${first.census}'s behind without a newer latest action, which the ruling leaves unwritten), now: ${line(control)}`);
  const gap = new Set(readGap(first.census).map((g) => g.id));
  const newMissing = now.missing.filter((id) => !gap.has(id));
  const newBehind = now.behind.filter((id) => !gap.has(id));
  say(`  missing now and not in census ${first.census}'s gap: ${newMissing.length}${newMissing.length ? `: ${newMissing.map((id) => `${id} (listed ${listedOf(id)})`).join(", ")}` : ""}`);
  say(`  behind now and not in census ${first.census}'s gap: ${newBehind.length}${newBehind.length ? `: ${newBehind.slice(0, 40).map((id) => `${id} (listed ${listedOf(id)}, stored ${storedOf(id)})`).join(", ")}${newBehind.length > 40 ? ", …" : ""}` : ""}`);
  // The residual as the ruling names it: the control, plus whatever sits at or after the watermark instant. The
  // candidates the frontier rule left out are read as they stand; every other bill in it is placed by one detail read
  // against the last repair's watermark, the population gated first.
  const excluded = files.flatMap((f) => f.excluded.map((g) => g.id)).filter((id) => !allow.has(id));
  if (excluded.length) say(`  census ${first.census}'s candidates the frontier rule left to the cron, ${fmtN(new Set(excluded).size)}, now: ${line(new Set(excluded))}`);
  const wm = files[files.length - 1]?.watermark ?? null;
  const toPlace = [...new Set([...notCurrent, ...newMissing, ...newBehind])];
  const placed: Placement[] = [];
  if (wm && toPlace.length) {
    if (toPlace.length > VS_PLACEMENTS) say(`  the residual outside the control: ${fmtN(toPlace.length)} bills, over the ${VS_PLACEMENTS} placements a census makes; not placed`);
    else {
      say(`  the residual outside the control, ${fmtN(toPlace.length)} bills, each placed against the watermark ${wm}:`);
      for (const id of toPlace) placed.push(await place({ id, cls: stateOf(id), listed: listedOf(id) }, Date.parse(wm)));
      for (const p of placed) say(`    ${placementLine(p)}${allow.has(p.id) ? " · in the allow-set" : ""}`);
    }
  }
  // From the census's own snapshot, so the ticks between the census and the first repair are read too.
  const censusJson = path.join(ART, `census-${first.census}.json`);
  const since = (existsSync(censusJson) ? asStr(at(JSON.parse(readFileSync(censusJson, "utf8")), "census", "snapAt")) : null) ?? windows.map((w) => w.start).sort()[0];
  if (!since) return;
  const stamped = objs(await q(`vs · the rows stamped since census ${first.census}'s snapshot`, `SELECT id, changed_at, update_date FROM bills WHERE changed_at >= ? ORDER BY changed_at`, [since]));
  const inWindow = (t: string) => windows.find((w) => t >= w.start && t <= w.end)?.label ?? null;
  const inside = stamped.filter((r) => inWindow(String(r.changed_at)) !== null);
  const insideOther = inside.filter((r) => !allow.has(String(r.id)));
  const outside = stamped.filter((r) => inWindow(String(r.changed_at)) === null);
  const outsideGap = outside.filter((r) => gap.has(String(r.id)));
  const role = (id: string) => (allow.has(id) ? "allow-set" : control.has(id) ? "control" : gap.has(id) ? "excluded by the frontier" : "not in the gap");
  say(`  rows stamped since ${since}: ${fmtN(stamped.length)} · inside a repair's window ${fmtN(inside.length)}, outside the allow-set ${insideOther.length}${insideOther.length ? ` (${insideOther.map((r) => String(r.id)).join(", ")})` : ""} · outside every window ${fmtN(outside.length)} (the ticks), census ${first.census}'s gap among them ${outsideGap.length}: ${[...tally(outsideGap.map((r) => role(String(r.id)))).entries()].map(([k, v]) => `${k} ${v}`).join(" · ") || "none"}`);
  if (outside.length) say(`    outside every window: ${outside.slice(0, 60).map((r) => `${r.id} at ${r.changed_at} (${role(String(r.id))})`).join(", ")}${outside.length > 60 ? ", …" : ""}`);
  const controlStamped = stamped.filter((r) => control.has(String(r.id)));
  say(`  the control's rows stamped since: ${controlStamped.length}${controlStamped.length ? `: ${controlStamped.slice(0, 40).map((r) => `${r.id} at ${r.changed_at} (${inWindow(String(r.changed_at)) ?? "outside every window"})`).join(", ")}` : ""}`);
  results.versus = {
    labels, watermark: wm, placed, excluded: [...new Set(excluded)].map((id) => ({ id, now: stateOf(id) })),
    allow: allow.size, allowNow: Object.fromEntries(tally([...allow].map(stateOf))), notCurrent,
    control: control.size, controlNow: Object.fromEntries(tally([...control].map(stateOf))), newMissing, newBehind: newBehind.length,
    since, stamped: stamped.length, inside: inside.length, insideOther: insideOther.map((r) => String(r.id)), outside: outside.length,
    outsideGap: outsideGap.map((r) => ({ id: String(r.id), at: String(r.changed_at), role: role(String(r.id)) })),
    controlStamped: controlStamped.map((r) => ({ id: String(r.id), at: String(r.changed_at), window: inWindow(String(r.changed_at)) })),
  };
}

// ── --readings ──────────────────────────────────────────────────────────────
// The ruling's cheap readings: one detail read for each stored bill a census's walks never returned (200: Congress.gov
// still has it, so it was not dropped, and why no walk returned it is unsettled, the walk losing it or the list lagging
// its detail; 404: Congress.gov dropped it), and how many entries on the census's saved pages carry a time in
// updateDate and in updateDateIncludingText.
async function readings() {
  const label = argAt("--of") ?? "p1";
  const cj = JSON.parse(readFileSync(path.join(ART, `census-${label}.json`), "utf8")) as unknown;
  const extra = (at(cj, "census", "extraIds") as string[] | undefined) ?? [];
  say(`\n── the stored bills census ${label}'s walks never returned: ${extra.length}`);
  const rows = extra.length ? objs(await q("readings · their stored rows", `SELECT id, update_date, latest_action_date FROM bills WHERE id IN (${extra.map(() => "?").join(", ")})`, extra)) : [];
  const four: Array<{ id: string; status: number; verdict: string; stored: string | null; ud: string | null; udit: string | null; action: string | null }> = [];
  for (const id of extra) {
    const [, type, number] = id.split("-");
    const r = await cg(`detail ${id}`, `/bill/${CONGRESS}/${type}/${number}`);
    const s = rows.find((x) => String(x.id) === id);
    const verdict = r.status === 200 ? "not dropped; the walk lost it or the list lagged its detail, unsettled" : r.status === 404 ? "Congress.gov dropped it" : "unread";
    const row = {
      id, status: r.status, verdict, stored: asStr(s?.update_date),
      ud: asStr(at(r.json, "bill", "updateDate")), udit: asStr(at(r.json, "bill", "updateDateIncludingText")), action: asStr(at(r.json, "bill", "latestAction", "actionDate")),
    };
    four.push(row);
    say(`  ${id}: ${r.status} → ${verdict} · stored update_date ${row.stored}${r.status === 200 ? ` · now updateDate ${row.ud}, updateDateIncludingText ${row.udit}, latestAction ${row.action}` : ""}`);
  }
  say(`\n── the dates' precision on census ${label}'s saved pages`);
  const saved = JSON.parse(readFileSync(path.join(ART, `census-${label}-list.json`), "utf8")) as { pages: SavedPage[] };
  const fmt = (m: Map<string, number>) => [["timestamp", "with a time"], ["date", "a bare day"], ["none", "absent"], ["other", "other"]].map(([k, name]) => `${name} ${fmtN(m.get(k ?? "") ?? 0)}`).join(" · ");
  const byWalk: Record<string, unknown> = {};
  for (const walk of ["main", "tie", "half", "all"] as const) {
    const pages = walk === "all" ? saved.pages : saved.pages.filter((p) => p.walk === walk);
    if (!pages.length) continue;
    const entries = pages.flatMap((p) => p.bills);
    const ud = tally(entries.map((e) => precision(e.updateDate)));
    const udit = tally(entries.map((e) => precision(e.updateDateIncludingText)));
    say(`  ${walk}: ${pages.length} pages · ${fmtN(entries.length)} entries · updateDate: ${fmt(ud)} | updateDateIncludingText: ${fmt(udit)}`);
    byWalk[walk] = { pages: pages.length, entries: entries.length, updateDate: Object.fromEntries(ud), updateDateIncludingText: Object.fromEntries(udit) };
  }
  results.readings = { census: label, four, precision: byWalk };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!MODE) {
    console.error("usage: npx tsx scripts/diagnostic/bills-gap-788.ts --step0 | --ticks | --census [--no-details] [--vs <repair label>,…] | --impact [--of <census label>] | --repair --allow <census label> [--residual-of <repair label>] [--from <ISO>] | --readings [--of <census label>] [--label L]");
    process.exitCode = 2;
    return;
  }
  mkdirSync(ART, { recursive: true });
  const start = new Date();
  say(`HO 788 ${MODE} · label ${LABEL} · start ${when(start)} · HEAD ${git(["rev-parse", "--short", "HEAD"])} (${git(["branch", "--show-current"])}) · node ${process.version} · the ${ordinal(CONGRESS)} Congress, first day ${FIRST_DAY}`);
  let before = "";
  let failure: Error | null = null;
  try {
    before = await schemaPrint();
    say(`  prod's schema fingerprint before: ${before}`);
    if (MODE === "--step0") {
      claims1and2();
      await claim3();
      await claim4();
      await claim5();
      await claim6();
      claim7();
    } else if (MODE === "--ticks") await ticks();
    else if (MODE === "--census") await census();
    else if (MODE === "--impact") await impact();
    else if (MODE === "--readings") await readings();
    else await repair();
  } catch (e) {
    failure = e as Error;
    say(`\n  ${failure.message}`);
  } finally {
    const end = new Date();
    say(`\n── safety and cost`);
    try {
      const after = await schemaPrint();
      say(`  prod's schema fingerprint: before ${before} · after ${after} · ${before && before === after ? "unchanged" : "CHANGED OR UNREAD"}`);
      results.schema = { before, after, same: before === after };
    } catch (e) {
      say(`  the schema re-read failed: ${(e as Error).message}`);
    }
    const d = tap.db;
    say(`  prod: the instrument's own statements ${stmts} · hrana requests ${fmtN(d.requests)} · results ${fmtN(d.results)} · rows_read ${fmtN(d.rowsRead)}${d.noRead ? ` (${d.noRead} result(s) carried no rows_read)` : ""} · rows_written ${d.noWritten && d.noWritten === d.results ? "NOT CARRIED by any result" : fmtN(d.rowsWritten)}${d.noWritten && d.noWritten !== d.results ? ` (${d.noWritten} result(s) carried no rows_written)` : ""}`);
    const c = tap.cg;
    say(`  Congress.gov: ${fmtN(c.requests)} request(s) · most in flight at once ${c.maxInFlight} · the closest two starts ${Number.isFinite(c.minGapMs) ? `${c.minGapMs} ms` : "n/a"} · the quota at the last answer: x-ratelimit-limit ${c.quota.limit ?? "unread"}, x-ratelimit-remaining ${c.quota.remaining ?? "unread"}${c.quota.at ? ` at ${when(c.quota.at)}` : ""}`);
    for (const [k, v] of [...c.byEndpointStatus.entries()].sort()) say(`    ${k}: ${fmtN(v)}`);
    if (tap.other) say(`  other hosts: ${tap.other} request(s)`);
    say(`  end ${when(end)} · ${((end.getTime() - start.getTime()) / 1000).toFixed(1)} s`);
    results.cost = {
      statements: stmts, db: d, cg: { requests: c.requests, maxInFlight: c.maxInFlight, minGapMs: Number.isFinite(c.minGapMs) ? c.minGapMs : null, byEndpointStatus: Object.fromEntries(c.byEndpointStatus), byStatus: Object.fromEntries(c.byStatus), quota: c.quota },
      start: start.toISOString(), end: end.toISOString(),
    };
    if (!existsSync(LEDGER)) writeFileSync(LEDGER, "mode\tlabel\tstart_utc\tend_utc\tstatements\tresults\trows_read\trows_written\tno_rows_written\tcg_requests\tfailed\n");
    appendFileSync(LEDGER, `${MODE}\t${LABEL}\t${start.toISOString()}\t${end.toISOString()}\t${stmts}\t${d.results}\t${d.rowsRead}\t${d.rowsWritten}\t${d.noWritten}\t${c.requests}\t${failure ? "yes" : "no"}\n`);
    const base = `${MODE.slice(2)}-${LABEL}`;
    save(`${base}.log`, `${out.join("\n")}\n`);
    save(`${base}.json`, `${JSON.stringify(results, null, 2)}\n`);
    readDb?.close();
  }
  if (failure) process.exitCode = 1;
}

main().catch((e) => {
  console.error(redactSecrets(String((e as Error)?.stack ?? e)));
  process.exitCode = 1;
});
