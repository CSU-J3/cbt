// HO 829 — were the Nov 20 stalls the store's, or the PC's? Production's side,
// read from the crons' own cron_runs rows.
//
// THIS SCRIPT WRITES NOTHING TO THE DATABASE. Its only writes are <out.json>
// and its .txt twin. Every database statement it sends passes HO 824's guard on
// the singleton client (lib/db.ts getDb()): libSQL's createClient has no
// read-only open for a remote URL, so the guard refuses any statement that
// doesn't start with SELECT / WITH / EXPLAIN or that carries a write word
// outside its comments and string literals, any batch not in "read" mode, and
// every transaction, executeMultiple, migrate and sync.
//
// It reads cron_runs only. Production's crons run on Vercel (pdx1) against the
// same store the PC read, and each row's elapsed_ms runs from the client clock
// before its first statement (startCronRun's INSERT) to the client clock before
// its last (finishCronRun's UPDATE), so a store that stalls inside a run
// lengthens it.
//
//   set -a; . ./.env; set +a
//   node node_modules/tsx/dist/cli.mjs scripts/diagnostic/store-stalls-829.ts <out.json>
//
// A1 which routes write rows: each route's runs in the baseline week, beside
//    vercel.json's schedule (a scheduled path that never writes is invisible
//    here).
// A2 the baseline: each route's median and 95th-percentile elapsed_ms over the
//    7 days before Nov 20 (Nov 13 00:00 to Nov 20 00:00 MST), success rows
//    only; the other statuses are counted beside it.
// A3 the windows: every run that started inside a window, or started before it
//    and ended inside or after it (or never ended), for the three stall windows
//    and the three controls, each 15 minutes either side; with its route's
//    median, p95 and the ratio to the median.
// A4 the anomalies: every run in the 24 hours around the stalls (Nov 20 9:00 AM
//    to Nov 21 9:00 AM MST) whose status isn't success, or whose elapsed_ms is
//    over three times its route's median.
import { readFileSync, writeFileSync } from "node:fs";
import { getDb } from "../../lib/db";
import { redactSecrets } from "../../lib/redact";

const out = process.argv[2];
if (!out || !out.endsWith(".json")) throw new Error("usage: store-stalls-829.ts <out.json>");

// Mountain Standard Time, a fixed UTC-7 (Nov 20 is standard time).
const MST_MS = 7 * 3_600_000;
const mst = (iso: string | number | null | undefined): string => {
  if (iso == null) return "—";
  const t = typeof iso === "number" ? iso : Date.parse(iso);
  if (Number.isNaN(t)) return String(iso);
  return new Date(t - MST_MS).toLocaleString("en-US", { timeZone: "UTC", hour12: true }) + " MST";
};
const mstTime = (iso: string | null | undefined): string => {
  if (iso == null) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return String(iso);
  return new Date(t - MST_MS).toLocaleTimeString("en-US", { timeZone: "UTC", hour12: true });
};
// An MST wall time on a given November 2026 day, as an ISO UTC string.
const atMst = (day: number, h: number, m: number, s = 0): string =>
  new Date(Date.UTC(2026, 10, day, h, m, s) + MST_MS).toISOString();

