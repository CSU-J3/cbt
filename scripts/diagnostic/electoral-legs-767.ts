// HO 767 legs: /electoral in the general window (mock-767 v18, ruled "as set"), on `file:` copies
// seeded from prod, the day after planted by hand (no prod row is marked) with the clock at Nov 4.
//
//   npx tsx scripts/diagnostic/electoral-legs-767.ts --seed --label L
//   npx tsx scripts/diagnostic/electoral-legs-767.ts --phase before --label L --dir <HEAD worktree> [--node <node.exe>]
//   npx tsx scripts/diagnostic/electoral-legs-767.ts --phase after  --label L [--node <node.exe>]
//
// Two copies of one seed:
//   today  as seeded: the page before election day (legs 1, 2, 4, 5)
//   marks  general-ballot marks planted (leg 3): S-NH Pappas (D HOLD, a member elected to the
//          Senate), S-IA Turek (D GAIN, Hinson lost the Senate race), S-ME Susan Collins (R HOLD,
//          re-elected), S-OH Brown (D GAIN, Husted defeated), S-GA Ossoff + Mike Collins (a
//          runoff), S-NE Osborn (a winner the row's majors don't name: I GAIN, Ricketts defeated),
//          FL-25 Moskowitz (D HOLD, elected in FL-25), TX-23 its first R (R WIN, no stored
//          incumbent), S-AK nothing (NO CALL)
// `--phase before` runs HEAD's build (a worktree at 468e692, `--dir`): MAP's markup and captures
// for leg 1's side-by-side, and leg 3's red (the marks copy at Nov 4 shows none of the day after).
// `--phase after` runs the tree's build: legs 1-5 and the captures (1920, 1440, 1100, 430, and a
// reduced-motion pass at 1440), reading HEAD's readings back for leg 1's MAP equality.
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed and a fingerprint before and after
// every mode. Copies are `file:${abs}` from paths ending -767-legs.db; children get that URL with
// TURSO_AUTH_TOKEN="" (not deleted: dotenv and Next's loader refill a missing key). Every server
// is transport-checked: its copy's own cron_runs sentinel must come back on /api/health. Every
// printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/767-artifacts"); // repo-ignored
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const PORT = 3767;
const BASE = `http://127.0.0.1:${PORT}`;
const NOV4 = "2026-11-04T15:00:00.000Z"; // 8am MT the morning after
const SENTINEL_ROUTE = "/api/cron/race-challengers";
// Read whole: every table /electoral, the race pages and the member pages read for the legs.
const WHOLE = [
  "races", "members", "member_ids", "race_ratings", "rating_history", "race_candidates", "kalshi_odds", "polymarket_odds",
  "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads",
  "palestine_scorecard", "member_ideology", "member_participation", "member_career_votes", "votes", "observations",
  "observation_entities", "dashboard_state",
];
const WIDTHS = [1920, 1440, 1100, 430] as const;
const OPEN = ["S-NH-2026", "S-GA-2026", "FL-25-2026", "S-MI-2026", "S-MN-2026"];
const LEG5 = ["S-NH-2026", "S-GA-2026", "FL-25-2026", "S-MN-2026"];
const NO_FEC = ["G000600", "G000608", "H001091", "L000596", "L000598"]; // STEP 0's five, re-read below
// The day after, planted. `name` is matched against the race's printed rows (on_ballot = 1).
const PLANT: { race: string; mark: string[]; expect: { chip: string; checked?: string; open: Record<string, string>; roles?: Record<string, string> } }[] = [
  { race: "S-NH-2026", mark: ["Pappas"], expect: { chip: "D HOLD", checked: "Pappas", open: { "Chris Pappas": "Elected" }, roles: { P000614: "elected to the Senate" } } },
  { race: "S-IA-2026", mark: ["Turek"], expect: { chip: "D GAIN", checked: "Turek", open: { "Josh Turek": "Elected" }, roles: { H001091: "lost the Senate race" } } },
  { race: "S-ME-2026", mark: ["Susan"], expect: { chip: "R HOLD", checked: "S. Collins", open: { "Susan Collins": "re-elected" }, roles: { C001035: "re-elected" } } },
  { race: "S-OH-2026", mark: ["Brown"], expect: { chip: "D GAIN", checked: "Brown", open: { "Sherrod Brown": "Elected", "Jon Husted": "defeated" }, roles: { H001104: "defeated" } } },
  { race: "S-GA-2026", mark: ["Ossoff", "Collins"], expect: { chip: "RUNOFF", open: { "Jon Ossoff": "runoff", "Mike Collins": "runoff" }, roles: { O000174: "in the runoff", C001129: "in the Senate runoff" } } },
  { race: "S-NE-2026", mark: ["Osborn"], expect: { chip: "I GAIN", checked: "Osborn", open: { "Dan Osborn": "Elected", "Pete Ricketts": "defeated" }, roles: { R000618: "defeated" } } },
  { race: "FL-25-2026", mark: ["Moskowitz"], expect: { chip: "D HOLD", checked: "Moskowitz", open: { "Jared Evan Moskowitz": "Elected" }, roles: { M001217: "elected in FL-25" } } },
  { race: "TX-23-2026", mark: ["__first_R__"], expect: { chip: "R WIN", open: {} } },
  { race: "S-AK-2026", mark: [], expect: { chip: "NO CALL", open: {}, roles: { S001198: "not yet called" } } },
];

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
// --legs 1,4 runs only those legs of phase after (an iteration aid; the paste reads a full run)
const LEGS = (argAt("--legs") ?? "1,2,3,4,5,7").split(",").map(Number);
const runs = (leg: number) => LEGS.includes(leg);
const NODE = argAt("--node") ?? process.execPath;
const say = (s: string) => console.log(redactSecrets(s));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let fails = 0, passes = 0;
const check = (leg: string, label: string, ok: boolean, detail: string) => {
  say(`  ${ok ? "PASS" : "FAIL"}  [leg ${leg}] ${label}: ${detail}`);
  if (ok) passes++; else fails++;
};
const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);
// MAP's markup, compared across two builds. HEAD's is webpack (a Turbopack build cannot take the
// worktree's node_modules junction) and the tree's Turbopack, and the geometry is d3-geo arithmetic
// at request time: the two compile it differently and the coordinates part in the 12th decimal
// (700.7386861292633 / 700.7386861292831). And HEAD server-renders the map where the tree mounts
// it on the MAP click, so a style attribute reads "cursor:pointer" in one and "cursor: pointer;"
// in the other. Neither is a change to the map; everything else must match byte for byte.
const normMap = (html: string) =>
  html.replace(/-?[0-9]+[.][0-9]+/g, (m) => Number(m).toFixed(2)).replace(/style="([^"]*)"/g, (_m, v: string) => `style="${v.split(" ").join("").replace(/;$/, "")}"`);

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
// The tables the seed reads, by row count and content hash, and the schema: the legs write file:
// copies only, so a difference can only be a prod cron's own write inside the window.
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
  if (changed.length === 0) { check("*", `prod untouched (${label})`, true, "fingerprints equal"); return; }
  const db = prodClient();
  const runs = (await reader(db)(`SELECT id, route, started_at FROM cron_runs WHERE started_at >= ? ORDER BY id`, [t0])).rows.map((r) => `${r.route}#${r.id}`);
  db.close();
  const cronOwned = new Set(["race_candidates", "general_ballot", "general_ballot_reads", "primary_candidates", "member_fundraising"]);
  const unexplained = changed.filter((k) => !cronOwned.has(k) || runs.length === 0);
  check("*", `prod untouched (${label}): every difference is a prod cron's own run in the window`, unexplained.length === 0, `changed ${changed.join(", ")} · runs ${runs.join("; ") || "none"}${unexplained.length ? ` · UNEXPLAINED ${unexplained.join(", ")}` : ""}`);
}

