import Link from "next/link";
import { formatBillId, formatRelativeAge } from "@/lib/format";
import type { NewsMention } from "@/lib/queries";

// HO 178 — compact BREAKING row for the dashboard left column. Three columns:
// ID (~92px, --accent-amber mono, with a [+N] companion-count in --text-dim) ·
// truncated headline (--text-secondary, ellipsis) · right-aligned age
// (--text-dim). On hover the full headline floats left-anchored on an opaque
// --bg-row-hover overlay that OVERRUNS rightward into the races column (which
// dims to 0.4 via :has() — see globals.css), and the age is hidden while
// expanded. Pure CSS hover, so this stays a server component. The overlay is
// pointer-events:none so clicks fall through to the underlying headline link.
//
// Distinct from NewsRow (which carries a source column and an always-or-never
// full-headline mode) — BREAKING wants the compact+overrun treatment only.

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

export function BreakingRow({ mention }: { mention: NewsMention }) {
  const ageLabel = formatRelativeAge(mention.publishedAt);
  const tn = billTypeAndNumber(mention.billId);
  const billLabel = tn ? formatBillId(tn.type, tn.number) : mention.billId;
  const billHref = `/bill/${encodeURIComponent(mention.billId)}`;
  const otherBills = mention.otherBills ?? [];

  return (
    <div className="breaking-row">
      <span className="breaking-row-id">
        <Link
          href={billHref}
          className="tabular-nums"
          style={{ color: "var(--accent-amber)" }}
          title={mention.billTitle}
        >
          {billLabel}
        </Link>
        {otherBills.length > 0 ? (
          <span
            className="breaking-row-more tabular-nums"
            title={`${otherBills.length} additional related ${
              otherBills.length === 1 ? "article" : "articles"
            } (${otherBills.join(", ")})`}
          >
            [+{otherBills.length}]
          </span>
        ) : null}
      </span>
      <a
        href={mention.url}
        target="_blank"
        rel="noopener noreferrer"
        className="breaking-row-headline"
      >
        {mention.title}
      </a>
      <span className="breaking-row-age">{ageLabel}</span>
      {/* Hover overlay — full headline, overruns into the races column. */}
      <span aria-hidden className="breaking-row-full">
        {mention.title}
      </span>
    </div>
  );
}
