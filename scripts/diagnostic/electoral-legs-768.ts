// HO 768 legs A-F: the electoral overhaul's six follow-ups, on `file:` copies seeded from prod and,
// where a page needs the whole dashboard or the bills feed, on a local production build reading prod
// through its own pages' SELECTs (the arrangement HO 767's layout audit ran on).
//
//   npx tsx scripts/diagnostic/electoral-legs-768.ts --seed --label L
//   npx tsx scripts/diagnostic/electoral-legs-768.ts --phase head --label L --dir <8752512 worktree> [--node <node.exe>]
//   npx tsx scripts/diagnostic/electoral-legs-768.ts --phase tree --label L [--node <node.exe>]
//
// BUILT ON scripts/diagnostic/electoral-legs-767.ts, which exports nothing, so what it has is COPIED
// here, not imported: prodClient, reader, prodFingerprint and prodUntouched; copyPath, copyUrl,
// childEnv, withDb, sentinelAt, copyRows and the seed's shape; listeningPids and startServer (widened
// to a prod-read server); NORM, READ_OPEN, newPage, openRow, imagesLoaded. Imported from the tree:
// readRecentRaceMoves (lib/electoral-general.ts), isFreshMove and syncLegOk (lib/move-freshness.ts),
// kalshiActive (lib/race-colors.ts), the pure modules the page runs.
//
// Copies, one seed, each with its own cron_runs sentinel. cron_runs carries the two ratings routes
// whole (the guard's history) plus the newest 400 rows:
//   today  as seeded, the real clock: legs A (its today half), C, E (/electoral's MOVED rows)
//   marks  S-NH's Pappas marked, the clock at Nov 4: leg A (S-NH called; NH-01 the uncalled control)
//   pre    the tracker as it stood before HO 768's write: the House's rows and the pools key gone,
//          the Senate's synced_at back to 2026-05-20. Leg F reads it, `sync:palestine --write`
//          writes it, and leg F reads it again.
// The prod-read server (port 3769, the build's own directory, .env's prod Turso; AUTH_SECRET a local
// throwaway, since NextAuth refuses to run without one): leg B (the dashboard's band), leg D (/bills'
// Tooltip), and the dashboard's MOVED chips for leg E.
// `--phase head` runs 8752512's build (a webpack worktree) for the reds; `--phase tree` runs the
// tree's build for the legs, and leg E's planted cases and its M1 re-read, which need no server.
//
// SAFETY. Prod is READ only: a SELECT-only reader for the seed, the fingerprints and leg E, and the
// prod-read server's own page reads. A fingerprint before and after each mode. Copies are `file:`
// paths ending -768-legs.db; children get that URL with TURSO_AUTH_TOKEN="" (not deleted: dotenv and
// Next's loader refill a missing key). A copy server is transport-checked by its copy's sentinel on
// /api/health, a prod-read server by its own PID on the port and its build id in the served page.
// Every printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readRecentRaceMoves } from "@/lib/electoral-general";
import type { KalshiOdds } from "@/lib/kalshi";
import { isFreshMove, syncLegOk, type GuardHorizons, type HistoryRunRow, type MoveChamber, type SyncRunRow } from "@/lib/move-freshness";
import { kalshiActive } from "@/lib/race-colors";
import { redactSecrets } from "@/lib/redact";
import { STATE_ABBR_TO_NAME } from "@/lib/states";

config({ path: ".env", quiet: true });

const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/768-artifacts"); // repo-ignored
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const PORT = 3768; // copy servers
const PROD_PORT = 3769; // prod-read servers
const NOV4 = "2026-11-04T15:00:00.000Z"; // 8am MT the morning after
const SENTINEL_ROUTE = "/api/cron/race-challengers";
const SYNC_ROUTE = "/api/sync-race-ratings";
const HIST_ROUTE = "/api/cron/rating-history";
const SENATE_SYNCED_BEFORE = "2026-05-20T02:14:30.480Z"; // the Senate tab's last read before HO 768 (STEP 0)
// The 767 seed's tables, read whole.
const WHOLE = [
  "races", "members", "member_ids", "race_ratings", "rating_history", "race_candidates", "kalshi_odds", "polymarket_odds",
  "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads",
  "palestine_scorecard", "member_ideology", "member_participation", "member_career_votes", "votes", "observations",
  "observation_entities", "dashboard_state",
];
// STEP 0's re-read under the ruling (docs/handoffs/768-artifacts/step0-m1-ruling.txt): rated races
// by their newest passing move. The built reader must print the same.
const M1_EXPECTED = "2026-07-08 1 · 2026-07-29 28 · 2026-08-05 3 · 2026-08-12 2 · 2026-08-19 3 · 2026-08-26 2 · 2026-09-02 5 · 2026-09-23 8 · 2026-09-30 17 · none 21";
const OVERLAP_WIDTHS = [701, 768, 1100, 1440];

