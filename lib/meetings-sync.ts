// HO 263 committee-meetings (hearings) sync. HO 754: the table is the state, not a
// watermark.
//
// The list endpoint (committee-meeting/{N}/{chamber}) is sorted updateDate-DESC with NO
// server-side date filter, and the meeting DATE lives only on the detail record (HO 261
// probe). Until HO 754 the sync kept a per-chamber `meeting_sync_state` watermark and
// collected only events newer than it. HO 752 measured what that loses: a failed or null
// detail was passed over, an update landing exactly on the watermark was never collected,
// and a tie at an offset page boundary repeated one event and skipped another.
//
// Each run now reads each chamber's WHOLE list in pages of 250 that overlap by 25 (so a
// boundary that shifts by up to 25 places between two reads is re-read), deduplicated by
// eventId with the newest updateDate kept. Every listed event is compared with its stored
// row. No row, or a stored update_date older than the list's, is owed a refresh (the detail
// fetched and upserted); anything else is unchanged. upsertMeeting stores the DETAIL's
// updateDate, which agreed with the list's 104 of 104 at HO 752. Owed events are refreshed
// oldest list updateDate first across both chambers. No new event, and no retry, starts
// past the deadline; an event not reached stays owed, so the next run picks it up.
//
// A failed detail, or a 200 with no committeeMeeting, leaves the row as it was and is
// counted in committee_meeting_walk_state; a success resets it. Five running set the event
// aside, named in `gaveUp`, until its list updateDate moves past the one recorded at the
// fifth (it then gets five more). A stored row of this Congress that the chamber's list no
// longer carries is stamped `absent_upstream_at`, once, and only from a complete list read
// (every page read, paging ended, and the unique ids equal the list's own count); a row
// that reappears is cleared. Nothing is deleted, and the meeting queries hide absent rows.
// `meeting_sync_state` is no longer read or written (retired, HO 754).
//
// /api/cron/committee-meetings (HO 754, its own route) and `npm run sync:meetings` call
// the same function.
import { getCurrentCongress } from "./congress";
import { getDb } from "./db";
import { RECORDED_VOTE_DOC_SQL } from "./meeting-documents";
import { redactSecrets } from "./redact";

const API_BASE = "https://api.congress.gov/v3";
// HO 712: derived. Safe with no guard: an empty list for a Congress that has not met
// yet refreshes nothing, and the absent stamp is scoped to the current Congress's rows,
// so the previous Congress's rows are left as they are. The only DELETE here is scoped
// to an event being re-upserted. Carries the same tail tradeoff as committees-sync: once
// this rolls, a 119th meeting whose detail changes afterwards is no longer walked (SKILL,
// Congress rollover tradeoff).
const CONGRESS = getCurrentCongress();
const CHAMBERS = ["house", "senate"] as const;
type Chamber = (typeof CHAMBERS)[number];

const HTTP_TIMEOUT_MS = 15_000; // per-call abort (the list page is ~250 items)
const HTTP_TRIES = 8; // a list page: transient timeouts are common across a long walk
// HO 754 (review): one event's detail gets two tries, and both failing charges it. With
// eight, a detail that never answers held the head of the queue for the whole 50s every
// tick, uncharged, so it was never set aside and every newer meeting waited behind it.
const DETAIL_TRIES = 2;
const LIST_LIMIT = 250;
// HO 754: each page after the first starts 25 places before the previous one ended, so
// an event pushed across a boundary between two reads (an event above it deleted, or a
// tie reordered) is still read. The tie HO 752 caught at a boundary was six rows.
const LIST_OVERLAP = 25;
const LIST_MAX_PAGES = 40; // runaway backstop (1,611 House events at 225 a page is 8 pages)
const DETAIL_SLEEP_MS = 80; // pace detail calls; they share the CONGRESS_API_KEY budget
const DEFAULT_PER_TICK_LIMIT = 3_000; // detail attempts per run; about the whole corpus
// HO 754: five failed or null details running set an event aside until its list
// updateDate moves past the one recorded at the fifth.
export const GIVE_UP_AT = 5;
// HO 754: an attempt in flight at the deadline is aborted by the deadline plus this, so a
// run given a 50s deadline finishes inside the cron wrapper's 55s soft timeout.
const DEADLINE_GRACE_MS = 3_000;
// HO 754: more absent rows than this from one chamber's list in one run are not stamped.
// A list that reads complete but short (an upstream fault) would otherwise hide real
// meetings until the next run. HO 752 read 19 across both chambers, accumulated since June.
export const ABSENT_MAX_PER_RUN = 50;
const FAILED_IDS_MAX = 20;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function apiKey(): string {
  const k = process.env.CONGRESS_API_KEY;
  if (!k) throw new Error("CONGRESS_API_KEY is not set");
  // Trim defensively — a trailing newline/space in the env value (the local
  // .env has one) lands in the URL query and hangs/breaks the request.
  return k.trim();
}

