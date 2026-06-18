// HO 263 committee-meetings (hearings) sync — Phase 1 data layer, no UI.
// Mirrors lib/committees-sync.ts in shape (Congress.gov, CONGRESS=119, an 8s
// AbortSignal per call, a dashboard_state-style cursor, db.batch upserts,
// deadline-budgeted). Separate file from committees-sync (committees stayed
// separate from bills). The /api/cron/committees route folds the meetings step
// in after the committee sync, deadline-guarded + non-fatal (HO 263 Cron).
//
// The wrinkle (HO 261 probe): the list endpoint (committee-meeting/119/{chamber})
// is sorted updateDate-DESC with NO server-side date filter, and the meeting DATE
// lives only on the detail record. So the cursor is a per-chamber update_date
// watermark: each run COLLECTS the thin list newest→oldest until it hits an event
// at/older than the watermark (the synced tail), PROCESSES the collected set
// oldest-first (fetching detail per event), and advances the watermark per
// COMPLETED event — so a deadline-interrupted tick keeps its progress and the
// next tick resumes forward (the HO 116/143 forward-drain, adapted).
import { getDb } from "./db";

const API_BASE = "https://api.congress.gov/v3";
const CONGRESS = 119;
const CHAMBERS = ["house", "senate"] as const;
type Chamber = (typeof CHAMBERS)[number];

const HTTP_TIMEOUT_MS = 15_000; // per-call abort (the list page is ~250 items)
const HTTP_TRIES = 8; // transient timeouts are common across ~2,400 calls
const LIST_LIMIT = 250;
const CURSOR_COMMIT_EVERY = 50; // persist progress mid-backfill (HO 120 per-unit-commit)
const LIST_MAX_PAGES = 40; // runaway backstop (1,439 House / 250 ≈ 6 pages)
const DETAIL_SLEEP_MS = 80; // pace detail calls — they share the CONGRESS_API_KEY budget
const DEFAULT_PER_TICK_LIMIT = 3_000; // ~the full corpus; the CLI backfill drains it

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function apiKey(): string {
  const k = process.env.CONGRESS_API_KEY;
  if (!k) throw new Error("CONGRESS_API_KEY is not set");
  // Trim defensively — a trailing newline/space in the env value (the local
  // .env has one) lands in the URL query and hangs/breaks the request.
  return k.trim();
}

// Congress.gov occasionally times out under the 2,400-call backfill; retry the
// per-call abort a couple times with a short backoff before giving up. Non-200
// (a real error answer) is NOT retried.
async function getJson<T>(url: string, label: string): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < HTTP_TRIES; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) });
      if (!res.ok) throw new Error(`${label} HTTP ${res.status}`);
      return (await res.json()) as T;
    } catch (err) {
      lastErr = err;
      if (err instanceof Error && /HTTP \d/.test(err.message)) throw err; // real error answer
      await sleep(1000 * (attempt + 1)); // spaced backoff to outlast a flaky burst
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(`${label} failed`);
}

// --- cursor (per-chamber high-watermark) --------------------------------

async function readCursor(chamber: Chamber): Promise<string> {
  const db = getDb();
  const rs = await db.execute({
    sql: "SELECT update_date FROM meeting_sync_state WHERE chamber = ?",
    args: [chamber],
  });
  return (rs.rows[0]?.update_date as string | undefined) ?? "1970-01-01T00:00:00Z";
}

