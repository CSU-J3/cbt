// HO 757 legs: third parties and independents on race rosters, ruled C, on `file:` copies
// seeded whole from prod, each leg seen red before green.
//
//   npx tsx scripts/diagnostic/third-parties-legs-757.ts --seed --label L      # template, both copies
//   npx tsx scripts/diagnostic/third-parties-legs-757.ts --legs 1,2,3 --label L
//   (HEAD build)  npx tsx scripts/diagnostic/third-parties-legs-757.ts --legs 4 --phase before --label L
//   (tree build)  npx tsx scripts/diagnostic/third-parties-legs-757.ts --legs 4 --phase after --label L
//
// Two copies of one seed. `head` is harvested by HEAD's harvest (lib/harvest-challengers.ts at
// 0ad8aea, loaded with `git cat-file`), `new` by the working tree's. Legs 1 and 3 run the same
// checks on both: the head copy is the red, the new copy the green.
//   1 the plan    the `on_ballot` rows equal a derivation from the copy's ballot (STEP 0's scope
//                 rule and the same incumbent helpers; the letters from an explicit table of the
//                 44 printed labels, not the harvest's rule), by printed party and by letter;
//                 none in a top-two or top-four state, none in a curated race, no write-in, no
//                 withdrawn-only row, never the incumbent (exercised on a perturb copy that plants
//                 an other as the stored incumbent, since prod's data has none); the majors' rows
//                 equal the head copy's; the payload counts them
//   2 readers     lib/queries.ts's readers run outside Next under next-cache-stub-757.mjs, in
//                 child processes: every index race's matchup (deriveMatchup over
//                 getRaceCandidates), its active challengers, the /electoral cartogram
//                 (getRaceCandidatesForCycle) and the PAC-target rungs (getPacIeSpending) read
//                 the same before (HEAD's queries, head copy) and after (the tree's, new copy);
//                 red: HEAD's queries on the new copy. The roster's ranking: getRaceRoster puts
//                 every `on_ballot` row after the majors and before `withdrew`, by name, with
//                 L/G/O kept (red: HEAD's roster read, getRaceCandidates, on the new copy)
//   3 fusion      every published row printed on more than one line carries the print whole;
//                 New York's majors carry theirs (NY-07); no single-line print is stored
//   4 render      the three capture races through a local production build on a copy, at 1440,
//                 2560 and 1440 with reduced motion, before (HEAD build, head copy) and after
//                 (tree build, new copy): the majors as before, "Also on the ballot" with three
//                 by name, the <details> fold that opens, fusion prints, the header count
//
// SAFETY. Prod is only READ, through a reader that refuses anything but SELECT: the seed, and a
// fingerprint (race_candidates by source and a sha256 of its rows, general_ballot, the schema,
// both routes' last cron_runs) before and after every mode. Every copy is `file:${abs}` from a
// path ending -757-legs.db, and children (migrate, the readers, the server) get that URL with
// TURSO_AUTH_TOKEN="" (not deleted: dotenv and Next's loader would refill a missing key). The
// server's transport is proved by a sentinel cron_runs row that exists only in the copy. Every
// printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactSecrets } from "@/lib/redact";
import { findIncumbentOnBallot, findIncumbentRow, type BallotPerson } from "@/lib/ballot-incumbent";

config({ path: ".env", quiet: true });

