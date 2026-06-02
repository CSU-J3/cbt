const BILL_TYPE_FULL: Record<string, string> = {
  hr: "house-bill",
  s: "senate-bill",
  hres: "house-resolution",
  sres: "senate-resolution",
  hjres: "house-joint-resolution",
  sjres: "senate-joint-resolution",
  hconres: "house-concurrent-resolution",
  sconres: "senate-concurrent-resolution",
};

export function formatBillId(billType: string, billNumber: number): string {
  return `${billType.toUpperCase()} ${billNumber}`;
}

export function congressGovUrl(
  congress: number,
  billType: string,
  billNumber: number,
): string {
  const slug = BILL_TYPE_FULL[billType] ?? billType;
  return `https://www.congress.gov/bill/${congress}th-congress/${slug}/${billNumber}`;
}

// "MM-DD-YY" — feed list, dense
export function formatDateShort(iso: string | null | undefined): string {
  if (!iso) return "—";
  const part = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(part)) return part || "—";
  return `${part.slice(5, 7)}-${part.slice(8, 10)}-${part.slice(2, 4)}`;
}

// "YYYY-MM-DD" — detail page, expanded panel
export function formatDateLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  const part = iso.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(part)) return part || "—";
  return part;
}

// "h:MM AM/PM MT" in America/Denver — header bar last-updated (HO 169: 12-hour)
const mountainTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatLastUpdated(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${mountainTimeFormatter.format(d)} MT`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Relative-age string for news mentions. Sub-hour → "Xm"; sub-day → "Xh";
// otherwise → "Xd". Floors each unit so a 59-min mention reads "59m" rather
// than "1h", matching how news clients display recency. Capped at days
// because the news feed never shows anything older than a few weeks; for
// the longer arcs the BillRow stage pills need, use formatRelativeAgeLong.
export function formatRelativeAge(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diffMs = Math.max(0, Date.now() - t);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

// Extended relative-age covering minutes through years (HO 125). Used by the
// BillRow stage pills, where bills can be 9 months old or more — the news-
// feed version caps at days, which renders as e.g. "270d" instead of "9mo".
// Boundaries are practical, not calendar-precise: 30-day months and 365-day
// years are good enough for terminal-style "9mo ago" UI text. Output is
// lowercase; row CSS applies uppercase at render so the value travels
// case-agnostic through the pipe.
export function formatRelativeAgeLong(iso: string | null | undefined): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "—";
  const diffMs = Math.max(0, Date.now() - t);
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 14) return `${days}d`;
  if (days < 60) return `${Math.floor(days / 7)}w`;
  if (days < 730) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

export function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const part = dateStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(part)) return 0;
  const t = Date.parse(`${part}T00:00:00Z`);
  if (Number.isNaN(t)) return 0;
  const now = Date.now();
  return Math.max(0, Math.floor((now - t) / MS_PER_DAY));
}

// Days from today (UTC midnight) to the given date: 0 = today, positive =
// future, negative = past. Counterpart to daysSince; used by the primary
// tracker's countdown surfaces (handoff 91).
export function daysUntil(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const part = dateStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(part)) return 0;
  const t = Date.parse(`${part}T00:00:00Z`);
  if (Number.isNaN(t)) return 0;
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  return Math.round((t - today.getTime()) / MS_PER_DAY);
}

// General election day for a given cycle: first Tuesday after the first
// Monday of November. Returned as a UTC Date so callers can subtract from
// "today UTC" without timezone drift biting the day count.
export function electionDay(cycle: number): Date {
  const nov1 = new Date(Date.UTC(cycle, 10, 1));
  const dow = nov1.getUTCDay(); // 0=Sun … 6=Sat
  const firstMondayOffset = dow <= 1 ? 1 - dow : 8 - dow;
  const firstMonday = new Date(Date.UTC(cycle, 10, 1 + firstMondayOffset));
  const electionDate = new Date(firstMonday);
  electionDate.setUTCDate(firstMonday.getUTCDate() + 1);
  return electionDate;
}

// Days from today (UTC) to the general election. Negative once the
// election is in the past — callers render "Election concluded" rather
// than a negative countdown.
export function daysToElection(cycle: number): number {
  const election = electionDay(cycle);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const ms = election.getTime() - today.getTime();
  return Math.floor(ms / MS_PER_DAY);
}

// "1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st"... Used for
// House district names ("Colorado 8th Congressional District"). District 0
// is rendered as "At-Large" by the caller; this helper assumes n >= 1.
export function ordinal(n: number): string {
  const abs = Math.abs(n);
  const last2 = abs % 100;
  if (last2 >= 11 && last2 <= 13) return `${n}th`;
  switch (abs % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

// Compact USD formatter for the donor/industry stat lines. Input is cents
// (matches the integer storage on member_donors / member_industries /
// member_fundraising); divide once here so callers can stay in cent space.
// $87 / $245K / $1.2M / $5M — terminal-aesthetic, monospace-friendly.
export function formatDollarsCompact(cents: number): string {
  const dollars = cents / 100;
  if (dollars >= 1_000_000) {
    const m = dollars / 1_000_000;
    return m >= 10 ? `$${Math.round(m)}M` : `$${m.toFixed(1)}M`;
  }
  if (dollars >= 1_000) return `$${Math.round(dollars / 1000)}K`;
  return `$${Math.round(dollars)}`;
}

export function parseTopics(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t): t is string => typeof t === "string");
  } catch {
    return [];
  }
}

