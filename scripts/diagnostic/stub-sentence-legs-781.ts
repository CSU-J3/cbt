// HO 781 legs 0-2: past election day a stub page drops its sentence and keeps its provenance line (§ 1), and the
// race page's news ages read the clock seam (§ 2). On `file:` copies of prod seeded by SELECT, each build's server
// runs on its own copy, HEAD's (2ffc153) as the red.
//
//   npx tsx scripts/diagnostic/stub-sentence-legs-781.ts --seed --label L
//   npx tsx scripts/diagnostic/stub-sentence-legs-781.ts --census --head <HEAD worktree> --label L
//   npx tsx scripts/diagnostic/stub-sentence-legs-781.ts --run --head <HEAD worktree> --tree <tree worktree> --label L
//
// STEP 0's measurement (--census): every 2026 race page on HEAD's build and the head copy at today's clock (no seam),
// its stub paragraph (RaceHubBody's isStub <p>) counted by form: "Incumbent running for re-election. No competitive
// rating yet.", "No competitive rating yet." alone, and "Open seat. Candidate filings forthcoming."
// Legs:
//   0  today's clock (no seam), the copies as seeded: every race page's server-rendered <main> byte-identical to
//      HEAD's, the stub sentences included. HEAD's news ages run on Date.now(), so the age spans are set aside, as
//      HO 780's r3 did. The census read here is STEP 0's again.
//   the plants, the same on each copy: the decided stub (a stub page whose box prints its incumbent alone, that row
//      marked), and one news item for leg 2, observed two minutes before the plant, on the non-stub page whose
//      incumbent has the newest news
//   1  the clock at Nov 4: the decided stub, HEAD red (the sentence under Decided · Nov 3, 2026) and the tree green (no
//      sentence, the provenance line kept, re-elected); an undecided stub (its No call on Ballotpedia line kept); an
//      open-seat stub if the census holds one; the census: no stub page on the tree prints a sentence, each stub
//      page's <main> is HEAD's less its sentence, and every other page's equals HEAD's, the news ages aside
//   2  § 2 at the same clock: on the tree every news age on every race page reads formatRelativeAge(observed_at,
//      Nov 4), and the leg-2 page read twice a minute apart in real time is byte-identical; on HEAD the ages read
//      against today, and the planted item's age moves between the two reads
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed, fingerprinted before and after. A copy is
// `file:${abs}` from a path ending -781-legs.db under the gitignored scratch directory; a server gets its copy's
// URL with TURSO_AUTH_TOKEN="" and a CRON_SECRET minted for the run. No leg runs a cron or fetches upstream. Every
// printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { formatRelativeAge } from "@/lib/format";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const HEAD_SHA = "2ffc153";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/781-artifacts"); // repo-ignored
const SHOTS = path.join(ART, "captures");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const PORT = 3781;
const BASE = `http://127.0.0.1:${PORT}`;
const NOV4 = "2026-11-04T15:00:00.000Z";
const SENTINEL_ROUTE = "/api/cron/nominations"; // no leg runs it
const WHOLE = [
  "races", "members", "member_ids", "race_ratings", "rating_history", "race_candidates", "kalshi_odds", "polymarket_odds",
  "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads",
  "palestine_scorecard", "member_ideology", "member_participation", "member_career_votes", "votes", "observations",
  "observation_entities", "dashboard_state",
];
const COPIES = ["head", "tree"] as const;
type CopyKind = (typeof COPIES)[number];
const FORMS = {
  running: "Incumbent running for re-election. No competitive rating yet.",
  rating: "No competitive rating yet.",
  open: "Open seat. Candidate filings forthcoming.",
} as const;
type Form = keyof typeof FORMS | "none" | "other";

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
  for (const t of ["race_candidates", "general_ballot", "general_ballot_reads", "primary_candidates", "primaries"])
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
  const cronOwned = new Set(["race_candidates", "general_ballot", "general_ballot_reads", "primary_candidates", "primaries"]);
  const unexplained = changed.filter((k) => !cronOwned.has(k) || runs.length === 0);
  check("seed", `prod untouched (${label}): every difference is a prod cron's own run overlapping the window`, unexplained.length === 0, `changed ${changed.join(", ")} · runs ${runs.join("; ") || "none"}${unexplained.length ? ` · UNEXPLAINED ${unexplained.join(", ")}` : ""}`);
}

