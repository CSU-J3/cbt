// HO 835 § 1.D, C1's read-only proof: batch the race pool.
//
// What it proves. getMostCompetitiveRaces (lib/queries.ts:2930-3006) reads its pool's
// ids (:2933-2946), then two statements per id in a serial loop (:2949-2974): 1 + 2N
// statements in 1 + N round trips. This script builds the same result from the same
// first read plus ONE batched read of the pool's ratings (race_id IN (…)) and ONE
// batched read of its races and incumbents (r.id IN (…)), the two run together, and
// assembles it in the first read's order with the shipped code's logic. It then calls
// the shipped getMostCompetitiveRaces(2026, 30) and (2026, 12), uncached (the next/cache
// stub makes unstable_cache return the function itself), and deep-equals each against
// the batched result for the same arguments (node:util isDeepStrictEqual, and the JSON
// texts, which also hold the key order isDeepStrictEqual ignores): PASS or FAIL per
// call, and on FAIL every differing path with both values. A PASS also needs a
// non-empty result and the comparator's four controls (controls() below) on their
// expectations. From the guard's log it prints each path's store requests, statements
// and serial waves, and the batched path's statements in full.
//
// The trap it reads (step0-835-c5.md § 6, trap 1): the shipped ratings read orders by
// `updated_at DESC` with no tiebreak. The batched read orders by `race_id, updated_at
// DESC`, so each race's rows reach the sort in the same input order as the shipped
// per-race read (idx_ratings_race, then rowid). SQL doesn't promise how ties come out,
// so the script counts the ties in the pool and reports whether they came out in rowid
// order; a PASS shows the order matched on today's rows, not that it always will.
//
// Skeptic's changes (HO 835): the batched reads carry no diagnostic column, so the
// deep-equal proves the text HO 836 would ship, less the `rowid` tiebreak the probe adds
// to the ratings order (the census shows tied rows come out in rowid order on today's
// rows, so that tiebreak changes nothing today). The rowid and
// r.incumbent_bioguide_id the census needs come from two census reads sent after the
// batched path and counted outside both paths (takeCensus), and the script checks the
// census ratings read returns the proven read's rows in the same order.
//
// Read-only. Every store request goes through home-cold-plan-835-preload.cjs (HO 824's
// rules: each statement a read, read-only batches only, executeMultiple refused; it
// refuses before sending and logs). The script sends only SELECTs (db.execute) and the
// shipped reader's own SELECTs. It writes nothing but stdout. A refusal throws out of
// db.execute and ends the run at exit 1, before the exit-2 check below can run, so
// the guard log's grep is the check that counts. Run it only as:
//
//   cd C:/Users/meh/Desktop/CBT && set -a && . ./.env && set +a && \
//     HOME_PROBE_LOG=C:/Users/meh/Desktop/CBT/docs/handoffs/835-artifacts/proof-c1-guard.jsonl \
//     node --require ./scripts/diagnostic/home-cold-plan-835-preload.cjs --import tsx \
//       --import ./scripts/diagnostic/next-cache-stub-754.mjs \
//       scripts/diagnostic/race-pool-batch-835.ts \
//     > C:/Users/meh/Desktop/CBT/docs/handoffs/835-artifacts/proof-c1.log 2>&1; echo exit $?
//
// then: grep -c '"kind":"refused"' on the guard log must read 0.
// Exit: 0 both PASS, 3 a FAIL, 2 the guard refused a request (or isn't loaded).
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { getDb } from "@/lib/db";
import {
  getMostCompetitiveRaces,
  normalizePartyVariant,
  RATING_SOURCES,
  type CompetitiveRace,
  type RaceRating,
  type RatingSource,
} from "@/lib/queries";

const LOG = process.env.HOME_PROBE_LOG ?? "";
if (!LOG) {
  console.error("refused: HOME_PROBE_LOG is not set, so the read-only guard isn't loaded");
  process.exit(2);
}
type LogLine = { kind: string; t: string; pid?: number; n?: number; ms?: number; sql?: string[]; status?: number };
const logLines = (): LogLine[] =>
  readFileSync(LOG, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as LogLine);
// The log is appended to across runs: only this process's preload line, written since
// it started, counts (HO 835's review).
const startedAt = Date.now() - process.uptime() * 1000 - 1000;
if (!logLines().some((l) => l.kind === "preload" && l.pid === process.pid && Date.parse(l.t) >= startedAt)) {
  console.error(`refused: the guard's log has no preload line for this process (pid ${process.pid}), so the guard isn't loaded`);
  process.exit(2);
}

