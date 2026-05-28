// HO 146 Chart A — committee activity over time. Stacked monthly bar chart,
// hand-rolled SVG, same idiom as BillsTimeSeries. Forked rather than
// parameterized because BillsTimeSeries is hardwired to getBillsByMonth().
import { SvgGridY } from "@/components/svg/SvgGridY";
import { SvgLegend } from "@/components/svg/SvgLegend";
import {
  type CommitteeActivityBucket,
  getCommitteeActivityByPeriod,
} from "@/lib/queries";

const CHART_HEIGHT = 240;
const PAD = { top: 20, right: 16, bottom: 36, left: 40 };
const VB_WIDTH = 1000;
const MIN_ROWS = 5;

// Throughput funnel mapping: arriving → working → leaving → noise.
// Stage tokens are reused — the throughput question is structurally a
// mini-funnel within one committee, so the same color language applies.
const BUCKET_COLORS: Record<CommitteeActivityBucket, string> = {
  Referred: "var(--stage-committee)",
  Markup: "var(--stage-floor)",
  Reported: "var(--stage-enacted)",
  Other: "var(--text-dim)",
};

// Stack order: base of the bar at the funnel mouth (Referred), top at the
// noise band (Other). Reading the bar bottom-up traces the throughput path.
const STACK_ORDER: CommitteeActivityBucket[] = [
  "Referred",
  "Markup",
  "Reported",
  "Other",
];

function formatMonthLabel(month: string): string {
  const [yStr, mStr] = month.split("-");
  const m0 = Number(mStr) - 1;
  const short = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ][m0];
  return `${short} '${yStr?.slice(2) ?? ""}`;
}

function sumValues(obj: Partial<Record<CommitteeActivityBucket, number>>): number {
  let s = 0;
  for (const v of Object.values(obj)) s += v ?? 0;
  return s;
}

export async function CommitteeActivityChart({
  systemCode,
}: {
  systemCode: string;
}) {
  const rows = await getCommitteeActivityByPeriod(systemCode);
  const totalRows = rows.reduce((s, r) => s + r.count, 0);

  if (totalRows < MIN_ROWS) {
    return (
      <p
        className="px-3 py-3 text-[12px]"
        style={{ color: "var(--text-dim)" }}
      >
        Not enough activity to chart.
      </p>
    );
  }

  const months = Array.from(new Set(rows.map((r) => r.month))).sort();
  const stack: Record<string, Partial<Record<CommitteeActivityBucket, number>>> = {};
  for (const m of months) stack[m] = {};
  for (const r of rows) {
    stack[r.month]![r.bucket] = (stack[r.month]![r.bucket] ?? 0) + r.count;
  }

  const maxTotal = Math.max(...months.map((m) => sumValues(stack[m]!)));
  // Tick scheme: round axis up to nearest 50 so even quiet committees get
  // gridlines that read as integers. High-volume committees still land on a
  // clean cap.
  const stepSize = maxTotal > 200 ? 100 : maxTotal > 40 ? 50 : 10;
  const yAxisMax = Math.max(
    stepSize,
    Math.ceil(maxTotal / stepSize) * stepSize,
  );

  const innerWidth = VB_WIDTH - PAD.left - PAD.right;
  const innerHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const barWidth = innerWidth / months.length;
  const barGap = Math.max(2, barWidth * 0.15);
  const drawBarWidth = Math.max(1, barWidth - barGap);

  const labelStep = Math.max(1, Math.ceil(months.length / 8));

  // Hide legend chips for buckets that never occur — most committees won't
  // have Discharged/Hearings/etc., so an empty "Other" chip would be noise.
  const presentBuckets = STACK_ORDER.filter((b) =>
    rows.some((r) => r.bucket === b && r.count > 0),
  );

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full"
        role="img"
        aria-label="Committee activity per month, stacked by activity type"
      >
        <SvgGridY
          padLeft={PAD.left}
          padTop={PAD.top}
          innerWidth={innerWidth}
          innerHeight={innerHeight}
          max={yAxisMax}
          format={(v) => Math.round(v).toLocaleString()}
        />

        {months.map((month, i) => {
          const x = PAD.left + i * barWidth + barGap / 2;
          let cursorY = PAD.top + innerHeight;
          return (
            <g key={month}>
              {STACK_ORDER.map((bucket) => {
                const value = stack[month]![bucket] ?? 0;
                if (value === 0) return null;
                const segHeight = (value / yAxisMax) * innerHeight;
                cursorY -= segHeight;
                return (
                  <rect
                    key={bucket}
                    x={x}
                    y={cursorY}
                    width={drawBarWidth}
                    height={segHeight}
                    fill={BUCKET_COLORS[bucket]}
                  >
                    <title>
                      {formatMonthLabel(month)} · {bucket} · {value}
                    </title>
                  </rect>
                );
              })}
            </g>
          );
        })}

        {months.map((month, i) => {
          if (i % labelStep !== 0 && i !== months.length - 1) return null;
          const x = PAD.left + i * barWidth + barWidth / 2;
          return (
            <text
              key={month}
              x={x}
              y={CHART_HEIGHT - PAD.bottom + 18}
              textAnchor="middle"
              fontSize="11"
              fill="var(--text-muted)"
              fontFamily="var(--font-mono)"
            >
              {formatMonthLabel(month)}
            </text>
          );
        })}
      </svg>

      <SvgLegend
        items={presentBuckets.map((bucket) => ({
          label: bucket,
          color: BUCKET_COLORS[bucket],
        }))}
      />
    </div>
  );
}
