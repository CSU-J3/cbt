// HO 794: the CRS catch-up. Corey ruled on 2026-10-28 that a new CRS summary re-summarizes (lib/sync.ts's substantive
// gains the CRS term); this script counts the bills that already hold an AI summary older than their latest CRS
// summary, and resets them once at the summarizer's pace.
//
//   npx tsx scripts/diagnostic/crs-catchup-794.ts --step0
//   npx tsx scripts/diagnostic/crs-catchup-794.ts --count [--label 794a]
//   npx tsx scripts/diagnostic/crs-catchup-794.ts --reset --count <label> [--per-round 150] [--go]
//   npx tsx scripts/diagnostic/crs-catchup-794.ts --legs
//
// --step0    claims 4 to 6: three Congress.gov reads (/summaries/119 sorted updateDate asc, the same sorted desc as the
//            control that the sort is honoured, and one listed bill's /bill/{c}/{t}/{n}/summaries), the prod counts that
//            frame the catch-up, and the Sabato task's state, last run and log lines (the box, read-only).
// --count    read-only. Every CRS summary for the 119th Congress from /summaries/119 with fromDateTime before the Congress
//            began (without it the list answers a recent window only), pages of 250 sorted updateDate asc
//            that overlap by 25 (HO 754's method), reduced to each bill's latest CRS_DATE_FIELD; joined in memory to
//            bills (id, summary IS NOT NULL, summary_updated_at). A candidate is a bill with a summary whose
//            summary_updated_at is before its latest CRS date, or NULL (counted apart: nothing shows it saw the
//            summary). Prints the pages, the summaries and bills listed, the candidates and the NULL share, their CRS
//            dates by month, the 20 latest, and the bills the list names that bills doesn't hold (named, not acted on).
//            Writes count-<label>.csv (id,summary_updated_at,crs_date). More than half the candidates' CRS dates on one
//            day is a bulk touch on Congress.gov's side, and the reset refuses that file until chat rules.
// --reset    writes prod. Over 2,000 candidates it writes nothing without --go; over 4,000 nothing at all, the number
//            printed for chat. Otherwise rounds of --per-round, each after the first starting 90 s past the next
//            10-minute boundary (the summarizer's */10 tick), each bill written by RESET_SQL, one statement whose WHERE
//            is the guard: the summary still there and still older than the bill's CRS date, so a bill re-summarized
//            since the count is left alone and a re-run writes nothing twice. Names the host and pauses five seconds
//            before the first write; prints rowsAffected per round and summed, the guard's refusals, and the summary
//            hole (summary IS NULL) after each round. Resumable: the same command continues.
// --legs     the reset on a file: copy built by scripts/migrate.ts, seeded from HO 790's seed-1000.json (a SELECT of
//            prod's bills, read once), candidates planted; a fetch tripwire refuses every request and .env is never
//            loaded. (a) an older summary is nulled, all seven columns, and a NULL summary_updated_at counts apart and
//            is reset; (b) a newer one is kept; (c) a NULL summary is untouched; (d) a bill re-summarized after the
//            count is kept by the guard; (e) 2,001 candidates without --go write nothing, and 4,001 with it neither;
//            (f) the per-round cap holds, the sleep stubbed.
//
// SAFETY. Prod is read through q(), which refuses anything but SELECT or WITH … SELECT and any statement naming a write
// keyword; the one write is RESET_SQL through w(), which runs that statement and no other. TURSO_DATABASE_URL,
// TURSO_AUTH_TOKEN and CONGRESS_API_KEY are read from .env by name, and never by --legs. Congress.gov requests carry the
// key in the query; every printed or saved line passes redactSecrets and request lines print the path alone. Times
// print in Mountain Time on a 12-hour clock with UTC beside. Artifacts go to docs/handoffs/794-artifacts/ (repo-ignored).
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type ResultSet, type Row } from "@libsql/client";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { redactSecrets } from "../../lib/redact";

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const MODES = ["--step0", "--reset", "--count", "--legs"] as const;
type Mode = (typeof MODES)[number];
// --reset takes --count <label> as its argument, so it's matched before --count.
const MODE: Mode | undefined = MODES.find((m) => process.argv.includes(m));
const ART = path.resolve("docs/handoffs/794-artifacts"); // repo-ignored
const SEED_FILE = path.resolve("docs/handoffs/790-artifacts/seed-1000.json"); // repo-ignored
const SCRATCH = path.resolve("scripts/diagnostic/scratch"); // gitignored
const TSX = path.resolve("node_modules/tsx/dist/cli.mjs");
const MT = "America/Denver";
const API = "https://api.congress.gov/v3";
const CONGRESS = 119;
// HO 794 STEP 0: without fromDateTime the list answers a recent window only (pagination.count 35, all Oct 28); from
// before the Congress began it answers every summary (6,378 on Oct 28).
const LIST_FROM = "2025-01-01T00:00:00Z";
const PAGE = 250;
const OVERLAP = 25;
// Claim 4 decides the field: the instant Congress.gov last updated the summary itself.
const CRS_DATE_FIELD = "lastSummaryUpdateDate";
const GATE_GO = 2_000;
const GATE_HALT = 4_000;
const SECOND = 1_000;
const MIN = 60_000;
const RESET_SQL = `UPDATE bills SET summary = NULL, summary_model = NULL, summary_updated_at = NULL, topics = NULL, is_ceremonial = NULL, summarize_failed_at = NULL, summarize_attempts = 0 WHERE id = ? AND summary IS NOT NULL AND (summary_updated_at IS NULL OR summary_updated_at < ?)`;
const HOLE_SQL = "SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_summarize_queue WHERE summary IS NULL";

