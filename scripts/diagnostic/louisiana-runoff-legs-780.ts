// HO 780 legs 0-4: Louisiana's runoff box. On `file:` copies of prod, with a jungle box's marks and a Dec-12
// General election box planted by rows, each build's harvest (its own /api/cron/race-challengers) and server
// run on its own copy with CBT_CLOCK_NOW, HEAD's (bae5790) as the red.
//
//   npx tsx scripts/diagnostic/louisiana-runoff-legs-780.ts --seed --label L
//   npx tsx scripts/diagnostic/louisiana-runoff-legs-780.ts --leg0 --label L
//   npx tsx scripts/diagnostic/louisiana-runoff-legs-780.ts --run --head <HEAD worktree> --tree <tree worktree> --label L
//
// The plants, the same on each build's copy, are the rows the reader would write once Ballotpedia posts a seat's
// Dec-12 contest as a General election box: the jungle box's winners (primary_candidates.status 'winner'), the
// read (general_ballot_reads `box`), and the box's printed rows (general_ballot, primary_marked 1 on a jungle
// winner, the incumbent underlined and identified, marked where the box marks the winner):
//   LA-05  leg 1   the runoff, its box unmarked: Pat Moore (D) and Misti Cordell (R); the incumbent is not in it
//   LA-01  leg 1b  the incumbent in the runoff, the box unmarked: Steve Scalise (R, the incumbent), Lauren Jewett (D)
//   LA-06  leg 2   the runoff decided: Chauna Banks (D) and Blake Miguez (R), the box marking Miguez
//   LA-04  leg 3   an outright winner, the box unmarked and printing him: Mike Johnson (R, the incumbent)
//   LA-03  leg 3b  an outright winner who isn't the incumbent: Kate Cotten (R), the box printing her
//   LA-02  unplanted: a jungle seat with no box, inside leg 4's control
// Legs:
//   0  the reader, in process (lib/general-ballot.ts, unchanged by HO 780): a General election box copied from
//      another saved page's 2026 general box, carrying LA-01's two advancers, spliced into HO 747's saved LA-01
//      page, its jungle box's two rows marked: pageResult reads status box, two rows, both primary_marked 1
//   1  the clock at Nov 5: LA-05, HEAD red (Won primary on the D and R rows, Not yet called) and the tree green
//      (both Advanced, Runoff Dec 12); LA-01, the incumbent's qualifier (runoff Dec 12 on the tree); each build's
//      race_candidates after its harvest, equal outside the planted seats by a whole-table diff
//   2  the clock at Dec 13: LA-06, HEAD red (Decided · Nov 3, 2026) and the tree green (Decided · Dec 12, 2026),
//      Elected on Miguez's row
//   3  the clock at Nov 5: LA-04 and LA-03, HEAD red (Not yet called) and the tree green (Decided · Nov 3, 2026),
//      LA-04's qualifier re-elected and Elected on Cotten's row; the band's House count, two more on the tree
//   4  the control at Nov 5: every other race page's server-rendered <main> byte-identical to HEAD's, and
//      whether a planted seat is rated (if one were, its /electoral row reads RUNOFF on the tree in leg 1)
//
// SAFETY. Prod is only READ (a SELECT-only reader) for the seed, fingerprinted before and after. A copy is
// `file:${abs}` from a path ending -780-legs.db under the gitignored scratch directory; a server gets its copy's
// URL with TURSO_AUTH_TOKEN="" and a CRON_SECRET minted for the run, which the harvest's POST carries. The harvest
// route is pure DB-to-DB (no fetch upstream). Every printed line passes redactSecrets.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type InStatement } from "@libsql/client";
import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync, gzipSync } from "node:zlib";
import { loadIdentity, pageResult, readPageModel } from "@/lib/general-ballot";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const HEAD_SHA = "bae5790";
const DIR = path.resolve("scripts/diagnostic/scratch"); // gitignored
const ART = path.resolve("docs/handoffs/780-artifacts"); // repo-ignored
const SHOTS = path.join(ART, "captures");
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const PORT = 3780;
const BASE = `http://127.0.0.1:${PORT}`;
const NOV5 = "2026-11-05T15:00:00.000Z";
const DEC13 = "2026-12-13T15:00:00.000Z";
const SENTINEL_ROUTE = "/api/cron/nominations"; // no leg runs it
const HARVEST_ROUTE = "/api/cron/race-challengers";
const PAGES = "docs/handoffs/747-artifacts/pages/2026-09-25T19-56-59-291Z";
const WHOLE = [
  "races", "members", "member_ids", "race_ratings", "rating_history", "race_candidates", "kalshi_odds", "polymarket_odds",
  "member_fundraising", "pac_ie_spending", "primaries", "primary_candidates", "general_ballot", "general_ballot_reads",
  "palestine_scorecard", "member_ideology", "member_participation", "member_career_votes", "votes", "observations",
  "observation_entities", "dashboard_state",
];
type Plant = { race: string; leg: string; winners: string[]; box: string[]; boxMarked: string[] };
const PLANTS: Plant[] = [
  { race: "LA-05-2026", leg: "1", winners: ["Pat Moore", "Misti Cordell"], box: ["Pat Moore", "Misti Cordell"], boxMarked: [] },
  { race: "LA-01-2026", leg: "1b", winners: ["Steve Scalise", "Lauren Jewett"], box: ["Steve Scalise", "Lauren Jewett"], boxMarked: [] },
  { race: "LA-06-2026", leg: "2", winners: ["Chauna Banks", "Blake Miguez"], box: ["Chauna Banks", "Blake Miguez"], boxMarked: ["Blake Miguez"] },
  { race: "LA-04-2026", leg: "3", winners: ["Mike Johnson"], box: ["Mike Johnson"], boxMarked: [] },
  { race: "LA-03-2026", leg: "3b", winners: ["Kate Cotten"], box: ["Kate Cotten"], boxMarked: [] },
];
const PLANTED = PLANTS.map((p) => p.race);
const NOV5_PAGES = ["LA-05-2026", "LA-01-2026", "LA-04-2026", "LA-03-2026"];
const DEC13_PAGES = ["LA-06-2026"];
const COPIES = ["head", "tree"] as const;
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
const copyPath = (kind: string) => path.join(DIR, `${kind}-${LABEL}-780-legs.db`);
function copyUrl(abs: string) {
  if (!abs.endsWith("-780-legs.db")) throw new Error(`refused: a copy must be a *-780-legs.db file (got ${abs})`);
  return `file:${abs}`;
}
async function withDb<T>(url: string, fn: (db: Client) => Promise<T>): Promise<T> {
  if (!url.startsWith("file:")) throw new Error("refused: copies are file: only");
  const db = createClient({ url });
  try { return await fn(db); } finally { db.close(); await sleep(300); }
}
const sentinelFile = (kind: CopyKind) => path.join(DIR, `sentinel-${kind}-${LABEL}-780.txt`);
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
const JUNGLE_ROWS = `SELECT pc.id, pc.name, pc.party, pc.incumbent, pc.bioguide_id, pc.person_key
  FROM races r
  JOIN primaries p ON p.state = r.state AND p.chamber = r.chamber
   AND ( r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district )
   AND p.primary_type = 'jungle' AND p.election_round IS NOT 'runoff'
  JOIN primary_candidates pc ON pc.primary_id = p.id
 WHERE r.id = ? ORDER BY pc.name`;

