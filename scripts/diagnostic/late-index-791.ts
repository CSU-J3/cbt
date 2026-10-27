// HO 791: the same-day late-index sampler (backlog's same-day line, HO 790), the frontier's first week of ticks, and
// STEP 0's prod and Congress.gov claims.
//
//   npx tsx scripts/diagnostic/late-index-791.ts --step0
//   npx tsx scripts/diagnostic/late-index-791.ts --ticks
//   npx tsx scripts/diagnostic/late-index-791.ts --sample [--n 500] [--days 7] [--seed <int>]
//
// --step0    claims 3, 4, 6 and 10: sync_state's bills_frontier and bills_wide_at and sync_queue's rows (3); every
//            /api/sync row since 00:00Z Oct 26 (4); census-790a.csv's and census-790b.csv's behind and missing counts
//            (6); one Congress.gov detail read and its x-ratelimit-remaining (10).
// --ticks    every /api/sync row since the HO 790 FF's Production READY (19:14:03Z Oct 25), one table row per tick from
//            the payload's `sync` object, the sums, and the CRS meter: crsOnly summed over upserted summed. Then the
//            committee walk's rows since 00:05Z Oct 26 (the payload's `bills` object).
// --sample   the population is every bills row with update_date in the last --days; --n of them by a seeded shuffle
//            (mulberry32; the seed defaults to the run's start epoch second and is printed). bills_frontier (F) is
//            read once before the first detail read; then one detail read per bill (15 s cap, fetchJson's 429 retry),
//            U2 = updateDateIncludingText ?? updateDate to the second, U1 = the stored update_date. Classes: current
//            (U2 = U1), pending (U2 > U1, U2 >= F), same-day miss (U2 > U1, U2 < F, same UTC day: the shape the line
//            names, first wherever U2 falls), wide-reachable (U2 > U1, U2 < F, a later day, U2 >= F - 48 h), wide-unreachable (U2 > U1, a later day,
//            U2 < F - 48 h), ahead (U2 < U1), unread (the detail failed). THE CONTROL runs before any class prints:
//            five current bills chosen by the seed have U1 moved back one hour in memory (each eligible: U1 at or past
//            01:00Z so the day holds, U2 < F) and must read same-day miss; five others moved back three days (each
//            eligible: U2 < F - 48 h) must read wide-unreachable; every other sampled bill must read as it does
//            unmodified. Then the real classification on the stored values. A sampler that compared days would read
//            all ten as current, and so would one never built: the control is the difference.
//
// SAFETY. Prod is read through q(), which refuses anything but SELECT or WITH … SELECT and any statement naming a write
// keyword; this script writes nothing to prod. TURSO_DATABASE_URL, TURSO_AUTH_TOKEN and CONGRESS_API_KEY are read
// from .env by name. Congress.gov requests carry the key in the query, as production does; every printed or saved line
// passes redactSecrets, and the request lines print the path alone. Times print in Mountain Time on a 12-hour clock
// with UTC beside. Artifacts go to docs/handoffs/791-artifacts/ (repo-ignored).
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type ResultSet, type Row } from "@libsql/client";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { redactSecrets } from "../../lib/redact";

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const MODES = ["--step0", "--ticks", "--sample"] as const;
type Mode = (typeof MODES)[number];
const MODE: Mode | undefined = MODES.find((m) => process.argv.includes(m));
const ART = path.resolve("docs/handoffs/791-artifacts"); // repo-ignored
const ART788 = path.resolve("docs/handoffs/788-artifacts"); // repo-ignored
const MT = "America/Denver";
const ROUTE = "/api/sync";
const WALK_ROUTE = "/api/cron/committees";
const FF_READY = "2026-10-25T19:14:03Z"; // HO 790's Production READY
const STEP0_SINCE = "2026-10-26T00:00:00Z";
const WALK_SINCE = "2026-10-26T00:05:00Z";
const HOUR = 3_600_000;
const DAY_MS = 86_400_000;
const WIDE_WINDOW_MS = 48 * HOUR; // lib/sync.ts WIDE_WINDOW_MS
const DETAIL_TIMEOUT_MS = 15_000; // lib/sync.ts PER_DETAIL_TIMEOUT_MS

