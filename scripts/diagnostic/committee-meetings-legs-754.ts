// HO 754 legs: the committee-meetings walk, whole list per tick and compared per
// event, run end to end against a `file:` copy through the REAL route wrappers. The
// routes run on a LOCAL PRODUCTION BUILD (`next build`, then `next start`) whose
// database is a file copy and whose api.congress.gov answers come from
// committee-meetings-shim-754.cjs: recorded list orderings sliced at any offset, and
// details built from the stored rows (or recorded), failed, null, delayed or moved on
// command. The meeting readers are called for real through
// committee-meetings-queries-754.ts. Each leg is seen red on the old code (the
// committees route's meetings step, HEAD 0263059) before it is read green on the new.
//
//   npx tsx scripts/diagnostic/committee-meetings-legs-754.ts --prepare          prod SELECTs, once
//   npm run build && npx tsx scripts/diagnostic/committee-meetings-legs-754.ts --template --label red
//   npx tsx scripts/diagnostic/committee-meetings-legs-754.ts --legs 1,2,3,4,5,6,7,8,8b --label red
//
//   1 whole list   an event above the page-1/page-2 boundary is deleted between the two reads,
//                  so the event at the boundary moves up one place: it is refreshed exactly
//                  once, this tick or next; a read whose count moved stamps nothing absent, not
//                  even the two House rows no list carries, and the next complete read does
//   1b (from the review) an event already read is deleted and a stored one not yet read is
//                  updated to the head between page 1 and the rest: the unique ids equal the
//                  final count, and only the count moving shows the read was not whole; the
//                  live event is not stamped absent
//   2 failure      one event's detail fails; the row stays older and the next tick refreshes it
//   3 older        the 4 Senate events HO 752 read older, from their recorded list rows and
//                  details: refreshed on the first run
//   4 absent       the list drops two stored events: stamped once, kept, and the seven
//                  lib/queries readers stop returning them (the weekly band's count, breakdown
//                  and history follow); restored, the stamp clears; the 752 instrument's table
//                  mode reads the marks. The three other filtered sites (getStaleBills' heard
//                  flag, the weekly report's committee activity, the week summary's count) are
//                  read in code, not run
//   5 give-up      a null detail five ticks running is named in `gaveUp` and skipped on the
//                  sixth; a newer list updateDate brings it back
//   6 deadline     (a) a 9s delay on every detail: the tick stops at 50s, the attempt in flight
//                  is cut by the cap 3s after, refreshed rows are complete, nothing else changed
//                  or was charged, the row `success` with the stop reason; (b, from the review)
//                  a detail that never answers, ahead of a newer owed event: charged, the newer
//                  one refreshed, the run inside the 55s soft timeout; (c, from the review) the
//                  list pages hang: the run records `error`
//   7 split        the committees route runs no meetings step; the new route runs nothing
//                  else; /api/health watches both
//   8 the tie      HO 752's recorded Senate tie at offset 500 (337641 repeated, 337725
//                  skipped): every tied event stored once
//   8b (beyond the eight, named) the same tie moved onto a boundary of the new paging
//                  (25 events above it dropped) with the tie's order flipping on every
//                  request: every tied event stored once. Green only: the old paging's
//                  boundaries are elsewhere, so it has no red of its own
//
// SAFETY. Prod is only ever READ (SELECT only, a guard refuses anything else), once, by
// --prepare, and for a fingerprint before and after. Every write goes to a file built as
// `file:${abs}` from a path that must end in -754-legs.db; migrate, the server, the query
// probe and the instrument are spawned with that URL and TURSO_AUTH_TOKEN set to "" (a
// deleted key would be refilled from .env by dotenv or Next's loader), and the instrument
// also gets it as --db. The query probe refuses any other scheme or a token.
// Before any tick, /api/health on the spawned server must return a sentinel row that
// exists only in the copy. The recorded bodies carry no key; every printed line passes
// redactSecrets.
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InValue, type ResultSet } from "@libsql/client";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const CONGRESS = 119;
const ROUTE_OLD = "/api/cron/committees";
const ROUTE_NEW = "/api/cron/committee-meetings";
const SENTINEL = "2026-09-28T19:00:00.754Z";
const PORT = 3754;
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/754-artifacts");
const REC = path.join(ART, "recorded");
const SHIM = path.resolve("scripts/diagnostic/committee-meetings-shim-754.cjs").replace(/\\/g, "/");
const STUB = "./scripts/diagnostic/next-cache-stub-754.mjs";
const QPROBE = "scripts/diagnostic/committee-meetings-queries-754.ts";
const INSTRUMENT = "scripts/diagnostic/committees-cursor-752.ts";
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const OLDER_752 = ["338704", "338668", "338667", "338681"];
const HOUSE_GONE_752 = ["119523", "119525"];
const TIE_752 = ["337761", "337725", "337731", "337724", "337641", "337723"];

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
const say = (s: string) => console.log(redactSecrets(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const check = (leg: string, label: string, ok: boolean, detail: string) => {
  say(`  ${ok ? "PASS" : "FAIL"}  [leg ${leg}] ${label}: ${detail}`);
  if (ok) passes++; else fails++;
};

// ── prod, read-only ─────────────────────────────────────────────────────────
function prodDb(): { db: Client; read: (sql: string, args?: InArgs) => Promise<ResultSet> } {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("libsql://")) throw new Error("reading prod needs the prod libsql:// URL in .env");
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  return { db, read: (sql, args) => { if (!/^\s*SELECT\b/i.test(sql)) throw new Error("prod is read-only here"); return db.execute({ sql, args: args ?? [] }); } };
}
async function prodFingerprint(): Promise<string> {
  const { db, read } = prodDb();
  const a = (await read(`SELECT route, MAX(id) AS id FROM cron_runs WHERE route IN (?, ?) GROUP BY route ORDER BY route`, [ROUTE_OLD, ROUTE_NEW])).rows.map((r) => `${r.route}#${r.id}`);
  const b = (await read(`SELECT COUNT(*) AS n, MAX(update_date) AS mx FROM committee_meetings`)).rows[0]!;
  const c = (await read(`SELECT chamber, update_date FROM meeting_sync_state ORDER BY chamber`)).rows.map((r) => `${r.chamber}=${r.update_date}`);
  db.close();
  return JSON.stringify({ runs: a, meetings: [b.n, b.mx], watermarks: c });
}

// ── --prepare: the recorded orderings, the details, the seed (prod SELECTs, once) ─
type Item = { eventId: string; updateDate: string };
type Seed = { at: string; meetings: Record<string, unknown>[]; meetingBills: { event_id: string; bill_id: string }[]; watermarks: Record<string, string> };
function orderingFromPages(file: string): { items: Item[]; flips: number } {
  // The pages overlap by 25, and two reads of the same places can order a tie differently
  // (the thing the overlap exists for). The ordering is the deduplicated set, newest first,
  // a tie in the order its members were first read: one valid order of the list.
  const s = JSON.parse(readFileSync(file, "utf8")) as { pages: { offset: number; count: number | null; ids: Item[] }[] };
  const first = new Map<string, { item: Item; at: number }>();
  const atPos = new Map<number, string>();
  let flips = 0;
  for (const p of s.pages) p.ids.forEach((x, i) => {
    const id = String(x.eventId), pos = p.offset + i;
    if (atPos.has(pos) && atPos.get(pos) !== id) flips++;
    atPos.set(pos, id);
    if (!first.has(id)) first.set(id, { item: { eventId: id, updateDate: String(x.updateDate) }, at: pos });
  });
  const items = [...first.values()].sort((x, y) => y.item.updateDate.localeCompare(x.item.updateDate) || x.at - y.at).map((v) => v.item);
  const count = s.pages[s.pages.length - 1]?.count;
  if (items.length !== count) throw new Error(`${file}: ${items.length} unique of ${count}`);
  return { items, flips };
}
async function prepare() {
  mkdirSync(REC, { recursive: true });
  const { items: house, flips: hf } = orderingFromPages(path.join(ART, "step0-list-house.json"));
  const { items: senate, flips: sf } = orderingFromPages(path.join(ART, "step0-list-senate.json"));
  writeFileSync(path.join(REC, "house-A.json"), JSON.stringify({ from: "754 STEP 0", items: house }));
  writeFileSync(path.join(REC, "senate-A.json"), JSON.stringify({ from: "754 STEP 0", items: senate }));
  // HO 752's Senate recording: the page at 250 saw 337641 at 0-based 499; the page at 500
  // saw 337641 again at 502 and never 337725. B is the order the page at 500 (and the
  // recovery window) saw; A is B with 499 and 502 swapped, the order the page at 250 saw.
  const r752 = JSON.parse(readFileSync("docs/handoffs/752-artifacts/meetings-list-senate.json", "utf8")) as { pages: { recovery?: boolean; committeeMeetings: { eventId: string | number; updateDate: string }[] }[] };
  const raw = r752.pages.filter((p) => !p.recovery).flatMap((p) => p.committeeMeetings).map((x) => ({ eventId: String(x.eventId), updateDate: String(x.updateDate) }));
  if (raw[499]!.eventId !== "337641" || raw[502]!.eventId !== "337641" || raw.some((x) => x.eventId === "337725")) throw new Error("HO 752's recording is not the one this leg reconstructs");
  const B = raw.map((x, i) => (i === 499 ? { eventId: "337725", updateDate: x.updateDate } : x));
  const A = B.map((x, i) => (i === 499 ? B[502]! : i === 502 ? B[499]! : x));
  if (new Set(B.map((x) => x.eventId)).size !== B.length || new Set(A.map((x) => x.eventId)).size !== A.length) throw new Error("the tie orderings are not permutations");
  writeFileSync(path.join(REC, "senate-752-A.json"), JSON.stringify({ from: "752 recording, the order the page at 250 saw", items: A }));
  writeFileSync(path.join(REC, "senate-752-B.json"), JSON.stringify({ from: "752 recording, the order the page at 500 saw", items: B }));
  // The seed and the built details, from one prod snapshot.
  const { db, read } = prodDb();
  const at = new Date().toISOString();
  const meetings = (await read(`SELECT event_id, congress, chamber, meeting_date, meeting_type, meeting_status, title, location_building, location_room, video_url, committee_system_code, update_date FROM committee_meetings ORDER BY event_id`)).rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => isNaN(Number(k)))));
  const meetingBills = (await read(`SELECT event_id, bill_id FROM meeting_bills ORDER BY event_id, bill_id`)).rows.map((r) => ({ event_id: String(r.event_id), bill_id: String(r.bill_id) }));
  const watermarks = Object.fromEntries((await read(`SELECT chamber, update_date FROM meeting_sync_state`)).rows.map((r) => [String(r.chamber), String(r.update_date)]));
  db.close();
  writeFileSync(path.join(REC, "seed.json"), JSON.stringify({ at, meetings, meetingBills, watermarks } satisfies Seed));
  const billsOf = new Map<string, string[]>();
  for (const mb of meetingBills) billsOf.set(mb.event_id, [...(billsOf.get(mb.event_id) ?? []), mb.bill_id]);
  const details: Record<string, unknown> = {};
  for (const m of meetings) {
    const id = String(m.event_id);
    details[id] = {
      eventId: id, chamber: m.chamber, congress: m.congress, date: m.meeting_date, type: m.meeting_type, meetingStatus: m.meeting_status, title: m.title,
      location: { building: m.location_building, room: m.location_room }, updateDate: m.update_date,
      committees: m.committee_system_code ? [{ systemCode: m.committee_system_code }] : [],
      videos: m.video_url ? [{ name: "watch", url: m.video_url }] : [],
      relatedItems: { bills: (billsOf.get(id) ?? []).map((b) => { const [c, t, n] = b.split("-"); return { congress: Number(c), type: t!.toUpperCase(), number: n }; }) },
      meetingDocuments: [],
    };
  }
  writeFileSync(path.join(REC, "details-built.json"), JSON.stringify(details));
  copyFileSync(path.join(ART, "details-step0.json"), path.join(REC, "details-real.json"));
  say(`prepared at ${at}: house ${house.length} (overlap places read in a different order ${hf}) · senate ${senate.length} (${sf}) · 752 tie orderings ${A.length} · seed ${meetings.length} meetings, ${meetingBills.length} meeting_bills · details built ${Object.keys(details).length} · real ${Object.keys(JSON.parse(readFileSync(path.join(REC, "details-real.json"), "utf8"))).length}`);
}
const recFile = (name: string) => path.join(REC, name);
const items = (name: string): Item[] => (JSON.parse(readFileSync(recFile(name), "utf8")) as { items: Item[] }).items;
const seedData = (): Seed => JSON.parse(readFileSync(recFile("seed.json"), "utf8")) as Seed;
// The first position at or after k whose updateDate is strictly below the one before it,
// so a watermark there collects exactly the events above it.
function cut(list: Item[], k: number): number { for (let i = Math.max(1, k); i < list.length; i++) if (list[i]!.updateDate < list[i - 1]!.updateDate) return i; throw new Error("no strict cut"); }

