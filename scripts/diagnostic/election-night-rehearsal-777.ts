// HO 777 — the election-night rehearsal, Part A (the rendering). Today's code on a fresh copy of
// prod, the clock at Nov 4 with marks planted by hand (no prod row is marked), every surface that
// turns on election night read against what it should say, each check a PASS or FAIL line (N/A,
// with why, where a check's premise doesn't hold on today's data). Built
// from scripts/diagnostic/election-night-legs-758.ts and scripts/diagnostic/electoral-legs-767.ts:
// what it needs is copied here, and nothing is imported from them.
//
//   npx tsx scripts/diagnostic/election-night-rehearsal-777.ts --seed --label L   # seed, copies, plants, the reader
//   (a cold `next build` of the tree)
//   npx tsx scripts/diagnostic/election-night-rehearsal-777.ts --run --label L    # servers, checks, captures
//
// Copies of one seed (the union of the two leg scripts' table lists):
//   today   as seeded, the clock unset: the dormant check (race pages, /electoral, the band)
//   night   SHAPES planted (below), the clock at Nov 4: each race page, and /electoral at 1440 and 430
//   band    the rated index's seats marked as HO 758's band copy marked them, the clock at Nov 4
//   reader  the reader's write path (HO 758's leg 9), in process
// The shapes, re-matched to today's printed rows (a shape whose rows no longer exist reads STALE):
//   HO 758  MI-04 Huizenga (re-elected), IA-02 Joe Mitchell (open seat), FL-14 Beltran (defeated),
//           CO-08 none (not called), LA-01 Scalise + Jewett (a jungle runoff) and LA-02 Renada
//           Collins (one jungle winner), planted before the harvest, AR-02 Hill + Jones (a general
//           box with two marks), FL-10 (no box); S-ME's curated name is checked for STALE
//   HO 767  S-NH Pappas (D HOLD), S-IA Turek (D GAIN), S-ME Susan Collins (R HOLD, re-elected),
//           S-OH Brown (D GAIN), S-GA Ossoff + Mike Collins (RUNOFF), S-NE Osborn (I GAIN), FL-25
//           Moskowitz (D HOLD), TX-23 its first R (R WIN), S-AK none (NO CALL)
//   since   HO 775's rater links inside the dimmed final call (MI-04, S-ME), HO 773's GA-13 (its D
//           nominee over an incumbent who lost the primary), HO 776's AL-01 (Carl) and S-AL (Moore)
//   HO 795  re-matched to the rulings that came after HO 777, each expectation taken from the ruling's code or
//           block, never read off a page: HO 779's tag kept on a called race (components/RaceHubBody.tsx:180-188)
//           on IA-02, S-NH, S-IA, FL-25, GA-13, AL-01 and S-AL; HO 783's dated Georgia runoff, Runoff Dec 1
//           (lib/race-result.ts:177-180), on S-GA
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed, with a fingerprint before and
// after. Copies are `file:${abs}` from paths ending -777-rehearsal.db under the gitignored scratch
// directory; children get that URL with TURSO_AUTH_TOKEN="" (not deleted: dotenv and Next's loader
// refill a missing key). Every server is transport-checked: its copy's own cron_runs sentinel must
// come back on /api/health. Every printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/777-artifacts"); // repo-ignored
const SHOTS = path.join(ART, "captures");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const PORT = 3777;
const BASE = `http://127.0.0.1:${PORT}`;
const NOV4 = "2026-11-04T15:00:00.000Z"; // 8am MT the morning after
const SENTINEL_ROUTE = "/api/cron/race-challengers";
const SAVED = "docs/handoffs/747-artifacts/pages/2026-09-25T19-56-59-291Z";
// HO 767's whole tables, HO 758's thirteen among them; bills, member_votes and cron_runs cut below.
const WHOLE = [
  "races", "members", "member_ids", "race_ratings", "rating_history", "race_candidates", "kalshi_odds", "polymarket_odds",
  "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads",
  "palestine_scorecard", "member_ideology", "member_participation", "member_career_votes", "votes", "observations",
  "observation_entities", "dashboard_state",
];
// HO 775: each rater's 2026 page by chamber, as lib/enums.ts holds them.
const RATER_PAGES: Record<"house" | "senate", string[]> = {
  house: ["https://www.cookpolitical.com/ratings/house-race-ratings", "https://centerforpolitics.org/crystalball/2026-house/", "https://insideelections.com/ratings/house/"],
  senate: ["https://www.cookpolitical.com/ratings/senate-race-ratings", "https://centerforpolitics.org/crystalball/2026-senate/", "https://insideelections.com/ratings/senate/"],
};