// HO 754: the deadline refused a new attempt, or cut one in flight. `ownFailures` counts the
// attempts before it that failed on their own clock (a full-length timeout, or a network
// error), not by the deadline's cap. With none, nothing is charged and the event stays owed;
// with some, the event had its tries and the walk charges it (review).
export class MeetingsDeadlineError extends Error {
  constructor(
    label: string,
    public ownFailures = 0,
    lastError: string | null = null,
  ) {
    super(`${label}: stopped at the deadline${lastError ? ` after ${ownFailures} failed attempt(s), the last: ${lastError}` : ""}`);
    this.name = "MeetingsDeadlineError";
  }
}

// HO 754: a 429 ends the walk (the key's hourly budget is shared with every other
// Congress.gov caller); nothing is charged.
export class MeetingsRateLimitedError extends Error {
  constructor(label: string) {
    super(`${label}: HTTP 429`);
    this.name = "MeetingsRateLimitedError";
  }
}

// Congress.gov occasionally times out; retry the per-call abort with a short backoff
// before giving up. Non-200 (a real error answer) is NOT retried. HO 754: no attempt
// starts at or past `deadline`, and an attempt's abort is capped at the deadline plus
// DEADLINE_GRACE_MS, so the retries cannot carry a run past its budget.
async function getJson<T>(
  url: string,
  label: string,
  deadline = Number.POSITIVE_INFINITY,
  tries = HTTP_TRIES,
): Promise<T> {
  let lastErr: unknown;
  let ownFailures = 0;
  const lastMessage = () => (lastErr == null ? null : redactSecrets(lastErr instanceof Error ? lastErr.message : String(lastErr)));
  for (let attempt = 0; attempt < tries; attempt++) {
    const now = Date.now();
    if (now >= deadline) throw new MeetingsDeadlineError(label, ownFailures, lastMessage());
    const timeoutMs = Math.min(HTTP_TIMEOUT_MS, deadline + DEADLINE_GRACE_MS - now);
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
      if (res.status === 429) throw new MeetingsRateLimitedError(label);
      if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      if (err instanceof MeetingsRateLimitedError) throw err;
      if (err instanceof Error && /HTTP \d/.test(err.message)) throw err; // real error answer
      // A timeout under the deadline's cap is the deadline's doing, not the attempt's own.
      const capped = timeoutMs < HTTP_TIMEOUT_MS && err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      if (!capped) {
        ownFailures++;
        lastErr = err;
      }
      if (Date.now() >= deadline) throw new MeetingsDeadlineError(label, ownFailures, lastMessage()); // cut by the deadline
      // Spaced backoff to outlast a flaky burst, never sleeping past the deadline.
      if (attempt + 1 < tries) await sleep(Math.min(1000 * (attempt + 1), Math.max(0, deadline - Date.now())));
    }
  }
  throw new Error(`${label} failed after ${ownFailures} attempt(s): ${lastMessage() ?? "no answer"}`);
}

// --- list (thin, whole) ---------------------------------------------------

type ListRead = {
  items: Map<string, string>; // eventId → the newest updateDate read for it
  pages: number;
  count: number | null; // the list's own pagination.count, from the last page read
  countMoved: boolean; // a page reported a count different from the first page's
  complete: boolean;
  error: string | null;
  stop: "deadline" | "rate-limited" | null;
};

