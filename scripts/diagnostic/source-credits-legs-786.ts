// HO 786 legs: name the source where its data sits. On `file:` copies of prod seeded by SELECT (built by the real
// scripts/migrate.ts), HEAD's build (692b276) as the red and the tree's as the green, each build's server on its
// own copy.
//
//   npx tsx scripts/diagnostic/source-credits-legs-786.ts --step0 --label L
//   npx tsx scripts/diagnostic/source-credits-legs-786.ts --counts --label L
//   npx tsx scripts/diagnostic/source-credits-legs-786.ts --seed --label L
//   npx tsx scripts/diagnostic/source-credits-legs-786.ts --leg-c --label L
//   npx tsx scripts/diagnostic/source-credits-legs-786.ts --run --head <HEAD worktree> --tree <tree worktree> --label L
//   npx tsx scripts/diagnostic/source-credits-legs-786.ts --narrow390 [--width 390|430] --head <HEAD worktree> --tree <tree worktree> --label L --copies <seed label>
//   npx tsx scripts/diagnostic/source-credits-legs-786.ts --fit --head <HEAD worktree> --tree <tree worktree> --label L --copies <seed label>
//
// STEP 0 (read-only):
//   3  three real Senate roll calls (ids from prod by SELECT): the .htm twin of the URL the sync reads answers 200
//      with the roll number in the body; the .xml the sync reads, beside it
//   4  lda.gov and 270toWin's calendar answer 200 to a plain fetch; ballotpedia.org answers 200 in Playwright (a 202
//      is its challenge, not a page)
//   6  the newest The Hill or Roll Call mention (leg A's bill), and the newest Politico one (its control)
//   7  three LDA filings from the API with the sync's key: each filing_document_url, its shape in filing_uuid, and
//      whether it answers 200 with the uuid in the body; one House roll call's raw_json keys and any URL in it
//
// Legs (each states its red on HEAD first):
//   A  news names: on claim 6's bill the served page carries THE_HILL / ROLL_CALL on HEAD and THE HILL / ROLL CALL
//      on the tree; the control bill's POLITICO reads the same on both; the expand panel, opened on the bill's row
//      in the /bills feed, reads the same way
//   B  vote pages: [data-sources] 0/0 on HEAD, 1/1 on the tree; the Senate anchor is senateRollCallUrl's .htm; the
//      House page holds no senate.gov anchor (the control that the chamber branch can fail)
//   C  one copy of the Senate path: for five real triples HEAD's detailUrl string equals the tree's and
//      senateRollCallUrl's "xml" byte for byte, and differs from its "htm" (the control); "roll_call_votes/vote" is
//      in lib app components once
//   D  the member line: "Senate votes via senate.gov" on a senator's page 0 → 1; on a House member's, 0 both sides
//   E  /lobbying: [data-sources] 0 → 1 with an lda.gov anchor
//   F  /electoral: [data-sources] 0 → 1, 270toWin linked to PRIMARY_CALENDAR_URL, Ballotpedia named; the line 6px
//      under the band; "2026-state-primary-calendar" in lib app components once
//   G  /welcome's foot: lda.gov and Ballotpedia 0 → 1; the three rater anchors 3 both sides; on the tree,
//      "synced 4× daily", the sync time and each date of the ratings range nowrap and whole at 1440, 2560 and
//      430 (the review replies' rulings)
//   H  the stylesheet the page links carries .source-link (and .electoral-sources) on the tree, neither on HEAD
//   I  captures: every surface at 1440 and 2560, again with reduced motion (read back in the page), HEAD's at 1440
//      beside them, and the tree's at 430 with each page's overflow, the local prediction
//   the smoke test: the tree's e2e/smoke.spec.ts ("the sources lines name where the data comes from") against each
//      server, red on HEAD; e2e/narrow.spec.ts against each server, the local width reading
//
// SAFETY. Prod is only READ (a SELECT-only reader); its schema is fingerprinted before and after. A copy is
// `file:${abs}` from a path ending -786-legs.db under the gitignored scratch directory; a server gets its copy's URL
// with TURSO_AUTH_TOKEN="" and a CRON_SECRET minted for the run, and none of .env's names. users and watchlist are
// not copied. Every printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { redactSecrets } from "@/lib/redact";
import { LDA_HOME_URL, PRIMARY_CALENDAR_URL, senateRollCallUrl } from "@/lib/source-links";

const OURS = Object.keys(config({ path: ".env", quiet: true }).parsed ?? {});

const HEAD_SHA = "692b276";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/786-artifacts"); // repo-ignored
const SHOTS = path.join(ART, "captures");
const PW = path.resolve("node_modules/@playwright/test/cli.js");
const PORT = 3786;
const BASE = `http://127.0.0.1:${PORT}`;
const SENTINEL_ROUTE = "/api/cron/nominations"; // no leg runs it
// Claim 6's bills, and the roll calls claim 3 and 7 read.
const BILL_A = "119-hr-10828";
const BILL_CTRL = "119-s-5588";
const SENATE_VOTE = "senate-119-2-256";
const HOUSE_VOTE = "house-119-2-314";
const SMOKE_TITLE = "the sources lines name where the data comes from";
// Not copied: personal rows, and the FTS index, which bills' own triggers rebuild as the rows land.
const EXCLUDE = new Set(["users", "watchlist", "bills_fts", "bills_fts_data", "bills_fts_idx", "bills_fts_docsize", "bills_fts_config"]);
const COPIES = ["head", "tree"] as const;
type CopyKind = (typeof COPIES)[number];

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
// The copies a later mode reads: the seed's label (--copies), else this run's.
const COPIES_LABEL = argAt("--copies") ?? LABEL;
const out: string[] = [];
const say = (s: string) => { const r = redactSecrets(s); out.push(r); console.log(r); };
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
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

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
type Read = ReturnType<typeof reader>;
async function schemaPrint(): Promise<string> {
  const db = prodClient();
  try { return sha(JSON.stringify((await reader(db)(`SELECT type, name, sql FROM sqlite_master ORDER BY type, name`)).rows.map((r) => Object.values(r)))); }
  finally { db.close(); }
}
async function prodSchemaUnchanged(label: string, before: string) {
  const after = await schemaPrint();
  check("safety", `prod's schema unchanged (${label})`, before === after, `before ${before} · after ${after} (the reader is SELECT-only by construction)`);
}

// ── STEP 0 ──────────────────────────────────────────────────────────────────
// The sync's own path (lib/senate-votes-sync.ts detailUrl at 692b276), with the extension as a parameter.
const rollUrl = (c: number, s: number, r: number, ext: "xml" | "htm") =>
  `https://www.senate.gov/legislative/LIS/roll_call_votes/vote${c}${s}/vote_${c}_${s}_${String(r).padStart(5, "0")}.${ext}`;

async function get(url: string, headers: Record<string, string> = {}) {
  const t = Date.now();
  try {
    const res = await fetch(url, { headers, redirect: "follow", signal: AbortSignal.timeout(30_000) });
    const body = await res.text();
    return { status: res.status, finalUrl: res.url, type: res.headers.get("content-type") ?? "", bytes: body.length, body, ms: Date.now() - t };
  } catch (e) {
    return { status: 0, finalUrl: url, type: "", bytes: 0, body: "", ms: Date.now() - t, error: (e as Error).message };
  }
}