// ---- the read-only guard (HO 824's, verbatim in effect) ------------------------
const db = getDb();
const READ_START = /^\s*(?:--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(SELECT|WITH|EXPLAIN)\b/i;
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|UPSERT|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA)\b|\bREPLACE\b(?!\s*\()/i;
let guarded = 0;
function sqlOf(stmt: unknown): string {
  if (typeof stmt === "string") return stmt;
  if (stmt && typeof stmt === "object" && "sql" in stmt) return String((stmt as { sql: unknown }).sql);
  throw new Error("[guard] unknown statement shape");
}
function codeOnly(sql: string): string {
  let o = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const n = sql[i + 1];
    if (c === "-" && n === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      o += " ";
    } else if (c === "/" && n === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      o += " ";
    } else if (c === "'" || c === '"' || c === "`") {
      i++;
      while (i < sql.length) {
        if (sql[i] === c && sql[i + 1] === c) i += 2;
        else if (sql[i] === c) break;
        else i++;
      }
      i++;
      o += " ";
    } else {
      o += c;
      i++;
    }
  }
  return o;
}
function check(stmt: unknown) {
  const sql = sqlOf(stmt);
  if (!READ_START.test(sql) || WRITE_WORD.test(codeOnly(sql))) throw new Error(`[guard] refused a non-read statement: ${sql.slice(0, 120)}`);
  guarded++;
}
/* eslint-disable @typescript-eslint/no-explicit-any */
const anyDb = db as any;
const realExecute = anyDb.execute.bind(db);
const realBatch = anyDb.batch.bind(db);
anyDb.execute = (stmt: unknown, args?: unknown) => {
  check(stmt);
  return args === undefined ? realExecute(stmt) : realExecute(stmt, args);
};
anyDb.batch = (stmts: unknown[], mode?: string) => {
  if (mode !== "read") throw new Error(`[guard] refused a batch in mode ${mode ?? "(none)"}`);
  stmts.forEach(check);
  return realBatch(stmts, mode);
};
for (const k of ["transaction", "executeMultiple", "migrate", "sync"]) {
  anyDb[k] = () => {
    throw new Error(`[guard] refused ${k}`);
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */
const q = async (sql: string, args: (string | number)[] = []) => (await anyDb.execute({ sql, args })).rows as Record<string, unknown>[];

// ---- the windows ------------------------------------------------------------------
// The stalls, as HO 828's artifacts time them (MST, Nov 20), from the first
// slow reading to the last (docs/handoffs/829-artifacts/pc-side-828-readings.md).
// Each is read 15 minutes either side.
const PAD_MS = 15 * 60_000;
type Win = { key: string; label: string; coreFrom: string; coreTo: string; from: string; to: string };
const pad = (key: string, label: string, from: string, to: string): Win => ({
  key,
  label,
  coreFrom: from,
  coreTo: to,
  from: new Date(Date.parse(from) - PAD_MS).toISOString(),
  to: new Date(Date.parse(to) + PAD_MS).toISOString(),
});
const STALLS: Win[] = [
  pad("S1", "stall 1, 6:04:14 to 6:06:50 PM (index-rows' abort to Leg D's second re-read)", atMst(20, 18, 4, 14), atMst(20, 18, 6, 50)),
  pad("S2", "stall 2, 9:03:34 to 9:05:33 PM (crawl run 1: /stale?stage=floor 20.5 s, ?chamber=house past 45 s, two tests at 17 s)", atMst(20, 21, 3, 34), atMst(20, 21, 5, 33)),
  pad("S3", "stall 3, 10:02:59 to 10:05:53 PM (crawl run 4's slow start: two /electoral documents past 45 s)", atMst(20, 22, 2, 59), atMst(20, 22, 5, 53)),
];
// The controls: three spans the same evening that HO 828's artifacts show the
// PC reading the store normally, each read 15 minutes either side.
const CONTROLS: Win[] = [
  pad("C1", "control 1, 5:36:38 to 5:47:55 PM (Legs E, A, B, C, D and crawl run 0, 237 of 237)", atMst(20, 17, 36, 38), atMst(20, 17, 47, 55)),
  pad("C2", "control 2, 9:21:10 to 9:27:43 PM (the Leg A plants and the day-cross probe)", atMst(20, 21, 21, 10), atMst(20, 21, 27, 43)),
  pad("C3", "control 3, 9:37:16 to 9:46:39 PM (the cache-key legs, crawl run 3, 237 of 237, Legs B and A)", atMst(20, 21, 37, 16), atMst(20, 21, 46, 39)),
];
const BASE_FROM = atMst(13, 0, 0);
const BASE_TO = atMst(20, 0, 0);
const AROUND_FROM = atMst(20, 9, 0);
const AROUND_TO = atMst(21, 9, 0);

// vercel.json's crons, read from the file.
const vercelCrons = (JSON.parse(readFileSync(new URL("../../vercel.json", import.meta.url), "utf8")) as {
  crons: { path: string; schedule: string }[];
}).crons;

// ---- the reads --------------------------------------------------------------------
const res: Record<string, unknown> = {};
const lines: string[] = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};
const clock = Date.now();
say(`HO 829 store-stalls probe · ${mst(clock)} (${new Date(clock).toISOString()})`);
say(`baseline ${mst(BASE_FROM)} to ${mst(BASE_TO)}; around ${mst(AROUND_FROM)} to ${mst(AROUND_TO)}`);

type Run = {
  id: number;
  route: string;
  started_at: string;
  ended_at: string | null;
  elapsed_ms: number | null;
  status: string;
  error_message: string | null;
};
const toRun = (r: Record<string, unknown>): Run => ({
  id: Number(r.id),
  route: String(r.route),
  started_at: String(r.started_at),
  ended_at: r.ended_at == null ? null : String(r.ended_at),
  elapsed_ms: r.elapsed_ms == null ? null : Number(r.elapsed_ms),
  status: String(r.status),
  error_message: r.error_message == null ? null : redactSecrets(String(r.error_message)),
});
const RUN_COLS = "id, route, started_at, ended_at, elapsed_ms, status, error_message";

// What a run did, from its payload (redacted at write, lib/cron-log.ts, and
// again here): its numeric and boolean fields, and its arrays' lengths, two
// levels deep. Read for the window and anomaly rows only.
const digestOf = (payload: unknown): string => {
  let v: unknown = payload;
  if (typeof v === "string") {
    try {
      v = JSON.parse(redactSecrets(v));
    } catch {
      return "(payload not JSON)";
    }
  }
  const parts: string[] = [];
  const walk = (o: unknown, path: string, depth: number) => {
    if (o == null) return;
    if (typeof o === "number" || typeof o === "boolean") parts.push(`${path}=${o}`);
    else if (Array.isArray(o)) parts.push(`${path}[${o.length}]`);
    else if (typeof o === "object" && depth < 2)
      for (const [k, x] of Object.entries(o as Record<string, unknown>)) walk(x, path ? `${path}.${k}` : k, depth + 1);
  };
  walk(v, "", 0);
  return parts.join(" ");
};
const digests = new Map<number, string>();
const readDigests = async (ids: number[]) => {
  const need = ids.filter((id) => !digests.has(id));
  for (let i = 0; i < need.length; i += 50) {
    const chunk = need.slice(i, i + 50);
    const rows = await q(`SELECT id, payload FROM cron_runs WHERE id IN (${chunk.map(() => "?").join(",")})`, chunk);
    for (const r of rows) digests.set(Number(r.id), digestOf(r.payload));
  }
};

// A1 + A2: the baseline week, every row.
const baseRows = (
  await q(`SELECT ${RUN_COLS} FROM cron_runs WHERE started_at >= ? AND started_at < ? ORDER BY route, started_at`, [BASE_FROM, BASE_TO])
).map(toRun);

// Median: the middle value, or the mean of the middle two. p95: nearest rank,
// the ceil(0.95 n)-th smallest.
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  if (!n) return null;
  return n % 2 ? s[(n - 1) / 2]! : (s[n / 2 - 1]! + s[n / 2]!) / 2;
};
const p95 = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.ceil(0.95 * s.length) - 1]!;
};
type Base = { route: string; runs: number; success: number; other: Record<string, number>; median: number | null; p95: number | null; max: number | null };
const base = new Map<string, Base>();
for (const r of baseRows) {
  const b = base.get(r.route) ?? { route: r.route, runs: 0, success: 0, other: {}, median: null, p95: null, max: null };
  b.runs++;
  if (r.status === "success") b.success++;
  else b.other[r.status] = (b.other[r.status] ?? 0) + 1;
  base.set(r.route, b);
}
for (const b of base.values()) {
  const xs = baseRows.filter((r) => r.route === b.route && r.status === "success" && r.elapsed_ms != null).map((r) => r.elapsed_ms!);
  b.median = median(xs);
  b.p95 = p95(xs);
  b.max = xs.length ? Math.max(...xs) : null;
}
res.baseline = [...base.values()];

