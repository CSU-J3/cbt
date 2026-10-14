// HO 783 legs 0-4: the general runoff box. On `file:` copies of prod seeded by SELECT (built by the real
// scripts/migrate.ts, so general_runoff exists and is empty), each build's server on its own copy with
// CBT_CLOCK_NOW, HEAD's (4d73ca7) as the red.
//
//   npx tsx scripts/diagnostic/general-runoff-legs-783.ts --seed --label L
//   npx tsx scripts/diagnostic/general-runoff-legs-783.ts --leg0 --label L
//   npx tsx scripts/diagnostic/general-runoff-legs-783.ts --run --head <HEAD worktree> --tree <tree worktree> --label L
//
// Legs:
//   0  the reader, in process (the tree's lib/general-ballot.ts runGeneralBallot, its real write, through a
//      fetch shim, on a third copy): HO 747's saved pages with a general runoff box spliced into the 2026 section,
//      built from a real box (S-GA's own 2022 "General runoff election for U.S. Senate Georgia", outside the
//      section): S-GA, its general box's two advancers marked and the runoff box marking one, stores two runoff
//      rows, one marked, and S-GA's general rows equal the same page's without the runoff box; two runoff boxes
//      store nothing and the payload names the race; LA-01, no general box, stays no_box and stores its runoff rows
//   1  the clock at Nov 5, the runoff pending (S-GA's general box marking Ossoff and Collins, no runoff rows):
//      HEAD red "Runoff", the tree green "Runoff Dec 1"; GA-10's tag IN THE SENATE RUNOFF on both
//   2  the clock at Dec 2, the runoff decided (S-GA's runoff rows, Collins marked): HEAD red (Runoff, no Elected,
//      GA-10's tag IN THE SENATE RUNOFF, /electoral's chip RUNOFF, the band leaving the seat open) and the tree
//      green (Decided · Dec 1, 2026, Elected on Collins's row, GA-10's tag ELECTED TO THE SENATE, the chip calling
//      the seat, the band counting it)
//   3  the clock at Dec 13, Louisiana labelled "runoff" (LA-01, read no_box, two jungle winners, runoff rows
//      marking Jewett): HEAD red "Runoff Dec 12", the tree green "Decided · Dec 12, 2026", Elected on Jewett's row
//   4  the control at Dec 2: every other race page's server-rendered <main> byte-identical to HEAD's, with no news
//      ages set aside (both builds carry HO 781's clock), each page read twice per server
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed, fingerprinted before and after. A copy is
// `file:${abs}` from a path ending -783-legs.db under the gitignored scratch directory; a server gets its copy's
// URL with TURSO_AUTH_TOKEN="" and a CRON_SECRET minted for the run. Leg 0's reader reads no network: its IO
// returns the spliced page. Every printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync, gunzipSync } from "node:zlib";
import { readPageModel, runGeneralBallot, type IO } from "@/lib/general-ballot";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const HEAD_SHA = "4d73ca7";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/783-artifacts"); // repo-ignored
const SHOTS = path.join(ART, "captures");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const PORT = 3783;
const BASE = `http://127.0.0.1:${PORT}`;
const NOV5 = "2026-11-05T15:00:00.000Z";
const DEC2 = "2026-12-02T15:00:00.000Z";
const DEC13 = "2026-12-13T15:00:00.000Z";
const SENTINEL_ROUTE = "/api/cron/nominations"; // no leg runs it
const PAGES = "docs/handoffs/747-artifacts/pages/2026-09-25T19-56-59-291Z";
const SGA = "S-GA-2026";
const GA10 = "GA-10-2026";
const LA = "LA-01-2026";
const WHOLE = [
  "races", "members", "member_ids", "race_ratings", "rating_history", "race_candidates", "kalshi_odds", "polymarket_odds",
  "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads",
  "palestine_scorecard", "member_ideology", "member_participation", "member_career_votes", "votes", "observations",
  "observation_entities", "dashboard_state",
];
const COPIES = ["head", "tree", "leg0"] as const;
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
  for (const t of ["race_candidates", "general_ballot", "general_ballot_reads", "general_runoff", "primary_candidates", "primaries"])
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
  const cronOwned = new Set(["race_candidates", "general_ballot", "general_ballot_reads", "general_runoff", "primary_candidates", "primaries"]);
  const unexplained = changed.filter((k) => !cronOwned.has(k) || runs.length === 0);
  check("seed", `prod untouched (${label}): every difference is a prod cron's own run overlapping the window`, unexplained.length === 0, `changed ${changed.join(", ")} · runs ${runs.join("; ") || "none"}${unexplained.length ? ` · UNEXPLAINED ${unexplained.join(", ")}` : ""}`);
}