async function claim3(read: Read) {
  say(`\n── claim 3: senate.gov roll calls, .htm beside the sync's .xml`);
  const n = Number((await read(`SELECT COUNT(*) AS n FROM votes WHERE chamber = 'senate'`)).rows[0]!.n);
  const picks = [
    (await read(`SELECT id, congress, session, roll_call, vote_date FROM votes WHERE chamber = 'senate' ORDER BY vote_date DESC, roll_call DESC LIMIT 1`)).rows[0]!,
    (await read(`SELECT id, congress, session, roll_call, vote_date FROM votes WHERE chamber = 'senate' ORDER BY vote_date, roll_call LIMIT 1 OFFSET ?`, [Math.floor(n / 2)])).rows[0]!,
    (await read(`SELECT id, congress, session, roll_call, vote_date FROM votes WHERE chamber = 'senate' ORDER BY vote_date, roll_call LIMIT 1`)).rows[0]!,
  ];
  say(`  ${n} Senate rows on prod; picked the newest, the median by date and the oldest`);
  for (const p of picks) {
    const [c, s, r] = [Number(p.congress), Number(p.session), Number(p.roll_call)];
    for (const ext of ["htm", "xml"] as const) {
      const u = rollUrl(c, s, r, ext);
      const g = await get(u);
      // The page states its number as "Vote Number: <n>" (htm) or <vote_number>n</vote_number> (xml).
      const m = g.body.match(/Vote Number:\s*(?:<[^>]*>\s*)*0*(\d+)/i) ?? g.body.match(/<vote_number>\s*0*(\d+)\s*<\/vote_number>/i);
      const num = m ? Number(m[1]) : null;
      say(`  ${p.id} (${p.vote_date}) .${ext}: HTTP ${g.status} · ${g.bytes} bytes · ${g.type} · ${g.ms}ms · its number ${num ?? "not found"}${num === r ? " = the roll" : ""} · ${u}${"error" in g && g.error ? ` · ${g.error}` : ""}`);
    }
  }
}

async function claim4() {
  say(`\n── claim 4: the out-link homes`);
  for (const u of ["https://lda.gov/", "https://www.270towin.com/2026-state-primary-calendar/"]) {
    const g = await get(u);
    const title = g.body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
    say(`  ${u}: HTTP ${g.status} · final ${g.finalUrl} · ${g.bytes} bytes · title "${title}"${"error" in g && g.error ? ` · ${g.error}` : ""}`);
  }
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    const page = await (await browser.newContext()).newPage();
    const seen: string[] = [];
    page.on("response", (r) => { if (r.request().resourceType() === "document") seen.push(`${r.status()} ${r.url()}`); });
    const first = await page.goto("https://ballotpedia.org/", { waitUntil: "domcontentloaded", timeout: 45_000 });
    // A 202 is the challenge; it reloads itself once its script has run. Give it the time a reader would.
    if (first && first.status() === 202) await page.waitForURL(/ballotpedia\.org/, { waitUntil: "load", timeout: 30_000 }).catch(() => {});
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    const title = await page.title();
    say(`  https://ballotpedia.org/ in Playwright: document responses ${seen.join(" → ")} · title "${title}"`);
  } finally { await browser.close(); }
}

async function claim6(read: Read) {
  say(`\n── claim 6: leg A's bill`);
  const hill = (await read(`SELECT bill_id, source FROM news_mentions WHERE source IN ('the_hill','roll_call') ORDER BY published_at DESC LIMIT 1`)).rows;
  say(`  the handoff's SELECT: ${hill.length} row${hill.length === 1 ? "" : "s"}${hill[0] ? ` · bill ${hill[0].bill_id} · source ${hill[0].source}` : ""}`);
  const pol = (await read(`SELECT bill_id, source FROM news_mentions WHERE source = 'politico' ORDER BY published_at DESC LIMIT 1`)).rows;
  say(`  the control's bill (newest Politico mention): ${pol[0] ? `${pol[0].bill_id}` : "none"}`);
  for (const b of [hill[0]?.bill_id, pol[0]?.bill_id].filter(Boolean)) {
    const srcs = (await read(`SELECT source, COUNT(*) AS n FROM news_mentions WHERE bill_id = ? GROUP BY source ORDER BY source`, [b as string])).rows;
    const bill = (await read(`SELECT id, is_ceremonial FROM bills WHERE id = ?`, [b as string])).rows[0];
    say(`  ${b}: mentions ${srcs.map((r) => `${r.source} ${r.n}`).join(" · ")} · bills row ${bill ? `present, is_ceremonial ${bill.is_ceremonial}` : "MISSING"}`);
  }
}