// ---- copied verbatim from lib/queries.ts:2400 and :2414-2428 (not exported) -------------
const RATING_SOURCES_SET = new Set<string>(RATING_SOURCES);

function rowToRaceRating(r: Record<string, unknown>): RaceRating | null {
  const source = r.source as string;
  if (!RATING_SOURCES_SET.has(source)) return null;
  return {
    id: r.id as string,
    raceId: r.race_id as string,
    source: source as RatingSource,
    rating: r.rating as string,
    ratingScore: Number(r.rating_score),
    ratingDate: (r.rating_date as string | null) ?? null,
    sourceUrl: (r.source_url as string | null) ?? null,
    cycle: Number(r.cycle),
    updatedAt: r.updated_at as string,
  };
}
// ------------------------------------------------------------------------------------------

// The pool's first read, as shipped (lib/queries.ts:2934-2944), text unchanged.
const FIRST_READ_SQL = `WITH race_summary AS (
              SELECT race_id,
                     MIN(ABS(rating_score)) AS competitiveness,
                     MAX(updated_at) AS latest_updated_at
              FROM race_ratings
              WHERE cycle = ?
              GROUP BY race_id
            )
            SELECT race_id FROM race_summary
            ORDER BY competitiveness ASC, latest_updated_at DESC
            LIMIT ?`;

// The batched ratings read, as HO 836 would ship it less its `rowid` tiebreak: the shipped per-race read's
// columns (:2956-2960), WHERE over the pool's ids, no cycle filter (trap 3), ordered
// race_id first so each race's rows sort among themselves as the per-race read sorts
// them. No diagnostic column: the deep-equal proves this text, not a variant of it.
const inList = (n: number) => Array(n).fill("?").join(", ");
const ratingsSql = (n: number) => `SELECT id, race_id, source, rating, rating_score, rating_date,
          source_url, cycle, updated_at
        FROM race_ratings
        WHERE race_id IN (${inList(n)})
        ORDER BY race_id, updated_at DESC`;

// The batched race + incumbent read, exactly as HO 836 would ship it: the shipped columns
// (:2964-2971) plus r.id to key the rows. races.id and members.bioguide_id are both
// primary keys, so it's at most one row per id, as the shipped LIMIT 1 reads.
const racesSql = (n: number) => `SELECT r.id AS race_id, r.chamber, m.name AS incumbent_name,
          m.party AS incumbent_party,
          m.bioguide_id AS incumbent_bioguide_id
        FROM races r
        LEFT JOIN members m
          ON m.bioguide_id = r.incumbent_bioguide_id
        WHERE r.id IN (${inList(n)})`;

// The census reads, diagnostic only, sent after the batched path and counted outside
// both paths. The ratings one is the batched ratings read plus `rowid AS rr_rowid` (the
// tie census); the script checks it returns the rows in the same order as the read
// above, so the census speaks for the proven text. The races one carries
// r.incumbent_bioguide_id beside m.bioguide_id (trap 5).
const ratingsCensusSql = (n: number) => `SELECT id, race_id, source, rating, rating_score, rating_date,
          source_url, cycle, updated_at, rowid AS rr_rowid
        FROM race_ratings
        WHERE race_id IN (${inList(n)})
        ORDER BY race_id, updated_at DESC`;
const racesCensusSql = (n: number) => `SELECT r.id AS race_id, r.incumbent_bioguide_id AS race_incumbent_bioguide_id,
          m.bioguide_id AS incumbent_bioguide_id
        FROM races r
        LEFT JOIN members m
          ON m.bioguide_id = r.incumbent_bioguide_id
        WHERE r.id IN (${inList(n)})`;

type Row = Record<string, unknown>;
type Census = {
  ids: number;
  skipped: string[];
  noRaceRow: string[];
  unrecognisedRows: number;
  otherCycleRows: number;
  memberMissing: string[];
  tieRaces: string[];
  tieGroupsNotRowidAsc: string[];
  censusOrderSame: boolean;
  censusRows: number;
};
type Batched = { out: CompetitiveRace[]; ids: string[]; ratingsRows: Row[]; racesRows: Row[]; skipped: string[] };

