// HO 779 legs 0-2: Corey's two tag rulings, on a `file:` copy of prod with marks planted, each build's
// server run per clock, HEAD's (0d53dae) as the red.
//
//   npx tsx scripts/diagnostic/incumbent-tag-legs-779.ts --seed --label L
//   npx tsx scripts/diagnostic/incumbent-tag-legs-779.ts --run --head <HEAD worktree> --tree <tree worktree> --label L
//
// The copy: prod by SELECT (HO 777's tables), with the marks below planted. Each case's own race is decided
// (one mark), so HEAD's card reads HO 758's "not on the ballot" there; the targets carry the outcome:
//   senate, elected       AL-01 (Moore)    S-AL: Moore marked
//   senate, lost          IA-02 (Hinson)   S-IA: Turek marked                 (rated: /electoral, MAP, modal, hover)
//   senate, in the runoff GA-10 (Collins)  S-GA: Ossoff and Collins marked
//   senate, out of it     NH-01 (Pappas)   S-NH: Sununu and Laplante marked
//   senate, not called    KY-06 (Barr)     S-KY: no mark
//   moved, elected        FL-25 (Wasserman Schultz)  FL-20: her row marked
//   LOST PRIMARY GA-13 · RETIRING S-IA · NOT ON THE BALLOT S-MN · governor S-AL (Tuberville)
// Legs:
//   0  today's clock: every race page's server-rendered <main> byte-identical to HEAD's but the five governor
//      seats' cards; every tag on /electoral, / and /welcome equal to HEAD's but the five's; the five read
//      RUNNING FOR GOVERNOR on the tree; no outcome word, and no data-incumbent-outcome, anywhere
//   1  the clock at Nov 4: each case's card, HEAD red (not on the ballot, no tag) and the tree green (the
//      table's words, and no qualifier beside a tag); for the rated cases /electoral's row tag and holder
//      line, and for IA-02 its MAP card, district modal and hover meta; /'s featured cards; captures
//   2  the census at Nov 4: every tag on every race page against the rule computed from the copy's rows
//      (HO 759's classes by HEAD's unchanged rule, the governor list and the outcome computed here)
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed, fingerprinted before and after. The copy is
// `file:${abs}` from a path ending -779-legs.db under the gitignored scratch directory; servers get that URL
// with TURSO_AUTH_TOKEN="" and a CRON_SECRET minted for the run. Every printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const HEAD_SHA = "0d53dae";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/779-artifacts"); // repo-ignored
const SHOTS = path.join(ART, "captures");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const PORT = 3779;
const BASE = `http://127.0.0.1:${PORT}`;
const NOV4 = "2026-11-04T15:00:00.000Z";
const SENTINEL_ROUTE = "/api/cron/race-challengers";
const WHOLE = [
  "races", "members", "member_ids", "race_ratings", "rating_history", "race_candidates", "kalshi_odds", "polymarket_odds",
  "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads",
  "palestine_scorecard", "member_ideology", "member_participation", "member_career_votes", "votes", "observations",
  "observation_entities", "dashboard_state",
];
// A mark is a printed row matched by name, or a party's first printed row ("R:", "D:") where the name is
// whatever the copy prints.
const PLANTS: { race: string; marks: string[] }[] = [
  { race: "AL-01-2026", marks: ["Jerry Carl"] },
  { race: "S-AL-2026", marks: ["Barry Moore"] },
  { race: "IA-02-2026", marks: ["Joe Mitchell"] },
  { race: "S-IA-2026", marks: ["Josh Turek"] },
  { race: "GA-10-2026", marks: ["R:"] },
  { race: "S-GA-2026", marks: ["Jon Ossoff", "Mike Collins"] },
  { race: "NH-01-2026", marks: ["D:"] },
  { race: "S-NH-2026", marks: ["John Sununu", "Edmond Laplante"] },
  { race: "KY-06-2026", marks: ["R:"] },
  { race: "FL-25-2026", marks: ["Moskowitz"] },
  { race: "FL-20-2026", marks: ["Wasserman Schultz"] },
  { race: "GA-13-2026", marks: ["Jasmine Clark"] },
  { race: "S-MN-2026", marks: ["D:"] },
];
type Want = { key: string; outcome: string | null; text: string };
const CASES: { race: string; label: string; tree: Want; rated: boolean }[] = [
  { race: "AL-01-2026", label: "senate, elected", tree: { key: "senate", outcome: "elected", text: "ELECTED TO THE SENATE" }, rated: false },
  { race: "IA-02-2026", label: "senate, lost", tree: { key: "senate", outcome: "lost", text: "LOST THE SENATE RACE" }, rated: true },
  { race: "GA-10-2026", label: "senate, in the runoff", tree: { key: "senate", outcome: "runoff", text: "IN THE SENATE RUNOFF" }, rated: false },
  { race: "NH-01-2026", label: "senate, out of the runoff", tree: { key: "senate", outcome: "out_of_runoff", text: "OUT OF THE SENATE RUNOFF" }, rated: true },
  { race: "KY-06-2026", label: "senate, not called", tree: { key: "senate", outcome: null, text: "RUNNING FOR SENATE" }, rated: true },
  { race: "FL-25-2026", label: "moved, elected", tree: { key: "moved", outcome: "elected", text: "ELECTED IN FL-20" }, rated: true },
  { race: "GA-13-2026", label: "LOST PRIMARY", tree: { key: "lost_primary", outcome: null, text: "LOST PRIMARY" }, rated: false },
  { race: "S-IA-2026", label: "RETIRING", tree: { key: "retiring", outcome: null, text: "RETIRING" }, rated: true },
  { race: "S-MN-2026", label: "NOT ON THE BALLOT", tree: { key: "absent", outcome: null, text: "NOT ON THE BALLOT" }, rated: true },
  { race: "S-AL-2026", label: "governor", tree: { key: "governor", outcome: "ran", text: "RAN FOR GOVERNOR" }, rated: false },
];
// The open row's holder line on the tree at Nov 4, for the rated cases with a kind.
const HOLDER: Record<string, RegExp> = {
  "IA-02-2026": /lost the Senate race IA SEN/,
  "NH-01-2026": /out of the Senate runoff NH SEN/,
  "KY-06-2026": /running for Senate KY SEN/,
  "FL-25-2026": /elected in FL-20/,
};
const FIVE: Record<string, string> = { "S-AL-2026": "T000278", "AZ-05-2026": "B001302", "WI-07-2026": "T000165", "MI-10-2026": "J000307", "FL-19-2026": "D000032" };

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
const say = (s: string) => console.log(redactSecrets(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const failed: string[] = [];
const check = (leg: string, label: string, ok: boolean, detail: string) => {
  say(`  ${ok ? "PASS" : "FAIL"}  [${leg}] ${label}: ${detail}`);
  if (ok) passes++;
  else { fails++; failed.push(`[${leg}] ${label}`); }
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

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
  const db = prodClient();
  const t0m = new Date(Date.parse(t0) - 60 * 60 * 1000).toISOString();
  const runs = (await reader(db)(`SELECT id, route, started_at FROM cron_runs WHERE started_at >= ? OR (started_at >= ? AND (ended_at IS NULL OR ended_at >= ?)) ORDER BY id`, [t0, t0m, t0])).rows.map((r) => `${r.route}#${r.id}`);
  db.close();
  const cronOwned = new Set(["race_candidates", "general_ballot", "general_ballot_reads", "primary_candidates", "member_fundraising"]);
  const unexplained = changed.filter((k) => !cronOwned.has(k) || runs.length === 0);
  check("seed", `prod untouched (${label}): every difference is a prod cron's own run overlapping the window`, unexplained.length === 0, `changed ${changed.join(", ")} · runs ${runs.join("; ") || "none"}${unexplained.length ? ` · UNEXPLAINED ${unexplained.join(", ")}` : ""}`);
}

// ── the copy ────────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-779-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-779-legs.db")) throw new Error(`refused: a copy must be a *-779-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
const sentinelFile = () => path.join(DIR, `sentinel-marks-${LABEL}-779.txt`);
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
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: { ...process.env, TURSO_DATABASE_URL: copyUrl(tpl), TURSO_AUTH_TOKEN: "" }, encoding: "utf8" });
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
    counts.push(`bills ${await copyRows(read, db, "bills", `WHERE sponsor_bioguide_id IN (${ph})`, ids)}`);
    counts.push(`member_votes ${await copyRows(read, db, "member_votes", `WHERE bioguide_id IN (${ph})`, ids)}`);
    counts.push(`cron_runs ${await copyRows(read, db, "cron_runs", `WHERE id > (SELECT MAX(id) FROM cron_runs) - 400`)} (the newest 400)`);
  });
  prod.close();
  say(`  template: the real scripts/migrate.ts against file:, seeded from prod · ${counts.join(" · ")}`);
  const abs = copyPath("marks");
  copyFileSync(tpl, abs);
  const at = new Date().toISOString();
  writeFileSync(sentinelFile(), at);
  const planted: string[] = [];
  const stale: string[] = [];
  await withDb(copyUrl(abs), async (db) => {
    const closed = await db.execute(`UPDATE cron_runs SET status = 'success', ended_at = started_at WHERE status = 'running'`);
    if (closed.rowsAffected) say(`  copied rows still running, closed on the copy: ${closed.rowsAffected}`);
    await db.execute({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 779, 'success', ?)`, args: [SENTINEL_ROUTE, at, at, JSON.stringify({ sentinel: "HO 779 legs, the marks copy only" })] });
    for (const p of PLANTS) {
      const rows = (await db.execute({ sql: `SELECT person_key, name, party FROM general_ballot WHERE race_id = ? AND on_ballot = 1 AND write_in = 0 ORDER BY name`, args: [p.race] })).rows;
      for (const m of p.marks) {
        const hit = m.endsWith(":") ? rows.filter((r) => String(r.party) === m.slice(0, -1)).slice(0, 1) : rows.filter((r) => String(r.name).includes(m));
        if (hit.length !== 1) { stale.push(`${p.race} "${m}" matches ${hit.length} of ${rows.map((r) => r.name).join(", ")}`); continue; }
        await db.execute({ sql: `UPDATE general_ballot SET marked = 1 WHERE race_id = ? AND person_key = ?`, args: [p.race, String(hit[0]!.person_key)] });
        planted.push(`${p.race} ${hit[0]!.name} (${hit[0]!.party})`);
      }
    }
  });
  say(`  copy ${path.basename(abs)} · sentinel ${at} · planted ${planted.join(" · ")}`);
  for (const s of stale) say(`  STALE ${s}`);
  check("seed", "every plant matched one printed row", stale.length === 0, `${planted.length} marks`);
  writeFileSync(path.join(ART, `planted-${LABEL}.json`), JSON.stringify({ planted, stale }, null, 1));
  await prodUntouched("the seed", fp0, t0);
}

// ── servers ─────────────────────────────────────────────────────────────────
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
async function startServer(dir: string, tag: string, clock: string | null) {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  rmSync(path.join(dir, ".next", "cache", "fetch-cache"), { recursive: true, force: true });
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: copyUrl(copyPath("marks")), CRON_SECRET: randomBytes(18).toString("hex") };
  env.TURSO_AUTH_TOKEN = "";
  if (clock) env.CBT_CLOCK_NOW = clock;
  else delete env.CBT_CLOCK_NOW;
  const log = path.join(DIR, `server779-${tag}-${LABEL}-${Date.now()}.log`);
  const out = createWriteStream(log);
  const server = spawn(process.execPath, [path.join(dir, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
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
  const want = readFileSync(sentinelFile(), "utf8").trim();
  if (h.routes?.find((r) => r.path === SENTINEL_ROUTE)?.lastRunAt !== want) { await kill(); throw new Error(`transport check failed: not the marks copy's sentinel`); }
  const sha = execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  say(`  server :${PORT} (pid ${server.pid}) · ${tag} build at ${sha} (${path.basename(dir)}) · the marks copy (own sentinel) · clock ${clock ?? "real"} · fetch-cache cleared`);
  return { kill };
}

// ── page reads ──────────────────────────────────────────────────────────────
type Browser = Awaited<ReturnType<typeof import("@playwright/test")["chromium"]["launch"]>>;
async function newPage(browser: Browser, w: number, h = 1000, opts: { blob?: boolean; reduced?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: opts.reduced ? "reduce" : "no-preference" });
  await ctx.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
  if (opts.blob) await ctx.addInitScript(`(() => { const orig = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { if (b instanceof Blob) b.text().then((t) => { window.__md = t; }); return orig(b); }; })()`);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, errors };
}
type Page = Awaited<ReturnType<typeof newPage>>["page"];
// A race page's server-rendered <main>, as served.
async function mainOf(raceId: string): Promise<string> {
  const html = await (await fetch(`${BASE}/race/${raceId}`)).text();
  const a = html.indexOf("<main");
  const b = html.indexOf("</main>");
  return a >= 0 && b > a ? html.slice(a, b + 7) : `NO MAIN (${html.length} bytes)`;
}
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]!); } }));
  return out;
}
// The card's tag and qualifier, read from a race page's <main> with the browser's own parser.
type Card = { tag: string | null; key: string | null; outcome: string | null; qualifier: string | null };
const READ_CARD = (html: string) => `(() => {
  const norm = (s) => (s || '').split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ');
  const doc = new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html');
  const t = doc.querySelector('[data-incumbent-tag]');
  const q = doc.querySelector('[data-incumbent-qualifier]');
  return { tag: t ? norm(t.textContent) : null, key: t ? t.getAttribute('data-incumbent-tag') : null, outcome: t ? t.getAttribute('data-incumbent-outcome') : null, qualifier: q ? norm(q.textContent) : null };
})()`;
const TAG_RE = /<span class="so-qual"[^>]*>[\s\S]*?<\/span><\/span>/;
// Every tag on a page: its race (the enclosing row's or card's), its key and its words.
const READ_TAGS = `(() => {
  const norm = (s) => (s || '').split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ');
  return Array.from(document.querySelectorAll('[data-incumbent-tag]')).map((t) => {
    // The race: the list row's data-race (/electoral), the whole-card link (/), or the row's seat cell (/welcome).
    const li = t.closest('[data-race]');
    const a = t.closest('a[href^="/race/"]');
    const row = li || a ? null : t.closest('[class*="row"]');
    const ident = row ? row.querySelector('[class*="rident"]') : null;
    const seat = ident ? norm(ident.textContent) : '';
    const fromSeat = /^(S-)?[A-Z]{2}(-[0-9A-Z]{2})?$/.test(seat) ? seat + '-2026' : null;
    return { race: li ? li.getAttribute('data-race') : a ? a.getAttribute('href').replace('/race/', '') : fromSeat, key: t.getAttribute('data-incumbent-tag'), outcome: t.getAttribute('data-incumbent-outcome'), text: norm(t.textContent) };
  });
})()`;
type TagRead = { race: string | null; key: string; outcome: string | null; text: string };
async function electoralTags(page: Page): Promise<TagRead[]> {
  await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
  const out: TagRead[] = [];
  for (const tab of ["SENATE", "HOUSE"]) {
    await page.locator(".rl-tab", { hasText: tab }).click();
    out.push(...((await page.evaluate(READ_TAGS)) as TagRead[]));
  }
  return out;
}
async function pageTags(page: Page, url: string): Promise<{ tags: TagRead[]; html: string; landed: string }> {
  await page.goto(`${BASE}${url}`, { waitUntil: "networkidle" });
  const tab = page.locator("button.dv2-racesbox-tab", { hasText: "Races" }).first();
  if (url === "/" && (await tab.count())) { await tab.click(); await sleep(500); }
  return { tags: (await page.evaluate(READ_TAGS)) as TagRead[], html: await page.content(), landed: page.url() };
}
const OUTCOME_WORDS = /ELECTED TO THE|LOST THE SENATE|SENATE RUNOFF|OUT OF THE|ELECTED IN [A-Z]|LOST IN [A-Z]|RAN FOR GOVERNOR/;

