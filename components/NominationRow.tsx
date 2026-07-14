import { NominationDispositionBadge } from "@/components/NominationDispositionBadge";
import { formatDateLong } from "@/lib/format";
import type { NominationListRow } from "@/lib/queries";

// HO 456 — one row of the /nominations civilian list. Non-linked in v1 (no
// /nomination/[id] detail page — the list is the surface). The `description` is
// the civilian nominee + position and reads cleanly as-is (no parsing). Meta row:
// agency · disposition badge · date · citation. Matches the member/lobbying row
// grammar (px-4, 0.5px border-soft divider).
export function NominationRow({ nomination: n }: { nomination: NominationListRow }) {
  const date = n.latestActionDate ?? n.receivedDate;
  return (
    <div className="px-4 py-[9px]" style={{ borderTop: "0.5px solid var(--border-soft)" }}>
      {n.description ? (
        <div
          className="text-[13px]"
          style={{
            color: "var(--text-primary)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {n.description}
        </div>
      ) : null}
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {n.organization ? (
          <span style={{ color: "var(--text-muted)" }}>{n.organization}</span>
        ) : null}
        <NominationDispositionBadge disposition={n.disposition} />
        {date ? <span style={{ color: "var(--text-muted)" }}>{formatDateLong(date)}</span> : null}
        <span
          className="tabular-nums"
          style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}
        >
          {n.citation}
        </span>
      </div>
    </div>
  );
}