// The plants, by rows, as the reader would write a seat's Dec-12 General election box.
async function plant(db: Client, at: string): Promise<{ planted: string[]; stale: string[] }> {
  const planted: string[] = [];
  const stale: string[] = [];
  for (const p of PLANTS) {
    const jr = (await db.execute({ sql: JUNGLE_ROWS, args: [p.race] })).rows;
    const one = (name: string) => {
      const hit = jr.filter((r) => String(r.name) === name);
      if (hit.length !== 1) stale.push(`${p.race} "${name}" matches ${hit.length} of ${jr.map((r) => r.name).join(", ")}`);
      return hit.length === 1 ? hit[0]! : null;
    };
    for (const w of p.winners) {
      const r = one(w);
      if (r) await db.execute({ sql: `UPDATE primary_candidates SET status = 'winner' WHERE id = ?`, args: [Number(r.id)] });
    }
    const before = Number((await db.execute({ sql: `SELECT COUNT(*) AS n FROM general_ballot WHERE race_id = ?`, args: [p.race] })).rows[0]!.n);
    if (before !== 0) stale.push(`${p.race} already holds ${before} general_ballot rows`);
    for (const n of p.box) {
      const r = one(n);
      if (!r) continue;
      const inc = Number(r.incumbent) === 1;
      await db.execute({
        sql: `INSERT INTO general_ballot (race_id, person_key, name, printed_party, party, incumbent_marked, write_in, on_ballot, withdrawn, primary_marked, bioguide_id, box_prefix, read_at, marked)
              VALUES (?, ?, ?, ?, ?, ?, 0, 1, 0, ?, ?, 'General election', ?, ?)`,
        args: [p.race, String(r.person_key), String(r.name), String(r.party), String(r.party), inc ? 1 : 0, p.winners.includes(n) ? 1 : 0, inc && r.bioguide_id != null ? String(r.bioguide_id) : null, at, p.boxMarked.includes(n) ? 1 : 0],
      });
    }
    const upd = await db.execute({
      sql: `UPDATE general_ballot_reads SET status = 'box', read_at = ?, rows = ?, marked = ?, last_attempt_at = ?, last_attempt = 'READ' WHERE race_id = ?`,
      args: [at, p.box.length, p.boxMarked.length, at, p.race],
    });
    if (upd.rowsAffected !== 1) stale.push(`${p.race} general_ballot_reads rows updated ${upd.rowsAffected}`);
    planted.push(`${p.race} (leg ${p.leg}) jungle ${p.winners.join(" + ")} · box ${p.box.join(" + ")}${p.boxMarked.length ? ` marking ${p.boxMarked.join(", ")}` : ", unmarked"}`);
  }
  return { planted, stale };
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
  const out: Record<string, unknown> = {};
  for (const kind of COPIES) {
    const abs = copyPath(kind);
    copyFileSync(tpl, abs);
    const at = new Date().toISOString();
    writeFileSync(sentinelFile(kind), at);
    const res = await withDb(copyUrl(abs), async (db) => {
      const closed = await db.execute(`UPDATE cron_runs SET status = 'success', ended_at = started_at WHERE status = 'running'`);
      if (closed.rowsAffected) say(`  ${kind}: copied rows still running, closed on the copy: ${closed.rowsAffected}`);
      await db.execute({ sql: `INSERT INTO cron_runs (route, started_at, ended_at, elapsed_ms, status, payload) VALUES (?, ?, ?, 780, 'success', ?)`, args: [SENTINEL_ROUTE, at, at, JSON.stringify({ sentinel: `HO 780 legs, the ${kind} copy only` })] });
      return plant(db, at);
    });
    say(`  copy ${path.basename(abs)} · sentinel ${at} · planted ${res.planted.join(" · ")}`);
    for (const s of res.stale) say(`  STALE ${s}`);
    check("seed", `${kind}: every plant matched one jungle row and one read`, res.stale.length === 0, `${res.planted.length} seats`);
    out[kind] = { at, ...res };
    await sleep(400);
  }
  writeFileSync(path.join(ART, `planted-${LABEL}.json`), JSON.stringify(out, null, 1));
  await prodUntouched("the seed", fp0, t0);
}