// ── templates, copies, seeding ──────────────────────────────────────────────
const templatePath = (label: string) => path.join(DIR, `template-${label}-754-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-754-legs.db")) throw new Error(`refused: a copy must be a *-754-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
function treeState(): string {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const files = ["lib/meetings-sync.ts", "app/api/cron/committees/route.ts", "scripts/migrate.ts", "lib/queries.ts", "lib/cron-health.ts", "vercel.json"];
  const head = (f: string) => { try { return execFileSync("git", ["rev-parse", `HEAD:${f}`], { encoding: "utf8" }).trim(); } catch { return ""; } };
  const blob = (f: string) => (existsSync(f) ? execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim() : "absent");
  const differ = files.filter((f) => blob(f) !== head(f));
  const pin = (f: string) => blob(f).slice(0, 10);
  const newRoute = existsSync("app/api/cron/committee-meetings/route.ts") ? `present ${pin("app/api/cron/committee-meetings/route.ts")}` : "absent";
  const build = existsSync(".next/BUILD_ID") ? `${readFileSync(".next/BUILD_ID", "utf8").trim()} @ ${statSync(".next/BUILD_ID").mtime.toISOString()}` : "none";
  return `tree ${sha} · the walk's files: ${differ.length ? `${differ.length} of ${files.length} differ from HEAD (${differ.map((f) => path.basename(f)).join(", ")})` : `all ${files.length} at HEAD`} · new route ${newRoute} · blobs meetings-sync ${pin(files[0]!)} committees-route ${pin(files[1]!)} migrate ${pin(files[2]!)} queries ${pin(files[3]!)} · build ${build} · driver ${pin("scripts/diagnostic/committee-meetings-legs-754.ts")} shim ${pin("scripts/diagnostic/committee-meetings-shim-754.cjs")} probe ${pin(QPROBE)} instrument ${pin(INSTRUMENT)}`;
}
function template(label: string) {
  mkdirSync(DIR, { recursive: true });
  const abs = templatePath(label);
  const url = copyUrl(abs);
  if (existsSync(abs)) rmSync(abs);
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url };
  env.TURSO_AUTH_TOKEN = ""; // not deleted: dotenv and Next's env loader would refill a missing key from .env
  const out = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env, encoding: "utf8" });
  if (out.status !== 0) throw new Error(`migrate against the template failed: ${redactSecrets((out.stderr || out.stdout).slice(-600))}`);
  say(`template ${label}: ${abs} (the real scripts/migrate.ts against scheme ${url.split(":")[0]}:) · ${treeState()}`);
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error(`refused: writes go to file: only (got ${url.split(":")[0]}:)`);
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
async function hasCol(url: string, table: string, col: string): Promise<boolean> {
  return withDb(url, async (db) => (await db.execute(`PRAGMA table_info(${table})`)).rows.some((r) => String(r.name) === col));
}
async function hasTable(url: string, table: string): Promise<boolean> {
  return withDb(url, async (db) => Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?`, args: [table] })).rows[0]!.n) === 1);
}
type CopyOpts = {
  lists: { house: Item[]; senate: Item[] }; // what tick 1 serves, for the normalize step
  keepOlder?: string[]; // events left older than the list (the leg's targets)
  deleteRows?: string[];
  ageRows?: Record<string, string>;
  watermarks?: Partial<Record<"house" | "senate", string>>;
  report?: { weekStart: string; weekEnd: string };
};
async function newCopy(leg: string, o: CopyOpts): Promise<{ abs: string; url: string }> {
  const abs = path.join(DIR, `leg${leg}-${LABEL}-${Date.now()}-754-legs.db`);
  copyFileSync(templatePath(LABEL), abs);
  const url = copyUrl(abs);
  const seed = seedData();
  const listed = new Map<string, string>();
  for (const x of [...o.lists.house, ...o.lists.senate]) listed.set(x.eventId, x.updateDate);
  const keep = new Set([...(o.keepOlder ?? []), ...Object.keys(o.ageRows ?? {})]);
  let normalized = 0;
  await withDb(url, async (db) => {
    const stmts: { sql: string; args: InValue[] }[] = [];
    for (const m of seed.meetings) {
      const id = String(m.event_id);
      if (o.deleteRows?.includes(id)) continue;
      let ud = String(m.update_date);
      const lu = listed.get(id);
      if (o.ageRows?.[id]) ud = o.ageRows[id]!;
      else if (lu && ud < lu && !keep.has(id)) { ud = lu; normalized++; }
      stmts.push({ sql: `INSERT INTO committee_meetings (event_id, congress, chamber, meeting_date, meeting_type, meeting_status, title, location_building, location_room, video_url, committee_system_code, update_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, args: [id, m.congress as InValue, m.chamber as InValue, m.meeting_date as InValue, m.meeting_type as InValue, m.meeting_status as InValue, m.title as InValue, m.location_building as InValue, m.location_room as InValue, m.video_url as InValue, m.committee_system_code as InValue, ud] });
    }
    for (const mb of seed.meetingBills) if (!o.deleteRows?.includes(mb.event_id)) stmts.push({ sql: `INSERT OR IGNORE INTO meeting_bills (event_id, bill_id) VALUES (?, ?)`, args: [mb.event_id, mb.bill_id] });
    const wm = { ...seed.watermarks, ...(o.watermarks ?? {}) };
    for (const [ch, u] of Object.entries(wm)) stmts.push({ sql: `INSERT INTO meeting_sync_state (chamber, update_date) VALUES (?, ?)`, args: [ch, u] });
    stmts.push({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 754, 'success', '{"sentinel":"HO 754 legs, file copy only"}')`, args: [ROUTE_OLD, SENTINEL, SENTINEL] });
    if (o.report) stmts.push({ sql: `INSERT INTO reports (slug, week_start, week_end, title, content_md, created_at) VALUES (?, ?, ?, 'HO 754 leg', 'HO 754 leg', ?)`, args: [`ho754-${o.report.weekStart}`, o.report.weekStart, o.report.weekEnd, SENTINEL] });
    for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500), "write");
  });
  say(`  copy ${path.basename(abs)} · scheme file: · seeded ${seed.meetings.length - (o.deleteRows?.length ?? 0)} meetings (snapshot ${seed.at}), ${seed.meetingBills.length} meeting_bills · normalized to the served list ${normalized} · deleted ${o.deleteRows?.length ?? 0} · aged ${Object.keys(o.ageRows ?? {}).length} · kept older ${o.keepOlder?.length ?? 0} · watermarks ${JSON.stringify({ ...seed.watermarks, ...(o.watermarks ?? {}) })} · absent_upstream_at ${await hasCol(url, "committee_meetings", "absent_upstream_at")} · walk state ${await hasTable(url, "committee_meeting_walk_state")}`);
  return { abs, url };
}

// ── the shim's control and log, the server ──────────────────────────────────
type Control = Record<string, unknown>;
type Shim = { control: string; log: string; set: (c: Control) => void; mark: () => number; since: (m: number) => string[] };
function shimFor(leg: string): Shim {
  const control = path.join(DIR, `shim-${leg}-${LABEL}-${Date.now()}.json`);
  const log = path.join(DIR, `shim-${leg}-${LABEL}-${Date.now()}.log`);
  writeFileSync(control, "{}");
  writeFileSync(log, "");
  return {
    control, log,
    set: (c) => writeFileSync(control, JSON.stringify({ details: recFile("details-built.json"), realDetails: recFile("details-real.json"), ...c })),
    mark: () => readFileSync(log, "utf8").length,
    since: (m) => readFileSync(log, "utf8").slice(m).split(/\r?\n/).filter(Boolean),
  };
}
const L = { house: recFile("house-A.json"), senate: recFile("senate-A.json") };
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
type Tick = { http: number; ms: number; lines: string[] };
type Server = { tick: (route: string, label: string) => Promise<Tick>; get: (p: string) => Promise<{ status: number; body: string }>; kill: () => Promise<void> };
async function startServer(url: string, shim: Shim, leg: string): Promise<Server> {
  if (!url.startsWith("file:")) throw new Error("refused: spawn against file: only");
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  const secret = randomBytes(24).toString("hex"); // local only, never printed
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url, NODE_OPTIONS: `--require ${SHIM}`, SHIM_754_CONTROL: shim.control, SHIM_754_LOG: shim.log, CRON_SECRET: secret };
  env.TURSO_AUTH_TOKEN = ""; // not deleted: dotenv and Next's env loader would refill a missing key from .env
  const logFile = path.join(DIR, `server-${leg}-${LABEL}-${Date.now()}.log`);
  const out = createWriteStream(logFile);
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (b: Buffer) => out.write(b));
  server.stderr.on("data", (b: Buffer) => out.write(b));
  const kill = async () => {
    try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
    out.end();
    await sleep(900); // HO 724: the file handle releases after the process dies
  };
  let up = false;
  for (let i = 0; i < 120 && !up; i++) {
    await sleep(500);
    try { up = (await fetch(`http://127.0.0.1:${PORT}/api/health`)).status > 0; } catch { /* not yet */ }
  }
  if (!up) { await kill(); throw new Error("the server never answered /api/health"); }
  const health = (await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json()) as { routes?: { path?: string; lastRunAt?: string }[] };
  const mine = health.routes?.find((r) => r.path === ROUTE_OLD);
  if (mine?.lastRunAt !== SENTINEL) { await kill(); throw new Error(`transport check failed: health lastRunAt ${String(mine?.lastRunAt)} is not the copy's sentinel; nothing triggered`); }
  say(`  server :${PORT} (pid ${server.pid}) reads the copy: /api/health's ${ROUTE_OLD} lastRunAt is the sentinel ${SENTINEL}`);
  return {
    kill,
    get: async (p) => { const r = await fetch(`http://127.0.0.1:${PORT}${p}`); return { status: r.status, body: await r.text() }; },
    tick: async (route, label) => {
      const m = shim.mark();
      const t0 = Date.now();
      let res: Response;
      try {
        res = await fetch(`http://127.0.0.1:${PORT}${route}`, { headers: { authorization: `Bearer ${secret}` }, signal: AbortSignal.timeout(120_000) });
      } catch (e) {
        const cause = e instanceof Error && e.cause instanceof Error ? `${e.cause.name}: ${e.cause.message}` : String((e as { cause?: unknown })?.cause ?? "");
        throw new Error(`${label}: ${e instanceof Error ? e.message : String(e)} (${cause}) · port ${PORT} bound by ${JSON.stringify(listeningPids())} · server pid ${server.pid} exit ${server.exitCode ?? "none"} signal ${server.signalCode ?? "none"}`);
      }
      await res.text();
      const ms = Date.now() - t0;
      const lines = shim.since(m);
      say(`    ${label}: ${route} HTTP ${res.status} in ${ms} ms · shim: ${lines.filter((l) => l.includes(" meetings list ")).length} list page(s), ${lines.filter((l) => / meeting (house|senate) /.test(l)).length} detail answer(s), ${lines.filter((l) => !/ meetings? /.test(l) && !l.includes(" armed ")).length} other`);
      return { http: res.status, ms, lines };
    },
  };
}
// The route a meetings tick goes through: the new route when the build has it, else the old step.
async function meetingsRoute(srv: Server): Promise<string> {
  const h = JSON.parse((await srv.get("/api/health")).body) as { routes?: { path?: string }[] };
  return h.routes?.some((r) => r.path === ROUTE_NEW) ? ROUTE_NEW : ROUTE_OLD;
}