// HO 754: the whole list, newest→oldest, in pages of LIST_LIMIT that overlap by
// LIST_OVERLAP, deduplicated by eventId. Complete means every page came back, paging
// ended (no `next`, or a short page), every page reported the same count, and the unique
// ids equal it. Only a complete read may stamp a row absent. The steady count matters
// (review): an event already read being deleted while one not yet read moves to the head
// leaves the unique ids equal to the final count with the moved one never read.
// A page that fails keeps what was read before it.
async function readWholeList(chamber: Chamber, deadline: number): Promise<ListRead> {
  const key = apiKey();
  const items = new Map<string, string>();
  let offset = 0;
  let pages = 0;
  let count: number | null = null;
  let countMoved = false;
  let ended = false;
  try {
    while (pages < LIST_MAX_PAGES) {
      const url = `${API_BASE}/committee-meeting/${CONGRESS}/${chamber}?api_key=${key}&format=json&limit=${LIST_LIMIT}&offset=${offset}`;
      const j = await getJson<{
        committeeMeetings?: Array<{ eventId?: string | number; updateDate?: string }>;
        pagination?: { next?: string; count?: number };
      }>(url, `meetings list ${chamber} @${offset}`, deadline);
      pages++;
      const rows = j.committeeMeetings ?? [];
      if (j.pagination?.count != null) {
        const c = Number(j.pagination.count);
        if (count != null && c !== count) countMoved = true;
        count = c;
      }
      for (const r of rows) {
        if (r.eventId == null || !r.updateDate) continue;
        const id = String(r.eventId);
        const prev = items.get(id);
        if (prev === undefined || r.updateDate > prev) items.set(id, r.updateDate);
      }
      if (!j.pagination?.next || rows.length < LIST_LIMIT) {
        ended = true;
        break;
      }
      offset += LIST_LIMIT - LIST_OVERLAP;
    }
  } catch (err) {
    const stop =
      err instanceof MeetingsDeadlineError ? "deadline" : err instanceof MeetingsRateLimitedError ? "rate-limited" : null;
    const error = redactSecrets(err instanceof Error ? err.message : String(err));
    return { items, pages, count, countMoved, complete: false, error, stop };
  }
  return { items, pages, count, countMoved, complete: ended && !countMoved && count != null && items.size === count, error: null, stop: null };
}

// --- detail -------------------------------------------------------------

export type ApiMeeting = {
  eventId?: string;
  chamber?: string;
  congress?: number;
  date?: string;
  type?: string;
  meetingStatus?: string;
  title?: string;
  location?: { building?: string; room?: string };
  updateDate?: string;
  committees?: Array<{ systemCode?: string }>;
  videos?: Array<{ name?: string; url?: string }>;
  relatedItems?: {
    bills?: Array<{ congress?: number; type?: string; number?: string | number }>;
  };
  // HO 717: stored as filed in committee_meeting_documents. Any key may be absent
  // upstream (STEP 0: 18 of 2,185 entries had no name, 15 no url).
  meetingDocuments?: Array<{ documentType?: string; format?: string; name?: string; url?: string }>;
};

export async function fetchMeetingDetail(
  chamber: Chamber,
  eventId: string,
  deadline = Number.POSITIVE_INFINITY,
): Promise<ApiMeeting | null> {
  const url = `${API_BASE}/committee-meeting/${CONGRESS}/${chamber}/${eventId}?api_key=${apiKey()}&format=json`;
  const j = await getJson<{ committeeMeeting?: ApiMeeting }>(
    url,
    `meeting detail ${chamber}/${eventId}`,
    deadline,
    DETAIL_TRIES,
  );
  return j.committeeMeeting ?? null;
}

// The watch link is the videos[] entry whose host is NOT api.congress.gov (that
// one's the API referrer). House → youtube.com, Senate → senate.gov/isvp. Null
// when no videos[] or only the referrer is present (HO 261).
// videos[] carries TWO entries per event: the congress.gov event-page referrer
// (api. OR www.) and the actual broadcast link — youtube.com (House) or
// senate.gov/isvp (Senate). Skip ANY congress.gov host and return the first
// real watch link; null when there's no videos[] (no broadcast on record).
function extractVideoUrl(videos: ApiMeeting["videos"]): string | null {
  for (const v of videos ?? []) {
    if (v.url && !/(^|\/\/)([a-z0-9-]+\.)*congress\.gov/i.test(v.url)) return v.url;
  }
  return null;
}

