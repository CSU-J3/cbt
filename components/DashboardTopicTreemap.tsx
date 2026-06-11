"use client";

import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import { useRouter, useSearchParams } from "next/navigation";
import { type MouseEvent, useCallback, useMemo, useRef, useState } from "react";

// HO 231 (design item 3) — Topic Distribution treemap, replacing the HO 132/180
// d3-pack bubble cluster. Squarified, STRICTLY area-proportional: accurate area
// comparison is the whole reason to leave bubbles (bubble area reads unreliably),
// so cells are never min-sized to fit a label. A cell is labeled only when it
// clears a legibility floor (tall AND wide enough for TOPIC + count); cells below
// it render filled + colored but unlabeled, with TOPIC + count on hover — the
// standard peek pattern. No min-area floor (that would re-introduce the bubble
// lie); if the tail reads as too many slivers, the floor is a Design-chat call.
//
// Matches the bubble's rendering model: a client island that lays out with
// d3-hierarchy (treemap lives in the same dep the bubble already pulled — no new
// dependency), renders SVG, and carries the HO 56 click-to-filter — plain click
// soft-routes `/?topics=<id>` (toggling), cmd/ctrl/shift/alt or aux click follows
// the `/bills?topics=<id>` href natively. Topic-only (paramKey is always
// "topics"); the stage surface is StageFunnel.
export type TopicDatum = {
  id: string;
  label: string;
  count: number;
  color: string;
  /** Full category name for the hover popover. Falls back to `label`. */
  fullName?: string;
};

// viewBox units. The svg is width:100% / height:auto, so the rendered height is
// containerWidth * (VIEW_H / VIEW_W) — a 4:1 strip ≈ half the bubble cluster's
// 2:1 height (recovers vertical space, per the density direction).
const VIEW_W = 720;
const VIEW_H = 180;
// Legibility floor (viewBox units ≈ rendered px at this scale): a cell must clear
// both to fit the top-left-anchored TOPIC + count without clipping. Below → no
// label, hover peek.
const LABEL_MIN_W = 50;
const LABEL_MIN_H = 34;

type HoverState = {
  name: string;
  count: number;
  left: number;
  top: number;
  placement: "above" | "below";
};

// Darken a #rrggbb toward black for the on-fill label — a tonal dark shade of the
// cell's own hue (topic-colors.ts exposes no dark variant). 0.4 reads legibly on
// the L55-62% per-topic fills.
function darken(hex: string, f = 0.4): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const r = Math.round(((n >> 16) & 255) * f);
  const g = Math.round(((n >> 8) & 255) * f);
  const b = Math.round((n & 255) * f);
  return `rgb(${r}, ${g}, ${b})`;
}

export function DashboardTopicTreemap({ data }: { data: TopicDatum[] }) {
  const router = useRouter();
  const params = useSearchParams();
  const currentValue = params.get("topics");
  const wrapRef = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<HoverState | null>(null);

  const cells = useMemo(() => {
    type Leaf = TopicDatum & { value: number };
    type Node = { children?: Leaf[] } & Partial<Leaf>;
    const root = hierarchy<Node>({
      children: data.map((d) => ({ ...d, value: Math.max(d.count, 0) })),
    })
      .sum((d) => d.value ?? 0)
      // Largest-first so squarify anchors the dominant topic (GOV) top-left.
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    const layout = treemap<Node>()
      .tile(treemapSquarify)
      .size([VIEW_W, VIEW_H])
      .paddingInner(0)
      .round(true);
    return layout(root)
      .leaves()
      .map((l) => ({
        datum: l.data as TopicDatum,
        x: l.x0,
        y: l.y0,
        w: l.x1 - l.x0,
        h: l.y1 - l.y0,
      }))
      .filter((c) => c.w > 0 && c.h > 0);
  }, [data]);

  const buildHref = useCallback(
    (basePath: "/" | "/bills", value: string | null): string => {
      const next = new URLSearchParams(params.toString());
      if (value === null) next.delete("topics");
      else next.set("topics", value);
      const qs = next.toString();
      return qs ? `${basePath}?${qs}` : basePath;
    },
    [params],
  );

  // Popover anchored from the hovered cell's screen rect, mapped into wrapper
  // coords (mirrors the bubble's HO 180 logic). Above the cell by default; below
  // when it would clip the strip's top edge; horizontal center clamped inside.
  const showHover = useCallback((e: MouseEvent<Element>, datum: TopicDatum) => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const wr = wrap.getBoundingClientRect();
    const cr = e.currentTarget.getBoundingClientRect();
    const cx = cr.left + cr.width / 2 - wr.left;
    const MARGIN = 90;
    const left = Math.max(MARGIN, Math.min(cx, wr.width - MARGIN));
    const cellTop = cr.top - wr.top;
    const placement: "above" | "below" = cellTop < 40 ? "below" : "above";
    const top = placement === "above" ? cellTop - 6 : cr.bottom - wr.top + 6;
    setHover({ name: datum.fullName ?? datum.label, count: datum.count, left, top, placement });
  }, []);
  const clearHover = useCallback(() => setHover(null), []);

  function handleAnchorClick(e: MouseEvent<HTMLAnchorElement>, dashboardHref: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    router.push(dashboardHref, { scroll: false });
  }

  return (
    <div className="topic-treemap-wrap" ref={wrapRef}>
      <svg
        className="topic-treemap-svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label="Topic distribution treemap"
      >
        {cells.map(({ datum, x, y, w, h }) => {
          const isSelected = currentValue === datum.id;
          const labeled = w >= LABEL_MIN_W && h >= LABEL_MIN_H;
          const labelFill = darken(datum.color);
          const ariaLabel = `${datum.label}, ${datum.count.toLocaleString()} bills`;
          const feedHref = buildHref("/bills", datum.id);
          const dashboardHref = isSelected ? buildHref("/", null) : buildHref("/", datum.id);

          return (
            <a
              key={datum.id}
              href={feedHref}
              onClick={(e) => handleAnchorClick(e, dashboardHref)}
              aria-label={ariaLabel}
            >
              <g
                className={`topic-treemap-cell${isSelected ? " selected" : ""}`}
                onMouseEnter={(e) => showHover(e, datum)}
                onMouseLeave={clearHover}
              >
                <rect x={x} y={y} width={w} height={h} fill={datum.color} />
                {labeled ? (
                  <>
                    <text
                      className="topic-treemap-label"
                      x={x + 6}
                      y={y + 16}
                      fill={labelFill}
                    >
                      {datum.label}
                    </text>
                    <text
                      className="topic-treemap-count"
                      x={x + 6}
                      y={y + 30}
                      fill={labelFill}
                    >
                      {datum.count.toLocaleString()}
                    </text>
                  </>
                ) : null}
              </g>
            </a>
          );
        })}
      </svg>

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
