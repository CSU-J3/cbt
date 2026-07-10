// HO 437 — /lobbying surface rollup (issue-code-first). PRECOMPUTES the ENTIRE
// surface aggregate — top-line stats, the issue-bars, AND the per-issue drill
// (top clients/firms + recent filings) — into one dashboard_state blob, because
// request-time aggregation over the LDA tables is NOT viable on this Turso: SQL
// GROUP BY / JOINs row-fetch 100k-233k rows and run 30s to >200s COLD (the HO 340
// USING-INDEX-not-COVERING trap; even a bounded per-code drill LIMIT 10 is >25s
// for the biggest codes — measured HO 437). Both request-time AND per-code-live
// were ruled out.
//
// The trick that DOES work: this DB is slow at random row-fetches but fine at
// SEQUENTIAL scans (full reads of all three tables ≈ 96s total, HO 437), so the
// rollup reads them whole through an UNCAPPED client (below) and does the entire
// join + aggregation in JS memory. getLobbyingRollup() then serves stats + bars +
// drill O(1) from the blob. Only the corpus-wide recent-filings FEED stays live
// (getRecentFilings — a clean idx_lda_filings_dt_posted walk that short-circuits
// at LIMIT). This module owns the FilingSummary hydration that live feed reuses.
import { createClient, type Client, type Row } from "@libsql/client";

export const LDA_ROLLUP_KEY = "lda_lobbying_rollup";
// HO 440 — the bill-keyed drill blob (a second dashboard_state key so the
// /lobbying 286KB read stays lean). Precomputes only the fat-tail bills; the
// long tail of small bills is served live (getBillLobbying's fallback).
export const LDA_BILL_DRILL_KEY = "lda_bill_drill";
// Threshold confirmed by measurement (HO 440): bills with >= this many distinct
// filings are precomputed; everything below goes live at <=1 hydrate chunk. The
// probe's p99 knee is 159, so this precomputes ~the top 1% — exactly the bills a
// live query can't serve under the 10s getDb cap. One source of truth for the
// cron (what to precompute) and the doc sweep.
export const BILL_DRILL_MIN_FILINGS = 150;
// HO 442 — the corpus-wide top-firms leaderboard blob (a third dashboard_state
// key; keeps the /lobbying rollup read lean, same rationale as HO 440's bill drill).
export const LDA_TOP_FIRMS_KEY = "lda_top_firms";
// Top N lobbying shops (registrants) by distinct filings. Store == render (no
// stored-vs-shown split); bump here to widen the leaderboard.
export const TOP_FIRMS_N = 25;
const HYDRATE_CHUNK = 400; // stay well under SQLite's ~999 bound-param limit
const DRILL_TOP_N = 5;
const DRILL_RECENT_N = 8; // keeps the blob comfortably under ~250KB

export interface LobbyingStats {
  filings: number;
  activities: number;
  registrants: number;
  clients: number;
  billLinkedPct: number;
}
export interface IssueStat {
  code: string;
  display: string;
  filings: number; // distinct filings citing this code (the bar length)
  activities: number;
}
export interface FilingSummary {
  filingUuid: string;
  registrantName: string | null;
  clientName: string | null;
  dtPosted: string;
  filingType: string;
  filingPeriod: string | null;
  income: number | null;
  expenses: number | null;
  issueCodes: string[];
  billIds: string[];
}
export interface IssueDrill {
  code: string;
  display: string;
  filings: number;
  activities: number;
  distinctClients: number;
  billLinked: number; // distinct filings under this code with ≥1 resolved bill
  topClients: { name: string; filings: number }[];
  topFirms: { name: string; filings: number }[];
  recent: FilingSummary[];
}
export interface LobbyingRollup {
  generatedAt: string;
  stats: LobbyingStats;
  issues: IssueStat[];
  drill: Record<string, IssueDrill>;
}
// HO 440 — the per-bill drill. The IssueDrill shape minus the issue-code fields
// (code/display/activities): a bill IS the key, and "bill-linked" is trivially
// 100% (every filing here links this bill), so those drop out. Ranked by
// distinct filings (the HO 435 rule), same as the issue drill.
export interface BillDrill {
  billId: string;
  distinctFilings: number;
  distinctClients: number;
  topClients: { name: string; filings: number }[];
  topFirms: { name: string; filings: number }[];
  recent: FilingSummary[];
}
export interface BillDrillBlob {
  generatedAt: string;
  drill: Record<string, BillDrill>;
}

