// HO 761 legs: the runoff rounds Ballotpedia already prints, ingested, on `file:` copies seeded whole
// from prod, each leg red first against HEAD's code (ead1020). HO 747's saved pages stand in for
// Ballotpedia everywhere: in process through an IO that reads them, and in children through
// runoff-pages-shim-761.cjs.
//   npx tsx scripts/diagnostic/runoff-rounds-legs-761.ts --label L              seed, then legs 1, 2, 3, 4, 6
//   npx tsx scripts/diagnostic/runoff-rounds-legs-761.ts --cli --label L        leg 5: `npm run repair:runoffs`
//                                                                               itself, dry then --write, paced
//   npx tsx scripts/diagnostic/runoff-rounds-legs-761.ts --captures --label L   the runoff block, the tree's build
//
// The copies, all from one template (the real migrate, 13 tables read whole from prod):
//   before   untouched: the reds of legs 3 and 4, leg 6's before, the "before" captures
//   head     HEAD's sync over leg 2's pages (the red)
//   new      the tree's sync over the same pages, then the repair twice and the sync again (leg 2)
//   after    the tree's repair over every page (legs 3, 4, 6, the "after" captures)
//   cli      leg 5's copy
//   hbefore, hafter   clones of before and after for leg 6's harvests
//
//   1 parser     red: HEAD's parseCandidatesPage has no runoff round on TX-18's or S-GA's page; the tree's
//                has TX-18's (Menefee marked, Green not) and S-GA's (Collins marked, Dooley not), their ids
//                through the repair's writer house-TX-18-2026-D-runoff and the seeded senate-GA-2026-R-runoff;
//                and every saved page's first round reads exactly as HEAD's
//   2 the write  red: HEAD's sync writes no runoff row; the tree's inserts each new runoff with its marks
//                in the first write (isSettled refuses none of them) and, as the cron, leaves the three
//                expired seeds; the repair updates GA's seed in place (same ids, race_id kept, marks
//                landed); a second repair and a second sync change nothing
//   2r the race  two writers on one copy write TX-18's runoff at once: both pass the existence check,
//                and the roster holds 2 rows, not 4 (the review's replay finding)
//   2s the seed  red: HEAD's seed:runoffs on the after copy resets the decided seeds to running; the
//                tree's keeps them, and still refreshes an undecided seed (the before copy)
//   3 qualifier  red: TX-09, TX-32 and S-TX read absent before; lost_primary after; HEAD's rule reads the
//                same on the after copy (the rule is unchanged); no other race's reading moves
//   4 the block  red: HEAD's RaceRunoffs on the after rows shows Dooley pending; the tree's shows Collins
//                won and Dooley lost; LA's undecided seeds (the before copy) stay Pending
//   5 repair     the CLI: its dry run writes nothing (every table's content hash), its --write yields the
//                census's 33 runoff rounds, each with one winner, equal to the in-process repair's
//   6 nothing else moves   before → after changes primaries and primary_candidates only, and in them only
//                runoff rounds; the harvest's result is identical on the two
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed and for a fingerprint before and after
// every mode. Copies are `file:${abs}` from paths ending -761-legs.db; children get that URL with
// TURSO_AUTH_TOKEN="" (not deleted: dotenv refills a missing key). getDb() never runs in this process
// (its env is prod's): the writer, the repair and the qualifier take the copy's client, and the sync
// and the page read run in children. Every printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const HEAD_SHA = "ead1020";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const CWD = path.join(DIR, "cwd-761"); // the children's cwd: no .cache/ballotpedia
const ART = path.resolve("docs/handoffs/761-artifacts");
const PAGES = path.resolve("docs/handoffs/747-artifacts/pages");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const TSCONFIG = path.resolve("tsconfig.json");
const CHILD = path.resolve("scripts/diagnostic/runoff-legs-child-761.ts");
const SHIM = path.resolve("scripts/diagnostic/runoff-pages-shim-761.cjs").replace(/\\/g, "/");
const PORT = 3761;
const ROUTE = "/api/cron/race-challengers";
const SENTINEL: Record<string, string> = { before: "2026-09-30T03:00:01.761Z", after: "2026-09-30T03:00:02.761Z" };
const TABLES = ["races", "members", "member_ids", "race_ratings", "race_candidates", "kalshi_odds", "polymarket_odds", "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads"];
const LEG2_SENATE = "GA,TX,LA,SC";
const LEG2_HOUSE = "TX-18,TX-33";
const LEG2_NEW = ["house-TX-18-2026-D-runoff", "house-TX-33-2026-D-runoff", "house-TX-33-2026-R-runoff", "senate-SC-2026-special-R-runoff", "senate-TX-2026-R-runoff"];
const SEEDS = ["senate-GA-2026-R-runoff", "senate-LA-2026-D-runoff", "senate-LA-2026-R-runoff"];
const THREE = ["TX-09-2026", "TX-32-2026", "S-TX-2026"];
const CENSUS_BOXES = 33; // docs/handoffs/761-artifacts/census-761.txt

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
const reader = (db: Client) => (sql: string) => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("prod is read-only here");
  return db.execute(sql);
};
async function prodFingerprint(): Promise<string> {
  const db = prodClient();
  const read = reader(db);
  const hash = async (q: string) => sha(JSON.stringify((await read(q)).rows.map((r) => Object.values(r))));
  const fp = {
    primaries: await hash(`SELECT * FROM primaries ORDER BY id`),
    pc: await hash(`SELECT * FROM primary_candidates ORDER BY id`),
    rc: await hash(`SELECT * FROM race_candidates ORDER BY race_id, name`),
    gb: await hash(`SELECT * FROM general_ballot ORDER BY race_id, person_key`),
    races: await hash(`SELECT * FROM races ORDER BY id`),
    schema: await hash(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`),
    runs: (await read(`SELECT route, MAX(id) AS id FROM cron_runs WHERE route IN ('/api/cron/race-challengers', '/api/cron/general-ballot', '/api/cron/primaries') GROUP BY route ORDER BY route`)).rows.map((r) => `${r.route}#${r.id}`),
  };
  db.close();
  return JSON.stringify(fp);
}
async function prodUntouched(what: string, fp0: string, t0: string) {
  const fp1 = await prodFingerprint();
  if (fp0 === fp1) { check("*", `prod untouched (${what})`, true, "fingerprints equal"); return; }
  const a = JSON.parse(fp0) as Record<string, unknown>, b = JSON.parse(fp1) as Record<string, unknown>;
  const changed = Object.keys(a).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const db = prodClient();
  const runs = (await reader(db)(`SELECT id, route, started_at FROM cron_runs WHERE started_at >= '${t0}' ORDER BY id`)).rows.map((r) => ({ route: String(r.route), at: String(r.started_at), id: Number(r.id) }));
  db.close();
  const by = (route: string) => runs.some((r) => r.route === route);
  const explained: Record<string, boolean> = { primaries: by("/api/cron/primaries"), pc: by("/api/cron/primaries"), rc: by("/api/cron/race-challengers"), gb: by("/api/cron/general-ballot"), races: false, schema: false, runs: runs.length > 0 };
  const unexplained = changed.filter((k) => !explained[k]);
  check("*", `prod untouched (${what}): every difference is a prod cron's own run in the window`, unexplained.length === 0, `changed ${changed.join(", ")} · runs in the window: ${runs.map((r) => `${r.route}#${r.id} ${r.at}`).join("; ") || "none"}${unexplained.length ? ` · UNEXPLAINED ${unexplained.join(", ")}` : ""}`);
}

// ── copies ──────────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-761-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-761-legs.db")) throw new Error(`refused: a copy must be a *-761-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
function childEnv(url: string, shimLog: string | null): NodeJS.ProcessEnv {
  if (!url.startsWith("file:")) throw new Error("refused: children get file: only");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url, LEGS_761_HEAD_DIR: DIR };
  env.TURSO_AUTH_TOKEN = "";
  if (shimLog) {
    env.NODE_OPTIONS = `--require ${SHIM}`;
    env.SHIM_761_MAP = path.join(DIR, `shim761-map-${LABEL}.json`);
    env.SHIM_761_LOG = shimLog;
  }
  return env;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
// HEAD's file from git, into scratch, its relative imports pointed at the tree's modules, except the
// ones named in `local` (HEAD's own copies, in scratch beside it). A .tsx copy gets `import React`
// on top: scratch is outside tsconfig's program, so tsx compiles it with the classic JSX runtime.
function headFile(repoPath: string, out: string, local: Record<string, string> = {}): string {
  const src = execFileSync("git", ["cat-file", "-p", `${HEAD_SHA}:${repoPath}`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 16 * 1024 * 1024 });
  const dst = path.join(DIR, out);
  const body = src
    .replace(/from "\.\/([^"]+)"/g, (_, m: string) => (local[m] ? `from "./${local[m]}"` : `from "@/lib/${m}"`))
    .replace(/from "\.\.\/lib\/([^"]+)"/g, (_, m: string) => `from "@/lib/${m}"`);
  writeFileSync(dst, (out.endsWith(".tsx") ? 'import React from "react";\n' : "") + body);
  return dst;
}

