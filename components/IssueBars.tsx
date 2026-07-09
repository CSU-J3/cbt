import Link from "next/link";
import type { IssueStat } from "@/lib/queries";

// HO 437 — the /lobbying LEFT column: one ranked bar per LDA general_issue_code,
// bar length = filing count (linear, scaled to the max). Native LDA labels — NOT
// crosswalked to the 24 CBT topics (that mapping is lossy; the source taxonomy is
// ~79 codes). Server component: selection is URL-driven via ?issue=<code>, so each
// row is a plain <Link> (no client island). A code is ALWAYS selected (the page
// auto-selects the top one), so the drill on the right is never blank.
//
// Neutral single hue for v1 — there's no natural progress ramp like Patterns'
// "% past committee." Built to the /patterns bar idiom with an inline 3-col grid
// (the shared .pattern-bar-row is a fixed 4-col layout).
const GRID = "minmax(0, 1.4fr) minmax(0, 2fr) 64px";

export function IssueBars({
  issues,
  selected,
}: {
  issues: IssueStat[];
  selected: string | null;
}) {
  const maxFilings = Math.max(1, ...issues.map((i) => i.filings));

  return (
    <div className="border" style={{ borderColor: "var(--border-strong)" }}>
      <div
        className="grid items-center gap-x-[14px] px-[14px] py-[9px] text-[11px] uppercase tracking-[0.5px]"
        style={{
          gridTemplateColumns: GRID,
          backgroundColor: "var(--bg-panel)",
          borderBottom: "0.5px solid var(--border-strong)",
          color: "var(--text-dim)",
        }}
      >
        <span>Issue</span>
        <span aria-hidden />
        <span className="text-right">Filings</span>
      </div>
      <ul>
        {issues.map((s) => {
          const isSelected = s.code === selected;
          const widthPct = (s.filings / maxFilings) * 100;
          return (
            <li key={s.code}>
              <Link
                href={`/lobbying?issue=${encodeURIComponent(s.code)}`}
                scroll={false}
                aria-current={isSelected ? "true" : undefined}
                title={s.display}
                className="grid items-center gap-x-[14px] px-[14px] py-[10px] no-underline transition hover:bg-[var(--bg-row-hover)]"
                style={{
                  gridTemplateColumns: GRID,
                  borderBottom: "0.5px solid var(--border-soft)",
                  borderLeft: `3px solid ${isSelected ? "var(--accent-amber)" : "transparent"}`,
                  backgroundColor: isSelected ? "var(--bg-row-hover)" : undefined,
                }}
              >
                <span className="flex min-w-0 flex-col leading-[1.2]">
                  <span
                    className="truncate text-[12px]"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {s.display}
                  </span>
                  <span
                    className="text-[10px] uppercase tracking-[0.5px]"
                    style={{ color: "var(--text-dim)" }}
                  >
                    {s.code}
                  </span>
                </span>
                <span
                  className="block h-[10px] overflow-hidden rounded-[2px]"
                  style={{ backgroundColor: "var(--bg-row-hover)" }}
                  aria-hidden
                >
                  <span
                    className="block h-full rounded-[2px]"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: "var(--accent-amber)",
                      opacity: 0.55,
                    }}
                  />
                </span>
                <span
                  className="text-right text-[12px] tabular-nums"
                  style={{ color: "var(--text-muted)" }}
                >
                  {s.filings.toLocaleString()}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
