import { classifyCluster } from "./cluster-patterns";
import { getCurrentCongress } from "./congress";
import { getDb } from "./db";

const API_BASE = "https://api.congress.gov/v3";
const PAGE_SIZE = 250;
// HO 116: hard wall-clock cap per detail fetch. Cheap insurance — observed
// p95 was 127ms locally — but mirrors the HO 115 summarize pattern so a
// future hung Congress.gov call can't burn the cron tick.
const PER_DETAIL_TIMEOUT_MS = 15_000;

type LatestAction = { actionDate?: string; text?: string };
type Sponsor = {
  fullName?: string;
  party?: string;
  state?: string;
  bioguideId?: string;
};

type ListBill = {
  congress: number;
  type: string;
  number: string;
  url?: string;
  title: string;
  updateDate?: string;
  updateDateIncludingText?: string;
  latestAction?: LatestAction;
};

type DetailBill = {
  congress: number;
  type: string;
  number: string;
  title: string;
  introducedDate?: string;
  updateDate?: string;
  updateDateIncludingText?: string;
  latestAction?: LatestAction;
  sponsors?: Sponsor[];
  cosponsors?: { count?: number };
};

type ListResponse = {
  bills?: ListBill[];
  pagination?: { count?: number; next?: string };
};

type DetailResponse = { bill?: DetailBill };

export type SyncStats = {
  seen: number;
  upserted: number;
  skipped: number;
  failed: number;
  // HO 116: detail fetches killed by the per-bill AbortController. Subset of
  // `failed`. Defensive metric — measured p95 is 127ms, so this is usually 0.
  timedOut: number;
  // HO 116: did the loop stop because deadlineMs was reached (vs. exhausting
  // the list)? The route uses this in its timings payload to see whether the
  // cron is leaving runSync work on the table.
  budgetStopped: boolean;
  fromDateTime: string;
};

function billId(congress: number, type: string, number: number | string): string {
  return `${congress}-${String(type).toLowerCase()}-${number}`;
}

function effectiveUpdate(b: { updateDateIncludingText?: string; updateDate?: string }): string | undefined {
  return b.updateDateIncludingText ?? b.updateDate;
}

