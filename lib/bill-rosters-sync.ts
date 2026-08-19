// HO 674 — the cosponsor and related-bill rosters.
//
// Both hang off the SAME per-bill sub-endpoint shape, which is the whole reason
// this is one module and not two:
//
//   GET /bill/{congress}/{type}/{number}/cosponsors?limit=250&offset=N
//   GET /bill/{congress}/{type}/{number}/relatedbills?limit=250
//
// The bill DETAIL endpoint returns only `{count, url}` for each (lib/sync.ts:42
// types `cosponsors` that way and it is correct), so neither roster is
// recoverable from `bills.raw_json`. This module is the only writer of
// `bill_cosponsors` and `bill_related_bills`.
//
// PATTERN: this follows `lib/summarize.ts` (fetchBillText / fetchBillContext),
// which already fetches per-bill sub-endpoints the same way — base URL, then
// `?format=json&api_key=`. It does not establish a new pattern.
//
// This module performs NO writes of its own. It fetches and shapes; the caller
// writes. That keeps the read-only default of the backfill script honest —
// a fetch path that cannot write cannot write by accident.
import { getDb } from "./db";

const API_BASE = "https://api.congress.gov/v3";

// Congress.gov's max page size, matching committees-sync/meetings-sync.
const PAGE_LIMIT = 250;

export type CosponsorRow = {
  bill_id: string;
  bioguide_id: string;
  sponsorship_date: string | null;
  // NULL = active. HO 674 measured that the API returns withdrawn cosponsors
  // INSIDE the list (119-hr-452 lists 300 entries, one carrying the date),
  // while pagination.count reports 299 — see the note on activeCount below.
  sponsorship_withdrawn_date: string | null;
  is_original: 0 | 1;
};

export type RelatedBillRow = {
  bill_id: string;
  related_bill_id: string;
  relationship_type: string;
  identified_by: string | null;
};

type ApiCosponsor = {
  bioguideId?: string;
  sponsorshipDate?: string;
  sponsorshipWithdrawnDate?: string;
  isOriginalCosponsor?: boolean;
};
type CosponsorsResp = {
  cosponsors?: ApiCosponsor[];
  pagination?: {
    count?: number;
    countIncludingWithdrawnCosponsors?: number;
    next?: string;
  };
};

type ApiRelated = {
  congress?: number;
  type?: string;
  number?: number;
  relationshipDetails?: Array<{ type?: string; identifiedBy?: string }>;
};
type RelatedResp = {
  relatedBills?: ApiRelated[];
  pagination?: { count?: number };
};

async function fetchJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

/** `119-hr-842` -> `{congress: 119, type: "hr", number: 842}`. */
export function parseBillId(
  id: string,
): { congress: string; type: string; number: string } | null {
  const m = /^(\d+)-([a-z]+)-(\d+)$/.exec(id);
  if (!m || !m[1] || !m[2] || !m[3]) return null;
  return { congress: m[1], type: m[2], number: m[3] };
}

/** The canonical bill id for a related bill, matching `bills.id`. */
function relatedBillId(r: ApiRelated): string | null {
  if (r.congress == null || !r.type || r.number == null) return null;
  return `${r.congress}-${r.type.toLowerCase()}-${r.number}`;
}

export type CosponsorFetch = {
  rows: CosponsorRow[];
  /**
   * `pagination.count` — the ACTIVE cosponsor count, EXCLUDING withdrawals.
   * This is the number `bills.cosponsor_count` is sourced from (the detail
   * endpoint's `$.cosponsors.count`), so it is the only fair comparand for the
   * count cross-check. `rows.length` includes withdrawn entries and will exceed
   * it on any bill that has one.
   */
  activeCount: number | null;
  requests: number;
};

