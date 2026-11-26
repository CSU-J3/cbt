// HO 835 § 1.D, C2: the absence band's card, read band-only and batched, and a
// read-only proof that it deep-equals the shipped band's card for every member.
//
// The shipped band (lib/queries.ts:6194-6235) builds each member's card from
// getMemberCardExpansion(bio, false): five readers per member, each its own store
// request (stats, top topics, recent bills, committees, affiliations), and keeps
// three fields of them (:6223-6229):
//   - stats.total;
//   - the first ABSENCE_BACK_BILLS_CAP recent bills' bill_type and bill_number;
//   - every current committee's name, unsliced, in the roster's order.
// The candidate reads just those three, each in ONE statement over all of the
// band's members (IN (…)), and assembles each member's card with the shipped
// projection. getMemberCardExpansion and everything else in lib/ stay as they are:
// this file is the prototype, and nothing imports it.
//
// What it does, in order:
//   1. Controls: the next/cache stub is loaded (unstable_cache returns the function
//      itself, so every shipped reader runs uncached), and the guard's preload is
//      loaded in THIS process (its `preload` line carries this pid).
//   2. The shipped path: getAbsenceWatch(), uncached, which runs queryAbsenceWatch:
//      the band's member list and each member's shipped `card`.
//   3. The candidate: three SELECTs over the same members, in parallel (db.execute
//      only, no batch), and the cards assembled from them.
//   4. A tie diagnostic (one more SELECT, not part of the candidate): the
//      latest_action_date at ranks 1 to CAP + 1 of each member's summary'd bills.
//   5. Per member: PASS or FAIL by node:util isDeepStrictEqual AND byte-equal JSON
//      (isDeepStrictEqual ignores object key order; the JSON is what a cache holds),
//      every differing field named, and any date tie that leaves the shipped bills'
//      order unfixed. Then the comparator's own controls (no store): six mutations
//      of a passing member's batched card must each FAIL, or the run stops (exit 2).
//   6. From the guard's log: store requests, statements, the longest serial chain
//      and the most requests in flight, for each path. Then the log's claims as
//      gates (exit 2 on any): the batched window is exactly the three candidate
//      SELECTs, the tie window is exactly its one, the shipped card wave is 5 readers
//      x the band, every statement is a SELECT, and every store request since the
//      shipped path began falls inside one of the three windows.
//
// The traps (STEP 0 claim 6, docs/handoffs/835-artifacts/step0-835-c6.md):
//   - stats.total counts every non-ceremonial bill with no summary gate (:8044-8045);
//     the bills come from summary'd ones only (:8007). Two predicates, two reads.
//     A member with no bills has no GROUP BY row: total 0, as Number(r?.total ?? 0).
//   - getSponsorRecentBills orders by `latest_action_date DESC NULLS LAST` with no
//     tiebreak (:8008). The candidate COPIES that order, adding no tiebreak: the
//     window's ORDER BY is the shipped clause, under the same forced index
//     (idx_bills_sponsor_agg) and the same predicate, partitioned by sponsor. SQL
//     doesn't fix the order of two bills with the same date in either read, so the
//     tie diagnostic names every member where such a tie touches the first CAP. A
//     PASS there means the two plans agreed on the tie this run, not that SQL
//     guarantees it.
//   - Committees keep the roster's ORDER BY (:10539-10549) behind cm.bioguide_id.
//     Two rows tie on that order only when their c.name is equal too, so a tie can't
//     change the projected names: no trap for this field.
//   - bill_type and bill_number are the raw column values, as rowToFeedBill passes
//     them (:8575-8576); committee name likewise (:10554).
//
// The store is prod's, read-only. Run it only with the guard's preload and the
// next/cache stub, from the repo root (the store's URL and token from .env, by name,
// never printed):
//   set -a && . ./.env && set +a && \
//   HOME_PROBE_LOG=<repo>/docs/handoffs/835-artifacts/proof-c2-guard.jsonl \
//   node --require ./scripts/diagnostic/home-cold-plan-835-preload.cjs --import tsx \
//     --import ./scripts/diagnostic/next-cache-stub-754.mjs \
//     scripts/diagnostic/absence-card-batch-835.ts > <…>/proof-c2.log 2>&1
// The preload refuses, before sending, any statement that isn't a read by HO 824's
// rules (it throws, and logs a `refused` line). This file sends SELECTs only.
//
// The shipped-card-wave gates describe the band BEFORE C2 (five readers x the band):
// after HO 836 ships C2 they fail by design and must be replaced (the band's card reads
// become three SELECTs), and billsSql/tieSql must carry the tiebreak HO 836 ships.
//
// Exit: 0 every member PASS; 1 any FAIL, or a candidate or tie read threw (a guard
// refusal included: grep the guard log for "kind":"refused"); 2 a control or a gate
// failed, or the shipped read returned no window.
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { unstable_cache } from "next/cache";
import { getDb } from "../../lib/db";
import { ABSENCE_BACK_BILLS_CAP, getAbsenceWatch, type AbsenceCardPayload } from "../../lib/queries";