// A2b (an addition to the handoff's A2): the same baseline per slot, the route
// at the same minute past the hour. A route's runs differ by slot (summarize's
// :00 run follows news' :00 run, every hour), so a ratio to the route's
// all-slot median would flag every top-of-hour run.
const slotOf = (iso: string) => new Date(iso).getUTCMinutes();
const slotKey = (route: string, iso: string) => `${route}@:${String(slotOf(iso)).padStart(2, "0")}`;
type Slot = { slot: string; success: number; median: number | null; p95: number | null; max: number | null };
const slots = new Map<string, Slot>();
for (const r of baseRows) {
  if (r.status !== "success" || r.elapsed_ms == null) continue;
  const k = slotKey(r.route, r.started_at);
  if (!slots.has(k)) slots.set(k, { slot: k, success: 0, median: null, p95: null, max: null });
}
for (const s of slots.values()) {
  const xs = baseRows
    .filter((r) => r.status === "success" && r.elapsed_ms != null && slotKey(r.route, r.started_at) === s.slot)
    .map((r) => r.elapsed_ms!);
  s.success = xs.length;
  s.median = median(xs);
  s.p95 = p95(xs);
  s.max = xs.length ? Math.max(...xs) : null;
}
res.slots = [...slots.values()];

say("");
say("== A1 which routes write cron_runs (baseline week) beside vercel.json");
const logged = new Set(base.keys());
for (const c of vercelCrons) {
  const b = base.get(c.path);
  say(`  ${c.path.padEnd(32)} ${c.schedule.padEnd(14)} ${b ? `${b.runs} runs` : "NO ROWS in the baseline week"}`);
}
for (const r of logged) if (!vercelCrons.some((c) => c.path === r)) say(`  ${r.padEnd(32)} (not in vercel.json) ${base.get(r)!.runs} runs`);
res.vercelCrons = vercelCrons.map((c) => ({ ...c, baselineRuns: base.get(c.path)?.runs ?? 0 }));

