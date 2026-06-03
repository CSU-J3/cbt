"use client";

import { hierarchy, pack } from "d3-hierarchy";
import { useRouter, useSearchParams } from "next/navigation";
import { type MouseEvent, useCallback, useMemo, useRef, useState } from "react";

// HO 132 + 132.1: reusable bubble chart for the dashboard row-2 stage
// + topic surfaces. Sized by sqrt(count) implicitly via d3-hierarchy's
// pack layout — pack works on values, and feeding it Math.max(count, 1)
// reproduces the sqrt-faithful area encoding the HO 128 patterns
// chart established.
//
// Click behavior (HO 132.1):
//   - Each clickable bubble is wrapped in an SVG <a href> pointing to
//     the equivalent /bills view. Cmd/ctrl/shift/alt-click and middle/
//     aux-click preserve the browser-native behavior (open /bills in a
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
  /** Full category name for the HO 180 hover popover. Falls back to `label`. */
  fullName?: string;
};

// HO 180: hover-popover state — the bubble's full name + count, positioned from
// the hovered bubble's measured rect (relative to the chart wrapper), placed
// above the bubble (or below when it's near the top edge), clamped horizontally
// so it stays inside the overflow:hidden panel.
type HoverState = {
  name: string;
  count: number;
  left: number;
  top: number;
  placement: "above" | "below";
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
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  // HO 180: position the popover from the hovered bubble's screen rect, mapped
  // into wrapper coords. Above the bubble by default; below when it'd clip the
  // top edge. Horizontal center clamped so the box stays inside the panel.
  const showHover = useCallback((e: MouseEvent<Element>, datum: BubbleDatum) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    const br = e.currentTarget.getBoundingClientRect();
    const cx = br.left + br.width / 2 - wr.left;
    const MARGIN = 90;
    const left = Math.max(MARGIN, Math.min(cx, wr.width - MARGIN));
    const bubbleTop = br.top - wr.top;
    const placement: "above" | "below" = bubbleTop < 56 ? "below" : "above";
    const top = placement === "above" ? bubbleTop - 6 : br.bottom - wr.top + 6;
    setHover({
      name: datum.fullName ?? datum.label,
      count: datum.count,
      left,
      top,
      placement,
    });
  }, []);
  const clearHover = useCallback(() => setHover(null), []);

  const buildHref = useCallback(
    (basePath: "/" | "/bills", value: string | null): string => {
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
    // /bills href natively (new tab, etc.) — no soft routing.
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
    <div className="dashboard-bubble-wrap" ref={wrapRef}>
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

          // The /bills href is the cmd-click destination (always applies
          // this bubble's filter). The dashboard href is the soft-route
          // destination: setting the value on a new bubble, or dropping
          // the param when re-clicking the selected one.
          const feedHref = buildHref("/bills", datum.id);
          const dashboardHref = isSelected
            ? buildHref("/", null)
            : buildHref("/", datum.id);

          const bubble = (
            <g
              className={`dashboard-bubble${clickable ? "" : " is-static"}${isSelected ? " selected" : ""}`}
              transform={`translate(${x}, ${y})`}
              aria-label={ariaLabel}
              onMouseEnter={(e) => showHover(e, datum)}
              onMouseLeave={clearHover}
            >
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

      {/* HO 180: hover popover — full category name + count, tape/race-card
          style (absolute, opaque --bg-row-hover, above the chart). pointer-
          events:none so it never intercepts the bubble's click-to-filter. */}
      {hover ? (
        <div
          className="dashboard-bubble-popover"
          data-placement={hover.placement}
          style={{ left: hover.left, top: hover.top }}
        >
          <span className="dashboard-bubble-popover-name">{hover.name}</span>
          <span className="dashboard-bubble-popover-meta">
            {hover.count.toLocaleString()} bills
          </span>
        </div>
      ) : null}
    </div>
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
