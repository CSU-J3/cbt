"use client";

// HO 515 — a topic row in the /news topic rail (Axis A), the single-select
// .mc-crow idiom from /members + /lobbying. This is deliberately NOT the /bills
// multi-select TopicRailRow: /news carries singular ?topic=, so exactly one row
// is ever selected, and the checkbox marker (.bl-mark) is the documented
// /bills DIVERGENCE from the pattern, not the pattern. Clicking SCOPES the
// mention feed to this topic (?topic=<enum>); re-clicking the selected row
// clears it — the .mc-crow.is-sel amber-left-border single-scope convention.
import { useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function NewsTopicRailRow({
  topic,
  label,
  fullLabel,
  count,
  pct,
  barColor,
  selected,
}: {
  topic: string; // the enum value written to ?topic= (e.g. "healthcare")
  label: string; // the abbreviation shown in the tag cell (e.g. "HLTH")
  fullLabel: string; // the full topic name in the row body
  count: number; // distinct-article count under the active source/window/signal
  pct: number; // bar width vs the rail's top count
  barColor: string;
  selected: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const rowRef = useRef<HTMLDivElement | null>(null);

  // HO 492 pattern: the rail is a bounded scroll region, so scoping a topic low
  // in the list would re-render it selected but with the rail scrolled to top,
  // hiding the selection. Bring the selected row into view within the rail's
  // overflow container only (block:"nearest" scrolls that container, not the
  // window). Build it with the fix already in (HO 492 shipped it after the fact).
  useEffect(() => {
    if (selected) rowRef.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  function scope() {
    const next = new URLSearchParams(searchParams.toString());
    if (selected) next.delete("topic");
    else next.set("topic", topic);
    next.delete("page"); // a topic change resets pagination to page 1
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
      <span className="mc-crow-tag">{label}</span>
      <span className="mc-crow-name" title={fullLabel}>
        {fullLabel}
      </span>
      <span className="mc-crow-act" aria-hidden>
        {pct > 0 ? (
          <span
            className="mc-crow-act-f"
            style={{ width: `${pct}%`, backgroundColor: barColor }}
          />
        ) : null}
      </span>
      <span className="mc-crow-mem">{count.toLocaleString()}</span>
    </div>
  );
}