type PageWant = {
  sub: "decided" | "notCalled" | "runoff" | "runoffDec12" | "runoffDec1";
  elected: string | null; // the roster row that reads Elected, or none
  qualifier: string | null; // the incumbent card's word (lib/race-result.ts raceResultView), null for none
  // HO 795: the tag the card keeps in the word's place (HO 779's ruling, components/RaceHubBody.tsx:180-188): its
  // data-incumbent-tag key and its words (lib/incumbent-tag.ts tagWords).
  tag?: { key: string; words: string };
  prov: "called" | "nocall" | "nobox";
  anchors?: "house" | "senate"; // HO 775: the three chips are links inside the dimmed final call
  rated: boolean; // whether the header carries chips at all
};
type ListWant = { chip: string; checked?: string; open: Record<string, string>; roles?: Record<string, string> };
type Shape = { key: string; from: string; race: string; mark?: string[]; jungle?: { district: number; names: string[] }; page: PageWant; list?: ListWant; record?: string };
const D = (o: Partial<PageWant> & Pick<PageWant, "elected" | "qualifier">): PageWant => ({ sub: "decided", prov: "called", rated: true, ...o });
const SHAPES: Shape[] = [
  // HO 758
  { key: "re-elected", from: "758", race: "MI-04-2026", mark: ["Bill Huizenga"], page: D({ elected: null, qualifier: "re-elected", anchors: "house" }) },
  // HO 795, HO 779's ruling (components/RaceHubBody.tsx:180-188): the card keeps the tag. Hinson is `senate` (HO 779's
  // measurements: IA-02 → S-IA; lib/incumbent-qualifier.ts:13-26), and S-IA's one mark below is Turek's, another's:
  // lost, LOST THE SENATE RACE (lib/incumbent-tag.ts:23-38, :43-47).
  { key: "open seat", from: "758", race: "IA-02-2026", mark: ["Joe Mitchell"], page: D({ elected: "Joe Mitchell", qualifier: null, tag: { key: "senate", words: "LOST THE SENATE RACE" } }) },
  { key: "defeated", from: "758", race: "FL-14-2026", mark: ["Mike Beltran"], page: D({ elected: "Mike Beltran", qualifier: "defeated" }) },
  { key: "not called", from: "758", race: "CO-08-2026", mark: [], page: { sub: "notCalled", elected: null, qualifier: null, prov: "nocall", rated: true } },
  { key: "jungle runoff", from: "758", race: "LA-01-2026", jungle: { district: 1, names: ["Steve Scalise", "Lauren Jewett"] }, page: { sub: "runoffDec12", elected: null, qualifier: "runoff dec 12", prov: "nocall", rated: false } },
  { key: "one jungle winner", from: "758", race: "LA-02-2026", jungle: { district: 2, names: ["Renada Collins"] }, page: D({ elected: "Renada Collins", qualifier: "defeated", rated: false }) },
  { key: "general box, two marks", from: "758", race: "AR-02-2026", mark: ["French Hill", "Chris Jones"], page: { sub: "runoff", elected: null, qualifier: "runoff", prov: "nocall", rated: true } },
  { key: "no box", from: "758", race: "FL-10-2026", mark: [], page: { sub: "notCalled", elected: null, qualifier: null, prov: "nobox", rated: false } },
  // HO 767
  // HO 795, HO 779 (components/RaceHubBody.tsx:180-188): Shaheen, printed nowhere, is curated incumbent_running = 0,
  // the first reason (lib/incumbent-qualifier.ts:33-34), and the reason tags stand: RETIRING (lib/incumbent-tag.ts:10-15).
  { key: "D HOLD, a member to the Senate", from: "767", race: "S-NH-2026", mark: ["Chris Pappas"], page: D({ elected: "Chris Pappas", qualifier: null, tag: { key: "retiring", words: "RETIRING" } }), list: { chip: "D HOLD", checked: "Pappas", open: { "Chris Pappas": "Elected" }, roles: { P000614: "elected to the Senate" } } },
  // HO 795, HO 779 (components/RaceHubBody.tsx:180-188): Ernst, printed nowhere, is curated incumbent_running = 0:
  // RETIRING (lib/incumbent-qualifier.ts:33-34; lib/incumbent-tag.ts:10-15).
  { key: "D GAIN, a member lost the Senate race", from: "767", race: "S-IA-2026", mark: ["Josh Turek"], page: D({ elected: "Josh Turek", qualifier: null, tag: { key: "retiring", words: "RETIRING" } }), list: { chip: "D GAIN", checked: "Turek", open: { "Josh Turek": "Elected" }, roles: { H001091: "lost the Senate race" } } },
  { key: "R HOLD, re-elected", from: "767", race: "S-ME-2026", mark: ["Susan Collins"], page: D({ elected: null, qualifier: "re-elected", anchors: "senate" }), list: { chip: "R HOLD", checked: "S. Collins", open: { "Susan Collins": "re-elected" }, roles: { C001035: "re-elected" } } },
  { key: "D GAIN, the incumbent defeated", from: "767", race: "S-OH-2026", mark: ["Sherrod Brown"], page: D({ elected: "Sherrod Brown", qualifier: "defeated" }), list: { chip: "D GAIN", checked: "Brown", open: { "Sherrod Brown": "Elected", "Jon Husted": "defeated" }, roles: { H001104: "defeated" } } },
  // HO 795, HO 783 (lib/race-result.ts:177-180, :207, :272): Georgia's general runoff is dated, 28 days after election
  // day, so two marks read Runoff Dec 1 (the header, :276), and the incumbent among them runoff Dec 1 (the card's word,
  // :280, compared lowered).
  { key: "a general runoff", from: "767", race: "S-GA-2026", mark: ["Jon Ossoff", "Mike Collins"], page: { sub: "runoffDec1", elected: null, qualifier: "runoff dec 1", prov: "nocall", rated: true }, list: { chip: "RUNOFF", open: { "Jon Ossoff": "runoff", "Mike Collins": "runoff" }, roles: { O000174: "in the runoff", C001129: "in the Senate runoff" } } },
  { key: "I GAIN, a winner the majors don't name", from: "767", race: "S-NE-2026", mark: ["Dan Osborn"], page: D({ elected: "Dan Osborn", qualifier: "defeated" }), list: { chip: "I GAIN", checked: "Osborn", open: { "Dan Osborn": "Elected", "Pete Ricketts": "defeated" }, roles: { R000618: "defeated" } } },
  // HO 795, HO 779 (components/RaceHubBody.tsx:180-188): Wasserman Schultz is `moved` (HO 779's measurements: FL-25 →
  // FL-20; lib/incumbent-qualifier.ts:13-26), and no shape marks FL-20: no outcome, the running words, RUNNING IN FL-20
  // (lib/incumbent-tag.ts:23-38, :43-47).
  { key: "D HOLD, a member moving in", from: "767", race: "FL-25-2026", mark: ["Moskowitz"], page: D({ elected: "Moskowitz", qualifier: null, tag: { key: "moved", words: "RUNNING IN FL-20" } }), list: { chip: "D HOLD", checked: "Moskowitz", open: { "Jared Evan Moskowitz": "Elected" }, roles: { M001217: "elected in FL-25" } } },
  { key: "R WIN, no stored incumbent", from: "767", race: "TX-23-2026", mark: ["__first_R__"], page: D({ elected: "Brandon Herrera", qualifier: null }), list: { chip: "R WIN", open: {} } },
  { key: "no call", from: "767", race: "S-AK-2026", mark: [], page: { sub: "notCalled", elected: null, qualifier: null, prov: "nocall", rated: true }, list: { chip: "NO CALL", open: {}, roles: { S001198: "not yet called" } } },
  // since
  // HO 795, HO 779 (components/RaceHubBody.tsx:180-188): Blair, printed nowhere and not curated as retiring, is unmarked
  // in GA-13's decided D primary: LOST PRIMARY (lib/incumbent-qualifier.ts:38-59; lib/incumbent-tag.ts:10-15).
  { key: "a D nominee over an incumbent who lost the primary", from: "773", race: "GA-13-2026", mark: ["Jasmine Clark"], page: D({ elected: "Jasmine Clark", qualifier: null, tag: { key: "lost_primary", words: "LOST PRIMARY" }, rated: false }), record: "the card for B001328" },
  // HO 795, HO 779 (components/RaceHubBody.tsx:180-188): Moore is `senate` (HO 779's measurements: AL-01 → S-AL), and
  // S-AL's one mark below is his: elected, ELECTED TO THE SENATE (lib/incumbent-tag.ts:23-38, :43-47).
  { key: "AL-01's rerun nominee", from: "776", race: "AL-01-2026", mark: ["Jerry Carl"], page: D({ elected: "Jerry Carl", qualifier: null, tag: { key: "senate", words: "ELECTED TO THE SENATE" }, rated: false }), record: "the card and open row for Moore; R HOLD on /electoral" },
  // HO 795, HO 779 (components/RaceHubBody.tsx:180-188): Tuberville is on the curated governor list
  // (data/governor-runs-2026.json; lib/incumbent-qualifier.ts:27-32), and past election day it reads RAN FOR GOVERNOR
  // (lib/incumbent-tag.ts:48-49).
  { key: "Moore on S-AL", from: "776", race: "S-AL-2026", mark: ["Barry Moore"], page: D({ elected: "Barry Moore", qualifier: null, tag: { key: "governor", words: "RAN FOR GOVERNOR" }, rated: false }), record: "whether S-AL's row was tied to Moore at the seed" },
];

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
const say = (s: string) => console.log(redactSecrets(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const failed: string[] = [];
const check = (part: string, label: string, ok: boolean, detail: string) => {
  say(`  ${ok ? "PASS" : "FAIL"}  [${part}] ${label}: ${detail}`);
  if (ok) passes++;
  else { fails++; failed.push(`[${part}] ${label}`); }
};
// A check whose premise doesn't hold on today's data reads neither PASS nor FAIL: it is named, with why.
const unread: string[] = [];
const unreadable = (part: string, label: string, why: string) => {
  say(`  N/A   [${part}] ${label}: ${why}`);
  unread.push(`[${part}] ${label}`);
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

// ── prod, read-only ─────────────────────────────────────────────────────────
function prodClient(): Client {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("libsql://")) throw new Error("reading prod needs the prod libsql:// URL in .env");
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}
const reader = (db: Client) => (sql: string, args: InArgs = []) => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("prod is read-only here");
  return db.execute({ sql, args });
};
// The tables a cron writes, by content hash, and the schema: the seed writes file: copies only, so
// a difference can only be a prod cron's own write inside the window.
async function prodFingerprint(): Promise<Record<string, string>> {
  const db = prodClient();
  const read = reader(db);
  const fp: Record<string, string> = {};
  for (const t of ["race_candidates", "general_ballot", "general_ballot_reads", "primary_candidates", "palestine_scorecard", "member_fundraising"])
    fp[t] = sha(JSON.stringify((await read(`SELECT * FROM ${t} ORDER BY rowid`)).rows.map((r) => Object.values(r))));
  fp.schema = sha(JSON.stringify((await read(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`)).rows.map((r) => Object.values(r))));
  db.close();
  return fp;
}
async function prodUntouched(label: string, fp0: Record<string, string>, t0: string) {
  const fp1 = await prodFingerprint();
  const changed = Object.keys(fp0).filter((k) => fp0[k] !== fp1[k]);
  say(`  prod fingerprint before ${JSON.stringify(fp0)}`);
  say(`  prod fingerprint after  ${JSON.stringify(fp1)}`);
  if (changed.length === 0) { check("seed", `prod untouched (${label})`, true, "fingerprints equal"); return; }
  // A run overlaps the window if it started inside it or was still in flight when it opened (an
  // hour back, so a long-dead row that never closed explains nothing).
  const db = prodClient();
  const t0m = new Date(Date.parse(t0) - 60 * 60 * 1000).toISOString();
  const runs = (await reader(db)(`SELECT id, route, started_at FROM cron_runs WHERE started_at >= ? OR (started_at >= ? AND (ended_at IS NULL OR ended_at >= ?)) ORDER BY id`, [t0, t0m, t0])).rows.map((r) => `${r.route}#${r.id}`);
  db.close();
  const cronOwned = new Set(["race_candidates", "general_ballot", "general_ballot_reads", "primary_candidates", "member_fundraising"]);
  const unexplained = changed.filter((k) => !cronOwned.has(k) || runs.length === 0);
  check("seed", `prod untouched (${label}): every difference is a prod cron's own run overlapping the window`, unexplained.length === 0, `changed ${changed.join(", ")} · runs ${runs.join("; ") || "none"}${unexplained.length ? ` · UNEXPLAINED ${unexplained.join(", ")}` : ""}`);
}

// ── copies ──────────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-777-rehearsal.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-777-rehearsal.db")) throw new Error(`refused: a copy must be a *-777-rehearsal.db file (got ${abs})`);
  return `file:${abs}`;
}
function childEnv(url: string, clock: string | null): NodeJS.ProcessEnv {
  if (!url.startsWith("file:")) throw new Error("refused: children get file: only");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url };
  env.TURSO_AUTH_TOKEN = "";
  if (clock) env.CBT_CLOCK_NOW = clock;
  else delete env.CBT_CLOCK_NOW;
  return env;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
const sentinelFile = (kind: string) => path.join(DIR, `sentinel-${kind}-${LABEL}-777.txt`);
const sentinelAt = (kind: string) => readFileSync(sentinelFile(kind), "utf8").trim();

// Paged by rowid (a whole observations or member_votes read in one response resets the connection),
// each page written as it arrives.
const PAGE = 1500;
async function copyRows(read: ReturnType<typeof reader>, db: Client, table: string, where = "", args: InArgs = []) {
  const cols = new Set((await db.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name)));
  await db.execute(`DELETE FROM ${table}`);
  const cond = where.replace(/^\s*WHERE\s+/i, "");
  let last = -1;
  let n = 0;
  for (;;) {
    const rs = await read(`SELECT rowid AS __rid, * FROM ${table} WHERE rowid > ?${cond ? ` AND (${cond})` : ""} ORDER BY rowid LIMIT ${PAGE}`, [last, ...(Array.isArray(args) ? args : [])]);
    if (rs.rows.length === 0) break;
    const use = Object.keys(rs.rows[0]!).filter((c) => c !== "__rid" && cols.has(c));
    const stmts: InStatement[] = rs.rows.map((r) => ({ sql: `INSERT INTO ${table} (${use.join(",")}) VALUES (${use.map(() => "?").join(",")})`, args: use.map((c) => (r as Record<string, unknown>)[c] as never) }));
    for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500), "write");
    n += rs.rows.length;
    last = Number(rs.rows[rs.rows.length - 1]!.__rid);
    if (rs.rows.length < PAGE) break;
  }
  return n;
}

async function seed() {
  mkdirSync(DIR, { recursive: true });
  mkdirSync(ART, { recursive: true });
  say(`\n── the seed`);
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();
  const tpl = copyPath("template");
  if (existsSync(tpl)) rmSync(tpl);
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: childEnv(copyUrl(tpl), null), encoding: "utf8" });
  if (mig.status !== 0) throw new Error(`migrate against the template failed: ${redactSecrets((mig.stderr || mig.stdout).slice(-600))}`);
  const prod = prodClient();
  const read = reader(prod);
  const ids = (await read(`
    SELECT DISTINCT g.bioguide_id AS b FROM general_ballot g
     WHERE g.bioguide_id IS NOT NULL AND g.race_id IN (SELECT r.id FROM races r WHERE r.cycle = 2026 AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = r.cycle))
    UNION SELECT r.incumbent_bioguide_id FROM races r
     WHERE r.cycle = 2026 AND r.incumbent_bioguide_id IS NOT NULL AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = r.cycle)`)).rows.map((r) => String(r.b));
  const ph = ids.map(() => "?").join(",");
  const counts: string[] = [];
  await withDb(copyUrl(tpl), async (db) => {
    await db.execute("PRAGMA foreign_keys = OFF");
    for (const t of WHOLE) counts.push(`${t} ${await copyRows(read, db, t)}`);
    counts.push(`bills ${await copyRows(read, db, "bills", `WHERE sponsor_bioguide_id IN (${ph})`, ids)} (sponsored by the ${ids.length} members)`);
    counts.push(`member_votes ${await copyRows(read, db, "member_votes", `WHERE bioguide_id IN (${ph})`, ids)} (the ${ids.length} members)`);
    counts.push(`cron_runs ${await copyRows(read, db, "cron_runs", `WHERE id > (SELECT MAX(id) FROM cron_runs) - 400`)} (the newest 400)`);
  });
  prod.close();
  say(`  template: the real scripts/migrate.ts against file:, seeded from prod · ${counts.join(" · ")}`);
  const seedNotes = await withDb(copyUrl(tpl), async (db) => {
    const one = async (sql: string) => (await db.execute(sql)).rows[0] ?? null;
    return {
      sAlMoore: await one(`SELECT name, person_key, bioguide_id FROM general_ballot WHERE race_id = 'S-AL-2026' AND name LIKE '%Moore%'`),
      al01: await one(`SELECT incumbent_bioguide_id FROM races WHERE id = 'AL-01-2026'`),
      latestRead: await one(`SELECT MAX(read_at) t FROM general_ballot_reads WHERE status = 'box'`),
    };
  });
  say(`  at the seed: S-AL's Moore row ${JSON.stringify(seedNotes.sAlMoore)} · AL-01's stored incumbent ${JSON.stringify(seedNotes.al01)} · the newest box read ${JSON.stringify(seedNotes.latestRead)}`);
  const planted: Record<string, unknown> = { seedNotes };
  for (const kind of ["today", "night", "band", "reader"] as const) {
    const abs = copyPath(kind);
    copyFileSync(tpl, abs);
    const at = new Date(Date.now() + (["today", "night", "band", "reader"].indexOf(kind) + 1) * 7).toISOString();
    writeFileSync(sentinelFile(kind), at);
    await withDb(copyUrl(abs), (db) => db.execute({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 777, 'success', ?)`, args: [SENTINEL_ROUTE, at, at, JSON.stringify({ sentinel: `HO 777 rehearsal, the ${kind} copy only` })] }));
    if (kind === "night") planted.night = await plantNight(copyUrl(abs));
    if (kind === "band") planted.band = await plantBand(copyUrl(abs));
    say(`  copy ${path.basename(abs)} · sentinel ${at}`);
  }
  writeFileSync(path.join(ART, `planted-${LABEL}.json`), JSON.stringify(planted, null, 1));
  await prodUntouched("the seed", fp0, t0);
}

// The night's plants: Louisiana's jungle winners, then the tree's harvest (it publishes LA-01's
// two as `advanced`; it reads no general mark), then every general-ballot mark. A name is matched
// against the race's printed rows (on_ballot = 1, write_in = 0); a shape that no longer matches
// exactly reads STALE with what it found, and is left unplanted.
type Stale = { race: string; key: string; what: string; skip: boolean };
async function plantNight(url: string) {
  const stale: Stale[] = [];
  const planted: string[] = [];
  await withDb(url, async (db) => {
    for (const s of SHAPES) if (s.jungle) for (const n of s.jungle.names) {
      const r = await db.execute({ sql: `UPDATE primary_candidates SET status = 'winner' WHERE name = ? AND primary_id IN (SELECT id FROM primaries WHERE state = 'LA' AND chamber = 'house' AND primary_type = 'jungle' AND CAST(district AS INTEGER) = ?)`, args: [n, s.jungle.district] });
      if (r.rowsAffected !== 1) stale.push({ race: s.race, key: s.key, what: `jungle row "${n}" matched ${r.rowsAffected}`, skip: true });
      else planted.push(`${s.race} jungle winner ${n}`);
    }
  });
  const harvest = (await import("@/lib/harvest-challengers")) as { harvestChallengers: (db: Client) => Promise<Record<string, unknown>> };
  const result = await withDb(url, (db) => harvest.harvestChallengers(db));
  writeFileSync(path.join(ART, `harvest-night-${LABEL}.json`), JSON.stringify(result, null, 1));
  say(`  night: the tree's harvest ran after LA's winners were planted · jungle ${JSON.stringify((result as { jungle?: unknown }).jungle ?? null)}`);
  await withDb(url, async (db) => {
    for (const s of SHAPES) {
      if (s.page.prov === "nobox") {
        const st = (await db.execute({ sql: `SELECT status FROM general_ballot_reads WHERE race_id = ?`, args: [s.race] })).rows[0]?.status;
        if (st !== "no_box") stale.push({ race: s.race, key: s.key, what: `its read is ${String(st)}, not no_box`, skip: true });
      }
      for (const m of s.mark ?? []) {
        const rows = (await db.execute({ sql: `SELECT person_key, name, party FROM general_ballot WHERE race_id = ? AND on_ballot = 1 AND write_in = 0 ORDER BY name`, args: [s.race] })).rows;
        const hit = m === "__first_R__" ? rows.filter((r) => r.party === "R").slice(0, 1) : rows.filter((r) => String(r.name).includes(m));
        if (hit.length !== 1) { stale.push({ race: s.race, key: s.key, what: `"${m}" matches ${hit.length} printed rows (${rows.map((r) => r.name).join(", ")})`, skip: true }); continue; }
        await db.execute({ sql: `UPDATE general_ballot SET marked = 1 WHERE race_id = ? AND person_key = ?`, args: [s.race, String(hit[0]!.person_key)] });
        planted.push(`${s.race} ${hit[0]!.name} (${hit[0]!.party})`);
      }
    }
    // HO 758's curated shape: a curated (not harvested) race_candidates row the ballot prints
    // otherwise, matched by first and last name (getRaceRoster), its ballot row marked. HO 760 had
    // the ballot decide every box race's field; this looks for any live curated row left to carry it.
    const firstLast = (x: string) => {
      const t = x.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((w) => w && !["jr", "sr", "ii", "iii", "iv"].includes(w));
      return `${t[0] ?? ""} ${t[t.length - 1] ?? ""}`;
    };
    const live = (await db.execute(`
      SELECT rc.race_id, rc.name, rc.status FROM race_candidates rc
       WHERE rc.race_id IN (SELECT race_id FROM general_ballot_reads WHERE status = 'box')
         AND rc.source_url NOT LIKE 'harvest:%' AND rc.status <> 'withdrew'`)).rows;
    const carriers: string[] = [];
    for (const c of live) {
      const printed = (await db.execute({ sql: `SELECT name FROM general_ballot WHERE race_id = ? AND on_ballot = 1`, args: [c.race_id as string] })).rows.map((r) => String(r.name));
      if (!printed.includes(String(c.name)) && printed.filter((p) => firstLast(p) === firstLast(String(c.name))).length === 1) carriers.push(`${c.race_id} "${c.name}"`);
    }
    const sMe = (await db.execute(`SELECT name, status, source_url FROM race_candidates WHERE race_id = 'S-ME-2026' ORDER BY name`)).rows.map((r) => `${r.name} ${r.status} (${String(r.source_url).startsWith("harvest:") ? "harvested" : "curated"})`);
    stale.push({ race: "S-ME-2026", key: "HO 758's curated name printed otherwise (\"Troy Jackson\", the ballot's \"Troy Dale Jackson\")", what: `S-ME's race_candidates now reads ${sMe.join(", ")}; ${live.length} live curated rows in box races, ${carriers.length ? `re-plantable on ${carriers.join(", ")}` : "none printed otherwise, so nothing to re-plant on"}`, skip: false });
  });
  say(`  night: planted ${planted.join(" · ")}`);
  for (const s of stale) say(`  STALE ${s.race} (${s.key}): ${s.what}`);
  return { planted, stale };
}

