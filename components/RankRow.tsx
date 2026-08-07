import Link from "next/link";

// HO 616 — the ranked bar row, extracted from two page-local copies.
//
// /amendments carried it as a local `RankRow` function; /nominations carried the
// same markup INLINE inside its agency `.map`, with a slightly different track
// ratio and an active state the other one lacked. Two copies of a row that render
// the same thing is the collector-helpers drift class (backlog, HO 574), and this
// HO touches both — so they become one component before either is changed.
//
// `labelFr` is a prop rather than a unified constant, and that is deliberate. The
// two surfaces rank different vocabularies at different row widths — agency names
// across a full-width 2,526px row, bill labels and member names inside a 1,254px
// column — so the label:bar ratio is a per-surface design value, not drift.
// Everything that WAS drift (bar markup, fill colour and opacity, truncation,
// count formatting, hover, row border) is shared here and cannot diverge again.
//
// This row is marked `data-viz-row` BY ITS CONTAINER, not here: the exemption goes
// on the table so a column header stays over the columns it labels. See the
// exemption registry in docs/backlog.md.
export function RankRow({
  href,
  label,
  sub,
  count,
  widthPct,
  dotColor,
  labelFr = 1.6,
  active = false,
  scroll,
}: {
  href: string;
  label: string;
  sub?: string | null;
  count: number;
  widthPct: number;
  dotColor?: string;
  labelFr?: number;
  active?: boolean;
  scroll?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        scroll={scroll}
        aria-current={active ? "true" : undefined}
        className="grid items-center gap-x-[14px] px-[14px] py-[9px] no-underline transition hover:bg-[var(--bg-row-hover)]"
        style={{
          gridTemplateColumns: `minmax(0, ${labelFr}fr) minmax(0, 2fr) 56px`,
          borderBottom: "0.5px solid var(--border-soft)",
          borderLeft: `3px solid ${active ? "var(--accent-amber)" : "transparent"}`,
          backgroundColor: active ? "var(--bg-row-hover)" : undefined,
        }}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {dotColor ? (
            <span
              aria-hidden
              style={{ width: 7, height: 7, flexShrink: 0, borderRadius: "50%", backgroundColor: dotColor }}
            />
          ) : null}
          <span className="truncate text-[length:var(--fs-12)]" style={{ color: "var(--text-primary)" }}>
            {label}
          </span>
          {sub ? (
            <span className="truncate text-[length:var(--fs-11)]" style={{ color: "var(--text-muted)" }}>
              {sub}
            </span>
          ) : null}
        </span>
        <span
          className="block h-[10px] overflow-hidden rounded-[2px]"
          style={{ backgroundColor: "var(--bg-row-hover)" }}
          aria-hidden
        >
          <span
            className="block h-full rounded-[2px]"
            style={{ width: `${widthPct}%`, backgroundColor: "var(--accent-amber)", opacity: 0.55 }}
          />
        </span>
        <span
          className="text-right text-[length:var(--fs-12)] tabular-nums"
          style={{ color: "var(--text-muted)" }}
        >
          {count.toLocaleString()}
        </span>
      </Link>
    </li>
  );
}
