// HO 746 legs — the Senate vote sync's skip rule, run end to end against a
// `file:` copy of prod, seen red on the old rule before the new one lands.
//
// Everything under test is the shipped CLI, `scripts/sync-senate-votes.ts`
// (`runSenateVotesSync` with its defaults, the same function the 10:00 UTC cron
// calls), spawned with its database pointed at the copy. The only substitution
// besides the database is one roll's detail URL, which
// `senate-detail-fail-shim-746.cjs` makes answer HTTP 500. Every reading of the
// copy is the HO 745 probe's (`senate-roll-gaps-745.ts --db file:…`), with
// senate.gov's menu as the authority.
//
//   npx tsx scripts/diagnostic/senate-watermark-legs-746.ts --seed <x-746-legs.db>
//       copy prod's members (senate), bill ids, Senate votes and their
//       member_votes (prod read with SELECTs only), then the probe's baseline
//   npx tsx scripts/diagnostic/senate-watermark-legs-746.ts --run <x-746-legs.db> --label "run 0"
//   npx tsx scripts/diagnostic/senate-watermark-legs-746.ts --run <x-746-legs.db> --label "run 1" --fail-roll <N>
//       one CLI run against the copy (optionally with roll N forced to 500), then
//       the tree SHA and whether it was dirty, the sync file's blob, the run's
//       stats lines, the probe's reading, and prod's fingerprint before and after
//   npx tsx scripts/diagnostic/senate-watermark-legs-746.ts --setup-strand <x-746-legs.db> [--session 2]
//       N = MAX - 2 in that session; delete every roll >= N (member_votes first,
//       the FK at scripts/migrate.ts:403). N and above become PENDING, not stranded.
//
// SAFETY. Prod is only ever read. Every write in this file goes to a client
// built as `file:${abs}` from a path that must end in -746-legs.db, and the CLI
// is spawned with TURSO_DATABASE_URL set the same way; the run refuses to spawn
// if that URL is not `file:` and prints the scheme it ran against. Prod's
// Senate fingerprint is read before and after every run, so a run that reached
// prod would show.
import { config } from "dotenv";
import { spawnSync, execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { createClient, type Client, type InArgs, type ResultSet } from "@libsql/client";

config({ path: ".env", quiet: true });

const argAt = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const CONGRESS = 119;
const SHIM = path.resolve("scripts/diagnostic/senate-detail-fail-shim-746.cjs").replace(/\\/g, "/");
const PROBE = "scripts/diagnostic/senate-roll-gaps-745.ts";
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");

function copyPath(p: string | undefined): { abs: string; url: string } {
  if (!p) throw new Error("a copy path is required");
  const abs = path.resolve(p);
  if (!abs.endsWith("-746-legs.db")) throw new Error(`refused: the copy must be a *-746-legs.db file (got ${abs})`);
  return { abs, url: `file:${abs}` };
}

function prodClient(): { db: Client; read: (sql: string, args?: InArgs) => Promise<ResultSet> } {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("libsql://")) throw new Error("reading prod needs the prod libsql:// URL in .env");
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const read = (sql: string, args?: InArgs) => {
    if (sql.trim().split(/\s+/)[0]!.toUpperCase() !== "SELECT") throw new Error("prod is read-only here");
    return db.execute({ sql, args: args ?? [] });
  };
  return { db, read };
}

async function prodFingerprint(): Promise<string> {
  const { db, read } = prodClient();
  const r = await read(
    `SELECT session, COUNT(*) n, MAX(roll_call) mx FROM votes WHERE chamber = 'senate' AND congress = ? GROUP BY session ORDER BY session`,
    [CONGRESS],
  );
  const m = await read(`SELECT COUNT(*) n FROM member_votes mv JOIN votes v ON v.id = mv.vote_id WHERE v.chamber = 'senate'`);
  db.close();
  return JSON.stringify({ sessions: r.rows.map((x) => ({ ...x })), memberVotes: m.rows[0]?.n });
}