// relatedItems.bills[] → bill ids in our `{congress}-{type}-{number}` form. The
// messier meetingDocuments PDF-name path is deliberately NOT parsed in v1 (HO 717
// stores those documents as filed — documentStatements — but still parses nothing).
function extractBillIds(m: ApiMeeting): string[] {
  const ids: string[] = [];
  for (const b of m.relatedItems?.bills ?? []) {
    if (b.congress == null || !b.type || b.number == null) continue;
    ids.push(`${b.congress}-${String(b.type).toLowerCase()}-${b.number}`);
  }
  return [...new Set(ids)];
}

// HO 717: an event's documents as a delete-then-insert (so a document the upstream
// withdraws clears), every entry kept as filed and keyed by its array position,
// then ONE trailing SELECT that counts the recorded-vote documents under the shared
// predicate — the count comes out of the same batch, not a second round trip, and
// not a JS copy of the rule.
function documentStatements(
  eventId: string,
  docs: ApiMeeting["meetingDocuments"],
): { sql: string; args: (string | number | null)[] }[] {
  const stmts: { sql: string; args: (string | number | null)[] }[] = [
    { sql: "DELETE FROM committee_meeting_documents WHERE event_id = ?", args: [eventId] },
  ];
  (docs ?? []).forEach((d, ord) => {
    stmts.push({
      sql: `INSERT INTO committee_meeting_documents (event_id, ord, name, document_type, url)
            VALUES (?, ?, ?, ?, ?)`,
      args: [eventId, ord, d.name ?? null, d.documentType ?? null, d.url ?? null],
    });
  });
  stmts.push({
    sql: `SELECT COUNT(*) AS n FROM committee_meeting_documents
          WHERE event_id = ? AND ${RECORDED_VOTE_DOC_SQL}`,
    args: [eventId],
  });
  return stmts;
}

export type DocumentWrite = { documents: number; recordedVoteDocs: number };

function readDocumentCount(
  results: { rows: unknown[] }[],
  documents: number,
): DocumentWrite {
  const last = results[results.length - 1];
  const row = last?.rows[0] as { n?: unknown } | undefined;
  return { documents, recordedVoteDocs: Number(row?.n ?? 0) };
}

// The backfill's write: documents only, for events synced before HO 717 stored any.
// It does not touch committee_meetings or meeting_bills, so it rewrites no column the
// walk owns.
export async function writeMeetingDocuments(m: ApiMeeting): Promise<DocumentWrite> {
  const eventId = m.eventId!;
  const docs = m.meetingDocuments ?? [];
  const results = await getDb().batch(documentStatements(eventId, docs), "write");
  return readDocumentCount(results, docs.length);
}

