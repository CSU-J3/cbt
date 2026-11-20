// HO 824 — why no /electoral LIST row opens with a Kalshi line, read on prod.
//
// THIS SCRIPT WRITES NOTHING TO THE DATABASE. Its only writes are <out.json>
// and its .txt twin. Every database statement it or the page's loaders send
// passes a guard on the singleton client (lib/db.ts getDb()): libSQL's
// createClient has no read-only open for a remote URL, so the guard refuses any
// statement that doesn't start with SELECT / WITH / EXPLAIN or that carries a
// write word outside its comments and string literals, any batch not in "read"
// mode, and every transaction, executeMultiple, migrate and sync.
//
// It never asks Kalshi or Ballotpedia anything: the store and the crons' own
// cron_runs rows are the evidence. (lib/kalshi.ts loads, through lib/queries.ts
// → lib/markets.ts, but none of its fetchers runs.) The pages it reads (E, F)
// are prod's own, read with a headless browser, which loads them as any reader
// would, member photos from Congress.gov's image host included.
//
//   set -a; . ./.env; set +a
//   node node_modules/tsx/dist/cli.mjs --import ./scripts/diagnostic/next-cache-stub-757.mjs \
//     scripts/diagnostic/electoral-kalshi-824.ts <out.json> [--no-pages]
//
// A  the LIST as the page builds it: the inputs buildElectoralRows takes,
//    computed as app/electoral/page.tsx:98-131 computes them (getRacesIndex,
//    getIncumbentQualifiers + incumbentTagsAt, getGeneralBallots,
//    getRecentRaceMoves, getPacIeSpending, getBallotNews, getRaceResults; the
//    page's other eight readers feed the board, not the rows), then
//    buildElectoralRows, with unstable_cache a passthrough
//    (next-cache-stub-757.mjs), so every read is uncached.
//    HO 826: this reads HO 824's shape. Since HO 826 the page runs
//    withoutStaleOdds before it builds the rows and the map, and this probe
//    doesn't, so a re-run shows a stale price (NY-01-2026's, written Nov 5)
//    that the page no longer draws.
// B  the counts per tab, and the first row on each tab that renders a line.
// C  kalshi_odds and the Kalshi cron's last twelve cron_runs rows.
// D  what changed between the last green run and the first red one.
// E  the control, on the page: prod /electoral at 1440, ON state, gate cookie.
// F  the same primitive elsewhere: `/`'s K/P line, the map card, the district
//    card, /race/AL-01-2026.
// G  the runway.
import { writeFileSync } from "node:fs";
import { chromium, type Page } from "@playwright/test";
import { getDb } from "../../lib/db";
import { buildElectoralRows, withoutCalledOdds, type ElectoralRow } from "../../lib/electoral-rows";
import { clockNowMs } from "../../lib/clock";
import { daysToElection } from "../../lib/format";
import { incumbentTagsAt, withIncumbentTags } from "../../lib/incumbent-tag";
import { kalshiActive } from "../../lib/race-colors";
import { STATE_ABBR_TO_NAME } from "../../lib/states";
import {
  getBallotNews,
  getGeneralBallots,
  getIncumbentQualifiers,
  getPacIeSpending,
  getRaceResults,
  getRacesIndex,
  getRecentRaceMoves,
} from "../../lib/queries";

const ORIGIN = "https://congressional-terminal-chi-silk.vercel.app";
const CYCLE = 2026;
// The last green e2e-prod run (44224087665, Production at c926562) and the first
// red one (44412015377, schedule at c926562): created → updated, from gh.
const GREEN = { id: 44224087665, start: "2026-11-18T02:33:04Z", end: "2026-11-18T02:42:11Z" };
const RED = { id: 44412015377, start: "2026-11-18T22:29:11Z", end: "2026-11-18T22:38:39Z" };
const HELPER_ROWS = 13; // e2e/odds-off.spec.ts openRaceWithKalshi's cap

const out = process.argv[2];
const noPages = process.argv.includes("--no-pages");
if (!out || !out.endsWith(".json")) throw new Error("usage: electoral-kalshi-824.ts <out.json> [--no-pages]");

// Mountain Standard Time, a fixed UTC-7: a date in daylight time (a 2027 close)
// would read an hour late under America/Denver with an MST label.
const mst = (ms: number | string | null | undefined) => {
  if (ms == null) return "—";
  const t = typeof ms === "string" ? Date.parse(ms) : ms;
  if (Number.isNaN(t)) return String(ms);
  return new Date(t - 7 * 3_600_000).toLocaleString("en-US", { timeZone: "UTC", hour12: true }) + " MST";
};
const res: Record<string, unknown> = {};
const lines: string[] = [];
const say = (s = "") => {
  lines.push(s);
  console.log(s);
};