// ── leg 0: today's clock ────────────────────────────────────────────────────
async function collectToday(dir: string, tag: string, browser: Browser, raceIds: string[]) {
  const srv = await startServer(dir, tag, null);
  try {
    const mains = await pool(raceIds, 4, (id) => mainOf(id));
    const { ctx, page } = await newPage(browser, 1440);
    const electoral = await electoralTags(page);
    const home = await pageTags(page, "/");
    const welcome = await pageTags(page, "/welcome");
    await ctx.close();
    return { mains: Object.fromEntries(raceIds.map((id, i) => [id, mains[i]!])), electoral, home: home.tags, homeHtml: home.html, homeLanded: home.landed, welcome: welcome.tags, welcomeHtml: welcome.html };
  } finally { await srv.kill(); }
}
async function leg0(headDir: string, treeDir: string, browser: Browser, raceIds: string[]) {
  say(`\n── leg 0, today's clock, the marks planted (${raceIds.length} race pages, /electoral, /, /welcome)`);
  const H = await collectToday(headDir, "HEAD", browser, raceIds);
  const T = await collectToday(treeDir, "tree", browser, raceIds);
  const differ = raceIds.filter((id) => H.mains[id] !== T.mains[id]);
  const outsideFive = differ.filter((id) => !(id in FIVE));
  check("0", "every race page's <main> byte-identical to HEAD's, but the five governor seats'", outsideFive.length === 0 && differ.every((id) => id in FIVE), `${raceIds.length - differ.length} of ${raceIds.length} identical · differing: ${differ.join(", ") || "none"}`);
  const cardOnly = Object.keys(FIVE).filter((id) => (H.mains[id] ?? "").replace(TAG_RE, "<TAG/>") === (T.mains[id] ?? "").replace(TAG_RE, "<TAG/>"));
  check("0", "the five's <main> differ only in the card's tag", cardOnly.length === 5, `${cardOnly.length} of 5 equal with the tag set aside`);
  const browserB = await browser.newContext();
  const pg = await browserB.newPage();
  await pg.goto("about:blank");
  for (const id of Object.keys(FIVE)) {
    const h = (await pg.evaluate(READ_CARD(H.mains[id]!))) as Card;
    const t = (await pg.evaluate(READ_CARD(T.mains[id]!))) as Card;
    check("0", `${id}: RUNNING FOR GOVERNOR on the tree, its old tag on HEAD`, t.tag === "RUNNING FOR GOVERNOR" && t.key === "governor" && !t.outcome && h.tag != null && h.key !== "governor", `tree ${t.key} "${t.tag}" · HEAD ${h.key} "${h.tag}"`);
  }
  await browserB.close();
  const key = (x: TagRead) => `${x.race} ${x.key} ${x.outcome ?? ""} ${x.text}`;
  for (const [name, h, t] of [["/electoral", H.electoral, T.electoral], ["/", H.home, T.home], ["/welcome", H.welcome, T.welcome]] as const) {
    const hs = h.map(key).sort(), ts = t.map(key).sort();
    const onlyH = hs.filter((x) => !ts.includes(x)), onlyT = ts.filter((x) => !hs.includes(x));
    const allFive = [...onlyH, ...onlyT].every((x) => Object.keys(FIVE).some((id) => x.startsWith(`${id} `)));
    check("0", `${name}: every tag equal to HEAD's but the five's`, allFive, `${t.length} tags · HEAD only ${JSON.stringify(onlyH)} · tree only ${JSON.stringify(onlyT)}`);
  }
  const tagWords = [...T.electoral, ...T.home, ...T.welcome].filter((x) => OUTCOME_WORDS.test(x.text) || x.outcome);
  const inMains = raceIds.filter((id) => /data-incumbent-outcome/.test(T.mains[id]!) || (T.mains[id]!.match(TAG_RE) ?? []).some((m) => OUTCOME_WORDS.test(m.replace(/<[^>]+>/g, " "))));
  const inHtml = [T.homeHtml, T.welcomeHtml].filter((h) => /data-incumbent-outcome/.test(h)).length;
  check("0", "no outcome word anywhere on the tree today, and no data-incumbent-outcome (the gate holds with the marks planted)", tagWords.length === 0 && inMains.length === 0 && inHtml === 0, `${tagWords.length} of ${T.electoral.length + T.home.length + T.welcome.length} tags · ${inMains.length} of ${raceIds.length} race pages · ${inHtml} of 2 pages`);
  writeFileSync(path.join(ART, `leg0-${LABEL}.json`), JSON.stringify({ differ, electoral: { head: H.electoral, tree: T.electoral }, home: { head: H.home, tree: T.home, landed: [H.homeLanded, T.homeLanded] }, welcome: { head: H.welcome, tree: T.welcome } }, null, 1));
}

