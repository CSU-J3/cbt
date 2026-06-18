# 263 — Committee meetings data layer (hearings)

## What this is

Phase 1 of the hearings surface: schema, sync pipeline, query helpers. No UI. Mirrors HO 143 (committee data layer) in shape — data lands in the DB, a cron keeps it fresh, the dashboard doesn't change yet. Sync logic mirrors `lib/committees-sync.ts`; the cron wiring follows the external-source house pattern the HO 262 sweep documented (third-party syncs ride existing crons), so the meetings sync rides the committees cron rather than taking its own slot — see Cron. The UI (a hearings calendar/list surface, plus a committee-detail "this week" cut and a bill-hub "hearings covering this bill" link) goes to the Design chat for a masthead/nav/row-parity spec, then a later build handoff.

The framing-question payoff: "what is Congress actually doing in the room this week, and which bills is it about." The HO 261 probe confirmed `committee-meeting` is the spine.

## Pre-flight (verify current state, don't assume — copy lags live)

Before writing schema or sync, confirm these against the live repo and report in chat:

1. The current committee-sync file name and cron route — handoff log says `lib/committees-sync.ts` and `/api/cron/committees`. Confirm exact paths so the new files mirror them.
2. The `wrapCronRoute` import path (`lib/cron-log.ts` per HO 139) and the `cron_runs` instrumentation pattern.
3. The `/api/cron/committees` route's structure — the meetings daily sync rides it (see Cron), so confirm how its steps are sequenced and where the meetings step folds in. 263 adds no new cron slot.
4. The `bills` table PK column name and exact id format. Probe found `relatedItems.bills` maps to `119-hr-8401`; confirm the column is `id` and the format is `{congress}-{type.toLowerCase()}-{number}`.
5. The `committees` table primary-key column name (`system_code`?) for the `committee_system_code` reference.

Any mismatch, flag before migration.

## Resolved premise (HO 261 probe — do not re-derive)

These are confirmed from the live endpoint. Build against them; don't re-investigate.

- **Spine:** `committee-meeting/{congress}/{chamber}` (list) + `committee-meeting/{congress}/{chamber}/{eventId}` (detail). Congress 119. Lowercase params. `/hearing/119` is the GPO printed-transcript archive (`jacketNumber`), backward-looking — NOT used here.
- **List items are thin:** chamber / congress / eventId / updateDate / url only. No meeting date in the list. Sorted by `updateDate` DESC, no server-side date filter. So you must fetch detail to read the date.
- **Detail fields present:** `chamber`, `committees[]`, `congress`, `date` (ISO w/ time, e.g. `2026-06-24T14:15:00Z`), `eventId`, `location` (`{building, room}`), `meetingDocuments[]`, `meetingStatus` (e.g. `Scheduled`), `title`, `type`, `updateDate`, plus `videos[]` and `relatedItems` on many.
- **Meeting types are mixed and distinct** in `type`: House sees Hearing / Markup / Meeting; Senate sees Open Hearing / Open Business Meeting / Closed Business Meeting / Open Markup Session. Store the raw string; the hearings surface filters later.
- **Video link — the make-or-break, and it works.** `videos[]` holds the API referrer (`api.congress.gov/.../house-event/N` or `senate-event/N`) AND the real watch link. House → `youtube.com/watch?v=...`. Senate → `senate.gov/isvp/?...`. Extract the entry whose host is NOT `api.congress.gov` — that's the watch URL. Null if absent. Coverage ~76% House / ~94% Senate.
- **Bill join — use `relatedItems.bills[]` only.** Structured `{congress, type, number, url}`, joins directly to the `bills` id. Present ~20% House / ~12% Senate. `relatedItems` also carries `nominations[]` and `treaties[]` — ignore those for the join. Do NOT parse the `meetingDocuments[]` PDF path (`documentType: "Bills and Resolutions"`, names like `H.R. ____`) for v1; it's messier and includes numberless discussion drafts. Accept the sparser, cleaner join.
- **Forward window is ~1–2 weeks** (real `Scheduled` events, real rooms, real video links). Upcoming events are fully populated — no placeholder-location records seen in samples. Past meetings are interleaved in the list because of the `updateDate` sort.
- **Counts:** 119th has ~1439 House + ~1009 Senate meeting events (~2,400 total). `meeting_bills` will be sparse (rough order ~300–600 rows).