// HO 758's band plant: rated seats get one marked row each, alternating R and D by id order, the
// rated Senate seats first; 40 unrated House seats get planted totals (20 R, 19 D and one other);
// one Louisiana seat (LA-03) gets one jungle winner.
const BAND_CALLED = 61;
async function plantBand(url: string) {
  return withDb(url, async (db) => {
    const rated = (await db.execute(`SELECT r.id, r.chamber FROM races r WHERE r.cycle = 2026 AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = 2026) AND r.id IN (SELECT race_id FROM general_ballot_reads WHERE status = 'box') ORDER BY r.chamber = 'house', r.id`)).rows.map((r) => ({ id: String(r.id), chamber: String(r.chamber) }));
    const pickRow = async (race: string, want: string[]) => {
      const rs = await db.execute({ sql: `SELECT person_key, name, party FROM general_ballot WHERE race_id = ? AND on_ballot = 1 AND write_in = 0 ORDER BY name`, args: [race] });
      for (const w of want) { const r = rs.rows.find((x) => (w === "other" ? !["D", "R"].includes(String(x.party)) : String(x.party) === w)); if (r) return { key: String(r.person_key), name: String(r.name), party: String(r.party) }; }
      return null;
    };
    let marked = 0, i = 0;
    for (const r of rated) {
      if (marked >= BAND_CALLED) break;
      const row = await pickRow(r.id, i % 2 === 0 ? ["R", "D"] : ["D", "R"]);
      if (!row) continue;
      await db.execute({ sql: `UPDATE general_ballot SET marked = 1 WHERE race_id = ? AND person_key = ?`, args: [r.id, row.key] });
      marked++; i++;
    }
    const unrated = (await db.execute(`SELECT r.id FROM races r WHERE r.cycle = 2026 AND r.chamber = 'house' AND NOT EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = 2026) AND r.id IN (SELECT race_id FROM general_ballot_reads WHERE status = 'box') ORDER BY r.id`)).rows.map((r) => String(r.id));
    let R = 0, Dm = 0, O = 0;
    for (const id of unrated) {
      if (R >= 20 && Dm >= 19 && O >= 1) break;
      const want = O < 1 ? ["other"] : R < 20 && (Dm >= 19 || R <= Dm) ? ["R"] : ["D"];
      const row = await pickRow(id, want);
      if (!row) continue;
      await db.execute({ sql: `UPDATE general_ballot SET marked = 1 WHERE race_id = ? AND person_key = ?`, args: [id, row.key] });
      if (want[0] === "other") O++; else if (want[0] === "R") R++; else Dm++;
    }
    const la = (await db.execute(`SELECT pc.id, pc.name FROM primary_candidates pc JOIN primaries p ON p.id = pc.primary_id WHERE p.state = 'LA' AND p.chamber = 'house' AND p.primary_type = 'jungle' AND CAST(p.district AS INTEGER) = 3 ORDER BY pc.name LIMIT 1`)).rows[0]!;
    await db.execute({ sql: `UPDATE primary_candidates SET status = 'winner' WHERE id = ?`, args: [la.id as number] });
    say(`  band: ${marked} rated seats marked, unrated House R ${R} · D ${Dm} · other ${O}, and LA-03's ${String(la.name)} a jungle winner`);
    return { rated: marked, unrated: { R, D: Dm, other: O }, la: String(la.name) };
  });
}

