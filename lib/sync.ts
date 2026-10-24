// HO 790: the bill sync. The frontier is a row in sync_state (`bills_frontier`, an ISO instant), not a derived
// MAX(update_date). A tick lists /bill/{congress} from it, `sort=updateDate asc`, in pages of 250 that overlap by 25
// (HO 754's meetings method, so an entry that shifts across a boundary while the walk runs is read twice and never
// zero times), and every listed entry goes into sync_queue keyed by bill id. When the listing reaches the end of the
// list the frontier moves to the instant the listing began, less a 15-minute margin; a listing cut by the deadline or
// by a failed page leaves the frontier where it was, and the next tick lists from there again. Then the tick drains
// the queue, oldest list day first: each bill's detail fetched and upserted, its row deleted. A failed fetch charges
// the row an attempt and leaves it for the next tick; the third drops it, named in the stats.
//
// Nothing is compared at day precision on this path. The list prints both dates as a bare day (HO 788 read 58,557
// entries, none with a time), `fromDateTime` filters on updateDateIncludingText to the second, and the detail carries
// the instant, so every entry the filter returns is fetched and the upsert decides. Once a UTC day (`bills_wide_at`),
// after the frontier listing completes, a second listing from the frontier less 48 hours enqueues each entry missing
// from `bills` or whose stored day is before its list day: the self-heal for late indexing, and the only day compare
// left. It never moves the frontier, so it can't drop what the frontier listing took.
//
// /api/sync and `npm run sync` call runSync with the `live` queue. A pass run from the box enqueues with
// `source = 'backfill'` and drains that queue alone, so the cron's drain never reads it.
import { classifyCluster } from "./cluster-patterns";
import { getCurrentCongress } from "./congress";
import { getDb } from "./db";
import { computeStage, stageRank } from "./enums";
import { fetchError, redactSecrets } from "./redact";

// HO 790: the one seam, for the legs' stub on 127.0.0.1 (scripts/diagnostic/sync-frontier-790.ts). Unset everywhere
// else, so production reads Congress.gov.
const API_BASE = process.env.CONGRESS_API_BASE ?? "https://api.congress.gov/v3";
const PAGE_SIZE = 250;
// HO 790: each list page after the first starts 25 places before the previous one ended. An entry re-updated while
// the walk runs moves to the end of the asc list, which shifts every later entry left by one; 25 is the shift a
// boundary absorbs between two page reads.
const OVERLAP = 25;
// HO 790: a completed listing moves the frontier to its own start less this, so an entry Congress.gov indexes a few
// minutes behind its updateDateIncludingText is still listed by the next tick.
const FRONTIER_MARGIN_MS = 15 * 60_000;
// HO 790: the daily wide listing reaches this far behind the frontier.
const WIDE_WINDOW_MS = 48 * 60 * 60_000;
// HO 790: queue rows read per drain round, failed fetches a row may take before it's dropped, and the dropped ids
// a tick's stats carry.
const DRAIN_BATCH = 500;
const MAX_ATTEMPTS = 3;
const DROPPED_CAP = 50;
const FRONTIER_KEY = "bills_frontier";
const WIDE_KEY = "bills_wide_at";
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
  textVersions?: { count?: number };
  summaries?: { count?: number };
};

type ListResponse = {
  bills?: ListBill[];
  pagination?: { count?: number; next?: string };
};

type DetailResponse = { bill?: DetailBill };

type QueueSource = "live" | "backfill";