// ── the copies ──────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-781-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-781-legs.db")) throw new Error(`refused: a copy must be a *-781-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
const sentinelFile = (kind: CopyKind) => path.join(DIR, `sentinel-${kind}-${LABEL}-781.txt`);
const plantedFile = () => path.join(ART, `planted-${LABEL}.json`);
const censusFile = () => path.join(ART, `census-${LABEL}.json`);
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
  const out: Record<string, unknown> = { counts };
  for (const kind of COPIES) {
    const abs = copyPath(kind);
    copyFileSync(tpl, abs);
    const at = new Date().toISOString();
    writeFileSync(sentinelFile(kind), at);
    await withDb(copyUrl(abs), async (db) => {
      const closed = await db.execute(`UPDATE cron_runs SET status = 'success', ended_at = started_at WHERE status = 'running'`);
      if (closed.rowsAffected) say(`  ${kind}: copied rows still running, closed on the copy: ${closed.rowsAffected}`);
      await db.execute({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 781, 'success', ?)`, args: [SENTINEL_ROUTE, at, at, JSON.stringify({ sentinel: `HO 781 legs, the ${kind} copy only` })] });
    });
    say(`  copy ${path.basename(abs)} · sentinel ${at}`);
    out[kind] = { at };
    await sleep(400);
  }
  if (existsSync(plantedFile())) rmSync(plantedFile());
  writeFileSync(path.join(ART, `seeded-${LABEL}.json`), JSON.stringify(out, null, 1));
  await prodUntouched("the seed", fp0, t0);
}

// ── servers ─────────────────────────────────────────────────────────────────
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
// `clock` null is today's clock: CBT_CLOCK_NOW unset, so clockNowMs() is Date.now().
async function startServer(dir: string, tag: string, copy: CopyKind, clock: string | null) {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  rmSync(path.join(dir, ".next", "cache", "fetch-cache"), { recursive: true, force: true });
  const secret = randomBytes(18).toString("hex");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: copyUrl(copyPath(copy)), CRON_SECRET: secret };
  env.TURSO_AUTH_TOKEN = "";
  if (clock) env.CBT_CLOCK_NOW = clock;
  else delete env.CBT_CLOCK_NOW;
  const log = path.join(DIR, `server781-${tag}-${LABEL}-${Date.now()}.log`);
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
  say(`  server :${PORT} (pid ${server.pid}; listener ${pids.join(",")}) · ${tag} build at ${at} (${path.basename(dir)}) · the ${copy} copy (its own sentinel) · clock ${clock ?? "today (no seam)"} · fetch-cache cleared · log ${path.basename(log)}`);
  return { kill, log };
}

// ── page reads ──────────────────────────────────────────────────────────────
// A race page's server-rendered <main>, as served, with the window it was read in.
async function mainOf(raceId: string): Promise<{ main: string; a: number; b: number }> {
  const a = Date.now();
  const html = await (await fetch(`${BASE}/race/${raceId}`)).text();
  const b = Date.now();
  const i = html.indexOf("<main");
  const j = html.indexOf("</main>");
  return { main: i >= 0 && j > i ? html.slice(i, j + 7) : `NO MAIN (${html.length} bytes)`, a, b };
}
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]!); } }));
  return out;
}
// The stub paragraph (components/RaceHubBody.tsx, the isStub branch): its sentence is the text before the
// provenance span, the provenance the span's.
const STUB_P = /<p class="mt-6 text-\[length:var\(--fs-12\)\] uppercase tracking-\[0\.5px\]" style="color:var\(--text-muted\)">([\s\S]*?)<\/p>/;
type Stub = { html: string; sentence: string; form: Form; provenance: string | null };
function stubOf(main: string): Stub | null {
  const m = main.match(STUB_P);
  if (!m) return null;
  const inner = m[1]!;
  const at = inner.indexOf("<span");
  const sentence = at >= 0 ? inner.slice(0, at) : inner;
  const provenance = inner.match(/data-result-provenance="true">([\s\S]*?)<\/span>/)?.[1] ?? null;
  const form: Form = sentence === "" ? "none" : sentence === FORMS.running ? "running" : sentence === FORMS.rating ? "rating" : sentence === FORMS.open ? "open" : "other";
  return { html: m[0], sentence, form, provenance };
}
// The race page's news ages (components/RaceNewsRow.tsx), the one class="age" span on the page.
const AGE_RE = /<span class="age" style="[^"]*">([^<]*)<\/span>/g;
const agesOf = (main: string) => [...main.matchAll(AGE_RE)].map((m) => m[1]!);
const ageless = (s: string) => s.replace(AGE_RE, '<span class="age"/>');
const countdownOf = (main: string) => main.match(/<span style="color:var\(--text-dim\)">([^<]*)<\/span><\/div>/)?.[1] ?? null;
// "none" is a stub paragraph with no sentence (the tree's past election day); "other" one whose sentence is none
// of the three.
type Census = Record<"running" | "rating" | "open" | "none" | "other", string[]>;
function census(ids: string[], mains: Record<string, string>): Census {
  const c: Census = { running: [], rating: [], open: [], none: [], other: [] };
  for (const id of ids) {
    const s = stubOf(mains[id]!);
    if (!s) continue;
    if (s.form === "running" || s.form === "rating" || s.form === "open" || s.form === "none") c[s.form].push(id);
    else c.other.push(`${id} ("${s.sentence}")`);
  }
  return c;
}
const showCensus = (c: Census) => `${c.running.length + c.rating.length + c.open.length + c.none.length + c.other.length} stub pages: "running" ${c.running.length} · "rating" alone ${c.rating.length} · "open seat" ${c.open.length} · no sentence ${c.none.length}${c.other.length ? ` · OTHER ${c.other.join(", ")}` : ""}`;

// Each race page's expected news (lib/queries.ts readObservationNews's SQL, limit 8, a row with no url dropped).
async function expectedNews(copy: CopyKind, raceIds: string[]): Promise<Map<string, string[]>> {
  return withDb(copyUrl(copyPath(copy)), async (db) => {
    const inc = new Map((await db.execute(`SELECT id, incumbent_bioguide_id FROM races WHERE cycle = 2026`)).rows.map((r) => [String(r.id), r.incumbent_bioguide_id == null ? null : String(r.incumbent_bioguide_id)]));
    const out = new Map<string, string[]>();
    for (const id of raceIds) {
      const b = inc.get(id);
      if (!b) { out.set(id, []); continue; }
      const rs = await db.execute({
        sql: `SELECT o.obs_id, json_extract(o.source, '$.url') AS url, o.observed_at AS observed_at
                FROM observation_entities oe JOIN observations o ON o.obs_id = oe.obs_id
               WHERE oe.entity_type = 'person' AND oe.entity_value IN (?)
               GROUP BY o.obs_id ORDER BY o.observed_at DESC LIMIT ?`,
        args: [b, 8],
      });
      out.set(id, rs.rows.filter((r) => String(r.url ?? "").length > 0).map((r) => String(r.observed_at)));
    }
    return out;
  });
}

// ── the plants ──────────────────────────────────────────────────────────────
type Plants = { at: string; decided: string; incumbent: string; undecided: string | null; open: string | null; leg2: string; leg2Incumbent: string; leg2Obs: string; leg2ObservedAt: string };
async function choosePlants(c: Census): Promise<Omit<Plants, "at" | "leg2ObservedAt">> {
  return withDb(copyUrl(copyPath("head")), async (db) => {
    let decided: string | null = null, incumbent = "";
    for (const id of [...c.running].sort()) {
      const rs = await db.execute({ sql: `SELECT g.rowid AS rid, g.bioguide_id, g.write_in, r.incumbent_bioguide_id AS inc FROM general_ballot g JOIN races r ON r.id = g.race_id WHERE g.race_id = ? AND g.on_ballot = 1`, args: [id] });
      const rows = rs.rows;
      if (rows.length === 1 && Number(rows[0]!.write_in) === 0 && rows[0]!.bioguide_id != null && String(rows[0]!.bioguide_id) === String(rows[0]!.inc)) { decided = id; incumbent = String(rows[0]!.inc); break; }
    }
    if (!decided) throw new Error("no stub page whose box prints its incumbent alone");
    const undecided = [...c.running].sort().find((id) => id !== decided) ?? null;
    const open = [...c.open].sort()[0] ?? null;
    const stubs = new Set([...c.running, ...c.rating, ...c.open]);
    const rs = await db.execute(`SELECT r.id, r.incumbent_bioguide_id AS b, MAX(o.observed_at) AS newest, COUNT(DISTINCT o.obs_id) AS n
                                   FROM races r JOIN observation_entities oe ON oe.entity_type = 'person' AND oe.entity_value = r.incumbent_bioguide_id
                                   JOIN observations o ON o.obs_id = oe.obs_id
                                  WHERE r.cycle = 2026 GROUP BY r.id ORDER BY newest DESC, r.id`);
    const pick = rs.rows.find((r) => !stubs.has(String(r.id)) && Number(r.n) >= 3);
    if (!pick) throw new Error("no non-stub page with three news items");
    const obs = (await db.execute({ sql: `SELECT o.obs_id FROM observation_entities oe JOIN observations o ON o.obs_id = oe.obs_id WHERE oe.entity_type = 'person' AND oe.entity_value = ? AND json_extract(o.source, '$.url') IS NOT NULL ORDER BY o.observed_at DESC LIMIT 1`, args: [String(pick.b)] })).rows[0];
    return { decided, incumbent, undecided, open, leg2: String(pick.id), leg2Incumbent: String(pick.b), leg2Obs: String(obs!.obs_id) };
  });
}
async function plant(choice: Omit<Plants, "at" | "leg2ObservedAt">): Promise<Plants> {
  const at = new Date().toISOString();
  const leg2ObservedAt = new Date(Date.parse(at) - 2 * 60 * 1000).toISOString();
  const obsId = `ho781-leg2-${LABEL}`;
  for (const kind of COPIES) {
    await withDb(copyUrl(copyPath(kind)), async (db) => {
      const m = await db.execute({ sql: `UPDATE general_ballot SET marked = 1 WHERE race_id = ? AND on_ballot = 1 AND bioguide_id = ?`, args: [choice.decided, choice.incumbent] });
      const r = await db.execute({ sql: `UPDATE general_ballot_reads SET marked = 1 WHERE race_id = ? AND status = 'box'`, args: [choice.decided] });
      const o = await db.execute({
        sql: `INSERT INTO observations (obs_id, schema_version, source, fetched_at, observed_at, obs_type, title, reliability, credibility, raw)
              SELECT ?, schema_version, source, ?, ?, obs_type, ?, reliability, credibility, raw FROM observations WHERE obs_id = ?`,
        args: [obsId, at, leg2ObservedAt, "HO 781 leg 2: a planted item, observed two minutes before the plant", choice.leg2Obs],
      });
      const e = await db.execute({
        sql: `INSERT INTO observation_entities (obs_id, entity_type, entity_value, entity_name, role)
              SELECT ?, entity_type, entity_value, entity_name, role FROM observation_entities WHERE obs_id = ? AND entity_type = 'person' AND entity_value = ? LIMIT 1`,
        args: [obsId, choice.leg2Obs, choice.leg2Incumbent],
      });
      const ok = m.rowsAffected === 1 && r.rowsAffected === 1 && o.rowsAffected === 1 && e.rowsAffected === 1;
      check("plant", `${kind}: the decided stub's one row and its read marked, the leg-2 item and its entity row inserted`, ok, `general_ballot ${m.rowsAffected} · reads ${r.rowsAffected} · observations ${o.rowsAffected} · entities ${e.rowsAffected}`);
    });
  }
  const p: Plants = { at, ...choice, leg2Obs: obsId, leg2ObservedAt };
  writeFileSync(plantedFile(), JSON.stringify({ ...p, copiedFrom: choice.leg2Obs }, null, 1));
  say(`  planted at ${at}: the decided stub ${p.decided} (${p.incumbent}'s row marked) · the undecided stub ${p.undecided ?? "-"} · the open-seat stub ${p.open ?? "none in the census"} · leg 2's page ${p.leg2} (${p.leg2Incumbent}), item ${obsId} observed ${leg2ObservedAt}, copied from ${choice.leg2Obs}`);
  return p;
}

