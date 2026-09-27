// HO 750 — the legs for the harvest yielding to the ballot, on `file:` copies
// seeded from prod after HO 749's full pass, seen red before green.
//
//   npx tsx scripts/diagnostic/harvest-yields-legs-750.ts            # all six legs
//   npx tsx scripts/diagnostic/harvest-yields-legs-750.ts --leg 2    # one leg
//
//   Leg 1, the whole table. The harvest at ebe8813 (loaded with `git show`) and
//     the working tree's, on the same copy. The change is held to STEP 0's
//     independent prediction (docs/handoffs/750-artifacts/step0-prediction.json,
//     derived from the handoff's text, not from this code): the ballot-sourced
//     rows equal it row for row, and the difference from today's rows, put in
//     STEP 0's classes, equals its counts. A difference in no class is a stop.
//     Then the handoff's named rows, each seen in today's state (red) first,
//     and the fallback: four races lose their box on a copy, and the change
//     publishes them exactly as today's harvest does (on today's data the
//     primary-sourced INSERT writes nothing, so without this no leg reaches it).
//   Leg 2, the census re-read. HO 747's own census, --reclassify on its saved
//     pages, against the copy after today's harvest (red: HO 747's 40, its 43
//     and 31 less the two published since, and its 2 and 2) and after the
//     change (the four zeros), with the residual named and counted.
//   Leg 3, the incumbent rule four ways, and the underline perturbation; the
//     handoff's three moved incumbents publish with NULL, a named departure.
//   Leg 4, atomicity: a forced throw after the DELETE leaves the old rows (red:
//     today's two-call harvest loses them), on a ballot INSERT and on the
//     second, primary-sourced INSERT, last in the batch.
//   Leg 5, the stub: the page's own lookup, and the handoff's sentences.
// The HO 750 review (a four-dimension adversarial read) found the WA status,
// the vacuous fallback check, the unchecked 43 and 31, the swapped moved
// incumbents and the second-INSERT gap; each is a check above now.
//   Leg 6, the tag: the route's wrapper around generalBallotTick with a shim;
//     a tick that wrote expires `general-ballot` once, one that wrote nothing
//     expires nothing, and `races` is never expired by it.
//
// SAFETY. Prod is read through a reader that refuses anything but SELECT, to
// seed the copies and to fingerprint (race_candidates by source, the ballot
// tables, both routes' cron_runs, and a sha256 of every row of the four tables
// the legs perturb and of the schema) before and after: equal readings mean
// nothing here reached prod. Every copy is `file:${abs}` from a path that must
// end in -750-control.db; `copyClient` refuses any other scheme and prints the
// one it ran against, and every perturbation goes through `copyWrite`. The
// census is spawned with TURSO_DATABASE_URL set to a copy's `file:` URL, and the
// leg proves which database it read (a `harvest:general_ballot` row exists only
// on a copy). Leg 6 points getDb() at a copy and proves it through a marker.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement, type ResultSet } from "@libsql/client";
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import * as HEAD from "@/lib/harvest-challengers";
import { findIncumbentOnBallot, normName, surnameMatches, type BallotPerson } from "@/lib/ballot-incumbent";
import { readIncumbentOnBallot } from "@/lib/incumbent-on-ballot";
import { stubSentence } from "@/lib/race-stub";
import { generalBallotTick, readPageModel, type IO, type Raw } from "@/lib/general-ballot";

config({ path: ".env", quiet: true });

const ART = "docs/handoffs/750-artifacts";
const RUN747 = "docs/handoffs/747-artifacts/run-2026-09-25T19-56-59-291Z";
const BASE_SHA = "ebe8813";
const PROD_URL = process.env.TURSO_DATABASE_URL ?? "";
const PROD_TOKEN = process.env.TURSO_AUTH_TOKEN;
const SENTINELS = [HEAD.HARVEST_SOURCE, HEAD.BALLOT_SOURCE];

let failures = 0;
function check(label: string, ok: boolean, detail: string) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
  if (!ok) failures++;
}
const S = (v: unknown) => (v == null ? null : String(v));
const toks = (s: string) => normName(s).split(" ").filter((t) => t && !["jr", "sr", "ii", "iii", "iv"].includes(t));