async function claim7(read: Read) {
  say(`\n── claim 7a: LDA per-filing documents (the API with the sync's key, by name)`);
  const key = process.env.LDA_API_KEY;
  say(`  LDA_API_KEY present in .env: ${key ? "yes" : "no"}`);
  const uuids = (await read(`SELECT filing_uuid FROM lda_filings ORDER BY dt_posted DESC LIMIT 3`)).rows.map((r) => String(r.filing_uuid));
  const shapes: string[] = [];
  for (const u of uuids) {
    const api = await get(`https://lda.gov/api/v1/filings/${u}/`, { Accept: "application/json", ...(key ? { Authorization: `Token ${key}` } : {}) });
    let doc: string | null = null;
    try { doc = (JSON.parse(api.body) as { filing_document_url?: string | null }).filing_document_url ?? null; } catch { /* not JSON */ }
    const shape = doc ? doc.split(u).join("{uuid}") : null;
    if (shape) shapes.push(shape);
    const d = doc ? await get(doc) : null;
    say(`  ${u}: API HTTP ${api.status} · filing_document_url ${doc ?? "none"} · shape ${shape ?? "none"}${d ? ` · the document HTTP ${d.status} · ${d.bytes} bytes · ${d.type} · uuid in body ${d.body.includes(u) ? "yes" : "no"}` : ""}`);
  }
  const one = new Set(shapes).size === 1 && shapes.length === uuids.length && shapes[0]!.includes("{uuid}");
  say(`  one pattern in filing_uuid alone: ${one ? `yes, ${shapes[0]}` : "no"}`);

  say(`\n── claim 7b: one House roll call's raw_json`);
  const h = (await read(`SELECT id, raw_json FROM votes WHERE chamber = 'house' ORDER BY vote_date DESC, roll_call DESC LIMIT 1`)).rows[0]!;
  const j = JSON.parse(String(h.raw_json)) as Record<string, unknown>;
  say(`  ${h.id}: top-level keys ${Object.keys(j).join(", ")}`);
  const urls: string[] = [];
  const walk = (v: unknown, at: string) => {
    if (typeof v === "string") { if (/^https?:\/\//.test(v)) urls.push(`${at} = ${v}`); return; }
    if (Array.isArray(v)) { v.slice(0, 3).forEach((x, i) => walk(x, `${at}[${i}]`)); return; }
    if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, at ? `${at}.${k}` : k);
  };
  walk(j, "");
  say(`  URLs in it: ${urls.length ? urls.join(" · ") : "none"}`);
  const house = urls.filter((x) => /clerk\.house\.gov/.test(x));
  say(`  a Clerk URL: ${house.length ? house.join(" · ") : "none"}`);
}

async function counts(read: Read) {
  say(`\n── table sizes (planning the legs' copies)`);
  const tables = (await read(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).rows.map((r) => String(r.name));
  for (const t of tables) say(`  ${t} ${(await read(`SELECT COUNT(*) AS n FROM ${t}`)).rows[0]!.n}`);
}

// ── the copies ──────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${COPIES_LABEL}-786-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-786-legs.db")) throw new Error(`refused: a copy must be a *-786-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
const sentinelFile = (kind: CopyKind) => path.join(DIR, `sentinel-${kind}-${COPIES_LABEL}-786.txt`);
const PAGE = 4000;
async function copyRows(read: Read, db: Client, table: string): Promise<number> {
  const cols = new Set((await db.execute(`PRAGMA table_info(${table})`)).rows.map((r) => String(r.name)));
  await db.execute(`DELETE FROM ${table}`);
  let last = -1;
  let n = 0;
  for (;;) {
    const rs = await read(`SELECT rowid AS __rid, * FROM ${table} WHERE rowid > ? ORDER BY rowid LIMIT ${PAGE}`, [last]);
    if (rs.rows.length === 0) break;
    const use = Object.keys(rs.rows[0]!).filter((c) => c !== "__rid" && cols.has(c));
    const stmts: InStatement[] = rs.rows.map((r) => ({ sql: `INSERT INTO ${table} (${use.join(",")}) VALUES (${use.map(() => "?").join(",")})`, args: use.map((c) => (r as Record<string, unknown>)[c] as never) }));
    for (let i = 0; i < stmts.length; i += 1000) await db.batch(stmts.slice(i, i + 1000), "write");
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
  const before = await schemaPrint();
  const tpl = copyPath("template");
  if (existsSync(tpl)) rmSync(tpl);
  const mig = spawnSync(process.execPath, [path.resolve("node_modules/tsx/dist/cli.mjs"), "scripts/migrate.ts"], { env: { ...cleanEnv(), TURSO_DATABASE_URL: copyUrl(tpl), TURSO_AUTH_TOKEN: "" }, encoding: "utf8" });
  if (mig.status !== 0) throw new Error(`migrate against the template failed: ${redactSecrets((mig.stderr || mig.stdout).slice(-600))}`);
  const prod = prodClient();
  const read = reader(prod);
  const prodTables = (await read(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`)).rows.map((r) => String(r.name));
  const counts: string[] = [];
  const skipped: string[] = [];
  const t0 = Date.now();
  await withDb(copyUrl(tpl), async (db) => {
    await db.execute("PRAGMA foreign_keys = OFF");
    const local = new Set((await db.execute(`SELECT name FROM sqlite_master WHERE type = 'table'`)).rows.map((r) => String(r.name)));
    for (const t of prodTables) {
      if (EXCLUDE.has(t)) { skipped.push(`${t} (not copied)`); continue; }
      if (!local.has(t)) { skipped.push(`${t} (migrate.ts makes no such table)`); continue; }
      const s = Date.now();
      const n = await copyRows(read, db, t);
      counts.push(`${t} ${n}`);
      say(`  ${t}: ${n} rows (${((Date.now() - s) / 1000).toFixed(1)}s)`);
    }
    const fts = (await db.execute(`SELECT COUNT(*) AS n FROM bills_fts`)).rows[0]!.n;
    say(`  bills_fts, filled by bills' insert trigger: ${fts} rows`);
  });
  prod.close();
  say(`  template: the real scripts/migrate.ts against file:, seeded from prod in ${((Date.now() - t0) / 1000).toFixed(0)}s · ${counts.length} tables · skipped ${skipped.join(", ")}`);
  const outJ: Record<string, unknown> = { counts, skipped };
  for (const kind of COPIES) {
    const abs = copyPath(kind);
    copyFileSync(tpl, abs);
    const at = new Date().toISOString();
    writeFileSync(sentinelFile(kind), at);
    await withDb(copyUrl(abs), async (db) => {
      const closed = await db.execute(`UPDATE cron_runs SET status = 'success', ended_at = started_at WHERE status = 'running'`);
      if (closed.rowsAffected) say(`  ${kind}: copied rows still running, closed on the copy: ${closed.rowsAffected}`);
      await db.execute({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 786, 'success', ?)`, args: [SENTINEL_ROUTE, at, at, JSON.stringify({ sentinel: `HO 786 legs, the ${kind} copy only` })] });
    });
    say(`  copy ${path.basename(abs)} · ${(statSync(abs).size / 1e6).toFixed(0)} MB · sentinel ${at}`);
    outJ[kind] = { at };
    await sleep(400);
  }
  writeFileSync(path.join(ART, `seeded-${LABEL}.json`), JSON.stringify(outJ, null, 1));
  await prodSchemaUnchanged("the seed", before);
}

// ── leg C: one copy of the Senate path (in-process) ─────────────────────────
type DetailUrl = (c: number, s: number, padded: string) => string;
function detailUrlFrom(src: string, scope: Record<string, unknown>): DetailUrl {
  const m = src.match(/function detailUrl\([\s\S]*?\n\}/);
  if (!m) throw new Error("detailUrl not found");
  const js = ts.transpileModule(m[0], { compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.None } }).outputText;
  return new Function(...Object.keys(scope), `${js}\nreturn detailUrl;`)(...Object.values(scope)) as DetailUrl;
}
function grepTree(needle: string): string[] {
  const hits: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== ".next") walk(p); continue; }
      const lines = readFileSync(p, "utf8").split(/\r?\n/);
      lines.forEach((l, i) => { if (l.includes(needle)) hits.push(`${path.relative(process.cwd(), p).split(path.sep).join("/")}:${i + 1}`); });
    }
  };
  for (const d of ["lib", "app", "components"]) walk(path.resolve(d));
  return hits;
}
async function legC() {
  say(`\n── leg C, one copy of the Senate path`);
  const headSrc = execFileSync("git", ["show", `${HEAD_SHA}:lib/senate-votes-sync.ts`], { encoding: "utf8" });
  const treeSrc = readFileSync("lib/senate-votes-sync.ts", "utf8");
  const headFn = detailUrlFrom(headSrc, {});
  const treeFn = detailUrlFrom(treeSrc, { senateRollCallUrl });
  say(`  HEAD's detailUrl (${HEAD_SHA}): ${headSrc.match(/function detailUrl\([\s\S]*?\n\}/)![0].split(/\r?\n/).length} lines read from git · the tree's: calls senateRollCallUrl ${/senateRollCallUrl\(congress, session, paddedNum, "xml"\)/.test(treeSrc) ? "with \"xml\"" : "NOT AS EXPECTED"}`);
  const db = prodClient();
  const read = reader(db);
  const n = Number((await read(`SELECT COUNT(*) AS n FROM votes WHERE chamber = 'senate'`)).rows[0]!.n);
  const triples: { c: number; s: number; r: number }[] = [];
  for (const off of [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n - 1]) {
    const row = (await read(`SELECT congress, session, roll_call FROM votes WHERE chamber = 'senate' ORDER BY vote_date, roll_call LIMIT 1 OFFSET ?`, [off])).rows[0]!;
    triples.push({ c: Number(row.congress), s: Number(row.session), r: Number(row.roll_call) });
  }
  db.close();
  let same = 0, xml = 0, htmDiffers = 0;
  for (const { c, s, r } of triples) {
    const padded = String(r).padStart(5, "0"); // as the sync pads (lib/senate-votes-sync.ts, before each detailUrl call)
    const h = headFn(c, s, padded), t = treeFn(c, s, padded), x = senateRollCallUrl(c, s, padded, "xml"), m = senateRollCallUrl(c, s, padded, "htm");
    if (h === t) same++;
    if (h === x) xml++;
    if (h !== m) htmDiffers++;
    say(`  (${c}, ${s}, ${r}): HEAD ${h} · tree ${h === t ? "byte-identical" : `DIFFERS ${t}`} · senateRollCallUrl "xml" ${h === x ? "identical" : "DIFFERS"} · "htm" ${h !== m ? "differs (the control)" : "IDENTICAL"}`);
  }
  check("C", "HEAD's detailUrl equals the tree's, byte for byte", same === triples.length, `${same} of ${triples.length}`);
  check("C", "and equals senateRollCallUrl(…, \"xml\")", xml === triples.length, `${xml} of ${triples.length}`);
  check("C", "the control: the same comparison with \"htm\" differs", htmDiffers === triples.length, `${htmDiffers} of ${triples.length}`);
  const hits = grepTree("roll_call_votes/vote");
  check("C", "\"roll_call_votes/vote\" in lib app components: one site", hits.length === 1, hits.join(" · ") || "none");
}

// ── servers ─────────────────────────────────────────────────────────────────
function listeningPids(): number[] {
  const o = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(o.split(/\s+/).filter(Boolean).map(Number))];
}
async function startServer(dir: string, tag: string, copy: CopyKind) {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  rmSync(path.join(dir, ".next", "cache", "fetch-cache"), { recursive: true, force: true });
  const env: NodeJS.ProcessEnv = { ...cleanEnv(), TURSO_DATABASE_URL: copyUrl(copyPath(copy)), TURSO_AUTH_TOKEN: "", CRON_SECRET: randomBytes(18).toString("hex") };
  const log = path.join(DIR, `server786-${tag}-${LABEL}-${Date.now()}.log`);
  const ws = createWriteStream(log);
  const server = spawn(process.execPath, [path.join(dir, "node_modules/next/dist/bin/next"), "start", "-p", String(PORT)], { cwd: dir, env, stdio: ["ignore", "pipe", "pipe"] });
  server.stdout.on("data", (b: Buffer) => ws.write(b));
  server.stderr.on("data", (b: Buffer) => ws.write(b));
  const kill = async () => {
    try { execFileSync("taskkill", ["/PID", String(server.pid), "/T", "/F"], { stdio: "ignore" }); } catch { /* gone */ }
    ws.end();
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
  const dirty = execFileSync("git", ["-C", dir, "status", "--porcelain"], { encoding: "utf8" }).split("\n").filter(Boolean).length;
  say(`  server :${PORT} (pid ${server.pid}; listener ${pids.join(",")}) · ${tag} build in ${path.basename(dir)} at ${at}${dirty ? ` + ${dirty} changed files (the tree's)` : ""} · the ${copy} copy (its own sentinel) · fetch-cache cleared · log ${path.basename(log)}`);
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
async function go(page: Page, route: string): Promise<number | null> {
  const res = await page.goto(`${BASE}${route}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  return res ? res.status() : null;
}
type Line = { n: number; text: string | null; links: { text: string; href: string | null }[] };
const READ_SOURCES = `(() => {
  const els = Array.from(document.querySelectorAll('[data-sources]'));
  const el = els[0];
  return {
    n: els.length,
    text: el ? el.innerText.split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ') : null,
    links: el ? Array.from(el.querySelectorAll('a')).map((a) => ({ text: (a.textContent || '').trim(), href: a.getAttribute('href') })) : [],
  };
})()`;
const READ_ATTRIB = `(() => {
  const s = Array.from(document.querySelectorAll('span')).find((x) => (x.textContent || '').includes('Member data via Congress.gov'));
  return s ? s.textContent.split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ') : null;
})()`;
// The foot is the span holding "synced 4× daily" AND the raters' links (since HO 786 the phrase has its own
// nowrap span inside it). Beside its text: how many rows the foot and LAST SYNC take, and how many rows each of
// the two phrases spans (1 = whole), read by a Range over the phrase's own characters, so HEAD, where the
// phrase is a bare text node, reads on the same instrument.
const READ_FOOT = `(() => {
  const foot = Array.from(document.querySelectorAll('span')).find((s) => (s.textContent || '').includes('synced 4') && s.querySelector('a'));
  if (!foot) return null;
  const tops = (rects) => new Set(Array.from(rects).filter((x) => x.width > 0).map((x) => Math.round(x.top))).size;
  const rowsOf = (node) => { const r = document.createRange(); r.selectNodeContents(node); return tops(r.getClientRects()); };
  const piecesOf = (root, phrase) => {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      const i = n.textContent.indexOf(phrase);
      if (i === -1) continue;
      const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + phrase.length);
      return tops(r.getClientRects());
    }
    return null;
  };
  const sync = Array.from(document.querySelectorAll('span')).find((s) => (s.textContent || '').trim().startsWith('LAST SYNC'));
  const time = sync ? sync.querySelector('span') : null;
  const nowrap = (el) => !!el && getComputedStyle(el).whiteSpace === 'nowrap';
  return {
    text: foot.innerText.split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' '),
    links: Array.from(foot.querySelectorAll('a')).map((a) => ({ text: (a.textContent || '').trim(), href: a.getAttribute('href') })),
    rows: rowsOf(foot),
    syncRows: sync ? rowsOf(sync) : null,
    syncedPieces: piecesOf(foot, 'synced 4× daily'),
    timePieces: time ? piecesOf(time, (time.textContent || '').trim()) : null,
    syncedNowrap: Array.from(foot.querySelectorAll('span')).some((s) => (s.textContent || '').trim() === 'synced 4× daily' && nowrap(s)),
    timeNowrap: nowrap(time),
    // The "ratings as of" range's dates (the second review reply): each date's pieces, and whether the element
    // holding its text is nowrap.
    dates: (() => {
      const out = [];
      const w = document.createTreeWalker(foot, NodeFilter.SHOW_TEXT);
      for (let n = w.nextNode(); n; n = w.nextNode()) {
        const re = /\\d{4}-\\d{2}-\\d{2}/g;
        for (let m = re.exec(n.textContent); m; m = re.exec(n.textContent)) {
          const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
          out.push({ date: m[0], pieces: tops(r.getClientRects()), nowrap: nowrap(n.parentElement) });
        }
      }
      return out;
    })(),
  };
})()`;
type Foot = {
  text: string; links: { text: string; href: string | null }[];
  rows: number; syncRows: number | null; syncedPieces: number | null; timePieces: number | null; syncedNowrap: boolean; timeNowrap: boolean;
  dates: { date: string; pieces: number; nowrap: boolean }[];
} | null;
// The band, the line under it, and what follows.
const READ_BAND = `(() => {
  const band = document.querySelector('.electoral-tl-band--top');
  const line = document.querySelector('[data-sources]');
  const b = band ? band.getBoundingClientRect() : null, l = line ? line.getBoundingClientRect() : null;
  const next = line ? line.nextElementSibling : null;
  const n = next ? next.getBoundingClientRect() : null;
  return { bandBottom: b ? b.bottom : null, lineTop: l ? l.top : null, lineBottom: l ? l.bottom : null, nextTop: n ? n.top : null, followsBand: !!(line && line.previousElementSibling === band) };
})()`;
type Band = { bandBottom: number | null; lineTop: number | null; lineBottom: number | null; nextTop: number | null; followsBand: boolean };

// The bill's row in the /bills feed, opened: the panel's news meta.
async function panelMeta(page: Page, sponsor: string): Promise<{ found: boolean; metas: string[] }> {
  await go(page, `/bills?sponsor=${encodeURIComponent(sponsor)}`);
  const num = BILL_A.split("-").pop()!;
  const row = page.locator("li", { hasText: num }).filter({ has: page.locator('[role="button"][aria-expanded]') }).first();
  if ((await row.count()) === 0) return { found: false, metas: [] };
  await row.locator('[role="button"][aria-expanded]').first().click();
  await page.locator(".bxp-relnews-meta").first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
  return { found: true, metas: (await page.locator(".bxp-relnews-meta").allTextContents()).map((s) => s.replace(/\s+/g, " ").trim()) };
}

// ── the smoke test and the narrow spec on a server ──────────────────────────
function playwright(tag: string, args: string[], logName: string, timeout: number) {
  const r = spawnSync(process.execPath, [PW, "test", ...args], { env: { ...cleanEnv(), BASE_URL: BASE }, encoding: "utf8", timeout });
  const log = redactSecrets(`${r.stdout ?? ""}${r.stderr ?? ""}`);
  writeFileSync(path.join(ART, `${logName}-${tag}-${LABEL}.log`), log);
  return { exit: r.status, log, passed: Number(log.match(/(\d+) passed/)?.[1] ?? 0), failed: Number(log.match(/(\d+) failed/)?.[1] ?? 0) };
}
function smoke(tag: string) {
  const r = playwright(tag, ["e2e/smoke.spec.ts", "--grep", SMOKE_TITLE, "--retries=0", "--workers=1", "--reporter=list"], "smoke", 300_000);
  const error = (r.log.match(/Error: [^\n]*/)?.[0] ?? "").slice(0, 220);
  const at = (r.log.match(/smoke\.spec\.ts:(\d+):\d+/g) ?? []).slice(-1)[0] ?? "";
  return { exit: r.exit, passed: r.passed, failed: r.failed, error, at };
}
function narrow(tag: string) {
  const r = playwright(tag, ["e2e/narrow.spec.ts", "--retries=0", "--workers=2", "--reporter=list"], "narrow", 900_000);
  const cells = [...r.log.matchAll(/\[narrow (\d+) ([^\]]+)\] [^\n]*?over=(-?\d+)/g)].map((m) => ({ width: Number(m[1]), slug: m[2]!, over: Number(m[3]) }));
  return { exit: r.exit, passed: r.passed, failed: r.failed, cells };
}

// ── leg I: captures ─────────────────────────────────────────────────────────
type Surface = { slug: string; route: string; full: boolean; panel?: boolean };
function surfaces(senator: string, houseMember: string): Surface[] {
  return [
    { slug: "vote-senate", route: `/vote/${SENATE_VOTE}`, full: true },
    { slug: "vote-house", route: `/vote/${HOUSE_VOTE}`, full: true },
    { slug: "member-senator", route: `/members/${senator}`, full: true },
    { slug: "member-house", route: `/members/${houseMember}`, full: true },
    { slug: "lobbying", route: "/lobbying", full: true },
    { slug: "electoral", route: "/electoral", full: false },
    { slug: "welcome", route: "/welcome", full: true },
    { slug: "bill", route: `/bill/${BILL_A}`, full: true },
    { slug: "bills-panel", route: `/bills?sponsor=${houseMember}`, full: true, panel: true },
  ];
}
const VIEWS = [
  { w: 1440, h: 900, reduced: false, s: "1440" },
  { w: 2560, h: 1440, reduced: false, s: "2560" },
  { w: 1440, h: 900, reduced: true, s: "1440-reduced" },
  { w: 2560, h: 1440, reduced: true, s: "2560-reduced" },
  { w: 430, h: 932, reduced: false, s: "430" },
];
type Shot = { file: string; reducedRead: boolean | null; over: number | null; lineFits: boolean | null };
async function captures(browser: Browser, tag: "HEAD" | "tree", list: Surface[], houseMember: string): Promise<Shot[]> {
  const shots: Shot[] = [];
  for (const v of VIEWS) {
    if (tag === "HEAD" && v.s !== "1440") continue;
    const { ctx, page } = await newPage(browser, v.w, v.h, v.reduced);
    for (const s of list) {
      if (s.panel) await panelMeta(page, houseMember);
      else await go(page, s.route);
      await sleep(500);
      const reducedRead = v.reduced ? ((await page.evaluate(`matchMedia('(prefers-reduced-motion: reduce)').matches`)) as boolean) : null;
      const m = (await page.evaluate(`(() => {
        const se = document.scrollingElement;
        const line = document.querySelector('[data-sources]');
        const r = line ? line.getBoundingClientRect() : null;
        return { over: se.scrollWidth - se.clientWidth, fits: r ? r.left >= 0 && r.right <= se.clientWidth + 0.5 : null };
      })()`)) as { over: number; fits: boolean | null };
      const file = `${tag}-${s.slug}-${v.s}.png`;
      await page.screenshot({ path: path.join(SHOTS, file), fullPage: s.full });
      shots.push({ file, reducedRead, over: v.w === 430 ? m.over : null, lineFits: v.w === 430 ? m.fits : null });
    }
    await ctx.close();
  }
  return shots;
}

// ── the legs on the servers ─────────────────────────────────────────────────
type Session = {
  statuses: Record<string, number | null>;
  billA: { html: Record<string, number>; dom: Record<string, number> };
  billCtrl: { html: number; dom: number };
  panel: { found: boolean; metas: string[] };
  voteSenate: Line; voteHouse: Line; houseSenateAnchors: number;
  attribSenator: string | null; attribHouse: string | null;
  lobbying: Line; electoral: Line; band: Band; foot: Foot; feet: Record<string, Foot>;
  css: { sheets: string[]; sourceLink: number; electoralSources: number };
  smoke: ReturnType<typeof smoke>; narrow: ReturnType<typeof narrow>; shots: Shot[];
};
async function session(dir: string, tag: "HEAD" | "tree", copy: CopyKind, browser: Browser, ids: { senator: string; houseMember: string }): Promise<Session> {
  const srv = await startServer(dir, tag, copy);
  try {
    const statuses: Record<string, number | null> = {};
    // A: the served HTML, and the DOM's text, of the two bills.
    const htmlOf = async (route: string) => { const r = await fetch(`${BASE}${route}`, { headers: { cookie: "ct_seen=1" } }); statuses[route] = r.status; return r.text(); };
    const hA = await htmlOf(`/bill/${BILL_A}`);
    const hC = await htmlOf(`/bill/${BILL_CTRL}`);
    const { ctx, page } = await newPage(browser, 1440, 900, true);
    await go(page, `/bill/${BILL_A}`);
    const tA = (await page.evaluate("document.body.innerText")) as string;
    await go(page, `/bill/${BILL_CTRL}`);
    const tC = (await page.evaluate("document.body.innerText")) as string;
    const keys = ["THE_HILL", "ROLL_CALL", "THE HILL", "ROLL CALL"];
    const billA = { html: Object.fromEntries(keys.map((k) => [k, count(hA, k)])), dom: Object.fromEntries(keys.map((k) => [k, count(tA, k)])) };
    const billCtrl = { html: count(hC, "POLITICO"), dom: count(tC, "POLITICO") };
    const panel = await panelMeta(page, ids.houseMember);
    // B
    statuses[`/vote/${SENATE_VOTE}`] = await go(page, `/vote/${SENATE_VOTE}`);
    const voteSenate = (await page.evaluate(READ_SOURCES)) as Line;
    statuses[`/vote/${HOUSE_VOTE}`] = await go(page, `/vote/${HOUSE_VOTE}`);
    const voteHouse = (await page.evaluate(READ_SOURCES)) as Line;
    const houseSenateAnchors = (await page.evaluate(`document.querySelectorAll('a[href*="senate.gov"]').length`)) as number;
    // D
    statuses[`/members/${ids.senator}`] = await go(page, `/members/${ids.senator}`);
    const attribSenator = (await page.evaluate(READ_ATTRIB)) as string | null;
    statuses[`/members/${ids.houseMember}`] = await go(page, `/members/${ids.houseMember}`);
    const attribHouse = (await page.evaluate(READ_ATTRIB)) as string | null;
    // E
    statuses["/lobbying"] = await go(page, "/lobbying");
    const lobbying = (await page.evaluate(READ_SOURCES)) as Line;
    // F
    statuses["/electoral"] = await go(page, "/electoral");
    const electoral = (await page.evaluate(READ_SOURCES)) as Line;
    const band = (await page.evaluate(READ_BAND)) as Band;
    // G
    statuses["/welcome"] = await go(page, "/welcome");
    const foot = (await page.evaluate(READ_FOOT)) as Foot;
    // G, the foot's wrap at the three capture widths (HO 786's review reply: breaks fall between phrases).
    const feet: Record<string, Foot> = {};
    for (const [w, h] of [[1440, 900], [2560, 1440], [430, 932]] as const) {
      const { ctx: c, page: p } = await newPage(browser, w, h, true);
      await go(p, "/welcome");
      feet[String(w)] = (await p.evaluate(READ_FOOT)) as Foot;
      await c.close();
    }
    await ctx.close();
    // H: the stylesheets /lobbying links, as served.
    const lob = await (await fetch(`${BASE}/lobbying`, { headers: { cookie: "ct_seen=1" } })).text();
    const sheets = [...lob.matchAll(/<link[^>]+rel="stylesheet"[^>]*href="([^"]+)"/g), ...lob.matchAll(/<link[^>]+href="([^"]+\.css[^"]*)"[^>]*rel="stylesheet"/g)].map((m) => m[1]!);
    let css = "";
    for (const s of [...new Set(sheets)]) css += await (await fetch(new URL(s, BASE))).text();
    const cssRead = { sheets: [...new Set(sheets)], sourceLink: count(css, ".source-link"), electoralSources: count(css, ".electoral-sources") };

    say(`    ${tag}: HTTP ${JSON.stringify(statuses)}`);
    say(`    ${tag}: A /bill/${BILL_A} served HTML ${JSON.stringify(billA.html)} · DOM ${JSON.stringify(billA.dom)} · /bill/${BILL_CTRL} POLITICO HTML ${billCtrl.html}, DOM ${billCtrl.dom}`);
    say(`    ${tag}: A the panel on /bills?sponsor=${ids.houseMember}: row ${panel.found ? "found" : "NOT FOUND"} · ${panel.metas.length} news metas: ${panel.metas.slice(0, 3).map((m) => `"${m}"`).join(" · ")}${panel.metas.length > 3 ? " · …" : ""}`);
    say(`    ${tag}: B Senate vote line ${voteSenate.n ? `"${voteSenate.text}" ${JSON.stringify(voteSenate.links)}` : "none"} · House vote line ${voteHouse.n ? `"${voteHouse.text}" ${JSON.stringify(voteHouse.links)}` : "none"} · senate.gov anchors on the House page ${houseSenateAnchors}`);
    say(`    ${tag}: D senator ${ids.senator}: "${attribSenator}" · House member ${ids.houseMember}: "${attribHouse}"`);
    say(`    ${tag}: E /lobbying line ${lobbying.n ? `"${lobbying.text}" ${JSON.stringify(lobbying.links)}` : "none"}`);
    say(`    ${tag}: F /electoral line ${electoral.n ? `"${electoral.text}" ${JSON.stringify(electoral.links)}` : "none"} · band bottom ${band.bandBottom} · line ${band.lineTop}..${band.lineBottom} · next ${band.nextTop} · directly after the band ${band.followsBand}`);
    say(`    ${tag}: G /welcome foot "${foot?.text ?? "none"}"`);
    for (const [w, f] of Object.entries(feet)) say(`    ${tag}: G the foot at ${w}: ${f ? `${f.rows} row(s), LAST SYNC ${f.syncRows} · "synced 4× daily" in ${f.syncedPieces} piece(s)${f.syncedNowrap ? " (nowrap)" : ""} · the time in ${f.timePieces} piece(s)${f.timeNowrap ? " (nowrap)" : ""} · the dates ${f.dates.map((d) => `${d.date} in ${d.pieces}${d.nowrap ? " (nowrap)" : ""}`).join(", ") || "none"}` : "none"}`);
    say(`    ${tag}: H stylesheets ${cssRead.sheets.join(", ")} · .source-link ${cssRead.sourceLink} · .electoral-sources ${cssRead.electoralSources}`);
    const sm = smoke(tag);
    say(`    ${tag}: the smoke test: exit ${sm.exit} · ${sm.passed} passed · ${sm.failed} failed${sm.error ? ` · first error "${sm.error}"${sm.at ? ` at ${sm.at}` : ""}` : ""}`);
    const nr = narrow(tag);
    const overs = nr.cells.filter((c) => c.over > 1);
    say(`    ${tag}: e2e/narrow.spec.ts: exit ${nr.exit} · ${nr.passed} passed · ${nr.failed} failed · ${nr.cells.length} cells · over > 1px: ${overs.length ? overs.map((c) => `${c.width} ${c.slug} ${c.over}`).join(", ") : "none"}`);
    const shots = await captures(browser, tag, surfaces(ids.senator, ids.houseMember), ids.houseMember);
    say(`    ${tag}: ${shots.length} captures`);
    return { statuses, billA, billCtrl, panel, voteSenate, voteHouse, houseSenateAnchors, attribSenator, attribHouse, lobbying, electoral, band, foot, feet, css: cssRead, smoke: sm, narrow: nr, shots };
  } finally { await srv.kill(); }
}

async function run(headDir: string, treeDir: string) {
  for (const d of [headDir, treeDir]) if (!existsSync(path.join(d, ".next", "BUILD_ID"))) throw new Error(`no build in ${d}`);
  mkdirSync(SHOTS, { recursive: true });
  const before = await schemaPrint();
  // The members: the two bills' sponsors, read from the tree's copy.
  const ids = await withDb(copyUrl(copyPath("tree")), async (db) => {
    const sp = async (b: string) => (await db.execute({ sql: `SELECT b.sponsor_bioguide_id AS id, m.chamber AS ch FROM bills b LEFT JOIN members m ON m.bioguide_id = b.sponsor_bioguide_id WHERE b.id = ?`, args: [b] })).rows[0]!;
    const s = await sp(BILL_CTRL), h = await sp(BILL_A);
    const hill = (await db.execute({ sql: `SELECT COUNT(*) AS n FROM news_mentions WHERE bill_id = ? AND source IN ('the_hill','roll_call')`, args: [BILL_A] })).rows[0]!.n;
    say(`  the senator: ${s.id} (${s.ch}), ${BILL_CTRL}'s sponsor · the House member: ${h.id} (${h.ch}), ${BILL_A}'s sponsor · ${BILL_A}'s The Hill / Roll Call mentions on the copy: ${hill}`);
    if (s.ch !== "senate" || h.ch !== "house") throw new Error("the members' chambers aren't senate and house");
    return { senator: String(s.id), houseMember: String(h.id) };
  });
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    say(`\n── HEAD's server (the red)`);
    const H = await session(headDir, "HEAD", "head", browser, ids);
    say(`\n── the tree's server (the green)`);
    const T = await session(treeDir, "tree", "tree", browser, ids);

    say(`\n── the checks`);
    check("pages", "every page answers 200 on both builds", [H, T].every((x) => Object.values(x.statuses).every((v) => v === 200)), `HEAD ${JSON.stringify(H.statuses)} · tree ${JSON.stringify(T.statuses)}`);
    const slug = (x: Session) => x.billA.html.THE_HILL! + x.billA.html.ROLL_CALL!;
    const named = (x: Session) => x.billA.html["THE HILL"]! + x.billA.html["ROLL CALL"]!;
    check("A", "HEAD red: the bill page prints the slug (THE_HILL / ROLL_CALL ≥ 1)", slug(H) >= 1, `HTML ${slug(H)} · DOM ${H.billA.dom.THE_HILL! + H.billA.dom.ROLL_CALL!}`);
    check("A", "the tree green: no slug, the name (THE HILL / ROLL CALL ≥ 1)", slug(T) === 0 && named(T) >= 1, `slug HTML ${slug(T)} · name HTML ${named(T)}, DOM ${T.billA.dom["THE HILL"]! + T.billA.dom["ROLL CALL"]!}`);
    check("A", "the control: POLITICO on the control bill, the same both sides", H.billCtrl.dom >= 1 && H.billCtrl.dom === T.billCtrl.dom && H.billCtrl.html === T.billCtrl.html, `HEAD HTML ${H.billCtrl.html} / DOM ${H.billCtrl.dom} · tree HTML ${T.billCtrl.html} / DOM ${T.billCtrl.dom}`);
    const pm = (x: Session, s: string) => x.panel.metas.filter((m) => m.includes(s)).length;
    check("A", "the panel: HEAD's meta reads THE_HILL, the tree's THE HILL", H.panel.found && T.panel.found && pm(H, "THE_HILL") >= 1 && pm(T, "THE_HILL") === 0 && pm(T, "THE HILL") >= 1, `HEAD THE_HILL ${pm(H, "THE_HILL")} · tree THE_HILL ${pm(T, "THE_HILL")}, THE HILL ${pm(T, "THE HILL")}`);

    const [, sc, ss, sr] = SENATE_VOTE.split("-").map(Number);
    const senateHref = senateRollCallUrl(sc!, ss!, sr!, "htm");
    check("B", "HEAD red: no line on either vote page", H.voteSenate.n === 0 && H.voteHouse.n === 0, `${H.voteSenate.n}/${H.voteHouse.n}`);
    check("B", "the tree green: one line on each", T.voteSenate.n === 1 && T.voteHouse.n === 1, `${T.voteSenate.n}/${T.voteHouse.n}`);
    check("B", "the Senate anchor is senateRollCallUrl(…, \"htm\") for that vote", T.voteSenate.links.length === 1 && T.voteSenate.links[0]!.href === senateHref && /roll call via senate\.gov/i.test(T.voteSenate.text ?? ""), `${JSON.stringify(T.voteSenate.links)} · want ${senateHref}`);
    check("B", "the control: the House page holds no senate.gov anchor, and names Congress.gov", T.houseSenateAnchors === 0 && T.voteHouse.links.length === 0 && /roll call via congress\.gov/i.test(T.voteHouse.text ?? ""), `senate.gov anchors ${T.houseSenateAnchors} · "${T.voteHouse.text}"`);

    const sv = (s: string | null) => count(s ?? "", "Senate votes via senate.gov");
    check("D", "a senator's page: 0 on HEAD, 1 on the tree", !!H.attribSenator && sv(H.attribSenator) === 0 && sv(T.attribSenator) === 1, `HEAD ${sv(H.attribSenator)} · tree ${sv(T.attribSenator)}`);
    check("D", "a House member's page: 0 both sides", !!H.attribHouse && !!T.attribHouse && sv(H.attribHouse) === 0 && sv(T.attribHouse) === 0, `HEAD ${sv(H.attribHouse)} · tree ${sv(T.attribHouse)}`);

    check("E", "/lobbying: 0 → 1 with an lda.gov anchor", H.lobbying.n === 0 && T.lobbying.n === 1 && T.lobbying.links.length === 1 && T.lobbying.links[0]!.href === LDA_HOME_URL && /filings via lda\.gov/i.test(T.lobbying.text ?? ""), `HEAD ${H.lobbying.n} · tree ${T.lobbying.n} "${T.lobbying.text}" ${JSON.stringify(T.lobbying.links)}`);

    check("F", "/electoral: 0 → 1; 270toWin linked to PRIMARY_CALENDAR_URL, Ballotpedia named, unlinked", H.electoral.n === 0 && T.electoral.n === 1 && T.electoral.links.length === 1 && T.electoral.links[0]!.href === PRIMARY_CALENDAR_URL && /candidates and results via ballotpedia/i.test(T.electoral.text ?? ""), `HEAD ${H.electoral.n} · tree "${T.electoral.text}" ${JSON.stringify(T.electoral.links)}`);
    const gap = T.band.lineTop != null && T.band.bandBottom != null ? T.band.lineTop - T.band.bandBottom : null;
    check("F", "the line sits directly after the band, 6px under it", T.band.followsBand && gap !== null && Math.abs(gap - 6) <= 1, `gap ${gap}px`);
    const cal = grepTree("2026-state-primary-calendar");
    check("F", "\"2026-state-primary-calendar\" in lib app components: once", cal.length === 1, cal.join(" · "));

    const inFoot = (x: Session, s: string) => count(x.foot?.text ?? "", s);
    const raters = (x: Session) => (x.foot?.links ?? []).length;
    check("G", "/welcome's foot: lda.gov 0 → 1", inFoot(H, "lda.gov") === 0 && inFoot(T, "lda.gov") === 1, `HEAD ${inFoot(H, "lda.gov")} · tree ${inFoot(T, "lda.gov")}`);
    check("G", "and Ballotpedia 0 → 1 (claim 5)", inFoot(H, "Ballotpedia") === 0 && inFoot(T, "Ballotpedia") === 1, `HEAD ${inFoot(H, "Ballotpedia")} · tree ${inFoot(T, "Ballotpedia")}`);
    check("G", "the three rater anchors, 3 both sides", raters(H) === 3 && raters(T) === 3, `HEAD ${raters(H)} · tree ${raters(T)}`);
    const widths = ["1440", "2560", "430"];
    const fw = (x: Session, w: string) => x.feet[w];
    check("G", "the tree: both phrases nowrap, and each whole at 1440, 2560 and 430", widths.every((w) => fw(T, w)?.syncedNowrap && fw(T, w)?.timeNowrap && fw(T, w)?.syncedPieces === 1 && fw(T, w)?.timePieces === 1), widths.map((w) => `${w}: synced ${fw(T, w)?.syncedPieces}, time ${fw(T, w)?.timePieces}`).join(" · "));
    check("G", "the control: the same row counter reads the tree's foot as more than one row at 1440", (fw(T, "1440")?.rows ?? 0) >= 2, `tree's foot ${fw(T, "1440")?.rows} rows at 1440 · HEAD's ${fw(H, "1440")?.rows}`);
    check("G", "the tree: each date of the ratings range nowrap and whole at 1440, 2560 and 430", widths.every((w) => (fw(T, w)?.dates.length ?? 0) > 0 && fw(T, w)!.dates.every((d) => d.nowrap && d.pieces === 1)), widths.map((w) => `${w}: ${(fw(T, w)?.dates ?? []).map((d) => `${d.date} ${d.pieces}`).join(", ")}`).join(" · "));

    check("H", "the served stylesheet: .source-link and .electoral-sources absent on HEAD, present on the tree", H.css.sourceLink === 0 && H.css.electoralSources === 0 && T.css.sourceLink >= 1 && T.css.electoralSources >= 1, `HEAD ${H.css.sourceLink}/${H.css.electoralSources} · tree ${T.css.sourceLink}/${T.css.electoralSources} · ${T.css.sheets.length} sheet(s)`);

    check("smoke", "HEAD red: the test fails", H.smoke.failed === 1 && H.smoke.passed === 0, `${H.smoke.failed} failed · "${H.smoke.error}"${H.smoke.at ? ` at ${H.smoke.at}` : ""}`);
    check("smoke", "the tree green: the test passes", T.smoke.passed === 1 && T.smoke.failed === 0 && T.smoke.exit === 0, `${T.smoke.passed} passed`);
    const key = (c: { width: number; slug: string }) => `${c.width} ${c.slug}`;
    const hOver = new Map(H.narrow.cells.map((c) => [key(c), c.over]));
    const worse = T.narrow.cells.filter((c) => c.over > 1 && (hOver.get(key(c)) ?? 0) <= 1);
    check("narrow", "the tree's local width reading: no route over that HEAD reads clean", T.narrow.cells.length > 0 && worse.length === 0, `tree ${T.narrow.passed} passed / ${T.narrow.failed} failed, ${T.narrow.cells.length} cells · HEAD ${H.narrow.passed} / ${H.narrow.failed} · new overs ${worse.map((c) => `${key(c)} ${c.over}`).join(", ") || "none"}`);

    const reduced = T.shots.filter((s) => s.reducedRead !== null);
    check("I", "every reduced-motion capture read prefers-reduced-motion back true in the page", reduced.length > 0 && reduced.every((s) => s.reducedRead === true), `${reduced.filter((s) => s.reducedRead).length} of ${reduced.length}`);
    const narrowShots = T.shots.filter((s) => s.over !== null);
    check("I", "at 430 every surface's document holds its width and the line fits", narrowShots.every((s) => (s.over ?? 0) <= 1 && s.lineFits !== false), narrowShots.map((s) => `${s.file.replace(/^tree-|-430\.png$/g, "")} over ${s.over}${s.lineFits === null ? "" : s.lineFits ? " fits" : " LINE OVER"}`).join(" · "));
    check("I", "every capture written", [...H.shots, ...T.shots].every((s) => existsSync(path.join(SHOTS, s.file))), `${H.shots.length} HEAD · ${T.shots.length} tree`);
    writeFileSync(path.join(ART, `legs-${LABEL}.json`), JSON.stringify({ ids, head: H, tree: T }, null, 1));
  } finally { await browser.close(); }
  await prodSchemaUnchanged("the run", before);
}

// ── the width re-read ───────────────────────────────────────────────────────
// r1's narrow runs stopped answering in their last stretch at 390 on both builds (page.goto timeouts), and
// /stale answered 500 on both, its query naming an index the copies lacked (idx_bills_dash_stage, made outside
// scripts/migrate.ts). So: prod's indexes the copies lack, read by SELECT and made on the two copies only, then
// e2e/narrow.spec.ts's tests at one width (--width, 390 by default) on a fresh server per build, one worker.
async function narrow390(headDir: string, treeDir: string) {
  const W = argAt("--width") ?? "390";
  if (W !== "390" && W !== "430") throw new Error(`--width is 390 or 430, not ${W}`);
  for (const copy of COPIES) if (!existsSync(copyPath(copy))) throw new Error(`no copy at ${copyPath(copy)}: pass the seed's label as --copies`);
  const before = await schemaPrint();
  const db = prodClient();
  const prodIdx = (await reader(db)(`SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' AND sql IS NOT NULL ORDER BY name`)).rows.map((r) => ({ name: String(r.name), table: String(r.tbl_name), sql: String(r.sql) }));
  db.close();
  for (const copy of COPIES) {
    await withDb(copyUrl(copyPath(copy)), async (c) => {
      const have = new Set((await c.execute(`SELECT name FROM sqlite_master WHERE type = 'index'`)).rows.map((r) => String(r.name)));
      const missing = prodIdx.filter((i) => !have.has(i.name));
      for (const i of missing) await c.execute(i.sql);
      say(`  the ${copy} copy: prod has ${prodIdx.length} indexes; ${missing.length} missing here, now made: ${missing.map((i) => `${i.name} (${i.table})`).join(", ") || "none"}`);
    });
  }
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const runs: Record<string, ReturnType<typeof narrow>> = {};
  try {
    for (const [dir, tag, copy] of [[headDir, "HEAD", "head"], [treeDir, "tree", "tree"]] as const) {
      const srv = await startServer(dir, tag, copy);
      try {
        const r = playwright(tag, ["e2e/narrow.spec.ts", "--grep", `@${W}`, "--retries=0", "--workers=1", "--reporter=list"], `narrow${W}`, 1_800_000);
        const cells = [...r.log.matchAll(/\[narrow (\d+) ([^\]]+)\] [^\n]*?over=(-?\d+)/g)].map((m) => ({ width: Number(m[1]), slug: m[2]!, over: Number(m[3]) }));
        const failedTitles = [...r.log.matchAll(/✘\s+\d+ \[chromium\] › [^\n]*? › ([^\n]*?) @(\d+)/g)].map((m) => m[1]!.trim());
        runs[tag] = { exit: r.exit, passed: r.passed, failed: r.failed, cells };
        say(`    ${tag} @${W}: exit ${r.exit} · ${r.passed} passed · ${r.failed} failed${failedTitles.length ? ` (${failedTitles.join("; ")})` : ""} · ${cells.length} cells · over > 1px: ${cells.filter((c) => c.over > 1).map((c) => `${c.slug} ${c.over}`).join(", ") || "none"}`);
      } finally { await srv.kill(); }
    }
  } finally { await browser.close(); }
  const H = runs.HEAD!, T = runs.tree!;
  const hOver = new Map(H.cells.map((c) => [c.slug, c.over]));
  const changed = ["vote", "bill-detail", "member-detail", "lobbying", "electoral", "welcome"];
  const read = (x: typeof H, s: string) => x.cells.find((c) => c.slug === s);
  check("narrow", `@${W}, the changed surfaces read on both builds`, changed.every((s) => read(H, s) && read(T, s)), changed.map((s) => `${s} HEAD ${read(H, s)?.over ?? "UNREAD"} / tree ${read(T, s)?.over ?? "UNREAD"}`).join(" · "));
  const worse = T.cells.filter((c) => c.over > 1 && (hOver.get(c.slug) ?? 0) <= 1);
  check("narrow", `@${W}, no route over on the tree that HEAD reads clean, and the same cells read`, worse.length === 0 && T.cells.length === H.cells.length, `HEAD ${H.cells.length} cells · tree ${T.cells.length} · new overs ${worse.map((c) => `${c.slug} ${c.over}`).join(", ") || "none"}`);
  await prodSchemaUnchanged(`the ${W} re-read`, before);
}

// ── /electoral's fit (HO 784's leg C, read again) ───────────────────────────
// The line under the band moves everything below it down. HO 784 ruled the box's floor (BOX_MIN) and the short
// scroll it leaves at 1440x900 (option c); this reads the document's scroll on both builds, both tabs.
async function fit(headDir: string, treeDir: string) {
  for (const copy of COPIES) if (!existsSync(copyPath(copy))) throw new Error(`no copy at ${copyPath(copy)}: pass the seed's label as --copies`);
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  const reads: Record<string, number> = {};
  try {
    for (const [dir, tag, copy] of [[headDir, "HEAD", "head"], [treeDir, "tree", "tree"]] as const) {
      const srv = await startServer(dir, tag, copy);
      try {
        for (const [w, h] of [[1440, 900], [2560, 1440]] as const) {
          for (const tab of ["SENATE", "HOUSE"] as const) {
            const { ctx, page } = await newPage(browser, w, h, true);
            await go(page, "/electoral");
            if (tab === "HOUSE") { await page.locator(".rl-tab", { hasText: "HOUSE" }).click(); await sleep(900); }
            const r = (await page.evaluate(`(() => {
              const se = document.scrollingElement;
              const box = document.querySelector('.rl-main > .rl-box');
              const b = box ? box.getBoundingClientRect() : null;
              return { scroll: se.scrollHeight - innerHeight, boxTop: b ? Math.round(b.top) : null, boxH: b ? Math.round(b.height) : null };
            })()`)) as { scroll: number; boxTop: number | null; boxH: number | null };
            await ctx.close();
            reads[`${tag} ${w}x${h} ${tab}`] = r.scroll;
            say(`    ${tag} ${w}x${h} ${tab}: document scroll ${r.scroll} · box top ${r.boxTop}, height ${r.boxH}`);
          }
        }
      } finally { await srv.kill(); }
    }
  } finally { await browser.close(); }
  for (const k of ["1440x900", "2560x1440"]) for (const tab of ["SENATE", "HOUSE"]) {
    const d = reads[`tree ${k} ${tab}`]! - reads[`HEAD ${k} ${tab}`]!;
    say(`  ${k} ${tab}: HEAD ${reads[`HEAD ${k} ${tab}`]} → tree ${reads[`tree ${k} ${tab}`]} (${d >= 0 ? "+" : ""}${d})`);
  }
  check("fit", "2560x1440: the document doesn't scroll on the tree, either tab", reads["tree 2560x1440 SENATE"] === 0 && reads["tree 2560x1440 HOUSE"] === 0, `SENATE ${reads["tree 2560x1440 SENATE"]} · HOUSE ${reads["tree 2560x1440 HOUSE"]}`);
}

async function main() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  say(`=== HO 786 · ${LABEL} · ${new Date().toISOString()} · checkout ${tree} · HEAD's sha ${HEAD_SHA} ===`);
  mkdirSync(ART, { recursive: true });
  if (process.argv.includes("--step0") || process.argv.includes("--counts")) {
    const db = prodClient();
    const read = reader(db);
    try {
      if (process.argv.includes("--step0")) {
        await claim3(read);
        await claim4();
        await claim6(read);
        await claim7(read);
      }
      if (process.argv.includes("--counts")) await counts(read);
    } finally { db.close(); }
  }
  if (process.argv.includes("--seed")) await seed();
  if (process.argv.includes("--leg-c")) await legC();
  if (process.argv.includes("--run")) await run(path.resolve(argAt("--head") ?? ""), path.resolve(argAt("--tree") ?? ""));
  if (process.argv.includes("--narrow390")) await narrow390(path.resolve(argAt("--head") ?? ""), path.resolve(argAt("--tree") ?? ""));
  if (process.argv.includes("--fit")) await fit(path.resolve(argAt("--head") ?? ""), path.resolve(argAt("--tree") ?? ""));
  if (passes + fails) say(`\n${LABEL}: ${passes} PASS · ${fails} FAIL${failed.length ? `\n  FAIL ${failed.join("\n  FAIL ")}` : ""}`);
  writeFileSync(path.join(ART, `${LABEL}.txt`), out.join("\n") + "\n");
}
main().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
