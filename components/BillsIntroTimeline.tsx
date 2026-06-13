// HO 243 — total introductions on a TRUE calendar axis. Sits above the
// per-topic BillsTimeSeries (HO 66) as the headline overall-volume trend;
// the single amber line equals the envelope of that stacked chart because
// getIntroductionsByMonth shares its universe (current Congress, non-
// ceremonial, topics NOT NULL). Hand-rolled SVG per house convention,
// reusing SvgGridY; the dashed year divider + partial tail follow
// LawsEnactedComparison's `strokeDasharray="3 3"` visual.
import { SvgGridY } from "@/components/svg/SvgGridY";
import { SvgLegend } from "@/components/svg/SvgLegend";
import { getIntroductionsByMonth } from "@/lib/queries";

const VB_WIDTH = 1000;
const CHART_HEIGHT = 260;
const PAD = { top: 28, right: 20, bottom: 40, left: 48 };
const LINE = "var(--accent-amber-bright)";
// Calendar anchor — the 119th Congress opened Jan 2025. The axis runs from
// here to the current month regardless of where data happens to start/end.
const AXIS_START = "2025-01";

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// 'YYYY-MM' → absolute month index (year*12 + month0), the calendar metric
// that makes a skipped month read as a gap rather than a tight bin.
function monthIndex(month: string): number {
  const [y, m] = month.split("-");
  return Number(y) * 12 + (Number(m) - 1);
}

function indexToLabel(idx: number): string {
  const y = Math.floor(idx / 12);
  const m0 = ((idx % 12) + 12) % 12;
  return `${MONTHS[m0]} '${String(y).slice(2)}`;
}

export async function BillsIntroTimeline() {
  const rows = await getIntroductionsByMonth();

  if (rows.length === 0) {
    return (
      <p
        className="py-8 text-center text-[13px]"
        style={{ color: "var(--text-dim)" }}
      >
        No data yet.
      </p>
    );
  }

  const sorted = [...rows].sort((a, b) => a.month.localeCompare(b.month));
  const now = new Date();
  const currentMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;

  // Domain covers Jan 2025 → current month, extended to bound any stray data.
  const startIdx = Math.min(
    monthIndex(AXIS_START),
    monthIndex(sorted[0]!.month),
  );
  const endIdx = Math.max(
    monthIndex(currentMonth),
    monthIndex(sorted[sorted.length - 1]!.month),
  );
  const span = Math.max(1, endIdx - startIdx);

  const maxCount = Math.max(...sorted.map((r) => r.count));
  const yAxisMax = Math.max(100, Math.ceil(maxCount / 100) * 100);

  const innerWidth = VB_WIDTH - PAD.left - PAD.right;
  const innerHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const xScale = (idx: number) =>
    PAD.left + ((idx - startIdx) / span) * innerWidth;
  const yScale = (n: number) => PAD.top + (1 - n / yAxisMax) * innerHeight;

  const pts = sorted.map((r) => ({
    x: xScale(monthIndex(r.month)),
    y: yScale(r.count),
    month: r.month,
    count: r.count,
  }));

  // The current incomplete month must not read as a real drop — its trailing
  // segment goes dashed, its end point hollow, with a "partial" label.
  const lastIsPartial = sorted[sorted.length - 1]!.month === currentMonth;
  const solidPts = lastIsPartial ? pts.slice(0, -1) : pts;
  const dashSeg =
    lastIsPartial && pts.length >= 2
      ? [pts[pts.length - 2]!, pts[pts.length - 1]!]
      : null;
  const toPolyline = (a: { x: number; y: number }[]) =>
    a.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

  // Year dividers: a dashed vertical at each Jan boundary inside the domain,
  // labeled with the year (the Dec 2025 → Jan 2026 rule the handoff calls for,
  // generalized so 2027+ pick up for free).
  const dividers: { x: number; year: number }[] = [];
  const startYear = Math.floor((startIdx + 1) / 12);
  const endYear = Math.floor(endIdx / 12);
  for (let y = startYear; y <= endYear; y++) {
    const bIdx = monthIndex(`${y}-01`);
    if (bIdx > startIdx && bIdx < endIdx) dividers.push({ x: xScale(bIdx), year: y });
  }

  // ~8 month labels across the calendar domain; first + last always shown.
  const totalMonths = span + 1;
  const labelStep = Math.max(1, Math.ceil(totalMonths / 8));
  const monthLabels: { x: number; label: string }[] = [];
  for (let i = 0; i <= span; i++) {
    if (i % labelStep !== 0 && i !== span) continue;
    monthLabels.push({ x: xScale(startIdx + i), label: indexToLabel(startIdx + i) });
  }

  const lastPt = pts[pts.length - 1]!;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full"
        role="img"
        aria-label="Total bills introduced per month on a calendar axis"
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

        {/* year dividers */}
        {dividers.map((d) => (
          <g key={d.year}>
            <line
              x1={d.x}
              x2={d.x}
              y1={PAD.top}
              y2={PAD.top + innerHeight}
              stroke="var(--border-strong)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={d.x + 5}
              y={PAD.top + 11}
              textAnchor="start"
              fontSize="11"
              fill="var(--text-muted)"
              fontFamily="var(--font-mono)"
            >
              {d.year}
            </text>
          </g>
        ))}

        {/* month labels */}
        {monthLabels.map((l, i) => (
          <text
            key={`${l.label}-${i}`}
            x={l.x}
            y={CHART_HEIGHT - PAD.bottom + 18}
            textAnchor="middle"
            fontSize="11"
            fill="var(--text-muted)"
            fontFamily="var(--font-mono)"
          >
            {l.label}
          </text>
        ))}

        {/* solid line through complete months */}
        {solidPts.length >= 2 && (
          <polyline
            fill="none"
            stroke={LINE}
            strokeWidth={2.5}
            strokeLinejoin="round"
            points={toPolyline(solidPts)}
          />
        )}
        {/* dashed final segment into the partial current month */}
        {dashSeg && (
          <polyline
            fill="none"
            stroke={LINE}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeDasharray="4 3"
            points={toPolyline(dashSeg)}
          />
        )}

        {/* points: filled for complete months, hollow for the partial tail */}
        {pts.map((p, i) => {
          const hollow = lastIsPartial && i === pts.length - 1;
          return (
            <circle
              key={p.month}
              cx={p.x}
              cy={p.y}
              r={3.5}
              fill={hollow ? "var(--bg-panel)" : LINE}
              stroke={LINE}
              strokeWidth={hollow ? 1.5 : 0}
            >
              <title>
                {indexToLabel(monthIndex(p.month))} · {p.count.toLocaleString()}
                {hollow ? " (partial)" : ""}
              </title>
            </circle>
          );
        })}

        {/* partial-month label */}
        {lastIsPartial && (
          <text
            x={lastPt.x}
            y={lastPt.y - 9}
            textAnchor="end"
            fontSize="10"
            fill="var(--text-dim)"
            fontFamily="var(--font-mono)"
            letterSpacing="0.5"
          >
            partial
          </text>
        )}
      </svg>

      <SvgLegend
        items={[{ label: "Introductions", color: LINE }]}
        trailing="total per month · dashed tail = current month (partial)"
      />
    </div>
  );
}