// One event → committee_meetings upsert + a delete-then-insert of its meeting_bills
// (so a meeting that loses a bill association clears) + its documents (HO 717), all
// in one batch. HO 754: the same batch clears the row's absent stamp (the event was
// just read upstream) and resets its walk state, so a refresh that lands is never
// half-recorded.
async function upsertMeeting(
  chamber: Chamber,
  m: ApiMeeting,
): Promise<{ billRows: number } & DocumentWrite> {
  const db = getDb();
  const eventId = m.eventId!;
  const billIds = extractBillIds(m);
  const stmts: { sql: string; args: (string | number | null)[] }[] = [
    {
      sql: `INSERT INTO committee_meetings
              (event_id, congress, chamber, meeting_date, meeting_type, meeting_status,
               title, location_building, location_room, video_url, committee_system_code, update_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(event_id) DO UPDATE SET
              meeting_date = excluded.meeting_date,
              meeting_type = excluded.meeting_type,
              meeting_status = excluded.meeting_status,
              title = excluded.title,
              location_building = excluded.location_building,
              location_room = excluded.location_room,
              video_url = excluded.video_url,
              committee_system_code = excluded.committee_system_code,
              update_date = excluded.update_date,
              absent_upstream_at = NULL`,
      args: [
        eventId,
        m.congress ?? CONGRESS,
        chamber,
        m.date ?? null,
        m.type ?? null,
        m.meetingStatus ?? null,
        m.title ?? null,
        m.location?.building ?? null,
        m.location?.room ?? null,
        extractVideoUrl(m.videos),
        m.committees?.[0]?.systemCode ?? null,
        m.updateDate ?? new Date().toISOString(),
      ],
    },
    { sql: "DELETE FROM meeting_bills WHERE event_id = ?", args: [eventId] },
  ];
  for (const billId of billIds) {
    stmts.push({
      sql: `INSERT OR IGNORE INTO meeting_bills (event_id, bill_id) VALUES (?, ?)`,
      args: [eventId, billId],
    });
  }
  stmts.push({
    sql: `UPDATE committee_meeting_walk_state
             SET failures = 0, gave_up_at_update = NULL, last_error = NULL, last_attempt_at = ?
           WHERE event_id = ?`,
    args: [new Date().toISOString(), eventId],
  });
  const docs = m.meetingDocuments ?? [];
  stmts.push(...documentStatements(eventId, docs)); // last: readDocumentCount reads its SELECT
  const results = await db.batch(stmts, "write");
  return { billRows: billIds.length, ...readDocumentCount(results, docs.length) };
}

// --- driver -------------------------------------------------------------

type Owed = { chamber: Chamber; eventId: string; updateDate: string; returned: boolean };

// HO 754: a failed or null detail. Returns whether this failure set the event aside.
// An event back from a give-up (its list updateDate moved past the recorded one)
// starts again at 1.
async function recordFailure(item: Owed, error: string): Promise<boolean> {
  const rs = await getDb().execute({
    sql: `INSERT INTO committee_meeting_walk_state
            (event_id, failures, last_attempt_at, last_error, gave_up_at_update)
          VALUES (:id, 1, :at, :err, CASE WHEN 1 >= :cap THEN :upd END)
          ON CONFLICT(event_id) DO UPDATE SET
            failures = CASE WHEN :ret THEN 1 ELSE failures + 1 END,
            last_attempt_at = excluded.last_attempt_at,
            last_error = excluded.last_error,
            gave_up_at_update = CASE WHEN (CASE WHEN :ret THEN 1 ELSE failures + 1 END) >= :cap THEN :upd END
          RETURNING failures`,
    args: {
      id: item.eventId,
      at: new Date().toISOString(),
      err: error.slice(0, 500),
      cap: GIVE_UP_AT,
      upd: item.updateDate,
      ret: item.returned ? 1 : 0,
    },
  });
  return Number(rs.rows[0]?.failures ?? 0) >= GIVE_UP_AT;
}

export type MeetingsStopReason = "complete" | "deadline" | "cap" | "rate-limited";

export type MeetingsSyncResult = {
  stopReason: MeetingsStopReason;
  pages: Record<Chamber, number>; // list pages read
  listSize: Record<Chamber, number>; // unique events read
  listCount: Record<Chamber, number | null>; // the list's own count
  listComplete: Record<Chamber, boolean>;
  listErrors: string[];
  refreshed: number; // details fetched and upserted
  unchanged: number; // listed events whose stored row is current
  remaining: number; // owed events the run did not reach (deadline, cap or stop)
  failed: { count: number; ids: string[] }; // failed or null details this run (ids capped at 20)
  gaveUp: { count: number; ids: string[] }; // owed events set aside after GIVE_UP_AT (ids capped at 20)
  absent: { stamped: number; cleared: number; refused: string[]; skipped: string[] };
  billRowsUpserted: number;
  documentsStored: number; // HO 717: committee_meeting_documents rows written this run
  recordedVoteDocs: number; // HO 717: of those, rows matching RECORDED_VOTE_DOC_SQL
};

export type SyncMeetingsOptions = {
  deadlineMs?: number; // absolute Date.now() deadline; no new detail, page or retry starts past it
  perTickLimit?: number; // hard cap on detail attempts per run (default ~corpus)
};