// An async spawn: spawnSync would block this process's event loop for the child's whole
// run, so an idle keep-alive socket to the server, closed server-side meanwhile, would be
// reused dead by the next tick (leg 4's first red run: "fetch failed" after the instrument).
function run(args: string[], env: NodeJS.ProcessEnv, timeoutMs = 600_000): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const c = spawn(process.execPath, args, { env });
    let stdout = "", stderr = "";
    c.stdout.on("data", (b: Buffer) => (stdout += b.toString()));
    c.stderr.on("data", (b: Buffer) => (stderr += b.toString()));
    const t = setTimeout(() => { try { execFileSync("taskkill", ["/PID", String(c.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } }, timeoutMs);
    c.on("close", (status) => { clearTimeout(t); resolve({ status, stdout, stderr }); });
  });
}

// ── readings of a copy ──────────────────────────────────────────────────────
const details = (t: Tick, id: string) => t.lines.filter((l) => new RegExp(` meeting (house|senate) ${id} `).test(l));
const pagesOf = (t: Tick, chamber: string) => t.lines.filter((l) => l.includes(` meetings list ${chamber} `));
async function lastRun(url: string, route: string) {
  return withDb(url, async (db) => {
    const r = (await db.execute({ sql: `SELECT id, status, elapsed_ms, payload, error_message FROM cron_runs WHERE route = ? ORDER BY id DESC LIMIT 1`, args: [route] })).rows[0];
    if (!r) return null;
    let p: Record<string, unknown> | null = null;
    try { const j = JSON.parse(String(r.payload)) as { payload?: Record<string, unknown> }; p = (route === ROUTE_OLD ? (j.payload?.meetings as Record<string, unknown> | undefined) : j.payload) ?? null; } catch { /* none */ }
    return { id: Number(r.id), status: String(r.status), elapsed: Number(r.elapsed_ms), meetings: p, error: r.error_message == null ? null : String(r.error_message) };
  });
}
type Row = { event_id: string; update_date: string; absent: string | null; bills: string; row: string };
async function rows(url: string, ids: string[]): Promise<Map<string, Row>> {
  const absentCol = await hasCol(url, "committee_meetings", "absent_upstream_at");
  return withDb(url, async (db) => {
    const m = new Map<string, Row>();
    const ph = ids.map(() => "?").join(",");
    const rs = await db.execute({ sql: `SELECT *${absentCol ? "" : ", NULL AS absent_upstream_at"} FROM committee_meetings WHERE event_id IN (${ph})`, args: ids });
    const mb = await db.execute({ sql: `SELECT event_id, GROUP_CONCAT(bill_id) AS b FROM (SELECT event_id, bill_id FROM meeting_bills WHERE event_id IN (${ph}) ORDER BY bill_id) GROUP BY event_id`, args: ids });
    const bills = new Map(mb.rows.map((r) => [String(r.event_id), String(r.b)]));
    for (const r of rs.rows) {
      const o = Object.fromEntries(Object.entries(r).filter(([k]) => isNaN(Number(k))));
      m.set(String(r.event_id), { event_id: String(r.event_id), update_date: String(r.update_date), absent: r.absent_upstream_at == null ? null : String(r.absent_upstream_at), bills: bills.get(String(r.event_id)) ?? "", row: JSON.stringify(o) });
    }
    return m;
  });
}
async function walkState(url: string, id: string): Promise<{ failures: number; gaveUpAt: string | null } | null | "no table"> {
  if (!(await hasTable(url, "committee_meeting_walk_state"))) return "no table";
  return withDb(url, async (db) => {
    const r = (await db.execute({ sql: `SELECT failures, gave_up_at_update FROM committee_meeting_walk_state WHERE event_id = ?`, args: [id] })).rows[0];
    return r ? { failures: Number(r.failures), gaveUpAt: r.gave_up_at_update == null ? null : String(r.gave_up_at_update) } : null;
  });
}
async function walkRows(url: string): Promise<number | "no table"> {
  if (!(await hasTable(url, "committee_meeting_walk_state"))) return "no table";
  return withDb(url, async (db) => Number((await db.execute(`SELECT COUNT(*) AS n FROM committee_meeting_walk_state`)).rows[0]!.n));
}
async function queries(url: string, a: { ids: string[]; committees: string[]; bills: string[] }): Promise<Record<string, unknown>> {
  if (!url.startsWith("file:")) throw new Error("refused: the query probe reads file: only");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url };
  env.TURSO_AUTH_TOKEN = ""; // not deleted: dotenv and Next's env loader would refill a missing key from .env
  const r = await run(["--import", "tsx", "--import", STUB, QPROBE, JSON.stringify(a)], env);
  const line = r.stdout.split(/\r?\n/).filter((l) => l.startsWith("{")).pop();
  if (r.status !== 0 || !line) throw new Error(`the query probe failed (exit ${r.status}): ${redactSecrets((r.stderr || r.stdout).slice(-500))}`);
  return JSON.parse(line) as Record<string, unknown>;
}
const detailBills = (id: string): string => {
  const d = (JSON.parse(readFileSync(recFile("details-built.json"), "utf8")) as Record<string, { relatedItems?: { bills?: { congress: number; type: string; number: string }[] } }>)[id];
  return (d?.relatedItems?.bills ?? []).map((b) => `${b.congress}-${b.type.toLowerCase()}-${b.number}`).sort().join(",");
};

