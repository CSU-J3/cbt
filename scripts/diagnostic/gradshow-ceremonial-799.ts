// HO 799: the GradShow poster's ceremonial bills by stage, read from prod with each count's predicate and its as-of;
// the ceremonial laws beside Pew's 12 of 121; the label's "post office" example against the tag; ten bills for Corey
// to eyeball, drawn by a stated seed. Read-only. A sibling of gradshow-numbers-787.ts, which is untouched.
//
//   npx tsx scripts/diagnostic/gradshow-ceremonial-799.ts [--label L] [--seed N]
//
// One mode. STEP 0's tree anchors re-derived at HEAD and its prod claims read (2: the stored stages; 3: the tag's
// values, a fourth value HALTs; 5: 119-sres-611; 6: bills' columns, any approval-date column named); then
//   A  one GROUP BY over bills (bill_type, stage, is_ceremonial, summary IS NOT NULL AS gated, cal, agreed), every
//      table below a sum over its cells so they share an as-of; then two separate COUNT controls, re-read once on a
//      mismatch, HALT after that, and HALT on any bill_type outside the eight;
//      then, once more, the dome's untagged rows by summarizer model and month (a finding's evidence, not a cell);
//   B  the law-eligible ceremonial laws (id, title, latest action), the same list cut to latest_action_date <=
//      2026-10-14 with its denominator (all law-eligible laws under the cut, any tag) and the laws dated after it,
//      each row's action flagged when it isn't a Became Public Law action, Pew's figure and definition beside;
//   C  law-eligible titles naming a post office or a facility of the United States Postal Service, split by the tag,
//      and five tagged not ceremonial drawn as in D;
//   D  five law-eligible ceremonial bills at floor or later and five in committee, drawn by seed (mulberry32, a
//      Fisher-Yates shuffle of the id-sorted list, HO 787's CRS-pack method), the list's hash and the first ten printed.
//
// SAFETY. Prod is only READ: every statement goes through q(), which refuses anything but SELECT or WITH … SELECT
// and any statement naming a write keyword; prod's schema is fingerprinted before and after, as the 787 script does.
// rows_read is summed off each hrana pipeline response and the total appended to docs/handoffs/799-artifacts/
// rows-ledger.tsv. TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are read from .env by name; every printed line passes
// redactSecrets. Times print in Mountain Time on a 12-hour clock (MST or MDT as the day has it) with UTC beside.
// Monday Nov 9, before the poster prints: run it once more and paste its as-of (the handoff's After the FF).
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type ResultSet, type Row } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { ALLOWED_STAGES } from "@/lib/enums";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const ART = path.resolve("docs/handoffs/799-artifacts"); // repo-ignored
const LEDGER = path.join(ART, "rows-ledger.tsv");
const MT = "America/Denver";
const LAW_TYPES = ["hr", "s", "hjres", "sjres"];
const RES_TYPES = ["hres", "sres", "hconres", "sconres"];
const EIGHT = new Set<string>([...LAW_TYPES, ...RES_TYPES]);
const LAW = `bill_type IN ('hr','s','hjres','sjres')`;
const RES = `bill_type IN ('hres','sres','hconres','sconres')`;
const CER = `is_ceremonial = 1`;
const NONC = `(is_ceremonial = 0 OR is_ceremonial IS NULL)`;
const POST_OFFICE = `(title LIKE '%post office%' OR title LIKE '%facility of the United States Postal Service%')`;
const CUT = "2026-10-14";
// HO 787's readings (docs/probes/787-gradshow-numbers.md), 7:54 PM MT Oct 19 (01:54Z Oct 20): :66 the 969 and the
// 19,106; :93-99 the law-eligible non-ceremonial 16,303 and its 119 enacted; :125 the 65 calendar rows kept at floor;
// :76, :95 and :129 the resolutions at floor (795 less 327) and the 455 adopted.
const HO787 = { held: 19106, ceremonial: 969, lawNonc: 16303, lawNoncEnacted: 119, floorCal: 65, resFloor: 468, resAgreed: 455, when: "7:54 PM MT Oct 19 (01:54Z Oct 20)" };
// Pew Research Center, as the handoff carries it (B2).
const PEW = { ceremonial: 12, laws: 121, substantive: 109, asOf: "Oct. 14, 2026", definition: "intended primarily to honor or recognize an individual, group or cause" };

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
const SEED = Number(argAt("--seed") ?? 799);
const out: string[] = [];
const say = (s = "") => { const r = redactSecrets(s); out.push(r); console.log(r); };
const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const fmtN = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? ((a / b) * 100).toFixed(1) : "n/a");
const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();
const signed = (n: number) => (n > 0 ? `+${fmtN(n)}` : fmtN(n));
const results: Record<string, unknown> = {};