const out: string[] = [];
const say = (s = "") => { const r = redactSecrets(s); out.push(r); process.stdout.write(`${r}\n`); };
const fmtN = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const save = (name: string, body: string) => { mkdirSync(ART, { recursive: true }); writeFileSync(path.join(ART, name), redactSecrets(body)); };
const stamp = () => new Date().toISOString().slice(0, 16).replace(":", "");
const objs = (rs: ResultSet) => rs.rows.map((r: Row) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i] ?? null])) as Record<string, unknown>);
const asNum = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "bigint" ? Number(v) : null);
// An instant as epoch ms, or null.
const ms = (s: unknown): number | null => { if (typeof s !== "string" || !s) return null; const t = Date.parse(s); return Number.isNaN(t) ? null : t; };
const mtFmt = new Intl.DateTimeFormat("en-US", { timeZone: MT, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit" });
function when(x: unknown): string {
  if (x == null || x === "") return String(x);
  const d = x instanceof Date ? x : new Date(typeof x === "number" ? x : String(x));
  if (Number.isNaN(d.getTime())) return `${String(x)} (unparsed)`;
  return `${mtFmt.format(d)} MT (${d.toISOString().slice(0, 19).replace("T", " ")}Z)`;
}

// ── prod ────────────────────────────────────────────────────────────────────
let db: Client | null = null;
function prod(): Client {
  if (db) return db;
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("libsql://")) throw new Error("reading prod needs the prod libsql:// URL in .env (TURSO_DATABASE_URL)");
  db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN, fetch: (i: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(i, { ...init, signal: AbortSignal.timeout(120_000) }) });
  return db;
}
const host = () => { try { return new URL((process.env.TURSO_DATABASE_URL ?? "").replace(/^libsql:/, "https:")).host; } catch { return "(unparsed)"; } };
const WRITE_WORD = /\b(INSERT|UPDATE|DELETE|REPLACE|UPSERT|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|ANALYZE)\b/i;
async function q(label: string, sql: string, args: InArgs = [], on: Pick<Client, "execute"> = prod()): Promise<ResultSet> {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql) || WRITE_WORD.test(sql)) throw new Error(`HALT: the read path writes nothing, and this is not a SELECT: ${label}`);
  const t = Date.now();
  const rs = await on.execute({ sql, args });
  say(`  [q] ${label}`);
  say(`      ${oneLine(sql).slice(0, 400)}${Array.isArray(args) && args.length ? `  · args ${JSON.stringify(args).slice(0, 160)}` : ""}`);
  say(`      → ${fmtN(rs.rows.length)} row(s) · ${Date.now() - t}ms · read ${when(new Date())}`);
  return rs;
}
// The one write: RESET_SQL, and nothing else.
async function w(on: Pick<Client, "execute">, sql: string, args: InArgs): Promise<number> {
  if (sql !== RESET_SQL) throw new Error("HALT: w() runs RESET_SQL and no other statement");
  const r = await on.execute({ sql, args });
  return r.rowsAffected;
}

// ── Congress.gov, the key in the query, never printed ───────────────────────
type Got = { status: number; json: unknown; ms: number; err: string };
async function api(p: string, attempt = 0): Promise<Got> {
  const key = (process.env.CONGRESS_API_KEY ?? "").trim();
  if (!key) throw new Error("CONGRESS_API_KEY is not set in .env");
  const url = `${API}${p}${p.includes("?") ? "&" : "?"}format=json&api_key=${encodeURIComponent(key)}`;
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(30_000) });
    if ((res.status === 429 || res.status >= 500) && attempt < 3) { await sleep(3000 * (attempt + 1)); return api(p, attempt + 1); }
    const body = await res.text();
    let json: unknown = null;
    try { json = JSON.parse(body); } catch { json = null; }
    return { status: res.status, json, ms: Date.now() - t0, err: res.ok ? "" : `HTTP ${res.status}` };
  } catch (e) {
    if (attempt < 3) { await sleep(3000 * (attempt + 1)); return api(p, attempt + 1); }
    return { status: 0, json: null, ms: Date.now() - t0, err: (e as Error).message };
  }
}
type SumItem = { bill?: { congress?: number; type?: string; number?: string | number }; updateDate?: string; lastSummaryUpdateDate?: string; actionDate?: string; versionCode?: string; actionDesc?: string };
const billIdOf = (s: SumItem) => (s.bill?.congress && s.bill.type && s.bill.number ? `${s.bill.congress}-${String(s.bill.type).toLowerCase()}-${s.bill.number}` : null);
const crsDateOf = (s: SumItem): string | null => (s as Record<string, string | undefined>)[CRS_DATE_FIELD] ?? null;

