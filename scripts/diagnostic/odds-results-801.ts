// HO 801: the election odds against the results. The last pre-close book (the 3:30 PM MST Nov 3 snapshot) beside
// prod's marks, favorite by favorite; the counts behind the poster's "favorites won X of N"; the drift across the three
// snapshots; and the marks' as-of. Read-only.
//
//   npx tsx scripts/diagnostic/odds-results-801.ts [--label L]
//
// One mode. It reads the three snapshot files from disk (docs/probes/odds-snapshots/, HO 787's task) and prod's marks
// (general_ballot, general_ballot_reads), and prints:
//   1  the last pre-close book: each of the rated races, its Kalshi favorite (favorite_label, or favorite_party when
//      favorite_is_party is 1) and implied_pct, its Polymarket favorite where it has one, and prod's result
//      (general_ballot rows with marked = 1: one mark decides, two or more a runoff, none not called);
//   2  the verdict per race: favorite won, favorite lost, runoff, not called, or unmatched (for a hand list);
//   3  the counts, for each book: favorites won X of N (N the races called by one mark; the share is won over called,
//      the share of the decided beside it), House and Senate, by implied_pct band; then the races where the two
//      books' favorites, each resolved to a candidate on the ballot, differ, and who was right;
//   4  the drift: every rated race whose Kalshi favorite changed at any of the three snapshots (end to end, or and
//      back), with its three implied_pct values; and the ten biggest moves in implied_pct (the last snapshot's number
//      less the first's, the favorite's own number each time) with the result beside each, every race tied with the
//      tenth kept;
//   5  the as-of of the marks (MAX(read_at) over the marked rows, prod-wide and over the rated races; the newest
//      last_attempt_at).
//
// THE MATCHING RULE (the handoff's, printed in the output too). A party favorite is matched on party: the winner's
// one-letter party against favorite_party. A named favorite is matched by name: both names lower-cased, diacritics
// folded, punctuation but hyphens dropped, the suffixes Jr, Sr, II, III and IV dropped, single-letter initials
// dropped while two tokens remain, then the first and the last remaining tokens kept (middle names dropped); two names
// match when the last tokens are equal and the first tokens are equal or one is a prefix of the other. A nickname
// used as a first name (Andy for Andrew) doesn't match, by design: it goes to the hand list. The favorite is matched
// against every candidate on the race's ballot: matching the one marked row is "favorite won"; matching another row and
// not the marked one is "favorite lost" (a positive identification of a candidate who didn't win; the handoff's text
// leaves open whether a named favorite is matched against the winner only, under which these read unmatched, and the
// output prints that count too); matching no row, or more than one, is "unmatched" and goes to the hand list with both
// strings, never guessed.
//
// CONTROLS. The rated index's length against counts.rated_index.N, and the Kalshi rows against counts.kalshi_odds, in
// each snapshot. Then, in memory only: one favorite's name altered must read unmatched, one party favorite set against
// the winner's party must read favorite lost (and set to it, favorite won), and a winner's own name planted as the
// favorite must read favorite won. Each is printed; none is written anywhere.
//
// SAFETY. Prod is only READ: every statement goes through q(), which refuses anything but SELECT or WITH … SELECT and
// any statement naming a write keyword (the HO 799 script's guard, copied); prod's schema is fingerprinted before and
// after. rows_read is summed off each hrana pipeline response and appended to docs/handoffs/801-artifacts/
// rows-ledger.tsv. TURSO_DATABASE_URL and TURSO_AUTH_TOKEN are read from .env by name; every printed line passes
// redactSecrets. Times print in Mountain Time on a 12-hour clock with UTC beside.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type ResultSet } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { redactSecrets } from "@/lib/redact";

config({ path: ".env", quiet: true });

const ART = path.resolve("docs/handoffs/801-artifacts"); // repo-ignored
const LEDGER = path.join(ART, "rows-ledger.tsv");
const SNAPDIR = path.resolve("docs/probes/odds-snapshots");
const SNAPS = ["2026-11-02-2130-MT.json", "2026-11-03-0730-MT.json", "2026-11-03-1530-MT.json"] as const;
const MT = "America/Denver";
const BANDS: Array<[number, number]> = [[50, 59], [60, 69], [70, 79], [80, 89], [90, 100]];
const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);