// ── copies ──────────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-767-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-767-legs.db")) throw new Error(`refused: a copy must be a *-767-legs.db file (got ${abs})`);
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
const sentinelAt = (kind: string) => readFileSync(path.join(DIR, `sentinel-${kind}-${LABEL}-767.txt`), "utf8").trim();

// Paged by rowid (a whole observations or member_votes read in one response resets the
// connection, ECONNRESET at the first seed), each page written as it arrives.
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
  // The members the page's member read covers: everyone on a rated ballot by identity, every
  // rated seat's stored incumbent. Their bills and 119th votes are the heavy tables, cut to them.
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
    counts.push(`cron_runs ${await copyRows(read, db, "cron_runs", `WHERE id > (SELECT MAX(id) FROM cron_runs) - 400`)} (the newest 400)`);
  });
  prod.close();
  say(`template: the real scripts/migrate.ts against file:, seeded from prod · ${counts.join(" · ")}`);
  for (const kind of ["today", "marks"] as const) {
    const abs = copyPath(kind);
    copyFileSync(tpl, abs);
    const at = new Date(Date.now() + (kind === "today" ? 1 : 2)).toISOString();
    writeFileSync(path.join(DIR, `sentinel-${kind}-${LABEL}-767.txt`), at);
    await withDb(copyUrl(abs), (db) => db.execute({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 767, 'success', ?)`, args: [SENTINEL_ROUTE, at, at, JSON.stringify({ sentinel: `HO 767 legs, the ${kind} copy only` })] }));
    if (kind === "marks") {
      const planted: string[] = [];
      await withDb(copyUrl(abs), async (db) => {
        for (const p of PLANT) for (const m of p.mark) {
          const rows = (await db.execute({ sql: `SELECT person_key, name, party FROM general_ballot WHERE race_id = ? AND on_ballot = 1 AND write_in = 0`, args: [p.race] })).rows;
          const hit = m === "__first_R__" ? rows.filter((r) => r.party === "R").slice(0, 1) : rows.filter((r) => String(r.name).includes(m));
          if (hit.length !== 1) throw new Error(`plant ${p.race} ${m}: ${hit.length} printed rows match (${rows.map((r) => r.name).join(", ")})`);
          await db.execute({ sql: `UPDATE general_ballot SET marked = 1 WHERE race_id = ? AND person_key = ?`, args: [p.race, String(hit[0]!.person_key)] });
          planted.push(`${p.race} ${hit[0]!.name} (${hit[0]!.party})`);
        }
      });
      writeFileSync(path.join(ART, `planted-${LABEL}.json`), JSON.stringify({ planted, plan: PLANT }, null, 1));
      say(`  marks planted: ${planted.join(" · ")}`);
    }
    say(`copy ${path.basename(abs)} · sentinel ${at}`);
  }
  await prodUntouched("the seed", fp0, t0);
}

// ── servers ─────────────────────────────────────────────────────────────────
function listeningPids(): number[] {
  try {
    const out = execFileSync("netstat", ["-ano"], { encoding: "utf8" });
    return out.split(/\r?\n/).filter((l) => l.includes(`:${PORT} `) && /LISTENING/.test(l)).map((l) => Number(l.trim().split(/\s+/).pop()));
  } catch { return []; }
}
async function startServer(dir: string, kind: "today" | "marks", clock: string | null) {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  const cache = path.join(dir, ".next/cache/fetch-cache");
  rmSync(cache, { recursive: true, force: true });
  const log = path.join(DIR, `server767-${kind}-${LABEL}-${Date.now()}.log`);
  const out = createWriteStream(log);
  const server = spawn(NODE, [path.join(dir, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], { cwd: dir, env: childEnv(copyUrl(copyPath(kind)), clock), stdio: ["ignore", "pipe", "pipe"] });
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
  const mine = h.routes?.find((r) => r.path === SENTINEL_ROUTE);
  if (mine?.lastRunAt !== sentinelAt(kind)) { await kill(); throw new Error(`transport check failed: lastRunAt ${String(mine?.lastRunAt)} is not the ${kind} copy's sentinel`); }
  say(`  server :${PORT} (pid ${server.pid}, ${path.relative(process.cwd(), dir) || "the tree"}) · ${kind} copy (own sentinel) · clock ${clock ?? "real"} · fetch-cache cleared`);
  return { kill };
}

// Page scripts are strings (tsx's keepNames wrapper), with no regex escapes (HO 736).
const NORM = `const norm = (s) => (s || '').split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ');`;
const READ_ROWS = `(() => { ${NORM}
  return Array.from(document.querySelectorAll('li.race-list-item')).map((li) => {
    const row = li.querySelector('.race-list-row');
    const chip = row.querySelector('.rl-chipcell .race-list-chip');
    const moved = row.querySelector('[data-moved]');
    return {
      id: li.getAttribute('data-race'),
      who: norm(row.querySelector('.race-list-cand').textContent),
      chip: chip ? norm(chip.textContent) : null,
      result: chip ? chip.getAttribute('data-result') : null,
      checked: Array.from(row.querySelectorAll('.rl-wn .rl-nm')).map((n) => norm(n.textContent)),
      dim: Array.from(row.querySelectorAll('.rl-nm--dim')).map((n) => norm(n.textContent)),
      final: !!row.querySelector('.race-spread--final'),
      divergeInk: getComputedStyle(row.querySelector('.race-list-diverge')).color,
      moved: moved ? moved.getAttribute('data-moved') : null,
      movedText: moved ? norm(moved.textContent) : null,
      news: !!row.querySelector('.rl-lab--news'),
    };
  });
})()`;
const READ_OPEN = `(() => { ${NORM}
  const ex = document.querySelector('.race-list-expand');
  if (!ex) return null;
  const bal = Array.from(ex.querySelectorAll('.rl-bal-row')).map((r) => ({ party: norm(r.querySelector('.rl-pt').textContent), name: norm(r.querySelector('.rl-nm').textContent), how: norm((r.querySelector('.rl-how') || {}).textContent), under: norm((r.querySelector('.rl-hd') || {}).textContent) }));
  const tiles = (root) => Object.fromEntries(Array.from(root.querySelectorAll('.rl-tile')).map((t) => [norm(t.querySelector('.rl-tl').textContent), { v: norm((t.querySelector('.rl-tv') || {}).textContent), s: norm((t.querySelector('.rl-ts') || {}).textContent) }]));
  const members = Array.from(ex.querySelectorAll('.rl-mem')).map((m) => ({
    name: norm(m.querySelector('.rl-mn').textContent),
    href: (m.querySelector('.rl-mh a.rl-lk') || {}).getAttribute ? m.querySelector('.rl-mh a.rl-lk').getAttribute('href') : null,
    role: norm(m.querySelector('.rl-mr').textContent),
    info: norm((m.querySelectorAll('.rl-mi')[1] || {}).textContent),
    chips: m.querySelectorAll('[data-grade-chip]').length,
    chip: norm((m.querySelector('[data-grade-chip]') || {}).textContent),
    noFec: !!Array.from(m.children).find((c) => c.classList && c.classList.contains('rl-none')),
    camp: !!m.querySelector('.rl-camp'),
    tiles: tiles(m),
    face: (m.querySelector('img.rl-face') || {}).getAttribute ? 'img' : (m.querySelector('.rl-face--ini') ? 'initials' : 'none'),
  }));
  const sh = ex.querySelector('.rl-sh');
  return {
    bal, members,
    withdrew: norm((ex.querySelector('.rl-hd--wd') || {}).textContent),
    held: sh ? norm(sh.textContent) : null,
    heldChips: sh ? sh.querySelectorAll('[data-grade-chip]').length : 0,
    special: Array.from(ex.querySelectorAll('.rl-seatctx .rl-blk')).map((b) => norm(b.textContent)).filter((t) => t.toLowerCase().startsWith('special')),
    finalCalls: !!ex.querySelector('.rl-fc'),
    prov: norm((ex.querySelector('.rl-prov') || {}).textContent),
    kalshi: !!ex.querySelector('.racecard-kalshi'),
    news: Array.from(ex.querySelectorAll('.rl-nw .rl-hl')).map((a) => norm(a.textContent)),
    newsNone: norm((ex.querySelector('.rl-xn .rl-none') || {}).textContent),
    noMember: norm((ex.querySelector('.rl-seatctx > .rl-none') || {}).textContent),
    raters: tiles(ex.querySelector('.rl-seatctx')),
  };
})()`;
type OpenReading = {
  bal: { party: string; name: string; how: string; under: string }[];
  members: { name: string; href: string | null; role: string; info: string; chips: number; chip: string; noFec: boolean; camp: boolean; tiles: Record<string, { v: string; s: string }>; face: string }[];
  withdrew: string; held: string | null; heldChips: number; special: string[]; finalCalls: boolean; prov: string; kalshi: boolean; news: string[]; newsNone: string; noMember: string; raters: Record<string, { v: string; s: string }>;
};
type RowReading = { id: string; who: string; chip: string | null; result: string | null; checked: string[]; dim: string[]; final: boolean; divergeInk: string; moved: string | null; movedText: string | null; news: boolean };

type Browser = Awaited<ReturnType<typeof import("@playwright/test")["chromium"]["launch"]>>;
async function newPage(browser: Browser, w: number, h = 1000, rm: "reduce" | "no-preference" = "no-preference", touch = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: rm, hasTouch: touch, isMobile: touch });
  await ctx.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
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
const readRows = async (page: Page) => (await page.evaluate(READ_ROWS)) as RowReading[];
const readOpen = async (page: Page) => (await page.evaluate(READ_OPEN)) as OpenReading | null;
async function bothTabs(page: Page): Promise<RowReading[]> {
  await page.locator(".rl-tab", { hasText: "SENATE" }).click();
  const s = await readRows(page);
  await page.locator(".rl-tab", { hasText: "HOUSE" }).click();
  const h = await readRows(page);
  await page.locator(".rl-tab", { hasText: "SENATE" }).click();
  return [...s, ...h];
}

// ── phase before: HEAD's build ──────────────────────────────────────────────
async function phaseBefore(browser: Browser, dir: string, shots: string) {
  const out: Record<string, unknown> = {};
  {
    const srv = await startServer(dir, "today", null);
    try {
      const maps: Record<string, string> = {};
      for (const w of WIDTHS) {
        const { ctx, page } = await newPage(browser, w);
        await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
        const map = page.locator(".us-map-wrap");
        const html = (await map.innerHTML().catch(() => "")) ?? "";
        writeFileSync(path.join(ART, `before-map-${w}-${LABEL}.html`), html);
        maps[w] = sha(normMap(html));
        await page.screenshot({ path: path.join(shots, `before-map-${w}.png`), fullPage: true });
        await ctx.close();
      }
      out.maps = maps;
      say(`    leg 1 before: HEAD's MAP markup ${JSON.stringify(maps)}`);
    } finally { await srv.kill(); }
  }
  {
    const srv = await startServer(dir, "marks", NOV4);
    try {
      const { ctx, page } = await newPage(browser, 1440);
      await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
      await page.locator(".cart-viewtoggle-btn", { hasText: "LIST" }).click();
      const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
      const found = ["HOLD", "GAIN", "RUNOFF", "NO CALL", "Final calls", "re-elected", "Elected", "✓"].filter((t) => text.includes(t));
      out.leg3red = found;
      await page.screenshot({ path: path.join(shots, `before-nov4-list-1440.png`), fullPage: true });
      await ctx.close();
      check("3", "red: HEAD's build on the marks copy at Nov 4 shows none of the day after on /electoral", found.length === 0, found.length ? `found ${found.join(", ")}` : "no HOLD, GAIN, RUNOFF, NO CALL, Final calls, Elected, re-elected or check");
    } finally { await srv.kill(); }
  }
  return out;
}

// ── phase after: the tree's build ───────────────────────────────────────────
async function phaseAfter(browser: Browser, shots: string) {
  const out: Record<string, unknown> = {};
  const before = JSON.parse(readFileSync(path.join(ART, `phase-before-${LABEL}.json`), "utf8")) as { maps?: Record<string, string> };
  // legs 1, 2, 4, 5 on the today copy, the real clock
  {
    const srv = await startServer(process.cwd(), "today", null);
    try {
      if (runs(1)) await leg1(browser, shots, before.maps ?? {}, out);
      if (runs(2)) await leg2(browser, out);
      if (runs(4)) await leg4(browser, shots, out);
      if (runs(5)) await leg5(browser, out);
      if (runs(7)) await leg7c(browser, out);
    } finally { await srv.kill(); }
  }
  // leg 3 on the marks copy, the clock at Nov 4
  {
    const srv = await startServer(process.cwd(), "marks", NOV4);
    try { if (runs(3)) await leg3(browser, shots, out); } finally { await srv.kill(); }
  }
  return out;
}

async function leg1(browser: Browser, shots: string, headMaps: Record<string, string>, out: Record<string, unknown>) {
  say(`\n── leg 1, the page before election day (today copy, real clock)`);
  const maps: Record<string, string> = {};
  const opened: Record<string, OpenReading | null> = {};
  out.leg1 = opened;
  for (const w of WIDTHS) {
    for (const rm of (w === 1440 ? ["no-preference", "reduce"] : ["no-preference"]) as ("reduce" | "no-preference")[]) {
      const tag = `${w}${rm === "reduce" ? "-rm" : ""}`;
      const { ctx, page, errors } = await newPage(browser, w, w === 430 ? 932 : 1000, rm);
      await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
      const listOn = await page.locator(".cart-viewtoggle-btn", { hasText: "LIST" }).getAttribute("aria-selected");
      const doc = (await page.evaluate(`[document.documentElement.scrollWidth, document.documentElement.clientWidth]`)) as number[];
      await page.screenshot({ path: path.join(shots, `after-load-${tag}.png`) });
      if (rm === "no-preference") {
        check("1", `@${tag}: LIST is the view on load`, listOn === "true", `aria-selected ${listOn}`);
        check("1", `@${tag}: no horizontal document scroll`, doc[0]! <= doc[1]!, `${doc[0]}/${doc[1]}`);
        const tabs = (await page.locator(".rl-tab").allTextContents()).map((t) => t.replace(/\s+/g, ""));
        check("1", `@${tag}: the tabs carry their race and 7-day news counts`, /^SENATE13(·\d+news)?$/.test(tabs[0] ?? "") && /^HOUSE86(·\d+news)?$/.test(tabs[1] ?? ""), JSON.stringify(tabs));
        const fold = (await page.locator(".electoral-tl-fold").innerText()).replace(/\s+/g, " ").trim();
        check("1", `@${tag}: the calendar is folded to one line, NEXT with no dot before it`, /^PRIMARY CALENDAR · 2026 \d+ contests · \d+ voted NEXT [A-Z]{3} \d+ · [A-Z ]+ · \d+ ▸$/.test(fold) && (await page.locator(".electoral-tl-band rect").count()) === 0, `"${fold}"`);
        for (const id of OPEN) {
          const li = await openRow(page, id);
          await li.screenshot({ path: path.join(shots, `after-row-${id}-${tag}.png`) }).catch(() => {});
          if (w === 1440) opened[id] = await readOpen(page);
        }
        await page.locator(".rl-tab", { hasText: "SENATE" }).click();
        await page.locator(".electoral-tl-fold").click();
        await page.waitForTimeout(250);
        const bars = await page.locator(".electoral-tl-band rect[role='button']").count();
        const list = await page.locator(".electoral-cal-list[data-col-flow] .electoral-cal-row").count();
        const up = await page.locator(".electoral-cal-row.is-up").allInnerTexts();
        const nextHidden = (await page.locator(".electoral-tl-next").count()) === 0;
        await page.locator(".electoral-tl-band").screenshot({ path: path.join(shots, `after-calendar-open-${tag}.png`) });
        check("1", `@${tag}: the calendar opens to its bars and the dated list, NEXT hidden`, bars > 0 && list === bars && nextHidden, `bars ${bars} · list rows ${list} · upcoming ${JSON.stringify(up)} · NEXT hidden ${nextHidden}`);
        await page.locator(".electoral-tl-fold").click();
        await page.locator(".cart-viewtoggle-btn", { hasText: "MAP" }).click();
        await page.waitForTimeout(400);
        const html = (await page.locator(".us-map-wrap").innerHTML().catch(() => "")) ?? "";
        writeFileSync(path.join(ART, `after-map-${w}-${LABEL}.html`), html);
        maps[w] = sha(normMap(html));
        await page.screenshot({ path: path.join(shots, `after-map-${tag}.png`), fullPage: true });
        check("1", `@${tag}: MAP's markup equals HEAD's on the same copy (numbers to 2 dp, style attributes as declarations: see normMap)`, !!headMaps[w] && maps[w] === headMaps[w], `tree ${maps[w]} · HEAD ${headMaps[w] ?? "no reading"}`);
        check("1", `@${tag}: no page error`, errors.length === 0, errors.slice(0, 2).join(" | ") || "none");
      }
      await ctx.close();
    }
  }
  const nh = opened["S-NH-2026"], ga = opened["S-GA-2026"], fl = opened["FL-25-2026"], mi = opened["S-MI-2026"], mn = opened["S-MN-2026"];
  check("1", "NH SEN: Pappas on the ballot in Congress now, Shaheen holds the seat off it, one chip (hers, R1)", !!nh && nh.members.length === 1 && /Pappas/.test(nh.members[0]!.name) && /House · NH-01 · running for Senate/.test(nh.members[0]!.role) && /Jeanne Shaheen \(D\) F, retiring/.test(nh.held ?? "") && nh.heldChips === 1 && nh.members[0]!.chips === 0, JSON.stringify({ members: nh?.members.map((m) => [m.name, m.role, m.chips]), held: nh?.held, heldChips: nh?.heldChips }));
  check("1", "GA SEN: two members, Ossoff keeping the seat with his chip, Collins from GA-10 for the Senate", !!ga && ga.members.length === 2 && /Senate · running to keep the seat/.test(ga.members[0]!.role) && ga.members[0]!.chips === 1 && /House · GA-10 · running for Senate/.test(ga.members[1]!.role), JSON.stringify(ga?.members.map((m) => [m.name, m.role, m.chips])));
  check("1", "FL-25: Moskowitz running in another district", !!fl && fl.members.length === 1 && /House · FL-23 · running in FL-25/.test(fl.members[0]!.role) && /running in FL-20/.test(fl.held ?? ""), JSON.stringify({ role: fl?.members[0]?.role, held: fl?.held }));
  check("1", "MI SEN: no member on the ballot, one dim line", !!mi && mi.members.length === 0 && /nobody on this ballot holds office/.test(mi.noMember), `"${mi?.noMember}"`);
  check("1", "MN SEN: the holder is not on the ballot", !!mn && /Tina Smith \(D\) D, not on the ballot/.test(mn.held ?? ""), `"${mn?.held}"`);
  // R3: which rows carry MOVED, and their observed dates
  {
    const { ctx, page } = await newPage(browser, 1440);
    await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
    const rows = await bothTabs(page);
    const moved = rows.filter((r) => r.moved).map((r) => `${r.id} ${r.moved} (${r.movedText})`);
    out.moved = moved;
    say(`    R3: ${moved.length} rows carry MOVED: ${moved.join(" · ")}`);
    const old = rows.filter((r) => r.moved && Date.parse(r.moved) < Date.now() - 14 * 86_400_000);
    check("1", "R3: no MOVED older than 14 days", old.length === 0, `${old.length} older`);
    await ctx.close();
  }
}

async function leg2(browser: Browser, out: Record<string, unknown>) {
  say(`\n── leg 2, dormant (today copy, real clock, no marks)`);
  const { ctx, page } = await newPage(browser, 1440);
  await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
  const rows = await bothTabs(page);
  const head = (await page.locator(".rl-heads").innerText()).replace(/\s+/g, " ");
  for (const id of OPEN) await openRow(page, id);
  const text = (await page.locator("main").innerText()).replace(/\s+/g, " ");
  const res = rows.filter((r) => r.result || r.checked.length || r.final);
  out.dormant = { rows: rows.length, res: res.length };
  check("2", "no result chip, no check, no final calls on any row; the head reads Consensus", res.length === 0 && /CONSENSUS/i.test(head) && !/RESULT/i.test(head), `${rows.length} rows · ${res.length} with a result · head "${head.trim()}"`);
  check("2", "no Final calls and no Elected anywhere on the page", !/Final calls|Elected|re-elected|not yet called/.test(text), "searched main's text");
  await ctx.close();
}

async function leg3(browser: Browser, shots: string, out: Record<string, unknown>) {
  say(`\n── leg 3, the day after (marks copy, CBT_CLOCK_NOW ${NOV4})`);
  const reads: Record<string, { row: RowReading | undefined; open: OpenReading | null }> = {};
  for (const w of WIDTHS) {
    const { ctx, page, errors } = await newPage(browser, w, w === 430 ? 932 : 1000);
    await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
    const rows = await bothTabs(page);
    const head = (await page.locator(".rl-heads").innerText()).replace(/\s+/g, " ");
    const fold = (await page.locator(".electoral-tl-fold").innerText()).replace(/\s+/g, " ").trim();
    for (const p of PLANT) {
      const li = await openRow(page, p.race);
      await li.screenshot({ path: path.join(shots, `after-nov4-${p.race}-${w}.png`) }).catch(() => {});
      if (w === 1440) reads[p.race] = { row: rows.find((r) => r.id === p.race), open: await readOpen(page) };
    }
    await page.screenshot({ path: path.join(shots, `after-nov4-load-${w}.png`) });
    if (w === 1440) {
      check("3", "the column head reads Result", /RESULT/i.test(head) && !/CONSENSUS/i.test(head), `"${head.trim()}"`);
      check("3", "the calendar reads all voted, with no NEXT", /(\d+) contests · \1 voted/.test(fold) && !/NEXT/.test(fold), `"${fold}"`);
      check("3", "no page error", errors.length === 0, errors.slice(0, 2).join(" | ") || "none");
    }
    await ctx.close();
  }
  for (const p of PLANT) {
    const r = reads[p.race];
    const row = r?.row;
    const open = r?.open;
    check("3", `${p.race}: the chip reads ${p.expect.chip}`, row?.chip === p.expect.chip, `chip "${row?.chip}" · who "${row?.who}"`);
    if (p.expect.checked) check("3", `${p.race}: the check sits on ${p.expect.checked}, the other majors dim`, !!row && row.checked.length === 1 && row.checked[0] === p.expect.checked, `checked ${JSON.stringify(row?.checked)} · dim ${JSON.stringify(row?.dim)}`);
    check("3", `${p.race}: the raters' bars are final calls`, !!row?.final, `final ${row?.final}`);
    if (p.expect.chip !== "RUNOFF" && p.expect.chip !== "NO CALL") check("3", `${p.race}: a called seat's ◆ is blank and its open row has no Kalshi line (R6)`, row?.divergeInk === "rgba(0, 0, 0, 0)" && open?.kalshi === false, `ink ${row?.divergeInk} · kalshi ${open?.kalshi}`);
    for (const [name, how] of Object.entries(p.expect.open)) {
      const b = open?.bal.find((x) => x.name === name);
      check("3", `${p.race}: ${name} reads "${how}" on the ballot`, b?.how === how, `"${b?.how}" · ballot ${JSON.stringify(open?.bal.map((x) => [x.name, x.how]))}`);
    }
    if (open?.bal[0] && Object.values(p.expect.open).some((h) => h === "Elected" || h === "re-elected")) check("3", `${p.race}: the winner leads the ballot`, /Elected|re-elected/.test(open.bal[0].how), `first ${open.bal[0].name} (${open.bal[0].how})`);
    check("3", `${p.race}: the raters sit under Final calls, and HO 758's provenance is under the ballot`, !!open?.finalCalls && /^(Called by Ballotpedia|No call on Ballotpedia|No general-election box on Ballotpedia)/.test(open?.prov ?? ""), `final ${open?.finalCalls} · "${open?.prov}"`);
    for (const [bio, role] of Object.entries(p.expect.roles ?? {})) {
      const m = open?.members.find((x) => x.href === `/members/${bio}`);
      check("3", `${p.race}: ${bio}'s role line reads "${role}"`, !!m && m.role.includes(role), `"${m?.role}"`);
    }
    if (p.race === "S-GA-2026") check("3", "S-GA: a primary runoff's shares drop once the general is in", !!open && open.bal.every((b) => !b.under.includes("%")), JSON.stringify(open?.bal.map((b) => b.under)));
  }
  out.leg3 = reads;
}

async function leg4(browser: Browser, shots: string, out: Record<string, unknown>) {
  say(`\n── leg 4, the grade card (today copy)`);
  const res: Record<string, unknown> = {};
  const { ctx, page } = await newPage(browser, 1440, 1000);
  await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
  await openRow(page, "S-GA-2026");
  const chip = page.locator('li[data-race="S-GA-2026"] .rl-mem [data-grade-chip]').first();
  const card = page.locator(".grade-card");
  const away = async () => { await page.mouse.move(5, 5); };
  // (a) opens 400ms after the pointer arrives; the control is its absence at 250ms
  await chip.hover();
  await page.waitForTimeout(250);
  const at250 = await card.count();
  await page.waitForTimeout(400);
  const at650 = await card.count();
  check("4", "(a) hover: closed at 250ms (the control: opening before 400ms fails it), open by 650ms", at250 === 0 && at650 === 1, `250ms ${at250} · 650ms ${at650}`);
  await card.screenshot({ path: path.join(shots, "after-card-hover-1440.png") }).catch(() => {});
  // (b) the pointer leaving without reaching the card closes it after the grace; reaching it keeps it
  await away();
  await page.waitForTimeout(80);
  const in80 = await card.count();
  await page.waitForTimeout(300);
  const after380 = await card.count();
  await chip.hover();
  await page.waitForTimeout(650);
  const box = await card.boundingBox();
  if (box) await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 4 });
  await page.waitForTimeout(400);
  const kept = await card.count();
  check("4", "(b) leaving to nowhere: still open at 80ms, closed by 380ms; reaching the card within 160ms keeps it", in80 === 1 && after380 === 0 && kept === 1, `80ms ${in80} · 380ms ${after380} · reached ${kept}`);
  await away();
  await page.waitForTimeout(400);
  // (c) a click pins it, a second click closes it
  await chip.click();
  await away();
  await page.waitForTimeout(500);
  const pinned = await card.count();
  await card.screenshot({ path: path.join(shots, "after-card-pinned-1440.png") }).catch(() => {});
  await chip.click();
  await page.waitForTimeout(150);
  const unpinned = await card.count();
  check("4", "(c) click pins (survives the pointer leaving), a second click closes", pinned === 1 && unpinned === 0, `pinned ${pinned} · second click ${unpinned}`);
  // (d) focus opens at once; Enter pins; Enter again closes. The chip still holds focus from
  // (c)'s clicks, and focusing a focused element fires no focus event: blur it first.
  await page.mouse.move(5, 5);
  await chip.evaluate((el) => (el as HTMLElement).blur());
  await chip.focus();
  await page.waitForTimeout(60);
  const onFocus = await card.count();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(60);
  const enterPinned = await chip.getAttribute("aria-expanded");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  const enterClosed = await card.count();
  check("4", "(d) focus opens at once; Enter pins; Enter again closes", onFocus === 1 && enterPinned === "true" && enterClosed === 0, `focus ${onFocus} · after Enter expanded ${enterPinned} · second Enter ${enterClosed}`);
  // (e) Tab from the chip reaches the link; Tab from the link moves on past the chip
  await chip.blur();
  await chip.focus();
  await page.keyboard.press("Tab");
  const onLink = (await page.evaluate(`document.activeElement && document.activeElement.closest('.grade-card') ? document.activeElement.textContent : null`)) as string | null;
  await page.keyboard.press("Tab");
  await page.waitForTimeout(100);
  const after = (await page.evaluate(`(() => { const a = document.activeElement; return a ? (a.getAttribute('data-grade-chip') !== null ? 'chip' : (a.closest('.grade-card') ? 'card' : (a.textContent || '').trim().slice(0, 40))) : null; })()`)) as string | null;
  const closedAfterTab = await card.count();
  check("4", "(e) Tab reaches the card's link, then moves on past the chip and the card closes", (onLink ?? "").includes("View tracker") && after !== "chip" && after !== "card" && closedAfterTab === 0, `link "${onLink}" · then focus on "${after}" · card ${closedAfterTab}`);
  // (f) Esc closes it and hands focus back
  await chip.focus();
  await page.waitForTimeout(60);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(80);
  const escClosed = await card.count();
  const back = (await page.evaluate(`document.activeElement && document.activeElement.getAttribute('data-grade-chip') !== null`)) as boolean;
  check("4", "(f) Esc closes and focus returns to the chip", escClosed === 0 && back, `card ${escClosed} · focus on chip ${back}`);
  // (g) it follows the chip as the box scrolls, and closes once the chip is out of sight
  await chip.click();
  await page.waitForTimeout(150);
  const y0 = (await card.boundingBox())?.y ?? NaN;
  const c0 = (await chip.boundingBox())?.y ?? NaN;
  await page.evaluate(`document.querySelector('[data-scroll-box]').scrollTop += 40`);
  await page.waitForTimeout(150);
  const y1 = (await card.boundingBox())?.y ?? NaN;
  const c1 = (await chip.boundingBox())?.y ?? NaN;
  await page.evaluate(`document.querySelector('[data-scroll-box]').scrollTop += 4000`);
  await page.waitForTimeout(150);
  const gone = await card.count();
  check("4", "(g) the card follows the chip as the box scrolls, and closes once the chip is out of sight", Math.abs((y1 - y0) - (c1 - c0)) < 2 && Math.abs(c1 - c0) > 20 && gone === 0, `chip moved ${Math.round(c1 - c0)}px · card moved ${Math.round(y1 - y0)}px · out of sight ${gone}`);
  await page.evaluate(`document.querySelector('[data-scroll-box]').scrollTop = 0`);
  // (h) a re-render closes it
  await openRow(page, "S-GA-2026");
  await chip.click();
  await page.waitForTimeout(150);
  const open1 = await card.count();
  await page.locator(".rl-f--likely").click();
  await page.waitForTimeout(150);
  const rerendered = await card.count();
  await page.locator(".rl-f--likely").click();
  check("4", "(h) a re-render (a tier switch) closes it", open1 === 1 && rerendered === 0, `before ${open1} · after the switch ${rerendered}`);
  await ctx.close();
  // (i) a tap pins the card in a touch context. Two ways a page sees a tap: Playwright's tap in a
  // hasTouch context (CDP Input.dispatchTouchEvent), and DevTools' device mode, which turns a mouse
  // press into a touch with Input.emulateTouchFromMouseEvent under touch emulation. (A mouse click
  // under Emulation.setEmitTouchEventsForMouse hung the first run 13 minutes; every step here is
  // now raced against a timeout.) Each is read as a timeline:
  // a MutationObserver stamps every change in the panel's count from the tap on. The Tooltip
  // primitive under the same tap is the reading the backlog line "the Tooltip on touch" names.
  {
    const TIMELINE = (sel: string) => `(() => { window.__tl = []; window.__t0 = performance.now(); const n = () => document.querySelectorAll('${sel}').length; let last = n(); new MutationObserver(() => { const c = n(); if (c !== last) { last = c; window.__tl.push([Math.round(performance.now() - window.__t0), c]); } }).observe(document.body, { childList: true, subtree: true }); })()`;
    const readTl = async (p: Page) => (await p.evaluate(`window.__tl`)) as [number, number][];
    const touch: Record<string, unknown> = {};
    for (const mech of ["playwright-tap", "devtools-emulation"] as const) {
      const t = mech === "playwright-tap" ? await newPage(browser, 430, 932, "no-preference", true) : await newPage(browser, 430, 932, "no-preference", false);
      let cdp: Awaited<ReturnType<typeof t.ctx.newCDPSession>> | null = null;
      const guard = <T,>(p: Promise<T>, what: string) => Promise.race([p, new Promise<never>((_r, j) => setTimeout(() => j(new Error(`timed out: ${what}`)), 15_000))]);
      const tapAt = async (sel: string) => {
        const el = t.page.locator(sel).first();
        if (mech === "playwright-tap") return el.tap();
        const b = (await el.boundingBox())!;
        const at = { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2), button: "left" as const, clickCount: 1 };
        await cdp!.send("Input.emulateTouchFromMouseEvent", { type: "mousePressed", ...at, timestamp: Date.now() / 1000 });
        await cdp!.send("Input.emulateTouchFromMouseEvent", { type: "mouseReleased", ...at, timestamp: Date.now() / 1000 + 0.05 });
      };
      if (mech === "devtools-emulation") {
        cdp = await t.ctx.newCDPSession(t.page);
        await cdp.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
      }
      await t.page.goto(`${BASE}/bills`, { waitUntil: "networkidle" });
      let tooltip: [number, number][] | null = null;
      if (await t.page.locator(".tooltip-term").count()) {
        await t.page.evaluate(TIMELINE(".tooltip-panel"));
        await guard(tapAt(".tooltip-term"), "tap the Tooltip term");
        await t.page.waitForTimeout(700);
        tooltip = await readTl(t.page);
      }
      await t.page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
      await openRow(t.page, "S-GA-2026");
      await t.page.evaluate(TIMELINE(".grade-card"));
      await guard(tapAt('li[data-race="S-GA-2026"] .rl-mem [data-grade-chip]'), "tap the grade chip");
      await t.page.waitForTimeout(700);
      const card = await readTl(t.page);
      const cardNow = await t.page.locator(".grade-card").count();
      if (mech === "playwright-tap") await t.page.locator(".grade-card").screenshot({ path: path.join(shots, "after-card-tap-430.png") }).catch(() => {});
      touch[mech] = { tooltip, card, cardNow };
      check("4", `(i) touch, ${mech}: a tap opens the card and it stays (pinned) 700ms on`, cardNow === 1 && card.length > 0 && card[card.length - 1]![1] === 1, `card timeline ${JSON.stringify(card)} · Tooltip timeline under the same tap ${JSON.stringify(tooltip)}`);
      await t.ctx.close();
    }
    res.touch = touch;
  }
  out.leg4 = res;
}

