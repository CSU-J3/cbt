// Amendments data-layer sync (handoff 447). Ingests 119th-Congress amendments
// from Congress.gov /amendment into the additive `amendments` table (one FK to
// bills, a self-FK for sub-amendment lineage). Surface-agnostic — lands the
// corpus + the join; no status model, no rollup (HO 447 scope).
//
// Source facts locked by the HO 446 probe:
//  - Base https://api.congress.gov/v3, api_key param, format=json, limit 250.
//  - List is THIN ({congress,type,number,updateDate,url} for SAMDT); amendedBill,
//    sponsors, purpose are DETAIL-only, so the sync fetches list → detail each.
//  - `/amendment/{congress}` honors fromDateTime + sort=updateDate asc (probed),
//    so the frontier sweep is an ascending walk from MAX(update_date).
//  - amendedBill present 100% and resolving 100% to tracked bills; ~2.5% also
//    carry amendedAmendment (sub-amendment; the API still reports the ultimate
//    amendedBill transitively). SUAMDT is 0 in the 119th.
//
// RESUMABILITY (mirrors lib/lda-sync.ts): the resume point is DERIVED FROM THE
// DB, not a stored cursor. frontier = MAX(update_date) already ingested (empty →
// the 119th convening floor). Fetch `fromDateTime=frontier&sort=updateDate asc`
// ascending, hydrate detail, upsert on `id`, flush per page. Because updateDate
// always moves forward to ~now on any action and the sweep is ascending, the
// ingested set is a contiguous ascending prefix — MAX(update_date) is the
// frontier and re-fetching `>= frontier` resumes with no interior gap. Every
// write is an idempotent upsert on `id`, so a re-touched amendment resets
// cleanly (the inclusive fromDateTime boundary re-returns the frontier day; the
// upsert absorbs it). A deadline backstop stops cleanly; the next run re-derives
// MAX(update_date) and continues.
import { getCurrentCongress } from "./congress";
import { getDb } from "./db";

const API_BASE = "https://api.congress.gov/v3";
const PAGE_SIZE = 250;
// Hard wall-clock cap per detail fetch (mirrors lib/sync.ts PER_DETAIL_TIMEOUT_MS)
// so a single hung Congress.gov call can't burn the cron tick.
const PER_DETAIL_TIMEOUT_MS = 15_000;
// Buffer statements across amendments and flush in chunks. 100 mirrors the HO 435
// LDA tuning — a ~100-stmt write transaction clears in the gaps between the
// summarize-cron's writes on the shared prod DB, where a fatter batch reliably
// blew the 10s boundedFetch cap.
const FLUSH_AT = 100;

type Db = ReturnType<typeof getDb>;
type Stmt = { sql: string; args: (string | number | null)[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface AmendedRef {
  congress?: number;
  type?: string;
  number?: string | number;
}
interface Sponsor {
  bioguideId?: string;
  fullName?: string;
}
interface AmendmentDetail {
  congress?: number;
  type?: string;
  number?: string | number;
  chamber?: string;
  amendedBill?: AmendedRef;
  amendedAmendment?: AmendedRef;
  sponsors?: Sponsor[];
  purpose?: string;
  description?: string;
  latestAction?: { actionDate?: string; text?: string };
  submittedDate?: string;
  updateDate?: string;
}
interface ListItem {
  congress: number;
  type: string;
  number: string;
  updateDate?: string;
}
interface ListResponse {
  amendments?: ListItem[];
  pagination?: { count?: number; next?: string };
}

export interface AmendmentsSyncResult {
  mode: "backfill" | "incremental";
  upserted: number;
  listPages: number;
  detailErrors: number;
  throttled429: number;
  deadlineHit: boolean;
  frontier: string;
  apiTotal: number;
}

export interface SyncAmendmentsOptions {
  // Logging/labelling only — resume behavior is identical either way (both derive
  // the frontier from the DB). `backfill` just means "no deadline".
  backfill?: boolean;
  // Cron safety backstop. When reached, stop cleanly; the next run resumes from
  // the DB frontier with no gap. Manual backfill runs uncapped.
  deadlineMs?: number;
  // Pace between list-page fetches.
  pageDelayMs?: number;
  // Pace between per-amendment detail fetches (the bulk of the ~6,800 requests).
  detailDelayMs?: number;
  // Emit a progress line every N list pages.
  progressEveryPages?: number;
}

// getDb()'s boundedFetch (lib/db.ts) caps every Turso request at 10s and retries
// ONCE on a stall. Over a ~17-min backfill (thousands of flushes) a transient
// double-timeout is likely and would abort the run. This adds a second, backed-off
// retry layer around each db call. Every op here is an idempotent upsert/read, so
// re-running is safe. maxAttempts 8 mirrors the HO 435 tuning — the shared prod DB
// has recurring ~3-min all-timeout windows (summarize cron write bursts); an
// 8-attempt layer (~28s backoff + each boundedFetch double-timeout) rides one out.
async function dbRetry<T>(label: string, fn: () => Promise<T>, maxAttempts = 8): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= maxAttempts) throw e;
      console.warn(`[amendments] ${label} attempt ${attempt} failed (${(e as Error).name}), retrying`);
      await sleep(1000 * attempt);
    }
  }
}

