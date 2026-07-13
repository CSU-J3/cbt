import Link from "next/link";
import { formatDateLong } from "@/lib/format";
import type { MemberAmendment } from "@/lib/queries";

// HO 450 — one row of the /members/[bioguideId] AMENDMENTS SPONSORED section.
// The inverse of the bill-hub AmendmentRow: the sponsor is fixed (the page's
// member), so the row leads with the amended BILL (linked to /bill/[id]). The
// page owns the <section> shell + the render cap; this is just the row. Shares
// the HO 448 disposition-dot palette (--vote-yea/--vote-nay) and purpose-clamp.
function dispositionColor(d: MemberAmendment["disposition"]): string {
  if (d === "agreed") return "var(--vote-yea)";
  if (d === "failed") return "var(--vote-nay)";
  return "var(--text-muted)";
}

export function MemberAmendmentRow({ amendment: a }: { amendment: MemberAmendment }) {
  const purpose = a.purpose ?? a.description;
  return (
    <div className="px-4 py-[9px]" style={{ borderTop: "0.5px solid var(--border-soft)" }}>
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            flexShrink: 0,
            borderRadius: "50%",
            backgroundColor: dispositionColor(a.disposition),
          }}
        />
        <span
          className="text-[13px] tabular-nums"
          style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}
        >
          {a.label}
        </span>
        {a.amendedBillId ? (
          <Link
            href={`/bill/${a.amendedBillId}`}
            className="text-[12px] tabular-nums"
            style={{ color: "var(--accent-amber)" }}
          >
            {a.amendedBillLabel ?? a.amendedBillId}
          </Link>
        ) : a.amendedBillLabel ? (
          <span className="text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>
            {a.amendedBillLabel}
          </span>
        ) : null}
        {a.amendedBillTitle ? (
          <span
            className="min-w-0 flex-1 truncate text-[12px]"
            style={{ color: "var(--text-muted)" }}
          >
            {a.amendedBillTitle}
          </span>
        ) : null}
      </div>

      {purpose ? (
        <div
          className="mt-1 text-[13px]"
          style={{
            color: "var(--text-secondary)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {purpose}
        </div>
      ) : null}

      <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {a.latestActionText
          ? `${a.latestActionText}${a.latestActionDate ? ` · ${formatDateLong(a.latestActionDate)}` : ""}`
          : `Submitted ${formatDateLong(a.submittedDate)} · no floor action yet`}
      </div>

      {a.amendsLabel ? (
        <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          ↳ amends {a.amendsLabel}
        </div>
      ) : null}
    </div>
  );
}
