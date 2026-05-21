// Cumulative laws enacted, 119th vs 118th Congress, by week of session
// (HO 101). The honest answer to "is this Congress keeping pace?" — the 118th
// runs the full term as a muted reference curve, the 119th is the live amber
// curve up to today. First chart on /reports. Hand-rolled SVG, sharing the
// SvgGridY / SvgLegend primitives with BillsTimeSeries and the sponsor scatter.
import { SvgGridY } from "@/components/svg/SvgGridY";
import { SvgLegend } from "@/components/svg/SvgLegend";
import { getLawsEnactedBySessionWeek, type LawsByWeekRow } from "@/lib/queries";

const VB_WIDTH = 1000;
const CHART_HEIGHT = 300;
const PAD = { top: 30, right: 20, bottom: 44, left: 52 };
const FULL_TERM_WEEKS = 104; // a 2-year Congress, Jan 3 → Jan 3
const WEEK_MS = 7 * 86_400_000;
const C118 = "var(--text-muted)";
const C119 = "var(--accent-amber-bright)";

export async function LawsEnactedComparison() {
  const rows = await getLawsEnactedBySessionWeek();
  const s118 = rows.filter((r) => r.congress === 118);
  const s119 = rows.filter((r) => r.congress === 119);

  if (s118.length === 0 || s119.length === 0) {
    return (
      <p
        className="py-8 text-center text-[13px]"
        style={{ color: "var(--text-dim)" }}
      >
        No data yet.
      </p>
    );
  }

  const maxWeek = Math.max(FULL_TERM_WEEKS, ...rows.map((r) => r.weekOfSession));
  const maxLaws = Math.max(...rows.map((r) => r.cumulativeLaws));
  const yAxisMax = Math.max(50, Math.ceil(maxLaws / 50) * 50);

  const innerWidth = VB_WIDTH - PAD.left - PAD.right;
  const innerHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const xScale = (w: number) => PAD.left + (w / maxWeek) * innerWidth;
  const yScale = (n: number) =>
    PAD.top + (1 - n / yAxisMax) * innerHeight;
  const points = (s: LawsByWeekRow[]) =>
    s
      .map(
        (r) =>
          `${xScale(r.weekOfSession).toFixed(1)},${yScale(r.cumulativeLaws).toFixed(1)}`,
      )
      .join(" ");

  // 119th "today" — weeks since its Jan 3 2025 start. The marker tracks the
  // calendar, independent of when the last law happened to be enacted.
  const todayWeek = Math.min(
    maxWeek,
    Math.max(
      0,
      Math.floor(
        (Date.now() - Date.parse("2025-01-03T00:00:00Z")) / WEEK_MS,
      ),
    ),
  );
  const last119 = s119[s119.length - 1]!;
  const laws119 = last119.cumulativeLaws;
  // 118th's cumulative total at the same point in its term.
  const at118 =
    [...s118].reverse().find((r) => r.weekOfSession <= todayWeek)
      ?.cumulativeLaws ?? 0;

  // x-axis labels every 13 weeks (≈ quarterly), with the final week pinned.
  const weekTicks: number[] = [];
  for (let w = 0; w <= maxWeek; w += 13) weekTicks.push(w);
  if (weekTicks[weekTicks.length - 1] !== maxWeek) weekTicks.push(maxWeek);

  const markerX = xScale(todayWeek);
  const labelOnLeft = todayWeek / maxWeek > 0.55;
  const anchor = labelOnLeft ? "end" : "start";
  const labelDx = labelOnLeft ? -6 : 6;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full"
        role="img"
        aria-label="Cumulative laws enacted, 119th Congress versus 118th, by week of session"
      >
        <SvgGridY
          padLeft={PAD.left}
          padTop={PAD.top}
          innerWidth={innerWidth}
          innerHeight={innerHeight}
          max={yAxisMax}
          format={(v) => Math.round(v).toLocaleString()}
          labelGap={8}
        />

        {weekTicks.map((w) => (
          <text
            key={w}
            x={xScale(w)}
            y={CHART_HEIGHT - PAD.bottom + 18}
            textAnchor="middle"
            fontSize="11"
            fill="var(--text-muted)"
            fontFamily="var(--font-mono)"
          >
            {w}
          </text>
        ))}
        <text
          x={PAD.left + innerWidth / 2}
          y={CHART_HEIGHT - 8}
          textAnchor="middle"
          fontSize="11"
          fill="var(--text-muted)"
          fontFamily="var(--font-mono)"
          letterSpacing="0.5"
        >
          WEEK OF SESSION
        </text>

        {/* today marker */}
        <line
          x1={markerX}
          x2={markerX}
          y1={PAD.top}
          y2={PAD.top + innerHeight}
          stroke="var(--border-strong)"
          strokeWidth={1}
          strokeDasharray="3 3"
        />
        <text
          x={markerX + labelDx}
          y={PAD.top - 16}
          textAnchor={anchor}
          fontSize="11"
          fill={C119}
          fontFamily="var(--font-mono)"
        >
          119th · wk {todayWeek} · {laws119.toLocaleString()} laws
        </text>
        <text
          x={markerX + labelDx}
          y={PAD.top - 3}
          textAnchor={anchor}
          fontSize="11"
          fill="var(--text-muted)"
          fontFamily="var(--font-mono)"
        >
          118th by wk {todayWeek}: {at118.toLocaleString()}
        </text>

        {/* 118th — full term, muted reference */}
        <polyline
          fill="none"
          stroke={C118}
          strokeWidth={2}
          strokeLinejoin="round"
          points={points(s118)}
        />
        {/* 119th — partial, the live curve */}
        <polyline
          fill="none"
          stroke={C119}
          strokeWidth={2.5}
          strokeLinejoin="round"
          points={points(s119)}
        />
        <circle
          cx={xScale(last119.weekOfSession)}
          cy={yScale(last119.cumulativeLaws)}
          r={4}
          fill={C119}
        />
      </svg>

      <SvgLegend
        items={[
          { label: "119th (current)", color: C119 },
          { label: "118th (2023–25)", color: C118 },
        ]}
        trailing="cumulative laws enacted"
      />
    </div>
  );
}