// ── the pure parts, shared by --count, --reset and --legs ───────────────────
type Stored = { id: string; hasSummary: boolean; summaryAt: string | null };
type Cand = { id: string; summaryAt: string | null; crsDate: string };
// A bill with a summary whose summary_updated_at is before its latest CRS date, or NULL.
function candidates(stored: Stored[], latest: Map<string, string>): { cands: Cand[]; nulls: number } {
  const cands: Cand[] = [];
  let nulls = 0;
  for (const b of stored) {
    const crs = latest.get(b.id);
    if (!b.hasSummary || crs === undefined) continue;
    const at = ms(b.summaryAt);
    if (at === null) { nulls++; cands.push({ id: b.id, summaryAt: null, crsDate: crs }); }
    else if (at < ms(crs)!) cands.push({ id: b.id, summaryAt: b.summaryAt, crsDate: crs });
  }
  return { cands, nulls };
}
// The day holding the most candidates' CRS dates, and whether it holds more than half.
function concentration(cands: Cand[]): { day: string; n: number; bulk: boolean } {
  const byDay = new Map<string, number>();
  for (const c of cands) byDay.set(c.crsDate.slice(0, 10), (byDay.get(c.crsDate.slice(0, 10)) ?? 0) + 1);
  const [day, n] = [...byDay.entries()].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];
  return { day, n, bulk: cands.length > 0 && n > cands.length / 2 };
}
type Gate = "run" | "stop" | "halt";
const gate = (n: number, go: boolean): Gate => (n > GATE_HALT ? "halt" : n > GATE_GO && !go ? "stop" : "run");
// The guard's bound: the CRS date in the stored column's format (toISOString, milliseconds included), so the string
// compare in RESET_SQL orders the two the way the instants do.
const bound = (crsDate: string) => new Date(ms(crsDate)!).toISOString();

type ResetDeps = { db: Pick<Client, "execute">; sleepUntilNextRound: () => Promise<void>; hole: () => Promise<number> };
type ResetSum = { ended: Gate | "done"; rounds: number; written: number; refused: number; perRound: number[] };
async function resetRounds(deps: ResetDeps, cands: Cand[], perRound: number, go: boolean, beforeFirstWrite: () => Promise<void>): Promise<ResetSum> {
  const g = gate(cands.length, go);
  if (g === "halt") { say(`  ${fmtN(cands.length)} candidates, over ${fmtN(GATE_HALT)}: nothing is written; the number goes to chat`); return { ended: "halt", rounds: 0, written: 0, refused: 0, perRound: [] }; }
  if (g === "stop") { say(`  ${fmtN(cands.length)} candidates, over ${fmtN(GATE_GO)}: nothing is written without --go, which is Corey's`); return { ended: "stop", rounds: 0, written: 0, refused: 0, perRound: [] }; }
  const sum: ResetSum = { ended: "done", rounds: 0, written: 0, refused: 0, perRound: [] };
  for (let i = 0; i < cands.length; i += perRound) {
    if (i === 0) await beforeFirstWrite();
    else await deps.sleepUntilNextRound();
    const chunk = cands.slice(i, i + perRound);
    let n = 0;
    for (const c of chunk) n += await w(deps.db, RESET_SQL, [c.id, bound(c.crsDate)]);
    sum.rounds++;
    sum.written += n;
    sum.refused += chunk.length - n;
    sum.perRound.push(n);
    say(`  round ${sum.rounds} · ${when(new Date())} · ${chunk.length} statements · rowsAffected ${n} · the guard refused ${chunk.length - n} · so far ${fmtN(sum.written)} written, ${fmtN(sum.refused)} refused · the hole (summary IS NULL) ${fmtN(await deps.hole())}`);
  }
  return sum;
}
// 90 s past the next 10-minute boundary, after the summarizer's */10 tick.
async function untilNextRound() {
  const now = Date.now();
  const t = Math.floor(now / (10 * MIN)) * (10 * MIN) + 10 * MIN + 90 * SECOND;
  say(`  next round ${when(t)}`);
  await sleep(t - now);
}