## Schema

Two tables. No `raw_json` blob on either — the bills-table `raw_json` bloat is exactly what caused the cold-scan production outage; store only extracted columns.

`committee_meetings`:
- `event_id` TEXT PRIMARY KEY
- `congress` INTEGER
- `chamber` TEXT — `house` | `senate`
- `meeting_date` TEXT — ISO from `date`
- `meeting_type` TEXT — raw `type` string
- `meeting_status` TEXT — raw `meetingStatus`
- `title` TEXT
- `location_building` TEXT (nullable)
- `location_room` TEXT (nullable)
- `video_url` TEXT (nullable) — extracted watch link, NOT the API referrer
- `committee_system_code` TEXT (nullable) — first/primary committee from `committees[]`
- `update_date` TEXT — `updateDate`, the sync cursor

Indices: `(meeting_date)` for the calendar date-filter, `(committee_system_code)` for per-committee lookups, `(update_date)` for the sync cursor. Consider `(chamber, meeting_date)` if the surface filters by chamber.

`meeting_bills`:
- `event_id` TEXT
- `bill_id` TEXT — `{congress}-{type.toLowerCase()}-{number}`
- UNIQUE(`event_id`, `bill_id`)

Index on `bill_id` for the reverse lookup ("which meetings cover this bill").

`meeting_sync_state` — a single-row cursor table (or a column on an existing state table) holding the latest `update_date` watermark, mirroring the HO 116 / 143 cursor pattern.

## Sync

New file `lib/meetings-sync.ts` (separate from committees sync, same as committees stayed separate from bills).

1. **List, both chambers.** `GET /v3/committee-meeting/119/house` and `/119/senate`, sorted `updateDate` DESC (default). Walk pages.
2. **Detail per event.** For each list item newer than the stored `update_date` watermark, `GET /v3/committee-meeting/119/{chamber}/{eventId}`. Upsert the extracted columns into `committee_meetings`. Stop walking a chamber once you hit events at/older than the watermark — that's the already-synced tail, keeps the daily delta tiny.
3. **Bills.** From `relatedItems.bills[]`, upsert `(event_id, bill_id)` into `meeting_bills`. UNIQUE handles dedup. A meeting with no bills writes zero join rows — expected.
4. **Video extraction.** From `videos[]`, take the first entry whose host is not `api.congress.gov` → `video_url`. Null if none.
5. **Cursor.** After a clean pass, persist the max `update_date` seen to `meeting_sync_state`.

Time-budget it: `deadlineMs` param, `AbortController` per HTTP call, cursor persistence so a multi-tick drain is clean (HO 116 pattern). **Rate-limit caution:** detail calls share the `api.data.gov` budget on `CONGRESS_API_KEY` (the limit HO 83 exhausted, which is why FEC got its own key). ~2,400 detail calls is a lot for one tick — pace them and let the backfill drain across ticks rather than hammering. For the first run, kick the backfill manually once via a CLI script `npm run sync:meetings` rather than waiting days for the daily delta to drain it; after that the committees cron keeps it fresh (see Cron).

## Cron

No new route, no new slot. The meetings daily sync rides the existing `/api/cron/committees` cron as an added step after the committee sync — this is committee-family data, and it matches the external-source house pattern the HO 262 sweep documented (third-party syncs ride existing crons, non-fatal). Guard the meetings step with its own `deadlineMs` so it can't push the committees route toward the 60s ceiling, and make it non-fatal: a meetings-step error is logged and never fails the committees run. After the step, the route also calls `revalidateTag('meetings')` alongside its existing `revalidateTag('committees')`.

The ~2,400-call backfill does NOT run inside the cron — kick it manually once via `npm run sync:meetings` (see Sync). After that the daily delta is a handful of newly-updated events, well within the committees tick. Daily cadence is plenty: the forward window is only ~2 weeks.

## Query helpers

In `lib/queries.ts`. Each meeting-returning helper joins `meeting_bills` → `bills` so callers get the associated bills (title, sponsor, stage) for chips.

