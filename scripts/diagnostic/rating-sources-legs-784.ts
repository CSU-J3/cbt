// HO 784 legs: the ratings sources line, and the seed's guard. On `file:` copies of prod seeded by SELECT
// (built by the real scripts/migrate.ts), HEAD's build (372c433) as the red and the tree's as the green, each
// build's server on its own copy.
//
//   npx tsx scripts/diagnostic/rating-sources-legs-784.ts --seed --label L
//   npx tsx scripts/diagnostic/rating-sources-legs-784.ts --run --head <HEAD worktree> --tree <tree worktree> --label L
//   npx tsx scripts/diagnostic/rating-sources-legs-784.ts --seed-leg --head <HEAD worktree> --tree <tree worktree> --label L
//
// Legs:
//   A  the prod read: per rater, its 2026 rows, MAX(rating_date) and its most recently updated row's source_url,
//      read again here by SELECT, and the line's expected text from them; the copies' race_ratings equal prod's
//   B  the smoke test, the tree's e2e/smoke.spec.ts ("the ratings sources line names, links and dates the
//      raters") run by Playwright against each build's server: red on HEAD, green on the tree; then the tree's
//      lines read against A
//   C  the box fit, /electoral's HOUSE tab at 1440x900 and 2560x1440: the document doesn't scroll, the line lies
//      wholly in the window, and at 2560 its bottom is RACE NEWS's (1px); the box given back the line's height,
//      as measure() sized it before HO 784, scrolls the document by that height; HEAD, with no line, doesn't
//      scroll (the control)
//   D  the colours on the tree: every [data-rater-freshness] rgb(210, 80, 14), every rater name
//      rgb(148, 163, 184) as the chip's own, each against its computed background at 4.5:1 or better, on
//      /electoral, /race/S-AK-2026 and /welcome
//   E  the seed on scratch copies, never prod: HEAD's script writes (updated_at moves on seeded ids); the tree's
//      exits 1 with the message and the table hashes the same; the tree's with --force writes
//   F  captures: /electoral (Senate, House), /race/S-AK-2026 and /welcome at 1440 and 2560, again with reduced
//      motion, and HEAD's at 1440 beside them
//
// SAFETY. Prod is only READ (a SELECT-only reader), fingerprinted before and after. A copy is `file:${abs}` from
// a path ending -784-legs.db under the gitignored scratch directory; a server gets its copy's URL with
// TURSO_AUTH_TOKEN="" and a CRON_SECRET minted for the run; leg E's seed runs in a build worktree, which has no
// .env, under an environment carrying its copy's URL and none of ours. Every printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { RACE_RATING_PAGES_2026 } from "@/lib/enums";
import { DIRECT_SOURCE_URLS } from "@/lib/race-ratings-scrape";
import { redactSecrets } from "@/lib/redact";

const OURS = Object.keys(config({ path: ".env", quiet: true }).parsed ?? {});

const HEAD_SHA = "372c433";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/784-artifacts"); // repo-ignored
const SHOTS = path.join(ART, "captures");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const PW = path.resolve("node_modules/@playwright/test/cli.js");
const PORT = 3784;
const BASE = `http://127.0.0.1:${PORT}`;
const SENTINEL_ROUTE = "/api/cron/nominations"; // no leg runs it
const AK = "S-AK-2026";
const RATERS = ["cook", "inside_elections", "sabato"] as const;
type Rater = (typeof RATERS)[number];
const LABELS: Record<Rater, string> = { cook: "Cook", inside_elections: "Inside Elections", sabato: "Sabato" };
const EMBER = "rgb(210, 80, 14)";
const MUTED = "rgb(148, 163, 184)";
const MESSAGE = (n: number) =>
  `race_ratings has ${n} rows; seed:ratings is a first fill for an empty table and would write its snapshots over the synced ratings. Re-run with --force to do it anyway.`;