// ── --step0 ─────────────────────────────────────────────────────────────────
async function step0() {
  say(`\n── claim 4: /summaries/${CONGRESS}, three reads`);
  const show = (items: SumItem[]) => items.map((s) => `${billIdOf(s) ?? "(no bill)"} · updateDate ${s.updateDate ?? "—"} · lastSummaryUpdateDate ${s.lastSummaryUpdateDate ?? "—"} · actionDate ${s.actionDate ?? "—"} · versionCode ${s.versionCode ?? "—"}`);
  const a = await api(`/summaries/${CONGRESS}?limit=5&sort=updateDate+asc`);
  const ai = ((a.json as { summaries?: SumItem[] } | null)?.summaries ?? []);
  say(`  GET /summaries/${CONGRESS}?limit=5&sort=updateDate+asc → ${a.status || a.err} · ${a.ms}ms · pagination.count ${String((a.json as { pagination?: { count?: number } } | null)?.pagination?.count)}`);
  say(`    item keys: ${Object.keys(ai[0] ?? {}).join(", ")} · bill keys: ${Object.keys(ai[0]?.bill ?? {}).join(", ")}`);
  for (const l of show(ai)) say(`    ${l}`);
  const d = await api(`/summaries/${CONGRESS}?limit=5&sort=updateDate+desc`);
  const di = ((d.json as { summaries?: SumItem[] } | null)?.summaries ?? []);
  say(`  GET /summaries/${CONGRESS}?limit=5&sort=updateDate+desc → ${d.status || d.err} · ${d.ms}ms (the control: the sort is honoured if this list's first updateDate is after the asc list's last)`);
  for (const l of show(di)) say(`    ${l}`);
  const honoured = ms(di[0]?.updateDate) !== null && ms(ai[ai.length - 1]?.updateDate) !== null && ms(di[0]?.updateDate)! > ms(ai[ai.length - 1]?.updateDate)!;
  say(`  the sort is honoured: ${honoured}`);
  const pick = di.find((s) => billIdOf(s));
  if (pick) {
    const [c, t, n] = billIdOf(pick)!.split("-");
    const b = await api(`/bill/${c}/${t}/${n}/summaries`);
    const bi = ((b.json as { summaries?: SumItem[] } | null)?.summaries ?? []);
    say(`  GET /bill/${c}/${t}/${n}/summaries → ${b.status || b.err} · ${b.ms}ms · ${bi.length} item(s) · keys: ${Object.keys(bi[0] ?? {}).join(", ")}`);
    for (const l of show(bi)) say(`    ${l}`);
  }

  say(`\n── claim 5: prod, the bills that frame the catch-up`);
  const [c5] = objs(await q("5 · summaries, CRS counts, NULL stamps", `SELECT
      (SELECT COUNT(*) FROM bills WHERE summary IS NOT NULL) AS with_summary,
      (SELECT COUNT(*) FROM bills WHERE summary IS NOT NULL AND json_extract(raw_json, '$.summaries.count') >= 1) AS with_summary_and_crs,
      (SELECT COUNT(*) FROM bills WHERE summary IS NOT NULL AND summary_updated_at IS NULL) AS summary_no_stamp,
      (SELECT COUNT(*) FROM bills) AS total,
      (SELECT summary_updated_at FROM bills WHERE summary_updated_at IS NOT NULL ORDER BY summary_updated_at DESC LIMIT 1) AS latest_stamp`));
  say(`  bills ${fmtN(Number(c5!.total))} · with a summary ${fmtN(Number(c5!.with_summary))} · of them raw_json's summaries.count >= 1: ${fmtN(Number(c5!.with_summary_and_crs))} · a summary with summary_updated_at NULL: ${fmtN(Number(c5!.summary_no_stamp))} · the latest summary_updated_at ${String(c5!.latest_stamp)} (its format is the guard's bound's)`);

  say(`\n── claim 6: the box, the Sabato task (read-only)`);
  const ps = spawnSync("powershell.exe", ["-NoProfile", "-Command", `$t = Get-ScheduledTask -TaskName "CBT Sabato daily read"; "State: $($t.State)"; $i = Get-ScheduledTaskInfo -TaskName "CBT Sabato daily read"; "LastRunTime: $($i.LastRunTime)"; "LastTaskResult: $($i.LastTaskResult) (0x{0:X})" -f $i.LastTaskResult; "NextRunTime: $($i.NextRunTime)"; Get-Content docs\\handoffs\\sabato-daily.log | Where-Object { $_ -ge "2026-10-28 17:00" }`], { encoding: "utf8" });
  for (const l of (ps.stdout || ps.stderr || "").split(/\r?\n/).filter(Boolean)) say(`  ${l}`);
}

