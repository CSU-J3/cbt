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
//
// HO 840: for 7 days after a switch (amendmentsTail), the run also lists the previous
// Congress, /amendment/{current − 1}, after the current listing and inside the same
// deadline, from that Congress's own frontier, so a 119th amendment acted on in the
// session's last days and indexed after Jan 3 is stored. The frontier is per congress
// (MAX(update_date) WHERE congress = ?), as HO 839 made the nominations sync's: one
// MAX over the whole table would move with every row the tail writes and skip the
// current Congress's updates behind it. Today every row is the 119th's, so it reads
// the value the whole-table form read. The tail's failure doesn't fail the run. The
// tail stops at its first failed detail fetch: past it, a later item would lift the
// previous Congress's MAX(update_date) over the failed one, and --repair enumerates
// only the current Congress, so it would be lost for good. Stopping leaves the frontier
// at or below it, and the next run lists it again.
import { getCurrentCongress, previousCongressTail } from "./congress";
import { getDb } from "./db";
import { fetchError, redactSecrets } from "./redact";

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
  // HO 840: the previous Congress's tail, present only in its 7-day window.
  tail?: AmendmentsTailResult;
}

// HO 840: one run's tail of the previous Congress.
export interface AmendmentsTailResult {
  congress: number;
  frontier: string;
  // Rows written: on a throw, less the batch a failed flush never wrote.
  upserted: number;
  listPages: number;
  detailErrors: number;
  deadlineHit: boolean;
  apiTotal: number;
  // A list page or a flush that threw, or the first failed detail, where the tail stopped; redacted. The tail's
  // failure doesn't fail the run.
  error: string | null;
}

// HO 840: the tail's window, the nominations sync's 7 days. { congress: 119, session: 2 } from
// 2027-01-03T00:00:00Z through 2027-01-09T23:59:59.999Z, null outside it (check:rollover case 12).
export const AMENDMENTS_TAIL_DAYS = 7;
export function amendmentsTail(now: Date = new Date()): { congress: number; session: 2 } | null {
  return previousCongressTail(now, AMENDMENTS_TAIL_DAYS);
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
    throw fetchError(url, res.status, body);
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
//
// FRONTIER CORRECTNESS: `update_date` is stored from the LIST item's updateDate
// (listUpdateDate), NOT the detail's. The `/amendment` endpoint sorts and filters
// (fromDateTime) on the LIST updateDate, and the two DIVERGE (observed: a detail
// updateDate can be hours earlier OR a year later than its list updateDate). The
// resume frontier MAX(update_date) must equal the sweep's sort key or a partial
// run poisons it — an early-in-the-sweep item carrying a far-future detail
// updateDate lifts MAX past the middle of the corpus, and the next
// fromDateTime=MAX sweep skips the gap (the HO 447 backfill's poisoned-frontier
// hole). Storing the list updateDate keeps stored == sort key, so MAX is a true
// contiguous-prefix boundary. detail.updateDate remains in raw_json.
function buildAmendmentStatement(
  a: AmendmentDetail,
  congress: number,
  ingestedAt: string,
  listUpdateDate?: string,
): Stmt {
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
      a.submittedDate ?? listUpdateDate ?? a.updateDate ?? ingestedAt,
      listUpdateDate ?? a.updateDate ?? ingestedAt,
      JSON.stringify(a),
      ingestedAt,
    ],
  };
}

// HO 840: per congress (see the header). Until HO 840, MAX(update_date) over the whole table.
async function currentFrontier(db: Db, floor: string, congress: number): Promise<string> {
  const rs = await dbRetry("frontier", () =>
    db.execute({ sql: "SELECT MAX(update_date) AS mx FROM amendments WHERE congress = ?", args: [congress] }),
  );
  return (rs.rows[0]?.mx as string | null) ?? floor;
}

