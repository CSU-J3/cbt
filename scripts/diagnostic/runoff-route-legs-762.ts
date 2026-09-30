// HO 762 legs: a runoff box the page no longer marks special is routed by its date. On `file:` copies
// seeded whole from prod, red first against HEAD's writer (84f5079), with the live S-SC page saved at
// HO 761's FF go (docs/handoffs/761-artifacts/S-SC-2026.live-761.html.gz: its Aug 25 runoff box reads
// "Republican primary runoff", no "Special") and HO 747's saved pages for everything else.
//   npx tsx scripts/diagnostic/runoff-route-legs-762.ts --label L
//
//   1 the live page   red: HEAD's writer sends the unmarked box to the June primary's
//                     senate-SC-2026-R-runoff; the tree's sends it to senate-SC-2026-special-R-runoff
//                     (the first round whose runoff_date is the box's 2026-08-25), and writes it there
//   2 the saved page  the Sept 25 page, which still says Special: both route to the special, as before
//   3 no single match the special's runoff_date moved off the box's date (no match), or the regular's
//                     moved onto it (two matches), or the box's date struck from the page (none printed):
//                     each box skipped, named in `unrouted`, and no runoff row written anywhere
//   4 the cron's path red: HEAD's syncSenateCandidates(["SC"]) through the shim, the live page served,
//                     writes senate-SC-2026-R-runoff; the tree's writes the special's; the first rounds
//                     identical after both (both SC rows are settled)
//   5 nothing else    the tree's repair over all 104 pages with the live S-SC page reads row for row as
//                     over the saved pages (HO 761's after state): 33 rounds, unrouted 0, SC's three
//                     House boxes still on their only first round; HEAD's differs in S-SC alone
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed and a fingerprint before and after.
// Copies are `file:${abs}` from paths ending -762-legs.db; the child gets that URL with
// TURSO_AUTH_TOKEN="" and refuses any other. getDb() never runs in this process. Every printed line
// passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const HEAD_SHA = "84f5079";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const CWD = path.join(DIR, "cwd-762");
const ART = path.resolve("docs/handoffs/762-artifacts");
const PAGES = path.resolve("docs/handoffs/747-artifacts/pages");
const LIVE_SC = path.resolve("docs/handoffs/761-artifacts/S-SC-2026.live-761.html.gz");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const TSCONFIG = path.resolve("tsconfig.json");
const CHILD = path.resolve("scripts/diagnostic/runoff-route-child-762.ts");
const SHIM = path.resolve("scripts/diagnostic/runoff-pages-shim-761.cjs").replace(/\\/g, "/");
const TABLES = ["races", "members", "member_ids", "race_ratings", "race_candidates", "kalshi_odds", "polymarket_odds", "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads"];
const REG = "senate-SC-2026-R", SPEC = "senate-SC-2026-special-R";

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
    schema: await hash(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`),
    runs: (await read(`SELECT MAX(id) AS id FROM cron_runs WHERE route = '/api/cron/primaries'`)).rows.map((r) => String(r.id)),
  };
  db.close();
  return JSON.stringify(fp);
}

// ── copies ──────────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-762-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-762-legs.db")) throw new Error(`refused: a copy must be a *-762-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
function childEnv(url: string, shimLog: string | null, map: string | null): NodeJS.ProcessEnv {
  if (!url.startsWith("file:")) throw new Error("refused: children get file: only");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url, LEGS_762_HEAD_DIR: DIR };
  env.TURSO_AUTH_TOKEN = "";
  if (shimLog && map) { env.NODE_OPTIONS = `--require ${SHIM}`; env.SHIM_761_MAP = map; env.SHIM_761_LOG = shimLog; }
  return env;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
// HEAD's file from git, into scratch, its relative imports pointed at the tree's modules, except the
// ones named in `local` (HEAD's own copies, in scratch beside it).
function headFile(repoPath: string, out: string, local: Record<string, string> = {}): string {
  const src = execFileSync("git", ["cat-file", "-p", `${HEAD_SHA}:${repoPath}`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" }, maxBuffer: 16 * 1024 * 1024 });
  const dst = path.join(DIR, out);
  writeFileSync(dst, src.replace(/from "\.\/([^"]+)"/g, (_, m: string) => (local[m] ? `from "./${local[m]}"` : `from "@/lib/${m}"`)));
  return dst;
}
const blob = (f: string) => execFileSync("git", ["hash-object", f], { encoding: "utf8" }).trim();
const headBlob = (f: string) => execFileSync("git", ["rev-parse", `${HEAD_SHA}:${f}`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();

// ── pages ───────────────────────────────────────────────────────────────────
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
const savedIO = (map: Record<string, string>): IOish => ({
  now: () => Date.now(),
  sleep: async () => {},
  get: async (url) => (map[url] ? { kind: "response", status: 200, body: pageHtml(map[url]!) } : { kind: "response", status: 404, body: "not saved" }),
});

// ── reading a copy ──────────────────────────────────────────────────────────
type RunoffRow = { id: string; date: string | null; type: string | null; cands: string[] };
async function runoffRows(url: string): Promise<Map<string, RunoffRow>> {
  return withDb(url, async (db) => {
    const out = new Map<string, RunoffRow>();
    for (const r of (await db.execute(`SELECT * FROM primaries WHERE election_round = 'runoff' ORDER BY id`)).rows) out.set(String(r.id), { id: String(r.id), date: r.primary_date == null ? null : String(r.primary_date), type: r.primary_type == null ? null : String(r.primary_type), cands: [] });
    for (const c of (await db.execute(`SELECT c.* FROM primary_candidates c JOIN primaries p ON p.id = c.primary_id WHERE p.election_round = 'runoff' ORDER BY c.primary_id, c.name`)).rows) out.get(String(c.primary_id))!.cands.push(`${c.name} ${c.status} ${c.vote_pct} ${c.bioguide_id} ${c.incumbent}`);
    return out;
  });
}
const content = (m: Map<string, RunoffRow>) => [...m.values()].map((r) => JSON.stringify(r)).join("\n");
const show = (r: RunoffRow | undefined) => (r ? `${r.id} [${r.date}] ${r.cands.map((c) => c.split(" ").slice(0, -3).join(" ")).join(", ")}` : "(none)");
async function roundHash(url: string): Promise<string> {
  return withDb(url, async (db) => sha((await db.execute(`SELECT * FROM primaries WHERE election_round = 'primary' ORDER BY id`)).rows.map((r) => JSON.stringify(Object.values(r))).join("\n") + (await db.execute(`SELECT c.* FROM primary_candidates c JOIN primaries p ON p.id = c.primary_id WHERE p.election_round = 'primary' ORDER BY c.id`)).rows.map((r) => JSON.stringify(Object.values(r))).join("\n")));
}

async function main() {
  mkdirSync(DIR, { recursive: true });
  mkdirSync(ART, { recursive: true });
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  say(`=== HO 762 legs · ${LABEL} · ${new Date().toISOString()} · tree ${tree} · sync ${blob("lib/primaries-sync.ts").slice(0, 10)} (HEAD's ${headBlob("lib/primaries-sync.ts").slice(0, 10)}) · scrape ${blob("lib/primary-candidates-scrape.ts").slice(0, 10)} (HEAD's ${headBlob("lib/primary-candidates-scrape.ts").slice(0, 10)}) · driver ${blob("scripts/diagnostic/runoff-route-legs-762.ts").slice(0, 10)} child ${blob(CHILD).slice(0, 10)} ===`);
  const fp0 = await prodFingerprint();

  // the template: the real migrate, then 13 tables read whole from prod
  const tpl = copyPath("template");
  if (existsSync(tpl)) rmSync(tpl);
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: childEnv(copyUrl(tpl), null, null), encoding: "utf8" });
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
  const pr = await runoffRows(copyUrl(tpl));
  say(`template: the real migrate against file:, seeded whole from prod · ${counts.join(" · ")} · runoff rows ${pr.size} (${[...pr.keys()].join(", ")})`);
  for (const k of ["live", "saved", "nomatch", "twomatch", "undated", "shead", "stree", "fullsaved", "fulllive", "fullhead"]) copyFileSync(tpl, copyPath(k));

  const scrape = await import("@/lib/primary-candidates-scrape");
  const treeSync = await import("@/lib/primaries-sync");
  // HEAD's writer with HEAD's own parser beside it (the child's HEAD sync imports the same copies).
  const headScrape = (await import(pathToFileURL(headFile("lib/primary-candidates-scrape.ts", "head-primary-candidates-scrape-762.ts")).href)) as typeof scrape;
  const headSync = await import(pathToFileURL(headFile("lib/primaries-sync.ts", "head-primaries-sync-762.ts", { "primary-candidates-scrape": "head-primary-candidates-scrape-762" })).href);
  const now = new Date().toISOString();
  const at = { now, today: now.slice(0, 10), windowFloor: treeSync.settleWindowFloor(now) };
  const pages = savedPages();
  const liveHtml = pageHtml(LIVE_SC);
  const liveRunoffs = scrape.parseCandidatesPage(liveHtml, "SC", "S-SC-2026").runoffs ?? [];
  const savedRunoffs = scrape.parseCandidatesPage(pageHtml(pages.get("S-SC-2026")!), "SC", "S-SC-2026").runoffs ?? [];
  say(`live S-SC runoffs: ${JSON.stringify(liveRunoffs.map((r) => [r.contest, r.isSpecial, r.date, r.candidates.map((c) => c.name)]))} · saved: ${JSON.stringify(savedRunoffs.map((r) => [r.contest, r.isSpecial, r.date]))}`);
  const liveRunoffsHead = headScrape.parseCandidatesPage(liveHtml, "SC", "S-SC-2026").runoffs ?? [];
  const savedRunoffsHead = headScrape.parseCandidatesPage(pageHtml(pages.get("S-SC-2026")!), "SC", "S-SC-2026").runoffs ?? [];
  check("*", "HEAD's parser and the tree's read the live and the saved S-SC page identically (the tree changed a comment only)", JSON.stringify(liveRunoffsHead) === JSON.stringify(liveRunoffs) && JSON.stringify(savedRunoffsHead) === JSON.stringify(savedRunoffs), "live and saved");
  const SC = { chamber: "senate" as const, state: "SC", district: null };
  const write = async (mod: typeof treeSync, kind: string, runoffs: typeof liveRunoffs, w: boolean) => {
    const rep = treeSync.emptyRunoffReport();
    await withDb(copyUrl(copyPath(kind)), async (db) => (await mod.createRunoffWriter(db))(SC, runoffs, at, { write: w, reopenExpired: true }, rep));
    return rep;
  };

  // ── 1: the live page ────────────────────────────────────────────────────────
  say(`\n── leg 1: the live page (the box unmarked)`);
  {
    const h = await write(headSync as typeof treeSync, "live", liveRunoffsHead, false);
    check("1", "the live page's runoff box is unmarked: R, not special, dated 2026-08-25, Graham and Norman", liveRunoffs.length === 1 && liveRunoffs[0]!.contest === "R" && !liveRunoffs[0]!.isSpecial && liveRunoffs[0]!.date === "2026-08-25", JSON.stringify(liveRunoffs.map((r) => [r.contest, r.isSpecial, r.date])));
    check("1", "red: HEAD's writer (dry) sends it to the June primary's senate-SC-2026-R-runoff, and flags the date", h.inserted.some((t) => t.startsWith(`${REG}-runoff `)) && h.dateDisagrees.some((d) => d.startsWith(`${REG}-runoff:`)), `inserted ${JSON.stringify(h.inserted)} · dateDisagrees ${JSON.stringify(h.dateDisagrees)}`);
    const t = await write(treeSync, "live", liveRunoffs, true);
    const rows = await runoffRows(copyUrl(copyPath("live")));
    check("1", "the tree's writer sends it to senate-SC-2026-special-R-runoff (the first round dated 2026-08-25) and writes it there, and nothing to the June primary", t.inserted.length === 1 && t.inserted[0]!.startsWith(`${SPEC}-runoff `) && t.unrouted.length === 0 && t.dateDisagrees.length === 0 && rows.has(`${SPEC}-runoff`) && !rows.has(`${REG}-runoff`) && rows.get(`${SPEC}-runoff`)!.date === "2026-08-25", `inserted ${JSON.stringify(t.inserted)} · ${show(rows.get(`${SPEC}-runoff`))} · ${REG}-runoff ${rows.has(`${REG}-runoff`) ? "PRESENT" : "absent"}`);
  }

  // ── 2: the saved page ───────────────────────────────────────────────────────
  say(`\n── leg 2: the saved page (the box marked special)`);
  {
    const h = await write(headSync as typeof treeSync, "saved", savedRunoffsHead, false);
    const t = await write(treeSync, "saved", savedRunoffs, false);
    check("2", "HEAD and the tree both send the marked box to senate-SC-2026-special-R-runoff", h.inserted.some((x) => x.startsWith(`${SPEC}-runoff `)) && JSON.stringify(t.inserted) === JSON.stringify(h.inserted), `HEAD ${JSON.stringify(h.inserted)} · tree ${JSON.stringify(t.inserted)}`);
  }

  // ── 3: no single match ──────────────────────────────────────────────────────
  say(`\n── leg 3: the date picks no single first round`);
  {
    await withDb(copyUrl(copyPath("nomatch")), (db) => db.execute({ sql: `UPDATE primaries SET runoff_date = '2026-09-01' WHERE id = ?`, args: [SPEC] }));
    await withDb(copyUrl(copyPath("twomatch")), (db) => db.execute({ sql: `UPDATE primaries SET runoff_date = '2026-08-25' WHERE id = ?`, args: [REG] }));
    // The runoff box's results line is the page's one "on August 25, 2026" (its own spacing: "…primary
    // runoff   for U.S. Senate South Carolina on August 25, 2026."); strip that date, and prove it went.
    const struck = (liveHtml.match(/South Carolina on August 25, 2026\./g) ?? []).length;
    const undatedHtml = liveHtml.replace(/South Carolina on August 25, 2026\./g, "South Carolina.");
    const undated = scrape.parseCandidatesPage(undatedHtml, "SC", "S-SC-2026").runoffs ?? [];
    if (struck !== 1 || undated[0]?.date !== null) throw new Error(`the undated control did not take: ${struck} struck, date ${undated[0]?.date}`);
    for (const [kind, runoffs, want] of [["nomatch", liveRunoffs, "2026-09-01"], ["twomatch", liveRunoffs, "2026-08-25"], ["undated", undated, "(none printed)"]] as const) {
      const t = await write(treeSync, kind, runoffs, true);
      const rows = await runoffRows(copyUrl(copyPath(kind)));
      check("3", `${kind}: skipped, named in unrouted (${want}), no runoff row written for either first round`, t.unrouted.length === 1 && t.inserted.length === 0 && t.unrouted[0]!.includes(REG) && t.unrouted[0]!.includes(SPEC) && t.unrouted[0]!.includes(want) && !rows.has(`${REG}-runoff`) && !rows.has(`${SPEC}-runoff`), `unrouted ${JSON.stringify(t.unrouted)} · box date ${runoffs[0]?.date ?? "null"}`);
    }
  }

  // ── 4: the cron's path ──────────────────────────────────────────────────────
  say(`\n── leg 4: the cron's path (syncSenateCandidates(["SC"]), the live page through the shim)`);
  {
    const map = await urlMap(pages);
    const scUrl = Object.keys(map).find((u) => u.endsWith("United_States_Senate_election_in_South_Carolina,_2026"))!;
    map[scUrl] = LIVE_SC;
    const mapFile = path.join(DIR, `shim762-map-${LABEL}.json`);
    writeFileSync(mapFile, JSON.stringify(map));
    mkdirSync(CWD, { recursive: true });
    const run = (code: string, kind: string) => {
      const log = path.join(DIR, `shim762-${kind}-${LABEL}.log`);
      if (existsSync(log)) rmSync(log);
      const r = spawnSync(process.execPath, [TSX, "--tsconfig", TSCONFIG, CHILD, "sync", "--code", code, "--senate", "SC"], { cwd: CWD, env: childEnv(copyUrl(copyPath(kind)), log, mapFile), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      const out = redactSecrets(`${r.stdout}\n${r.stderr}`);
      writeFileSync(path.join(ART, `leg4-${kind}-${LABEL}.txt`), out);
      const line = (r.stdout ?? "").split(/\r?\n/).reverse().find((l) => l.startsWith("RESULT "));
      if (r.status !== 0 || !line) throw new Error(`the ${code} sync child failed: ${out.slice(-1500)}`);
      return { res: JSON.parse(line.slice(7)) as { runoffs?: { inserted: string[] } }, shim: readFileSync(log, "utf8").trim().split("\n") };
    };
    const h = run("head", "shead"), t = run("tree", "stree");
    const hr = await runoffRows(copyUrl(copyPath("shead"))), tr = await runoffRows(copyUrl(copyPath("stree")));
    check("4", "the shim served the live S-SC page to both runs", [h, t].every((x) => x.shim.some((l) => l.includes("S-SC-2026.live-761"))), `${h.shim.length} and ${t.shim.length} answers`);
    check("4", "red: HEAD's sync writes the Aug 25 runoff to the June primary's senate-SC-2026-R-runoff", hr.has(`${REG}-runoff`) && !hr.has(`${SPEC}-runoff`), `${JSON.stringify(h.res.runoffs?.inserted)} · ${show(hr.get(`${REG}-runoff`))}`);
    check("4", "the tree's sync writes it to senate-SC-2026-special-R-runoff, and nothing to the June primary", tr.has(`${SPEC}-runoff`) && !tr.has(`${REG}-runoff`) && tr.get(`${SPEC}-runoff`)!.date === "2026-08-25", `${JSON.stringify(t.res.runoffs?.inserted)} · ${show(tr.get(`${SPEC}-runoff`))}`);
    check("4", "the first rounds read the same after both (SC's rows are settled; nothing but the runoff is written)", (await roundHash(copyUrl(copyPath("shead")))) === (await roundHash(copyUrl(copyPath("stree")))) && (await roundHash(copyUrl(copyPath("stree")))) === (await roundHash(copyUrl(tpl))), "head · tree · template");
  }

  // ── 5: nothing else moves ───────────────────────────────────────────────────
  say(`\n── leg 5: the whole repair, saved pages against the live S-SC`);
  {
    const map = await urlMap(pages);
    const live = { ...map };
    const scUrl = Object.keys(map).find((u) => u.endsWith("United_States_Senate_election_in_South_Carolina,_2026"))!;
    live[scUrl] = LIVE_SC;
    const { repairRunoffs, runoffRepairUnits } = await import("@/lib/runoff-repair");
    const { readRacePage } = await import("@/lib/general-ballot");
    const rs = await withDb(copyUrl(copyPath("fullsaved")), (db) => repairRunoffs(db, savedIO(map), { write: true }));
    const rl = await withDb(copyUrl(copyPath("fulllive")), (db) => repairRunoffs(db, savedIO(live), { write: true }));
    const S = await runoffRows(copyUrl(copyPath("fullsaved"))), L = await runoffRows(copyUrl(copyPath("fulllive")));
    writeFileSync(path.join(ART, `leg5-reports-${LABEL}.json`), JSON.stringify({ saved: rs.report, live: rl.report }, null, 1));
    check("5", "over the saved pages and over the live S-SC alike: 33 rounds, 30 inserted and 3 reopened, unrouted 0", S.size === 33 && L.size === 33 && rs.report.inserted.length === 30 && rl.report.inserted.length === 30 && rs.report.reopened.length === 3 && rl.report.reopened.length === 3 && rs.report.unrouted.length === 0 && rl.report.unrouted.length === 0, `saved ${S.size} (${rs.report.inserted.length}+${rs.report.reopened.length}) · live ${L.size} (${rl.report.inserted.length}+${rl.report.reopened.length}) · unrouted ${rs.report.unrouted.length}/${rl.report.unrouted.length}`);
    check("5", "row for row the same rounds (the live page's box lands where the saved page's did)", content(S) === content(L), `${sha(content(S))} · ${sha(content(L))}`);
    const scHouse = rl.report.dateDisagrees.filter((d) => d.startsWith("house-SC-"));
    check("5", "SC's three House boxes still land on their only first round (the stored date's disagreement reported, not routed on)", ["house-SC-01-2026-D-runoff", "house-SC-01-2026-R-runoff", "house-SC-02-2026-D-runoff"].every((id) => L.has(id)) && scHouse.length === 3 && rl.report.dateDisagrees.length === 3, JSON.stringify(rl.report.dateDisagrees));
    // HEAD's repair module imports the tree's primaries-sync, so HEAD's full run is HEAD's writer over the
    // same units and the same pages, read through the reader's readRacePage as the repair reads them.
    const headRep = headSync.emptyRunoffReport();
    const hw = await withDb(copyUrl(copyPath("fullhead")), async (db) => {
      const w = await headSync.createRunoffWriter(db);
      const io = savedIO(live);
      const { units } = await runoffRepairUnits(db, at.today);
      for (const u of units) {
        const p = await readRacePage({ id: u.raceId, chamber: u.chamber, state: u.state, district: u.district }, io);
        if (p.verdict !== "READ" || !p.html) throw new Error(`no page for ${u.raceId}: ${p.verdict}`);
        await w(u, headScrape.parseCandidatesPage(p.html, u.state, p.url).runoffs ?? [], at, { write: true, reopenExpired: true }, headRep);
      }
      return units.length;
    });
    const H = await runoffRows(copyUrl(copyPath("fullhead")));
    const differ = [...new Set([...H.keys(), ...L.keys()])].filter((id) => JSON.stringify(H.get(id)) !== JSON.stringify(L.get(id))).sort();
    check("5", "red: HEAD's writer over the same pages differs from the tree's in S-SC's runoff alone", JSON.stringify(differ) === JSON.stringify([`${REG}-runoff`, `${SPEC}-runoff`].sort()), `${hw} pages · differ: ${differ.join(", ")}`);
  }

  const fp1 = await prodFingerprint();
  check("*", "prod untouched", fp0 === fp1, fp0 === fp1 ? "fingerprints equal" : `${fp0} → ${fp1}`);
  say(`\n${passes} PASS · ${fails} FAIL`);
}
main().then(() => process.exit(fails ? 1 : 0)).catch((e) => { console.error(redactSecrets(String(e?.stack ?? e))); process.exit(2); });