// ── the legs ────────────────────────────────────────────────────────────────
async function leg1() {
  const A = items("house-A.json"), S = items("senate-A.json");
  const E = A[250]!, F = A[100]!;
  const B = A.filter((x) => x.eventId !== F.eventId);
  writeFileSync(recFile("leg1-house-B.json"), JSON.stringify({ from: "house-A without F", items: B }));
  const k = cut(A, 270);
  const cp = await newCopy("1", { lists: { house: A, senate: S }, deleteRows: [E.eventId], watermarks: { house: A[k]!.updateDate, senate: S[0]!.updateDate } });
  say(`  E ${E.eventId} (0-based 250, list ${E.updateDate}, no row) · F ${F.eventId} (0-based 100) deleted upstream between page 1 and page 2 · the old walk's house watermark ${A[k]!.updateDate} (0-based ${k}), so it reads to page 2`);
  const shim = shimFor("1");
  const srv = await startServer(cp.url, shim, "1");
  try {
    const route = await meetingsRoute(srv);
    shim.set({ lists: L, after0: { house: recFile("leg1-house-B.json") } });
    // The two stored House rows no House list carries (Congress.gov deleted them, HO 752):
    // an ungated incomplete read would stamp them, so they are what the gate is read on.
    const gone = HOUSE_GONE_752;
    const t1 = await srv.tick(route, "tick 1, F deleted between the first page and the rest");
    const r1 = await rows(cp.url, [E.eventId, F.eventId, ...gone]);
    const run1 = await lastRun(cp.url, route);
    shim.set({ lists: { ...L, house: recFile("leg1-house-B.json") } });
    const t2 = await srv.tick(route, "tick 2, F gone from every page");
    const r2 = await rows(cp.url, [E.eventId, F.eventId, ...gone]);
    const n1 = details(t1, E.eventId).length, n2 = details(t2, E.eventId).length;
    check("1", "tick 1's pages past the first were served from the moved order", pagesOf(t1, "house").slice(1).every((l) => l.includes("(after0)")) && pagesOf(t1, "house").length > 1, `${pagesOf(t1, "house").length} house page(s): ${pagesOf(t1, "house").map((l) => l.split(" meetings list house ")[1]).join(" | ")}`);
    check("1", `E is refreshed exactly once, this tick or next`, n1 + n2 === 1 && r2.get(E.eventId)?.update_date === E.updateDate, `detail requests tick 1 ${n1}, tick 2 ${n2} · row ${r2.get(E.eventId) ? `update_date ${r2.get(E.eventId)!.update_date}` : "none"}`);
    const dup = (t: Tick) => { const c = new Map<string, number>(); for (const l of t.lines) { const m = l.match(/ meeting (?:house|senate) (\d+) -> 200/); if (m) c.set(m[1]!, (c.get(m[1]!) ?? 0) + 1); } return [...c].filter(([, n]) => n > 1).map(([id, n]) => `${id}×${n}`); };
    check("1", "no event's detail is fetched twice in a tick", dup(t1).length === 0 && dup(t2).length === 0, `tick 1 ${dup(t1).join(",") || "none"} · tick 2 ${dup(t2).join(",") || "none"}`);
    const run2 = await lastRun(cp.url, route);
    const st = (r: Map<string, Row>, id: string) => (r.get(id) ? r.get(id)!.absent ?? "unstamped" : "NO ROW");
    check("1", "a read whose count moved stamps nothing absent from that chamber, not even the rows no list carries; the next complete read stamps them and F", gone.every((id) => r1.get(id) && r1.get(id)!.absent == null) && gone.every((id) => r2.get(id)?.absent != null) && r1.get(F.eventId)?.absent == null && r2.get(F.eventId)?.absent != null, `after tick 1 (incomplete): ${gone.map((id) => `${id} ${st(r1, id)}`).join(", ")}, F ${st(r1, F.eventId)} · payload listComplete.house ${JSON.stringify((run1?.meetings as { listComplete?: { house?: boolean } } | null)?.listComplete?.house)} · after tick 2 (complete): ${gone.map((id) => `${id} ${st(r2, id)}`).join(", ")}, F ${st(r2, F.eventId)} · tick 2 payload house ${JSON.stringify((run2?.meetings as { listSize?: unknown; listCount?: unknown; listComplete?: unknown } | null) ? { size: (run2!.meetings as { listSize?: { house?: number } }).listSize?.house, count: (run2!.meetings as { listCount?: { house?: number } }).listCount?.house } : null)}`);
  } finally { await srv.kill(); }
}
// 1b (from the review, beyond the eight): between page 1 and the rest, an event already read
// (X) is deleted and a stored event not yet read (Y) is updated to the head. Every place past
// the first page nets out, so the rest reads everything but Y, and the unique ids (X kept, Y
// missed) equal the list's final count. Only a count that moved between the first page and
// the last tells the read was not whole; Y must not be stamped absent.
async function leg1b() {
  const A = items("house-A.json"), S = items("senate-A.json");
  const X = A[10]!, Y = A[600]!;
  const bumped = "2026-09-28T23:00:00Z";
  const C = [{ eventId: Y.eventId, updateDate: bumped }, ...A.filter((x) => x.eventId !== X.eventId && x.eventId !== Y.eventId)];
  writeFileSync(recFile("leg1b-house-C.json"), JSON.stringify({ from: "house-A without X, Y updated to the head", items: C }));
  const cp = await newCopy("1b", { lists: { house: A, senate: S } });
  say(`  X ${X.eventId} (0-based 10, read on page 1) deleted and Y ${Y.eventId} (0-based 600, stored) updated to the head, both between page 1 and page 2`);
  const shim = shimFor("1b");
  const srv = await startServer(cp.url, shim, "1b");
  try {
    const route = await meetingsRoute(srv);
    shim.set({ lists: L, after0: { house: recFile("leg1b-house-C.json") } });
    await srv.tick(route, "tick 1, X deleted and Y moved to the head after page 1");
    const r1 = await rows(cp.url, [X.eventId, Y.eventId]);
    const run1 = await lastRun(cp.url, route);
    shim.set({ lists: { ...L, house: recFile("leg1b-house-C.json") } });
    const t2 = await srv.tick(route, "tick 2, the list as it now is");
    const r2 = await rows(cp.url, [X.eventId, Y.eventId]);
    const m1 = run1?.meetings as { listSize?: { house?: number }; listCount?: { house?: number }; listComplete?: { house?: boolean } } | null;
    check("1b", "Y, live and missed by the read, is not stamped absent", r1.get(Y.eventId) != null && r1.get(Y.eventId)!.absent == null, `tick 1 house unique ${m1?.listSize?.house} of final count ${m1?.listCount?.house}, complete ${JSON.stringify(m1?.listComplete?.house)} · Y ${r1.get(Y.eventId)?.absent ?? "unstamped"}`);
    check("1b", "the next read refreshes Y and stamps X", r2.get(Y.eventId)?.update_date === bumped && r2.get(Y.eventId)?.absent == null && r2.get(X.eventId)?.absent != null && details(t2, Y.eventId).length === 1, `Y update_date ${r2.get(Y.eventId)?.update_date}, ${r2.get(Y.eventId)?.absent ?? "unstamped"} · X ${r2.get(X.eventId)?.absent ?? "unstamped"}`);
  } finally { await srv.kill(); }
}
async function leg2() {
  const A = items("house-A.json"), S = items("senate-A.json");
  const i = cut(S, 5) - 1; // S[i] strictly above S[i+1]
  const E = S[i]!;
  const aged = "2026-01-01T00:00:00Z";
  const cp = await newCopy("2", { lists: { house: A, senate: S }, ageRows: { [E.eventId]: aged }, watermarks: { house: A[0]!.updateDate, senate: S[i + 1]!.updateDate } });
  say(`  E ${E.eventId} (Senate 0-based ${i}, list ${E.updateDate}) stored at ${aged}; the old walk's Senate watermark ${S[i + 1]!.updateDate}, just below it`);
  const shim = shimFor("2");
  const srv = await startServer(cp.url, shim, "2");
  try {
    const route = await meetingsRoute(srv);
    shim.set({ lists: L, failDetails: [E.eventId] });
    const t1 = await srv.tick(route, "tick 1, E's detail failing");
    const r1 = await rows(cp.url, [E.eventId]);
    const w1 = await walkState(cp.url, E.eventId);
    shim.set({ lists: L });
    const t2 = await srv.tick(route, "tick 2, E's detail answering");
    const r2 = await rows(cp.url, [E.eventId]);
    const w2 = await walkState(cp.url, E.eventId);
    check("2", "tick 1: the failure is real and the row stays older", details(t1, E.eventId).some((l) => l.includes("-> 500")) && r1.get(E.eventId)?.update_date === aged, `${details(t1, E.eventId).map((l) => l.split("-> ")[1]).join(",")} · row ${r1.get(E.eventId)?.update_date} · walk state ${JSON.stringify(w1)}`);
    check("2", "tick 2 fetches E again and refreshes it", details(t2, E.eventId).length > 0 && r2.get(E.eventId)?.update_date === E.updateDate, `${details(t2, E.eventId).length} request(s) · row ${r2.get(E.eventId)?.update_date} · walk state ${JSON.stringify(w2)}`);
    check("2", "the failure was counted, then reset by the refresh", w1 !== "no table" && w1?.failures === 1 && w2 !== "no table" && w2?.failures === 0, `after tick 1 ${JSON.stringify(w1)} · after tick 2 ${JSON.stringify(w2)}`);
  } finally { await srv.kill(); }
}
async function leg3() {
  const A = items("house-A.json"), S = items("senate-A.json");
  const cp = await newCopy("3", { lists: { house: A, senate: S }, keepOlder: OLDER_752 });
  const shim = shimFor("3");
  const srv = await startServer(cp.url, shim, "3");
  try {
    const route = await meetingsRoute(srv);
    const r0 = await rows(cp.url, OLDER_752);
    shim.set({ lists: L });
    const t1 = await srv.tick(route, "tick 1");
    const r1 = await rows(cp.url, OLDER_752);
    for (const id of OLDER_752) {
      const lu = S.find((x) => x.eventId === id)!.updateDate;
      check("3", `${id} refreshed on the first run`, details(t1, id).some((l) => l.includes("recorded")) && r1.get(id)?.update_date === lu, `stored ${r0.get(id)?.update_date} → ${r1.get(id)?.update_date} · list ${lu} · ${details(t1, id).map((l) => l.split("-> ")[1]).join(",") || "not fetched"}`);
    }
  } finally { await srv.kill(); }
}
async function leg4() {
  const A = items("house-A.json"), S = items("senate-A.json");
  const seed = seedData();
  const now = new Date().toISOString(), d7 = new Date(Date.now() - 7 * 86400_000).toISOString();
  const listed = new Set([...A, ...S].map((x) => x.eventId));
  const withBill = new Set(seed.meetingBills.map((m) => m.event_id));
  const pick = (f: (m: Record<string, unknown>) => boolean) => seed.meetings.filter((m) => listed.has(String(m.event_id)) && m.committee_system_code && f(m)).sort((a, b) => Number(withBill.has(String(b.event_id))) - Number(withBill.has(String(a.event_id))))[0]!;
  const U = pick((m) => String(m.meeting_date ?? "") > now);
  const R = pick((m) => String(m.meeting_date ?? "") >= d7 && String(m.meeting_date ?? "") < now);
  const u = String(U.event_id), r = String(R.event_id);
  const billU = seed.meetingBills.find((m) => m.event_id === u)?.bill_id, billR = seed.meetingBills.find((m) => m.event_id === r)?.bill_id;
  const rd = new Date(String(R.meeting_date)); const dow = (rd.getUTCDay() + 6) % 7;
  const ws = new Date(Date.UTC(rd.getUTCFullYear(), rd.getUTCMonth(), rd.getUTCDate() - dow)).toISOString().slice(0, 10);
  const we = new Date(Date.parse(`${ws}T00:00:00Z`) + 6 * 86400_000).toISOString().slice(0, 10);
  const cp = await newCopy("4", { lists: { house: A, senate: S }, report: { weekStart: ws, weekEnd: we } });
  say(`  U ${u} (${U.chamber}, meeting ${U.meeting_date}, ${U.committee_system_code}, bill ${billU ?? "none"}) · R ${r} (${R.chamber}, meeting ${R.meeting_date}, ${R.committee_system_code}, bill ${billR ?? "none"}) · a reports row ${ws}..${we} for the band's history`);
  const qa = { ids: [u, r], committees: [String(U.committee_system_code), String(R.committee_system_code)], bills: [billU, billR].filter((x): x is string => !!x) };
  const shim = shimFor("4");
  const srv = await startServer(cp.url, shim, "4");
  try {
    const route = await meetingsRoute(srv);
    shim.set({ lists: L });
    await srv.tick(route, "tick 0, the whole list");
    const q0 = await queries(cp.url, qa);
    shim.set({ lists: L, drop: [u, r] });
    await srv.tick(route, "tick 1, the list drops U and R");
    const r1 = await rows(cp.url, [u, r]);
    const q1 = await queries(cp.url, qa);
    await srv.tick(route, "tick 1b, still dropped");
    const r1b = await rows(cp.url, [u, r]);
    // The 752 instrument's table mode, against this copy, its GETs answered by the shim.
    const outDir = path.join(DIR, `leg4-${LABEL}-instrument`);
    const inst = await runInstrument(cp.url, shim, outDir);
    shim.set({ lists: L });
    await srv.tick(route, "tick 2, U and R restored");
    const r2 = await rows(cp.url, [u, r]);
    const q2 = await queries(cp.url, qa);
    const where = (q: Record<string, unknown>, id: string) => {
      const out: string[] = [];
      for (const k of ["upcoming", "upcoming7", "recent7", "recent14"]) if ((q[k] as string[]).includes(id)) out.push(k);
      for (const k of ["byCommittee", "byCommitteeUpcoming", "forBill"]) for (const [x, v] of Object.entries(q[k] as Record<string, string[]>)) if (v.includes(id)) out.push(`${k}(${x})`);
      return out;
    };
    const band = (q: Record<string, unknown>) => (q.band as { thisWeek: number }).thisWeek;
    const hist = (q: Record<string, unknown>) => (q.history as { weekStart: string; hearings: number }[]).find((h) => h.weekStart === ws)?.hearings ?? null;
    check("4", "before the drop, U and R are returned by their readers", where(q0, u).includes("upcoming") && where(q0, u).some((w) => w.startsWith("byCommittee(")) && where(q0, r).includes("recent7") && (!billU || where(q0, u).some((w) => w.startsWith("forBill("))), `U ${where(q0, u).join(" ")} · R ${where(q0, r).join(" ")} · band thisWeek ${band(q0)} · breakdown sum ${q0.breakdownSum} · history ${ws} ${hist(q0)}`);
    check("4", "the drop stamps both, and the rows are kept", r1.get(u)?.absent != null && r1.get(r)?.absent != null, `U ${r1.get(u) ? `row kept, absent_upstream_at ${r1.get(u)!.absent}` : "ROW GONE"} · R ${r1.get(r) ? `row kept, absent_upstream_at ${r1.get(r)!.absent}` : "ROW GONE"}`);
    check("4", "stamped once: a second read with them still gone leaves the stamp as it was", r1b.get(u)?.absent != null && r1b.get(u)?.absent === r1.get(u)?.absent && r1b.get(r)?.absent === r1.get(r)?.absent, `U ${r1.get(u)?.absent} → ${r1b.get(u)?.absent} · R ${r1.get(r)?.absent} → ${r1b.get(r)?.absent}`);
    check("4", "every meeting reader stops returning them", where(q1, u).length === 0 && where(q1, r).length === 0, `U ${where(q1, u).join(" ") || "none"} · R ${where(q1, r).join(" ") || "none"}`);
    check("4", "the weekly band's count, its breakdown and its history follow (R held this week)", band(q1) === band(q0) - 1 && Number(q1.breakdownSum) === Number(q0.breakdownSum) - 1 && hist(q1) === (hist(q0) ?? 0) - 1, `thisWeek ${band(q0)} → ${band(q1)} · breakdown ${q0.breakdownSum} → ${q1.breakdownSum} · history ${hist(q0)} → ${hist(q1)}`);
    check("4", "restored, the stamps clear and the readers return them", r2.get(u)?.absent == null && r2.get(r)?.absent == null && where(q2, u).length === where(q0, u).length && where(q2, r).length === where(q0, r).length && band(q2) === band(q0), `U ${r2.get(u)?.absent ?? "clear"} ${where(q2, u).join(" ")} · R ${r2.get(r)?.absent ?? "clear"} ${where(q2, r).join(" ")} · band ${band(q2)}`);
    const marked = /marked absent (\d+)/g, got = [...inst.out.matchAll(marked)].map((m) => Number(m[1]));
    check("4", "the 752 instrument's table mode reads the marks (U, R and the 19 Congress.gov deleted)", inst.status === 0 && got.reduce((s, n) => s + n, 0) === 21 && inst.out.includes(u) && inst.out.includes(r) && /older 0/.test(inst.out) && /missing 0/.test(inst.out), `exit ${inst.status} · marked per chamber ${got.join(" + ")} · ${inst.out.split(/\r?\n/).filter((l) => /the table's reading|against the table/.test(l)).map((l) => l.trim().slice(0, 200)).join(" || ")}`);
  } finally { await srv.kill(); }
}
async function runInstrument(url: string, shim: Shim, outDir: string): Promise<{ status: number | null; out: string }> {
  if (!url.startsWith("file:")) throw new Error("refused: the instrument reads file: only here");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url, NODE_OPTIONS: `--require ${SHIM}`, SHIM_754_CONTROL: shim.control, SHIM_754_LOG: shim.log };
  env.TURSO_AUTH_TOKEN = ""; // not deleted: dotenv and Next's env loader would refill a missing key from .env
  const r = await run([TSX, INSTRUMENT, "--prod", "--only", "meetings", "--meetings", "table", "--db", url, "--out", outDir], env);
  const out = redactSecrets(`${r.stdout}${r.stderr}`);
  say(`    the 752 instrument, --only meetings --meetings table, against the copy: exit ${r.status}`);
  for (const l of out.split(/\r?\n/).filter((x) => /meetings (house|senate)|the table's reading|walk state|marked /.test(x)).slice(0, 12)) say(`      | ${l.slice(0, 260)}`);
  return { status: r.status, out };
}
async function leg5() {
  const A = items("house-A.json"), S = items("senate-A.json");
  const i = cut(S, 8) - 1;
  const G = S[i]!;
  const cp = await newCopy("5", { lists: { house: A, senate: S }, deleteRows: [G.eventId], watermarks: { house: A[0]!.updateDate, senate: S[i + 1]!.updateDate } });
  say(`  G ${G.eventId} (Senate 0-based ${i}, list ${G.updateDate}), no row, every detail null; the old walk's Senate watermark just below it`);
  const shim = shimFor("5");
  const srv = await startServer(cp.url, shim, "5");
  try {
    const route = await meetingsRoute(srv);
    const per: number[] = [];
    const gave: boolean[] = [];
    const ws: unknown[] = [];
    for (let t = 1; t <= 6; t++) {
      shim.set({ lists: L, nullDetails: [G.eventId] });
      const tk = await srv.tick(route, `tick ${t}, G's detail null`);
      per.push(details(tk, G.eventId).length);
      const run = await lastRun(cp.url, route);
      gave.push(((run?.meetings as { gaveUp?: { ids?: string[] } } | null)?.gaveUp?.ids ?? []).includes(G.eventId));
      ws.push(await walkState(cp.url, G.eventId));
    }
    const bumped = "2026-09-28T23:59:59Z";
    shim.set({ lists: L, nullDetails: [G.eventId], bump: { [G.eventId]: bumped } });
    const t7 = await srv.tick(route, "tick 7, G's list updateDate moves past the recorded one");
    per.push(details(t7, G.eventId).length);
    const w7 = await walkState(cp.url, G.eventId);
    check("5", "G is fetched on each of the first five ticks", per.slice(0, 5).every((n) => n === 1), `requests per tick ${per.join(",")}`);
    check("5", "named in gaveUp from the fifth, and skipped on the sixth", gave[4] === true && gave[5] === true && per[5] === 0, `gaveUp per tick ${gave.map((g) => (g ? "Y" : "n")).join("")} · walk state after 5 ${JSON.stringify(ws[4])} · after 6 ${JSON.stringify(ws[5])}`);
    const w5 = ws[4] as { gaveUpAt?: string | null } | null | "no table";
    check("5", "set aside at G's list updateDate at the fifth", w5 !== "no table" && w5?.gaveUpAt === G.updateDate, `recorded ${w5 === "no table" ? "no table" : w5?.gaveUpAt} · list ${G.updateDate}`);
    check("5", "a newer list updateDate brings it back, charged afresh", per[6] === 1 && w7 !== "no table" && w7?.failures === 1 && w7?.gaveUpAt == null, `tick 7 requests ${per[6]} · walk state ${JSON.stringify(w7)}`);
  } finally { await srv.kill(); }
}
async function leg6() {
  const A = items("house-A.json"), S = items("senate-A.json");
  const route0 = (srv: Server) => meetingsRoute(srv);
  // (a) 40 owed Senate events, every detail 9s: about five land, and the attempt in flight at
  // the 50s deadline is cut by the cap 3s after it (review: the cap had no leg of its own).
  const k = cut(S, 40);
  const owed = S.slice(0, k).map((x) => x.eventId);
  const aged = Object.fromEntries(owed.map((id) => [id, "2026-01-01T00:00:00Z"]));
  const cp = await newCopy("6a", { lists: { house: A, senate: S }, ageRows: aged, watermarks: { house: A[0]!.updateDate, senate: S[k]!.updateDate } });
  say(`  (a) ${owed.length} Senate events stored older than the list; every detail answers after 9s`);
  const shim = shimFor("6a");
  let srv = await startServer(cp.url, shim, "6a");
  try {
    const route = await route0(srv);
    const before = await rows(cp.url, owed);
    shim.set({ lists: L, delayMs: 9000 });
    const t0 = Date.now();
    const t = await srv.tick(route, "tick, 9s per detail");
    const after = await rows(cp.url, owed);
    const run = await lastRun(cp.url, route);
    const refreshed = owed.filter((id) => after.get(id)!.update_date !== before.get(id)!.update_date);
    const untouched = owed.filter((id) => after.get(id)!.row === before.get(id)!.row);
    const complete = refreshed.every((id) => after.get(id)!.update_date === S.find((x) => x.eventId === id)!.updateDate && after.get(id)!.bills === detailBills(id));
    const stopReason = (run?.meetings as { stopReason?: string } | null)?.stopReason;
    const cutLines = t.lines.filter((l) => l.includes("-> aborted after waiting"));
    const cutAt = cutLines.map((l) => (Date.parse(l.slice(0, 24)) - t0) / 1000);
    check("6", "(a) the tick stops at the deadline and records success with the stop reason, and chronicErr names the stop", run?.status === "success" && stopReason === "deadline" && t.ms < 56_000 && /stopped at the deadline/.test(run?.error ?? ""), `status ${run?.status} · stopReason ${stopReason ?? "(none in the payload)"} · ${t.ms} ms · error_message ${run?.error ?? "(none)"}`);
    check("6", "(a) the attempt in flight at the deadline is cut by the cap, between 50s and 55s", cutLines.length === 1 && cutAt[0]! > 50 && cutAt[0]! < 55, `aborted in flight ${cutLines.length}, at ${cutAt.map((x) => `${x.toFixed(1)}s`).join(", ") || "none"} after the POST`);
    check("6", "(a) the refreshed rows are complete, and every other owed row, the cut one included, is exactly as it was", refreshed.length > 0 && refreshed.length < owed.length && complete && refreshed.length + untouched.length === owed.length, `refreshed ${refreshed.length} (update_date and meeting_bills match the detail: ${complete}) · untouched ${untouched.length} · of ${owed.length}`);
    check("6", "(a) nothing is charged, the cut attempt included", (await walkRows(cp.url)) === 0, `walk state rows ${await walkRows(cp.url)}`);
  } finally { await srv.kill(); }
  // (b) a detail that never answers (60s, honouring the abort), beside a newer owed event.
  // Review: uncharged, it held the head of the queue every tick and starved everything newer.
  const N = S[0]!;
  const j = cut(S, 1);
  const K = S[j]!;
  const wm = S[cut(S, j + 1)]!.updateDate;
  const cpb = await newCopy("6b", { lists: { house: A, senate: S }, ageRows: { [N.eventId]: "2026-01-01T00:00:00Z", [K.eventId]: "2026-01-01T00:00:00Z" }, watermarks: { house: A[0]!.updateDate, senate: wm } });
  say(`  (b) K ${K.eventId} (list ${K.updateDate}) owed, its detail answering after 60s; N ${N.eventId} (list ${N.updateDate}, newer) owed, answering at once`);
  const shimb = shimFor("6b");
  srv = await startServer(cpb.url, shimb, "6b");
  try {
    const route = await route0(srv);
    const before = await rows(cpb.url, [K.eventId]);
    shimb.set({ lists: L, delayDetails: { [K.eventId]: 60_000 } });
    const t = await srv.tick(route, "tick, K never answers");
    const after = await rows(cpb.url, [K.eventId, N.eventId]);
    const run = await lastRun(cpb.url, route);
    const w = await walkState(cpb.url, K.eventId);
    check("6", "(b) the run ends inside the 55s soft timeout as success, not timeout", run?.status === "success" && t.ms < 56_000, `status ${run?.status} · elapsed ${run?.elapsed} ms · K attempts ${details(t, K.eventId).length} · stopReason ${(run?.meetings as { stopReason?: string } | null)?.stopReason ?? "(none)"} · error_message ${run?.error ?? "(none)"}`);
    check("6", "(b) K is charged, so five such runs set it aside, and its row is left as it was", w !== "no table" && w?.failures === 1 && after.get(K.eventId)!.row === before.get(K.eventId)!.row && (run?.error ?? "").includes(K.eventId), `walk state ${JSON.stringify(w)} · row unchanged ${after.get(K.eventId)!.row === before.get(K.eventId)!.row}`);
    check("6", "(b) the newer event behind K is refreshed in the same run", after.get(N.eventId)?.update_date === N.updateDate, `N ${after.get(N.eventId)?.update_date} · list ${N.updateDate} · requests ${details(t, N.eventId).length}`);
  } finally { await srv.kill(); }
  // (c) both chambers' list pages hang (review: a list that only times out ended as success).
  const cpc = await newCopy("6c", { lists: { house: A, senate: S } });
  say("  (c) every list page hangs 60s, honouring the abort");
  const shimc = shimFor("6c");
  srv = await startServer(cpc.url, shimc, "6c");
  try {
    const route = await route0(srv);
    shimc.set({ lists: L, delayLists: { house: 60_000, senate: 60_000 } });
    const t = await srv.tick(route, "tick, the lists never answer");
    const run = await lastRun(cpc.url, route);
    check("6", "(c) a run that reads no list page records error, inside the soft timeout, naming the cause", run?.status === "error" && t.ms < 56_000 && /timeout|aborted/i.test(run?.error ?? ""), `status ${run?.status} · ${t.ms} ms · error_message ${(run?.error ?? "(none)").slice(0, 220)}`);
  } finally { await srv.kill(); }
}
async function leg7() {
  const A = items("house-A.json"), S = items("senate-A.json");
  const cp = await newCopy("7", { lists: { house: A, senate: S } });
  const shim = shimFor("7");
  const srv = await startServer(cp.url, shim, "7");
  try {
    shim.set({ lists: L });
    const tc = await srv.tick(ROUTE_OLD, "the committees route");
    const meetingLines = tc.lines.filter((l) => / meetings? /.test(l));
    check("7", "the committees route runs no meetings step", tc.http === 200 && meetingLines.length === 0, `HTTP ${tc.http} · meetings requests ${meetingLines.length}`);
    const tn = await srv.tick(ROUTE_NEW, "the committee-meetings route");
    const other = tn.lines.filter((l) => !/ meetings? /.test(l) && !l.includes(" armed "));
    check("7", "the committee-meetings route runs, and runs nothing else", tn.http === 200 && pagesOf(tn, "house").length > 0 && pagesOf(tn, "senate").length > 0 && other.length === 0, `HTTP ${tn.http} · list pages house ${pagesOf(tn, "house").length}, senate ${pagesOf(tn, "senate").length} · other requests ${other.length}${other.length ? ` (${other.slice(0, 3).map((l) => l.split(" pid ")[1]).join("; ")})` : ""}`);
    const h = JSON.parse((await srv.get("/api/health")).body) as { routes?: { path?: string; schedule?: string; lastRunAt?: string | null }[] };
    const hc = h.routes?.find((r) => r.path === ROUTE_OLD), hn = h.routes?.find((r) => r.path === ROUTE_NEW);
    const vj = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons: { path: string; schedule: string }[]; functions: Record<string, { maxDuration: number }> };
    const vn = vj.crons.find((c) => c.path === ROUTE_NEW);
    check("7", "/api/health watches both, and vercel.json schedules the new route", !!hc && !!hn && hn.schedule === "50 */12 * * *" && hn.lastRunAt != null && vn?.schedule === "50 */12 * * *" && vj.functions["app/api/cron/committee-meetings/route.ts"]?.maxDuration === 60, `health committees ${hc ? `${hc.schedule}, last ${hc.lastRunAt}` : "absent"} · committee-meetings ${hn ? `${hn.schedule}, last ${hn.lastRunAt}` : "absent"} · vercel.json cron ${vn ? vn.schedule : "absent"}, maxDuration ${vj.functions["app/api/cron/committee-meetings/route.ts"]?.maxDuration ?? "absent"}`);
  } finally { await srv.kill(); }
}
async function leg8(shifted: boolean) {
  const A = items("house-A.json"), SA = items("senate-752-A.json"), SB = items("senate-752-B.json");
  let control: Control;
  let wm: string;
  let dropped: string[] = [];
  if (!shifted) {
    control = { lists: { house: L.house, senate: recFile("senate-752-A.json") }, split: { senate: { at: 500, file: recFile("senate-752-B.json") } } };
    wm = SA[cut(SA, 505)]!.updateDate;
  } else {
    dropped = SA.slice(300, 325).map((x) => x.eventId); // 25 above the tie: it moves to 0-based 473..478, across 475
    control = { lists: { house: L.house, senate: recFile("senate-752-A.json") }, alternate: { senate: recFile("senate-752-B.json") }, drop: dropped };
    wm = SA[cut(SA, 505)]!.updateDate;
  }
  const leg = shifted ? "8b" : "8";
  const cp = await newCopy(leg, { lists: { house: A, senate: SB }, deleteRows: TIE_752, watermarks: { house: A[0]!.updateDate, senate: wm } });
  const at = SB.filter((x) => !dropped.includes(x.eventId)).findIndex((x) => TIE_752.includes(x.eventId));
  say(`  the six tied at 2025-12-08T23:53:20Z (${TIE_752.join(", ")}), no rows · served ${shifted ? `with 25 events above dropped, the tie at 0-based ${at}..${at + 5}, its order flipping on every Senate request` : "as HO 752 recorded it: pages below offset 500 in the order the page at 250 saw, from 500 in the order the page at 500 saw"} · the old walk's Senate watermark ${wm}, so it reads past the tie`);
  const shim = shimFor(leg);
  const srv = await startServer(cp.url, shim, leg);
  try {
    const route = await meetingsRoute(srv);
    shim.set(control);
    const t1 = await srv.tick(route, "tick 1");
    const t2 = await srv.tick(route, "tick 2");
    const r2 = await rows(cp.url, TIE_752);
    const per = TIE_752.map((id) => `${id} ${details(t1, id).length}+${details(t2, id).length}${r2.get(id) ? "" : " NO ROW"}`);
    check(leg, "every tied event is stored, each fetched exactly once", TIE_752.every((id) => r2.has(id) && details(t1, id).length + details(t2, id).length === 1), per.join(" · "));
  } finally { await srv.kill(); }
}