const HEAD_SHA = "0ad8aea";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/757-artifacts");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const STUB = "./scripts/diagnostic/next-cache-stub-757.mjs";
const PORT = 3757;
const ROUTE = "/api/cron/race-challengers";
// One sentinel per copy (the review: a shared one proved transport, not which copy).
const SENTINEL: Record<string, string> = { head: "2026-09-29T23:57:01.757Z", new: "2026-09-29T23:57:02.757Z", perturb: "2026-09-29T23:57:03.757Z" };
const SENTINELS = ["harvest:primary_winner", "harvest:general_ballot"];
const TX_STATES = new Set(["CA", "WA", "AK"]); // STEP 0's own copy of the calendar's top-two and top-four sets
const CAPTURE = ["CO-08-2026", "S-TN-2026", "NY-07-2026"];
// An other, with no bioguide, planted as its race's stored incumbent on the perturb copy (leg 1).
const PLANT = { race: "S-TN-2026", name: "Yoshi Matthews", last: "Matthews" };
const ORDER_RACE = "S-NE-2026"; // a withdrawn major and others on one page (leg 2's red named it)
const TABLES = ["races", "members", "member_ids", "race_ratings", "race_candidates", "kalshi_odds", "polymarket_odds", "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads"];

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
const say = (s: string) => console.log(redactSecrets(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const check = (leg: string, label: string, ok: boolean, detail: string) => {
  say(`  ${ok ? "PASS" : "FAIL"}  [leg ${leg}] ${label}: ${detail}`);
  if (ok) passes++; else fails++;
};
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

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
  const hash = async (sql: string) => createHash("sha256").update(JSON.stringify((await read(sql)).rows.map((r) => Object.values(r)))).digest("hex").slice(0, 16);
  const bySource = (await read(`SELECT source_url, COUNT(*) AS n FROM race_candidates WHERE source_url IN (?, ?) GROUP BY source_url ORDER BY source_url`, SENTINELS)).rows.map((r) => `${r.source_url}=${r.n}`);
  const runs = (await read(`SELECT route, MAX(id) AS id FROM cron_runs WHERE route IN (?, '/api/cron/general-ballot') GROUP BY route ORDER BY route`, [ROUTE])).rows.map((r) => `${r.route}#${r.id}`);
  const fp = { race_candidates: bySource, rc_sha: await hash(`SELECT * FROM race_candidates ORDER BY race_id, name`), gb_sha: await hash(`SELECT * FROM general_ballot ORDER BY race_id, person_key`), schema_sha: await hash(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`), runs };
  db.close();
  return JSON.stringify(fp);
}

// ── copies ──────────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-757-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-757-legs.db")) throw new Error(`refused: a copy must be a *-757-legs.db file (got ${abs})`);
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
function headModule(file: string, name: string): string {
  const src = execFileSync("git", ["cat-file", "-p", `${HEAD_SHA}:${file}`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  const out = path.join(DIR, `head-${name}-757.ts`);
  writeFileSync(out, src.replace(/from "\.\/([^"]+)"/g, 'from "@/lib/$1"').replace(/from "\.\.\/([^"]+)"/g, 'from "@/$1"'));
  return out;
}

async function seed() {
  mkdirSync(DIR, { recursive: true });
  const fp0 = await prodFingerprint();
  say(`prod before: ${fp0}`);
  const tpl = copyPath("template");
  const url = copyUrl(tpl);
  if (existsSync(tpl)) rmSync(tpl);
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: childEnv(url), encoding: "utf8" });
  if (mig.status !== 0) throw new Error(`migrate against the template failed: ${redactSecrets((mig.stderr || mig.stdout).slice(-600))}`);
  const prod = prodClient();
  const read = reader(prod);
  const counts: string[] = [];
  await withDb(url, async (db) => {
    // The copy mirrors prod's rows table by table, so the order of the seed, not the rows, would
    // trip a foreign key; the harvests below run with the default.
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
  say(`template ${path.basename(tpl)}: the real scripts/migrate.ts against file:, seeded whole from prod · ${counts.join(" · ")}`);
  const headHarvest = (await import(pathToFileURL(headModule("lib/harvest-challengers.ts", "harvest")).href)) as { harvestChallengers: (db: Client) => Promise<unknown> };
  const treeHarvest = (await import("@/lib/harvest-challengers")) as { harvestChallengers: (db: Client) => Promise<unknown> };
  for (const [kind, h] of [["head", headHarvest], ["new", treeHarvest]] as const) {
    const abs = copyPath(kind);
    copyFileSync(tpl, abs);
    await withDb(copyUrl(abs), (db) => db.execute({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 757, 'success', ?)`, args: [ROUTE, SENTINEL[kind]!, SENTINEL[kind]!, JSON.stringify({ sentinel: `HO 757 legs, the ${kind} copy only` })] }));
    const result = await withDb(copyUrl(abs), (db) => h.harvestChallengers(db));
    writeFileSync(path.join(ART, `harvest-${kind}-${LABEL}.json`), JSON.stringify(result, null, 1));
    say(`copy ${path.basename(abs)} harvested by ${kind === "head" ? `HEAD's harvest (${HEAD_SHA})` : "the tree's harvest"}`);
  }
  // The incumbent clause cannot fail on prod's data (STEP 0: 0 non-major incumbents in scope). So a
  // third copy plants one: an other on a ballot is made the race's stored incumbent (a synthetic
  // member, identity by bioguide), and the tree's harvest runs on it.
  const pAbs = copyPath("perturb");
  copyFileSync(tpl, pAbs);
  const pUrl = copyUrl(pAbs);
  await withDb(pUrl, async (db) => {
    await db.execute("PRAGMA foreign_keys = OFF");
    await db.batch([
      { sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 757, 'success', '{"sentinel":"HO 757 legs, the perturb copy only"}')`, args: [ROUTE, SENTINEL.perturb!, SENTINEL.perturb!] },
      { sql: `INSERT INTO members (bioguide_id, name, last_name, party, raw_json, fetched_at) VALUES ('Z757000', 'HO 757 planted incumbent', ?, 'I', '{}', '2026-09-29T00:00:00Z')`, args: [PLANT.last] },
      { sql: `UPDATE races SET incumbent_bioguide_id = 'Z757000' WHERE id = ?`, args: [PLANT.race] },
      { sql: `UPDATE general_ballot SET bioguide_id = 'Z757000' WHERE race_id = ? AND name = ?`, args: [PLANT.race, PLANT.name] },
    ], "write");
  });
  const perturbed = await withDb(pUrl, (db) => treeHarvest.harvestChallengers(db));
  writeFileSync(path.join(ART, `harvest-perturb-${LABEL}.json`), JSON.stringify(perturbed, null, 1));
  say(`copy ${path.basename(pAbs)}: ${PLANT.name} (${PLANT.race}) planted as the stored incumbent, harvested by the tree's harvest`);
  const fp1 = await prodFingerprint();
  say(`prod after:  ${fp1}`);
  check("*", "prod untouched by the seed", fp0 === fp1, fp0 === fp1 ? "fingerprints equal" : "FINGERPRINTS DIFFER");
}

// ── the independent derivation (STEP 0's rule) ──────────────────────────────
type Gb = BallotPerson & { race_id: string; party: string | null; printed_party: string | null; write_in: number; withdrawn: number; primary_marked: number };
type Rc = { race_id: string; name: string; party: string | null; bioguide_id: string | null; status: string | null; source_url: string | null; printed_party: string | null };
// The letters, as an explicit table of every printed label STEP 0 read in scope (44), each placed by
// the ruling's words (Libertarian L, Green G, Independent / No party / Unaffiliated I, anything else
// O), not by the harvest's rule (the review: a copy of the rule would share its mistakes). A label
// missing from the table is a FAIL, never a guess.
const LETTER_TABLE: Record<string, "L" | "G" | "I" | "O"> = {
  "L": "L",
  "G": "G", "Pacific Green Party of Oregon": "G", "Pacific Green Party of Oregon / Progressive Party": "G",
  "Independent": "I", "No Party Affiliation": "I", "Unaffiliated": "I", "Nonpartisan": "I", "Unenrolled": "I", "No Political Party": "I",
  "Working Class Party": "O", "Constitution Party": "O", "U.S. Taxpayers Party": "O", "Unity Party": "O", "Independent American Party": "O",
  "No Labels Party": "O", "American Constitution Party": "O", "Kentucky Party": "O", "Natural Law Party in Michigan": "O",
  "America First Party Nebraska": "O", "Legal Marijuana Now Party": "O", "Nebraska Working People Party": "O", "Socialist Workers Party": "O",
  "Party for Socialism and Liberation": "O", "Florida Forward Party": "O", "Independent Party of Florida": "O",
  "Affordability, Accountability, People Party": "O", "Humane Sustainable Future Party": "O", "We The People Party": "O",
  "Save Our Babies Party": "O", "Hope for Tomorrow Party": "O", "Our Future Party": "O", "Karen Ortiz Party": "O", "For All of Us Party": "O",
  "Conservative Party": "O", "Speak The Truth Party": "O", "Independent Party": "O", "Approval Voting Party": "O", "Colorado Forward Party": "O",
  "American Center Party": "O", "American Independent Party": "O", "End the Corruption! Party": "O", "Workers Party": "O",
  "Independent American Party of Utah": "O",
};
function letterOf(printed: string | null): string {
  return (printed != null && LETTER_TABLE[printed]) || `UNMAPPED:${printed}`;
}
async function readCopy(kind: string) {
  return withDb(copyUrl(copyPath(kind)), async (db) => {
    const rc = (await db.execute(`SELECT race_id, name, party, bioguide_id, status, source_url, printed_party FROM race_candidates ORDER BY race_id, name`)).rows.map((r) => ({ race_id: String(r.race_id), name: String(r.name), party: r.party == null ? null : String(r.party), bioguide_id: r.bioguide_id == null ? null : String(r.bioguide_id), status: r.status == null ? null : String(r.status), source_url: r.source_url == null ? null : String(r.source_url), printed_party: r.printed_party == null ? null : String(r.printed_party) })) as Rc[];
    const gb = (await db.execute(`SELECT g.race_id, g.person_key, g.name, g.printed_party, g.party, g.bioguide_id, g.incumbent_marked, g.write_in, g.on_ballot, g.withdrawn, g.primary_marked FROM general_ballot g JOIN general_ballot_reads rd ON rd.race_id = g.race_id AND rd.status = 'box' ORDER BY g.race_id, g.person_key`)).rows.map((r) => ({ race_id: String(r.race_id), person_key: String(r.person_key), name: String(r.name), printed_party: r.printed_party == null ? null : String(r.printed_party), party: r.party == null ? null : String(r.party), bioguide_id: r.bioguide_id == null ? null : String(r.bioguide_id), incumbent_marked: Number(r.incumbent_marked), write_in: Number(r.write_in), on_ballot: Number(r.on_ballot), withdrawn: Number(r.withdrawn), primary_marked: Number(r.primary_marked) })) as Gb[];
    const races = new Map((await db.execute(`SELECT r.id, r.state, r.incumbent_bioguide_id, m.last_name FROM races r LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id WHERE r.cycle = 2026`)).rows.map((r) => [String(r.id), { state: String(r.state), incumbent: r.incumbent_bioguide_id == null ? null : String(r.incumbent_bioguide_id), lastName: r.last_name == null ? null : String(r.last_name) }]));
    return { rc, gb, races };
  });
}
function expectedOthers(gb: Gb[], races: Map<string, { state: string; incumbent: string | null; lastName: string | null }>, curated: Set<string>) {
  const byRace = new Map<string, Gb[]>();
  for (const g of gb) (byRace.get(g.race_id) ?? byRace.set(g.race_id, []).get(g.race_id)!).push(g);
  const out: { race_id: string; name: string; printed: string | null; letter: string; bioguide_id: string | null }[] = [];
  const incumbents = new Map<string, Gb | null>();
  for (const [id, rows] of byRace) {
    const race = races.get(id);
    if (!race || TX_STATES.has(race.state) || curated.has(id)) continue;
    const stored = race.incumbent ? { bioguideId: race.incumbent, lastName: race.lastName } : null;
    const inc = stored ? findIncumbentOnBallot(rows, stored).row : null;
    const any = findIncumbentRow(rows, stored);
    incumbents.set(id, inc ?? any);
    for (const g of rows) {
      if (g.on_ballot !== 1 || g.write_in !== 0 || g.party === "D" || g.party === "R" || g === inc || g === any) continue;
      out.push({ race_id: id, name: g.name, printed: g.printed_party, letter: letterOf(g.printed_party), bioguide_id: g.bioguide_id });
    }
  }
  return { out, incumbents };
}
const tally = (xs: string[]) => { const m: Record<string, number> = {}; for (const x of xs) m[x] = (m[x] ?? 0) + 1; return Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))); };

async function leg1() {
  say(`\n── leg 1, the plan`);
  const head = await readCopy("head");
  const neu = await readCopy("new");
  const curated = new Set(neu.rc.filter((r) => r.source_url == null || !SENTINELS.includes(r.source_url)).map((r) => r.race_id));
  const { out: exp, incumbents } = expectedOthers(neu.gb, neu.races, curated);
  const expKeys = exp.map((e) => `${e.race_id}|${e.name}`).sort();
  say(`  expected (STEP 0's rule on the copy's ballot): ${exp.length} others in ${new Set(exp.map((e) => e.race_id)).size} races · STEP 0 read 331 in 195 on prod at 21:04Z`);
  say(`  by letter ${JSON.stringify(tally(exp.map((e) => e.letter)))}`);
  const gbKey = new Map(neu.gb.map((g) => [`${g.race_id}|${g.name}`, g]));
  const headMajors = head.rc.filter((r) => r.source_url && SENTINELS.includes(r.source_url)).map(({ race_id, name, party, bioguide_id, status }) => ({ race_id, name, party, bioguide_id, status }));
  for (const [kind, copy] of [["red: head copy", head], ["green: new copy", neu]] as const) {
    const on = copy.rc.filter((r) => r.status === "on_ballot");
    const keys = on.map((r) => `${r.race_id}|${r.name}`).sort();
    check("1", `${kind} · the on_ballot rows are exactly the expected others`, eq(keys, expKeys), `${on.length} published in ${new Set(on.map((r) => r.race_id)).size} races against ${exp.length} expected · missing ${expKeys.filter((k) => !keys.includes(k)).length} · extra ${keys.filter((k) => !expKeys.includes(k)).length}`);
    const printedGot = tally(on.map((r) => gbKey.get(`${r.race_id}|${r.name}`)?.printed_party ?? "(no ballot row)"));
    check("1", `${kind} · by printed party, as STEP 0 counts it`, eq(printedGot, tally(exp.map((e) => e.printed ?? "(null)"))), `${Object.keys(printedGot).length} printed parties · top ${JSON.stringify(Object.fromEntries(Object.entries(printedGot).slice(0, 5)))}`);
    const letters = tally(on.map((r) => r.party ?? "null"));
    const unmapped = exp.filter((e) => e.letter.startsWith("UNMAPPED")).map((e) => e.printed);
    check("1", `${kind} · by roster letter, against the table of the 44 printed labels`, unmapped.length === 0 && on.length > 0 && eq(letters, tally(exp.map((e) => e.letter))) && on.every((r) => r.party === exp.find((e) => e.race_id === r.race_id && e.name === r.name)?.letter), `${JSON.stringify(letters)}${unmapped.length ? ` · unmapped ${JSON.stringify([...new Set(unmapped)])}` : ""}`);
    check("1", `${kind} · none in a top-two or top-four state`, on.length > 0 && on.every((r) => !TX_STATES.has(copy.races.get(r.race_id)?.state ?? "")), `${on.filter((r) => TX_STATES.has(copy.races.get(r.race_id)?.state ?? "")).length} in CA/WA/AK of ${on.length}`);
    check("1", `${kind} · none in a curated race`, on.length > 0 && on.every((r) => !curated.has(r.race_id)), `${on.filter((r) => curated.has(r.race_id)).length} in the ${curated.size} curated races of ${on.length}`);
    check("1", `${kind} · no write-in and no withdrawn-only row`, on.length > 0 && on.every((r) => { const g = gbKey.get(`${r.race_id}|${r.name}`); return !!g && g.on_ballot === 1 && g.write_in === 0; }), `${on.filter((r) => { const g = gbKey.get(`${r.race_id}|${r.name}`); return !g || g.on_ballot !== 1 || g.write_in !== 0; }).length} of ${on.length} not a printed, non-write-in ballot row`);
    check("1", `${kind} · never the incumbent (on prod's data the clause has nothing to exclude: STEP 0 read 0)`, on.length > 0 && on.every((r) => { const inc = incumbents.get(r.race_id); const race = copy.races.get(r.race_id); return !(inc && inc.name === r.name) && !(r.bioguide_id && r.bioguide_id === race?.incumbent); }), `${on.filter((r) => r.bioguide_id && r.bioguide_id === copy.races.get(r.race_id)?.incumbent).length} carry the seat's bioguide`);
    const majors = copy.rc.filter((r) => r.source_url && SENTINELS.includes(r.source_url) && r.status !== "on_ballot").map(({ race_id, name, party, bioguide_id, status }) => ({ race_id, name, party, bioguide_id, status }));
    check("1", `${kind} · the majors' rows equal HEAD's harvest, row for row`, eq(majors, headMajors), `${majors.length} against ${headMajors.length}`);
    const pay = JSON.parse(readFileSync(path.join(ART, `harvest-${kind.startsWith("red") ? "head" : "new"}-${LABEL}.json`), "utf8")) as { onBallot?: { rows: number; races: number; byParty: Record<string, number> } };
    check("1", `${kind} · the payload counts them`, pay.onBallot?.rows === exp.length && pay.onBallot?.races === new Set(exp.map((e) => e.race_id)).size && eq(Object.fromEntries(Object.entries(pay.onBallot?.byParty ?? {}).sort()), Object.fromEntries(Object.entries(tally(exp.map((e) => e.letter))).sort())), `payload onBallot ${JSON.stringify(pay.onBallot ?? null)}`);
  }
  // The incumbent clause, exercised on the perturb copy: the planted other is published on the new
  // copy and not on the perturbed one, and nothing else in the race moves.
  const pert = await readCopy("perturb");
  const onNew = neu.rc.filter((r) => r.race_id === PLANT.race && r.status === "on_ballot").map((r) => r.name).sort();
  const onPert = pert.rc.filter((r) => r.race_id === PLANT.race && r.status === "on_ballot").map((r) => r.name).sort();
  // Only the race's other others: re-pointing the stored incumbent frees the real incumbent's row,
  // which then publishes as a major, as it should.
  const restNew = neu.rc.filter((r) => r.race_id === PLANT.race && r.name !== PLANT.name && r.status === "on_ballot").map((r) => `${r.name}|${r.party}`).sort();
  const restPert = pert.rc.filter((r) => r.race_id === PLANT.race && r.name !== PLANT.name && r.status === "on_ballot").map((r) => `${r.name}|${r.party}`).sort();
  check("1", `the incumbent clause, exercised: ${PLANT.name}, planted as ${PLANT.race}'s stored incumbent, is not published`, onNew.includes(PLANT.name) && !pert.rc.some((r) => r.race_id === PLANT.race && r.name === PLANT.name) && restNew.length > 0 && eq(restNew, restPert), `new copy on_ballot ${onNew.length} (${PLANT.name} among them: ${onNew.includes(PLANT.name)}) · perturb copy on_ballot ${onPert.length} (among them: ${onPert.includes(PLANT.name)}) · the race's ${restNew.length} other others equal ${eq(restNew, restPert)}`);
}

async function leg3() {
  say(`\n── leg 3, fusion prints and the O others' parties`);
  const neu = await readCopy("new");
  const gbKey = new Map(neu.gb.map((g) => [`${g.race_id}|${g.name}`, g]));
  for (const kind of ["head", "new"] as const) {
    const copy = kind === "head" ? await readCopy("head") : neu;
    const tag = kind === "head" ? "red: head copy" : "green: new copy";
    const published = copy.rc.filter((r) => r.source_url === "harvest:general_ballot" && r.status !== "withdrew");
    const expected = published.filter((r) => (gbKey.get(`${r.race_id}|${r.name}`)?.printed_party ?? "").includes("/"));
    const carrying = copy.rc.filter((r) => r.printed_party != null);
    check("3", `${tag} · every published row printed on more than one line carries the print whole`, expected.length > 0 && expected.every((r) => r.printed_party === gbKey.get(`${r.race_id}|${r.name}`)?.printed_party), `${expected.filter((r) => r.printed_party === gbKey.get(`${r.race_id}|${r.name}`)?.printed_party).length} of ${expected.length} (${expected.filter((r) => r.status !== "on_ballot").length} majors, ${expected.filter((r) => r.status === "on_ballot").length} others) · by state ${JSON.stringify(tally(expected.map((r) => copy.races.get(r.race_id)?.state ?? "?")))}`);
    const ny = copy.rc.filter((r) => r.race_id === "NY-07-2026" && (r.status === "won_primary" || r.status === "nominee")).map((r) => `${r.name} · ${r.printed_party}`);
    check("3", `${tag} · New York's majors carry their lines (NY-07)`, ny.length >= 2 && ny.every((s) => / \/ /.test(s)), ny.join(" | ") || "no majors");
    // The amendment: an other lettered O (by the 44-label table) keeps its single-line party.
    const oOthers = copy.rc.filter((r) => r.status === "on_ballot" && letterOf(gbKey.get(`${r.race_id}|${r.name}`)?.printed_party ?? null) === "O");
    const oExpected = kind === "head" ? 67 : oOthers.length;
    check("3", `${tag} · every O other carries its printed party, whole (the architect's amendment)`, oOthers.length === 67 && oOthers.every((r) => r.printed_party != null && r.printed_party === gbKey.get(`${r.race_id}|${r.name}`)?.printed_party), `${oOthers.filter((r) => r.printed_party != null && r.printed_party === gbKey.get(`${r.race_id}|${r.name}`)?.printed_party).length} of ${oOthers.length} O others (67 at STEP 0, expected ${oExpected}) · e.g. ${oOthers.filter((r) => r.race_id === "NY-07-2026").map((r) => `${r.name} · ${r.printed_party}`).join(" | ") || "none"}`);
    const oKeys = new Set(oOthers.map((r) => `${r.race_id}|${r.name}`));
    const pay = JSON.parse(readFileSync(path.join(ART, `harvest-${kind}-${LABEL}.json`), "utf8")) as { fusionPrints?: number; oPrints?: number };
    check("3", `${tag} · the payload counts the prints (fusion 29, O parties 67)`, pay.fusionPrints === 29 && pay.oPrints === 67, `fusionPrints ${pay.fusionPrints ?? "absent"} · oPrints ${pay.oPrints ?? "absent"}`);
    check("3", `${tag} · no other single-line print stored, and none on a withdrew row`, carrying.every((r) => (r.printed_party!.includes("/") || oKeys.has(`${r.race_id}|${r.name}`)) && r.status !== "withdrew"), `${carrying.length} rows carry a print · ${carrying.filter((r) => !r.printed_party!.includes("/")).length} single-line (${carrying.filter((r) => !r.printed_party!.includes("/") && !oKeys.has(`${r.race_id}|${r.name}`)).length} of them not an O other) · ${carrying.filter((r) => r.status === "withdrew").length} withdrew`);
  }
}

// ── leg 2: the readers, in child processes ─────────────────────────────────
type ReaderOut = { index: number; matchups: Record<string, unknown>; active: Record<string, string[]>; cartogram: string; pac: string; roster: Record<string, { name: string; party: string | null; status: string | null }[]> };
async function readersChild() {
  const which = argAt("--queries")!;
  const out = argAt("--out")!;
  const ids = JSON.parse(readFileSync(argAt("--ids")!, "utf8")) as string[];
  const q = (which === "head" ? await import(pathToFileURL(headModule("lib/queries.ts", "queries")).href) : await import("@/lib/queries")) as Record<string, (...a: unknown[]) => Promise<unknown>>;
  const { deriveMatchup, activeChallengers } = await import("@/lib/race-matchup");
  const { buildRacesCartogram } = await import("@/lib/cartogram-data");
  type Row = { raceId: string; incumbentBioguideId: string | null };
  const index = (await q.getRacesIndex!(2026)) as Row[];
  const matchups: Record<string, unknown> = {};
  const active: Record<string, string[]> = {};
  for (const row of index) {
    const c = (await q.getRaceCandidates!(row.raceId)) as never[];
    matchups[row.raceId] = deriveMatchup(row as never, c);
    active[row.raceId] = activeChallengers(c, row.incumbentBioguideId).map((x: { name: string }) => x.name);
  }
  const cycle = await q.getRaceCandidatesForCycle!(2026);
  const pac = await q.getPacIeSpending!(2026);
  const cart = buildRacesCartogram(index as never, cycle as never, pac as never);
  const roster: ReaderOut["roster"] = {};
  const read = q.getRaceRoster ?? q.getRaceCandidates!;
  for (const id of ids) roster[id] = ((await read(id)) as { name: string; party: string | null; status: string | null }[]).map((r) => ({ name: r.name, party: r.party, status: r.status }));
  writeFileSync(out, JSON.stringify({ index: index.length, matchups, active, cartogram: JSON.stringify(cart), pac: JSON.stringify(pac), roster } satisfies ReaderOut));
}
function runReaders(which: "head" | "tree", kind: "head" | "new", ids: string): ReaderOut {
  const out = path.join(DIR, `readers-${which}-${kind}-${LABEL}.json`);
  if (existsSync(out)) rmSync(out);
  const r = spawnSync(process.execPath, [TSX, "--import", STUB, "scripts/diagnostic/third-parties-legs-757.ts", "--readers-child", "--queries", which, "--ids", ids, "--out", out, "--label", LABEL], { env: childEnv(copyUrl(copyPath(kind))), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`readers child ${which}/${kind} failed: ${redactSecrets((r.stderr || r.stdout).slice(-900))}`);
  return JSON.parse(readFileSync(out, "utf8")) as ReaderOut;
}
async function leg2() {
  say(`\n── leg 2, readers`);
  const neu = await readCopy("new");
  const ids = [...new Set(neu.rc.filter((r) => r.status === "on_ballot").map((r) => r.race_id))].sort();
  const idsFile = path.join(DIR, `ids-${LABEL}-757.json`);
  writeFileSync(idsFile, JSON.stringify(ids));
  const before = runReaders("head", "head", idsFile);
  const after = runReaders("tree", "new", idsFile);
  const red = runReaders("head", "new", idsFile);
  const control = runReaders("tree", "head", idsFile);
  say(`  index races ${before.index} · races with others ${ids.length}`);
  const diff = (a: Record<string, unknown>, b: Record<string, unknown>) => Object.keys({ ...a, ...b }).filter((k) => !eq(a[k], b[k]));
  for (const [tag, x] of [["red: HEAD's queries on the new copy", red], ["green: the tree's queries on the new copy", after], ["control: the tree's queries on the head copy", control]] as const) {
    const dm = diff(before.matchups, x.matchups);
    check("2", `${tag} · every index race's matchup reads as before`, dm.length === 0, `${dm.length} of ${before.index} differ${dm.length ? ` (e.g. ${dm.slice(0, 4).join(", ")})` : ""}`);
    const da = diff(before.active, x.active);
    check("2", `${tag} · every index race's active challengers read as before`, da.length === 0, `${da.length} differ${da.length ? ` (e.g. ${da.slice(0, 2).map((k) => `${k}: ${JSON.stringify(before.active[k])} → ${JSON.stringify(x.active[k])}`).join("; ")})` : ""}`);
    check("2", `${tag} · the /electoral cartogram reads as before`, before.cartogram === x.cartogram, `${before.cartogram.length} against ${x.cartogram.length} bytes`);
    check("2", `${tag} · the PAC-target rungs read as before`, before.pac === x.pac, `${before.pac.length} against ${x.pac.length} bytes`);
  }
  const RANK = (s: string | null) => (s === "won_primary" || s === "nominee" || s === "advanced" ? 0 : s === "running" ? 1 : s === "declared" ? 2 : s === "on_ballot" ? 3 : s === "withdrew" ? 4 : 5);
  for (const [tag, x] of [["red: HEAD's roster read (getRaceCandidates) on the new copy", red], ["green: getRaceRoster on the new copy", after]] as const) {
    const bad: string[] = [];
    let folded = 0, withdrewBefore = 0;
    for (const id of ids) {
      const rows = x.roster[id] ?? [];
      const ranks = rows.map((r) => RANK(r.status));
      if (!ranks.every((v, i) => i === 0 || ranks[i - 1]! <= v)) bad.push(id);
      const on = rows.filter((r) => r.status === "on_ballot").map((r) => r.name);
      if (!eq(on, [...on].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)))) bad.push(`${id} (names)`);
      const lastW = rows.map((r) => r.status).lastIndexOf("withdrew"), firstO = rows.map((r) => r.status).indexOf("on_ballot");
      if (lastW !== -1 && firstO !== -1 && lastW < firstO) withdrewBefore++;
      const exp = neu.rc.filter((r) => r.race_id === id && r.status === "on_ballot");
      folded += exp.filter((e) => rows.find((r) => r.name === e.name)?.party !== e.party).length;
    }
    check("2", `${tag} · on_ballot ranks after the majors and before withdrew, by name`, bad.length === 0 && withdrewBefore === 0, `${bad.length} races out of order${bad.length ? ` (e.g. ${bad.slice(0, 3).join(", ")})` : ""} · ${withdrewBefore} with withdrew above the others`);
    check("2", `${tag} · the roster keeps the others' letters (L, G, O)`, folded === 0, `${folded} letters folded`);
  }
}

