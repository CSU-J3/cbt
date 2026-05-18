import { getBillsByMonth } from "@/lib/queries";
import { topicColor, topicLabel } from "@/lib/topic-colors";

const TOP_N_TOPICS = 6;
const CHART_HEIGHT = 240;
const PAD = { top: 20, right: 16, bottom: 36, left: 40 };
const VB_WIDTH = 1000;

function sumValues(obj: Record<string, number>): number {
  let s = 0;
  for (const v of Object.values(obj)) s += v;
  return s;
}

function formatMonthLabel(month: string): string {
  // 'YYYY-MM' → "Mon 'YY"
  const [yStr, mStr] = month.split("-");
  const m0 = Number(mStr) - 1;
  const short = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ][m0];
  return `${short} '${yStr?.slice(2) ?? ""}`;
}

export async function BillsTimeSeries() {
  const rows = await getBillsByMonth();

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

  // Rank topics by overall count; everything outside the top N rolls into 'other'.
  const totalsByTopic = new Map<string, number>();
  for (const r of rows) {
    totalsByTopic.set(r.topic, (totalsByTopic.get(r.topic) ?? 0) + r.count);
  }
  const topTopics = Array.from(totalsByTopic.entries())
    .filter(([t]) => t !== "other")
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_N_TOPICS)
    .map(([t]) => t);
  const topTopicsSet = new Set(topTopics);

  const months = Array.from(new Set(rows.map((r) => r.month))).sort();
  const stack: Record<string, Record<string, number>> = {};
  for (const m of months) stack[m] = {};
  for (const r of rows) {
    const topic = topTopicsSet.has(r.topic) ? r.topic : "other";
    stack[r.month]![topic] = (stack[r.month]![topic] ?? 0) + r.count;
  }

  // Top topics first (base of bar), 'other' last (top of bar — visually
  // fades into the less-visible territory).
  const stackOrder = [...topTopics, "other"];

  const maxTotal = Math.max(...months.map((m) => sumValues(stack[m]!)));
  // Round axis cap up to nearest 100 for a clean tick scheme.
  const yAxisMax = Math.max(100, Math.ceil(maxTotal / 100) * 100);

  const innerWidth = VB_WIDTH - PAD.left - PAD.right;
  const innerHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const barWidth = innerWidth / months.length;
  const barGap = Math.max(2, barWidth * 0.15);
  const drawBarWidth = Math.max(1, barWidth - barGap);

  // ~8 visible x-axis labels across the range; first and last always show.
  const labelStep = Math.max(1, Math.ceil(months.length / 8));

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full"
        role="img"
        aria-label="Bills introduced per month stacked by topic"
      >
        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const y = PAD.top + innerHeight * (1 - t);
          const label = Math.round(yAxisMax * t);
          return (
            <g key={t}>
              <line
                x1={PAD.left}
                x2={PAD.left + innerWidth}
                y1={y}
                y2={y}
                stroke="var(--border-soft)"
                strokeWidth={1}
              />
              <text
                x={PAD.left - 6}
                y={y + 4}
                textAnchor="end"
                fontSize="11"
                fill="var(--text-dim)"
                fontFamily="var(--font-mono)"
              >
                {label.toLocaleString()}
              </text>
            </g>
          );
        })}

        {months.map((month, i) => {
          const x = PAD.left + i * barWidth + barGap / 2;
          let cursorY = PAD.top + innerHeight;
          return (
            <g key={month}>
              {stackOrder.map((topic) => {
                const value = stack[month]![topic] ?? 0;
                if (value === 0) return null;
                const segHeight = (value / yAxisMax) * innerHeight;
                cursorY -= segHeight;
                return (
                  <rect
                    key={topic}
                    x={x}
                    y={cursorY}
                    width={drawBarWidth}
                    height={segHeight}
                    fill={topicColor(topic)}
                  >
                    <title>
                      {formatMonthLabel(month)} · {topicLabel(topic)} · {value}
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

      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] uppercase tracking-[0.5px]">
        {stackOrder.map((topic) => (
          <span key={topic} className="inline-flex items-center gap-1">
            <span
              aria-hidden
              className="inline-block h-2 w-2"
              style={{ backgroundColor: topicColor(topic) }}
            />
            <span style={{ color: topicColor(topic) }}>
              {topicLabel(topic)}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