// The band's numbers by a SELECT over the copy's marks: a box race with exactly one marked row, or
// a race with no box read whose jungle first round has exactly one winner.
async function bandExpect(url: string) {
  return withDb(url, async (db) => {
    const calls = (await db.execute(`
      SELECT g.race_id AS id, r.chamber, g.party, EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = 2026) AS rated
        FROM general_ballot g JOIN races r ON r.id = g.race_id
       WHERE r.cycle = 2026 AND g.marked = 1 AND g.on_ballot = 1
         AND g.race_id IN (SELECT race_id FROM general_ballot_reads WHERE status = 'box')
         AND (SELECT COUNT(*) FROM general_ballot x WHERE x.race_id = g.race_id AND x.marked = 1 AND x.on_ballot = 1) = 1
      UNION ALL
      SELECT r.id, r.chamber, pc.party, EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = 2026)
        FROM races r JOIN primaries p ON p.state = r.state AND p.chamber = r.chamber AND (r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district) AND p.primary_type = 'jungle' AND p.election_round IS NOT 'runoff'
        JOIN primary_candidates pc ON pc.primary_id = p.id AND pc.status = 'winner'
       WHERE r.cycle = 2026
         AND (SELECT COUNT(*) FROM primary_candidates w WHERE w.primary_id = p.id AND w.status = 'winner') = 1
         AND r.id NOT IN (SELECT race_id FROM general_ballot_reads WHERE status = 'box')`)).rows;
    const rated = Number((await db.execute(`SELECT COUNT(*) n FROM races r WHERE r.cycle = 2026 AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = 2026)`)).rows[0]!.n);
    const houseSeats = Number((await db.execute(`SELECT COUNT(*) n FROM races WHERE cycle = 2026 AND chamber = 'house'`)).rows[0]!.n);
    const house = calls.filter((c) => c.chamber === "house");
    const party = (p: unknown) => String(p ?? "").trim().toUpperCase();
    return {
      ratedCalled: new Set(calls.filter((c) => Number(c.rated) === 1).map((c) => String(c.id))).size,
      rated,
      R: house.filter((c) => party(c.party) === "R").length,
      D: house.filter((c) => party(c.party) === "D").length,
      other: house.filter((c) => !["R", "D"].includes(party(c.party))).length,
      open: houseSeats - new Set(house.map((c) => String(c.id))).size,
    };
  });
}