export type SyncStats = {
  // Every list entry read, the overlap's repeats included.
  seen: number;
  upserted: number;
  // List entries with no date, and entries the wide listing's day compare passed over.
  skipped: number;
  failed: number;
  // HO 116: detail fetches killed by the per-bill AbortController. Subset of
  // `failed`. Defensive metric — measured p95 is 127ms, so this is usually 0.
  timedOut: number;
  // HO 116: did the tick stop because deadlineMs was reached? Since HO 790 that
  // can happen in the listing (before a page) or in the drain (before a bill).
  budgetStopped: boolean;
  // The frontier listing's fromDateTime; empty when the tick only drains (`listing: false`).
  fromDateTime: string;
  // HO 790: the frontier as the tick read it and as it left it, and whether this tick wrote it first, from
  // MAX(update_date).
  frontierBefore: string | null;
  frontierAfter: string | null;
  bootstrapped: boolean;
  // HO 790: the frontier listing reached the end of the list; only then does the frontier move.
  listComplete: boolean;
  // HO 790: a list page that threw (a 5xx past fetchJson's 429 retry, a network failure), redacted. The frontier
  // stays and the tick goes on to the drain.
  listError: string | null;
  // HO 790: list pages read across the tick's listings, and the frontier listing's own pagination.count.
  pages: number;
  listedCount: number | null;
  // HO 790: ids put into sync_queue that weren't already there.
  enqueued: number;
  // HO 790: the depth of the queue this tick drains (`source`), at the tick's start and end.
  queueBefore: number;
  queueAfter: number;
  // HO 790: rows deleted on their third failed fetch: the first 50 ids, and the count.
  dropped: string[];
  droppedCount: number;
  // HO 790: the daily wide listing ran this tick, and reached the end of the list (which writes bills_wide_at).
  wide: boolean;
  wideComplete: boolean;
  // HO 790: writes that nulled a summary, on a new latest action or a new text version (Corey's ruling on backlog
  // :17), and of them those with a new action and those with a new text version (a write with both counts in each).
  resets: number;
  resetByAction: number;
  resetByText: number;
  // HO 790: two moves the ruling counts and doesn't act on: the CRS summaries' count (every write where it moved, and
  // those where nothing else reset the summary, the resets a CRS term would add) and the title.
  crsMoved: number;
  crsOnly: number;
  titleMoved: number;
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
    throw fetchError(url, res.status, body);
  }
  return (await res.json()) as T;
}

