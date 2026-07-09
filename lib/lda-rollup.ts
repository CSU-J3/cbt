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

// Read all three LDA tables SEQUENTIALLY (the shape this Turso is fast at) and do
// the whole join + aggregation in JS. ~96s of reads + trivial in-memory work.
export async function computeLdaRollup(
  db: Client,
  generatedAt: string,
): Promise<LobbyingRollup> {
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

  const stats: LobbyingStats = {
    filings: filings.size,
    activities: aRes.rows.length, // every activity carries a code (verified HO 437)
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

  const topN = (m: Map<string, number>) =>
    [...m.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, DRILL_TOP_N)
      .map(([name, filings]) => ({ name, filings }));

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