// ── --count ─────────────────────────────────────────────────────────────────
async function count() {
  const label = argAt("--label") ?? "794a";
  if (!/^[\w-]+$/.test(label)) throw new Error("--label takes a word");
  say(`\n── the count: label ${label} · /summaries/${CONGRESS} from ${LIST_FROM}, pages of ${PAGE} sorted updateDate asc, overlap ${OVERLAP} · the CRS date is ${CRS_DATE_FIELD}`);
  const latest = new Map<string, string>();
  const seenKeys = new Set<string>();
  let offset = 0, pages = 0, entries = 0, listedCount: number | null = null, noBill = 0, noDate = 0;
  for (;;) {
    const g = await api(`/summaries/${CONGRESS}?fromDateTime=${LIST_FROM}&limit=${PAGE}&offset=${offset}&sort=updateDate+asc`);
    if (g.err) throw new Error(`the list failed at offset ${offset}: ${g.err}`);
    const j = g.json as { summaries?: SumItem[]; pagination?: { count?: number } };
    const items = j.summaries ?? [];
    if (pages === 0) listedCount = j.pagination?.count ?? null;
    pages++;
    for (const s of items) {
      entries++;
      const id = billIdOf(s);
      const d = crsDateOf(s);
      if (!id) { noBill++; continue; }
      if (!d || ms(d) === null) { noDate++; continue; }
      seenKeys.add(`${id}|${s.versionCode ?? ""}|${s.actionDate ?? ""}`);
      const prev = latest.get(id);
      if (prev === undefined || ms(d)! > ms(prev)!) latest.set(id, d);
    }
    if (pages % 10 === 0) say(`    page ${pages} · offset ${offset} · ${items.length} items · ${when(new Date())}`);
    if (items.length < PAGE) break;
    offset += PAGE - OVERLAP;
  }
  say(`  pages ${pages} · entries read ${fmtN(entries)} (the overlap's repeats included) · pagination.count ${listedCount === null ? "—" : fmtN(listedCount)} · distinct summaries ${fmtN(seenKeys.size)} · bills ${fmtN(latest.size)} · no bill reference ${noBill} · no ${CRS_DATE_FIELD} ${noDate}`);

  const rows = objs(await q("count · bills, the 119th", `SELECT id, summary IS NOT NULL AS has_summary, summary_updated_at FROM bills WHERE congress = ? ORDER BY id`, [CONGRESS]));
  const stored: Stored[] = rows.map((r) => ({ id: String(r.id), hasSummary: Number(r.has_summary) === 1, summaryAt: (r.summary_updated_at as string | null) ?? null }));
  const held = new Set(stored.map((s) => s.id));
  const absent = [...latest.keys()].filter((id) => !held.has(id)).sort();
  const { cands, nulls } = candidates(stored, latest);
  const withCrs = stored.filter((s) => s.hasSummary && latest.has(s.id)).length;
  say(`\n── the reading`);
  say(`  bills stored ${fmtN(stored.length)} · with a summary and a CRS summary ${fmtN(withCrs)} · **candidates ${fmtN(cands.length)}** · of them summary_updated_at NULL ${fmtN(nulls)} (${pct(nulls, cands.length)}) · older than the CRS date ${fmtN(cands.length - nulls)}`);
  const byMonth = new Map<string, number>();
  for (const c of cands) byMonth.set(c.crsDate.slice(0, 7), (byMonth.get(c.crsDate.slice(0, 7)) ?? 0) + 1);
  say(`  candidates' CRS dates by month: ${[...byMonth.entries()].sort().map(([m, n]) => `${m} ${n}`).join(" · ") || "none"}`);
  const top = [...cands].sort((a, b) => ms(b.crsDate)! - ms(a.crsDate)!).slice(0, 20);
  say(`  the 20 latest: ${top.map((c) => `${c.id} (CRS ${c.crsDate} · summary ${c.summaryAt ?? "NULL"})`).join(", ") || "none"}`);
  const conc = concentration(cands);
  say(`  the busiest CRS day: ${conc.day || "—"}, ${conc.n} of ${cands.length}${conc.bulk ? " · MORE THAN HALF ON ONE DAY: a bulk touch on Congress.gov's side, not a wave of new summaries; --reset refuses this file until chat rules" : ""}`);
  say(`  bills the list names that bills doesn't hold: ${absent.length}${absent.length ? `: ${absent.slice(0, 60).join(", ")}${absent.length > 60 ? ", …" : ""}` : ""}`);
  save(`count-${label}.csv`, `id,summary_updated_at,crs_date\n${cands.map((c) => `${c.id},${c.summaryAt ?? ""},${c.crsDate}`).join("\n")}\n`);
  if (absent.length) save(`count-${label}-absent.txt`, `${absent.join("\n")}\n`);
  save(`count-${label}-${stamp()}.log`, `${out.join("\n")}\n`);
  say(`  wrote docs/handoffs/794-artifacts/count-${label}.csv`);
}