const out: string[] = [];
const say = (s = "") => { const r = redactSecrets(s); out.push(r); process.stdout.write(`${r}\n`); };
const fmtN = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(2)}%` : "n/a");
const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();
const isoS = (ms: number) => new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
const dayOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const save = (name: string, body: string) => { mkdirSync(ART, { recursive: true }); writeFileSync(path.join(ART, name), redactSecrets(body)); };
const objs = (rs: ResultSet) => rs.rows.map((r: Row) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i] ?? null])) as Record<string, unknown>);
const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "bigint" ? Number(v) : null);
// A stored or listed instant to epoch ms at second precision; null when it isn't one.
const toMs = (s: unknown): number | null => {
  if (typeof s !== "string" || !s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : Math.floor(t / 1000) * 1000;
};
const lag = (ms: number) => {
  const s = Math.round(ms / 1000);
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return `${d ? `${d}d ` : ""}${h}h ${String(m).padStart(2, "0")}m ${String(r).padStart(2, "0")}s`;
};

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
async function q(label: string, sql: string, args: InArgs = []): Promise<ResultSet> {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql) || WRITE_WORD.test(sql)) throw new Error(`HALT: the read path writes nothing, and this is not a SELECT: ${label}`);
  const t = Date.now();
  const rs = await prod().execute({ sql, args });
  const shownArgs = Array.isArray(args) && args.length ? `  · args ${JSON.stringify(args).slice(0, 300)}` : "";
  say(`  [q] ${label}`);
  say(`      ${oneLine(sql)}${shownArgs}`);
  say(`      → ${fmtN(rs.rows.length)} row(s) · ${Date.now() - t}ms · read ${when(new Date())}`);
  return rs;
}

// ── Congress.gov, the key in the query as production sends it, never printed ───
type Detail = { status: number; json: unknown; ms: number; remaining: string | null; err: string };
async function detail(id: string, attempt = 0): Promise<Detail> {
  const key = (process.env.CONGRESS_API_KEY ?? "").trim();
  if (!key) throw new Error("CONGRESS_API_KEY is not set in .env");
  const [c, t, n] = id.split("-");
  const url = `https://api.congress.gov/v3/bill/${c}/${t}/${n}?format=json&api_key=${encodeURIComponent(key)}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(DETAIL_TIMEOUT_MS) });
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (res.status === 429 && attempt < 3) {
      await sleep(2000 * (attempt + 1));
      return detail(id, attempt + 1);
    }
    const body = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(body); } catch { json = null; }
    return { status: res.status, json, ms: Date.now() - t0, remaining, err: res.ok ? "" : `HTTP ${res.status}` };
  } catch (e) {
    return { status: 0, json: null, ms: Date.now() - t0, remaining: null, err: (e as Error).name === "TimeoutError" ? `timeout ${DETAIL_TIMEOUT_MS}ms` : (e as Error).message };
  }
}
// lib/sync.ts effectiveUpdate: updateDateIncludingText ?? updateDate.
function detailInstant(json: unknown): string | null {
  const b = (json as { bill?: { updateDateIncludingText?: string; updateDate?: string } } | null)?.bill;
  return b?.updateDateIncludingText ?? b?.updateDate ?? null;
}

