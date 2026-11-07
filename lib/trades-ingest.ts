// Stock-trade ingest (HO 806, rewritten whole; handoff 70 first wrote it for
// FMP's feed). Reads CapitolStockWatch's open dataset (lib/capitolstockwatch.ts,
// CC BY 4.0), places each filer on a bioguide (lib/matchMember.ts), and mirrors
// the feed's filing-date window into `stock_trades`: a new line is inserted, a
// changed one updated, and one the feed no longer carries deleted, behind a
// guard. Shared by `/api/sync` (cron) and `scripts/sync-trades.ts` (CLI, with
// --dry-run): the same code path.
import type { Client, InStatement } from "@libsql/client";
import { type CswRecord, fetchCswTrades } from "./capitolstockwatch";
import { getDb } from "./db";
import { type MatchableMember, matchMemberName } from "./matchMember";

// The 31 disclosure fields `raw_json` keeps, in this order. Each record carries
// nine more (ret_since, excess_since, ret_30d, ret_1y, window_advantage, dte,
// hasInsiderAlignment, has_insider_alignment, insiderAlignment): the dataset's
// analytics, recomputed against current prices at each rebuild. CT doesn't show
// them, and kept they would read every row as changed on every run, so they're
// dropped.
const RAW_KEYS = [
  "id",
  "source_id",
  "filer_id",
  "filer_name",
  "branch",
  "chamber",
  "party",
  "state",
  "office",
  "agency",
  "level",
  "filing_type",
  "doc_url",
  "filing_date",
  "transaction_date",
  "days_to_file",
  "is_late",
  "notification_received_over_30d",
  "owner",
  "ticker",
  "asset_name",
  "asset_type",
  "security_type",
  "transaction_type",
  "amount_range_low",
  "amount_range_high",
  "amount_range_label",
  "comment",
  "row_index",
  "expiration_date",
  "strike_price",
] as const;

export interface TradesIngestResult {
  dryRun: boolean;
  fetched: number;                    // records in the feed
  kept: number;
  skipped: Record<string, number>;    // by reason: not-congress, chamber, no-id, no-filer, no-filing-date
  duplicateIds: number;
  byChamber: { house: number; senate: number };   // kept
  window: { from: string; to: string };
  domain: number;                     // csw: rows held in the window before the run
  inserted: number;                   // or would insert, on a dry run
  updated: number;                    // or would update, on a dry run
  deleted: number;                    // or would delete, on a dry run
  deleteRefused: number;
  matched: number;                    // kept rows placed on a bioguide
  unmatchedNames: string[];           // distinct "filer_name · chamber · state"
  ownerOther: number;
}

type TradeRow = {
  id: string;
  bioguide_id: string | null;
  member_name_raw: string;
  chamber: "house" | "senate";
  ticker: string | null;
  asset_description: string | null;
  transaction_type: string | null;
  transaction_date: string | null;
  disclosure_date: string;
  amount: string | null;
  owner: string | null;
  raw_json: string;
};

// The eleven stored columns besides `id` that a feed line can change
// (`ingested_at` is set on insert only).
const COMPARED = [
  "bioguide_id",
  "member_name_raw",
  "chamber",
  "ticker",
  "asset_description",
  "transaction_type",
  "transaction_date",
  "disclosure_date",
  "amount",
  "owner",
  "raw_json",
] as const;

const YMD = /^\d{4}-\d{2}-\d{2}$/;
const BATCH = 200;
const DELETE_CHUNK = 100;

