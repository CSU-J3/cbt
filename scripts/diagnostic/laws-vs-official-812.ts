// HO 812: CT's laws against Congress.gov's official list, the tracked law check (it began as HO 811's inline read,
// docs/handoffs/811-artifacts/laws-check-811.ts). Read-only. It is the instrument for the backlog line "a law can read
// short of enacted": that line closes when this reads 0 short.
//
//   npx tsx scripts/diagnostic/laws-vs-official-812.ts --label L
//
// 1. Congress.gov: every public and private law of the current Congress (getCurrentCongress()), GET /law/{c}/pub and
//    /law/{c}/priv, paged at 250. scripts/backfill-historical-laws.ts:5-8 verified the shape: items under `bills`, the
//    law number at laws[].number, the origin bill at congress/type/number. CONGRESS_API_KEY by name, in the X-Api-Key
//    header; the query string only if the header is refused on the first call, and redactSecrets strips it from every
//    printed line.
// 2. prod, one read-only transaction (BEGIN TRANSACTION READONLY): CT's enacted rows among the law types (hr, s, hjres,
//    sjres), any tag; CT's row for every official law's bill, any stage; the dome's laws now, by party (the poster's
//    predicate: those law types with is_ceremonial 0 or NULL).
// 3. the diff both ways: official laws CT holds short of enacted or not at all, and CT laws the official list lacks.
//    For each, the bill's Congress.gov detail (its sponsor and update date) and its actions: when it became law, and
//    the latest action by date, since CT stages a bill from its latest action alone (lib/enums.ts:97).
// 4. what each gap would change: the dome's law count and the party lines, from the read's own counts.
// Prod is only read: every statement through guard() (SELECT or WITH only, no write keyword), the schema fingerprinted
// before and after. Congress.gov only GETs. The log and JSON go to docs/handoffs/812-artifacts/ (repo-ignored), and a
// label already used is refused before anything is read.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type ResultSet, type Row } from "@libsql/client";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getCurrentCongress } from "@/lib/congress";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const ART = path.resolve("docs/handoffs/812-artifacts"); // repo-ignored
const LEDGER = path.join(ART, "rows-ledger.tsv");
const API = process.env.CONGRESS_API_BASE ?? "https://api.congress.gov/v3"; // lib/sync.ts:30's seam, unset in .env
const KEY = process.env.CONGRESS_API_KEY ?? "";
const CONGRESS = getCurrentCongress();
const MT = "America/Denver";
const LAW_TYPES = ["hr", "s", "hjres", "sjres"];
const LAW = `bill_type IN ('hr','s','hjres','sjres')`;
const NONC = `(is_ceremonial = 0 OR is_ceremonial IS NULL)`;

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "";
const out: string[] = [];
const say = (s = "") => { const r = redactSecrets(s); out.push(r); console.log(r); };
const fmtN = (n: number) => n.toLocaleString("en-US");
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => (v == null ? null : String(v));
const results: Record<string, unknown> = {};
const sp = (s: string) => s.replace(/[  ]/g, " ");
const mtFmt = new Intl.DateTimeFormat("en-US", { timeZone: MT, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
function when(x: unknown): string {
  if (x == null || x === "") return String(x);
  if (typeof x === "string" && /^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  const d = x instanceof Date ? x : new Date(String(x));
  if (Number.isNaN(d.getTime())) return `${String(x)} (unparsed)`;
  return `${sp(mtFmt.format(d))} (${d.toISOString().slice(0, 19).replace("T", " ")}Z)`;
}

// ── Congress.gov, GET only ──────────────────────────────────────────────────
let useHeader = true;
let calls = 0;
async function cg(pathq: string): Promise<Record<string, unknown>> {
  const url = `${API}${pathq}${pathq.includes("?") ? "&" : "?"}format=json`;
  for (let attempt = 1; attempt <= 3; attempt++) {
    const t0 = Date.now();
    let status = 0;
    let body = "";
    let err = "";
    try {
      const res = useHeader
        ? await fetch(url, { headers: { "X-Api-Key": KEY, Accept: "application/json" }, signal: AbortSignal.timeout(90_000) })
        : await fetch(`${url}&api_key=${encodeURIComponent(KEY)}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(90_000) });
      status = res.status;
      body = await res.text();
    } catch (e) {
      err = (e as Error).message;
    }
    calls += 1;
    say(`    GET ${url} → ${status || "no answer"}${err ? ` (${err})` : ""} · ${fmtN(body.length)} bytes · ${Date.now() - t0}ms${useHeader ? "" : " · key in the query, redacted"}`);
    if (status === 403 && useHeader && calls === 1) {
      useHeader = false;
      say(`    the X-Api-Key header was refused; the key rides the query string from here, and redactSecrets strips it from every printed line`);
      attempt -= 1;
      continue;
    }
    if (status === 200) {
      try {
        return JSON.parse(body) as Record<string, unknown>;
      } catch {
        /* retried below */
      }
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
  throw new Error(`GET ${API}${pathq} failed three times`);
}
type LawItem = { congress?: unknown; type?: unknown; number?: unknown; title?: unknown; latestAction?: { actionDate?: unknown; text?: unknown }; laws?: Array<{ number?: unknown; type?: unknown }>; updateDate?: unknown; updateDateIncludingText?: unknown };
type Official = { id: string; type: string; number: string; title: string; lawNumber: string; lawType: string; kind: "pub" | "priv"; actionDate: string | null; actionText: string | null; update: string | null };
async function lawList(kind: "pub" | "priv"): Promise<{ items: Official[]; count: number }> {
  const items: Official[] = [];
  let offset = 0;
  let count = Number.POSITIVE_INFINITY;
  while (offset < count) {
    const json = await cg(`/law/${CONGRESS}/${kind}?limit=250&offset=${offset}`);
    const page = (json.bills ?? []) as LawItem[];
    count = num((json.pagination as { count?: unknown } | undefined)?.count ?? page.length);
    for (const b of page) {
      const type = String(b.type ?? "").toLowerCase();
      const number = String(b.number ?? "");
      for (const l of b.laws ?? [{ number: "?", type: "?" }]) {
        items.push({
          id: `${String(b.congress ?? CONGRESS)}-${type}-${number}`, type, number, title: String(b.title ?? ""),
          lawNumber: String(l.number ?? "?"), lawType: String(l.type ?? "?"), kind,
          actionDate: str(b.latestAction?.actionDate), actionText: str(b.latestAction?.text),
          update: str(b.updateDateIncludingText ?? b.updateDate),
        });
      }
    }
    if (!page.length) break;
    offset += page.length;
  }
  return { items, count };
}
type Detail = { sponsor: string | null; party: string | null; state: string | null; update: string | null; laws: string; became: string | null; latest: string | null };
async function detail(type: string, number: string): Promise<Detail> {
  const json = await cg(`/bill/${CONGRESS}/${type}/${number}`);
  const b = (json.bill ?? {}) as { sponsors?: Array<{ fullName?: unknown; party?: unknown; state?: unknown }>; updateDateIncludingText?: unknown; updateDate?: unknown; laws?: Array<{ number?: unknown; type?: unknown }> };
  const acts = ((await cg(`/bill/${CONGRESS}/${type}/${number}/actions?limit=250`)).actions ?? []) as Array<{ actionDate?: unknown; text?: unknown; type?: unknown }>;
  const sorted = acts.slice().sort((x, y) => String(x.actionDate).localeCompare(String(y.actionDate)));
  const became = sorted.find((a) => a.type === "BecameLaw" || /became (public|private) law/i.test(String(a.text)));
  const last = sorted.at(-1);
  const s = b.sponsors?.[0];
  return {
    sponsor: str(s?.fullName), party: str(s?.party), state: str(s?.state), update: str(b.updateDateIncludingText ?? b.updateDate),
    laws: (b.laws ?? []).map((l) => `${String(l.type)} ${String(l.number)}`).join(", ") || "none",
    became: became ? `${String(became.actionDate)} ${String(became.text).slice(0, 60)}` : null,
    latest: last ? `${String(last.actionDate)} ${String(last.text).slice(0, 100)}` : null,
  };
}

// ── prod, read-only ─────────────────────────────────────────────────────────
type StepResult = { rows_read?: unknown } | null;
const tap = { rows: 0, results: 0 };
async function tapFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { ...init, signal: AbortSignal.timeout(120_000) });
  try {
    const j = (await res.clone().json()) as { results?: Array<{ response?: { result?: { rows_read?: unknown; step_results?: StepResult[] } } }> };
    for (const r of j.results ?? []) {
      const result = r?.response?.result;
      if (typeof result?.rows_read === "number") { tap.rows += result.rows_read; tap.results += 1; }
      const steps = result?.step_results;
      if (Array.isArray(steps)) for (const s of steps) if (s && typeof s.rows_read === "number") { tap.rows += s.rows_read; tap.results += 1; }
    }
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
function guard(label: string, sql: string) {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql) || WRITE_WORD.test(sql)) throw new Error(`prod is read-only here: ${label}`);
}
let stmts = 0;
const objs = (rs: ResultSet | undefined) => (rs ? rs.rows.map((r: Row) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i] ?? null]))) : []);
async function fingerprint(): Promise<string> {
  const sql = `SELECT type, name, sql FROM sqlite_master ORDER BY type, name`;
  guard("the schema fingerprint", sql);
  const rs = await prod().execute(sql);
  stmts += 1;
  return createHash("sha256").update(JSON.stringify(rs.rows.map((r) => [r.type, r.name, r.sql]))).digest("hex").slice(0, 16);
}
const lawNo = (s: string) => Number(s.split("-")[1] ?? NaN);

async function main() {
  if (!/^[A-Za-z0-9_-]{1,40}$/.test(LABEL)) {
    console.error("usage: npx tsx scripts/diagnostic/laws-vs-official-812.ts --label L   (read-only; L: letters, digits, - or _)");
    process.exit(2);
  }
  mkdirSync(ART, { recursive: true });
  const base = path.join(ART, `laws-${LABEL}`);
  if (existsSync(`${base}.log`) || existsSync(`${base}.json`)) {
    console.error(`label ${LABEL} is taken (${base}.log or .json exists); pick another with --label. Nothing was read.`);
    process.exit(2);
  }
  if (!KEY) throw new Error("CONGRESS_API_KEY is not set in .env");
  const start = new Date();
  say(`HO 812 · CT's laws against Congress.gov's list · label ${LABEL} · start ${when(start)} · congress ${CONGRESS} · node ${process.version}`);
  let before = "";
  let failure: Error | null = null;
  try {
    say(`\n── 1. Congress.gov's laws of the ${CONGRESS}th (GET /law/${CONGRESS}/pub and /priv)`);
    const pub = await lawList("pub");
    const priv = await lawList("priv");
    const byId = new Map<string, Official[]>();
    for (const o of [...pub.items, ...priv.items]) byId.set(o.id, [...(byId.get(o.id) ?? []), o]);
    const pubNos = pub.items.map((o) => lawNo(o.lawNumber)).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
    const maxPub = pubNos.at(-1) ?? 0;
    const gaps = Array.from({ length: maxPub }, (_, i) => i + 1).filter((n) => !pubNos.includes(n));
    const odd = [...byId.values()].flat().filter((o) => !LAW_TYPES.includes(o.type));
    say(`  public laws: ${fmtN(pub.items.length)} (pagination.count ${fmtN(pub.count)}), numbered ${pubNos[0] ?? "-"} to ${maxPub}; numbers missing: ${gaps.length ? gaps.join(", ") : "none"}`);
    say(`  private laws: ${fmtN(priv.items.length)} (pagination.count ${fmtN(priv.count)}): ${priv.items.map((o) => `${o.lawNumber} ${o.id}`).join(", ") || "none"}`);
    say(`  bills that became more than one law: ${[...byId.entries()].filter(([, v]) => v.length > 1).map(([k]) => k).join(", ") || "none"}; a law from a type outside ${LAW_TYPES.join(", ")}: ${odd.map((o) => o.id).join(", ") || "none"}`);
    results.official = { pub: pub.items.length, priv: priv.items.length, pubCount: pub.count, privCount: priv.count, maxPub, gaps };

    say(`\n── 2. CT (prod, read-only)`);
    before = await fingerprint();
    say(`  prod's schema fingerprint before: ${before}`);
    const ids = [...byId.keys()];
    const list: Array<{ label: string; sql: string; args: InArgs }> = [
      { label: "the database's clock", sql: `SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now') AS db_now`, args: [] },
      { label: `CT's enacted rows among the law types, any tag`, sql: `SELECT id, title, is_ceremonial, update_date, sponsor_name, sponsor_party, latest_action_date, latest_action_text FROM bills WHERE congress = ? AND ${LAW} AND stage = 'enacted' ORDER BY id`, args: [CONGRESS] },
      { label: "CT's row for every official law's bill, any stage", sql: `SELECT id, stage, is_ceremonial, update_date, sponsor_name, sponsor_party, latest_action_date, latest_action_text FROM bills WHERE id IN (${ids.map(() => "?").join(", ")})`, args: ids },
      { label: "the dome's laws now, by party", sql: `SELECT sponsor_party AS party, COUNT(*) AS n FROM bills WHERE congress = ? AND ${LAW} AND ${NONC} AND stage = 'enacted' GROUP BY 1 ORDER BY 1`, args: [CONGRESS] },
    ];
    for (const s of list) guard(s.label, s.sql);
    const sets = await prod().batch(list.map((s) => ({ sql: s.sql, args: s.args })), "read");
    stmts += list.length;
    const back = new Date();
    const ctEnacted = objs(sets[1]);
    const ctRows = new Map(objs(sets[2]).map((r) => [String(r.id), r]));
    const dome = objs(sets[3]);
    const domeN = dome.reduce((a, r) => a + num(r.n), 0);
    say(`  [batch] ${list.length} statements, one read-only transaction · as of ${when(back)} (the database's clock ${when(objs(sets[0])[0]?.db_now)})`);
    say(`  CT's enacted rows among the law types, any tag: ${fmtN(ctEnacted.length)} (tag 1: ${ctEnacted.filter((r) => r.is_ceremonial === 1).length}, tag 0: ${ctEnacted.filter((r) => r.is_ceremonial === 0).length}, untagged: ${ctEnacted.filter((r) => r.is_ceremonial === null).length})`);
    say(`  the dome's laws now: ${domeN} (${dome.map((r) => `${String(r.party)} ${num(r.n)}`).join(", ")})`);

    say(`\n── 3. the diff`);
    const ctIds = new Set(ctEnacted.map((r) => String(r.id)));
    const lacking = ids.filter((id) => !ctRows.has(id));
    const short = ids.filter((id) => ctRows.has(id) && ctRows.get(id)?.stage !== "enacted");
    const extra = [...ctIds].filter((id) => !byId.has(id));
    say(`  official laws (${fmtN(pub.items.length)} public + ${fmtN(priv.items.length)} private, ${fmtN(ids.length)} bills): CT holds ${fmtN(ids.length - lacking.length - short.length)} at enacted, ${lacking.length} not at all, ${short.length} short of enacted; CT's enacted rows the official list lacks: ${extra.length}`);
    const effects = { dome: 0, party: {} as Record<string, number> };
    const rows: Array<Record<string, unknown>> = [];
    for (const id of [...lacking, ...short].sort((a, b) => lawNo(byId.get(a)?.[0]?.lawNumber ?? "") - lawNo(byId.get(b)?.[0]?.lawNumber ?? ""))) {
      const o = byId.get(id)![0]!;
      const r = ctRows.get(id);
      const d = await detail(o.type, o.number);
      const party = r ? str(r.sponsor_party) : d.party;
      const counts = !r || r.is_ceremonial === null || r.is_ceremonial === 0;
      if (counts) { effects.dome += 1; effects.party[String(party)] = (effects.party[String(party)] ?? 0) + 1; }
      const row = { id, law: `${o.lawType} ${o.lawNumber}`, title: o.title, sponsor: d.sponsor, party: d.party, state: d.state, ctStage: r ? r.stage : "not in CT", ctTag: r ? r.is_ceremonial : null, ctUpdate: r ? r.update_date : null, cgUpdate: d.update, became: d.became, latest: d.latest, counts };
      rows.push(row);
      say(`\n  ${id} · ${row.law} · ${o.title}`);
      say(`    sponsor ${String(d.sponsor)} (party ${String(d.party)}, state ${String(d.state)}) · CT: ${r ? `stage ${String(r.stage)}, is_ceremonial ${r.is_ceremonial === null ? "NULL" : String(r.is_ceremonial)}` : "not in CT"}`);
      say(`    update: CT ${r ? when(r.update_date) : "—"} · Congress.gov ${when(d.update)}`);
      say(`    became law: ${String(d.became)} · the latest action by date: ${String(d.latest)}`);
      say(`    if staged enacted: ${counts ? `the dome's laws +1, the ${String(party)} line +1` : "none on the dome (tagged ceremonial)"}`);
    }
    for (const id of extra.sort()) {
      const r = ctEnacted.find((x) => String(x.id) === id)!;
      const [, type, number] = id.split("-");
      const d = await detail(String(type), String(number));
      rows.push({ id, direction: "CT enacted, not on the official list", title: r.title, sponsor: r.sponsor_name, ctTag: r.is_ceremonial, cgLaws: d.laws, latest: d.latest });
      say(`\n  ${id} · CT enacted, not on the official list · ${String(r.title)}`);
      say(`    sponsor ${String(r.sponsor_name)} · CT is_ceremonial ${r.is_ceremonial === null ? "NULL" : String(r.is_ceremonial)} · Congress.gov laws ${d.laws} · latest ${String(d.latest)}`);
    }
    say(`\n── 4. what the gaps would change`);
    say(`  ${lacking.length + short.length + extra.length === 0 ? "none: CT's laws match the official list (0 short, 0 not in CT, 0 CT-only)" : `the dome's laws ${domeN} → ${domeN + effects.dome} if every gap were staged; by party ${Object.entries(effects.party).map(([p, n]) => `${p} +${n}`).join(", ") || "none"}; CT-only laws: ${extra.length}`}`);
    results.diff = { asOf: back.toISOString(), ctEnacted: ctEnacted.length, dome: domeN, lacking, short, extra, rows, effects };
  } catch (e) {
    failure = e as Error;
    say(`\n  ${failure.message}`);
  } finally {
    const end = new Date();
    say(`\n── safety`);
    if (before) {
      try {
        const after = await fingerprint();
        say(`  prod's schema fingerprint: before ${before} · after ${after} · ${before === after ? "unchanged" : "CHANGED"}`);
        results.schema = { before, after };
      } catch (e) {
        say(`  the schema re-read failed: ${(e as Error).message}`);
      }
    } else say(`  prod was not read`);
    say(`  prod: ${stmts} statement(s) · rows_read ${fmtN(tap.rows)} over ${tap.results} result(s) · Congress.gov: ${calls} GET(s)${useHeader ? ", the key in the X-Api-Key header" : ", the key in the query (redacted)"} · end ${when(end)} · ${((end.getTime() - start.getTime()) / 1000).toFixed(1)}s`);
    results.cost = { statements: stmts, rowsRead: tap.rows, results: tap.results, congressGov: calls, header: useHeader, start: start.toISOString(), end: end.toISOString() };
    results.failure = failure ? failure.message : null;
    try { writeFileSync(`${base}.log`, out.join("\n") + "\n"); } catch (e) { console.error(redactSecrets(`the log write failed: ${(e as Error).message}`)); }
    try { writeFileSync(`${base}.json`, JSON.stringify(results, null, 2) + "\n"); } catch (e) { console.error(redactSecrets(`the JSON write failed: ${(e as Error).message}`)); }
    try {
      if (!existsSync(LEDGER)) writeFileSync(LEDGER, "label\tstart_utc\tend_utc\tstatements\tresults_with_rows_read\trows_read\tfailed\n");
      appendFileSync(LEDGER, `laws-${LABEL}\t${start.toISOString()}\t${end.toISOString()}\t${stmts}\t${tap.results}\t${tap.rows}\t${failure ? "yes" : "no"}\n`);
    } catch (e) {
      console.error(redactSecrets(`the ledger write failed: ${(e as Error).message}`));
    }
    db?.close();
  }
  if (failure) process.exitCode = 1;
}

main().catch((e) => {
  console.error(redactSecrets(String((e as Error).stack ?? e)));
  process.exitCode = 1;
});