// ── STEP 0 ──────────────────────────────────────────────────────────────────
async function step0() {
  say(`\n── claim 3: sync_state's bills_frontier and bills_wide_at; sync_queue's rows`);
  const ss = objs(await q("3 · sync_state, the two keys", `SELECT key, value, updated_at FROM sync_state WHERE key IN ('bills_frontier', 'bills_wide_at') ORDER BY key`));
  for (const r of ss) say(`  ${r.key} = ${r.value} (${when(r.value)}) · updated_at ${when(r.updated_at)}`);
  if (!ss.some((r) => r.key === "bills_frontier")) say(`  HALT: bills_frontier is absent`);
  const sq = objs(await q("3 · sync_queue, every row", `SELECT bill_id, source, list_update_day, enqueued_at, attempts, last_error FROM sync_queue ORDER BY enqueued_at`));
  say(`  sync_queue: ${sq.length} row(s)`);
  for (const r of sq) say(`    ${r.bill_id} · ${r.source} · list day ${r.list_update_day} · enqueued ${when(r.enqueued_at)} · attempts ${r.attempts}${r.last_error ? ` · ${r.last_error}` : ""}`);
  const stale = sq.filter((r) => (asNum(r.attempts) ?? 0) >= 1 && Date.now() - (toMs(r.enqueued_at) ?? Date.now()) > 12 * HOUR);
  say(`  rows with attempts >= 1 enqueued over 12 hours ago: ${stale.length}${stale.length ? ": HALT" : ""}`);

  say(`\n── claim 4: every /api/sync row since ${when(STEP0_SINCE)}`);
  const ticks = objs(await q("4 · /api/sync rows", `SELECT id, started_at, status, elapsed_ms FROM cron_runs WHERE route = ? AND started_at >= ? ORDER BY started_at`, [ROUTE, STEP0_SINCE]));
  for (const t of ticks) say(`  #${t.id} · ${when(t.started_at)} · ${t.status} · ${fmtN(asNum(t.elapsed_ms) ?? 0)} ms`);
  const bad = ticks.filter((t) => t.status !== "success");
  say(`  ${ticks.length} row(s), not success: ${bad.length}${bad.length ? ": HALT" : ""}`);

  say(`\n── claim 6: census-790a.csv and census-790b.csv, behind and missing`);
  for (const label of ["790a", "790b"]) {
    const f = path.join(ART788, `census-${label}.csv`);
    if (!existsSync(f)) { say(`  census-${label}.csv absent (not gating)`); continue; }
    const lines = readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean);
    const cls = lines[0]!.split(",").indexOf("class");
    const counts = new Map<string, number>();
    for (const l of lines.slice(1)) { const k = l.split(",")[cls] ?? ""; counts.set(k, (counts.get(k) ?? 0) + 1); }
    say(`  census-${label}.csv: ${lines.length - 1} data row(s) · behind ${fmtN(counts.get("behind") ?? 0)} · missing ${fmtN(counts.get("missing") ?? 0)}${[...counts.keys()].some((k) => k !== "behind" && k !== "missing") ? ` · other classes ${JSON.stringify(Object.fromEntries(counts))}` : ""}`);
  }

  say(`\n── claim 10: one Congress.gov detail read, x-ratelimit-remaining`);
  const d = await detail("119-hr-1");
  say(`    GET /bill/119/hr/1 → ${d.status || d.err} · ${d.ms}ms · x-ratelimit-remaining ${d.remaining ?? "(absent)"}`);
  const rem = Number(d.remaining);
  say(`  ${Number.isFinite(rem) && rem >= 2000 ? "at or over 2,000" : "UNDER 2,000 or unread: wait for the reset"}`);
}

// ── --ticks ─────────────────────────────────────────────────────────────────
const SYNC_KEYS = ["listComplete", "pages", "listedCount", "enqueued", "upserted", "queueBefore", "queueAfter", "resets", "resetByAction", "resetByText", "crsOnly", "wide", "wideComplete", "budgetStopped", "failed", "droppedCount"] as const;
const SUMMED = ["pages", "enqueued", "upserted", "resets", "resetByAction", "resetByText", "crsOnly", "failed", "droppedCount"] as const;
const WALK_KEYS = ["billsWalked", "remaining", "failed.count", "capHit"] as const;
const cell = (v: unknown) => (v === null || v === undefined ? "—" : v === 1 || v === true ? (typeof v === "boolean" ? "true" : "1") : v === 0 || v === false ? (typeof v === "boolean" ? "false" : "0") : typeof v === "number" ? fmtN(v) : String(v));
const bool = (v: unknown) => (v === 1 || v === true ? "true" : v === 0 || v === false ? "false" : cell(v));
const BOOLS = new Set<string>(["listComplete", "wide", "wideComplete", "budgetStopped", "capHit"]);