// ── HO 747's saved pages ────────────────────────────────────────────────────
// race id → the newest saved copy across the runs.
function savedPages(): Map<string, string> {
  const out = new Map<string, string>();
  for (const run of readdirSync(PAGES).filter((d) => /^\d{4}-/.test(d)).sort().reverse()) {
    for (const f of readdirSync(path.join(PAGES, run)).filter((f) => f.endsWith(".html.gz")).sort().reverse()) {
      const id = f.slice(0, f.indexOf("."));
      if (!out.has(id)) out.set(id, path.join(PAGES, run, f));
    }
  }
  return out;
}
const pageHtml = (file: string) => gunzipSync(readFileSync(file)).toString("utf8");
// The URL each saved race page answers, from the pipeline's own builders.
async function urlMap(pages: Map<string, string>): Promise<Record<string, string>> {
  const { houseDistrictUrl, senatePageUrl } = await import("@/lib/primary-candidates-scrape");
  const { stateName } = await import("@/lib/states");
  const map: Record<string, string> = {};
  for (const [id, file] of pages) {
    const senate = id.startsWith("S-");
    const st = senate ? id.slice(2, 4) : id.slice(0, 2);
    const slug = stateName(st).replace(/ /g, "_");
    const dd = id.slice(3, id.indexOf("-2026"));
    map[senate ? senatePageUrl(slug) : houseDistrictUrl(slug, dd === "AL" ? 0 : Number(dd))] = file;
  }
  return map;
}
type IOish = import("@/lib/general-ballot").IO;
function savedIO(map: Record<string, string>, served: string[]): IOish {
  return {
    now: () => Date.now(),
    sleep: async () => {},
    get: async (url) => {
      const file = map[url];
      served.push(`${file ? 200 : 404} ${url}`);
      return file ? { kind: "response", status: 200, body: pageHtml(file) } : { kind: "response", status: 404, body: "not saved" };
    },
  };
}

// ── reading a copy ──────────────────────────────────────────────────────────
async function tableHashes(url: string): Promise<Record<string, string>> {
  return withDb(url, async (db) => {
    const names = (await db.execute(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)).rows.map((r) => String(r.name));
    const out: Record<string, string> = {};
    for (const t of names) out[t] = sha((await db.execute(`SELECT * FROM "${t}"`)).rows.map((r) => JSON.stringify(Object.values(r))).sort().join("\n"));
    return out;
  });
}
const diffKeys = (a: Record<string, string>, b: Record<string, string>) => [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => a[k] !== b[k]).sort();
// sqlite_sequence holds each AUTOINCREMENT table's counter, so an insert into primary_candidates moves
// it. Its other rows must not move; the primary_candidates row is printed.
async function sequenceRows(url: string): Promise<{ others: string; pc: string }> {
  return withDb(url, async (db) => {
    const rows = (await db.execute(`SELECT name, seq FROM sqlite_sequence ORDER BY name`)).rows.map((r) => `${r.name}=${r.seq}`);
    return { others: rows.filter((r) => !r.startsWith("primary_candidates=")).join(","), pc: rows.find((r) => r.startsWith("primary_candidates=")) ?? "primary_candidates=(none)" };
  });
}
const WRITE_TABLES = JSON.stringify(["primaries", "primary_candidates", "sqlite_sequence"]);
// One round's rows and rosters, whole (updated_at included).
async function roundHash(url: string, round: "primary" | "runoff"): Promise<string> {
  return withDb(url, async (db) => {
    const p = (await db.execute({ sql: `SELECT * FROM primaries WHERE election_round = ? ORDER BY id`, args: [round] })).rows.map((r) => JSON.stringify(Object.values(r)));
    const c = (await db.execute({ sql: `SELECT c.* FROM primary_candidates c JOIN primaries p ON p.id = c.primary_id WHERE p.election_round = ? ORDER BY c.id`, args: [round] })).rows.map((r) => JSON.stringify(Object.values(r)));
    return sha(p.join("\n") + "\n--\n" + c.join("\n"));
  });
}
type Cand = { pcId: number; name: string; party: string; incumbent: number; bioguide: string | null; status: string; pct: number | null };
type RunoffRow = { id: string; state: string; district: string | null; chamber: string; party: string; date: string | null; runoff: string | null; type: string | null; raceId: string | null; cands: Cand[] };
async function runoffRows(url: string): Promise<Map<string, RunoffRow>> {
  return withDb(url, async (db) => {
    const out = new Map<string, RunoffRow>();
    for (const r of (await db.execute(`SELECT * FROM primaries WHERE election_round = 'runoff' ORDER BY id`)).rows) {
      out.set(String(r.id), { id: String(r.id), state: String(r.state), district: r.district == null ? null : String(r.district), chamber: String(r.chamber), party: String(r.party), date: r.primary_date == null ? null : String(r.primary_date), runoff: r.runoff_date == null ? null : String(r.runoff_date), type: r.primary_type == null ? null : String(r.primary_type), raceId: r.race_id == null ? null : String(r.race_id), cands: [] });
    }
    for (const c of (await db.execute(`SELECT c.* FROM primary_candidates c JOIN primaries p ON p.id = c.primary_id WHERE p.election_round = 'runoff' ORDER BY c.primary_id, c.name`)).rows) {
      out.get(String(c.primary_id))!.cands.push({ pcId: Number(c.id), name: String(c.name), party: String(c.party), incumbent: Number(c.incumbent), bioguide: c.bioguide_id == null ? null : String(c.bioguide_id), status: String(c.status), pct: c.vote_pct == null ? null : Number(c.vote_pct) });
    }
    return out;
  });
}
const showRow = (r: RunoffRow | undefined) => (r ? `${r.id} [${r.date}, type ${r.type}, race_id ${r.raceId}] ${r.cands.map((c) => `${c.name} ${c.status}${c.pct != null ? ` ${c.pct}%` : ""}${c.bioguide ? ` ${c.bioguide}` : ""}`).join(", ")}` : "(none)");
const content = (r: RunoffRow) => JSON.stringify([r.id, r.state, r.district, r.chamber, r.party, r.date, r.runoff, r.type, r.raceId, r.cands.map((c) => [c.name, c.party, c.incumbent, c.bioguide, c.status, c.pct])]);