// ── time ────────────────────────────────────────────────────────────────────
const mtFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: MT, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
});
function asDate(x: unknown): Date | null {
  if (x == null || x === "") return null;
  const d = x instanceof Date ? x : new Date(String(x));
  return Number.isNaN(d.getTime()) ? null : d;
}
// "Nov 4, 2026, 12:30:05 PM MST (2026-11-04 19:30:05Z)"; a bare date ("2026-10-14") prints as itself.
function when(x: unknown): string {
  if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  const d = asDate(x);
  if (!d) return `${String(x)} (unparsed)`;
  return `${mtFmt.format(d)} (${d.toISOString().slice(0, 19).replace("T", " ")}Z)`;
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
const str = (v: unknown) => (v == null ? null : String(v));
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
  const h = existsSync(file) ? grepFile(file, needle) : [];
  say(`  ${label}: ${h.length} hit(s)${existsSync(file) ? "" : " (no such file)"}`);
  for (const x of h.slice(0, max)) say(`    ${x}`);
  if (h.length > max) say(`    … ${h.length - max} more`);
  return h;
}

// ── the seed (HO 787's CRS-pack method) ─────────────────────────────────────
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
type Named = { id: string; title: string; stage: string | null };
// The pool is read id-sorted, shuffled by the seed, and the first k are the draw; the list's hash goes in the log
// because the draw reproduces only against the same list.
function draw(label: string, pool: Named[], k: number) {
  const ids = pool.map((p) => p.id).sort();
  const byId = new Map(pool.map((p) => [p.id, p]));
  const order = shuffle(ids, mulberry32(SEED));
  const listHash = createHash("sha256").update(ids.join("\n")).digest("hex").slice(0, 16);
  say(`    ${label}: ${fmtN(ids.length)} candidates (the id list's sha256 ${listHash}); seed ${SEED} (mulberry32, a Fisher-Yates shuffle of the id-sorted list); the first ten drawn: ${order.slice(0, 10).join(", ") || "(none)"}`);
  const picked = order.slice(0, k).map((id) => byId.get(id)!);
  for (const p of picked) say(`      ${p.id}${p.stage ? ` · ${p.stage}` : ""} · ${p.title}`);
  if (picked.length < k) say(`      (only ${picked.length} of ${k}: the pool has no more)`);
  return { candidates: ids.length, listHash, seed: SEED, firstTen: order.slice(0, 10), picked };
}
const named = (rs: ResultSet): Named[] => rs.rows.map((r) => ({ id: String(r.id), title: String(r.title ?? ""), stage: str(r.stage) }));