// 429-backoff fetch mirroring fetchJson in lib/sync.ts, plus a per-request abort
// so a hung socket can't ride to the function ceiling.
async function fetchJson<T>(url: string, attempt = 0): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(PER_DETAIL_TIMEOUT_MS),
  });
  if (res.status === 429 && attempt < 3) {
    const wait = 2000 * (attempt + 1);
    console.warn(`[amendments] 429 throttled — sleeping ${wait}ms`);
    await sleep(wait);
    return fetchJson<T>(url, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetch ${url} -> ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function amendmentId(congress: number, type: string, number: string | number): string {
  return `${congress}-${String(type).toLowerCase()}-${number}`;
}
// Same construction as billId in lib/sync.ts — the amendedBill join key.
function billId(congress: number, type: string, number: string | number): string {
  return `${congress}-${String(type).toLowerCase()}-${number}`;
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
  return `${API_BASE}/amendment/${congress}?${params.toString()}`;
}
function detailUrl(congress: number, type: string, number: string | number, apiKey: string): string {
  const params = new URLSearchParams({ format: "json", api_key: apiKey });
  return `${API_BASE}/amendment/${congress}/${String(type).toLowerCase()}/${number}?${params.toString()}`;
}

// Pure: builds the single idempotent upsert for one amendment detail. amended_bill_id
// is the CONSTRUCTED id regardless of whether it resolves (HO 447 — don't gate the
// insert on a bills lookup). submitted_date/update_date are NOT NULL columns; both
// were 100% present in the probe, but submitted_date coalesces to updateDate
// defensively so a rare missing field can't fail the batch.
function buildAmendmentStatement(a: AmendmentDetail, congress: number, ingestedAt: string): Stmt {
  const amCongress = a.congress ?? congress;
  const id = amendmentId(amCongress, a.type ?? "", a.number ?? "");
  const amendedBillId =
    a.amendedBill && a.amendedBill.type != null && a.amendedBill.number != null
      ? billId(a.amendedBill.congress ?? amCongress, a.amendedBill.type, a.amendedBill.number)
      : null;
  const amendsAmendmentId =
    a.amendedAmendment && a.amendedAmendment.type != null && a.amendedAmendment.number != null
      ? amendmentId(a.amendedAmendment.congress ?? amCongress, a.amendedAmendment.type, a.amendedAmendment.number)
      : null;
  const sponsor = a.sponsors?.[0];
  return {
    sql: `INSERT INTO amendments
      (id, congress, amendment_type, amendment_number, chamber, amended_bill_id,
       amends_amendment_id, sponsor_bioguide_id, sponsor_name, purpose, description,
       latest_action_text, latest_action_date, submitted_date, update_date, raw_json, ingested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        congress = excluded.congress, amendment_type = excluded.amendment_type,
        amendment_number = excluded.amendment_number, chamber = excluded.chamber,
        amended_bill_id = excluded.amended_bill_id, amends_amendment_id = excluded.amends_amendment_id,
        sponsor_bioguide_id = excluded.sponsor_bioguide_id, sponsor_name = excluded.sponsor_name,
        purpose = excluded.purpose, description = excluded.description,
        latest_action_text = excluded.latest_action_text, latest_action_date = excluded.latest_action_date,
        submitted_date = excluded.submitted_date, update_date = excluded.update_date,
        raw_json = excluded.raw_json, ingested_at = excluded.ingested_at`,
    args: [
      id,
      amCongress,
      String(a.type ?? "").toUpperCase(),
      Number(a.number ?? 0),
      a.chamber ?? null,
      amendedBillId,
      amendsAmendmentId,
      sponsor?.bioguideId ?? null,
      sponsor?.fullName ?? null,
      a.purpose ?? null,
      a.description ?? null,
      a.latestAction?.text ?? null,
      a.latestAction?.actionDate ?? null,
      a.submittedDate ?? a.updateDate ?? ingestedAt,
      a.updateDate ?? ingestedAt,
      JSON.stringify(a),
      ingestedAt,
    ],
  };
}

async function currentFrontier(db: Db, floor: string): Promise<string> {
  const rs = await dbRetry("frontier", () => db.execute("SELECT MAX(update_date) AS mx FROM amendments"));
  return (rs.rows[0]?.mx as string | null) ?? floor;
}

export async function syncAmendments(opts: SyncAmendmentsOptions = {}): Promise<AmendmentsSyncResult> {
  const { backfill = false, deadlineMs, pageDelayMs = 150, progressEveryPages = 5 } = opts;
  // Cap-safe pacing. The Congress.gov key cap is ~5,000 req/hr and the backfill is
  // ~6,800 detail fetches (1 per amendment), so an uncapped run trips the hourly
  // cap mid-way and the short 429-backoff exhausts and throws. A backfill (no
  // deadline) self-paces to ~750ms/detail (fetch ~200ms + 750ms sleep ≈ 1 req/s ≈
  // ~3,800/hr) for one clean ~2h run comfortably under the cap. The cron's
  // incremental deltas are tiny and never approach the cap, so it stays fast at
  // 60ms. Override via opts.detailDelayMs for either.
  const detailDelayMs = opts.detailDelayMs ?? (backfill ? 750 : 60);
  const db = getDb();
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");
  const congress = getCurrentCongress();
  // 119th convenes 2025-01-03; derive from congress so it advances with the cycle.
  const floor = `${2025 + (congress - 119) * 2}-01-03T00:00:00Z`;
  const frontier = await currentFrontier(db, floor);
  const ingestedAt = new Date().toISOString();

  let upserted = 0;
  let listPages = 0;
  let detailErrors = 0;
  let throttled429 = 0;
  let deadlineHit = false;
  let apiTotal = -1;

  const pending: Stmt[] = [];
  const flush = async () => {
    if (!pending.length) return;
    const chunk = pending.splice(0);
    await dbRetry("flush", () => db.batch(chunk, "write"));
  };

  console.log(`[amendments] mode=${backfill ? "backfill" : "incremental"} frontier=${frontier}`);

  let offset = 0;
  outer: for (;;) {
    if (deadlineMs && Date.now() >= deadlineMs) {
      deadlineHit = true;
      break;
    }
    let page: ListResponse;
    try {
      page = await fetchJson<ListResponse>(listUrl(congress, frontier, offset, apiKey));
    } catch (e) {
      // A list-page failure (not a single detail) aborts the run; the next run
      // re-derives the frontier and retries from a durable point.
      await flush();
      throw e;
    }
    listPages++;
    if (apiTotal < 0) apiTotal = page.pagination?.count ?? 0;
    const items = page.amendments ?? [];
    if (!items.length) break;

    for (const it of items) {
      if (deadlineMs && Date.now() >= deadlineMs) {
        deadlineHit = true;
        await flush();
        break outer;
      }
      let detail: AmendmentDetail | undefined;
      try {
        detail = (await fetchJson<{ amendment?: AmendmentDetail }>(detailUrl(it.congress, it.type, it.number, apiKey)))
          .amendment;
      } catch (e) {
        detailErrors++;
        if ((e as Error).message.includes("429")) throttled429++;
        console.warn(`[amendments] detail ${it.type}/${it.number} failed: ${(e as Error).message.slice(0, 100)}`);
        if (detailDelayMs) await sleep(detailDelayMs);
        continue;
      }
      if (detail) {
        pending.push(buildAmendmentStatement(detail, congress, ingestedAt));
        upserted++;
      }
      if (pending.length >= FLUSH_AT) await flush();
      if (detailDelayMs) await sleep(detailDelayMs);
    }
    await flush(); // durable at page boundary

    if (listPages % progressEveryPages === 0) {
      console.log(`[amendments]   page ${listPages} (offset ${offset}): +${upserted} upserted, ${detailErrors} detail errors (api total=${apiTotal})`);
    }
    offset += items.length;
    if (items.length < PAGE_SIZE) break; // last page
    await sleep(pageDelayMs);
  }
  await flush();

  return {
    mode: backfill ? "backfill" : "incremental",
    upserted,
    listPages,
    detailErrors,
    throttled429,
    deadlineHit,
    frontier,
    apiTotal,
  };
}