async function batched(cycle: number, limit: number): Promise<Batched> {
  const db = getDb();
  const rs = await db.execute({ sql: FIRST_READ_SQL, args: [cycle, limit] });
  const ids = rs.rows.map((row) => row.race_id as string);
  if (ids.length === 0) return { out: [], ids, ratingsRows: [], racesRows: [], skipped: [] };

  const [ratingsRs, racesRs] = await Promise.all([
    db.execute({ sql: ratingsSql(ids.length), args: ids }),
    db.execute({ sql: racesSql(ids.length), args: ids }),
  ]);
  const ratingsRows = ratingsRs.rows as unknown as Row[];
  const racesRows = racesRs.rows as unknown as Row[];

  // Group the ratings by race, keeping the SQL order within each race.
  const ratingsByRace = new Map<string, Row[]>();
  for (const r of ratingsRows) {
    const k = r.race_id as string;
    const list = ratingsByRace.get(k);
    if (list) list.push(r);
    else ratingsByRace.set(k, [r]);
  }
  const metaByRace = new Map<string, Row>();
  for (const r of racesRows) {
    const k = r.race_id as string;
    if (!metaByRace.has(k)) metaByRace.set(k, r);
  }

  // Assemble in the first read's order. The body is lib/queries.ts:2975-3000's logic,
  // verbatim but for where `detail.rows` and `raceRow.rows[0]` come from.
  const out: CompetitiveRace[] = [];
  const skipped: string[] = [];
  for (const raceId of ids) {
    const detailRows = ratingsByRace.get(raceId) ?? [];
    const ratings = detailRows
      .map((r) => rowToRaceRating(r as Record<string, unknown>))
      .filter((x): x is RaceRating => x !== null);
    const first = ratings[0];
    if (!first) {
      skipped.push(raceId);
      continue;
    }
    const competitivenessScore = ratings.reduce(
      (best, r) =>
        Math.abs(r.ratingScore) < Math.abs(best) ? r.ratingScore : best,
      first.ratingScore,
    );
    const meta = metaByRace.get(raceId);
    const chamberRaw = (meta?.chamber as string | undefined) ?? null;
    const chamber =
      chamberRaw === "house" || chamberRaw === "senate" ? chamberRaw : null;
    out.push({
      raceId,
      ratings,
      competitivenessScore,
      chamber,
      incumbentName: (meta?.incumbent_name as string | null) ?? null,
      incumbentParty: normalizePartyVariant(
        (meta?.incumbent_party as string | null) ?? null,
      ),
      incumbentBioguideId:
        (meta?.incumbent_bioguide_id as string | null) ?? null,
    });
  }
  return { out, ids, ratingsRows, racesRows, skipped };
}

// The census: what the batched path's rows hold, plus two diagnostic reads (rowid for
// the tie census, r.incumbent_bioguide_id for trap 5). Ties are read in the batched
// ratings read's own order (the proven text), with each row's rowid looked up by id.
async function takeCensus(cycle: number, b: Batched): Promise<Census> {
  const census: Census = { ids: b.ids.length, skipped: b.skipped, noRaceRow: [], unrecognisedRows: 0, otherCycleRows: 0, memberMissing: [], tieRaces: [], tieGroupsNotRowidAsc: [], censusOrderSame: true, censusRows: 0 };
  if (b.ids.length === 0) return census;
  for (const r of b.ratingsRows) {
    if (!RATING_SOURCES_SET.has(r.source as string)) census.unrecognisedRows++;
    if (Number(r.cycle) !== cycle) census.otherCycleRows++;
  }
  const raceIdsWithRow = new Set(b.racesRows.map((r) => r.race_id as string));
  for (const id of b.ids) if (!raceIdsWithRow.has(id)) census.noRaceRow.push(id);

  const db = getDb();
  const [ratingsC, racesC] = await Promise.all([
    db.execute({ sql: ratingsCensusSql(b.ids.length), args: b.ids }),
    db.execute({ sql: racesCensusSql(b.ids.length), args: b.ids }),
  ]);
  const cRows = ratingsC.rows as unknown as Row[];
  census.censusRows = cRows.length;
  const seqProven = b.ratingsRows.map((r) => String(r.id)).join("\n");
  const seqCensus = cRows.map((r) => String(r.id)).join("\n");
  census.censusOrderSame = seqProven === seqCensus;
  const rowidOf = new Map(cRows.map((r) => [String(r.id), Number(r.rr_rowid)]));
  for (const r of racesC.rows as unknown as Row[]) {
    if (r.race_incumbent_bioguide_id != null && r.incumbent_bioguide_id == null) census.memberMissing.push(String(r.race_id));
  }

  const byRace = new Map<string, Row[]>();
  for (const r of b.ratingsRows) byRace.set(r.race_id as string, [...(byRace.get(r.race_id as string) ?? []), r]);
  for (const raceId of b.ids) {
    const byUpdated = new Map<string, Row[]>();
    for (const r of byRace.get(raceId) ?? []) {
      const k = String(r.updated_at);
      byUpdated.set(k, [...(byUpdated.get(k) ?? []), r]);
    }
    const ties = [...byUpdated.values()].filter((g) => g.length > 1);
    if (ties.length) census.tieRaces.push(`${raceId} (${ties.map((g) => g.length).join("+")} rows tied)`);
    for (const g of ties) {
      const rowids = g.map((r) => rowidOf.get(String(r.id)) ?? NaN);
      if (!rowids.every((v, i) => i === 0 || rowids[i - 1]! < v)) census.tieGroupsNotRowidAsc.push(`${raceId} @ ${String(g[0]!.updated_at)}: rowids ${rowids.join(",")}`);
    }
  }
  return census;
}

