// Stock-trade ingestion (handoff 70). Pulls FMP disclosure pages for each
// chamber, matches FMP names against `members`, and idempotently writes
// rows to `stock_trades`. Shared by `scripts/sync-trades.ts` (CLI) and
// `/api/sync` (cron) — same code path, different pagination caps.
import type { Client } from "@libsql/client";
import { getDb } from "./db";
import { type FmpTrade, fetchHouseTrades, fetchSenateTrades } from "./fmp";
import { type MatchableMember, matchMemberName } from "./matchMember";

export interface ChamberIngestResult {
  chamber: "senate" | "house";
  pagesFetched: number;
  inserted: number;
  matched: number;
  unmatchedNames: Set<string>;
  errors: string[];
}

export interface IngestTradesOptions {
  // Hard ceiling on pages per chamber. CLI uses 20 (initial backfill);
  // cron uses 3 (incremental). The page-all-seen short-circuit usually
  // stops well below this on warm runs.
  maxPagesPerChamber: number;
}

type RawRow = Record<string, unknown>;

function pickString(row: RawRow, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = row[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

// FMP returns dates in multiple shapes ("2024-03-15", "2024-03-15T00:00:00",
// occasionally "03/15/2024"). Normalize to ISO "YYYY-MM-DD" where possible;
// fall back to the raw string so we don't lose data.
function normalizeDate(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) return trimmed.slice(0, 10);
  const slash = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slash) {
    const [, mm, dd, yyyy] = slash;
    return `${yyyy}-${(mm ?? "01").padStart(2, "0")}-${(dd ?? "01").padStart(2, "0")}`;
  }
  return trimmed;
}

// FMP House feed often returns name in two fields (`firstName` + `lastName`);
// Senate feed sometimes returns a single `senator` or `representative`
// string. Prefer the structured pair when both halves are present.
function extractName(row: RawRow): string {
  const first = pickString(row, "firstName", "first_name");
  const last = pickString(row, "lastName", "last_name");
  if (first && last) return `${first} ${last}`;
  return (
    pickString(row, "representative", "senator", "name", "memberName") ?? ""
  );
}

// The handoff specifies the composite key shape: bioguide-disclosure-ticker
// -transaction-amount. We use the raw member name when no bioguide match
// landed so unmatched rows still dedupe across re-ingests.
function composeId(args: {
  matchedBioguide: string | null;
  memberNameRaw: string;
  ticker: string | null;
  transactionDate: string | null;
  disclosureDate: string | null;
  amount: string | null;
}): string {
  const memberKey =
    args.matchedBioguide ?? `unmatched:${args.memberNameRaw.toLowerCase()}`;
  const parts = [
    memberKey,
    args.disclosureDate ?? "",
    args.ticker ?? "",
    args.transactionDate ?? "",
    args.amount ?? "",
  ];
  return parts
    .map((p) => p.replace(/\|/g, "_"))
    .join("|");
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

async function ingestChamber(
  db: Client,
  members: MatchableMember[],
  chamber: "senate" | "house",
  maxPages: number,
): Promise<ChamberIngestResult> {
  const result: ChamberIngestResult = {
    chamber,
    pagesFetched: 0,
    inserted: 0,
    matched: 0,
    unmatchedNames: new Set(),
    errors: [],
  };

  const fetcher = chamber === "senate" ? fetchSenateTrades : fetchHouseTrades;
  const ingestedAt = new Date().toISOString();

  for (let page = 0; page < maxPages; page++) {
    let trades: FmpTrade[];
    try {
      trades = await fetcher({ page });
    } catch (err) {
      result.errors.push(
        err instanceof Error ? err.message : String(err),
      );
      break;
    }
    result.pagesFetched++;
    if (trades.length === 0) break;

    let pageInsertedAny = false;
    for (const trade of trades) {
      const row = trade as RawRow;
      const memberNameRaw = extractName(row);
      if (!memberNameRaw) continue;

      const ticker =
        pickString(row, "ticker", "symbol") ?? null;
      const assetDescription =
        pickString(row, "assetDescription", "asset_description") ?? null;
      const transactionType =
        pickString(row, "transactionType", "type") ?? null;
      const transactionDate = normalizeDate(
        pickString(row, "transactionDate", "transaction_date"),
      );
      const disclosureDate = normalizeDate(
        pickString(row, "disclosureDate", "disclosure_date"),
      );
      const amount = pickString(row, "amount") ?? null;
      const owner = pickString(row, "owner", "ownerType") ?? null;
      // FMP's /stable/ endpoints carry the state in `district`:
      //   Senate: "PA" (2-letter state code)
      //   House:  "VA05" (state + district number; empty for unmatched)
      // First two letters cover both. `state` is kept as a fallback for
      // any older response variant; `office` is intentionally not used
      // here — on /stable/ it's the member's full name, not a state hint.
      const districtRaw = pickString(row, "district", "state");
      const stateHint = districtRaw ? districtRaw.slice(0, 2) : null;

      const matched = matchMemberName(
        memberNameRaw,
        members,
        chamber,
        stateHint,
      );
      if (matched) result.matched++;
      else result.unmatchedNames.add(memberNameRaw);

      const id = composeId({
        matchedBioguide: matched,
        memberNameRaw,
        ticker,
        transactionDate,
        disclosureDate,
        amount,
      });

      // INSERT OR IGNORE plus a changes() check tells us whether the row
      // was actually new on this page — that's how we know to stop
      // paginating once an entire page is all-seen.
      const insertRs = await db.execute({
        sql: `INSERT OR IGNORE INTO stock_trades
                (id, bioguide_id, member_name_raw, chamber, ticker,
                 asset_description, transaction_type, transaction_date,
                 disclosure_date, amount, owner, raw_json, ingested_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          matched,
          memberNameRaw,
          chamber,
          ticker,
          assetDescription,
          transactionType,
          transactionDate,
          disclosureDate ?? "",
          amount,
          owner,
          JSON.stringify(row),
          ingestedAt,
        ],
      });
      if ((insertRs.rowsAffected ?? 0) > 0) {
        result.inserted++;
        pageInsertedAny = true;
      }
    }

    // Stop when an entire page is all-seen. Self-correcting if FMP backfills
    // late — the next sync will pick it up.
    if (!pageInsertedAny) break;
  }

  return result;
}

export async function ingestTrades(
  options: IngestTradesOptions,
): Promise<ChamberIngestResult[]> {
  const db = getDb();
  const members = await loadMembers(db);
  const results: ChamberIngestResult[] = [];
  for (const chamber of ["senate", "house"] as const) {
    const r = await ingestChamber(
      db,
      members,
      chamber,
      options.maxPagesPerChamber,
    );
    results.push(r);
  }
  return results;
}