// ---- the read-only guard ----------------------------------------------------
const db = getDb();
const READ_START = /^\s*(?:--[^\n]*\n\s*|\/\*[\s\S]*?\*\/\s*)*(SELECT|WITH|EXPLAIN)\b/i;
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|UPSERT|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA)\b|\bREPLACE\b(?!\s*\()/i;
let guarded = 0;
function sqlOf(stmt: unknown): string {
  if (typeof stmt === "string") return stmt;
  if (stmt && typeof stmt === "object" && "sql" in stmt) return String((stmt as { sql: unknown }).sql);
  throw new Error("[guard] unknown statement shape");
}
// The statement's code with its string literals, quoted identifiers and
// comments blanked, scanned in one pass so neither can hide the other: an
// apostrophe in a comment can't open a "literal" that swallows a write word,
// and a `--` inside a literal can't open a "comment".
function codeOnly(sql: string): string {
  let out = "";
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    const n = sql[i + 1];
    if (c === "-" && n === "-") {
      while (i < sql.length && sql[i] !== "\n") i++;
      out += " ";
    } else if (c === "/" && n === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
      out += " ";
    } else if (c === "'" || c === '"' || c === "`") {
      i++;
      while (i < sql.length) {
        if (sql[i] === c && sql[i + 1] === c) i += 2;
        else if (sql[i] === c) break;
        else i++;
      }
      i++;
      out += " ";
    } else {
      out += c;
      i++;
    }
  }
  return out;
}
function check(stmt: unknown) {
  const sql = sqlOf(stmt);
  const bare = codeOnly(sql);
  if (!READ_START.test(sql) || WRITE_WORD.test(bare)) throw new Error(`[guard] refused a non-read statement: ${sql.slice(0, 120)}`);
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

// ---- A: the list as the page builds it -----------------------------------------
const nowMs = Date.now();
const clockMs = clockNowMs();
const passed = daysToElection(CYCLE, clockMs) < 0;
res.clock = { nowMs, nowMst: mst(nowMs), clockMs, clockSeamSet: process.env.CBT_CLOCK_NOW != null, passed };
say(`HO 824 probe — run clock ${mst(nowMs)} (${new Date(nowMs).toISOString()}); election day passed: ${passed}`);
say(`DB: no read-only open exists for a remote libSQL URL; the singleton is guarded (reads only, batches "read").`);

const [index, pacByRace, incumbentTags, general] = await Promise.all([
  getRacesIndex(CYCLE),
  getPacIeSpending(CYCLE),
  getIncumbentQualifiers(CYCLE),
  getGeneralBallots(CYCLE),
]);
const races = withIncumbentTags(index, incumbentTagsAt(incumbentTags, CYCLE, clockMs));
const onBallots = [...new Set(Object.values(general.races).flatMap((g) => g.memberIds))].sort();
const [moves, news, results] = await Promise.all([
  getRecentRaceMoves(races.map((r) => r.raceId)),
  getBallotNews(onBallots),
  passed ? getRaceResults(CYCLE) : Promise.resolve(null),
]);
const { rows } = buildElectoralRows({ cycle: CYCLE, index: races, general, moves, pacByRace, news, results, nowMs, clockMs });

// kalshi_odds by race, for each row's last refresh.
const koRows = await q(
  `SELECT race_id, cycle, event_ticker, implied_pct, favorite_label, open_interest, close_time, updated_at FROM kalshi_odds`,
);
const ko = new Map(koRows.map((r) => [String(r.race_id), r]));
const readsRows = await q(
  `SELECT race_id, status, read_at, rows, marked, last_attempt_at, last_attempt FROM general_ballot_reads WHERE race_id LIKE '%-2026'`,
);
const reads = new Map(readsRows.map((r) => [String(r.race_id), r]));

type Line = {
  pos: number;
  raceId: string;
  seat: string;
  tier: string;
  kind: string;
  called: boolean;
  odds: boolean;
  ticker: string | null;
  closeTime: string | null;
  koUpdatedAt: string | null;
  active: boolean;
  line: boolean;
  readAt: string | null;
  runoffOn: string | null;
};
const lineOf = (r: ElectoralRow, i: number): Line => {
  const k = ko.get(r.raceId);
  const reading = results?.[r.raceId] as { jungle?: { runoffDate: string | null } | null; runoffOn?: string | null } | undefined;
  const called = !!r.result?.called;
  const active = kalshiActive(r.kalshiOdds, nowMs);
  return {
    pos: i + 1,
    raceId: r.raceId,
    seat: r.seat,
    tier: r.tier,
    kind: r.result?.kind ?? "null",
    called,
    odds: r.kalshiOdds != null,
    ticker: r.kalshiOdds?.eventTicker ?? null,
    closeTime: r.kalshiOdds?.closeTime ?? null,
    koUpdatedAt: k ? String(k.updated_at) : null,
    active,
    line: !called && active,
    readAt: reads.get(r.raceId)?.read_at == null ? null : String(reads.get(r.raceId)!.read_at),
    runoffOn: reading?.runoffOn ?? reading?.jungle?.runoffDate ?? null,
  };
};
const tabs = {
  senate: rows.filter((r) => r.chamber === "senate").map(lineOf),
  house: rows.filter((r) => r.chamber === "house").map(lineOf),
};
const ratedSet = new Set(rows.map((r) => r.raceId));
res.A = { loader: "app/electoral/page.tsx:98-131 → lib/electoral-rows.ts buildElectoralRows", defaultTab: "senate", tabs };

const fmtLine = (l: Line) =>
  `${String(l.pos).padStart(3)}  ${l.raceId.padEnd(11)} ${l.seat.padEnd(7)} ${l.tier.padEnd(6)} ${l.kind.padEnd(6)} called=${l.called ? "Y" : "n"} odds=${l.odds ? "Y" : "n"} close=${l.closeTime ? mst(l.closeTime) : "—"} active=${l.active ? "Y" : "n"} LINE=${l.line ? "Y" : "n"} odds-written=${l.koUpdatedAt ? l.koUpdatedAt.slice(0, 10) : "—"}`;
say("");
say("== A. the LIST as the page builds it (default tab: Senate, RaceListView.tsx:323; tiers all on, :324)");
for (const tab of ["senate", "house"] as const) {
  say(`-- ${tab} (${tabs[tab].length} rows), in the order the list renders`);
  for (const l of tabs[tab]) say(fmtLine(l));
}

// ---- B: the counts ----------------------------------------------------------------
const count = (ls: Line[]) => ({
  rows: ls.length,
  called: ls.filter((l) => l.called).length,
  notCalled: ls.filter((l) => !l.called).length,
  notCalledWithOdds: ls.filter((l) => !l.called && l.odds).length,
  notCalledActive: ls.filter((l) => !l.called && l.active).length,
  firstLine: ls.find((l) => l.line)?.pos ?? null,
  firstLineRace: ls.find((l) => l.line)?.raceId ?? null,
});
const all = [...tabs.senate, ...tabs.house];
res.B = { senate: count(tabs.senate), house: count(tabs.house), all: count(all) };
say("");
say("== B. the counts (as of the run clock)");
for (const [k, v] of Object.entries(res.B as Record<string, ReturnType<typeof count>>))
  say(
    `${k.padEnd(6)} rows ${v.rows}  called ${v.called}  not called ${v.notCalled}  not called with odds ${v.notCalledWithOdds}  not called with ACTIVE odds ${v.notCalledActive}  first row that renders a line: ${v.firstLine ?? "none"}${v.firstLineRace ? ` (${v.firstLineRace})` : ""}`,
  );

// ---- C: the store and the sync ------------------------------------------------------
const koAll = koRows.map((r) => ({
  raceId: String(r.race_id),
  close: r.close_time == null ? null : String(r.close_time),
  updated: String(r.updated_at),
}));
const newestWrite = koAll.reduce<string | null>((a, r) => (a == null || r.updated > a ? r.updated : a), null);
const byDay = (key: "close" | "updated") => {
  const m = new Map<string, { past: number; future: number; none: number }>();
  for (const r of koAll) {
    const v = r[key];
    const day = v ? v.slice(0, 10) : "(null)";
    const e = m.get(day) ?? { past: 0, future: 0, none: 0 };
    if (!v) e.none++;
    else if (Date.parse(v) < nowMs) e.past++;
    else e.future++;
    m.set(day, e);
  }
  return [...m.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([day, e]) => ({ day, ...e }));
};
const cron = await q(
  `SELECT id, started_at, ended_at, elapsed_ms, status, payload, error_message FROM cron_runs WHERE route = '/api/cron/kalshi' ORDER BY started_at DESC LIMIT 12`,
);
const lastOk = cron.find((c) => c.status === "success");
const writtenByLast = lastOk ? koAll.filter((r) => r.updated >= String(lastOk.started_at)).length : null;
res.C = {
  rows: koAll.length,
  cycles: await q(`SELECT cycle, COUNT(*) AS n FROM kalshi_odds GROUP BY cycle`),
  newestWrite,
  closeByDay: byDay("close"),
  updatedByDay: byDay("updated"),
  closePast: koAll.filter((r) => r.close && Date.parse(r.close) < nowMs).length,
  closedRows: koAll.filter((r) => r.close && Date.parse(r.close) < nowMs).map((r) => ({ ...r, listRow: rows.some((x) => x.raceId === r.raceId) })),
  closeFuture: koAll.filter((r) => r.close && Date.parse(r.close) >= nowMs).length,
  closeNull: koAll.filter((r) => !r.close).length,
  cron: cron.map((c) => ({ ...c, payload: c.payload == null ? null : String(c.payload) })),
  lastSuccess: lastOk ? String(lastOk.started_at) : null,
  rowsWrittenByLastSuccess: writtenByLast,
  // A market that left the open feed keeps its row: the upsert never deletes.
  futureCloseNotRefreshed: lastOk
    ? koAll.filter((r) => r.close && Date.parse(r.close) >= nowMs && r.updated < String(lastOk.started_at)).map((r) => ({ ...r }))
    : null,
};
say("");
say(`== C. kalshi_odds: ${koAll.length} rows; newest write ${newestWrite} (${mst(newestWrite)})`);
say(`close_time at the run clock: past ${(res.C as { closePast: number }).closePast}, future ${(res.C as { closeFuture: number }).closeFuture}, null ${(res.C as { closeNull: number }).closeNull}`);
for (const r of (res.C as { closedRows: { raceId: string; close: string; updated: string; listRow: boolean }[] }).closedRows)
  say(`  closed: ${r.raceId} close ${mst(r.close)} last written ${mst(r.updated)}${r.listRow ? " (a LIST row)" : ""}`);
say("close_time by day (UTC day): past / future / null");
for (const d of (res.C as { closeByDay: { day: string; past: number; future: number; none: number }[] }).closeByDay)
  say(`  ${d.day}  ${d.past} / ${d.future} / ${d.none}`);
say("updated_at by day (UTC day): rows last written that day");
for (const d of (res.C as { updatedByDay: { day: string; past: number; future: number; none: number }[] }).updatedByDay)
  say(`  ${d.day}  ${d.past + d.future}`);
say("the Kalshi cron's last twelve cron_runs rows: started (MST) · status · elapsed · payload");
for (const c of cron)
  say(`  ${mst(String(c.started_at))} · ${c.status} · ${c.elapsed_ms ?? "—"} ms · ${c.payload ?? c.error_message ?? "—"}`);
say(`rows written by the last success (${mst(lastOk ? String(lastOk.started_at) : null)}): ${writtenByLast}`);
// The rows the feed still carries: written since Nov 9 (UTC), newest first. The
// upsert never deletes, so every other row is a market the open-events feed
// stopped returning, kept at its last price.
const recent = await q(
  `SELECT race_id, event_ticker, implied_pct, favorite_label, close_time, updated_at FROM kalshi_odds WHERE updated_at >= '2026-11-09' ORDER BY updated_at DESC, race_id`,
);
(res.C as Record<string, unknown>).writtenSinceNov9 = recent;
say(`rows written since 2026-11-09 (UTC): ${recent.length}`);
for (const r of recent)
  say(`  ${String(r.race_id).padEnd(11)} ${r.event_ticker} ${r.implied_pct}% ${r.favorite_label} close ${r.close_time} written ${mst(String(r.updated_at))}${ratedSet.has(String(r.race_id)) ? " (a LIST row)" : ""}`);
const seatReads = await q(
  `SELECT race_id, status, read_at, rows, marked, last_attempt_at, last_attempt FROM general_ballot_reads WHERE race_id IN ('S-AK-2026','MN-01-2026','NY-01-2026') ORDER BY race_id`,
);
const queue = await q(`SELECT COUNT(*) AS n, MIN(last_attempt_at) AS oldest, MAX(last_attempt_at) AS newest FROM general_ballot_reads`);
(res.C as Record<string, unknown>).seatReads = seatReads;
(res.C as Record<string, unknown>).ballotQueue = queue[0];
say("the ballot reads of AK SEN and the two live House rows:");
for (const r of seatReads)
  say(`  ${String(r.race_id).padEnd(11)} ${r.status} read ${mst(String(r.read_at))} rows ${r.rows} marked ${r.marked} · last attempt ${mst(String(r.last_attempt_at))} ${r.last_attempt}`);
say(`the ballot queue: ${queue[0]?.n} races; last attempts from ${mst(String(queue[0]?.oldest))} to ${mst(String(queue[0]?.newest))}`);

// ---- D: what flipped between the two runs ----------------------------------------
const g0 = Date.parse(GREEN.start);
const g1 = Date.parse(GREEN.end);
const r0 = Date.parse(RED.start);
const inWindow = (v: string | null) => v != null && Date.parse(v) > g1 && Date.parse(v) < r0;
const closedInWindow = koAll.filter((r) => inWindow(r.close));
const ratedIds = new Set(all.map((l) => l.raceId));
const readInWindow = readsRows.filter((r) => inWindow(r.read_at == null ? null : String(r.read_at)) && ratedIds.has(String(r.race_id)));
// The two crons from 1:00 PM MST Nov 17 (the afternoon before the green run)
// to the red run's end: the ballot queue's last pass before the window, and
// the Kalshi ticks around S-AK's last write.
const SINCE = "2026-11-17T20:00:00Z";
const gbRuns = await q(
  `SELECT id, route, started_at, status, payload FROM cron_runs WHERE route = '/api/cron/general-ballot' AND started_at > ? AND started_at < ? ORDER BY started_at`,
  [SINCE, RED.end],
);
const kxRuns = await q(
  `SELECT id, started_at, status, payload FROM cron_runs WHERE route = '/api/cron/kalshi' AND started_at > ? AND started_at < ? ORDER BY started_at`,
  [SINCE, RED.end],
);
const senate13 = tabs.senate.slice(0, HELPER_ROWS);
// The first 13 Senate rows as each run would have seen them, on what the store
// can date: a close_time against the run's clock. A call is datable only by its
// last READ (general_ballot_reads.read_at), which a later read overwrites.
const at = (l: Line, ms: number) => ({
  raceId: l.raceId,
  closeActive: l.odds && (l.closeTime == null || Date.parse(l.closeTime) >= ms),
  calledNow: l.called,
  readAt: l.readAt,
});
res.D = {
  window: { from: GREEN.end, to: RED.start, fromMst: mst(GREEN.end), toMst: mst(RED.start) },
  closedInWindow,
  ratedReadInWindow: readInWindow,
  generalBallotRuns: gbRuns.map((c) => ({ ...c, payload: c.payload == null ? null : String(c.payload).slice(0, 2000) })),
  kalshiRuns: kxRuns.map((c) => ({ ...c, payload: c.payload == null ? null : String(c.payload).slice(0, 2000) })),
  senate13AtGreen: senate13.map((l) => at(l, g0)),
  senate13AtRed: senate13.map((l) => at(l, r0)),
};
say("");
say(`== D. between ${mst(GREEN.end)} (green ${GREEN.id} ended) and ${mst(RED.start)} (red ${RED.id} started)`);
say(`kalshi_odds close_times inside the window: ${closedInWindow.length}`);
for (const r of closedInWindow) say(`  ${r.raceId} close ${mst(r.close)} last written ${mst(r.updated)}${ratedIds.has(r.raceId) ? " (a LIST row)" : ""}`);
say(`rated seats whose last ballot READ falls inside the window: ${readInWindow.length}`);
for (const r of readInWindow) say(`  ${r.race_id} read ${mst(String(r.read_at))} status ${r.status} marked ${r.marked}`);
say(`general-ballot cron runs from ${mst(SINCE)} to the red run's end: ${gbRuns.length}`);
for (const c of gbRuns) say(`  ${mst(String(c.started_at))} · ${c.status} · ${String(c.payload ?? "").slice(0, 300)}`);
say(`kalshi cron runs from ${mst(SINCE)} to the red run's end: ${kxRuns.length}`);
for (const c of kxRuns) say(`  ${mst(String(c.started_at))} · ${c.status} · ${String(c.payload ?? "").slice(0, 160)}`);
say("the first 13 Senate rows: odds open by close_time at green → at red; called now; last read");
for (let i = 0; i < senate13.length; i++) {
  const a = (res.D as { senate13AtGreen: ReturnType<typeof at>[] }).senate13AtGreen[i]!;
  const b = (res.D as { senate13AtRed: ReturnType<typeof at>[] }).senate13AtRed[i]!;
  say(`  ${String(i + 1).padStart(2)} ${a.raceId.padEnd(11)} open@green=${a.closeActive ? "Y" : "n"} open@red=${b.closeActive ? "Y" : "n"} called now=${a.calledNow ? "Y" : "n"} last read ${mst(a.readAt)}`);
}

// ---- G: the runway ------------------------------------------------------------------
const uncalledActive = all.filter((l) => !l.called && l.active);
const runoffs = all.filter((l) => l.kind === "runoff");
const runoffBoxes = await q(
  `SELECT race_id, MAX(box_date) AS box_date, MAX(read_at) AS read_at, SUM(marked) AS marked FROM general_runoff WHERE race_id LIKE '%-2026' GROUP BY race_id`,
);
const latestClose = koAll.reduce<string | null>((a, r) => (r.close && (a == null || r.close > a) ? r.close : a), null);
const latestUncalledClose = all
  .filter((l) => !l.called && l.odds)
  .reduce<string | null>((a, l) => (l.closeTime && (a == null || l.closeTime > a) ? l.closeTime : a), null);
res.G = {
  uncalledActive: uncalledActive.map((l) => ({ raceId: l.raceId, close: l.closeTime, kind: l.kind })),
  runoffs: runoffs.map((l) => ({ raceId: l.raceId, runoffOn: l.runoffOn, odds: l.odds, close: l.closeTime, active: l.active })),
  runoffBoxes,
  latestClose,
  latestUncalledClose,
  uncalledNullClose: all.filter((l) => !l.called && l.odds && !l.closeTime).map((l) => l.raceId),
};
say("");
say(`== G. the runway: uncalled with active odds ${uncalledActive.length}; runoffs ${runoffs.length}; latest close_time in the store ${latestClose} (${mst(latestClose)})`);
for (const l of uncalledActive) say(`  active: ${l.raceId} ${l.kind} close ${mst(l.closeTime)}`);
for (const l of runoffs) say(`  runoff: ${l.raceId} on ${l.runoffOn ?? "—"} odds=${l.odds ? "Y" : "n"} close ${mst(l.closeTime)} active=${l.active ? "Y" : "n"}`);
for (const r of runoffBoxes) say(`  general_runoff box: ${r.race_id} box_date ${r.box_date} read ${mst(String(r.read_at))} marked ${r.marked}`);
say(`latest close_time among uncalled LIST rows with odds: ${latestUncalledClose} (${mst(latestUncalledClose)})`);

// ---- the cartogram's contests (the map and district cards' data) -------------------
// HO 826: withoutCalledOdds takes the called set, built from the rows as the page builds it. The page
// passes it the stale-stripped index; this passes `races`, HO 824's shape (see the header).
const carto = withoutCalledOdds(races, new Set(rows.filter((r) => r.result?.called).map((r) => r.raceId)));
const cartoActive = carto.filter((r) => kalshiActive(r.kalshiOdds, nowMs)).map((r) => r.raceId);
res.cartogramActive = cartoActive;
say("");
say(`the cartogram's contests (withoutCalledOdds(races, called), HO 824's shape: no stale strip) with active odds: ${cartoActive.length}${cartoActive.length ? ` (${cartoActive.join(", ")})` : ""}`);
say(`statements sent, all through the read guard: ${guarded}`);

// ---- E and F: the pages ------------------------------------------------------------
async function newPage(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
  await context.addCookies([{ name: "ct_seen", value: "1", url: ORIGIN }]);
  return { context, page: await context.newPage() };
}
async function settle(page: Page, path: string) {
  await page.goto(`${ORIGIN}${path}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("load").catch(() => {});
  await page.waitForTimeout(2_500);
}
async function openRow(page: Page, raceId: string) {
  const item = page.locator(`li.race-list-item[data-race="${raceId}"]`);
  await item.locator(".race-list-seat").click();
  await page.waitForTimeout(600);
  return {
    raceId,
    chip: await item.locator(".race-list-chip[data-result]").getAttribute("data-result").catch(() => null),
    open: (await item.locator(".race-list-expand").count()) > 0,
    line: await item.locator(".race-list-expand .racecard-kalshi").count(),
  };
}

if (!noPages) {
  const browser = await chromium.launch({ headless: true });
  const E: Record<string, unknown> = { at: mst(Date.now()) };
  {
    const { context, page } = await newPage(browser);
    await settle(page, "/electoral");
    E.version = await (await page.request.get(`${ORIGIN}/api/version`)).json().catch(() => null);
    E.dataOdds = await page.evaluate(() => document.documentElement.dataset.odds ?? null);
    const first = (res.B as { all: { firstLineRace: string | null } }).all.firstLineRace;
    if (first) {
      const tab = first.startsWith("S-") ? "SENATE" : "HOUSE";
      if (tab === "HOUSE") {
        await page.locator('.rl-tabs [role="tab"]', { hasText: "HOUSE" }).click();
        await page.waitForTimeout(600);
      }
      E.firstLineRow = await openRow(page, first);
    } else {
      E.firstLineRow = null;
    }
    await context.close();
  }
  {
    const { context, page } = await newPage(browser);
    await settle(page, "/electoral");
    const items = page.locator("li.race-list-item");
    E.senateItems = await items.count();
    E.divergeVisible = await page.locator(".race-list-diverge[data-market]:visible").count();
    E.divergeInked = await page
      .locator(".race-list-diverge[data-market]")
      .evaluateAll((els) => els.filter((e) => (e as HTMLElement).style.color !== "transparent").length);
    const walk: unknown[] = [];
    const n = Math.min(await items.count(), HELPER_ROWS);
    for (let i = 0; i < n; i++) {
      const item = items.nth(i);
      const raceId = await item.getAttribute("data-race");
      await item.locator(".race-list-seat").click().catch(() => {});
      await page.waitForTimeout(300);
      walk.push({
        pos: i + 1,
        raceId,
        chip: await item.locator(".race-list-chip[data-result]").getAttribute("data-result").catch(() => null),
        line: await item.locator(".race-list-expand .racecard-kalshi").count(),
      });
    }
    E.walk = walk;
    await context.close();
  }
  res.E = E;
  say("");
  say(`== E. the control, prod /electoral at 1440, ON state (data-odds ${E.dataOdds ?? "absent"}), ${E.at}, served ${(E.version as { sha?: string } | null)?.sha?.slice(0, 7) ?? "?"}`);
  say(`first row B says renders a line: ${E.firstLineRow ? JSON.stringify(E.firstLineRow) : "none (B found none)"}`);
  say(`Senate items ${E.senateItems}; .race-list-diverge visible ${E.divergeVisible}, inked (a diverging live market) ${E.divergeInked}`);
  for (const w of E.walk as { pos: number; raceId: string; chip: string | null; line: number }[])
    say(`  ${String(w.pos).padStart(2)} ${String(w.raceId).padEnd(11)} chip ${w.chip ?? "(consensus)"} line ${w.line}`);

  // F
  const F: Record<string, unknown> = { at: mst(Date.now()) };
  {
    const { context, page } = await newPage(browser);
    await settle(page, "/");
    // The race cards sit in the races box's RACES panel, which is display:none
    // until its tab opens (components/RacesBoxTabs.tsx; the default tab is
    // Hearings, app/page.tsx:218). Read the lines as loaded, then open RACES
    // (after React has hydrated the tab, HO 822) and read them again.
    const readKp = () =>
      page.locator(".rc-kpline").evaluateAll((els) =>
        els.map((el) => {
          const kalshi = el.querySelector(".rc-kp");
          return {
            seat: (el.closest("a.race-card") as HTMLElement | null)?.dataset.seat ?? null,
            visible: (el as HTMLElement).checkVisibility(),
            kalshi: (kalshi?.textContent ?? "").replace(/\s+/g, " ").trim(),
            na: !!kalshi?.querySelector(".rc-kp-na"),
          };
        }),
      );
    F.homeAtLoad = await readKp();
    const racesTab = page.locator(".dv2-racesbox-tab", { hasText: "Races" }).first();
    for (let i = 0; i < 100; i++) {
      if (await racesTab.evaluate((el) => Object.keys(el).some((k) => k.startsWith("__reactProps$")))) break;
      await page.waitForTimeout(100);
    }
    await racesTab.click();
    await page.waitForTimeout(800);
    F.home = await readKp();
    await context.close();
  }
  // The map card: on /electoral a state click opens the district modal
  // (ElectoralBoard passes onStatePick), so the pinned card is reached by the
  // map's search box (CartogramShell onSearchSubmit).
  // The map and district cards: every state holding a contest with active odds
  // (the cartogram's own list), else Alaska, the last line the crawl saw. The
  // map card's contests are collapsed rows (RaceMapCard's RaceCardRow), the
  // line in each row's open body, so each row is opened in turn.
  const probeStates = [...new Set(cartoActive.map((id) => races.find((r) => r.raceId === id)!.state))];
  if (probeStates.length === 0) probeStates.push("AK");
  F.mapCard = [];
  F.districtCard = [];
  for (const st of probeStates) {
    const stateName = STATE_ABBR_TO_NAME[st] ?? st;
    {
      const { context, page } = await newPage(browser);
      await settle(page, "/electoral");
      await page.locator(".cart-viewtoggle-btn", { hasText: "MAP" }).click();
      await page.waitForTimeout(800);
      await page.locator('input[aria-label="search the map"]').fill(st);
      await page.locator('input[aria-label="search the map"]').press("Enter");
      await page.waitForTimeout(1_000);
      const heads = page.locator('.cart-report li.racecard-row [role="button"][aria-expanded]');
      const contests: unknown[] = [];
      for (let i = 0; i < (await heads.count()); i++) {
        const head = heads.nth(i);
        await head.click();
        await page.waitForTimeout(500);
        const row = page.locator(".cart-report li.racecard-row").nth(i);
        contests.push({
          head: ((await head.textContent()) ?? "").replace(/\s+/g, " ").trim().slice(0, 60),
          line: await row.locator(".racecard-kalshi").count(),
          lineText: (await row.locator(".racecard-kalshi").allTextContents()).map((s) => s.replace(/\s+/g, " ").trim()),
        });
        await head.click();
        await page.waitForTimeout(300);
      }
      (F.mapCard as unknown[]).push({
        state: st,
        report: await page.locator(".cart-report").count(),
        head: ((await page.locator(".cart-report-head").first().textContent().catch(() => null)) ?? "").replace(/\s+/g, " ").trim(),
        contests,
      });
      await context.close();
    }
    {
      const { context, page } = await newPage(browser);
      await settle(page, "/electoral");
      await page.locator(".cart-viewtoggle-btn", { hasText: "MAP" }).click();
      await page.waitForTimeout(800);
      const tile = page.locator(`[role="button"][aria-label="${stateName}"]`).first();
      if (await tile.count()) {
        // The state's label sits over its tile (CartogramShell.tsx:384-391), and a
        // click at the tile's centre can land on whatever else is drawn there, so
        // the click is dispatched on the tile itself; React's onClick takes it.
        await tile.dispatchEvent("click");
        await page.locator(".rdm-panel").waitFor({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(1_500);
        const paths = page.locator('.rdm-panel path[style*="cursor"]');
        const nd = await paths.count();
        const districts: unknown[] = [];
        for (let i = 0; i < nd; i++) {
          await paths.nth(i).click({ force: true }).catch(() => {});
          await page.waitForTimeout(600);
          districts.push({
            title: ((await paths.nth(i).locator("title").textContent().catch(() => null)) ?? "").trim(),
            card: ((await page.locator(".rdm-detail").textContent().catch(() => null)) ?? "").replace(/\s+/g, " ").trim().slice(0, 50),
            line: await page.locator(".rdm-detail .racecard-kalshi").count(),
            lineText: (await page.locator(".rdm-detail .racecard-kalshi").allTextContents()).map((s) => s.replace(/\s+/g, " ").trim()),
          });
        }
        (F.districtCard as unknown[]).push({ state: st, modal: await page.locator(".rdm-panel").count(), clickableDistricts: nd, districts });
      } else {
        (F.districtCard as unknown[]).push({ state: st, tile: 0 });
      }
      await context.close();
    }
  }
  {
    const { context, page } = await newPage(browser);
    await settle(page, "/race/AL-01-2026");
    F.race = {
      kalshi: await page.locator(".racecard-kalshi").count(),
      marketsVisible: await page.locator("[data-market]:visible").evaluateAll((els) =>
        els.map((e) => `${e.tagName.toLowerCase()}.${(e as HTMLElement).className} "${(e.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 60)}"`),
      ),
    };
    await context.close();
  }
  res.F = F;
  await browser.close();
  type Kp = { seat: string | null; visible: boolean; kalshi: string; na: boolean };
  const home = F.home as Kp[];
  const atLoad = F.homeAtLoad as Kp[];
  say("");
  say(`== F. the same primitive elsewhere, prod, ON state, ${F.at}`);
  say(`/ .rc-kpline at load: ${atLoad.length} in the DOM, ${atLoad.filter((h) => h.visible).length} visible (the RACES panel is closed)`);
  say(`/ .rc-kpline with RACES open: ${home.length} lines, ${home.filter((h) => h.visible).length} visible; Kalshi half n/a on ${home.filter((h) => h.na).length}, a favorite on ${home.filter((h) => !h.na).length}`);
  for (const h of home) say(`  ${h.seat ?? "?"} visible=${h.visible ? "Y" : "n"} ${h.kalshi}${h.na ? " (n/a)" : ""}`);
  for (const m of F.mapCard as unknown[]) say(`/electoral map card: ${JSON.stringify(m)}`);
  for (const d of F.districtCard as unknown[]) say(`/electoral district card: ${JSON.stringify(d)}`);
  say(`/race/AL-01-2026: ${JSON.stringify(F.race)}`);
}

res.statementsGuarded = guarded;
res.endedAt = mst(Date.now());
writeFileSync(out, JSON.stringify(res, null, 2));
writeFileSync(out.replace(/\.json$/, ".txt"), lines.join("\n") + "\n");
say("");
say(`wrote ${out} — ${guarded} statements, all reads`);
