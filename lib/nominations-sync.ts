// Nominations data-layer sync (handoff 455). Ingests 119th-Congress PNs from
// Congress.gov /nomination into the additive `nominations` table. LIST-ONLY —
// the HO 454 probe found every core field (nominationType civ/mil, organization,
// description, latestAction) on the list item, so v1 needs no per-PN detail
// fetch (far cheaper than the amendments sync). Persists a computed `disposition`
// (100% latestAction coverage + clean vocab — the differentiator vs the
// amendments status-model NO-GO).
//
// Source facts locked by the HO 454 probe:
//  - Base https://api.congress.gov/v3, api_key param, format=json, limit 250.
//  - 1,884 PNs in the 119th; ~833 civilian / ~1,051 military (nominationType bool).
//  - COMPOSITE KEY: citation is PN{number}-{partNumber}; the base-part detail
//    endpoint returns a DIFFERENT record, so the logical key is (pn_number,
//    part_number). The list is part-specific and carries the core fields.
//  - `/nomination/{congress}` honors fromDateTime + sort=updateDate asc (probed).
//  - LIST updateDate is a bulk-refresh timestamp (clusters many rows at one time);
//    detail updateDate is the real per-record date. Resume on the LIST updateDate
//    (stored == sort key), inclusive boundary — the amendments HO 447 frontier
//    lesson. On a bulk-refresh day the inclusive re-fetch re-returns the corpus;
//    every write is an idempotent upsert on `id`, so it self-heals cheaply.
//
// DEFERRED (columns exist, NULL in v1): committee_system_code + nominee_count are
// detail-only and land with a later detail-hydration HO (which also resolves the
// part-specific-detail fetch + the civilian committee-referral re-measure).
import { getCurrentCongress } from "./congress";
import { getDb } from "./db";

const API_BASE = "https://api.congress.gov/v3";
const PAGE_SIZE = 250;
const PER_REQUEST_TIMEOUT_MS = 15_000;
const FLUSH_AT = 100;

type Db = ReturnType<typeof getDb>;
type Stmt = { sql: string; args: (string | number | null)[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface NominationListItem {
  congress: number;
  number: number;
  partNumber?: string;
  citation?: string;
  description?: string;
  organization?: string;
  nominationType?: { isCivilian?: boolean; isMilitary?: boolean };
  latestAction?: { actionDate?: string; text?: string };
  receivedDate?: string;
  updateDate?: string;
}
interface ListResponse {
  nominations?: NominationListItem[];
  pagination?: { count?: number };
}

// ---------------------------------------------------------------------------
// Disposition model (the differentiator). Deterministic, persisted at sync. The
// probe's clean 100%-coverage vocabulary maps to the confirmation pipeline
// (Received → Referred → Hearings → Reported → Calendar → Confirmed / Returned /
// Withdrawn). Terminal outcomes first, then latest-stage-wins for the pipeline.
export type NominationDisposition =
  | "confirmed"
  | "returned"
  | "withdrawn" // terminal
  | "calendar"
  | "reported"
  | "hearings"
  | "referred"
  | "received"; // in-pipeline

export function computeNominationDisposition(text: string | null): NominationDisposition {
  if (!text) return "received";
  const t = text.toLowerCase();
  // terminal first
  if (/\bconfirmed\b/.test(t)) return "confirmed";
  if (/returned to the president/.test(t)) return "returned";
  if (/\bwithdrawn\b/.test(t)) return "withdrawn";
  // in-pipeline, latest-stage-wins order
  if (/executive calendar/.test(t)) return "calendar";
  if (/ordered.*reported|reported by/.test(t)) return "reported";
  if (/hearings held/.test(t)) return "hearings";
  if (/referred to the committee/.test(t)) return "referred";
  return "received"; // "received in the senate and referred" lead / anything unmatched
}

// A `received` result on NON-null text that ISN'T a received/referred lead is a
// residual — a terminal/pipeline phrasing the map missed. Persisted column, so it
// matters; the sync counts + samples these (the coverage diagnostic is §4).
const RECEIVED_LEAD_RE = /received|referred/;
function isDispositionResidual(disp: NominationDisposition, text: string | null): boolean {
  return disp === "received" && !!text && !RECEIVED_LEAD_RE.test(text.toLowerCase());
}

// ---------------------------------------------------------------------------
async function dbRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 8): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= maxAttempts) throw e;
      console.warn(`[nominations] ${label} attempt ${attempt} failed (${(e as Error).name}), retrying`);
      await sleep(1000 * attempt);
    }
  }
}

