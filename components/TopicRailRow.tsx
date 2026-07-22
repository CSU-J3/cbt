"use client";

// HO 496: a topic row in the /bills two-pane rail. Unlike CommitteeRailRow /
// IssueRailRow (single-scope: clicking REPLACES the scope), this is MULTI-SELECT —
// clicking adds/removes the topic from the ?topics= CSV (OR semantics), preserving
// every other param. Re-clicking a lit row removes it. Mirrors the TopicFilter
// toggle (components/TopicFilter.tsx) but as a router.push rail row rather than a
// server-rendered <Link>, so it can read + rewrite the live ?topics= list.
//
// The selection marker is a topic-colored filled square (`.bl-mark`), a checkbox
// affordance that reads as "one of several" — deliberately NOT the single-select
// amber left-border the shared .mc-crow.is-sel carries (which would imply the
// single-scope rails' replace semantics). So this row never takes .is-sel.
import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function TopicRailRow({
  topic,
  fullLabel,
  count,
  pct,
  color,
  selected,
}: {
  topic: string;
  fullLabel: string;
  count: number;
  pct: number;
  color: string;
  selected: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function toggle() {
    const next = new URLSearchParams(searchParams.toString());
    const current = (next.get("topics") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const updated = current.includes(topic)
      ? current.filter((t) => t !== topic)
      : [...current, topic];
    if (updated.length > 0) next.set("topics", updated.join(","));
    else next.delete("topics");
    // A topic toggle changes the result set, so reset to page 1 (the current
    // ?page= may not exist under the new filter). Everything else — stage,
    // chamber, ceremonial, q, sort — rides through untouched.
    next.delete("page");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }

  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      onClick={toggle}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggle();
        }
      }}
      className={`mc-crow bl-crow${selected ? " is-on" : ""}${
        count === 0 ? " bl-zero" : ""
      }`}
    >
      <span
        className="bl-mark"
        aria-hidden
        style={{
          borderColor: color,
          backgroundColor: selected ? color : "transparent",
        }}
      />
      <span
        className="mc-crow-name"
        title={fullLabel}
        style={selected ? { color } : undefined}
      >
        {fullLabel}
      </span>
      <span className="mc-crow-act" aria-hidden>
        {count > 0 ? (
          <span
            className="mc-crow-act-f"
            style={{ width: `${pct}%`, backgroundColor: color }}
          />
        ) : null}
      </span>
      <span className="mc-crow-mem">{count.toLocaleString()}</span>
    </div>
  );
}