// ── the reader (HO 758's leg 9), in process, on HO 747's saved pages ───────
type ReaderMod = {
  readPageModel: (html: string) => { general: { rows: { name: string; winner: boolean }[]; marked: number }[]; outsideGeneral: { rows: { name: string; winner: boolean }[]; marked: number }[] };
  pageResult: (...a: unknown[]) => { status: string; rows: unknown[] };
  raceWriteStatements: (...a: unknown[]) => InStatement[];
};
async function readerLeg() {
  say(`\n── the reader (HO 758's leg 9), on HO 747's saved pages`);
  const R = (await import("@/lib/general-ballot")) as unknown as ReaderMod;
  const page = (f: string) => gunzipSync(readFileSync(path.join(SAVED, f))).toString("utf8");
  for (const [f, want] of [["AK-AL-2026.1.html.gz", "Begich"], ["ME-02-2026.1.html.gz", "Golden"], ["ME-01-2026.1.html.gz", "Pingree"]] as const) {
    const m = R.readPageModel(page(f));
    const box = m.outsideGeneral.find((b) => b.rows.length > 1 && b.rows.some((r) => r.name.includes(want)));
    const winners = box ? box.rows.filter((r) => r.winner).map((r) => r.name) : [];
    check("reader", `${f.split(".")[0]}: the ranked-choice box marks only its Won (N) row, ${want}`, winners.length === 1 && winners[0]!.includes(want), `marked ${JSON.stringify(winners)} of ${box?.rows.map((r) => r.name).join(", ") ?? "no box"}`);
  }
  const html = page("AK-AL-2026.1.html.gz");
  const m = R.readPageModel(html);
  const past = m.outsideGeneral.find((b) => b.rows.some((r) => r.name.includes("Begich")) && b.rows.length > 1)!;
  const res = R.pageResult("AK-AL-2026", { ...m, general: [past] }, new Map(), NOV4);
  const stmts = R.raceWriteStatements("AK-AL-2026", { verdict: "READ", status: res.status, rows: res.rows, marked: past.marked, url: "file:saved-page" }, NOV4);
  const got = await withDb(copyUrl(copyPath("reader")), async (db) => { await db.batch(stmts, "write"); return (await db.execute(`SELECT name, marked FROM general_ballot WHERE race_id = 'AK-AL-2026' ORDER BY name`)).rows.map((r) => `${r.name}:${r.marked}`); });
  const marked = got.filter((x) => x.endsWith(":1"));
  check("reader", "a marked row reaches general_ballot.marked through the reader's own write path (pageResult, raceWriteStatements), and only it", marked.length === 1 && marked[0]!.includes("Begich"), got.join(", "));
}

// ── servers ─────────────────────────────────────────────────────────────────
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
async function startServer(kind: "today" | "night" | "band", clock: string | null) {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  const cache = path.resolve(".next/cache/fetch-cache");
  rmSync(cache, { recursive: true, force: true });
  const log = path.join(DIR, `server777-${kind}-${LABEL}-${Date.now()}.log`);
  const out = createWriteStream(log);
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env: childEnv(copyUrl(copyPath(kind)), clock), stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (b: Buffer) => out.write(b));
  server.stderr.on("data", (b: Buffer) => out.write(b));
  const kill = async () => {
    try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
    out.end();
    for (let i = 0; i < 20 && listeningPids().length; i++) await sleep(250);
    if (listeningPids().length) throw new Error(`port ${PORT} still bound after the kill`);
  };
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`${BASE}/api/health`)).status > 0; } catch { /* not yet */ } }
  if (!up) { await kill(); throw new Error("the server never answered /api/health"); }
  const h = (await (await fetch(`${BASE}/api/health`)).json()) as { routes?: { path?: string; lastRunAt?: string }[] };
  const mine = h.routes?.find((r) => r.path === SENTINEL_ROUTE);
  if (mine?.lastRunAt !== sentinelAt(kind)) { await kill(); throw new Error(`transport check failed: lastRunAt ${String(mine?.lastRunAt)} is not the ${kind} copy's sentinel`); }
  const pids = listeningPids();
  say(`  server :${PORT} (pid ${server.pid}, listener ${pids.join(",")}) · ${kind} copy (own sentinel ${sentinelAt(kind)}) · clock ${clock ?? "real"} · fetch-cache cleared`);
  return { kill };
}