// ── the copies ──────────────────────────────────────────────────────────────
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-783-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-783-legs.db")) throw new Error(`refused: a copy must be a *-783-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
const sentinelFile = (kind: CopyKind) => path.join(DIR, `sentinel-${kind}-${LABEL}-783.txt`);
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
    counts.push(`general_runoff ${(await db.execute(`SELECT COUNT(*) AS n FROM general_runoff`)).rows[0]!.n} (the template's, empty; prod's is empty too)`);
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
      await db.execute({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 783, 'success', ?)`, args: [SENTINEL_ROUTE, at, at, JSON.stringify({ sentinel: `HO 783 legs, the ${kind} copy only` })] });
    });
    say(`  copy ${path.basename(abs)} · sentinel ${at}`);
    out[kind] = { at };
    await sleep(400);
  }
  writeFileSync(path.join(ART, `seeded-${LABEL}.json`), JSON.stringify(out, null, 1));
  await prodUntouched("the seed", fp0, t0);
}

// ── leg 0: the reader on spliced saved pages ────────────────────────────────
function voteboxAround(html: string, at: number): { start: number; end: number } {
  const start = html.lastIndexOf('<div class="votebox"', at);
  if (start < 0) throw new Error("no votebox before the offset");
  const re = /<div\b|<\/div>/g;
  re.lastIndex = start;
  let depth = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    depth += m[0] === "</div>" ? -1 : 1;
    if (depth === 0) return { start, end: m.index + m[0].length };
  }
  throw new Error("an unclosed votebox");
}
const ROW_RE = /<tr class="results_row([^"]*)">([\s\S]*?)<\/tr>/g;
const rowName = (inner: string) => (inner.match(/<a [^>]*href="https:\/\/ballotpedia\.org\/[^"]*"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "").replace(/<[^>]+>/g, "").trim();
const saved = (race: string) => gunzipSync(readFileSync(path.join(PAGES, `${race}.1.html.gz`))).toString("utf8");
// A box's rows by name, with the winner class set as asked.
function rowsOf(box: string, marks: Record<string, boolean>): string[] {
  const out: string[] = [];
  for (const m of box.matchAll(ROW_RE)) {
    const name = rowName(m[2]!);
    if (!(name in marks)) continue;
    const cls = (m[1] ?? "").replace(/\bwinner\b/g, "").trim();
    out.push(`<tr class="results_row${marks[name] ? " winner" : ""}${cls ? ` ${cls}` : ""}">${m[2]}</tr>`);
  }
  return out;
}
// The general runoff box: the template box's markup with its <h5>, its sentence and its rows replaced.
function runoffBox(template: string, h5: string, sentence: string, rows: string[]): string {
  let i = 0;
  return template
    .replace(/(<h5[^>]*>)[\s\S]*?(<\/h5>)/, `$1${h5}$2`)
    .replace(/(<p class="results_text">)[\s\S]*?(<\/p>)/, `$1${sentence}$2`)
    .replace(/<tr class="results_row[^"]*">[\s\S]*?<\/tr>/g, () => (i++ === 0 ? rows.join("\n") : ""));
}
function shim(page: string): IO {
  return { get: async () => ({ kind: "response", status: 200, body: page }), sleep: async () => {}, now: () => Date.now() };
}
type Read0 = { payload: { runoffBoxes: string[]; runoffAmbiguous: string[]; statuses: Record<string, number>; verdicts: Record<string, number> }; status: string | null; general: Record<string, unknown>[]; runoff: Record<string, unknown>[] };
async function readOnce(db: Client, race: string, page: string): Promise<Read0> {
  const r = await runGeneralBallot(db, { write: true, raceIds: [race], io: shim(page), gapMs: 0, stopRule: "first-unread" });
  const status = (await db.execute({ sql: `SELECT status FROM general_ballot_reads WHERE race_id = ?`, args: [race] })).rows[0]?.status;
  const general = (await db.execute({ sql: `SELECT person_key, name, printed_party, party, incumbent_marked, write_in, on_ballot, withdrawn, primary_marked, bioguide_id, box_prefix, marked FROM general_ballot WHERE race_id = ? ORDER BY person_key`, args: [race] })).rows.map((x) => ({ ...x }));
  const runoff = (await db.execute({ sql: `SELECT person_key, name, party, incumbent_marked, on_ballot, marked, bioguide_id, box_prefix, box_date FROM general_runoff WHERE race_id = ? ORDER BY person_key`, args: [race] })).rows.map((x) => ({ ...x }));
  return { payload: { runoffBoxes: r.runoffBoxes, runoffAmbiguous: r.runoffAmbiguous, statuses: r.statuses, verdicts: r.verdicts }, status: status == null ? null : String(status), general, runoff };
}

async function leg0() {
  say(`\n── leg 0, the reader: HO 747's saved pages with a general runoff box spliced into the 2026 section`);
  // The template: S-GA's own 2022 general runoff box, outside its 2026 section.
  const ga = saved(SGA);
  const model = readPageModel(ga);
  const h5At = [...ga.matchAll(/<h5[^>]*>([\s\S]*?)<\/h5>/g)].find((m) => /General runoff election for U\.S\. Senate Georgia/.test(m[1] ?? "") && (m.index ?? 0) > (model.section?.end ?? 0) && ga.slice(m.index!, m.index! + 6000).includes("December 6, 2022"));
  if (!h5At || !model.section || model.general.length !== 1) throw new Error("S-GA's saved page isn't the shape this leg expects");
  const tvb = voteboxAround(ga, h5At.index!);
  const template = ga.slice(tvb.start, tvb.end);
  say(`  the template: S-GA's 2022 "${(h5At[1] ?? "").replace(/<[^>]+>/g, "").trim()}" box (Dec 6, 2022), outside the 2026 section (${template.length} chars)`);
  // The general box: its two advancers marked.
  const gvb = voteboxAround(ga, model.general[0]!.offset + 10);
  const general = ga.slice(gvb.start, gvb.end);
  const marked = general.replace(ROW_RE, (whole, cls: string, inner: string) => {
    const n = rowName(inner);
    if (n !== "Jon Ossoff" && n !== "Mike Collins") return whole;
    return `<tr class="results_row winner${cls.replace(/\bwinner\b/g, "")}">${inner}</tr>`;
  });
  const runRows = rowsOf(general, { "Jon Ossoff": false, "Mike Collins": true });
  const sgaBox = runoffBox(template, "General runoff election for U.S. Senate Georgia", "Mike Collins defeated incumbent Jon Ossoff in the general runoff election for U.S. Senate Georgia on December 1, 2026.", runRows);
  const pageA = ga.slice(0, gvb.start) + marked + ga.slice(gvb.end);
  const pageB = ga.slice(0, gvb.start) + "<h4>General runoff election</h4>\n" + sgaBox + "\n" + marked + ga.slice(gvb.end);
  const pageC = ga.slice(0, gvb.start) + "<h4>General runoff election</h4>\n" + sgaBox + "\n" + sgaBox + "\n" + marked + ga.slice(gvb.end);
  // LA-01: no general box; its jungle box's two rows make the runoff box, Jewett marked.
  const la = saved(LA);
  const lm = readPageModel(la);
  if (!lm.section || lm.general.length !== 0 || lm.primaries.length !== 1) throw new Error("LA-01's saved page isn't the shape this leg expects");
  const jvb = voteboxAround(la, lm.primaries[0]!.offset + 10);
  const laRows = rowsOf(la.slice(jvb.start, jvb.end), { "Steve Scalise": false, "Lauren Jewett": true });
  const laBox = runoffBox(template, "General runoff election for U.S. House Louisiana District 1", "Lauren Jewett defeated incumbent Steve Scalise in the general runoff election for U.S. House Louisiana District 1 on December 12, 2026.", laRows);
  const pageLA = la.slice(0, jvb.start) + "<h4>General runoff election</h4>\n" + laBox + "\n" + la.slice(jvb.start);
  for (const [n, p] of [["S-GA-A", pageA], ["S-GA-B", pageB], ["S-GA-C", pageC], ["LA-01", pageLA]] as const) writeFileSync(path.join(ART, `leg0-${n}-${LABEL}.html.gz`), gzipSync(p));
  const models = { B: readPageModel(pageB), C: readPageModel(pageC), LA: readPageModel(pageLA) };
  say(`  the spliced pages read in process: S-GA B general ${models.B.general.length} · general-runoff ${models.B.generalRunoff.length} ("${models.B.generalRunoff[0]?.h5}", date ${models.B.generalRunoff[0]?.date}) · C general-runoff ${models.C.generalRunoff.length} · LA-01 general ${models.LA.general.length} · general-runoff ${models.LA.generalRunoff.length} (date ${models.LA.generalRunoff[0]?.date})`);

  const out: Record<string, Read0> = {};
  await withDb(copyUrl(copyPath("leg0")), async (db) => {
    out.A = await readOnce(db, SGA, pageA);
    out.B = await readOnce(db, SGA, pageB);
    out.C = await readOnce(db, SGA, pageC);
    out.LA = await readOnce(db, LA, pageLA);
  });
  writeFileSync(path.join(ART, `leg0-${LABEL}.json`), JSON.stringify(out, null, 1));
  const show = (rows: Record<string, unknown>[]) => rows.map((r) => `${r.name} ${r.party ?? "-"}${Number(r.marked) ? " MARKED" : ""}${Number(r.incumbent_marked) ? " (underlined)" : ""} · bioguide ${r.bioguide_id ?? "-"} · on_ballot ${r.on_ballot}${r.box_date !== undefined ? ` · box_date ${r.box_date}` : ""} · "${r.box_prefix}"`).join("; ");
  for (const k of ["A", "B", "C", "LA"]) say(`  ${k}: read ${out[k]!.status} · payload runoffBoxes ${JSON.stringify(out[k]!.payload.runoffBoxes)} runoffAmbiguous ${JSON.stringify(out[k]!.payload.runoffAmbiguous)} · general ${out[k]!.general.length} rows (${out[k]!.general.filter((r) => Number(r.marked)).length} marked) · runoff: ${show(out[k]!.runoff) || "none"}`);
  const b = out.B!, a = out.A!, c = out.C!, l = out.LA!;
  const bMarked = b.runoff.filter((r) => Number(r.marked) === 1);
  check("0", "S-GA: the run stores two runoff rows, one marked (Collins), dated 2026-12-01, both identified, the incumbent underlined", b.status === "box" && b.runoff.length === 2 && bMarked.length === 1 && bMarked[0]!.name === "Mike Collins" && b.runoff.every((r) => r.box_date === "2026-12-01" && r.box_prefix === "General runoff election" && r.bioguide_id != null && Number(r.on_ballot) === 1) && Number(b.runoff.find((r) => r.name === "Jon Ossoff")?.incumbent_marked) === 1 && b.payload.runoffBoxes.includes(SGA), show(b.runoff));
  check("0", "S-GA: its general rows equal the same page's without the runoff box (two marked)", JSON.stringify(a.general) === JSON.stringify(b.general) && a.general.filter((r) => Number(r.marked)).length === 2 && a.runoff.length === 0 && a.payload.runoffBoxes.length === 0, `${a.general.length} general rows, ${a.general.filter((r) => Number(r.marked)).length} marked, on both · without the box: runoff rows ${a.runoff.length}`);
  check("0", "S-GA with two runoff boxes: nothing stored, the payload names the race", c.runoff.length === 0 && c.payload.runoffAmbiguous.includes(SGA) && c.payload.runoffBoxes.length === 0 && JSON.stringify(c.general) === JSON.stringify(a.general), `runoff rows ${c.runoff.length} · runoffAmbiguous ${JSON.stringify(c.payload.runoffAmbiguous)}`);
  const lMarked = l.runoff.filter((r) => Number(r.marked) === 1);
  check("0", "LA-01 (no general box): the read stays no_box, and the runoff rows are stored (Jewett marked, dated 2026-12-12)", l.status === "no_box" && l.general.length === 0 && l.runoff.length === 2 && lMarked.length === 1 && lMarked[0]!.name === "Lauren Jewett" && l.runoff.every((r) => r.box_date === "2026-12-12") && Number(l.runoff.find((r) => r.name === "Steve Scalise")?.incumbent_marked) === 1, `read ${l.status} · general ${l.general.length} · runoff ${show(l.runoff)}`);
}

