// HO 787: the GradShow poster's numbers, read from the tree and from prod, each printed with its predicate and the
// as-of time of what it read; the CRS spot-check pack; and the odds snapshot the poster needs on Nov 3. Read-only.
//
//   npx tsx scripts/diagnostic/gradshow-numbers-787.ts --numbers [--label L]
//   npx tsx scripts/diagnostic/gradshow-numbers-787.ts --crs-pack [--label L]
//   npx tsx scripts/diagnostic/gradshow-numbers-787.ts --odds-snapshot [--label L]
//
// --numbers        STEP 0's anchors re-derived from the tree, and its two prod claims (6: bills' columns; 8: the
//                  current Congress against no Congress clause); then A, the funnel and its labels; B, the CRA check;
//                  C, the sponsors; D, the build-protocol numbers (git, vercel.json, the workflows); G, usage.
// --crs-pack       F: seed 787 over the non-ceremonial bills with a CT summary; each drawn bill's CRS summaries read
//                  from Congress.gov, one request in flight and at least 1s between starts, until 30 are independent
//                  or 90 are read; writes docs/probes/787-crs-spotcheck.md.
// --odds-snapshot  E: the two odds tables' shape (the tree and prod), the rated index's coverage, then every row of
//                  kalshi_odds and polymarket_odds with its updated_at, written to
//                  docs/probes/odds-snapshots/<YYYY-MM-DD-HHMM-MT>.json (HHMM on a 24-hour clock, so the names sort)
//                  and read back before the mode exits. It never overwrites a snapshot.
//
// SAFETY. Prod is only READ. Every statement goes through q(), which refuses anything but SELECT or WITH … SELECT and
// any statement naming a write keyword; prod's schema is fingerprinted before and after each mode. rows_read is
// summed off each hrana pipeline response (the field HO 670's tap reads, scripts/diagnostic/rows-tap-670.cjs); each
// mode prints its total and appends it to docs/handoffs/787-artifacts/rows-ledger.tsv. TURSO_DATABASE_URL,
// TURSO_AUTH_TOKEN and CONGRESS_API_KEY are read from .env by name; the key rides the X-Api-Key header, never a URL,
// and every printed line passes redactSecrets. Times print in Mountain Time on a 12-hour clock with UTC beside.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type ResultSet, type Row } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getCurrentCongress } from "@/lib/congress";
import { ALLOWED_STAGES, computeStage } from "@/lib/enums";
import { congressGovUrl } from "@/lib/format";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const ART = path.resolve("docs/handoffs/787-artifacts"); // repo-ignored
const LEDGER = path.join(ART, "rows-ledger.tsv");
const PACK = path.resolve("docs/probes/787-crs-spotcheck.md");
const SNAP_DIR = path.resolve("docs/probes/odds-snapshots");
const MT = "America/Denver";

// The poster's figures, as the handoff reads them off /welcome on 2026-10-19 ("What the poster shows today").
const POSTER = { introduced: 18137, enacted: 120, sponsored12: 1551, enacted12: 9, craTotal: 215, craEnacted: 18, cronJobs: 19 };
// The poster's foot read "last sync 2:05 AM MT". /welcome prints formatMt(MAX(update_date)) of the gated corpus
// (app/welcome/page.tsx:477, corpus.lastSync), and Oct 19 is MDT (UTC-6), so the page rendered after 08:05:00Z.
// Every reproduction bound below takes that minute's start as T: a row whose summary predates T and is still there
// was in the poster's count.
const POSTER_T = "2026-10-19T08:05:00Z";
// /electoral reads getRacesIndex(sanitizeCycle(undefined)), and that default is 2026 (lib/queries.ts:382-387).
const RACE_CYCLE = 2026;
const SEED = 787;
const PACK_SIZE = 30;
const MAX_READ = 90;
const GAP_MS = 1000; // Congress.gov: one request in flight, at least 1s between starts
const CRS_MAX_CHARS = 8000;
const LAW_TYPES = new Set(["hr", "s", "hjres", "sjres"]);
const BILL_TYPES = ["hr", "s", "hjres", "sjres", "hconres", "sconres", "hres", "sres"];

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
const MODE = ["--numbers", "--crs-pack", "--odds-snapshot"].find((m) => process.argv.includes(m));
const out: string[] = [];
const say = (s = "") => { const r = redactSecrets(s); out.push(r); console.log(r); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const fmtN = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(1) : "n/a");
const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();
const results: Record<string, unknown> = {};