type LogLine = {
  kind: string;
  t: string;
  pid?: number;
  n?: number;
  sql?: string[];
  ms?: number;
  status?: number;
  refused?: string[];
};

const LOG = process.env.HOME_PROBE_LOG ?? "";
function die(msg: string): never {
  console.log(`STOP: ${msg}`);
  process.exit(2);
}
if (!LOG) die("HOME_PROBE_LOG is not set: run it with the guard's preload");
const readLog = (): LogLine[] =>
  readFileSync(LOG, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as LogLine);

// ---- 1. controls ------------------------------------------------------------------------
{
  const probe = () => 0;
  const wrapped = (unstable_cache as unknown as (f: unknown, k?: unknown, o?: unknown) => unknown)(probe, ["x"], {});
  if (wrapped !== probe) die("next/cache isn't the stub: unstable_cache wrapped the function (readers would be cached)");
  // --require runs in every thread of the process: the main thread and tsx's
  // module-hooks worker, which shares the pid. So one line or more; none means the
  // guard isn't loaded here. The log is appended to across runs, so only lines written
  // since this process started count (a recycled pid's old line must not pass).
  const started = Date.now() - process.uptime() * 1000 - 1000;
  const pre = readLog().filter((l) => l.kind === "preload" && l.pid === process.pid && Date.parse(l.t) >= started);
  if (pre.length < 1) die(`no guard preload line for this pid (${process.pid})`);
  console.log(`controls: next/cache stub loaded (unstable_cache returns the function); guard preload loaded in pid ${process.pid} (${pre.length} preload lines: main thread + tsx's hooks thread)`);
}

const CAP = ABSENCE_BACK_BILLS_CAP;
const offsets: Record<string, [number, number]> = {};
const mark = () => readLog().length;

// ---- 2. the shipped path ---------------------------------------------------------------------
const s0 = mark();
const watch = await getAbsenceWatch();
const s1 = mark();
offsets.shipped = [s0, s1];
if (watch.window === null) die("getAbsenceWatch returned window: null (its read threw; see above)");
const members = watch.members;
console.log(`\nshipped band: ${members.length} members; window house ${watch.window.house}, senate ${watch.window.senate}; ABSENCE_BACK_BILLS_CAP = ${CAP}`);
if (members.length === 0) die("the band is empty: no card to compare");

// ---- 3. the candidate: three SELECTs over the band's members ----------------------------------
const db = getDb();
const bios = members.map((m) => m.bioguideId);
if (new Set(bios).size !== bios.length) die("a member appears twice in the band");
const ph = bios.map(() => "?").join(",");
const CER = " AND (is_ceremonial = 0 OR is_ceremonial IS NULL)";
const statsSql = `SELECT sponsor_bioguide_id AS bio, COUNT(*) AS total
    FROM bills INDEXED BY idx_bills_sponsor_agg
   WHERE sponsor_bioguide_id IN (${ph})${CER}
   GROUP BY sponsor_bioguide_id`;