// ── the plants, on the head and tree copies ─────────────────────────────────
async function incumbents(db: Client): Promise<{ ossoff: string; collins: string }> {
  const rs = await db.execute({ sql: `SELECT id, incumbent_bioguide_id AS b FROM races WHERE id IN (?, ?)`, args: [SGA, GA10] });
  const by = new Map(rs.rows.map((r) => [String(r.id), String(r.b)]));
  return { ossoff: by.get(SGA)!, collins: by.get(GA10)! };
}
async function plantGeneral(kind: "head" | "tree") {
  return withDb(copyUrl(copyPath(kind)), async (db) => {
    const { ossoff, collins } = await incumbents(db);
    const m = await db.execute({ sql: `UPDATE general_ballot SET marked = 1 WHERE race_id = ? AND on_ballot = 1 AND bioguide_id IN (?, ?)`, args: [SGA, ossoff, collins] });
    const r = await db.execute({ sql: `UPDATE general_ballot_reads SET marked = 2 WHERE race_id = ? AND status = 'box'`, args: [SGA] });
    check("plant", `${kind}: S-GA's general box marks its two advancers (${ossoff}, ${collins})`, m.rowsAffected === 2 && r.rowsAffected === 1, `general_ballot ${m.rowsAffected} · reads ${r.rowsAffected}`);
  });
}
async function plantRunoff(kind: "head" | "tree", at: string) {
  return withDb(copyUrl(copyPath(kind)), async (db) => {
    const { ossoff, collins } = await incumbents(db);
    const ins = await db.execute({
      sql: `INSERT INTO general_runoff (race_id, person_key, name, party, incumbent_marked, on_ballot, marked, bioguide_id, box_prefix, box_date, read_at)
            SELECT race_id, person_key, name, party, incumbent_marked, 1, CASE WHEN bioguide_id = ? THEN 1 ELSE 0 END, bioguide_id, 'General runoff election', '2026-12-01', ?
              FROM general_ballot WHERE race_id = ? AND on_ballot = 1 AND bioguide_id IN (?, ?)`,
      args: [collins, at, SGA, ossoff, collins],
    });
    check("plant", `${kind}: S-GA's general runoff box, Ossoff and Collins, Collins marked`, ins.rowsAffected === 2, `general_runoff ${ins.rowsAffected}`);
  });
}
async function plantLouisiana(kind: "head" | "tree", at: string) {
  return withDb(copyUrl(copyPath(kind)), async (db) => {
    const read = (await db.execute({ sql: `SELECT status FROM general_ballot_reads WHERE race_id = ?`, args: [LA] })).rows[0]?.status;
    const jr = (await db.execute({
      sql: `SELECT pc.id, pc.name, pc.party, pc.bioguide_id, pc.person_key, pc.incumbent, p.runoff_date
              FROM races r JOIN primaries p ON p.state = r.state AND p.chamber = r.chamber
               AND ( r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district )
               AND p.primary_type = 'jungle' AND p.election_round IS NOT 'runoff'
              JOIN primary_candidates pc ON pc.primary_id = p.id
             WHERE r.id = ? AND pc.name IN ('Steve Scalise', 'Lauren Jewett')`,
      args: [LA],
    })).rows;
    for (const r of jr) await db.execute({ sql: `UPDATE primary_candidates SET status = 'winner' WHERE id = ?`, args: [Number(r.id)] });
    for (const r of jr) {
      await db.execute({
        sql: `INSERT INTO general_runoff (race_id, person_key, name, party, incumbent_marked, on_ballot, marked, bioguide_id, box_prefix, box_date, read_at)
              VALUES (?, ?, ?, ?, ?, 1, ?, ?, 'General runoff election', ?, ?)`,
        args: [LA, String(r.person_key ?? `name:${r.name}`), String(r.name), r.party == null ? null : String(r.party), Number(r.incumbent) === 1 ? 1 : 0, r.name === "Lauren Jewett" ? 1 : 0, r.bioguide_id == null ? null : String(r.bioguide_id), r.runoff_date == null ? null : String(r.runoff_date), at],
      });
    }
    check("plant", `${kind}: LA-01, read ${read}, two jungle winners (Scalise, Jewett) and their runoff rows, Jewett marked`, read === "no_box" && jr.length === 2 && jr.every((r) => r.runoff_date === "2026-12-12"), `read ${read} · jungle rows ${jr.length} · runoff_date ${[...new Set(jr.map((r) => r.runoff_date))].join(",")}`);
  });
}