type Kind = "today" | "marks" | "pre";
const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
const NODE = argAt("--node") ?? process.execPath;
const say = (s: string) => console.log(redactSecrets(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const check = (leg: string, label: string, ok: boolean, detail: string) => {
  say(`  ${ok ? "PASS" : "FAIL"}  [leg ${leg}] ${label}: ${detail}`);
  if (ok) passes++; else fails++;
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const LOCAL_AUTH = randomBytes(32).toString("hex"); // a throwaway for the local server; never stored

// ── prod, read-only (copied from the 767 driver) ────────────────────────────
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
  for (const t of ["race_candidates", "general_ballot", "general_ballot_reads", "primary_candidates", "palestine_scorecard", "member_fundraising", "race_ratings", "kalshi_odds"])
    fp[t] = sha(JSON.stringify((await read(`SELECT * FROM ${t} ORDER BY rowid`)).rows.map((r) => Object.values(r))));
  fp.pools = sha(JSON.stringify((await read(`SELECT value FROM dashboard_state WHERE key = 'palestine_tracker_pools'`)).rows.map((r) => Object.values(r))));
  fp.schema = sha(JSON.stringify((await read(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`)).rows.map((r) => Object.values(r))));
  db.close();
  return fp;
}
async function prodUntouched(label: string, fp0: Record<string, string>, t0: string) {
  const fp1 = await prodFingerprint();
  const changed = Object.keys(fp0).filter((k) => fp0[k] !== fp1[k]);
  if (changed.length === 0) { check("*", `prod untouched (${label})`, true, "fingerprints equal"); return; }
  const db = prodClient();
  const t0m = new Date(Date.parse(t0) - 60 * 60 * 1000).toISOString();
  const runs = (await reader(db)(`SELECT id, route, started_at FROM cron_runs WHERE started_at >= ? OR (started_at >= ? AND (ended_at IS NULL OR ended_at >= ?)) ORDER BY id`, [t0, t0m, t0])).rows.map((r) => `${r.route}#${r.id}`);
  db.close();
  // The tables a prod cron writes; a difference in one is explained only if a run overlapped.
  const cronOwned = new Set(["race_candidates", "general_ballot", "general_ballot_reads", "primary_candidates", "member_fundraising", "race_ratings", "kalshi_odds"]);
  const unexplained = changed.filter((k) => !cronOwned.has(k) || runs.length === 0);
  check("*", `prod untouched (${label}): every difference is a prod cron's own run overlapping the window`, unexplained.length === 0, `changed ${changed.join(", ")} · runs ${runs.join("; ") || "none"}${unexplained.length ? ` · UNEXPLAINED ${unexplained.join(", ")}` : ""}`);
}

// ── copies (copied from the 767 driver, the kinds and the cron_runs cut changed) ─────
const copyPath = (kind: Kind | "template") => path.join(DIR, `${kind}-${LABEL}-768-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-768-legs.db")) throw new Error(`refused: a copy must be a *-768-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
function childEnv(url: string, clock: string | null): NodeJS.ProcessEnv {
  if (!url.startsWith("file:")) throw new Error("refused: children get file: only");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: url, AUTH_SECRET: LOCAL_AUTH };
  env.TURSO_AUTH_TOKEN = "";
  if (clock) env.CBT_CLOCK_NOW = clock;
  else delete env.CBT_CLOCK_NOW;
  return env;
}
function prodEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, AUTH_SECRET: LOCAL_AUTH };
  delete env.CBT_CLOCK_NOW;
  if (!String(env.TURSO_DATABASE_URL ?? "").startsWith("libsql://")) throw new Error("the prod-read server needs .env's prod URL");
  return env;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
const sentinelAt = (kind: Kind) => readFileSync(path.join(DIR, `sentinel-${kind}-${LABEL}-768.txt`), "utf8").trim();

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
  say(`    ${table}: ${n}`);
  return n;
}

async function seed() {
  mkdirSync(DIR, { recursive: true });
  mkdirSync(ART, { recursive: true });
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();
  const tpl = copyPath("template");
  if (existsSync(tpl)) rmSync(tpl);
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env: childEnv(copyUrl(tpl), null), encoding: "utf8" });
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
    counts.push(`bills ${await copyRows(read, db, "bills", `WHERE sponsor_bioguide_id IN (${ph})`, ids)} (sponsored by the ${ids.length} members)`);
    counts.push(`member_votes ${await copyRows(read, db, "member_votes", `WHERE bioguide_id IN (${ph})`, ids)} (the ${ids.length} members)`);
    counts.push(`cron_runs ${await copyRows(read, db, "cron_runs", `WHERE route IN (?, ?) OR id > (SELECT MAX(id) FROM cron_runs) - 400`, [SYNC_ROUTE, HIST_ROUTE])} (the ratings routes whole, and the newest 400)`);
  });
  prod.close();
  say(`template: the real scripts/migrate.ts against file:, seeded from prod · ${counts.join(" · ")}`);
  for (const kind of ["today", "marks", "pre"] as const) {
    const abs = copyPath(kind);
    copyFileSync(tpl, abs);
    const at = new Date(Date.now() + (kind === "today" ? 1 : kind === "marks" ? 2 : 3)).toISOString();
    writeFileSync(path.join(DIR, `sentinel-${kind}-${LABEL}-768.txt`), at);
    await withDb(copyUrl(abs), (db) => db.execute({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 768, 'success', ?)`, args: [SENTINEL_ROUTE, at, at, JSON.stringify({ sentinel: `HO 768 legs, the ${kind} copy only` })] }));
    if (kind === "marks") {
      await withDb(copyUrl(abs), async (db) => {
        const rows = (await db.execute({ sql: `SELECT person_key, name, party FROM general_ballot WHERE race_id = 'S-NH-2026' AND on_ballot = 1 AND write_in = 0`, args: [] })).rows;
        const hit = rows.filter((r) => String(r.name).includes("Pappas"));
        if (hit.length !== 1) throw new Error(`plant S-NH Pappas: ${hit.length} printed rows match (${rows.map((r) => r.name).join(", ")})`);
        await db.execute({ sql: `UPDATE general_ballot SET marked = 1 WHERE race_id = 'S-NH-2026' AND person_key = ?`, args: [String(hit[0]!.person_key)] });
        say(`  marks planted: S-NH-2026 ${hit[0]!.name} (${hit[0]!.party})`);
      });
    }
    if (kind === "pre") {
      await withDb(copyUrl(abs), async (db) => {
        const del = await db.execute(`DELETE FROM palestine_scorecard WHERE bioguide_id IN (SELECT bioguide_id FROM members WHERE chamber = 'house')`);
        const key = await db.execute(`DELETE FROM dashboard_state WHERE key = 'palestine_tracker_pools'`);
        const back = await db.execute({ sql: `UPDATE palestine_scorecard SET synced_at = ?`, args: [SENATE_SYNCED_BEFORE] });
        const left = (await db.execute(`SELECT COUNT(*) AS n FROM palestine_scorecard`)).rows[0]?.n;
        say(`  pre: House rows removed ${del.rowsAffected} · pools key removed ${key.rowsAffected} · Senate synced_at back to ${SENATE_SYNCED_BEFORE} on ${back.rowsAffected} · rows left ${left}`);
      });
    }
    say(`copy ${path.basename(abs)} · sentinel ${at}`);
  }
  await prodUntouched("the seed", fp0, t0);
}

// ── servers (copied from the 767 driver; the prod-read mode is new) ──────────
function listeningPids(port: number): number[] {
  try {
    const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
    return out.split(/\r?\n/).filter((l) => l.includes(`:${port} `) && /LISTENING/.test(l)).map((l) => Number(l.trim().split(/\s+/).pop()));
  } catch { return []; }
}
type Target = { copy: Kind; clock: string | null } | { prod: true };
type Srv = { base: string; kill: () => Promise<void> };
async function startServer(dir: string, target: Target): Promise<Srv> {
  const prod = "prod" in target;
  const port = prod ? PROD_PORT : PORT;
  const base = `http://127.0.0.1:${port}`;
  if (listeningPids(port).length) throw new Error(`port ${port} is already bound; refusing to share it`);
  rmSync(path.join(dir, ".next/cache/fetch-cache"), { recursive: true, force: true });
  const tag = prod ? "prod" : target.copy;
  const out = createWriteStream(path.join(DIR, `server768-${tag}-${LABEL}-${Date.now()}.log`));
  const env = prod ? prodEnv() : childEnv(copyUrl(copyPath(target.copy)), target.clock);
  const server = spawn(NODE, [path.join(dir, "node_modules/next/dist/bin/next"), "start", "-p", String(port)], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (b: Buffer) => out.write(b));
  server.stderr.on("data", (b: Buffer) => out.write(b));
  const kill = async () => {
    try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
    out.end();
    for (let i = 0; i < 20 && listeningPids(port).length; i++) await sleep(250);
    if (listeningPids(port).length) throw new Error(`port ${port} still bound after the kill`);
  };
  let up = false;
  for (let i = 0; i < 120 && !up; i++) { await sleep(500); try { up = (await fetch(`${base}/api/health`)).status > 0; } catch { /* not yet */ } }
  if (!up) { await kill(); throw new Error("the server never answered /api/health"); }
  const buildId = readFileSync(path.join(dir, ".next/BUILD_ID"), "utf8").trim();
  if (prod) {
    const pids = listeningPids(port);
    const html = await (await fetch(`${base}/electoral`, { headers: { cookie: "ct_seen=1" } })).text();
    if (!pids.includes(server.pid!) || !html.includes(buildId)) { await kill(); throw new Error(`transport check failed: port ${port} PIDs ${pids.join(",")} vs child ${server.pid}; build id ${buildId} in the page: ${html.includes(buildId)}`); }
    say(`  server :${port} (pid ${server.pid}, ${path.relative(process.cwd(), dir) || "the tree"}, build ${buildId}) · PROD-READ (pages' own SELECTs; its PID on the port, its build id in the page) · fetch-cache cleared`);
  } else {
    const h = (await (await fetch(`${base}/api/health`)).json()) as { routes?: { path?: string; lastRunAt?: string }[] };
    const mine = h.routes?.find((r) => r.path === SENTINEL_ROUTE);
    if (mine?.lastRunAt !== sentinelAt(target.copy)) { await kill(); throw new Error(`transport check failed: lastRunAt ${String(mine?.lastRunAt)} is not the ${target.copy} copy's sentinel`); }
    say(`  server :${port} (pid ${server.pid}, ${path.relative(process.cwd(), dir) || "the tree"}, build ${buildId}) · ${target.copy} copy (own sentinel) · clock ${target.clock ?? "real"} · fetch-cache cleared`);
  }
  return { base, kill };
}

// ── page scripts: strings, no regex escapes (HO 736). NORM and READ_OPEN copied from the 767 driver.
const NORM = `const norm = (s) => (s || '').split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ');`;
const READ_OPEN = `(() => { ${NORM}
  const ex = document.querySelector('.race-list-expand');
  if (!ex) return null;
  const members = Array.from(ex.querySelectorAll('.rl-mem')).map((m) => ({
    name: norm(m.querySelector('.rl-mn').textContent),
    href: (m.querySelector('.rl-mh a.rl-lk') || {}).getAttribute ? m.querySelector('.rl-mh a.rl-lk').getAttribute('href') : null,
    role: norm(m.querySelector('.rl-mr').textContent),
    chips: m.querySelectorAll('[data-grade-chip]').length,
    chip: norm((m.querySelector('[data-grade-chip]') || {}).textContent),
  }));
  const sh = ex.querySelector('.rl-sh');
  return { members, held: sh ? norm(sh.textContent) : null, heldChips: sh ? sh.querySelectorAll('[data-grade-chip]').length : 0, heldChip: sh ? norm((sh.querySelector('[data-grade-chip]') || {}).textContent) : null };
})()`;
type OpenReading = { members: { name: string; href: string | null; role: string; chips: number; chip: string }[]; held: string | null; heldChips: number; heldChip: string | null };
const READ_MOVED = `(() => Array.from(document.querySelectorAll('li.race-list-item')).map((li) => { const m = li.querySelector('.race-list-row [data-moved]'); return m ? li.getAttribute('data-race') + ' ' + m.getAttribute('data-moved') : null; }).filter(Boolean))()`;
const READ_CARDS = `(() => { ${NORM} return Array.from(document.querySelectorAll('.dv2-racesbox-panel--races .race-card')).map((c) => { const m = c.querySelector('.rc-moved .rc-chip-body'); return c.getAttribute('data-seat') + ' ' + (m ? norm(m.textContent) : '(no MOVED)'); }); })()`;
const READ_BAND = (sel: string) => `(() => {
  const b = document.querySelector('${sel}');
  if (!b) return null;
  const vis = (q) => { const e = b.querySelector(q); return e ? e.checkVisibility() : null; };
  const ink = (el) => { const r = document.createRange(); r.selectNodeContents(el); const rs = Array.from(r.getClientRects()).filter((x) => x.width > 0); return rs.length ? { l: Math.min(...rs.map((x) => x.left)), r: Math.max(...rs.map((x) => x.right)) } : { l: null, r: null }; };
  const lab = (q) => {
    const xs = Array.from(b.querySelectorAll(q)).filter((e) => e.checkVisibility()).map((e) => Object.assign({ t: e.textContent.trim() }, ink(e))).filter((x) => x.l != null).sort((a, c) => a.l - c.l);
    const ov = xs.slice(1).map((x, i) => ({ a: xs[i].t, b: x.t, px: Math.round((xs[i].r - x.l) * 10) / 10 }));
    return { n: xs.length, widths: xs.map((x) => Math.round(x.r - x.l)), max: ov.length ? Math.max(0, ...ov.map((o) => o.px)) : 0, over: ov.filter((o) => o.px > 0) };
  };
  const ctl = b.querySelector('.ctl');
  return { ctl: vis('.ctl'), legend: vis('.ctl-legend'), eday: vis('.ctl-eday'), edayText: ((b.querySelector('.ctl-eday') || {}).textContent || '').split(String.fromCharCode(10)).join(' ').trim(), padBottom: getComputedStyle(b).paddingBottom, track: ctl ? Math.round(ctl.getBoundingClientRect().width) : null, featured: lab('.cm-dot-wrap .cm-lbl'), counts: lab('.cm-agg .cm-cnt') };
})()`;
type BandReading = { ctl: boolean | null; legend: boolean | null; eday: boolean | null; edayText: string; padBottom: string; track: number | null; featured: { n: number; widths: number[]; max: number; over: { a: string; b: string; px: number }[] }; counts: { n: number; widths: number[]; max: number; over: { a: string; b: string; px: number }[] } } | null;

type Browser = Awaited<ReturnType<typeof import("@playwright/test")["chromium"]["launch"]>>;
async function newPage(browser: Browser, base: string, w: number, h = 1000, blob = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  await ctx.addCookies([{ name: "ct_seen", value: "1", url: base }]);
  if (blob) await ctx.addInitScript(`(() => { const orig = URL.createObjectURL.bind(URL); URL.createObjectURL = (b) => { if (b instanceof Blob) b.text().then((t) => { window.__md = t; }); return orig(b); }; })()`);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return { ctx, page, errors };
}
type Page = Awaited<ReturnType<typeof newPage>>["page"];
async function imagesLoaded(page: Page) {
  await page.evaluate(`Promise.all(Array.from(document.images).filter((i) => !i.complete).map((i) => new Promise((r) => { i.onload = r; i.onerror = r; setTimeout(r, 4000); })))`);
}
async function openRow(page: Page, id: string) {
  await page.locator(".rl-tab", { hasText: id.startsWith("S-") ? "SENATE" : "HOUSE" }).click();
  const li = page.locator(`li[data-race="${id}"]`);
  if (!(await li.locator(".race-list-expand").count())) await li.locator(".race-list-seat").click();
  await li.locator(".race-list-expand").waitFor({ timeout: 8000 });
  await imagesLoaded(page);
  return li;
}
const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
async function toMap(page: Page) {
  const b = page.locator(".cart-viewtoggle-btn", { hasText: "MAP" });
  if ((await b.getAttribute("aria-selected")) !== "true") { await b.click(); await page.waitForTimeout(400); }
}

// ── leg A: a called seat's market on the MAP ─────────────────────────────────
// The pinned card (RaceMapCard): pin the state by a seat label in MAP's search, open each row in
// turn (the card is single-open), count its .racecard-kalshi.
async function pinnedKalshi(page: Page, query: string, labels: string[]): Promise<Record<string, number>> {
  await toMap(page);
  const box = page.locator(".cart-search input");
  await box.fill(query);
  await box.press("Enter");
  await page.locator("ul.racecard-list").waitFor({ timeout: 8000 });
  const out: Record<string, number> = {};
  const rows = page.locator("ul.racecard-list > li.racecard-row");
  const n = await rows.count();
  for (let i = 0; i < n; i++) {
    const row = rows.nth(i);
    const seat = norm(await row.locator(".racecard-seat").innerText());
    const label = labels.find((l) => seat.includes(l)) ?? seat;
    // The chevron, not the head's center: the head carries the incumbent's member link.
    await row.locator(".racecard-head .racecard-chevron").click();
    await page.waitForTimeout(150);
    out[label] = await row.locator(".racecard-kalshi").count();
  }
  return out;
}
// The district modal: the state's path, then each seat's chip; its card's .racecard-kalshi and the
// export's markdown, the Blob intercepted as odds-toggle-692 does.
async function districtKalshi(page: Page, stateName: string, labels: string[]) {
  await toMap(page);
  await page.locator(`path.us-map-state[aria-label="${stateName}"]`).click({ force: true });
  await page.locator(".rdm-chip").first().waitFor({ timeout: 8000 });
  const out: Record<string, { card: number; md: string | null }> = {};
  for (const l of labels) {
    await page.evaluate(`window.__md = null`);
    await page.locator(".rdm-chip", { hasText: l }).first().click();
    await page.waitForTimeout(300);
    const card = await page.locator(".rdm-detail .racecard-kalshi").count();
    await page.locator("button.rdm-action", { hasText: "EXPORT" }).click();
    await page.waitForTimeout(600);
    out[l] = { card, md: (await page.evaluate(`window.__md || null`)) as string | null };
  }
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  return out;
}
async function legA(browser: Browser, base: string, out: Record<string, unknown>, mode: "head" | "tree") {
  say(`\n── leg A (${mode}), the marks copy at ${NOV4}: S-NH called, NH-01 the uncalled control`);
  const { ctx, page, errors } = await newPage(browser, base, 1440, 1000, true);
  await page.goto(`${base}/electoral`, { waitUntil: "networkidle" });
  await openRow(page, "S-NH-2026");
  const chip = norm(await page.locator('li[data-race="S-NH-2026"] .rl-chipcell .race-list-chip').innerText().catch(() => ""));
  const pinned = await pinnedKalshi(page, "NH SEN", ["NH SEN", "NH-01", "NH-02"]);
  const district = await districtKalshi(page, "New Hampshire", ["NH SEN", "NH-01"]);
  const mdLine = (md: string | null) => (md == null ? null : md.includes("Kalshi market:"));
  const r = { chip, pinned, district: Object.fromEntries(Object.entries(district).map(([k, v]) => [k, { card: v.card, mdKalshi: mdLine(v.md), mdHead: (v.md ?? "").split("\n").slice(0, 4).join(" | ") }])), errors };
  out.legA = r;
  say(`    S-NH's chip "${chip}" · pinned card .racecard-kalshi ${JSON.stringify(pinned)} · district ${JSON.stringify(r.district)}`);
  if (mode === "head") {
    check("A", "red: HEAD's pinned card prints the called seat's market (S-NH)", pinned["NH SEN"] === 1, `NH SEN ${pinned["NH SEN"]}`);
    check("A", "red: HEAD's district export prints the called seat's market line", mdLine(district["NH SEN"]?.md ?? null) === true, `export "Kalshi market:" ${mdLine(district["NH SEN"]?.md ?? null)}`);
  } else {
    check("A", "the precondition: S-NH reads called (D HOLD) on the marks copy at Nov 4", chip === "D HOLD", `"${chip}"`);
    check("A", "the pinned card: no market on the called seat, one on the uncalled NH-01 (the control)", pinned["NH SEN"] === 0 && pinned["NH-01"] === 1, JSON.stringify(pinned));
    check("A", "the district card: no market on the called seat, one on NH-01 (the control)", district["NH SEN"]?.card === 0 && district["NH-01"]?.card === 1, `NH SEN ${district["NH SEN"]?.card} · NH-01 ${district["NH-01"]?.card}`);
    check("A", "the district export: no market line for the called seat, one for NH-01 (the control)", mdLine(district["NH SEN"]?.md ?? null) === false && mdLine(district["NH-01"]?.md ?? null) === true, `NH SEN ${mdLine(district["NH SEN"]?.md ?? null)} · NH-01 ${mdLine(district["NH-01"]?.md ?? null)}`);
    check("A", "no page error", errors.length === 0, errors.slice(0, 2).join(" | ") || "none");
  }
  await ctx.close();
}
// The today copy: every MAP card with a market keeps it. The seats with a live market come from
// the copy's own kalshi_odds; each state is pinned by its first seat label.
async function legAToday(browser: Browser, base: string, out: Record<string, unknown>) {
  say(`\n── leg A (tree), the today copy at the real clock: every MAP card with a market keeps it`);
  const now = Date.now();
  const seats = await withDb(copyUrl(copyPath("today")), async (db) => (await db.execute({ sql: `
      SELECT r.id, r.state, r.chamber, r.district, (SELECT COUNT(*) FROM kalshi_odds k WHERE k.race_id = r.id AND (k.close_time IS NULL OR k.close_time > ?)) AS live
        FROM races r WHERE r.cycle = 2026 AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = r.cycle) ORDER BY r.state, r.id`, args: [new Date(now).toISOString()] })).rows.map((r) => ({
    id: String(r.id), state: String(r.state), label: String(r.chamber) === "senate" ? `${r.state} SEN` : `${r.state}-${r.district == null || Number(r.district) === 0 ? "AL" : String(r.district).padStart(2, "0")}`, live: Number(r.live) > 0,
  })));
  const states = [...new Set(seats.filter((s) => s.live).map((s) => s.state))];
  const { ctx, page } = await newPage(browser, base, 1440, 1000);
  await page.goto(`${base}/electoral`, { waitUntil: "networkidle" });
  const misses: string[] = [];
  let read = 0, withMarket = 0;
  for (const st of states) {
    const mine = seats.filter((s) => s.state === st);
    const got = await pinnedKalshi(page, mine[0]!.label, mine.map((s) => s.label));
    for (const s of mine) {
      read++;
      if (s.live) withMarket++;
      if ((got[s.label] ?? -1) !== (s.live ? 1 : 0)) misses.push(`${s.label} expected ${s.live ? 1 : 0} read ${got[s.label] ?? "no row"}`);
    }
  }
  out.legAToday = { states: states.length, read, withMarket, misses };
  check("A", "today copy: every pinned MAP card with a live market shows it, and none without one does", misses.length === 0 && withMarket > 0, `${states.length} states pinned · ${read} seats read · ${withMarket} with a live market · misses ${JSON.stringify(misses)}`);
  await ctx.close();
}
function legAUnit() {
  say(`\n── leg A, kalshiActive on a closeTime one second either side of a fixed nowMs`);
  const nowMs = Date.parse("2026-11-03T15:00:00.000Z");
  const odds = (closeTime: string | null) => ({ eventTicker: "X", impliedPct: 60, favoriteLabel: "D", favoriteIsParty: true, favoriteParty: "D", openInterest: 1, closeTime }) as unknown as KalshiOdds;
  const after = kalshiActive(odds(new Date(nowMs + 1000).toISOString()), nowMs);
  const before = kalshiActive(odds(new Date(nowMs - 1000).toISOString()), nowMs);
  check("A", "kalshiActive: a market closing 1s after nowMs is active, 1s before is not (the clock is the argument)", after === true && before === false, `+1s ${after} · −1s ${before}`);
}

// ── leg B: the dashboard's band at phone width ───────────────────────────────
async function band(browser: Browser, base: string, route: "/" | "/electoral", w: number): Promise<BandReading> {
  const { ctx, page } = await newPage(browser, base, w, 1000);
  await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
  if (route === "/") {
    await page.locator("button.dv2-racesbox-tab", { hasText: "Races" }).first().click();
    await page.locator(".dv2-racesbox-panel--races .battlefield").first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);
  }
  const r = (await page.evaluate(READ_BAND(route === "/" ? ".dv2-racesbox-panel--races .battlefield" : ".electoral-band .battlefield"))) as BandReading;
  await ctx.close();
  return r;
}
async function legB(browser: Browser, base: string, out: Record<string, unknown>, mode: "head" | "tree", head?: Record<string, BandReading>) {
  say(`\n── leg B (${mode}), the band at phone width (prod-read server)`);
  const r: Record<string, BandReading> = {};
  for (const [route, w] of [["/", 430], ["/", 1440], ["/electoral", 430], ["/electoral", 1440]] as const) r[`${route} ${w}`] = await band(browser, base, route, w);
  for (const w of OVERLAP_WIDTHS) r[`/ ${w} overlap`] = await band(browser, base, "/", w);
  out.legB = r;
  for (const [k, v] of Object.entries(r)) say(`    ${k}: ctl ${v?.ctl} · legend ${v?.legend} · eday ${v?.eday} "${v?.edayText}" · pad-bottom ${v?.padBottom} · track ${v?.track}px · featured labels ${v?.featured.n} (widths ${v?.featured.widths.join("/")}) worst overlap ${v?.featured.max}px ${JSON.stringify(v?.featured.over)} · tier counts ${v?.counts.n} worst ${v?.counts.max}px`);
  const d430 = r["/ 430"], d1440 = r["/ 1440"];
  if (mode === "head") {
    check("B", "red: HEAD's dashboard band at 430 shows its axis and legend, and its featured labels overlap", d430?.ctl === true && d430?.legend === true && (d430?.featured.max ?? 0) > 0, `ctl ${d430?.ctl} · legend ${d430?.legend} · worst featured overlap ${d430?.featured.max}px · counts ${d430?.counts.max}px`);
    return;
  }
  check("B", "/ at 430, the Races tab open: .ctl and .ctl-legend hidden, the ELECTION DAY line shows", d430?.ctl === false && d430?.legend === false && d430?.eday === true && /ELECTION DAY|RESULTS/.test(d430?.edayText ?? ""), `ctl ${d430?.ctl} · legend ${d430?.legend} · eday ${d430?.eday} "${d430?.edayText}" · pad-bottom ${d430?.padBottom}`);
  check("B", "/ at 1440 (the control): the axis and the legend show", d1440?.ctl === true && d1440?.legend === true && d1440?.eday === true, `ctl ${d1440?.ctl} · legend ${d1440?.legend}`);
  for (const w of [430, 1440]) {
    const a = r[`/electoral ${w}`], b = head?.[`/electoral ${w}`];
    const pick = (x: BandReading | undefined) => JSON.stringify(x && { ctl: x.ctl, legend: x.legend, eday: x.eday, pad: x.padBottom, track: x.track, featured: x.featured.n });
    check("B", `/electoral at ${w} reads as at 8752512`, !!b && pick(a) === pick(b), `tree ${pick(a)} · HEAD ${pick(b ?? undefined)}`);
  }
  const over = OVERLAP_WIDTHS.map((w) => `${w}: ${r[`/ ${w} overlap`]?.featured.max}px over ${r[`/ ${w} overlap`]?.track}px of track`);
  out.legBOverlap = over;
  say(`    REPORT, the featured labels' worst overlap on / with the Races tab open: ${over.join(" · ")} (over 0px is filed, not fixed)`);
}

// ── leg C: the calendar readout names its states ─────────────────────────────
// Two pairs of dates off the dated list: the pair sharing the most states (the union drops the
// repeat), and the pair whose union is widest (the A-to-Z order across two lists).
const PICK_PAIRS = `(() => {
  const rows = Array.from(document.querySelectorAll('.electoral-cal-row')).map((r) => { const s = r.querySelector('.electoral-cal-s'); const n = s.querySelector('.electoral-cal-n'); const states = s.textContent.replace(n ? n.textContent : '', '').trim().split(' ').filter(Boolean); return { d: r.querySelector('.electoral-cal-d').textContent.trim(), states, n: Number((n ? n.textContent : '').split(' ').filter(Boolean).pop()) }; });
  const pairs = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) { const shared = rows[i].states.filter((x) => rows[j].states.includes(x)).length; pairs.push({ a: rows[i], b: rows[j], shared, union: new Set(rows[i].states.concat(rows[j].states)).size }); }
  const by = (k1, k2) => pairs.slice().sort((x, y) => y[k1] - x[k1] || y[k2] - x[k2])[0] || null;
  return { shared: by('shared', 'union'), wide: by('union', 'shared') };
})()`;
const CLICK_BAR = (d: string) => `(() => { const r = Array.from(document.querySelectorAll('.electoral-tl-band rect[role=button]')).find((x) => (x.querySelector('title') || {}).textContent && x.querySelector('title').textContent.startsWith('${d} ·')); if (!r) return false; r.dispatchEvent(new MouseEvent('click', { bubbles: true })); return true; })()`;
const AMBER = `(() => Array.from(document.querySelectorAll('.us-map-wrap path[aria-label]')).filter((p) => (p.getAttribute('fill') || '').toLowerCase() === '#fbbf24').map((p) => p.getAttribute('aria-label')))()`;
type CalRow = { d: string; states: string[]; n: number };
type Pair = { a: CalRow; b: CalRow; shared: number; union: number };
async function legC(browser: Browser, base: string, out: Record<string, unknown>, mode: "head" | "tree") {
  say(`\n── leg C (${mode}), the calendar readout (today copy, LIST)`);
  const { ctx, page, errors } = await newPage(browser, base, 1440, 1000);
  await page.goto(`${base}/electoral`, { waitUntil: "networkidle" });
  const listOn = await page.locator(".cart-viewtoggle-btn", { hasText: "LIST" }).getAttribute("aria-selected");
  await page.locator(".electoral-tl-fold").click();
  await page.waitForTimeout(250);
  const pairs = (await page.evaluate(PICK_PAIRS)) as { shared: Pair | null; wide: Pair | null };
  const reads: Record<string, unknown> = { list: listOn };
  for (const [name, two] of [["shared", pairs.shared], ["wide", pairs.wide]] as const) {
    if (!two) { check("C", `the ${name} pair of dates`, false, "no dated list"); continue; }
    // LIST, the calendar open, no locks left from the pair before
    const list = page.locator(".cart-viewtoggle-btn", { hasText: "LIST" });
    if ((await list.getAttribute("aria-selected")) !== "true") { await list.click(); await page.waitForTimeout(300); }
    if (!(await page.locator(".electoral-cal-list").count())) { await page.locator(".electoral-tl-fold").click(); await page.waitForTimeout(250); }
    if (await page.locator(".electoral-readout-clear").count()) { await page.locator(".electoral-readout-clear").click(); await page.waitForTimeout(150); }
    const clicked = [await page.evaluate(CLICK_BAR(two.a.d)), await page.evaluate(CLICK_BAR(two.b.d))];
    await page.waitForTimeout(250);
    const readout = norm(await page.locator(".electoral-readout-count").innerText().catch(() => ""));
    const union = [...new Set([...two.a.states, ...two.b.states])].sort();
    const expect = `— ${union.join(" ")} · ${two.a.n + two.b.n} contests`;
    await page.locator(".electoral-tl-fold").click();
    await toMap(page);
    const amber = ((await page.evaluate(AMBER)) as string[]).map((n) => Object.entries(STATE_ABBR_TO_NAME).find(([, v]) => v === n)?.[0] ?? n).sort();
    reads[name] = { two, clicked, readout, expect, amber };
    say(`    ${name}: ${two.a.d} (${two.a.states.join(" ")} · ${two.a.n}) and ${two.b.d} (${two.b.states.join(" ")} · ${two.b.n}), ${two.shared} shared, union ${two.union} · readout "${readout}" · MAP amber ${amber.join(" ")}`);
    if (mode === "head") {
      check("C", `red (${name} pair): HEAD's readout prints a count of states, not their names`, /^— \d+ states · \d+ contests$/.test(readout), `"${readout}"`);
    } else {
      check("C", `in LIST (${name} pair): the readout names the union of the two dates' states A to Z, and the contests sum`, listOn === "true" && clicked.every(Boolean) && readout === expect, `"${readout}" · expected "${expect}"`);
      check("C", `MAP paints the same states amber (${name} pair, the control)`, amber.join(" ") === union.join(" "), `amber ${amber.join(" ")} · union ${union.join(" ")}`);
    }
  }
  if (mode === "tree") check("C", "no page error", errors.length === 0, errors.slice(0, 2).join(" | ") || "none");
  out.legC = reads;
  await ctx.close();
}

// ── leg D: the Tooltip follows a scroll (/bills on the prod-read server) ─────
const PICK_TERM = `(() => { const els = Array.from(document.querySelectorAll('.tooltip-term')); const pinnedUp = (e) => { for (let n = e; n; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return true; } return false; }; return { i: els.findIndex((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.top > 220 && r.bottom < innerHeight - 200 && !pinnedUp(e); }), n: els.length, doc: document.documentElement.scrollHeight, vh: innerHeight }; })()`;
// A panel-count timeline from now on: every change in the number of open Tooltip panels, stamped.
const TIMELINE = `(() => { window.__tl = []; window.__t0 = performance.now(); const n = () => document.querySelectorAll('.tooltip-panel').length; let last = n(); new MutationObserver(() => { const c = n(); if (c !== last) { last = c; window.__tl.push([Math.round(performance.now() - window.__t0), c]); } }).observe(document.body, { childList: true, subtree: true }); })()`;
async function legD(browser: Browser, base: string, out: Record<string, unknown>, mode: "head" | "tree") {
  say(`\n── leg D (${mode}), the Tooltip on /bills at 1440 (prod-read server)`);
  const { ctx, page, errors } = await newPage(browser, base, 1440, 900);
  await page.goto(`${base}/bills`, { waitUntil: "networkidle" });
  const pick = (await page.evaluate(PICK_TERM)) as { i: number; n: number; doc: number; vh: number };
  if (pick.i < 0) { check("D", "a .tooltip-term in the first screen with room to scroll", false, JSON.stringify(pick)); await ctx.close(); return; }
  const term = page.locator(".tooltip-term").nth(pick.i);
  const label = norm(await term.innerText());
  const panel = page.locator(".tooltip-panel[role='tooltip']");
  // a closed panel reads null at once (a bare locator would wait for one to appear)
  const top = async (l: typeof term) => ((await l.count()) ? ((await l.first().boundingBox())?.y ?? null) : null);
  const tlRead = async () => (await page.evaluate(`window.__tl`)) as [number, number][];
  const hoverOpen = async () => {
    const b = (await term.boundingBox())!;
    await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(650);
  };
  // the delay: hover, then closed at 250ms and open by 650ms
  let b = (await term.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForTimeout(250);
  const at250 = await panel.count();
  await page.waitForTimeout(400);
  const at650 = await panel.count();
  // (1) the handoff's reading: hovered, a 120px scroll under a pointer held still. The trigger leaves
  // the pointer, and Chromium's hover update closes the panel on either build; reported with its
  // timeline, not gated (HEAD's first reading "moved" only by reopening after the delay).
  await page.evaluate(TIMELINE);
  const p0 = await top(panel), t0 = await top(term);
  await page.evaluate(`window.scrollBy(0, 120)`);
  await page.waitForTimeout(250);
  const p1 = await top(panel), t1 = await top(term);
  const tl120 = await tlRead();
  // (2) hovered, a 5px scroll that keeps the pointer on the trigger: the follow, by hover
  await page.mouse.move(5, 5);
  await page.evaluate(`window.scrollTo(0, 0)`);
  await page.waitForTimeout(200);
  await hoverOpen();
  const h = (await term.boundingBox())!;
  await page.evaluate(TIMELINE);
  const sp0 = await top(panel), st0 = await top(term);
  await page.evaluate(`window.scrollBy(0, 5)`);
  await page.waitForTimeout(250);
  const sp1 = await top(panel), st1 = await top(term);
  const tl5 = await tlRead();
  // Escape, as before
  await page.keyboard.press("Escape");
  await page.waitForTimeout(120);
  const afterEsc = await panel.count();
  // (3) by focus (no pointer): the follow through 120px, then the trigger out of sight
  await page.mouse.move(5, 5);
  await page.evaluate(`window.scrollTo(0, 0)`);
  await page.waitForTimeout(150);
  await term.focus();
  await page.waitForTimeout(100);
  await page.evaluate(TIMELINE);
  const fp0 = await top(panel), ft0 = await top(term);
  await page.evaluate(`window.scrollBy(0, 120)`);
  await page.waitForTimeout(250);
  const fp1 = await top(panel), ft1 = await top(term);
  const tlF = await tlRead();
  await page.evaluate(`window.scrollBy(0, Math.round(document.querySelectorAll('.tooltip-term')[${pick.i}].getBoundingClientRect().bottom) + 40)`);
  await page.waitForTimeout(250);
  const tOut = (await term.boundingBox())?.y ?? null;
  const outOfSight = await panel.count();
  const r = { label, pick, triggerHeight: h.height, at250, at650, hover120: { p0, t0, p1, t1, timeline: tl120 }, hover5: { sp0, st0, sp1, st1, timeline: tl5 }, afterEsc, focus: { fp0, ft0, fp1, ft1, timeline: tlF, tOut, outOfSight }, errors };
  out.legD = r;
  say(`    term "${label}" (#${pick.i} of ${pick.n}, ${h.height}px tall; doc ${pick.doc}px) · 250ms ${at250} · 650ms ${at650}`);
  say(`    (1) hover, 120px under a still pointer: trigger ${t0}→${t1}, panel ${p0}→${p1}, timeline ${JSON.stringify(tl120)}`);
  say(`    (2) hover, 5px: trigger ${st0}→${st1}, panel ${sp0}→${sp1}, timeline ${JSON.stringify(tl5)} · Escape → ${afterEsc}`);
  say(`    (3) focus, 120px: trigger ${ft0}→${ft1}, panel ${fp0}→${fp1}, timeline ${JSON.stringify(tlF)} · trigger out at ${tOut} → panels ${outOfSight}`);
  const moved = (a: number | null, b2: number | null) => (a == null || b2 == null ? null : b2 - a);
  const d5 = moved(sp0, sp1), d5T = moved(st0, st1), dF = moved(fp0, fp1), dFT = moved(ft0, ft1);
  if (mode === "head") {
    check("D", "red, by hover: through a 5px scroll HEAD's panel stays where it was while its trigger moves", d5 === 0 && d5T != null && Math.abs(d5T) >= 4 && tl5.length === 0, `trigger ${d5T}px · panel ${d5}px · timeline ${JSON.stringify(tl5)}`);
    check("D", "red, by focus: HEAD leaves the panel where it was through a 120px scroll, and open with its trigger out of sight", dF === 0 && outOfSight === 1, `trigger ${dFT}px · panel ${dF}px · out of sight → ${outOfSight}`);
  } else {
    check("D", "the delay: closed at 250ms, open by 650ms (as before)", at250 === 0 && at650 === 1, `250ms ${at250} · 650ms ${at650}`);
    check("D", "by hover: through a 5px scroll the panel's top moves with the trigger to within 2px, open throughout", d5 != null && d5T != null && Math.abs(d5T) >= 4 && Math.abs(d5 - d5T) <= 2 && tl5.length === 0, `trigger ${d5T}px · panel ${d5}px · timeline ${JSON.stringify(tl5)}`);
    check("D", "Escape closes it (as before)", afterEsc === 0, `${afterEsc}`);
    check("D", "by focus: through a 120px scroll the panel's top moves with the trigger to within 2px, open throughout", dF != null && dFT != null && Math.abs(dFT) >= 100 && Math.abs(dF - dFT) <= 2 && tlF.length === 0, `trigger ${dFT}px · panel ${dF}px · timeline ${JSON.stringify(tlF)}`);
    check("D", "the trigger scrolled out of sight: the panel is gone", (tOut ?? 0) < 0 && outOfSight === 0, `trigger top ${tOut} · panels ${outOfSight}`);
    check("D", "no page error", errors.length === 0, errors.slice(0, 2).join(" | ") || "none");
  }
  await ctx.close();
}

// ── leg E: the MOVED guard ───────────────────────────────────────────────────
const DAY = 86_400_000;
const iso = (s: string) => new Date(s).toISOString();
function syncRun(startedAt: string, legs: { house?: number; senate?: number }, status = "success"): SyncRunRow {
  const leg = (n: number | undefined) => (n == null ? undefined : { ok: n > 0, stats: { scraped: n } });
  const payload = status === "success" ? { ok: true, elapsedMs: 1, payload: { chambers: { house: leg(legs.house), senate: leg(legs.senate) } } } : { ok: false, elapsedMs: 1, error: "planted", status };
  return { startedAt: iso(startedAt), status, payload: JSON.stringify(payload) };
}
const oldRun = (startedAt: string, scraped: number): SyncRunRow => ({ startedAt: iso(startedAt), status: "success", payload: JSON.stringify({ ok: true, elapsedMs: 1, payload: { stats: { scraped } } }) });
function ticks(from: string, to: string, fail: string[] = [], gap: [string, string] | null = null): HistoryRunRow[] {
  const out: HistoryRunRow[] = [];
  for (let t = Date.parse(`${from}T15:00:00Z`); t <= Date.parse(`${to}T15:00:00Z`); t += DAY) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (gap && d >= gap[0] && d <= gap[1]) continue;
    out.push({ startedAt: new Date(t).toISOString(), status: fail.includes(d) ? "error" : "success" });
  }
  return out;
}
const weekly = (from: string, to: string, legs: { house?: number; senate?: number }) => {
  const out: SyncRunRow[] = [];
  for (let t = Date.parse(`${from}T11:00:00Z`); t <= Date.parse(`${to}T11:00:00Z`); t += 7 * DAY) out.push(syncRun(new Date(t).toISOString(), legs));
  return out;
};
const horizonsOf = (sync: SyncRunRow[], hist: HistoryRunRow[]): GuardHorizons => ({
  sync: sync.map((r) => r.startedAt).sort()[0] ?? null,
  history: hist.map((r) => r.startedAt).sort()[0] ?? null,
});
// Two independent readings of the rules the ruling set aside, so a planted case can be seen to bite:
// § 5 as written (S the latest leg-ok run before the end of T, S' the one before it) and STEP 0's
// 24-hour floor (S' the latest leg-ok run 24h or more before S).
function rejected(T: string, c: MoveChamber, sync: SyncRunRow[], hist: HistoryRunRow[], floorH: number): boolean {
  const t0 = Date.parse(`${T}T00:00:00Z`);
  const hs = hist.filter((h) => h.status === "success").map((h) => Date.parse(h.startedAt)).filter((t) => t < t0 && t >= t0 - 8 * DAY);
  if (!hs.length) return false;
  const ok = sync.filter((r) => syncLegOk(r, c)).map((r) => Date.parse(r.startedAt)).filter((t) => t < t0 + DAY).sort((a, b) => b - a);
  const s = ok[0];
  const sp = s == null ? undefined : ok.find((t) => t < s && t <= s - floorH * 3_600_000);
  return s != null && sp != null && s - sp <= 8 * DAY;
}
function legEPlanted(out: Record<string, unknown>) {
  say(`\n── leg E, isFreshMove against planted runs (the ruling's rule; each case also read under § 5 as written and the 24h floor)`);
  const days = ticks("2026-08-01", "2026-09-30");
  type Case = { name: string; T: string; c: MoveChamber; sync: SyncRunRow[]; hist: HistoryRunRow[]; expect: boolean };
  const both = { house: 200, senate: 30 };
  const cases: Case[] = [
    { name: "weekly runs (the control)", T: "2026-09-16", c: "house", sync: weekly("2026-08-05", "2026-09-30", both), hist: days, expect: true },
    { name: "a 20-day gap, then a batch", T: "2026-09-15", c: "house", sync: [...weekly("2026-08-05", "2026-08-26", both), syncRun("2026-09-15T11:00:00Z", both)], hist: days, expect: false },
    { name: "a first Senate leg", T: "2026-09-16", c: "senate", sync: [...["2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26", "2026-09-02", "2026-09-09"].map((d) => oldRun(`${d}T11:00:00Z`, 200)), syncRun("2026-09-16T11:00:00Z", both)], hist: days, expect: false },
    { name: "the same runs, the House move (the first Senate leg's control)", T: "2026-09-16", c: "house", sync: [...["2026-08-05", "2026-08-12", "2026-08-19", "2026-08-26", "2026-09-02", "2026-09-09"].map((d) => oldRun(`${d}T11:00:00Z`, 200)), syncRun("2026-09-16T11:00:00Z", both)], hist: days, expect: true },
    { name: "a 10-day history gap", T: "2026-09-16", c: "house", sync: weekly("2026-08-05", "2026-09-30", both), hist: ticks("2026-08-01", "2026-09-30", [], ["2026-09-06", "2026-09-15"]), expect: false },
    { name: "an error run as the only one before", T: "2026-09-16", c: "house", sync: [syncRun("2026-09-09T11:00:00Z", both, "error"), syncRun("2026-09-16T11:00:00Z", both)], hist: days, expect: false },
    { name: "a move before the horizon", T: "2026-07-20", c: "house", sync: weekly("2026-08-05", "2026-09-30", both), hist: days, expect: true },
    { name: "a re-run 68 minutes after a post-gap run (the ruling's first)", T: "2026-09-20", c: "house", sync: [...weekly("2026-08-05", "2026-08-26", both), syncRun("2026-09-19T23:35:00Z", both), syncRun("2026-09-20T00:43:00Z", both)], hist: days, expect: false },
    { name: "a re-run 30 hours after a post-gap run, the history tick between them failing (the ruling's second)", T: "2026-09-20", c: "house", sync: [...weekly("2026-08-05", "2026-08-26", both), syncRun("2026-09-18T20:00:00Z", both), syncRun("2026-09-20T02:00:00Z", both)], hist: ticks("2026-08-01", "2026-09-30", ["2026-09-19"]), expect: false },
  ];
  const rows: string[] = [];
  for (const k of cases) {
    const got = isFreshMove(k.T, k.c, k.sync, k.hist, horizonsOf(k.sync, k.hist));
    const asWritten = rejected(k.T, k.c, k.sync, k.hist, 0);
    const floor24 = rejected(k.T, k.c, k.sync, k.hist, 24);
    rows.push(`${k.name}: ${got ? "fresh" : "not fresh"} (§ 5 as written ${asWritten ? "fresh" : "not fresh"} · 24h floor ${floor24 ? "fresh" : "not fresh"})`);
    check("E", k.name, got === k.expect, `${got ? "fresh" : "not fresh"}, expected ${k.expect ? "fresh" : "not fresh"} · § 5 as written reads ${asWritten ? "fresh" : "not fresh"} · the 24h floor reads ${floor24 ? "fresh" : "not fresh"}`);
  }
  out.legEPlanted = rows;
}
async function legEProd(out: Record<string, unknown>) {
  say(`\n── leg E, M1 again through the built reader, against prod (SELECT only)`);
  const db = prodClient();
  const read = reader(db);
  const ids = (await read(`SELECT r.id FROM races r WHERE r.cycle = 2026 AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = r.cycle) ORDER BY r.id`)).rows.map((r) => String(r.id));
  const moved = new Set((await read(`SELECT DISTINCT race_id FROM (SELECT race_id, observed_at, MIN(observed_at) OVER (PARTITION BY race_id, source) AS base FROM rating_history) WHERE observed_at > base`)).rows.map((r) => String(r.race_id)));
  const got = await readRecentRaceMoves(db, ids);
  const by: Record<string, number> = {};
  for (const m of Object.values(got)) by[m.date] = (by[m.date] ?? 0) + 1;
  const ratedMoved = ids.filter((id) => moved.has(id)).length;
  const dist = `${Object.entries(by).sort().map(([d, n]) => `${d} ${n}`).join(" · ")} · none ${ratedMoved - Object.keys(got).length}`;
  check("E", "the built reader's newest passing move per rated race equals STEP 0's independent re-read under the ruling", dist === M1_EXPECTED, `"${dist}"`);
  // The four batches, through isFreshMove on prod's own runs.
  const sync: SyncRunRow[] = (await read(`SELECT started_at, status, payload FROM cron_runs WHERE route = ? ORDER BY started_at, id`, [SYNC_ROUTE])).rows.map((r) => ({ startedAt: String(r.started_at), status: String(r.status), payload: r.payload == null ? null : String(r.payload) }));
  const hist: HistoryRunRow[] = (await read(`SELECT started_at, status FROM cron_runs WHERE route = ? AND status = 'success' ORDER BY started_at, id`, [HIST_ROUTE])).rows.map((r) => ({ startedAt: String(r.started_at), status: String(r.status) }));
  const first = (await read(`SELECT route, MIN(started_at) AS f FROM cron_runs WHERE route IN (?, ?) GROUP BY route`, [SYNC_ROUTE, HIST_ROUTE])).rows;
  const hz: GuardHorizons = { sync: String(first.find((r) => r.route === SYNC_ROUTE)?.f ?? "") || null, history: String(first.find((r) => r.route === HIST_ROUTE)?.f ?? "") || null };
  const table: [string, MoveChamber, boolean][] = [["2026-09-21", "house", false], ["2026-09-23", "house", true], ["2026-09-24", "senate", false], ["2026-09-30", "house", true], ["2026-09-30", "senate", true]];
  const read4 = table.map(([T, c, want]) => ({ T, c, want, got: isFreshMove(T, c, sync, hist, hz) }));
  check("E", "M1's four batches read as the ruling's table (09-21 House and 09-24 Senate not fresh; 09-23 House and 09-30 fresh)", read4.every((x) => x.got === x.want), read4.map((x) => `${x.T} ${x.c} ${x.got ? "fresh" : "not fresh"}`).join(" · "));
  // After the 10-07 failure: the next leg-ok run's moves read not fresh (the ruling's note), measured on today's runs.
  const nextT = new Date(Date.now() + DAY).toISOString().slice(0, 10);
  out.legEProd = { dist, read4, lastSync: sync.at(-1), nextT, nextIfRunNow: isFreshMove(nextT, "house", [...sync, syncRun(new Date().toISOString(), { house: 218, senate: 30 })], hist, hz) };
  say(`    the newest sync row: ${JSON.stringify(sync.at(-1)?.startedAt)} ${sync.at(-1)?.status} · a leg-ok run now would log moves on ${nextT} that read ${(out.legEProd as { nextIfRunNow: boolean }).nextIfRunNow ? "fresh" : "not fresh"} (S' is #21278, 09-30)`);
  db.close();
}
async function movedRows(browser: Browser, base: string): Promise<string[]> {
  const { ctx, page } = await newPage(browser, base, 1440, 1000);
  await page.goto(`${base}/electoral`, { waitUntil: "networkidle" });
  const all: string[] = [];
  for (const tab of ["SENATE", "HOUSE"]) {
    await page.locator(".rl-tab", { hasText: tab }).click();
    await page.waitForTimeout(200);
    all.push(...((await page.evaluate(READ_MOVED)) as string[]));
  }
  await ctx.close();
  return all.sort();
}
async function dashboardMoved(browser: Browser, base: string): Promise<string[]> {
  const { ctx, page } = await newPage(browser, base, 1440, 1000);
  await page.goto(`${base}/`, { waitUntil: "networkidle" });
  await page.locator("button.dv2-racesbox-tab", { hasText: "Races" }).first().click();
  await page.waitForTimeout(600);
  const cards = (await page.evaluate(READ_CARDS)) as string[];
  await ctx.close();
  return cards;
}

// ── leg F: the tracker's House tab, written to the pre copy ──────────────────
async function cardText(page: Page, chip: ReturnType<Page["locator"]>) {
  await chip.click();
  await page.waitForTimeout(250);
  const t = norm(await page.locator(".grade-card").innerText().catch(() => ""));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  return t;
}
async function readF(browser: Browser, base: string) {
  const { ctx, page, errors } = await newPage(browser, base, 1440, 1000);
  await page.goto(`${base}/electoral`, { waitUntil: "networkidle" });
  await openRow(page, "S-NH-2026");
  const nh = (await page.evaluate(READ_OPEN)) as OpenReading | null;
  const pappasChip = page.locator('li[data-race="S-NH-2026"] .rl-mem [data-grade-chip]').first();
  const pappasCard = (await pappasChip.count()) ? await cardText(page, pappasChip) : null;
  const shaheenCard = await cardText(page, page.locator('li[data-race="S-NH-2026"] .rl-sh [data-grade-chip]').first());
  await openRow(page, "S-GA-2026");
  const ga = (await page.evaluate(READ_OPEN)) as OpenReading | null;
  await page.goto(`${base}/members/P000614`, { waitUntil: "networkidle" });
  const sc = (await page.evaluate(`(() => { const p = document.getElementById('rec-panel-scorecard'); if (!p) return null; const rows = p.querySelectorAll('.flex.flex-col.gap-1 > div').length; return { rows, text: p.textContent.split(String.fromCharCode(10)).join(' ') }; })()`)) as { rows: number; text: string } | null;
  const tab = await page.locator('[role="tab"]', { hasText: "Scorecard" }).count();
  await ctx.close();
  return { nh, pappasCard, shaheenCard, ga, scorecard: sc ? { rows: sc.rows, rank: (sc.text.match(/Rank #\d+( of \d+)?/) ?? [null])[0] } : null, tab, errors };
}
async function legF(browser: Browser, out: Record<string, unknown>) {
  say(`\n── leg F, the tracker's House tab on the pre copy: before, \`sync:palestine --write\` against it, after`);
  let srv = await startServer(process.cwd(), { copy: "pre", clock: null });
  let before: Awaited<ReturnType<typeof readF>>;
  try { before = await readF(browser, srv.base); } finally { await srv.kill(); }
  const w = spawnSync(NODE, [TSX, "scripts/sync-palestine.ts", "--write"], { env: childEnv(copyUrl(copyPath("pre")), null), encoding: "utf8" });
  const wout = redactSecrets(`${w.stdout}${w.stderr}`);
  writeFileSync(path.join(ART, `legF-write-pre-copy-${LABEL}.txt`), wout);
  const pools = /pools \(dashboard_state palestine_tracker_pools\): (\{.*\})/.exec(wout)?.[1];
  const houseGraded = pools ? (JSON.parse(pools) as { house: { graded: number } }).house.graded : NaN;
  say(`    --write against the pre copy: exit ${w.status} · ${wout.split("\n").filter((l) => /^(wrote|read back|  matched|  graded|  unmatched)/.test(l)).join(" | ")}`);
  check("F", "sync:palestine --write ran against the pre copy (exit 0, both tabs written, its pools read back)", w.status === 0 && /wrote house: 210 rows affected/.test(wout) && /wrote senate: 47 rows affected/.test(wout) && Number.isFinite(houseGraded), `exit ${w.status} · House graded ${houseGraded}`);
  srv = await startServer(process.cwd(), { copy: "pre", clock: null });
  let after: Awaited<ReturnType<typeof readF>>;
  try { after = await readF(browser, srv.base); } finally { await srv.kill(); }
  out.legF = { before, after, houseGraded };
  const pappas = (r: typeof before) => r.nh?.members.find((m) => m.href === "/members/P000614");
  const collins = (r: typeof before) => r.ga?.members.find((m) => m.href === "/members/C001129");
  say(`    before: Pappas chips ${pappas(before)?.chips} · Shaheen "${before.shaheenCard}" · scorecard tab ${before.tab}`);
  say(`    after:  Pappas chips ${pappas(after)?.chips} "${after.pappasCard}" · Shaheen "${after.shaheenCard}" · Collins chips ${collins(after)?.chips} · scorecard ${JSON.stringify(after.scorecard)}`);
  check("F", "red: before the write Pappas has no chip on NH SEN and no Scorecard tab", pappas(before)?.chips === 0 && before.tab === 0, `chips ${pappas(before)?.chips} · tab ${before.tab}`);
  check("F", `Pappas's member row on NH SEN carries a chip, and its card reads "of ${houseGraded} House Democrats"`, pappas(after)?.chips === 1 && (after.pappasCard ?? "").includes(`of ${houseGraded} House Democrats`), `chips ${pappas(after)?.chips} · "${after.pappasCard}"`);
  check("F", `Pappas's member page shows the Scorecard tab with 64 votes and "Rank #N of ${houseGraded}"`, after.tab === 1 && after.scorecard?.rows === 64 && new RegExp(`^Rank #\\d+ of ${houseGraded}$`).test(after.scorecard?.rank ?? ""), JSON.stringify(after.scorecard));
  check("F", "a House Republican has no chip (Collins on GA SEN, the control)", !!collins(after) && collins(after)!.chips === 0, `Collins chips ${collins(after)?.chips}`);
  const grade = (t: string | null) => (t ?? "").match(/#\d+ of \d+ Senate Democrats/)?.[0] ?? null;
  check("F", "Shaheen's chip reads as before, refreshed (the control): the same grade line, as of the write's month", grade(after.shaheenCard) != null && grade(after.shaheenCard) === grade(before.shaheenCard) && /as of May 2026/i.test(before.shaheenCard ?? "") && /as of Oct 2026/i.test(after.shaheenCard ?? ""), `before "${before.shaheenCard}" · after "${after.shaheenCard}"`);
  check("F", "no page error", before.errors.length === 0 && after.errors.length === 0, [...before.errors, ...after.errors].slice(0, 2).join(" | ") || "none");
}

// ── the phases ───────────────────────────────────────────────────────────────
async function phaseRun() {
  const phase = argAt("--phase");
  if (phase !== "head" && phase !== "tree") throw new Error("--phase head|tree");
  const dir = phase === "head" ? path.resolve(argAt("--dir") ?? "") : process.cwd();
  if (!existsSync(path.join(dir, ".next/BUILD_ID"))) throw new Error(`no build at ${dir}`);
  const headSha = execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  say(`\n── phase ${phase} · ${path.relative(process.cwd(), dir) || "the tree"} at ${headSha} · build ${readFileSync(path.join(dir, ".next/BUILD_ID"), "utf8").trim()} · node ${NODE}`);
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const out: Record<string, unknown> = { sha: headSha };
  const head = phase === "tree" ? (JSON.parse(readFileSync(path.join(ART, `phase-head-${LABEL}.json`), "utf8")) as Record<string, unknown>) : null;
  try {
    if (phase === "tree") {
      legAUnit();
      legEPlanted(out);
      await legEProd(out);
    }
    {
      const srv = await startServer(dir, { copy: "marks", clock: NOV4 });
      try { await legA(browser, srv.base, out, phase); } finally { await srv.kill(); }
    }
    {
      const srv = await startServer(dir, { copy: "today", clock: null });
      try {
        if (phase === "tree") await legAToday(browser, srv.base, out);
        await legC(browser, srv.base, out, phase);
        out.moved = await movedRows(browser, srv.base);
        say(`\n── leg E (${phase}), /electoral's MOVED rows on the today copy: ${(out.moved as string[]).length} · ${(out.moved as string[]).join(" · ")}`);
        if (head) {
          const was = (head.moved as string[]) ?? [];
          const now = out.moved as string[];
          const gone = was.filter((x) => !now.includes(x)), added = now.filter((x) => !was.includes(x));
          check("E", "/electoral's MOVED rows, 8752512 against the tree on the same copy: any row that changes is the guard's", gone.length === 0 && added.length === 0, `8752512 ${was.length} · tree ${now.length} · gone ${JSON.stringify(gone)} · new ${JSON.stringify(added)} (the 14-day window holds only 09-30's batch, which passes)`);
        }
      } finally { await srv.kill(); }
    }
    if (phase === "tree") await legF(browser, out);
    {
      const srv = await startServer(dir, { prod: true });
      try {
        await legB(browser, srv.base, out, phase, (head?.legB as Record<string, BandReading>) ?? undefined);
        await legD(browser, srv.base, out, phase);
        if (phase === "tree") {
          // The House tab's close: the review build reading prod's own rows after HO 768's write. The
          // pool is the pools key's 212 (graded as read), where the table holds 210 matched rows.
          say(`\n── leg F, the review build on prod's data (after HO 768's write)`);
          const t = await readF(browser, srv.base);
          out.prodTracker = t;
          const p = t.nh?.members.find((m) => m.href === "/members/P000614");
          check("F", "the review build on prod's data: Pappas's NH SEN chip reads of 212 House Democrats; his member page, 64 votes and Rank #N of 212", p?.chips === 1 && (t.pappasCard ?? "").includes("of 212 House Democrats") && t.scorecard?.rows === 64 && /^Rank #\d+ of 212$/.test(t.scorecard?.rank ?? ""), `chips ${p?.chips} · "${t.pappasCard}" · ${JSON.stringify(t.scorecard)}`);
        }
        out.cards = await dashboardMoved(browser, srv.base);
        say(`\n── leg E (${phase}), the dashboard's featured cards' MOVED on prod's data: ${(out.cards as string[]).join(" · ")}`);
        if (head) {
          const was = (head.cards as string[]) ?? [];
          const now = out.cards as string[];
          const diff = now.map((x, i) => (x !== was[i] ? `${was[i] ?? "(no card)"} → ${x}` : null)).filter((x): x is string => x != null);
          say(`    REPORT, 8752512 → tree: ${diff.length ? diff.join(" · ") : "no card changed"} (each change is a featured seat whose newest move fails the guard: it shows an older move that passes, or none)`);
          out.cardsDiff = diff;
        }
      } finally { await srv.kill(); }
    }
  } finally {
    await browser.close();
  }
  writeFileSync(path.join(ART, `phase-${phase}-${LABEL}.json`), JSON.stringify(out, null, 1));
  await prodUntouched(phase, fp0, t0);
}

async function main() {
  if (process.argv.includes("--seed")) await seed();
  if (argAt("--phase")) await phaseRun();
  say(`\n${passes} PASS · ${fails} FAIL`);
  process.exitCode = fails ? 1 : 0;
}
main().catch((e) => {
  const cause = (e as { cause?: unknown }).cause;
  say(`ERROR ${(e as Error).stack ?? e}${cause ? `\n  cause: ${cause instanceof Error ? cause.stack ?? cause.message : JSON.stringify(cause)}` : ""}`);
  process.exitCode = 1;
});