const billsSql = `SELECT bio, bill_type, bill_number, rn FROM (
    SELECT sponsor_bioguide_id AS bio, bill_type, bill_number,
           ROW_NUMBER() OVER (PARTITION BY sponsor_bioguide_id
                              ORDER BY latest_action_date DESC NULLS LAST) AS rn
      FROM bills INDEXED BY idx_bills_sponsor_agg
     WHERE sponsor_bioguide_id IN (${ph})
       AND summary IS NOT NULL${CER}
  ) WHERE rn <= ? ORDER BY bio, rn`;
const cmteSql = `SELECT cm.bioguide_id AS bio, c.name AS name
    FROM committee_members cm
    JOIN committees c ON c.system_code = cm.committee_system_code
    LEFT JOIN committees p ON p.system_code = c.parent_system_code
   WHERE cm.bioguide_id IN (${ph}) AND c.is_current = 1
   ORDER BY cm.bioguide_id,
     c.parent_system_code IS NOT NULL ASC,
     CASE c.committee_type
       WHEN 'Standing' THEN 1
       WHEN 'Select' THEN 2
       WHEN 'Joint' THEN 3
       WHEN 'Task Force' THEN 4
       ELSE 5
     END,
     COALESCE(p.name, '') ASC,
     c.name ASC`;

const b0 = mark();
const [statsRs, billsRs, cmteRs] = await Promise.all([
  db.execute({ sql: statsSql, args: bios }),
  db.execute({ sql: billsSql, args: [...bios, CAP] }),
  db.execute({ sql: cmteSql, args: bios }),
]);
const b1 = mark();
offsets.batched = [b0, b1];

const batched = new Map<string, AbsenceCardPayload>();
for (const bio of bios) batched.set(bio, { stats: { total: 0 }, recentBills: [], committees: [] });
const at = (bio: unknown) => {
  const c = batched.get(String(bio ?? ""));
  if (!c) die(`a batched row for a member outside the band`);
  return c;
};
for (const r of statsRs.rows) at(r.bio).stats.total = Number(r.total ?? 0);
for (const r of billsRs.rows) {
  const c = at(r.bio);
  if (Number(r.rn) !== c.recentBills.length + 1) die(`bills rows out of rank order for ${String(r.bio)}`);
  c.recentBills.push({ bill_type: r.bill_type as string, bill_number: r.bill_number as number });
}
for (const r of cmteRs.rows) at(r.bio).committees.push({ name: r.name as string });

// ---- 4. the tie diagnostic (not part of the candidate) -------------------------------------
const tieSql = `SELECT bio, latest_action_date AS d, rn FROM (
    SELECT sponsor_bioguide_id AS bio, latest_action_date,
           ROW_NUMBER() OVER (PARTITION BY sponsor_bioguide_id
                              ORDER BY latest_action_date DESC NULLS LAST) AS rn
      FROM bills INDEXED BY idx_bills_sponsor_agg
     WHERE sponsor_bioguide_id IN (${ph})
       AND summary IS NOT NULL${CER}
  ) WHERE rn <= ? ORDER BY bio, rn`;
const t0 = mark();
const tieRs = await db.execute({ sql: tieSql, args: [...bios, CAP + 1] });
const t1 = mark();
offsets.tie = [t0, t1];
// The date at each rank is fixed whatever order ties come out in, so this reading
// is plan-proof: a tie between ranks k and k+1 (k <= CAP) is a place where SQL
// leaves the shipped first-CAP order, or the CAP-th bill itself, unfixed.
const dates = new Map<string, (string | null)[]>();
for (const r of tieRs.rows) {
  const k = String(r.bio ?? "");
  if (!dates.has(k)) dates.set(k, []);
  dates.get(k)!.push((r.d as string | null) ?? null);
}
const tiesOf = (bio: string): string[] => {
  const d = dates.get(bio) ?? [];
  const out: string[] = [];
  for (let k = 0; k + 1 < d.length && k < CAP; k++) {
    if (d[k] === d[k + 1]) out.push(`ranks ${k + 1}=${k + 2} on ${d[k] ?? "NULL"}`);
  }
  return out;
};