export async function fetchCosponsors(
  billId: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<CosponsorFetch> {
  const p = parseBillId(billId);
  if (!p) throw new Error(`unparseable bill id: ${billId}`);
  const base = `${API_BASE}/bill/${p.congress}/${p.type}/${p.number}/cosponsors`;
  const auth = `format=json&api_key=${encodeURIComponent(apiKey)}`;

  const rows: CosponsorRow[] = [];
  let activeCount: number | null = null;
  let requests = 0;
  let offset = 0;

  // Paged rather than single-shot: 10 corpus bills exceed one page (max 338 at
  // HO 674's measurement). Loops on the returned page size, not on the count,
  // because the count excludes withdrawals and would stop one short.
  for (;;) {
    const url = `${base}?${auth}&limit=${PAGE_LIMIT}&offset=${offset}`;
    const resp = await fetchJson<CosponsorsResp>(url, signal);
    requests++;
    if (activeCount === null) activeCount = resp.pagination?.count ?? null;

    const page = resp.cosponsors ?? [];
    for (const c of page) {
      if (!c.bioguideId) continue; // no key to store it under
      rows.push({
        bill_id: billId,
        bioguide_id: c.bioguideId,
        sponsorship_date: c.sponsorshipDate ?? null,
        sponsorship_withdrawn_date: c.sponsorshipWithdrawnDate ?? null,
        is_original: c.isOriginalCosponsor ? 1 : 0,
      });
    }
    if (page.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }
  return { rows, activeCount, requests };
}

export type RelatedFetch = {
  rows: RelatedBillRow[];
  /**
   * `pagination.count` — which counts RELATIONSHIP ENTRIES, not related bills.
   * HO 674 measured this exactly: across 40 bills the summed count (1,078)
   * equals the summed relationshipDetails entries (1,078) against 1,004 distinct
   * listed bills. `rows.length` is the relationship-entry count and SHOULD track
   * this; the number of distinct related bills is smaller.
   */
  relationshipCount: number | null;
  distinctBills: number;
  requests: number;
};

export async function fetchRelatedBills(
  billId: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<RelatedFetch> {
  const p = parseBillId(billId);
  if (!p) throw new Error(`unparseable bill id: ${billId}`);
  const base = `${API_BASE}/bill/${p.congress}/${p.type}/${p.number}/relatedbills`;
  const auth = `format=json&api_key=${encodeURIComponent(apiKey)}`;

  // Single page: the corpus maximum is 92 related bills (HO 674), well inside
  // PAGE_LIMIT. Guarded rather than assumed — if a page ever comes back full,
  // this throws instead of silently truncating a roster.
  const resp = await fetchJson<RelatedResp>(
    `${base}?${auth}&limit=${PAGE_LIMIT}`,
    signal,
  );
  const list = resp.relatedBills ?? [];
  if (list.length >= PAGE_LIMIT) {
    throw new Error(
      `${billId}: relatedbills returned a full page (${list.length}); ` +
        `pagination is unimplemented here because the measured max was 92`,
    );
  }

  const rows: RelatedBillRow[] = [];
  const seenBills = new Set<string>();
  for (const r of list) {
    const rid = relatedBillId(r);
    if (!rid) continue;
    seenBills.add(rid);
    const details = r.relationshipDetails ?? [];
    // A related bill can carry MORE THAN ONE relationship (measured). Each
    // becomes its own row — that is what the composite PK is for.
    for (const d of details) {
      if (!d.type) continue;
      rows.push({
        bill_id: billId,
        related_bill_id: rid,
        relationship_type: d.type,
        identified_by: d.identifiedBy ?? null,
      });
    }
  }
  return {
    rows,
    relationshipCount: resp.pagination?.count ?? null,
    distinctBills: seenBills.size,
    requests: 1,
  };
}

/**
 * Which bills already have a stored roster. Used to make the backfill resumable
 * WITHOUT spending a request to discover it — the skip decision is made against
 * the DB, so a resumed run costs nothing for work already done.
 */
export async function loadCoveredBillIds(
  table: "bill_cosponsors" | "bill_related_bills",
): Promise<Set<string>> {
  const db = getDb();
  const r = await db.execute(`SELECT DISTINCT bill_id FROM ${table}`);
  return new Set(r.rows.map((x) => String(x.bill_id)));
}