// The comparator's controls (skeptic, HO 835): isDeepStrictEqual compares array order and
// every own key both ways, but not the order of an object's keys, so the proof also
// compares the JSON texts (every value is a string, a number or null, so the text is
// faithful). Four plants on a structuredClone of the batched result, each against the
// shipped one: the clone unplanted must match both ways; two tied ratings swapped (trap
// 1's exact shape; the first two ratings of a race if no tie exists) must fail both;
// one rating's keys reversed must pass isDeepStrictEqual and fail the JSON compare; one
// leaf changed must fail both. A control off its expectation fails the proof.
const compareBoth = (a: unknown, b: unknown) => ({ deep: isDeepStrictEqual(a, b), json: JSON.stringify(a) === JSON.stringify(b) });
function controls(shipped: CompetitiveRace[], batch: CompetitiveRace[]): { lines: string[]; failed: number } {
  const lines: string[] = [];
  let failed = 0;
  const check = (name: string, got: { deep: boolean; json: boolean }, want: { deep: boolean; json: boolean }) => {
    const ok = got.deep === want.deep && got.json === want.json;
    if (!ok) failed++;
    lines.push(`  control ${ok ? "ok" : "OFF"}: ${name}: isDeepStrictEqual ${got.deep} (want ${want.deep}), JSON ${got.json} (want ${want.json})`);
  };
  if (batch.length === 0) {
    lines.push("  control OFF: the batched result is empty, so no plant can be made");
    return { lines, failed: 1 };
  }
  const clone = () => structuredClone(batch) as CompetitiveRace[];
  check("the unplanted clone", compareBoth(shipped, clone()), { deep: true, json: true });

  const swap = clone();
  let at: { race: CompetitiveRace; j: number; tied: boolean } | null = null;
  for (const race of swap) {
    const rs = race.ratings;
    const j = rs.findIndex((r, k) => k + 1 < rs.length && r.updatedAt === rs[k + 1]!.updatedAt);
    if (j >= 0) {
      at = { race, j, tied: true };
      break;
    }
  }
  if (!at) {
    const race = swap.find((r) => r.ratings.length >= 2);
    if (race) at = { race, j: 0, tied: false };
  }
  if (at) {
    const rs = at.race.ratings;
    const a = rs[at.j]!;
    rs[at.j] = rs[at.j + 1]!;
    rs[at.j + 1] = a;
    check(`${at.tied ? "two tied" : "two (no tie in the pool)"} ratings swapped in ${at.race.raceId} at ${at.j},${at.j + 1}`, compareBoth(shipped, swap), { deep: false, json: false });
  } else {
    failed++;
    lines.push("  control OFF: no race has two ratings, so the swap plant can't be made");
  }

  const keys = clone();
  const k0 = keys[0]!;
  const r0 = k0.ratings[0];
  if (r0) {
    k0.ratings[0] = Object.fromEntries(Object.entries(r0).reverse()) as RaceRating;
    check(`${k0.raceId}'s first rating with its keys reversed`, compareBoth(shipped, keys), { deep: true, json: false });
  } else {
    failed++;
    lines.push("  control OFF: the first race has no rating, so the key-order plant can't be made");
  }

  const leaf = clone();
  const last = leaf[leaf.length - 1]!;
  const lastRating = last.ratings[last.ratings.length - 1]!;
  lastRating.updatedAt += "x";
  check(`${last.raceId}'s last rating's updatedAt changed`, compareBoth(shipped, leaf), { deep: false, json: false });
  return { lines, failed };
}