// ---- 5. the comparison ----------------------------------------------------------------------
const fmt = (v: unknown) => (v === undefined ? "(absent)" : JSON.stringify(v));
function diff(a: unknown, b: unknown, path: string, out: string[]): void {
  if (isDeepStrictEqual(a, b)) return;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push(`${path}.length: shipped ${a.length} | batched ${b.length}`);
    for (let i = 0; i < Math.max(a.length, b.length); i++) diff(a[i], b[i], `${path}[${i}]`, out);
    return;
  }
  if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) diff((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], `${path}.${k}`, out);
    return;
  }
  out.push(`${path}: shipped ${fmt(a)} | batched ${fmt(b)}`);
}

console.log(`\nper member (band order), shipped card vs batched card:`);
let pass = 0;
let fail = 0;
let tiedMembers = 0;
for (const m of members) {
  const mine = batched.get(m.bioguideId)!;
  const ties = tiesOf(m.bioguideId);
  if (ties.length) tiedMembers++;
  const head = `${m.bioguideId} ${m.name} (${m.chamber}, ${m.tier}, streak ${m.streak})`;
  const tieNote = `ties in the first ${CAP}: ${ties.length ? ties.join("; ") : "none"}`;
  if (m.card === null) {
    fail++;
    console.log(`FAIL  ${head}  ${tieNote}\n      card: shipped null (its assembly threw) | batched ${fmt(mine)}`);
    continue;
  }
  if ((m.card as unknown) === mine) die(`the shipped and batched cards are one object for ${m.bioguideId}`);
  const deep = isDeepStrictEqual(m.card, mine);
  const bytes = JSON.stringify(m.card) === JSON.stringify(mine);
  if (deep && bytes) {
    pass++;
    console.log(`PASS  ${head}  ${tieNote}`);
    console.log(`      card ${fmt(m.card)}`);
  } else {
    fail++;
    const d: string[] = [];
    diff(m.card, mine, "card", d);
    if (deep && !bytes) d.push("card: deep-equal, but the JSON differs (object key order)");
    console.log(`FAIL  ${head}  ${tieNote}`);
    for (const line of d) console.log(`      ${line}`);
    console.log(`      shipped ${fmt(m.card)}`);
    console.log(`      batched ${fmt(mine)}`);
  }
}
console.log(`\nRESULT: ${pass} PASS, ${fail} FAIL of ${members.length} members; ${tiedMembers} member(s) with a date tie in the first ${CAP}`);

// ---- 5b. the comparator's own controls (no store) ----------------------------------------------
// A PASS is worth something only if the same comparison can FAIL. On the first member
// that passed with 2+ distinct bills and 2+ distinct committees, each mutation of a
// copy of its batched card must fail the PASS test above (deep AND bytes).
{
  const ok = (a: unknown, b: unknown) => isDeepStrictEqual(a, b) && JSON.stringify(a) === JSON.stringify(b);
  const host = members.find((m) => {
    const c = m.card;
    return (
      c !== null &&
      ok(c, batched.get(m.bioguideId)) &&
      c.recentBills.length >= 2 &&
      c.committees.length >= 2 &&
      !isDeepStrictEqual(c.recentBills[0], c.recentBills[1]) &&
      c.committees[0]!.name !== c.committees[1]!.name
    );
  });
  if (!host) die("no passing member with 2+ distinct bills and committees to run the comparator's controls on");
  const base = batched.get(host.bioguideId)!;
  const muts: [string, (c: AbsenceCardPayload) => void][] = [
    ["stats.total + 1", (c) => void (c.stats.total += 1)],
    ["bills 0 and 1 swapped", (c) => void ([c.recentBills[0], c.recentBills[1]] = [c.recentBills[1]!, c.recentBills[0]!])],
    ["committees 0 and 1 swapped", (c) => void ([c.committees[0], c.committees[1]] = [c.committees[1]!, c.committees[0]!])],
    ["last committee dropped", (c) => void c.committees.pop()],
    ["bill_number as a string", (c) => void ((c.recentBills[0] as { bill_number: unknown }).bill_number = String(c.recentBills[0]!.bill_number))],
    // Same values, keys in another order: deep-equal, so it must fail by bytes alone.
    [
      "card keys reordered (same values)",
      (c) => {
        const { stats, recentBills, committees } = c;
        for (const k of Object.keys(c)) delete (c as Record<string, unknown>)[k];
        Object.assign(c, { committees, recentBills, stats });
      },
    ],
  ];
  const caught = muts.map(([name, f]) => {
    const c = structuredClone(base);
    f(c);
    return { name, failed: !ok(host.card, c), deep: isDeepStrictEqual(host.card, c) };
  });
  console.log(`comparator controls on ${host.bioguideId}: ${caught.map((x) => `${x.name} -> ${x.failed ? "FAIL (caught)" : "PASS (missed)"}${x.deep ? " [deep-equal, caught by bytes]" : ""}`).join("; ")}`);
  if (caught.some((x) => !x.failed)) die("the comparison missed a mutation: its PASS can't be trusted");
}

