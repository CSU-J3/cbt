// HO 760 legs: the seed keeps history, the ballot decides the field (ruled C), on `file:` copies seeded
// whole from prod, each leg red first against HEAD's code. Nothing renders differently, so every leg is
// in process (the harvest) or a child process (the seed script), with no server.
//   npx tsx scripts/diagnostic/seed-keeps-history-legs-760.ts --label L
//
// The copies, all from one seed (the real migrate, 13 tables read whole from prod):
//   head      HEAD's harvest (lib/harvest-challengers.ts at 2bce248, loaded with git cat-file)
//   new       the tree's harvest, then the tree's again (leg 6)
//   seedhead  the tree's harvest, then HEAD's scripts/seed-races.ts (leg 5's red)
//   seednew   the tree's harvest, then the tree's seed-races.ts, then the tree's harvest (legs 5, 6)
//   1 S-GA     Dooley gone; Collins from the ballot (won_primary: he is marked in a kept primary box,
//              the runoff, where the handoff read nominee); Carter's curated withdrew row kept
//   2 S-ME     Troy Dale Jackson from the ballot (nominee), Mills and Platner kept as curated withdrew,
//              Collins (the incumbent) excluded
//   3 NJ-07, PA-10, AK-AL  the majors from the ballot under the same names, the withdrew rows kept,
//              AK-AL's four unchanged in content; NJ-07's Seamus O'Toole (O) arrives as on_ballot
//   4 the table  exactly STEP 0's delta: the 8 curated rows that are not withdrew go, the 8 planned ballot
//              rows arrive, and every other row is identical to HEAD's harvest; the payload names them, and
//              AK-AL's Williams (the ballot's withdrew row) is counted in curatedHistoryKept, so
//              ballotIgnored reads 0 (the architect, on the flags)
//   5 seed      the tree's seed-races writes no non-withdrew entry and prints the 8 as retired, and
//              writes the 7 withdrew entries as before; HEAD's writes the non-withdrew ones (the red)
//   6 idempotence  a second harvest changes nothing, and neither does a harvest after the tree's seed
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed and a fingerprint before and after the
// run. Copies are `file:${abs}` from paths ending -760-legs.db; children get that URL with
// TURSO_AUTH_TOKEN="" (not deleted: dotenv refills a missing key). Every printed line passes
// redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const HEAD_SHA = "2bce248";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/760-artifacts");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const TABLES = ["races", "members", "member_ids", "race_ratings", "race_candidates", "kalshi_odds", "polymarket_odds", "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads"];
const FIVE = ["S-GA-2026", "S-ME-2026", "NJ-07-2026", "PA-10-2026", "AK-AL-2026"];
const CURATED = "curated";
// STEP 0's prediction (docs/handoffs/760-artifacts/step0-760.txt), as (race_id, name, party, status).
const RETIRED = [
  ["AK-AL-2026", "Bill Hill", "I", "advanced"], ["AK-AL-2026", "Eric Hafner", "D", "advanced"], ["AK-AL-2026", "Jim McDermott", "L", "advanced"],
  ["NJ-07-2026", "Rebecca Bennett", "D", "won_primary"], ["PA-10-2026", "Janelle Stelson", "D", "won_primary"],
  ["S-GA-2026", "Derek Dooley", "R", "running"], ["S-GA-2026", "Mike Collins", "R", "running"], ["S-ME-2026", "Troy Jackson", "D", "nominee"],
];
const ARRIVING = [
  ["S-GA-2026", "Mike Collins", "R", "won_primary"], ["S-ME-2026", "Troy Dale Jackson", "D", "nominee"],
  ["NJ-07-2026", "Rebecca Bennett", "D", "won_primary"], ["NJ-07-2026", "Seamus O'Toole", "O", "on_ballot"],
  ["PA-10-2026", "Janelle Stelson", "D", "won_primary"],
  ["AK-AL-2026", "Bill Hill", "I", "advanced"], ["AK-AL-2026", "Eric Hafner", "D", "advanced"], ["AK-AL-2026", "Jim McDermott", "L", "advanced"],
];
const KEPT = [["AK-AL-2026", "John Brendan Williams"], ["NJ-07-2026", "Brian Varela"], ["NJ-07-2026", "Michael Roth"], ["NJ-07-2026", "Tina Shah"], ["S-GA-2026", "Buddy Carter"], ["S-ME-2026", "Graham Platner"], ["S-ME-2026", "Janet Mills"]];

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
const say = (s: string) => console.log(redactSecrets(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const check = (leg: string, label: string, ok: boolean, detail: string) => {
  say(`  ${ok ? "PASS" : "FAIL"}  [leg ${leg}] ${label}: ${detail}`);
  if (ok) passes++; else fails++;
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
async function prodFingerprint(): Promise<string> {
  const db = prodClient();
  const read = reader(db);
  const hash = async (q: string) => sha(JSON.stringify((await read(q)).rows.map((r) => Object.values(r))));
  const fp = {
    rc: await hash(`SELECT * FROM race_candidates ORDER BY race_id, name`),
    gb: await hash(`SELECT * FROM general_ballot ORDER BY race_id, person_key`),
    reads: await hash(`SELECT * FROM general_ballot_reads ORDER BY race_id`),
    pc: await hash(`SELECT * FROM primary_candidates ORDER BY id`),
    races: await hash(`SELECT * FROM races ORDER BY id`),
    schema: await hash(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`),
    runs: (await read(`SELECT route, MAX(id) AS id FROM cron_runs WHERE route IN ('/api/cron/race-challengers', '/api/cron/general-ballot', '/api/cron/primaries') GROUP BY route ORDER BY route`)).rows.map((r) => `${r.route}#${r.id}`),
  };
  db.close();
  return JSON.stringify(fp);
}
async function prodUntouched(fp0: string, t0: string) {
  const fp1 = await prodFingerprint();
  if (fp0 === fp1) { check("*", "prod untouched", true, "fingerprints equal"); return; }
  const a = JSON.parse(fp0) as Record<string, unknown>, b = JSON.parse(fp1) as Record<string, unknown>;
  const changed = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const db = prodClient();
  const runs = (await reader(db)(`SELECT id, route, started_at, status FROM cron_runs WHERE started_at >= ? ORDER BY id`, [t0])).rows.map((r) => ({ route: String(r.route), at: String(r.started_at), id: Number(r.id) }));
  db.close();
  const by = (route: string) => runs.some((r) => r.route === route);
  const explained: Record<string, boolean> = { rc: by("/api/cron/race-challengers"), gb: by("/api/cron/general-ballot"), reads: by("/api/cron/general-ballot"), pc: by("/api/cron/primaries"), races: false, runs: runs.length > 0, schema: false };
  const unexplained = changed.filter((k) => !explained[k]);
  check("*", "prod untouched: every difference is a prod cron's own run in the window", unexplained.length === 0, `changed ${changed.join(", ")} · runs in the window: ${runs.map((r) => `${r.route}#${r.id} ${r.at}`).join("; ") || "none"}${unexplained.length ? ` · UNEXPLAINED ${unexplained.join(", ")}` : ""}`);
}

// ── copies ──────────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-760-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-760-legs.db")) throw new Error(`refused: a copy must be a *-760-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
function childEnv(url: string): NodeJS.ProcessEnv {
  if (!url.startsWith("file:")) throw new Error("refused: children get file: only");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url };
  env.TURSO_AUTH_TOKEN = "";
  return env;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
// HEAD's file from git, into scratch, its relative imports pointed at the tree's modules.
function headFile(repoPath: string, out: string): string {
  const src = execFileSync("git", ["cat-file", "-p", `${HEAD_SHA}:${repoPath}`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 16 * 1024 * 1024 });
  const dst = path.join(DIR, out);
  writeFileSync(dst, src.replace(/from "\.\/([^"]+)"/g, 'from "@/lib/$1"').replace(/from "\.\.\/([^"]+)"/g, 'from "@/$1"'));
  return dst;
}
type Harvest = { harvestChallengers: (db: Client) => Promise<Record<string, unknown>> };
type Row = { race_id: string; name: string; party: string | null; bioguide_id: string | null; status: string | null; source: string; printed_party: string | null };
async function snapshot(url: string): Promise<Row[]> {
  return withDb(url, async (db) => (await db.execute(`SELECT race_id, name, party, bioguide_id, status, source_url, printed_party FROM race_candidates ORDER BY race_id, name`)).rows.map((r) => ({
    race_id: String(r.race_id), name: String(r.name), party: r.party == null ? null : String(r.party), bioguide_id: r.bioguide_id == null ? null : String(r.bioguide_id),
    status: r.status == null ? null : String(r.status),
    source: String(r.source_url ?? "").startsWith("harvest:") ? String(r.source_url) : CURATED,
    printed_party: r.printed_party == null ? null : String(r.printed_party),
  })));
}
const tup = (r: Row) => JSON.stringify([r.race_id, r.name, r.party, r.bioguide_id, r.status, r.source, r.printed_party]);
const raceRows = (rows: Row[], id: string) => rows.filter((r) => r.race_id === id);
const show = (rows: Row[]) => rows.map((r) => `${r.name} ${r.party ?? "-"} ${r.status} [${r.source === CURATED ? "curated" : r.source.replace("harvest:", "")}]${r.printed_party ? ` «${r.printed_party}»` : ""}`).join(" · ");

async function seedCopies() {
  mkdirSync(DIR, { recursive: true });
  const tpl = copyPath("template");
  if (existsSync(tpl)) rmSync(tpl);
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: childEnv(copyUrl(tpl)), encoding: "utf8" });
  if (mig.status !== 0) throw new Error(`migrate against the template failed: ${redactSecrets((mig.stderr || mig.stdout).slice(-600))}`);
  const prod = prodClient();
  const read = reader(prod);
  const counts: string[] = [];
  await withDb(copyUrl(tpl), async (db) => {
    await db.execute("PRAGMA foreign_keys = OFF");
    for (const t of TABLES) {
      const cols = new Set((await db.execute(`PRAGMA table_info(${t})`)).rows.map((r) => String(r.name)));
      const rows = (await read(`SELECT * FROM ${t}`)).rows;
      const use = rows.length ? Object.keys(rows[0]!).filter((c) => cols.has(c)) : [];
      const stmts: InStatement[] = [{ sql: `DELETE FROM ${t}`, args: [] }];
      for (const r of rows) stmts.push({ sql: `INSERT INTO ${t} (${use.join(",")}) VALUES (${use.map(() => "?").join(",")})`, args: use.map((c) => (r as Record<string, unknown>)[c] as never) });
      for (let i = 0; i < stmts.length; i += 500) await db.batch(stmts.slice(i, i + 500), "write");
      counts.push(`${t} ${rows.length}`);
    }
  });
  prod.close();
  for (const kind of ["head", "new", "seedhead", "seednew"]) copyFileSync(tpl, copyPath(kind));
  say(`template: the real scripts/migrate.ts against file:, seeded whole from prod · ${counts.join(" · ")} · copies head, new, seedhead, seednew`);
}
function runSeed(script: string, kind: string): { code: number | null; out: string } {
  const r = spawnSync(process.execPath, [TSX, script], { env: childEnv(copyUrl(copyPath(kind))), encoding: "utf8" });
  return { code: r.status, out: redactSecrets(`${r.stdout}\n${r.stderr}`) };
}

async function main() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim().slice(0, 10);
  say(`=== HO 760 legs · ${LABEL} · ${new Date().toISOString()} · tree ${tree} · harvest ${blob("lib/harvest-challengers.ts")} seed ${blob("scripts/seed-races.ts")} seedjson ${blob("data/races-seed.json")} · driver ${blob("scripts/diagnostic/seed-keeps-history-legs-760.ts")} ===`);
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();
  await seedCopies();
  const head = (await import(pathToFileURL(headFile("lib/harvest-challengers.ts", "head-harvest-760.ts")).href)) as Harvest;
  const treeH = (await import("@/lib/harvest-challengers")) as Harvest;
  const seeded = await snapshot(copyUrl(copyPath("head")));
  const pHead = await withDb(copyUrl(copyPath("head")), (db) => head.harvestChallengers(db));
  const pNew = await withDb(copyUrl(copyPath("new")), (db) => treeH.harvestChallengers(db));
  const H = await snapshot(copyUrl(copyPath("head")));
  const N = await snapshot(copyUrl(copyPath("new")));
  writeFileSync(path.join(ART, `payloads-${LABEL}.json`), JSON.stringify({ head: pHead, tree: pNew }, null, 1));
  say(`  seeded ${seeded.length} rows · HEAD's harvest → ${H.length} · the tree's → ${N.length}`);
  for (const id of FIVE) say(`  ${id}\n    HEAD: ${show(raceRows(H, id))}\n    tree: ${show(raceRows(N, id))}`);
  say(`  HEAD's payload: curatedDivergence ${JSON.stringify(pHead.curatedDivergence)} · ballotRaces ${pHead.ballotRaces} · planned ${pHead.ballotPlanned} · ignored ${pHead.ballotIgnored} · onBallot ${JSON.stringify(pHead.onBallot)}`);
  say(`  the tree's payload: curatedRetired ${JSON.stringify(pNew.curatedRetired)} · curatedHistoryKept ${JSON.stringify(pNew.curatedHistoryKept)} · ballotRaces ${pNew.ballotRaces} · planned ${pNew.ballotPlanned} · ignored ${pNew.ballotIgnored} · onBallot ${JSON.stringify(pNew.onBallot)} · cleared ${pNew.cleared} · inserted ${pNew.inserted}`);

  const find = (rows: Row[], id: string, name: string) => rows.find((r) => r.race_id === id && r.name === name) ?? null;
  const has = (rows: Row[], id: string, name: string, status: string, source: string) => { const r = find(rows, id, name); return !!r && r.status === status && r.source === source; };
  const BAL = "harvest:general_ballot";
  for (const [tag, rows] of [["red: HEAD", H], ["green: the tree", N]] as const) {
    // leg 1
    check("1", `${tag} · S-GA: Dooley gone, Collins from the ballot (won_primary), Carter's curated withdrew row kept`, !find(rows, "S-GA-2026", "Derek Dooley") && has(rows, "S-GA-2026", "Mike Collins", "won_primary", BAL) && has(rows, "S-GA-2026", "Buddy Carter", "withdrew", CURATED) && raceRows(rows, "S-GA-2026").length === 2, show(raceRows(rows, "S-GA-2026")));
    // leg 2
    check("2", `${tag} · S-ME: Troy Dale Jackson from the ballot (nominee), Mills and Platner curated withdrew, the incumbent Collins not listed`, has(rows, "S-ME-2026", "Troy Dale Jackson", "nominee", BAL) && !find(rows, "S-ME-2026", "Troy Jackson") && has(rows, "S-ME-2026", "Janet Mills", "withdrew", CURATED) && has(rows, "S-ME-2026", "Graham Platner", "withdrew", CURATED) && !rows.some((r) => r.race_id === "S-ME-2026" && /Collins/.test(r.name)) && raceRows(rows, "S-ME-2026").length === 3, show(raceRows(rows, "S-ME-2026")));
    // leg 3
    check("3", `${tag} · NJ-07: Bennett from the ballot (won_primary), Roth, Shah and Varela curated withdrew, and Seamus O'Toole (O) on_ballot`, has(rows, "NJ-07-2026", "Rebecca Bennett", "won_primary", BAL) && ["Michael Roth", "Tina Shah", "Brian Varela"].every((n) => has(rows, "NJ-07-2026", n, "withdrew", CURATED)) && has(rows, "NJ-07-2026", "Seamus O'Toole", "on_ballot", BAL) && raceRows(rows, "NJ-07-2026").length === 5, show(raceRows(rows, "NJ-07-2026")));
    check("3", `${tag} · PA-10: Stelson from the ballot (won_primary), alone`, has(rows, "PA-10-2026", "Janelle Stelson", "won_primary", BAL) && raceRows(rows, "PA-10-2026").length === 1, show(raceRows(rows, "PA-10-2026")));
    const ak = raceRows(rows, "AK-AL-2026");
    const akSeed = raceRows(seeded, "AK-AL-2026");
    const content = (xs: Row[]) => JSON.stringify(xs.map((r) => [r.name, r.party, r.bioguide_id, r.status, r.printed_party]).sort());
    check("3", `${tag} · AK-AL: Hill, Hafner and McDermott from the ballot (advanced), Williams curated withdrew, the four unchanged in content`, ["Bill Hill", "Eric Hafner", "Jim McDermott"].every((n) => has(rows, "AK-AL-2026", n, "advanced", BAL)) && has(rows, "AK-AL-2026", "John Brendan Williams", "withdrew", CURATED) && content(ak) === content(akSeed), show(ak));
  }
  // leg 4: the whole table
  {
    const hSet = new Set(H.map(tup)), nSet = new Set(N.map(tup));
    const gone = H.filter((r) => !nSet.has(tup(r)));
    const came = N.filter((r) => !hSet.has(tup(r)));
    const want = (xs: string[][], src: string) => xs.map(([race, name, party, status]) => `${race}|${name}|${party}|${status}|${src}`).sort();
    const got = (xs: Row[]) => xs.map((r) => `${r.race_id}|${r.name}|${r.party}|${r.status}|${r.source === CURATED ? CURATED : r.source}`).sort();
    const outside = N.filter((r) => !FIVE.includes(r.race_id));
    const outsideH = H.filter((r) => !FIVE.includes(r.race_id));
    check("4", "the tree against HEAD: exactly STEP 0's 8 curated rows gone (not withdrew)", JSON.stringify(got(gone)) === JSON.stringify(want(RETIRED, CURATED)), got(gone).join(" · "));
    check("4", "the tree against HEAD: exactly STEP 0's 8 ballot rows arrived", JSON.stringify(got(came)) === JSON.stringify(want(ARRIVING, BAL)), got(came).join(" · "));
    check("4", "every row outside the five races identical to HEAD's harvest (name, party, bioguide, status, source, print)", outside.length === outsideH.length && outside.every((r) => hSet.has(tup(r))), `${outside.length} rows against HEAD's ${outsideH.length}`);
    check("4", "the table's size unchanged (928 on prod at STEP 0): − 8 + 8", N.length === H.length, `${H.length} → ${N.length}`);
    const kept = N.filter((r) => r.source === CURATED).map((r) => `${r.race_id}|${r.name}`).sort();
    check("4", "the curated rows left are the 7 withdrew rows, and nothing else", JSON.stringify(kept) === JSON.stringify(KEPT.map(([a, b]) => `${a}|${b}`).sort()) && N.filter((r) => r.source === CURATED).every((r) => r.status === "withdrew"), kept.join(" · "));
    const retiredNamed = (pNew.curatedRetired as string[]) ?? [];
    const keptNamed = (pNew.curatedHistoryKept as string[]) ?? [];
    check("4", "the payload names the 8 retired rows and the 7 kept, AK-AL's Williams counted there as also the ballot's withdrew row, and ballotIgnored reads 0 (the architect, on the flags)", retiredNamed.length === 8 && keptNamed.length === 7 && RETIRED.every(([race, name, , status]) => retiredNamed.includes(`${race}: ${name} (${status})`)) && keptNamed.includes("AK-AL-2026: John Brendan Williams (withdrew; also the ballot's withdrew row)") && keptNamed.filter((k) => k.includes("also the ballot's")).length === 1 && pNew.ballotIgnored === 0 && !("curatedDivergence" in pNew), `retired ${retiredNamed.length} · kept ${keptNamed.length} (${keptNamed.filter((k) => k.includes("also the ballot's")).join("; ")}) · ignored ${pNew.ballotIgnored}`);
    check("4", "the planned rows are HEAD's plus the five races' 8 arrivals, and nothing planned is ignored: planned = HEAD's planned + 8", pNew.ballotPlanned === (pHead.ballotPlanned as number) + 8 && pNew.ballotIgnored === 0, `HEAD planned ${pHead.ballotPlanned} ignored ${pHead.ballotIgnored} · the tree planned ${pNew.ballotPlanned} ignored ${pNew.ballotIgnored}`);
    check("4", "HEAD's red: HEAD's payload still names S-GA's divergence, and HEAD keeps all 15 curated rows", Array.isArray(pHead.curatedDivergence) && H.filter((r) => r.source === CURATED).length === 15, `${JSON.stringify(pHead.curatedDivergence)} · curated ${H.filter((r) => r.source === CURATED).length}`);
  }
  // leg 6a: a second harvest changes nothing
  {
    const p2 = await withDb(copyUrl(copyPath("new")), (db) => treeH.harvestChallengers(db));
    const N2 = await snapshot(copyUrl(copyPath("new")));
    check("6", "a second harvest on the tree's copy: the table identical, nothing retired, 7 kept, ballotIgnored 0 (the steady state)", JSON.stringify(N2.map(tup)) === JSON.stringify(N.map(tup)) && (p2.curatedRetired as string[]).length === 0 && (p2.curatedHistoryKept as string[]).length === 7 && p2.ballotIgnored === 0, `rows ${N2.length} · retired ${JSON.stringify(p2.curatedRetired)} · kept ${(p2.curatedHistoryKept as string[]).length} · ignored ${p2.ballotIgnored}`);
  }
  // leg 5: seed:races, HEAD's (red) and the tree's, each on a copy the tree's harvest ran on
  {
    for (const kind of ["seedhead", "seednew"]) await withDb(copyUrl(copyPath(kind)), (db) => treeH.harvestChallengers(db));
    const before = await snapshot(copyUrl(copyPath("seednew")));
    const stampOf = async (kind: string) => withDb(copyUrl(copyPath(kind)), async (db) => new Map((await db.execute(`SELECT race_id, name, updated_at FROM race_candidates`)).rows.map((r) => [`${r.race_id}|${r.name}`, String(r.updated_at)])));
    const stamps0 = await stampOf("seednew");
    const headSeed = runSeed(headFile("scripts/seed-races.ts", "head-seed-races-760.ts"), "seedhead");
    const treeSeed = runSeed("scripts/seed-races.ts", "seednew");
    writeFileSync(path.join(ART, `seed-out-${LABEL}.txt`), `HEAD's seed-races (exit ${headSeed.code}):\n${headSeed.out}\n\nthe tree's seed-races (exit ${treeSeed.code}):\n${treeSeed.out}\n`);
    const SH = await snapshot(copyUrl(copyPath("seedhead")));
    const SN = await snapshot(copyUrl(copyPath("seednew")));
    const stamps1 = await stampOf("seednew");
    const retiredPrinted = RETIRED.filter(([race, name]) => treeSeed.out.includes(`${race}: ${name} (`) && treeSeed.out.includes("retired by HO 760"));
    check("5", "red: HEAD's seed-races writes the non-withdrew entries back (Dooley running, Troy Jackson nominee)", headSeed.code === 0 && has(SH, "S-GA-2026", "Derek Dooley", "running", CURATED) && has(SH, "S-ME-2026", "Troy Jackson", "nominee", CURATED), show(raceRows(SH, "S-GA-2026")));
    check("5", "green: the tree's seed-races writes no non-withdrew entry: the table's rows equal the harvest's", treeSeed.code === 0 && JSON.stringify(SN.map(tup)) === JSON.stringify(before.map(tup)), `${before.length} → ${SN.length} rows`);
    check("5", "green: it prints the 8 as retired by HO 760, and its summary counts them", retiredPrinted.length === 8 && /retired_by_ho760=8/.test(treeSeed.out) && /candidates=7\b/.test(treeSeed.out), `${retiredPrinted.length} of 8 printed · ${(treeSeed.out.match(/Done\.[^\n]*/) ?? [""])[0]}`);
    const rewritten = KEPT.filter(([a, b]) => stamps1.get(`${a}|${b}`) !== stamps0.get(`${a}|${b}`));
    check("5", "green: the 7 withdrew entries write as before (each row re-stamped by the seed, content unchanged)", rewritten.length === 7, `${rewritten.length} of 7 re-stamped`);
    // leg 6b: the harvest after the tree's seed changes nothing
    await withDb(copyUrl(copyPath("seednew")), (db) => treeH.harvestChallengers(db));
    const SN2 = await snapshot(copyUrl(copyPath("seednew")));
    check("6", "the tree's harvest after the tree's seed: the table identical to the harvest's before the seed", JSON.stringify(SN2.map(tup)) === JSON.stringify(before.map(tup)), `${SN2.length} rows`);
  }
  await prodUntouched(fp0, t0);
  say(`${LABEL}: ${passes} PASS · ${fails} FAIL`);
}
main().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