// ── leg 4: render, through a local production build ────────────────────────
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
function buildState(phase: string): string {
  const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim();
  const headBlob = (f: string) => execFileSync("git", ["rev-parse", `${HEAD_SHA}:${f}`], { encoding: "utf8" }).trim();
  const files = ["components/RaceCandidates.tsx", "lib/queries.ts", "app/race/[id]/page.tsx"];
  const atHead = files.filter((f) => blob(f) === headBlob(f));
  const id = readFileSync(".next/BUILD_ID", "utf8").trim();
  const built = statSync(".next/BUILD_ID").mtime;
  const newest = Math.max(...files.map((f) => statSync(f).mtime.getTime()));
  const want = phase === "before" ? files.length : 0;
  if (atHead.length !== want) throw new Error(`phase ${phase} needs ${want} of ${files.length} files at HEAD, found ${atHead.length}`);
  if (built.getTime() < newest) throw new Error(`the build (${built.toISOString()}) is older than the tree's files; rebuild first`);
  return `build ${id} @ ${built.toISOString()} · ${atHead.length} of ${files.length} roster files at ${HEAD_SHA} · component ${blob(files[0]!).slice(0, 10)} queries ${blob(files[1]!).slice(0, 10)}`;
}
async function startServer(url: string, phase: string, kind: string) {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  // The on-disk Data Cache (unstable_cache entries, keyed on the reader's source and arguments)
  // survives builds and servers: the review found the g1 after-server serving getRace and the other
  // race-page readers from entries the before-server wrote reading the head copy. Cleared each time.
  const cache = path.resolve(".next/cache/fetch-cache");
  const n = existsSync(cache) ? readdirSync(cache).length : 0;
  rmSync(cache, { recursive: true, force: true });
  say(`  cleared .next/cache/fetch-cache (${n} entries)`);
  const log = path.join(DIR, `server757-${phase}-${LABEL}-${Date.now()}.log`);
  const out = createWriteStream(log);
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env: childEnv(url), stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (b: Buffer) => out.write(b));
  server.stderr.on("data", (b: Buffer) => out.write(b));
  const kill = async () => { try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } out.end(); await sleep(900); };
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`http://127.0.0.1:${PORT}/api/health`)).status > 0; } catch { /* not yet */ } }
  if (!up) { await kill(); throw new Error("the server never answered /api/health"); }
  const h = (await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json()) as { routes?: { path?: string; lastRunAt?: string }[] };
  const mine = h.routes?.find((r) => r.path === ROUTE);
  if (mine?.lastRunAt !== SENTINEL[kind]) { await kill(); throw new Error(`transport check failed: lastRunAt ${String(mine?.lastRunAt)} is not the ${kind} copy's sentinel ${SENTINEL[kind]}`); }
  say(`  server :${PORT} (pid ${server.pid}) reads ${path.basename(url)}: /api/health's ${ROUTE} lastRunAt is the ${kind} copy's own sentinel ${SENTINEL[kind]}`);
  return { kill, log };
}
// A string, not a function: tsx's keepNames wrapper does not exist in the page (HO 670/675), and
// no regex escapes (HO 736's template-literal trap). innerText applies text-transform, so labels
// are compared case-insensitively.
const READ_ROSTER = `(() => {
  const h2 = Array.from(document.querySelectorAll('h2')).find((h) => h.textContent.trim().toLowerCase().startsWith('candidates ('));
  if (!h2) return { header: null, majors: [], others: [], summary: null, alsoLabel: false };
  const section = h2.closest('section');
  const block = section.querySelector('[data-roster-others]');
  const liText = (li) => li.innerText.split(String.fromCharCode(10)).join(' ').split(String.fromCharCode(9)).join(' ').trim();
  // A row's text with the fusion print's span removed, from textContent (a clone has no layout,
  // so no text-transform): what the row said before HO 757, for comparing across the two builds.
  const bare = (li) => { const c = li.cloneNode(true); Array.from(c.querySelectorAll('span')).forEach((s) => { if (s.textContent.startsWith(' · ')) s.remove(); }); return c.textContent.split(' ').filter(Boolean).join(' ').toLowerCase(); };
  const all = Array.from(section.querySelectorAll('li'));
  const inOthers = (li) => !!block && block.contains(li);
  const det = block ? block.querySelector('details') : null;
  const sum = det ? det.querySelector('summary') : null;
  // checkVisibility, not a bounding box: Chrome hides a closed <details> body with
  // content-visibility: hidden, and its rows still report non-zero rects (the first run of this
  // leg read all eight S-TN rows "visible" beside a capture showing three).
  const visible = (li) => li.checkVisibility();
  return {
    header: h2.textContent.trim(),
    majors: all.filter((li) => !inOthers(li)).map(liText),
    majorsBare: all.filter((li) => !inOthers(li)).map(bare),
    // raw: textContent, since innerText reads nothing from a row a closed <details> hides (content-visibility).
    others: all.filter(inOthers).map((li) => ({ text: liText(li), raw: li.textContent, folded: !!det && det.contains(li), visible: visible(li) })),
    summary: sum ? sum.textContent.trim() : null,
    open: det ? det.open : null,
    alsoLabel: !!block && block.innerText.toLowerCase().includes('also on the ballot'),
  };
})()`;
type Reading = { header: string | null; majors: string[]; majorsBare: string[]; others: { text: string; raw: string; folded: boolean; visible: boolean }[]; summary: string | null; open: boolean | null; alsoLabel: boolean };
async function leg4() {
  const phase = argAt("--phase");
  if (phase !== "before" && phase !== "after") throw new Error("--phase before|after");
  say(`\n── leg 4, render (${phase}) · ${buildState(phase)}`);
  const fp0 = await prodFingerprint();
  const kind = phase === "before" ? "head" : "new";
  const neu = await readCopy("new");
  const shots = path.join(ART, "captures");
  mkdirSync(shots, { recursive: true });
  const { chromium } = await import("@playwright/test");
  const srv = await startServer(copyUrl(copyPath(kind)), phase, kind);
  const readings: Record<string, Reading> = {};
  try {
    const browser = await chromium.launch();
    const MODES = [
      { tag: "1440", w: 1440, h: 1200, rm: "no-preference" as const },
      { tag: "2560", w: 2560, h: 1440, rm: "no-preference" as const },
      { tag: "1440-reduced", w: 1440, h: 1200, rm: "reduce" as const },
    ];
    for (const id of CAPTURE) {
      for (const m of MODES) {
        const ctx = await browser.newContext({ viewport: { width: m.w, height: m.h }, reducedMotion: m.rm });
        const page = await ctx.newPage();
        const res = await page.goto(`http://127.0.0.1:${PORT}/race/${id}`, { waitUntil: "networkidle" });
        const r = (await page.evaluate(READ_ROSTER)) as Reading;
        readings[`${id}@${m.tag}`] = r;
        const h2 = page.locator("h2", { hasText: /^Candidates \(/i }).first();
        const section = h2.locator("xpath=ancestor::section[1]");
        const file = path.join(shots, `${phase}-${id}-${m.tag}.png`);
        await section.screenshot({ path: file });
        say(`    ${phase} ${id} @${m.tag}: HTTP ${res?.status()} · ${r.header} · majors ${r.majors.length} · others ${r.others.length} (${r.others.filter((o) => o.visible).length} visible) · summary ${r.summary ?? "none"} → ${path.relative(process.cwd(), file)}`);
        if (phase === "after" && id === "S-TN-2026" && m.tag === "1440") {
          await section.locator("summary").click();
          await sleep(300);
          const opened = (await page.evaluate(READ_ROSTER)) as Reading;
          readings[`${id}@${m.tag}+open`] = opened;
          const ofile = path.join(shots, `${phase}-${id}-${m.tag}-open.png`);
          await section.screenshot({ path: ofile });
          say(`    ${phase} ${id} @${m.tag} after a click on the summary: open ${opened.open} · others visible ${opened.others.filter((o) => o.visible).length} of ${opened.others.length} → ${path.relative(process.cwd(), ofile)}`);
        }
        await ctx.close();
      }
    }
    // The page's order where a race has both a withdrawn major and others (the review): the majors
    // as before, withdrew last among them, then the others' block. One reading and one capture.
    {
      const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 }, reducedMotion: "reduce" });
      const page = await ctx.newPage();
      const res = await page.goto(`http://127.0.0.1:${PORT}/race/${ORDER_RACE}`, { waitUntil: "networkidle" });
      const r = (await page.evaluate(READ_ROSTER)) as Reading;
      readings[`${ORDER_RACE}@order`] = r;
      const section = page.locator("h2", { hasText: /^Candidates \(/i }).first().locator("xpath=ancestor::section[1]");
      const file = path.join(shots, `${phase}-${ORDER_RACE}-order.png`);
      await section.screenshot({ path: file });
      say(`    ${phase} ${ORDER_RACE} (order): HTTP ${res?.status()} · ${r.header} · majors ${r.majorsBare.join(" | ")} · others ${r.others.length} → ${path.relative(process.cwd(), file)}`);
      await ctx.close();
    }
    await browser.close();
  } finally {
    await srv.kill();
  }
  // The before readings are read BEFORE this phase's are written, and only by the after phase, so
  // the before phase never compares itself with itself.
  const beforeFile = path.join(ART, `render-before-${LABEL}.json`);
  const before = phase === "after" && existsSync(beforeFile) ? (JSON.parse(readFileSync(beforeFile, "utf8")) as Record<string, Reading>) : null;
  if (phase === "after" && !before) throw new Error(`no before readings at ${beforeFile}; run --phase before on the HEAD build first`);
  writeFileSync(path.join(ART, `render-${phase}-${LABEL}.json`), JSON.stringify(readings, null, 1));
  for (const id of CAPTURE) {
    const exp = neu.rc.filter((r) => r.race_id === id && r.status === "on_ballot").map((r) => r.name).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    const majorsExp = neu.rc.filter((r) => r.race_id === id && r.status !== "on_ballot").length;
    for (const tag of ["1440", "2560", "1440-reduced"]) {
      const r = readings[`${id}@${tag}`]!;
      const b = before?.[`${id}@${tag}`];
      const lbl = `${phase} ${id} @${tag}`;
      if (phase === "after") check("4", `${lbl} · the majors read as before, less the fusion print`, !!b && Array.isArray(b.majorsBare) && eq(r.majorsBare, b.majorsBare) && r.majors.length > 0, b ? `${r.majorsBare.length} rows · ${r.majorsBare.join(" | ").slice(0, 160)}` : "no before reading for this key");
      check("4", `${lbl} · the header counts the whole roster`, r.header?.toLowerCase() === `candidates (${majorsExp + exp.length})`, `${r.header} against ${majorsExp} + ${exp.length}`);
      const shown = r.others.filter((o) => !o.folded).map((o) => o.text);
      check("4", `${lbl} · "Also on the ballot" shows the first three by name, "On ballot"`, r.alsoLabel && eq(shown.map((t) => exp.find((n) => t.includes(n)) ?? t), exp.slice(0, 3)) && shown.every((t) => /on ballot/i.test(t)), `${r.alsoLabel ? "label" : "no label"} · ${shown.join(" | ").slice(0, 200) || "none"}`);
      const rest = exp.length - 3;
      check("4", `${lbl} · the rest fold under "+N more on the ballot"`, rest > 0 ? r.summary?.toLowerCase().includes(`+${rest} more on the ballot`) === true && r.others.filter((o) => o.folded).length === rest && r.open === false && r.others.filter((o) => o.folded && o.visible).length === 0 : r.summary === null, `summary ${r.summary ?? "none"} · folded ${r.others.filter((o) => o.folded).length} (visible ${r.others.filter((o) => o.folded && o.visible).length}) · expected ${Math.max(rest, 0)}`);
    }
  }
  {
    const r = readings[`${ORDER_RACE}@order`]!;
    const b = before?.[`${ORDER_RACE}@order`];
    const withdrew = neu.rc.filter((x) => x.race_id === ORDER_RACE && x.status === "withdrew").map((x) => x.name);
    const lastIsWithdrew = withdrew.length > 0 && withdrew.some((n) => (r.majorsBare[r.majorsBare.length - 1] ?? "").includes(n.toLowerCase()));
    const others = neu.rc.filter((x) => x.race_id === ORDER_RACE && x.status === "on_ballot").length;
    check("4", `${phase} ${ORDER_RACE} · the page keeps withdrew last among the majors, then the others' block`, lastIsWithdrew && (phase === "before" || (!!b && eq(r.majorsBare, b.majorsBare))) && r.alsoLabel && r.others.length === others && others > 0, `majors ${r.majorsBare.length} (last: ${r.majorsBare[r.majorsBare.length - 1] ?? "none"}) · withdrew ${withdrew.join(", ") || "none"} · others shown ${r.others.length} of ${others}${b ? ` · majors as before ${eq(r.majorsBare, b.majorsBare)}` : ""}`);
  }
  if (phase === "after") {
    const o = readings["S-TN-2026@1440+open"];
    check("4", "after S-TN-2026 · the <details> opens and shows every folded row", !!o && o.open === true && o.others.filter((x) => x.folded).length > 0 && o.others.filter((x) => x.folded).every((x) => x.visible), o ? `open ${o.open} · ${o.others.filter((x) => x.folded && x.visible).length} of ${o.others.filter((x) => x.folded).length} folded rows visible` : "no reading");
  }
  // The amendment: every O other on the capture and order pages shows " · <printed party>" after its
  // name, and no L, G or I other shows a print (S-TN's eight are I; CO-08's is L).
  {
    const pages: [string, string][] = [["CO-08-2026", "CO-08-2026@1440"], ["S-TN-2026", "S-TN-2026@1440"], ["NY-07-2026", "NY-07-2026@1440"], [ORDER_RACE, `${ORDER_RACE}@order`]];
    const bad: string[] = [];
    let oSeen = 0, plainSeen = 0;
    for (const [id, key] of pages) {
      const r = readings[key]!;
      for (const x of neu.rc.filter((y) => y.race_id === id && y.status === "on_ballot")) {
        // textContent (raw): the folded rows are hidden, and innerText reads them empty.
        const row = r.others.find((o) => o.raw.includes(x.name));
        if (!row) { bad.push(`${x.name}: not on the page`); continue; }
        if (x.party === "O") { oSeen++; if (!x.printed_party || !row.raw.toLowerCase().includes(`${x.name} · ${x.printed_party}`.toLowerCase())) bad.push(`${x.name}: no party after the name`); }
        else { plainSeen++; if (row.raw.includes(" · ")) bad.push(`${x.name} (${x.party}): a print shown`); }
      }
    }
    check("4", `${phase} · an O other shows its printed party after the name, an L/G/I other shows none (the amendment)`, bad.length === 0 && oSeen > 0 && plainSeen > 0, `${oSeen} O rows and ${plainSeen} L/G/I rows read${bad.length ? ` · ${bad.slice(0, 5).join("; ")}` : ""} · NY-07: ${readings["NY-07-2026@1440"]!.others.map((o) => o.text).join(" | ")}`);
  }
  const ny = readings["NY-07-2026@1440"]!;
  const prints = neu.rc.filter((r) => r.race_id === "NY-07-2026" && r.printed_party && r.status !== "on_ballot").map((r) => `${r.name} · ${r.printed_party}`);
  check("4", `${phase} NY-07-2026 · fusion prints after the names`, prints.length >= 2 && prints.every((p) => ny.majors.some((t) => t.toLowerCase().includes(p.toLowerCase()))), `${ny.majors.join(" | ").slice(0, 240)} · expected ${prints.join(" | ")}`);
  const fp1 = await prodFingerprint();
  check("*", `prod untouched by leg 4 (${phase})`, fp0 === fp1, fp0 === fp1 ? "fingerprints equal" : "FINGERPRINTS DIFFER");
}