// leg 7c (R8): the calendar list's `data-col-flow` curve, applied in the page and re-read with the
// calendar open (the audit measures the load state, where the list is folded away). Each column is
// the rows sharing a left edge; its ink is the union of its rows' text rects; a rag is the next
// column's ink-left less this column's ink-right, the shape registry entry (9) recorded for
// `.so-group-names`. Widths 2560, 1920, 1440, and at 2560 two injected column widths.
const READ_CURVE = `(() => {
  const box = document.querySelector('.electoral-cal-list');
  if (!box) return null;
  const cs = getComputedStyle(box);
  const rows = Array.from(box.querySelectorAll('.electoral-cal-row'));
  const ink = rows.map((r) => { const rg = document.createRange(); rg.selectNodeContents(r); const rs = Array.from(rg.getClientRects()).filter((x) => x.width > 0); return { l: Math.min(...rs.map((x) => x.left)), r: Math.max(...rs.map((x) => x.right)), x: r.getBoundingClientRect().left }; });
  const cols = [];
  for (const k of ink) { let c = cols.find((c) => Math.abs(c.x - k.x) < 4); if (!c) { c = { x: k.x, l: k.l, r: k.r, n: 0 }; cols.push(c); } c.l = Math.min(c.l, k.l); c.r = Math.max(c.r, k.r); c.n++; }
  cols.sort((a, b) => a.x - b.x);
  const rags = cols.slice(1).map((c, i) => Math.round(c.l - cols[i].r));
  return { width: Math.round(box.getBoundingClientRect().width), columnWidth: cs.columnWidth, columnCount: cs.columnCount, columnGap: cs.columnGap, marked: box.hasAttribute('data-col-flow'), columns: cols.length, perColumn: cols.map((c) => c.n), rows: rows.length, children: rows.map((r) => r.children.length).filter((n, i, a) => a.indexOf(n) === i), rowWidths: [Math.round(Math.min(...rows.map((r) => r.getBoundingClientRect().width))), Math.round(Math.max(...rows.map((r) => r.getBoundingClientRect().width)))], rags, worst: rags.length ? Math.max(...rags) : 0 };
})()`;
async function leg7c(browser: Browser, out: Record<string, unknown>) {
  say(`\n── leg 7c (R8), the calendar list's data-col-flow curve (today copy, calendar open)`);
  const curve: Record<string, unknown> = {};
  const runs7 = [
    { tag: "2560", w: 2560, css: "" },
    { tag: "1920", w: 1920, css: "" },
    { tag: "1440", w: 1440, css: "" },
    { tag: "2560 · column-width: 14rem", w: 2560, css: ".electoral-cal-list{column-width:14rem!important}" },
    { tag: "2560 · column-width: 20rem", w: 2560, css: ".electoral-cal-list{column-width:20rem!important}" },
  ];
  for (const r of runs7) {
    const { ctx, page } = await newPage(browser, r.w, 1440);
    await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
    if (r.css) await page.addStyleTag({ content: r.css });
    await page.locator(".electoral-tl-fold").click();
    await page.waitForTimeout(250);
    const c = (await page.evaluate(READ_CURVE)) as { width: number; columnWidth: string; columnCount: string; columnGap: string; marked: boolean; columns: number; perColumn: number[]; rows: number; children: number[]; rowWidths: number[]; rags: number[]; worst: number } | null;
    curve[r.tag] = c;
    say(`    ${r.tag}: ${c ? `width ${c.width} · ${c.columns} columns (${c.perColumn.join("/")} rows) · computed column-width ${c.columnWidth}, count ${c.columnCount}, gap ${c.columnGap} · rags ${c.rags.join(" / ")} · worst ${c.worst}px · ${c.rows} rows of ${c.children.join("/")} children, ${c.rowWidths[0]}–${c.rowWidths[1]}px wide` : "no list"}`);
  }
  const base = curve["2560"] as { marked: boolean; columnWidth: string; columns: number } | null;
  check("7", "R8: the calendar list is marked data-col-flow and computes multi-column (the marking and the style agree)", !!base && base.marked && base.columnWidth !== "auto" && base.columns > 1, JSON.stringify(base && { marked: base.marked, columnWidth: base.columnWidth, columns: base.columns }));
  out.curve = curve;
}