const WHOLE = [
  "races", "members", "member_ids", "race_ratings", "rating_history", "race_candidates", "kalshi_odds", "polymarket_odds",
  "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads",
  "general_runoff", "palestine_scorecard", "member_ideology", "member_participation", "member_career_votes", "votes",
  "observations", "observation_entities", "dashboard_state",
];
const COPIES = ["head", "tree", "e-head", "e-tree"] as const;
type CopyKind = (typeof COPIES)[number];

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
// A child's environment without any of .env's names: the caller adds what the child needs.
function cleanEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of OURS) delete env[k];
  return env;
}

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
const RATINGS_DUMP = `SELECT id, race_id, source, rating, rating_score, rating_date, source_url, cycle, updated_at FROM race_ratings ORDER BY id`;
async function prodFingerprint(): Promise<Record<string, string>> {
  const db = prodClient();
  const read = reader(db);
  const fp: Record<string, string> = {};
  fp.race_ratings = sha(JSON.stringify((await read(RATINGS_DUMP)).rows.map((r) => Object.values(r))));
  fp.schema = sha(JSON.stringify((await read(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`)).rows.map((r) => Object.values(r))));
  db.close();
  return fp;
}
async function prodUntouched(label: string, fp0: Record<string, string>, t0: string) {
  const fp1 = await prodFingerprint();
  const changed = Object.keys(fp0).filter((k) => fp0[k] !== fp1[k]);
  say(`  prod fingerprint before ${JSON.stringify(fp0)}`);
  say(`  prod fingerprint after  ${JSON.stringify(fp1)}`);
  if (changed.length === 0) { check("safety", `prod untouched (${label})`, true, "fingerprints equal"); return; }
  const db = prodClient();
  const runs = (await reader(db)(`SELECT id, status FROM cron_runs WHERE route = '/api/sync-race-ratings' AND started_at >= ?`, [t0])).rows.map((r) => `#${r.id} ${r.status}`);
  db.close();
  const unexplained = changed.filter((k) => k !== "race_ratings" || runs.length === 0);
  check("safety", `prod untouched (${label}): any difference is the ratings sync's own run in the window`, unexplained.length === 0, `changed ${changed.join(", ")} · sync runs ${runs.join("; ") || "none"}`);
}
type Expected = Record<Rater, { rows: number; asOf: string | null; newestUrl: string | null; via: "ballotpedia" | "direct" | null }>;
function viaOf(u: string | null): "ballotpedia" | "direct" | null {
  if (!u) return null;
  try { if (new URL(u).hostname === "ballotpedia.org") return "ballotpedia"; } catch { return null; }
  return DIRECT_SOURCE_URLS.has(u) ? "direct" : null;
}
const FRESH_SQL = `SELECT r.source,
       COUNT(*) AS n,
       MAX(r.rating_date) AS as_of,
       (SELECT n.source_url FROM race_ratings n
         WHERE n.source = r.source AND n.cycle = 2026
         ORDER BY n.updated_at DESC LIMIT 1) AS newest_url
  FROM race_ratings r
 WHERE r.cycle = 2026
 GROUP BY r.source`;
function expectedFrom(rows: Record<string, unknown>[]): Expected {
  const out = {} as Expected;
  for (const s of RATERS) {
    const r = rows.find((x) => x.source === s);
    const u = r?.newest_url == null ? null : String(r.newest_url);
    out[s] = { rows: Number(r?.n ?? 0), asOf: r?.as_of == null ? null : String(r.as_of), newestUrl: u, via: viaOf(u) };
  }
  return out;
}
const freshText = (e: Expected[Rater]) =>
  (e.asOf ? ` · as of ${e.asOf}` : "") + (e.via === "ballotpedia" ? " · via Ballotpedia" : e.via === "direct" ? " · direct" : "");
const lineText = (e: Expected, raters: readonly Rater[] = RATERS) =>
  `RATINGS${raters.map((s) => ` · ${LABELS[s]}${freshText(e[s])}`).join("")}`.toUpperCase();
function welcomeAsOf(e: Expected): string | null {
  const d = RATERS.map((s) => e[s].asOf).filter((x): x is string => !!x).sort();
  return d.length === 0 ? null : d[0] === d[d.length - 1] ? d[0]! : `${d[0]} to ${d[d.length - 1]}`;
}

// ── the copies ──────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-784-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-784-legs.db")) throw new Error(`refused: a copy must be a *-784-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
const sentinelFile = (kind: CopyKind) => path.join(DIR, `sentinel-${kind}-${LABEL}-784.txt`);
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
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: { ...cleanEnv(), TURSO_DATABASE_URL: copyUrl(tpl), TURSO_AUTH_TOKEN: "" }, encoding: "utf8" });
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
  const out: Record<string, unknown> = { counts };
  for (const kind of COPIES) {
    const abs = copyPath(kind);
    copyFileSync(tpl, abs);
    const at = new Date().toISOString();
    writeFileSync(sentinelFile(kind), at);
    await withDb(copyUrl(abs), async (db) => {
      const closed = await db.execute(`UPDATE cron_runs SET status = 'success', ended_at = started_at WHERE status = 'running'`);
      if (closed.rowsAffected) say(`  ${kind}: copied rows still running, closed on the copy: ${closed.rowsAffected}`);
      await db.execute({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 784, 'success', ?)`, args: [SENTINEL_ROUTE, at, at, JSON.stringify({ sentinel: `HO 784 legs, the ${kind} copy only` })] });
    });
    say(`  copy ${path.basename(abs)} · sentinel ${at}`);
    out[kind] = { at };
    await sleep(400);
  }
  writeFileSync(path.join(ART, `seeded-${LABEL}.json`), JSON.stringify(out, null, 1));
  await prodUntouched("the seed", fp0, t0);
}

// ── servers ─────────────────────────────────────────────────────────────────
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
async function startServer(dir: string, tag: string, copy: "head" | "tree") {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  rmSync(path.join(dir, ".next", "cache", "fetch-cache"), { recursive: true, force: true });
  const env: NodeJS.ProcessEnv = { ...cleanEnv(), TURSO_DATABASE_URL: copyUrl(copyPath(copy)), TURSO_AUTH_TOKEN: "", CRON_SECRET: randomBytes(18).toString("hex") };
  const log = path.join(DIR, `server784-${tag}-${LABEL}-${Date.now()}.log`);
  const out = createWriteStream(log);
  const server = spawn(process.execPath, [path.join(dir, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (b: Buffer) => out.write(b));
  server.stderr.on("data", (b: Buffer) => out.write(b));
  const kill = async () => {
    try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
    out.end();
    for (let i = 0; i < 20 && listeningPids().length; i++) await sleep(250);
    if (listeningPids().length) throw new Error(`port ${PORT} still bound after the kill`);
    await sleep(400);
  };
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`${BASE}/api/health`)).status > 0; } catch { /* not yet */ } }
  if (!up) { await kill(); throw new Error("the server never answered /api/health"); }
  const h = (await (await fetch(`${BASE}/api/health`)).json()) as { routes?: { path?: string; lastRunAt?: string }[] };
  const want = readFileSync(sentinelFile(copy), "utf8").trim();
  if (h.routes?.find((r) => r.path === SENTINEL_ROUTE)?.lastRunAt !== want) { await kill(); throw new Error(`transport check failed: not the ${copy} copy's sentinel`); }
  const pids = listeningPids();
  const at = execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  say(`  server :${PORT} (pid ${server.pid}; listener ${pids.join(",")}) · ${tag} build at ${at} (${path.basename(dir)}) · the ${copy} copy (its own sentinel) · fetch-cache cleared · log ${path.basename(log)}`);
  return { kill };
}

// ── page reads ──────────────────────────────────────────────────────────────
type Browser = Awaited<ReturnType<typeof import("@playwright/test")["chromium"]["launch"]>>;
async function newPage(browser: Browser, w: number, h: number, reduced: boolean) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? "reduce" : "no-preference" });
  await ctx.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
  const page = await ctx.newPage();
  return { ctx, page };
}
type Page = Awaited<ReturnType<typeof newPage>>["page"];
async function status(page: Page, route: string): Promise<number | null> {
  const res = await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  return res ? res.status() : null;
}
type LineRead = { text: string | null; raters: { key: string | null; href: string | null; fresh: string | null }[] } | null;
const READ_LINE = (sel: string) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  return {
    text: el.innerText.split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' '),
    raters: Array.from(el.querySelectorAll('[data-rater]')).map((r) => {
      const a = r.querySelector('a');
      const f = r.querySelector('[data-rater-freshness]');
      return { key: r.getAttribute('data-rater'), href: a ? a.getAttribute('href') : null, fresh: f ? f.textContent : null };
    }),
  };
})()`;
// The welcome foot: the span that ends "synced 4× daily".
const READ_FOOT = `(() => {
  const foot = Array.from(document.querySelectorAll('span')).find((s) => Array.from(s.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').includes('synced 4')));
  if (!foot) return null;
  return {
    text: foot.innerText.split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' '),
    links: Array.from(foot.querySelectorAll('a')).map((a) => ({ text: a.textContent, href: a.getAttribute('href') })),
  };
})()`;
type Foot = { text: string; links: { text: string | null; href: string | null }[] } | null;

// ── leg B: the smoke test ───────────────────────────────────────────────────
function smoke(tag: string) {
  const r = spawnSync(process.execPath, [PW, "test", "e2e/smoke.spec.ts", "--grep", "ratings sources line", "--retries=0", "--workers=1", "--reporter=list"], { env: { ...cleanEnv(), BASE_URL: BASE }, encoding: "utf8", timeout: 300_000 });
  const log = redactSecrets(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  writeFileSync(path.join(ART, `legB-${tag}-${LABEL}.log`), log);
  const passed = Number(log.match(/(\d+) passed/)?.[1] ?? 0);
  const failedN = Number(log.match(/(\d+) failed/)?.[1] ?? 0);
  const error = (log.match(/Error: [^\n]*/)?.[0] ?? "").slice(0, 220);
  const at = (log.match(/smoke\.spec\.ts:(\d+):\d+/g) ?? []).slice(-1)[0] ?? "";
  return { exit: r.status, passed, failed: failedN, error, at };
}

// ── leg C: the box fit ──────────────────────────────────────────────────────
type Fit = {
  inner: number; scroll: number; house: boolean;
  box: { top: number; bottom: number } | null; boxMax: string; foot: { top: number; bottom: number; height: number } | null;
  news: { bottom: number } | null; before: { maxHeight: number; scroll: number } | null;
};
const READ_FIT = `(() => {
  const se = document.scrollingElement;
  const box = document.querySelector('.rl-main > .rl-box');
  const foot = document.querySelector('.rl-main > .rl-sources');
  const news = document.querySelector('.rl-news');
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, height: b.height }; };
  const active = document.querySelector('.rl-tab.is-active');
  const out = { inner: innerHeight, scroll: se.scrollHeight - innerHeight, house: !!active && active.textContent.includes('HOUSE'), box: r(box), boxMax: box ? box.style.maxHeight : '', foot: r(foot), news: r(news), before: null };
  if (box && foot) {
    // The box as measure() sized it before HO 784: its top to the window's bottom less the page's bottom
    // padding, between the floor and the ceiling (BOX_MIN 320, BOX_MAX 1100), not less the line.
    const main = box.closest('main');
    const pad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 16;
    const top = box.getBoundingClientRect().top + window.scrollY;
    const h = Math.min(1100, Math.max(320, Math.round(innerHeight - top - pad)));
    const keep = box.style.maxHeight;
    box.style.maxHeight = h + 'px';
    out.before = { maxHeight: h, scroll: se.scrollHeight - innerHeight };
    box.style.maxHeight = keep;
  }
  return out;
})()`;
async function boxFit(browser: Browser, w: number, h: number): Promise<Fit> {
  const { ctx, page } = await newPage(browser, w, h, true);
  await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
  await page.locator(".rl-tab", { hasText: "HOUSE" }).click();
  await sleep(900);
  const fit = (await page.evaluate(READ_FIT)) as Fit;
  await ctx.close();
  return fit;
}

// ── leg D: the colours ──────────────────────────────────────────────────────
type Ink = { where: string; kind: string; text: string; color: string; background: string };
const READ_INK = `(() => {
  const parse = (s) => { const m = (s || '').match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const bg = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; } }
    let base = layers.length && layers[layers.length - 1].a >= 1 ? layers.pop() : { r: 255, g: 255, b: 255, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) { const l = layers[i]; base = { r: l.r * l.a + base.r * (1 - l.a), g: l.g * l.a + base.g * (1 - l.a), b: l.b * l.a + base.b * (1 - l.a), a: 1 }; }
    return 'rgb(' + Math.round(base.r) + ', ' + Math.round(base.g) + ', ' + Math.round(base.b) + ')';
  };
  const ink = (el, where, kind) => ({ where, kind, text: (el.textContent || '').trim().slice(0, 50), color: getComputedStyle(el).color, background: bg(el) });
  const out = [];
  for (const line of document.querySelectorAll('[data-rating-sources]')) {
    const where = line.closest('.rl-sources') ? '/electoral line' : line.closest('.race-header') ? '/race line' : 'a line';
    for (const f of line.querySelectorAll('[data-rater-freshness]')) out.push(ink(f, where, 'freshness'));
    for (const r of line.querySelectorAll('[data-rater]')) { const n = r.firstElementChild; if (n) out.push(ink(n, where, 'name')); }
  }
  const strip = document.querySelector('.race-header [data-rating-sources]');
  if (strip && strip.previousElementSibling) for (const a of strip.previousElementSibling.querySelectorAll('a.rater-link')) out.push(ink(a, '/race chip', 'chip name'));
  const foot = Array.from(document.querySelectorAll('span')).find((s) => Array.from(s.childNodes).some((n) => n.nodeType === 3 && (n.textContent || '').includes('synced 4')));
  if (foot) {
    for (const a of foot.querySelectorAll('a')) out.push(ink(a, '/welcome foot', 'name'));
    for (const s of foot.querySelectorAll('span')) if ((s.textContent || '').startsWith('ratings as of')) out.push(ink(s, '/welcome foot', 'freshness'));
  }
  return out;
})()`;
function lum(rgb: string): number {
  const p = (rgb.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number).map((v) => v / 255).map((v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
  return 0.2126 * p[0]! + 0.7152 * p[1]! + 0.0722 * p[2]!;
}
const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x! + 0.05) / (y! + 0.05); };

// ── leg F: captures ─────────────────────────────────────────────────────────
const VIEWS = [
  { w: 1440, h: 900, reduced: false, s: "1440" },
  { w: 2560, h: 1440, reduced: false, s: "2560" },
  { w: 1440, h: 900, reduced: true, s: "1440-reduced" },
  { w: 2560, h: 1440, reduced: true, s: "2560-reduced" },
];
async function captures(browser: Browser, tag: "HEAD" | "tree"): Promise<string[]> {
  const files: string[] = [];
  const shot = (name: string, s: string) => { const f = path.join(SHOTS, `${tag}-${name}-${s}.png`); files.push(path.basename(f)); return f; };
  for (const v of VIEWS) {
    if (tag === "HEAD" && v.s !== "1440") continue;
    const { ctx, page } = await newPage(browser, v.w, v.h, v.reduced);
    // /electoral: the window as it opens, where the box fit is the point.
    await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
    await sleep(600);
    await page.screenshot({ path: shot("electoral-senate", v.s) });
    await page.locator(".rl-tab", { hasText: "HOUSE" }).click();
    await sleep(900);
    await page.screenshot({ path: shot("electoral-house", v.s) });
    await page.goto(`${BASE}/race/${AK}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: shot("race-S-AK-2026", v.s), fullPage: true });
    await page.goto(`${BASE}/welcome`, { waitUntil: "networkidle" });
    await sleep(600);
    await page.screenshot({ path: shot("welcome", v.s), fullPage: true });
    await ctx.close();
  }
  return files;
}

