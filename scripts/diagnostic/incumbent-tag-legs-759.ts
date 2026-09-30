// HO 759 legs: the tag for a stored incumbent the seat's ballot doesn't carry (ruled C), on `file:`
// copies seeded whole from prod, each leg red first against HEAD's build.
//   npx tsx scripts/diagnostic/incumbent-tag-legs-759.ts --seed --label L     # template, four copies, the in-process legs
//   (HEAD build)  npx tsx scripts/diagnostic/incumbent-tag-legs-759.ts --phase before --label L
//   (tree build)  npx tsx scripts/diagnostic/incumbent-tag-legs-759.ts --phase after --label L
//
// Four copies of one seed, no harvest run (HO 759 writes nothing):
//   head    no plants, for HEAD's server
//   new     no plants, for the tree's server
//   plant   leg 3's two primary rows and leg 4's mark, for the tree's server
//   hplant  the same plants, for HEAD's server (HEAD's reds read HEAD on the same rows)
// Plants (prod carries none of them):
//   leg 3  AZ-05 (Andy Biggs, on no ballot): a namesake "Andrea Biggs" row carrying Biggs's bioguide,
//          unmarked in AZ-05's decided primary; SD-AL (Dusty Johnson, on no ballot): a "Dusty Johnson"
//          row with his bioguide, unmarked in SD's decided House primary (the control the guard lets by)
//   leg 4  TX-35's box: one printed row marked (a decided race); IA-02 left unmarked (undecided)
// Each server run gets its copy's own sentinel on /api/health and a cleared .next/cache/fetch-cache;
// for "Nov 4", CBT_CLOCK_NOW (lib/clock.ts honours it only against a file: database).
//   0 unchanged    clock today: every race page's <main> equals HEAD's once the tag is taken out and
//                  Louisiana's heading put back; only the 94 and LA's six differ at all; /electoral's
//                  list rows and the dashboard's cards equal HEAD's except the rows carrying a tag
//   1 the kinds    TX-35 RUNNING IN TX-37 (links /race/TX-37-2026), IA-02 RUNNING FOR SENATE (links
//                  /race/S-IA-2026), TN-09 RETIRING, NC-11 WITHDREW, CO-01 LOST PRIMARY, AZ-05 NOT ON
//                  THE BALLOT (absent), TX-09 NOT ON THE BALLOT (the handoff's LOST PRIMARY case: its
//                  runoff is not in the table, STEP 0), MI-04 (on his own ballot) no tag; in process,
//                  the cycle's table by kind and reason on the copy
//   2 precedence   IA-02, curated incumbent_running = 0, reads RUNNING FOR SENATE; so do KY-06, NH-01,
//                  OK-01 (in process: each carries `retiring` among its reasons)
//   3 namesake     plant copy: AZ-05 reads NOT ON THE BALLOT with the namesake's row in a decided
//                  primary (a bioguide-only match would read LOST PRIMARY); SD-AL reads LOST PRIMARY
//   4 post-elect.  plant copy, Nov 4: TX-35 (marked, decided) shows HO 758's "not on the ballot" and no
//                  tag; IA-02 (unmarked, undecided) keeps RUNNING FOR SENATE and no HO 758 qualifier
//   5 Louisiana    LA-01's roster heading reads "On the ballot"; CO-08's "Also on the ballot"
//   6 captures     the cases' race pages and LA-01 at 1440, 2560 and reduced motion; /electoral's list
//                  rows (one per tag), the pinned card (search TX-35), the district card (TX, TX-35),
//                  and the dashboard's Races panel; HEAD's before beside
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed and a fingerprint before and after
// every mode. Copies are `file:${abs}` from paths ending -759-legs.db; children get that URL with
// TURSO_AUTH_TOKEN="" (not deleted: dotenv and Next's loader refill a missing key). Every printed
// line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const HEAD_SHA = "d8f1a0a";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/759-artifacts");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const PORT = 3759;
const ROUTE = "/api/cron/race-challengers";
const NOV4 = "2026-11-04T15:00:00.000Z"; // 8am MT the morning after
const SENTINEL: Record<string, string> = { head: "2026-09-30T02:00:01.759Z", new: "2026-09-30T02:00:02.759Z", plant: "2026-09-30T02:00:03.759Z", hplant: "2026-09-30T02:00:04.759Z" };
const TABLES = ["races", "members", "member_ids", "race_ratings", "race_candidates", "kalshi_odds", "polymarket_odds", "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads"];
// The cases (STEP 0 read each on prod) and what each tag reads.
const CASES: { race: string; want: string | null; kind: string | null; href?: string; note: string }[] = [
  { race: "TX-35-2026", want: "RUNNING IN TX-37", kind: "moved", href: "/race/TX-37-2026", note: "moved (Casar printed in TX-37)" },
  { race: "IA-02-2026", want: "RUNNING FOR SENATE", kind: "senate", href: "/race/S-IA-2026", note: "Senate (Hinson printed in S-IA; curated 0)" },
  { race: "TN-09-2026", want: "RETIRING", kind: "retiring", note: "retiring (curated 0)" },
  { race: "NC-11-2026", want: "WITHDREW", kind: "withdrew", note: "withdrew (Edwards in NC-11's withdrawn block)" },
  { race: "CO-01-2026", want: "LOST PRIMARY", kind: "lost_primary", note: "lost primary (DeGette unmarked in CO-01's decided D primary)" },
  { race: "AZ-05-2026", want: "NOT ON THE BALLOT", kind: "absent", note: "absent (Biggs on no ballot read)" },
  { race: "TX-09-2026", want: "NOT ON THE BALLOT", kind: "absent", note: "the handoff's LOST PRIMARY case: Green is marked in TX-18's first round, whose runoff the table lacks" },
  { race: "MI-04-2026", want: null, kind: null, note: "control: Huizenga on his own ballot" },
];
const SENATE_CURATED = ["IA-02-2026", "KY-06-2026", "NH-01-2026", "OK-01-2026"];
const LA = "LA-01-2026", CO8 = "CO-08-2026";
const PLANT = { namesake: { race: "AZ-05-2026", name: "Andrea Biggs" }, truename: { race: "SD-AL-2026" }, decided: { race: "TX-35-2026" }, undecided: { race: "IA-02-2026" } };
// One rated race per tag for /electoral's list captures (rated-759.txt).
const LIST_ROWS = ["TX-35-2026", "IA-02-2026", "NV-02-2026", "NC-11-2026", "FL-07-2026", "TX-09-2026"];
const CAPTURE = [...CASES.map((c) => c.race), LA];

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
// A difference between two fingerprints passes only when each changed component is explained by a
// prod cron's OWN run that started inside the window (the legs write file: copies only).
async function prodUntouched(label: string, fp0: string, t0: string) {
  const fp1 = await prodFingerprint();
  if (fp0 === fp1) { check("*", `prod untouched (${label})`, true, "fingerprints equal"); return; }
  const a = JSON.parse(fp0) as Record<string, unknown>, b = JSON.parse(fp1) as Record<string, unknown>;
  const changed = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const db = prodClient();
  const runs = (await reader(db)(`SELECT id, route, started_at, status FROM cron_runs WHERE started_at >= ? ORDER BY id`, [t0])).rows.map((r) => ({ route: String(r.route), at: String(r.started_at), id: Number(r.id), status: String(r.status) }));
  db.close();
  const by = (route: string) => runs.some((r) => r.route === route);
  const explained: Record<string, boolean> = { rc: by(ROUTE), gb: by("/api/cron/general-ballot"), reads: by("/api/cron/general-ballot"), pc: by("/api/cron/primaries"), races: false, runs: runs.length > 0, schema: false };
  const unexplained = changed.filter((k) => !explained[k]);
  check("*", `prod untouched (${label}): every difference is a prod cron's own run in the window`, unexplained.length === 0, `changed ${changed.join(", ")} · runs in the window: ${runs.map((r) => `${r.route}#${r.id} ${r.at} ${r.status}`).join("; ") || "none"}${unexplained.length ? ` · UNEXPLAINED ${unexplained.join(", ")}` : ""}`);
}
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
    runs: (await read(`SELECT route, MAX(id) AS id FROM cron_runs WHERE route IN (?, '/api/cron/general-ballot', '/api/cron/primaries') GROUP BY route ORDER BY route`, [ROUTE])).rows.map((r) => `${r.route}#${r.id}`),
  };
  db.close();
  return JSON.stringify(fp);
}