const argAt = (flag: string) => { const i = process.argv.indexOf(flag); return i === -1 ? undefined : process.argv[i + 1]; };
const LABEL = argAt("--label") ?? "run";
const out: string[] = [];
const say = (s = "") => { const r = redactSecrets(s); out.push(r); console.log(r); };
const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8" }).trim();
const fmtN = (n: number) => n.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toFixed(1)}%` : "n/a");
const oneLine = (sql: string) => sql.replace(/\s+/g, " ").trim();
const results: Record<string, unknown> = {};

// ── time ────────────────────────────────────────────────────────────────────
const mtFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: MT, month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short",
});
function when(x: unknown): string {
  if (x == null || x === "") return "(none)";
  const d = x instanceof Date ? x : new Date(String(x));
  if (Number.isNaN(d.getTime())) return `${String(x)} (unparsed)`;
  return `${mtFmt.format(d)} (${d.toISOString().slice(0, 19).replace("T", " ")}Z)`;
}

// ── prod, read-only, with the rows_read tap (the HO 799 script's, copied) ────
const tap = { rows: 0, results: 0 };
async function tapFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const res = await fetch(input, { ...init, signal: AbortSignal.timeout(120_000) });
  try {
    const j = (await res.clone().json()) as { results?: Array<{ response?: { result?: { rows_read?: unknown } } }> };
    for (const r of j.results ?? []) {
      const rr = r?.response?.result?.rows_read;
      if (typeof rr === "number") { tap.rows += rr; tap.results += 1; }
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
let stmts = 0;
async function q(label: string, sql: string, args: InArgs = []): Promise<ResultSet> {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql) || WRITE_WORD.test(sql)) throw new Error(`prod is read-only here: ${label}`);
  const before = tap.rows;
  const t = Date.now();
  const rs = await prod().execute({ sql, args });
  stmts += 1;
  const n = Array.isArray(args) ? args.length : 0;
  say(`  [q] ${label}`);
  say(`      ${oneLine(sql)}${n ? ` · ${n} arg(s)` : ""}`);
  say(`      → ${rs.rows.length} row(s) · rows_read ${tap.rows - before} · ${Date.now() - t}ms · read ${when(new Date())}`);
  return rs;
}
async function schemaPrint(): Promise<string> {
  const rs = await q("the schema fingerprint (sqlite_master)", `SELECT type, name, sql FROM sqlite_master ORDER BY type, name`);
  return createHash("sha256").update(JSON.stringify(rs.rows.map((r) => [r.type, r.name, r.sql]))).digest("hex").slice(0, 16);
}
const str = (v: unknown) => (v == null ? null : String(v));
const num = (v: unknown) => Number(v ?? 0);

// ── the snapshots ───────────────────────────────────────────────────────────
type OddsRow = { race_id: string; implied_pct: number | null; favorite_label: string | null; favorite_is_party: number; favorite_party: string | null; updated_at: string | null };
type Rated = { race_id: string; chamber: string; kalshi: boolean; polymarket: boolean };
type Snapshot = {
  file: string; taken: string; head: string;
  counts: { kalshi_odds: number; polymarket_odds: number; rated_index: { N: number } };
  rated: Rated[]; kalshi: Map<string, OddsRow>; poly: Map<string, OddsRow>; kalshiRows: number; polyRows: number;
};
function loadSnapshot(file: string): Snapshot {
  const p = path.join(SNAPDIR, file);
  const j = JSON.parse(readFileSync(p, "utf8")) as {
    taken_at: { utc: string }; head: string; counts: Snapshot["counts"]; rated_index: Rated[]; kalshi_odds: OddsRow[]; polymarket_odds: OddsRow[];
  };
  const keyed = (rows: OddsRow[]) => new Map(rows.map((r) => [r.race_id, r]));
  return {
    file, taken: j.taken_at.utc, head: String(j.head).slice(0, 7), counts: j.counts, rated: j.rated_index,
    kalshi: keyed(j.kalshi_odds), poly: keyed(j.polymarket_odds), kalshiRows: j.kalshi_odds.length, polyRows: j.polymarket_odds.length,
  };
}

// ── the matching rule ───────────────────────────────────────────────────────
// A name's tokens: NFKD with the combining marks dropped (\p{M}), lower-cased, apostrophes dropped, other punctuation
// but hyphens a space; the suffixes dropped; then single-letter initials dropped while more than two tokens remain.
function nameTokens(raw: string): string[] {
  // A period before a letter joins it ("J.D." is jd, one given name); a period before a space or the end is punctuation.
  const folded = raw.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/\.(?=[a-z])/g, "");
  const cleaned = folded.replace(/['`‘’]/g, "").replace(/[^a-z0-9\- ]+/g, " ").replace(/\s+/g, " ").trim();
  let tokens = cleaned.split(" ").filter((t) => t.length > 0 && t !== "-" && !SUFFIXES.has(t));
  while (tokens.length > 2) {
    const i = tokens.findIndex((t) => t.length === 1);
    if (i === -1) break;
    tokens = tokens.filter((_, k) => k !== i);
  }
  return tokens;
}
// Two names match when each keeps two tokens or more, the last tokens are equal, and the first tokens are equal or one
// is a prefix of the other.
function sameName(a: string, b: string): boolean {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (x.length < 2 || y.length < 2) return false;
  if (x[x.length - 1] !== y[y.length - 1]) return false;
  const fx = x[0]!;
  const fy = y[0]!;
  return fx === fy || fx.startsWith(fy) || fy.startsWith(fx);
}

