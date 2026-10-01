// HO 765 legs: the PAC-target rungs read the ballot first where a race has a `box` read. On `file:` copies
// seeded from prod, red first against HEAD (b5a6f82).
//   npx tsx scripts/diagnostic/pac-ballot-legs-765.ts --seed --label L    the copies
//   npx tsx scripts/diagnostic/pac-ballot-legs-765.ts --legs --label L    legs 1-6
//
// The copies, one template (the tree's migrate, the 9 tables getPacIeSpending reads, whole from prod):
//   main   untouched: leg 5
//   clock  the plant copy, plus LA-02's jungle contest resulted (Carter `running` 30.0, another `winner`),
//          NY-16's Pat Replacement marked, and TX-23's Herrera and one other row marked (a runoff's two):
//          the caller's clock (clockNowMs) and rung 0's why past election day
//   plant  four planted cases, one per leg, and the review's namesake:
//     1  MD-05's Adrian Boafo (a live S target, `winner` of the decided D primary): his ballot row moved
//        to the withdrawn block (on_ballot 0, withdrawn 1), as if he withdrew after winning
//     2  NY-16 (box): "Pat Replacement" printed on the ballot, a `nominee` roster row as the ballot harvest
//        writes it, no contest row; a PAC row targets "REPLACEMENT, PAT"
//     3  TX-18's Al Green, unmarked in the decided D runoff and absent from the ballot; a PAC row targets
//        "GREEN, AL"
//     4  LA-02's Troy Carter (a `no_box` race, the Nov 3 jungle not yet resulted); a PAC row targets
//        "CARTER, TROY", and a ballot row printing him is planted although the race's read is no_box
//     1b S-MI: an independent "Joe Stevens" printed on the ballot beside the target Haley Stevens, who
//        lost the D primary (the review's namesake case)
//
//   1 withdrew after winning  red: HEAD reads Boafo `active` (winner); the tree `withdrew`, from the ballot
//   1b namesake               a printed "Joe Stevens" does not speak for Haley Stevens: both read `lost`
//                             from the contest (the first-name check); the pure function shows the check
//                             is what declines (a printed "Haley Stevens" would read `active`)
//   2 replacement nominee     both `active`; HEAD's why is the roster's, the tree's the ballot's; with the
//                             clock past election day the tree still reads `active`, its why from the marks
//   2c the clock              on the clock copy at 2026-11-04 the tree reads LA-02's Carter `lost` (the
//                             caller's clockNowMs reaches the contest rung) where HEAD reads `unknown`; the
//                             why reads decided (one mark) for NY-16 and a runoff (two) for TX-23
//   3 runoff loser            both `lost`, from the contest
//   4 no box                  both read exactly the same (the planted printed row is not consulted)
//   5 the live set            getPacIeSpending HEAD and tree over the untouched copy: STEP 0's one change
//                             (TX-23's Herrera, unknown -> active) and no other; every tree why names its rung
//   6 the chore               the repair header names person_key, bioguide_id and updated_at
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed and a fingerprint before and after every
// mode. Copies are `file:${abs}` from paths ending -765-legs.db; children get that URL with
// TURSO_AUTH_TOKEN="" and refuse any other. Every printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const HEAD_SHA = "b5a6f82";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const CWD = path.join(DIR, "cwd-765");
const ART = path.resolve("docs/handoffs/765-artifacts");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const TSCONFIG = path.resolve("tsconfig.json");
const CHILD = path.resolve("scripts/diagnostic/pac-ballot-child-765.ts");
const STUB = pathToFileURL(path.resolve("scripts/diagnostic/next-cache-stub-757.mjs")).href;
const TABLES = ["races", "members", "member_ids", "pac_ie_spending", "primaries", "primary_candidates", "race_candidates", "general_ballot", "general_ballot_reads"];
const AFTER_ELECTION = "2026-11-04T18:00:00Z";

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