export async function syncMeetings(
  opts: SyncMeetingsOptions = {},
): Promise<MeetingsSyncResult> {
  const deadline = opts.deadlineMs ?? Number.POSITIVE_INFINITY;
  const limit = opts.perTickLimit ?? DEFAULT_PER_TICK_LIMIT;
  const db = getDb();
  const r: MeetingsSyncResult = {
    stopReason: "complete",
    pages: { house: 0, senate: 0 },
    listSize: { house: 0, senate: 0 },
    listCount: { house: null, senate: null },
    listComplete: { house: false, senate: false },
    listErrors: [],
    refreshed: 0,
    unchanged: 0,
    remaining: 0,
    failed: { count: 0, ids: [] },
    gaveUp: { count: 0, ids: [] },
    absent: { stamped: 0, cleared: 0, refused: [], skipped: [] },
    billRowsUpserted: 0,
    documentsStored: 0,
    recordedVoteDocs: 0,
  };
  let stop: Exclude<MeetingsStopReason, "complete"> | null = null;

  // Every stored row and every walk state, once (2,758 rows and none at HO 754).
  const stored = new Map(
    (await db.execute(
      "SELECT event_id, congress, chamber, update_date, absent_upstream_at FROM committee_meetings",
    )).rows.map((x) => [
      String(x.event_id),
      {
        congress: Number(x.congress),
        chamber: String(x.chamber),
        updateDate: String(x.update_date),
        absent: x.absent_upstream_at == null ? null : String(x.absent_upstream_at),
      },
    ]),
  );
  const walk = new Map(
    (await db.execute(
      "SELECT event_id, failures, gave_up_at_update FROM committee_meeting_walk_state",
    )).rows.map((x) => [
      String(x.event_id),
      {
        failures: Number(x.failures ?? 0),
        gaveUpAt: x.gave_up_at_update == null ? null : String(x.gave_up_at_update),
      },
    ]),
  );

  const owed: Owed[] = [];
  const gaveUp: string[] = [];
  const listErrors: string[] = [];
  let listsRead = 0;
  for (const chamber of CHAMBERS) {
    if (stop) {
      r.absent.skipped.push(`${chamber}: list not read (${stop})`);
      continue;
    }
    const list = await readWholeList(chamber, deadline);
    r.pages[chamber] = list.pages;
    r.listSize[chamber] = list.items.size;
    r.listCount[chamber] = list.count;
    r.listComplete[chamber] = list.complete;
    if (list.error) listErrors.push(`${chamber}: ${list.error}`);
    if (list.stop) stop = list.stop;
    if (list.items.size > 0 || list.complete) listsRead++;

    // Absent. A listed row that carries a stamp is cleared from any read; a stored row
    // of this Congress and chamber that the list does not carry is stamped from a
    // complete read only, and not at all past ABSENT_MAX_PER_RUN.
    const now = new Date().toISOString();
    const clear = [...list.items.keys()].filter((id) => stored.get(id)?.absent != null);
    let stampIds: string[] = [];
    if (!list.complete) {
      r.absent.skipped.push(`${chamber}: list incomplete (${list.items.size} unique of ${list.count ?? "?"}${list.countMoved ? ", the count moved during the read" : ""})`);
    } else {
      stampIds = [...stored]
        .filter(([id, s]) => s.congress === CONGRESS && s.chamber === chamber && s.absent == null && !list.items.has(id))
        .map(([id]) => id);
      if (stampIds.length > ABSENT_MAX_PER_RUN) {
        r.absent.refused.push(`${chamber}: ${stampIds.length} rows not listed, more than ${ABSENT_MAX_PER_RUN}`);
        stampIds = [];
      }
    }
    const absentStmts: { sql: string; args: string[] }[] = [];
    for (let i = 0; i < clear.length; i += 200) {
      const part = clear.slice(i, i + 200);
      absentStmts.push({
        sql: `UPDATE committee_meetings SET absent_upstream_at = NULL
               WHERE event_id IN (${part.map(() => "?").join(",")})`,
        args: part,
      });
    }
    for (let i = 0; i < stampIds.length; i += 200) {
      const part = stampIds.slice(i, i + 200);
      absentStmts.push({
        sql: `UPDATE committee_meetings SET absent_upstream_at = ?
               WHERE absent_upstream_at IS NULL AND event_id IN (${part.map(() => "?").join(",")})`,
        args: [now, ...part],
      });
    }
    if (absentStmts.length) await db.batch(absentStmts, "write");
    r.absent.cleared += clear.length;
    r.absent.stamped += stampIds.length;

    // Compare every listed event with its stored row.
    for (const [id, updateDate] of list.items) {
      const s = stored.get(id);
      if (s && s.updateDate >= updateDate) {
        r.unchanged++;
        continue;
      }
      const w = walk.get(id);
      if (w && w.failures >= GIVE_UP_AT && w.gaveUpAt != null && updateDate <= w.gaveUpAt) {
        gaveUp.push(id);
        continue;
      }
      owed.push({ chamber, eventId: id, updateDate, returned: w?.gaveUpAt != null && updateDate > w.gaveUpAt });
    }
  }
  // Nothing read from either chamber is an outage, not a quiet run, and records `error`,
  // even when the deadline is what ended the reads (review: a list that only times out
  // spends the whole budget on retries). A 429 stays a success row, named in chronicErr.
  if (listsRead === 0 && stop !== "rate-limited") {
    throw new Error(`meetings lists unread: ${listErrors.join("; ") || "no pages"}`);
  }

  // Refresh, oldest list updateDate first across both chambers.
  owed.sort((a, b) => a.updateDate.localeCompare(b.updateDate) || a.eventId.localeCompare(b.eventId));
  const failedIds: string[] = [];
  let attempts = 0;
  let i = 0;
  let chargedAtStop = 0; // the event the deadline stopped on, charged because it had its tries
  for (; i < owed.length && !stop; i++) {
    const item = owed[i]!;
    if (Date.now() >= deadline) {
      stop = "deadline";
      break;
    }
    if (attempts >= limit) {
      stop = "cap";
      break;
    }
    attempts++;
    try {
      const detail = await fetchMeetingDetail(item.chamber, item.eventId, deadline);
      if (!detail) throw new Error(`meeting detail ${item.chamber}/${item.eventId}: 200 with no committeeMeeting`);
      const w = await upsertMeeting(item.chamber, detail);
      r.refreshed++;
      r.billRowsUpserted += w.billRows;
      r.documentsStored += w.documents;
      r.recordedVoteDocs += w.recordedVoteDocs;
    } catch (err) {
      if (err instanceof MeetingsDeadlineError) {
        // Its tries failed on their own clock before the deadline stopped the next one:
        // charged, like any failure, so a detail that never answers is set aside at five
        // rather than holding the head of the queue every run (review). Cut by the
        // deadline's cap alone, or refused before its first try: not charged.
        if (err.ownFailures > 0) {
          const msg = redactSecrets(err.message);
          console.warn(`[meetings] ${item.chamber}/${item.eventId} failed:`, msg);
          failedIds.push(item.eventId);
          if (await recordFailure(item, msg)) gaveUp.push(item.eventId);
          chargedAtStop = 1;
        }
        stop = "deadline";
        break;
      }
      if (err instanceof MeetingsRateLimitedError) {
        stop = "rate-limited";
        break;
      }
      const msg = redactSecrets(err instanceof Error ? err.message : String(err));
      console.warn(`[meetings] ${item.chamber}/${item.eventId} failed:`, msg);
      failedIds.push(item.eventId);
      if (await recordFailure(item, msg)) gaveUp.push(item.eventId);
    }
    await sleep(DETAIL_SLEEP_MS);
  }

  r.stopReason = stop ?? "complete";
  r.remaining = owed.length - i - chargedAtStop; // owed events the run did not reach
  r.listErrors = listErrors;
  r.failed = { count: failedIds.length, ids: failedIds.slice(0, FAILED_IDS_MAX) };
  r.gaveUp = { count: gaveUp.length, ids: gaveUp.slice(0, FAILED_IDS_MAX) };
  return r;
}