// ── servers ─────────────────────────────────────────────────────────────────
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
async function startServer(dir: string, tag: string, copy: "head" | "tree", clock: string) {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  rmSync(path.join(dir, ".next", "cache", "fetch-cache"), { recursive: true, force: true });
  const secret = randomBytes(18).toString("hex");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: copyUrl(copyPath(copy)), CRON_SECRET: secret, CBT_CLOCK_NOW: clock };
  env.TURSO_AUTH_TOKEN = "";
  const log = path.join(DIR, `server783-${tag}-${LABEL}-${Date.now()}.log`);
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
  say(`  server :${PORT} (pid ${server.pid}; listener ${pids.join(",")}) · ${tag} build at ${at} (${path.basename(dir)}) · the ${copy} copy (its own sentinel) · clock ${clock} · fetch-cache cleared · log ${path.basename(log)}`);
  return { kill };
}

// ── page reads ──────────────────────────────────────────────────────────────
type Browser = Awaited<ReturnType<typeof import("@playwright/test")["chromium"]["launch"]>>;
async function newPage(browser: Browser, w: number, h = 1000, reduced = true) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, reducedMotion: reduced ? "reduce" : "no-preference" });
  await ctx.addCookies([{ name: "ct_seen", value: "1", url: BASE }]);
  const page = await ctx.newPage();
  return { ctx, page };
}
type Page = Awaited<ReturnType<typeof newPage>>["page"];
type RosterRow = { name: string; label: string; elected: boolean };
type RaceRead = { status: number | null; countdown: string | null; tag: { key: string | null; text: string } | null; qualifier: string | null; roster: RosterRow[] | null; provenance: string[]; sheet: boolean };
const READ_RACE = `(() => {
  const norm = (s) => (s || '').split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ');
  const hdr = document.querySelector('.race-header');
  const sub = hdr && hdr.children[1] ? norm(hdr.children[1].textContent) : null;
  const tagEl = document.querySelector('[data-incumbent-tag]');
  const q = document.querySelector('[data-incumbent-qualifier]');
  const h2 = Array.from(document.querySelectorAll('h2')).find((h) => /^candidates \\(/i.test(norm(h.textContent)));
  const sec = h2 ? h2.closest('section') : null;
  const roster = sec ? Array.from(sec.querySelectorAll('li')).map((li) => {
    const spans = Array.from(li.children).filter((c) => c.tagName === 'SPAN');
    const nameSpan = spans[2];
    const last = spans[spans.length - 1];
    const a = nameSpan ? nameSpan.querySelector('a') : null;
    return { name: a ? norm(a.textContent) : (nameSpan ? norm(nameSpan.textContent).split(' · ')[0] : ''), label: last ? norm(last.textContent) : '', elected: !!(last && last.hasAttribute('data-elected')) };
  }) : null;
  const provenance = Array.from(document.querySelectorAll('[data-result-provenance]')).map((p) => norm(p.textContent));
  const sheet = Array.from(document.styleSheets).some((s) => { try { return s.cssRules.length > 0; } catch { return false; } });
  return { countdown: sub ? sub.split(' · ').slice(1).join(' · ') : null, tag: tagEl ? { key: tagEl.getAttribute('data-incumbent-tag'), text: norm(tagEl.textContent) } : null, qualifier: q ? norm(q.textContent) : null, roster, provenance, sheet };
})()`;
async function readRace(page: Page, id: string): Promise<RaceRead> {
  const res = await page.goto(`${BASE}/race/${id}`, { waitUntil: "networkidle" });
  return { status: res ? res.status() : null, ...((await page.evaluate(READ_RACE)) as Omit<RaceRead, "status">) };
}
const showRace = (id: string, r: RaceRead) =>
  `${id} · HTTP ${r.status} · "${r.countdown}" · card ${r.tag ? `tag ${r.tag.key} "${r.tag.text}"` : "no tag"}, qualifier ${r.qualifier ? `"${r.qualifier}"` : "none"} · roster: ${r.roster ? r.roster.map((x) => `${x.name} ${x.elected ? "ELECTED" : x.label}`).join("; ") || "none" : "none (a stub)"} · provenance ${JSON.stringify(r.provenance)} · stylesheet ${r.sheet ? "loaded" : "MISSING"}`;