```ts
export type CommitteeMeeting = {
  eventId: string;
  chamber: 'house' | 'senate';
  meetingDate: string;
  meetingType: string;
  meetingStatus: string;
  title: string;
  building: string | null;
  room: string | null;
  videoUrl: string | null;
  committeeSystemCode: string | null;
  bills: FeedBill[];        // from meeting_bills join; may be empty
};

// calendar spine: meeting_date >= now, ORDER BY meeting_date ASC
export async function getUpcomingMeetings(opts?: { days?: number; chamber?: string; type?: string }): Promise<CommitteeMeeting[]>;
// recent record: meeting_date in [now - days, now)
export async function getRecentMeetings(days?: number): Promise<CommitteeMeeting[]>;
// committee-detail cut (HO 143 "what's it doing this week")
export async function getMeetingsByCommittee(systemCode: string, opts?: { upcomingOnly?: boolean }): Promise<CommitteeMeeting[]>;
// reverse lookup for the bill hub
export async function getMeetingsForBill(billId: string): Promise<CommitteeMeeting[]>;
```

Cache each with `unstable_cache`, tag `'meetings'` (new tag, the 12th — the committees cron revalidates it after the meetings step). Aggregate/join in SQL, not JS.

## Out of scope

- **All UI.** No `/hearings` page, no calendar component, no committee-detail meeting section, no bill-hub sub-page link. Design-chat spec first, then a build handoff. Same posture HO 143 held.
- **The `meetingDocuments` PDF bill-parse path.** `relatedItems.bills` only for v1.
- **Meeting-type normalization/classification** beyond storing the raw string.
- **The `/hearing` GPO transcript archive.**
- **Far-forward calendar.** Data only runs ~2 weeks ahead; that's a source limit, not a build choice.
- **"Watch live" liveness gating** (show/hide based on whether the stream is actually live vs a scheduled placeholder link). That's a UI-time concern — note it for the UI handoff, spot-check the URL before rendering a live affordance.
- **Backfill of prior Congresses.** 119th only, same as bills/committees.

## Acceptance

1. Pre-flight verifications posted in chat (file/route paths, committees cron structure, bills id format + column, committees PK column). Any mismatch flagged before migration.
2. Migration applied to prod Turso. `committee_meetings` + `meeting_bills` + `meeting_sync_state` exist with the schema and indices above. No `raw_json` column on either data table.
3. Sync runs end-to-end against prod once (backfill kicked manually, drained across ticks if needed). Row counts reported — rough expectation ~2,400 meetings, `meeting_bills` sparse (~300–600).
4. `cron_runs` shows the committees route logging cleanly with the meetings step included; a forced meetings-step error is logged without failing the committees run.
5. Helpers return non-empty data: `getUpcomingMeetings()` returns this/next week's `Scheduled` meetings with video links and any associated bills; `getMeetingsForBill()` returns meetings for a known bill that had a hearing.
6. `video_url` extracts the watch link, not the API referrer — spot-check one House (`youtube.com`) and one Senate (`senate.gov/isvp`) record. Confirm a record with no `videos[]` stores null, not the referrer.
7. `SKILL.md` updated: the two tables + state table, the meetings step riding the committees cron, the new `meetings` cache tag, the video-extraction rule, the `relatedItems.bills`-only join decision, and the no-`raw_json` note.
8. Single commit: `feat: committee meetings data layer (HO 263)`.
9. Ship per the documented flow (HO 252): push, then `npm run verify:deploy` and wait until the deployed SHA matches HEAD before calling it shipped.

## Notes

- **Why store all meeting types, not just hearings?** Same endpoint returns markups and business meetings; storing them is free and gives the committee detail page its "what's this committee doing this week" cut. The hearings surface filters `meeting_type`. Cheaper than re-syncing later.
- **Why ride the committees cron instead of a dedicated route?** The HO 262 sweep documented the external-source house pattern: third-party syncs ride existing crons rather than taking new slots. Meetings is committee-family Congress.gov data, so it rides `/api/cron/committees`, deadline-guarded and non-fatal so it can't hurt the committee sync. The sync *logic* still mirrors `lib/committees-sync.ts` (committees-sync wasn't superseded); only the wiring follows the newer pattern. The heavy one-time backfill is manual anyway, so nothing competes for the tick.
- **The list-has-no-date wrinkle is the whole reason this is detail-fetch-heavy.** There's no shortcut — the date lives only on the detail record. The cursor-on-`update_date` walk is what keeps the steady-state cost tiny after the one-time backfill.