async function fetchJson<T>(
  url: string,
  signal?: AbortSignal,
  attempt = 0,
): Promise<T> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal,
  });
  if (res.status === 429 && attempt < 3) {
    const wait = 2000 * (attempt + 1);
    console.warn(`rate limited, sleeping ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
    return fetchJson<T>(url, signal, attempt + 1);
  }
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`fetch ${url} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

function listUrl(fromDateTime: string, offset: number, apiKey: string): string {
  const params = new URLSearchParams({
    fromDateTime,
    sort: "updateDate desc",
    limit: String(PAGE_SIZE),
    offset: String(offset),
    format: "json",
    api_key: apiKey,
  });
  return `${API_BASE}/bill/${getCurrentCongress()}?${params.toString()}`;
}

function detailUrl(congress: number, type: string, number: string | number, apiKey: string): string {
  const params = new URLSearchParams({ format: "json", api_key: apiKey });
  return `${API_BASE}/bill/${congress}/${String(type).toLowerCase()}/${number}?${params.toString()}`;
}

function defaultFromDateTime(): string {
  const d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  return d.toISOString().replace(/\.\d+Z$/, "Z");
}

function normalizeDateTime(s: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s}T00:00:00Z`;
  return s.replace(/\.\d+Z$/, "Z");
}

async function getWatermark(db: ReturnType<typeof getDb>): Promise<string> {
  const r = await db.execute("SELECT MAX(update_date) AS m FROM bills");
  const m = r.rows[0]?.m as string | null | undefined;
  if (!m) return defaultFromDateTime();
  return normalizeDateTime(m);
}

// HO 116: batched diff. One round-trip per list page replaces the previous
// per-bill SELECT, which was the dominant cost in runSync (8.5s/page on
// Turso locally → ~17s/page projected in prod). Same logic, identical
// skip/needs-fetch outcome — see scripts/diagnostic/sync-measure.ts.
async function getStoredUpdates(
  db: ReturnType<typeof getDb>,
  ids: string[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (ids.length === 0) return result;
  const placeholders = ids.map(() => "?").join(",");
  const r = await db.execute({
    sql: `SELECT id, update_date FROM bills WHERE id IN (${placeholders})`,
    args: ids,
  });
  for (const row of r.rows) {
    const id = row.id as string;
    const ud = row.update_date as string | null;
    if (ud) result.set(id, ud);
  }
  return result;
}

// cosponsor_count is refreshed on every upsert (cosponsors accrete over the
// life of a bill). Intentionally NOT cleared when update_date changes —
// re-nulling would create unnecessary backfill churn since the count is
// fresh from every detail fetch.
const UPSERT_SQL = `
INSERT INTO bills (
  id, congress, bill_type, bill_number, title,
  introduced_date, latest_action_date, latest_action_text,
  sponsor_name, sponsor_party, sponsor_state, sponsor_bioguide_id,
  update_date, raw_json, cluster_id, cosponsor_count
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(id) DO UPDATE SET
  title = excluded.title,
  introduced_date = excluded.introduced_date,
  latest_action_date = excluded.latest_action_date,
  latest_action_text = excluded.latest_action_text,
  sponsor_name = excluded.sponsor_name,
  sponsor_party = excluded.sponsor_party,
  sponsor_state = excluded.sponsor_state,
  sponsor_bioguide_id = excluded.sponsor_bioguide_id,
  raw_json = excluded.raw_json,
  update_date = excluded.update_date,
  cluster_id = excluded.cluster_id,
  cosponsor_count = excluded.cosponsor_count,
  summary = CASE WHEN excluded.update_date != bills.update_date THEN NULL ELSE bills.summary END,
  summary_model = CASE WHEN excluded.update_date != bills.update_date THEN NULL ELSE bills.summary_model END,
  summary_updated_at = CASE WHEN excluded.update_date != bills.update_date THEN NULL ELSE bills.summary_updated_at END,
  topics = CASE WHEN excluded.update_date != bills.update_date THEN NULL ELSE bills.topics END,
  is_ceremonial = CASE WHEN excluded.update_date != bills.update_date THEN NULL ELSE bills.is_ceremonial END,
  -- HO 115: a bill with a new update_date gets a fresh shot at summarization.
  -- Clear the failure timestamp and attempt counter so the 24h-skip clause in
  -- runSummarize doesn't strand a re-synced bill on its prior failure record.
  summarize_failed_at = CASE WHEN excluded.update_date != bills.update_date THEN NULL ELSE bills.summarize_failed_at END,
  summarize_attempts = CASE WHEN excluded.update_date != bills.update_date THEN 0 ELSE bills.summarize_attempts END
`;

async function upsertBill(
  db: ReturnType<typeof getDb>,
  detail: DetailBill,
): Promise<void> {
  const id = billId(detail.congress, detail.type, detail.number);
  const update = effectiveUpdate(detail);
  if (!update) {
    console.warn(`skipping ${id}: no update date in detail`);
    return;
  }
  const sponsor = detail.sponsors?.[0];
  const billType = String(detail.type).toLowerCase();
  const clusterId = classifyCluster(detail.title, billType);
  const cosponsorCount = detail.cosponsors?.count ?? null;
  await db.execute({
    sql: UPSERT_SQL,
    args: [
      id,
      detail.congress,
      billType,
      Number(detail.number),
      detail.title,
      detail.introducedDate ?? null,
      detail.latestAction?.actionDate ?? null,
      detail.latestAction?.text ?? null,
      sponsor?.fullName ?? null,
      sponsor?.party ?? null,
      sponsor?.state ?? null,
      sponsor?.bioguideId ?? null,
      update,
      JSON.stringify(detail),
      clusterId,
      cosponsorCount,
    ],
  });
}

export type RunSyncOptions = {
  fromDateTime?: string;
  /**
   * HO 116: absolute epoch-millis past which runSync stops *starting* new
   * bills. The 15s per-detail AbortController bounds the in-flight bill on
   * top of this, mirroring runSummarize's pattern. The route passes
   * `routeStart + 30_000` so the downstream steps (lead + news + trades +
   * Monday report) get ~25s of remaining function budget. Outer-loop
   * pagination check too: if a long page-1 detail-fetch crowd pushed us past
   * the deadline, we won't even fetch the next list page.
   */
  deadlineMs?: number;
};

export async function runSync(opts: RunSyncOptions = {}): Promise<SyncStats> {
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");
  const db = getDb();

  const fromDateTime = opts.fromDateTime ?? (await getWatermark(db));
  const deadlineMs = opts.deadlineMs;
  console.log(
    `syncing bills updated since ${fromDateTime}` +
      (deadlineMs ? ` deadline=${new Date(deadlineMs).toISOString()}` : ""),
  );

  let offset = 0;
  const stats: SyncStats = {
    seen: 0,
    upserted: 0,
    skipped: 0,
    failed: 0,
    timedOut: 0,
    budgetStopped: false,
    fromDateTime,
  };
  let deadlineReached = false;

  // HO 116 caveat (worth knowing before tweaking this loop): list sort is
  // `updateDate desc` so the freshest bills are processed first. On a
  // partial-tick kill — Vercel ceiling or `deadlineMs` reached — the new
  // MAX(update_date) advances to whichever bill we processed first (the
  // freshest one). Bills further down in the same tick's queue (older
  // changes) end up below the next tick's watermark and are skipped until
  // they update again on their own. This is the same behavior the pre-116
  // implementation had; HO 116 doesn't regress it. If post-deploy shows the
  // backlog isn't draining, the resolution is `updateDate asc` plus an
  // explicit cursor in `sync_state` — defer until evidence calls for it.
  pageLoop: while (true) {
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
      stats.budgetStopped = true;
      console.log(
        `budget reached before page offset=${offset}; stopping`,
      );
      break;
    }
    const url = listUrl(fromDateTime, offset, apiKey);
    const page = await fetchJson<ListResponse>(url);
    const bills = page.bills ?? [];
    if (bills.length === 0) break;

    console.log(`page offset=${offset}: ${bills.length} bills`);

    // HO 116: batch the diff. One IN(...) SELECT for the whole page replaces
    // 250 per-bill round-trips — measured 8481ms → 84ms on a full page.
    const ids = bills.map((lb) => billId(lb.congress, lb.type, lb.number));
    const storedById = await getStoredUpdates(db, ids);

    for (const lb of bills) {
      // Deadline check before starting any new bill, so the only thing that
      // can push us past `deadlineMs` is the 15s per-detail AbortController.
      if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
        stats.budgetStopped = true;
        deadlineReached = true;
        console.log(
          `budget reached after ${stats.seen}/${bills.length}+ bill(s); stopping`,
        );
        break pageLoop;
      }

      stats.seen++;
      const id = billId(lb.congress, lb.type, lb.number);
      const listUpdate = effectiveUpdate(lb);
      if (!listUpdate) {
        console.warn(`skip ${id}: list entry has no update date`);
        stats.skipped++;
        continue;
      }
      const stored = storedById.get(id) ?? null;
      if (stored && stored >= listUpdate) {
        stats.skipped++;
        continue;
      }

      // HO 116: detail fetch is bounded by a 15s AbortController. Same shape
      // as runSummarize. `ac.signal.aborted` after a throw means the timer
      // fired; that bill counts as timedOut (subset of failed) and will be
      // re-attempted naturally on the next tick when its watermark
      // comparison still shows it as needing fetch.
      const ac = new AbortController();
      const timer = setTimeout(() => ac.abort(), PER_DETAIL_TIMEOUT_MS);
      try {
        const detailRes = await fetchJson<DetailResponse>(
          detailUrl(lb.congress, lb.type, lb.number, apiKey),
          ac.signal,
        );
        const detail = detailRes.bill;
        if (!detail) {
          console.warn(`skip ${id}: detail response missing bill`);
          stats.failed++;
          continue;
        }
        await upsertBill(db, detail);
        stats.upserted++;
      } catch (err) {
        if (ac.signal.aborted) {
          stats.timedOut++;
          console.warn(
            `timeout ${id}: detail exceeded ${PER_DETAIL_TIMEOUT_MS}ms`,
          );
        } else {
          console.error(`failed ${id}:`, (err as Error).message);
        }
        stats.failed++;
      } finally {
        clearTimeout(timer);
      }
    }

    if (deadlineReached) break;
    if (bills.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  console.log(
    `done: seen=${stats.seen} upserted=${stats.upserted} ` +
      `skipped=${stats.skipped} failed=${stats.failed} ` +
      `timeout=${stats.timedOut} budgetStopped=${stats.budgetStopped}`,
  );
  return stats;
}