// Page scripts are strings (tsx's keepNames wrapper), with no regex escapes (HO 736).
const NORM = `const norm = (s) => (s || '').split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ');`;
const READ_RACE = `(() => { ${NORM}
  const header = document.querySelector('.race-header');
  const sub = header ? header.children[1] : null;
  const chips = header ? header.children[2] : null;
  const qual = document.querySelector('[data-incumbent-qualifier]');
  const tag = document.querySelector('[data-incumbent-tag]');
  const h2 = Array.from(document.querySelectorAll('h2')).find((h) => h.textContent.trim().toLowerCase().startsWith('candidates ('));
  const section = h2 ? h2.closest('section') : null;
  const lis = section ? Array.from(section.querySelectorAll('li')) : [];
  return {
    sub: sub ? norm(sub.textContent) : null,
    chipsOpacity: chips ? getComputedStyle(chips).opacity : null,
    chipsText: chips ? norm(chips.textContent) : null,
    anchors: chips ? Array.from(chips.querySelectorAll('a')).map((a) => ({ text: norm(a.textContent), href: a.getAttribute('href'), target: a.getAttribute('target') })) : [],
    qualifier: qual ? norm(qual.textContent) : null,
    tag: tag ? norm(tag.textContent) : null,
    card: (() => {
      const prof = Array.from(document.querySelectorAll('a')).find((a) => norm(a.textContent).startsWith('View member profile'));
      const col = prof ? prof.parentElement : (Array.from(document.querySelectorAll('span')).find((s) => norm(s.textContent) === 'Open Seat') || {}).parentElement;
      return col ? Array.from(col.children).map((ch) => norm(ch.textContent)).filter(Boolean).join(' · ') : null;
    })(),
    tagKey: tag ? tag.getAttribute('data-incumbent-tag') : null,
    rows: lis.map((li) => ({ text: norm(li.textContent), elected: !!li.querySelector('[data-elected]') })),
    provenance: Array.from(document.querySelectorAll('[data-result-provenance]')).map((p) => norm(p.textContent)),
  };
})()`;
type RaceReading = { sub: string | null; chipsOpacity: string | null; chipsText: string | null; anchors: { text: string; href: string | null; target: string | null }[]; qualifier: string | null; tag: string | null; tagKey: string | null; card: string | null; rows: { text: string; elected: boolean }[]; provenance: string[] };
// The dormant read of one race page's server HTML, by the browser's own parser (it loads nothing).
const READ_DORMANT = (html: string) => `(() => { ${NORM}
  const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html');
  const header = doc.querySelector('.race-header');
  const main = doc.querySelector('main');
  return {
    header: !!header,
    sub: header && header.children[1] ? norm(header.children[1].textContent) : '',
    finalCall: main ? /final call/i.test(main.textContent || '') : false,
    provenance: doc.querySelectorAll('[data-result-provenance]').length,
    elected: doc.querySelectorAll('[data-elected]').length,
    qualifier: doc.querySelectorAll('[data-incumbent-qualifier]').length,
  };
})()`;
const READ_ROWS = `(() => { ${NORM}
  return Array.from(document.querySelectorAll('li.race-list-item')).map((li) => {
    const row = li.querySelector('.race-list-row');
    const chip = row.querySelector('.rl-chipcell .race-list-chip');
    return {
      id: li.getAttribute('data-race'),
      who: norm(row.querySelector('.race-list-cand').textContent),
      chip: chip ? norm(chip.textContent) : null,
      result: chip ? chip.getAttribute('data-result') : null,
      checked: Array.from(row.querySelectorAll('.rl-wn .rl-nm')).map((n) => norm(n.textContent)),
      dim: Array.from(row.querySelectorAll('.rl-nm--dim')).map((n) => norm(n.textContent)),
      final: !!row.querySelector('.race-spread--final'),
      divergeInk: getComputedStyle(row.querySelector('.race-list-diverge')).color,
    };
  });
})()`;
const READ_OPEN = `(() => { ${NORM}
  const ex = document.querySelector('.race-list-expand');
  if (!ex) return null;
  return {
    bal: Array.from(ex.querySelectorAll('.rl-bal-row')).map((r) => ({ name: norm(r.querySelector('.rl-nm').textContent), how: norm((r.querySelector('.rl-how') || {}).textContent), under: norm((r.querySelector('.rl-hd') || {}).textContent) })),
    members: Array.from(ex.querySelectorAll('.rl-mem')).map((m) => ({ href: (m.querySelector('.rl-mh a.rl-lk') || {}).getAttribute ? m.querySelector('.rl-mh a.rl-lk').getAttribute('href') : null, role: norm(m.querySelector('.rl-mr').textContent) })),
    held: (() => { const sh = ex.querySelector('.rl-sh'); return sh ? norm(sh.textContent) : null; })(),
    finalCalls: !!ex.querySelector('.rl-fc'),
    prov: norm((ex.querySelector('.rl-prov') || {}).textContent),
    kalshi: !!ex.querySelector('.racecard-kalshi'),
  };
})()`;
const readOpenFor = (id: string) => READ_OPEN.replace("document.querySelector('.race-list-expand')", `document.querySelector('li[data-race="${id}"] .race-list-expand')`);
type RowReading = { id: string; who: string; chip: string | null; result: string | null; checked: string[]; dim: string[]; final: boolean; divergeInk: string };
type OpenReading = { bal: { name: string; how: string; under: string }[]; members: { href: string | null; role: string }[]; held: string | null; finalCalls: boolean; prov: string; kalshi: boolean };

type Browser = Awaited<ReturnType<typeof import("@playwright/test")["chromium"]["launch"]>>;
async function newPage(browser: Browser, w: number, h = 1000) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: "reduce" });
  await ctx.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, errors };
}
type Page = Awaited<ReturnType<typeof newPage>>["page"];
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
async function imagesLoaded(page: Page) {
  await page.evaluate(`Promise.all(Array.from(document.images).filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = r; i.onerror = r; setTimeout(r, 4000); })))`);
}
async function openRow(page: Page, id: string) {
  await page.locator(".rl-tab", { hasText: id.startsWith("S-") ? "SENATE" : "HOUSE" }).click();
  const li = page.locator(`li[data-race="${id}"]`);
  if (!(await li.count())) return null;
  if (!(await li.locator(".race-list-expand").count())) await li.locator(".race-list-seat").click();
  await li.locator(".race-list-expand").waitFor({ timeout: 8000 });
  return li;
}
async function bothTabs(page: Page): Promise<RowReading[]> {
  await page.locator(".rl-tab", { hasText: "SENATE" }).click();
  const s = (await page.evaluate(READ_ROWS)) as RowReading[];
  await page.locator(".rl-tab", { hasText: "HOUSE" }).click();
  const h = (await page.evaluate(READ_ROWS)) as RowReading[];
  await page.locator(".rl-tab", { hasText: "SENATE" }).click();
  return [...s, ...h];
}
// HO 768's pinned MAP card: MAP, the search, each card opened by its chevron, its Kalshi lines counted.
async function pinnedKalshi(page: Page, query: string, labels: string[]): Promise<Record<string, number>> {
  const b = page.locator(".cart-viewtoggle-btn", { hasText: "MAP" });
  if ((await b.getAttribute("aria-selected")) !== "true") { await b.click(); await page.waitForTimeout(400); }
  const box = page.locator(".cart-search input");
  await box.fill(query);
  await box.press("Enter");
  await page.locator("ul.racecard-list").waitFor({ timeout: 8000 });
  const out: Record<string, number> = {};
  const rows = page.locator("ul.racecard-list > li.racecard-row");
  for (let i = 0; i < (await rows.count()); i++) {
    const row = rows.nth(i);
    const seat = norm(await row.locator(".racecard-seat").innerText());
    const label = labels.find((l) => seat.includes(l)) ?? seat;
    await row.locator(".racecard-head .racecard-chevron").click();
    await page.waitForTimeout(150);
    out[label] = await row.locator(".racecard-kalshi").count();
  }
  return out;
}

// The band sits in the dashboard's Races panel; its tab is opened when the band isn't in the document.
async function readBand(page: Page): Promise<{ text: string | null; results: boolean }> {
  const READ = `(() => { const e = document.querySelector('section.battlefield .ctl-eday'); return { text: e ? e.textContent.split(' ').filter(Boolean).join(' ') : null, results: !!(e && e.hasAttribute('data-results')) }; })()`;
  let b = (await page.evaluate(READ)) as { text: string | null; results: boolean };
  if (b.text === null) {
    const tab = page.locator("button.dv2-racesbox-tab", { hasText: "Races" }).first();
    if (await tab.count()) { await tab.click(); await sleep(600); }
    b = (await page.evaluate(READ)) as { text: string | null; results: boolean };
  }
  return b;
}

function buildState(): string {
  if (!existsSync(".next/BUILD_ID")) throw new Error("no build: run a cold `next build` first");
  const built = statSync(".next/BUILD_ID").mtime;
  const headAt = Number(execFileSync("git", ["log", "-1", "--format=%ct"], { encoding: "utf8" }).trim()) * 1000;
  if (built.getTime() < headAt) throw new Error("the build is older than HEAD; rebuild first");
  return `build ${readFileSync(".next/BUILD_ID", "utf8").trim()} @ ${built.toISOString()} · HEAD ${execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim()}`;
}

async function run() {
  say(`\n── run · ${buildState()}`);
  mkdirSync(SHOTS, { recursive: true });
  const raceIds = await withDb(copyUrl(copyPath("today")), async (db) => (await db.execute(`SELECT id FROM races WHERE cycle = 2026 ORDER BY id`)).rows.map((r) => String(r.id)));
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const out: Record<string, unknown> = {};
  try {
    { const srv = await startServer("today", null); try { await dormant(browser, raceIds, out); } finally { await srv.kill(); } }
    { const srv = await startServer("night", NOV4); try { await night(browser, out); } finally { await srv.kill(); } }
    { const srv = await startServer("band", NOV4); try { await band(browser, out); } finally { await srv.kill(); } }
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(ART, `run-${LABEL}.json`), JSON.stringify(out, null, 1));
}