// ── copies ──────────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-759-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-759-legs.db")) throw new Error(`refused: a copy must be a *-759-legs.db file (got ${abs})`);
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

async function plant(db: Client) {
  const out: Record<string, unknown> = {};
  const now = new Date().toISOString();
  const incOf = async (race: string) => String((await db.execute({ sql: `SELECT incumbent_bioguide_id b FROM races WHERE id = ?`, args: [race] })).rows[0]!.b);
  const decidedPrimary = async (state: string, district: number) => {
    const r = (await db.execute({ sql: `SELECT p.id, p.party FROM primaries p WHERE p.state = ? AND p.chamber = 'house' AND CAST(p.district AS INTEGER) = ? AND p.election_round = 'primary' AND EXISTS (SELECT 1 FROM primary_candidates w WHERE w.primary_id = p.id AND w.status = 'winner') ORDER BY p.party = 'R' DESC, p.id LIMIT 1`, args: [state, district] })).rows[0];
    if (!r) throw new Error(`no decided House primary for ${state}-${district}`);
    return { id: String(r.id), party: String(r.party) };
  };
  // leg 3: the namesake (must not read LOST PRIMARY) and the true name (must)
  {
    const bio = await incOf(PLANT.namesake.race);
    const p = await decidedPrimary("AZ", 5);
    await db.execute({ sql: `INSERT INTO primary_candidates (primary_id, name, party, incumbent, bioguide_id, status, vote_pct, updated_at) VALUES (?, ?, 'R', 0, ?, 'running', 1.1, ?)`, args: [p.id, PLANT.namesake.name, bio, now] });
    out.namesake = { race: PLANT.namesake.race, primary: p.id, name: PLANT.namesake.name, bioguide: bio };
  }
  {
    const bio = await incOf(PLANT.truename.race);
    const m = (await db.execute({ sql: `SELECT name FROM members WHERE bioguide_id = ?`, args: [bio] })).rows[0]!;
    const p = await decidedPrimary("SD", 0);
    await db.execute({ sql: `INSERT INTO primary_candidates (primary_id, name, party, incumbent, bioguide_id, status, vote_pct, updated_at) VALUES (?, ?, 'R', 1, ?, 'running', 1.2, ?)`, args: [p.id, String(m.name), bio, now] });
    out.truename = { race: PLANT.truename.race, primary: p.id, name: String(m.name), bioguide: bio };
  }
  // leg 4: TX-35 decided (one printed row marked, the Democrat's if any)
  {
    const row = (await db.execute({ sql: `SELECT person_key, name, party FROM general_ballot WHERE race_id = ? AND on_ballot = 1 AND write_in = 0 ORDER BY party = 'D' DESC, name LIMIT 1`, args: [PLANT.decided.race] })).rows[0];
    if (!row) throw new Error("TX-35 has no printed row to mark");
    const r = await db.execute({ sql: `UPDATE general_ballot SET marked = 1 WHERE race_id = ? AND person_key = ?`, args: [PLANT.decided.race, String(row.person_key)] });
    if (r.rowsAffected !== 1) throw new Error(`mark TX-35: ${r.rowsAffected}`);
    const n = Number((await db.execute({ sql: `SELECT COUNT(*) n FROM general_ballot WHERE race_id = ? AND marked = 1`, args: [PLANT.undecided.race] })).rows[0]!.n);
    if (n !== 0) throw new Error(`IA-02 must stay unmarked (${n})`);
    out.decided = { race: PLANT.decided.race, marked: String(row.name), party: String(row.party) };
  }
  return out;
}