// ── leg 0: the reader ───────────────────────────────────────────────────────
// The votebox element around a box's header: from the nearest <div class="votebox"> before it to its matching
// </div>, by div depth (Ballotpedia's votebox markup is well formed).
function voteboxAround(html: string, headerAt: number): { start: number; end: number } {
  const start = html.lastIndexOf('<div class="votebox"', headerAt);
  if (start < 0) throw new Error("no votebox before the header");
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

async function leg0() {
  say(`\n── leg 0, the reader: HO 747's saved LA-01 page with a General election box spliced in`);
  const diff = execFileSync("git", ["diff", "--stat", HEAD_SHA, "--", "lib/general-ballot.ts"], { encoding: "utf8" }).trim();
  check("0", "the reader is HEAD's (lib/general-ballot.ts unchanged by HO 780)", diff === "", diff || "no diff");
  const ADV = ["Steve Scalise", "Lauren Jewett"];
  const page = gunzipSync(readFileSync(path.join(PAGES, "LA-01-2026.1.html.gz"))).toString("utf8");
  const model0 = readPageModel(page);
  const today = pageResult("LA-01-2026", model0, new Map(), "leg0");
  check("0", "the saved page as saved reads no_box (its one 2026 box is the Nonpartisan primary)", today.status === "no_box" && model0.primaries.length === 1 && model0.primaries[0]!.contest === "open", `pageResult ${today.status} · primary-kept ${model0.primaries.length} (${model0.primaries[0]?.contest ?? "-"}) · general ${model0.general.length}`);

  // The template: the first other saved page (by file name) whose section holds one general box of two rows, D and
  // R, no write-in, no mark, no withdrawn block, not a special.
  let template: { file: string; box: string; h5: string } | null = null;
  for (const f of readdirSync(PAGES).filter((x) => x.endsWith(".1.html.gz") && !x.startsWith("LA-")).sort()) {
    const h = gunzipSync(readFileSync(path.join(PAGES, f))).toString("utf8");
    const m = readPageModel(h);
    const g = m.general.length === 1 ? m.general[0]! : null;
    if (!g || g.rows.length !== 2 || g.withdrawn || g.special || g.rows.some((r) => r.writeIn || r.winner)) continue;
    if (g.rows.map((r) => r.party).sort().join("") !== "DR") continue;
    const vb = voteboxAround(h, g.offset);
    template = { file: f, box: h.slice(vb.start, vb.end), h5: g.h5 };
    break;
  }
  if (!template) throw new Error("no template general box among the saved pages");

  // LA-01's jungle box: its votebox, with the two advancers' rows marked winners.
  const jbox = model0.primaries[0]!;
  const jvb = voteboxAround(page, jbox.offset);
  const jungle = page.slice(jvb.start, jvb.end);
  const advRows: string[] = [];
  const marked = jungle.replace(ROW_RE, (whole, cls: string, inner: string) => {
    if (!ADV.includes(rowName(inner))) return whole;
    advRows.push(`<tr class="results_row${cls}">${inner}</tr>`);
    return `<tr class="results_row winner${cls}">${inner}</tr>`;
  });
  // The general box: the template's markup, its <h5> and sentence LA-01's, its rows the two advancers' own rows
  // from the jungle box (unmarked: the Dec-12 contest is not yet decided).
  let i = 0;
  const general = template.box
    .replace(/(<h5[^>]*>)[\s\S]*?(<\/h5>)/, "$1General election for U.S. House Louisiana District 1$2")
    .replace(/(<p class="results_text">)[\s\S]*?(<\/p>)/, "$1Steve Scalise (R) and Lauren Jewett (D) are running in the general election for U.S. House Louisiana District 1 on December 12, 2026.$2")
    .replace(/<tr class="results_row[^"]*">[\s\S]*?<\/tr>/g, () => (i++ === 0 ? advRows.join("\n") : ""));
  const h4At = page.lastIndexOf("<h4", jvb.start);
  const insertAt = model0.section && h4At > model0.section.start ? h4At : jvb.start;
  const spliced = page.slice(0, insertAt) + "<h4> General election</h4>\n" + general + "\n" + page.slice(insertAt, jvb.start) + marked + page.slice(jvb.end);
  writeFileSync(path.join(ART, `leg0-LA-01-spliced-${LABEL}.html.gz`), gzipSync(spliced));

  const idCopy = copyPath("template");
  const identity = existsSync(idCopy) ? await withDb(copyUrl(idCopy), (db) => loadIdentity(db)) : new Map<string, string | null>();
  const model = readPageModel(spliced);
  const res = pageResult("LA-01-2026", model, identity, "leg0");
  const rows = res.rows.filter((r) => r.on_ballot === 1);
  const scalise = rows.find((r) => r.name === "Steve Scalise");
  say(`  template: ${template.file}'s "${template.h5}" box · LA-01's jungle box marked ${advRows.length} of ${(jungle.match(ROW_RE) ?? []).length} rows · identity ${identity.size} titles from the seed's template copy`);
  say(`  the spliced page: general ${model.general.length} ("${model.general[0]?.h5 ?? "-"}"), primary-kept ${model.primaries.length} (marked ${model.primaries[0]?.marked ?? 0}) · pageResult ${res.status}`);
  for (const r of res.rows) say(`    ${r.person_key} · ${r.name} · printed ${r.printed_party ?? "-"} · party ${r.party ?? "-"} · on_ballot ${r.on_ballot} · primary_marked ${r.primary_marked} · incumbent_marked ${r.incumbent_marked} · bioguide ${r.bioguide_id ?? "-"} · marked ${r.marked} · prefix "${r.box_prefix}"`);
  check("0", "pageResult: status box, two rows, both primary_marked 1", res.status === "box" && rows.length === 2 && rows.every((r) => r.primary_marked === 1) && rows.map((r) => r.name).sort().join("|") === [...ADV].sort().join("|"), `status ${res.status} · ${rows.length} rows · primary_marked ${rows.map((r) => r.primary_marked).join(",")} · ${rows.map((r) => r.name).join(", ")}`);
  check("0", "the box is unmarked, prefix General election, and the incumbent is underlined and identified", rows.every((r) => r.marked === 0 && r.box_prefix === "General election") && scalise?.incumbent_marked === 1 && (identity.size === 0 || scalise?.bioguide_id === "S001176"), `Scalise incumbent_marked ${scalise?.incumbent_marked} · bioguide ${scalise?.bioguide_id ?? "-"}${identity.size === 0 ? " (no identity copy)" : ""}`);
  writeFileSync(path.join(ART, `leg0-${LABEL}.json`), JSON.stringify({ template: { file: template.file, h5: template.h5 }, today: today.status, result: res }, null, 1));
}

// ── servers ─────────────────────────────────────────────────────────────────
function listeningPids(): number[] {
  const out = execFileSync("powershell", ["-NoProfile", "-Command", `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`], { encoding: "utf8" });
  return [...new Set(out.split(/\s+/).filter(Boolean).map(Number))];
}
async function startServer(dir: string, tag: string, copy: CopyKind, clock: string) {
  if (listeningPids().length) throw new Error(`port ${PORT} is already bound; refusing to share it`);
  rmSync(path.join(dir, ".next", "cache", "fetch-cache"), { recursive: true, force: true });
  const secret = randomBytes(18).toString("hex");
  const env: NodeJS.ProcessEnv = { ...process.env, TURSO_DATABASE_URL: copyUrl(copyPath(copy)), CRON_SECRET: secret, CBT_CLOCK_NOW: clock };
  env.TURSO_AUTH_TOKEN = "";
  const log = path.join(DIR, `server780-${tag}-${LABEL}-${Date.now()}.log`);
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
  const at = execFileSync("git", ["-C", dir, "rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  say(`  server :${PORT} (pid ${server.pid}) · ${tag} build at ${at} (${path.basename(dir)}) · the ${copy} copy (its own sentinel) · clock ${clock} · fetch-cache cleared · log ${path.basename(log)}`);
  return { kill, secret, log };
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
type RaceRead = { status: number | null; countdown: string | null; tag: { key: string | null; text: string } | null; qualifier: string | null; candidates: string | null; roster: RosterRow[] | null; stub: string | null; provenance: string[] };
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
  const provEls = Array.from(document.querySelectorAll('[data-result-provenance]'));
  const stubP = sec ? null : (provEls[0] ? provEls[0].parentElement : null);
  return { countdown: sub ? sub.split(' · ').slice(1).join(' · ') : null, tag: tagEl ? { key: tagEl.getAttribute('data-incumbent-tag'), text: norm(tagEl.textContent) } : null, qualifier: q ? norm(q.textContent) : null, candidates: h2 ? norm(h2.textContent) : null, roster, stub: stubP ? norm(stubP.textContent) : null, provenance: provEls.map((p) => norm(p.textContent)) };
})()`;
async function readRace(page: Page, id: string): Promise<RaceRead> {
  const res = await page.goto(`${BASE}/race/${id}`, { waitUntil: "networkidle" });
  return { status: res ? res.status() : null, ...((await page.evaluate(READ_RACE)) as Omit<RaceRead, "status">) };
}
const showRace = (id: string, r: RaceRead) =>
  `${id} · HTTP ${r.status} · "${r.countdown}" · card ${r.tag ? `tag ${r.tag.key} "${r.tag.text}"` : "no tag"}, qualifier ${r.qualifier ? `"${r.qualifier}"` : "none"} · ${r.candidates ?? "no Candidates section"}: ${r.roster ? r.roster.map((x) => `${x.name} ${x.elected ? "ELECTED" : x.label}`).join("; ") || "none" : `stub "${r.stub}"`}`;
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
type Band = { text: string | null; R: number | null; D: number | null; other: number; open: number | null };
async function readBand(page: Page): Promise<Band> {
  await page.goto(`${BASE}/electoral`, { waitUntil: "networkidle" });
  const text = (await page.evaluate(`(() => { const el = document.querySelector('[data-results]'); return el ? el.textContent.split(String.fromCharCode(10)).join(' ').split(' ').filter(Boolean).join(' ') : null; })()`)) as string | null;
  const m = text?.match(/House R (\d+) · D (\d+)(?: · other (\d+))? · (\d+) open/);
  return { text, R: m ? Number(m[1]) : null, D: m ? Number(m[2]) : null, other: m?.[3] ? Number(m[3]) : 0, open: m ? Number(m[4]) : null };
}
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

// ── one build's two sessions: Nov 5 (its harvest first), then Dec 13 ────────
type Session = { harvest: { status: number; body: unknown }; nov5: Record<string, RaceRead>; dec13: Record<string, RaceRead>; band: Band; mains: Record<string, string>; selfDiffer: string[] };
async function sessions(dir: string, tag: "HEAD" | "tree", copy: CopyKind, browser: Browser, raceIds: string[], captures: boolean): Promise<Session> {
  const out: Partial<Session> = {};
  {
    const srv = await startServer(dir, `${tag}-nov5`, copy, NOV5);
    try {
      const res = await fetch(`${BASE}${HARVEST_ROUTE}`, { method: "POST", headers: { authorization: `Bearer ${srv.secret}` } });
      out.harvest = { status: res.status, body: await res.json().catch(() => null) };
      const p = (out.harvest.body as { payload?: Record<string, unknown> } | null)?.payload ?? null;
      say(`  ${tag}: its harvest, POST ${HARVEST_ROUTE} on its own server and copy · HTTP ${res.status}${p ? ` · rows ${p.rows} on ${p.races} races · ballotRaces ${p.ballotRaces} · ballotPlanned ${p.ballotPlanned} · jungle ${JSON.stringify(p.jungle)}` : ""}`);
      const { ctx, page } = await newPage(browser, 1440);
      out.nov5 = {};
      for (const id of NOV5_PAGES) { out.nov5[id] = await readRace(page, id); say(`    Nov 5 ${showRace(id, out.nov5[id]!)}`); }
      out.band = await readBand(page);
      say(`    Nov 5 /electoral's band: ${out.band.text}`);
      await ctx.close();
      // Every race page twice on the same server: a page whose two reads differ is not the build's doing.
      const mains = await pool(raceIds, 4, (id) => mainOf(id));
      const again = await pool(raceIds, 4, (id) => mainOf(id));
      out.mains = Object.fromEntries(raceIds.map((id, i) => [id, mains[i]!]));
      out.selfDiffer = raceIds.filter((_, i) => mains[i] !== again[i]);
      for (const id of out.selfDiffer) {
        const k = raceIds.indexOf(id);
        writeFileSync(path.join(ART, `main-${LABEL}-${id}-${tag}-a.html`), mains[k]!);
        writeFileSync(path.join(ART, `main-${LABEL}-${id}-${tag}-b.html`), again[k]!);
      }
      say(`    Nov 5 every race page read twice on this server: ${raceIds.length - out.selfDiffer.length} of ${raceIds.length} equal to themselves${out.selfDiffer.length ? ` · differing ${out.selfDiffer.join(", ")}` : ""}`);
      if (captures) await capture(browser, tag, NOV5_PAGES);
    } finally { await srv.kill(); }
  }
  {
    const srv = await startServer(dir, `${tag}-dec13`, copy, DEC13);
    try {
      const { ctx, page } = await newPage(browser, 1440);
      out.dec13 = {};
      for (const id of DEC13_PAGES) { out.dec13[id] = await readRace(page, id); say(`    Dec 13 ${showRace(id, out.dec13[id]!)}`); }
      await ctx.close();
      if (captures) await capture(browser, tag, DEC13_PAGES);
    } finally { await srv.kill(); }
  }
  return out as Session;
}