// ── DOM reads and captures ──────────────────────────────────────────────────
type Browser = Awaited<ReturnType<typeof import("@playwright/test")["chromium"]["launch"]>>;
async function newPage(browser: Browser, w: number, h = 1000, reduced = true) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? "reduce" : "no-preference" });
  await ctx.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
  const page = await ctx.newPage();
  return { ctx, page };
}
type Page = Awaited<ReturnType<typeof newPage>>["page"];
type RaceRead = { status: number | null; countdown: string | null; tag: string | null; qualifier: string | null; stub: { sentence: string; provenance: string | null } | null; sheet: boolean };
const READ_RACE = `(() => {
  const norm = (s) => (s || '').split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ');
  const hdr = document.querySelector('.race-header');
  const sub = hdr && hdr.children[1] ? norm(hdr.children[1].textContent) : null;
  const tagEl = document.querySelector('[data-incumbent-tag]');
  const q = document.querySelector('[data-incumbent-qualifier]');
  const p = document.querySelector('main p[class="mt-6 text-[length:var(--fs-12)] uppercase tracking-[0.5px]"]');
  const stub = p ? { sentence: norm(Array.from(p.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent).join('')), provenance: p.querySelector('[data-result-provenance]') ? norm(p.querySelector('[data-result-provenance]').textContent) : null } : null;
  const sheet = Array.from(document.styleSheets).some((s) => { try { return s.cssRules.length > 0; } catch { return false; } });
  return { countdown: sub ? sub.split(' · ').slice(1).join(' · ') : null, tag: tagEl ? norm(tagEl.textContent) : null, qualifier: q ? norm(q.textContent) : null, stub, sheet };
})()`;
async function readRace(page: Page, id: string): Promise<RaceRead> {
  const res = await page.goto(`${BASE}/race/${id}`, { waitUntil: "networkidle" });
  return { status: res ? res.status() : null, ...((await page.evaluate(READ_RACE)) as Omit<RaceRead, "status">) };
}
const showRace = (id: string, r: RaceRead) =>
  `${id} · HTTP ${r.status} · "${r.countdown}" · card ${r.tag ? `tag "${r.tag}"` : "no tag"}, qualifier ${r.qualifier ? `"${r.qualifier}"` : "none"} · stub ${r.stub ? `sentence "${r.stub.sentence}", provenance "${r.stub.provenance ?? "-"}"` : "none"} · stylesheet ${r.sheet ? "loaded" : "MISSING"}`;
