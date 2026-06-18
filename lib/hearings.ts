// HO 264: hearings UI logic shared by the /hearings list (Piece 1) and the
// later calendar / LIVE NOW pieces (265-267). Pure functions, no DB. The
// meetingType→badge map and the watch-state rule were both settled against live
// data in the Phase 1 diagnostic (scripts/diagnostic/hearings-list-264.ts).
import type { CommitteeMeeting } from "./queries";

export const HEARING_BADGES = ["HEARING", "MARKUP", "BUSINESS"] as const;
export type HearingBadge = (typeof HEARING_BADGES)[number];

// Substring map — robust to the Open/Closed prefixes the raw set carries
// (Hearing / Open Hearing / Closed Hearing; Markup / Open Markup Session /
// Closed Markup Session; Meeting / Open Business Meeting / Closed Business
// Meeting). "hearing" and "markup" never co-occur in a single raw value, so the
// two checks can't collide; everything else (Meeting / *Business Meeting) is
// BUSINESS. Verified in Phase 1: all 9 live values map, nothing falls through.
export function hearingBadge(
  meetingType: string | null | undefined,
): HearingBadge {
  const t = (meetingType ?? "").toLowerCase();
  if (t.includes("hearing")) return "HEARING";
  if (t.includes("markup")) return "MARKUP";
  return "BUSINESS";
}

// Watch state for the row's right cell + Piece 3's LIVE NOW callout.
export type WatchState = "live" | "watch" | "stream" | "none";

// A hearing reads as "live" from its start through this window (committee
// meetings run ~1-3h and the source carries no end time). Phase 1 decision:
// time-window only, no URL spot-check (YouTube/ISVP live-state isn't cheaply
// checkable server-side; the blast radius is one window per future-with-url row,
// and Canceled/Postponed are already suppressed). Exported so Piece 3 shares the
// exact boundary rather than re-deriving it.
export const LIVE_WINDOW_MS = 3 * 60 * 60 * 1000;

// meetingStatus is planning-state, not playback-state (Phase 1: "Scheduled"
// spans both future and past). These two mean the event won't/didn't happen, so
// any stale videoUrl on them must not light up WATCH/LIVE/STREAM.
const SUPPRESS_STATUS = new Set(["Canceled", "Postponed"]);

export function watchState(
  m: Pick<CommitteeMeeting, "meetingDate" | "meetingStatus" | "videoUrl">,
  nowMs: number,
): WatchState {
  if (!m.videoUrl) return "none";
  if (SUPPRESS_STATUS.has(m.meetingStatus)) return "none";
  const start = Date.parse(m.meetingDate);
  if (Number.isNaN(start)) return "none";
  if (nowMs < start) return "stream";
  if (nowMs <= start + LIVE_WINDOW_MS) return "live";
  return "watch";
}

// ---- URL filters (?type=, ?chamber=) -----------------------------------

export const HEARING_TYPES = ["hearing", "markup", "business"] as const;
export type HearingTypeFilter = (typeof HEARING_TYPES)[number];
const HEARING_TYPES_SET = new Set<string>(HEARING_TYPES);

export function sanitizeHearingType(
  raw: string | null | undefined,
): HearingTypeFilter | undefined {
  if (raw && HEARING_TYPES_SET.has(raw)) return raw as HearingTypeFilter;
  return undefined;
}

// The badge a ?type= filter value selects for, so a meeting passes when
// hearingBadge(meetingType) === typeFilterBadge(type).
export function typeFilterBadge(t: HearingTypeFilter): HearingBadge {
  if (t === "hearing") return "HEARING";
  if (t === "markup") return "MARKUP";
  return "BUSINESS";
}

// ---- ET (DC time) formatting -------------------------------------------
// Hearings are DC events; the spec's "9:30a" is the ET reading of a 13:30Z
// meeting_date. All grouping + display is in America/New_York so day boundaries
// and "TODAY" line up with how hearings are universally listed. The explicit
// timeZone makes these deterministic across server render and client hydration.

const ET = "America/New_York";

const etDayKeyFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: ET,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}); // -> "2026-06-17"

const etTimeFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
}); // -> "9:30 AM"

const etHeaderFmt = new Intl.DateTimeFormat("en-US", {
  timeZone: ET,
  weekday: "short",
  month: "short",
  day: "numeric",
}); // -> "Wed, Jun 17"

// "2026-06-17" in ET — the per-day group key.
export function etDayKey(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return etDayKeyFmt.format(t);
}

// "9:30a" / "2:15p" — mono time column. Empty for an unparseable date.
export function etTimeLabel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return etTimeFmt
    .format(t)
    .replace(/\s/g, "")
    .replace(/AM$/, "a")
    .replace(/PM$/, "p");
}

// "WED JUN 17" — day subheader label (uppercased at render via the parts).
export function etDayLabel(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  // "Wed, Jun 17" -> "WED JUN 17"
  return etHeaderFmt.format(t).replace(",", "").toUpperCase();
}

// "TODAY" / "TOMORROW" / "YESTERDAY" or null, comparing ET calendar days. Both
// sides become YYYY-MM-DD ET keys parsed at UTC midnight, so the subtraction is
// a pure calendar-day difference free of any timezone drift.
export function etRelativeDay(iso: string, nowMs: number): string | null {
  const key = etDayKey(iso);
  const nowKey = etDayKeyFmt.format(nowMs);
  if (!key) return null;
  const a = Date.parse(`${key}T00:00:00Z`);
  const b = Date.parse(`${nowKey}T00:00:00Z`);
  const diff = Math.round((a - b) / 86_400_000);
  if (diff === 0) return "TODAY";
  if (diff === 1) return "TOMORROW";
  if (diff === -1) return "YESTERDAY";
  return null;
}