const STUB = pathToFileURL(path.resolve("scripts/diagnostic/next-cache-stub-757.mjs")).href;
function spawnChild(args: string[], url: string, shimLog: string | null): { code: number | null; out: string; result: Record<string, unknown> | null } {
  mkdirSync(CWD, { recursive: true });
  // render and pac import lib/queries.ts: unstable_cache needs the HO 757 stub outside Next.
  const stub = args[0] === "render" || args[0] === "pac" ? ["--import", STUB] : [];
  const r = spawnSync(process.execPath, [TSX, "--tsconfig", TSCONFIG, ...stub, CHILD, ...args], { cwd: CWD, env: childEnv(url, shimLog), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = redactSecrets(`${r.stdout}\n${r.stderr}`);
  const line = (r.stdout ?? "").split(/\r?\n/).reverse().find((l) => l.startsWith("RESULT "));
  return { code: r.status, out, result: line ? (JSON.parse(line.slice(7)) as Record<string, unknown>) : null };
}

async function seedCopies() {
  mkdirSync(DIR, { recursive: true });
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
  for (const kind of ["before", "head", "new", "after", "cli"]) copyFileSync(tpl, copyPath(kind));
  say(`template: the real scripts/migrate.ts against file:, seeded whole from prod · ${counts.join(" · ")} · copies before, head, new, after, cli`);
}

type Report = import("@/lib/primaries-sync").RunoffWriteReport;
type Readings = Awaited<ReturnType<typeof import("@/lib/incumbent-qualifier")["readIncumbentQualifierReadings"]>>;
const tagOf = (r: { qualifier: { kind: string; reason?: string } | null } | undefined) => (r == null ? "no reading" : r.qualifier == null ? "none" : r.qualifier.kind === "none" ? String(r.qualifier.reason) : r.qualifier.kind);

async function legs() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim().slice(0, 10);
  say(`=== HO 761 legs · ${LABEL} · ${new Date().toISOString()} · tree ${tree} · scrape ${blob("lib/primary-candidates-scrape.ts")} sync ${blob("lib/primaries-sync.ts")} repair ${blob("lib/runoff-repair.ts")} block ${blob("components/RaceRunoffs.tsx")} qualifier ${blob("lib/incumbent-qualifier.ts")} · driver ${blob("scripts/diagnostic/runoff-rounds-legs-761.ts")} child ${blob(CHILD)} shim ${blob(SHIM)} ===`);
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();
  await seedCopies();
  const pages = savedPages();
  const map = await urlMap(pages);
  writeFileSync(path.join(DIR, `shim761-map-${LABEL}.json`), JSON.stringify(map));
  say(`saved pages: ${pages.size} race pages from HO 747's runs, ${Object.keys(map).length} URLs`);
  headFile("lib/primary-candidates-scrape.ts", "head-primary-candidates-scrape-761.ts");
  headFile("lib/primaries-sync.ts", "head-primaries-sync-761.ts", { "primary-candidates-scrape": "head-primary-candidates-scrape-761" });
  headFile("components/RaceRunoffs.tsx", "head-RaceRunoffs-761.tsx");
  headFile("lib/incumbent-qualifier.ts", "head-incumbent-qualifier-761.ts");
  const B = copyUrl(copyPath("before"));
  const now = new Date().toISOString();
  const { createRunoffWriter, emptyRunoffReport, settleWindowFloor } = await import("@/lib/primaries-sync");
  const at = { now, today: now.slice(0, 10), windowFloor: settleWindowFloor(now) };
  const hashBefore = await tableHashes(B);

  // ── leg 1: the parser ──────────────────────────────────────────────────────
  say(`\n── leg 1: the parser`);
  {
    const headScrape = await import(pathToFileURL(path.join(DIR, "head-primary-candidates-scrape-761.ts")).href);
    const treeScrape = await import("@/lib/primary-candidates-scrape");
    type Parse = { status: string; candidates: { name: string; isWinner: boolean; incumbent: boolean; contest: string; isSpecial: boolean; votePct: number | null }[]; runoffs?: { contest: string; isSpecial: boolean; date: string | null; candidates: { name: string; isWinner: boolean; incumbent: boolean; votePct: number | null }[] }[] };
    const parse = (mod: { parseCandidatesPage: (h: string, s: string, u: string) => Parse }, id: string) => mod.parseCandidatesPage(pageHtml(pages.get(id)!), id.startsWith("S-") ? id.slice(2, 4) : id.slice(0, 2), id);
    const h18 = parse(headScrape, "TX-18-2026"), hGA = parse(headScrape, "S-GA-2026");
    const t18 = parse(treeScrape, "TX-18-2026"), tGA = parse(treeScrape, "S-GA-2026");
    const onceMarked = (p: Parse, names: string[]) => names.every((n) => p.candidates.filter((c) => c.name === n).length === 1 && p.candidates.find((c) => c.name === n)!.isWinner);
    check("1", "red: HEAD's parser returns no runoff round on TX-18's or S-GA's page (Green, Menefee, Collins, Dooley each once, marked: the first round's advancers)", !("runoffs" in h18) && !("runoffs" in hGA) && onceMarked(h18, ["Al Green", "Christian Menefee"]) && onceMarked(hGA, ["Mike Collins", "Derek Dooley"]), `TX-18 keys [${Object.keys(h18).join(",")}] · S-GA keys [${Object.keys(hGA).join(",")}]`);
    const r18 = t18.runoffs ?? [], rGA = tGA.runoffs ?? [];
    const c = (r: NonNullable<Parse["runoffs"]>[number] | undefined, n: string) => r?.candidates.find((x) => x.name === n);
    check("1", "the tree's parser: TX-18's page has one runoff round, D, 2026-05-26, Menefee marked (69.3%), Green not (30.7%), both underlined", r18.length === 1 && r18[0]!.contest === "D" && !r18[0]!.isSpecial && r18[0]!.date === "2026-05-26" && r18[0]!.candidates.length === 2 && c(r18[0], "Christian Menefee")?.isWinner === true && c(r18[0], "Al Green")?.isWinner === false && c(r18[0], "Al Green")?.incumbent === true && c(r18[0], "Christian Menefee")?.votePct === 69.3 && c(r18[0], "Al Green")?.votePct === 30.7, JSON.stringify(r18));
    check("1", "the tree's parser: S-GA's page has one runoff round, R, 2026-06-16, Collins marked (55.5%), Dooley not (44.5%)", rGA.length === 1 && rGA[0]!.contest === "R" && rGA[0]!.date === "2026-06-16" && rGA[0]!.candidates.length === 2 && c(rGA[0], "Mike Collins")?.isWinner === true && c(rGA[0], "Derek Dooley")?.isWinner === false, JSON.stringify(rGA));
    check("1", "the two rounds kept apart: Green is in TX-18's first round (marked) AND its runoff (unmarked)", t18.candidates.filter((x) => x.name === "Al Green").length === 1 && t18.candidates.find((x) => x.name === "Al Green")!.isWinner && c(r18[0], "Al Green")?.isWinner === false, `first round: ${t18.candidates.map((x) => `${x.name}${x.isWinner ? "*" : ""}`).join(", ")}`);
    // every saved page: the first round unchanged, and the runoff rounds counted
    let same = 0, boxes = 0;
    const differ: string[] = [];
    for (const [id, file] of pages) {
      const html = pageHtml(file);
      const st = id.startsWith("S-") ? id.slice(2, 4) : id.slice(0, 2);
      const h = headScrape.parseCandidatesPage(html, st, id) as Parse;
      const t = treeScrape.parseCandidatesPage(html, st, id) as Parse;
      if (JSON.stringify([h.status, h.candidates, (h as { pageIsSpecial?: boolean }).pageIsSpecial]) === JSON.stringify([t.status, t.candidates, (t as { pageIsSpecial?: boolean }).pageIsSpecial])) same++;
      else differ.push(id);
      boxes += t.runoffs?.length ?? 0;
    }
    check("1", `every saved page's first round (status, candidates, pageIsSpecial) reads exactly as HEAD's, and the tree finds the census's ${CENSUS_BOXES} runoff boxes`, differ.length === 0 && boxes === CENSUS_BOXES, `${same} of ${pages.size} identical${differ.length ? ` · DIFFER ${differ.join(", ")}` : ""} · ${boxes} runoff rounds`);
    // the ids, through the repair's writer, dry, on the before copy
    const rep = emptyRunoffReport();
    const cron = emptyRunoffReport();
    await withDb(B, async (db) => {
      const w = await createRunoffWriter(db);
      await w({ chamber: "house", state: "TX", district: 18 }, r18 as never, at, { write: false, reopenExpired: true }, rep);
      await w({ chamber: "senate", state: "GA", district: null }, rGA as never, at, { write: false, reopenExpired: true }, rep);
      await w({ chamber: "senate", state: "GA", district: null }, rGA as never, at, { write: false }, cron);
    });
    check("1", "the ids (the repair's writer, dry, before copy): house-TX-18-2026-D-runoff would be inserted; S-GA's box lands on the seeded senate-GA-2026-R-runoff, reopened (expired, undecided)", JSON.stringify(rep.inserted) === JSON.stringify(["house-TX-18-2026-D-runoff (winner Christian Menefee)"]) && JSON.stringify(rep.reopened) === JSON.stringify(["senate-GA-2026-R-runoff (winner Mike Collins)"]), `inserted ${JSON.stringify(rep.inserted)} · reopened ${JSON.stringify(rep.reopened)}`);
    check("1", "and as the cron (no reopenExpired) the same box finds the seed settled by expiry and leaves it", JSON.stringify(cron.settledSkipped) === JSON.stringify(["senate-GA-2026-R-runoff"]) && cron.reopened.length === 0, `settledSkipped ${JSON.stringify(cron.settledSkipped)}`);
    const h1 = await tableHashes(B);
    check("1", "the dry writer wrote nothing to the before copy (every table's content hash)", diffKeys(hashBefore, h1).length === 0, `differ: ${diffKeys(hashBefore, h1).join(", ") || "none"}`);
  }

  // ── leg 2: the write ───────────────────────────────────────────────────────
  say(`\n── leg 2: the write (the sync over senate ${LEG2_SENATE}, house ${LEG2_HOUSE}; the pages from the shim)`);
  {
    const H = copyUrl(copyPath("head")), N = copyUrl(copyPath("new"));
    const before = await runoffRows(B);
    const shimLog = (k: string) => path.join(DIR, `shim761-${k}-${LABEL}.log`);
    const hs = spawnChild(["sync", "--code", "head", "--senate", LEG2_SENATE, "--house", LEG2_HOUSE], H, shimLog("head-sync"));
    writeFileSync(path.join(ART, `leg2-head-sync-${LABEL}.txt`), hs.out);
    if (hs.code !== 0 || !hs.result) throw new Error(`HEAD's sync child failed: ${hs.out.slice(-1500)}`);
    const afterHead = await runoffRows(H);
    check("2", "red: HEAD's sync writes no runoff row (the three seeds, unchanged)", afterHead.size === 3 && [...afterHead.values()].every((r) => content(r) === content(before.get(r.id)!)), [...afterHead.keys()].join(", "));
    const ts = spawnChild(["sync", "--code", "tree", "--senate", LEG2_SENATE, "--house", LEG2_HOUSE], N, shimLog("tree-sync"));
    writeFileSync(path.join(ART, `leg2-tree-sync-${LABEL}.txt`), ts.out);
    if (ts.code !== 0 || !ts.result) throw new Error(`the tree's sync child failed: ${ts.out.slice(-1500)}`);
    const sR = (ts.result.senate as { runoffs: Report }).runoffs, hR = (ts.result.house as { runoffs: Report }).runoffs;
    const inserted = [...sR.inserted, ...hR.inserted].map((t) => t.slice(0, t.indexOf(" "))).sort();
    say(`  the tree's sync, senate: ${JSON.stringify(sR)}`);
    say(`  the tree's sync, house: ${JSON.stringify(hR)}`);
    const rowsNew = await runoffRows(N);
    check("2", `the tree's sync inserts the five new runoff rounds on these pages: ${LEG2_NEW.join(", ")}`, JSON.stringify(inserted) === JSON.stringify([...LEG2_NEW].sort()), inserted.join(", "));
    const settled = [...sR.settledSkipped, ...hR.settledSkipped].sort();
    check("2", "isSettled refused no first write (nothing new in settledSkipped); as the cron it leaves the three expired, undecided seeds, which only the repair reopens", JSON.stringify(settled) === JSON.stringify([...SEEDS].sort()) && sR.reopened.length === 0 && hR.reopened.length === 0, `settledSkipped ${settled.join(", ")}`);
    const firsts = await withDb(N, async (db) => new Map((await db.execute(`SELECT id, district, party, primary_type, runoff_date FROM primaries WHERE election_round = 'primary'`)).rows.map((r) => [String(r.id), r])));
    for (const id of LEG2_NEW) {
      const r = rowsNew.get(id);
      const first = firsts.get(id.replace(/-runoff$/, ""));
      const winners = r?.cands.filter((c) => c.status === "winner").length ?? 0;
      check("2", `${id} arrived with its marks, the first round's fields, the box's date`, !!r && !!first && r.cands.length === 2 && winners === 1 && r.cands.every((c) => c.pct != null) && r.date === String(first.runoff_date) && r.type === (first.primary_type == null ? null : String(first.primary_type)) && r.district === (first.district == null ? null : String(first.district)) && r.party === String(first.party) && r.raceId === null && r.runoff === null, showRow(r));
    }
    const tx18 = rowsNew.get("house-TX-18-2026-D-runoff");
    check("2", "TX-18's runoff: Menefee winner, Green running with Green's bioguide (G000553)", tx18?.cands.find((c) => c.name === "Christian Menefee")?.status === "winner" && tx18?.cands.find((c) => c.name === "Al Green")?.status === "running" && tx18?.cands.find((c) => c.name === "Al Green")?.bioguide === "G000553", showRow(tx18));
    check("2", "the first rounds read the same after the tree's sync as after HEAD's (every primary-round row and roster, whole)", (await roundHash(H, "primary")) === (await roundHash(N, "primary")), `head ${await roundHash(H, "primary")} · new ${await roundHash(N, "primary")}`);
    check("2", "the seeds are as the before copy has them after the tree's sync", SEEDS.every((id) => content(rowsNew.get(id)!) === content(before.get(id)!)), SEEDS.map((id) => showRow(rowsNew.get(id))).join(" | "));

    // the repair, in process, the saved pages through an IO
    const { repairRunoffs } = await import("@/lib/runoff-repair");
    const served: string[] = [];
    const r1 = await withDb(N, (db) => repairRunoffs(db, savedIO(map, served), { write: true }));
    writeFileSync(path.join(ART, `leg2-repair1-${LABEL}.json`), JSON.stringify(r1, null, 1));
    const rowsR = await runoffRows(N);
    const gaB = before.get("senate-GA-2026-R-runoff")!, gaA = rowsR.get("senate-GA-2026-R-runoff")!;
    check("2", "the repair updates GA's seed in place: same id, same primary_candidates ids, race_id S-GA-2026, date and type kept, Collins winner 55.5, Dooley running 44.5", r1.report.reopened.some((t) => t.startsWith("senate-GA-2026-R-runoff ")) && JSON.stringify(gaA.cands.map((c) => c.pcId).sort()) === JSON.stringify(gaB.cands.map((c) => c.pcId).sort()) && gaA.raceId === "S-GA-2026" && gaA.date === gaB.date && gaA.type === gaB.type && gaA.cands.find((c) => c.name === "Mike Collins")?.status === "winner" && gaA.cands.find((c) => c.name === "Mike Collins")?.pct === 55.5 && gaA.cands.find((c) => c.name === "Derek Dooley")?.status === "running" && gaA.cands.find((c) => c.name === "Derek Dooley")?.pct === 44.5, `before: ${showRow(gaB)} · after: ${showRow(gaA)} · pc ids ${gaB.cands.map((c) => c.pcId).join(",")} → ${gaA.cands.map((c) => c.pcId).join(",")}`);
    check("2", "…and LA's two seeds the same way (their June 27 runoffs are decided on the page)", ["senate-LA-2026-D-runoff", "senate-LA-2026-R-runoff"].every((id) => r1.report.reopened.some((t) => t.startsWith(`${id} `)) && rowsR.get(id)!.cands.filter((c) => c.status === "winner").length === 1 && rowsR.get(id)!.raceId === "S-LA-2026"), ["senate-LA-2026-D-runoff", "senate-LA-2026-R-runoff"].map((id) => showRow(rowsR.get(id))).join(" | "));
    check("2", "the repair after the sync: the five the sync wrote are settled (decided), the rest inserted", LEG2_NEW.every((id) => r1.report.settledSkipped.includes(id)) && r1.report.inserted.length === CENSUS_BOXES - LEG2_NEW.length - SEEDS.length, `inserted ${r1.report.inserted.length} · reopened ${r1.report.reopened.length} · settled ${r1.report.settledSkipped.length} · updated ${r1.report.updated.length}`);
    const hP = await roundHash(N, "primary"), hRo = await roundHash(N, "runoff");
    const r2 = await withDb(N, (db) => repairRunoffs(db, savedIO(map, []), { write: true }));
    check("2", "a second repair changes nothing (every runoff round settled; both rounds' hashes equal)", r2.report.inserted.length === 0 && r2.report.updated.length === 0 && r2.report.reopened.length === 0 && r2.report.settledSkipped.length === CENSUS_BOXES && hP === (await roundHash(N, "primary")) && hRo === (await roundHash(N, "runoff")), `inserted ${r2.report.inserted.length} · updated ${r2.report.updated.length} · reopened ${r2.report.reopened.length} · settled ${r2.report.settledSkipped.length}`);
    const ts2 = spawnChild(["sync", "--code", "tree", "--senate", LEG2_SENATE, "--house", LEG2_HOUSE], N, shimLog("tree-sync2"));
    writeFileSync(path.join(ART, `leg2-tree-sync2-${LABEL}.txt`), ts2.out);
    const s2 = (ts2.result?.senate as { runoffs: Report } | undefined)?.runoffs, h2 = (ts2.result?.house as { runoffs: Report } | undefined)?.runoffs;
    check("2", "a second sync changes nothing (both rounds' hashes equal)", ts2.code === 0 && !!s2 && !!h2 && s2.inserted.length + h2.inserted.length + s2.updated.length + h2.updated.length === 0 && hP === (await roundHash(N, "primary")) && hRo === (await roundHash(N, "runoff")), `settled ${[...(s2?.settledSkipped ?? []), ...(h2?.settledSkipped ?? [])].join(", ")}`);
  }

  // the after copy: before + the repair, nothing else
  const A = copyUrl(copyPath("after"));
  const { repairRunoffs } = await import("@/lib/runoff-repair");
  const servedA: string[] = [];
  const rA = await withDb(A, (db) => repairRunoffs(db, savedIO(map, servedA), { write: true }));
  writeFileSync(path.join(ART, `after-repair-${LABEL}.json`), JSON.stringify(rA, null, 1));
  say(`\nthe after copy: the repair over ${rA.units} pages (${servedA.length} served, ${servedA.filter((s) => s.startsWith("404")).length} 404) · inserted ${rA.report.inserted.length} · reopened ${rA.report.reopened.length} · dates ${rA.report.dateFromBox} box / ${rA.report.dateFromFirstRound} first round · disagree ${rA.report.dateDisagrees.length} · noMatch ${rA.report.noMatch.length} · left out ${rA.leftFuture.length}`);

  // ── leg 2r: two writers race one first write ────────────────────────────────
  // The review's replay finding: the existence check and the insert batch are separate round trips,
  // so a replayed batch or a second writer can reach the insert twice. Two writers, two clients, one
  // copy, the same page at once. The control is both reports reading `inserted` (both passed the
  // check, so the race happened); the answer is the roster holding 2 rows, not 4.
  say(`\n── leg 2r: two writers race one first write`);
  {
    copyFileSync(copyPath("before"), copyPath("race"));
    const url = copyUrl(copyPath("race"));
    const tx18 = (await import("@/lib/primary-candidates-scrape")).parseCandidatesPage(pageHtml(pages.get("TX-18-2026")!), "TX", "TX-18-2026").runoffs ?? [];
    const dbA = createClient({ url }), dbB = createClient({ url });
    const [wA, wB] = [await createRunoffWriter(dbA), await createRunoffWriter(dbB)];
    const [rA, rB] = [emptyRunoffReport(), emptyRunoffReport()];
    const page = { chamber: "house" as const, state: "TX", district: 18 };
    await Promise.all([wA(page, tx18, at, { write: true }, rA), wB(page, tx18, at, { write: true }, rB)]);
    dbA.close(); dbB.close(); await sleep(300);
    const rows = (await runoffRows(url)).get("house-TX-18-2026-D-runoff");
    check("2r", "both writers passed the existence check (the race happened) and the roster holds 2 rows, not 4", rA.inserted.length === 1 && rB.inserted.length === 1 && rows?.cands.length === 2, `A inserted ${rA.inserted.length}, B inserted ${rB.inserted.length} · ${showRow(rows)}`);
  }

  // ── leg 2s: seed:runoffs after the page has decided ─────────────────────────
  say(`\n── leg 2s: seed:runoffs on a decided seed`);
  {
    for (const k of ["seedhead", "seednew"]) copyFileSync(copyPath("after"), copyPath(k));
    copyFileSync(copyPath("before"), copyPath("seedbefore"));
    const headSeed = headFile("scripts/seed-runoffs.ts", "head-seed-runoffs-761.ts");
    const runSeed = (script: string, kind: string) => {
      const r = spawnSync(process.execPath, [TSX, script], { env: childEnv(copyUrl(copyPath(kind)), null), encoding: "utf8" });
      const out = redactSecrets(`${r.stdout}\n${r.stderr}`);
      writeFileSync(path.join(ART, `leg2s-${kind}-${LABEL}.txt`), out);
      if (r.status !== 0) throw new Error(`seed:runoffs on ${kind} failed: ${out.slice(-1200)}`);
      return out;
    };
    const winners = (rows: Map<string, RunoffRow>) => SEEDS.map((id) => rows.get(id)!.cands.filter((c) => c.status === "winner").length);
    const after = await runoffRows(A);
    runSeed(headSeed, "seedhead");
    const sh = await runoffRows(copyUrl(copyPath("seedhead")));
    check("2s", "red: HEAD's seed:runoffs on the after copy resets the three decided seeds to running (no winner, no share)", winners(sh).every((n) => n === 0) && SEEDS.every((id) => sh.get(id)!.cands.every((c) => c.status === "running" && c.pct == null)), SEEDS.map((id) => showRow(sh.get(id))).join(" | "));
    const outNew = runSeed("scripts/seed-runoffs.ts", "seednew");
    const sn = await runoffRows(copyUrl(copyPath("seednew")));
    check("2s", "the tree's seed:runoffs keeps the three decided rosters exactly (every runoff row's content equal to the after copy's) and says so", SEEDS.every((id) => content(sn.get(id)!) === content(after.get(id)!)) && (outNew.match(/roster kept/g) ?? []).length === 3 && sn.size === after.size, `${(outNew.match(/roster kept/g) ?? []).length} "roster kept" · ${SEEDS.map((id) => showRow(sn.get(id))).join(" | ")}`);
    const beforeRows = await runoffRows(B);
    const outB = runSeed("scripts/seed-runoffs.ts", "seedbefore");
    const sb = await runoffRows(copyUrl(copyPath("seedbefore")));
    const names = (r: RunoffRow) => JSON.stringify(r.cands.map((c) => [c.name, c.party, c.incumbent, c.bioguide, c.status, c.pct]));
    check("2s", "…and on an undecided seed (the before copy) it refreshes the roster as it always has: rewritten in one batch (new ids), the same content", SEEDS.every((id) => names(sb.get(id)!) === names(beforeRows.get(id)!) && sb.get(id)!.cands.every((c) => !beforeRows.get(id)!.cands.some((b) => b.pcId === c.pcId))) && !/roster kept/.test(outB), SEEDS.map((id) => `${id} ids ${beforeRows.get(id)!.cands.map((c) => c.pcId).join(",")} → ${sb.get(id)!.cands.map((c) => c.pcId).join(",")}`).join(" · "));
  }

  // ── leg 3: the qualifier ───────────────────────────────────────────────────
  say(`\n── leg 3: the qualifier`);
  {
    const { readIncumbentQualifierReadings } = await import("@/lib/incumbent-qualifier");
    const headQ = await import(pathToFileURL(path.join(DIR, "head-incumbent-qualifier-761.ts")).href);
    const rb = await withDb(B, (db) => readIncumbentQualifierReadings(db, 2026));
    const ra = await withDb(A, (db) => readIncumbentQualifierReadings(db, 2026));
    const rh = (await withDb(A, (db) => headQ.readIncumbentQualifierReadings(db, 2026))) as Readings;
    check("3", "red: before, TX-09, TX-32 and S-TX read absent", THREE.every((id) => tagOf(rb.get(id)) === "absent"), THREE.map((id) => `${id} ${tagOf(rb.get(id))}`).join(" · "));
    check("3", "after: TX-09, TX-32 and S-TX read lost_primary", THREE.every((id) => tagOf(ra.get(id)) === "lost_primary"), THREE.map((id) => `${id} ${tagOf(ra.get(id))} [${ra.get(id)?.reasons.join(",")}]`).join(" · "));
    check("3", "HEAD's rule on the after copy reads the same three lost_primary (the rule is unchanged; the rows were missing)", THREE.every((id) => tagOf(rh.get(id)) === "lost_primary"), THREE.map((id) => `${id} ${tagOf(rh.get(id))}`).join(" · "));
    const moved = [...new Set([...rb.keys(), ...ra.keys()])].filter((id) => JSON.stringify(rb.get(id)) !== JSON.stringify(ra.get(id))).sort();
    check("3", "no other race's reading moves", JSON.stringify(moved) === JSON.stringify([...THREE].sort()), `moved: ${moved.join(", ")} of ${ra.size}`);
    const table = (r: Readings) => { const t: Record<string, number> = {}; for (const [, x] of r) if (x.qualifier) t[tagOf(x)] = (t[tagOf(x)] ?? 0) + 1; return JSON.stringify(Object.fromEntries(Object.entries(t).sort())); };
    say(`  the table before ${table(rb)} · after ${table(ra)}`);
  }

  // ── leg 4: the runoff block (in process: the race page's read, rendered) ─
  say(`\n── leg 4: the runoff block`);
  {
    const render = (code: string, url: string, race: string) => {
      const r = spawnChild(["render", "--code", code, "--race", race], url, null);
      if (r.code !== 0 || !r.result) throw new Error(`render child failed: ${r.out.slice(-1500)}`);
      return r.result as { rows: unknown[]; heads: string[]; lis: string[] };
    };
    const tGA = render("tree", A, "S-GA-2026"), hGA = render("head", A, "S-GA-2026");
    const tGAb = render("tree", B, "S-GA-2026");
    const tLAb = render("tree", B, "S-LA-2026"), tLAa = render("tree", A, "S-LA-2026");
    say(`  S-GA after, tree: ${tGA.lis.join(" | ")}\n  S-GA after, HEAD: ${hGA.lis.join(" | ")}\n  S-GA before, tree: ${tGAb.lis.join(" | ")}\n  S-LA before, tree: ${tLAb.lis.join(" | ")}\n  S-LA after, tree: ${tLAa.lis.join(" | ")}`);
    check("4", "red: HEAD's block on the after rows shows Dooley pending (a share and no result)", hGA.lis.some((l) => l.includes("Derek Dooley") && /44\.5%$/.test(l)) && !hGA.lis.some((l) => /lost/i.test(l)), hGA.lis.join(" | "));
    check("4", "the tree's block on the after rows: Collins won, Dooley lost", tGA.lis.some((l) => l.includes("Mike Collins") && l.endsWith("55.5% · won")) && tGA.lis.some((l) => l.includes("Derek Dooley") && l.endsWith("44.5% · lost")), tGA.lis.join(" | "));
    check("4", "an undecided seeded row stays Pending: LA's two runoffs on the before copy, all four rows", tLAb.lis.length === 4 && tLAb.lis.every((l) => l.endsWith("Pending")), tLAb.lis.join(" | "));
    check("4", "and GA's seed before the repair reads Pending twice (prod's page today)", tGAb.lis.length === 2 && tGAb.lis.every((l) => l.endsWith("Pending")), tGAb.lis.join(" | "));
    check("4", "LA after the repair: Letlow and Davis won, Fleming and Crockett lost", tLAa.lis.length === 4 && ["Julia Letlow", "Jamie Davis"].every((n) => tLAa.lis.some((l) => l.includes(n) && l.endsWith("· won"))) && ["John Fleming", "Gary Crockett"].every((n) => tLAa.lis.some((l) => l.includes(n) && l.endsWith("· lost"))), tLAa.lis.join(" | "));
  }

  // ── leg 6: nothing else moves ──────────────────────────────────────────────
  say(`\n── leg 6: nothing else moves`);
  {
    const hashAfter = await tableHashes(A);
    const d = diffKeys(hashBefore, hashAfter);
    const sqB = await sequenceRows(B), sqA = await sequenceRows(A);
    check("6", "before → after: only primaries and primary_candidates change, and sqlite_sequence only in primary_candidates' counter (the instrument fires on those, so it can)", JSON.stringify(d) === WRITE_TABLES && sqB.others === sqA.others, `differ: ${d.join(", ")} · of ${Object.keys(hashAfter).length} tables · ${sqB.pc} → ${sqA.pc} · other counters ${sqB.others === sqA.others ? "equal" : "MOVED"}`);
    check("6", "and in them only the runoff rounds: every primary-round row and roster, whole, is equal", (await roundHash(B, "primary")) === (await roundHash(A, "primary")), `${await roundHash(B, "primary")} · ${await roundHash(A, "primary")}`);
    const ra = await runoffRows(A);
    const oneWinner = [...ra.values()].filter((r) => r.cands.filter((c) => c.status === "winner").length === 1);
    check("6", `the after copy holds the census's ${CENSUS_BOXES} runoff rounds, each with one winner (30 new, the 3 seeds updated)`, ra.size === CENSUS_BOXES && oneWinner.length === CENSUS_BOXES, `${ra.size} rounds, ${oneWinner.length} with one winner`);
    writeFileSync(path.join(ART, `after-runoffs-${LABEL}.txt`), [...ra.values()].map(showRow).join("\n") + "\n");
    // the harvest, on clones
    copyFileSync(copyPath("before"), copyPath("hbefore"));
    copyFileSync(copyPath("after"), copyPath("hafter"));
    const { harvestChallengers } = await import("@/lib/harvest-challengers");
    const pB = await withDb(copyUrl(copyPath("hbefore")), (db) => harvestChallengers(db));
    const pA = await withDb(copyUrl(copyPath("hafter")), (db) => harvestChallengers(db));
    const rc = async (url: string) => withDb(url, async (db) => (await db.execute(`SELECT race_id, name, party, bioguide_id, status, source_url, printed_party FROM race_candidates ORDER BY race_id, name`)).rows.map((r) => JSON.stringify(Object.values(r))).join("\n"));
    // HarvestResult's one volatile field is runStamp (lib/harvest-challengers.ts, the type).
    const volatile = (p: Record<string, unknown>) => JSON.stringify(p, (k, v) => (k === "runStamp" ? undefined : v));
    writeFileSync(path.join(ART, `leg6-harvest-${LABEL}.json`), JSON.stringify({ before: pB, after: pA }, null, 1));
    // PAC targets (lib/pac-target-status.ts reads runoff rounds by design: rung 1b holds an advancer
    // whose runoff has no resulted row at `unknown`). Measured, not asserted equal: the page's own
    // read on each copy, and every status that moves listed.
    const pac = (url: string) => {
      const r = spawnChild(["pac", "--code", "tree"], url, null);
      if (r.code !== 0 || !r.result) throw new Error(`pac child failed: ${r.out.slice(-1500)}`);
      return (r.result as { rows: string[] }).rows;
    };
    const pacB = pac(B), pacA = pac(A);
    const pacMoved = pacA.filter((x) => !pacB.includes(x));
    writeFileSync(path.join(ART, `leg6-pac-${LABEL}.txt`), `before\n${pacB.join("\n")}\n\nafter\n${pacA.join("\n")}\n`);
    say(`  PAC targets (getPacIeSpending on each copy): ${pacB.length} before, ${pacA.length} after · moved: ${pacMoved.length ? pacMoved.map((x) => `${pacB.find((b) => b.slice(0, b.lastIndexOf(" · ")) === x.slice(0, x.lastIndexOf(" · "))) ?? "?"} → ${x.slice(x.lastIndexOf(" · ") + 3)}`).join(" | ") : "none"}`);
    check("6", "the PAC reading is taken (the same targets on both copies); what moves is listed above, not asserted away", pacB.length === pacA.length && pacB.length > 0, `${pacB.length} targets`);
    check("6", "the harvest's result on the two copies is identical (race_candidates whole, and the payload less its runStamp)", (await rc(copyUrl(copyPath("hbefore")))) === (await rc(copyUrl(copyPath("hafter")))) && volatile(pB as never) === volatile(pA as never), `race_candidates ${sha(await rc(copyUrl(copyPath("hbefore"))))} · ${sha(await rc(copyUrl(copyPath("hafter"))))} · payload ${sha(volatile(pB as never))} · ${sha(volatile(pA as never))}`);
  }

  await prodUntouched("the legs", fp0, t0);
  say(`\n${passes} PASS · ${fails} FAIL`);
}

// ── leg 5: the CLI itself ────────────────────────────────────────────────────
async function cliLeg() {
  say(`=== HO 761 leg 5 · ${LABEL} · ${new Date().toISOString()} ===`);
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();
  const C = copyUrl(copyPath("cli"));
  if (!existsSync(copyPath("cli")) || !existsSync(copyPath("after"))) throw new Error("run the legs with this label first (the cli and after copies)");
  const run = (write: boolean) => {
    const log = path.join(DIR, `shim761-cli-${write ? "write" : "dry"}-${LABEL}.log`);
    if (existsSync(log)) rmSync(log);
    const r = spawnSync(process.execPath, [TSX, "scripts/repair-runoffs.ts", ...(write ? ["--write"] : [])], { env: childEnv(C, log), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const out = redactSecrets(`${r.stdout}\n${r.stderr}`);
    writeFileSync(path.join(ART, `leg5-cli-${write ? "write" : "dry"}-${LABEL}.txt`), out);
    const shim = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : [];
    return { code: r.status, out, shim };
  };
  const h0 = await tableHashes(C);
  const dry = run(false);
  const h1 = await tableHashes(C);
  const planned = Number(dry.out.match(/would insert \((\d+)\)/)?.[1] ?? -1), reopen = Number(dry.out.match(/would reopen and update \(expired, undecided\) \((\d+)\)/)?.[1] ?? -1);
  check("5", "the dry run writes nothing: every table's content hash is equal", dry.code === 0 && diffKeys(h0, h1).length === 0, `exit ${dry.code} · differ: ${diffKeys(h0, h1).join(", ") || "none"}`);
  check("5", "…and it is not an empty run: it plans 30 inserts and 3 reopens", planned === 30 && reopen === 3, `would insert ${planned} · would reopen ${reopen}`);
  const wr = run(true);
  const h2 = await tableHashes(C);
  const rc = await runoffRows(C), ra = await runoffRows(copyUrl(copyPath("after")));
  const oneWinner = [...rc.values()].filter((r) => r.cands.filter((c) => c.status === "winner").length === 1).length;
  check("5", `--write yields the census's ${CENSUS_BOXES} runoff rounds, each with one winner (the hash moves on primaries, primary_candidates and its sqlite_sequence counter only)`, wr.code === 0 && rc.size === CENSUS_BOXES && oneWinner === CENSUS_BOXES && JSON.stringify(diffKeys(h1, h2)) === WRITE_TABLES, `exit ${wr.code} · ${rc.size} rounds, ${oneWinner} with one winner · differ: ${diffKeys(h1, h2).join(", ")}`);
  check("5", "the CLI's rounds equal the in-process repair's (the after copy), row by row", rc.size === ra.size && [...rc.keys()].every((id) => ra.has(id) && content(rc.get(id)!) === content(ra.get(id)!)), `${[...rc.keys()].filter((id) => !ra.has(id) || content(rc.get(id)!) !== content(ra.get(id)!)).join(", ") || "all equal"}`);
  for (const [tag, r] of [["dry", dry], ["write", wr]] as const) {
    const gap = Number(r.out.match(/minGapMs (\d+)/)?.[1] ?? -1), req = Number(r.out.match(/requests (\d+)/)?.[1] ?? -1);
    check("5", `the ${tag} run's pacing and pages: 104 requests, every start ≥ 6000 ms apart, every one answered 200 by the shim`, req === 104 && gap >= 6000 && r.shim.length === 104 && r.shim.every((l) => / 200 https:\/\/ballotpedia\.org\//.test(l)), `requests ${req} · minGapMs ${gap} · shim lines ${r.shim.length}, 200s ${r.shim.filter((l) => / 200 /.test(l)).length}`);
  }
  await prodUntouched("leg 5", fp0, t0);
  say(`\n${passes} PASS · ${fails} FAIL`);
}

// ── captures ────────────────────────────────────────────────────────────────
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
const PRODUCT = ["components/RaceRunoffs.tsx", "lib/primaries-sync.ts", "lib/primary-candidates-scrape.ts", "lib/incumbent-qualifier.ts", "lib/runoff-repair.ts"];
function buildState(): string {
  const built = statSync(".next/BUILD_ID").mtime;
  const newest = Math.max(...PRODUCT.map((f) => statSync(f).mtime.getTime()));
  if (built.getTime() < newest) throw new Error("the build is older than a product file; rebuild first");
  const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim();
  const headBlob = (f: string) => { try { return execFileSync("git", ["rev-parse", `${HEAD_SHA}:${f}`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "absent"; } };
  const changed = PRODUCT.filter((f) => blob(f) !== headBlob(f));
  if (changed.length !== PRODUCT.length) throw new Error(`the tree's build is wanted: ${PRODUCT.length - changed.length} product files are still at ${HEAD_SHA}`);
  return `build ${readFileSync(".next/BUILD_ID", "utf8").trim()} @ ${built.toISOString()} · all ${PRODUCT.length} product files differ from ${HEAD_SHA} · the build is newer than every one`;
}
async function startServer(kind: "before" | "after") {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  await withDb(copyUrl(copyPath(kind)), async (db) => {
    const have = await db.execute({ sql: `SELECT 1 FROM cron_runs WHERE route = ? AND started_at = ?`, args: [ROUTE, SENTINEL[kind]!] });
    if (!have.rows.length) await db.execute({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 761, 'success', ?)`, args: [ROUTE, SENTINEL[kind]!, SENTINEL[kind]!, JSON.stringify({ sentinel: `HO 761 legs, the ${kind} copy only` })] });
  });
  const cache = path.resolve(".next/cache/fetch-cache");
  const n = existsSync(cache) ? readdirSync(cache).length : 0;
  rmSync(cache, { recursive: true, force: true });
  const log = path.join(DIR, `server761-${kind}-${LABEL}.log`);
  const out = createWriteStream(log);
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env: childEnv(copyUrl(copyPath(kind)), null), stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (b: Buffer) => out.write(b));
  server.stderr.on("data", (b: Buffer) => out.write(b));
  const kill = async () => { try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ } out.end(); await sleep(900); };
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`http://127.0.0.1:${PORT}/api/health`)).status > 0; } catch { /* not yet */ } }
  if (!up) { await kill(); throw new Error("the server never answered /api/health"); }
  const pids = listeningPids();
  const ours = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${server.pid}").ProcessId`], { encoding: "utf8" }).split(/\s+/).filter(Boolean).map(Number);
  const h = (await (await fetch(`http://127.0.0.1:${PORT}/api/health`)).json()) as { routes?: { path?: string; lastRunAt?: string }[] };
  const mine = h.routes?.find((r) => r.path === ROUTE);
  if (mine?.lastRunAt !== SENTINEL[kind]) { await kill(); throw new Error(`transport check failed: lastRunAt ${String(mine?.lastRunAt)} is not the ${kind} copy's sentinel`); }
  say(`  server :${PORT} (spawned pid ${server.pid}, its children ${ours.join(",") || "none"}, listening pid ${pids.join(",")}${pids.every((p) => p === server.pid || ours.includes(p)) ? ", ours" : ", NOT OURS"}) · ${kind} copy (own sentinel ${SENTINEL[kind]}) · fetch-cache cleared (${n})`);
  if (!pids.every((p) => p === server.pid || ours.includes(p))) { await kill(); throw new Error("the listener is not our server"); }
  return { kill };
}
const READ_BLOCK = `(() => {
  const norm = (s) => (s || '').split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ');
  const h = Array.from(document.querySelectorAll('main section h2')).find((x) => norm(x.textContent) === 'Runoff');
  const s = h ? h.closest('section') : null;
  if (!s) return null;
  return {
    head: norm(s.firstElementChild ? s.firstElementChild.textContent : ''),
    parties: Array.from(s.querySelectorAll('p')).map((p) => norm(p.textContent)),
    rows: Array.from(s.querySelectorAll('li')).map((li) => norm(li.textContent)),
    border: getComputedStyle(s).borderTopWidth,
    sheets: document.styleSheets.length,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
})()`;
async function captures() {
  say(`=== HO 761 captures · ${LABEL} · ${new Date().toISOString()} · ${buildState()} ===`);
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const shots = path.join(ART, "captures");
  mkdirSync(shots, { recursive: true });
  const MODES = [{ tag: "1440", w: 1440, h: 1200, rm: "no-preference" as const }, { tag: "2560", w: 2560, h: 1440, rm: "no-preference" as const }, { tag: "1440-reduced", w: 1440, h: 1200, rm: "reduce" as const }];
  const readings: Record<string, unknown> = {};
  const errors: string[] = [];
  try {
    for (const kind of ["before", "after"] as const) {
      const srv = await startServer(kind);
      try {
        for (const m of MODES) {
          const ctx = await browser.newContext({ viewport: { width: m.w, height: m.h }, reducedMotion: m.rm });
          await ctx.addCookies([{ name: "ct_seen", value: "1", domain: "127.0.0.1", path: "/" }]);
          const page = await ctx.newPage();
          page.on("console", (x) => { if (x.type() === "error") errors.push(`${kind} ${m.tag} ${page.url()}: ${x.text().slice(0, 200)}`); });
          page.on("pageerror", (e) => errors.push(`${kind} ${m.tag} ${page.url()}: pageerror ${String(e).slice(0, 200)}`));
          for (const race of ["S-GA-2026", "S-LA-2026"]) {
            const res = await page.goto(`http://127.0.0.1:${PORT}/race/${race}`, { waitUntil: "networkidle" });
            const css = await page.evaluate(`Array.from(document.querySelectorAll('link[rel=stylesheet]')).map((l) => l.href)`) as string[];
            const cssOk = await Promise.all(css.map(async (href) => (await page.request.get(href)).status()));
            const block = (await page.evaluate(READ_BLOCK)) as { head: string; parties: string[]; rows: string[]; border: string; sheets: number; reduced: boolean } | null;
            readings[`${kind} ${race} ${m.tag}`] = { status: res?.status(), css: cssOk, block };
            const section = page.locator("main section", { has: page.locator("h2", { hasText: /^Runoff$/ }) }).first();
            if (await section.count()) await section.screenshot({ path: path.join(shots, `${kind}-${race}-${m.tag}.png`) });
            say(`  ${kind} ${race} ${m.tag}: HTTP ${res?.status()} · stylesheets ${css.length} (${cssOk.join(",")}) · reduced-motion in page ${block?.reduced} · border ${block?.border} · ${block ? `${block.head} · ${block.parties.join(" / ")} · ${block.rows.join(" | ")}` : "NO RUNOFF BLOCK"}`);
          }
          await ctx.close();
        }
      } finally { await srv.kill(); }
      const after = listeningPids();
      say(`  port ${PORT} after the kill: ${after.length ? `STILL BOUND by ${after.join(",")}` : "free"}`);
    }
  } finally { await browser.close(); }
  writeFileSync(path.join(ART, `captures-${LABEL}.json`), JSON.stringify(readings, null, 1));
  const r = readings as Record<string, { status: number; css: number[]; block: { rows: string[]; reduced: boolean; border: string } | null }>;
  for (const m of MODES) {
    const want = m.rm === "reduce";
    const all = Object.entries(r).filter(([k]) => k.endsWith(` ${m.tag}`));
    check("4", `${m.tag}: every page 200, every stylesheet 200, the block drawn (a border), reduced-motion read back in the page as ${want}`, all.length === 4 && all.every(([, v]) => v.status === 200 && v.css.length > 0 && v.css.every((s) => s === 200) && v.block != null && v.block.reduced === want && v.block.border !== "0px"), all.map(([k, v]) => `${k}: ${v.status} css ${v.css.join(",")} reduced ${v.block?.reduced} border ${v.block?.border}`).join(" · "));
    const ga = (k: string) => r[`${k} S-GA-2026 ${m.tag}`]?.block?.rows ?? [];
    const la = (k: string) => r[`${k} S-LA-2026 ${m.tag}`]?.block?.rows ?? [];
    // textContent joins the row's spans with no space ("Mike Collins55.5% · won"), hence the \s?.
    check("4", `${m.tag}: S-GA before reads Collins and Dooley Pending; after, Collins 55.5% · won and Dooley 44.5% · lost`, ga("before").length === 2 && ga("before").every((x) => /Pending$/.test(x)) && ga("after").some((x) => /Mike Collins\s?55\.5% · won$/.test(x)) && ga("after").some((x) => /Derek Dooley\s?44\.5% · lost$/.test(x)), `before ${ga("before").join(" | ")} · after ${ga("after").join(" | ")}`);
    check("4", `${m.tag}: S-LA before (undecided seeds) reads Pending on all four rows; after, two won and two lost`, la("before").length === 4 && la("before").every((x) => /Pending$/.test(x)) && la("after").filter((x) => /· won$/.test(x)).length === 2 && la("after").filter((x) => /· lost$/.test(x)).length === 2, `before ${la("before").join(" | ")} · after ${la("after").join(" | ")}`);
  }
  check("4", "no console error or page error on any capture", errors.length === 0, errors.join(" · ") || "none");
  await prodUntouched("the captures", fp0, t0);
  say(`\n${passes} PASS · ${fails} FAIL`);
}

const mode = process.argv.includes("--cli") ? cliLeg : process.argv.includes("--captures") ? captures : legs;
mode().then(() => process.exit(fails ? 1 : 0)).catch((e) => { console.error(redactSecrets(String(e?.stack ?? e))); process.exit(2); });