// A Congress's convening floor: the 119th convened 2025-01-03, derived from the congress so it advances.
const floorOf = (congress: number) => `${2025 + (congress - 119) * 2}-01-03T00:00:00Z`;

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
  // HO 840: one reading of the clock per run, for the listing's congress and the tail's window.
  const now = new Date();
  const congress = getCurrentCongress(now);
  const frontier = await currentFrontier(db, floorOf(congress), congress);
  const ingestedAt = new Date().toISOString();

  let throttled429 = 0;

  const pending: Stmt[] = [];
  // HO 840: a batch leaves the buffer only once it's written, so a tail that throws can count what it wrote.
  const flush = async () => {
    if (!pending.length) return;
    const chunk = pending.slice();
    await dbRetry("flush", () => db.batch(chunk, "write"));
    pending.splice(0, chunk.length);
  };

  // HO 840: one listing of /amendment/{listCongress} from its frontier to the end of the list or the deadline,
  // counting into `acc`, which its caller holds, so the counts survive a throw. A list page that throws flushes
  // what it has and rethrows: for the current Congress that aborts the run (the next run re-derives the frontier
  // and retries from a durable point), as before; the tail catches it. A failed detail is skipped, as before, unless
  // `stopOnDetailError` (the tail's): then the walk flushes what precedes it, notes it in `acc.detailStop` and stops.
  type WalkCounts = {
    upserted: number;
    listPages: number;
    detailErrors: number;
    deadlineHit: boolean;
    apiTotal: number;
    detailStop: string | null;
  };
  const walk = async (listCongress: number, from: string, acc: WalkCounts, stopOnDetailError = false): Promise<void> => {
    let offset = 0;
    outer: for (;;) {
      if (deadlineMs && Date.now() >= deadlineMs) {
        acc.deadlineHit = true;
        break;
      }
      let page: ListResponse;
      try {
        page = await fetchJson<ListResponse>(listUrl(listCongress, from, offset, apiKey));
      } catch (e) {
        await flush();
        throw e;
      }
      acc.listPages++;
      if (acc.apiTotal < 0) acc.apiTotal = page.pagination?.count ?? 0;
      const items = page.amendments ?? [];
      if (!items.length) break;

      for (const it of items) {
        if (deadlineMs && Date.now() >= deadlineMs) {
          acc.deadlineHit = true;
          await flush();
          break outer;
        }
        let detail: AmendmentDetail | undefined;
        try {
          detail = (await fetchJson<{ amendment?: AmendmentDetail }>(detailUrl(it.congress, it.type, it.number, apiKey)))
            .amendment;
        } catch (e) {
          acc.detailErrors++;
          if ((e as Error).message.includes("429")) throttled429++;
          console.warn(`[amendments] detail ${it.type}/${it.number} failed: ${(e as Error).message.slice(0, 100)}`);
          if (stopOnDetailError) {
            acc.detailStop =
              `detail ${it.type}/${it.number} failed (${redactSecrets((e as Error).message).slice(0, 160)}); ` +
              "the tail stopped before it and lists it again next run";
            await flush();
            break outer;
          }
          if (detailDelayMs) await sleep(detailDelayMs);
          continue;
        }
        if (detail) {
          pending.push(buildAmendmentStatement(detail, listCongress, ingestedAt, it.updateDate));
          acc.upserted++;
        }
        if (pending.length >= FLUSH_AT) await flush();
        if (detailDelayMs) await sleep(detailDelayMs);
      }
      await flush(); // durable at page boundary

      if (acc.listPages % progressEveryPages === 0) {
        console.log(
          `[amendments]   ${listCongress} page ${acc.listPages} (offset ${offset}): +${acc.upserted} upserted, ` +
            `${acc.detailErrors} detail errors (api total=${acc.apiTotal})`,
        );
      }
      offset += items.length;
      if (items.length < PAGE_SIZE) break; // last page
      await sleep(pageDelayMs);
    }
    await flush();
  };

  console.log(`[amendments] mode=${backfill ? "backfill" : "incremental"} frontier=${frontier}`);
  const fresh = (): WalkCounts => ({ upserted: 0, listPages: 0, detailErrors: 0, deadlineHit: false, apiTotal: -1, detailStop: null });
  const cur = fresh();
  await walk(congress, frontier, cur);

  // HO 840: for 7 days after a switch, the previous Congress too, after the current listing and inside the same
  // deadline, from its own frontier, stopping at its first failed detail. The frontier read is inside the try too,
  // so nothing the tail does can fail the run, and it never moves the current Congress's frontier, which is read
  // per congress.
  let tail: AmendmentsTailResult | undefined;
  const t = amendmentsTail(now);
  if (t) {
    const acc = fresh();
    let tailFrontier = "";
    try {
      tailFrontier = await currentFrontier(db, floorOf(t.congress), t.congress);
      console.log(`[amendments] tail congress=${t.congress} frontier=${tailFrontier}`);
      await walk(t.congress, tailFrontier, acc, true);
      const { detailStop, ...counts } = acc;
      tail = { congress: t.congress, frontier: tailFrontier, ...counts, error: detailStop };
    } catch (e) {
      // A flush that threw left its batch in `pending`: one statement per amendment, never written.
      const unwritten = pending.length;
      pending.length = 0;
      const { detailStop: _stop, ...counts } = acc;
      tail = {
        congress: t.congress,
        frontier: tailFrontier,
        ...counts,
        upserted: counts.upserted - unwritten,
        error: redactSecrets((e as Error).message),
      };
    }
  }

  return {
    mode: backfill ? "backfill" : "incremental",
    upserted: cur.upserted,
    listPages: cur.listPages,
    detailErrors: cur.detailErrors,
    throttled429,
    deadlineHit: cur.deadlineHit,
    frontier,
    apiTotal: cur.apiTotal,
    ...(tail ? { tail } : {}),
  };
}

