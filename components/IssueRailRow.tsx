"use client";

// HO 486: an LDA issue-code row in the /lobbying rail — the CommitteeRailRow
// idiom on ?issue=. Clicking SCOPES the right pane to this issue code
// (?issue=CODE); re-clicking the selected row clears the scope. The whole row is
// the control (no nested entity link — lobbying issue areas have no detail page,
// so the name is a plain span, not an <a>). The bar is inline-colored by the
// code's CBT topic (overriding the fixed --stage-committee), precomputed by the
// page so this stays a thin click wrapper.
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function IssueRailRow({
  code,
  display,
  filings,
  pct,
  barColor,
  selected,
}: {
  code: string;
  display: string;
  filings: number;
  pct: number;
  barColor: string;
  selected: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rowRef = useRef<HTMLDivElement | null>(null);

  // HO 492 — the rail is now a bounded scroll region, so scoping an issue low in
  // the 79-code list would re-render with it selected but the rail scrolled to
  // top, hiding the selection. Bring the selected row into view within the rail's
  // overflow container. `block: "nearest"` scrolls only that container (minimal),
  // not the window — verified on a deep selection (?issue=MON).
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function scope() {
    const next = new URLSearchParams(searchParams.toString());
    if (selected) next.delete("issue");
    else next.set("issue", code);
    // Scoping/clearing drops any open filing (an expanded row from one scope may
    // not exist in the next) and any pager position (the scoped drill has no
    // pager; clearing back to the corpus feed returns to page 1).
    next.delete("expanded");
    next.delete("page");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={scope}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          scope();
        }
      }}
      className={`mc-crow${selected ? " is-sel" : ""}`}
    >
      <span className="mc-crow-tag">{code}</span>
      <span className="mc-crow-name" title={display}>
        {display}
      </span>
      <span className="mc-crow-act" aria-hidden>
        {pct > 0 ? (
          <span
            className="mc-crow-act-f"
            style={{ width: `${pct}%`, backgroundColor: barColor }}
          />
        ) : null}
      </span>
      <span className="mc-crow-mem">{filings.toLocaleString()}</span>
    </div>
  );
}