async function ticks() {
  const cols = SYNC_KEYS.map((k) => `COALESCE(json_extract(payload, '$.payload.sync.${k}'), json_extract(payload, '$.sync.${k}')) AS "${k}"`).join(",\n            ");
  const rows = objs(await q(
    "ticks · /api/sync since the FF's READY",
    `SELECT id, started_at, status, elapsed_ms,
            ${cols}
     FROM cron_runs WHERE route = ? AND started_at >= ? ORDER BY started_at`,
    [ROUTE, FF_READY],
  ));
  const md: string[] = [];
  md.push(`| tick | started | status | elapsed_ms | ${SYNC_KEYS.join(" | ")} |`);
  md.push(`|${"---|".repeat(4 + SYNC_KEYS.length)}`);
  const sums = Object.fromEntries(SUMMED.map((k) => [k, 0])) as Record<(typeof SUMMED)[number], number>;
  let withStats = 0;
  for (const r of rows) {
    if (asNum(r.upserted) !== null) withStats++;
    for (const k of SUMMED) sums[k] += asNum(r[k]) ?? 0;
    md.push(`| #${r.id} | ${when(r.started_at)} | ${r.status} | ${cell(asNum(r.elapsed_ms))} | ${SYNC_KEYS.map((k) => (BOOLS.has(k) ? bool(r[k]) : cell(r[k]))).join(" | ")} |`);
  }
  md.push(`| **sum** | ${rows.length} ticks | | | | ${cell(sums.pages)} | | ${cell(sums.enqueued)} | ${cell(sums.upserted)} | | | ${cell(sums.resets)} | ${cell(sums.resetByAction)} | ${cell(sums.resetByText)} | ${cell(sums.crsOnly)} | | | | ${cell(sums.failed)} | ${cell(sums.droppedCount)} |`);
  say(`\n── /api/sync since ${when(FF_READY)}: ${rows.length} row(s), ${withStats} with sync stats`);
  for (const l of md) say(l);
  say(`\n  the CRS meter: crsOnly ${fmtN(sums.crsOnly)} over upserted ${fmtN(sums.upserted)} = ${pct(sums.crsOnly, sums.upserted)} (resets ${fmtN(sums.resets)}: by action ${sums.resetByAction}, by text ${sums.resetByText})`);
  const notOk = rows.filter((r) => r.status !== "success");
  say(`  not success: ${notOk.length}${notOk.length ? `: ${notOk.map((r) => `#${r.id} ${r.status}`).join(", ")}` : ""}`);

  const wcols = WALK_KEYS.map((k) => `COALESCE(json_extract(payload, '$.payload.bills.${k}'), json_extract(payload, '$.bills.${k}')) AS "${k}"`).join(",\n            ");
  const walk = objs(await q(
    "ticks · the committee walk since 00:05Z Oct 26",
    `SELECT id, started_at, status,
            ${wcols}
     FROM cron_runs WHERE route = ? AND started_at >= ? ORDER BY started_at`,
    [WALK_ROUTE, WALK_SINCE],
  ));
  say(`\n── the committee walk since ${when(WALK_SINCE)}: ${walk.length} row(s)`);
  say(`| tick | started | status | billsWalked | remaining | failed | capHit |`);
  say(`|---|---|---|---|---|---|---|`);
  for (const r of walk) say(`| #${r.id} | ${when(r.started_at)} | ${r.status} | ${cell(r.billsWalked)} | ${cell(r.remaining)} | ${cell(r["failed.count"])} | ${bool(r.capHit)} |`);
  const last = walk[walk.length - 1];
  const rem = asNum(last?.remaining);
  if (last && rem !== null) {
    const ticksLeft = Math.ceil(rem / 500);
    const lastMs = toMs(last.started_at)!;
    say(`  remaining ${fmtN(rem)} after #${last.id}: at 500 a tick and four ticks a day, ${ticksLeft} more tick(s), the last near ${when(lastMs + ticksLeft * 6 * HOUR)} (a projection, not a reading)`);
  }
  save(`ticks-${isoS(Date.now()).slice(0, 16).replace(":", "")}.log`, `${out.join("\n")}\n`);
}

// ── --sample ────────────────────────────────────────────────────────────────
// mulberry32: a 32-bit seeded generator, so a run is reproducible by --seed.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(xs: T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}
type Cls = "current" | "pending" | "same-day miss" | "wide-reachable" | "wide-unreachable" | "ahead" | "unread";
const CLASSES: Cls[] = ["current", "pending", "same-day miss", "wide-reachable", "wide-unreachable", "ahead", "unread"];
function classify(u1: number | null, u2: number | null, f: number): Cls {
  if (u1 === null || u2 === null) return "unread";
  if (u2 === u1) return "current";
  if (u2 < u1) return "ahead";
  if (u2 >= f) return "pending";
  // The handoff's same-day and wide-unreachable classes overlap where U2 < F - 48 h on U1's day; same-day comes first
  // (the first run's control, seed 1793058413, read its five -1 h bills wide-unreachable with the window checked
  // first). Below the frontier a same-day late index is missed whether the wide window reaches it or not: inside it
  // the day compare passes it over, beyond it the wide listing never lists it. The reading marks which.
  if (dayOf(u2) === dayOf(u1)) return "same-day miss";
  return u2 < f - WIDE_WINDOW_MS ? "wide-unreachable" : "wide-reachable";
}
type S = { id: string; u1s: string; u1: number | null; u2s: string | null; u2: number | null; err: string; cls: Cls };