// Every path where a and b differ, with both values.
function diffPaths(a: unknown, b: unknown, p: string, out: [string, unknown, unknown][]) {
  if (isDeepStrictEqual(a, b)) return;
  const before = out.length;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) out.push([`${p}.length`, a.length, b.length]);
    for (let i = 0; i < Math.max(a.length, b.length); i++) diffPaths(a[i], b[i], `${p}[${i}]`, out);
  } else if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
    const ao = a as Record<string, unknown>;
    const bo = b as Record<string, unknown>;
    for (const k of new Set([...Object.keys(ao), ...Object.keys(bo)])) {
      if (!(k in ao)) out.push([`${p}.${k}`, "(absent)", bo[k]]);
      else if (!(k in bo)) out.push([`${p}.${k}`, ao[k], "(absent)"]);
      else diffPaths(ao[k], bo[k], `${p}.${k}`, out);
    }
  }
  if (out.length === before) out.push([p, a, b]); // a leaf, or differs by type/prototype only
}

// Store requests, statements and serial waves in the guard's log since line `from`.
// A wave is a set of requests whose starts fall within 5 ms of the wave's first start
// (step0-835-c5.md § 4's rule).
function segment(from: number) {
  const ls = logLines().slice(from);
  const store = ls.filter((l) => l.kind === "store" || l.kind === "store-error");
  const refused = ls.filter((l) => l.kind === "refused").length;
  const spans = store.map((l) => ({ t0: Date.parse(l.t), t1: Date.parse(l.t) + (l.ms ?? 0) })).sort((x, y) => x.t0 - y.t0);
  let waves = 0;
  let waveStart = -Infinity;
  for (const s of spans) {
    if (s.t0 - waveStart > 5) {
      waves++;
      waveStart = s.t0;
    }
  }
  const shapes = new Map<string, number>();
  for (const l of store) for (const s of l.sql ?? []) shapes.set(s.slice(0, 70), (shapes.get(s.slice(0, 70)) ?? 0) + 1);
  const fullSql = [...new Set(store.flatMap((l) => l.sql ?? []))];
  return {
    fullSql,
    requests: store.length,
    statements: store.reduce((s, l) => s + (l.n ?? 0), 0),
    perRequest: [...new Set(store.map((l) => l.n))],
    statuses: [...new Set(store.map((l) => l.status ?? l.kind))],
    waves,
    wallMs: spans.length ? Math.max(...spans.map((s) => s.t1)) - spans[0]!.t0 : 0,
    refused,
    shapes,
  };
}
const mark = () => logLines().length;
const mst = (ms: number) => new Date(ms - 7 * 3_600_000).toISOString().replace("T", " ").replace("Z", "") + " MST";

const t0 = Date.now();
console.log(`HO 835 C1 proof: batch the race pool — started ${mst(t0)} (${new Date(t0).toISOString()})`);
console.log(`guard log: ${LOG}`);
console.log("");