const VIEWS = [
  { w: 1440, h: 1100, reduced: false, s: "1440" },
  { w: 430, h: 932, reduced: false, s: "430" },
  { w: 1440, h: 1100, reduced: true, s: "1440-reduced" },
];
async function capture(browser: Browser, tag: string, ids: string[]) {
  for (const v of VIEWS) {
    if (tag === "HEAD" && v.s !== "1440") continue;
    const { ctx, page } = await newPage(browser, v.w, v.h, v.reduced);
    for (const id of ids) {
      await page.goto(`${BASE}/race/${id}`, { waitUntil: "networkidle" });
      await page.screenshot({ path: path.join(SHOTS, `${tag}-${id}-${v.s}.png`), fullPage: true });
    }
    await ctx.close();
  }
}

// ── one server's reads ──────────────────────────────────────────────────────
type Reads = { mains: Record<string, string>; windows: Record<string, [number, number]>; selfDiffer: string[]; selfDifferAgesAside: string[] };
async function readAll(raceIds: string[]): Promise<Reads> {
  const one = await pool(raceIds, 4, (id) => mainOf(id));
  const two = await pool(raceIds, 4, (id) => mainOf(id));
  const mains = Object.fromEntries(raceIds.map((id, i) => [id, one[i]!.main]));
  const windows = Object.fromEntries(raceIds.map((id, i) => [id, [one[i]!.a, one[i]!.b] as [number, number]]));
  const selfDiffer = raceIds.filter((_, i) => one[i]!.main !== two[i]!.main);
  const selfDifferAgesAside = raceIds.filter((_, i) => ageless(one[i]!.main) !== ageless(two[i]!.main));
  return { mains, windows, selfDiffer, selfDifferAgesAside };
}
type Nov4 = Reads & { pages: Record<string, RaceRead>; leg2: { first: { main: string; a: number; b: number }; second: { main: string; a: number; b: number } } };
async function nov4Session(dir: string, tag: "HEAD" | "tree", copy: CopyKind, browser: Browser, raceIds: string[], p: Plants, captures: boolean): Promise<Nov4> {
  const srv = await startServer(dir, `${tag}-nov4`, copy, NOV4);
  try {
    const first = await mainOf(p.leg2);
    const { ctx, page } = await newPage(browser, 1440);
    const pages: Record<string, RaceRead> = {};
    for (const id of [p.decided, p.undecided, p.open].filter((x): x is string => !!x)) { pages[id] = await readRace(page, id); say(`    Nov 4 ${showRace(id, pages[id]!)}`); }
    await ctx.close();
    const reads = await readAll(raceIds);
    const wait = 60_000 - (Date.now() - first.b);
    if (wait > 0) await sleep(wait);
    const second = await mainOf(p.leg2);
    say(`    Nov 4 the leg-2 page ${p.leg2} read at ${new Date(first.b).toISOString()} and again at ${new Date(second.b).toISOString()} (${Math.round((second.a - first.b) / 1000)}s apart)`);
    say(`    Nov 4 every race page read twice on this server: ${raceIds.length - reads.selfDiffer.length} of ${raceIds.length} equal to themselves${reads.selfDiffer.length ? ` (differing ${reads.selfDiffer.join(", ")}; with the news ages aside ${reads.selfDifferAgesAside.length})` : ""}`);
    if (captures) await capture(browser, tag, [p.decided]);
    return { ...reads, pages, leg2: { first, second } };
  } finally { await srv.kill(); }
}