// ---- 6. counts, from the guard's log ------------------------------------------------------------
const log = readLog();
const storeIn = ([a, b]: [number, number]) => log.slice(a, b).filter((l) => l.kind === "store" || l.kind === "store-error");
const span = (l: LogLine) => {
  const s = Date.parse(l.t);
  return { s, e: s + (l.ms ?? 0) };
};
// The longest chain of requests where each starts at or after the previous one's
// end (t is taken as the request is sent, ms runs to its response headers). It counts
// the client's 20-slot limiter too: a request that waited for a slot chains on the
// one whose end freed it.
function chain(lines: LogLine[]): number {
  const iv = lines.map(span).sort((x, y) => x.s - y.s || x.e - y.e);
  const d: number[] = [];
  let max = 0;
  for (let i = 0; i < iv.length; i++) {
    let best = 0;
    for (let j = 0; j < i; j++) if (iv[j]!.e <= iv[i]!.s && d[j]! > best) best = d[j]!;
    d[i] = best + 1;
    if (d[i]! > max) max = d[i]!;
  }
  return max;
}
function inFlight(lines: LogLine[]): number {
  const ev: [number, number][] = [];
  for (const l of lines) {
    const { s, e } = span(l);
    ev.push([s, 1], [e, -1]);
  }
  ev.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let cur = 0;
  let max = 0;
  for (const [, dlt] of ev) {
    cur += dlt;
    if (cur > max) max = cur;
  }
  return max;
}
const stmts = (lines: LogLine[]) => lines.reduce((n, l) => n + (l.n ?? 0), 0);
const SHAPES: [string, string][] = [
  ["getSponsorStats", "SELECT COUNT(*) AS total, SUM(CASE WHEN stage = 'enacted'"],
  ["getSponsorTopTopics", "SELECT topics FROM bills INDEXED BY idx_bills_sponsor_topics"],
  ["getSponsorRecentBills", "SELECT id, congress, bill_type, bill_number, title"],
  ["getMemberCommittees", "SELECT cm.role, cm.party_side, cm.rank"],
  ["getMemberAffiliations", "SELECT org, category, source_url, last_verified FROM affiliations"],
];
const readerOf = (l: LogLine) => {
  const sql = l.sql ?? [];
  if (sql.length !== 1) return null;
  return SHAPES.find(([, p]) => sql[0]!.startsWith(p))?.[0] ?? null;
};
const describe = (label: string, lines: LogLine[]) =>
  `${label}: ${lines.length} store requests, ${stmts(lines)} statements, longest serial chain ${chain(lines)}, most in flight ${inFlight(lines)}`;