type Cand = { key: string; name: string; party: string | null; marked: number; on_ballot: number; withdrawn: number; read_at: string | null };
type Verdict = "favorite won" | "favorite lost" | "runoff" | "not called" | "unmatched";
type Judged = { verdict: Verdict; winner: Cand | null; marks: number; why: string; matched: string[] };
function judge(fav: { label: string | null; isParty: boolean; party: string | null } | null, cands: Cand[]): Judged {
  const marked = cands.filter((c) => c.marked === 1);
  if (marked.length >= 2) return { verdict: "runoff", winner: null, marks: marked.length, why: `${marked.length} marked: ${marked.map((c) => `${c.name} (${c.party ?? "?"})`).join(", ")}`, matched: [] };
  if (marked.length === 0) return { verdict: "not called", winner: null, marks: 0, why: cands.length ? `${cands.length} ballot row(s), none marked` : "no ballot rows", matched: [] };
  const w = marked[0]!;
  if (!fav) return { verdict: "unmatched", winner: w, marks: 1, why: "no favorite in the book", matched: [] };
  if (fav.isParty) {
    if (!fav.party || !w.party) return { verdict: "unmatched", winner: w, marks: 1, why: `a party favorite (${fav.party ?? "none"}) against a winner's party (${w.party ?? "none"})`, matched: [] };
    return fav.party === w.party
      ? { verdict: "favorite won", winner: w, marks: 1, why: `party ${fav.party} = the winner's ${w.party}`, matched: [w.name] }
      : { verdict: "favorite lost", winner: w, marks: 1, why: `party ${fav.party} ≠ the winner's ${w.party}`, matched: [] };
  }
  const label = fav.label ?? "";
  const hits = cands.filter((c) => sameName(label, c.name));
  if (hits.length === 1 && hits[0]!.marked === 1) return { verdict: "favorite won", winner: w, marks: 1, why: `"${label}" = "${w.name}"`, matched: [hits[0]!.name] };
  if (hits.length === 1) return { verdict: "favorite lost", winner: w, marks: 1, why: `"${label}" = "${hits[0]!.name}", not the marked "${w.name}"`, matched: [hits[0]!.name] };
  if (hits.length === 0) return { verdict: "unmatched", winner: w, marks: 1, why: `"${label}" matches no ballot row; the winner reads "${w.name}"`, matched: [] };
  return { verdict: "unmatched", winner: w, marks: 1, why: `"${label}" matches ${hits.length} ballot rows (${hits.map((h) => `"${h.name}"`).join(", ")})`, matched: hits.map((h) => h.name) };
}
const favOf = (r: OddsRow | undefined) =>
  r ? { label: r.favorite_label, isParty: r.favorite_is_party === 1, party: r.favorite_party, pct: r.implied_pct } : null;
const favText = (r: OddsRow | undefined) => (!r ? "—" : r.favorite_is_party === 1 ? `${r.favorite_party ?? "?"} (${r.favorite_label ?? "party"})` : r.favorite_label ?? "?");
const bandOf = (p: number | null) => (p == null ? "n/a" : (BANDS.find(([lo, hi]) => p >= lo && p <= hi) ?? [0, 0]).join("–"));