type Electoral = { band: string | null; called: number | null; rated: number | null; chip: { kind: string | null; text: string } | null };
async function readElectoral(page: Page): Promise<Electoral> {
  await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
  const band = (await page.evaluate(`(() => { const el = document.querySelector('[data-results]'); return el ? el.textContent.split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ') : null; })()`)) as string | null;
  await page.locator(".rl-tab", { hasText: "SENATE" }).click();
  await sleep(400);
  const chip = (await page.evaluate(`(() => { const el = document.querySelector('li[data-race="${SGA}"] [data-result]'); return el ? { kind: el.getAttribute('data-result'), text: el.textContent.trim() } : null; })()`)) as Electoral["chip"];
  const m = band?.match(/(\d+) of (\d+) competitive seats called/);
  return { band, called: m ? Number(m[1]) : null, rated: m ? Number(m[2]) : null, chip };
}
async function mainOf(raceId: string): Promise<string> {
  const html = await (await fetch(`${BASE}/race/${raceId}`)).text();
  const i = html.indexOf("<main");
  const j = html.indexOf("</main>");
  return i >= 0 && j > i ? html.slice(i, j + 7) : `NO MAIN (${html.length} bytes)`;
}
async function pool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const k = i++; out[k] = await fn(items[k]!); } }));
  return out;
}
const VIEWS = [
  { w: 1440, h: 1100, reduced: false, s: "1440" },
  { w: 430, h: 932, reduced: false, s: "430" },
  { w: 1440, h: 1100, reduced: true, s: "1440-reduced" },
];
async function capture(browser: Browser, tag: string, id: string, when: string) {
  for (const v of VIEWS) {
    if (tag === "HEAD" && v.s !== "1440") continue;
    const { ctx, page } = await newPage(browser, v.w, v.h, v.reduced);
    await page.goto(`${BASE}/race/${id}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(SHOTS, `${tag}-${id}-${when}-${v.s}.png`), fullPage: true });
    await ctx.close();
  }
}

// ── the legs ────────────────────────────────────────────────────────────────
type Session = { pages: Record<string, RaceRead>; electoral: Electoral | null; mains: Record<string, string>; selfDiffer: string[] };
async function session(dir: string, tag: "HEAD" | "tree", copy: "head" | "tree", clock: string, when: string, browser: Browser, ids: string[], opts: { electoral?: boolean; mains?: string[]; capture?: boolean }): Promise<Session> {
  const srv = await startServer(dir, `${tag}-${when}`, copy, clock);
  try {
    const { ctx, page } = await newPage(browser, 1440);
    const pages: Record<string, RaceRead> = {};
    for (const id of ids) { pages[id] = await readRace(page, id); say(`    ${when} ${showRace(id, pages[id]!)}`); }
    const electoral = opts.electoral ? await readElectoral(page) : null;
    if (electoral) say(`    ${when} /electoral: S-GA's chip ${electoral.chip ? `${electoral.chip.kind} "${electoral.chip.text}"` : "none"} · the band "${electoral.band}"`);
    await ctx.close();
    let mains: Record<string, string> = {}, selfDiffer: string[] = [];
    if (opts.mains) {
      const one = await pool(opts.mains, 4, (id) => mainOf(id));
      const two = await pool(opts.mains, 4, (id) => mainOf(id));
      mains = Object.fromEntries(opts.mains.map((id, i) => [id, one[i]!]));
      selfDiffer = opts.mains.filter((_, i) => one[i] !== two[i]);
      say(`    ${when} every race page read twice on this server: ${opts.mains.length - selfDiffer.length} of ${opts.mains.length} equal to themselves${selfDiffer.length ? ` (differing ${selfDiffer.join(", ")})` : ""}`);
    }
    if (opts.capture) await capture(browser, tag, SGA, when);
    return { pages, electoral, mains, selfDiffer };
  } finally { await srv.kill(); }
}

async function run(headDir: string, treeDir: string) {
  for (const d of [headDir, treeDir]) if (!existsSync(path.join(d, ".next", "BUILD_ID"))) throw new Error(`no build in ${d}`);
  const marker = path.join(ART, `planted-${LABEL}.txt`);
  if (existsSync(marker)) throw new Error(`${path.basename(marker)} exists: these copies are planted; seed again`);
  mkdirSync(SHOTS, { recursive: true });
  const raceIds = await withDb(copyUrl(copyPath("tree")), async (db) => (await db.execute(`SELECT id FROM races WHERE cycle = 2026 ORDER BY id`)).rows.map((r) => String(r.id)));
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  try {
    say(`\n── the plant for leg 1, on each copy`);
    await plantGeneral("head");
    await plantGeneral("tree");
    writeFileSync(marker, new Date().toISOString());
    say(`\n── leg 1, the clock at Nov 5: the runoff pending`);
    const H1 = await session(headDir, "HEAD", "head", NOV5, "nov5", browser, [SGA, GA10], { electoral: true, capture: true });
    const T1 = await session(treeDir, "tree", "tree", NOV5, "nov5", browser, [SGA, GA10], { electoral: true, capture: true });
    {
      const h = H1.pages[SGA]!, t = T1.pages[SGA]!;
      check("1", "S-GA HEAD red: Runoff", h.countdown === "Runoff", showRace(SGA, h));
      check("1", "S-GA the tree green: Runoff Dec 1 (and the incumbent's card runoff Dec 1)", t.countdown === "Runoff Dec 1" && t.qualifier === "runoff Dec 1", showRace(SGA, t));
      const hg = H1.pages[GA10]!, tg = T1.pages[GA10]!;
      check("1", "GA-10's tag IN THE SENATE RUNOFF on both", hg.tag?.text === "IN THE SENATE RUNOFF" && tg.tag?.text === "IN THE SENATE RUNOFF", `HEAD ${hg.tag ? `"${hg.tag.text}"` : "no tag"} · tree ${tg.tag ? `"${tg.tag.text}"` : "no tag"}`);
    }

    say(`\n── the plant for leg 2, on each copy`);
    const at2 = new Date().toISOString();
    await plantRunoff("head", at2);
    await plantRunoff("tree", at2);
    say(`\n── leg 2, the clock at Dec 2: the runoff decided; and leg 4's control on the same servers`);
    const H2 = await session(headDir, "HEAD", "head", DEC2, "dec2", browser, [SGA, GA10], { electoral: true, mains: raceIds, capture: true });
    const T2 = await session(treeDir, "tree", "tree", DEC2, "dec2", browser, [SGA, GA10], { electoral: true, mains: raceIds, capture: true });
    {
      const h = H2.pages[SGA]!, t = T2.pages[SGA]!;
      const hr = new Map((h.roster ?? []).map((x) => [x.name, x])), tr = new Map((t.roster ?? []).map((x) => [x.name, x]));
      const he = H2.electoral!, te = T2.electoral!;
      check("2", "S-GA HEAD red: Runoff, no Elected", h.countdown === "Runoff" && ![...hr.values()].some((x) => x.elected), showRace(SGA, h));
      check("2", "S-GA the tree green: Decided · Dec 1, 2026, Elected on Collins's row alone, the incumbent defeated", t.countdown === "Decided · Dec 1, 2026" && tr.get("Mike Collins")?.elected === true && [...tr.values()].filter((x) => x.elected).length === 1 && t.qualifier === "defeated", showRace(SGA, t));
      const hg = H2.pages[GA10]!, tg = T2.pages[GA10]!;
      check("2", "GA-10's tag: HEAD IN THE SENATE RUNOFF, the tree ELECTED TO THE SENATE (the planted mark is Collins's)", hg.tag?.text === "IN THE SENATE RUNOFF" && tg.tag?.text === "ELECTED TO THE SENATE", `HEAD ${hg.tag ? `"${hg.tag.text}"` : "no tag"} · tree ${tg.tag ? `"${tg.tag.text}"` : "no tag"}`);
      check("2", "/electoral's chip: HEAD RUNOFF, the tree calls the seat (R GAIN: Collins over the D incumbent)", he.chip?.kind === "runoff" && he.chip.text === "RUNOFF" && te.chip?.kind === "won" && te.chip.text === "R GAIN", `HEAD ${JSON.stringify(he.chip)} · tree ${JSON.stringify(te.chip)}`);
      check("2", "the band: the tree counts the seat, one more competitive seat called than HEAD", he.called != null && te.called != null && te.called - he.called === 1 && te.rated === he.rated, `HEAD "${he.band}" · tree "${te.band}"`);
    }
    say(`\n── leg 4, the control at Dec 2`);
    {
      const planted = new Set([SGA, GA10]);
      const others = raceIds.filter((id) => !planted.has(id));
      const differ = others.filter((id) => H2.mains[id] !== T2.mains[id]);
      for (const id of differ) { writeFileSync(path.join(ART, `main-${LABEL}-${id}-HEAD.html`), H2.mains[id]!); writeFileSync(path.join(ART, `main-${LABEL}-${id}-tree.html`), T2.mains[id]!); }
      const noMain = others.filter((id) => H2.mains[id]!.startsWith("NO MAIN") || T2.mains[id]!.startsWith("NO MAIN"));
      const ages = Object.values(T2.mains).reduce((n, m) => n + (m.match(/<span class="age" style="/g) ?? []).length, 0);
      check("4", "every other race page's <main> byte-identical to HEAD's, nothing set aside", differ.length === 0 && noMain.length === 0, `${others.length - differ.length} of ${others.length} byte-identical (${ages} news-age spans on the tree's pages, none set aside)${differ.length ? ` · DIFFER ${differ.join(", ")}` : ""}${noMain.length ? ` · NO MAIN ${noMain.join(", ")}` : ""}`);
      check("4", "each server's pages read twice equal themselves", H2.selfDiffer.length === 0 && T2.selfDiffer.length === 0, `HEAD ${raceIds.length - H2.selfDiffer.length} of ${raceIds.length} · tree ${raceIds.length - T2.selfDiffer.length} of ${raceIds.length}`);
      const sga = H2.mains[SGA] !== T2.mains[SGA], ga10 = H2.mains[GA10] !== T2.mains[GA10];
      say(`  the two planted pages differ between the builds, as legs 1-2 read: S-GA ${sga ? "differs" : "EQUAL"} · GA-10 ${ga10 ? "differs" : "EQUAL"}`);
    }

    say(`\n── the plant for leg 3, on each copy`);
    const at3 = new Date().toISOString();
    await plantLouisiana("head", at3);
    await plantLouisiana("tree", at3);
    say(`\n── leg 3, the clock at Dec 13: Louisiana labelled "runoff"`);
    const H3 = await session(headDir, "HEAD", "head", DEC13, "dec13", browser, [LA], {});
    const T3 = await session(treeDir, "tree", "tree", DEC13, "dec13", browser, [LA], {});
    {
      const h = H3.pages[LA]!, t = T3.pages[LA]!;
      const tr = new Map((t.roster ?? []).map((x) => [x.name, x]));
      check("3", "LA-01 HEAD red: Runoff Dec 12", h.countdown === "Runoff Dec 12", showRace(LA, h));
      check("3", "LA-01 the tree green: Decided · Dec 12, 2026, Elected on Jewett's row", t.countdown === "Decided · Dec 12, 2026" && tr.get("Lauren Jewett")?.elected === true && [...tr.values()].filter((x) => x.elected).length === 1, showRace(LA, t));
    }
    writeFileSync(path.join(ART, `legs-${LABEL}.json`), JSON.stringify({ nov5: { head: H1.pages, tree: T1.pages, electoral: [H1.electoral, T1.electoral] }, dec2: { head: H2.pages, tree: T2.pages, electoral: [H2.electoral, T2.electoral] }, dec13: { head: H3.pages, tree: T3.pages } }, null, 1));
  } finally { await browser.close(); }
}

async function main() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  say(`=== HO 783 legs · ${LABEL} · ${new Date().toISOString()} · checkout ${tree} · HEAD's sha ${HEAD_SHA} ===`);
  if (process.argv.includes("--seed")) await seed();
  if (process.argv.includes("--leg0")) await leg0();
  if (process.argv.includes("--run")) await run(path.resolve(argAt("--head") ?? ""), path.resolve(argAt("--tree") ?? ""));
  say(`\n${LABEL}: ${passes} PASS · ${fails} FAIL${failed.length ? `\n  FAIL ${failed.join("\n  FAIL ")}` : ""}`);
}
main().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