function readCount(label: string): Cand[] {
  const f = path.join(ART, `count-${label}.csv`);
  if (!existsSync(f)) throw new Error(`no ${f}: run --count --label ${label} first`);
  return readFileSync(f, "utf8").split(/\r?\n/).slice(1).filter(Boolean).map((l) => { const [id = "", at = "", crs = ""] = l.split(","); return { id, summaryAt: at || null, crsDate: crs }; });
}

// ── --reset ─────────────────────────────────────────────────────────────────
async function reset() {
  const label = argAt("--count");
  if (!label || !/^[\w-]+$/.test(label)) throw new Error("--reset needs --count <label>");
  const perRound = Number(argAt("--per-round") ?? "150");
  if (!Number.isInteger(perRound) || perRound < 1) throw new Error("--per-round takes a positive integer");
  const go = process.argv.includes("--go");
  const all = readCount(label);
  const conc = concentration(all);
  say(`\n── reset count-${label}: ${fmtN(all.length)} candidates · ${perRound} a round${go ? " · --go given" : ""}`);
  if (conc.bulk) { say(`  ${conc.n} of ${all.length} on ${conc.day}: more than half on one day; nothing is written until chat rules`); return; }
  // Which still match the guard, read first so a resumed run starts where it stopped; the guard stays in the statement.
  const now = objs(await q("reset · the candidates as they stand", `SELECT id, summary IS NOT NULL AS has_summary, summary_updated_at FROM bills WHERE id IN (SELECT value FROM json_each(?))`, [JSON.stringify(all.map((c) => c.id))]));
  const st = new Map(now.map((r) => [String(r.id), r] as const));
  const todo = all.filter((c) => { const r = st.get(c.id); if (!r || Number(r.has_summary) !== 1) return false; const at = r.summary_updated_at as string | null; return at === null || at < bound(c.crsDate); });
  say(`  still matching the guard: ${fmtN(todo.length)} of ${fmtN(all.length)} (the rest reset already, re-summarized since, or gone)`);
  const h0 = asNum(objs(await q("reset · the hole before", HOLE_SQL))[0]?.n) ?? 0;
  say(`  the hole before: ${fmtN(h0)}`);
  const sum = await resetRounds(
    { db: prod(), sleepUntilNextRound: untilNextRound, hole: async () => asNum((await prod().execute(HOLE_SQL)).rows[0]?.n) ?? 0 },
    todo, perRound, go,
    async () => { say(`  WRITING to ${host()} (TURSO_DATABASE_URL) in five seconds: Ctrl-C now to stop`); await sleep(5_000); },
  );
  say(`\n  ${sum.ended === "done" ? `done: ${sum.rounds} round(s), rowsAffected ${fmtN(sum.written)} (${sum.perRound.join(", ")}), the guard refused ${fmtN(sum.refused)}` : `ended: ${sum.ended}, nothing written`} · ${when(new Date())}`);
  save(`reset-${label}-${stamp()}.log`, `${out.join("\n")}\n`);
}