async function fetchJson<T>(url: string, attempt = 0): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(PER_REQUEST_TIMEOUT_MS),
  });
  if (res.status === 429 && attempt < 3) {
    const wait = 2000 * (attempt + 1);
    console.warn(`[nominations] 429 throttled — sleeping ${wait}ms`);
    await sleep(wait);
    return fetchJson<T>(url, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetch ${url} -> ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function partOf(it: NominationListItem): string {
  return it.partNumber != null && String(it.partNumber).length > 0 ? String(it.partNumber) : "00";
}
function nominationId(congress: number, number: number, part: string): string {
  return `${congress}-pn${number}-${part}`;
}
function listUrl(congress: number, frontier: string, offset: number, apiKey: string): string {
  const params = new URLSearchParams({
    fromDateTime: frontier,
    sort: "updateDate asc",
    limit: String(PAGE_SIZE),
    offset: String(offset),
    format: "json",
    api_key: apiKey,
  });
  return `${API_BASE}/nomination/${congress}?${params.toString()}`;
}

// Pure: the single idempotent upsert for one list item. update_date is the LIST
// updateDate (the sweep's sort/filter key — stored == sort key keeps MAX a true
// contiguous-prefix frontier, per HO 447). committee_system_code + nominee_count
// are NULL (deferred, detail-only). disposition is computed here and persisted.
function buildNominationStatement(it: NominationListItem, congress: number, ingestedAt: string): Stmt {
  const part = partOf(it);
  const id = nominationId(it.congress ?? congress, it.number, part);
  const isMilitary = it.nominationType?.isMilitary === true ? 1 : 0;
  const actionText = it.latestAction?.text ?? null;
  const disposition = computeNominationDisposition(actionText);
  return {
    sql: `INSERT INTO nominations
      (id, congress, pn_number, part_number, citation, is_military, organization, description,
       disposition, latest_action_text, latest_action_date, received_date,
       committee_system_code, nominee_count, update_date, raw_json, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        congress = excluded.congress, pn_number = excluded.pn_number, part_number = excluded.part_number,
        citation = excluded.citation, is_military = excluded.is_military, organization = excluded.organization,
        description = excluded.description, disposition = excluded.disposition,
        latest_action_text = excluded.latest_action_text, latest_action_date = excluded.latest_action_date,
        received_date = excluded.received_date, update_date = excluded.update_date,
        raw_json = excluded.raw_json, ingested_at = excluded.ingested_at`,
    args: [
      id,
      it.congress ?? congress,
      Number(it.number ?? 0),
      part,
      it.citation ?? `PN${it.number}-${part}`,
      isMilitary,
      it.organization ?? null,
      it.description ?? null,
      disposition,
      actionText,
      it.latestAction?.actionDate ?? null,
      it.receivedDate ?? null,
      null, // committee_system_code — deferred
      null, // nominee_count — deferred
      it.updateDate ?? ingestedAt,
      JSON.stringify(it),
      ingestedAt,
    ],
  };
}

export interface NominationsSyncResult {
  mode: "backfill" | "incremental";
  upserted: number;
  listPages: number;
  throttled429: number;
  deadlineHit: boolean;
  dispositionResidual: number;
  frontier: string;
  apiTotal: number;
}

export interface SyncNominationsOptions {
  backfill?: boolean;
  deadlineMs?: number;
  pageDelayMs?: number;
  progressEveryPages?: number;
}

async function currentFrontier(db: Db, floor: string): Promise<string> {
  const rs = await dbRetry("frontier", () => db.execute("SELECT MAX(update_date) AS mx FROM nominations"));
  return (rs.rows[0]?.mx as string | null) ?? floor;
}

export async function syncNominations(opts: SyncNominationsOptions = {}): Promise<NominationsSyncResult> {
  const { backfill = false, deadlineMs, pageDelayMs = 150, progressEveryPages = 5 } = opts;
  const db = getDb();
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");
  const congress = getCurrentCongress();
  const floor = `${2025 + (congress - 119) * 2}-01-03T00:00:00Z`;
  const frontier = await currentFrontier(db, floor);
  const ingestedAt = new Date().toISOString();

  let upserted = 0;
  let listPages = 0;
  let throttled429 = 0;
  let deadlineHit = false;
  let dispositionResidual = 0;
  let apiTotal = -1;
  const residualSamples: string[] = [];

  const pending: Stmt[] = [];
  const flush = async () => {
    if (!pending.length) return;
    const chunk = pending.splice(0);
    await dbRetry("flush", () => db.batch(chunk, "write"));
  };

  console.log(`[nominations] mode=${backfill ? "backfill" : "incremental"} frontier=${frontier}`);

  let offset = 0;
  for (;;) {
    if (deadlineMs && Date.now() >= deadlineMs) {
      deadlineHit = true;
      break;
    }
    let page: ListResponse;
    try {
      page = await fetchJson<ListResponse>(listUrl(congress, frontier, offset, apiKey));
    } catch (e) {
      if ((e as Error).message.includes("429")) throttled429++;
      await flush();
      throw e;
    }
    listPages++;
    if (apiTotal < 0) apiTotal = page.pagination?.count ?? 0;
    const items = page.nominations ?? [];
    if (!items.length) break;

    for (const it of items) {
      const actionText = it.latestAction?.text ?? null;
      const disp = computeNominationDisposition(actionText);
      if (isDispositionResidual(disp, actionText)) {
        dispositionResidual++;
        if (residualSamples.length < 5 && actionText) residualSamples.push(actionText.slice(0, 120));
      }
      pending.push(buildNominationStatement(it, congress, ingestedAt));
      upserted++;
      if (pending.length >= FLUSH_AT) await flush();
    }
    await flush(); // durable at page boundary

    if (listPages % progressEveryPages === 0) {
      console.log(`[nominations]   page ${listPages} (offset ${offset}): +${upserted} upserted (api total=${apiTotal})`);
    }
    offset += items.length;
    if (items.length < PAGE_SIZE) break; // last page
    await sleep(pageDelayMs);
  }
  await flush();

  if (dispositionResidual > 0) {
    console.warn(`[nominations] disposition residual: ${dispositionResidual} rows fell to "received" on non-lead text — sample:`);
    for (const s of residualSamples) console.warn(`    ${s}`);
  }

  return {
    mode: backfill ? "backfill" : "incremental",
    upserted,
    listPages,
    throttled429,
    deadlineHit,
    dispositionResidual,
    frontier,
    apiTotal,
  };
}

export interface RepairResult {
  liveCount: number;
  storedBefore: number;
  storedAfter: number;
  repaired: number;
  passes: number;
  complete: boolean;
}

// Close the holes the frontier-sweep backfill can't. Like amendments, the list
// paginates by `sort=updateDate asc` with no stable tiebreaker, and the bulk-
// refresh clustering (many rows share one updateDate) means offset windows can
// skip across tie-group boundaries. UNLIKE amendments, the list carries every
// column, so repair upserts the missing ids DIRECTLY from the enumerated item —
// no detail fetch. Enumeration is itself lossy (tie-order drift), so it loops:
// gate is stored == live pagination.count, until that holds, a pass makes no
// progress, or maxPasses.
export async function repairNominations(opts: { maxPasses?: number } = {}): Promise<RepairResult> {
  const { maxPasses = 8 } = opts;
  const db = getDb();
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");
  const congress = getCurrentCongress();
  const ingestedAt = new Date().toISOString();

  const countUrl = `${API_BASE}/nomination/${congress}?${new URLSearchParams({ limit: "1", format: "json", api_key: apiKey })}`;
  const liveCount = (await fetchJson<ListResponse>(countUrl)).pagination?.count ?? -1;
  const countStored = async () =>
    Number((await dbRetry("repair-count", () => db.execute("SELECT COUNT(*) AS n FROM nominations"))).rows[0]?.n ?? 0);
  const storedBefore = await countStored();

  let repaired = 0;
  let passes = 0;
  for (let pass = 1; pass <= maxPasses; pass++) {
    passes = pass;
    if ((await countStored()) >= liveCount) break; // complete

    // Enumerate the full list (offset walk, no fromDateTime) -> id -> item.
    const byId = new Map<string, NominationListItem>();
    let offset = 0;
    for (;;) {
      const url = `${API_BASE}/nomination/${congress}?${new URLSearchParams({
        sort: "updateDate asc",
        limit: String(PAGE_SIZE),
        offset: String(offset),
        format: "json",
        api_key: apiKey,
      })}`;
      const page = await fetchJson<ListResponse>(url);
      const items = page.nominations ?? [];
      if (!items.length) break;
      for (const it of items) byId.set(nominationId(it.congress ?? congress, it.number, partOf(it)), it);
      offset += items.length;
      if (items.length < PAGE_SIZE) break;
      await sleep(120);
    }

    const rs = await dbRetry("repair-stored", () => db.execute("SELECT id FROM nominations"));
    const stored = new Set(rs.rows.map((r) => r.id as string));
    const missing = [...byId.keys()].filter((id) => !stored.has(id));
    console.log(`[nominations] repair pass ${pass}: enumerated ${byId.size}, ${missing.length} missing`);
    if (!missing.length) continue; // lossy enumeration this pass; try again

    const pending: Stmt[] = [];
    let repairedThisPass = 0;
    for (const id of missing) {
      const it = byId.get(id)!;
      pending.push(buildNominationStatement(it, congress, ingestedAt));
      repaired++;
      repairedThisPass++;
      if (pending.length >= FLUSH_AT) {
        const chunk = pending.splice(0);
        await dbRetry("repair-flush", () => db.batch(chunk, "write"));
      }
    }
    if (pending.length) {
      const chunk = pending.splice(0);
      await dbRetry("repair-flush", () => db.batch(chunk, "write"));
    }
    if (repairedThisPass === 0) break;
  }

  const storedAfter = await countStored();
  return { liveCount, storedBefore, storedAfter, repaired, passes, complete: storedAfter >= liveCount };
}