const shipped = storeIn(offsets.shipped);
const shippedCard = shipped.filter((l) => readerOf(l) !== null);
const shippedFixed = shipped.filter((l) => readerOf(l) === null);
const batchedLines = storeIn(offsets.batched);
const tieLines = storeIn(offsets.tie);
console.log(`\ncounts, from the guard's log (${LOG.split(/[\\/]/).pop()}):`);
console.log(describe("shipped band, getAbsenceWatch uncached (whole)", shipped));
console.log(`  ${describe("the band's own reads (population, rolls, Phase A/B, palestine)", shippedFixed)}`);
console.log(`  ${describe("the card wave, five readers per member", shippedCard)}`);
for (const [name] of SHAPES) console.log(`    ${name}: ${shippedCard.filter((l) => readerOf(l) === name).length}`);
console.log(`  card statements: ${stmts(shippedCard)}, want 5 x ${members.length} = ${5 * members.length}`);
console.log(describe("batched card read, three SELECTs (the candidate)", batchedLines));
console.log(describe("tie diagnostic, one SELECT (not the candidate)", tieLines));
console.log(
  `a band built on the candidate: ${stmts(shippedFixed)} + ${stmts(batchedLines)} = ${stmts(shippedFixed) + stmts(batchedLines)} statements, against the shipped ${stmts(shipped)} (${stmts(shippedFixed)} + ${stmts(shippedCard)})`,
);
const runLines = log.slice(s0);
const refused = runLines.filter((l) => l.kind === "refused").length;
const errors = runLines.filter((l) => l.kind === "store-error").length;
const non200 = runLines.filter((l) => l.kind === "store" && l.status !== 200).length;
console.log(`guard, this run: ${stmts(runLines.filter((l) => l.kind === "store"))} statements passed, ${refused} refused, ${errors} store errors, ${non200} non-200`);

// ---- 6b. the guard log's claims, as gates ---------------------------------------------------------
// The counts above are printed; these make them part of the verdict. The preload logs
// each statement whitespace-collapsed, so the candidate's SQL is compared the same way.
const gates: string[] = [];
const flat = (s: string) => s.replace(/\s+/g, " ").trim();
const wantBatched = [statsSql, billsSql, cmteSql].map(flat).sort();
const gotBatched = batchedLines.flatMap((l) => l.sql ?? []).sort();
if (batchedLines.length !== 3 || batchedLines.some((l) => l.kind !== "store" || l.n !== 1) || !isDeepStrictEqual(gotBatched, wantBatched))
  gates.push(`the batched window isn't exactly the three candidate SELECTs: ${batchedLines.length} requests, ${JSON.stringify(gotBatched.map((s) => s.slice(0, 60)))}`);
if (tieLines.length !== 1 || tieLines[0]!.kind !== "store" || !isDeepStrictEqual(tieLines[0]!.sql, [flat(tieSql)]))
  gates.push(`the tie window isn't exactly the tie SELECT: ${tieLines.length} requests`);
for (const [name] of SHAPES) {
  const k = shippedCard.filter((l) => readerOf(l) === name).length;
  if (k !== members.length) gates.push(`shipped ${name}: ${k} requests, want ${members.length}`);
}
if (stmts(shippedCard) !== 5 * members.length) gates.push(`shipped card statements ${stmts(shippedCard)}, want ${5 * members.length}`);
const runStore = runLines.filter((l) => l.kind === "store" || l.kind === "store-error");
const nonSelect = runStore.flatMap((l) => l.sql ?? []).filter((s) => !/^SELECT\b/i.test(s));
if (nonSelect.length) gates.push(`${nonSelect.length} statement(s) not a SELECT: ${JSON.stringify(nonSelect.map((s) => s.slice(0, 60)))}`);
if (runStore.length !== shipped.length + batchedLines.length + tieLines.length)
  gates.push(`${runStore.length} store requests since the shipped path began, but the three windows hold ${shipped.length + batchedLines.length + tieLines.length}`);
for (const g of gates) console.log(`GATE FAIL: ${g}`);
console.log(
  `gates: ${gates.length === 0 ? "all hold" : `${gates.length} failed`} (batched window = exactly the 3 candidate SELECTs; tie window = its 1; shipped card wave = 5 readers x ${members.length}; every statement a SELECT; every store request inside a window)`,
);

process.exit(gates.length ? 2 : fail === 0 && refused === 0 && errors === 0 ? 0 : 1);