function probe(url: string): string {
  const out = spawnSync(process.execPath, [TSX, PROBE, "--db", url], { encoding: "utf8" });
  const lines = `${out.stdout}${out.stderr}`.split(/\r?\n/);
  const keep = lines.filter((l) => /^\d+ · \d+ ·|stranded, with|^  \d+\/\d+ roll|^  \(none\)|gap query \d+ vs|parse control|scheme/.test(l));
  return keep.map((l) => `    probe| ${l}`).join("\n");
}

function treeState(): string {
  const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "lib", "scripts/sync-senate-votes.ts"], { encoding: "utf8" }).trim();
  const blob = execFileSync("git", ["hash-object", "lib/senate-votes-sync.ts"], { encoding: "utf8" }).trim().slice(0, 10);
  const headBlob = execFileSync("git", ["rev-parse", "HEAD:lib/senate-votes-sync.ts"], { encoding: "utf8" }).trim().slice(0, 10);
  return `tree ${sha} · lib ${dirty ? "DIRTY" : "clean"} · lib/senate-votes-sync.ts blob ${blob} (HEAD's ${headBlob})`;
}

async function seed(p: string | undefined) {
  const { abs, url } = copyPath(p);
  console.log(`=== HO 746 seed · scheme ${url.split(":")[0]}: · ${abs} ===`);
  const { db: prod, read } = prodClient();
  const members = await read(`SELECT bioguide_id, last_name, state, chamber FROM members WHERE chamber = 'senate'`);
  const bills = await read(`SELECT id FROM bills`);
  const votes = await read(`SELECT * FROM votes WHERE chamber = 'senate'`);
  const mvs = await read(`SELECT mv.vote_id, mv.bioguide_id, mv.position FROM member_votes mv JOIN votes v ON v.id = mv.vote_id WHERE v.chamber = 'senate'`);
  prod.close();
  if (existsSync(abs)) rmSync(abs);
  const local = createClient({ url });
  // The shapes the sync touches (scripts/migrate.ts), trimmed to what it reads:
  // `members` for the senator resolver, `bills(id)` for the bill_id lookup.
  await local.execute(`CREATE TABLE members (bioguide_id TEXT PRIMARY KEY, last_name TEXT, state TEXT, chamber TEXT)`);
  await local.execute(`CREATE TABLE bills (id TEXT PRIMARY KEY)`);
  await local.execute(`CREATE TABLE votes (
    id TEXT PRIMARY KEY, chamber TEXT NOT NULL, congress INTEGER NOT NULL, session INTEGER NOT NULL,
    roll_call INTEGER NOT NULL, vote_date TEXT NOT NULL, question TEXT, description TEXT, result TEXT,
    bill_id TEXT REFERENCES bills(id), amendment_designation TEXT,
    yea_count INTEGER NOT NULL, nay_count INTEGER NOT NULL, present_count INTEGER, not_voting_count INTEGER,
    raw_json TEXT NOT NULL, update_date TEXT NOT NULL)`);
  await local.execute(`CREATE TABLE member_votes (vote_id TEXT NOT NULL REFERENCES votes(id), bioguide_id TEXT NOT NULL, position TEXT NOT NULL, PRIMARY KEY (vote_id, bioguide_id))`);
  const chunk = <T,>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  const cols = ["id", "chamber", "congress", "session", "roll_call", "vote_date", "question", "description", "result", "bill_id", "amendment_designation", "yea_count", "nay_count", "present_count", "not_voting_count", "raw_json", "update_date"];
  for (const part of chunk(members.rows, 500)) {
    await local.batch(part.map((r) => ({ sql: "INSERT INTO members VALUES (?, ?, ?, ?)", args: [r.bioguide_id, r.last_name, r.state, r.chamber] as InArgs })), "write");
  }
  for (const part of chunk(bills.rows, 2000)) {
    await local.batch(part.map((r) => ({ sql: "INSERT INTO bills (id) VALUES (?)", args: [r.id] as InArgs })), "write");
  }
  for (const part of chunk(votes.rows, 400)) {
    await local.batch(part.map((r) => ({ sql: `INSERT INTO votes (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, args: cols.map((c) => (r as unknown as Record<string, never>)[c] ?? null) })), "write");
  }
  for (const part of chunk(mvs.rows, 2000)) {
    await local.batch(part.map((r) => ({ sql: "INSERT INTO member_votes VALUES (?, ?, ?)", args: [r.vote_id, r.bioguide_id, r.position] as InArgs })), "write");
  }
  local.close();
  console.log(`  seeded ${members.rows.length} senate members · ${bills.rows.length} bill ids · ${votes.rows.length} Senate votes · ${mvs.rows.length} member_votes (prod read with SELECTs only)`);
  console.log(`  prod fingerprint: ${await prodFingerprint()}`);
  console.log("  BASELINE (the 745 probe on the copy):");
  console.log(probe(url));
}

async function setupStrand(p: string | undefined) {
  const { abs, url } = copyPath(p);
  const session = Number(argAt("--session") ?? 2);
  console.log(`=== HO 746 setup · scheme ${url.split(":")[0]}: · ${abs} · session ${CONGRESS}/${session} ===`);
  const local = createClient({ url });
  const mx = Number((await local.execute({ sql: `SELECT MAX(roll_call) m FROM votes WHERE chamber = 'senate' AND congress = ? AND session = ?`, args: [CONGRESS, session] })).rows[0]?.m);
  const N = mx - 2;
  const doomed = (await local.execute({ sql: `SELECT id, roll_call FROM votes WHERE chamber = 'senate' AND congress = ? AND session = ? AND roll_call >= ? ORDER BY roll_call`, args: [CONGRESS, session, N] })).rows;
  const ids = doomed.map((r) => String(r.id));
  const ph = ids.map(() => "?").join(",");
  await local.batch(
    [
      { sql: `DELETE FROM member_votes WHERE vote_id IN (${ph})`, args: ids },
      { sql: `DELETE FROM votes WHERE id IN (${ph})`, args: ids },
    ],
    "write",
  );
  const after = Number((await local.execute({ sql: `SELECT MAX(roll_call) m FROM votes WHERE chamber = 'senate' AND congress = ? AND session = ?`, args: [CONGRESS, session] })).rows[0]?.m);
  local.close();
  console.log(`  MAX was ${mx}; N = MAX - 2 = ${N}; deleted rolls ${doomed.map((r) => r.roll_call).join(",")} (member_votes first); MAX now ${after} = N - 1`);
  console.log(probe(url));
}

async function run(p: string | undefined) {
  const { abs, url } = copyPath(p);
  const label = argAt("--label") ?? "run";
  const failRoll = argAt("--fail-roll");
  const session = argAt("--session") ?? "2";
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url };
  delete env.TURSO_AUTH_TOKEN;
  if (!String(env.TURSO_DATABASE_URL).startsWith("file:")) throw new Error("refused: the CLI may only run against a file: database");
  if (failRoll) {
    env.NODE_OPTIONS = `--require ${SHIM}`;
    env.FAIL_ROLL_746 = failRoll;
    env.FAIL_CONGRESS_746 = String(CONGRESS);
    env.FAIL_SESSION_746 = session;
  }
  console.log(`=== HO 746 ${label} · CLI against scheme ${url.split(":")[0]}: · ${abs}${failRoll ? ` · roll ${CONGRESS}/${session}/${failRoll} forced to HTTP 500` : " · no shim"} ===`);
  console.log(`  ${treeState()}`);
  const before = await prodFingerprint();
  const out = spawnSync(process.execPath, [TSX, "scripts/sync-senate-votes.ts"], { env, encoding: "utf8" });
  const lines = `${out.stdout}${out.stderr}`.split(/\r?\n/);
  const keep = lines.filter((l) => /^session \d|senate vote sync complete|^failed senate-|^skip senate-|\[fail-746\] vote_|^heal:/.test(l));
  for (const l of keep) console.log(`    sync| ${l}`);
  console.log(`  CLI exit ${out.status}`);
  console.log(probe(url));
  const after = await prodFingerprint();
  console.log(`  prod ${after === before ? "UNCHANGED" : "CHANGED"}: ${after}`);
  if (after !== before) process.exitCode = 3;
}

(async () => {
  if (argAt("--seed")) await seed(argAt("--seed"));
  else if (argAt("--setup-strand")) await setupStrand(argAt("--setup-strand"));
  else if (argAt("--run")) await run(argAt("--run"));
  else throw new Error("one of --seed, --setup-strand, --run");
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
