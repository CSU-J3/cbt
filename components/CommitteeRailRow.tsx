"use client";

// HO 328: a committee row in the merged /members rail. Clicking the row SCOPES
// the right pane to this committee (?committee=); re-clicking the selected row
// clears the scope. The committee NAME is a nested real <a> → /committee/[code]
// (detail), with stopPropagation so it navigates without toggling the scope —
// the BillRow idiom (a div role=button can't legally wrap an <a>, so the row is
// a button and the link is a sibling-in-flow child that stops propagation).
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function CommitteeRailRow({
  systemCode,
  name,
  chamberTag,
  memberCount,
  activityPct,
  selected,
  onMarker,
}: {
  systemCode: string;
  name: string;
  chamberTag: string;
  memberCount: number;
  activityPct: number;
  selected: boolean;
  onMarker: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function scope() {
    const next = new URLSearchParams(searchParams.toString());
    if (selected) next.delete("committee");
    else next.set("committee", systemCode);
    // Selecting/clearing a committee drops any open member — an expanded member
    // from the full list may not be in the scoped roster.
    next.delete("expanded");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div
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
      <span className="mc-crow-mark" aria-hidden>
        {onMarker ? "●" : ""}
      </span>
      <span className="mc-crow-tag">{chamberTag}</span>
      <Link
        href={`/committee/${systemCode}`}
        className="mc-crow-name"
        title={name}
        onClick={(e) => e.stopPropagation()}
      >
        {name}
      </Link>
      <span className="mc-crow-act" aria-hidden>
        {activityPct > 0 ? (
          <span className="mc-crow-act-f" style={{ width: `${activityPct}%` }} />
        ) : null}
      </span>
      <span className="mc-crow-mem">{memberCount}</span>
    </div>
  );
}