// ── dormant: the today copy, the real clock, no marks ──────────────────────
async function dormant(browser: Browser, raceIds: string[], out: Record<string, unknown>) {
  say(`\n── dormant (today copy, the real clock, no marks)`);
  const { ctx, page, errors } = await newPage(browser, 1440);
  await page.goto("about:blank");
  const turned: string[] = [];
  let read = 0;
  for (const id of raceIds) {
    const res = await ctx.request.get(`${BASE}/race/${id}`);
    const d = (await page.evaluate(READ_DORMANT(await res.text()))) as { header: boolean; sub: string; finalCall: boolean; provenance: number; elected: number; qualifier: number };
    read++;
    if (res.status() !== 200 || !d.header || /Decided|Not yet called|Runoff/.test(d.sub) || d.finalCall || d.provenance || d.elected || d.qualifier) turned.push(`${id} (${res.status()}${d.header ? "" : ", no header"}: "${d.sub}"${d.finalCall ? ", final call" : ""}${d.provenance ? `, ${d.provenance} provenance` : ""}${d.elected ? `, ${d.elected} Elected` : ""}${d.qualifier ? `, ${d.qualifier} result word` : ""})`);
  }
  check("dormant", `no race page shows a result, final call, Elected or a runoff header (${read} race pages, server HTML)`, turned.length === 0, turned.length ? `${turned.length} turned: ${turned.slice(0, 8).join(" · ")}` : `${read} read, every header a countdown`);
  await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
  const rows = await bothTabs(page);
  const head = norm(await page.locator(".rl-heads").innerText());
  const text = norm(await page.locator("main").innerText());
  const res = rows.filter((r) => r.result || r.checked.length || r.final);
  check("dormant", "/electoral: no row carries a result chip, a check or final bars, and the head reads Consensus", res.length === 0 && /CONSENSUS/i.test(head) && !/RESULT/i.test(head), `${rows.length} rows · ${res.length} with a result · head "${head}"`);
  check("dormant", "/electoral: no Final calls, Elected, re-elected or not yet called anywhere on the page", !/Final calls|Elected|re-elected|not yet called/.test(text), "searched main's text");
  const runoffRows = rows.filter((r) => r.chip === "RUNOFF" || /runoff/i.test(r.who)).map((r) => `${r.id} "${r.who}"`);
  check("dormant", "/electoral: no row reads RUNOFF", runoffRows.length === 0, runoffRows.join(" · ") || `${rows.length} rows read`);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const band = await readBand(page);
  check("dormant", "the band reads its ELECTION DAY line, not RESULTS", !band.results && /^ELECTION DAY · NOV 3 · \d+ DAYS · ~\d+ competitive seats$/.test(band.text ?? ""), `"${band.text}"`);
  for (const id of ["GA-13-2026", "AL-01-2026", "S-AL-2026", "S-AK-2026"]) {
    await page.goto(`${BASE}/race/${id}`, { waitUntil: "networkidle" });
    const x = (await page.evaluate(READ_RACE)) as RaceReading;
    say(`    RECORD today ${id}: card "${x.card ?? "none"}" · tag ${x.tagKey ? `${x.tagKey} "${x.tag}"` : "none"}`);
  }
  check("dormant", "no page error", errors.length === 0, errors.slice(0, 2).join(" | ") || "none");
  out.dormant = { races: read, turned, rows: rows.length, head, band };
  await ctx.close();
}