async function main() {
  if (process.argv.includes("--readers-child")) return readersChild();
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim().slice(0, 10);
  say(`=== HO 757 legs · ${LABEL} · ${new Date().toISOString()} · tree ${tree} · harvest ${blob("lib/harvest-challengers.ts")} queries ${blob("lib/queries.ts")} component ${blob("components/RaceCandidates.tsx")} · driver ${blob("scripts/diagnostic/third-parties-legs-757.ts")} stub ${blob("scripts/diagnostic/next-cache-stub-757.mjs")} ===`);
  if (process.argv.includes("--seed")) await seed();
  const legs = (argAt("--legs") ?? "").split(",").filter(Boolean);
  if (legs.length) {
    const fp0 = legs.some((l) => l !== "4") ? await prodFingerprint() : null;
    if (legs.includes("1")) await leg1();
    if (legs.includes("2")) await leg2();
    if (legs.includes("3")) await leg3();
    if (fp0) { const fp1 = await prodFingerprint(); check("*", "prod untouched by legs 1-3", fp0 === fp1, fp0 === fp1 ? "fingerprints equal" : "FINGERPRINTS DIFFER"); }
    if (legs.includes("4")) await leg4();
  }
  say(`${LABEL}: ${passes} PASS · ${fails} FAIL`);
}
main().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