// HO 442 — one row of the corpus-wide top-firms leaderboard.
export interface TopFirm {
  name: string;                    // registrant_name (the lobbying shop)
  filings: number;                 // distinct filings (rank metric — HO 435 rule)
  clients: number;                 // distinct clients represented
  billLinked: number;              // distinct filings citing >=1 resolved tracked bill
  topIssueCode: string | null;     // their single most-cited general_issue_code
  topIssueDisplay: string | null;  // its display label
}
export interface TopFirmsBlob {
  generatedAt: string;
  totalRegistrants: number;        // for the honest "top N of M registrants" label
  firms: TopFirm[];
}

// A dedicated UNCAPPED libSQL client. getDb() injects lib/db.ts's boundedFetch
// (10s abort) into createClient — that cap is why this can't run on the request
// path, so the rollup must NOT go through it. A long AbortSignal still bounds a
// genuinely stuck request (well over the cron's 300s wall, so Vercel's SIGKILL is
// the effective ceiling, not this).
export function uncappedLdaClient(): Client {
  return createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
    fetch: ((input: RequestInfo | URL, init: RequestInit = {}) =>
      fetch(input, { ...init, signal: AbortSignal.timeout(240_000) })) as typeof fetch,
  });
}

const num = (v: unknown): number => Number(v ?? 0);
const numOrNull = (v: unknown): number | null => (v == null ? null : Number(v));
const str = (v: unknown): string => String(v ?? "");
const strOrNull = (v: unknown): string | null => (v == null ? null : String(v));

// Top-N names by distinct-filing count, name-tiebroken. Shared by the issue drill
// and the bill drill (both rank firms/clients by distinct filings — HO 435).
const topN = (m: Map<string, number>) =>
  [...m.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, DRILL_TOP_N)
    .map(([name, filings]) => ({ name, filings }));

// Hydrate a set of filing_uuids with their distinct issue codes + resolved bill
// ids, in chunked batched queries (never per-row). Used by the LIVE getRecentFilings
// feed (lib/queries.ts) — the rollup hydrates in-memory instead. getDb()'s client
// is the same @libsql/client Client type, so the FilingSummary shape is shared.
export async function hydrateFilings(
  db: Client,
  uuids: string[],
): Promise<{ codes: Map<string, string[]>; bills: Map<string, string[]> }> {
  const codes = new Map<string, string[]>();
  const bills = new Map<string, string[]>();
  for (let i = 0; i < uuids.length; i += HYDRATE_CHUNK) {
    const chunk = uuids.slice(i, i + HYDRATE_CHUNK);
    const ph = chunk.map(() => "?").join(",");
    const [cRs, bRs] = await Promise.all([
      db.execute({
        sql: `SELECT DISTINCT filing_uuid, general_issue_code
              FROM lda_activities
              WHERE filing_uuid IN (${ph}) AND general_issue_code IS NOT NULL`,
        args: chunk,
      }),
      db.execute({
        sql: `SELECT DISTINCT filing_uuid, bill_id
              FROM lda_activity_bills WHERE filing_uuid IN (${ph})`,
        args: chunk,
      }),
    ]);
    for (const r of cRs.rows) {
      const k = str(r.filing_uuid);
      (codes.get(k) ?? codes.set(k, []).get(k)!).push(str(r.general_issue_code));
    }
    for (const r of bRs.rows) {
      const k = str(r.filing_uuid);
      (bills.get(k) ?? bills.set(k, []).get(k)!).push(str(r.bill_id));
    }
  }
  return { codes, bills };
}

export function rowToFilingSummary(
  r: Row,
  codes: Map<string, string[]>,
  bills: Map<string, string[]>,
): FilingSummary {
  const uuid = str(r.filing_uuid);
  return {
    filingUuid: uuid,
    registrantName: strOrNull(r.registrant_name),
    clientName: strOrNull(r.client_name),
    dtPosted: str(r.dt_posted),
    filingType: str(r.filing_type),
    filingPeriod: strOrNull(r.filing_period),
    income: numOrNull(r.income),
    expenses: numOrNull(r.expenses),
    issueCodes: codes.get(uuid) ?? [],
    billIds: bills.get(uuid) ?? [],
  };
}

type FilingRec = {
  registrantName: string | null;
  clientName: string | null;
  dtPosted: string;
  filingType: string;
  filingPeriod: string | null;
  income: number | null;
  expenses: number | null;
};