// leg 5: the open row's values against the race pages and member pages on the same copy
const READ_MEMBER_PAGE = `(() => { ${NORM}
  const stat = (s) => { const v = s.querySelector('.mhp-stat-v'); return { full: norm(v.textContent), lead: norm(v.firstChild ? v.firstChild.textContent : '') }; };
  const stats = Object.fromEntries(Array.from(document.querySelectorAll('.mhp-stat')).map((s) => [norm(s.querySelector('.mhp-stat-l').textContent), stat(s)]));
  const all = norm(document.querySelector('main').textContent);
  const fund = Array.from(document.querySelectorAll('div')).map((d) => norm(d.textContent)).find((t) => /^[0-9]{4} fundraising/.test(t)) || null;
  const badge = document.querySelector('[title^="Palestine Tracker:"]');
  return { stats, fund, all, badge: badge ? badge.getAttribute('title') : null, badgeText: badge ? norm(badge.textContent) : null };
})()`;
type MemberPage = { stats: Record<string, { full: string; lead: string }>; fund: string | null; all: string; badge: string | null; badgeText: string | null };
const READ_RACE_PAGE = `(() => { ${NORM}
  const h2 = Array.from(document.querySelectorAll('h2')).find((h) => h.textContent.trim().toLowerCase().startsWith('candidates ('));
  const section = h2 ? h2.closest('section') : null;
  const lis = section ? Array.from(section.querySelectorAll('li')).map((li) => norm(li.textContent)) : [];
  const news = Array.from(document.querySelectorAll('.news-row a')).map((a) => norm(a.textContent));
  return { lis, news, all: norm(document.querySelector('main').textContent) };
})()`;
async function leg5(browser: Browser, out: Record<string, unknown>) {
  say(`\n── leg 5, the data: the open row against the race and member pages (today copy)`);
  const { ctx, page } = await newPage(browser, 1440, 1000);
  const readings: Record<string, unknown> = {};
  for (const id of LEG5) {
    await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
    await openRow(page, id);
    const open = (await readOpen(page))!;
    await page.goto(`${BASE}/race/${id}`, { waitUntil: "networkidle" });
    const race = (await page.evaluate(READ_RACE_PAGE)) as { lis: string[]; news: string[]; all: string };
    const names = open.bal.filter((b) => b.how !== "incumbent" && !b.how.startsWith("incumbent")).map((b) => b.name);
    const missing = names.filter((n) => !race.lis.some((l) => l.includes(n)));
    check("5", `${id}: every non-incumbent name on the open row's ballot is on the race page's roster`, missing.length === 0, `${names.length} names · missing ${JSON.stringify(missing)}`);
    for (const [k, v] of Object.entries(open.raters)) if (["Cook", "Sabato", "Inside"].includes(k) && v.v !== "—") check("5", `${id}: ${k} ${v.v} is the race page's`, race.all.includes(v.v), v.v);
    const memberNews: string[] = [];
    for (const m of open.members) {
      const bio = (m.href ?? "").split("/").pop()!;
      await page.goto(`${BASE}/members/${bio}`, { waitUntil: "networkidle" });
      const mp = (await page.evaluate(READ_MEMBER_PAGE)) as MemberPage;
      const missed = Object.entries(mp.stats).find(([k]) => k.startsWith("Missed ·") && !k.includes("career"));
      const t = m.tiles;
      const median = (t["Missed · 119th"]?.s.match(/[0-9.]+%/) ?? [""])[0]!.replace("%", "");
      check("5", `${id} ${bio}: Missed ${t["Missed · 119th"]?.v} and its median equal the member page's "${missed?.[1].full}"`, !!missed && missed[1].lead === t["Missed · 119th"]!.v.replace("%", "") && median !== "" && missed[1].full.includes(`median ${median}%`), `open "${t["Missed · 119th"]?.v} / ${t["Missed · 119th"]?.s}" · page "${missed?.[1].full}"`);
      check("5", `${id} ${bio}: Sponsored ${t["Sponsored"]?.v} and ${t["Sponsored"]?.s} equal the member page's`, mp.stats["Sponsored"]?.lead === t["Sponsored"]?.v && mp.stats["Enacted"]?.lead === t["Sponsored"]!.s.split(" ")[0], `page Sponsored ${mp.stats["Sponsored"]?.lead} · Enacted ${mp.stats["Enacted"]?.lead}`);
      const dw = t["DW-NOMINATE"]?.v ?? "";
      check("5", `${id} ${bio}: DW-NOMINATE ${dw} is the member page's`, dw === "—" ? /No ideology score/.test(mp.all) : mp.all.includes(dw.replace("−", "-")), dw);
      if (m.noFec) check("5", `${id} ${bio}: no FEC row, and the member page prints no fundraising line`, mp.fund == null, `page fund "${mp.fund}"`);
      else check("5", `${id} ${bio}: Raised ${t["Raised"]?.v} is the member page's fundraising line "${mp.fund}"`, !!mp.fund && mp.fund.includes(`${t["Raised"]?.v} raised`), `open ${t["Raised"]?.v} · ${t["FEC as of"]?.v}`);
      if (m.chips) check("5", `${id} ${bio}: the chip's grade ${m.chip} is the member page's badge`, mp.badgeText === m.chip, `page badge "${mp.badgeText}" (${mp.badge})`);
      // the member's own seat's race page: where their news is the page's news (getRaceNews, unfiltered)
      const role = m.role.split(" · ");
      const own = role[0] === "Senate" ? `S-${id.slice(2, 4)}-2026` : `${role[1]}-2026`;
      const ownId = role[0] === "Senate" ? id : own;
      await page.goto(`${BASE}/race/${ownId}`, { waitUntil: "networkidle" });
      memberNews.push(...((await page.evaluate(READ_RACE_PAGE)) as { news: string[] }).news);
    }
    if (open.members.length) {
      const strays = open.news.filter((n) => !memberNews.includes(n));
      check("5", `${id}: each open-row headline is on a member's own race page (getRaceNews' read, unfiltered, R2)`, strays.length === 0, `${open.news.length} items · not found ${JSON.stringify(strays)}`);
    } else {
      check("5", `${id}: no member on the ballot, so no news (the race page shows the holder's: R2's rule, not a mismatch)`, /No news in the feed for anyone on this ballot/.test(open.newsNone) && race.news.length >= 0, `open "${open.newsNone}" · race page ${race.news.length} items (the holder's)`);
    }
    readings[id] = { open, raceRoster: race.lis, raceNews: race.news.length };
  }
  // the five with no FEC row: their member pages print no totals
  for (const bio of NO_FEC) {
    await page.goto(`${BASE}/members/${bio}`, { waitUntil: "networkidle" });
    const mp = (await page.evaluate(READ_MEMBER_PAGE)) as MemberPage;
    check("5", `${bio}: the member page prints no FEC totals (the open row's no-FEC line agrees)`, mp.fund == null, `fund "${mp.fund}"`);
  }
  out.leg5 = readings;
  await ctx.close();
}

async function phaseRun() {
  const phase = argAt("--phase");
  if (phase !== "before" && phase !== "after") throw new Error("--phase before|after");
  const dir = phase === "before" ? path.resolve(argAt("--dir") ?? "") : process.cwd();
  if (!existsSync(path.join(dir, ".next/BUILD_ID"))) throw new Error(`no build at ${dir}`);
  const headSha = execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  say(`\n── phase ${phase} · ${path.relative(process.cwd(), dir) || "the tree"} at ${headSha} · build ${readFileSync(path.join(dir, ".next/BUILD_ID"), "utf8").trim()} · node ${NODE}`);
  const fp0 = await prodFingerprint();
  const t0 = new Date().toISOString();
  const shots = path.join(ART, "captures");
  mkdirSync(shots, { recursive: true });
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  let out: Record<string, unknown> = {};
  try {
    out = phase === "before" ? await phaseBefore(browser, dir, shots) : await phaseAfter(browser, shots);
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