// ── --legs ──────────────────────────────────────────────────────────────────
const SEED_COLS = [
  "id", "congress", "bill_type", "bill_number", "title", "introduced_date", "latest_action_date", "latest_action_text",
  "sponsor_name", "sponsor_party", "sponsor_state", "sponsor_bioguide_id", "update_date", "raw_json", "cluster_id",
  "summary", "summary_model", "summary_updated_at", "topics", "is_ceremonial", "stage", "previous_stage",
  "stage_observed_at", "changed_at", "committee_walk_failures", "summarize_failed_at", "summarize_attempts",
] as const;
let passes = 0, fails = 0;
const check = (label: string, ok: boolean, detail: string) => { say(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`); if (ok) passes++; else fails++; };

async function legs() {
  // The tripwire first: no request leaves the process.
  const refused: string[] = [];
  globalThis.fetch = ((input: RequestInfo | URL) => { const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; refused.push(redactSecrets(href)); return Promise.reject(new Error("tripwire: the legs make no request")); }) as typeof fetch;
  if (!existsSync(SEED_FILE)) throw new Error(`no seed at ${SEED_FILE}`);
  const seed = (JSON.parse(readFileSync(SEED_FILE, "utf8")) as { rows: Record<string, unknown>[] }).rows;
  mkdirSync(SCRATCH, { recursive: true });
  const file = path.join(SCRATCH, `legs-794-${Date.now()}.db`);
  const url = `file:${file}`;
  if (!url.startsWith("file:")) throw new Error("refused: the legs get file: only");
  const env = { ...process.env, TURSO_DATABASE_URL: url, TURSO_AUTH_TOKEN: "", DOTENV_CONFIG_PATH: path.join(SCRATCH, "no-such-794.env"), DOTENV_CONFIG_QUIET: "true" };
  const mig = spawnSync(process.execPath, [TSX, "scripts/migrate.ts"], { env, encoding: "utf8" });
  if (mig.status !== 0) throw new Error(`migrate against the copy failed: ${(mig.stderr || mig.stdout).slice(-600)}`);
  const c = createClient({ url });
  say(`  the copy ${file}, built by scripts/migrate.ts (exit ${mig.status}), ${seed.length} seed rows from ${path.relative(process.cwd(), SEED_FILE)}`);
  const batch: Array<{ sql: string; args: InArgs }> = seed.map((r) => ({ sql: `INSERT INTO bills (${SEED_COLS.join(", ")}) VALUES (${SEED_COLS.map(() => "?").join(", ")})`, args: SEED_COLS.map((k) => (r[k] as string | number | null) ?? null) }));
  await c.batch(batch, "write");
  const ids = seed.map((r) => String(r.id));
  const CRS = "2026-10-01T12:00:00Z";
  const plant = async (id: string, summary: string | null, at: string | null) => c.execute({ sql: "UPDATE bills SET summary = ?, summary_model = ?, summary_updated_at = ?, topics = ?, is_ceremonial = ?, summarize_failed_at = ?, summarize_attempts = ? WHERE id = ?", args: [summary, summary ? "leg-model" : null, at, summary ? '["Health"]' : null, summary ? 0 : null, summary ? "2026-09-02T00:00:00.000Z" : null, summary ? 2 : 0, id] });
  const row = async (id: string) => objs(await c.execute({ sql: "SELECT summary, summary_model, summary_updated_at, topics, is_ceremonial, summarize_failed_at, summarize_attempts FROM bills WHERE id = ?", args: [id] }))[0]!;
  const nulled = (r: Record<string, unknown>) => ["summary", "summary_model", "summary_updated_at", "topics", "is_ceremonial", "summarize_failed_at"].every((k) => r[k] === null) && Number(r.summarize_attempts) === 0;
  const show = (r: Record<string, unknown>) => `summary ${r.summary === null ? "NULL" : JSON.stringify(r.summary)} · at ${String(r.summary_updated_at)} · topics ${String(r.topics)} · failed_at ${String(r.summarize_failed_at)} · attempts ${String(r.summarize_attempts)}`;
  const deps = (sleeps: { n: number }): ResetDeps => ({ db: c, sleepUntilNextRound: async () => { sleeps.n++; }, hole: async () => asNum((await c.execute(HOLE_SQL)).rows[0]?.n) ?? 0 });
  const quiet = async () => {};

  // (a), (b), (c): the count's classification and the reset on it.
  say(`\n── a, b, c: the count's candidates and the reset on them`);
  say(`  never done: an AI summary written before its bill's CRS summary arrived stays as written`);
  const [A, A0, B, C] = ids.slice(0, 4) as [string, string, string, string];
  await plant(A, "OLDER", "2026-09-01T00:00:00.000Z");
  await plant(A0, "NO STAMP", null);
  await plant(B, "NEWER", "2026-10-15T00:00:00.000Z");
  await plant(C, null, null);
  const latest = new Map([[A, CRS], [A0, CRS], [B, CRS], [C, CRS]]);
  const st = objs(await c.execute({ sql: "SELECT id, summary IS NOT NULL AS has_summary, summary_updated_at FROM bills WHERE id IN (?, ?, ?, ?)", args: [A, A0, B, C] })).map((r) => ({ id: String(r.id), hasSummary: Number(r.has_summary) === 1, summaryAt: (r.summary_updated_at as string | null) ?? null }));
  const { cands, nulls } = candidates(st, latest);
  check("the candidates are A (older) and A0 (no stamp, counted apart); B (newer) and C (no summary) are not", cands.map((x) => x.id).sort().join() === [A, A0].sort().join() && nulls === 1, `candidates ${cands.map((x) => x.id).join(", ")} · nulls ${nulls}`);
  // C rides the reset's list too, as a stale count file would carry it: the guard must refuse it.
  const r1 = await resetRounds(deps({ n: 0 }), [...cands, { id: B, summaryAt: "2026-10-15T00:00:00.000Z", crsDate: CRS }, { id: C, summaryAt: null, crsDate: CRS }], 150, false, quiet);
  const [ra, ra0, rb, rc] = [await row(A), await row(A0), await row(B), await row(C)];
  check("(a) the older summary is nulled, all seven columns, and so is the unstamped one", nulled(ra) && nulled(ra0), `A ${show(ra)} · A0 ${show(ra0)}`);
  check("(b) the newer summary is kept by the guard", rb.summary === "NEWER" && rb.summary_updated_at === "2026-10-15T00:00:00.000Z" && Number(rb.summarize_attempts) === 2, show(rb));
  check("(c) the NULL summary is untouched", rc.summary === null && rc.summary_updated_at === null && Number(rc.summarize_attempts) === 0, show(rc));
  check("the tally: 2 written, 2 refused by the guard", r1.written === 2 && r1.refused === 2, `written ${r1.written} · refused ${r1.refused}`);

  // (d) a bill re-summarized after the count.
  say(`\n── d, a bill re-summarized after the count`);
  say(`  never done: the reset nulls a summary the summarizer wrote after the count, and it's written twice`);
  const D = ids[4]!;
  await plant(D, "OLDER", "2026-09-01T00:00:00.000Z");
  const dCands = candidates([{ id: D, hasSummary: true, summaryAt: "2026-09-01T00:00:00.000Z" }], new Map([[D, CRS]])).cands;
  await plant(D, "RE-SUMMARIZED", "2026-10-28T20:00:00.000Z");
  const rd1 = await resetRounds(deps({ n: 0 }), dCands, 150, false, quiet);
  const rd = await row(D);
  check("(d) counted before, re-summarized after: the guard keeps it", dCands.length === 1 && rd1.written === 0 && rd.summary === "RE-SUMMARIZED", `counted ${dCands.length} · written ${rd1.written} · ${show(rd)}`);
  const rA2 = await resetRounds(deps({ n: 0 }), cands, 150, false, quiet);
  check("(d) a re-run writes nothing twice", rA2.written === 0 && rA2.refused === cands.length, `written ${rA2.written} · refused ${rA2.refused}`);

  // (e) the gates.
  say(`\n── e, the gates`);
  say(`  never done: a count past 2,000 resets without Corey's --go, and one past 4,000 resets at all`);
  const holeBefore = asNum((await c.execute(HOLE_SQL)).rows[0]?.n) ?? 0;
  const many = (n: number) => Array.from({ length: n }, (_, i) => ({ id: ids[10 + (i % 900)]!, summaryAt: null, crsDate: CRS }));
  for (const id of ids.slice(10, 910)) await plant(id, "GATE", "2026-09-01T00:00:00.000Z");
  const e1 = await resetRounds(deps({ n: 0 }), many(2_001), 150, false, quiet);
  const e2 = await resetRounds(deps({ n: 0 }), many(4_001), 150, true, quiet);
  const e3 = await resetRounds(deps({ n: 0 }), many(2_000), 150, false, async () => { throw new Error("stop before the first write"); }).catch((e) => ({ ended: (e as Error).message }) as unknown as ResetSum);
  const holeAfter = asNum((await c.execute(HOLE_SQL)).rows[0]?.n) ?? 0;
  check("(e) 2,001 without --go: stopped, nothing written", e1.ended === "stop" && e1.written === 0, `ended ${e1.ended} · written ${e1.written}`);
  check("(e) 4,001 with --go: halted, nothing written", e2.ended === "halt" && e2.written === 0, `ended ${e2.ended} · written ${e2.written}`);
  check("(e) 2,000 without --go runs (it reached the first write)", e3.ended === ("stop before the first write" as unknown as ResetSum["ended"]), `ended ${String(e3.ended)}`);
  check("(e) the hole didn't move", holeAfter === holeBefore, `before ${holeBefore} · after ${holeAfter}`);

  // (f) the per-round cap.
  say(`\n── f, the per-round cap`);
  say(`  never done: a round writes past its cap, and the summarizer's hole jumps by the whole count at once`);
  const F5 = ids.slice(950, 955);
  for (const id of F5) await plant(id, "OLDER", "2026-09-01T00:00:00.000Z");
  const sleeps = { n: 0 };
  const f = await resetRounds(deps(sleeps), F5.map((id) => ({ id, summaryAt: "2026-09-01T00:00:00.000Z", crsDate: CRS })), 2, false, quiet);
  check("(f) 5 candidates at 2 a round: rounds 2, 2, 1, a wait between each", f.rounds === 3 && f.perRound.join() === "2,2,1" && sleeps.n === 2 && f.written === 5, `rounds ${f.rounds} (${f.perRound.join(", ")}) · waits ${sleeps.n} · written ${f.written}`);

  say(`\n── legs: checks ${passes} passed, ${fails} failed · tripwire ${refused.length} refused`);
  c.close();
  save(`legs-${stamp()}.log`, `${out.join("\n")}\n`);
  if (fails) process.exitCode = 1;
}

async function main() {
  if (MODE !== "--legs") config({ path: ".env", quiet: true });
  if (!MODE) throw new Error(`one of ${MODES.join(", ")}`);
  say(`crs-catchup-794 ${MODE} · ${when(new Date())}`);
  if (MODE === "--step0") { await step0(); save(`step0-${stamp()}.log`, `${out.join("\n")}\n`); }
  else if (MODE === "--count") await count();
  else if (MODE === "--reset") await reset();
  else await legs();
}
main().catch((e) => { say(`FAILED: ${(e as Error).message}`); process.exitCode = 1; });
