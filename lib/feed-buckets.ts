// HO 632 C2 — day bucketing for the dashboard feed groups (TODAY / YESTERDAY /
// EARLIER THIS WEEK / OLDER).
//
// A LEAF MODULE ON PURPOSE: no `next/cache`, no `lib/queries` import, nothing but
// the `FeedBill` type. `V2FeedList` is a client island, so anything it imports
// ships to the browser; keeping this dependency-free is what lets the island do
// the bucketing without dragging the query layer into the bundle.
//
// ── WHY THE BUCKET FIELD IS PARAMETERIZED BY MODE ──────────────────────────────
// The rule is that a row's GROUP and its printed AGE must derive from the same
// timestamp — a row under TODAY reading "1d" is the defect this guards. There is
// no single field that satisfies that, because the three feeds measure different
// things (V2FeedList's Metric, per mode):
//
//   MOVERS  stage_changed_at   "→ FLOOR 3h"    when the stage last moved
//   NEW     introduced_date    "INTRO 2d"      when the bill was introduced
//   STALLS  latest_action_date "14d stuck"     how long it has been quiet
//
// So the bucketer takes the mode and reads the matching field. STALLS is
// deliberately UNGROUPED (see `groupFeed`) — it is sorted by stall age, so a
// TODAY header over it is a category error, not a missing feature.
//
// ── WHY THE TWO GROUPED FIELDS ARE HANDLED DIFFERENTLY (the HO 622 trap) ──────
// Measured on live data, they do not store the same shape:
//
//   stage_changed_at   ISO INSTANT in UTC   '2026-08-08T13:04:11.000Z'
//   introduced_date    DATE-ONLY            '2026-08-06'
//
// An instant is a moment and genuinely needs a zone to land on a calendar day.
// A date-only string is ALREADY a calendar day and must be SLICED, never parsed:
// `new Date('2026-08-06')` is UTC midnight, which in ET is 2026-08-05 20:00 — the
// previous day. Running one rule over both fields silently backdates every row of
// whichever feed loses, which is exactly the HO 622 defect.
//
// ── WHY ET, AND WHY IT IS NOT COSMETIC ────────────────────────────────────────
// Congress runs on Eastern time; the House stores `-04:00` offsets. "Today" on
// this product means the chamber's today, not the server's UTC nor the viewer's
// locale. This is measurable rather than decorative: on the day it was built,
// 5 of 30 MOVERS rows (17%) landed on a DIFFERENT calendar day under UTC
// bucketing than under ET.
//
// ── HYDRATION (HO 574/589/490) ────────────────────────────────────────────────
// Nothing here reads a clock. `nowMs` is the page-computed value already drilled
// for the age strings, and every `Date` below is constructed FROM AN ARGUMENT —
// there is no bare `new Date()` and no `Date.now()`, so SSR and hydration compute
// identical buckets from identical inputs. `Intl` over those constants is
// deterministic; the constraint is on nondeterministic SOURCES, not on formatting.
import type { FeedBill } from "@/lib/queries";

export type V2MetricMode = "movers" | "stalls" | "new";

export type FeedBucket = "today" | "yesterday" | "week" | "older";

export const BUCKET_LABEL: Record<FeedBucket, string> = {
  today: "TODAY",
  yesterday: "YESTERDAY",
  week: "EARLIER THIS WEEK",
  older: "OLDER",
};

// en-CA renders 'YYYY-MM-DD', which is directly comparable as a string.
const ET_DAY = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** The ET calendar day ('YYYY-MM-DD') an instant falls on. */
function etDayOfInstant(ms: number): string {
  return ET_DAY.format(new Date(ms));
}

/**
 * The three reference days, derived ONCE per render from the drilled `nowMs` and
 * shared by both field paths so the two feeds can never disagree about when
 * "today" started.
 *
 * The arithmetic for yesterday/week-start runs in UTC on a bare calendar date —
 * `Date.UTC` in, `getUTC*` out. That is NOT a zone conversion and must not be
 * "fixed" into one: the input is already an ET calendar day, and UTC is merely a
 * DST-free frame in which to subtract days. Doing this arithmetic in a real zone
 * would reintroduce the very boundary shift the ET conversion just resolved.
 */