type Readings = Awaited<ReturnType<typeof import("@/lib/incumbent-qualifier")["readIncumbentQualifierReadings"]>>;
async function readings(url: string): Promise<Readings> {
  const { readIncumbentQualifierReadings } = await import("@/lib/incumbent-qualifier");
  return withDb(url, (db) => readIncumbentQualifierReadings(db, 2026));
}
const tagOf = (r: Readings extends Map<string, infer V> ? V : never) => (r.qualifier == null ? "none" : r.qualifier.kind === "none" ? r.qualifier.reason : r.qualifier.kind);

async function seed() {
  mkdirSync(DIR, { recursive: true });
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();
  say(`prod before: ${fp0}`);
  const tpl = copyPath("template");
  if (existsSync(tpl)) rmSync(tpl);
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: childEnv(copyUrl(tpl), null), encoding: "utf8" });
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
  say(`template: the real scripts/migrate.ts against file:, seeded whole from prod · ${counts.join(" · ")}`);
  const sentinel = (kind: string) => ({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 759, 'success', ?)`, args: [ROUTE, SENTINEL[kind]!, SENTINEL[kind]!, JSON.stringify({ sentinel: `HO 759 legs, the ${kind} copy only` })] });
  let planted: Record<string, unknown> = {};
  for (const kind of ["head", "new", "plant", "hplant"] as const) {
    const abs = copyPath(kind);
    copyFileSync(tpl, abs);
    const url = copyUrl(abs);
    await withDb(url, (db) => db.execute(sentinel(kind)));
    if (kind === "plant" || kind === "hplant") planted = await withDb(url, plant);
    say(`copy ${path.basename(abs)}${kind === "plant" || kind === "hplant" ? " · planted" : ""}`);
  }
  writeFileSync(path.join(ART, `planted-${LABEL}.json`), JSON.stringify(planted, null, 1));
  say(`  planted: ${JSON.stringify(planted)}`);
  await prodUntouched("the seed", fp0, t0);
  await inProcess();
}

// ── the rule, in process, on the copies (the tree's lib/incumbent-qualifier.ts) ─
async function inProcess() {
  say(`\n── in process (the tree's rule on the copies)`);
  const base = await readings(copyUrl(copyPath("new")));
  const off = [...base.entries()].filter(([, r]) => r.qualifier);
  const count = (k: string) => off.filter(([, r]) => tagOf(r) === k).length;
  const table = { moved: count("moved"), senate: count("senate"), retiring: count("retiring"), withdrew: count("withdrew"), lost_primary: count("lost_primary"), absent: count("absent") };
  say(`  the table on the copy: ${off.length} tagged of ${base.size} box races with a stored incumbent · ${JSON.stringify(table)}`);
  writeFileSync(path.join(ART, `table-${LABEL}.json`), JSON.stringify(Object.fromEntries(off.map(([id, r]) => [id, { tag: tagOf(r), moved: r.moved, senate: r.senate, reasons: r.reasons }])), null, 1));
  check("1", "in process: 94 tagged, by kind 11 moved · 6 Senate, and 77 by reason 31 retiring · 1 withdrew · 9 lost primary · 36 absent (the tree's rule on prod at STEP 0, qual-prod-759.txt; plain full-name equality reads 6 lost primary · 39 absent, step0-759.txt)", off.length === 94 && JSON.stringify(table) === JSON.stringify({ moved: 11, senate: 6, retiring: 31, withdrew: 1, lost_primary: 9, absent: 36 }), JSON.stringify(table));
  for (const c of CASES) {
    const r = base.get(c.race);
    const got = r ? tagOf(r) : "no reading";
    check("1", `in process: ${c.race} ${c.note} reads ${c.kind ?? "nothing"}`, c.kind === null ? r != null && r.qualifier === null && r.onOwnBallot : got === c.kind && (!c.href || (r!.qualifier as { raceId?: string }).raceId === c.href.replace("/race/", "")), `${got}${r?.qualifier && "raceId" in r.qualifier ? ` ${r.qualifier.raceId}` : ""} · reasons [${r?.reasons.join(",")}]`);
  }
  // leg 2: kind beats the curated flag
  for (const id of SENATE_CURATED) {
    const r = base.get(id)!;
    check("2", `in process: ${id} carries the curated zero and reads senate, not retiring`, r.reasons.includes("retiring") && tagOf(r) === "senate", `reasons [${r.reasons.join(",")}] · ${tagOf(r)} ${r.senate.join(",")}`);
  }
  // leg 3: the namesake guard, on the plant copy and on prod's own namesake rows
  const pl = await readings(copyUrl(copyPath("plant")));
  const az = pl.get(PLANT.namesake.race)!, sd = pl.get(PLANT.truename.race)!;
  const strawman = await withDb(copyUrl(copyPath("plant")), async (db) => Number((await db.execute({ sql: `SELECT COUNT(*) n FROM primary_candidates c JOIN primaries p ON p.id = c.primary_id WHERE c.bioguide_id = (SELECT incumbent_bioguide_id FROM races WHERE id = ?) AND c.status <> 'winner' AND EXISTS (SELECT 1 FROM primary_candidates w WHERE w.primary_id = c.primary_id AND w.status = 'winner')`, args: [PLANT.namesake.race] })).rows[0]!.n));
  check("3", `in process, plant copy: AZ-05 with the namesake "${PLANT.namesake.name}" (Biggs's bioguide, unmarked, decided primary) reads absent, where a bioguide-only match reads lost_primary (${strawman} such row)`, tagOf(az) === "absent" && !az.reasons.includes("lost_primary") && strawman >= 1, `${tagOf(az)} · reasons [${az.reasons.join(",")}]`);
  check("3", `in process, plant copy: SD-AL with its incumbent's own name unmarked in a decided primary reads lost_primary (the control)`, tagOf(sd) === "lost_primary", `${tagOf(sd)} · reasons [${sd.reasons.join(",")}]`);
  // Prod's one namesake the guard meets: FL-11's "Royal Webster" carries Daniel Webster's bioguide,
  // unmarked in a decided primary (TX-22's "Trever Nehls" is marked, so it never reaches the guard).
  const fl11 = base.get("FL-11-2026")!;
  check("3", `in process, prod's own namesake: FL-11 ("Royal Webster", Webster's bioguide, unmarked in a decided primary) adds no lost_primary`, !fl11.reasons.includes("lost_primary"), `FL-11 [${fl11.reasons.join(",")}]`);
  // The other side: the name check lets the incumbent through under a middle initial or a short
  // first name, where plain normName equality would not (STEP 0's near misses).
  const through = ["CT-01-2026", "NY-10-2026", "TX-02-2026"].map((id) => [id, tagOf(base.get(id)!)] as const);
  check("3", `in process: CT-01 ("John Larson" / John B. Larson), NY-10 ("Daniel Goldman" / Daniel S. Goldman), TX-02 ("Daniel Crenshaw" / Dan Crenshaw) read lost_primary through the name check`, through.every(([, t]) => t === "lost_primary"), through.map(([id, t]) => `${id} ${t}`).join(" · "));
  // the copies' untouched readings agree with each other (no plant leaked)
  const hd = await readings(copyUrl(copyPath("head")));
  const same = [...base.keys()].every((id) => JSON.stringify(base.get(id)) === JSON.stringify(hd.get(id)));
  check("*", "the head and new copies read alike (the same seed)", same && hd.size === base.size, `${hd.size} readings`);
}

// ── the servers ─────────────────────────────────────────────────────────────
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
// Every product file HO 759 changes, and the three it adds (HO 759's review: the staleness check
// covered four). Before: the changed ones at HEAD and the new ones absent. After: none at HEAD, all
// present. Either way the build must be newer than every product file on disk.
const PRODUCT = ["app/electoral/page.tsx", "app/race/[id]/page.tsx", "app/welcome/panels.tsx", "components/CompetitiveRacesBlock.tsx", "components/RaceCandidates.tsx", "components/RaceCard.tsx", "components/RaceDistrictCard.tsx", "components/RaceDistrictModal.tsx", "components/RaceHubBody.tsx", "components/RaceIncumbentCard.tsx", "components/RaceListView.tsx", "components/RaceMapCard.tsx", "lib/ballot-incumbent.ts", "lib/ballotpedia-title-repair.ts", "lib/cartogram-data.ts", "lib/queries.ts"];
const PRODUCT_NEW = ["lib/incumbent-qualifier.ts", "lib/incumbent-tag.ts", "components/IncumbentTag.tsx"];
function buildState(phase: string): string {
  const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim();
  const headBlob = (f: string) => execFileSync("git", ["rev-parse", `${HEAD_SHA}:${f}`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
  const atHead = PRODUCT.filter((f) => blob(f) === headBlob(f));
  const present = PRODUCT_NEW.filter((f) => existsSync(f));
  const before = phase === "before";
  if (atHead.length !== (before ? PRODUCT.length : 0)) throw new Error(`phase ${phase} needs ${before ? PRODUCT.length : 0} of ${PRODUCT.length} changed files at HEAD, found ${atHead.length}`);
  if (present.length !== (before ? 0 : PRODUCT_NEW.length)) throw new Error(`phase ${phase}: ${present.length} of the ${PRODUCT_NEW.length} new files present`);
  const built = statSync(".next/BUILD_ID").mtime;
  const newest = Math.max(...[...PRODUCT, ...present].map((f) => statSync(f).mtime.getTime()));
  if (built.getTime() < newest) throw new Error("the build is older than a product file; rebuild first");
  return `build ${readFileSync(".next/BUILD_ID", "utf8").trim()} @ ${built.toISOString()} · ${atHead.length} of ${PRODUCT.length} changed files at ${HEAD_SHA} · ${present.length} of ${PRODUCT_NEW.length} new present · newer than every one`;
}
async function startServer(kind: string, clock: string | null) {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  const cache = path.resolve(".next/cache/fetch-cache");
  const n = existsSync(cache) ? readdirSync(cache).length : 0;
  rmSync(cache, { recursive: true, force: true });
  const log = path.join(DIR, `server759-${kind}-${LABEL}-${Date.now()}.log`);
  const out = createWriteStream(log);
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env: childEnv(copyUrl(copyPath(kind)), clock), stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (b: Buffer) => out.write(b));
  server.stderr.on("data", (b: Buffer) => out.write(b));
  const kill = async () => { try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } out.end(); await sleep(900); };
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`http://127.0.0.1:${PORT}/api/health`)).status > 0; } catch { /* not yet */ } }
  if (!up) { await kill(); throw new Error("the server never answered /api/health"); }
  const pids = listeningPids();
  const h = (await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json()) as { routes?: { path?: string; lastRunAt?: string }[] };
  const mine = h.routes?.find((r) => r.path === ROUTE);
  if (mine?.lastRunAt !== SENTINEL[kind]) { await kill(); throw new Error(`transport check failed: lastRunAt ${String(mine?.lastRunAt)} is not the ${kind} copy's sentinel`); }
  say(`  server :${PORT} (spawned pid ${server.pid}, listening pid ${pids.join(",")}) · ${kind} copy (own sentinel) · clock ${clock ?? "real"} · fetch-cache cleared (${n})`);
  return { kill };
}