async function writeCursor(chamber: Chamber, value: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO meeting_sync_state (chamber, update_date)
          VALUES (?, ?)
          ON CONFLICT(chamber) DO UPDATE SET update_date = excluded.update_date`,
    args: [chamber, value],
  });
}

// --- list (thin) --------------------------------------------------------

type ListItem = { eventId: string; updateDate: string };

// Page the list newest→oldest, collecting events strictly newer than the
// watermark; stop as soon as a page yields an event at/older than it (the synced
// tail) or the list ends. Cheap (no detail fetch). On the first backfill the
// watermark is epoch, so this pages the whole list (~6/4 pages) — still thin.
async function collectNewEvents(
  chamber: Chamber,
  watermark: string,
): Promise<ListItem[]> {
  const key = apiKey();
  const out: ListItem[] = [];
  let offset = 0;
  let pages = 0;
  while (pages < LIST_MAX_PAGES) {
    const url = `${API_BASE}/committee-meeting/${CONGRESS}/${chamber}?api_key=${key}&format=json&limit=${LIST_LIMIT}&offset=${offset}`;
    const j = await getJson<{
      committeeMeetings?: Array<{ eventId?: string; updateDate?: string }>;
      pagination?: { next?: string };
    }>(url, `meetings list ${chamber} @${offset}`);
    const rows = j.committeeMeetings ?? [];
    pages++;
    let hitTail = false;
    for (const r of rows) {
      if (!r.eventId || !r.updateDate) continue;
      if (r.updateDate > watermark) {
        out.push({ eventId: r.eventId, updateDate: r.updateDate });
      } else {
        hitTail = true; // newest-first → everything past here is already synced
        break;
      }
    }
    if (hitTail || !j.pagination?.next || rows.length < LIST_LIMIT) break;
    offset += LIST_LIMIT;
  }
  return out;
}

// --- detail -------------------------------------------------------------

type ApiMeeting = {
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
};

async function fetchMeetingDetail(
  chamber: Chamber,
  eventId: string,
): Promise<ApiMeeting | null> {
  const url = `${API_BASE}/committee-meeting/${CONGRESS}/${chamber}/${eventId}?api_key=${apiKey()}&format=json`;
  const j = await getJson<{ committeeMeeting?: ApiMeeting }>(
    url,
    `meeting detail ${chamber}/${eventId}`,
  );
  return j.committeeMeeting ?? null;
}

// The watch link is the videos[] entry whose host is NOT api.congress.gov (that
// one's the API referrer). House → youtube.com, Senate → senate.gov/isvp. Null
// when no videos[] or only the referrer is present (HO 261).
function extractVideoUrl(videos: ApiMeeting["videos"]): string | null {
  for (const v of videos ?? []) {
    if (v.url && !/(^|\/\/)api\.congress\.gov/i.test(v.url)) return v.url;
  }
  return null;
}

// relatedItems.bills[] → bill ids in our `{congress}-{type}-{number}` form. The
// messier meetingDocuments PDF-name path is deliberately NOT parsed in v1.
function extractBillIds(m: ApiMeeting): string[] {
  const ids: string[] = [];
  for (const b of m.relatedItems?.bills ?? []) {
    if (b.congress == null || !b.type || b.number == null) continue;
    ids.push(`${b.congress}-${String(b.type).toLowerCase()}-${b.number}`);
  }
  return [...new Set(ids)];
}

// One event → committee_meetings upsert + a delete-then-insert of its meeting_bills
// (so a meeting that loses a bill association clears), all in one batch.
async function upsertMeeting(chamber: Chamber, m: ApiMeeting): Promise<number> {
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
              update_date = excluded.update_date`,
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
  await db.batch(stmts, "write");
  return billIds.length;
}

// --- driver -------------------------------------------------------------

export type MeetingsSyncResult = {
  meetingsUpserted: number;
  billRowsUpserted: number;
  fetchErrors: number;
  deadlineHit: boolean;
  perChamber: Record<Chamber, { collected: number; processed: number; cursorEnd: string }>;
};

export type SyncMeetingsOptions = {
  deadlineMs?: number; // absolute Date.now() deadline; stops starting new detail fetches past this
  perTickLimit?: number; // hard cap on events per run (default ~corpus)
};

export async function syncMeetings(
  opts: SyncMeetingsOptions = {},
): Promise<MeetingsSyncResult> {
  const deadline = opts.deadlineMs ?? Number.POSITIVE_INFINITY;
  let budget = opts.perTickLimit ?? DEFAULT_PER_TICK_LIMIT;

  let meetingsUpserted = 0;
  let billRowsUpserted = 0;
  let fetchErrors = 0;
  let deadlineHit = false;
  const perChamber = {
    house: { collected: 0, processed: 0, cursorEnd: "" },
    senate: { collected: 0, processed: 0, cursorEnd: "" },
  } as MeetingsSyncResult["perChamber"];

  for (const chamber of CHAMBERS) {
    const cursorStart = await readCursor(chamber);
    perChamber[chamber].cursorEnd = cursorStart;
    if (deadlineHit || budget <= 0) continue;

    // Collect newest→oldest, then process oldest-first so the watermark advances
    // forward and a partial tick resumes cleanly.
    const collected = await collectNewEvents(chamber, cursorStart);
    collected.sort((a, b) => a.updateDate.localeCompare(b.updateDate));
    perChamber[chamber].collected = collected.length;

    let cursorEnd = cursorStart;
    for (const item of collected) {
      if (Date.now() >= deadline) {
        deadlineHit = true;
        break;
      }
      if (budget <= 0) break;
      try {
        const detail = await fetchMeetingDetail(chamber, item.eventId);
        if (detail) {
          billRowsUpserted += await upsertMeeting(chamber, detail);
          meetingsUpserted++;
        }
      } catch (err) {
        fetchErrors++;
        console.warn(
          `[meetings] ${chamber}/${item.eventId} failed:`,
          err instanceof Error ? err.message : err,
        );
      }
      perChamber[chamber].processed++;
      budget--;
      cursorEnd = item.updateDate; // advance per attempted-and-completed event
      // Persist progress periodically so a crash mid-backfill resumes forward
      // (the list is processed oldest-first, so the watermark only moves up).
      if (perChamber[chamber].processed % CURSOR_COMMIT_EVERY === 0) {
        await writeCursor(chamber, cursorEnd);
        perChamber[chamber].cursorEnd = cursorEnd;
      }
      await sleep(DETAIL_SLEEP_MS);
    }

    if (cursorEnd !== cursorStart) {
      await writeCursor(chamber, cursorEnd);
      perChamber[chamber].cursorEnd = cursorEnd;
    }
  }

  return { meetingsUpserted, billRowsUpserted, fetchErrors, deadlineHit, perChamber };
}