export type EtCalendar = { today: string; yesterday: string; weekStart: string };

export function etCalendar(nowMs: number): EtCalendar {
  const today = etDayOfInstant(nowMs);
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const anchor = Date.UTC(y, m - 1, d);
  const DAY = 86_400_000;

  const yesterday = new Date(anchor - DAY).toISOString().slice(0, 10);

  // ISO week: Monday-anchored. getUTCDay() is 0=Sun, so (dow + 6) % 7 puts Monday at 0.
  const dow = (new Date(anchor).getUTCDay() + 6) % 7;
  const weekStart = new Date(anchor - dow * DAY).toISOString().slice(0, 10);

  return { today, yesterday, weekStart };
}

/**
 * The calendar day a row belongs to, per mode — the same timestamp its age string
 * is printed from. Returns null when the row carries no usable date.
 */
export function feedDay(bill: FeedBill, mode: V2MetricMode): string | null {
  if (mode === "new") {
    const raw = bill.introduced_date;
    if (!raw) return null;
    // DATE-ONLY: slice. Never `new Date(raw)` — see the HO 622 note above.
    return DATE_ONLY.test(raw) ? raw.slice(0, 10) : etDayOfInstant(Date.parse(raw));
  }
  // movers (and any future instant-valued mode)
  const raw = bill.stage_changed_at;
  if (!raw) return null;
  // Defensive: if this field ever becomes date-only upstream, slice it rather
  // than backdating every row by a timezone.
  if (DATE_ONLY.test(raw)) return raw.slice(0, 10);
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : etDayOfInstant(ms);
}

export function bucketOf(day: string | null, cal: EtCalendar): FeedBucket {
  // Unreachable in both grouped feeds — getStageChanges constrains
  // `stage_changed_at IS NOT NULL` and getNewBillsThisWeek constrains
  // `introduced_date >= date(...)`, so neither can yield a null here. If it ever
  // does, OLDER is the least-wrong home: it is the only one of the four that
  // makes no positive claim about WHEN, which is precisely what we don't know.
  if (day === null) return "older";
  if (day === cal.today) return "today";
  if (day === cal.yesterday) return "yesterday";
  return day >= cal.weekStart ? "week" : "older";
}

export type FeedGroup = { bucket: FeedBucket; label: string; bills: FeedBill[] };

/**
 * Groups a feed for rendering. Returns null for modes that are not grouped, which
 * the caller renders flat — a null return is "this feed has no day story", not
 * "grouping failed".
 *
 * Empty buckets are DROPPED, never rendered as an empty header: a header over no
 * rows is the reserved-box defect (C4) wearing a label. OLDER in particular is
 * built and will fire — its population is a function of the WEEKDAY, not of
 * corpus depth, because both feeds are 7-day rolling windows while the ISO week
 * is Monday-anchored. Late in the week almost the whole window sits inside the
 * current week and OLDER is empty; on a Monday up to six of the seven days fall
 * before the week start and it carries most of the feed. A Monday screenshot
 * showing a full OLDER group is correct behaviour, not a regression.
 */
export function groupFeed(
  bills: FeedBill[],
  mode: V2MetricMode,
  nowMs: number,
): FeedGroup[] | null {
  // STALLS is ordered by stall age, so a day header would be a category error.
  if (mode === "stalls") return null;

  const cal = etCalendar(nowMs);
  const order: FeedBucket[] = ["today", "yesterday", "week", "older"];
  const byBucket = new Map<FeedBucket, FeedBill[]>();

  for (const bill of bills) {
    const b = bucketOf(feedDay(bill, mode), cal);
    const list = byBucket.get(b);
    if (list) list.push(bill);
    else byBucket.set(b, [bill]);
  }

  const groups: FeedGroup[] = [];
  for (const bucket of order) {
    const rows = byBucket.get(bucket);
    if (rows && rows.length > 0) {
      groups.push({ bucket, label: BUCKET_LABEL[bucket], bills: rows });
    }
  }
  return groups;
}