say("");
say("== A2 the baseline: success rows' elapsed_ms, Nov 13 00:00 to Nov 20 00:00 MST");
say("  route                            runs  success  median    p95      max      other statuses");
for (const b of [...base.values()].sort((a, z) => a.route.localeCompare(z.route))) {
  say(
    `  ${b.route.padEnd(32)} ${String(b.runs).padStart(4)}  ${String(b.success).padStart(7)}  ${String(b.median ?? "—").padStart(7)}  ${String(b.p95 ?? "—").padStart(7)}  ${String(b.max ?? "—").padStart(7)}  ${JSON.stringify(b.other)}`,
  );
}

say("");
say("== A2b the baseline per slot (the route at the same minute past the hour), success rows, same week");
say("  slot                                success  median    p95      max");
for (const s of [...slots.values()].sort((a, z) => a.slot.localeCompare(z.slot))) {
  say(`  ${s.slot.padEnd(36)} ${String(s.success).padStart(6)}  ${String(s.median ?? "—").padStart(7)}  ${String(s.p95 ?? "—").padStart(7)}  ${String(s.max ?? "—").padStart(7)}`);
}

// A3: the windows.
const ratio = (r: Run) => {
  const m = base.get(r.route)?.median;
  return r.elapsed_ms != null && m ? Math.round((r.elapsed_ms / m) * 100) / 100 : null;
};
const slotFor = (r: Run) => slots.get(slotKey(r.route, r.started_at));
const slotRatio = (r: Run) => {
  const m = slotFor(r)?.median;
  return r.elapsed_ms != null && m ? Math.round((r.elapsed_ms / m) * 100) / 100 : null;
};
const windowRows = async (w: Win) =>
  (
    await q(
      `SELECT ${RUN_COLS} FROM cron_runs
       WHERE started_at <= ? AND (started_at >= ? OR ended_at IS NULL OR ended_at >= ?)
       ORDER BY started_at`,
      [w.to, w.from, w.from],
    )
  )
    .map(toRun)
    // ended_at IS NULL also matches rows from long before: keep only those that
    // started within a day of the window.
    .filter((r) => Date.parse(r.started_at) > Date.parse(w.from) - 86_400_000);