// ── STEP 0 ──────────────────────────────────────────────────────────────────
function step0Tree() {
  say(`\n── STEP 0, the tree (anchors re-derived at HEAD ${git(["rev-parse", "--short", "HEAD"])})`);
  show("claim 2 · ALLOWED_STAGES", "lib/enums.ts", /^export const ALLOWED_STAGES|^  "(introduced|committee|floor|other_chamber|president|enacted)",$/, 8);
  show("claim 2 · the HO 239 guard", "lib/summarize-runner.ts", /^export function decideStage|return "reject"|proposed === pending\) return "advance"|stageRank\(proposed\) > stageRank\(current\)/);
  show("claim 3 · the summarizer's values", "lib/summarize-runner.ts", /result\.is_ceremonial === null \? null : result\.is_ceremonial \? 1 : 0|is_ceremonial = \?/);
  show("claim 3 · the classifier's values", "scripts/classify-ceremonial.ts", /UPDATE bills SET is_ceremonial = \? WHERE id = \?|result\.is_ceremonial \? 1 : 0/);
  show("claim 3 · the sync's reset (NULL)", "lib/sync.ts", /is_ceremonial = CASE WHEN \? = 1 THEN NULL ELSE bills\.is_ceremonial END/);
  show("claim 4 · the dome's scope, as HO 787 read it", "docs/probes/787-gradshow-numbers.md", /^Predicate `bill_type IN \('hr','s','hjres','sjres'\) AND \(is_ceremonial = 0 OR is_ceremonial IS NULL\)`/);
  show("claim 4 · the dome's predicate, as HO 787 read it (:66)", "docs/probes/787-gradshow-numbers.md", /^\*\*The ungated count is the same today\.\*\* All non-ceremonial bills, `\(is_ceremonial = 0 OR is_ceremonial IS NULL\)`/);
  show("claim 5 · 119-sres-611 at HO 787", "docs/probes/787-gradshow-numbers.md", /119-sres-611/);
  show("claim 6 · historical_laws holds the 118th only", "scripts/migrate.ts", /comparison chart\. Stores the 118th only|CREATE TABLE IF NOT EXISTS historical_laws/);
  show("claim 6 · bills' date columns in the DDL", "scripts/migrate.ts", /^\s{4}(introduced_date|latest_action_date|update_date) TEXT/);
  show("claim 7 · cal and agreed in cubeSql", "scripts/diagnostic/gradshow-numbers-787.ts", /AS cal,$|AS agreed,$|^const cubeSql = /);
  show("claim 7 · the 787 usage line", "scripts/diagnostic/gradshow-numbers-787.ts", /console\.error\("usage: npx tsx scripts\/diagnostic\/gradshow-numbers-787\.ts/);
  show("claim 7 · SKILL's scripts list: the 787 script", ".claude/skills/cbt/SKILL.md", "gradshow-numbers-787");
  show("claim 7 · SKILL's scripts list: late-index-791 and the rehearsal", ".claude/skills/cbt/SKILL.md", /^- `npx tsx scripts\/diagnostic\/(late-index-791|election-night-rehearsal-777)\.ts`/);
}

let billCols: string[] = [];
async function step0Prod() {
  say(`\n── STEP 0, prod (claims 2, 3, 5 and 6)`);
  // claim 6: bills' columns; any column that could hold a law's approval date is named, none is expected.
  billCols = (await q("claim 6 · bills' columns", `SELECT name FROM pragma_table_info('bills') ORDER BY cid`)).rows.map((r) => String(r.name));
  const dateLike = billCols.filter((c) => /date|_at$/.test(c));
  const approval = billCols.filter((c) => /law|enact|approv|sign/.test(c));
  say(`  claim 6: ${billCols.length} columns; date-like: ${dateLike.join(", ")}; an approval-date column: ${approval.length ? approval.join(", ") : "none, so B2's cut uses latest_action_date as the proxy"}`);
  const needed = ["id", "bill_type", "stage", "is_ceremonial", "summary", "title", "latest_action_date", "latest_action_text", "update_date", "summary_updated_at"];
  const missing = needed.filter((c) => !billCols.includes(c));
  if (missing.length) throw new Error(`cannot run (a precondition, not one of the marked HALTs): bills lacks ${missing.join(", ")}`);
  results.claim6 = { columns: billCols, dateLike, approval };

  // claim 3: the tag's values, by SQLite type and value. Anything but integer 1, integer 0 and NULL is a fourth value.
  const vals = objs(await q("claim 3 · is_ceremonial's values", `SELECT typeof(is_ceremonial) AS t, is_ceremonial AS v, COUNT(*) AS n FROM bills WHERE id IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2`));
  for (const v of vals) say(`  claim 3: ${String(v.t)} ${v.v === null ? "NULL" : String(v.v)} · ${fmtN(num(v.n))}`);
  const fourth = vals.filter((v) => !((v.t === "integer" && (num(v.v) === 0 || num(v.v) === 1)) || v.t === "null"));
  results.claim3 = { values: vals, fourth };
  if (fourth.length) throw new Error(`HALT: claim 3 fails: is_ceremonial carries ${fourth.map((v) => `${String(v.t)} ${String(v.v)} (${fmtN(num(v.n))})`).join(", ")}`);
  say(`  claim 3 holds: 1, 0 and NULL only`);

  // claim 2 on prod: the stored stage values. The ladder is the tree's; a value outside the six, other and NULL is reported.
  const stages = objs(await q("claim 2 · the stored stages", `SELECT stage, COUNT(*) AS n FROM bills WHERE id IS NOT NULL GROUP BY 1 ORDER BY 1`));
  const offLadder = stages.filter((s) => s.stage !== null && s.stage !== "other" && !(ALLOWED_STAGES as readonly string[]).includes(String(s.stage)));
  say(`  claim 2: stored stages ${stages.map((s) => `${s.stage === null ? "NULL" : String(s.stage)} ${fmtN(num(s.n))}`).join(" · ")}${offLadder.length ? ` · OFF THE LADDER: ${offLadder.map((s) => String(s.stage)).join(", ")}` : " · none off the ladder"}`);
  results.claim2 = { stages, offLadder };

  // The eight types, and the Congress clause (one Congress at HO 787).
  const types = objs(await q("the bill types held", `SELECT bill_type, COUNT(*) AS n FROM bills WHERE id IS NOT NULL GROUP BY 1 ORDER BY 1`));
  const outside = types.filter((t) => !EIGHT.has(String(t.bill_type)));
  say(`  bill_type: ${types.map((t) => `${String(t.bill_type)} ${fmtN(num(t.n))}`).join(" · ")}${outside.length ? ` · OUTSIDE THE EIGHT: ${outside.map((t) => String(t.bill_type)).join(", ")}` : " · all eight, none outside"}`);
  const congresses = objs(await q("the Congresses held", `SELECT congress, COUNT(*) AS n FROM bills WHERE id IS NOT NULL GROUP BY 1 ORDER BY 1`));
  say(`  congress: ${congresses.map((c) => `${String(c.congress)} ${fmtN(num(c.n))}`).join(" · ")}`);
  results.types = types;
  results.congresses = congresses;

  // claim 5: 119-sres-611, stored enacted by the old stage model; its tag today decides whether A3 counts it.
  const sres = objs(await q("claim 5 · 119-sres-611", `SELECT id, bill_type, stage, is_ceremonial, (summary IS NOT NULL) AS gated, previous_stage, stage_observed_at, summary_updated_at, latest_action_date, latest_action_text FROM bills WHERE id = '119-sres-611'`))[0] ?? null;
  if (sres) say(`  claim 5: ${String(sres.id)} · stage ${String(sres.stage)} · is_ceremonial ${sres.is_ceremonial === null ? "NULL" : String(sres.is_ceremonial)} · gated ${String(sres.gated)} · previous_stage ${String(sres.previous_stage)} · stage_observed_at ${String(sres.stage_observed_at)} · summarized ${when(sres.summary_updated_at)} · latest action ${when(sres.latest_action_date)} ${String(sres.latest_action_text).slice(0, 120)}`);
  else say(`  claim 5: 119-sres-611 is not in bills`);
  results.claim5 = sres;
}

async function freshness() {
  say(`\n── what the reads below are as of`);
  for (const route of ["/api/sync", "/api/cron/summarize"]) {
    const rs = await q(`the newest ${route} run`, `SELECT id, started_at, ended_at, status FROM cron_runs WHERE route = ? ORDER BY started_at DESC LIMIT 1`, [route]);
    const ok = await q(`${route}'s newest success`, `SELECT id, started_at, ended_at, status FROM cron_runs WHERE route = ? AND status = 'success' ORDER BY started_at DESC LIMIT 1`, [route]);
    const r = rs.rows[0];
    const o = ok.rows[0];
    say(`    ${route}: newest #${String(r?.id)} ${String(r?.status)} started ${when(r?.started_at)} · newest success #${String(o?.id)} started ${when(o?.started_at)}`);
    const fr = (results.freshness ??= {}) as Record<string, unknown>;
    fr[route] = { newest: r ? objs(rs)[0] : null, newestSuccess: o ? objs(ok)[0] : null };
  }
}

// ── A: one statement, every table a sum over its cells ──────────────────────
type Cell = { billType: string; stage: string | null; cer: number | null; gated: boolean; cal: boolean; agreed: boolean; n: number; maxUpd: string | null; maxSum: string | null };
const RANK: Record<string, number> = Object.fromEntries(ALLOWED_STAGES.map((s, i) => [s, i]));
const rank = (s: string | null) => (s != null && s in RANK ? RANK[s]! : -1);
const FLOOR = RANK.floor!;
const sum = (cells: Cell[], pred: (c: Cell) => boolean) => cells.reduce((a, c) => (pred(c) ? a + c.n : a), 0);
const maxOf = (vals: Array<string | null>) => vals.filter((v): v is string => !!v).sort().at(-1) ?? null;
const isLaw = (c: Cell) => LAW_TYPES.includes(c.billType);
const isRes = (c: Cell) => RES_TYPES.includes(c.billType);
const isCer = (c: Cell) => c.cer === 1;
const isNonc = (c: Cell) => c.cer === 0 || c.cer === null;

// cal and agreed are gradshow-numbers-787.ts's cubeSql values (:248-249), copied, not imported.
const CUBE_SQL = `SELECT bill_type, stage, is_ceremonial,
       (summary IS NOT NULL) AS gated,
       COALESCE(latest_action_text LIKE '%placed on%' AND latest_action_text LIKE '%calendar%', 0) AS cal,
       COALESCE(latest_action_text LIKE '%agreed to%', 0) AS agreed,
       COUNT(*) AS n,
       MAX(update_date) AS max_upd, MAX(summary_updated_at) AS max_sum
  FROM bills
 WHERE id IS NOT NULL
 GROUP BY 1, 2, 3, 4, 5, 6`;

async function readCube(label: string): Promise<{ cells: Cell[]; at: Date }> {
  const rs = await q(`A · ${label}: one GROUP BY over bills (bill_type, stage, is_ceremonial, gated, cal, agreed)`, CUBE_SQL);
  const at = new Date();
  const cells = rs.rows.map((r) => ({
    billType: String(r.bill_type), stage: str(r.stage), cer: r.is_ceremonial == null ? null : num(r.is_ceremonial),
    gated: num(r.gated) === 1, cal: num(r.cal) === 1, agreed: num(r.agreed) === 1, n: num(r.n),
    maxUpd: str(r.max_upd), maxSum: str(r.max_sum),
  }));
  return { cells, at };
}
async function readControls(label: string) {
  const law = num((await q(`control 1 · ${label}: the law-eligible rows, one statement`, `SELECT COUNT(*) AS n FROM bills WHERE ${LAW}`)).rows[0]?.n);
  const cer = num((await q(`control 2 · ${label}: the rows tagged ceremonial, one statement`, `SELECT COUNT(*) AS n FROM bills WHERE ${CER}`)).rows[0]?.n);
  return { law, cer };
}

type Funnel = { predicate: string; total: number; byStage: Record<string, number>; calByStage: Record<string, number>; reached: Record<string, number>; other: number; nul: number; odd: Record<string, number> };
function funnel(title: string, predicate: string, cells: Cell[]): Funnel {
  const total = sum(cells, () => true);
  const byStage: Record<string, number> = {};
  const calByStage: Record<string, number> = {};
  const reached: Record<string, number> = {};
  say(`\n  ${title}`);
  say(`    predicate: ${predicate}`);
  say(`    ${"stage".padEnd(15)}${"count".padStart(9)}${"of which cal".padStart(14)}${"reached at least".padStart(19)}`);
  ALLOWED_STAGES.forEach((s, i) => {
    byStage[s] = sum(cells, (c) => c.stage === s);
    calByStage[s] = sum(cells, (c) => c.stage === s && c.cal);
    reached[s] = sum(cells, (c) => rank(c.stage) >= i);
    say(`    ${s.padEnd(15)}${fmtN(byStage[s]!).padStart(9)}${fmtN(calByStage[s]!).padStart(14)}${fmtN(reached[s]!).padStart(19)}`);
  });
  const other = sum(cells, (c) => c.stage === "other");
  const nul = sum(cells, (c) => c.stage === null);
  const oddCells = cells.filter((c) => c.stage !== null && c.stage !== "other" && rank(c.stage) < 0);
  const odd: Record<string, number> = {};
  for (const c of oddCells) odd[String(c.stage)] = (odd[String(c.stage)] ?? 0) + c.n;
  say(`    ${"other".padEnd(15)}${fmtN(other).padStart(9)}${fmtN(sum(cells, (c) => c.stage === "other" && c.cal)).padStart(14)}`);
  say(`    ${"NULL".padEnd(15)}${fmtN(nul).padStart(9)}${fmtN(sum(cells, (c) => c.stage === null && c.cal)).padStart(14)}`);
  if (oddCells.length) say(`    any other value: ${Object.entries(odd).map(([k, v]) => `${k} ${fmtN(v)}`).join(", ")}`);
  say(`    ${"total".padEnd(15)}${fmtN(total).padStart(9)}`);
  say(`    cal = ${oneLine(`COALESCE(latest_action_text LIKE '%placed on%' AND latest_action_text LIKE '%calendar%', 0)`)}, HO 787's value; at floor ${fmtN(calByStage.floor ?? 0)} (HO 787 read ${HO787.floorCal} in the non-ceremonial scope)`);
  return { predicate, total, byStage, calByStage, reached, other, nul, odd };
}

async function sectionA() {
  say(`\n── A, ceremonial by stage`);
  say(`  the statement: ${oneLine(CUBE_SQL)}`);
  let { cells, at } = await readCube("read 1");
  let ctl = await readControls("read 1");
  const check = (cs: Cell[], c: { law: number; cer: number }) => {
    const a1 = sum(cs, (x) => isLaw(x) && isCer(x));
    const a2 = sum(cs, (x) => isLaw(x) && isNonc(x));
    const a3 = sum(cs, (x) => isRes(x) && isCer(x));
    const outside = [...new Set(cs.filter((x) => !EIGHT.has(x.billType)).map((x) => x.billType))];
    return { a1, a2, a3, outside, lawOk: a1 + a2 === c.law, cerOk: a1 + a3 === c.cer };
  };
  let k = check(cells, ctl);
  say(`  controls, read 1: A1 + A2 = ${fmtN(k.a1)} + ${fmtN(k.a2)} = ${fmtN(k.a1 + k.a2)} against control 1 ${fmtN(ctl.law)} (${k.lawOk ? "equal" : "NOT EQUAL"}); A1 + A3 = ${fmtN(k.a1)} + ${fmtN(k.a3)} = ${fmtN(k.a1 + k.a3)} against control 2 ${fmtN(ctl.cer)} (${k.cerOk ? "equal" : "NOT EQUAL"}); bill_type outside the eight: ${k.outside.length ? k.outside.join(", ") : "none"}`);
  let reread = false;
  if (!k.lawOk || !k.cerOk || k.outside.length) {
    say(`  a mismatch: a sync can land between statements, so all three are re-read once`);
    reread = true;
    ({ cells, at } = await readCube("read 2"));
    ctl = await readControls("read 2");
    k = check(cells, ctl);
    say(`  controls, read 2: A1 + A2 = ${fmtN(k.a1 + k.a2)} against ${fmtN(ctl.law)} (${k.lawOk ? "equal" : "NOT EQUAL"}); A1 + A3 = ${fmtN(k.a1 + k.a3)} against ${fmtN(ctl.cer)} (${k.cerOk ? "equal" : "NOT EQUAL"}); outside the eight: ${k.outside.length ? k.outside.join(", ") : "none"}`);
  }
  results.A = { cells: cells.length, cubeAt: at.toISOString(), controls: ctl, check: k, reread, maxUpd: maxOf(cells.map((c) => c.maxUpd)), maxSum: maxOf(cells.map((c) => c.maxSum)) };
  say(`  the cube: ${cells.length} cells · as of ${when(at)} · newest update_date ${when(maxOf(cells.map((c) => c.maxUpd)))} · newest summary_updated_at ${when(maxOf(cells.map((c) => c.maxSum)))}`);
  const halts: string[] = [];
  if (!k.lawOk) halts.push(`A1 + A2 (${fmtN(k.a1 + k.a2)}) ≠ the law-eligible count (${fmtN(ctl.law)})`);
  if (!k.cerOk) halts.push(`A1 + A3 (${fmtN(k.a1 + k.a3)}) ≠ the ceremonial count (${fmtN(ctl.cer)})`);
  if (k.outside.length) halts.push(`bill_type outside the eight: ${k.outside.join(", ")}`);

  const held = sum(cells, () => true);
  const a1 = funnel("A1 · law-eligible and ceremonial", `${LAW} AND ${CER}`, cells.filter((c) => isLaw(c) && isCer(c)));
  const a2 = funnel("A2 · the dome's own predicate: law-eligible, not ceremonial or unclassified", `${LAW} AND ${NONC}`, cells.filter((c) => isLaw(c) && isNonc(c)));
  const unclassified = cells.filter((c) => isLaw(c) && c.cer === null);
  const uncG = sum(unclassified, (c) => c.gated);
  const uncU = sum(unclassified, (c) => !c.gated);
  say(`    unclassified inside A2 (is_ceremonial IS NULL): ${fmtN(uncG + uncU)} · with a summary (gated) ${fmtN(uncG)} · awaiting one ${fmtN(uncU)}`);
  const a2Classified = sum(cells, (c) => isLaw(c) && c.cer === 0);
  say(`    tagged not ceremonial (is_ceremonial = 0): ${fmtN(a2Classified)}`);

  say(`\n  A3 · the other four types and ceremonial`);
  say(`    predicate: ${RES} AND ${CER}`);
  const a3Cells = cells.filter((c) => isRes(c) && isCer(c));
  const a3 = sum(a3Cells, () => true);
  const a3Floor = sum(a3Cells, (c) => rank(c.stage) >= FLOOR);
  const a3Agreed = sum(a3Cells, (c) => c.agreed);
  const a3ByType: Record<string, number> = {};
  for (const t of RES_TYPES) a3ByType[t] = sum(a3Cells, (c) => c.billType === t);
  const a3ByStage: Record<string, number> = {};
  for (const s of ALLOWED_STAGES) a3ByStage[s] = sum(a3Cells, (c) => c.stage === s);
  a3ByStage.other = sum(a3Cells, (c) => c.stage === "other");
  a3ByStage.NULL = sum(a3Cells, (c) => c.stage === null);
  say(`    total ${fmtN(a3)} (${RES_TYPES.map((t) => `${t} ${fmtN(a3ByType[t]!)}`).join(" · ")})`);
  say(`    at floor or later (stage IN ('floor','other_chamber','president','enacted')): ${fmtN(a3Floor)}; by stage ${Object.entries(a3ByStage).map(([s, n]) => `${s} ${fmtN(n)}`).join(" · ")}`);
  say(`    with agreed set (${oneLine(`COALESCE(latest_action_text LIKE '%agreed to%', 0)`)}, HO 787's value): ${fmtN(a3Agreed)}`);
  say(`    the two aren't the same number: a concurrent resolution's other_chamber means one chamber only, and a resolution's adoption reads floor (HO 787: 468 at floor, 455 adopted, non-ceremonial scope)`);

  say(`\n  A4 · totals (every figure a sum over the same cells, as of ${when(at)})`);
  const cerAll = sum(cells, isCer);
  const lawAll = sum(cells, isLaw);
  say(`    ceremonial across all types: ${fmtN(cerAll)} beside HO 787's ${fmtN(HO787.ceremonial)} (${HO787.when}): drift ${signed(cerAll - HO787.ceremonial)}`);
  say(`    law-eligible ceremonial (A1): ${fmtN(a1.total)} · A3: ${fmtN(a3)} · A1 + A3 = ${fmtN(a1.total + a3)}`);
  say(`    law-eligible, any tag (A1 + A2): ${fmtN(lawAll)} beside HO 787's 16,303 + A1 = ${fmtN(HO787.lawNonc + a1.total)}: drift ${signed(lawAll - (HO787.lawNonc + a1.total))} (so A2 ${fmtN(a2.total)} beside 16,303: ${signed(a2.total - HO787.lawNonc)})`);
  say(`    rows held: ${fmtN(held)} beside HO 787's ${fmtN(HO787.held)}: ${signed(held - HO787.held)}`);
  say(`    the dome's enacted: A2 ${fmtN(a2.byStage.enacted ?? 0)} beside HO 787's ${HO787.lawNoncEnacted}; hollow (A1) at enacted ${fmtN(a1.byStage.enacted ?? 0)}`);
  results.A1 = a1;
  results.A2 = { ...a2, unclassified: { total: uncG + uncU, gated: uncG, ungated: uncU }, taggedNot: a2Classified };
  results.A3 = { total: a3, byType: a3ByType, byStage: a3ByStage, atFloorOrLater: a3Floor, agreed: a3Agreed };
  results.A4 = { ceremonialAll: cerAll, drift969: cerAll - HO787.ceremonial, lawAll, lawDriftVs16303PlusA1: lawAll - (HO787.lawNonc + a1.total), a2DriftVs16303: a2.total - HO787.lawNonc, held, heldDrift: held - HO787.held };
  if (halts.length) throw new Error(`HALT (A): ${halts.join("; ")}`);
  return { cells, at, a1, a2, a3 };
}

// ── B: ceremonial laws ──────────────────────────────────────────────────────
async function sectionB(cells: Cell[]) {
  say(`\n── B, ceremonial laws`);
  const sql = `SELECT id, title, latest_action_date, latest_action_text FROM bills WHERE ${LAW} AND stage = 'enacted' AND ${CER} ORDER BY latest_action_date, id`;
  const rows = objs(await q("B1 · law-eligible bills at enacted tagged ceremonial", sql));
  const isLaw = (t: unknown) => /became public law/i.test(String(t ?? ""));
  say(`  B1 · ${fmtN(rows.length)} rows (predicate ${LAW} AND stage = 'enacted' AND ${CER}):`);
  for (const r of rows) say(`    ${String(r.id)} · ${when(r.latest_action_date)} · ${isLaw(r.latest_action_text) ? "law" : "NOT A BECAME-PUBLIC-LAW ACTION"} · ${String(r.title).slice(0, 110)} · ${String(r.latest_action_text ?? "").slice(0, 80)}`);
  const cut = rows.filter((r) => r.latest_action_date != null && String(r.latest_action_date) <= CUT); // the SQL cut's semantics: a NULL date is outside it
  const notLaw = rows.filter((r) => !isLaw(r.latest_action_text));
  const den = objs(await q(`B2 · the denominator: law-eligible bills at enacted with latest_action_date <= ${CUT}, by tag`, `SELECT is_ceremonial, COUNT(*) AS n FROM bills WHERE ${LAW} AND stage = 'enacted' AND latest_action_date <= ? GROUP BY 1`, [CUT]));
  const denTotal = den.reduce((a, r) => a + num(r.n), 0);
  const denBy = Object.fromEntries(den.map((r) => [r.is_ceremonial === null ? "NULL" : String(r.is_ceremonial), num(r.n)]));
  const enactedAll = sum(cells, (c) => isLawCell(c) && c.stage === "enacted");
  const enactedCer = sum(cells, (c) => isLawCell(c) && c.stage === "enacted" && c.cer === 1);
  say(`  B2 · cut to latest_action_date <= '${CUT}' (the proxy: bills stores no approval date, STEP 0 claim 6):`);
  say(`    CT: ${fmtN(cut.length)} ceremonial of ${fmtN(denTotal)} law-eligible laws under the cut (by tag: ${Object.entries(denBy).map(([k, v]) => `${k} ${fmtN(v)}`).join(" · ")}); ${fmtN(cut.length)} of ${fmtN(denTotal)} = ${pct(cut.length, denTotal)}%`);
  say(`    Pew Research Center: ${PEW.ceremonial} ceremonial of ${PEW.laws} laws as of ${PEW.asOf} (${PEW.substantive} substantive); Pew's definition: "${PEW.definition}", and its coders aren't CT's classifier`);
  say(`    without the cut: ${fmtN(enactedCer)} ceremonial of ${fmtN(enactedAll)} law-eligible laws (the cube's cells, A)`);
  say(`    rows whose latest action isn't a Became Public Law action (so its date isn't the approval date): ${notLaw.length ? notLaw.map((r) => String(r.id)).join(", ") : "none"}`);
  const after = objs(await q(`B2 · the law-eligible laws dated after the cut (latest_action_date > ${CUT}), any tag`, `SELECT id, latest_action_date, is_ceremonial, latest_action_text FROM bills WHERE ${LAW} AND stage = 'enacted' AND latest_action_date > ? ORDER BY latest_action_date, id`, [CUT]));
  say(`    dated after the cut: ${fmtN(after.length)}${after.length ? ` (${after.map((r) => `${String(r.id)} ${when(r.latest_action_date)}${r.is_ceremonial === null ? " untagged" : num(r.is_ceremonial) === 1 ? " ceremonial" : ""}${isLaw(r.latest_action_text) ? "" : " NOT A BECAME-PUBLIC-LAW ACTION"}`).join(", ")})` : ""}`);
  say(`  B3 · the reconcile HO (CT's laws against the Archives) hadn't landed as of HO 799's base 281c81d, so B1 is re-derived here, not cited; a re-run at a HEAD where it has landed cites its list instead (the handoff's B3)`);
  results.B = { rows, cut: cut.map((r) => String(r.id)), cutN: cut.length, denominator: denTotal, denominatorByTag: denBy, notLaw: notLaw.map((r) => String(r.id)), afterCut: after, enactedAll, enactedCer, pew: PEW };
}
const isLawCell = (c: Cell) => LAW_TYPES.includes(c.billType);

// ── A2's unclassified, read once more: the finding's evidence, not one of A's cells ──────────────────────────────
async function unclassified() {
  say(`\n── A2's unclassified, read once more (a finding's evidence; A's tables stay sums over the one statement)`);
  show("the summarizer asks for the field and stores NULL when the answer isn't a boolean", "lib/summarize.ts", /^- is_ceremonial: true if the bill's primary purpose is symbolic|typeof obj\.is_ceremonial === "boolean" \? obj\.is_ceremonial : null|\/\/ backfill script can pick it up later\. Don't guess\./);
  show("the backfill classifier reads the NULL rows", "scripts/classify-ceremonial.ts", /SELECT id, title, latest_action_text FROM bills WHERE is_ceremonial IS NULL/);
  const byMonth = (rs: Record<string, unknown>[]) => rs.map((r) => `${String(r.month ?? "NULL")} ${String(r.summary_model ?? "NULL")} ${fmtN(num(r.n))}`).join(" · ") || "(none)";
  const untagged = objs(await q("the law-eligible rows with a summary and no tag, by the summarizer's model and the month summarized", `SELECT summary_model, substr(summary_updated_at, 1, 7) AS month, COUNT(*) AS n FROM bills WHERE ${LAW} AND is_ceremonial IS NULL AND summary IS NOT NULL GROUP BY 1, 2 ORDER BY 2, 1`));
  const tagged = objs(await q("control: the law-eligible rows with a summary and a tag, the same grouping", `SELECT summary_model, substr(summary_updated_at, 1, 7) AS month, COUNT(*) AS n FROM bills WHERE ${LAW} AND is_ceremonial IS NOT NULL AND summary IS NOT NULL GROUP BY 1, 2 ORDER BY 2, 1`));
  say(`    untagged, with a summary: ${byMonth(untagged)}`);
  say(`    tagged, with a summary (control): ${byMonth(tagged)}`);
  results.unclassified = { untagged, tagged };
}

// ── C: the label's example ──────────────────────────────────────────────────
async function sectionC() {
  say(`\n── C, the label's example: "like naming a post office"`);
  const split = objs(await q("C · law-eligible titles naming a post office or a USPS facility, by tag (LIKE is case-insensitive for ASCII)", `SELECT is_ceremonial, COUNT(*) AS n FROM bills WHERE ${LAW} AND ${POST_OFFICE} GROUP BY 1`));
  const by = { ceremonial: 0, not: 0, unclassified: 0 };
  for (const r of split) { if (r.is_ceremonial === null) by.unclassified += num(r.n); else if (num(r.is_ceremonial) === 1) by.ceremonial += num(r.n); else by.not += num(r.n); }
  say(`  predicate: ${LAW} AND ${POST_OFFICE}`);
  say(`  tagged ceremonial ${fmtN(by.ceremonial)} · tagged not ceremonial ${fmtN(by.not)} · unclassified ${fmtN(by.unclassified)} · total ${fmtN(by.ceremonial + by.not + by.unclassified)}`);
  const pool = named(await q("C · the pool: those tagged not ceremonial, id-sorted", `SELECT id, title, stage FROM bills WHERE ${LAW} AND ${POST_OFFICE} AND is_ceremonial = 0 ORDER BY id`));
  const drawn = pool.length ? draw("five tagged not ceremonial", pool, 5) : null;
  if (!pool.length) say(`    five tagged not ceremonial: none exist`);
  results.C = { split: by, drawn };
}

// ── D: ten for Corey to eyeball ─────────────────────────────────────────────
async function sectionD() {
  say(`\n── D, ten for Corey to eyeball (seed ${SEED})`);
  const late = named(await q("D · the pool: law-eligible ceremonial bills at floor or later, id-sorted", `SELECT id, title, stage FROM bills WHERE ${LAW} AND ${CER} AND stage IN ('floor','other_chamber','president','enacted') ORDER BY id`));
  const comm = named(await q("D · the pool: law-eligible ceremonial bills in committee, id-sorted", `SELECT id, title, stage FROM bills WHERE ${LAW} AND ${CER} AND stage = 'committee' ORDER BY id`));
  const d1 = draw("five at floor or later", late, 5);
  const d2 = draw("five in committee", comm, 5);
  results.D = { floorOrLater: d1, committee: d2 };
}

async function main() {
  if (process.argv.includes("--help") || process.argv.includes("-h")) {
    console.error("usage: npx tsx scripts/diagnostic/gradshow-ceremonial-799.ts [--label L] [--seed N]   (read-only; one mode)");
    process.exit(2);
  }
  mkdirSync(ART, { recursive: true });
  const start = new Date();
  say(`HO 799 · label ${LABEL} · seed ${SEED} · start ${when(start)} · HEAD ${git(["rev-parse", "--short", "HEAD"])} (${git(["branch", "--show-current"])}) · node ${process.version}`);
  let before = "";
  let failure: Error | null = null;
  try {
    before = await schemaPrint();
    say(`  prod's schema fingerprint before: ${before}`);
    step0Tree();
    await step0Prod();
    await freshness();
    const { cells } = await sectionA();
    await unclassified();
    await sectionB(cells);
    await sectionC();
    await sectionD();
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
    say(`  end ${when(end)} · ${((end.getTime() - start.getTime()) / 1000).toFixed(1)}s`);
    results.cost = { statements: stmts, pipelineResults: tap.results, rowsRead: tap.rows, start: start.toISOString(), end: end.toISOString() };
    results.failure = failure ? failure.message : null;
    if (!existsSync(LEDGER)) writeFileSync(LEDGER, "label\tseed\tstart_utc\tend_utc\tstatements\tpipeline_results\trows_read\tfailed\n");
    appendFileSync(LEDGER, `${LABEL}\t${SEED}\t${start.toISOString()}\t${end.toISOString()}\t${stmts}\t${tap.results}\t${tap.rows}\t${failure ? "yes" : "no"}\n`);
    const base = path.join(ART, `run-${LABEL}`);
    writeFileSync(`${base}.log`, out.join("\n") + "\n");
    writeFileSync(`${base}.json`, JSON.stringify(results, null, 2) + "\n");
    db?.close();
  }
  if (failure) process.exitCode = 1;
}

main().catch((e) => {
  console.error(redactSecrets(String((e as Error).stack ?? e)));
  process.exitCode = 1;
});
