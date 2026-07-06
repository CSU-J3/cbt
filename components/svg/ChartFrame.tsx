// Shared SVG chart frame (HO 428). The <div overflow-x-auto> + <svg viewBox>
// wrapper the hand-rolled time-series charts repeat verbatim, plus the frame
// constants they duplicate. Extracted from BillsTimeSeries + CommitteeActivityChart
// (near-identical forks) when the 4th chart (polarization-over-time) landed. The
// IdeologyStrip dotplot deliberately stays on its own CSS-class layout — a dim1
// baseline axis with no Y-grid/legend doesn't fit this bar/line frame.
//
// Pure presentational (no hooks), so it renders in both server components (the bar
// charts) and client islands (the over-time chart). `legend` is an optional node
// rendered as a sibling BELOW the svg (where SvgLegend sits).
import type { ReactNode } from "react";

// The frame geometry the two bar charts share. A chart may override vbWidth/height
// (the over-time chart is taller); everything else stays constant.
export const CHART_VB_WIDTH = 1000;
export const CHART_HEIGHT = 240;
export const CHART_PAD = { top: 20, right: 16, bottom: 36, left: 40 };

export function ChartFrame({
  ariaLabel,
  vbWidth = CHART_VB_WIDTH,
  height = CHART_HEIGHT,
  children,
  legend,
}: {
  ariaLabel: string;
  vbWidth?: number;
  height?: number;
  children: ReactNode;
  legend?: ReactNode;
}) {
  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${vbWidth} ${height}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full"
        role="img"
        aria-label={ariaLabel}
      >
        {children}
      </svg>
      {legend}
    </div>
  );
}
