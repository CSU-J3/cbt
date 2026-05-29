import Link from "next/link";
import { formatBillId, formatRelativeAge } from "@/lib/format";
import type { NewsMention } from "@/lib/queries";

// Hour thresholds match the .stale daysSinceMode pattern: a fresh-amber tier
// for very recent items, then secondary, then muted once the item is a day
// or more old. Derived inside the row from the publishedAt timestamp so
// callers don't have to pre-bucket.
function ageColor(hours: number): string {
  if (hours < 6) return "var(--accent-amber-bright)";
  if (hours < 24) return "var(--text-secondary)";
  return "var(--text-muted)";
}

function ageHours(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 3_600_000;
}

// Parse "119-hr-1234" → { type: 'hr', number: 1234 } for display.
function billTypeAndNumber(billId: string): {
  type: string;
  number: number;
} | null {
  const parts = billId.split("-");
  if (parts.length !== 3) return null;
  const [, type, numStr] = parts as [string, string, string];
  const number = Number(numStr);
  if (Number.isNaN(number)) return null;
  return { type, number };
}

export function NewsRow({
  mention,
  showFullHeadline = false,
}: {
  mention: NewsMention;
  showFullHeadline?: boolean;
}) {
  const hours = ageHours(mention.publishedAt);
  const ageLabel = formatRelativeAge(mention.publishedAt);
  const tn = billTypeAndNumber(mention.billId);
  const billLabel = tn ? formatBillId(tn.type, tn.number) : mention.billId;
  // The bill ID always links to the bill hub (/bill/[id]). HO 155: the old
  // non-detail branch pointed at /feed?expanded=<billId>, but the feed runs
  // on pure client state and never reads `?expanded=` (HO 148), so that
  // target opened nothing. All callers already used the detail link.
  const billHref = `/bill/${encodeURIComponent(mention.billId)}`;

  const otherBills = mention.otherBills ?? [];

  return (
    <div className="news-row">
      <span className="bill-cell">
        <Link
          href={billHref}
          className="text-[14px] font-medium tabular-nums"
          style={{ color: "var(--accent-amber)" }}
          title={mention.billTitle}
        >
          {billLabel}
        </Link>
        {otherBills.length > 0 && (
          <span
            className="companions-pill text-[12px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
            title={`${otherBills.length} additional related ${otherBills.length === 1 ? "article" : "articles"} (${otherBills.join(", ")})`}
          >
            [+{otherBills.length}]
          </span>
        )}
      </span>
      <a
        href={mention.url}
        target="_blank"
        rel="noopener noreferrer"
        className={
          showFullHeadline
            ? "text-[14px] leading-snug"
            : "truncate text-[14px]"
        }
        style={{ color: "var(--text-primary)" }}
      >
        {mention.title}
      </a>
      <span className="source">{mention.source.replace(/_/g, " ")}</span>
      <span className="age" style={{ color: ageColor(hours) }}>
        {ageLabel}
      </span>
    </div>
  );
}