// ── the legs on the servers ─────────────────────────────────────────────────
type Session = {
  statuses: Record<string, number | null>; electoral: { senate: LineRead; house: LineRead }; race: LineRead; foot: Foot;
  smoke: ReturnType<typeof smoke>; fits: Record<string, Fit>; inks: Ink[]; shots: string[];
};
async function session(dir: string, tag: "HEAD" | "tree", copy: "head" | "tree", browser: Browser): Promise<Session> {
  const srv = await startServer(dir, tag, copy);
  try {
    const { ctx, page } = await newPage(browser, 1440, 900, true);
    const statuses: Record<string, number | null> = {};
    statuses["/electoral"] = await status(page, "/electoral");
    const senate = (await page.evaluate(READ_LINE(".rl-main > .rl-sources > [data-rating-sources]"))) as LineRead;
    await page.locator(".rl-tab", { hasText: "HOUSE" }).click();
    await sleep(700);
    const house = (await page.evaluate(READ_LINE(".rl-main > .rl-sources > [data-rating-sources]"))) as LineRead;
    statuses[`/race/${AK}`] = await status(page, `/race/${AK}`);
    const race = (await page.evaluate(READ_LINE(".race-header [data-rating-sources]"))) as LineRead;
    statuses["/welcome"] = await status(page, "/welcome");
    const foot = (await page.evaluate(READ_FOOT)) as Foot;
    const inks: Ink[] = [];
    if (tag === "tree") {
      for (const route of ["/electoral", `/race/${AK}`, "/welcome"]) { await status(page, route); inks.push(...((await page.evaluate(READ_INK)) as Ink[])); }
    }
    await ctx.close();
    say(`    ${tag}: HTTP ${JSON.stringify(statuses)}`);
    say(`    ${tag}: /electoral SENATE line ${senate ? `"${senate.text}"` : "none"}`);
    say(`    ${tag}: /electoral HOUSE line ${house ? `"${house.text}"` : "none"}`);
    say(`    ${tag}: /race/${AK} line ${race ? `"${race.text}"` : "none"}`);
    say(`    ${tag}: /welcome foot "${foot?.text ?? "none"}"`);
    const sm = smoke(tag);
    say(`    ${tag}: leg B's test: exit ${sm.exit} · ${sm.passed} passed · ${sm.failed} failed${sm.error ? ` · first error "${sm.error}"${sm.at ? ` at ${sm.at}` : ""}` : ""}`);
    const fits: Record<string, Fit> = {};
    for (const [w, h] of [[1440, 900], [2560, 1440]] as const) {
      const f = await boxFit(browser, w, h);
      fits[`${w}x${h}`] = f;
      say(`    ${tag}: /electoral HOUSE at ${w}x${h}: tab ${f.house ? "HOUSE" : "NOT HOUSE"} · document scroll ${f.scroll} · box ${f.box ? `${Math.round(f.box.top)}..${Math.round(f.box.bottom)} (max-height ${f.boxMax})` : "none"} · line ${f.foot ? `${Math.round(f.foot.top)}..${Math.round(f.foot.bottom)} (${f.foot.height}px)` : "none"} · RACE NEWS bottom ${f.news ? Math.round(f.news.bottom) : "none"}${f.before ? ` · sized as before HO 784 (max-height ${f.before.maxHeight}px): document scroll ${f.before.scroll}` : ""}`);
    }
    const shots = await captures(browser, tag);
    say(`    ${tag}: ${shots.length} captures`);
    return { statuses, electoral: { senate, house }, race, foot, smoke: sm, fits, inks, shots };
  } finally { await srv.kill(); }
}