// ── copies ─────────────────────────────────────────────────────────────────
function reader(db: Client) {
  return (sql: string, args?: InArgs): Promise<ResultSet> => {
    const kw = sql.trim().split(/\s+/)[0]!.toUpperCase();
    if (kw !== "SELECT") throw new Error(`read-only: refused ${kw}`);
    return db.execute({ sql, args: args ?? [] });
  };
}
function schemeOf(url: string, what: string): string {
  const scheme = url.split(":")[0]!;
  if (scheme !== "file") throw new Error(`refused: ${what} runs against file: only (got ${scheme}:)`);
  return scheme;
}
function copyClient(url: string, what: string): Client {
  console.log(`    [${what}] scheme ${schemeOf(url, what)}:`);
  return createClient({ url });
}
async function copyWrite(url: string, stmts: InStatement[], what: string): Promise<number[]> {
  const c = copyClient(url, what);
  try {
    return (await c.batch(stmts, "write")).map((r) => r.rowsAffected);
  } finally {
    c.close();
  }
}
function ddlFromMigrate(table: string): string {
  const src = readFileSync("scripts/migrate.ts", "utf8").replace(/\r\n/g, "\n");
  const m = src.match(new RegExp("`(CREATE TABLE IF NOT EXISTS " + table + " \\([\\s\\S]*?\\n  \\))`"));
  if (!m?.[1]) throw new Error(`migrate.ts has no CREATE TABLE for ${table}`);
  return m[1];
}
// The tables the harvest, the census, the lookup and the tick read, cut to the
// columns they read.
const TABLES: { table: string; ddl: string; cols: string[] }[] = [
  { table: "races", ddl: `CREATE TABLE races (id TEXT PRIMARY KEY, cycle INTEGER NOT NULL, chamber TEXT NOT NULL, state TEXT NOT NULL, district INTEGER, rating TEXT, incumbent_bioguide_id TEXT, incumbent_running INTEGER)`, cols: ["id", "cycle", "chamber", "state", "district", "rating", "incumbent_bioguide_id", "incumbent_running"] },
  { table: "primaries", ddl: `CREATE TABLE primaries (id TEXT PRIMARY KEY, state TEXT NOT NULL, district TEXT, chamber TEXT NOT NULL, party TEXT NOT NULL, primary_date TEXT, primary_type TEXT, race_id TEXT, election_round TEXT)`, cols: ["id", "state", "district", "chamber", "party", "primary_date", "primary_type", "race_id", "election_round"] },
  { table: "primary_candidates", ddl: `CREATE TABLE primary_candidates (id INTEGER PRIMARY KEY, primary_id TEXT NOT NULL, name TEXT NOT NULL, party TEXT NOT NULL, incumbent INTEGER, bioguide_id TEXT, status TEXT)`, cols: ["id", "primary_id", "name", "party", "incumbent", "bioguide_id", "status"] },
  { table: "race_candidates", ddl: `CREATE TABLE race_candidates (race_id TEXT NOT NULL, name TEXT NOT NULL, party TEXT, bioguide_id TEXT, status TEXT, source_url TEXT, updated_at TEXT, PRIMARY KEY (race_id, name))`, cols: ["race_id", "name", "party", "bioguide_id", "status", "source_url", "updated_at"] },
  { table: "race_ratings", ddl: `CREATE TABLE race_ratings (id TEXT PRIMARY KEY, race_id TEXT NOT NULL, source TEXT, rating TEXT, cycle INTEGER NOT NULL)`, cols: ["id", "race_id", "source", "rating", "cycle"] },
  { table: "members", ddl: `CREATE TABLE members (bioguide_id TEXT PRIMARY KEY, name TEXT, first_name TEXT, last_name TEXT, party TEXT)`, cols: ["bioguide_id", "name", "first_name", "last_name", "party"] },
  { table: "member_ids", ddl: `CREATE TABLE member_ids (bioguide_id TEXT PRIMARY KEY, ballotpedia_title TEXT)`, cols: ["bioguide_id", "ballotpedia_title"] },
  { table: "general_ballot", ddl: "", cols: ["race_id", "person_key", "name", "printed_party", "party", "incumbent_marked", "write_in", "on_ballot", "withdrawn", "primary_marked", "bioguide_id", "box_prefix", "read_at"] },
  { table: "general_ballot_reads", ddl: "", cols: ["race_id", "status", "read_at", "rows", "marked", "source_url", "last_attempt_at", "last_attempt"] },
];
type Seed = Record<string, Record<string, unknown>[]>;
async function readSeed(): Promise<Seed> {
  if (!PROD_URL.startsWith("libsql://")) throw new Error("the seed reads prod; TURSO_DATABASE_URL must be the prod libsql:// URL");
  const prod = createClient({ url: PROD_URL, authToken: PROD_TOKEN });
  const read = reader(prod);
  const out: Seed = {};
  for (const t of TABLES) out[t.table] = (await read(`SELECT ${t.cols.join(", ")} FROM ${t.table}`)).rows.map((r) => ({ ...r }));
  prod.close();
  return out;
}
// Counts, plus a sha256 over every row of the tables the legs perturb on
// copies (race_candidates, general_ballot, general_ballot_reads,
// primary_candidates) and over prod's schema, triggers included: a leg's UPDATE,
// DELETE or CREATE TRIGGER that reached prod would move a hash, not only a count
// (the HO 750 review). A general-ballot tick in the window also moves them, so
// the legs run clear of the `20 */2` ticks, and cron_runs is printed beside.
async function prodFingerprint(): Promise<string> {
  const prod = createClient({ url: PROD_URL, authToken: PROD_TOKEN });
  const read = reader(prod);
  const rc = (await read(`SELECT source_url, COUNT(*) AS n FROM race_candidates WHERE source_url IN (?, ?) GROUP BY source_url ORDER BY source_url`, SENTINELS)).rows.map((r) => `${r.source_url}=${r.n}`);
  const gb = (await read(`SELECT (SELECT COUNT(*) FROM general_ballot) AS g, (SELECT COUNT(*) FROM general_ballot_reads) AS r`)).rows[0];
  const cr = (await read(`SELECT route, MAX(id) AS id FROM cron_runs WHERE route IN ('/api/cron/race-challengers', '/api/cron/general-ballot') GROUP BY route ORDER BY route`)).rows.map((r) => `${r.route}#${r.id}`);
  const hash = async (sql: string) => createHash("sha256").update(JSON.stringify((await read(sql)).rows.map((r) => Object.values(r)))).digest("hex").slice(0, 16);
  const sha = {
    race_candidates: await hash(`SELECT * FROM race_candidates ORDER BY race_id, name`),
    general_ballot: await hash(`SELECT * FROM general_ballot ORDER BY race_id, person_key`),
    general_ballot_reads: await hash(`SELECT * FROM general_ballot_reads ORDER BY race_id`),
    primary_candidates: await hash(`SELECT * FROM primary_candidates ORDER BY id`),
    schema: await hash(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`),
  };
  prod.close();
  return JSON.stringify({ race_candidates: rc, general_ballot: gb?.g, general_ballot_reads: gb?.r, cron_runs: cr, sha });
}
async function seedCopy(name: string, seed: Seed): Promise<string> {
  const abs = path.resolve(ART, name);
  if (!abs.endsWith("-750-control.db")) throw new Error(`refused: a copy must be a *-750-control.db file (got ${abs})`);
  if (existsSync(abs)) rmSync(abs);
  const url = `file:${abs}`;
  await copyWrite(
    url,
    [
      ...TABLES.map((t) => ({ sql: t.ddl || ddlFromMigrate(t.table), args: [] })),
      { sql: ddlFromMigrate("cron_runs"), args: [] },
    ],
    `ddl ${name}`,
  );
  for (const t of TABLES) {
    const rows = seed[t.table]!;
    for (let i = 0; i < rows.length; i += 400) {
      await copyWrite(
        url,
        rows.slice(i, i + 400).map((r) => ({
          sql: `INSERT INTO ${t.table} (${t.cols.join(",")}) VALUES (${t.cols.map(() => "?").join(",")})`,
          args: t.cols.map((c) => (r[c] ?? null) as never),
        })),
        `seed ${name} ${t.table}`,
      );
    }
  }
  return url;
}

// ── the two harvests ───────────────────────────────────────────────────────
type Harvest = (db: Client) => Promise<Record<string, unknown>>;
async function loadBase(): Promise<Harvest> {
  const src = execFileSync("git", ["show", `${BASE_SHA}:lib/harvest-challengers.ts`], { encoding: "utf8" });
  const file = path.resolve(ART, `harvest-challengers-base-${BASE_SHA}.ts`);
  writeFileSync(file, src);
  return ((await import(pathToFileURL(file).href)) as { harvestChallengers: Harvest }).harvestChallengers;
}
type RC = { race_id: string; name: string; party: string | null; bioguide_id: string | null; status: string | null; source_url: string | null };
async function harvestOn(url: string, fn: Harvest, what: string): Promise<{ rows: RC[]; result: Record<string, unknown> }> {
  const c = copyClient(url, what);
  try {
    const result = await fn(c);
    const rs = await c.execute({ sql: `SELECT race_id, name, party, bioguide_id, status, source_url FROM race_candidates WHERE source_url IN (?, ?) ORDER BY race_id, name`, args: SENTINELS });
    return { rows: rs.rows.map((r) => ({ race_id: String(r.race_id), name: String(r.name), party: S(r.party), bioguide_id: S(r.bioguide_id), status: S(r.status), source_url: S(r.source_url) })), result };
  } finally {
    c.close();
  }
}

// ── STEP 0's classifier, applied to the harvests' own output ──────────────
const man = JSON.parse(readFileSync(`${RUN747}/manifest-union.json`, "utf8")) as { raceId: string; url: string; file: string }[];
function primaryKeys(): Map<string, string> {
  const m = new Map<string, string>();
  for (const p of man) {
    const model = readPageModel(gunzipSync(readFileSync(p.file)).toString("utf8"));
    for (const b of model.primaries) for (const r of b.rows) if (r.key) m.set(`${p.raceId}|${normName(r.name)}`, r.key);
  }
  return m;
}
function classify(base: RC[], head: RC[], seed: Seed, pkeys: Map<string, string>): Record<string, string[]> {
  const classes: Record<string, string[]> = {};
  const add = (k: string, v: string) => (classes[k] ??= []).push(v);
  const gb = new Map<string, Record<string, unknown>[]>();
  for (const r of seed.general_ballot!) (gb.get(String(r.race_id)) ?? gb.set(String(r.race_id), []).get(String(r.race_id))!).push(r);
  const races = new Map(seed.races!.map((r) => [String(r.id), r]));
  const members = new Map(seed.members!.map((m) => [String(m.bioguide_id), m]));
  const headBallot = head.filter((r) => r.source_url === HEAD.BALLOT_SOURCE);
  // The ballot-sourced races: a box read and no curated row (STEP 0's set).
  const curated = new Set(seed.race_candidates!.filter((r) => !SENTINELS.includes(String(r.source_url ?? ""))).map((r) => String(r.race_id)));
  const ballotRaces = seed.general_ballot_reads!.filter((r) => r.status === "box" && !curated.has(String(r.race_id))).map((r) => String(r.race_id)).sort();
  for (const id of ballotRaces) {
    const olds = base.filter((r) => r.race_id === id);
    const news = headBallot.filter((r) => r.race_id === id);
    const ballot = gb.get(id) ?? [];
    const race = races.get(id)!;
    const inc = S(race.incumbent_bioguide_id);
    const incRow = inc
      ? findIncumbentOnBallot(ballot.map((b) => ({ person_key: String(b.person_key), name: String(b.name), bioguide_id: S(b.bioguide_id), incumbent_marked: Number(b.incumbent_marked), on_ballot: Number(b.on_ballot) })) as BallotPerson[], { bioguideId: inc, lastName: S(members.get(inc)?.last_name) }).row
      : null;
    const keyOfNew = (n: RC) => String(ballot.find((b) => String(b.name) === n.name)?.person_key ?? "");
    const matched = new Set<RC>();
    for (const o of olds) {
      const key = pkeys.get(`${id}|${normName(o.name)}`);
      const n = news.find((x) => (key && keyOfNew(x) === key) || normName(x.name) === normName(o.name));
      const b = ballot.find((x) => (key && x.person_key === key) || normName(String(x.name)) === normName(o.name));
      if (n) {
        matched.add(n);
        if (n.name !== o.name) add("renamed: the primary box's name → the ballot's (same person, same key)", `${id} ${o.name} → ${n.name}`);
        if (n.status !== o.status) add(n.status === "withdrew" ? "withdrawn: removed and re-added as `withdrew`" : `status ${o.status} → ${n.status}`, `${id} ${o.name}`);
        if (n.party !== o.party) add(`party ${o.party} → ${n.party} (fusion or printed party)`, `${id} ${o.name}`);
        if (n.bioguide_id !== o.bioguide_id) add(bioDir(o.bioguide_id, n.bioguide_id), `${id} ${o.name} ${o.bioguide_id ?? "NULL"} → ${n.bioguide_id ?? "NULL"}`);
        continue;
      }
      const ot = toks(o.name);
      const rn = news.find((x) => !matched.has(x) && o.party === x.party && (() => { const t = toks(x.name); return t[t.length - 1] === ot[ot.length - 1] && t[0]?.[0] === ot[0]?.[0]; })());
      if (rn) { matched.add(rn); add("renamed on the page: same race, party, surname and initial", `${id} ${o.name} → ${rn.name}`); continue; }
      if (b && incRow && b.person_key === incRow.person_key) add("incumbent no longer published as a challenger", `${id} ${o.name}`);
      else if (!b) add("removed: not on the ballot (runoff loser, or never on it)", `${id} ${o.name}`);
      else if (Number(b.on_ballot) === 1 && Number(b.write_in) === 1) add("removed: a write-in", `${id} ${o.name}`);
      else if (Number(b.on_ballot) === 1) add("removed: not D or R in a party-primary state", `${id} ${o.name} (${S(b.party)})`);
      else add("removed: withdrawn, not primary-marked", `${id} ${o.name}`);
    }
    for (const n of news) {
      if (matched.has(n)) continue;
      const namesake = !!inc && surnameMatches(n.name, S(members.get(inc)?.last_name)) && keyOfNew(n) !== String(incRow?.person_key ?? "~");
      add(n.status === "withdrew" ? "added: withdrew (not published before)" : namesake ? "added: a namesake of the stored incumbent (dropped before on a surname bioguide)" : n.party === "D" || n.party === "R" ? "added: a major-party candidate" : "added: a top-two/top-four candidate of another party", `${id} ${n.name} (${n.party}, ${n.status})`);
    }
  }
  return classes;
}
// A bioguide change, by direction (STEP 0 v2 prints one class per bioguide,
// labelled the same way): NULL → X is identity tying what the ingest did not,
// X → NULL is identity failing to tie what the ingest's surname match did (the
// HO 750 review: folding both into one "moved to identity" count hid the
// second kind).
function bioDir(from: string | null, to: string | null): string {
  return from == null ? "bioguide gained by identity" : to == null ? "bioguide lost: identity cannot tie" : "bioguide changed by identity";
}
const normClasses = (c: Record<string, number>) => {
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(c)) {
    const kk = !k.startsWith("bioguide ") ? k : / → NULL /.test(k) || k === "bioguide lost: identity cannot tie" ? "bioguide lost: identity cannot tie" : /^bioguide NULL → /.test(k) || k === "bioguide gained by identity" ? "bioguide gained by identity" : "bioguide changed by identity";
    out[kk] = (out[kk] ?? 0) + v;
  }
  return out;
};

// ── the fallback perturbation (legs 1 and 4) ──────────────────────────────
// Four races lose their box on a copy, so the primary-sourced INSERT…SELECT
// has rows to write, and LA-01 gains a marked winner for HO 748's jungle clause.
const FALLBACK = ["CA-10-2026", "AZ-04-2026", "TX-18-2026", "WA-04-2026"];
function perturbFallback(url: string): Promise<number[]> {
  return copyWrite(url, [
    { sql: `UPDATE general_ballot_reads SET status = 'no_box' WHERE race_id IN (${FALLBACK.map(() => "?").join(",")})`, args: FALLBACK },
    { sql: `DELETE FROM general_ballot WHERE race_id IN (${FALLBACK.map(() => "?").join(",")})`, args: FALLBACK },
    { sql: `UPDATE primary_candidates SET status = 'winner' WHERE name = 'Lauren Jewett' AND primary_id IN (SELECT id FROM primaries WHERE state = 'LA' AND chamber = 'house' AND CAST(district AS INTEGER) = 1)`, args: [] },
  ], "fallback perturb: four races lose their box, LA-01 gains a winner");
}

// ── legs ───────────────────────────────────────────────────────────────────
async function leg1(seed: Seed, BASE: Harvest) {
  console.log("\n── Leg 1 · the whole table: today's harvest against the change, held to STEP 0's prediction");
  const url = await seedCopy("table-750-control.db", seed);
  const base = await harvestOn(url, BASE, "BASE on the copy");
  const head = await harvestOn(url, HEAD.harvestChallengers as unknown as Harvest, "HEAD on the copy");
  console.log(`    BASE ${base.rows.length} rows · HEAD ${head.rows.length} rows ${JSON.stringify(head.result.bySource)} · routes ${JSON.stringify(head.result.incumbentRoutes)} · ignored ${head.result.ballotIgnored} · curatedDivergence ${JSON.stringify(head.result.curatedDivergence)}`);
  const pred = JSON.parse(readFileSync(`${ART}/step0-prediction.json`, "utf8")) as { classes: Record<string, number>; newRows: { race: string; name: string; party: string | null; bioguide_id: string | null; status: string }[] };
  const k = (r: { race: string; name: string; party: string | null; bioguide_id: string | null; status: string | null }) => JSON.stringify([r.race, r.name, r.party, r.bioguide_id, r.status]);
  const headBallot = head.rows.filter((r) => r.source_url === HEAD.BALLOT_SOURCE).map((r) => ({ race: r.race_id, name: r.name, party: r.party, bioguide_id: r.bioguide_id, status: r.status }));
  const hk = new Set(headBallot.map(k)), pk = new Set(pred.newRows.map(k));
  const onlyHead = headBallot.filter((r) => !pk.has(k(r))), onlyPred = pred.newRows.filter((r) => !hk.has(k(r)));
  for (const r of [...onlyHead.map((x) => `HEAD only ${k(x)}`), ...onlyPred.map((x) => `STEP 0 only ${k(x)}`)].slice(0, 10)) console.log(`    ${r}`);
  check("the ballot-sourced rows equal STEP 0's independent derivation, row for row", onlyHead.length === 0 && onlyPred.length === 0 && headBallot.length === pred.newRows.length, `${headBallot.length} rows · only HEAD ${onlyHead.length} · only STEP 0 ${onlyPred.length}`);
  const cls = classify(base.rows, head.rows, seed, primaryKeys());
  const got = normClasses(Object.fromEntries(Object.entries(cls).map(([kk, v]) => [kk, v.length])));
  const want = normClasses(pred.classes);
  console.log(`    the change, by class (leg · STEP 0):`);
  for (const kk of [...new Set([...Object.keys(got), ...Object.keys(want)])].sort()) console.log(`      ${String(got[kk] ?? 0).padStart(4)} · ${String(want[kk] ?? 0).padStart(4)}  ${kk}${cls[kk] ? ` · ${cls[kk]!.slice(0, 4).join("; ")}${cls[kk]!.length > 4 ? "; …" : ""}` : ""}`);
  const same = JSON.stringify(Object.entries(got).sort()) === JSON.stringify(Object.entries(want).sort());
  check("every difference sits in one of STEP 0's classes, at STEP 0's count", same, same ? "identical" : "the class table above differs");
  // The payload's own census, which the cron logs: every planned row inserted
  // (a (race_id, name) collision is counted, never silent), and the sentinel
  // counts equal to the rows read back.
  const bs = head.result.bySource as Record<string, { rows: number; races: number }>;
  const readBack = (src: string) => head.rows.filter((r) => r.source_url === src).length;
  // STEP 0 predicted "+ 0 kept primary-sourced": no race with a box keeps a
  // primary-sourced row (the class table above only sees ballot-sourced rows).
  const primInBox = head.rows.filter((r) => r.source_url === HEAD.HARVEST_SOURCE);
  check("no primary-sourced row survives anywhere (STEP 0's + 0 kept primary-sourced)", primInBox.length === 0, `${primInBox.length}${primInBox.length ? `: ${primInBox.slice(0, 5).map((r) => `${r.race_id} ${r.name}`).join("; ")}` : ""}`);
  check("the payload: 0 ignored, and rows by sentinel equal the rows read back",
    head.result.ballotIgnored === 0 && head.result.ballotPlanned === pred.newRows.length && bs[HEAD.BALLOT_SOURCE]!.rows === readBack(HEAD.BALLOT_SOURCE) && bs[HEAD.HARVEST_SOURCE]!.rows === readBack(HEAD.HARVEST_SOURCE),
    `planned ${head.result.ballotPlanned} · ignored ${head.result.ballotIgnored} · bySource ${JSON.stringify(bs)} · read back ${readBack(HEAD.BALLOT_SOURCE)} / ${readBack(HEAD.HARVEST_SOURCE)}`);

  // The named rows, each read in today's rows (red) and the change's (green).
  const has = (rows: RC[], race: string, re: RegExp) => rows.filter((r) => r.race_id === race && re.test(r.name));
  const show = (rows: RC[]) => rows.map((r) => `${r.name}·${r.status}·${r.party}·${r.bioguide_id ?? "NULL"}`).join(", ") || "none";
  const named: [string, string, RegExp, (b: RC[], h: RC[]) => boolean][] = [
    ["TX-18 without Al Green", "TX-18-2026", /Al Green/, (b, h) => b.length === 1 && h.length === 0],
    ["TX-33 without Julie Johnson", "TX-33-2026", /Julie Johnson/, (b, h) => b.length === 1 && h.length === 0],
    ["S-AK Leslie at withdrew", "S-AK-2026", /Leslie/, (b, h) => b[0]?.status === "advanced" && h[0]?.status === "withdrew"],
    ["S-AK Heikes at advanced", "S-AK-2026", /Heikes/, (b, h) => b.length === 0 && h[0]?.status === "advanced"],
    ["S-AK the second Dan Sullivan at advanced, NULL", "S-AK-2026", /^Dan Sullivan$/, (b, h) => b.length === 0 && h[0]?.status === "advanced" && h[0]?.bioguide_id === null],
    ["S-AK the senator on no row", "S-AK-2026", /Daniel S\. Sullivan/, (b, h) => b.length === 0 && h.length === 0],
    ["IL-04 Patty Garcia at NULL", "IL-04-2026", /Patty Garcia/, (b, h) => b.length === 0 && h.length === 1 && h[0]!.bioguide_id === null],
    ["CA-14 without Wahab", "CA-14-2026", /Wahab/, (b, h) => b.length === 1 && h.length === 0],
    ["S-SC without Darline Graham", "S-SC-2026", /Darline Graham/, (b, h) => b.length === 1 && h.length === 0],
    ["FL-20 Wasserman Schultz at W000797", "FL-20-2026", /Wasserman Schultz/, (b, h) => h[0]?.bioguide_id === "W000797"],
    ["NC-11 Balkcom at nominee", "NC-11-2026", /Balkcom/, (b, h) => b.length === 0 && h[0]?.status === "nominee"],
    ["NC-11's incumbent Edwards on no row (the departure)", "NC-11-2026", /Chuck Edwards/, (b, h) => h.length === 0],
    ["DE-AL published", "DE-AL-2026", /./, (b, h) => h.length > 0],
    ["S-DE published", "S-DE-2026", /./, (b, h) => h.length > 0],
    // The review's WA finding: Washington is a top-two state whose primaries
    // rows carry primary_type NULL, so v1 published its advancers as
    // won_primary (as today's harvest does, through its CASE on the column).
    ["WA-04's two top-two advancers at advanced", "WA-04-2026", /./, (b, h) => b.length === 2 && b.every((r) => r.status === "won_primary") && h.length === 2 && h.every((r) => r.status === "advanced")],
    // S-LA has a box (Louisiana's 2026 Senate race ran party primaries and a
    // runoff, and its November contest is a general): it is on the ballot path.
    // The handoff's Louisiana carve-out is the six House seats, which have no box.
    ["S-LA on the ballot path (ruled 2026-09-27: the rule is \"no box, then primary-sourced\", not \"Louisiana\"; S-LA has a box and its runoff losers leave)", "S-LA-2026", /./, (b, h) => h.length > 0 && h.every((r) => r.source_url === HEAD.BALLOT_SOURCE)],
  ];
  for (const [label, race, re, ok] of named) {
    const b = has(base.rows, race, re), h = has(head.rows, race, re);
    check(`named: ${label}`, ok(b, h), `today ${show(b)} → change ${show(h)}`);
  }
  // Utah's convention nominees, New York's fusion rows, Hawaii, Louisiana, FL-10, the curated races.
  // Utah's convention nominees by name (STEP 0's list), at `nominee`, and every
  // other Utah row a primary winner at `won_primary`, so an inverted status rule fails.
  const UT_NOMINEES = ["Riley Owen", "Peter Crosby", "Kent Udell", "Jonny Larsen", "Mike Kennedy"];
  const utRows = head.rows.filter((r) => r.race_id.startsWith("UT-"));
  const utNom = utRows.filter((r) => r.status === "nominee").map((r) => r.name).sort();
  check("named: Utah's convention nominees at nominee, by name, and every other Utah row at won_primary",
    JSON.stringify(utNom) === JSON.stringify([...UT_NOMINEES].sort()) && utRows.filter((r) => r.status !== "nominee").every((r) => r.status === "won_primary"),
    `nominee ${utNom.join(", ")} · others ${show(utRows.filter((r) => r.status !== "nominee"))}`);
  // New York's fusion lines: each published row's party is the FIRST party of
  // its printed line (read here from printed_party, not from the reader's
  // letter), and every fusion line led by D or R, printed and not a write-in or
  // the incumbent, is published.
  const nyFusion = seed.general_ballot!.filter((g) => String(g.race_id).startsWith("NY-") && String(g.printed_party ?? "").includes("/") && Number(g.on_ballot) === 1 && Number(g.write_in) === 0);
  const lead = (g: Record<string, unknown>) => String(g.printed_party).split("/")[0]!.trim();
  const nyLedDR = nyFusion.filter((g) => ["D", "R"].includes(lead(g)));
  const nyPub = nyFusion.map((g) => ({ g, r: head.rows.find((r) => r.race_id === g.race_id && r.name === g.name) })).filter((x) => x.r);
  const nyIncumbents = nyLedDR.filter((g) => !nyPub.some((x) => x.g === g));
  check("named: New York fusion rows at their printed line's leading party, D or R, and every D- or R-led fusion line published but the incumbents'",
    nyPub.length > 0 && nyPub.every((x) => x.r!.party === lead(x.g)) && nyIncumbents.every((g) => Number(g.incumbent_marked) === 1),
    `${nyPub.length} published of ${nyFusion.length} printed fusion lines (${nyLedDR.length} led by D or R) · unpublished D/R-led: ${nyIncumbents.map((g) => `${g.race_id} ${g.name}${Number(g.incumbent_marked) ? " (underlined)" : ""}`).join(", ") || "none"}`);
  const hiNp = seed.general_ballot!.filter((g) => String(g.race_id).match(/^(S-)?HI-/) && Number(g.on_ballot) === 1 && S(g.party) !== "D" && S(g.party) !== "R");
  const hiPub = hiNp.filter((g) => head.rows.some((r) => r.race_id === g.race_id && r.name === g.name));
  check("named: Hawaii's nonpartisan candidates not published", hiNp.length > 0 && hiPub.length === 0, `${hiNp.length} non-D/R Hawaii ballot rows, ${hiPub.length} published`);
  const unchanged = (race: string) => JSON.stringify(base.rows.filter((r) => r.race_id === race).map((r) => [r.name, r.status, r.party, r.bioguide_id])) === JSON.stringify(head.rows.filter((r) => r.race_id === race).map((r) => [r.name, r.status, r.party, r.bioguide_id]));
  const laFl = ["LA-01-2026", "LA-02-2026", "LA-03-2026", "LA-04-2026", "LA-05-2026", "LA-06-2026", "FL-10-2026", "S-LA-2026"].filter((r) => seed.general_ballot_reads!.find((x) => x.race_id === r)?.status !== "box");
  check("named: Louisiana's no-box seats and FL-10 unchanged", laFl.every(unchanged), `${laFl.join(", ")} · ${laFl.filter((r) => !unchanged(r)).join(", ") || "all unchanged"}`);
  const curatedCopy = copyClient(url, "curated rows");
  const cur = (await curatedCopy.execute({ sql: `SELECT race_id, name, status FROM race_candidates WHERE source_url IS NULL OR source_url NOT IN (?, ?) ORDER BY race_id, name`, args: SENTINELS })).rows.map((r) => `${r.race_id}:${r.name}:${r.status}`);
  curatedCopy.close();
  const curSeed = seed.race_candidates!.filter((r) => !SENTINELS.includes(String(r.source_url ?? ""))).map((r) => `${r.race_id}:${r.name}:${r.status}`).sort();
  const div = head.result.curatedDivergence as string[];
  check("named: curated races unchanged, with S-GA in the divergence report", JSON.stringify(cur) === JSON.stringify(curSeed) && div.length === 1 && div[0]!.startsWith("S-GA-2026"), `${cur.length} curated rows unchanged · divergence ${JSON.stringify(div)}`);

  // THE FALLBACK. On today's data the primary-sourced INSERT writes nothing:
  // the seven races without a box (Louisiana's six, FL-10) have no winner it
  // would publish, so the check above compares an empty list with an empty one
  // (the HO 750 review). Here four races lose their box on a copy, and the
  // change must publish them exactly as today's harvest does, under
  // `harvest:primary_winner`, while every other race keeps its ballot rows:
  //   CA-10 (top_two → advanced), AZ-04 (a NULL-typed primary → won_primary,
  //   HO 748's control), TX-18 (a runoff loser the fallback still publishes:
  //   it is today's derivation, blind spot and all) and WA-04 (the fallback
  //   still branches on primary_type, so WA reads won_primary there).
  // And LA-01, with Lauren Jewett marked winner, stays unpublished (HO 748's
  // jungle clause survives in the fallback).
  const urlF = await seedCopy("fallback-750-control.db", seed);
  const pert = await perturbFallback(urlF);
  const baseF = await harvestOn(urlF, BASE, "BASE on the fallback copy");
  const headF = await harvestOn(urlF, HEAD.harvestChallengers as unknown as Harvest, "HEAD on the fallback copy");
  const row = (r: RC) => JSON.stringify([r.race_id, r.name, r.party, r.bioguide_id, r.status]);
  const inF = (rows: RC[]) => rows.filter((r) => FALLBACK.includes(r.race_id));
  const bF = inF(baseF.rows), hF = inF(headF.rows);
  check("the fallback: races without a box are published exactly as today's harvest publishes them, under harvest:primary_winner",
    bF.length > 0 && JSON.stringify(bF.map(row)) === JSON.stringify(hF.map(row)) && hF.every((r) => r.source_url === HEAD.HARVEST_SOURCE) && FALLBACK.every((id) => hF.some((r) => r.race_id === id)),
    `today ${bF.length} rows · change ${hF.length} rows · ${hF.map((r) => `${r.race_id} ${r.name}·${r.status}`).join("; ")}`);
  const elsewhere = (rows: RC[]) => rows.filter((r) => !FALLBACK.includes(r.race_id)).map(row);
  check("the fallback touches no other race: every ballot-sourced row elsewhere is leg 1's",
    JSON.stringify(elsewhere(headF.rows)) === JSON.stringify(elsewhere(head.rows)), `${elsewhere(headF.rows).length} rows elsewhere`);
  const la1 = [...baseF.rows, ...headF.rows].filter((r) => r.race_id === "LA-01-2026");
  check("the fallback keeps HO 748's jungle clause: LA-01 with a marked winner publishes nothing", pert[0] === FALLBACK.length && pert[2]! >= 1 && la1.length === 0, `reads moved ${pert[0]} · winners marked ${pert[2]} · LA-01 rows ${la1.length}`);

  // THE OVERLAP (the review's second round). A ballot tick can commit between
  // the plan's read and the write batch. Simulated on a fallback copy: just
  // before the harvest's write batch, a commit gives CA-10 its box back and
  // takes AL-01's away. The fallback excludes the PLAN's box races, so CA-10
  // (no box when planned) keeps its primary-sourced rows and AL-01 (a box when
  // planned) keeps only its ballot rows. Red: the same harvest with the fallback
  // re-reading general_ballot_reads inside the batch (the first build's clause)
  // drops CA-10 to no rows and gives AL-01 both sentinels (its runoff loser, Rhett Marques, beside its ballot rows).
  const flipBeforeWrite = (c: Client): Client => {
    let flipped = false;
    return new Proxy(c, {
      get(t, p) {
        if (p === "batch") {
          return async (stmts: InStatement[], mode?: "write" | "read" | "deferred") => {
            if (mode === "write" && !flipped) {
              flipped = true;
              await t.batch([
                { sql: `UPDATE general_ballot_reads SET status = 'box' WHERE race_id = 'CA-10-2026'`, args: [] },
                { sql: `UPDATE general_ballot_reads SET status = 'no_box' WHERE race_id = 'AL-01-2026'`, args: [] },
              ], "write");
            }
            return t.batch(stmts, mode);
          };
        }
        const v = Reflect.get(t, p) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
  };
  const overlap = async (name: string, fn: Harvest) => {
    const u = await seedCopy(name, seed);
    await perturbFallback(u);
    const rows = (await harvestOn(u, (c) => fn(flipBeforeWrite(c)), `${name} with a commit before its write`)).rows;
    const at = (race: string) => rows.filter((r) => r.race_id === race);
    return { ca10: at("CA-10-2026"), al01: at("AL-01-2026") };
  };
  const firstBuild = await loadOverlapRed();
  const red = await overlap("overlap-red-750-control.db", firstBuild);
  const green = await overlap("overlap-green-750-control.db", HEAD.harvestChallengers as unknown as Harvest);
  const srcs = (rs: RC[]) => [...new Set(rs.map((r) => r.source_url))].join("+") || "none";
  const ca10Base = bF.filter((r) => r.race_id === "CA-10-2026").map(row);
  check("red: a fallback that re-reads the box status inside its batch drops CA-10 and doubles AL-01 when a tick commits in between",
    red.ca10.length === 0 && new Set(red.al01.map((r) => r.source_url)).size === 2, `CA-10 ${red.ca10.length} rows · AL-01 ${srcs(red.al01)}`);
  check("green: the fallback excludes the plan's box races, so CA-10 keeps today's rows and AL-01 only its ballot rows",
    JSON.stringify(green.ca10.map(row)) === JSON.stringify(ca10Base) && green.ca10.every((r) => r.source_url === HEAD.HARVEST_SOURCE) && green.al01.length > 0 && green.al01.every((r) => r.source_url === HEAD.BALLOT_SOURCE),
    `CA-10 ${green.ca10.length} rows (${srcs(green.ca10)}) · AL-01 ${green.al01.length} rows (${srcs(green.al01)})`);
  return { url, base, head };
}

// The first build's fallback clause, for the overlap's red: the working tree's
// harvest with the plan's box list swapped back for a re-read of
// general_ballot_reads inside the batch. Two exact substitutions, each checked.
async function loadOverlapRed(): Promise<Harvest> {
  let src = readFileSync("lib/harvest-challengers.ts", "utf8");
  const swaps: [string, string][] = [
    ["AND r.id NOT IN (SELECT value FROM json_each(?))", "AND NOT EXISTS (SELECT 1 FROM general_ballot_reads g WHERE g.race_id = r.id AND g.status = 'box')"],
    ["args: [runStamp, JSON.stringify(plan.boxRaces)],", "args: [runStamp],"],
    ['from "./ballot-incumbent"', 'from "@/lib/ballot-incumbent"'],
    ['from "./primary-calendar-scrape"', 'from "@/lib/primary-calendar-scrape"'],
  ];
  for (const [a, b] of swaps) {
    if (src.split(a).length !== 2) throw new Error(`overlap red: "${a}" must occur exactly once`);
    src = src.replace(a, b);
  }
  const file = path.resolve(ART, "harvest-challengers-overlap-red.ts");
  writeFileSync(file, src);
  return ((await import(pathToFileURL(file).href)) as { harvestChallengers: Harvest }).harvestChallengers;
}

type CensusM = { "published off the ballot": number; "D/R on the ballot, unpublished": number; "published and the stored incumbent": number; ballotSourcedRowsInSnapshot: number };
async function census(dbUrl: string, label: string, curated: Set<string>): Promise<{ m: CensusM; residual: Record<string, number>; missNames: string[]; curatedOff: string[]; json: { id: string; cands: Record<string, unknown>[]; incumbent: Record<string, unknown> | null }[]; cronLine: string }> {
  schemeOf(dbUrl, `census ${label}`);
  const dir = path.resolve(ART, `census-${label}`);
  mkdirSync(dir, { recursive: true });
  copyFileSync(`${RUN747}/manifest-union.json`, `${dir}/manifest-union.json`);
  const before = new Set(readdirSync(dir));
  console.log(`    [census ${label}] spawning HO 747's census --reclassify against ${dbUrl.split(":")[0]}:…${dbUrl.slice(-30)}`);
  execSync(`npx tsx scripts/diagnostic/general-box-census-747.ts --reclassify "${dir}"`, {
    env: { ...process.env, TURSO_DATABASE_URL: dbUrl, TURSO_AUTH_TOKEN: "" },
    stdio: ["ignore", "ignore", "inherit"],
    maxBuffer: 1 << 26,
  });
  const newJson = readdirSync(dir).filter((f) => !before.has(f) && f.startsWith("races-reclassify-") && f.endsWith(".json"));
  const snapJson = readdirSync(dir).filter((f) => !before.has(f) && f.startsWith("snapshot-reclassify-"));
  const reportTxt = readdirSync(dir).filter((f) => !before.has(f) && f.startsWith("report-reclassify-"));
  if (newJson.length !== 1 || snapJson.length !== 1 || reportTxt.length !== 1) throw new Error(`census ${label}: expected one new races JSON, snapshot and report, got ${newJson.length}/${snapJson.length}/${reportTxt.length}`);
  // The census's header names the newest cron_runs row it read for the harvest
  // and the primaries routes. Prod has both; a copy carries the table empty, so
  // "(none)" twice is the database's own tell that the census read a copy.
  const cronLine = readFileSync(`${dir}/${reportTxt[0]}`, "utf8").split(/\r?\n/)[0]!.replace(/^.*cron_runs /, "").replace(/ ===$/, "");
  // Which database did it read? A general_ballot sentinel row exists only on a copy after the change;
  // before the change the copy's rows are identical to prod's, so the copy's own cron_runs (empty) is the tell.
  const snap = JSON.parse(readFileSync(`${dir}/${snapJson[0]}`, "utf8")) as { roster: Record<string, { source: string | null }[]> };
  const ballotSourced = Object.values(snap.roster).flat().filter((r) => r.source === HEAD.BALLOT_SOURCE).length;
  const json = JSON.parse(readFileSync(`${dir}/${newJson[0]}`, "utf8")) as { id: string; cands: Record<string, unknown>[]; incumbent: Record<string, unknown> | null }[];
  const C = json.flatMap((r) => r.cands);
  const m: CensusM = {
    // The HARVEST's rows only. The census labels a harvest:general_ballot row
    // "curated" (it knows one sentinel), so curation is read by race instead.
    "published off the ballot": C.filter((c) => c.cls === "published-not-on-ballot" && !curated.has(String(c.race))).length,
    "D/R on the ballot, unpublished": C.filter((c) => c.cls === "on-ballot-not-published" && (c.ballotParty === "D" || c.ballotParty === "R") && !c.writeIn).length,
    "published and the stored incumbent": C.filter((c) => c.cls === "agree" && c.sub === "is-the-stored-incumbent").length,
    ballotSourcedRowsInSnapshot: ballotSourced,
  };
  const residual: Record<string, number> = {};
  for (const c of C.filter((c) => c.cls === "on-ballot-not-published")) {
    const k = c.writeIn ? "write-in" : c.ballotParty === "D" || c.ballotParty === "R" ? "D/R" : "not D or R";
    residual[k] = (residual[k] ?? 0) + 1;
  }
  const missNames = C.filter((c) => (c.cls === "on-ballot-not-published" && (c.ballotParty === "D" || c.ballotParty === "R") && !c.writeIn) || (c.cls === "agree" && c.sub === "is-the-stored-incumbent")).map((c) => `${c.race} ${c.name} (${c.cls}${c.sub ? `/${c.sub}` : ""})`);
  const curatedOff = C.filter((c) => c.cls === "published-not-on-ballot" && curated.has(String(c.race))).map((c) => `${c.race} ${c.name} (${c.status}, curated)`);
  return { m, residual, missNames, curatedOff, json, cronLine };
}
// HO 747's own figure, read the way HO 747 read it: on the ballot and
// unpublished, by the ballot's party, write-ins included (its 43 and 31).
type CensusJson = { id?: string; cands: Record<string, unknown>[] }[];
const drUnpublished = (json: CensusJson) =>
  json.flatMap((r) => r.cands).filter((c) => c.cls === "on-ballot-not-published" && (c.ballotParty === "D" || c.ballotParty === "R")).map((c) => `${c.race}|${c.name}|${c.ballotParty}`);

async function leg2(seed: Seed, BASE: Harvest) {
  console.log("\n── Leg 2 · the census re-read, today's harvest (red) and the change (green)");
  // The fourth zero: marked primary winners unpublished whose primary_candidates row carries the stored incumbent's bioguide.
  const byRacePc = new Map<string, Record<string, unknown>[]>();
  const prim = new Map(seed.primaries!.map((p) => [String(p.id), p]));
  for (const pc of seed.primary_candidates!) {
    const p = prim.get(String(pc.primary_id));
    if (!p || pc.status !== "winner") continue;
    for (const r of seed.races!) {
      if (Number(r.cycle) !== 2026 || r.state !== p.state || r.chamber !== p.chamber) continue;
      if (r.chamber !== "senate" && Number(p.district) !== Number(r.district)) continue;
      (byRacePc.get(String(r.id)) ?? byRacePc.set(String(r.id), []).get(String(r.id))!).push(pc);
    }
  }
  const incOf = new Map(seed.races!.map((r) => [String(r.id), S(r.incumbent_bioguide_id)]));
  const curated = new Set(seed.race_candidates!.filter((r) => !SENTINELS.includes(String(r.source_url ?? ""))).map((r) => String(r.race_id)));
  // HO 747's "2" is the namesakes. A winner who IS the stored incumbent is the
  // exclusion working, not a namesake dropped; the one the census cannot see as
  // the incumbent is WA-09's "D. Adam Smith" (its name route misses him, HO 749),
  // left out BY NAME as the census's own miss, the way the other two green
  // checks allow it. (v1 left out the rule's incumbent row instead, which filtered
  // the check with the function under test; the HO 750 review.)
  const CENSUS_OWN_MISS = "WA-09-2026 D. Adam Smith";
  const droppedAll = (json: { id: string; cands: Record<string, unknown>[] }[]) =>
    json.flatMap((r) => r.cands.filter((c) => c.cls === "on-ballot-not-published" && c.sub === "marked-in-primary" && (byRacePc.get(r.id) ?? []).some((pc) => normName(String(pc.name)) === normName(String(c.name)) && S(pc.bioguide_id) != null && S(pc.bioguide_id) === incOf.get(r.id))).map((c) => `${r.id} ${c.name}`));
  const dropped = (json: { id: string; cands: Record<string, unknown>[] }[]) => droppedAll(json).filter((x) => x !== CENSUS_OWN_MISS);

  const urlB = await seedCopy("census-base-750-control.db", seed);
  await harvestOn(urlB, BASE, "BASE on the census copy");
  const red = await census(urlB, "base", curated);
  const redDrop = dropped(red.json);
  const urlH = await seedCopy("census-head-750-control.db", seed);
  const headRows = (await harvestOn(urlH, HEAD.harvestChallengers as unknown as Harvest, "HEAD on the census copy")).rows;
  const green = await census(urlH, "head", curated);
  const greenDrop = dropped(green.json);
  const bothNone = (l: string) => /\/api\/cron\/race-challengers \(none\)/.test(l) && /\/api\/cron\/primaries \(none\)/.test(l);
  check("the census read the copies: each run's own header reads the copy's empty cron_runs (prod has rows for both routes), and only the change's copy carries ballot-sourced rows",
    bothNone(red.cronLine) && bothNone(green.cronLine) && red.m.ballotSourcedRowsInSnapshot === 0 && green.m.ballotSourcedRowsInSnapshot > 0,
    `red header ${JSON.stringify(red.cronLine)} · green header ${JSON.stringify(green.cronLine)} · ballot-sourced rows ${red.m.ballotSourcedRowsInSnapshot} → ${green.m.ballotSourcedRowsInSnapshot}`);
  console.log(`    red, today's harvest: off the ballot ${red.m["published off the ballot"]} · D/R unpublished ${red.m["D/R on the ballot, unpublished"]} · the stored incumbent published ${red.m["published and the stored incumbent"]} · marked winners dropped on the incumbent's bioguide ${redDrop.length} (${redDrop.join(", ")})`);
  check("red: today's harvest reproduces HO 747's shape (39 harvested off the ballot + S-GA's curated one = HO 747's 40; the 2 incumbents; the 2 namesakes)",
    red.m["published off the ballot"] === 39 && red.curatedOff.length === 1 && red.m["published and the stored incumbent"] === 2 && redDrop.length === 2, `${JSON.stringify(red.m)} · curated off the ballot ${red.curatedOff.join(", ")} · dropped ${redDrop.join(", ")}`);
  // HO 747's 43 and 31 (on the ballot and unpublished, R and D, write-ins
  // included). Two have been published since the census, and the difference must
  // be exactly them: DE-AL's Arminio (R), marked winner by the 2026-09-26 12:00Z
  // primaries tick, and FL-20's Wasserman Schultz (D), published by HO 748's
  // null-safe clause. Anything else in the difference is a stop.
  const ho747 = drUnpublished(JSON.parse(readFileSync(`${RUN747}/races-reclassify-2026-09-25T21-08-41-563Z.json`, "utf8")) as CensusJson);
  const redDr = drUnpublished(red.json);
  const party = (xs: string[], p: string) => xs.filter((x) => x.endsWith(`|${p}`)).length;
  const gone = ho747.filter((x) => !redDr.includes(x)).sort(), came = redDr.filter((x) => !ho747.includes(x));
  const SINCE = ["DE-AL-2026|Joseph Arminio|R", "FL-20-2026|Debbie Wasserman Schultz|D"];
  check("red: HO 747's 43 R and 31 D unpublished, less exactly the two published since (DE-AL's Arminio, FL-20's Wasserman Schultz), = 42 and 30",
    party(ho747, "R") === 43 && party(ho747, "D") === 31 && party(redDr, "R") === 42 && party(redDr, "D") === 30 && JSON.stringify(gone) === JSON.stringify(SINCE) && came.length === 0,
    `HO 747 R ${party(ho747, "R")} D ${party(ho747, "D")} · red R ${party(redDr, "R")} D ${party(redDr, "D")} · gone ${JSON.stringify(gone)} · new ${JSON.stringify(came)}`);
  // The census's own name route misses, named (HO 749): WA-09's "D. Adam Smith" is the stored incumbent the census cannot see; TX-22's "Trever Nehls" is the twin it takes for one.
  const misses = green.missNames;
  console.log(`    green, the change: ${JSON.stringify(green.m)} · dropped ${greenDrop.length}${greenDrop.length ? ` (${greenDrop.join(", ")})` : ""}`);
  console.log(`    the census's own misses among them: ${misses.join(" · ") || "none"}`);
  // The census's two blind spots are allowed EXACTLY, by name, not as "at most
  // one": each is the only row in its count. And because the census cannot see
  // either person for what they are, the harvest's own rows are read for both:
  // WA-09's stored incumbent, D. Adam Smith, is not published (the rule found
  // him), and TX-22's Trever Nehls, the incumbent's twin, is (the namesake guard).
  const drMiss = misses.filter((m) => m.includes("on-ballot-not-published")), incMiss = misses.filter((m) => m.includes("is-the-stored-incumbent"));
  const smith = headRows.filter((r) => r.race_id === "WA-09-2026" && r.name === "D. Adam Smith");
  const trever = headRows.filter((r) => r.race_id === "TX-22-2026" && r.name === "Trever Nehls");
  check("green: 0 of the harvest's rows published off the ballot", green.m["published off the ballot"] === 0, `${green.m["published off the ballot"]} · the curated residual, by ruling and filed: ${green.curatedOff.join(", ") || "none"}`);
  check("green: 0 D/R ballot rows unpublished, apart from exactly the census's own miss, WA-09's stored incumbent, whom the harvest indeed leaves out",
    green.m["D/R on the ballot, unpublished"] === 1 && drMiss.length === 1 && /^WA-09-2026 D\. Adam Smith /.test(drMiss[0]!) && smith.length === 0,
    `${green.m["D/R on the ballot, unpublished"]} · ${drMiss.join(", ")} · the harvest publishes him: ${smith.length ? "YES" : "no"}`);
  check("green: 0 published rows that are the stored incumbent, apart from exactly the census's own miss, TX-22's twin, whom the harvest indeed publishes",
    green.m["published and the stored incumbent"] === 1 && incMiss.length === 1 && /^TX-22-2026 Trever Nehls /.test(incMiss[0]!) && trever.length === 1,
    `${green.m["published and the stored incumbent"]} · ${incMiss.join(", ")} · the harvest publishes him: ${trever.map((r) => `${r.status}/${r.bioguide_id ?? "NULL"}`).join("") || "no"}`);
  const greenAll = droppedAll(green.json);
  check("green: 0 marked primary winners dropped for carrying the incumbent's bioguide, apart from the census's own miss (WA-09's stored incumbent, by name)",
    greenDrop.length === 0 && greenAll.every((x) => x === CENSUS_OWN_MISS), `${greenDrop.length} · left out by name: ${greenAll.filter((x) => x === CENSUS_OWN_MISS).join(", ") || "none"}`);
  console.log(`    the residual, unpublished by ruling: ${JSON.stringify(green.residual)} (non-major in party-primary states and write-ins; the D/R figure is the census's WA-09 miss)`);
}

async function leg3(seed: Seed, BASE: Harvest) {
  console.log("\n── Leg 3 · the incumbent rule, four ways, and the underline perturbation");
  const url = await seedCopy("rule-750-control.db", seed);
  const members = new Map(seed.members!.map((m) => [String(m.bioguide_id), m]));
  const rows = (race: string) => seed.general_ballot!.filter((g) => g.race_id === race).map((g) => ({ person_key: String(g.person_key), name: String(g.name), bioguide_id: S(g.bioguide_id), incumbent_marked: Number(g.incumbent_marked), on_ballot: Number(g.on_ballot) }));
  const inc = (race: string) => { const b = S(seed.races!.find((r) => r.id === race)?.incumbent_bioguide_id); return b ? { bioguideId: b, lastName: S(members.get(b)?.last_name) } : null; };
  const a = findIncumbentOnBallot(rows("AL-03-2026"), inc("AL-03-2026"));
  check("identity: AL-03's Mike Rogers (the handoff's FL-20 stores no incumbent; its case is the moved one, below)", a.route === "identity" && a.row?.name === "Mike Rogers", `${a.route} · ${a.row?.name}`);
  const s = findIncumbentOnBallot(rows("S-AK-2026"), inc("S-AK-2026"));
  check("underline and surname, one of the 42: S-AK's senator (stored title stale)", s.route === "underline-surname" && s.row?.name === "Daniel S. Sullivan", `${s.route} · ${s.row?.name}`);
  // Today's harvest first (it would read the change's rows as curated), then the change.
  const base3 = (await harvestOn(url, BASE, "BASE on the rule copy")).rows;
  const head = await harvestOn(url, HEAD.harvestChallengers as unknown as Harvest, "HEAD on the rule copy");
  const dan = head.rows.find((r) => r.race_id === "S-AK-2026" && r.name === "Dan Sullivan");
  check("the namesake guard: S-AK's second Dan Sullivan, not underlined, is published", s.row?.name !== "Dan Sullivan" && dan?.status === "advanced" && dan.bioguide_id === null, `${dan ? `${dan.status}, ${dan.bioguide_id ?? "NULL"}` : "absent"}`);
  const ca3 = findIncumbentOnBallot(rows("CA-03-2026"), inc("CA-03-2026"));
  const bera = head.rows.find((r) => r.race_id === "CA-03-2026" && r.name === "Ami Bera");
  const dws = head.rows.find((r) => r.race_id === "FL-20-2026" && /Wasserman Schultz/.test(r.name));
  // The handoff's "one of the 3" (TX-37's Casar, UT-04's Kennedy, UT-02's Blake
  // Moore, each underlined in a district not their own) is published there, but
  // NOT "with their bioguide": identity cannot tie any of the three (their
  // member_ids titles are missing), the build takes the bioguide from the ballot
  // row, and so all three publish with NULL. Two of them had one before, from
  // the ingest's surname match (Casar C001131, Moore M001213), and lose it.
  // The handoff's leg and its build clause could not both hold for these three.
  // RULED 2026-09-27: they publish at NULL for now, and leg 3 reads, corrected,
  // "with their bioguide where identity ties them, NULL where it doesn't". The
  // identity-tied moved incumbents (CA-03's Bera, FL-20's Wasserman Schultz)
  // publish with their bioguide. The stale-title residual is the next HO.
  const three = [["TX-37-2026", "Greg Casar"], ["UT-04-2026", "Mike Kennedy"], ["UT-02-2026", "Blake Moore"]] as const;
  const got3 = three.map(([race, name]) => ({ race, name, rule: findIncumbentOnBallot(rows(race), inc(race)).route, before: base3.find((r) => r.race_id === race && r.name === name), after: head.rows.find((r) => r.race_id === race && r.name === name) }));
  check("leg 3 as corrected by the ruling, NULL where identity doesn't tie: the handoff's 3 moved incumbents are published in the district they run in, not excluded as that seat's incumbent, and with NULL",
    got3.every((g) => g.rule === "none" && !!g.after && g.after.bioguide_id === null),
    got3.map((g) => `${g.race} ${g.name}: rule ${g.rule} · today ${g.before ? `${g.before.status}/${g.before.bioguide_id ?? "NULL"}` : "absent"} → change ${g.after ? `${g.after.status}/${g.after.bioguide_id ?? "NULL"}` : "absent"}`).join(" · "));
  check("leg 3 as corrected by the ruling, with their bioguide where identity ties them: CA-03's Ami Bera (CA-06's), and FL-20's Wasserman Schultz (FL-25's)", ca3.route === "none" && bera?.bioguide_id === "B001287" && dws?.bioguide_id === "W000797", `CA-03 rule ${ca3.route} · Bera ${bera?.status}/${bera?.bioguide_id} · Wasserman Schultz ${dws?.status}/${dws?.bioguide_id}`);
  // The perturbation: take the senator's underline away; the rule loses him and he is published as his own challenger.
  await copyWrite(url, [{ sql: `UPDATE general_ballot SET incumbent_marked = 0 WHERE race_id = 'S-AK-2026' AND name = 'Daniel S. Sullivan'`, args: [] }], "leg 3 perturb: no underline");
  const pert = await harvestOn(url, HEAD.harvestChallengers as unknown as Harvest, "HEAD on the perturbed copy");
  const senator = pert.rows.find((r) => r.race_id === "S-AK-2026" && r.name === "Daniel S. Sullivan");
  check("perturbation (red): with the underline gone, the senator is published as his own challenger", !!senator, `${senator ? `${senator.status}, ${senator.bioguide_id ?? "NULL"}` : "absent"} · routes ${JSON.stringify(pert.result.incumbentRoutes)}`);

  // The review's fixes (2) and (3), which today's data never reaches, each with
  // its red computed from the first build's own predicate on the same rows.
  // (3) Identity is decisive: an incumbent identity finds only in the withdrawn
  // block is on no printed row, even when another underlined, untied row with
  // the same surname is printed. The first build looked for identity on printed
  // rows only and fell through to the surname route.
  const firstBuildRule = (rs: BallotPerson[], i: { bioguideId: string; lastName: string | null }) => {
    const printed = rs.filter((r) => r.on_ballot === 1);
    const id = printed.filter((r) => r.bioguide_id === i.bioguideId);
    if (id.length === 1) return id[0]!.name;
    const s = printed.filter((r) => r.incumbent_marked === 1 && r.bioguide_id === null && surnameMatches(r.name, i.lastName));
    return s.length === 1 ? s[0]!.name : null;
  };
  const synth: BallotPerson[] = [
    { person_key: "Leg_Three_Doe_(member)", name: "Chris Doe", bioguide_id: "Z000001", incumbent_marked: 1, on_ballot: 0 },
    { person_key: "Leg_Three_Doe_(another)", name: "Pat Doe", bioguide_id: null, incumbent_marked: 1, on_ballot: 1 },
  ];
  const synthInc = { bioguideId: "Z000001", lastName: "Doe" };
  const decisive = findIncumbentOnBallot(synth, synthInc);
  check("fix (3): identity found only in the withdrawn block decides (red: the first build took the printed namesake by surname)",
    firstBuildRule(synth, synthInc) === "Pat Doe" && decisive.route === "none", `first build ${firstBuildRule(synth, synthInc)} · now ${decisive.route}`);
  // (2) The incumbent is kept off `withdrew` by either route, and a race with no
  // stored incumbent excludes no one. On a copy: FL-20 (no stored incumbent)
  // gains a primary-marked withdrawal with no bioguide, and S-AK's senator
  // (untied, underlined) is moved to the withdrawn block as a primary winner.
  const url2 = await seedCopy("rule2-750-control.db", seed);
  const now = new Date().toISOString();
  await copyWrite(url2, [
    { sql: `INSERT INTO general_ballot (race_id, person_key, name, printed_party, party, incumbent_marked, write_in, on_ballot, withdrawn, primary_marked, bioguide_id, box_prefix, read_at) VALUES ('FL-20-2026', 'Leg_Three_Withdrew', 'Leg Three Withdrew', 'D', 'D', 0, 0, 0, 1, 1, NULL, 'General election', ?)`, args: [now] },
    { sql: `UPDATE general_ballot SET on_ballot = 0, withdrawn = 1, primary_marked = 1 WHERE race_id = 'S-AK-2026' AND name = 'Daniel S. Sullivan'`, args: [] },
  ], "leg 3 perturb: a withdrawal where no incumbent is stored, and the senator withdrawn");
  const h2 = await harvestOn(url2, HEAD.harvestChallengers as unknown as Harvest, "HEAD on the withdrew copy");
  const firstBuildWithdrew = (bioguide: string | null, incumbent: string | null) => bioguide !== incumbent; // the first build's guard
  const legThree = h2.rows.find((r) => r.race_id === "FL-20-2026" && r.name === "Leg Three Withdrew");
  const senatorWd = h2.rows.find((r) => r.race_id === "S-AK-2026" && r.name === "Daniel S. Sullivan");
  check("fix (2): a race with no stored incumbent publishes its withdrawal (red: the first build's null !== null dropped it)",
    firstBuildWithdrew(null, null) === false && legThree?.status === "withdrew", `first build ${firstBuildWithdrew(null, null) ? "publishes" : "drops"} · now ${legThree ? legThree.status : "absent"}`);
  check("fix (2): an untied incumbent who withdrew is not published as a challenger who withdrew from their own seat (red: the first build's identity-only guard published him)",
    firstBuildWithdrew(null, "S001198") === true && !senatorWd, `first build ${firstBuildWithdrew(null, "S001198") ? "publishes" : "drops"} · now ${senatorWd ? `${senatorWd.status}` : "not published"}`);
}

async function leg4(seed: Seed, BASE: Harvest) {
  console.log("\n── Leg 4 · atomicity: a throw forced after the DELETE");
  // Red: today's harvest, a DELETE and an INSERT…SELECT as two calls, its INSERT forced to throw.
  const urlR = await seedCopy("atomic-red-750-control.db", seed);
  const before = await harvestOn(urlR, BASE, "BASE, rows in place");
  await copyWrite(urlR, [{ sql: `CREATE TRIGGER leg4 BEFORE INSERT ON race_candidates WHEN NEW.source_url = '${HEAD.HARVEST_SOURCE}' BEGIN SELECT RAISE(ABORT, 'leg 4 forced'); END`, args: [] }], "leg 4 red trigger");
  let redErr = "";
  try { await harvestOn(urlR, BASE, "BASE, forced to throw"); } catch (e) { redErr = String(e).slice(0, 90); }
  const c1 = copyClient(urlR, "leg 4 red read");
  const redAfter = Number((await c1.execute({ sql: `SELECT COUNT(*) AS n FROM race_candidates WHERE source_url = ?`, args: [HEAD.HARVEST_SOURCE] })).rows[0]?.n);
  c1.close();
  check("red: today's harvest loses its rows when the INSERT throws after the DELETE", redErr !== "" && redAfter === 0 && before.rows.length > 0, `threw ${JSON.stringify(redErr)} · ${before.rows.length} → ${redAfter} rows`);
  // Green: the change, one batch, its ballot INSERT forced to throw.
  const urlG = await seedCopy("atomic-green-750-control.db", seed);
  const had = await harvestOn(urlG, HEAD.harvestChallengers as unknown as Harvest, "HEAD, rows in place");
  await copyWrite(urlG, [{ sql: `CREATE TRIGGER leg4 BEFORE INSERT ON race_candidates WHEN NEW.source_url = '${HEAD.BALLOT_SOURCE}' AND NEW.race_id = 'S-AK-2026' BEGIN SELECT RAISE(ABORT, 'leg 4 forced'); END`, args: [] }], "leg 4 green trigger");
  let greenErr = "";
  try { await harvestOn(urlG, HEAD.harvestChallengers as unknown as Harvest, "HEAD, forced to throw"); } catch (e) { greenErr = String(e).slice(0, 90); }
  const c2 = copyClient(urlG, "leg 4 green read");
  const after = (await c2.execute({ sql: `SELECT race_id, name, party, bioguide_id, status, source_url FROM race_candidates WHERE source_url IN (?, ?) ORDER BY race_id, name`, args: SENTINELS })).rows.map((r) => JSON.stringify(Object.values(r)));
  c2.close();
  const same = JSON.stringify(after) === JSON.stringify(had.rows.map((r) => JSON.stringify([r.race_id, r.name, r.party, r.bioguide_id, r.status, r.source_url])));
  check("green: a ballot INSERT (the first INSERT after the DELETE) throws, and every old row is still there", greenErr !== "" && same, `threw ${JSON.stringify(greenErr)} · ${had.rows.length} rows before, ${after.length} after (${same ? "identical" : "CHANGED"})`);

  // Green, the handoff's own case: "the second INSERT". The batch is the DELETE,
  // the ballot INSERTs, then the primary-sourced INSERT…SELECT. On today's data
  // that last statement writes nothing, so a trigger on it would never fire; the
  // fallback perturbation gives it rows. The trigger fires on the LAST
  // statement, after the DELETE and every ballot INSERT have run inside the
  // batch, and every old row, of both sentinels, is still there.
  const urlS = await seedCopy("atomic-second-750-control.db", seed);
  await perturbFallback(urlS);
  const hadS = await harvestOn(urlS, HEAD.harvestChallengers as unknown as Harvest, "HEAD, rows in place (both sentinels)");
  await copyWrite(urlS, [{ sql: `CREATE TRIGGER leg4b BEFORE INSERT ON race_candidates WHEN NEW.source_url = '${HEAD.HARVEST_SOURCE}' BEGIN SELECT RAISE(ABORT, 'leg 4 forced: the second INSERT'); END`, args: [] }], "leg 4 second-INSERT trigger");
  let secondErr = "";
  try { await harvestOn(urlS, HEAD.harvestChallengers as unknown as Harvest, "HEAD, its primary-sourced INSERT forced to throw"); } catch (e) { secondErr = String(e).slice(0, 100); }
  const c3 = copyClient(urlS, "leg 4 second read");
  const afterS = (await c3.execute({ sql: `SELECT race_id, name, party, bioguide_id, status, source_url FROM race_candidates WHERE source_url IN (?, ?) ORDER BY race_id, name`, args: SENTINELS })).rows.map((r) => JSON.stringify(Object.values(r)));
  c3.close();
  const sameS = JSON.stringify(afterS) === JSON.stringify(hadS.rows.map((r) => JSON.stringify([r.race_id, r.name, r.party, r.bioguide_id, r.status, r.source_url])));
  const nPrim = hadS.rows.filter((r) => r.source_url === HEAD.HARVEST_SOURCE).length, nBal = hadS.rows.filter((r) => r.source_url === HEAD.BALLOT_SOURCE).length;
  check("green: the second INSERT (the primary-sourced one, last in the batch) throws after the DELETE and the ballot INSERTs, and every old row of both sentinels is still there",
    /second INSERT/.test(secondErr) && sameS && nPrim > 0 && nBal > 0, `threw ${JSON.stringify(secondErr)} · before ${nBal} ballot + ${nPrim} primary rows, after ${afterS.length} (${sameS ? "identical" : "CHANGED"})`);
}

async function leg5(seed: Seed) {
  console.log("\n── Leg 5 · the stub: the page's own lookup and sentence, on the copy");
  const url = await seedCopy("stub-750-control.db", seed);
  const c = copyClient(url, "leg 5 lookup");
  // The sentences are the handoff's words, written here, not read off
  // lib/race-stub.ts: "Incumbent running for re-election." only when the rule
  // finds the incumbent; otherwise "No competitive rating yet." alone.
  const RUNNING = "Incumbent running for re-election. No competitive rating yet.";
  const ALONE = "No competitive rating yet.";
  for (const [race, want, sentence, why] of [
    ["MA-02-2026", true, RUNNING, "the on-ballot capture race"],
    ["UT-04-2026", false, ALONE, "the off-ballot capture race (a box, the incumbent on no row)"],
    ["FL-10-2026", null, ALONE, "a no-box race"],
  ] as const) {
    const r = await readIncumbentOnBallot(c, race);
    const after = stubSentence(true, r.onBallot);
    check(`${race} reads ${want} (${why}), and the sentence follows`, r.onBallot === want && after === sentence, `lookup ${r.onBallot} via ${r.route} · stub before "${RUNNING}" → after "${after}"`);
  }
  c.close();
  // The red, observed rather than stated: prod's own render at ebe8813 (the
  // render gate's "before" captures), where all three pages say RUNNING.
  const beforeFile = `${ART}/shots/readings-before.json`;
  if (existsSync(beforeFile)) {
    const before = JSON.parse(readFileSync(beforeFile, "utf8")) as { base: string; readings: Record<string, { stubDom: string | null }> };
    const three = ["MA-02-2026", "UT-04-2026", "FL-10-2026"].map((id) => [id, before.readings[`${id}@1440`]?.stubDom ?? null] as const);
    check("red, observed: prod's render before the change says RUNNING on all three pages", three.every(([, s]) => s === RUNNING), `${before.base} · ${three.map(([id, s]) => `${id} "${s}"`).join(" · ")}`);
  } else console.log(`    (no ${beforeFile}: the render gate's before captures have not been taken)`);
  check("the open-seat sentence is unchanged", stubSentence(false, null) === "Open seat. Candidate filings forthcoming.", stubSentence(false, null));
  // Which capture pages stay stubs once the change's harvest runs: UT-04 gains a
  // roster (its two ballot candidates), so its "false" sentence renders only
  // where the harvest has not run on the change (the review ref's Preview, and
  // prod between the FF and the first harvest after it).
  const head = await harvestOn(url, HEAD.harvestChallengers as unknown as Harvest, "HEAD on the stub copy");
  const roster = (race: string) => head.rows.filter((r) => r.race_id === race);
  console.log(`    after the change's harvest: MA-02 ${roster("MA-02-2026").length} roster rows (still a stub) · UT-04 ${roster("UT-04-2026").length} (${roster("UT-04-2026").map((r) => `${r.name}·${r.status}·${r.bioguide_id ?? "NULL"}`).join(", ")}; a roster, not a stub) · FL-10 ${roster("FL-10-2026").length} (still a stub)`);
}

async function leg6(seed: Seed) {
  console.log("\n── Leg 6 · the tag, through the route's wrapper with a shim");
  const url = await seedCopy("tag-750-control.db", seed);
  await copyWrite(url, [{ sql: `CREATE TABLE leg750_marker (x INTEGER)`, args: [] }], "leg 6 marker");
  process.env.TURSO_DATABASE_URL = url;
  delete process.env.TURSO_AUTH_TOKEN;
  const { getDb } = await import("@/lib/db");
  const { wrapCronRoute } = await import("@/lib/cron-log");
  const where = await getDb().execute(`SELECT COUNT(*) AS n FROM sqlite_master WHERE name = 'leg750_marker'`);
  if (Number(where.rows[0]?.n) !== 1) throw new Error("refused: getDb() does not point at the leg 6 copy");
  console.log(`    getDb() sees the copy's marker`);
  const byUrl = new Map(man.map((m) => [m.url, m.file]));
  const challenge = "<html><body>Checking your browser</body></html>";
  const shim = (walled: boolean): IO => {
    let t = Date.parse("2026-09-28T12:20:00Z");
    return {
      now: () => t,
      sleep: async (ms) => { t += ms; },
      get: async (u): Promise<Raw> => {
        t += 700;
        if (walled) return { kind: "response", status: 202, body: challenge };
        const f = byUrl.get(u);
        return f ? { kind: "response", status: 200, body: gunzipSync(readFileSync(f)).toString("utf8") } : { kind: "response", status: 404, body: "not found" };
      },
    };
  };
  for (const [label, walled, wantCalls] of [["a tick that wrote", false, 1], ["a tick that wrote nothing (first request walled)", true, 0]] as const) {
    const calls: string[] = [];
    const out = await wrapCronRoute("/api/cron/general-ballot", () => generalBallotTick(getDb(), shim(walled), (tag) => calls.push(tag)), { softTimeoutMs: 290_000 });
    const pl = (out.body as { payload?: { verdicts?: Record<string, number>; stop?: string } }).payload;
    check(`${label} expires general-ballot ${wantCalls === 1 ? "once" : "never"}, and never races`, calls.length === wantCalls && !calls.includes("races") && calls.every((c) => c === "general-ballot"), `http ${out.httpStatus} · READ ${pl?.verdicts?.READ} · stop ${pl?.stop} · expired ${JSON.stringify(calls)}`);
  }
  const lastRun = async () => (await getDb().execute(`SELECT id, status, error_message FROM cron_runs ORDER BY id DESC LIMIT 1`)).rows[0];

  // A tick that throws part-way: the third race's write batch fails after two
  // READs have committed. The tick expires general-ballot once, before the
  // error propagates (the review's second round: expiring only on return left
  // those READs behind a stale page for up to the 24h revalidate).
  {
    const calls: string[] = [];
    let writes = 0;
    const db = getDb();
    const failing = new Proxy(db, {
      get(t, p) {
        if (p === "batch") {
          return async (stmts: InStatement[], mode?: "write" | "read" | "deferred") => {
            if (mode === "write" && ++writes === 3) throw new Error("leg 6 forced: the third race's write");
            return t.batch(stmts, mode);
          };
        }
        const v = Reflect.get(t, p) as unknown;
        return typeof v === "function" ? (v as (...a: unknown[]) => unknown).bind(t) : v;
      },
    });
    const out = await wrapCronRoute("/api/cron/general-ballot", () => generalBallotTick(failing, shim(false), (tag) => calls.push(tag)), { softTimeoutMs: 290_000 });
    const row = await lastRun();
    check("a tick that throws part-way (two READs committed) still expires general-ballot, once, and records the error",
      out.httpStatus !== 200 && row?.status === "error" && writes === 3 && JSON.stringify(calls) === JSON.stringify(["general-ballot"]),
      `http ${out.httpStatus} · cron_runs #${row?.id} ${row?.status} ${JSON.stringify(String(row?.error_message ?? "").slice(0, 60))} · write batches ${writes} · expired ${JSON.stringify(calls)}`);
  }

  // The shipped flush, not an injected one. The route calls generalBallotTick
  // with no third argument, so it gets the default, expireTag; outside a Next
  // request revalidateTag throws an invariant that names its tag, and that
  // message is the proof the default reaches revalidateTag("general-ballot").
  // The red: HO 749's tick (ebe8813) on the same shim writes READs, returns a
  // success row, and reaches no revalidateTag at all.
  {
    const routeSrc = readFileSync("app/api/cron/general-ballot/route.ts", "utf8");
    const routeUsesDefault = /generalBallotTick\(getDb\(\)\)/.test(routeSrc);
    const out = await wrapCronRoute("/api/cron/general-ballot", () => generalBallotTick(getDb(), shim(false)), { softTimeoutMs: 290_000 });
    const row = await lastRun();
    check("the shipped default flush reaches revalidateTag(\"general-ballot\") (the route passes no flush of its own)",
      routeUsesDefault && row?.status === "error" && /revalidateTag general-ballot/.test(String(row?.error_message ?? "")),
      `route calls generalBallotTick(getDb()): ${routeUsesDefault} · http ${out.httpStatus} · cron_runs #${row?.id} ${row?.status} ${JSON.stringify(String(row?.error_message ?? "").slice(0, 80))}`);
    const baseTick = await loadBaseTick();
    const outB = await wrapCronRoute("/api/cron/general-ballot", () => baseTick(getDb(), shim(false)), { softTimeoutMs: 290_000 });
    const rowB = await lastRun();
    const plB = (outB.body as { payload?: { verdicts?: Record<string, number> } }).payload;
    check("red: HO 749's tick writes READs and flushes nothing (a success row, no revalidateTag reached)",
      outB.httpStatus === 200 && rowB?.status === "success" && (plB?.verdicts?.READ ?? 0) > 0,
      `http ${outB.httpStatus} · cron_runs #${rowB?.id} ${rowB?.status} · READ ${plB?.verdicts?.READ}`);
  }
}

// HO 749's tick, as it shipped at ebe8813, for leg 6's red: its relative
// imports repointed at the working tree's unchanged modules.
async function loadBaseTick(): Promise<(db: Client, io: IO) => Promise<{ payload: unknown }>> {
  let src = execFileSync("git", ["show", `${BASE_SHA}:lib/general-ballot.ts`], { encoding: "utf8" });
  for (const m of ["./primary-candidates-scrape", "./states"]) {
    if (src.split(`from "${m}"`).length !== 2) throw new Error(`base tick: import ${m} must occur exactly once`);
    src = src.replace(`from "${m}"`, `from "@/lib/${m.slice(2)}"`);
  }
  if (/from "\.\//.test(src)) throw new Error("base tick: an unrepointed relative import remains");
  const file = path.resolve(ART, `general-ballot-base-${BASE_SHA}.ts`);
  writeFileSync(file, src);
  return ((await import(pathToFileURL(file).href)) as { generalBallotTick: (db: Client, io: IO) => Promise<{ payload: unknown }> }).generalBallotTick;
}

async function main(): Promise<number> {
  mkdirSync(ART, { recursive: true });
  const only = process.argv.includes("--leg") ? Number(process.argv[process.argv.indexOf("--leg") + 1]) : null;
  const run = (n: number) => only === null || only === n;
  console.log(`=== HO 750 legs · ${new Date().toISOString()} · BASE = git show ${BASE_SHA}:lib/harvest-challengers.ts · HEAD = the working tree ===`);
  const fp0 = await prodFingerprint();
  console.log(`prod fingerprint before: ${fp0}`);
  const seed = await readSeed();
  console.log(`seed read from prod (SELECT only): ${Object.entries(seed).map(([k, v]) => `${k} ${v.length}`).join(" · ")}`);
  const BASE = await loadBase();
  if (run(1)) await leg1(seed, BASE);
  if (run(2)) await leg2(seed, BASE);
  if (run(3)) await leg3(seed, BASE);
  if (run(4)) await leg4(seed, BASE);
  if (run(5)) await leg5(seed);
  if (run(6)) await leg6(seed); // last: it repoints getDb() at a copy
  const fp1 = await prodFingerprint();
  check("prod reads the same before and after (nothing here reached it)", fp0 === fp1, `before ${fp0} · after ${fp1}`);
  console.log(`\nLEGS: ${failures === 0 ? "ALL GREEN" : `${failures} FAILED`}`);
  return failures === 0 ? 0 : 1;
}
main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(2);
  });
