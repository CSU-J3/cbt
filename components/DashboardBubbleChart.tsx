"use client";

import { hierarchy, pack } from "d3-hierarchy";
import { useRouter, useSearchParams } from "next/navigation";
import { type MouseEvent, useCallback, useMemo } from "react";

// HO 132 + 132.1: reusable bubble chart for the dashboard row-2 stage
// + topic surfaces. Sized by sqrt(count) implicitly via d3-hierarchy's
// pack layout — pack works on values, and feeding it Math.max(count, 1)
// reproduces the sqrt-faithful area encoding the HO 128 patterns
// chart established.
//
// Click behavior (HO 132.1):
//   - Each clickable bubble is wrapped in an SVG <a href> pointing to
//     the equivalent /feed view. Cmd/ctrl/shift/alt-click and middle/
//     aux-click preserve the browser-native behavior (open /feed in a
//     new tab).
//   - Plain click: preventDefault, then router.push("/?…") with the
//     current dimension's param toggled while every other param is
//     preserved. Opens the bills drawer mounted in app/page.tsx.
//   - Re-click on the currently-selected bubble drops that dimension's
//     param. If the other dimension's param is still set, the drawer
//     stays open with the remaining filter.
//
// The chart needs to know which URL param it owns; `paramKey` picks
// "stage" or "topics" so the stage chart and topic chart can write to
// their own dimensions without colliding.
export type BubbleDatum = {
  id: string;
  label: string;
  count: number;
  color: string;
  /** Native tooltip on hover. Falls back to `${label}, ${count} bills`. */
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
  paramKey,
  height = VIEW_H,
}: {
  data: BubbleDatum[];
  /** URL search param this chart owns. Stage chart = "stage", topic = "topics". */
  paramKey: "stage" | "topics";
  /** ViewBox height; rarely overridden. Pixel height is CSS-driven. */
  height?: number;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const currentValue = params.get(paramKey);

  const buildHref = useCallback(
    (basePath: "/" | "/feed", value: string | null): string => {
      const next = new URLSearchParams(params.toString());
      if (value === null) next.delete(paramKey);
      else next.set(paramKey, value);
      const qs = next.toString();
      return qs ? `${basePath}?${qs}` : basePath;
    },
    [params, paramKey],
  );

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

  function handleAnchorClick(
    e: MouseEvent<HTMLAnchorElement>,
    dashboardHref: string,
  ) {
    // Modifier-held or non-primary click: let the browser open the
    // /feed href natively (new tab, etc.) — no soft routing.
    if (
      e.metaKey ||
      e.ctrlKey ||
      e.shiftKey ||
      e.altKey ||
      e.button !== 0
    ) {
      return;
    }
    e.preventDefault();
    router.push(dashboardHref, { scroll: false });
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
        const isSelected = !isEmpty && currentValue === datum.id;
        const clickable = !isEmpty;
        const labelLines = labelFor(datum, r);
        const ariaLabel = isEmpty
          ? `${datum.label}, no bills`
          : `${datum.label}, ${datum.count.toLocaleString()} bills`;
        const tooltipText = isEmpty
          ? null
          : (datum.tooltip ?? `${datum.label} — ${datum.count.toLocaleString()} bills`);

        // The /feed href is the cmd-click destination (always applies
        // this bubble's filter). The dashboard href is the soft-route
        // destination: setting the value on a new bubble, or dropping
        // the param when re-clicking the selected one.
        const feedHref = buildHref("/feed", datum.id);
        const dashboardHref = isSelected
          ? buildHref("/", null)
          : buildHref("/", datum.id);

        const bubble = (
          <g
            className={`dashboard-bubble${clickable ? "" : " is-static"}${isSelected ? " selected" : ""}`}
            transform={`translate(${x}, ${y})`}
            aria-label={ariaLabel}
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

        if (!clickable) {
          return <g key={datum.id}>{bubble}</g>;
        }

        return (
          <a
            key={datum.id}
            href={feedHref}
            onClick={(e) => handleAnchorClick(e, dashboardHref)}
            aria-label={ariaLabel}
          >
            {bubble}
          </a>
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