function listUrl(fromDateTime: string, offset: number, apiKey: string): string {
  const params = new URLSearchParams({
    fromDateTime,
    sort: "updateDate asc",
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

function isoSeconds(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");
}

// HO 790: the frontier's bootstrap, read once, when sync_state has no bills_frontier. Until HO 790 this was every
// tick's fromDateTime.
async function getWatermark(db: ReturnType<typeof getDb>): Promise<string> {
  const r = await db.execute("SELECT MAX(update_date) AS m FROM bills");
  const m = r.rows[0]?.m as string | null | undefined;
  if (!m) return defaultFromDateTime();
  return normalizeDateTime(m);
}

// HO 790: the frontier and the wide listing's last day, read together once a tick. An absent frontier is bootstrapped
// from getWatermark and written, and the stats say so.
async function getFrontier(
  db: ReturnType<typeof getDb>,
  stats: SyncStats,
): Promise<{ frontier: string; wideAt: string | null }> {
  const r = await db.execute({
    sql: "SELECT key, value FROM sync_state WHERE key IN (?, ?)",
    args: [FRONTIER_KEY, WIDE_KEY],
  });
  const state = new Map(r.rows.map((row) => [row.key as string, row.value as string]));
  let frontier = state.get(FRONTIER_KEY);
  if (!frontier) {
    frontier = await getWatermark(db);
    await setSyncState(db, FRONTIER_KEY, frontier);
    stats.bootstrapped = true;
  }
  return { frontier, wideAt: state.get(WIDE_KEY) ?? null };
}

async function setSyncState(db: ReturnType<typeof getDb>, key: string, value: string): Promise<void> {
  await db.execute({
    sql: `INSERT INTO sync_state (key, value, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    args: [key, value, new Date().toISOString()],
  });
}

async function setFrontier(db: ReturnType<typeof getDb>, instant: string): Promise<void> {
  await setSyncState(db, FRONTIER_KEY, instant);
}

// HO 116: batched diff. One round-trip per list page replaces the previous
// per-bill SELECT, which was the dominant cost in runSync (8.5s/page on
// Turso locally → ~17s/page projected in prod). HO 790: kept for the wide
// listing's day compare, the one place the stored date is still read.
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

async function queueDepth(db: ReturnType<typeof getDb>, source: QueueSource): Promise<number> {
  const r = await db.execute({ sql: "SELECT COUNT(*) AS n FROM sync_queue WHERE source = ?", args: [source] });
  return Number(r.rows[0]?.n ?? 0);
}

// HO 790: one list page's entries into sync_queue, in one statement. A row already queued keeps its enqueued_at and
// takes the later list day; a live listing takes over a backfill row, so the cron drains it first (either drain
// writes the same detail). Returns the ids that weren't queued before, read before the INSERT, since rowsAffected
// counts the conflict updates too.
async function enqueue(
  db: ReturnType<typeof getDb>,
  entries: Map<string, string>,
  source: QueueSource,
): Promise<number> {
  if (entries.size === 0) return 0;
  const ids = [...entries.keys()];
  const placeholders = ids.map(() => "?").join(",");
  const had = new Set(
    (await db.execute({ sql: `SELECT bill_id FROM sync_queue WHERE bill_id IN (${placeholders})`, args: ids })).rows.map(
      (row) => row.bill_id as string,
    ),
  );
  const now = new Date().toISOString();
  await db.execute({
    sql: `INSERT INTO sync_queue (bill_id, list_update_day, source, enqueued_at)
          VALUES ${ids.map(() => "(?, ?, ?, ?)").join(", ")}
          ON CONFLICT(bill_id) DO UPDATE SET
            list_update_day = MAX(excluded.list_update_day, sync_queue.list_update_day),
            source = CASE WHEN excluded.source = 'live' THEN 'live' ELSE sync_queue.source END`,
    args: ids.flatMap((id) => [id, entries.get(id)!, source, now]),
  });
  return ids.filter((id) => !had.has(id)).length;
}

// ── cosponsor_count is NOT written here, and the omission is deliberate ──────
// HO 677 gave the column ONE owner: /api/cron/bill-rosters, via
// lib/bill-rosters-refresh.ts, which writes it from the roster it just fetched.
// This is the HO 459 rule — a column omitted from an upsert is a permanent
// invariant on the sync, so it is stated here rather than discovered later by
// someone helpfully adding the field back.
//
// WHAT THIS SYNC USED TO DO, and why it was not enough: it wrote the column from
// the detail endpoint's $.cosponsors.count, which is the LIVE count at upsert
// time — so its writes were never wrong, they were merely infrequent. Measured
// at HO 677: of bills upserted within 7 days, 501 of 501 agreed with their
// roster; of the 1,905 that disagreed, ZERO had been upserted in that window,
// and the oldest carried an update_date from 2025-02-28. Cosponsors accrue
// without reliably moving updateDate, so no upsert fires and the column freezes.
// Re-adding the write would not fix that; it would restore a second writer for a
// value the refresh already owns.
//
// A NEW bill therefore carries NULL until the refresh's first check (its
// never-checked trigger is the priority band, so <= one ~3h tick). That window
// is deliberate: the panel gates its COSPONSORS row on `!= null`, so a
// not-yet-checked bill renders NO row rather than a total above no groups —
// absence over a wrong number, and a broken refresh fails VISIBLY instead of
// silently reverting to a frozen column.
const UPSERT_SQL = `
INSERT INTO bills (
  id, congress, bill_type, bill_number, title,
  introduced_date, latest_action_date, latest_action_text,
  sponsor_name, sponsor_party, sponsor_state, sponsor_bioguide_id,
  update_date, raw_json, cluster_id, changed_at
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
  -- HO 753: the committee-bills walk keys on changed_at. Stamped on insert and
  -- when update_date moves; an unchanged rewrite leaves it alone. The same
  -- change resets the walk's failure count, so a bill set aside after five
  -- failed walks comes back when it changes. HO 790: it stays on update_date
  -- while the summary reset below moved off it, because a committee referral
  -- is metadata and the walk must see it.
  changed_at = CASE WHEN excluded.update_date != bills.update_date THEN excluded.changed_at ELSE bills.changed_at END,
  committee_walk_failures = CASE WHEN excluded.update_date != bills.update_date THEN 0 ELSE bills.committee_walk_failures END,
  -- HO 790: the seven summary columns reset on upsertBill's substantive flag,
  -- bound once per clause (? = 1): update_date moved AND the latest action or
  -- the text versions' count changed. The summarizer's prompt reads the latest
  -- action and the latest text (lib/summarize.ts:217-220), so those two are
  -- what a reset follows; a subject, a cosponsor or a title moving update_date
  -- keeps the summary (HO 790, Corey's ruling on backlog :17, 2026-10-24). The
  -- prompt reads the CRS summary too, and a new one is not a reset under the
  -- ruling; the drain counts it (crsMoved, crsOnly). Until HO 790 each clause
  -- tested excluded.update_date != bills.update_date (HO 115).
  summary = CASE WHEN ? = 1 THEN NULL ELSE bills.summary END,
  summary_model = CASE WHEN ? = 1 THEN NULL ELSE bills.summary_model END,
  summary_updated_at = CASE WHEN ? = 1 THEN NULL ELSE bills.summary_updated_at END,
  topics = CASE WHEN ? = 1 THEN NULL ELSE bills.topics END,
  is_ceremonial = CASE WHEN ? = 1 THEN NULL ELSE bills.is_ceremonial END,
  -- HO 115: a bill whose summary resets gets a fresh shot at summarization.
  -- Clear the failure timestamp and attempt counter so the 24h-skip clause in
  -- runSummarize doesn't strand a re-synced bill on its prior failure record.
  summarize_failed_at = CASE WHEN ? = 1 THEN NULL ELSE bills.summarize_failed_at END,
  summarize_attempts = CASE WHEN ? = 1 THEN 0 ELSE bills.summarize_attempts END,
  -- HO 383: keep STORED stage fresh the moment an action advances, before
  -- re-summarization, so non-gated stage views (/bills?stage=, the funnel) are
  -- correct in the gap window. The advance decision (real update_date change +
  -- monotonic-only) is computed in TS (see upsertBill) and passed as a single
  -- nullable stage arg: non-null = advance to it, null = keep bills.stage. The
  -- SET RHS all read the OLD row, so previous_stage captures the pre-advance
  -- stage. When sync advances here it also logs the transition (HO 232/239)
  -- right after the upsert, so the later re-summarization noops and never
  -- double-logs.
  previous_stage = CASE WHEN ? IS NOT NULL THEN bills.stage ELSE bills.previous_stage END,
  stage_observed_at = COALESCE(?, bills.stage_observed_at),
  stage = COALESCE(?, bills.stage)
`;

// HO 790: what one write did, for the drain's tally: whether the summary reset and why, and the two moves the
// ruling counts without acting on.
type UpsertResult = { substantive: boolean; byAction: boolean; byText: boolean; crsMoved: boolean; titleMoved: boolean };

// HO 790: a count the detail omits reads 0. Congress.gov leaves textVersions out until a bill has text (HO 790's
// STEP 0: 406 stored bills without it, none with a count of 0), so a first text version reads as a change and two
// absences don't.
function countOf(v: unknown): number {
  return v == null ? 0 : Number(v);
}

// HO 790: null when the detail carries no update date and nothing was written.
async function upsertBill(
  db: ReturnType<typeof getDb>,
  detail: DetailBill,
): Promise<UpsertResult | null> {
  const id = billId(detail.congress, detail.type, detail.number);
  const update = effectiveUpdate(detail);
  if (!update) {
    console.warn(`skipping ${id}: no update date in detail`);
    return null;
  }
  const sponsor = detail.sponsors?.[0];
  const billType = String(detail.type).toLowerCase();
  const clusterId = classifyCluster(detail.title, billType);

  // HO 383: decide whether this sync advances the stored stage. Read the prior
  // row first so we can (a) gate on a real update_date change (since HO 790 no
  // longer the summary's trigger, which also needs a new action or text) and
  // (b) advance monotonically only (never regress; the runner still owns
  // LLM-disagreement downgrades via its pending logic). A brand-new bill (no
  // prior row) keeps the INSERT default stage (NULL) and is staged by the
  // runner at first summary, exactly as before.
  const computedStage = computeStage(detail.latestAction?.text ?? null);
  const prior = (
    await db.execute({
      sql: `SELECT stage, update_date, title, latest_action_date, latest_action_text,
                   json_extract(raw_json, '$.textVersions.count') AS text_versions,
                   json_extract(raw_json, '$.summaries.count') AS crs_summaries
            FROM bills WHERE id = ?`,
      args: [id],
    })
  ).rows[0];
  const priorStage = (prior?.stage as string | null) ?? null;
  const updateMoved = prior !== undefined && (prior.update_date as string | null) !== update;
  const stageAdvanced = updateMoved && stageRank(computedStage) > stageRank(priorStage);

  // HO 790: the summary reset (UPSERT_SQL) follows the latest action and the text versions, the two inputs of the
  // summarizer's prompt the ruling names; the CRS count and the title are read for the tally only.
  let byAction = false;
  let byText = false;
  let crsMoved = false;
  let titleMoved = false;
  if (prior !== undefined && updateMoved) {
    byAction =
      (prior.latest_action_date as string | null) !== (detail.latestAction?.actionDate ?? null) ||
      (prior.latest_action_text as string | null) !== (detail.latestAction?.text ?? null);
    byText = countOf(prior.text_versions) !== countOf(detail.textVersions?.count);
    crsMoved = countOf(prior.crs_summaries) !== countOf(detail.summaries?.count);
    titleMoved = (prior.title as string | null) !== detail.title;
  }
  const substantive = byAction || byText;
  const stageObservedAt = stageAdvanced ? new Date().toISOString() : null;
  const newStageArg = stageAdvanced ? computedStage : null;

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
      // HO 753 changed_at: written on insert, or when update_date moved (UPSERT_SQL).
      new Date().toISOString(),
      // HO 790: the summary reset's flag, once for each of its seven clauses (UPSERT_SQL).
      ...Array<number>(7).fill(substantive ? 1 : 0),
      // HO 383 stage trio (previous_stage gate, stage_observed_at, stage).
      newStageArg,
      stageObservedAt,
      newStageArg,
    ],
  });

  // HO 383: append the transition log (HO 232) when sync is the first to observe
  // the advance. Same shape/timestamp as the runner's write, so a transition is
  // logged exactly once regardless of which path sees it first.
  if (stageAdvanced) {
    await db.execute({
      // HO 635: writes the observation stamp under the name that describes it.
      // The one-release dual-write of the old `changed_at` column ended with the
      // contract migration that dropped it.
      sql: `INSERT INTO stage_transitions (bill_id, from_stage, to_stage, observed_at)
            VALUES (?, ?, ?, ?)`,
      args: [id, priorStage, computedStage, stageObservedAt],
    });
  }
  return { substantive, byAction, byText, crsMoved, titleMoved };
}

export type RunSyncOptions = {
  // An explicit start for the frontier listing. It never moves the frontier, and it turns the automatic wide listing
  // off.
  fromDateTime?: string;
  /**
   * HO 116: absolute epoch-millis past which runSync stops *starting* new
   * work: checked before each list page and before each queued bill. The 15s
   * per-detail AbortController bounds the in-flight bill on top of this,
   * mirroring runSummarize's pattern. HO 790: the route passes
   * `routeStart + 240_000` inside its 290s soft timeout, so trades still run
   * after the sync. What a tick doesn't reach stays queued for the next one.
   */
  deadlineMs?: number;
  // HO 790: the daily wide listing. true runs it, false never; unset (the route) runs it when bills_wide_at is
  // absent or its UTC date is before today's, unless fromDateTime is given.
  wide?: boolean;
  // HO 790: the queue this run labels its listings with and drains. Default `live`; a pass from the box uses
  // `backfill`.
  source?: QueueSource;
  // HO 790: false skips the listings and the frontier, so the run only drains (the pass's mode). Default true.
  listing?: boolean;
  // HO 790: the drain stops starting new bills once `resets` reaches this; the pass's pace cap. Unset on the route.
  maxResets?: number;
  // HO 790: the list pages' overlap, default 25. The legs set 0 as the control (scripts/diagnostic/sync-frontier-790.ts);
  // nothing else should.
  overlap?: number;
};

// HO 790: one listing from `from` to the end of the list, every entry into the queue (the wide listing first drops
// the ones its day compare passes over). Returns whether it reached the end, which a cut or a thrown page doesn't.
async function walkList(
  db: ReturnType<typeof getDb>,
  apiKey: string,
  from: string,
  cfg: { overlap: number; deadlineMs?: number; source: QueueSource; dayCompare: boolean },
  stats: SyncStats,
): Promise<boolean> {
  let offset = 0;
  try {
    while (true) {
      if (cfg.deadlineMs !== undefined && Date.now() >= cfg.deadlineMs) {
        stats.budgetStopped = true;
        console.log(`budget reached before list page offset=${offset}; the listing from ${from} is cut`);
        return false;
      }
      const page = await fetchJson<ListResponse>(listUrl(from, offset, apiKey));
      stats.pages++;
      if (offset === 0 && !cfg.dayCompare) stats.listedCount = page.pagination?.count ?? null;
      const bills = page.bills ?? [];
      console.log(`list from ${from} offset=${offset}: ${bills.length} bills`);

      // id → list day; the later day wins if a page names an id twice.
      const entries = new Map<string, string>();
      for (const lb of bills) {
        stats.seen++;
        const id = billId(lb.congress, lb.type, lb.number);
        const listUpdate = effectiveUpdate(lb);
        if (!listUpdate) {
          console.warn(`skip ${id}: list entry has no update date`);
          stats.skipped++;
          continue;
        }
        const day = listUpdate.slice(0, 10);
        const prev = entries.get(id);
        if (prev === undefined || day > prev) entries.set(id, day);
      }
      if (cfg.dayCompare && entries.size > 0) {
        const stored = await getStoredUpdates(db, [...entries.keys()]);
        for (const [id, day] of entries) {
          const s = stored.get(id);
          if (s !== undefined && s.slice(0, 10) >= day) {
            entries.delete(id);
            stats.skipped++;
          }
        }
      }
      stats.enqueued += await enqueue(db, entries, cfg.source);

      if (bills.length < PAGE_SIZE) return true;
      offset += PAGE_SIZE - cfg.overlap;
    }
  } catch (err) {
    stats.listError = redactSecrets((err as Error).message);
    console.error(`list from ${from} failed at offset=${offset}: ${stats.listError}`);
    return false;
  }
}

// HO 790: drain one queued bill. A row the drain doesn't clear is charged an attempt; the third deletes it.
async function drainOne(
  db: ReturnType<typeof getDb>,
  apiKey: string,
  row: { id: string; attempts: number },
  source: QueueSource,
  stats: SyncStats,
): Promise<void> {
  const { id } = row;
  const [congress, type, number] = id.split("-");
  let error: string | null = null;
  // HO 116: detail fetch is bounded by a 15s AbortController. Same shape
  // as runSummarize. `ac.signal.aborted` after a throw means the timer
  // fired; that bill counts as timedOut (subset of failed), and its queue
  // row stays for the next tick.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), PER_DETAIL_TIMEOUT_MS);
  try {
    const detailRes = await fetchJson<DetailResponse>(
      detailUrl(Number(congress), type ?? "", number ?? "", apiKey),
      ac.signal,
    );
    const detail = detailRes.bill;
    if (!detail) {
      console.warn(`skip ${id}: detail response missing bill`);
      error = "detail response missing bill";
    } else {
      const result = await upsertBill(db, detail);
      if (result === null) {
        error = "no update date in detail";
      } else {
        stats.upserted++;
        if (result.substantive) stats.resets++;
        if (result.byAction) stats.resetByAction++;
        if (result.byText) stats.resetByText++;
        if (result.crsMoved) stats.crsMoved++;
        if (result.crsMoved && !result.substantive) stats.crsOnly++;
        if (result.titleMoved) stats.titleMoved++;
        // Scoped to the drain's own source: a live listing that took this row over while the bill was in flight
        // keeps it, and the cron fetches it again.
        await db.execute({ sql: "DELETE FROM sync_queue WHERE bill_id = ? AND source = ?", args: [id, source] });
      }
    }
  } catch (err) {
    if (ac.signal.aborted) {
      stats.timedOut++;
      console.warn(`timeout ${id}: detail exceeded ${PER_DETAIL_TIMEOUT_MS}ms`);
      error = `detail exceeded ${PER_DETAIL_TIMEOUT_MS}ms`;
    } else {
      console.error(`failed ${id}:`, (err as Error).message);
      error = redactSecrets((err as Error).message);
    }
  } finally {
    clearTimeout(timer);
  }
  if (error === null) return;
  stats.failed++;
  const attempts = row.attempts + 1;
  if (attempts >= MAX_ATTEMPTS) {
    await db.execute({ sql: "DELETE FROM sync_queue WHERE bill_id = ? AND source = ?", args: [id, source] });
    stats.droppedCount++;
    if (stats.dropped.length < DROPPED_CAP) stats.dropped.push(id);
    console.warn(`dropped ${id} from the queue after ${attempts} failed fetches: ${error}`);
  } else {
    await db.execute({
      sql: "UPDATE sync_queue SET attempts = ?, last_error = ? WHERE bill_id = ? AND source = ?",
      args: [attempts, error.slice(0, 300), id, source],
    });
  }
}

// HO 790: the drain, oldest list day first, in rounds of DRAIN_BATCH until the queue is empty, the deadline arrives
// or the reset cap is reached. Each round reads past the previous one's last row, so a row that failed this tick
// waits for the next.
async function drain(
  db: ReturnType<typeof getDb>,
  apiKey: string,
  cfg: { source: QueueSource; deadlineMs?: number; maxResets?: number },
  stats: SyncStats,
): Promise<void> {
  let cursor: [string, string, string] | null = null;
  rounds: while (true) {
    const r = await db.execute(
      cursor === null
        ? {
            sql: `SELECT bill_id, list_update_day, enqueued_at, attempts FROM sync_queue
                  WHERE source = ? AND attempts < ?
                  ORDER BY list_update_day, enqueued_at, bill_id LIMIT ?`,
            args: [cfg.source, MAX_ATTEMPTS, DRAIN_BATCH],
          }
        : {
            sql: `SELECT bill_id, list_update_day, enqueued_at, attempts FROM sync_queue
                  WHERE source = ? AND attempts < ? AND (list_update_day, enqueued_at, bill_id) > (?, ?, ?)
                  ORDER BY list_update_day, enqueued_at, bill_id LIMIT ?`,
            args: [cfg.source, MAX_ATTEMPTS, ...cursor, DRAIN_BATCH],
          },
    );
    for (const row of r.rows) {
      // Checked before starting any bill, so the only thing that can push us past `deadlineMs` is the 15s
      // per-detail AbortController.
      if (cfg.deadlineMs !== undefined && Date.now() >= cfg.deadlineMs) {
        stats.budgetStopped = true;
        console.log(`budget reached after ${stats.upserted + stats.failed} queued bill(s); the rest wait for the next tick`);
        break rounds;
      }
      if (cfg.maxResets !== undefined && stats.resets >= cfg.maxResets) {
        console.log(`reset cap ${cfg.maxResets} reached; the drain stops starting bills`);
        break rounds;
      }
      const id = row.bill_id as string;
      cursor = [row.list_update_day as string, row.enqueued_at as string, id];
      await drainOne(db, apiKey, { id, attempts: Number(row.attempts) }, cfg.source, stats);
    }
    if (r.rows.length < DRAIN_BATCH) break;
  }
}

export async function runSync(opts: RunSyncOptions = {}): Promise<SyncStats> {
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");
  const db = getDb();

  const deadlineMs = opts.deadlineMs;
  const source: QueueSource = opts.source ?? "live";
  const overlap = opts.overlap ?? OVERLAP;
  const stats: SyncStats = {
    seen: 0,
    upserted: 0,
    skipped: 0,
    failed: 0,
    timedOut: 0,
    budgetStopped: false,
    fromDateTime: "",
    frontierBefore: null,
    frontierAfter: null,
    bootstrapped: false,
    listComplete: false,
    listError: null,
    pages: 0,
    listedCount: null,
    enqueued: 0,
    queueBefore: 0,
    queueAfter: 0,
    dropped: [],
    droppedCount: 0,
    wide: false,
    wideComplete: false,
    resets: 0,
    resetByAction: 0,
    resetByText: 0,
    crsMoved: 0,
    crsOnly: 0,
    titleMoved: 0,
  };
  stats.queueBefore = await queueDepth(db, source);

  // RECORD, HO 116's caveat and what retired it. Until HO 790 this function listed `updateDate desc` from
  // MAX(update_date) and wrote each bill as it went, and HO 116 wrote down what that cost: on a partial tick the
  // watermark advanced to the freshest bill written, and the older changes further down that tick's list fell below
  // the next tick's fromDateTime, "skipped until they update again on their own". It named the resolution,
  // `updateDate asc` plus an explicit cursor in `sync_state`, and deferred it "until evidence calls for it". The
  // evidence came at HO 752 (3 of 200 sampled committee-walked bills behind) and at HO 788 (8,287 of 19,127 stored
  // bills behind, 43.3%, 8,021 of them first owed by a tick that stopped). HO 790 built the resolution it named, with
  // a queue between the listing and the writes.
  if (opts.listing ?? true) {
    const explicit = opts.fromDateTime !== undefined;
    const { frontier, wideAt } = await getFrontier(db, stats);
    stats.frontierBefore = frontier;
    stats.frontierAfter = frontier;
    const from = opts.fromDateTime ?? frontier;
    stats.fromDateTime = from;
    console.log(
      `syncing bills listed since ${from}${explicit ? ` (explicit; the frontier ${frontier} stays)` : ""}` +
        (deadlineMs ? ` deadline=${new Date(deadlineMs).toISOString()}` : ""),
    );

    const listingStartedAt = Date.now();
    stats.listComplete = await walkList(db, apiKey, from, { overlap, deadlineMs, source, dayCompare: false }, stats);
    if (stats.listComplete && !explicit) {
      const next = isoSeconds(listingStartedAt - FRONTIER_MARGIN_MS);
      await setFrontier(db, next);
      stats.frontierAfter = next;
    }

    const today = new Date().toISOString().slice(0, 10);
    const wide = opts.wide ?? (!explicit && (wideAt === null || wideAt.slice(0, 10) < today));
    if (wide && stats.listComplete) {
      stats.wide = true;
      const wideFrom = isoSeconds(Date.parse(normalizeDateTime(from)) - WIDE_WINDOW_MS);
      console.log(`wide listing since ${wideFrom}: missing or behind at day precision`);
      stats.wideComplete = await walkList(db, apiKey, wideFrom, { overlap, deadlineMs, source, dayCompare: true }, stats);
      if (stats.wideComplete) await setSyncState(db, WIDE_KEY, new Date().toISOString());
    }
  }

  await drain(db, apiKey, { source, deadlineMs, maxResets: opts.maxResets }, stats);
  stats.queueAfter = await queueDepth(db, source);

  console.log(
    `done: seen=${stats.seen} enqueued=${stats.enqueued} upserted=${stats.upserted} resets=${stats.resets} ` +
      `skipped=${stats.skipped} failed=${stats.failed} timeout=${stats.timedOut} dropped=${stats.droppedCount} ` +
      `queue=${stats.queueBefore}→${stats.queueAfter} listComplete=${stats.listComplete} wide=${stats.wide} ` +
      `frontier=${stats.frontierBefore}→${stats.frontierAfter} budgetStopped=${stats.budgetStopped}` +
      (stats.listError ? ` listError=${stats.listError}` : ""),
  );
  return stats;
}
