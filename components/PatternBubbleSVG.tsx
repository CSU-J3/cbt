"use client";

import { hierarchy, pack } from "d3-hierarchy";
import { useRouter } from "next/navigation";
import { useMemo } from "react";
import type { ClusterStat } from "@/lib/queries";

const WIDTH = 720;
const HEIGHT = 480;
const PADDING = 8;

// Linear lerp in sRGB space between #6b7280 (text-dim) and #10b981
// (stage-enacted). Saturation drift is acceptable for a 5-stop ramp — the
// goal is "more saturated green = pattern actually moves," not perceptual
// uniformity. Maps pctPastCommittee linearly into [0, 0.30] → [0, 1];
// anything above 30% saturates at full green (cra-disapproval territory).
const DIM: [number, number, number] = [0x6b, 0x72, 0x80];
const ENACTED: [number, number, number] = [0x10, 0xb9, 0x81];
const PCT_CEILING = 0.3;

function lerpHex(t: number): string {
  const k = Math.max(0, Math.min(1, t));
  const r = Math.round(DIM[0] + (ENACTED[0] - DIM[0]) * k);
  const g = Math.round(DIM[1] + (ENACTED[1] - DIM[1]) * k);
  const b = Math.round(DIM[2] + (ENACTED[2] - DIM[2]) * k);
  return `rgb(${r}, ${g}, ${b})`;
}

function fillForStat(s: ClusterStat): string {
  if (s.count === 0) return lerpHex(0);
  return lerpHex(s.pastCommittee / s.count / PCT_CEILING);
}

export function PatternBubbleSVG({
  stats,
  selected,
}: {
  stats: ClusterStat[];
  selected: string | null;
}) {
  const router = useRouter();

  const nodes = useMemo(() => {
    type Leaf = ClusterStat & { value: number };
    type Node = { children?: Leaf[] } & Partial<Leaf>;
    const root = hierarchy<Node>({
      children: stats.map((s) => ({ ...s, value: Math.max(s.count, 1) })),
    }).sum((d) => d.value ?? 0);
    const layout = pack<Node>().size([WIDTH, HEIGHT]).padding(PADDING);
    const packed = layout(root);
    return (packed.children ?? []).map((c) => ({
      stat: c.data as ClusterStat,
      x: c.x,
      y: c.y,
      r: c.r,
    }));
  }, [stats]);

  function onBubbleClick(slug: string) {
    const next = selected === slug ? "/patterns" : `/patterns?selected=${slug}`;
    router.push(next, { scroll: false });
  }

  return (
    <svg
      className="pattern-bubble-svg"
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Bill pattern cluster bubbles, sized by count, colored by past-committee progression."
    >
      {nodes.map(({ stat, x, y, r }) => {
        const isSelected = selected === stat.id;
        const isEmpty = stat.count === 0;
        const fill = fillForStat(stat);
        const labelLines = labelFor(stat, r);
        return (
          <g
            key={stat.id}
            className="pattern-bubble"
            transform={`translate(${x}, ${y})`}
            onClick={() => onBubbleClick(stat.id)}
            role="button"
            tabIndex={0}
            aria-pressed={isSelected}
            aria-label={`${stat.name}, ${stat.count} bills`}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onBubbleClick(stat.id);
              }
            }}
          >
            <circle
              r={r}
              fill={fill}
              fillOpacity={isEmpty ? 0.35 : 0.85}
              className={isSelected ? "selected" : undefined}
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

// Two-line label: pattern name on top, count below. Hide the count line on
// small bubbles (<32px radius) so the name still fits; hide both labels on
// truly tiny ones. The threshold is empirical — at r<24 the SVG `text` is
// wider than the circle even at the shortest names.
function labelFor(stat: ClusterStat, r: number): string[] {
  if (r < 24) return [];
  if (r < 36) return [stat.name];
  return [stat.name, stat.count.toLocaleString()];
}