export interface RepairResult {
  liveCount: number; // pagination.count — can OVERCOUNT (API lists duplicate entries)
  distinctLive: number; // distinct amendment ids the list enumerates
  duplicates: number; // liveCount - distinctLive — API duplicate list entries (a drift, not a gap)
  storedBefore: number;
  storedAfter: number;
  repaired: number;
  errors: number;
  passes: number;
  complete: boolean;
}

// Close the holes the frontier-sweep backfill can't. The `/amendment` list paginates
// by `sort=updateDate asc` with NO stable tiebreaker, and hundreds of amendments
// share an exact updateDate (batch actions), so offset windows skip across tie-group
// boundaries — the backfill AND a single enumeration both under-collect (observed:
// an enumeration saw 6,749 of 6,788). A skipped row is a hole BELOW MAX(update_date),
// which the ascending frontier-resume can never refill. So repair enumerates the full
// list, diffs against stored, and detail-fetches only the missing ids — ITERATIVELY,
// because the enumeration is itself lossy: each pass's independent tie-order drift
// surfaces a different subset, and re-running converges. COMPLETION GATES ON THE
// DISTINCT-ENUMERABLE SET, not pagination.count: the `/amendment` list can carry
// duplicate entries so pagination.count OVERCOUNTS the distinct id set, and a
// PK-deduped store can never reach it — the pre-HO-570 `stored >= pagination.count`
// gate looped every pass reporting complete=false (the same LDA-40 count-vs-
// enumerable drift nominations fixed at e175fd7). The corpus is complete when a full
// enumeration surfaces 0 missing (every distinct live id is stored); the duplicate
// drift (liveCount - distinctLive) is reported, not chased. Repair also stops on a
// no-progress pass (all missing errored) or maxPasses. Detail-fetch is by explicit
// (type, number), so it never depends on pagination order — a missing id, once
// identified, is fetched deterministically.
export async function repairAmendments(opts: { maxPasses?: number; detailDelayMs?: number } = {}): Promise<RepairResult> {
  const { maxPasses = 8, detailDelayMs = 150 } = opts;
  const db = getDb();
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");
  const congress = getCurrentCongress();
  const ingestedAt = new Date().toISOString();

  const countUrl = `${API_BASE}/amendment/${congress}?${new URLSearchParams({ limit: "1", format: "json", api_key: apiKey })}`;
  const liveCount = (await fetchJson<ListResponse>(countUrl)).pagination?.count ?? -1;
  const storedBefore = Number(
    (await dbRetry("repair-count", () => db.execute("SELECT COUNT(*) AS n FROM amendments"))).rows[0]?.n ?? 0,
  );

  let repaired = 0;
  let errors = 0;
  let passes = 0;
  let distinctLive = 0;
  let complete = false;
  for (let pass = 1; pass <= maxPasses; pass++) {
    passes = pass;

    // Enumerate the full list (offset walk) -> id -> list updateDate.
    const listIds = new Map<string, string>();
    let offset = 0;
    for (;;) {
      const url = `${API_BASE}/amendment/${congress}?${new URLSearchParams({
        sort: "updateDate asc",
        limit: String(PAGE_SIZE),
        offset: String(offset),
        format: "json",
        api_key: apiKey,
      })}`;
      const page = await fetchJson<ListResponse>(url);
      const items = page.amendments ?? [];
      if (!items.length) break;
      for (const it of items) listIds.set(amendmentId(it.congress, it.type, it.number), it.updateDate ?? "");
      offset += items.length;
      if (items.length < PAGE_SIZE) break;
      await sleep(120);
    }

    distinctLive = listIds.size;
    const rs = await dbRetry("repair-stored", () => db.execute("SELECT id FROM amendments"));
    const stored = new Set(rs.rows.map((r) => r.id as string));
    const missing = [...listIds.keys()].filter((id) => !stored.has(id));
    console.log(
      `[amendments] repair pass ${pass}: enumerated ${listIds.size} distinct (pagination.count=${liveCount}), ${missing.length} missing`,
    );
    if (!missing.length) {
      // Every distinct enumerable id is stored — complete. pagination.count may
      // still exceed listIds.size (API duplicate list entries); that's the drift,
      // not a gap.
      complete = true;
      break;
    }

    const pending: Stmt[] = [];
    let repairedThisPass = 0;
    for (const id of missing) {
      const m = id.match(/^(\d+)-([a-z]+)-(\d+)$/);
      if (!m) continue;
      const [, c = "", type = "", number = ""] = m;
      let detail: AmendmentDetail | undefined;
      try {
        detail = (await fetchJson<{ amendment?: AmendmentDetail }>(detailUrl(Number(c), type, number, apiKey))).amendment;
      } catch (e) {
        errors++;
        console.warn(`[amendments] repair ${id} failed: ${(e as Error).message.slice(0, 80)}`);
        if (detailDelayMs) await sleep(detailDelayMs);
        continue;
      }
      if (detail) {
        pending.push(buildAmendmentStatement(detail, congress, ingestedAt, listIds.get(id)));
        repaired++;
        repairedThisPass++;
      }
      if (pending.length >= FLUSH_AT) {
        const chunk = pending.splice(0);
        await dbRetry("repair-flush", () => db.batch(chunk, "write"));
      }
      if (detailDelayMs) await sleep(detailDelayMs);
    }
    if (pending.length) {
      const chunk = pending.splice(0);
      await dbRetry("repair-flush", () => db.batch(chunk, "write"));
    }
    if (repairedThisPass === 0) break; // no progress (all missing errored) — stop looping
  }

  const storedAfter = Number(
    (await dbRetry("repair-count", () => db.execute("SELECT COUNT(*) AS n FROM amendments"))).rows[0]?.n ?? 0,
  );
  const duplicates = liveCount >= 0 && distinctLive > 0 ? liveCount - distinctLive : 0;
  return { liveCount, distinctLive, duplicates, storedBefore, storedAfter, repaired, errors, passes, complete };
}
