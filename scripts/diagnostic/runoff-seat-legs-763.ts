// HO 763 legs: a written runoff draws its block. The runoff read keys on the seat (state, chamber, cycle,
// and the House district), not on a race_id the sync never wrote. On `file:` copies seeded whole from
// prod (which holds HO 762's 33 rounds), red first against HEAD (99f16a1).
//   npx tsx scripts/diagnostic/runoff-seat-legs-763.ts --seed --label L            the copies
//   (HEAD build)  npx tsx scripts/diagnostic/runoff-seat-legs-763.ts --phase before --label L
//   (tree build)  npx tsx scripts/diagnostic/runoff-seat-legs-763.ts --phase after --label L
//   npx tsx scripts/diagnostic/runoff-seat-legs-763.ts --legs --label L            legs 1-3, HEAD and tree
//
// The copies, one template (the real migrate, 13 tables read whole from prod):
//   main   untouched: legs 1 and 2, and the captures
//   stub   TX-18-2026 with its one roster row taken out and no rating, so its runoff is all it has:
//          HEAD's page prints the stub, the tree's draws the runoff and no stub
//   stray  a runoff round planted on a seat no race has (house-TX-99-2026-D-runoff): leg 3
//   tick   the stray copy's twin, for the primaries cron tick through the shim (leg 3's payload)
//
//   1 the read      red: HEAD's getRunoffsForRace draws nothing for TX-18; the tree's draws its D round;
//                   S-SC the special's round; S-GA the seeded round, as before; TX-02 none; a 2028/2030
//                   Senate race of a runoff state none (the cycle is in the key)
//   2 the count     every race read: exactly STEP 0's 26 races gain exactly its 30 blocks, S-GA and S-LA
//                   draw what they drew, 33 blocks on 28 races in all
//   3 strays        the planted round is named by the stray list and in the tick's payload (HEAD's
//                   payload has no such list), and no race draws it
//   4 captures      HEAD's build and the tree's, 1440, 2560 and 1440 reduced: TX-18, TX-33 (two blocks),
//                   S-GA; and the stub copy's TX-18, whose stub HEAD prints and the tree does not
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed and a fingerprint before and after every
// mode. Copies are `file:${abs}` from paths ending -763-legs.db; children get that URL with
// TURSO_AUTH_TOKEN="" and refuse any other. Every printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const HEAD_SHA = "99f16a1";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const CWD = path.join(DIR, "cwd-763");
const ART = path.resolve("docs/handoffs/763-artifacts");
const PAGES = path.resolve("docs/handoffs/747-artifacts/pages");
const LIVE_SC = path.resolve("docs/handoffs/761-artifacts/S-SC-2026.live-761.html.gz");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const TSCONFIG = path.resolve("tsconfig.json");
const CHILD = path.resolve("scripts/diagnostic/runoff-seat-child-763.ts");
const STUB = pathToFileURL(path.resolve("scripts/diagnostic/next-cache-stub-757.mjs")).href;
const SHIM = path.resolve("scripts/diagnostic/runoff-pages-shim-761.cjs").replace(/\\/g, "/");
const PORT = 3763;
const ROUTE = "/api/cron/race-challengers";
const SENTINEL: Record<string, string> = { main: "2026-10-01T03:00:01.763Z", stub: "2026-10-01T03:00:02.763Z" };
const TABLES = ["races", "members", "member_ids", "race_ratings", "race_candidates", "kalshi_odds", "polymarket_odds", "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads"];
const STRAY = "house-TX-99-2026-D-runoff";
// STEP 0 (docs/handoffs/763-artifacts/step0-763.txt): the races that gain a block, and their counts.
const GAIN: Record<string, number> = { "AL-05-2026": 1, "GA-01-2026": 1, "GA-07-2026": 1, "GA-11-2026": 1, "GA-12-2026": 1, "S-AL-2026": 2, "S-OK-2026": 1, "S-SC-2026": 1, "S-TX-2026": 1, "SC-01-2026": 2, "SC-02-2026": 1, "TX-01-2026": 1, "TX-05-2026": 1, "TX-07-2026": 1, "TX-09-2026": 1, "TX-14-2026": 1, "TX-16-2026": 1, "TX-17-2026": 1, "TX-18-2026": 1, "TX-19-2026": 1, "TX-24-2026": 1, "TX-30-2026": 1, "TX-33-2026": 2, "TX-35-2026": 2, "TX-37-2026": 1, "TX-38-2026": 1 };
const KEEP: Record<string, string[]> = { "S-GA-2026": ["senate-GA-2026-R-runoff"], "S-LA-2026": ["senate-LA-2026-D-runoff", "senate-LA-2026-R-runoff"] };
const CAPTURE = ["TX-18-2026", "TX-33-2026", "S-GA-2026"];

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
  // The cursor row too: the one prod row a primaries tick writes (leg 3 runs ticks, on copies only).
  const fp = { primaries: await hash(`SELECT * FROM primaries ORDER BY id`), pc: await hash(`SELECT * FROM primary_candidates ORDER BY id`), races: await hash(`SELECT * FROM races ORDER BY id`), rc: await hash(`SELECT * FROM race_candidates ORDER BY race_id, name`), schema: await hash(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`), cursor: await hash(`SELECT key, value, updated_at FROM dashboard_state WHERE key = 'primaries_cron_cursor'`) };
  db.close();
  return JSON.stringify(fp);
}
async function prodUntouched(what: string, fp0: string) {
  const fp1 = await prodFingerprint();
  check("*", `prod untouched (${what})`, fp0 === fp1, fp0 === fp1 ? "fingerprints equal" : `${fp0} → ${fp1}`);
}

// ── copies ──────────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-763-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-763-legs.db")) throw new Error(`refused: a copy must be a *-763-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
function childEnv(url: string, shim: { log: string; map: string } | null): NodeJS.ProcessEnv {
  if (!url.startsWith("file:")) throw new Error("refused: children get file: only");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url, LEGS_763_HEAD_DIR: DIR };
  env.TURSO_AUTH_TOKEN = "";
  if (shim) { env.NODE_OPTIONS = `--require ${SHIM}`; env.SHIM_761_MAP = shim.map; env.SHIM_761_LOG = shim.log; }
  return env;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
function headFile(repoPath: string, out: string): string {
  const src = execFileSync("git", ["cat-file", "-p", `${HEAD_SHA}:${repoPath}`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 16 * 1024 * 1024 });
  const dst = path.join(DIR, out);
  writeFileSync(dst, src.replace(/from "\.\/([^"]+)"/g, (_, m: string) => `from "@/lib/${m}"`).replace(/from "\.\.\/([^"]+)"/g, (_, m: string) => `from "@/${m}"`));
  return dst;
}
function spawnChild(args: string[], url: string, shim: { log: string; map: string } | null) {
  mkdirSync(CWD, { recursive: true });
  const r = spawnSync(process.execPath, [TSX, "--tsconfig", TSCONFIG, "--import", STUB, CHILD, ...args], { cwd: CWD, env: childEnv(url, shim), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const out = redactSecrets(`${r.stdout}\n${r.stderr}`);
  const line = (r.stdout ?? "").split(/\r?\n/).reverse().find((l) => l.startsWith("RESULT "));
  if (r.status !== 0 || !line) throw new Error(`child ${args.join(" ")} failed: ${out.slice(-1500)}`);
  return { out, result: JSON.parse(line.slice(7)) as Record<string, unknown> };
}

// ── seed ────────────────────────────────────────────────────────────────────
async function seed() {
  mkdirSync(DIR, { recursive: true });
  mkdirSync(ART, { recursive: true });
  const fp0 = await prodFingerprint();
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
  for (const k of ["main", "stub", "stray", "tick"]) copyFileSync(tpl, copyPath(k));
  const sentinel = (kind: string) => ({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 763, 'success', ?)`, args: [ROUTE, SENTINEL[kind]!, SENTINEL[kind]!, JSON.stringify({ sentinel: `HO 763 legs, the ${kind} copy only` })] });
  await withDb(copyUrl(copyPath("main")), (db) => db.execute(sentinel("main")));
  const stubbed = await withDb(copyUrl(copyPath("stub")), async (db) => {
    await db.execute(sentinel("stub"));
    const rc = await db.execute(`DELETE FROM race_candidates WHERE race_id = 'TX-18-2026'`);
    const rr = await db.execute(`DELETE FROM race_ratings WHERE race_id = 'TX-18-2026'`);
    const ra = await db.execute(`UPDATE races SET rating = NULL WHERE id = 'TX-18-2026'`);
    const left = (await db.execute(`SELECT (SELECT COUNT(*) FROM race_candidates WHERE race_id = 'TX-18-2026') rc, (SELECT COUNT(*) FROM race_ratings WHERE race_id = 'TX-18-2026') rr, (SELECT rating FROM races WHERE id = 'TX-18-2026') rating`)).rows[0]!;
    return `roster rows removed ${rc.rowsAffected}, ratings ${rr.rowsAffected}, rating set NULL ${ra.rowsAffected} · left: roster ${left.rc}, ratings ${left.rr}, rating ${left.rating}`;
  });
  const plant = async (db: Client) => {
    await db.execute("PRAGMA foreign_keys = ON");
    await db.batch([
      { sql: `INSERT INTO primaries (id, state, district, chamber, party, primary_date, runoff_date, primary_type, election_round, updated_at) VALUES (?, 'TX', '99', 'house', 'D', '2026-05-26', NULL, 'open', 'runoff', ?)`, args: [STRAY, new Date().toISOString()] },
      { sql: `INSERT INTO primary_candidates (primary_id, name, party, incumbent, bioguide_id, status, vote_pct, updated_at) VALUES (?, 'Planted Winner', 'D', 0, NULL, 'winner', 60, ?)`, args: [STRAY, new Date().toISOString()] },
      { sql: `INSERT INTO primary_candidates (primary_id, name, party, incumbent, bioguide_id, status, vote_pct, updated_at) VALUES (?, 'Planted Loser', 'D', 0, NULL, 'running', 40, ?)`, args: [STRAY, new Date().toISOString()] },
    ], "write");
    return Number((await db.execute({ sql: `SELECT COUNT(*) n FROM primary_candidates WHERE primary_id = ?`, args: [STRAY] })).rows[0]!.n);
  };
  const ps = await withDb(copyUrl(copyPath("stray")), plant);
  const pt = await withDb(copyUrl(copyPath("tick")), plant);
  say(`template: the real migrate against file:, seeded whole from prod · ${counts.join(" · ")} · copies main, stub, stray, tick`);
  say(`  stub copy: ${stubbed}`);
  say(`  stray and tick copies: ${STRAY} planted with ${ps} and ${pt} candidates`);
  await prodUntouched("the seed", fp0);
}

// ── legs 1-3 ────────────────────────────────────────────────────────────────
async function legs() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim().slice(0, 10);
  say(`=== HO 763 legs · ${LABEL} · ${new Date().toISOString()} · tree ${tree} · queries ${blob("lib/queries.ts")} seat ${blob("lib/runoff-seat.ts")} sync ${blob("lib/primaries-sync.ts")} · driver ${blob("scripts/diagnostic/runoff-seat-legs-763.ts")} child ${blob(CHILD)} ===`);
  const fp0 = await prodFingerprint();
  headFile("lib/queries.ts", "head-queries-763.ts");
  headFile("lib/primaries-sync.ts", "head-primaries-sync-763.ts");
  const M = copyUrl(copyPath("main"));
  const h = spawnChild(["runoffs", "--code", "head"], M, null).result as { races: number; drawn: Record<string, string[]> };
  const t = spawnChild(["runoffs", "--code", "tree"], M, null).result as { races: number; drawn: Record<string, string[]> };
  writeFileSync(path.join(ART, `leg12-drawn-${LABEL}.json`), JSON.stringify({ head: h, tree: t }, null, 1));
  const races = await withDb(M, async (db) => (await db.execute(`SELECT id, cycle, chamber, state FROM races`)).rows.map((r) => ({ id: String(r.id), cycle: Number(r.cycle), chamber: String(r.chamber), state: String(r.state) })));

  say(`\n── leg 1: the read`);
  check("1", "red: HEAD's read draws nothing for TX-18", !h.drawn["TX-18-2026"], JSON.stringify(h.drawn["TX-18-2026"] ?? []));
  check("1", "the tree's read draws TX-18's D round", JSON.stringify(t.drawn["TX-18-2026"]) === JSON.stringify(["house-TX-18-2026-D-runoff"]), JSON.stringify(t.drawn["TX-18-2026"]));
  check("1", "S-SC draws the special's round, and no June primary round", JSON.stringify(t.drawn["S-SC-2026"]) === JSON.stringify(["senate-SC-2026-special-R-runoff"]), JSON.stringify(t.drawn["S-SC-2026"]));
  check("1", "S-GA draws the seeded round, as HEAD does", JSON.stringify(t.drawn["S-GA-2026"]) === JSON.stringify(["senate-GA-2026-R-runoff"]) && JSON.stringify(h.drawn["S-GA-2026"]) === JSON.stringify(t.drawn["S-GA-2026"]), `tree ${JSON.stringify(t.drawn["S-GA-2026"])} · HEAD ${JSON.stringify(h.drawn["S-GA-2026"])}`);
  check("1", "a race with no round (TX-02) draws none", !t.drawn["TX-02-2026"], JSON.stringify(t.drawn["TX-02-2026"] ?? []));
  const later = races.filter((r) => r.cycle !== 2026 && r.chamber === "senate" && ["AL", "GA", "LA", "OK", "SC", "TX"].includes(r.state));
  check("1", `the cycle is in the key: the other cycles' Senate races of the runoff states (${later.length}) draw none`, later.length > 0 && later.every((r) => !t.drawn[r.id]), later.map((r) => r.id).join(", "));

  say(`\n── leg 2: the count`);
  const blocks = (d: Record<string, string[]>) => Object.values(d).reduce((n, ids) => n + ids.length, 0);
  const gained = Object.keys(t.drawn).filter((k) => !h.drawn[k]).sort();
  check("2", `exactly STEP 0's ${Object.keys(GAIN).length} races gain exactly its ${Object.values(GAIN).reduce((a, b) => a + b, 0)} blocks`, JSON.stringify(gained) === JSON.stringify(Object.keys(GAIN).sort()) && gained.every((k) => t.drawn[k]!.length === GAIN[k]), gained.map((k) => `${k} ${t.drawn[k]!.length}`).join(" · "));
  check("2", "every race HEAD drew still draws the same rounds (S-GA, S-LA), and HEAD drew no other", JSON.stringify(h.drawn) === JSON.stringify(KEEP) && Object.keys(KEEP).every((k) => JSON.stringify(t.drawn[k]) === JSON.stringify(KEEP[k])), `HEAD ${JSON.stringify(h.drawn)}`);
  check("2", `in all, ${blocks(t.drawn)} blocks on ${Object.keys(t.drawn).length} races of ${t.races} read (STEP 0: 33 on 28)`, blocks(t.drawn) === 33 && Object.keys(t.drawn).length === 28, `HEAD ${blocks(h.drawn)} on ${Object.keys(h.drawn).length}`);

  say(`\n── leg 3: strays`);
  // Typed by hand: the before phase builds HEAD, where the function does not exist yet, and `next
  // build` type-checks this file.
  const { findRunoffStrays } = (await import("@/lib/primaries-sync")) as unknown as { findRunoffStrays: (db: Client) => Promise<string[]> };
  const strays = await withDb(copyUrl(copyPath("stray")), (db) => findRunoffStrays(db));
  const strays0 = await withDb(M, (db) => findRunoffStrays(db));
  check("3", "the stray list names the planted round, and nothing on the unplanted copy", strays.length === 1 && strays[0]!.startsWith(STRAY) && strays0.length === 0, `${JSON.stringify(strays)} · unplanted ${JSON.stringify(strays0)}`);
  const ts = spawnChild(["runoffs", "--code", "tree"], copyUrl(copyPath("stray")), null).result as { drawn: Record<string, string[]> };
  check("3", "no race draws the planted round", !Object.values(ts.drawn).flat().includes(STRAY) && blocks(ts.drawn) === 33, `${blocks(ts.drawn)} blocks drawn`);
  // the tick, through the shim, on the tick copy: HEAD's payload has no stray list, the tree's names it
  const map = await urlMap();
  const mapFile = path.join(DIR, `shim763-map-${LABEL}.json`);
  writeFileSync(mapFile, JSON.stringify(map));
  const tickRun = async (code: string) => {
    copyFileSync(copyPath("tick"), copyPath(`tick${code}`));
    await withDb(copyUrl(copyPath(`tick${code}`)), (db) => db.execute(`INSERT INTO dashboard_state (key, value, updated_at) VALUES ('primaries_cron_cursor', '440', '2026-10-01T00:00:00Z') ON CONFLICT(key) DO UPDATE SET value = '440'`));
    const log = path.join(DIR, `shim763-tick${code}-${LABEL}.log`);
    if (existsSync(log)) rmSync(log);
    // scrapeHouseCandidates reads and writes process.cwd()/.cache/ballotpedia: cleared before each tick,
    // so each tick's pages come from the shim (the review caught the tree tick reading the HEAD tick's).
    rmSync(path.join(CWD, ".cache"), { recursive: true, force: true });
    const r = spawnChild(["tick", "--code", code], copyUrl(copyPath(`tick${code}`)), { log, map: mapFile });
    writeFileSync(path.join(ART, `leg3-tick-${code}-${LABEL}.txt`), r.out);
    const served = existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").filter((l) => / 200 https:\/\/ballotpedia\.org\//.test(l)).length : 0;
    return { ...(r.result as { unit?: string; cursorStart?: number; cursorEnd?: number; runoffStrays?: string[] }), served };
  };
  const th = await tickRun("head"), tt = await tickRun("tree");
  check("3", "each tick read its 12 pages from the shim (no disk cache)", th.served === 12 && tt.served === 12, `HEAD ${th.served} · tree ${tt.served}`);
  check("3", "red: HEAD's tick payload carries no stray list", th.runoffStrays === undefined && th.unit === "house", `unit ${th.unit} ${th.cursorStart}→${th.cursorEnd} · keys ${Object.keys(th).join(",")}`);
  check("3", "the tree's tick payload names the planted round, once", JSON.stringify(tt.runoffStrays?.map((s) => s.split(" ")[0])) === JSON.stringify([STRAY]) && tt.unit === "house", `unit ${tt.unit} ${tt.cursorStart}→${tt.cursorEnd} · runoffStrays ${JSON.stringify(tt.runoffStrays)}`);
  await prodUntouched("the legs", fp0);
  say(`\n${passes} PASS · ${fails} FAIL`);
}
async function urlMap(): Promise<Record<string, string>> {
  const { houseDistrictUrl, senatePageUrl } = await import("@/lib/primary-candidates-scrape");
  const { stateName } = await import("@/lib/states");
  const map: Record<string, string> = {};
  for (const run of readdirSync(PAGES).filter((d) => /^\d{4}-/.test(d)).sort().reverse()) {
    for (const f of readdirSync(path.join(PAGES, run)).filter((f) => f.endsWith(".html.gz")).sort().reverse()) {
      const id = f.slice(0, f.indexOf("."));
      const senate = id.startsWith("S-");
      const st = senate ? id.slice(2, 4) : id.slice(0, 2);
      const slug = stateName(st).replace(/ /g, "_");
      const dd = id.slice(3, id.indexOf("-2026"));
      const url = senate ? senatePageUrl(slug) : houseDistrictUrl(slug, dd === "AL" ? 0 : Number(dd));
      if (!map[url]) map[url] = id === "S-SC-2026" ? LIVE_SC : path.join(PAGES, run, f);
    }
  }
  return map;
}

// ── captures ────────────────────────────────────────────────────────────────
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
const PRODUCT = ["lib/queries.ts", "lib/primaries-sync.ts"];
const PRODUCT_NEW = ["lib/runoff-seat.ts"];
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
async function startServer(kind: "main" | "stub") {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  const cache = path.resolve(".next/cache/fetch-cache");
  const n = existsSync(cache) ? readdirSync(cache).length : 0;
  rmSync(cache, { recursive: true, force: true });
  const log = path.join(DIR, `server763-${kind}-${LABEL}-${Date.now()}.log`);
  const out = createWriteStream(log);
  const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", String(PORT)], { env: childEnv(copyUrl(copyPath(kind)), null), stdio: ["ignore", "pipe", "pipe"] });
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
  if (!pids.every((p) => p === server.pid)) { await kill(); throw new Error(`the listener (${pids.join(",")}) is not the spawned server (${server.pid})`); }
  say(`  server :${PORT} (spawned pid ${server.pid}, listening pid ${pids.join(",")}, ours) · ${kind} copy (own sentinel ${SENTINEL[kind]}) · fetch-cache cleared (${n})`);
  return { kill };
}
const READ = `(() => {
  const norm = (s) => (s || '').split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ');
  const main = document.querySelector('main');
  const h = Array.from(document.querySelectorAll('main section h2')).find((x) => norm(x.textContent) === 'Runoff');
  const s = h ? h.closest('section') : null;
  const text = norm(main ? main.innerText : '');
  return {
    block: s ? { head: norm(s.firstElementChild ? s.firstElementChild.textContent : ''), parties: Array.from(s.querySelectorAll('p')).map((p) => norm(p.textContent)), rows: Array.from(s.querySelectorAll('li')).map((li) => norm(li.innerText)), border: getComputedStyle(s).borderTopWidth } : null,
    // The stub's own sentences (lib/race-stub.ts). "Candidate filings forthcoming." alone is also the
    // Candidates section's empty-roster note (components/RaceCandidates.tsx), so it is read apart.
    stub: /No competitive rating yet\\.|Open seat\\. Candidate filings forthcoming\\./i.test(text),
    stubText: (text.match(/(Incumbent running for re-election\\. )?No competitive rating yet\\.|Open seat\\. Candidate filings forthcoming\\./i) || [null])[0],
    emptyRoster: /Candidates[\\s\\S]{0,40}Candidate filings forthcoming\\./i.test(text) && !/Open seat\\. Candidate filings forthcoming\\./i.test(text),
    sheets: document.styleSheets.length,
    reduced: matchMedia('(prefers-reduced-motion: reduce)').matches,
  };
})()`;
type Reading = { status: number | undefined; css: number[]; read: { block: { head: string; parties: string[]; rows: string[]; border: string } | null; stub: boolean; stubText: string | null; emptyRoster: boolean; reduced: boolean } };
async function phaseRun() {
  const phase = argAt("--phase");
  if (phase !== "before" && phase !== "after") throw new Error("--phase before|after");
  say(`=== HO 763 captures · phase ${phase} · ${LABEL} · ${new Date().toISOString()} · ${buildState(phase)} ===`);
  const fp0 = await prodFingerprint();
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const shots = path.join(ART, "captures");
  mkdirSync(shots, { recursive: true });
  const MODES = [{ tag: "1440", w: 1440, h: 1200, rm: "no-preference" as const }, { tag: "2560", w: 2560, h: 1440, rm: "no-preference" as const }, { tag: "1440-reduced", w: 1440, h: 1200, rm: "reduce" as const }];
  const readings: Record<string, Reading> = {};
  const errors: string[] = [];
  try {
    for (const kind of ["main", "stub"] as const) {
      const srv = await startServer(kind);
      try {
        for (const m of MODES) {
          const ctx = await browser.newContext({ viewport: { width: m.w, height: m.h }, reducedMotion: m.rm });
          await ctx.addCookies([{ name: "ct_seen", value: "1", domain: "127.0.0.1", path: "/" }]);
          const page = await ctx.newPage();
          page.on("console", (x) => { if (x.type() === "error") errors.push(`${kind} ${m.tag} ${page.url()}: ${x.text().slice(0, 200)}`); });
          page.on("pageerror", (e) => errors.push(`${kind} ${m.tag} ${page.url()}: pageerror ${String(e).slice(0, 200)}`));
          for (const race of kind === "main" ? CAPTURE : ["TX-18-2026"]) {
            const res = await page.goto(`http://127.0.0.1:${PORT}/race/${race}`, { waitUntil: "networkidle" });
            const css = (await page.evaluate(`Array.from(document.querySelectorAll('link[rel=stylesheet]')).map((l) => l.href)`)) as string[];
            const cssOk = await Promise.all(css.map(async (href) => (await page.request.get(href)).status()));
            const read = (await page.evaluate(READ)) as Reading["read"];
            const key = `${phase} ${kind} ${race} ${m.tag}`;
            readings[key] = { status: res?.status(), css: cssOk, read };
            const section = page.locator("main section", { has: page.locator("h2", { hasText: /^Runoff$/ }) }).first();
            const file = path.join(shots, `${phase}-${kind}-${race}-${m.tag}.png`);
            if (await section.count()) await section.screenshot({ path: file });
            else await page.locator("main").first().screenshot({ path: file });
            say(`  ${key}: HTTP ${res?.status()} · css ${cssOk.join(",")} · reduced ${read.reduced} · stub ${read.stub}${read.stubText ? ` «${read.stubText}»` : ""}${read.emptyRoster ? " · the roster section's empty note" : ""} · ${read.block ? `${read.block.parties.join(" / ")} · ${read.block.rows.join(" | ")}` : "no runoff block"}`);
          }
          await ctx.close();
        }
      } finally { await srv.kill(); }
      const after = listeningPids();
      say(`  port ${PORT} after the kill: ${after.length ? `STILL BOUND by ${after.join(",")}` : "free"}`);
    }
  } finally { await browser.close(); }
  writeFileSync(path.join(ART, `captures-${phase}-${LABEL}.json`), JSON.stringify(readings, null, 1));
  for (const m of MODES) {
    const all = Object.entries(readings).filter(([k]) => k.endsWith(` ${m.tag}`));
    check("4", `${phase} ${m.tag}: every page 200, every stylesheet 200, reduced motion read back in the page as ${m.rm === "reduce"}`, all.length === 4 && all.every(([, v]) => v.status === 200 && v.css.length > 0 && v.css.every((s) => s === 200) && v.read.reduced === (m.rm === "reduce")), all.map(([k, v]) => `${k.split(" ").slice(2, 3)}: ${v.status} css ${v.css.join(",")} reduced ${v.read.reduced}`).join(" · "));
    const r = (kind: string, race: string) => readings[`${phase} ${kind} ${race} ${m.tag}`]!.read;
    if (phase === "before") {
      check("4", `before ${m.tag}: TX-18 and TX-33 draw no runoff block; S-GA draws its seeded one (Collins won, Dooley lost); the stub copy's TX-18 prints the stub`, !r("main", "TX-18-2026").block && !r("main", "TX-33-2026").block && !!r("main", "S-GA-2026").block?.rows.some((x) => /Mike Collins.*won/i.test(x)) && r("stub", "TX-18-2026").stub && !r("stub", "TX-18-2026").block, `TX-18 ${r("main", "TX-18-2026").block ? "block" : "none"} · TX-33 ${r("main", "TX-33-2026").block ? "block" : "none"} · S-GA ${r("main", "S-GA-2026").block?.rows.join(" | ")} · stub TX-18 stub=${r("stub", "TX-18-2026").stub}`);
    } else {
      const tx18 = r("main", "TX-18-2026").block, tx33 = r("main", "TX-33-2026").block, ga = r("main", "S-GA-2026").block, st = r("stub", "TX-18-2026");
      check("4", `after ${m.tag}: TX-18 draws its D runoff (Menefee won, Green lost)`, !!tx18 && tx18.parties.length === 1 && tx18.rows.some((x) => /Christian Menefee.*69\.3% · won/i.test(x)) && tx18.rows.some((x) => /Al Green.*30\.7% · lost/i.test(x)), tx18 ? `${tx18.head} · ${tx18.rows.join(" | ")}` : "no block");
      check("4", `after ${m.tag}: TX-33 draws two rounds (D and R) in one block`, !!tx33 && tx33.parties.length === 2 && tx33.rows.length === 4, tx33 ? `${tx33.parties.join(" / ")} · ${tx33.rows.join(" | ")}` : "no block");
      const beforeFile = path.join(ART, `captures-before-${LABEL}.json`);
      const gaBefore = existsSync(beforeFile) ? (JSON.parse(readFileSync(beforeFile, "utf8")) as Record<string, Reading>)[`before main S-GA-2026 ${m.tag}`]?.read.block : null;
      check("4", `after ${m.tag}: S-GA draws exactly what HEAD's build drew (the before phase's rows)`, !!ga && !!gaBefore && JSON.stringify(ga.rows) === JSON.stringify(gaBefore.rows) && JSON.stringify(ga.parties) === JSON.stringify(gaBefore.parties), ga ? `${ga.rows.join(" | ")} · before ${gaBefore ? gaBefore.rows.join(" | ") : "(no before reading)"}` : "no block");
      check("4", `after ${m.tag}: the stub copy's TX-18, whose runoff is all it has, draws the runoff and no stub`, !!st.block && !st.stub, `stub=${st.stub}${st.stubText ? ` «${st.stubText}»` : ""} · empty-roster note ${st.emptyRoster} · ${st.block ? st.block.rows.join(" | ") : "no block"}`);
    }
  }
  check("4", `${phase}: no console error or page error`, errors.length === 0, errors.join(" · ") || "none");
  await prodUntouched(`the ${phase} captures`, fp0);
  say(`\n${passes} PASS · ${fails} FAIL`);
}

const mode = process.argv.includes("--seed") ? seed : process.argv.includes("--legs") ? legs : phaseRun;
mode().then(() => process.exit(fails ? 1 : 0)).catch((e) => { console.error(redactSecrets(String(e?.stack ?? e))); process.exit(2); });