// Page scripts are strings (tsx's keepNames wrapper), with no regex escapes (HO 736).
const NORM = `const norm = (s) => (s || '').split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ');`;
// <main> raw, and normalized: the tag's wrapper taken out and the roster heading put back to HEAD's.
const READ_MAIN = `(() => {
  const m = document.querySelector('main');
  if (!m) return { raw: '', norm: '' };
  const raw = m.innerHTML;
  const c = m.cloneNode(true);
  c.querySelectorAll('[data-incumbent-tag]').forEach((t) => { const w = t.parentElement; if (w && w.children.length === 1 && w.tagName === 'SPAN') w.remove(); else t.remove(); });
  c.querySelectorAll('[data-roster-others] > p').forEach((p) => { if (p.textContent === 'On the ballot') p.textContent = 'Also on the ballot'; });
  return { raw, norm: c.innerHTML };
})()`;
const READ_RACE = `(() => {
  ${NORM}
  const tag = document.querySelector('[data-incumbent-tag]');
  const a = tag ? tag.querySelector('a') : null;
  const qual = document.querySelector('[data-incumbent-qualifier]');
  const heads = Array.from(document.querySelectorAll('[data-roster-others] > p')).map((p) => norm(p.textContent));
  return { tag: tag ? norm(tag.textContent) : null, tagKind: tag ? tag.getAttribute('data-incumbent-tag') : null, href: a ? a.getAttribute('href') : null, tagClass: tag && tag.firstElementChild ? tag.firstElementChild.className : null, qualifier: qual ? norm(qual.textContent) : null, heading: heads };
})()`;
type RaceReading = { tag: string | null; tagKind: string | null; href: string | null; tagClass: string | null; qualifier: string | null; heading: string[] };
const READ_LIST = `(() => {
  const rows = {};
  document.querySelectorAll('li.race-list-item').forEach((li) => {
    const seat = li.querySelector('.race-list-seat');
    const t = li.querySelector('[data-incumbent-tag]');
    rows[seat ? seat.textContent.trim() : '?' + Object.keys(rows).length] = { html: li.outerHTML, tag: t ? t.getAttribute('data-incumbent-tag') : null, text: t ? t.textContent : null, memberLink: !!li.querySelector('.race-list-row a[href^="/members/"]') };
  });
  return rows;
})()`;
const READ_CARDS = `(() => {
  const rows = {};
  document.querySelectorAll('a.race-card[data-seat]').forEach((a) => { const t = a.querySelector('[data-incumbent-tag]'); rows[a.getAttribute('data-seat')] = { html: a.outerHTML, tag: t ? t.getAttribute('data-incumbent-tag') : null, text: t ? t.textContent : null, nestedAnchor: !!a.querySelector('a') }; });
  return rows;
})()`;
type ListRow = { html: string; tag: string | null; text: string | null; nestedAnchor?: boolean; memberLink?: boolean };