const CYCLE = 2026;
let failures = 0;
let refusedTotal = 0;
for (const limit of [30, 12]) {
  console.log(`=== getMostCompetitiveRaces(${CYCLE}, ${limit}) ===`);
  let m = mark();
  const b = await batched(CYCLE, limit);
  const batch = b.out;
  const segB = segment(m);
  m = mark();
  const census = await takeCensus(CYCLE, b);
  const segC = segment(m);
  m = mark();
  const shipped = await getMostCompetitiveRaces(CYCLE, limit);
  const segS = segment(m);
  refusedTotal += segB.refused + segC.refused + segS.refused;

  const cmp = compareBoth(shipped, batch);
  const nonEmpty = shipped.length > 0 && batch.length > 0;
  const ctl = controls(shipped, batch);
  const pass = cmp.deep && cmp.json && nonEmpty && ctl.failed === 0;
  console.log(`${pass ? "PASS" : "FAIL"}: shipped (${shipped.length} races) vs batched (${batch.length} races): isDeepStrictEqual ${cmp.deep}; JSON text equal (key order too) ${cmp.json}; non-empty ${nonEmpty}; comparator controls ${ctl.failed === 0 ? "all ok" : `${ctl.failed} OFF`}`);
  for (const l of ctl.lines) console.log(l);
  if (!pass) {
    failures++;
    const diffs: [string, unknown, unknown][] = [];
    diffPaths(shipped, batch, "result", diffs);
    console.log(`  ${diffs.length} differing path(s), shipped vs batched:`);
    for (const [p, a, b] of diffs) console.log(`  ${p}: shipped=${JSON.stringify(a)} batched=${JSON.stringify(b)}`);
    console.log(`  shipped raceIds: ${shipped.map((r) => r.raceId).join(", ")}`);
    console.log(`  batched raceIds: ${batch.map((r) => r.raceId).join(", ")}`);
  }
  console.log(`  pool: ${census.ids} ids from the first read; ${census.skipped.length} skipped (no cook/sabato/inside_elections rating)${census.skipped.length ? ": " + census.skipped.join(", ") : ""}`);
  console.log(`  no races row (chamber and incumbent null, still pushed): ${census.noRaceRow.length}${census.noRaceRow.length ? " — " + census.noRaceRow.join(", ") : ""}`);
  console.log(`  races naming an incumbent with no members row (incumbentBioguideId null, from m.bioguide_id): ${census.memberMissing.length}${census.memberMissing.length ? " — " + census.memberMissing.join(", ") : ""}`);
  console.log(`  ratings rows with an unrecognised source (dropped): ${census.unrecognisedRows}; with cycle != ${CYCLE} (kept, as shipped reads no cycle): ${census.otherCycleRows}`);
  console.log(`  updated_at ties within a race: ${census.tieRaces.length} race(s)${census.tieRaces.length ? " — " + census.tieRaces.join("; ") : ""}`);
  console.log(`  tie groups not in rowid order in the batched read: ${census.tieGroupsNotRowidAsc.length}${census.tieGroupsNotRowidAsc.length ? " — " + census.tieGroupsNotRowidAsc.join("; ") : ""}`);
  console.log(`  the census read (with rowid) returned the proven read's rows in the same order: ${census.censusOrderSame} (${census.censusRows} vs ${b.ratingsRows.length} rows)`);
  for (const [label, s] of [["shipped", segS], ["batched", segB], ["census (context, outside both paths)", segC]] as const) {
    console.log(`  ${label}: ${s.requests} store requests, ${s.statements} statements (per request: ${s.perRequest.join("/")}), ${s.waves} serial waves; status ${s.statuses.join("/")}; refused ${s.refused}; wall ${s.wallMs} ms (context only, the box against prod)`);
    for (const [shape, n] of s.shapes) console.log(`      ${String(n).padStart(3)} × ${shape}…`);
  }
  console.log("  the batched path's statements, in full (whitespace collapsed, as the guard logged them):");
  for (const s of segB.fullSql) console.log(`      ${s}`);
  console.log("");
}

// Context, outside both paths' counts: the indexes prod's store holds on the two tables
// the trap turns on, so the tie argument above rests on the store's schema, not
// scripts/migrate.ts's. One SELECT on sqlite_master.
{
  const m = mark();
  const ix = await getDb().execute({
    sql: `SELECT tbl_name, name, sql FROM sqlite_master WHERE type = 'index' AND tbl_name IN ('race_ratings', 'races') ORDER BY tbl_name, name`,
    args: [],
  });
  const s = segment(m);
  refusedTotal += s.refused;
  console.log(`=== context: indexes on race_ratings and races in prod's store (${s.requests} request, ${s.statements} statement) ===`);
  for (const r of ix.rows) console.log(`  ${String(r.tbl_name)}.${String(r.name)}: ${r.sql == null ? "(auto, primary key or unique)" : String(r.sql).replace(/\s+/g, " ")}`);
  console.log("");
}

const all = logLines();
console.log(`guard log totals: ${all.filter((l) => l.kind === "store").length} store requests, ${all.filter((l) => l.kind === "store-error").length} store errors, ${all.filter((l) => l.kind === "refused").length} refused`);
console.log(`finished ${mst(Date.now())}; ${failures === 0 ? "both deep-equals PASS" : `${failures} FAIL`}`);
process.exit(refusedTotal > 0 ? 2 : failures > 0 ? 3 : 0);