function text(v: unknown): string | null {
  if (typeof v === "string") {
    const s = v.trim();
    return s ? s : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function mapTicker(v: unknown): string | null {
  const s = text(v)?.toUpperCase() ?? null;
  return s === null || s === "--" || s === "N/A" ? null : s;
}

// The House files owner codes and the Senate words. TradeRow prints the value
// upper-cased (`ownerLabel`, which hides `self`), so mapping both to one word
// keeps the chips reading [SPOUSE], [JOINT], [DEPENDENT] as they did. Anything
// else is kept as given and counted in `ownerOther`.
const OWNER_MAP: Readonly<Record<string, string>> = {
  sp: "Spouse",
  spouse: "Spouse",
  jt: "Joint",
  joint: "Joint",
  dc: "Dependent",
  child: "Dependent",
  "dependent child": "Dependent",
  dependent: "Dependent",
  self: "Self",
};

function mapOwner(v: unknown): { owner: string | null; other: boolean } {
  const s = text(v);
  if (s === null) return { owner: null, other: false };
  const mapped = OWNER_MAP[s.toLowerCase()];
  return mapped ? { owner: mapped, other: false } : { owner: s, other: true };
}

function rawJson(rec: CswRecord): string {
  const kept: Record<string, unknown> = {};
  for (const k of RAW_KEYS) {
    if (Object.prototype.hasOwnProperty.call(rec, k)) kept[k] = rec[k];
  }
  return JSON.stringify(kept);
}

function chunk<T>(xs: readonly T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

async function loadMembers(db: Client): Promise<MatchableMember[]> {
  const rs = await db.execute(
    `SELECT bioguide_id, first_name, last_name, state, chamber FROM members`,
  );
  return rs.rows.map((r) => ({
    bioguide_id: r.bioguide_id as string,
    first_name: (r.first_name as string | null) ?? null,
    last_name: (r.last_name as string | null) ?? null,
    state: (r.state as string | null) ?? null,
    chamber: (r.chamber as string | null) ?? null,
  }));
}

// Each statement's rowsAffected, summed: the write's own read-back, so an
// INSERT OR IGNORE that met a row an overlapping run wrote first counts 0.
async function runBatches(db: Client, statements: InStatement[]): Promise<number> {
  let affected = 0;
  for (const part of chunk(statements, BATCH)) {
    const results = await db.batch(part, "write");
    for (const rs of results) affected += rs.rowsAffected ?? 0;
  }
  return affected;
}

const INSERT_SQL = `INSERT OR IGNORE INTO stock_trades
    (id, bioguide_id, member_name_raw, chamber, ticker,
     asset_description, transaction_type, transaction_date,
     disclosure_date, amount, owner, raw_json, ingested_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const UPDATE_SQL = `UPDATE stock_trades
  SET bioguide_id = ?, member_name_raw = ?, chamber = ?, ticker = ?,
      asset_description = ?, transaction_type = ?, transaction_date = ?,
      disclosure_date = ?, amount = ?, owner = ?, raw_json = ?
  WHERE id = ?`;

export async function ingestTrades(
  opts: { dryRun?: boolean } = {},
): Promise<TradesIngestResult> {
  const dryRun = opts.dryRun ?? false;
  const ingestedAt = new Date().toISOString();
  const feed = await fetchCswTrades();
  const db = getDb();
  const members = await loadMembers(db);

  // ── Kept records. A record is kept only if each check holds; a skip counts
  // under the first reason it fails.
  const skipped: Record<string, number> = {};
  const skip = (reason: string) => {
    skipped[reason] = (skipped[reason] ?? 0) + 1;
  };
  const rows = new Map<string, TradeRow>();
  const byChamber = { house: 0, senate: 0 };
  const matchCache = new Map<string, string | null>();
  const unmatched = new Set<string>();
  let duplicateIds = 0;
  let matched = 0;
  let ownerOther = 0;

  for (const item of feed) {
    const rec: CswRecord = item !== null && typeof item === "object" ? (item as CswRecord) : {};
    if (rec.branch !== "congress") { skip("not-congress"); continue; }
    const chamber = rec.chamber;
    if (chamber !== "house" && chamber !== "senate") { skip("chamber"); continue; }
    if (typeof rec.id !== "string" || rec.id.trim() === "") { skip("no-id"); continue; }
    const filer = typeof rec.filer_name === "string" ? rec.filer_name.trim() : "";
    if (!filer) { skip("no-filer"); continue; }
    const filingDate = typeof rec.filing_date === "string" ? rec.filing_date : "";
    if (!YMD.test(filingDate)) { skip("no-filing-date"); continue; }

    const id = `csw:${rec.id}`;
    if (rows.has(id)) { duplicateIds++; continue; }

    const state = text(rec.state);
    const cacheKey = `${chamber}|${state ?? ""}|${filer}`;
    let bioguide = matchCache.get(cacheKey);
    if (bioguide === undefined) {
      bioguide = matchMemberName(filer, members, chamber, state);
      matchCache.set(cacheKey, bioguide);
    }
    if (bioguide) matched++;
    else unmatched.add(`${filer} · ${chamber} · ${state ?? ""}`);

    const { owner, other } = mapOwner(rec.owner);
    if (other) ownerOther++;
    const txDate =
      typeof rec.transaction_date === "string" && YMD.test(rec.transaction_date)
        ? rec.transaction_date
        : null;

    rows.set(id, {
      id,
      bioguide_id: bioguide,
      member_name_raw: filer,
      chamber,
      ticker: mapTicker(rec.ticker),
      asset_description: text(rec.asset_name),
      transaction_type: text(rec.transaction_type),
      transaction_date: txDate,
      disclosure_date: filingDate,
      amount: text(rec.amount_range_label),
      owner,
      raw_json: rawJson(rec),
    });
    byChamber[chamber]++;
  }

  const kept = [...rows.values()];
  if (kept.length === 0) {
    throw new Error(`CSW feed kept 0 of ${feed.length} records`);
  }

  // ── The mirror. The sync owns the `csw:` rows in the feed's filing-date
  // window, and nothing else. FMP's rows (HO 70 to HO 805) carry no prefix, so
  // they can never read as vanished; HO 806's FF deletes them by their own
  // shape (a `|` in the id). A future source keeps its own prefix. And at the
  // year's turn the window moves with the feed, a year of filings, so the old
  // year's rows stay. A feed that drops more than max(25, 5%) of the window's
  // rows reads as broken: nothing is deleted and `deleteRefused` carries the
  // count.
  let from = kept[0]!.disclosure_date;
  let to = from;
  for (const r of kept) {
    if (r.disclosure_date < from) from = r.disclosure_date;
    if (r.disclosure_date > to) to = r.disclosure_date;
  }

  const domainRs = await db.execute({
    sql: `SELECT id, ${COMPARED.join(", ")} FROM stock_trades
          WHERE id LIKE 'csw:%' AND disclosure_date >= ? AND disclosure_date <= ?`,
    args: [from, to],
  });
  const domain = new Map<string, Record<string, unknown>>();
  for (const r of domainRs.rows) {
    domain.set(String(r.id), r as unknown as Record<string, unknown>);
  }

  const norm = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const inserts: TradeRow[] = [];
  const updates: TradeRow[] = [];
  for (const r of kept) {
    const have = domain.get(r.id);
    if (!have) inserts.push(r);
    else if (COMPARED.some((c) => norm(have[c]) !== norm(r[c]))) updates.push(r);
  }
  const vanished = [...domain.keys()].filter((id) => !rows.has(id));
  const deleteLimit = Math.max(25, Math.ceil(domain.size * 0.05));
  const deletable = vanished.length <= deleteLimit;

  let inserted = inserts.length;
  let updated = updates.length;
  let deleted = deletable ? vanished.length : 0;
  if (!dryRun) {
    inserted = await runBatches(
      db,
      inserts.map((r) => ({
        sql: INSERT_SQL,
        args: [
          r.id, r.bioguide_id, r.member_name_raw, r.chamber, r.ticker,
          r.asset_description, r.transaction_type, r.transaction_date,
          r.disclosure_date, r.amount, r.owner, r.raw_json, ingestedAt,
        ],
      })),
    );
    updated = await runBatches(
      db,
      updates.map((r) => ({
        sql: UPDATE_SQL,
        args: [
          r.bioguide_id, r.member_name_raw, r.chamber, r.ticker,
          r.asset_description, r.transaction_type, r.transaction_date,
          r.disclosure_date, r.amount, r.owner, r.raw_json, r.id,
        ],
      })),
    );
    deleted = deletable
      ? await runBatches(
          db,
          chunk(vanished, DELETE_CHUNK).map((ids) => ({
            sql: `DELETE FROM stock_trades WHERE id IN (${ids.map(() => "?").join(", ")})`,
            args: ids,
          })),
        )
      : 0;
  }

  return {
    dryRun,
    fetched: feed.length,
    kept: kept.length,
    skipped,
    duplicateIds,
    byChamber,
    window: { from, to },
    domain: domain.size,
    inserted,
    updated,
    deleted,
    deleteRefused: deletable ? 0 : vanished.length,
    matched,
    unmatchedNames: [...unmatched].sort(),
    ownerOther,
  };
}