async function phaseRun() {
  const phase = argAt("--phase");
  if (phase !== "before" && phase !== "after") throw new Error("--phase before|after");
  say(`\n── phase ${phase} · ${buildState(phase)}`);
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const out: Record<string, unknown> = {};
  const raceIds = await withDb(copyUrl(copyPath("new")), async (db) => (await db.execute(`SELECT id FROM races WHERE cycle = 2026 ORDER BY id`)).rows.map((r) => String(r.id)));
  const shots = path.join(ART, "captures");
  mkdirSync(shots, { recursive: true });
  const errors: string[] = [];
  const newPage = async (w = 1440, h = 1200, rm: "reduce" | "no-preference" = "reduce") => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: rm });
    await ctx.addCookies([{ name: "ct_seen", value: "1", domain: "127.0.0.1", path: "/" }]);
    const page = await ctx.newPage();
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${page.url()}: ${m.text().slice(0, 200)}`); });
    page.on("pageerror", (e) => errors.push(`${page.url()}: pageerror ${String(e).slice(0, 200)}`));
    return { ctx, page };
  };
  const MODES = [{ tag: "1440", w: 1440, h: 1200, rm: "no-preference" as const }, { tag: "2560", w: 2560, h: 1440, rm: "no-preference" as const }, { tag: "1440-reduced", w: 1440, h: 1200, rm: "reduce" as const }];
  try {
    // legs 0, 1, 5, 6: the unplanted copy, clock today. HEAD reads its own copy.
    {
      const srv = await startServer(phase === "before" ? "head" : "new", null);
      try {
        const { ctx, page } = await newPage();
        const mains: Record<string, { raw: string; norm: string }> = {};
        for (const id of raceIds) {
          await page.goto(`http://127.0.0.1:${PORT}/race/${id}`, { waitUntil: "load" });
          mains[id] = (await page.evaluate(READ_MAIN)) as { raw: string; norm: string };
        }
        const races: Record<string, RaceReading> = {};
        for (const id of [...CASES.map((c) => c.race), LA, CO8, ...SENATE_CURATED]) {
          await page.goto(`http://127.0.0.1:${PORT}/race/${id}`, { waitUntil: "networkidle" });
          races[id] = (await page.evaluate(READ_RACE)) as RaceReading;
        }
        await page.goto(`http://127.0.0.1:${PORT}/electoral`, { waitUntil: "networkidle" });
        await page.locator("button.cart-viewtoggle-btn", { hasText: "LIST" }).first().click();
        await sleep(500);
        const list = (await page.evaluate(READ_LIST)) as Record<string, ListRow>;
        // leg 6: Enter on TX-35's tag link, in the list row, follows the link (HO 759's review)
        {
          const link = page.locator("li.race-list-item", { has: page.locator(".race-list-seat", { hasText: "TX-35" }) }).first().locator("[data-incumbent-tag] a").first();
          if (await link.count()) {
            await link.focus();
            await page.keyboard.press("Enter");
            await page.waitForLoadState("networkidle");
            await sleep(400);
            out.enterNav = new URL(page.url()).pathname;
          } else out.enterNav = "no tag link";
        }
        // leg 6: the map's hover for Texas, its TX-35 row's meta
        {
          await page.goto(`http://127.0.0.1:${PORT}/electoral`, { waitUntil: "networkidle" });
          // The peek opens on the state path's hover or focus (tileHandlers); the label is a
          // sibling <text> with only an onClick, so it is the path that is focused.
          const tile = page.locator('path.us-map-state[aria-label="Texas"]').first();
          if (await tile.count()) {
            await tile.focus();
            await sleep(500);
            out.peek = (await page.evaluate(`(() => { const rows = Array.from(document.querySelectorAll('.us-map-peek .cart-peek-row')); const r = rows.find((x) => x.firstElementChild && x.firstElementChild.textContent.trim() === 'TX-35'); return r && r.lastElementChild ? r.lastElementChild.textContent : null; })()`)) as string | null;
            const peek = page.locator(".us-map-peek").first();
            if (await peek.count()) await peek.screenshot({ path: path.join(ART, "captures", `${phase}-peek-TX-1440.png`) });
          } else out.peek = null;
        }
        await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
        const cards = (await page.evaluate(READ_CARDS)) as Record<string, ListRow>;
        await ctx.close();
        writeFileSync(path.join(DIR, `unchanged-${phase}-${LABEL}.json`), JSON.stringify({ mains, list, cards }));
        out.races = races;
        out.listTags = Object.fromEntries(Object.entries(list).filter(([, r]) => r.tag).map(([k, r]) => [k, r.text]));
        out.cardTags = Object.fromEntries(Object.entries(cards).map(([k, r]) => [k, r.text]));
        out.cardNested = Object.entries(cards).filter(([, r]) => r.nestedAnchor).map(([k]) => k);
        say(`    ${phase}: ${raceIds.length} race pages · /electoral list ${Object.keys(list).length} rows (${Object.values(list).filter((r) => r.tag).length} tagged) · dashboard ${Object.keys(cards).length} cards (${Object.values(cards).filter((r) => r.tag).length} tagged)`);
        for (const [id, r] of Object.entries(races)) say(`    ${phase} ${id}: tag ${r.tag ?? "none"} (${r.tagKind ?? "-"}, class ${r.tagClass ?? "-"}, href ${r.href ?? "-"}) · qualifier ${r.qualifier ?? "none"} · heading ${JSON.stringify(r.heading)}`);
        // leg 6: captures
        for (const id of CAPTURE) for (const m of MODES) {
          const p = await newPage(m.w, m.h, m.rm);
          await p.page.goto(`http://127.0.0.1:${PORT}/race/${id}`, { waitUntil: "networkidle" });
          await p.page.screenshot({ path: path.join(shots, `${phase}-${id}-${m.tag}.png`), fullPage: true });
          await p.ctx.close();
        }
        for (const m of MODES) {
          const p = await newPage(m.w, m.h, m.rm);
          await p.page.goto(`http://127.0.0.1:${PORT}/electoral`, { waitUntil: "networkidle" });
          await p.page.locator("button.cart-viewtoggle-btn", { hasText: "LIST" }).first().click();
          await sleep(500);
          for (const id of LIST_ROWS) {
            const seat = id.replace(/-2026$/, "").replace(/^S-(\w\w)$/, "$1 SEN");
            const li = p.page.locator("li.race-list-item", { has: p.page.locator(".race-list-seat", { hasText: seat }) }).first();
            if (await li.count()) await li.screenshot({ path: path.join(shots, `${phase}-list-${id}-${m.tag}.png`) });
          }
          // the pinned card: search TX-35 pins Texas
          await p.page.locator("button.cart-viewtoggle-btn", { hasText: "MAP" }).first().click();
          await p.page.locator("form.cart-search input").first().fill("TX-35");
          await p.page.locator("form.cart-search input").first().press("Enter");
          await sleep(700);
          const pinned = p.page.locator(".cart-report").first();
          if (await pinned.count()) await pinned.screenshot({ path: path.join(shots, `${phase}-pinned-TX-${m.tag}.png`) });
          await p.ctx.close();
        }
        // the district card: Texas's modal, the TX-35 chip
        {
          const p = await newPage();
          await p.page.goto(`http://127.0.0.1:${PORT}/electoral`, { waitUntil: "networkidle" });
          const label = p.page.locator("text.us-map-label", { hasText: "TX" }).first();
          if (await label.count()) {
            await label.click();
            await sleep(900);
            const chip = p.page.locator("button.rdm-chip", { hasText: "TX-35" }).first();
            if (await chip.count()) { await chip.click(); await sleep(600); }
            const panel = p.page.locator(".rdm-panel").first();
            if (await panel.count()) await panel.screenshot({ path: path.join(shots, `${phase}-district-TX-35-1440.png`) });
            out.district = (await p.page.evaluate(`(() => { ${NORM} const c = document.querySelector('.rdc'); const t = c ? c.querySelector('[data-incumbent-tag]') : null; return { card: !!c, tag: t ? norm(t.textContent) : null }; })()`)) as unknown;
          } else out.district = { card: false, tag: null, note: "no TX label" };
          await p.ctx.close();
        }
        // the dashboard's Races panel
        for (const m of MODES) {
          const p = await newPage(m.w, m.h, m.rm);
          await p.page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
          const tab = p.page.locator("button.dv2-racesbox-tab", { hasText: "Races" }).first();
          if (await tab.count()) { await tab.click(); await sleep(600); }
          const strip = p.page.locator(".race-card").first().locator("xpath=..");
          if (await strip.count()) await strip.screenshot({ path: path.join(shots, `${phase}-dashboard-cards-${m.tag}.png`) });
          await p.ctx.close();
        }
      } finally { await srv.kill(); }
    }
    // leg 3: the plant copy, clock today
    {
      const srv = await startServer(phase === "before" ? "hplant" : "plant", null);
      try {
        const r: Record<string, RaceReading> = {};
        for (const id of [PLANT.namesake.race, PLANT.truename.race]) {
          const { ctx, page } = await newPage();
          await page.goto(`http://127.0.0.1:${PORT}/race/${id}`, { waitUntil: "networkidle" });
          r[id] = (await page.evaluate(READ_RACE)) as RaceReading;
          await ctx.close();
        }
        out.plantToday = r;
        for (const [id, x] of Object.entries(r)) say(`    ${phase} ${id} (plant, today): tag ${x.tag ?? "none"} · qualifier ${x.qualifier ?? "none"}`);
      } finally { await srv.kill(); }
    }
    // leg 4: the plant copy, Nov 4
    {
      const srv = await startServer(phase === "before" ? "hplant" : "plant", NOV4);
      try {
        const r: Record<string, RaceReading> = {};
        for (const id of [PLANT.decided.race, PLANT.undecided.race]) {
          const { ctx, page } = await newPage();
          await page.goto(`http://127.0.0.1:${PORT}/race/${id}`, { waitUntil: "networkidle" });
          r[id] = (await page.evaluate(READ_RACE)) as RaceReading;
          for (const m of MODES.slice(0, 1)) await page.screenshot({ path: path.join(shots, `${phase}-nov4-${id}-${m.tag}.png`), fullPage: true });
          await ctx.close();
        }
        out.plantNov4 = r;
        for (const [id, x] of Object.entries(r)) say(`    ${phase} ${id} (plant, Nov 4): tag ${x.tag ?? "none"} · qualifier ${x.qualifier ?? "none"}`);
      } finally { await srv.kill(); }
    }
  } finally {
    await browser.close();
  }
  out.errors = errors;
  writeFileSync(path.join(ART, `phase-${phase}-${LABEL}.json`), JSON.stringify(out, null, 1));
  await prodUntouched(phase, fp0, t0);
  evaluate(phase, out);
}