async function run(headDir: string, treeDir: string) {
  for (const d of [headDir, treeDir]) if (!existsSync(path.join(d, ".next", "BUILD_ID"))) throw new Error(`no build in ${d}`);
  mkdirSync(SHOTS, { recursive: true });
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();

  say(`\n── leg A, the prod read`);
  const prod = prodClient();
  const A = expectedFrom((await reader(prod)(FRESH_SQL)).rows as Record<string, unknown>[]);
  const prodDump = sha(JSON.stringify((await reader(prod)(RATINGS_DUMP)).rows.map((r) => Object.values(r))));
  prod.close();
  for (const s of RATERS) say(`  ${s}: ${A[s].rows} rows · as of ${A[s].asOf} · newest row's source_url ${A[s].newestUrl} → via ${A[s].via ?? "none"}`);
  say(`  the line must print: "${lineText(A)}"`);
  say(`  /welcome's foot must print: "ratings as of ${welcomeAsOf(A)}"`);
  for (const copy of ["head", "tree"] as const) {
    const c = await withDb(copyUrl(copyPath(copy)), async (db) => sha(JSON.stringify((await db.execute(RATINGS_DUMP)).rows.map((r) => Object.values(r)))));
    check("A", `the ${copy} copy's race_ratings equal prod's`, c === prodDump, `copy ${c} · prod ${prodDump}`);
  }
  check("A", "all three raters present on prod", RATERS.every((s) => A[s].rows > 0), RATERS.map((s) => `${s} ${A[s].rows}`).join(" · "));

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    say(`\n── HEAD's server (the red)`);
    const H = await session(headDir, "HEAD", "head", browser);
    say(`\n── the tree's server (the green)`);
    const T = await session(treeDir, "tree", "tree", browser);

    say(`\n── leg B, the smoke test`);
    check("B", "every page answers 200 on both builds", [H, T].every((x) => Object.values(x.statuses).every((v) => v === 200)), `HEAD ${JSON.stringify(H.statuses)} · tree ${JSON.stringify(T.statuses)}`);
    check("B", "HEAD red: the test fails, the line absent", H.smoke.failed === 1 && H.smoke.passed === 0 && H.electoral.senate === null, `${H.smoke.failed} failed · first error "${H.smoke.error}"${H.smoke.at ? ` at ${H.smoke.at}` : ""}`);
    check("B", "the tree green: the test passes", T.smoke.passed === 1 && T.smoke.failed === 0 && T.smoke.exit === 0, `${T.smoke.passed} passed`);
    const order = (l: LineRead) => (l?.raters ?? []).map((r) => r.key).join(",");
    check("B", "/electoral: the three raters in order on both tabs", order(T.electoral.senate) === RATERS.join(",") && order(T.electoral.house) === RATERS.join(","), `SENATE ${order(T.electoral.senate)} · HOUSE ${order(T.electoral.house)}`);
    const hrefs = (l: LineRead, ch: "senate" | "house") => RATERS.every((s) => l?.raters.find((r) => r.key === s)?.href === RACE_RATING_PAGES_2026[s]?.[ch]);
    check("B", "/electoral: the links follow the tab (Senate pages, then House pages)", hrefs(T.electoral.senate, "senate") && hrefs(T.electoral.house, "house"), (T.electoral.house?.raters ?? []).map((r) => `${r.key} ${r.href}`).join(" · "));
    const agrees = (l: LineRead) => RATERS.every((s) => (l?.raters.find((r) => r.key === s)?.fresh ?? null) === (freshText(A[s]) || null));
    check("B", "/electoral: each rater's AS OF and VIA agree with A", agrees(T.electoral.senate) && agrees(T.electoral.house), `"${T.electoral.senate?.text}"`);
    check("B", "/electoral: the line's text is A's, word for word", T.electoral.senate?.text === lineText(A), `read "${T.electoral.senate?.text}" · A "${lineText(A)}"`);
    const akRaters = (T.race?.raters ?? []).map((r) => r.key as Rater);
    check("B", `/race/${AK}: the line names the strip's raters, each agreeing with A`, akRaters.length > 0 && T.race?.text === lineText(A, akRaters) && agrees({ text: null, raters: T.race!.raters.concat(RATERS.filter((s) => !akRaters.includes(s)).map((s) => ({ key: s, href: null, fresh: freshText(A[s]) || null }))) }), `"${T.race?.text}"`);
    const want = welcomeAsOf(A);
    check("B", "/welcome: the foot links the three House pages and reads A's dates", RATERS.every((s) => T.foot?.links.some((l) => l.href === RACE_RATING_PAGES_2026[s]?.house)) && !!want && (T.foot?.text ?? "").includes(`ratings as of ${want}`), `"${T.foot?.text}"`);
    check("B", "HEAD's /race and /welcome carry no line and no rater links in the foot", H.race === null && !(H.foot?.links ?? []).length, `race line ${H.race ? "present" : "none"} · foot links ${(H.foot?.links ?? []).length}`);

    say(`\n── leg C, the box fit`);
    for (const k of ["1440x900", "2560x1440"]) {
      const t = T.fits[k]!, h = H.fits[k]!;
      check("C", `${k}, the tree: the document doesn't scroll and the line lies wholly in the window`, t.house && t.scroll === 0 && !!t.foot && t.foot.top >= 0 && t.foot.bottom <= t.inner, `scroll ${t.scroll} · line ${t.foot ? `${Math.round(t.foot.top)}..${Math.round(t.foot.bottom)}` : "none"} of ${t.inner}`);
      check("C", `${k}, sized as before HO 784 the document scrolls by the line's height`, !!t.before && !!t.foot && Math.abs(t.before.scroll - t.foot.height) <= 1, `${t.before?.scroll} against the line's ${t.foot?.height}px`);
      check("C", `${k}, HEAD (the control): no line, the document doesn't scroll`, h.house && h.foot === null && h.scroll === 0, `scroll ${h.scroll}`);
    }
    {
      const t = T.fits["2560x1440"]!;
      check("C", "2560x1440: the line's bottom is RACE NEWS's (1px)", !!t.foot && !!t.news && Math.abs(t.foot.bottom - t.news.bottom) <= 1, `line ${t.foot?.bottom} · RACE NEWS ${t.news?.bottom}`);
    }

    say(`\n── leg D, the colours (the tree)`);
    for (const i of T.inks) say(`    ${i.where} ${i.kind} "${i.text}": ${i.color} on ${i.background} · ${contrast(i.color, i.background).toFixed(2)}:1`);
    const fr = T.inks.filter((i) => i.kind === "freshness"), nm = T.inks.filter((i) => i.kind === "name"), chip = T.inks.filter((i) => i.kind === "chip name");
    check("D", `every freshness clause reads ${EMBER}`, fr.length >= 7 && fr.every((i) => i.color === EMBER), `${fr.length} read: ${[...new Set(fr.map((i) => i.color))].join(", ")}`);
    check("D", `every rater name reads ${MUTED}, as the chip's own`, nm.length >= 9 && nm.every((i) => i.color === MUTED) && chip.length > 0 && chip.every((i) => i.color === MUTED), `${nm.length} names: ${[...new Set(nm.map((i) => i.color))].join(", ")} · ${chip.length} chip names: ${[...new Set(chip.map((i) => i.color))].join(", ")}`);
    const worst = [...fr, ...nm].map((i) => ({ i, c: contrast(i.color, i.background) })).sort((a, b) => a.c - b.c)[0];
    check("D", "each against its computed background at 4.5:1 or better", [...fr, ...nm].every((i) => contrast(i.color, i.background) >= 4.5), worst ? `lowest ${worst.c.toFixed(2)}:1 (${worst.i.where} ${worst.i.kind} on ${worst.i.background})` : "none read");

    say(`\n── leg F, captures: ${[...H.shots, ...T.shots].length} files in ${path.relative(process.cwd(), SHOTS)}`);
    check("F", "every capture written", [...H.shots, ...T.shots].every((f) => existsSync(path.join(SHOTS, f))), `${H.shots.length} HEAD · ${T.shots.length} tree`);
    writeFileSync(path.join(ART, `legs-${LABEL}.json`), JSON.stringify({ A, head: H, tree: T }, null, 1));
  } finally { await browser.close(); }
  await prodUntouched("the run", fp0, t0);
}