// ── leg 1 and leg 2: the clock at Nov 4 ─────────────────────────────────────
type GovRun = { race: string; bioguide: string; office: string };
async function expectedTags(): Promise<Record<string, Want>> {
  // HO 759's classes by HEAD's unchanged rule; the governor list and the outcome computed here.
  const src = execFileSync("git", ["cat-file", "-p", `${HEAD_SHA}:lib/incumbent-qualifier.ts`], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
  const f = path.join(DIR, "head-incumbent-qualifier-779.ts");
  writeFileSync(f, src.replace(/from "\.\/([^"]+)"/g, 'from "@/lib/$1"').replace(/from "\.\.\/([^"]+)"/g, 'from "@/$1"'));
  const HEAD = (await import(pathToFileURL(f).href)) as { readIncumbentQualifierReadings: (db: Client, c: number) => Promise<Map<string, { qualifier: { kind: string; raceId?: string; reason?: string } | null }>> };
  const gov = (JSON.parse(readFileSync("data/governor-runs-2026.json", "utf8")) as { entries: GovRun[] }).entries.filter((e) => e.office === "governor");
  return withDb(copyUrl(copyPath("marks")), async (db) => {
    const readings = await HEAD.readIncumbentQualifierReadings(db, 2026);
    const inc = new Map((await db.execute(`SELECT id, incumbent_bioguide_id FROM races WHERE cycle = 2026`)).rows.map((r) => [String(r.id), r.incumbent_bioguide_id == null ? null : String(r.incumbent_bioguide_id)]));
    const reads = new Map((await db.execute(`SELECT race_id, status FROM general_ballot_reads`)).rows.map((r) => [String(r.race_id), String(r.status)]));
    const REASON: Record<string, string> = { retiring: "RETIRING", withdrew: "WITHDREW", lost_primary: "LOST PRIMARY", absent: "NOT ON THE BALLOT" };
    const out: Record<string, Want> = {};
    for (const [id, r] of readings) {
      const q = r.qualifier;
      if (!q) continue;
      if (q.kind === "moved" || q.kind === "senate") {
        const t = q.raceId!;
        const rows = reads.get(t) === "box" ? (await db.execute({ sql: `SELECT bioguide_id FROM general_ballot WHERE race_id = ? AND on_ballot = 1 AND marked = 1`, args: [t] })).rows : [];
        const theirs = rows.some((x) => x.bioguide_id != null && String(x.bioguide_id) === inc.get(id));
        const outcome = rows.length === 0 ? null : rows.length === 1 ? (theirs ? "elected" : "lost") : theirs ? "runoff" : "out_of_runoff";
        const seat = t.replace(/-\d{4}$/, "");
        const words = q.kind === "senate"
          ? { none: "RUNNING FOR SENATE", elected: "ELECTED TO THE SENATE", lost: "LOST THE SENATE RACE", runoff: "IN THE SENATE RUNOFF", out_of_runoff: "OUT OF THE SENATE RUNOFF" }
          : { none: `RUNNING IN ${seat}`, elected: `ELECTED IN ${seat}`, lost: `LOST IN ${seat}`, runoff: `IN THE ${seat} RUNOFF`, out_of_runoff: `OUT OF THE ${seat} RUNOFF` };
        out[id] = { key: q.kind, outcome, text: words[outcome ?? "none"] };
      } else if (gov.some((e) => e.race === id && e.bioguide === inc.get(id))) {
        out[id] = { key: "governor", outcome: "ran", text: "RAN FOR GOVERNOR" };
      } else {
        out[id] = { key: q.reason!, outcome: null, text: REASON[q.reason!]! };
      }
    }
    return out;
  });
}

async function collectNov4(dir: string, tag: "HEAD" | "tree", browser: Browser, raceIds: string[], census: boolean) {
  const srv = await startServer(dir, tag, NOV4);
  const out: Record<string, unknown> = {};
  try {
    const blank = await browser.newContext();
    const pg = await blank.newPage();
    await pg.goto("about:blank");
    const ids = census ? raceIds : CASES.map((c) => c.race);
    const mains = await pool(ids, 4, (id) => mainOf(id));
    const cards: Record<string, Card> = {};
    for (const [i, id] of ids.entries()) cards[id] = (await pg.evaluate(READ_CARD(mains[i]!))) as Card;
    await blank.close();
    out.cards = cards;
    // /electoral: each rated case's row tag and open row's holder line
    const { ctx, page } = await newPage(browser, 1440, 1000, { blob: true });
    await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
    const rows: Record<string, { tag: string | null; outcome: string | null; holder: string | null }> = {};
    for (const c of CASES.filter((x) => x.rated)) {
      await page.locator(".rl-tab", { hasText: c.race.startsWith("S-") ? "SENATE" : "HOUSE" }).click();
      const li = page.locator(`li[data-race="${c.race}"]`);
      if (!(await li.count())) { rows[c.race] = { tag: null, outcome: null, holder: null }; continue; }
      const t = li.locator(".race-list-row [data-incumbent-tag]").first();
      const tagText = (await t.count()) ? norm(await t.textContent()) : null;
      const outcome = (await t.count()) ? await t.getAttribute("data-incumbent-outcome") : null;
      if (!(await li.locator(".race-list-expand").count())) await li.locator(".race-list-seat").click();
      await li.locator(".race-list-expand").waitFor({ timeout: 8000 });
      const sh = li.locator(".race-list-expand .rl-sh");
      rows[c.race] = { tag: tagText, outcome, holder: (await sh.count()) ? norm(await sh.textContent()) : null };
      await li.screenshot({ path: path.join(SHOTS, `${tag}-row-${c.race}-1440.png`) }).catch(() => {});
    }
    out.rows = rows;
    // IA-02's MAP card, district modal and hover meta
    const toMap = async () => { const b = page.locator(".cart-viewtoggle-btn", { hasText: "MAP" }); if ((await b.getAttribute("aria-selected")) !== "true") { await b.click(); await sleep(400); } };
    await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
    await toMap();
    // The "IA" label sits over the path's middle, so a hover at the path's centre
    // lands on the label and the path's onMouseEnter never fires (r1: no peek on
    // either build). The mouse goes to a point the path itself is under.
    const iowa = page.locator('path.us-map-state[aria-label="Iowa"]');
    await iowa.scrollIntoViewIfNeeded();
    const at = (await page.evaluate(`(() => { const el = document.querySelector('path.us-map-state[aria-label="Iowa"]'); if (!el) return null; const r = el.getBoundingClientRect(); for (let fy = 0.15; fy <= 0.85; fy += 0.05) for (let fx = 0.1; fx <= 0.9; fx += 0.05) { const x = r.left + r.width * fx, y = r.top + r.height * fy; if (document.elementFromPoint(x, y) === el) return { x: Math.round(x), y: Math.round(y) }; } return null; })()`)) as { x: number; y: number } | null;
    out.hoverAt = at;
    await page.mouse.move(2, 2);
    if (at) await page.mouse.move(at.x, at.y, { steps: 4 });
    await sleep(400);
    const peek = (await page.locator(".us-map-peek .cart-peek-row").allTextContents()).map(norm);
    out.hover = peek.filter((x) => x.startsWith("IA-02"));
    await page.locator(".us-map-peek").first().screenshot({ path: path.join(SHOTS, `${tag}-hover-IA-1440.png`) }).catch(() => {});
    await iowa.click({ force: true });
    await page.locator(".rdm-chip").first().waitFor({ timeout: 8000 });
    await page.locator(".rdm-chip", { hasText: "IA-02" }).first().click();
    await sleep(300);
    const dtag = page.locator(".rdm-detail [data-incumbent-tag]").first();
    out.modalTag = (await dtag.count()) ? norm(await dtag.textContent()) : null;
    await page.evaluate(`window.__md = null`);
    await page.locator("button.rdm-action", { hasText: "EXPORT" }).click();
    await sleep(600);
    const md = (await page.evaluate(`window.__md || null`)) as string | null;
    out.modalExport = md ? (md.split("\n").find((l) => l.startsWith("- ") && /\[R\]|\[D\]/.test(l) && /\(/.test(l)) ?? null) : null;
    await page.locator(".rdm-detail").first().screenshot({ path: path.join(SHOTS, `${tag}-district-IA-02-1440.png`) }).catch(() => {});
    await page.keyboard.press("Escape");
    await sleep(200);
    const box = page.locator(".cart-search input");
    await box.fill("IA-02");
    await box.press("Enter");
    await page.locator("ul.racecard-list").waitFor({ timeout: 8000 });
    const card = page.locator("ul.racecard-list > li.racecard-row", { has: page.locator(".racecard-seat", { hasText: "IA-02" }) }).first();
    const ctag = card.locator(".racecard-name [data-incumbent-tag]").first();
    out.mapTag = (await ctag.count()) ? norm(await ctag.textContent()) : null;
    await card.locator(".racecard-head .racecard-chevron").click();
    await sleep(200);
    out.mapMeta = (await card.locator(".racecard-cand-meta").allTextContents()).map(norm).filter((x) => /·/.test(x));
    await card.screenshot({ path: path.join(SHOTS, `${tag}-mapcard-IA-02-1440.png`) }).catch(() => {});
    await ctx.close();
    // /: the featured cards
    const home = await newPage(browser, 1440);
    out.home = (await pageTags(home.page, "/")).tags;
    await home.ctx.close();
  } finally { await srv.kill(); }
  return out;
}

type RowRead = { tag: string | null; outcome: string | null; holder: string | null };
type NovRead = { cards: Record<string, Card>; rows: Record<string, RowRead>; hover: string[]; hoverAt: { x: number; y: number } | null; modalTag: string | null; modalExport: string | null; mapTag: string | null; mapMeta: string[]; home: TagRead[] };
async function leg1and2(headDir: string, treeDir: string, browser: Browser, raceIds: string[]) {
  say(`\n── leg 1, the clock at ${NOV4}: the cases, red on HEAD and green on the tree`);
  const H = (await collectNov4(headDir, "HEAD", browser, raceIds, false)) as unknown as NovRead;
  const T = (await collectNov4(treeDir, "tree", browser, raceIds, true)) as unknown as NovRead;
  const hc = H.cards, tc = T.cards;
  for (const c of CASES) {
    const h = hc[c.race]!, t = tc[c.race]!;
    check("1 red", `${c.race} (${c.label}): HEAD's decided card reads "not on the ballot" and drops the tag`, h.qualifier === "not on the ballot" && h.tag === null, `qualifier "${h.qualifier}" · tag ${h.key ? `${h.key} "${h.tag}"` : "none"}`);
    check("1 green", `${c.race} (${c.label}): the tree's card reads ${c.tree.text}, and no qualifier beside it`, t.tag === c.tree.text && t.key === c.tree.key && (t.outcome ?? null) === c.tree.outcome && t.qualifier === null, `tag ${t.key} "${t.tag}" outcome ${t.outcome} · qualifier ${t.qualifier === null ? "none" : `"${t.qualifier}"`}`);
  }
  const hr = H.rows, tr = T.rows;
  for (const c of CASES.filter((x) => x.rated)) {
    const h = hr[c.race], t = tr[c.race];
    check("1 /electoral", `${c.race}: the row's tag reads ${c.tree.text} on the tree (HEAD "${h?.tag}")`, t?.tag === c.tree.text && (t?.outcome ?? null) === c.tree.outcome, `tree "${t?.tag}" (${t?.outcome}) · HEAD "${h?.tag}"`);
    if (HOLDER[c.race]) check("1 /electoral", `${c.race}: the open row's holder line reads ${HOLDER[c.race]!.source}`, HOLDER[c.race]!.test(t?.holder ?? ""), `tree "${t?.holder}" · HEAD "${h?.holder}"`);
  }
  check("1 MAP", "IA-02's pinned card: the tag and its lower-case contest line read LOST THE SENATE RACE", T.mapTag === "LOST THE SENATE RACE" && T.mapMeta.some((x) => x.includes("lost the senate race")), `tree "${T.mapTag}" ${JSON.stringify(T.mapMeta)} · HEAD "${H.mapTag}" ${JSON.stringify(H.mapMeta)}`);
  check("1 modal", "IA-02's district card and its export read LOST THE SENATE RACE", T.modalTag === "LOST THE SENATE RACE" && /\(LOST THE SENATE RACE\)/.test(String(T.modalExport)), `tree "${T.modalTag}" · export ${JSON.stringify(T.modalExport)} · HEAD "${H.modalTag}" ${JSON.stringify(H.modalExport)}`);
  check("1 hover", "IA-02's hover meta reads LOST THE SENATE RACE (HEAD's, RUNNING FOR SENATE)", T.hover.some((x) => x.includes("LOST THE SENATE RACE")) && H.hover.some((x) => x.includes("RUNNING FOR SENATE")), `tree ${JSON.stringify(T.hover)} at ${JSON.stringify(T.hoverAt)} · HEAD ${JSON.stringify(H.hover)} at ${JSON.stringify(H.hoverAt)}`);
  const caseIds = new Set(CASES.map((c) => c.race));
  const featured = T.home.filter((x) => x.race && caseIds.has(x.race));
  const featuredOk = featured.every((x) => { const c = CASES.find((y) => y.race === x.race)!; return x.text === c.tree.text; });
  check("1 /", `the featured cards among the cases read the table's words (${featured.map((x) => x.race).join(", ") || "none featured"})`, featuredOk, `tree ${JSON.stringify(featured.map((x) => [x.race, x.text]))} · HEAD ${JSON.stringify(H.home.filter((x) => x.race && caseIds.has(x.race)).map((x) => [x.race, x.text]))}`);

  say(`\n── leg 2, the census at ${NOV4}: every tag on every race page against the rule`);
  const want = await expectedTags();
  const mism: string[] = [];
  let tagged = 0;
  for (const id of raceIds) {
    const got = tc[id]!;
    const w = want[id];
    if (got.tag) tagged++;
    if (!w) { if (got.tag) mism.push(`${id}: a tag "${got.tag}" where the rule gives none`); continue; }
    if (got.tag !== w.text || got.key !== w.key || (got.outcome ?? null) !== w.outcome) mism.push(`${id}: "${got.tag}" (${got.key}/${got.outcome}) where the rule gives "${w.text}" (${w.key}/${w.outcome})`);
    if (got.qualifier !== null) mism.push(`${id}: a qualifier "${got.qualifier}" beside the tag`);
  }
  const byKey: Record<string, number> = {};
  for (const w of Object.values(want)) byKey[`${w.key}${w.outcome ? `/${w.outcome}` : ""}`] = (byKey[`${w.key}${w.outcome ? `/${w.outcome}` : ""}`] ?? 0) + 1;
  check("2", `every tag on every race page equals the rule computed from the copy's rows (${raceIds.length} pages, ${Object.keys(want).length} tags)`, mism.length === 0 && tagged === Object.keys(want).length, `${mism.length} mismatches${mism.length ? `: ${mism.slice(0, 8).join(" · ")}` : ""} · pages with a tag ${tagged} · the rule's ${JSON.stringify(byKey)}`);
  writeFileSync(path.join(ART, `leg1-2-${LABEL}.json`), JSON.stringify({ head: H, tree: { ...T, cards: undefined }, census: { want, mismatches: mism } }, null, 1));
}

// ── captures: leg 1's cards and /electoral's rows and MAP card, 1440 and 430, reduced motion at 1440 ────
async function captures(treeDir: string, headDir: string, browser: Browser) {
  say(`\n── captures (the clock at ${NOV4})`);
  for (const [dir, tag] of [[treeDir, "tree"], [headDir, "HEAD"]] as const) {
    const srv = await startServer(dir, `${tag}-captures`, NOV4);
    try {
      for (const v of [{ w: 1440, h: 1100, reduced: false, s: "1440" }, { w: 430, h: 932, reduced: false, s: "430" }, { w: 1440, h: 1100, reduced: true, s: "1440-reduced" }]) {
        if (tag === "HEAD" && v.s !== "1440") continue;
        const { ctx, page } = await newPage(browser, v.w, v.h, { reduced: v.reduced });
        for (const c of CASES) {
          await page.goto(`${BASE}/race/${c.race}`, { waitUntil: "networkidle" });
          const sec = page.locator("section", { has: page.locator("h2", { hasText: "Incumbent" }) }).first();
          if (await sec.count()) await sec.screenshot({ path: path.join(SHOTS, `${tag}-card-${c.race}-${v.s}.png`) }).catch(() => {});
        }
        if (tag === "tree") {
          await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
          for (const c of CASES.filter((x) => x.rated && HOLDER[x.race])) {
            await page.locator(".rl-tab", { hasText: c.race.startsWith("S-") ? "SENATE" : "HOUSE" }).click();
            const li = page.locator(`li[data-race="${c.race}"]`);
            if (!(await li.count())) continue;
            if (!(await li.locator(".race-list-expand").count())) await li.locator(".race-list-seat").click();
            await li.locator(".race-list-expand").waitFor({ timeout: 8000 }).catch(() => {});
            await li.screenshot({ path: path.join(SHOTS, `tree-row-${c.race}-${v.s}.png`) }).catch(() => {});
          }
          await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
          const b = page.locator(".cart-viewtoggle-btn", { hasText: "MAP" });
          if ((await b.getAttribute("aria-selected")) !== "true") { await b.click(); await sleep(400); }
          const box = page.locator(".cart-search input");
          await box.fill("IA-02");
          await box.press("Enter");
          await page.locator("ul.racecard-list").waitFor({ timeout: 8000 }).catch(() => {});
          const card = page.locator("ul.racecard-list > li.racecard-row", { has: page.locator(".racecard-seat", { hasText: "IA-02" }) }).first();
          if (await card.count()) { await card.locator(".racecard-head .racecard-chevron").click(); await sleep(200); await card.screenshot({ path: path.join(SHOTS, `tree-mapcard-IA-02-${v.s}.png`) }).catch(() => {}); }
        }
        await ctx.close();
      }
    } finally { await srv.kill(); }
  }
}

async function main() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  say(`=== HO 779 legs · ${LABEL} · ${new Date().toISOString()} · tree ${tree} ===`);
  if (process.argv.includes("--seed")) await seed();
  if (process.argv.includes("--run")) {
    const headDir = path.resolve(argAt("--head") ?? "");
    const treeDir = path.resolve(argAt("--tree") ?? "");
    for (const d of [headDir, treeDir]) if (!existsSync(path.join(d, ".next", "BUILD_ID"))) throw new Error(`no build in ${d}`);
    mkdirSync(SHOTS, { recursive: true });
    const raceIds = await withDb(copyUrl(copyPath("marks")), async (db) => (await db.execute(`SELECT id FROM races WHERE cycle = 2026 ORDER BY id`)).rows.map((r) => String(r.id)));
    const { chromium } = await import("@playwright/test");
    const browser = await chromium.launch();
    try {
      if (!process.argv.includes("--skip0")) await leg0(headDir, treeDir, browser, raceIds);
      await leg1and2(headDir, treeDir, browser, raceIds);
      if (!process.argv.includes("--nocaptures")) await captures(treeDir, headDir, browser);
    } finally { await browser.close(); }
  }
  say(`\n${LABEL}: ${passes} PASS · ${fails} FAIL${failed.length ? `\n  FAIL ${failed.join("\n  FAIL ")}` : ""}`);
}
main().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