function prodClient(): Client {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("libsql://")) throw new Error("reading prod needs the prod libsql:// URL in .env");
  return createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
}
const reader = (db: Client) => (sql: string) => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("prod is read-only here");
  return db.execute(sql);
};
async function prodFingerprint(): Promise<string> {
  const db = prodClient();
  const read = reader(db);
  const hash = async (q: string) => sha(JSON.stringify((await read(q)).rows.map((r) => Object.values(r))));
  const fp = { pac: await hash(`SELECT * FROM pac_ie_spending ORDER BY id`), gb: await hash(`SELECT * FROM general_ballot ORDER BY race_id, person_key`), pc: await hash(`SELECT * FROM primary_candidates ORDER BY id`), rc: await hash(`SELECT * FROM race_candidates ORDER BY race_id, name`), gbr: await hash(`SELECT * FROM general_ballot_reads ORDER BY race_id`), races: await hash(`SELECT * FROM races ORDER BY id`), primaries: await hash(`SELECT * FROM primaries ORDER BY id`), schema: await hash(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`) };
  db.close();
  return JSON.stringify(fp);
}
async function prodUntouched(what: string, fp0: string) {
  // One retry, logged: after the legs' idle minutes the first read can meet a pooled connection the
  // server has closed ("fetch failed"), which says nothing about prod's rows.
  const fp1 = await prodFingerprint().catch(async (e) => {
    say(`  (prod fingerprint read failed once: ${String(e?.message ?? e)}; retrying)`);
    await sleep(2000);
    return prodFingerprint();
  });
  check("*", `prod untouched (${what})`, fp0 === fp1, fp0 === fp1 ? "fingerprints equal" : `${fp0} → ${fp1}`);
}
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-765-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-765-legs.db")) throw new Error(`refused: a copy must be a *-765-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
function headFile(repoPath: string, out: string, post: (s: string) => string = (s) => s): string {
  const src = execFileSync("git", ["cat-file", "-p", `${HEAD_SHA}:${repoPath}`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 32 * 1024 * 1024 });
  const dst = path.join(DIR, out);
  writeFileSync(dst, post(src.replace(/from "\.\/([^"]+)"/g, (_, m: string) => `from "@/lib/${m}"`).replace(/from "\.\.\/([^"]+)"/g, (_, m: string) => `from "@/${m}"`)));
  return dst;
}
function child(args: string[], url: string, env: Record<string, string> = {}) {
  if (!url.startsWith("file:")) throw new Error("refused: children get file: only");
  rmSync(CWD, { recursive: true, force: true });
  mkdirSync(CWD, { recursive: true });
  const e: NodeJS.ProcessEnv = { ...process.env, ...env, TURSO_DATABASE_URL: url, LEGS_765_HEAD_DIR: DIR };
  e.TURSO_AUTH_TOKEN = "";
  if (!env.CBT_CLOCK_NOW) delete e.CBT_CLOCK_NOW;
  const r = spawnSync(process.execPath, [TSX, "--tsconfig", TSCONFIG, "--import", STUB, CHILD, ...args], { cwd: CWD, env: e, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = redactSecrets(`${r.stdout}\n${r.stderr}`);
  const line = (r.stdout ?? "").split(/\r?\n/).reverse().find((l) => l.startsWith("RESULT "));
  if (r.status !== 0 || !line) throw new Error(`child ${args.join(" ")} failed: ${out.slice(-2000)}`);
  return JSON.parse(line.slice(7));
}

async function seed() {
  mkdirSync(DIR, { recursive: true });
  mkdirSync(ART, { recursive: true });
  const fp0 = await prodFingerprint();
  const tpl = copyPath("template");
  if (existsSync(tpl)) rmSync(tpl);
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: { ...process.env, TURSO_DATABASE_URL: copyUrl(tpl), TURSO_AUTH_TOKEN: "" }, encoding: "utf8" });
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
  for (const k of ["main", "plant"]) copyFileSync(tpl, copyPath(k));
  const now = new Date().toISOString();
  const pac = (race: string, cid: string, name: string) => ({ sql: `INSERT INTO pac_ie_spending (committee_id, spender, race_id, candidate_id, candidate_name, support_oppose, amount, earliest_date, latest_date, cycle, as_of) VALUES ('C00PLANT765', 'Planted PAC (HO 765 legs)', ?, ?, ?, 'S', 1000, '2026-06-01', '2026-06-01', 2026, ?)`, args: [race, cid, name, now] });
  const planted = await withDb(copyUrl(copyPath("plant")), async (db) => {
    await db.execute("PRAGMA foreign_keys = OFF");
    const r1 = await db.execute(`UPDATE general_ballot SET on_ballot = 0, withdrawn = 1 WHERE race_id = 'MD-05-2026' AND name = 'Adrian Boafo'`);
    await db.batch([
      { sql: `INSERT INTO general_ballot (race_id, person_key, name, party, on_ballot, withdrawn, write_in, marked, incumbent_marked, primary_marked, box_prefix, read_at) VALUES ('NY-16-2026', 'Pat_Replacement_(planted_765)', 'Pat Replacement', 'D', 1, 0, 0, 0, 0, 0, 'General election', '2026-10-01T00:00:00Z')`, args: [] },
      { sql: `INSERT INTO race_candidates (race_id, name, party, status, source_url) VALUES ('NY-16-2026', 'Pat Replacement', 'D', 'nominee', 'harvest:general_ballot')`, args: [] },
      pac("NY-16-2026", "H6PLANT0001", "REPLACEMENT, PAT"),
      pac("TX-18-2026", "H6PLANT0002", "GREEN, AL"),
      pac("LA-02-2026", "H6PLANT0003", "CARTER, TROY"),
      { sql: `INSERT INTO general_ballot (race_id, person_key, name, party, on_ballot, withdrawn, write_in, marked, incumbent_marked, primary_marked, box_prefix, read_at) VALUES ('S-MI-2026', 'Joe_Stevens_(planted_765)', 'Joe Stevens', 'I', 1, 0, 0, 0, 0, 0, 'General election', '2026-10-01T00:00:00Z')`, args: [] },
      { sql: `INSERT INTO general_ballot (race_id, person_key, name, party, on_ballot, withdrawn, write_in, marked, incumbent_marked, primary_marked, box_prefix, read_at) VALUES ('LA-02-2026', 'Troy_Carter_(planted_765)', 'Troy Carter', 'D', 1, 0, 0, 0, 1, 0, 'General election', '2026-10-01T00:00:00Z')`, args: [] },
    ], "write");
    const state = (await db.execute(`SELECT (SELECT on_ballot || '/' || withdrawn FROM general_ballot WHERE race_id = 'MD-05-2026' AND name = 'Adrian Boafo') boafo, (SELECT status FROM general_ballot_reads WHERE race_id = 'LA-02-2026') la, (SELECT status FROM general_ballot_reads WHERE race_id = 'NY-16-2026') ny, (SELECT status FROM general_ballot_reads WHERE race_id = 'TX-18-2026') tx, (SELECT COUNT(*) FROM pac_ie_spending WHERE committee_id = 'C00PLANT765') pac`)).rows[0]!;
    return `Boafo's ballot row ${r1.rowsAffected} moved (on/withdrawn ${state.boafo}) · reads: LA-02 ${state.la}, NY-16 ${state.ny}, TX-18 ${state.tx} · planted PAC rows ${state.pac}`;
  });
  copyFileSync(copyPath("plant"), copyPath("clock"));
  const clocked = await withDb(copyUrl(copyPath("clock")), async (db) => {
    const la = (await db.execute(`SELECT id, name FROM primary_candidates WHERE primary_id = 'house-LA-02-2026-open' ORDER BY name`)).rows;
    const carter = la.find((r) => /Carter/.test(String(r.name)));
    const other = la.find((r) => !/Carter/.test(String(r.name)));
    if (!carter || !other) throw new Error("LA-02's jungle rows");
    await db.batch([
      { sql: `UPDATE primary_candidates SET vote_pct = 30.0, status = 'running' WHERE id = ?`, args: [carter.id as number] },
      { sql: `UPDATE primary_candidates SET vote_pct = 45.0, status = 'winner' WHERE id = ?`, args: [other.id as number] },
      { sql: `UPDATE general_ballot SET marked = 1 WHERE race_id = 'NY-16-2026' AND name = 'Pat Replacement'`, args: [] },
      { sql: `UPDATE general_ballot SET marked = 1 WHERE race_id = 'TX-23-2026' AND (name = 'Brandon Herrera' OR rowid = (SELECT MIN(rowid) FROM general_ballot WHERE race_id = 'TX-23-2026' AND on_ballot = 1 AND name <> 'Brandon Herrera'))`, args: [] },
    ], "write");
    const m = (await db.execute(`SELECT race_id, COUNT(*) n FROM general_ballot WHERE marked = 1 GROUP BY race_id ORDER BY race_id`)).rows.map((r) => `${r.race_id} ${r.n}`).join(", ");
    return `LA-02: ${carter.name} running 30.0, ${other.name} winner 45.0 · marks: ${m}`;
  });
  say(`template: the tree's migrate against file:, seeded whole from prod · ${counts.join(" · ")} · copies main, plant, clock`);
  say(`  clock: ${clocked}`);
  say(`  plant: ${planted}`);
  await prodUntouched("the seed", fp0);
}

async function legs() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim().slice(0, 10);
  say(`=== HO 765 legs · ${LABEL} · ${new Date().toISOString()} · tree ${tree} · pac-target-status ${blob("lib/pac-target-status.ts")} queries ${blob("lib/queries.ts")} repair ${blob("lib/primary-identity-repair.ts")} · driver ${blob("scripts/diagnostic/pac-ballot-legs-765.ts")} child ${blob(CHILD)} ===`);
  const fp0 = await prodFingerprint();
  headFile("lib/pac-target-status.ts", "head-pac-target-status-765.ts");
  headFile("lib/queries.ts", "head-queries-765.ts", (s) => s.replace(/from "@\/lib\/pac-target-status"/g, 'from "./head-pac-target-status-765"'));
  const M = copyUrl(copyPath("main")), P = copyUrl(copyPath("plant"));
  const pH = child(["pac", "--code", "head"], P) as Record<string, string>;
  const pT = child(["pac", "--code", "tree"], P) as Record<string, string>;
  const st = (m: Record<string, string>, race: string, name: string) => Object.entries(m).find(([k]) => k.startsWith(`${race}|`) && k.endsWith(`|${name}`))?.[1];
  const targetsFile = path.join(DIR, `why-targets-${LABEL}-765.json`);
  const T = [
    { race: "MD-05-2026", name: "BOAFO, ADRIAN" },
    { race: "NY-16-2026", name: "REPLACEMENT, PAT" },
    { race: "TX-18-2026", name: "GREEN, AL" },
    { race: "LA-02-2026", name: "CARTER, TROY" },
    { race: "S-MI-2026", name: "STEVENS, HALEY" },
    { race: "TX-23-2026", name: "HERRERA, BRANDON" },
  ];
  writeFileSync(targetsFile, JSON.stringify(T));
  const wH = child(["why", "--code", "head", "--targets", targetsFile], P) as { res: Record<string, { status: string; why: string }> };
  const wT = child(["why", "--code", "tree", "--targets", targetsFile], P) as { today: string; electionDate: string; res: Record<string, { status: string; why: string }> };
  const wA = child(["why", "--code", "tree", "--targets", targetsFile], P, { CBT_CLOCK_NOW: AFTER_ELECTION }) as { today: string; electionDate: string; res: Record<string, { status: string; why: string }> };
  const pA = child(["pac", "--code", "tree"], P, { CBT_CLOCK_NOW: AFTER_ELECTION }) as Record<string, string>;
  const w = (x: { res: Record<string, { status: string; why: string }> }, k: string) => x.res[k] ?? { status: "?", why: "?" };

  say(`\n── leg 1: withdrawn after winning (MD-05's Boafo, his ballot row moved to the withdrawn block)`);
  check("1", "red: HEAD reads him active, from the contest", st(pH, "MD-05-2026", "BOAFO, ADRIAN") === "active" && /winner in/.test(w(wH, "MD-05-2026|BOAFO, ADRIAN").why), `HEAD ${st(pH, "MD-05-2026", "BOAFO, ADRIAN")} — ${w(wH, "MD-05-2026|BOAFO, ADRIAN").why}`);
  check("1", "the tree reads him withdrew, from the ballot", st(pT, "MD-05-2026", "BOAFO, ADRIAN") === "withdrew" && w(wT, "MD-05-2026|BOAFO, ADRIAN").why === "in the ballot's withdrawn block", `tree ${st(pT, "MD-05-2026", "BOAFO, ADRIAN")} — ${w(wT, "MD-05-2026|BOAFO, ADRIAN").why}`);

  say(`\n── leg 2: replacement nominee (NY-16's planted Pat Replacement, printed, a nominee roster row, no contest row)`);
  check("2", "HEAD reads active from the roster (rung 2)", st(pH, "NY-16-2026", "REPLACEMENT, PAT") === "active" && /race_candidates status=nominee/.test(w(wH, "NY-16-2026|REPLACEMENT, PAT").why), `HEAD ${st(pH, "NY-16-2026", "REPLACEMENT, PAT")} — ${w(wH, "NY-16-2026|REPLACEMENT, PAT").why}`);
  check("2", "the tree reads active from the ballot (rung 0), the why changed", st(pT, "NY-16-2026", "REPLACEMENT, PAT") === "active" && w(wT, "NY-16-2026|REPLACEMENT, PAT").why === "printed on the November ballot", `tree ${st(pT, "NY-16-2026", "REPLACEMENT, PAT")} — ${w(wT, "NY-16-2026|REPLACEMENT, PAT").why}`);
  check("2", "past election day (clock 2026-11-04, no marks on the box) the tree still reads active, and the why says not yet called", wA.today === "2026-11-04" && wA.electionDate === "2026-11-03" && st(pA, "NY-16-2026", "REPLACEMENT, PAT") === "active" && /election day has passed and the race is not yet called/.test(w(wA, "NY-16-2026|REPLACEMENT, PAT").why), `today ${wA.today} · election ${wA.electionDate} · ${st(pA, "NY-16-2026", "REPLACEMENT, PAT")} — ${w(wA, "NY-16-2026|REPLACEMENT, PAT").why}`);

  say(`\n── leg 3: runoff loser (TX-18's Al Green, unmarked in the decided D runoff, absent from the ballot)`);
  check("3", "HEAD and the tree both read lost, from the contest", st(pH, "TX-18-2026", "GREEN, AL") === "lost" && st(pT, "TX-18-2026", "GREEN, AL") === "lost" && w(wT, "TX-18-2026|GREEN, AL").why === w(wH, "TX-18-2026|GREEN, AL").why && /runoff/.test(w(wT, "TX-18-2026|GREEN, AL").why), `HEAD ${st(pH, "TX-18-2026", "GREEN, AL")} · tree ${st(pT, "TX-18-2026", "GREEN, AL")} — ${w(wT, "TX-18-2026|GREEN, AL").why}`);

  say(`\n── leg 4: no box (LA-02's Troy Carter; a printed ballot row planted under a no_box read)`);
  check("4", "HEAD and the tree read exactly the same, the planted row not consulted", st(pH, "LA-02-2026", "CARTER, TROY") === st(pT, "LA-02-2026", "CARTER, TROY") && JSON.stringify(w(wH, "LA-02-2026|CARTER, TROY")) === JSON.stringify(w(wT, "LA-02-2026|CARTER, TROY")) && w(wT, "LA-02-2026|CARTER, TROY").why !== "printed on the November ballot", `HEAD ${st(pH, "LA-02-2026", "CARTER, TROY")} · tree ${st(pT, "LA-02-2026", "CARTER, TROY")} — ${w(wT, "LA-02-2026|CARTER, TROY").why}`);
  // STEP 0's live change (TX-23's Herrera) is on every copy; leg 5 reads it on the untouched one.
  say(`\n── leg 1b: a printed namesake (an independent "Joe Stevens" on S-MI beside the target Haley Stevens, who lost the D primary)`);
  check("1b", "HEAD and the tree both read her lost, from the contest: the namesake does not speak for her", st(pH, "S-MI-2026", "STEVENS, HALEY") === "lost" && st(pT, "S-MI-2026", "STEVENS, HALEY") === "lost" && /senate-MI-2026-D resulted/.test(w(wT, "S-MI-2026|STEVENS, HALEY").why), `HEAD ${st(pH, "S-MI-2026", "STEVENS, HALEY")} · tree ${st(pT, "S-MI-2026", "STEVENS, HALEY")} — ${w(wT, "S-MI-2026|STEVENS, HALEY").why}`);
  const g = child(["guard"], P) as Record<string, { status: string; why: string }>;
  check("1b", "the first-name check is what declines: the pure function reads a printed Joe Stevens as the contest's lost, a printed Haley Stevens as active", g.joe?.status === "lost" && g.haley?.status === "active" && g.haley.why === "printed on the November ballot", `Joe → ${g.joe?.status} (${g.joe?.why}) · Haley → ${g.haley?.status} (${g.haley?.why})`);

  say(`\n── leg 2c: the caller's clock, and the why past election day by the box's marks (the clock copy)`);
  const C = copyUrl(copyPath("clock"));
  const cNow = child(["pac", "--code", "tree"], C) as Record<string, string>;
  const cTree = child(["pac", "--code", "tree"], C, { CBT_CLOCK_NOW: AFTER_ELECTION }) as Record<string, string>;
  const cHead = child(["pac", "--code", "head"], C, { CBT_CLOCK_NOW: AFTER_ELECTION }) as Record<string, string>;
  check("2c", "red: HEAD's caller ignores the clock (Carter unknown at 2026-11-04); the tree's reads it (lost), and today's clock still reads unknown", st(cHead, "LA-02-2026", "CARTER, TROY") === "unknown" && st(cTree, "LA-02-2026", "CARTER, TROY") === "lost" && st(cNow, "LA-02-2026", "CARTER, TROY") === "unknown", `HEAD@11-04 ${st(cHead, "LA-02-2026", "CARTER, TROY")} · tree@11-04 ${st(cTree, "LA-02-2026", "CARTER, TROY")} · tree@today ${st(cNow, "LA-02-2026", "CARTER, TROY")}`);
  const wC = child(["why", "--code", "tree", "--targets", targetsFile], C, { CBT_CLOCK_NOW: AFTER_ELECTION }) as { res: Record<string, { status: string; why: string }> };
  check("2c", "one mark on the box: decided; two: a runoff; the status active in both", w(wC, "NY-16-2026|REPLACEMENT, PAT").status === "active" && w(wC, "NY-16-2026|REPLACEMENT, PAT").why === "printed on the November ballot; the race is decided (marked)" && w(wC, "TX-23-2026|HERRERA, BRANDON").status === "active" && w(wC, "TX-23-2026|HERRERA, BRANDON").why === "printed on the November ballot; the race goes to a runoff (marked)", `NY-16 ${w(wC, "NY-16-2026|REPLACEMENT, PAT").why} · TX-23 ${w(wC, "TX-23-2026|HERRERA, BRANDON").why}`);
  const otherPlant = Object.keys({ ...pH, ...pT }).filter((k) => pH[k] !== pT[k] && !k.includes("|BOAFO, ADRIAN") && !k.endsWith("|HERRERA, BRANDON"));
  check("1-4", "on the plant copy nothing else moves (Boafo's status, and STEP 0's live change)", otherPlant.length === 0, otherPlant.join("; ") || "none");

  say(`\n── leg 5: the live set (the untouched copy)`);
  const mH = child(["pac", "--code", "head"], M) as Record<string, string>;
  const mT = child(["pac", "--code", "tree"], M) as Record<string, string>;
  const moved = Object.keys({ ...mH, ...mT }).filter((k) => mH[k] !== mT[k]);
  check("5", "STEP 0's one change and no other: TX-23's Herrera unknown → active", moved.length === 1 && moved[0]!.startsWith("TX-23-2026|") && moved[0]!.endsWith("|HERRERA, BRANDON") && mH[moved[0]!] === "unknown" && mT[moved[0]!] === "active", `${Object.keys(mT).length} PAC rows · moved: ${moved.map((k) => `${k} ${mH[k]} → ${mT[k]}`).join("; ") || "none"}`);
  const live = [...new Set(Object.keys(mT).map((k) => { const [race, , , name] = k.split("|"); return JSON.stringify({ race, name }); }))].map((s) => JSON.parse(s) as { race: string; name: string });
  const liveFile = path.join(DIR, `why-live-${LABEL}-765.json`);
  writeFileSync(liveFile, JSON.stringify(live));
  const lT = child(["why", "--code", "tree", "--targets", liveFile], M) as { res: Record<string, { status: string; why: string }> };
  const rung = (why: string) => (/November ballot|withdrawn block/.test(why) ? "0 ballot" : /race_candidates|no contest row and no roster/.test(why) ? "2 roster" : "1 contest");
  const table = live.map((t) => { const c = lT.res[`${t.race}|${t.name}`]!; return `| ${t.race} | ${t.name} | ${c.status} | rung ${rung(c.why)} | ${c.why} |`; });
  say(`  | race | FEC name | tree status | rung | why |`);
  say(`  |---|---|---|---|---|`);
  for (const r of table) say(`  ${r}`);
  check("5", "every tree why names its rung (the ballot, a contest id, or the roster)", live.every((t) => { const why = lT.res[`${t.race}|${t.name}`]!.why; return /November ballot|withdrawn block|race_candidates|no contest row|(house|senate)-[A-Z]{2}-/.test(why); }), `${live.length} targets`);
  writeFileSync(path.join(ART, `leg5-live-${LABEL}.json`), JSON.stringify({ head: mH, tree: mT, why: lT.res }, null, 1));

  say(`\n── leg 6: the chore`);
  const headHeader = execFileSync("git", ["cat-file", "-p", `${HEAD_SHA}:lib/primary-identity-repair.ts`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  const treeHeader = readFileSync("lib/primary-identity-repair.ts", "utf8");
  const said = (s: string) => s.replace(/\r/g, "").match(/The write\n\/\/ is UPDATE by id, ([^:]*):/)?.[1] ?? "(not found)";
  check("6", "red: HEAD's header names two columns; the tree's names the three", /^person_key and bioguide_id only$/.test(said(headHeader)) && /^person_key, bioguide_id and updated_at only$/.test(said(treeHeader)), `HEAD "${said(headHeader)}" → tree "${said(treeHeader)}"`);

  await prodUntouched("the legs", fp0);
  say(`\n${passes} pass, ${fails} fail`);
}

async function main() {
  if (process.argv.includes("--seed")) await seed();
  else if (process.argv.includes("--legs")) await legs();
  else throw new Error("--seed | --legs");
}
main().catch((e) => {
  console.error(redactSecrets(String(e?.stack ?? e)));
  process.exit(1);
});