// The shared intermediate — every map both the issue rollup and the bill drill
// need, built from ONE sequential pass over the three tables (HO 440). The cron
// reads once and feeds both computeIssueRollup + computeBillDrill; neither runs
// a second ~96s scan.
export interface LdaTables {
  filings: Map<string, FilingRec>;
  registrantSet: Set<string>;
  clientSet: Set<string>;
  billsByUuid: Map<string, string[]>;
  linkedUuids: Set<string>;
  codesByUuid: Map<string, string[]>;
  uuidsByCode: Map<string, Set<string>>;
  displayByCode: Map<string, string>;
  activityCountByCode: Map<string, number>;
  activityRowCount: number; // every activity carries a code (stats.activities)
}

// Read all three LDA tables SEQUENTIALLY (the shape this Turso is fast at) into
// the in-memory maps. ~96s of reads. The join + aggregation is the consumers'
// trivial in-memory work.
export async function readLdaTables(db: Client): Promise<LdaTables> {
  const [fRes, aRes, bRes] = [
    await db.execute(
      `SELECT filing_uuid, registrant_name, client_name, dt_posted,
              filing_type, filing_period, income, expenses FROM lda_filings`,
    ),
    await db.execute(
      `SELECT filing_uuid, general_issue_code, general_issue_code_display
       FROM lda_activities WHERE general_issue_code IS NOT NULL`,
    ),
    await db.execute("SELECT filing_uuid, bill_id FROM lda_activity_bills"),
  ];

  // filings map + distinct registrant/client sets (stats)
  const filings = new Map<string, FilingRec>();
  const registrantSet = new Set<string>();
  const clientSet = new Set<string>();
  for (const r of fRes.rows) {
    const uuid = str(r.filing_uuid);
    const rn = strOrNull(r.registrant_name);
    const cn = strOrNull(r.client_name);
    filings.set(uuid, {
      registrantName: rn,
      clientName: cn,
      dtPosted: str(r.dt_posted),
      filingType: str(r.filing_type),
      filingPeriod: strOrNull(r.filing_period),
      income: numOrNull(r.income),
      expenses: numOrNull(r.expenses),
    });
    if (rn) registrantSet.add(rn);
    if (cn) clientSet.add(cn);
  }

  // bill links: per-uuid bill ids + the set of bill-linked filings
  const billsByUuid = new Map<string, string[]>();
  const linkedUuids = new Set<string>();
  for (const r of bRes.rows) {
    const uuid = str(r.filing_uuid);
    (billsByUuid.get(uuid) ?? billsByUuid.set(uuid, []).get(uuid)!).push(str(r.bill_id));
    linkedUuids.add(uuid);
  }

  // activities: per-uuid codes (recent hydration), per-code uuids + display + count
  const codesByUuid = new Map<string, string[]>();
  const uuidsByCode = new Map<string, Set<string>>();
  const displayByCode = new Map<string, string>();
  const activityCountByCode = new Map<string, number>();
  for (const r of aRes.rows) {
    const uuid = str(r.filing_uuid);
    const code = str(r.general_issue_code);
    (codesByUuid.get(uuid) ?? codesByUuid.set(uuid, []).get(uuid)!).push(code);
    (uuidsByCode.get(code) ?? uuidsByCode.set(code, new Set()).get(code)!).add(uuid);
    activityCountByCode.set(code, (activityCountByCode.get(code) ?? 0) + 1);
    if (!displayByCode.has(code)) displayByCode.set(code, str(r.general_issue_code_display));
  }

  return {
    filings,
    registrantSet,
    clientSet,
    billsByUuid,
    linkedUuids,
    codesByUuid,
    uuidsByCode,
    displayByCode,
    activityCountByCode,
    activityRowCount: aRes.rows.length,
  };
}

// Read + compute the issue rollup in one call — the idiom the CLI (rollup-lda.ts)
// and existing callers use. The cron uses readLdaTables + computeIssueRollup
// directly so it can also feed computeBillDrill off the same read.
export async function computeLdaRollup(
  db: Client,
  generatedAt: string,
): Promise<LobbyingRollup> {
  return computeIssueRollup(await readLdaTables(db), generatedAt);
}