(async () => {
  if (process.argv.includes("--prepare")) { await prepare(); return; }
  if (process.argv.includes("--template")) { template(LABEL); return; }
  const legs = (argAt("--legs") ?? "").split(",").filter(Boolean);
  if (!legs.length) throw new Error("one of --prepare, --template, --legs");
  if (!existsSync(templatePath(LABEL))) throw new Error(`no template for ${LABEL}; run --template --label ${LABEL} after the build`);
  if (!existsSync(recFile("seed.json"))) throw new Error("no recorded seed; run --prepare first");
  mkdirSync(DIR, { recursive: true });
  const prodBefore = await prodFingerprint();
  say(`=== HO 754 legs · ${LABEL} · ${new Date().toISOString()} · ${treeState()} ===`);
  for (const leg of legs) {
    say(`\n── leg ${leg}`);
    const t = Date.now();
    try {
      if (leg === "1") await leg1();
      else if (leg === "1b") await leg1b();
      else if (leg === "2") await leg2();
      else if (leg === "3") await leg3();
      else if (leg === "4") await leg4();
      else if (leg === "5") await leg5();
      else if (leg === "6") await leg6();
      else if (leg === "7") await leg7();
      else if (leg === "8") await leg8(false);
      else if (leg === "8b") await leg8(true);
      else throw new Error(`no leg ${leg}`);
    } catch (e) {
      check(leg, "the leg ran to its checks", false, redactSecrets(e instanceof Error ? e.message : String(e)));
    }
    say(`  (${Math.round((Date.now() - t) / 1000)}s)`);
  }
  const prodAfter = await prodFingerprint();
  check("*", "prod untouched", prodAfter === prodBefore, prodAfter);
  say(`\n${LABEL}: ${passes} PASS · ${fails} FAIL`);
  appendFileSync(path.join(ART, `legs-${LABEL}.summary.txt`), `${new Date().toISOString()} legs ${legs.join(",")} · ${passes} PASS · ${fails} FAIL\n`);
})().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(2); });