// ── night: the plants, the clock at Nov 4 ──────────────────────────────────
async function night(browser: Browser, out: Record<string, unknown>) {
  say(`\n── night (the plants, CBT_CLOCK_NOW ${NOV4})`);
  const planted = JSON.parse(readFileSync(path.join(ART, `planted-${LABEL}.json`), "utf8")) as { night: { stale: { race: string; skip: boolean }[] }; seedNotes: { sAlMoore: Record<string, unknown> | null } };
  const skipRaces = new Set(planted.night.stale.filter((x) => x.skip).map((x) => x.race));
  const readings: Record<string, RaceReading> = {};
  for (const s of SHAPES) {
    if (skipRaces.has(s.race)) { say(`  SKIP ${s.race} (${s.key}): STALE at the seed`); continue; }
    const { ctx, page } = await newPage(browser, 1440);
    await page.goto(`${BASE}/race/${s.race}`, { waitUntil: "networkidle" });
    const x = (await page.evaluate(READ_RACE)) as RaceReading;
    readings[s.race] = x;
    await ctx.close();
    const w = s.page;
    const tag = `${s.race} (HO ${s.from}, ${s.key})`;
    const wantSub = w.sub === "decided" ? "Decided · Nov 3, 2026" : w.sub === "notCalled" ? "Not yet called" : w.sub === "runoffDec12" ? "Runoff Dec 12" : w.sub === "runoffDec1" ? "Runoff Dec 1" : "Runoff";
    // HO 795: a runoff header is matched at its end, so a bare Runoff and Georgia's Runoff Dec 1 read exactly.
    check("race page", `${tag}: the header reads ${wantSub}`, w.sub === "runoff" || w.sub === "runoffDec1" ? (x.sub ?? "").endsWith(wantSub) : (x.sub ?? "").includes(wantSub), `"${x.sub}"`);
    if (w.rated) check("race page", `${tag}: the chips sit dimmed under final call ·`, x.chipsOpacity === "0.55" && /final call/i.test(x.chipsText ?? ""), `opacity ${x.chipsOpacity} · "${x.chipsText}"`);
    else check("race page", `${tag}: no rating row, so no chips`, x.chipsText === null, `chips ${x.chipsText === null ? "none" : `"${x.chipsText}"`}`);
    if (w.anchors) {
      const want = RATER_PAGES[w.anchors];
      const hrefs = x.anchors.map((a) => a.href);
      check("race page", `${tag}: HO 775's three rater chips are links to the ${w.anchors} pages, inside the dimmed final call`, x.chipsOpacity === "0.55" && /final call/i.test(x.chipsText ?? "") && x.anchors.length === 3 && want.every((h) => hrefs.includes(h)) && x.anchors.every((a) => a.target === "_blank"), x.anchors.map((a) => `${a.text}→${a.href}`).join(" · "));
    }
    const elected = x.rows.filter((r) => r.elected).map((r) => r.text);
    check("race page", `${tag}: ${w.elected ? `Elected on ${w.elected}'s row, and only it` : "no row reads Elected"}`, w.elected ? elected.length === 1 && elected[0]!.includes(w.elected) : elected.length === 0, `Elected ${JSON.stringify(elected)} · rows ${x.rows.map((r) => r.text).slice(0, 6).join(" | ")}`);
    // HO 795: where HO 779 keeps the tag, the card shows the tag, as ruled, and no word.
    if (w.tag) check("race page", `${tag}: the card keeps its incumbent's tag, ${w.tag.key} "${w.tag.words}", and shows no word`, x.qualifier === null && x.tagKey === w.tag.key && x.tag === w.tag.words, `word "${x.qualifier ?? "none"}" · tag ${x.tagKey ?? "none"} "${x.tag ?? "none"}"`);
    else check("race page", `${tag}: the card's word reads ${w.qualifier ?? "nothing"}`, (x.qualifier?.toLowerCase() ?? null) === w.qualifier, `"${x.qualifier ?? "none"}" · tag "${x.tag ?? "none"}"`);
    const provOk = x.provenance.length > 0 && x.provenance.every((p) => (w.prov === "called" ? p.startsWith("Called by Ballotpedia · read ") : w.prov === "nobox" ? p.startsWith("No general-election box on Ballotpedia · read ") : p.startsWith("No call on Ballotpedia · read ")) && / MT$/.test(p));
    check("race page", `${tag}: the provenance line reads ${w.prov === "called" ? "Called by Ballotpedia" : w.prov === "nobox" ? "No general-election box on Ballotpedia" : "No call on Ballotpedia"} with its read time`, provOk, JSON.stringify(x.provenance));
    if (s.record) say(`    RECORD ${tag} · ${s.record}: card "${x.card ?? "none"}" · tag ${x.tagKey ? `${x.tagKey} "${x.tag}"` : "none"}`);
  }
  out.racePages = readings;
  say(`    RECORD S-AL's Moore row at the seed: ${JSON.stringify(planted.seedNotes.sAlMoore)}`);

  // /electoral at 1440 and 430
  const listShapes = SHAPES.filter((s) => s.list);
  const reads: Record<string, { row: RowReading | undefined; open: OpenReading | null }> = {};
  for (const w of [1440, 430]) {
    const { ctx, page, errors } = await newPage(browser, w, w === 430 ? 932 : 1000);
    await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
    const rows = await bothTabs(page);
    const head = norm(await page.locator(".rl-heads").innerText());
    const fold = norm(await page.locator(".electoral-tl-fold").innerText());
    const folded = (await page.locator(".electoral-tl-fold").getAttribute("aria-expanded")) === "false";
    const unlisted = SHAPES.filter((s) => !s.list && s.from === "776").map((s) => `${s.race} ${rows.some((r) => r.id === s.race) ? "listed" : "not listed"}`);
    for (const s of listShapes) {
      const li = await openRow(page, s.race);
      if (li) { await imagesLoaded(page); await li.screenshot({ path: path.join(SHOTS, `night-row-${s.race}-${w}.png`) }).catch(() => {}); }
      reads[`${s.race}@${w}`] = { row: rows.find((r) => r.id === s.race), open: li ? ((await page.evaluate(readOpenFor(s.race))) as OpenReading | null) : null };
    }
    await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(SHOTS, `night-electoral-list-${w}.png`), fullPage: true });
    check("/electoral", `@${w}: the column head reads Result`, /RESULT/i.test(head) && !/CONSENSUS/i.test(head), `"${head}"`);
    check("/electoral", `@${w}: the calendar is folded and reads all voted, with no NEXT`, folded && /(\d+) contests · \1 voted/.test(fold) && !/NEXT/.test(fold), `aria-expanded ${folded ? "false" : "not false"} · "${fold}"`);
    check("/electoral", `@${w}: no page error`, errors.length === 0, errors.slice(0, 2).join(" | ") || "none");
    try {
      const pinned = await pinnedKalshi(page, "NH SEN", ["NH SEN", "NH-01", "NH-02"]);
      check("/electoral", `@${w} MAP: a called seat's pinned card has no Kalshi line (S-NH), beside an uncalled one's (NH-01, the control)`, pinned["NH SEN"] === 0 && (pinned["NH-01"] ?? 0) > 0, JSON.stringify(pinned));
      out[`pinned${w}`] = pinned;
    } catch (e) {
      unreadable("/electoral", `@${w} MAP: a called seat's pinned card has no Kalshi line`, `the MAP card couldn't be opened: ${(e as Error).message.split("\n")[0]}`);
    }
    if (w === 1440) {
      say(`    RECORD /electoral's list for HO 776's races: ${unlisted.join(" · ")} (the list is getRacesIndex's rated races)`);
      const al = rows.find((r) => r.id === "AL-01-2026");
      if (al) check("/electoral", "AL-01 (HO 776): the chip reads R HOLD", al.chip === "R HOLD", `chip "${al.chip}" · who "${al.who}"`);
      else unreadable("/electoral", "AL-01 (HO 776): the chip reads R HOLD", "AL-01 is not on /electoral: the list carries the rated index, and AL-01 has no rating; its open row and its R HOLD can't be read here");
    }
    await ctx.close();
  }
  for (const w of [1440, 430]) for (const s of listShapes) {
    const r = reads[`${s.race}@${w}`]!;
    const L = s.list!;
    const tag = `@${w} ${s.race} (HO ${s.from})`;
    check("/electoral", `${tag}: the chip reads ${L.chip}`, r.row?.chip === L.chip, `chip "${r.row?.chip}" · who "${r.row?.who}"`);
    if (L.checked) check("/electoral", `${tag}: the check sits on ${L.checked}`, !!r.row && r.row.checked.length === 1 && r.row.checked[0] === L.checked, `checked ${JSON.stringify(r.row?.checked)} · dim ${JSON.stringify(r.row?.dim)}`);
    check("/electoral", `${tag}: the raters' bars are final calls`, !!r.row?.final, `final ${r.row?.final}`);
    if (L.chip !== "RUNOFF" && L.chip !== "NO CALL") check("/electoral", `${tag}: a called seat's ◆ is blank and its open row has no Kalshi line`, r.row?.divergeInk === "rgba(0, 0, 0, 0)" && r.open?.kalshi === false, `ink ${r.row?.divergeInk} · kalshi ${r.open?.kalshi}`);
    else check("/electoral", `${tag}: an uncalled seat keeps its Kalshi line (the control)`, r.open?.kalshi === true, `kalshi ${r.open?.kalshi}`);
    for (const [name, how] of Object.entries(L.open)) {
      const b = r.open?.bal.find((x) => x.name === name);
      check("/electoral", `${tag}: ${name} reads "${how}" on the open row's ballot`, b?.how === how, `"${b?.how}" · ballot ${JSON.stringify(r.open?.bal.map((x) => [x.name, x.how]))}`);
    }
    check("/electoral", `${tag}: the raters sit under Final calls, with the provenance under the ballot`, !!r.open?.finalCalls && /^(Called by Ballotpedia|No call on Ballotpedia|No general-election box on Ballotpedia)/.test(r.open?.prov ?? ""), `final ${r.open?.finalCalls} · "${r.open?.prov}"`);
    for (const [bio, role] of Object.entries(L.roles ?? {})) {
      const m = r.open?.members.find((x) => x.href === `/members/${bio}`);
      check("/electoral", `${tag}: ${bio}'s role line reads "${role}"`, !!m && m.role.includes(role), m ? `"${m.role}"` : `no member block for ${bio} · members ${JSON.stringify(r.open?.members.map((x) => x.href))} · held "${r.open?.held}"`);
    }
    if (s.race === "S-GA-2026") check("/electoral", `${tag}: a primary runoff's shares drop once the general is in`, !!r.open && r.open.bal.every((b) => !b.under.includes("%")), JSON.stringify(r.open?.bal.map((b) => b.under)));
  }
  out.electoral = reads;

  // captures: two decided race pages and the not-called one, at 1440 and 430
  for (const id of ["MI-04-2026", "IA-02-2026", "CO-08-2026"]) for (const w of [1440, 430]) {
    const { ctx, page } = await newPage(browser, w, w === 430 ? 932 : 1200);
    await page.goto(`${BASE}/race/${id}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(SHOTS, `night-race-${id}-${w}.png`), fullPage: true });
    await ctx.close();
  }
}

// ── band: the band copy at Nov 4 ───────────────────────────────────────────
async function band(browser: Browser, out: Record<string, unknown>) {
  say(`\n── the band (band copy, CBT_CLOCK_NOW ${NOV4})`);
  const e = await bandExpect(copyUrl(copyPath("band")));
  const { ctx, page } = await newPage(browser, 1440);
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  const { text, results } = await readBand(page);
  await ctx.close();
  check("band", "the band's line is the RESULTS line", results && /^RESULTS · NOV 3 · /.test(text ?? ""), `data-results ${results} · "${text}"`);
  const m = (text ?? "").match(/^RESULTS · NOV 3 · (\d+) of (\d+) competitive seats called · House R (\d+) · D (\d+)(?: · other (\d+))? · (\d+) open · Ballotpedia/);
  const got = m ? { ratedCalled: Number(m[1]), rated: Number(m[2]), R: Number(m[3]), D: Number(m[4]), other: Number(m[5] ?? 0), open: Number(m[6]) } : null;
  check("band", "the RESULTS line's N and House totals equal a SELECT over the marks", !!got && JSON.stringify(got) === JSON.stringify(e), `line "${text}" · read ${JSON.stringify(got)} · SELECT ${JSON.stringify(e)}`);
  out.band = { text, expect: e };
  for (const w of [1440, 430]) {
    const p = await newPage(browser, w, w === 430 ? 932 : 1200);
    await p.page.goto(`${BASE}/`, { waitUntil: "networkidle" });
    const tab = p.page.locator("button.dv2-racesbox-tab", { hasText: "Races" }).first();
    if (await tab.count()) { await tab.click(); await sleep(600); }
    const b = p.page.locator("section.battlefield").first();
    if (await b.count()) await b.screenshot({ path: path.join(SHOTS, `band-nov4-${w}.png`) }).catch(() => {});
    await p.ctx.close();
  }
}

async function main() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  say(`=== HO 777 election-night rehearsal · ${LABEL} · ${new Date().toISOString()} · tree ${tree} ===`);
  if (process.argv.includes("--seed")) { await seed(); await readerLeg(); }
  if (process.argv.includes("--run")) await run();
  say(`\n${LABEL}: ${passes} PASS · ${fails} FAIL · ${unread.length} N/A${failed.length ? `\n  FAIL ${failed.join("\n  FAIL ")}` : ""}${unread.length ? `\n  N/A  ${unread.join("\n  N/A  ")}` : ""}`);
}
main().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