async function sample() {
  const n = Number(argAt("--n") ?? 500);
  const days = Number(argAt("--days") ?? 7);
  const seed = Number(argAt("--seed") ?? Math.floor(Date.now() / 1000));
  if (!Number.isInteger(n) || n < 1 || !Number.isFinite(days) || days <= 0 || !Number.isInteger(seed)) throw new Error("--n, --days and --seed take positive numbers (--seed an integer)");
  const since = isoS(Date.now() - days * DAY_MS);
  say(`\n── the sample: seed ${seed} · n ${n} · days ${days} · population update_date >= ${since} (${when(since)})`);

  const pop = objs(await q("sample · the population", `SELECT id, update_date FROM bills WHERE update_date >= ? ORDER BY id`, [since]));
  say(`  population ${fmtN(pop.length)}`);
  const picked = shuffle(pop, rng(seed)).slice(0, n);
  say(`  sampled ${fmtN(picked.length)}`);

  const fr = objs(await q("sample · bills_frontier and bills_wide_at, once, before the first detail read", `SELECT key, value, updated_at FROM sync_state WHERE key IN ('bills_frontier', 'bills_wide_at') ORDER BY key`));
  const fRow = fr.find((r) => r.key === "bills_frontier");
  const wRow = fr.find((r) => r.key === "bills_wide_at");
  const F = toMs(fRow?.value);
  if (F === null) throw new Error("HALT: bills_frontier is absent or unparsed");
  const W = toMs(wRow?.value);
  say(`  F = ${fRow?.value} (${when(F)}) · F - 48 h = ${isoS(F - WIDE_WINDOW_MS)} · bills_wide_at = ${wRow?.value ?? "absent"}${W !== null ? ` (${when(W)})` : ""}`);

  say(`\n  detail reads, sequential, 15 s cap each:`);
  const rows: S[] = [];
  const t0 = Date.now();
  let lastRemaining: string | null = null;
  for (const [i, p] of picked.entries()) {
    const id = String(p.id);
    const d = await detail(id);
    if (d.remaining) lastRemaining = d.remaining;
    const u2s = d.err ? null : detailInstant(d.json);
    const u1s = String(p.update_date);
    rows.push({ id, u1s, u1: toMs(u1s), u2s, u2: toMs(u2s), err: d.err || (u2s ? "" : "no update date in the detail"), cls: "unread" });
    if ((i + 1) % 50 === 0 || i + 1 === picked.length) say(`    ${i + 1}/${picked.length} · ${((Date.now() - t0) / 1000).toFixed(0)} s · x-ratelimit-remaining ${lastRemaining ?? "?"}`);
    await sleep(150);
  }
  for (const r of rows) r.cls = classify(r.u1, r.u2, F);

  // THE CONTROL, before any class prints.
  say(`\n── the control, on the same reads, U1 moved in memory only`);
  const cr = rng(seed ^ 0x5bd1e995);
  const cur = rows.filter((r) => r.cls === "current");
  const hourOk = shuffle(cur.filter((r) => r.u1! - HOUR >= Date.parse(`${dayOf(r.u1!)}T00:00:00Z`) && r.u2! < F), cr).slice(0, 5);
  const used = new Set(hourOk.map((r) => r.id));
  const dayOk = shuffle(cur.filter((r) => !used.has(r.id) && r.u2! < F - WIDE_WINDOW_MS), cr).slice(0, 5);
  const shift = new Map<string, number>([...hourOk.map((r) => [r.id, HOUR] as const), ...dayOk.map((r) => [r.id, 3 * DAY_MS] as const)]);
  let controlOk = hourOk.length === 5 && dayOk.length === 5;
  let othersMoved = 0;
  for (const r of rows) {
    const s = shift.get(r.id);
    const c = classify(r.u1 === null ? null : r.u1 - (s ?? 0), r.u2, F);
    if (s === HOUR) { say(`  -1 h  ${r.id} · U1 ${r.u1s} → ${isoS(r.u1! - HOUR)} · U2 ${r.u2s} · reads ${c}`); if (c !== "same-day miss") controlOk = false; }
    else if (s === 3 * DAY_MS) { say(`  -3 d  ${r.id} · U1 ${r.u1s} → ${isoS(r.u1! - 3 * DAY_MS)} · U2 ${r.u2s} · reads ${c}`); if (c !== "wide-unreachable") controlOk = false; }
    else if (c !== r.cls) othersMoved++;
  }
  if (othersMoved) controlOk = false;
  say(`  eligible: ${hourOk.length} of 5 for -1 h (current, U1 at or past 01:00Z, U2 < F) · ${dayOk.length} of 5 for -3 d (current, U2 < F - 48 h) · every other bill unchanged: ${othersMoved === 0 ? "yes" : `NO, ${othersMoved} moved`}`);
  say(`  the control ${controlOk ? "PASSES: five same-day miss, five wide-unreachable, nothing else moved" : "FAILS: the classes below are not a reading"}`);
  if (!controlOk) { save(`sample-${seed}.log`, `${out.join("\n")}\n`); process.exitCode = 1; return; }

  // The reading, on the stored values.
  say(`\n── the reading, unmodified`);
  const counts = new Map<Cls, number>(CLASSES.map((c) => [c, 0]));
  for (const r of rows) counts.set(r.cls, counts.get(r.cls)! + 1);
  say(`  ${CLASSES.map((c) => `${c} ${counts.get(c)}`).join(" · ")} · total ${rows.length}`);
  const non = rows.filter((r) => r.cls !== "current");
  if (non.length) say(`\n  every non-current bill (F = ${isoS(F)}):`);
  const tickStarts = non.some((r) => r.cls === "wide-reachable")
    ? objs(await q("sample · /api/sync ticks since the oldest wide-reachable U2", `SELECT started_at FROM cron_runs WHERE route = ? AND started_at >= ? ORDER BY started_at`, [ROUTE, isoS(Math.min(...non.filter((r) => r.cls === "wide-reachable").map((r) => r.u2!)))])).map((t) => toMs(t.started_at)!)
    : [];
  for (const r of non) {
    let extra = "";
    if (r.cls === "unread") extra = ` · ${r.err}`;
    else if (r.u1 !== null && r.u2 !== null) extra = ` · lag U2 - U1 ${lag(Math.abs(r.u2 - r.u1))}${r.u2 < r.u1 ? " (U1 ahead)" : ""}`;
    if (r.cls === "wide-reachable") {
      const waited = tickStarts.filter((t) => t > r.u2!).length;
      extra += ` · ticks since U2: ${waited}${W !== null && r.u2! < W ? ` · U2 is before bills_wide_at: the last wide listing ran past it and didn't take it` : ""}`;
    }
    say(`    ${r.id} · ${r.cls} · U1 ${r.u1s} · U2 ${r.u2s ?? "—"} · F ${isoS(F)}${extra}`);
  }
  const misses = rows.filter((r) => r.cls === "same-day miss");
  say(`\n  same-day misses: ${misses.length}${misses.length ? ` · lags ${misses.map((r) => `${r.id} ${lag(r.u2! - r.u1!)}${r.u2! < F - WIDE_WINDOW_MS ? " (beyond the wide window)" : ""}`).join(", ")}` : ""}`);
  save(`sample-${seed}.csv`, `id,U1,U2,class\n${rows.map((r) => `${r.id},${r.u1s},${r.u2s ?? ""},${r.cls}`).join("\n")}\n`);
  save(`sample-${seed}.log`, `${out.join("\n")}\n`);
  say(`  wrote docs/handoffs/791-artifacts/sample-${seed}.csv and .log`);
}

async function main() {
  config({ path: ".env", quiet: true });
  if (!MODE) throw new Error(`one of ${MODES.join(", ")}`);
  say(`late-index-791 ${MODE} · ${when(new Date())}`);
  if (MODE === "--step0") { await step0(); save(`step0-${isoS(Date.now()).slice(0, 16).replace(":", "")}.log`, `${out.join("\n")}\n`); }
  else if (MODE === "--ticks") await ticks();
  else await sample();
}
main().catch((e) => { say(`FAILED: ${(e as Error).message}`); process.exitCode = 1; });
