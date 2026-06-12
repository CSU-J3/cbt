"use client";

// HO 237 — the leader-line frustum overlay for the metro insets. The overview
// SVG and the inset boxes are separate elements, so the connecting lines live in
// an absolutely-positioned, pointer-events:none overlay spanning the maps band.
// Per inset: two lines, source-rect bottom-left → inset top-left and bottom-
// right → inset top-right, so the eye reads "this box magnifies that area."
//
// Fill-agnostic (it only draws lines from geometry), so it's shared by both the
// Races and Primaries modals — unlike the polygon band render, which stays
// duplicated per HO 236 because its fill rule differs.
import { useLayoutEffect, useRef, useState } from "react";
import type { MetroPanelGeometry } from "@/lib/district-geo";

const VIEW_W = 800;
const VIEW_H = 600;

// Source-region horizontal center, for ordering the inset row left→right (so
// leader lines never cross). Metros without an overviewBox sort to the left.
export function metroCenterX(m: MetroPanelGeometry): number {
  return m.overviewBox ? m.overviewBox.x + m.overviewBox.w / 2 : 0;
}

type Line = { x1: number; y1: number; x2: number; y2: number };

export function MetroLeaderLines({
  bandRef,
  overviewSvgRef,
  metros,
}: {
  bandRef: React.RefObject<HTMLDivElement | null>;
  overviewSvgRef: React.RefObject<SVGSVGElement | null>;
  // Already ordered left→right by overviewBox x-center (same order the inset
  // boxes render in, so DOM order matches and the lines never cross).
  metros: MetroPanelGeometry[];
}) {
  const [lines, setLines] = useState<Line[]>([]);
  const metrosRef = useRef(metros);
  metrosRef.current = metros;

  useLayoutEffect(() => {
    const band = bandRef.current;
    const svg = overviewSvgRef.current;
    if (!band || !svg) return;

    const compute = () => {
      const bandRect = band.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      if (svgRect.width === 0) return;
      // preserveAspectRatio="xMidYMid meet" mapping (robust to any
      // letterboxing): uniform scale, content centered in the SVG element box.
      const scale = Math.min(svgRect.width / VIEW_W, svgRect.height / VIEW_H);
      const offX =
        svgRect.left - bandRect.left + (svgRect.width - VIEW_W * scale) / 2;
      const offY =
        svgRect.top - bandRect.top + (svgRect.height - VIEW_H * scale) / 2;
      const sx = (vx: number) => offX + vx * scale;
      const sy = (vy: number) => offY + vy * scale;

      const insets = Array.from(
        band.querySelectorAll<HTMLElement>(".rdm-metro"),
      );
      const out: Line[] = [];
      metrosRef.current.forEach((m, i) => {
        const ob = m.overviewBox;
        const inset = insets[i];
        if (!ob || !inset) return;
        const ir = inset.getBoundingClientRect();
        const rectBottom = sy(ob.y + ob.h);
        const bl = sx(ob.x);
        const br = sx(ob.x + ob.w);
        const insetTop = ir.top - bandRect.top;
        const insetLeft = ir.left - bandRect.left;
        const insetRight = ir.right - bandRect.left;
        out.push({ x1: bl, y1: rectBottom, x2: insetLeft, y2: insetTop });
        out.push({ x1: br, y1: rectBottom, x2: insetRight, y2: insetTop });
      });
      setLines(out);
    };

    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(band);
    return () => ro.disconnect();
  }, [bandRef, overviewSvgRef]);

  if (lines.length === 0) return null;
  return (
    <svg className="rdm-frustum" aria-hidden>
      {lines.map((l, i) => (
        <line key={i} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} />
      ))}
    </svg>
  );
}