const windowsOut: unknown[] = [];
for (const [group, ws] of [["stall", STALLS], ["control", CONTROLS]] as const) {
  for (const w of ws) {
    const rows = await windowRows(w);
    await readDigests(rows.map((r) => r.id));
    // In flight during the span itself, not its padding: started at or before
    // its end, and ended at or after its start (or never ended).
    const inFlight = rows.filter(
      (r) => r.started_at <= w.coreTo && (r.ended_at == null || r.ended_at >= w.coreFrom),
    );
    say("");
    say(`== A3 ${w.key}: ${w.label}`);
    say(`   read ${mstTime(w.from)} to ${mstTime(w.to)} MST (${w.from} to ${w.to}), ${rows.length} runs`);
    say(
      `   in flight during the span itself (${mstTime(w.coreFrom)} to ${mstTime(w.coreTo)}): ${inFlight.length}${inFlight.length ? " — " + inFlight.map((r) => `${r.route} ${mstTime(r.started_at)}`).join(", ") : ""}`,
    );
    say("   route                          start (MST)    end (MST)      elapsed  status   median   p95     ratio  slot med  slot p95  slot ratio  error · what it did");
    for (const r of rows) {
      const b = base.get(r.route);
      say(
        `   ${r.route.padEnd(30)} ${mstTime(r.started_at).padEnd(14)} ${mstTime(r.ended_at).padEnd(14)} ${String(r.elapsed_ms ?? "—").padStart(7)}  ${r.status.padEnd(7)}  ${String(b?.median ?? "—").padStart(6)}  ${String(b?.p95 ?? "—").padStart(6)}  ${String(ratio(r) ?? "—").padStart(5)}  ${String(slotFor(r)?.median ?? "—").padStart(8)}  ${String(slotFor(r)?.p95 ?? "—").padStart(8)}  ${String(slotRatio(r) ?? "—").padStart(10)}  ${r.error_message ? r.error_message.slice(0, 140) + " · " : ""}${(digests.get(r.id) ?? "").slice(0, 200)}`,
      );
    }
    windowsOut.push({
      group,
      ...w,
      inFlight: inFlight.map((r) => r.id),
      runs: rows.map((r) => ({
        ...r,
        startMst: mst(r.started_at),
        endMst: mst(r.ended_at),
        median: base.get(r.route)?.median ?? null,
        p95: base.get(r.route)?.p95 ?? null,
        ratio: ratio(r),
        slot: slotKey(r.route, r.started_at),
        slotMedian: slotFor(r)?.median ?? null,
        slotP95: slotFor(r)?.p95 ?? null,
        slotRatio: slotRatio(r),
        did: digests.get(r.id) ?? null,
      })),
    });
  }
}
res.windows = windowsOut;

// A4: the anomalies in the 24 hours around.
const around = (
  await q(`SELECT ${RUN_COLS} FROM cron_runs WHERE started_at >= ? AND started_at < ? ORDER BY started_at`, [AROUND_FROM, AROUND_TO])
).map(toRun);
const anomalies = around.filter((r) => {
  const m = base.get(r.route)?.median;
  return r.status !== "success" || (r.elapsed_ms != null && m != null && r.elapsed_ms > 3 * m);
});
await readDigests(anomalies.map((r) => r.id));
say("");
say(`== A4 the 24 hours around (${mst(AROUND_FROM)} to ${mst(AROUND_TO)}): ${around.length} runs, ${anomalies.length} not success or over 3x their median`);
for (const r of anomalies) {
  const b = base.get(r.route);
  say(
    `   ${r.route.padEnd(30)} ${mst(r.started_at).padEnd(26)} ${String(r.elapsed_ms ?? "—").padStart(7)} ms  ${r.status.padEnd(8)} median ${b?.median ?? "—"}  ratio ${ratio(r) ?? "—"}  slot ${slotKey(r.route, r.started_at)} median ${slotFor(r)?.median ?? "—"} ratio ${slotRatio(r) ?? "—"}  ${r.error_message ? r.error_message.slice(0, 160) + " · " : ""}${(digests.get(r.id) ?? "").slice(0, 160)}`,
  );
}
// The same 24 hours by route: runs, and the slowest run's ratio.
say("   by route: runs · success · slowest elapsed (ratio to median)");
const byRoute = new Map<string, Run[]>();
for (const r of around) byRoute.set(r.route, [...(byRoute.get(r.route) ?? []), r]);
for (const [route, rs] of [...byRoute.entries()].sort((a, z) => a[0].localeCompare(z[0]))) {
  const slow = rs.filter((r) => r.elapsed_ms != null).sort((a, z) => z.elapsed_ms! - a.elapsed_ms!)[0];
  say(
    `   ${route.padEnd(32)} ${String(rs.length).padStart(4)} · ${String(rs.filter((r) => r.status === "success").length).padStart(4)} · ${slow ? `${slow.elapsed_ms} ms at ${mstTime(slow.started_at)} (${ratio(slow) ?? "—"})` : "—"}`,
  );
}
res.around = { from: AROUND_FROM, to: AROUND_TO, runs: around.length, anomalies: anomalies.map((r) => ({ ...r, startMst: mst(r.started_at), ratio: ratio(r), slot: slotKey(r.route, r.started_at), slotRatio: slotRatio(r), did: digests.get(r.id) ?? null })) };

say("");
say(`statements through the read guard: ${guarded}`);
res.guarded = guarded;
res.clock = new Date(clock).toISOString();
writeFileSync(out, JSON.stringify(res, null, 2));
writeFileSync(out.replace(/\.json$/, ".txt"), lines.join("\n") + "\n");