const rosterOf = (r: RaceRead | undefined) => new Map((r?.roster ?? []).map((x) => [x.name, x]));
async function raceCandidates(copy: CopyKind): Promise<Map<string, string>> {
  return withDb(copyUrl(copyPath(copy)), async (db) => {
    const cols = (await db.execute(`PRAGMA table_info(race_candidates)`)).rows.map((r) => String(r.name)).filter((c) => c !== "updated_at");
    const rs = await db.execute(`SELECT ${cols.join(", ")} FROM race_candidates ORDER BY race_id, name`);
    return new Map(rs.rows.map((r) => [`${r.race_id}|${r.name}`, JSON.stringify(cols.map((c) => (r as Record<string, unknown>)[c] ?? null))]));
  });
}

async function run(headDir: string, treeDir: string) {
  for (const d of [headDir, treeDir]) if (!existsSync(path.join(d, ".next", "BUILD_ID"))) throw new Error(`no build in ${d}`);
  mkdirSync(SHOTS, { recursive: true });
  const raceIds = await withDb(copyUrl(copyPath("tree")), async (db) => (await db.execute(`SELECT id FROM races WHERE cycle = 2026 ORDER BY id`)).rows.map((r) => String(r.id)));
  const rated = await withDb(copyUrl(copyPath("tree")), async (db) => (await db.execute({ sql: `SELECT DISTINCT race_id FROM race_ratings WHERE cycle = 2026 AND race_id IN (${PLANTED.map(() => "?").join(",")})`, args: PLANTED })).rows.map((r) => String(r.race_id)));
  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch();
  let H: Session, T: Session;
  try {
    say(`\n── HEAD's build on the head copy: its harvest, then the clock at Nov 5 and at Dec 13`);
    H = await sessions(headDir, "HEAD", "head", browser, raceIds, !process.argv.includes("--nocaptures"));
    say(`\n── the tree's build on the tree copy: its harvest, then the clock at Nov 5 and at Dec 13`);
    T = await sessions(treeDir, "tree", "tree", browser, raceIds, !process.argv.includes("--nocaptures"));
  } finally { await browser.close(); }
  writeFileSync(path.join(ART, `legs-${LABEL}.json`), JSON.stringify({ head: { ...H, mains: undefined }, tree: { ...T, mains: undefined } }, null, 1));
  check("1", "each build's harvest ran on its own copy (HTTP 200)", H.harvest.status === 200 && T.harvest.status === 200, `HEAD ${H.harvest.status} · tree ${T.harvest.status}`);

  // leg 1: LA-05, the runoff with its box unmarked; LA-01, the incumbent in it
  say(`\n── leg 1, the clock at Nov 5: a runoff, the box unmarked`);
  {
    const h = H.nov5["LA-05-2026"]!, t = T.nov5["LA-05-2026"]!;
    const hr = rosterOf(h), tr = rosterOf(t);
    check("1", "LA-05 HEAD red: Won primary on the D and R rows, Not yet called", h.countdown === "Not yet called" && hr.get("Pat Moore")?.label === "Won primary" && hr.get("Misti Cordell")?.label === "Won primary" && hr.size === 2, `"${h.countdown}" · ${[...hr.values()].map((x) => `${x.name} ${x.label}`).join("; ")}`);
    check("1", "LA-05 the tree green: both Advanced, Runoff Dec 12", t.countdown === "Runoff Dec 12" && tr.get("Pat Moore")?.label === "Advanced" && tr.get("Misti Cordell")?.label === "Advanced" && tr.size === 2 && ![...tr.values()].some((x) => x.elected), `"${t.countdown}" · ${[...tr.values()].map((x) => `${x.name} ${x.label}`).join("; ")}`);
    const h1 = H.nov5["LA-01-2026"]!, t1 = T.nov5["LA-01-2026"]!;
    check("1", "LA-01 HEAD red: Jewett Won primary, Not yet called, the incumbent's card with no qualifier", h1.countdown === "Not yet called" && rosterOf(h1).get("Lauren Jewett")?.label === "Won primary" && !h1.tag && h1.qualifier === null, `"${h1.countdown}" · Jewett ${rosterOf(h1).get("Lauren Jewett")?.label ?? "-"} · ${h1.tag ? `tag ${h1.tag.text}` : "no tag"} · qualifier ${h1.qualifier ?? "none"}`);
    check("1", "LA-01 the tree green: Jewett Advanced, Runoff Dec 12, and the incumbent's qualifier runoff Dec 12 (no tag: he's on his own ballot)", t1.countdown === "Runoff Dec 12" && rosterOf(t1).get("Lauren Jewett")?.label === "Advanced" && !t1.tag && t1.qualifier === "runoff Dec 12", `"${t1.countdown}" · Jewett ${rosterOf(t1).get("Lauren Jewett")?.label ?? "-"} · ${t1.tag ? `tag ${t1.tag.text}` : "no tag"} · qualifier ${t1.qualifier ?? "none"}`);
  }
  const rcH = await raceCandidates("head");
  const rcT = await raceCandidates("tree");
  {
    const keys = [...new Set([...rcH.keys(), ...rcT.keys()])].sort();
    const differ = keys.filter((k) => rcH.get(k) !== rcT.get(k));
    const outside = differ.filter((k) => !PLANTED.includes(k.split("|")[0]!));
    const inside = differ.filter((k) => PLANTED.includes(k.split("|")[0]!));
    for (const k of inside) say(`    ${k} · HEAD ${rcH.get(k) ?? "(none)"} · tree ${rcT.get(k) ?? "(none)"}`);
    check("1", "race_candidates after each build's harvest: equal to HEAD's outside the planted seats (every column but updated_at, each run's stamp)", outside.length === 0, `HEAD ${rcH.size} rows · tree ${rcT.size} rows · ${keys.length - differ.length} equal · ${inside.length} differ, all in the planted seats (${[...new Set(inside.map((k) => k.split("|")[0]))].join(", ") || "none"})${outside.length ? ` · OUTSIDE ${outside.join("; ")}` : ""}`);
  }

  // leg 2: LA-06 at Dec 13
  say(`\n── leg 2, the clock at Dec 13: the runoff decided`);
  {
    const h = H.dec13["LA-06-2026"]!, t = T.dec13["LA-06-2026"]!;
    check("2", "LA-06 HEAD red: Decided · Nov 3, 2026", h.countdown === "Decided · Nov 3, 2026" && rosterOf(h).get("Blake Miguez")?.elected === true, `"${h.countdown}" · ${(h.roster ?? []).map((x) => `${x.name} ${x.elected ? "ELECTED" : x.label}`).join("; ")}`);
    check("2", "LA-06 the tree green: Decided · Dec 12, 2026, Elected on the marked row", t.countdown === "Decided · Dec 12, 2026" && rosterOf(t).get("Blake Miguez")?.elected === true && rosterOf(t).get("Chauna Banks")?.label === "Advanced" && !rosterOf(t).get("Chauna Banks")?.elected, `"${t.countdown}" · ${(t.roster ?? []).map((x) => `${x.name} ${x.elected ? "ELECTED" : x.label}`).join("; ")} · provenance ${JSON.stringify(t.provenance)}`);
  }

  // leg 3: LA-04 and LA-03 at Nov 5, and the band
  say(`\n── leg 3, the clock at Nov 5: an outright winner, the box unmarked`);
  {
    const h = H.nov5["LA-04-2026"]!, t = T.nov5["LA-04-2026"]!;
    check("3", "LA-04 HEAD red: Not yet called", h.countdown === "Not yet called", `"${h.countdown}" · qualifier ${h.qualifier ?? "none"} · ${h.tag ? `tag ${h.tag.text}` : "no tag"}`);
    check("3", "LA-04 the tree green: Decided · Nov 3, 2026, the incumbent re-elected", t.countdown === "Decided · Nov 3, 2026" && !t.tag && t.qualifier === "re-elected", `"${t.countdown}" · qualifier ${t.qualifier ?? "none"} · ${t.tag ? `tag ${t.tag.text}` : "no tag"} · ${t.candidates ?? `stub "${t.stub}"`}`);
    const h3 = H.nov5["LA-03-2026"]!, t3 = T.nov5["LA-03-2026"]!;
    check("3", "LA-03 HEAD red: Not yet called, Cotten Won primary", h3.countdown === "Not yet called" && rosterOf(h3).get("Kate Cotten")?.label === "Won primary" && !rosterOf(h3).get("Kate Cotten")?.elected, `"${h3.countdown}" · ${(h3.roster ?? []).map((x) => `${x.name} ${x.elected ? "ELECTED" : x.label}`).join("; ")}`);
    check("3", "LA-03 the tree green: Decided · Nov 3, 2026, Elected on Cotten's row (the jungle box's mark)", t3.countdown === "Decided · Nov 3, 2026" && rosterOf(t3).get("Kate Cotten")?.elected === true, `"${t3.countdown}" · ${(t3.roster ?? []).map((x) => `${x.name} ${x.elected ? "ELECTED" : x.label}`).join("; ")} · card ${t3.tag ? `tag ${t3.tag.text}` : "no tag"}`);
    const hb = H.band, tb = T.band;
    check("3", "the band (getElectionResults): two more House R calls on the tree (LA-04, LA-03), two fewer open, D unchanged", hb.R != null && tb.R != null && tb.R - hb.R === 2 && hb.open != null && tb.open != null && hb.open - tb.open === 2 && tb.D === hb.D && tb.other === hb.other, `HEAD "${hb.text}" · tree "${tb.text}"`);
  }

  // leg 4: the control
  say(`\n── leg 4, the control at Nov 5`);
  {
    const differ = raceIds.filter((id) => H.mains[id] !== T.mains[id]);
    for (const id of differ) {
      writeFileSync(path.join(ART, `main-${LABEL}-${id}-HEAD.html`), H.mains[id]!);
      writeFileSync(path.join(ART, `main-${LABEL}-${id}-tree.html`), T.mains[id]!);
    }
    say(`  every race page read twice per server: HEAD ${H.selfDiffer.length ? `differs from itself on ${H.selfDiffer.join(", ")}` : "equal to itself on all"} · tree ${T.selfDiffer.length ? `differs from itself on ${T.selfDiffer.join(", ")}` : "equal to itself on all"}`);
    // The race page's news ages run on the real clock (app/race/[id]/page.tsx's Date.now(), HO 490), not the clock
    // seam, so a label that crosses a unit between the two builds' sessions differs with no code behind it (r1:
    // AZ-04's item of 2026-07-22T03:06:03Z turned 82d to 83d between them). The span, its tier colour and its words
    // are set aside; anything else that differs still fails.
    const ageless = (s: string) => s.replace(/<span class="age" style="[^"]*">[^<]*<\/span>/g, '<span class="age"/>');
    const all = Object.values(T.mains).join("\n");
    say(`  news ages on the tree's pages: ${(all.match(/class="age"/g) ?? []).length} spans, ${(all.match(/<span class="age" style="[^"]*">[^<]*<\/span>/g) ?? []).length} matched by the set-aside`);
    const ageOnly = differ.filter((id) => !PLANTED.includes(id) && ageless(H.mains[id]!) === ageless(T.mains[id]!));
    const outside = differ.filter((id) => !PLANTED.includes(id) && !ageOnly.includes(id));
    const noMain = raceIds.filter((id) => H.mains[id]!.startsWith("NO MAIN") || T.mains[id]!.startsWith("NO MAIN"));
    check("4", "every other race page's <main> byte-identical to HEAD's, the news ages aside", outside.length === 0 && noMain.length === 0, `${raceIds.length - PLANTED.length - outside.length - ageOnly.length} of ${raceIds.length - PLANTED.length} byte-identical${ageOnly.length ? `, ${ageOnly.length} more differing only in a news age (${ageOnly.join(", ")})` : ""} · the planted seats differing: ${differ.filter((id) => PLANTED.includes(id)).join(", ") || "none"}${outside.length ? ` · OUTSIDE ${outside.join(", ")}` : ""}${noMain.length ? ` · NO MAIN ${noMain.join(", ")}` : ""}`);
    // /electoral lists the rated seats alone. If a planted seat were rated, its row should read RUNOFF on the
    // tree in leg 1; this script doesn't read that row, so a rated planted seat fails here rather than passing.
    if (rated.length) check("4", "a planted seat is rated: its /electoral row is unread here", false, rated.join(", "));
    else say(`  (a planted seat on /electoral: none of the five is rated, so the clause doesn't apply; /electoral reads the same resultFromRows)`);
  }
}

async function main() {
  const tree = execFileSync("git", ["rev-parse", "--short", "HEAD"], { encoding: "utf8" }).trim();
  say(`=== HO 780 legs · ${LABEL} · ${new Date().toISOString()} · tree ${tree} ===`);
  if (process.argv.includes("--seed")) await seed();
  if (process.argv.includes("--leg0")) await leg0();
  if (process.argv.includes("--run")) await run(path.resolve(argAt("--head") ?? ""), path.resolve(argAt("--tree") ?? ""));
  say(`\n${LABEL}: ${passes} PASS · ${fails} FAIL${failed.length ? `\n  FAIL ${failed.join("\n  FAIL ")}` : ""}`);
}
main().catch((e) => { console.error(redactSecrets(e instanceof Error ? e.stack ?? e.message : String(e))); process.exit(1); });