// ── the run ─────────────────────────────────────────────────────────────────
async function main() {
  if (process.argv.slice(2).some((a) => a.startsWith("--") && a !== "--label")) {
    console.error("usage: npx tsx scripts/diagnostic/odds-results-801.ts [--label L]   (read-only; one mode)");
    process.exit(2);
  }
  mkdirSync(ART, { recursive: true });
  const start = new Date();
  say(`HO 801 odds · label ${LABEL} · start ${when(start)} · HEAD ${git(["rev-parse", "--short", "HEAD"])} (${git(["branch", "--show-current"])}) · node ${process.version}`);
  let before = "";
  let failure: Error | null = null;
  try {
    before = await schemaPrint();
    say(`  prod's schema fingerprint before: ${before}`);

    // the snapshots and their controls
    say(`\n── the snapshots (${SNAPDIR})`);
    const snaps = SNAPS.map(loadSnapshot);
    const ctl: string[] = [];
    for (const s of snaps) {
      const okN = s.rated.length === s.counts.rated_index.N;
      const okK = s.kalshiRows === s.counts.kalshi_odds;
      const okP = s.polyRows === s.counts.polymarket_odds;
      say(`  ${s.file}: taken ${when(s.taken)} · head ${s.head} · rated ${s.rated.length} (counts.rated_index.N ${s.counts.rated_index.N}) ${okN ? "equal" : "DIFFER"} · kalshi rows ${s.kalshiRows} (counts ${s.counts.kalshi_odds}) ${okK ? "equal" : "DIFFER"} · polymarket rows ${s.polyRows} (counts ${s.counts.polymarket_odds}) ${okP ? "equal" : "DIFFER"}`);
      if (!okN || !okK || !okP) ctl.push(s.file);
    }
    if (ctl.length) throw new Error(`HALT: a snapshot's rows differ from its own counts (${ctl.join(", ")})`);
    const last = snaps[2]!;
    const ratedIds = last.rated.map((r) => r.race_id).sort();
    const chamber = new Map(last.rated.map((r) => [r.race_id, r.chamber]));
    const sameSet = snaps.every((s) => JSON.stringify(s.rated.map((r) => r.race_id).sort()) === JSON.stringify(ratedIds));
    say(`  the rated index is the same ${ratedIds.length} races in all three: ${sameSet ? "yes" : "NO"}`);
    for (const id of ratedIds) if (!last.kalshi.has(id)) throw new Error(`HALT: rated race ${id} has no Kalshi row in ${last.file}`);

    // prod's marks
    say(`\n── prod's marks (SELECT only)`);
    const ph = ratedIds.map(() => "?").join(",");
    const gb = await q("every ballot row of the rated races", `SELECT race_id, person_key, name, party, marked, on_ballot, withdrawn, read_at FROM general_ballot WHERE race_id IN (${ph}) ORDER BY race_id, person_key`, ratedIds);
    const cands = new Map<string, Cand[]>();
    for (const r of gb.rows) {
      const id = String(r.race_id);
      const list = cands.get(id) ?? [];
      list.push({ key: String(r.person_key), name: String(r.name), party: str(r.party), marked: num(r.marked), on_ballot: num(r.on_ballot), withdrawn: num(r.withdrawn), read_at: str(r.read_at) });
      cands.set(id, list);
    }
    // The verdicts' input, kept beside the run's log so they can be recomputed without prod.
    const dump = path.join(ART, `odds-${LABEL}-ballot.tsv`);
    writeFileSync(dump, `race_id\tperson_key\tname\tparty\tmarked\ton_ballot\twithdrawn\tread_at\n${gb.rows.map((r) => [r.race_id, r.person_key, r.name, r.party ?? "", r.marked, r.on_ballot, r.withdrawn, r.read_at].map((v) => String(v ?? "").replace(/[\t\r\n]/g, " ")).join("\t")).join("\n")}\n`);
    say(`  the ballot rows of the rated races, as read: ${path.relative(process.cwd(), dump)} (${gb.rows.length} rows)`);
    const reads = await q("the rated races' read rows", `SELECT race_id, status, read_at, rows, marked, last_attempt_at FROM general_ballot_reads WHERE race_id IN (${ph})`, ratedIds);
    const readOf = new Map(reads.rows.map((r) => [String(r.race_id), r]));
    const asof = await q("the marks' as-of", `SELECT (SELECT MAX(read_at) FROM general_ballot WHERE marked = 1) AS marked_read_at, (SELECT MAX(last_attempt_at) FROM general_ballot_reads) AS last_attempt_at, (SELECT COUNT(*) FROM (SELECT race_id FROM general_ballot GROUP BY race_id HAVING SUM(marked) = 1)) AS one_mark_races, (SELECT COUNT(*) FROM (SELECT race_id FROM general_ballot GROUP BY race_id HAVING SUM(marked) >= 2)) AS runoff_races`);
    const a0 = asof.rows[0]!;
    const ratedMarked = [...cands.values()].flat().filter((c) => c.marked === 1 && c.read_at).map((c) => c.read_at!).sort();
    say(`  the newest read_at among marked rows: ${when(a0.marked_read_at)} prod-wide, ${when(ratedMarked[ratedMarked.length - 1] ?? null)} over the rated races · the newest last_attempt_at: ${when(a0.last_attempt_at)}`);
    say(`  all races in general_ballot: ${fmtN(num(a0.one_mark_races))} decided by one mark, ${fmtN(num(a0.runoff_races))} with two or more`);
    say(`  Ballotpedia is still calling races, so a later run may read more marks than this one (Monday's --label print re-run).`);
    results.asof = { markedReadAt: str(a0.marked_read_at), ratedMarkedReadAt: ratedMarked[ratedMarked.length - 1] ?? null, lastAttemptAt: str(a0.last_attempt_at), oneMarkRaces: num(a0.one_mark_races), runoffRaces: num(a0.runoff_races) };

    // 1 and 2: the book and the verdicts
    say(`\n── 1 and 2: the last pre-close book (${last.file}, ${when(last.taken)}) against the marks`);
    say(`  the matching rule: party favorites on party; named favorites by name, lower-cased, diacritics folded, a period before a letter joined (J.D. is jd), other punctuation but hyphens dropped, Jr/Sr/II/III/IV dropped, single-letter initials dropped while more than two tokens remain, first and last remaining tokens kept; last equal and first equal or a prefix (so a nickname, Andy for Andrew, doesn't match). Matched against every ballot row of the race: the one marked row is won; another row only, lost; none or several, unmatched (the hand list).`);
    type Line = { id: string; chamber: string; k: OddsRow; p: OddsRow | undefined; kj: Judged; pj: Judged | null; read: string };
    const lines: Line[] = [];
    for (const id of ratedIds) {
      const k = last.kalshi.get(id)!;
      const p = last.poly.get(id);
      const cs = cands.get(id) ?? [];
      const kj = judge(favOf(k), cs);
      const pj = p ? judge(favOf(p), cs) : null;
      const rr = readOf.get(id);
      lines.push({ id, chamber: chamber.get(id) ?? "?", k, p, kj, pj, read: rr ? `${String(rr.status)} ${when(rr.read_at)}` : "no read row" });
    }
    say(`  race · chamber · Kalshi favorite (pct) · Polymarket favorite (pct) · result · Kalshi verdict · Polymarket verdict`);
    for (const l of lines) {
      const result = l.kj.verdict === "runoff" ? `runoff (${l.kj.why})` : l.kj.winner ? `${l.kj.winner.name} (${l.kj.winner.party ?? "?"})` : l.kj.why;
      say(`    ${l.id} · ${l.chamber} · ${favText(l.k)} (${l.k.implied_pct ?? "?"}) · ${l.p ? `${favText(l.p)} (${l.p.implied_pct ?? "?"})` : "—"} · ${result} · ${l.kj.verdict}${l.pj ? ` · ${l.pj.verdict}` : ""}`);
    }

    // 3: the counts
    say(`\n── 3: the counts`);
    const tally = (rows: Array<{ j: Judged; pct: number | null; chamber: string }>) => {
      const t = { called: 0, won: 0, lost: 0, unmatched: 0, runoff: 0, notCalled: 0 };
      for (const r of rows) {
        if (r.j.verdict === "runoff") t.runoff++;
        else if (r.j.verdict === "not called") t.notCalled++;
        else {
          t.called++;
          if (r.j.verdict === "favorite won") t.won++;
          else if (r.j.verdict === "favorite lost") t.lost++;
          else t.unmatched++;
        }
      }
      return t;
    };
    // the share is won over called (the handoff's "called, won, the share"); the share of the decided (won over won and
    // lost, the hand list out of the denominator) prints beside it
    const line = (name: string, t: ReturnType<typeof tally>) =>
      `  ${name}: favorites won ${t.won} of ${t.called} called by one mark, ${pct(t.won, t.called)} (lost ${t.lost}, unmatched ${t.unmatched} for the hand list; ${pct(t.won, t.won + t.lost)} of those decided) · runoff ${t.runoff} · not called ${t.notCalled}`;
    type CRow = { j: Judged; pct: number | null; chamber: string; named: boolean };
    const countsFor = (book: string, rows: CRow[]) => {
      const all = tally(rows);
      say(line(`${book}, all ${rows.length} rated`, all));
      const out: Record<string, unknown> = { all };
      for (const ch of ["house", "senate"]) {
        const sub = rows.filter((r) => r.chamber === ch);
        const t = tally(sub);
        say(line(`  ${book}, ${ch} (${sub.length})`, t));
        out[ch] = t;
      }
      say(`  ${book} by implied_pct band (the favorite's own number): band · rated · called · won · lost · unmatched · the share (won of called) · of those decided`);
      const bands: Record<string, unknown> = {};
      for (const [lo, hi] of BANDS) {
        const sub = rows.filter((r) => r.pct != null && r.pct >= lo && r.pct <= hi);
        const t = tally(sub);
        say(`    ${lo}–${hi} · ${sub.length} · ${t.called} · ${t.won} · ${t.lost} · ${t.unmatched} · ${pct(t.won, t.called)} · ${pct(t.won, t.won + t.lost)}`);
        bands[`${lo}-${hi}`] = { rated: sub.length, ...t };
      }
      out.bands = bands;
      // The handoff leaves open whether a named favorite is matched against the winner only: under that narrower reading
      // a named "favorite lost" reads unmatched instead; X of N doesn't move.
      const namedLost = rows.filter((r) => r.named && r.j.verdict === "favorite lost").length;
      say(`  ${book}, the narrower reading (a named favorite matched against the winner only): lost ${all.lost - namedLost}, unmatched ${all.unmatched + namedLost}; won ${all.won} of ${all.called} unchanged`);
      out.narrower = { lost: all.lost - namedLost, unmatched: all.unmatched + namedLost };
      return out;
    };
    const counts: Record<string, unknown> = {};
    counts.kalshi = countsFor("Kalshi", lines.map((l) => ({ j: l.kj, pct: l.k.implied_pct, chamber: l.chamber, named: l.k.favorite_is_party !== 1 })));
    const pLines = lines.filter((l) => l.p && l.pj);
    counts.polymarket = countsFor("Polymarket", pLines.map((l) => ({ j: l.pj!, pct: l.p!.implied_pct, chamber: l.chamber, named: l.p!.favorite_is_party !== 1 })));
    // Both books: each favorite resolved to one candidate on the race's ballot first (a party favorite to the one on-ballot
    // row of its party, a named one to the one row the name rule matches); two candidates compared, never two strings.
    const resolve = (r: OddsRow, cs: Cand[]): Cand | null => {
      const hits = r.favorite_is_party === 1
        ? cs.filter((c) => c.on_ballot === 1 && c.party != null && c.party === r.favorite_party)
        : cs.filter((c) => sameName(r.favorite_label ?? "", c.name));
      return hits.length === 1 ? hits[0]! : null;
    };
    const rightOf = (kv: Verdict, pv: Verdict) => {
      const tail = ` (Kalshi ${kv}, Polymarket ${pv})`;
      if (kv === "runoff" || kv === "not called") return `not decided${tail}`;
      if (kv === "favorite won" && pv === "favorite won") return `both${tail}`;
      if (kv === "favorite won") return `Kalshi${tail}`;
      if (pv === "favorite won") return `Polymarket${tail}`;
      if (kv === "unmatched" || pv === "unmatched") return `the hand list${tail}`;
      return `neither${tail}`;
    };
    say(`  both books: each favorite resolved to a candidate on the ballot, then compared`);
    const differ: unknown[] = [];
    const unresolved: unknown[] = [];
    let same = 0;
    for (const l of pLines) {
      const cs = cands.get(l.id) ?? [];
      const kc = resolve(l.k, cs);
      const pc = resolve(l.p!, cs);
      const res = l.kj.winner ? `${l.kj.winner.name} (${l.kj.winner.party ?? "?"})` : l.kj.verdict;
      if (!kc || !pc) {
        say(`    ${l.id}: unresolved, for the hand list: Kalshi ${favText(l.k)} (${l.k.implied_pct}) → ${kc ? kc.name : "no one candidate"} · Polymarket ${favText(l.p)} (${l.p!.implied_pct}) → ${pc ? pc.name : "no one candidate"} · result ${res} · ${rightOf(l.kj.verdict, l.pj!.verdict)}`);
        unresolved.push({ id: l.id, kalshi: favText(l.k), polymarket: favText(l.p), kalshiCandidate: kc?.name ?? null, polymarketCandidate: pc?.name ?? null, result: res });
        continue;
      }
      if (kc.key === pc.key) { same++; continue; }
      const right = rightOf(l.kj.verdict, l.pj!.verdict);
      say(`    ${l.id}: differed: Kalshi ${favText(l.k)} (${l.k.implied_pct}) = ${kc.name} · Polymarket ${favText(l.p)} (${l.p!.implied_pct}) = ${pc.name} · result ${res} · right: ${right}`);
      differ.push({ id: l.id, kalshi: kc.name, kalshiPct: l.k.implied_pct, polymarket: pc.name, polymarketPct: l.p!.implied_pct, result: res, right });
    }
    say(`  both books: the same candidate in ${same} of ${pLines.length} · differed ${differ.length} · unresolved ${unresolved.length}`);
    counts.differ = differ;
    counts.unresolved = unresolved;
    counts.bothSame = same;
    results.counts = counts;

    // the hand list
    say(`\n── the hand list (unmatched; never guessed)`);
    const hand = lines.flatMap((l) => [
      ...(l.kj.verdict === "unmatched" ? [{ id: l.id, book: "Kalshi", favorite: favText(l.k), pct: l.k.implied_pct, why: l.kj.why, ballot: (cands.get(l.id) ?? []).map((c) => `${c.name}${c.marked ? " [marked]" : ""}`) }] : []),
      ...(l.pj && l.pj.verdict === "unmatched" ? [{ id: l.id, book: "Polymarket", favorite: favText(l.p), pct: l.p!.implied_pct, why: l.pj.why, ballot: (cands.get(l.id) ?? []).map((c) => `${c.name}${c.marked ? " [marked]" : ""}`) }] : []),
    ]);
    for (const h of hand) say(`    ${h.id} · ${h.book} · favorite "${h.favorite}" (${h.pct}) · ${h.why} · the ballot: ${h.ballot.join("; ") || "(no rows)"}`);
    if (hand.length === 0) say(`    none`);

    // 4: the drift
    say(`\n── 4: the drift across the three snapshots (${snaps.map((s) => when(s.taken)).join(" → ")})`);
    const sameFav = (a: OddsRow | undefined, b: OddsRow | undefined) =>
      !!a && !!b && ((a.favorite_is_party === 1 || b.favorite_is_party === 1)
        ? a.favorite_is_party === b.favorite_is_party && a.favorite_party === b.favorite_party
        : sameName(a.favorite_label ?? "", b.favorite_label ?? ""));
    const drift = lines.map((l) => {
      const ks = snaps.map((s) => s.kalshi.get(l.id));
      const anyChange = ks.some((r, i) => i > 0 && !sameFav(r, ks[i - 1]));
      const endToEnd = !sameFav(ks[2], ks[0]);
      const p0 = ks[0]?.implied_pct ?? null;
      const p2 = ks[2]?.implied_pct ?? null;
      return { id: l.id, ks, changed: anyChange, endToEnd, move: p0 != null && p2 != null ? p2 - p0 : null, verdict: l.kj.verdict, winner: l.kj.winner };
    });
    const changed = drift.filter((d) => d.changed);
    say(`  the Kalshi favorite changed at one of the three snapshots in ${changed.length} rated race(s), ${changed.filter((d) => d.endToEnd).length} of them end to end (9:30 PM Nov 2 against 3:30 PM Nov 3) and ${changed.filter((d) => !d.endToEnd).length} and back:`);
    for (const d of changed) say(`    ${d.id} (${d.endToEnd ? "end to end" : "and back"}): ${d.ks.map((r) => `${favText(r)} ${r?.implied_pct ?? "?"}`).join(" → ")} · ${d.verdict}${d.winner ? ` (${d.winner.name})` : ""}`);
    say(`  the ten biggest moves in implied_pct, the 3:30 PM Nov 3 number less the 9:30 PM Nov 2 one, each the favorite's own number at the time (* where the two end numbers are two candidates', the favorite having changed end to end); every race tied with the tenth kept:`);
    const ranked = drift.filter((d) => d.move != null).sort((a, b) => Math.abs(b.move!) - Math.abs(a.move!) || a.id.localeCompare(b.id));
    const cut = ranked.length >= 10 ? Math.abs(ranked[9]!.move!) : 0;
    const top = ranked.filter((d, i) => i < 10 || Math.abs(d.move!) === cut);
    for (const d of top) say(`    ${d.id}${d.endToEnd ? " *" : ""}: ${d.ks.map((r) => r?.implied_pct ?? "?").join(" → ")} (${d.move! > 0 ? "+" : ""}${d.move}) · ${favText(d.ks[2])} · ${d.verdict}${d.winner ? ` (${d.winner.name})` : ""}`);
    if (top.length > 10) say(`    (tenth place shared at |${cut}|: ${top.length} races printed)`);
    results.drift = {
      changed: changed.map((d) => ({ id: d.id, endToEnd: d.endToEnd, path: d.ks.map((r) => `${favText(r)} ${r?.implied_pct}`), verdict: d.verdict })),
      top: top.map((d) => ({ id: d.id, path: d.ks.map((r) => r?.implied_pct), move: d.move, endToEnd: d.endToEnd, verdict: d.verdict })),
    };

    // the planted controls, in memory only
    say(`\n── the planted controls (in memory; nothing written)`);
    const calledNamed = lines.find((l) => l.kj.verdict === "favorite won" && l.k.favorite_is_party !== 1);
    const ctlOut: Record<string, unknown> = {};
    if (calledNamed) {
      const cs = cands.get(calledNamed.id) ?? [];
      const altered = { label: `${calledNamed.k.favorite_label ?? ""}zq`.replace(/(\S+)$/, "Xq$1"), isParty: false, party: null };
      const r1 = judge(altered, cs);
      say(`  a favorite's name altered (${calledNamed.id}, "${calledNamed.k.favorite_label}" → "${altered.label}"): ${r1.verdict} · ${r1.verdict === "unmatched" ? "PASS" : "FAIL"}`);
      const r2 = judge({ label: calledNamed.kj.winner!.name, isParty: false, party: null }, cs);
      say(`  the winner's own name planted as the favorite (${calledNamed.id}, "${calledNamed.kj.winner!.name}"): ${r2.verdict} · ${r2.verdict === "favorite won" ? "PASS" : "FAIL"}`);
      ctlOut.altered = { id: calledNamed.id, verdict: r1.verdict, pass: r1.verdict === "unmatched" };
      ctlOut.winnerName = { id: calledNamed.id, verdict: r2.verdict, pass: r2.verdict === "favorite won" };
    } else say(`  no called race with a named favorite that won: the name controls can't be planted`);
    const calledParty = lines.find((l) => l.kj.winner && l.kj.winner.party && (l.kj.winner.party === "D" || l.kj.winner.party === "R"));
    if (calledParty) {
      const cs = cands.get(calledParty.id) ?? [];
      const wp = calledParty.kj.winner!.party!;
      const flip = wp === "D" ? "R" : "D";
      const r3 = judge({ label: "party", isParty: true, party: flip }, cs);
      const r4 = judge({ label: "party", isParty: true, party: wp }, cs);
      say(`  a party favorite set against the winner's party (${calledParty.id}, the winner ${wp}, the plant ${flip}): ${r3.verdict} · ${r3.verdict === "favorite lost" ? "PASS" : "FAIL"}`);
      say(`  a party favorite set to the winner's party (${calledParty.id}, ${wp}): ${r4.verdict} · ${r4.verdict === "favorite won" ? "PASS" : "FAIL"}`);
      ctlOut.partyFlip = { id: calledParty.id, verdict: r3.verdict, pass: r3.verdict === "favorite lost" };
      ctlOut.partySame = { id: calledParty.id, verdict: r4.verdict, pass: r4.verdict === "favorite won" };
    } else say(`  no called race with a D or R winner: the party controls can't be planted`);
    results.controls = ctlOut;
    const failed = Object.values(ctlOut).filter((c) => !(c as { pass: boolean }).pass);
    if (failed.length) throw new Error(`HALT: ${failed.length} planted control(s) read wrong`);

    results.races = lines.map((l) => ({
      id: l.id, chamber: l.chamber,
      kalshi: { favorite: favText(l.k), pct: l.k.implied_pct, band: bandOf(l.k.implied_pct), verdict: l.kj.verdict, why: l.kj.why },
      polymarket: l.p ? { favorite: favText(l.p), pct: l.p.implied_pct, verdict: l.pj!.verdict, why: l.pj!.why } : null,
      winner: l.kj.winner ? { name: l.kj.winner.name, party: l.kj.winner.party } : null, marks: l.kj.marks, read: l.read,
    }));
    results.hand = hand;
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
    if (!existsSync(LEDGER)) writeFileSync(LEDGER, "label\tstart_utc\tend_utc\tstatements\tpipeline_results\trows_read\tfailed\n");
    appendFileSync(LEDGER, `odds-${LABEL}\t${start.toISOString()}\t${end.toISOString()}\t${stmts}\t${tap.results}\t${tap.rows}\t${failure ? "yes" : "no"}\n`);
    const base = path.join(ART, `odds-${LABEL}`);
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