// ── time ────────────────────────────────────────────────────────────────────
const mtFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: MT, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
});
const mtParts = new Intl.DateTimeFormat("en-US", {
  timeZone: MT, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
function asDate(x: unknown): Date | null {
  if (x == null || x === "") return null;
  const d = x instanceof Date ? x : new Date(String(x));
  return Number.isNaN(d.getTime()) ? null : d;
}
// "Oct 19, 2026, 8:05 PM MT (2026-10-20 02:05:13Z)"
function when(x: unknown): string {
  const d = asDate(x);
  if (!d) return `${String(x)} (unparsed)`;
  return `${mtFmt.format(d)} MT (${d.toISOString().slice(0, 19).replace("T", " ")}Z)`;
}
// "2026-11-02-2130-MT": the snapshot's name, MT on a 24-hour clock so the names sort.
function mtStamp(d: Date): string {
  const p = Object.fromEntries(mtParts.formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}-${p.hour}${p.minute}-MT`;
}

// ── prod, read-only, with the rows_read tap ─────────────────────────────────
const tap = { rows: 0, results: 0, responses: 0 };
async function tapFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { ...init, signal: AbortSignal.timeout(120_000) });
  try {
    const j = (await res.clone().json()) as { results?: Array<{ response?: { result?: { rows_read?: unknown } } }> };
    let saw = false;
    for (const r of j.results ?? []) {
      const rr = r?.response?.result?.rows_read;
      if (typeof rr === "number") { tap.rows += rr; tap.results += 1; saw = true; }
    }
    if (saw) tap.responses += 1;
  } catch {
    /* not a pipeline response */
  }
  return res;
}
let db: Client | null = null;
function prod(): Client {
  if (db) return db;
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("libsql://")) throw new Error("reading prod needs the prod libsql:// URL in .env (TURSO_DATABASE_URL)");
  db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN, fetch: tapFetch });
  return db;
}
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|ANALYZE)\b/i;
let stmts = 0;
async function q(label: string, sql: string, args: InArgs = []): Promise<ResultSet> {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql) || WRITE_WORD.test(sql)) throw new Error(`prod is read-only here: ${label}`);
  const before = tap.rows;
  const t = Date.now();
  const rs = await prod().execute({ sql, args });
  stmts += 1;
  const shownArgs = Array.isArray(args) && args.length ? `  · args ${JSON.stringify(args)}` : "";
  say(`  [q] ${label}`);
  say(`      ${oneLine(sql)}${shownArgs}`);
  say(`      → ${rs.rows.length} row(s) · rows_read ${tap.rows - before} · ${Date.now() - t}ms · read ${when(new Date())}`);
  return rs;
}
const num = (v: unknown) => Number(v ?? 0);
const objs = (rs: ResultSet) => rs.rows.map((r: Row) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i] ?? null])));
async function schemaPrint(): Promise<string> {
  const rs = await q("the schema fingerprint (sqlite_master)", `SELECT type, name, sql FROM sqlite_master ORDER BY type, name`);
  return createHash("sha256").update(JSON.stringify(rs.rows.map((r) => [r.type, r.name, r.sql]))).digest("hex").slice(0, 16);
}

// ── the tree ────────────────────────────────────────────────────────────────
function grepFile(file: string, needle: string | RegExp): string[] {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  const hits: string[] = [];
  lines.forEach((l, i) => {
    if (typeof needle === "string" ? l.includes(needle) : needle.test(l)) hits.push(`${file}:${i + 1}  ${l.trim().slice(0, 150)}`);
  });
  return hits;
}
function show(label: string, file: string, needle: string | RegExp, max = 8) {
  const h = grepFile(file, needle);
  say(`  ${label}: ${h.length} hit(s)`);
  for (const x of h.slice(0, max)) say(`    ${x}`);
  if (h.length > max) say(`    … ${h.length - max} more`);
  return h;
}
function walk(dirs: string[]): string[] {
  const outFiles: string[] = [];
  const go = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) go(p);
      else outFiles.push(p);
    }
  };
  for (const d of dirs) if (existsSync(d)) go(d);
  return outFiles;
}

// ── STEP 0 ──────────────────────────────────────────────────────────────────
function step0Tree() {
  say(`\n── STEP 0, the tree (anchors re-derived at HEAD ${git(["rev-parse", "--short", "HEAD"])})`);
  show("claim 2 · /welcome's corpus read", "app/welcome/page.tsx", "getCorpusStats(true)");
  show("claim 2 · /welcome's stage read", "app/welcome/page.tsx", "getStageDistribution(undefined, true)");
  show("claim 2 · the two figures and the ratio", "app/welcome/page.tsx", /const (introduced|enacted|lawRatio) =/);
  show("claim 2 · the foot's LAST SYNC", "app/welcome/page.tsx", "LAST SYNC <span");
  show("claim 2 · getCorpusStats and getStageDistribution", "lib/queries.ts", /^export const (getCorpusStats|getStageDistribution) =/);
  show("claim 2 · their summary clause", "lib/queries.ts", 'const summaryClause = summaryGated ? " AND summary IS NOT NULL" : ""');
  show("claim 2 · the CRS summary in the prompt", "lib/summarize.ts", "CRS summary (if any)");
  show("claim 2 · the odds tables' keys", "scripts/migrate.ts", "race_id TEXT PRIMARY KEY");
  show("claim 2 · the kalshi cron's payload", "app/api/cron/kalshi/route.ts", /^\s*(payload: \{|seats: odds\.length|polymarketSeats: |house: control|senate: control)/);
  show("claim 2 · computeStage's branches", "lib/enums.ts", /^export function computeStage|return "(enacted|president|other_chamber|floor|committee)";/, 20);
  show("claim 3 · ALLOWED_STAGES", "lib/enums.ts", "export const ALLOWED_STAGES");
  show("claim 4 · the CRA slug", "lib/cluster-patterns.ts", 'id: "cra-disapproval"');
  show("claim 4 · getClusterStats", "lib/queries.ts", /^export const getClusterStats =|WHERE cluster_id IS NOT NULL GROUP BY cluster_id/);
  show("claim 5 · the Members panel", "app/welcome/panels.tsx", 'getMembersRanked({}, "volume", 1, 12)');
  show("claim 5 · bills_agg and its clauses", "lib/queries.ts", /bills_agg AS \(|WHERE sponsor_bioguide_id IS NOT NULL\$\{ceremonial\}|: " AND \(is_ceremonial = 0 OR is_ceremonial IS NULL\)";|billsAggCte\(filters\.includeCeremonial \?\? false\)/);
  show("claim 6 · the bills DDL's columns", "scripts/migrate.ts", /^\s{4}(congress|bill_type|introduced_date|latest_action_text|summary|summary_updated_at|stage) (INTEGER|TEXT)/);
  show("claim 6 · the added columns", "scripts/migrate.ts", /ensureColumn\(db, "bills", "(cluster_id|is_ceremonial|sponsor_bioguide_id|stage_observed_at)"/);
  show("claim 7 · SKILL's probe pointers", ".claude/skills/cbt/SKILL.md", "docs/probes/");
  show("claim 7 · SKILL's /welcome line", ".claude/skills/cbt/SKILL.md", /^- `\/welcome` — /);
  show("claim 7 · docs/probes/", "docs/probes/715-committee-votes-findings.md", /^# /);
  show("claim 7 · docs/probes/", "docs/probes/747-general-box-findings.md", /^# /);
}

// bills' columns as claim 6 reads them; a column this probe reads beyond the handoff's eight is selected only if there.
let billCols: string[] = [];
const col = (name: string) => (billCols.includes(name) ? name : `NULL`);

async function step0Prod(): Promise<{ congress: number; multi: boolean }> {
  say(`\n── STEP 0, prod (claims 6 and 8)`);
  let cols: string[] = [];
  try {
    cols = (await q("claim 6 · bills' columns", `SELECT name FROM pragma_table_info('bills') ORDER BY cid`)).rows.map((r) => String(r.name));
  } catch (e) {
    say(`  pragma_table_info refused (${(e as Error).message}); reading the stored DDL instead`);
    const sql = String((await q("claim 6 · bills' stored DDL", `SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bills'`)).rows[0]?.sql ?? "");
    cols = [...sql.matchAll(/[(,]\s*"?([a-z_]+)"?\s+(?:INTEGER|TEXT|REAL)/gi)].map((m) => m[1]!);
  }
  billCols = cols;
  const need = ["congress", "bill_type", "introduced_date", "summary", "summary_updated_at", "stage", "cluster_id", "latest_action_text"];
  const missing = need.filter((c) => !cols.includes(c));
  say(`  claim 6: ${cols.length} columns; the eight the handoff names ${missing.length === 0 ? "all present" : `MISSING ${missing.join(", ")}`}`);
  say(`           and the ones this probe also reads: ${["is_ceremonial", "sponsor_bioguide_id", "update_date", "stage_observed_at", "bill_number", "title"].map((c) => `${c} ${cols.includes(c) ? "yes" : "NO"}`).join(" · ")}`);
  results.claim6 = { columns: cols.length, missing };
  if (missing.length) throw new Error(`HALT: claim 6 fails: bills lacks ${missing.join(", ")}`);
  const congress = getCurrentCongress();
  const cur = num((await q(`claim 8 · bills in Congress ${congress} (getCurrentCongress())`, `SELECT COUNT(*) AS n FROM bills WHERE congress = ?`, [congress])).rows[0]?.n);
  // No Congress clause. Predicated on the primary key, which every row has, so the count is the same and its
  // rows_read is honest: a bare COUNT(*) is answered off B-tree pages and under-reports (HO 624's trap).
  const all = num((await q("claim 8 · bills, no Congress clause", `SELECT COUNT(*) AS n FROM bills WHERE id IS NOT NULL`)).rows[0]?.n);
  const multi = cur !== all;
  say(`  claim 8: Congress ${congress} holds ${fmtN(cur)} · no clause ${fmtN(all)} · ${multi ? "they differ, so every count below is reported per Congress and the current one is the poster's" : "the same: the table holds one Congress, so every count below is the 119th's"}`);
  results.claim8 = { congress, inCongress: cur, all, multi };
  return { congress, multi };
}

// ── A and B: one pass over bills ────────────────────────────────────────────
type Cell = {
  congress: number; billType: string; stage: string | null;
  nonc: boolean; gated: boolean; passed: boolean; cal: boolean; agreed: boolean; cra: boolean;
  updAfter: boolean; sumAfter: boolean; stageAfter: boolean; n: number;
  maxUpd: string | null; maxSum: string | null; maxStage: string | null;
};
const RANK: Record<string, number> = Object.fromEntries(ALLOWED_STAGES.map((s, i) => [s, i]));
const rank = (s: string | null) => (s != null && s in RANK ? RANK[s]! : -1);
const sum = (cells: Cell[], pred: (c: Cell) => boolean) => cells.reduce((a, c) => (pred(c) ? a + c.n : a), 0);
const maxOf = (vals: Array<string | null>) => vals.filter((v): v is string => !!v).sort().at(-1) ?? null;

// Every count in A and B below is a sum over this one GROUP BY's cells; each prints the predicate the sum stands for.
const cubeSql = () => `SELECT congress, bill_type, stage,
       (is_ceremonial = 0 OR is_ceremonial IS NULL) AS nonc,
       (summary IS NOT NULL) AS gated,
       COALESCE(latest_action_text LIKE '%passed house%' OR latest_action_text LIKE '%passed senate%', 0) AS passed,
       COALESCE(latest_action_text LIKE '%placed on%' AND latest_action_text LIKE '%calendar%', 0) AS cal,
       COALESCE(latest_action_text LIKE '%agreed to%', 0) AS agreed,
       COALESCE(cluster_id = 'cra-disapproval', 0) AS cra,
       COALESCE(julianday(update_date) >= julianday(?), 0) AS upd_after,
       COALESCE(julianday(summary_updated_at) >= julianday(?), 0) AS sum_after,
       COALESCE(julianday(${col("stage_observed_at")}) >= julianday(?), 0) AS stage_after,
       COUNT(*) AS n,
       MAX(update_date) AS max_upd, MAX(summary_updated_at) AS max_sum, MAX(${col("stage_observed_at")}) AS max_stage
  FROM bills
 WHERE id IS NOT NULL
 GROUP BY 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12`;

async function readCube(): Promise<Cell[]> {
  const rs = await q("A/B · one pass over bills, every dimension the counts below use", cubeSql(), [POSTER_T, POSTER_T, POSTER_T]);
  return rs.rows.map((r) => ({
    congress: num(r.congress), billType: String(r.bill_type), stage: r.stage == null ? null : String(r.stage),
    nonc: num(r.nonc) === 1, gated: num(r.gated) === 1, passed: num(r.passed) === 1, cal: num(r.cal) === 1,
    agreed: num(r.agreed) === 1, cra: num(r.cra) === 1,
    updAfter: num(r.upd_after) === 1, sumAfter: num(r.sum_after) === 1, stageAfter: num(r.stage_after) === 1,
    n: num(r.n),
    maxUpd: r.max_upd == null ? null : String(r.max_upd),
    maxSum: r.max_sum == null ? null : String(r.max_sum),
    maxStage: r.max_stage == null ? null : String(r.max_stage),
  }));
}

function funnel(title: string, predicate: string, cells: Cell[]) {
  const total = sum(cells, () => true);
  const byStage: Record<string, number> = {};
  const reached: Record<string, number> = {};
  say(`\n  ${title}`);
  say(`    predicate: ${predicate}`);
  say(`    ${"stage".padEnd(15)}${"count".padStart(9)}${"reached at least".padStart(19)}`);
  ALLOWED_STAGES.forEach((s, i) => {
    byStage[s] = sum(cells, (c) => c.stage === s);
    reached[s] = sum(cells, (c) => rank(c.stage) >= i);
    say(`    ${s.padEnd(15)}${fmtN(byStage[s]!).padStart(9)}${fmtN(reached[s]!).padStart(19)}`);
  });
  byStage.other = sum(cells, (c) => c.stage === "other");
  byStage.NULL = sum(cells, (c) => c.stage === null);
  const odd = cells.filter((c) => c.stage !== null && c.stage !== "other" && rank(c.stage) < 0);
  say(`    ${"other".padEnd(15)}${fmtN(byStage.other).padStart(9)}`);
  say(`    ${"NULL".padEnd(15)}${fmtN(byStage.NULL).padStart(9)}`);
  if (odd.length) say(`    any other value: ${[...new Set(odd.map((c) => c.stage))].join(", ")} (${sum(odd, () => true)})`);
  say(`    ${"total".padEnd(15)}${fmtN(total).padStart(9)}`);
  const enacted = byStage.enacted ?? 0;
  say(`    enacted share: ${fmtN(enacted)} of ${fmtN(total)} = ${pct(enacted, total)}%`);
  return { predicate, total, byStage, reached, enacted, enactedPct: pct(enacted, total) };
}

const GATED = "(is_ceremonial = 0 OR is_ceremonial IS NULL) AND summary IS NOT NULL";
const NONC = "(is_ceremonial = 0 OR is_ceremonial IS NULL)";
const LAW = "bill_type IN ('hr','s','hjres','sjres')";

async function sectionA(cells: Cell[], multi: boolean, congress: number) {
  say(`\n── A, the funnel`);
  // A1: the page's own statements, verbatim but for whitespace.
  const corpus = await q(
    "A1 · /welcome's corpus read, getCorpusStats(true) (lib/queries.ts:640-644)",
    `SELECT COUNT(*) AS total, MAX(update_date) AS last_sync
       FROM bills INDEXED BY idx_bills_summary_feed
       WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL) AND summary IS NOT NULL`,
  );
  const dist = await q(
    "A1 · /welcome's stage read, getStageDistribution(undefined, true) (lib/queries.ts:571-578; FUNNEL_STAGES :497-504)",
    `SELECT stage, COUNT(*) AS count
            FROM bills INDEXED BY idx_bills_summary_stage
            WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
              AND stage IN (?, ?, ?, ?, ?, ?) AND summary IS NOT NULL
            GROUP BY stage`,
    [...ALLOWED_STAGES],
  );
  const offPath = await q(
    "A1 · its offPath read (lib/queries.ts:596-603)",
    `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_summary_stage
            WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
              AND (stage = 'other' OR stage IS NULL) AND summary IS NOT NULL`,
  );
  const pageTotal = num(corpus.rows[0]?.total);
  const lastSync = corpus.rows[0]?.last_sync == null ? null : String(corpus.rows[0]!.last_sync);
  const pageEnacted = num(dist.rows.find((r) => r.stage === "enacted")?.count);
  say(`\n  A1 · the poster's scope, read with the page's own statements now:`);
  say(`    Introduced ${fmtN(pageTotal)} · Became law ${fmtN(pageEnacted)} (${pct(pageEnacted, pageTotal)}%) · the foot's LAST SYNC would read ${when(lastSync)}`);
  say(`    the poster: Introduced ${fmtN(POSTER.introduced)} · Became law ${fmtN(POSTER.enacted)} (${pct(POSTER.enacted, POSTER.introduced)}%) · LAST SYNC 2:05 AM MT`);
  // Reproduction bounds at T. A row gated now whose summary and update_date both predate T was gated when the poster
  // rendered (after T): a summary is cleared only when update_date moves, and a re-summary restamps
  // summary_updated_at. Every row the poster counted that this lower bound misses changed at or after T, so it carries
  // sum_after or upd_after, whatever its ceremonial flag is now.
  const lower = sum(cells, (c) => c.nonc && c.gated && !c.sumAfter && !c.updAfter);
  const changed = sum(cells, (c) => c.sumAfter || c.updAfter);
  const lowerE = sum(cells, (c) => c.nonc && c.gated && c.stage === "enacted" && !c.sumAfter && !c.updAfter && !c.stageAfter);
  const changedE = sum(cells, (c) => c.stage === "enacted" && (c.sumAfter || c.updAfter || c.stageAfter));
  const inT = POSTER.introduced >= lower && POSTER.introduced <= lower + changed;
  const inE = POSTER.enacted >= lowerE && POSTER.enacted <= lowerE + changedE;
  say(`    the drift since T = ${when(POSTER_T)}:`);
  say(`      gated rows whose summary and update_date predate T: ${fmtN(lower)}   (predicate: ${GATED} AND summary_updated_at < T AND update_date < T)`);
  say(`      rows touched at or after T, any scope: ${fmtN(changed)}   (summary_updated_at >= T OR update_date >= T)`);
  say(`      so the poster's Introduced lies in [${fmtN(lower)}, ${fmtN(lower + changed)}]: 18,137 is ${inT ? "INSIDE" : "OUTSIDE"}`);
  say(`      enacted, the same way: [${fmtN(lowerE)}, ${fmtN(lowerE + changedE)}] (adds stage_observed_at >= T): 120 is ${inE ? "INSIDE" : "OUTSIDE"}`);
  // Two computations of one number: the page's index-hinted statements, and the cube's full scan.
  const cubeGated = sum(cells, (c) => c.nonc && c.gated);
  const cubeEnacted = sum(cells, (c) => c.nonc && c.gated && c.stage === "enacted");
  say(`    control: the cube's ${GATED} reads ${fmtN(cubeGated)} and its enacted ${fmtN(cubeEnacted)}; the page's statements ${fmtN(pageTotal)} and ${fmtN(pageEnacted)} (${cubeGated === pageTotal && cubeEnacted === pageEnacted ? "equal" : "DIFFERENT: a write landed between the two reads, or a predicate differs"})`);
  results.A1 = {
    pageTotal, pageEnacted, pagePct: pct(pageEnacted, pageTotal), lastSync, lastSyncMt: when(lastSync),
    offPath: num(offPath.rows[0]?.n), bars: objs(dist), T: POSTER_T,
    lower, changed, upper: lower + changed, lowerE, changedE, upperE: lowerE + changedE, inT, inE,
    cubeGated, cubeEnacted,
  };
  if (!inT || !inE) say(`    HALT (A1): the poster's figures don't reproduce within the drift since T`);

  const scopes = (cs: Cell[], suffix: string) => ({
    poster: funnel(`A1 · the poster's scope${suffix}`, `${GATED} (no Congress clause)`, cs.filter((c) => c.nonc && c.gated)),
    ungated: funnel(`A2 · all non-ceremonial bills${suffix}`, NONC, cs.filter((c) => c.nonc)),
    lawGated: funnel(`A3 · law-eligible, with a CT summary${suffix}`, `${LAW} AND ${GATED}`, cs.filter((c) => c.nonc && c.gated && LAW_TYPES.has(c.billType))),
    lawUngated: funnel(`A3 · law-eligible, all${suffix}`, `${LAW} AND ${NONC}`, cs.filter((c) => c.nonc && LAW_TYPES.has(c.billType))),
  });
  results.A = scopes(cells, "");
  if (multi) results.Acurrent = scopes(cells.filter((c) => c.congress === congress), ` (Congress ${congress} only)`);

  say(`\n  A · by bill_type (non-ceremonial; gated = with a CT summary)`);
  say(`    ${"type".padEnd(9)}${"gated".padStart(8)}${"ungated".padStart(9)}${"law?".padStart(6)}${"gated enacted".padStart(15)}`);
  const byType: Record<string, { gated: number; ungated: number; law: boolean; gatedEnacted: number }> = {};
  for (const t of BILL_TYPES) {
    const g = sum(cells, (c) => c.nonc && c.gated && c.billType === t);
    const u = sum(cells, (c) => c.nonc && c.billType === t);
    const ge = sum(cells, (c) => c.nonc && c.gated && c.billType === t && c.stage === "enacted");
    byType[t] = { gated: g, ungated: u, law: LAW_TYPES.has(t), gatedEnacted: ge };
    say(`    ${t.padEnd(9)}${fmtN(g).padStart(8)}${fmtN(u).padStart(9)}${(LAW_TYPES.has(t) ? "yes" : "no").padStart(6)}${fmtN(ge).padStart(15)}`);
  }
  const otherTypes = [...new Set(cells.map((c) => c.billType))].filter((t) => !BILL_TYPES.includes(t));
  if (otherTypes.length) say(`    other bill_type values: ${otherTypes.join(", ")}`);
  const resG = sum(cells, (c) => c.nonc && c.gated && !LAW_TYPES.has(c.billType));
  const resU = sum(cells, (c) => c.nonc && !LAW_TYPES.has(c.billType));
  say(`    resolutions that cannot become law (hconres, sconres, hres, sres): gated ${fmtN(resG)} of ${fmtN(cubeGated)} (${pct(resG, cubeGated)}%), ungated ${fmtN(resU)} of ${fmtN(sum(cells, (c) => c.nonc))} (${pct(resU, sum(cells, (c) => c.nonc))}%)`);
  results.byType = { byType, resolutionsGated: resG, resolutionsUngated: resU };

  // The labels.
  say(`\n  A · the labels, in the poster's scope (${GATED})`);
  const P = cells.filter((c) => c.nonc && c.gated);
  const floorPlus = sum(P, (c) => rank(c.stage) >= RANK.floor!);
  const ocPlus = sum(P, (c) => rank(c.stage) >= RANK.other_chamber!);
  const passedOne = sum(P, (c) => c.passed || rank(c.stage) >= RANK.other_chamber!);
  const floorPassed = sum(P, (c) => c.stage === "floor" && c.passed);
  const floorNotPassed = sum(P, (c) => c.stage === "floor" && !c.passed);
  const simpleAgreed = sum(P, (c) => c.stage === "floor" && !c.passed && (c.billType === "hres" || c.billType === "sres") && c.agreed);
  const passedBelow = sum(P, (c) => c.passed && rank(c.stage) < RANK.floor!);
  const presPlus = sum(P, (c) => rank(c.stage) >= RANK.president!);
  say(`    "Reached the floor" = floor+ (stage IN floor, other_chamber, president, enacted): ${fmtN(floorPlus)}`);
  say(`      of which floor itself ${fmtN(sum(P, (c) => c.stage === "floor"))}: ${fmtN(floorPassed)} whose latest action reads passed house/senate, ${fmtN(floorNotPassed)} on another floor action (a vote, a motion, "agreed to", held at the desk)`);
  say(`    "Passed one chamber" = latest_action_text LIKE '%passed house%' OR LIKE '%passed senate%', OR stage IN (other_chamber, president, enacted): ${fmtN(passedOne)}`);
  say(`      the draft's other_chamber+ alone: ${fmtN(ocPlus)}, so it misses the ${fmtN(floorPassed)} at floor that passed their first chamber`);
  say(`      simple resolutions (hres, sres) at floor whose latest action reads "agreed to": ${fmtN(simpleAgreed)}, adopted, which is a simple resolution's last step, and not in the line above`);
  say(`      control: rows reading passed house/senate below floor (computeStage puts every one at floor or past it): ${fmtN(passedBelow)}`);
  say(`    "Sent to the president" = president+: ${fmtN(presPlus)} · "Became law" = enacted: ${fmtN(sum(P, (c) => c.stage === "enacted"))}`);
  results.labels = { floorPlus, ocPlus, passedOne, floorPassed, floorNotPassed, simpleAgreed, passedBelow, presPlus };

  // Calendar placement, by computeStage on the text and as stored.
  const calRs = await q(
    "A · calendar placement: every bill whose latest action says placed on … calendar",
    `SELECT id, bill_type, stage, latest_action_text FROM bills
      WHERE latest_action_text LIKE '%placed on%' AND latest_action_text LIKE '%calendar%'`,
  );
  const calTab = new Map<string, number>();
  for (const r of calRs.rows) {
    const k = `computeStage ${computeStage(String(r.latest_action_text ?? ""))} · stored ${r.stage ?? "NULL"}`;
    calTab.set(k, (calTab.get(k) ?? 0) + 1);
  }
  say(`    calendar placement (${fmtN(calRs.rows.length)} rows, every scope):`);
  for (const [k, v] of [...calTab].sort((a, b) => b[1] - a[1])) say(`      ${k}: ${fmtN(v)}`);
  const calComputed = new Map<string, number>();
  for (const r of calRs.rows) { const k = computeStage(String(r.latest_action_text ?? "")); calComputed.set(k, (calComputed.get(k) ?? 0) + 1); }
  results.calendar = { rows: calRs.rows.length, byComputedAndStored: Object.fromEntries(calTab), byComputed: Object.fromEntries(calComputed) };

  // Simple resolutions at enacted.
  const hresN = sum(cells, (c) => c.billType === "hres" && c.stage === "enacted");
  const sresN = sum(cells, (c) => c.billType === "sres" && c.stage === "enacted");
  const conN = sum(cells, (c) => (c.billType === "hconres" || c.billType === "sconres") && c.stage === "enacted");
  say(`    simple and concurrent resolutions stored at enacted, every scope: hres ${hresN} · sres ${sresN} · hconres+sconres ${conN}`);
  const hres = await q(
    "A · ten hres rows at enacted",
    `SELECT id, stage, ${col("previous_stage")} AS previous_stage, ${col("stage_observed_at")} AS stage_observed_at, latest_action_text FROM bills
      WHERE bill_type = 'hres' AND stage = 'enacted' ORDER BY id LIMIT 10`,
  );
  for (const r of hres.rows) say(`      ${r.id} · previous ${r.previous_stage ?? "NULL"} · observed ${when(r.stage_observed_at)} · computeStage now ${computeStage(String(r.latest_action_text ?? ""))} · "${String(r.latest_action_text ?? "").slice(0, 110)}"`);
  // The control: the same statement's shape returns rows for a type that does become law.
  const ctl = await q(
    "A · the control: the same read for hr",
    `SELECT id, stage, ${col("previous_stage")} AS previous_stage, ${col("stage_observed_at")} AS stage_observed_at, latest_action_text FROM bills
      WHERE bill_type = 'hr' AND stage = 'enacted' ORDER BY id LIMIT 3`,
  );
  for (const r of ctl.rows) say(`      ${r.id} · computeStage now ${computeStage(String(r.latest_action_text ?? ""))} · "${String(r.latest_action_text ?? "").slice(0, 90)}"`);
  const others = await q(
    "A · every other resolution at enacted (sres, hconres, sconres)",
    `SELECT id, bill_type, stage, ${col("previous_stage")} AS previous_stage, ${col("stage_observed_at")} AS stage_observed_at,
            ${col("pending_stage")} AS pending_stage, ${col("pending_stage_at")} AS pending_stage_at,
            is_ceremonial, summary IS NOT NULL AS gated, summary_updated_at, update_date, latest_action_date, latest_action_text FROM bills
      WHERE bill_type IN ('sres', 'hconres', 'sconres') AND stage = 'enacted' ORDER BY id`,
  );
  for (const r of others.rows) say(`      ${r.id} · ceremonial ${r.is_ceremonial ?? "NULL"} · gated ${r.gated} · previous ${r.previous_stage ?? "NULL"} · observed ${r.stage_observed_at ?? "NULL"} · pending ${r.pending_stage ?? "NULL"} at ${r.pending_stage_at ?? "NULL"} · summarized ${when(r.summary_updated_at)} · update_date ${when(r.update_date)} · latest action ${r.latest_action_date} · computeStage now ${computeStage(String(r.latest_action_text ?? ""))} · "${String(r.latest_action_text ?? "").slice(0, 160)}"`);
  results.simpleAtEnacted = { hres: hresN, sres: sresN, concurrent: conN, hresRows: objs(hres), control: ctl.rows.length, otherRows: objs(others) };

  // What the floor rung holds, read from each row's latest action: the latest action is all a row keeps, so a bill
  // that passed its chamber and then saw a motion to reconsider shows the motion, not the passage.
  const floorRs = await q(
    "A · the floor rung in the poster's scope, each row's latest action",
    `SELECT id, bill_type, latest_action_text FROM bills
      WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL) AND summary IS NOT NULL AND stage = 'floor'`,
  );
  const RES = new Set(["hres", "sres", "hconres", "sconres"]);
  const floorClass = (text: string): string => {
    const t = text.toLowerCase();
    if (t.includes("passed house") || t.includes("passed senate")) return "passed house/senate";
    if (t.includes("held at the desk")) return "held at the desk";
    if (t.includes("motion to reconsider") || t.includes("laid on the table")) return "a motion to reconsider, laid on the table";
    // A chamber messages the other only after it has acted on the measure.
    if (t.includes("message on senate action") || t.includes("directed the clerk to notify") || t.includes("message from the house") || t.includes("message received in")) return "a message between the chambers";
    if (t.includes("failed of passage") || t.includes("failed")) return "failed";
    if (t.includes("cloture") || t.includes("motion to proceed")) return "cloture or a motion to proceed";
    if (t.includes("agreed to")) return "agreed to";
    // computeStage reads this as committee (lib/enums.ts:167); the row keeps floor because stage only advances.
    if (t.includes("placed on") && t.includes("calendar")) return "calendar placement";
    if (t.includes("postponed proceedings") || t.includes("suspend the rules") || t.includes("on agreeing to") || t.includes("on passage")) return "a vote or motion, its outcome not in the text";
    return "other";
  };
  const tab = new Map<string, { law: number; res: number; example: string }>();
  const otherHeads = new Map<string, { n: number; computed: string }>();
  for (const r of floorRs.rows) {
    const text = String(r.latest_action_text ?? "");
    const k = floorClass(text);
    const e = tab.get(k) ?? { law: 0, res: 0, example: "" };
    if (RES.has(String(r.bill_type))) e.res += 1; else e.law += 1;
    if (!e.example) e.example = `${r.id}: ${text.slice(0, 120)}`;
    tab.set(k, e);
    if (k === "other") {
      // The rest, by their first words (numbers dropped), and what computeStage reads in each.
      const head = text.replace(/\d+/g, "N").split(/\s+/).slice(0, 7).join(" ");
      const o = otherHeads.get(head) ?? { n: 0, computed: computeStage(text) };
      o.n += 1;
      otherHeads.set(head, o);
    }
  }
  say(`    the floor rung (${fmtN(floorRs.rows.length)} rows) by its latest action, bills (hr, s, hjres, sjres) / resolutions (hres, sres, hconres, sconres):`);
  for (const [k, v] of [...tab].sort((a, b) => b[1].law + b[1].res - (a[1].law + a[1].res))) say(`      ${k}: ${v.law} / ${v.res} · e.g. ${v.example}`);
  say(`    "other", by its first seven words (computeStage on the text now):`);
  for (const [h, o] of [...otherHeads].sort((a, b) => b[1].n - a[1].n).slice(0, 15)) say(`      ${o.n} × "${h}…" → ${o.computed}`);
  const lawSum = (ks: string[]) => ks.reduce((a, k) => a + (tab.get(k)?.law ?? 0), 0);
  const resSum = (ks: string[]) => ks.reduce((a, k) => a + (tab.get(k)?.res ?? 0), 0);
  const ACTED = ["passed house/senate", "held at the desk", "a motion to reconsider, laid on the table"];
  const lawPassedAtFloor = lawSum(ACTED);
  const lawMessaged = lawSum(["a message between the chambers"]);
  const resAdoptedAtFloor = resSum([...ACTED, "agreed to"]);
  const calendarAtFloor = lawSum(["calendar placement"]) + resSum(["calendar placement"]);
  const ocPlusLaw = sum(P, (c) => LAW_TYPES.has(c.billType) && rank(c.stage) >= RANK.other_chamber!);
  const ocPlusRes = sum(P, (c) => !LAW_TYPES.has(c.billType) && rank(c.stage) >= RANK.other_chamber!);
  const lawFloorPlus = sum(P, (c) => LAW_TYPES.has(c.billType) && rank(c.stage) >= RANK.floor!);
  const lawCalendar = lawSum(["calendar placement"]);
  say(`    bills (hr, s, hjres, sjres) whose chamber acted, read from the latest action: ${fmtN(ocPlusLaw)} at other_chamber or past it, ${fmtN(lawPassedAtFloor)} at floor (passed, held at the desk, or a post-passage motion), ${fmtN(lawMessaged)} more at floor on a message between the chambers: ${fmtN(ocPlusLaw + lawPassedAtFloor)} to ${fmtN(ocPlusLaw + lawPassedAtFloor + lawMessaged)}`);
  say(`    resolutions at floor read as adopted (agreed to, passed, or a post-passage motion): ${fmtN(resAdoptedAtFloor)}; resolutions at other_chamber or past it: ${fmtN(ocPlusRes)}`);
  say(`    rows at floor whose latest action is a calendar placement (computeStage: committee; the stored stage kept): ${fmtN(calendarAtFloor)}, ${fmtN(lawCalendar)} of them bills; floor+ without them: ${fmtN(floorPlus - calendarAtFloor)} in the poster's scope, ${fmtN(lawFloorPlus - lawCalendar)} of ${fmtN(lawFloorPlus)} bills`);
  results.floorRung = {
    rows: floorRs.rows.length, byClass: Object.fromEntries(tab), otherHeads: Object.fromEntries(otherHeads),
    lawPassedAtFloor, lawMessaged, ocPlusLaw, resAdoptedAtFloor, ocPlusRes, calendarAtFloor, lawCalendar, lawFloorPlus,
  };
}

async function sectionB(cells: Cell[]) {
  say(`\n── B, the CRA check`);
  const rs = await q(
    "B · getClusterStats's own read (lib/queries.ts:8513-8518)",
    `SELECT cluster_id,
              COUNT(*) AS total,
              SUM(CASE WHEN stage IN ('floor','other_chamber','president') THEN 1 ELSE 0 END) AS past_committee,
              SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted,
              SUM(CASE WHEN is_ceremonial = 1 THEN 1 ELSE 0 END) AS ceremonial
       FROM bills INDEXED BY idx_bills_cluster_agg WHERE cluster_id IS NOT NULL GROUP BY cluster_id`,
  );
  const cra = rs.rows.find((r) => r.cluster_id === "cra-disapproval");
  const craTotal = num(cra?.total);
  const craEnacted = num(cra?.enacted);
  say(`  the Patterns row now: CRA disapproval ${fmtN(craTotal)} total · ${fmtN(craEnacted)} enacted · ${fmtN(num(cra?.past_committee))} past committee · ${fmtN(num(cra?.ceremonial))} ceremonial (the poster: 215 and 18)`);
  const ungatedEnacted = sum(cells, (c) => c.cra && c.stage === "enacted");
  const posterScopeEnacted = sum(cells, (c) => c.cra && c.nonc && c.gated && c.stage === "enacted");
  const posterScopeTotal = sum(cells, (c) => c.cra && c.nonc && c.gated);
  const gatedEnacted = sum(cells, (c) => c.nonc && c.gated && c.stage === "enacted");
  const ungatedAllEnacted = sum(cells, (c) => c.nonc && c.stage === "enacted");
  say(`  enacted with cluster_id = 'cra-disapproval':`);
  say(`    getClusterStats's scope (cluster_id only, any ceremonial flag, with or without a summary): ${fmtN(ungatedEnacted)} (control against the read above: ${ungatedEnacted === craEnacted ? "equal" : "DIFFERENT"})`);
  say(`    the poster's scope (${GATED}): ${fmtN(posterScopeEnacted)} of ${fmtN(gatedEnacted)} enacted (${pct(posterScopeEnacted, gatedEnacted)}%); CRA rows in that scope ${fmtN(posterScopeTotal)}`);
  say(`    all non-ceremonial, ungated: ${fmtN(sum(cells, (c) => c.cra && c.nonc && c.stage === "enacted"))} of ${fmtN(ungatedAllEnacted)} enacted`);
  results.B = { craTotal, craEnacted, pastCommittee: num(cra?.past_committee), ceremonial: num(cra?.ceremonial), ungatedEnacted, posterScopeEnacted, posterScopeTotal, gatedEnacted, ungatedAllEnacted, clusters: objs(rs) };
}

// ── C: the sponsors ─────────────────────────────────────────────────────────
// getMembersRanked's statement (lib/queries.ts:7511-7538) with billsAggCte(false) (:7422-7445) and
// participationAggCte() (:7471-7478, PARTICIPATION_FLOOR 50 at :9466) spliced in, comments dropped; /welcome calls it
// as getMembersRanked({}, "volume", 1, 12) (app/welcome/panels.tsx:203), so buildMemberWhere({}) is m.is_current = 1.
const MISSED = `CASE
          WHEN m.chamber = 'house'
           AND m.state IN ('DC','AS','GU','MP','PR','VI') THEN NULL
          ELSE pa.missed_pct
        END`;
const membersSql = (congressClause: string) => `
      WITH bills_agg AS (
    SELECT
      sponsor_bioguide_id,
      COUNT(*) AS total,
      SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted,
      CAST(SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS REAL)
        / COUNT(*) AS passrate
    FROM bills INDEXED BY idx_bills_sponsor_agg
    WHERE sponsor_bioguide_id IS NOT NULL AND (is_ceremonial = 0 OR is_ceremonial IS NULL)${congressClause}
    GROUP BY sponsor_bioguide_id
  ),
      part_agg AS (
    SELECT
      bioguide_id AS bid,
      CAST(not_voting AS REAL) / total AS missed_pct
    FROM member_participation
    WHERE total >= 50
  )
      SELECT
        m.bioguide_id, m.name, m.party, m.state, m.chamber, m.district,
        COALESCE(b.total,   0) AS total,
        COALESCE(b.enacted, 0) AS enacted,
        b.passrate             AS passrate,
        ps.grade               AS palestine_grade,
        ps.rank                AS palestine_rank,
        ps.total_score         AS palestine_score,
        ${MISSED}   AS missed_pct
      FROM members m
      LEFT JOIN bills_agg b ON b.sponsor_bioguide_id = m.bioguide_id
      LEFT JOIN palestine_scorecard ps ON ps.bioguide_id = m.bioguide_id
      LEFT JOIN part_agg pa ON pa.bid = m.bioguide_id
      WHERE m.is_current = 1
      ORDER BY
        CASE WHEN ? = 'missed'   THEN ${MISSED} END DESC,
        CASE WHEN ? = 'passrate' THEN passrate END DESC,
        CASE WHEN ? = 'passrate' THEN total    END DESC,
        CASE WHEN ? = 'volume'   THEN total    END DESC,
        m.name ASC
      LIMIT ? OFFSET ?
    `;
async function sectionC(multi: boolean, congress: number) {
  say(`\n── C, the sponsors`);
  const runOne = async (label: string, clause: string) => {
    const rs = await q(label, membersSql(clause), ["volume", "volume", "volume", "volume", 12, 0]);
    let s = 0, e = 0;
    rs.rows.forEach((r, i) => {
      s += num(r.total); e += num(r.enacted);
      say(`    ${String(i + 1).padStart(2)}. ${String(r.name).padEnd(28)} ${String(r.party ?? "").padEnd(2)} ${String(r.state ?? "").padEnd(3)} ${String(r.chamber).padEnd(7)} sponsored ${fmtN(num(r.total)).padStart(4)} · enacted ${num(r.enacted)}`);
    });
    say(`    sums: ${fmtN(s)} sponsored · ${fmtN(e)} enacted (the poster: 1,551 and 9)`);
    return { rows: objs(rs).map((o) => ({ bioguide_id: o.bioguide_id, name: o.name, party: o.party, state: o.state, chamber: o.chamber, total: o.total, enacted: o.enacted })), sponsored: s, enacted: e };
  };
  results.C = await runOne(`C · /welcome's Members panel, getMembersRanked({}, "volume", 1, 12), as the page runs it`, "");
  if (multi) results.Ccurrent = await runOne(`C · the same with AND congress = ${congress}`, ` AND congress = ${congress}`);
}

// ── D: the build-protocol numbers ───────────────────────────────────────────
function mtClockPair(hh: number, mm: number): string {
  const t = (d: Date) => new Intl.DateTimeFormat("en-US", { timeZone: MT, hour: "numeric", minute: "2-digit" }).format(d);
  const mdt = t(new Date(Date.UTC(2026, 9, 19, hh, mm))); // Oct 19: MDT, UTC-6
  const mst = t(new Date(Date.UTC(2026, 10, 3, hh, mm))); // Nov 3: MST, UTC-7 (DST ends Nov 1)
  return `${mdt} MDT, ${mst} MST from Nov 1`;
}
const pad2 = (x: string | number) => String(x).padStart(2, "0");
function cronWords(expr: string): string {
  const [mi = "", h = "", dom = "", mon = "", dow = ""] = expr.trim().split(/\s+/);
  if (dom !== "*" || mon !== "*") return `${expr} (not described)`;
  const days = dow === "*" ? "" : dow === "1-5" ? "weekdays, " : dow === "1" ? "Mondays, " : `days ${dow}, `;
  if (/^\*\/\d+$/.test(mi) && h === "*") return `${days}every ${mi.slice(2)} minutes`;
  if (/^\d+$/.test(mi) && /^\*\/\d+$/.test(h)) {
    const n = Number(h.slice(2));
    const hours = Array.from({ length: 24 / n }, (_, i) => `${pad2(i * n)}:${pad2(mi)}`);
    return `${days}every ${n} hours at :${pad2(mi)} (${hours.join(", ")} UTC)`;
  }
  if (/^\d+$/.test(mi) && /^\d+$/.test(h)) return `${days || "daily, "}at ${pad2(h)}:${pad2(mi)} UTC, which is ${mtClockPair(Number(h), Number(mi))}`;
  if (/^\d+$/.test(mi) && /^\d+(,\d+)+$/.test(h)) {
    const hs = h.split(",");
    return `${days}${hs.length} times a day, at ${hs.map((x) => `${pad2(x)}:${pad2(mi)}`).join(" and ")} UTC (${hs.map((x) => mtClockPair(Number(x), Number(mi))).join("; ")})`;
  }
  if (/^\d+(,\d+)+$/.test(mi) && /^\d+-\d+$/.test(h)) {
    const ms = mi.split(",").map(Number);
    const [a = 0, b = 0] = h.split("-").map(Number);
    const step = (ms[1] ?? 0) - (ms[0] ?? 0);
    return `${days}every ${step} minutes from ${pad2(a)}:${pad2(ms[0]!)} to ${pad2(b)}:${pad2(ms.at(-1)!)} UTC (${mtClockPair(a, ms[0]!)} to ${mtClockPair(b, ms.at(-1)!)})`;
  }
  return `${expr} (not described)`;
}
function sectionD() {
  const head = git(["rev-parse", "--short", "HEAD"]);
  const main = git(["rev-parse", "--short", "main"]);
  say(`\n── D, the build-protocol numbers (the tree at HEAD ${head}; git's main at ${main})`);
  const road = readFileSync("docs/roadmap.md", "utf8").split(/\r?\n/);
  const ptrs = road.flatMap((l, i) => { const m = l.match(/^- \*\*Also notes now run through HO (\d+)\.\*\*/); return m ? [{ line: i + 1, ho: Number(m[1]) }] : []; });
  const ptr = ptrs.at(-1);
  say(`  the roadmap pointer: HO ${ptr?.ho} (docs/roadmap.md:${ptr?.line}, the last of ${ptrs.length} pointer lines)`);
  const subjects = git(["log", "--format=%s", "main"]).split("\n");
  const hos = subjects.flatMap((s) => [...s.matchAll(/\bHO (\d{3,4})\b/g)].map((m) => Number(m[1])));
  const maxHo = Math.max(...hos);
  say(`  the highest HO in main's commit subjects: ${maxHo}`);
  const dated = road.flatMap((l, i) => [...l.matchAll(/\b(20\d\d-\d\d-\d\d)\b/g)].map((m) => ({ line: i + 1, date: m[1]! })));
  const firstDated = dated[0];
  const smallest = [...dated].sort((a, b) => a.date.localeCompare(b.date))[0];
  say(`  the roadmap's first dated line: docs/roadmap.md:${firstDated?.line}, ${firstDated?.date}: "${road[(firstDated?.line ?? 1) - 1]?.trim().slice(0, 110)}"`);
  say(`    (its smallest date string is ${smallest?.date} at :${smallest?.line}, a value inside an entry, not an entry's date)`);
  const roots = git(["rev-list", "--max-parents=0", "main"]).split("\n").filter(Boolean);
  const rootLines = roots.map((r) => git(["log", "-1", "--format=%h %ad %s", "--date=iso", r]));
  for (const r of rootLines) say(`  the first commit on main (git rev-list --max-parents=0 main): ${r}`);
  const literal = git(["log", "--reverse", "--format=%h %ad", "--date=iso", "-1"]);
  say(`  the handoff's command, git log --reverse --format='%h %ad' --date=iso -1, prints ${literal}: HEAD, because -1 limits the walk before --reverse orders it`);
  const firstCommitDate = asDate(git(["log", "-1", "--format=%aI", roots[0]!]));
  say(`  the earlier of the two: ${firstCommitDate && firstDated && firstCommitDate.toISOString().slice(0, 10) <= firstDated.date ? `the first commit, ${when(firstCommitDate)}` : `the roadmap's, ${firstDated?.date}`}`);
  const count = git(["rev-list", "--count", "main"]);
  say(`  git rev-list --count main: ${count}`);

  const vj = JSON.parse(readFileSync("vercel.json", "utf8")) as { crons?: Array<{ path: string; schedule: string }> };
  const crons = vj.crons ?? [];
  const paths = new Set(crons.map((c) => c.path));
  const routes = new Set(crons.map((c) => c.path.split("?")[0]));
  say(`\n  vercel.json: ${crons.length} cron entries · ${paths.size} distinct path strings · ${routes.size} distinct routes (a query string dropped)`);
  const cronRows = crons.map((c) => ({ path: c.path, schedule: c.schedule, words: cronWords(c.schedule) }));
  for (const c of cronRows) say(`    ${c.path.padEnd(32)} ${c.schedule.padEnd(20)} ${c.words}`);
  say(`  the poster's "19 cron jobs": ${crons.length} entries in vercel.json over ${routes.size} routes (${[...routes].filter((r) => crons.filter((c) => c.path.split("?")[0] === r).length > 1).join(", ")} runs on two schedules)`);

  say(`\n  the workflows (.github/workflows):`);
  const wf: Array<Record<string, unknown>> = [];
  for (const f of readdirSync(".github/workflows").filter((x) => x.endsWith(".yml")).sort()) {
    const t = readFileSync(path.join(".github/workflows", f), "utf8");
    const lines = t.split(/\r?\n/);
    const name = t.match(/^name:\s*(.+?)\s*$/m)?.[1];
    // The trigger keys: the two-space keys between `on:` and the next top-level key.
    const onAt = lines.findIndex((l) => /^on:\s*$/.test(l));
    const triggers: string[] = [];
    for (let i = onAt + 1; onAt >= 0 && i < lines.length && !/^\S/.test(lines[i]!); i++) {
      const m = lines[i]!.match(/^ {2}([a-z_]+):/);
      if (m) triggers.push(m[1]!);
    }
    const cron = [...t.matchAll(/cron:\s*'([^']+)'/g)].map((m) => m[1]);
    const ignores = [...new Set([...t.matchAll(/^\s+- '([^']+)'\s*$/gm)].map((m) => m[1]))];
    const branches = t.match(/branches:\s*\[([^\]]+)\]/)?.[1];
    const jobs = [...t.matchAll(/^ {2}([a-z][a-z0-9_-]*):\s*$/gm)].map((m) => m[1]!).filter((j) => !triggers.includes(j));
    const runs = [...t.matchAll(/^\s+run:\s*(npm (?:ci|run [^\s]+)|npx playwright test .+)$/gm)].map((m) => m[1]!.trim());
    say(`    ${f}: name "${name}" · on ${triggers.join(", ")}${cron.length ? ` (schedule ${cron.join(", ")})` : ""}${branches ? ` · push branches [${branches}]` : ""}${ignores.length ? ` · paths-ignore ${ignores.join(", ")}` : ""}`);
    say(`      jobs ${jobs.join(", ")} · runs ${[...new Set(runs)].join(" · ")}`);
    wf.push({ file: f, name, triggers, cron, branches, ignores, jobs, runs: [...new Set(runs)] });
  }
  results.D = {
    head, main, pointer: ptr, maxHo, firstDated, smallestDate: smallest, roots: rootLines, literal,
    revListCount: Number(count), crons: cronRows, entries: crons.length, pathStrings: paths.size, routes: routes.size, workflows: wf,
  };
}

// ── G: usage ────────────────────────────────────────────────────────────────
function sectionG() {
  say(`\n── G, usage (the tree)`);
  const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  const analyticsDeps = deps.filter((k) => /^@vercel\/(analytics|speed-insights)$/.test(k));
  const NEEDLES = ["@vercel/analytics", "@vercel/speed-insights", "<Analytics", "<SpeedInsights", "injectSpeedInsights"];
  const CONTROL = "unstable_cache"; // a string the walker must find, so its zero above means something
  const files = walk(["app", "components", "lib"]).filter((f) => /\.(tsx?|jsx?|mjs|cjs)$/.test(f));
  const hits: string[] = [];
  let control = 0;
  for (const f of files) {
    const t = readFileSync(f, "utf8");
    for (const n of NEEDLES) if (t.includes(n)) hits.push(`${f}: ${n}`);
    if (t.includes(CONTROL)) control++;
  }
  say(`  package.json: ${deps.length} dependencies; @vercel/analytics or @vercel/speed-insights among them: ${analyticsDeps.length}`);
  say(`  app, components, lib: ${files.length} source files; ${NEEDLES.join(", ")}: ${hits.length} hit(s)`);
  for (const h of hits) say(`    ${h}`);
  say(`  control: the same walk finds "${CONTROL}" in ${control} file(s)`);
  results.G = { deps: deps.length, analyticsDeps, files: files.length, hits, control };
}

// ── F: the CRS spot-check pack ──────────────────────────────────────────────
type Crs = { actionDate?: string; actionDesc?: string; text?: string; updateDate?: string; versionCode?: string };
type Drawn = {
  i: number; id: string; congress: number; type: string; number: number; title: string; introduced: string | null;
  summary: string; summaryAt: string | null; cls: "independent" | "shown" | "no-crs" | "unknown";
  versions: Crs[]; packVersion: Crs | null; newer: number; literalIndependent: boolean | null;
};
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(xs: T[], rnd: () => number): T[] {
  const a = xs.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}
// The newest version by actionDate, as lib/summarize.ts:154-157 orders them, updateDate breaking a tie.
const newestFirst = (vs: Crs[]) =>
  vs.slice().sort((x, y) => (y.actionDate ?? "").localeCompare(x.actionDate ?? "") || (y.updateDate ?? "").localeCompare(x.updateDate ?? ""));
function crsText(html: string): string {
  return html
    .replace(/<\/(p|li|h\d|div)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n))).replace(/&amp;/g, "&")
    .split("\n").map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
}
// Markdown-safe quoting: the texts are quoted as written, with the characters markdown would read as markup escaped.
const mdEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/([<*_`[\]])/g, "\\$1").replace(/^#/, "\\#");
const quote = (s: string) => s.split("\n").map((l) => `> ${mdEscape(l)}`).join("\n>\n");

async function crsPack() {
  const key = (process.env.CONGRESS_API_KEY ?? "").trim(); // SKILL :1838: the local .env's value carries a trailing space
  if (!key) throw new Error("CONGRESS_API_KEY is not set in .env");
  say(`\n── F, the input question (the tree)`);
  show("the CRS fetch", "lib/summarize.ts", /summaries\?|const latest = list\[0\]|crsSummary = stripHtml/);
  show("the prompt", "lib/summarize.ts", /`Bill title:|^Latest action:|^CRS summary \(if any\):|^Bill text \(truncated\):/);
  show("SKILL, the Summarization prompt", ".claude/skills/cbt/SKILL.md", /The CRS summary is a useful input|^CRS summary \(if any\): \{crs_summary\}/);

  say(`\n── F, the draw`);
  const pool = await q(
    "F · the candidates: non-ceremonial bills with a CT summary",
    `SELECT id FROM bills WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL) AND summary IS NOT NULL ORDER BY id`,
  );
  const ids = pool.rows.map((r) => String(r.id));
  const order = shuffle(ids, mulberry32(SEED));
  // The draw reproduces only against the same list, so the list's hash goes in the log.
  const listHash = createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 16);
  say(`  ${fmtN(ids.length)} candidates (the id list's sha256 ${listHash}); seed ${SEED} (mulberry32, a Fisher-Yates shuffle of the id-sorted list); the first ten drawn: ${order.slice(0, 10).join(", ")}`);

  let calls = 0;
  let lastStart = 0;
  let useHeader = true;
  const statuses: Record<string, number> = {};
  const get = async (url: string): Promise<{ status: number; body: string }> => {
    for (let attempt = 1; ; attempt++) {
      const wait = lastStart + GAP_MS - Date.now();
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
      calls += 1;
      let status = 0;
      let body = "";
      let err = "";
      try {
        const res = useHeader
          ? await fetch(url, { headers: { "X-Api-Key": key, Accept: "application/json" }, signal: AbortSignal.timeout(30_000) })
          : await fetch(`${url}&api_key=${encodeURIComponent(key)}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
        status = res.status;
        body = await res.text();
      } catch (e) {
        err = (e as Error).message;
      }
      statuses[String(status)] = (statuses[String(status)] ?? 0) + 1;
      say(`    GET ${url} → ${status || "no answer"}${err ? ` (${err})` : ""} · ${body.length} bytes · ${Date.now() - lastStart}ms · attempt ${attempt}${useHeader ? "" : " · key in the query, redacted"}`);
      if (status === 403 && useHeader && calls === 1) { useHeader = false; say(`    the X-Api-Key header was refused; the key rides the query string from here, and redactSecrets strips it from every printed line`); continue; }
      if (status === 200) return { status, body };
      if ((status === 0 || status === 429 || status >= 500) && attempt < 3) { await sleep(5000 * attempt); continue; }
      return { status, body };
    }
  };

  const drawn: Drawn[] = [];
  for (const id of order) {
    if (drawn.length >= MAX_READ) break;
    if (drawn.filter((d) => d.cls === "independent").length >= PACK_SIZE) break;
    const rs = await q(`F · candidate ${drawn.length + 1}`, `SELECT id, congress, bill_type, bill_number, title, introduced_date, summary, summary_updated_at FROM bills WHERE id = ?`, [id]);
    const b = rs.rows[0];
    if (!b) continue;
    const congress = num(b.congress), type = String(b.bill_type), number = num(b.bill_number);
    const url = `https://api.congress.gov/v3/bill/${congress}/${type}/${number}/summaries?format=json&limit=250`;
    const res = await get(url);
    if (res.status !== 200) throw new Error(`Congress.gov answered ${res.status} for ${id}; stopping rather than classify a bill unread`);
    const versions = ((JSON.parse(res.body) as { summaries?: Crs[] }).summaries ?? []).filter((v) => (v.text ?? "").trim());
    const at = asDate(b.summary_updated_at);
    const d: Drawn = {
      i: drawn.length + 1, id, congress, type, number, title: String(b.title), introduced: b.introduced_date == null ? null : String(b.introduced_date),
      summary: String(b.summary ?? ""), summaryAt: b.summary_updated_at == null ? null : String(b.summary_updated_at),
      cls: "no-crs", versions, packVersion: null, newer: 0, literalIndependent: null,
    };
    if (versions.length && !at) d.cls = "unknown";
    else if (versions.length && at) {
      // A version with no updateDate counts as there at the time, which can only move a bill toward "shown".
      const existed = versions.filter((v) => { const u = asDate(v.updateDate); return !u || u.getTime() <= at.getTime(); });
      const latest = newestFirst(versions)[0]!;
      d.cls = existed.length === 0 ? "independent" : "shown";
      d.packVersion = d.cls === "shown" ? newestFirst(existed)[0]! : latest;
      d.newer = versions.length - existed.length;
      d.literalIndependent = (asDate(latest.updateDate)?.getTime() ?? 0) > at.getTime();
    }
    drawn.push(d);
    say(`  #${d.i} ${id}: ${d.cls} · CT summary ${when(d.summaryAt)} · ${versions.length} CRS version(s)${versions.length ? `: ${newestFirst(versions).map((v) => `${v.versionCode ?? "?"} updated ${v.updateDate ?? "?"}`).join("; ")}` : ""}${d.literalIndependent !== null && (d.literalIndependent !== (d.cls === "independent")) ? " · the handoff's rule reads it independent" : ""}`);
  }
  const indep = drawn.filter((d) => d.cls === "independent");
  const shownList = drawn.filter((d) => d.cls === "shown");
  const pack = [...indep.slice(0, PACK_SIZE), ...shownList.slice(0, Math.max(0, PACK_SIZE - indep.length))];
  const flips = drawn.filter((d) => d.literalIndependent === true && d.cls === "shown").length;
  const counts = {
    candidates: ids.length, read: drawn.length, independent: indep.length, shown: shownList.length,
    noCrs: drawn.filter((d) => d.cls === "no-crs").length, unknown: drawn.filter((d) => d.cls === "unknown").length,
    pack: pack.length, flips, calls, statuses,
  };
  say(`\n  read ${counts.read} · independent ${counts.independent} · shown ${counts.shown} · no CRS summary yet ${counts.noCrs} · unclassifiable ${counts.unknown}`);
  say(`  the pack: ${counts.pack} (${Math.min(indep.length, PACK_SIZE)} independent, ${pack.length - Math.min(indep.length, PACK_SIZE)} shown) · bills the handoff's rule reads independent and this one shown: ${flips}`);
  say(`  Congress.gov: ${calls} request(s) · by status ${JSON.stringify(statuses)}`);
  results.F = { counts, seed: SEED, drawnIds: drawn.map((d) => `${d.id}:${d.cls}`) };

  const now = new Date();
  const lines: string[] = [];
  lines.push(`# HO 787 — the CRS spot-check pack: CT's summary beside CRS's, ungraded`);
  lines.push(``);
  lines.push(`> **Diagnostic-only, ungraded.** Base \`main\` at \`${git(["rev-parse", "--short", "main"])}\`. Drawn ${when(now)} by \`scripts/diagnostic/gradshow-numbers-787.ts --crs-pack\`, seed **${SEED}**. Prod was read with \`SELECT\` only. Congress.gov was read with \`CONGRESS_API_KEY\` by name, one request in flight and at least 1s between starts: **${calls} request${calls === 1 ? "" : "s"}** (${Object.entries(statuses).map(([s, n]) => `${n} × ${s}`).join(", ")}). **Corey grades; nothing here is graded.**`);
  lines.push(``);
  lines.push(`**The input question.** The summarizer's prompt carries the bill's title, its latest action, the CRS summary when one exists and the bill's text, truncated (\`lib/summarize.ts:217-220\`). It fetches the CRS summaries and takes the newest by \`actionDate\` (\`:151-161\`); SKILL records the input (Summarization prompt, \`:1887\`, \`:1900\`). So a CT summary written after a CRS summary was published was written with it in view.`);
  lines.push(``);
  lines.push(`**The rule.** A bill is **independent** when every CRS version it has carries an \`updateDate\` after the CT summary's \`summary_updated_at\`: no version was there when the summary was written. It is **shown** when at least one was. \`updateDate\` is the last change Congress.gov records for a version, not the day it was first posted, so a version posted before the CT summary and revised after it would read independent here. The handoff's rule compares only the newest version's date; on a bill with several versions that reads a bill independent though an older version was in the prompt, so this pack uses the stricter rule. ${flips} of the ${counts.read} bills read change class between the two rules.`);
  lines.push(``);
  lines.push(`**The draw.** Candidates: the ${fmtN(ids.length)} bills with \`(is_ceremonial = 0 OR is_ceremonial IS NULL) AND summary IS NOT NULL\`, ordered by id and shuffled by mulberry32(${SEED}). Read in that order until ${PACK_SIZE} were independent or ${MAX_READ} were read: **read ${counts.read}, independent ${counts.independent}, shown ${counts.shown}, no CRS summary yet ${counts.noCrs}${counts.unknown ? `, unclassifiable ${counts.unknown}` : ""}.** The pack is the independent bills, then the first shown ones in draw order, to ${PACK_SIZE}: **${Math.min(indep.length, PACK_SIZE)} independent, ${pack.length - Math.min(indep.length, PACK_SIZE)} shown.**`);
  lines.push(``);
  lines.push(`**What each section quotes.** The CT summary is \`bills.summary\` as it stands. For an independent bill the CRS text is its newest version; for a shown bill it is the version the prompt carried (the newest that was there when the CT summary was written), with any later version noted. A CRS text over ${fmtN(CRS_MAX_CHARS)} characters is cut there and says so; the full text is on the Congress.gov page linked.`);
  lines.push(``);
  lines.push(`| # | bill | class | CT summary written | CRS version quoted |`);
  lines.push(`|---|---|---|---|---|`);
  pack.forEach((d, k) => {
    const v = d.packVersion;
    lines.push(`| ${k + 1} | \`${d.id}\` | ${d.cls} | ${when(d.summaryAt)} | ${v?.actionDesc ?? "?"}, updated ${when(v?.updateDate)} |`);
  });
  pack.forEach((d, k) => {
    const v = d.packVersion!;
    const text = crsText(v.text ?? "");
    const cut = text.length > CRS_MAX_CHARS;
    lines.push(``);
    lines.push(`## ${k + 1}. \`${d.id}\`: ${mdEscape(d.title)}`);
    lines.push(``);
    lines.push(`- **Class:** ${d.cls}${d.cls === "shown" ? " (a CRS version was there when the CT summary was written)" : " (every CRS version is dated after the CT summary)"}`);
    lines.push(`- **Introduced:** ${d.introduced ?? "?"} · **Congress.gov:** ${congressGovUrl(d.congress, d.type, d.number)}`);
    lines.push(`- **CT summary written:** ${when(d.summaryAt)}`);
    lines.push(`- **CRS summary quoted:** ${v.actionDesc ?? "?"} (action date ${v.actionDate ?? "?"}, version ${v.versionCode ?? "?"}), updated ${when(v.updateDate)}${d.versions.length > 1 ? ` · ${d.versions.length} versions in all${d.cls === "shown" && d.newer ? `, ${d.newer} of them dated after the CT summary` : ""}` : ""}`);
    lines.push(``);
    lines.push(`**CT summary:**`);
    lines.push(``);
    lines.push(quote(d.summary.trim()));
    lines.push(``);
    lines.push(`**CRS summary${cut ? ` (the first ${fmtN(CRS_MAX_CHARS)} of ${fmtN(text.length)} characters)` : ""}:**`);
    lines.push(``);
    lines.push(quote(cut ? `${text.slice(0, CRS_MAX_CHARS)} …` : text));
    lines.push(``);
    lines.push(`main effect: yes / partly / no`);
    lines.push(``);
    lines.push(`factual error:`);
  });
  writeFileSync(PACK, lines.join("\n") + "\n");
  say(`\n  wrote ${path.relative(process.cwd(), PACK)} (${fmtN(Buffer.byteLength(lines.join("\n") + "\n"))} bytes, ${pack.length} sections)`);
}

// ── E: the odds snapshot ────────────────────────────────────────────────────
async function oddsSnapshot() {
  say(`\n── E, the tree`);
  const mig = readFileSync("scripts/migrate.ts", "utf8").split(/\r?\n/);
  const oddsLines = mig.flatMap((l, i) => (l.includes("odds") ? [`scripts/migrate.ts:${i + 1}  ${l.trim().slice(0, 140)}`] : []));
  say(`  grep -n odds scripts/migrate.ts: ${oddsLines.length} line(s)`);
  for (const l of oddsLines) say(`    ${l}`);
  for (const t of ["kalshi_odds", "polymarket_odds"]) {
    const start = mig.findIndex((l) => l.includes(`CREATE TABLE IF NOT EXISTS ${t} (`));
    let end = start;
    while (end >= 0 && end < mig.length && !mig[end]!.includes(")`")) end++;
    say(`  ${t}, scripts/migrate.ts:${start + 1}-${end + 1}:`);
    for (let i = start; i >= 0 && i <= end; i++) say(`    ${mig[i]!.trim()}`);
  }

  say(`\n── E, prod`);
  const tables = await q(
    "E · every table whose name says odds, kalshi, polymarket, market, tick, snapshot or history",
    `SELECT name, sql FROM sqlite_master WHERE type = 'table'
        AND (name LIKE '%odds%' OR name LIKE '%kalshi%' OR name LIKE '%polymarket%' OR name LIKE '%market%'
             OR name LIKE '%tick%' OR name LIKE '%snapshot%' OR name LIKE '%history%')
      ORDER BY name`,
  );
  for (const r of tables.rows) say(`    ${r.name}: ${oneLine(String(r.sql ?? "")).slice(0, 230)}`);
  const ds = await q("E · dashboard_state's keys", `SELECT key, updated_at, LENGTH(value) AS bytes FROM dashboard_state ORDER BY key`);
  for (const r of ds.rows) say(`    ${r.key} · ${num(r.bytes)} bytes · updated ${when(r.updated_at)}`);
  const lastRun = await q(
    "E · the kalshi cron's newest run",
    `SELECT id, started_at, ended_at, elapsed_ms, status, payload FROM cron_runs WHERE route = '/api/cron/kalshi' ORDER BY started_at DESC LIMIT 1`,
  );
  const lastOk = await q(
    "E · its newest success",
    `SELECT id, started_at, ended_at, elapsed_ms, status, payload FROM cron_runs WHERE route = '/api/cron/kalshi' AND status = 'success' ORDER BY started_at DESC LIMIT 1`,
  );
  const lr = lastRun.rows[0];
  const lo = lastOk.rows[0];
  say(`    newest run #${lr?.id} · ${lr?.status} · started ${when(lr?.started_at)} · ended ${when(lr?.ended_at)}`);
  say(`    newest success #${lo?.id} · started ${when(lo?.started_at)} · payload ${String(lo?.payload ?? "")}`);
  let payloadKeys: string[] = [];
  try { payloadKeys = Object.keys(JSON.parse(String(lo?.payload ?? "{}")) as object); } catch { /* not JSON */ }
  say(`    its payload's keys: ${payloadKeys.join(", ") || "(none)"}`);

  const idx = await q(
    `E · the rated index, getRacesIndex's join (lib/queries.ts:3122-3130), cycle ${RACE_CYCLE}`,
    `SELECT r.id AS race_id, r.chamber,
            MAX(ko.race_id IS NOT NULL) AS kalshi, MAX(pm.race_id IS NOT NULL) AS polymarket
       FROM races r
       INNER JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = r.cycle
       LEFT JOIN kalshi_odds ko ON ko.race_id = r.id
       LEFT JOIN polymarket_odds pm ON pm.race_id = r.id
      WHERE r.cycle = ?
      GROUP BY r.id
      ORDER BY r.id`,
    [RACE_CYCLE],
  );
  const rated = idx.rows.map((r) => ({ race_id: String(r.race_id), chamber: String(r.chamber), kalshi: num(r.kalshi) === 1, polymarket: num(r.polymarket) === 1 }));
  const tally = (pred: (x: (typeof rated)[number]) => boolean) => rated.filter(pred).length;
  const coverage = {
    N: rated.length, house: tally((x) => x.chamber === "house"), senate: tally((x) => x.chamber === "senate"),
    kalshi: tally((x) => x.kalshi), polymarket: tally((x) => x.polymarket),
    both: tally((x) => x.kalshi && x.polymarket), kalshiOnly: tally((x) => x.kalshi && !x.polymarket),
    polymarketOnly: tally((x) => !x.kalshi && x.polymarket), neither: tally((x) => !x.kalshi && !x.polymarket),
  };
  say(`    N = ${coverage.N} rated races (${coverage.house} House, ${coverage.senate} Senate): Kalshi ${coverage.kalshi} · Polymarket ${coverage.polymarket} · both ${coverage.both} · Kalshi only ${coverage.kalshiOnly} · Polymarket only ${coverage.polymarketOnly} · neither ${coverage.neither}`);

  const ko = await q("E · every kalshi_odds row", `SELECT * FROM kalshi_odds ORDER BY race_id`);
  const pm = await q("E · every polymarket_odds row", `SELECT * FROM polymarket_odds ORDER BY race_id`);
  const kc = num((await q("E · kalshi_odds' count, for the read-back", `SELECT COUNT(*) AS n FROM kalshi_odds WHERE race_id IS NOT NULL`)).rows[0]?.n);
  const pc = num((await q("E · polymarket_odds' count, for the read-back", `SELECT COUNT(*) AS n FROM polymarket_odds WHERE race_id IS NOT NULL`)).rows[0]?.n);
  const span = (rs: ResultSet) => { const u = rs.rows.map((r) => String(r.updated_at)).sort(); return { oldest: u[0] ?? null, newest: u.at(-1) ?? null }; };
  say(`    kalshi_odds ${ko.rows.length} rows (updated ${when(span(ko).oldest)} to ${when(span(ko).newest)}) · polymarket_odds ${pm.rows.length} (${when(span(pm).oldest)} to ${when(span(pm).newest)})`);

  const takenAt = new Date();
  mkdirSync(SNAP_DIR, { recursive: true });
  const file = path.join(SNAP_DIR, `${mtStamp(takenAt)}.json`);
  if (existsSync(file)) throw new Error(`${path.relative(process.cwd(), file)} exists; a snapshot is never overwritten, so wait a minute and run it again`);
  const snapshot = {
    ho: 787,
    kind: "odds-snapshot",
    taken_at: { utc: takenAt.toISOString(), mt: when(takenAt) },
    head: git(["rev-parse", "HEAD"]),
    cycle: RACE_CYCLE,
    note: "Every row of kalshi_odds and polymarket_odds as read, each with its updated_at. Both tables keep one row per race_id, overwritten by /api/cron/kalshi every two hours at :15 UTC; no other table keeps per-race odds.",
    last_tick: lr ? { id: num(lr.id), status: String(lr.status), started_at: String(lr.started_at), ended_at: lr.ended_at == null ? null : String(lr.ended_at) } : null,
    last_success: lo ? { id: num(lo.id), started_at: String(lo.started_at), ended_at: lo.ended_at == null ? null : String(lo.ended_at), payload: String(lo.payload ?? "") } : null,
    counts: { kalshi_odds: kc, polymarket_odds: pc, rated_index: coverage },
    rated_index: rated,
    kalshi_odds: objs(ko),
    polymarket_odds: objs(pm),
  };
  writeFileSync(file, JSON.stringify(snapshot, null, 2) + "\n");

  // The read-back, from the file as written.
  const back = JSON.parse(readFileSync(file, "utf8")) as typeof snapshot;
  const since = asDate(lo?.started_at);
  const stale = (rows: Array<Record<string, unknown>>) => rows.filter((r) => { const u = asDate(r.updated_at); return !u || !since || u.getTime() < since.getTime(); });
  const ks = stale(back.kalshi_odds);
  const ps = stale(back.polymarket_odds);
  say(`\n  the snapshot: ${path.relative(process.cwd(), file)} · ${fmtN(Buffer.byteLength(JSON.stringify(snapshot, null, 2) + "\n"))} bytes · taken ${when(takenAt)}`);
  say(`  read back: kalshi_odds ${back.kalshi_odds.length} rows against the table's ${kc} (${back.kalshi_odds.length === kc ? "equal" : "DIFFERENT"}) · polymarket_odds ${back.polymarket_odds.length} against ${pc} (${back.polymarket_odds.length === pc ? "equal" : "DIFFERENT"})`);
  say(`  every updated_at at or after the newest successful tick's start (#${lo?.id}, ${when(lo?.started_at)}): kalshi ${back.kalshi_odds.length - ks.length} of ${back.kalshi_odds.length} · polymarket ${back.polymarket_odds.length - ps.length} of ${back.polymarket_odds.length}`);
  for (const r of [...ks, ...ps].slice(0, 12)) say(`    older: ${r.race_id} · updated ${when(r.updated_at)}`);
  results.E = { file: path.relative(process.cwd(), file), takenAt: takenAt.toISOString(), kc, pc, coverage, lastRun: lr ? objs(lastRun)[0] : null, lastOk: lo ? objs(lastOk)[0] : null, staleKalshi: ks.length, stalePolymarket: ps.length, payloadKeys, dashboardState: objs(ds), tables: tables.rows.map((r) => String(r.name)) };
}

// ── the run ─────────────────────────────────────────────────────────────────
async function freshness() {
  say(`\n── what the reads below are as of`);
  for (const route of ["/api/sync", "/api/cron/summarize"]) {
    const rs = await q(
      `the newest ${route} run, and its newest success`,
      `SELECT id, started_at, ended_at, status FROM cron_runs WHERE route = ? ORDER BY started_at DESC LIMIT 1`,
      [route],
    );
    const ok = await q(`${route}'s newest success`, `SELECT id, started_at, ended_at, status FROM cron_runs WHERE route = ? AND status = 'success' ORDER BY started_at DESC LIMIT 1`, [route]);
    const r = rs.rows[0];
    const o = ok.rows[0];
    say(`    ${route}: newest #${r?.id} ${r?.status} started ${when(r?.started_at)} · newest success #${o?.id} started ${when(o?.started_at)}`);
    const fr = (results.freshness ??= {}) as Record<string, unknown>;
    fr[route] = { newest: r ? objs(rs)[0] : null, newestSuccess: o ? objs(ok)[0] : null };
  }
}

async function main() {
  if (!MODE) {
    console.error("usage: npx tsx scripts/diagnostic/gradshow-numbers-787.ts --numbers | --crs-pack | --odds-snapshot [--label L]");
    process.exit(2);
  }
  mkdirSync(ART, { recursive: true });
  const start = new Date();
  say(`HO 787 ${MODE} · label ${LABEL} · start ${when(start)} · HEAD ${git(["rev-parse", "--short", "HEAD"])} (${git(["branch", "--show-current"])}) · node ${process.version}`);
  let before = "";
  let failure: Error | null = null;
  try {
    before = await schemaPrint();
    say(`  prod's schema fingerprint before: ${before}`);
    if (MODE === "--numbers") {
      step0Tree();
      const { congress, multi } = await step0Prod();
      await freshness();
      const cells = await readCube();
      results.cubeCells = cells.length;
      results.cubeMax = { update_date: maxOf(cells.map((c) => c.maxUpd)), summary_updated_at: maxOf(cells.map((c) => c.maxSum)), stage_observed_at: maxOf(cells.map((c) => c.maxStage)) };
      say(`  the cube: ${cells.length} cells · newest update_date ${when((results.cubeMax as Record<string, string | null>).update_date)} · newest summary_updated_at ${when((results.cubeMax as Record<string, string | null>).summary_updated_at)} · newest stage_observed_at ${when((results.cubeMax as Record<string, string | null>).stage_observed_at)}`);
      await sectionA(cells, multi, congress);
      await sectionB(cells);
      await sectionC(multi, congress);
      sectionD();
      sectionG();
    } else if (MODE === "--crs-pack") {
      await crsPack();
    } else {
      await oddsSnapshot();
    }
  } catch (e) {
    failure = e as Error;
    say(`\n  ${failure.message}`);
  } finally {
    const end = new Date();
    say(`\n── safety`);
    try {
      const after = await schemaPrint();
      say(`  prod's schema fingerprint: before ${before} · after ${after} · ${before && before === after ? "unchanged" : "CHANGED OR UNREAD"}`);
      results.schema = { before, after, same: before === after };
    } catch (e) {
      say(`  the schema re-read failed: ${(e as Error).message}`);
    }
    say(`  prod: ${stmts} statement(s) · ${tap.results} pipeline result(s) carried rows_read (${tap.results === stmts ? "one per statement" : "NOT one per statement: the total below is short"}) · rows_read ${fmtN(tap.rows)}`);
    say(`  end ${when(new Date())} · ${((Date.now() - start.getTime()) / 1000).toFixed(1)}s`);
    results.cost = { statements: stmts, pipelineResults: tap.results, rowsRead: tap.rows, start: start.toISOString(), end: end.toISOString() };
    if (!existsSync(LEDGER)) writeFileSync(LEDGER, "mode\tlabel\tstart_utc\tend_utc\tstatements\tpipeline_results\trows_read\tfailed\n");
    appendFileSync(LEDGER, `${MODE}\t${LABEL}\t${start.toISOString()}\t${end.toISOString()}\t${stmts}\t${tap.results}\t${tap.rows}\t${failure ? "yes" : "no"}\n`);
    const base = path.join(ART, `${MODE.slice(2)}-${LABEL}`);
    writeFileSync(`${base}.log`, out.join("\n") + "\n");
    writeFileSync(`${base}.json`, JSON.stringify(results, null, 2) + "\n");
    db?.close();
  }
  if (failure) process.exitCode = 1;
}

main().catch((e) => {
  console.error(redactSecrets(String((e as Error)?.stack ?? e)));
  process.exitCode = 1;
});