// ── leg E: the seed ─────────────────────────────────────────────────────────
type Row = Record<string, unknown>;
async function dump(copy: CopyKind): Promise<Row[]> {
  return withDb(copyUrl(copyPath(copy)), async (db) => (await db.execute(RATINGS_DUMP)).rows.map((r) => ({ ...r })));
}
function seededIds(dir: string): Set<string> {
  const ids = new Set<string>();
  for (const f of readdirSync(path.join(dir, "data")).filter((n) => /^race-ratings-.+\.json$/.test(n))) {
    const j = JSON.parse(readFileSync(path.join(dir, "data", f), "utf8")) as { source: string; ratings?: { race_id: string }[] };
    for (const r of j.ratings ?? []) ids.add(`${r.race_id}-${j.source}`);
  }
  return ids;
}
function runSeed(dir: string, copy: CopyKind, force: boolean) {
  if (existsSync(path.join(dir, ".env"))) throw new Error(`refused: ${dir} carries a .env`);
  const env: Record<string, string | undefined> = { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH, TEMP: process.env.TEMP, TMP: process.env.TMP, USERPROFILE: process.env.USERPROFILE, TURSO_DATABASE_URL: copyUrl(copyPath(copy)), TURSO_AUTH_TOKEN: "" };
  const r = spawnSync(process.execPath, [path.join(dir, "node_modules/tsx/dist/cli.mjs"), "scripts/seed-race-ratings.ts", ...(force ? ["--force"] : [])], { cwd: dir, env: env as NodeJS.ProcessEnv, encoding: "utf8", timeout: 180_000 });
  return { status: r.status, out: redactSecrets(`${r.stdout ?? ""}${r.stderr ?? ""}`).trim() };
}
function moved(before: Row[], after: Row[], ids: Set<string>) {
  const b = new Map(before.map((r) => [String(r.id), r]));
  let updated = 0, inserted = 0, rewritten = 0;
  for (const r of after) {
    const id = String(r.id);
    const p = b.get(id);
    if (!p) { inserted++; continue; }
    if (ids.has(id) && p.updated_at !== r.updated_at) updated++;
    if (p.rating !== r.rating || p.source_url !== r.source_url || p.rating_date !== r.rating_date) rewritten++;
  }
  return { updated, inserted, rewritten };
}
async function seedLeg(headDir: string, treeDir: string) {
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();
  say(`\n── leg E, the seed on scratch copies (never prod)`);
  for (const [dir, kind] of [[headDir, "HEAD"], [treeDir, "tree"]] as const) {
    const at = execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
    say(`  ${kind}'s script: ${path.basename(dir)} at ${at}, no .env there: ${!existsSync(path.join(dir, ".env"))}`);
  }
  const ids = seededIds(treeDir);
  say(`  the seed files' ids: ${ids.size} (${readdirSync(path.join(treeDir, "data")).filter((n) => /^race-ratings-.+\.json$/.test(n)).join(", ")})`);

  const h0 = await dump("e-head");
  const hr = runSeed(headDir, "e-head", false);
  const h1 = await dump("e-head");
  const hm = moved(h0, h1, ids);
  say(`  HEAD, no flag: exit ${hr.status} · ${h0.length} rows before, ${h1.length} after · updated_at moved on ${hm.updated} seeded ids, ${hm.inserted} inserted, ${hm.rewritten} rows rewritten\n    ${hr.out.split("\n").join("\n    ")}`);
  check("E", "HEAD red: the script writes over a table with rows", hr.status === 0 && hm.updated > 0, `updated_at moved on ${hm.updated} of ${ids.size} seeded ids · ${hm.rewritten} rows rewritten`);

  const t0rows = await dump("e-tree");
  const before = sha(JSON.stringify(t0rows));
  const tr = runSeed(treeDir, "e-tree", false);
  const t1rows = await dump("e-tree");
  const after = sha(JSON.stringify(t1rows));
  say(`  the tree, no flag: exit ${tr.status} · table ${before} before, ${after} after\n    ${tr.out}`);
  check("E", "the tree green: exits 1 with the message, the table untouched", tr.status === 1 && tr.out.includes(MESSAGE(t0rows.length)) && before === after, `exit ${tr.status} · message ${tr.out.includes(MESSAGE(t0rows.length)) ? `as specified (N = ${t0rows.length})` : "DIFFERENT"} · hash ${before === after ? "equal" : "CHANGED"}`);

  const tf = runSeed(treeDir, "e-tree", true);
  const t2rows = await dump("e-tree");
  const tm = moved(t1rows, t2rows, ids);
  say(`  the tree, --force: exit ${tf.status} · updated_at moved on ${tm.updated} seeded ids, ${tm.inserted} inserted, ${tm.rewritten} rows rewritten\n    ${tf.out.split("\n").join("\n    ")}`);
  check("E", "the tree with --force writes, which proves the flag", tf.status === 0 && tm.updated > 0, `updated_at moved on ${tm.updated} of ${ids.size} seeded ids`);
  writeFileSync(path.join(ART, `legE-${LABEL}.json`), JSON.stringify({ head: { exit: hr.status, ...hm, out: hr.out }, tree: { exit: tr.status, out: tr.out, before, after }, force: { exit: tf.status, ...tm, out: tf.out } }, null, 1));
  await prodUntouched("leg E", fp0, t0);
}

async function main() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  say(`=== HO 784 legs · ${LABEL} · ${new Date().toISOString()} · checkout ${tree} · HEAD's sha ${HEAD_SHA} ===`);
  if (process.argv.includes("--seed")) await seed();
  if (process.argv.includes("--run")) await run(path.resolve(argAt("--head") ?? ""), path.resolve(argAt("--tree") ?? ""));
  if (process.argv.includes("--seed-leg")) await seedLeg(path.resolve(argAt("--head") ?? ""), path.resolve(argAt("--tree") ?? ""));
  say(`\n${LABEL}: ${passes} PASS · ${fails} FAIL${failed.length ? `\n  FAIL ${failed.join("\n  FAIL ")}` : ""}`);
}
main().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