async function raceIdsOf(copy: CopyKind) {
  return withDb(copyUrl(copyPath(copy)), async (db) => (await db.execute(`SELECT id FROM races WHERE cycle = 2026 ORDER BY id`)).rows.map((r) => String(r.id)));
}

// ── STEP 0's measurement ────────────────────────────────────────────────────
async function measure(headDir: string) {
  if (!existsSync(path.join(headDir, ".next", "BUILD_ID"))) throw new Error(`no build in ${headDir}`);
  const raceIds = await raceIdsOf("head");
  say(`\n── STEP 0's measurement: HEAD's build on the head copy at today's clock, every 2026 race page (${raceIds.length})`);
  const srv = await startServer(headDir, "HEAD-census", "head", null);
  let reads: Reads;
  try { reads = await readAll(raceIds); } finally { await srv.kill(); }
  const c = census(raceIds, reads.mains);
  const noMain = raceIds.filter((id) => reads.mains[id]!.startsWith("NO MAIN"));
  say(`  ${showCensus(c)} · of ${raceIds.length} race pages${noMain.length ? ` · NO MAIN ${noMain.join(", ")}` : ""}`);
  // What each stub's box holds, for the record: the read, its printed rows, and whether the incumbent alone is printed.
  const detail = await withDb(copyUrl(copyPath("head")), async (db) => {
    const out: Record<string, string> = {};
    for (const id of [...c.running, ...c.rating, ...c.open]) {
      const rd = (await db.execute({ sql: `SELECT status, read_at FROM general_ballot_reads WHERE race_id = ?`, args: [id] })).rows[0];
      const rows = (await db.execute({ sql: `SELECT g.name, g.party, g.write_in, g.bioguide_id, r.incumbent_bioguide_id AS inc FROM general_ballot g JOIN races r ON r.id = g.race_id WHERE g.race_id = ? AND g.on_ballot = 1 ORDER BY g.name`, args: [id] })).rows;
      const alone = rows.length === 1 && rows[0]!.bioguide_id != null && String(rows[0]!.bioguide_id) === String(rows[0]!.inc);
      out[id] = `read ${rd ? `${rd.status} ${rd.read_at}` : "none"} · printed ${rows.length}${rows.length ? ` (${rows.map((r) => `${r.name} ${r.party ?? "-"}${Number(r.write_in) ? " write-in" : ""}`).join("; ")})` : ""}${alone ? " · the incumbent alone" : ""}`;
    }
    return out;
  });
  for (const form of ["running", "rating", "open"] as const) {
    say(`  "${FORMS[form]}" (${c[form].length}):`);
    for (const id of c[form]) say(`    ${id} · ${detail[id]}`);
  }
  writeFileSync(censusFile(), JSON.stringify({ at: new Date().toISOString(), raceIds: raceIds.length, census: c, detail }, null, 1));
  check("step0", "the census read every race page", noMain.length === 0 && c.none.length === 0 && c.other.length === 0, showCensus(c));
}

