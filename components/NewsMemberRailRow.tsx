"use client";

// HO 517 — a member row in the /news "IN THE NEWS" rail group (Axis B), the 2nd
// group in the same rail as the topic group. Same single-select `.mc-crow.is-sel`
// idiom, but a party dot + surname (no bar — the member group's count is a fixed
// 30d article count, not a rebasing volume). Clicking SCOPES the pane to this
// member's observation feed (`?member=<bioguide>`, the HO 512 mode); re-clicking
// clears it. **One selection across both groups (HO 517 call 3): selecting a
// member CLEARS `topic`**, so at most one row (topic OR member) is ever lit.
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { partyColor, surname } from "@/lib/race-colors";

export function NewsMemberRailRow({
  bioguide,
  name,
  party,
  count,
  selected,
  pinned = false,
}: {
  bioguide: string;
  name: string; // members.name (directOrderName) — rendered surname-forward
  party: string | null;
  count: number; // 30d article count (may be 0 for a pinned out-of-window member)
  selected: boolean;
  // HO 517 call 5 — the active member arrived from a Press-tab out-link but ranks
  // outside the top 15, so this row is injected at the top of the group.
  pinned?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rowRef = useRef<HTMLDivElement | null>(null);

  // With two groups the lit row is more likely below the fold on arrival, so
  // this matters more here than for the topic group (HO 492 pattern).
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function scope() {
    const next = new URLSearchParams(searchParams.toString());
    if (selected) next.delete("member");
    else next.set("member", bioguide);
    next.delete("topic"); // one selection across both groups (HO 517 call 3)
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
      className={`mc-crow nw-mrow${selected ? " is-sel" : ""}${pinned ? " nw-mrow-pin" : ""}`}
      title={pinned ? `${name} — pinned (the member you arrived from)` : name}
    >
      <span
        className="nw-mdot"
        aria-hidden
        style={{ backgroundColor: partyColor(party) }}
      />
      <span className="mc-crow-name">{surname(name)}</span>
      <span className="mc-crow-mem">{count.toLocaleString()}</span>
    </div>
  );
}