// ── the checks, on either phase's readings (HEAD's are the red) ────────────
function evaluate(phase: string, o: Record<string, unknown>) {
  const tag = phase === "before" ? "red: HEAD" : "green: the tree";
  const races = o.races as Record<string, RaceReading>;
  const table = JSON.parse(readFileSync(path.join(ART, `table-${LABEL}.json`), "utf8")) as Record<string, { tag: string }>;
  // leg 0: unchanged elsewhere
  if (phase === "after") {
    const b = JSON.parse(readFileSync(path.join(DIR, `unchanged-before-${LABEL}.json`), "utf8")) as { mains: Record<string, { raw: string; norm: string }>; list: Record<string, ListRow>; cards: Record<string, ListRow> };
    const a = JSON.parse(readFileSync(path.join(DIR, `unchanged-after-${LABEL}.json`), "utf8")) as typeof b;
    const ids = Object.keys(a.mains);
    const rawDiffer = ids.filter((id) => a.mains[id]!.raw !== b.mains[id]!.raw);
    const normDiffer = ids.filter((id) => a.mains[id]!.norm !== b.mains[id]!.raw);
    const tagged = new Set(Object.keys(table));
    // The heading rule is "no majors block", not "Louisiana": it also reaches HO 757's four stub
    // pages, whose rosters carry only others (a1's first reading found them).
    const noMajors = ids.filter((id) => />On the ballot</.test(a.mains[id]!.raw) && !/>On the ballot</.test(b.mains[id]!.raw));
    const la = noMajors.filter((id) => id.startsWith("LA-"));
    const stub757 = ["AZ-03-2026", "MA-01-2026", "NJ-08-2026", "S-SD-2026"];
    const expected = new Set([...tagged, ...noMajors]);
    const unexpected = rawDiffer.filter((id) => !expected.has(id));
    const missing = [...tagged].filter((id) => !rawDiffer.includes(id));
    const noMajorsOk = la.length === 6 && JSON.stringify(noMajors.filter((id) => !id.startsWith("LA-")).sort()) === JSON.stringify(stub757);
    check("0", `${tag} · clock today: the race pages that differ from HEAD's are exactly the 94 tagged and the ten whose roster has no majors block (Louisiana's six, HO 757's four: ${stub757.join(", ")})`, unexpected.length === 0 && missing.length === 0 && noMajorsOk, `${rawDiffer.length} of ${ids.length} differ (tagged ${tagged.size}, no majors block ${noMajors.length}: LA ${la.length}, others ${noMajors.filter((id) => !id.startsWith("LA-")).join(", ") || "none"}) · unexpected ${unexpected.join(", ") || "none"} · tagged but unchanged ${missing.join(", ") || "none"}`);
    check("0", `${tag} · every race page's <main>, with the tag taken out and the heading put back, equals HEAD's byte for byte`, normDiffer.length === 0, `${ids.length - normDiffer.length} of ${ids.length} equal${normDiffer.length ? ` · differ: ${normDiffer.slice(0, 8).join(", ")}` : ""}`);
    const listKeys = Object.keys(a.list);
    const listTagged = listKeys.filter((k) => a.list[k]!.tag);
    const listChanged = listKeys.filter((k) => a.list[k]!.html !== b.list[k]?.html);
    const listUntaggedChanged = listChanged.filter((k) => !a.list[k]!.tag);
    check("0", `${tag} · /electoral's list: only the rows carrying a tag differ from HEAD's (${listTagged.length} tagged, the rated share of the 94)`, listUntaggedChanged.length === 0 && listKeys.length === Object.keys(b.list).length && listTagged.length === 27, `${listKeys.length} rows · ${listChanged.length} changed · untagged changed ${listUntaggedChanged.join(", ") || "none"}`);
    const linkLost = listKeys.filter((k) => b.list[k] && !!b.list[k]!.memberLink !== !!a.list[k]!.memberLink);
    check("0", `${tag} · /electoral's list: every row keeps HEAD's /members link or its absence (HO 759's review: a tagged row had dropped it)`, linkLost.length === 0 && listKeys.some((k) => a.list[k]!.tag && a.list[k]!.memberLink), `${listKeys.filter((k) => a.list[k]!.memberLink).length} rows link a member · differ from HEAD: ${linkLost.join(", ") || "none"}`);
    const cardKeys = Object.keys(a.cards);
    const cardUntaggedChanged = cardKeys.filter((k) => a.cards[k]!.html !== b.cards[k]?.html && !a.cards[k]!.tag);
    const cardExpected = cardKeys.filter((k) => tagged.has(k));
    check("0", `${tag} · the dashboard's cards: only a card whose seat is tagged differs, and every such card carries its tag`, cardUntaggedChanged.length === 0 && cardExpected.every((k) => a.cards[k]!.tag) && cardKeys.length === Object.keys(b.cards).length, `${cardKeys.length} cards · tagged seats ${cardExpected.join(", ") || "none"} · untagged changed ${cardUntaggedChanged.join(", ") || "none"}`);
    const nested = o.cardNested as string[];
    check("0", `${tag} · no card carries an anchor inside its own (the tag is unlinked on RaceCard)`, nested.length === 0, nested.join(", ") || "none");
  }
  // leg 1: the kinds, on the page
  for (const c of CASES) {
    const x = races[c.race]!;
    const ok = c.want === null ? x.tag === null : x.tag === c.want && x.tagKind === c.kind && (c.href ? x.href === c.href : x.href === null);
    check("1", `${tag} · ${c.race}, ${c.note}: ${c.want ?? "no tag"}${c.href ? ` linking ${c.href}` : ""}`, ok, `tag ${x.tag ?? "none"} (${x.tagKind ?? "-"}) · href ${x.href ?? "-"} · class ${x.tagClass ?? "-"}`);
  }
  // leg 2
  for (const id of SENATE_CURATED) {
    const x = races[id]!;
    check("2", `${tag} · ${id} (curated zero, printed in its state's Senate race) reads RUNNING FOR SENATE, not RETIRING`, x.tag === "RUNNING FOR SENATE" && x.tagKind === "senate", `tag ${x.tag ?? "none"}`);
  }
  // leg 3
  { const p = o.plantToday as Record<string, RaceReading>;
    const az = p[PLANT.namesake.race]!, sd = p[PLANT.truename.race]!;
    check("3", `${tag} · plant copy: AZ-05 with the namesake's row reads NOT ON THE BALLOT, not LOST PRIMARY`, az.tag === "NOT ON THE BALLOT", `tag ${az.tag ?? "none"}`);
    check("3", `${tag} · plant copy: SD-AL with its incumbent's own unmarked row reads LOST PRIMARY (the control)`, sd.tag === "LOST PRIMARY", `tag ${sd.tag ?? "none"}`); }
  // leg 4
  { const p = o.plantNov4 as Record<string, RaceReading>;
    const d = p[PLANT.decided.race]!, u = p[PLANT.undecided.race]!;
    check("4", `${tag} · Nov 4, TX-35 marked (decided): HO 758's "not on the ballot" and no tag`, d.qualifier === "not on the ballot" && d.tag === null, `qualifier ${d.qualifier ?? "none"} · tag ${d.tag ?? "none"}`);
    check("4", `${tag} · Nov 4, IA-02 unmarked (undecided): RUNNING FOR SENATE and no HO 758 qualifier`, u.tag === "RUNNING FOR SENATE" && u.qualifier === null, `qualifier ${u.qualifier ?? "none"} · tag ${u.tag ?? "none"}`); }
  // leg 5
  { const la = races[LA]!, co = races[CO8]!;
    check("5", `${tag} · LA-01 (no majors block): the others' heading reads "On the ballot"`, JSON.stringify(la.heading) === JSON.stringify(["On the ballot"]), JSON.stringify(la.heading));
    check("5", `${tag} · CO-08 (majors above): the heading still reads "Also on the ballot"`, JSON.stringify(co.heading) === JSON.stringify(["Also on the ballot"]), JSON.stringify(co.heading)); }
  // leg 6: the compact surfaces carry each tag
  { const lt = o.listTags as Record<string, string>;
    const kinds = new Set(Object.values(lt).map((t) => (t.startsWith("RUNNING IN") ? "RUNNING IN" : t)));
    check("6", `${tag} · /electoral's list shows every tag: RUNNING IN, RUNNING FOR SENATE, RETIRING, WITHDREW, LOST PRIMARY, NOT ON THE BALLOT`, ["RUNNING IN", "RUNNING FOR SENATE", "RETIRING", "WITHDREW", "LOST PRIMARY", "NOT ON THE BALLOT"].every((k) => kinds.has(k)), [...kinds].join(" · ") || "none");
    check("6", `${tag} · Enter on TX-35's tag link in the list row follows it to /race/TX-37-2026, not the row's toggle (HO 759's review)`, o.enterNav === "/race/TX-37-2026", String(o.enterNav));
    check("6", `${tag} · the map's hover for Texas: TX-35's meta reads the rating, then the tag (HO 759's review: the ellipsized cell cuts the tag, never the rating)`, o.peek === "Greg Casar · Lean R · RUNNING IN TX-37", JSON.stringify(o.peek));
    const d = o.district as { card: boolean; tag: string | null };
    check("6", `${tag} · the district card (Texas's modal, TX-35) carries RUNNING IN TX-37`, d.card && d.tag === "RUNNING IN TX-37", JSON.stringify(d)); }
  const errs = o.errors as string[];
  check("*", `${tag} · no console error on any page this phase read`, errs.length === 0, errs.slice(0, 6).join(" | ") || "none");
}

async function main() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const blob = (f: string) => (existsSync(f) ? execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim().slice(0, 10) : "absent");
  say(`=== HO 759 legs · ${LABEL} · ${new Date().toISOString()} · tree ${tree} · qualifier ${blob("lib/incumbent-qualifier.ts")} tag ${blob("components/IncumbentTag.tsx")} queries ${blob("lib/queries.ts")} card ${blob("components/RaceIncumbentCard.tsx")} · driver ${blob("scripts/diagnostic/incumbent-tag-legs-759.ts")} ===`);
  if (process.argv.includes("--seed")) await seed();
  if (process.argv.includes("--inprocess")) await inProcess();
  if (argAt("--phase")) await phaseRun();
  // The checks again on a phase's saved readings, no server (a corrected expectation, not a new run).
  if (argAt("--evaluate")) evaluate(argAt("--evaluate")!, JSON.parse(readFileSync(path.join(ART, `phase-${argAt("--evaluate")}-${LABEL}.json`), "utf8")) as Record<string, unknown>);
  say(`${LABEL}: ${passes} PASS · ${fails} FAIL`);
}
main().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