// ── the legs ────────────────────────────────────────────────────────────────
async function run(headDir: string, treeDir: string) {
  for (const d of [headDir, treeDir]) if (!existsSync(path.join(d, ".next", "BUILD_ID"))) throw new Error(`no build in ${d}`);
  if (existsSync(plantedFile())) throw new Error(`${path.basename(plantedFile())} exists: these copies are planted; seed again`);
  mkdirSync(SHOTS, { recursive: true });
  const raceIds = await raceIdsOf("tree");
  const step0 = existsSync(censusFile()) ? (JSON.parse(readFileSync(censusFile(), "utf8")) as { census: Census }).census : null;
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    // leg 0: today's clock, the copies as seeded
    say(`\n── leg 0, today's clock (no seam), the copies as seeded: every race page on each build`);
    let H0: Reads, T0: Reads;
    { const srv = await startServer(headDir, "HEAD-today", "head", null); try { H0 = await readAll(raceIds); } finally { await srv.kill(); } }
    { const srv = await startServer(treeDir, "tree-today", "tree", null); try { T0 = await readAll(raceIds); } finally { await srv.kill(); } }
    say(`  each page read twice per server: HEAD ${H0.selfDiffer.length ? `differs from itself on ${H0.selfDiffer.join(", ")} (news ages aside: ${H0.selfDifferAgesAside.length})` : "equal to itself on all"} · tree ${T0.selfDiffer.length ? `differs from itself on ${T0.selfDiffer.join(", ")} (news ages aside: ${T0.selfDifferAgesAside.length})` : "equal to itself on all"}`);
    const c0 = census(raceIds, H0.mains);
    const c0t = census(raceIds, T0.mains);
    say(`  HEAD's census: ${showCensus(c0)} · the tree's: ${showCensus(c0t)}`);
    if (step0) check("0", "the census today is STEP 0's", JSON.stringify(c0) === JSON.stringify(step0), `STEP 0 ${showCensus(step0)}`);
    const exact = raceIds.filter((id) => H0.mains[id] === T0.mains[id]);
    const ageOnly = raceIds.filter((id) => H0.mains[id] !== T0.mains[id] && ageless(H0.mains[id]!) === ageless(T0.mains[id]!));
    const differ0 = raceIds.filter((id) => ageless(H0.mains[id]!) !== ageless(T0.mains[id]!));
    for (const id of differ0) { writeFileSync(path.join(ART, `main-${LABEL}-leg0-${id}-HEAD.html`), H0.mains[id]!); writeFileSync(path.join(ART, `main-${LABEL}-leg0-${id}-tree.html`), T0.mains[id]!); }
    const noMain0 = raceIds.filter((id) => H0.mains[id]!.startsWith("NO MAIN") || T0.mains[id]!.startsWith("NO MAIN"));
    const spans0 = Object.values(T0.mains).reduce((n, m) => n + agesOf(m).length, 0);
    check("0", "every race page's <main> byte-identical to HEAD's, the stub sentences included, the news ages aside", differ0.length === 0 && noMain0.length === 0, `${exact.length} of ${raceIds.length} byte-identical as served, ${ageOnly.length} more differing only in a news age${ageOnly.length ? ` (${ageOnly.join(", ")})` : ""} · ${spans0} age spans on the tree's pages${differ0.length ? ` · DIFFER ${differ0.join(", ")}` : ""}${noMain0.length ? ` · NO MAIN ${noMain0.join(", ")}` : ""}`);
    const stubIds0 = [...c0.running, ...c0.rating, ...c0.open];
    const sameStubs = stubIds0.filter((id) => stubOf(H0.mains[id]!)!.html === stubOf(T0.mains[id]!)?.html);
    check("0", "every stub page prints its sentence on both builds before election day", sameStubs.length === stubIds0.length && stubIds0.length > 0 && JSON.stringify(c0) === JSON.stringify(c0t), `${sameStubs.length} of ${stubIds0.length} stub paragraphs equal, each with its sentence`);

    // the plants
    say(`\n── the plants, the same on each copy`);
    const choice = await choosePlants(c0);
    const p = await plant(choice);
    const expect = await expectedNews("tree", raceIds);
    const expectHead = await expectedNews("head", raceIds);
    check("plant", "each copy's expected news is the same", JSON.stringify([...expect]) === JSON.stringify([...expectHead]), `${[...expect.values()].reduce((n, v) => n + v.length, 0)} items across ${raceIds.length} pages`);

    say(`\n── HEAD's build on the head copy, the clock at Nov 4`);
    const H = await nov4Session(headDir, "HEAD", "head", browser, raceIds, p, !process.argv.includes("--nocaptures"));
    say(`\n── the tree's build on the tree copy, the clock at Nov 4`);
    const T = await nov4Session(treeDir, "tree", "tree", browser, raceIds, p, !process.argv.includes("--nocaptures"));
    writeFileSync(path.join(ART, `legs-${LABEL}.json`), JSON.stringify({ plants: p, step0, leg0: { census: c0, exact: exact.length, ageOnly, differ: differ0 }, head: { pages: H.pages, selfDiffer: H.selfDiffer }, tree: { pages: T.pages, selfDiffer: T.selfDiffer } }, null, 1));

    // leg 1
    say(`\n── leg 1, the clock at Nov 4: the stub pages`);
    {
      const h = H.pages[p.decided]!, t = T.pages[p.decided]!;
      check("1", `the decided stub ${p.decided}, HEAD red: the sentence under Decided · Nov 3, 2026`, h.countdown === "Decided · Nov 3, 2026" && h.stub?.sentence === FORMS.running && /^Called by Ballotpedia · read /.test(h.stub?.provenance ?? ""), showRace(p.decided, h));
      check("1", `the decided stub ${p.decided}, the tree green: no sentence, the provenance line kept, re-elected`, t.countdown === "Decided · Nov 3, 2026" && t.qualifier === "re-elected" && t.stub?.sentence === "" && t.stub?.provenance === h.stub?.provenance && t.sheet, showRace(p.decided, t));
      if (p.undecided) {
        const hu = H.pages[p.undecided]!, tu = T.pages[p.undecided]!;
        check("1", `the undecided stub ${p.undecided}: HEAD's sentence, the tree's none, its No call on Ballotpedia line kept`, hu.countdown === "Not yet called" && hu.stub?.sentence === FORMS.running && tu.countdown === "Not yet called" && tu.stub?.sentence === "" && /^No call on Ballotpedia · read /.test(tu.stub?.provenance ?? "") && tu.stub?.provenance === hu.stub?.provenance, `HEAD ${showRace(p.undecided, hu)} · tree ${showRace(p.undecided, tu)}`);
      } else check("1", "an undecided stub exists", false, "the census holds one running stub only");
      if (p.open) {
        const ho = H.pages[p.open]!, to = T.pages[p.open]!;
        check("1", `the open-seat stub ${p.open}: HEAD's sentence, the tree's none`, ho.stub?.sentence === FORMS.open && to.stub?.sentence === "" && !!to.stub?.provenance && to.stub?.provenance === ho.stub?.provenance, `HEAD ${showRace(p.open, ho)} · tree ${showRace(p.open, to)}`);
      } else say(`  (the census holds no open-seat stub: that case is not read)`);
      const cH = census(raceIds, H.mains);
      const stubIds = [...cH.running, ...cH.rating, ...cH.open];
      const treeStubs = stubIds.map((id) => [id, stubOf(T.mains[id]!)] as const);
      const withSentence = treeStubs.filter(([, s]) => !s || s.sentence !== "");
      const noProv = treeStubs.filter(([, s]) => !s?.provenance);
      const treeAll = census(raceIds, T.mains);
      check("1", "the census: no stub page on the tree prints a sentence, each keeps its provenance line", withSentence.length === 0 && noProv.length === 0 && treeAll.running.length + treeAll.rating.length + treeAll.open.length + treeAll.other.length === 0 && treeAll.none.length === stubIds.length && stubIds.length > 0, `HEAD ${showCensus(cH)} · the tree's: ${showCensus(treeAll)} · ${stubIds.length - withSentence.length} of ${stubIds.length} with no sentence, ${stubIds.length - noProv.length} with the provenance line${withSentence.length ? ` · WITH ${withSentence.map(([id]) => id).join(", ")}` : ""}`);
      check("1", "the stub pages are STEP 0's", !step0 || JSON.stringify(cH) === JSON.stringify(step0), `${stubIds.length} at Nov 4 on HEAD`);
      const lessSentence = (id: string) => { const s = stubOf(H.mains[id]!)!; return H.mains[id]!.replace(s.html, s.html.replace(s.sentence, "")); };
      const stubOff = stubIds.filter((id) => ageless(lessSentence(id)) !== ageless(T.mains[id]!));
      const others = raceIds.filter((id) => !stubIds.includes(id));
      const othersOff = others.filter((id) => ageless(H.mains[id]!) !== ageless(T.mains[id]!));
      for (const id of [...stubOff, ...othersOff]) { writeFileSync(path.join(ART, `main-${LABEL}-nov4-${id}-HEAD.html`), H.mains[id]!); writeFileSync(path.join(ART, `main-${LABEL}-nov4-${id}-tree.html`), T.mains[id]!); }
      check("1", "each stub page's <main> is HEAD's less its sentence, the news ages aside", stubOff.length === 0, `${stubIds.length - stubOff.length} of ${stubIds.length}${stubOff.length ? ` · OFF ${stubOff.join(", ")}` : ""}`);
      check("1", "every other page's <main> equals HEAD's, the news ages aside", othersOff.length === 0, `${others.length - othersOff.length} of ${others.length}${othersOff.length ? ` · OFF ${othersOff.join(", ")}` : ""}`);
    }

    // leg 2
    say(`\n── leg 2, § 2 at Nov 4: the news ages`);
    {
      const set = Date.parse(NOV4);
      let spans = 0, onSet = 0, headOnNow = 0, headOnSet = 0, headSpans = 0;
      const off: string[] = [], headOff: string[] = [];
      for (const id of raceIds) {
        const want = (expect.get(id) ?? []).map((o) => formatRelativeAge(o, set));
        const got = agesOf(T.mains[id]!);
        spans += got.length;
        if (got.length === want.length && got.every((g, i) => g === want[i])) onSet += got.length;
        else off.push(`${id} (got ${got.join(",")} want ${want.join(",")})`);
        const [a, b] = H.windows[id]!;
        const hg = agesOf(H.mains[id]!);
        const obs = expect.get(id) ?? [];
        headSpans += hg.length;
        if (hg.length === obs.length && hg.every((g, i) => g === formatRelativeAge(obs[i]!, a) || g === formatRelativeAge(obs[i]!, b))) headOnNow += hg.length;
        else headOff.push(id);
        headOnSet += hg.filter((g, i) => g === formatRelativeAge(obs[i] ?? null, set)).length;
      }
      check("2", "the tree at Nov 4: every news age on every race page reads against the set clock", off.length === 0 && spans > 0, `${onSet} of ${spans} spans on ${raceIds.length} pages equal formatRelativeAge(observed_at, ${NOV4})${off.length ? ` · OFF ${off.slice(0, 5).join("; ")}` : ""}`);
      check("2", "HEAD at the same clock: every news age reads against today", headOff.length === 0 && headSpans > 0, `${headOnNow} of ${headSpans} spans equal formatRelativeAge(observed_at, the read's own time); ${headOnSet} equal the Nov 4 label${headOff.length ? ` · OFF ${headOff.slice(0, 5).join(", ")}` : ""}`);
      const t1 = T.leg2.first.main, t2 = T.leg2.second.main;
      const h1 = H.leg2.first.main, h2 = H.leg2.second.main;
      const gap = (x: Nov4) => Math.round((x.leg2.second.a - x.leg2.first.b) / 1000);
      check("2", `the tree: the leg-2 page ${p.leg2} read twice a minute apart in real time is byte-identical`, t1 === t2 && gap(T) >= 60, `${gap(T)}s apart · ages ${agesOf(t1).join(",")} then ${agesOf(t2).join(",")}`);
      check("2", `HEAD: the planted item's age moves between the two reads`, agesOf(h1)[0] !== agesOf(h2)[0] && gap(H) >= 60, `${gap(H)}s apart · ages ${agesOf(h1).join(",")} then ${agesOf(h2).join(",")}`);
      writeFileSync(path.join(ART, `leg2-${LABEL}-${p.leg2}-tree-1.html`), t1);
      writeFileSync(path.join(ART, `leg2-${LABEL}-${p.leg2}-tree-2.html`), t2);
      writeFileSync(path.join(ART, `leg2-${LABEL}-${p.leg2}-HEAD-1.html`), h1);
      writeFileSync(path.join(ART, `leg2-${LABEL}-${p.leg2}-HEAD-2.html`), h2);
      const tSelf = T.selfDiffer;
      check("2", "the tree at Nov 4: every race page equal to itself, read twice (no age moves at a set clock)", tSelf.length === 0, `${raceIds.length - tSelf.length} of ${raceIds.length} · HEAD's: ${raceIds.length - H.selfDiffer.length} of ${raceIds.length}${H.selfDiffer.length ? ` (differing ${H.selfDiffer.join(", ")})` : ""}`);
    }
  } finally { await browser.close(); }
}

async function main() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  say(`=== HO 781 legs · ${LABEL} · ${new Date().toISOString()} · checkout ${tree} · HEAD's sha ${HEAD_SHA} ===`);
  if (process.argv.includes("--seed")) await seed();
  if (process.argv.includes("--census")) await measure(path.resolve(argAt("--head") ?? ""));
  if (process.argv.includes("--run")) await run(path.resolve(argAt("--head") ?? ""), path.resolve(argAt("--tree") ?? ""));
  say(`\n${LABEL}: ${passes} PASS · ${fails} FAIL${failed.length ? `\n  FAIL ${failed.join("\n  FAIL ")}` : ""}`);
}
main().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