// The issue-code-first aggregate (stats + issue bars + per-code drill). Byte-
// identical to the pre-HO-440 inline compute — same maps, same sorts, same order.
export function computeIssueRollup(
  tables: LdaTables,
  generatedAt: string,
): LobbyingRollup {
  const {
    filings,
    registrantSet,
    clientSet,
    billsByUuid,
    linkedUuids,
    codesByUuid,
    uuidsByCode,
    displayByCode,
    activityCountByCode,
    activityRowCount,
  } = tables;

  const stats: LobbyingStats = {
    filings: filings.size,
    activities: activityRowCount, // every activity carries a code (verified HO 437)
    registrants: registrantSet.size,
    clients: clientSet.size,
    billLinkedPct: filings.size > 0 ? (100 * linkedUuids.size) / filings.size : 0,
  };

  const issues: IssueStat[] = [...uuidsByCode.entries()]
    .map(([code, set]) => ({
      code,
      display: displayByCode.get(code) ?? code,
      filings: set.size,
      activities: activityCountByCode.get(code) ?? 0,
    }))
    .sort((a, b) => b.filings - a.filings);

  const drill: Record<string, IssueDrill> = {};
  for (const s of issues) {
    const uuids = uuidsByCode.get(s.code)!;
    const clientTally = new Map<string, number>();
    const firmTally = new Map<string, number>();
    const clientDistinct = new Set<string>();
    let billLinked = 0;
    for (const uuid of uuids) {
      const f = filings.get(uuid);
      if (!f) continue;
      if (linkedUuids.has(uuid)) billLinked++;
      if (f.clientName) {
        clientTally.set(f.clientName, (clientTally.get(f.clientName) ?? 0) + 1);
        clientDistinct.add(f.clientName);
      }
      if (f.registrantName) {
        firmTally.set(f.registrantName, (firmTally.get(f.registrantName) ?? 0) + 1);
      }
    }
    const recent: FilingSummary[] = [...uuids]
      .map((uuid) => ({ uuid, f: filings.get(uuid)! }))
      .filter((x) => x.f)
      .sort((a, b) =>
        a.f.dtPosted < b.f.dtPosted ? 1 : a.f.dtPosted > b.f.dtPosted ? -1 : a.uuid < b.uuid ? -1 : 1,
      )
      .slice(0, DRILL_RECENT_N)
      .map(({ uuid, f }) => ({
        filingUuid: uuid,
        registrantName: f.registrantName,
        clientName: f.clientName,
        dtPosted: f.dtPosted,
        filingType: f.filingType,
        filingPeriod: f.filingPeriod,
        income: f.income,
        expenses: f.expenses,
        issueCodes: codesByUuid.get(uuid) ?? [],
        billIds: billsByUuid.get(uuid) ?? [],
      }));
    drill[s.code] = {
      code: s.code,
      display: s.display,
      filings: s.filings,
      activities: s.activities,
      distinctClients: clientDistinct.size,
      billLinked,
      topClients: topN(clientTally),
      topFirms: topN(firmTally),
      recent,
    };
  }

  return { generatedAt, stats, issues, drill };
}

export async function writeLdaRollup(
  db: Client,
  rollup: LobbyingRollup,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO dashboard_state (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [LDA_ROLLUP_KEY, JSON.stringify(rollup), rollup.generatedAt],
  });
}

// HO 440 — the per-bill drill, computed from the SAME LdaTables the issue rollup
// reads (piggybacks the ~96s scan; this is pure in-memory grouping). Groups by
// bill_id deduped to distinct filing_uuid, keeps bills with >= threshold distinct
// filings (the fat tail a live query can't serve), and emits the same top-firms/
// clients + recent shape as the issue drill. The long tail below threshold is
// served live by getBillLobbying's fallback — never precomputed here.
export function computeBillDrill(
  tables: LdaTables,
  generatedAt: string,
  threshold: number = BILL_DRILL_MIN_FILINGS,
): BillDrillBlob {
  const { filings, billsByUuid, codesByUuid } = tables;

  // Invert billsByUuid → distinct filing_uuids per bill.
  const uuidsByBill = new Map<string, Set<string>>();
  for (const [uuid, billIds] of billsByUuid) {
    for (const billId of billIds) {
      (uuidsByBill.get(billId) ?? uuidsByBill.set(billId, new Set()).get(billId)!).add(uuid);
    }
  }

  const drill: Record<string, BillDrill> = {};
  for (const [billId, uuids] of uuidsByBill) {
    if (uuids.size < threshold) continue;
    const summaries: FilingSummary[] = [...uuids]
      .map((uuid) => ({ uuid, f: filings.get(uuid) }))
      .filter((x): x is { uuid: string; f: FilingRec } => !!x.f)
      .map(({ uuid, f }) => ({
        filingUuid: uuid,
        registrantName: f.registrantName,
        clientName: f.clientName,
        dtPosted: f.dtPosted,
        filingType: f.filingType,
        filingPeriod: f.filingPeriod,
        income: f.income,
        expenses: f.expenses,
        issueCodes: codesByUuid.get(uuid) ?? [],
        billIds: billsByUuid.get(uuid) ?? [],
      }));
    drill[billId] = aggregateBillDrill(billId, summaries);
  }

  return { generatedAt, drill };
}

