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

// "HH:MM MT" in America/Denver — header bar last-updated
const mountainTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Denver",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function formatLastUpdated(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return `${mountainTimeFormatter.format(d)} MT`;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysSince(dateStr: string | null | undefined): number {
  if (!dateStr) return 0;
  const part = dateStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(part)) return 0;
  const t = Date.parse(`${part}T00:00:00Z`);
  if (Number.isNaN(t)) return 0;
  const now = Date.now();
  return Math.max(0, Math.floor((now - t) / MS_PER_DAY));
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

