"use client";

import { hierarchy, pack } from "d3-hierarchy";
import { useRouter } from "next/navigation";
import { useMemo } from "react";

// HO 132: reusable bubble chart for the dashboard row-2 stage + topic
// surfaces. Sized by sqrt(count) implicitly via d3-hierarchy's pack
// layout — pack works on values, and feeding it Math.max(count, 1)
// reproduces the sqrt-faithful area encoding the HO 128 patterns
// chart established. Client island only because the optional click
// handler needs useRouter for soft navigation; if no onSelectHref is
// passed the bubbles render static.
export type BubbleDatum = {
  id: string;
  label: string;
  count: number;
  color: string;
  /** Optional native tooltip on hover. Falls back to `${label}, ${count} bills`. */
  tooltip?: string;
};

// Internal viewBox math. The chart's actual pixel size is driven by
// CSS (.dashboard-bubble-svg fills its grid cell); these constants
// only affect the aspect ratio of the bubble pack layout.
const VIEW_W = 720;
const VIEW_H = 360;
const PADDING = 6;
const MIN_RADIUS = 12;

export function DashboardBubbleChart({
  data,
  onSelectHref,
  height = VIEW_H,
}: {
  data: BubbleDatum[];
  onSelectHref?: (id: string) => string;
  /** ViewBox height; rarely overridden. Pixel height is CSS-driven. */
  height?: number;
}) {
  const router = useRouter();

  const nodes = useMemo(() => {
    type Leaf = BubbleDatum & { value: number };
    type Node = { children?: Leaf[] } & Partial<Leaf>;
    const root = hierarchy<Node>({
      children: data.map((d) => ({ ...d, value: Math.max(d.count, 1) })),
    }).sum((d) => d.value ?? 0);
    const layout = pack<Node>().size([VIEW_W, height]).padding(PADDING);
    const packed = layout(root);
    return (packed.children ?? []).map((c) => ({
      datum: c.data as BubbleDatum,
      x: c.x,
      y: c.y,
      r: Math.max(c.r, MIN_RADIUS),
    }));
  }, [data, height]);

  function handleClick(id: string) {
    if (!onSelectHref) return;
    const href = onSelectHref(id);
    router.push(href, { scroll: false });
  }

  return (
    <svg
      className="dashboard-bubble-svg"
      viewBox={`0 0 ${VIEW_W} ${height}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
    >
      {nodes.map(({ datum, x, y, r }) => {
        const isEmpty = datum.count === 0;
        const clickable = !!onSelectHref && !isEmpty;
        const labelLines = labelFor(datum, r);
        const ariaLabel = isEmpty
          ? `${datum.label}, no bills`
          : `${datum.label}, ${datum.count.toLocaleString()} bills`;
        const tooltipText = isEmpty
          ? null
          : (datum.tooltip ?? `${datum.label} — ${datum.count.toLocaleString()} bills`);
        return (
          <g
            key={datum.id}
            className={`dashboard-bubble${clickable ? "" : " is-static"}`}
            transform={`translate(${x}, ${y})`}
            onClick={clickable ? () => handleClick(datum.id) : undefined}
            role={clickable ? "button" : undefined}
            tabIndex={clickable ? 0 : undefined}
            aria-label={ariaLabel}
            onKeyDown={
              clickable
                ? (e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleClick(datum.id);
                    }
                  }
                : undefined
            }
          >
            {tooltipText ? <title>{tooltipText}</title> : null}
            <circle
              r={r}
              fill={datum.color}
              fillOpacity={isEmpty ? 0.35 : 0.85}
            />
            {labelLines.map((line, i) => (
              <text
                key={i}
                y={(i - (labelLines.length - 1) / 2) * 14}
                textAnchor="middle"
                dominantBaseline="middle"
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

// Label-sizing tiers per Phase 1 proposal 3:
//   r < 16 → no inline text (relies on the native <title> tooltip)
//   r < 28 → label only
//   r ≥ 28 → label + count on two stacked lines
function labelFor(datum: BubbleDatum, r: number): string[] {
  if (r < 16) return [];
  if (r < 28) return [datum.label];
  return [datum.label, datum.count.toLocaleString()];
}