// Shared aggregation for one bill's filings → BillDrill. The SINGLE source of the
// bill-drill shape, used by BOTH the precompute (computeBillDrill) and the live
// fallback (getBillLobbying): top firms/clients ranked by distinct filings (one
// FilingSummary = one distinct filing), plus the most-recent DRILL_RECENT_N.
export function aggregateBillDrill(
  billId: string,
  filings: FilingSummary[],
): BillDrill {
  const clientTally = new Map<string, number>();
  const firmTally = new Map<string, number>();
  const clientDistinct = new Set<string>();
  for (const f of filings) {
    if (f.clientName) {
      clientTally.set(f.clientName, (clientTally.get(f.clientName) ?? 0) + 1);
      clientDistinct.add(f.clientName);
    }
    if (f.registrantName) {
      firmTally.set(f.registrantName, (firmTally.get(f.registrantName) ?? 0) + 1);
    }
  }
  const recent = [...filings]
    .sort((a, b) =>
      a.dtPosted < b.dtPosted ? 1 : a.dtPosted > b.dtPosted ? -1 : a.filingUuid < b.filingUuid ? -1 : 1,
    )
    .slice(0, DRILL_RECENT_N);
  return {
    billId,
    distinctFilings: filings.length,
    distinctClients: clientDistinct.size,
    topClients: topN(clientTally),
    topFirms: topN(firmTally),
    recent,
  };
}

export async function writeLdaBillDrill(
  db: Client,
  blob: BillDrillBlob,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO dashboard_state (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [LDA_BILL_DRILL_KEY, JSON.stringify(blob), blob.generatedAt],
  });
}

// HO 442 — the corpus-wide top-firms leaderboard, computed from the SAME LdaTables
// the issue rollup + bill drill read (third consumer of the ~96s pass; pure
// in-memory grouping, no new scan/query). Ranks REGISTRANTS (the lobbying shops)
// by DISTINCT filings (the HO 435 rule), name-tiebroken. Per firm: distinct
// clients, bill-linked filing count, and their single most-cited issue code.
// Dollars are deliberately NOT ranked here (LD-2 income/expenses are partial +
// income-vs-expense asymmetric across registrant types; the money surface is the
// banked LD-203 work).
export function computeTopFirms(
  tables: LdaTables,
  generatedAt: string,
  n: number = TOP_FIRMS_N,
): TopFirmsBlob {
  const { filings, codesByUuid, linkedUuids, displayByCode } = tables;

  type Acc = {
    filings: number;
    clients: Set<string>;
    billLinked: number;
    codeTally: Map<string, number>;
  };
  const byFirm = new Map<string, Acc>();

  for (const [uuid, f] of filings) {
    if (!f.registrantName) continue;
    let acc = byFirm.get(f.registrantName);
    if (!acc) {
      acc = { filings: 0, clients: new Set(), billLinked: 0, codeTally: new Map() };
      byFirm.set(f.registrantName, acc);
    }
    acc.filings++;
    if (f.clientName) acc.clients.add(f.clientName);
    if (linkedUuids.has(uuid)) acc.billLinked++;
    for (const code of codesByUuid.get(uuid) ?? []) {
      acc.codeTally.set(code, (acc.codeTally.get(code) ?? 0) + 1);
    }
  }

  const firms: TopFirm[] = [...byFirm.entries()]
    .sort((a, b) => b[1].filings - a[1].filings || a[0].localeCompare(b[0]))
    .slice(0, n)
    .map(([name, acc]) => {
      // single most-cited issue code, count-desc then code-asc (deterministic)
      let topIssueCode: string | null = null;
      let best = -1;
      for (const [code, c] of acc.codeTally) {
        if (c > best || (c === best && (topIssueCode === null || code < topIssueCode))) {
          best = c;
          topIssueCode = code;
        }
      }
      return {
        name,
        filings: acc.filings,
        clients: acc.clients.size,
        billLinked: acc.billLinked,
        topIssueCode,
        topIssueDisplay: topIssueCode
          ? (displayByCode.get(topIssueCode) ?? topIssueCode)
          : null,
      };
    });

  return { generatedAt, totalRegistrants: byFirm.size, firms };
}

export async function writeLdaTopFirms(
  db: Client,
  blob: TopFirmsBlob,
): Promise<void> {
  await db.execute({
    sql: `INSERT INTO dashboard_state (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [LDA_TOP_FIRMS_KEY, JSON.stringify(blob), blob.generatedAt],
  });
}
