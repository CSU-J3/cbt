// Cumulative laws enacted, the current Congress against the previous one, by
// week of session (HO 101; HO 838 made the pair follow getCurrentCongress, as
// HO 712 ruled). The honest answer to "is this Congress keeping pace?" — the
// previous Congress runs the full term as a muted reference curve, the current
// one is the live amber curve up to today. First chart on /reports.
// Hand-rolled SVG, sharing the SvgGridY / SvgLegend primitives with
// BillsTimeSeries and the sponsor scatter.
import { SvgGridY } from "@/components/svg/SvgGridY";
import { SvgLegend } from "@/components/svg/SvgLegend";
import { congressTermDates, ordinal } from "@/lib/congress";
import { getLawsEnactedBySessionWeek, type LawsByWeekRow } from "@/lib/queries";

const VB_WIDTH = 1000;
const CHART_HEIGHT = 300;
const PAD = { top: 30, right: 20, bottom: 44, left: 52 };
const FULL_TERM_WEEKS = 104; // a 2-year Congress, Jan 3 → Jan 3
const WEEK_MS = 7 * 86_400_000;
const C_PREV = "var(--text-muted)";
const C_CUR = "var(--accent-amber-bright)";

export async function LawsEnactedComparison() {
  // The reader names the pair it compared (HO 838); the chart never infers it.
  const { current, previous, rows } = await getLawsEnactedBySessionWeek();
  const sPrev = rows.filter((r) => r.congress === previous);
  const sCur = rows.filter((r) => r.congress === current);

  // With no reference curve there's nothing to pace against. A current
  // Congress with no laws yet (Jan 3 until its first enactment) still draws:
  // the reference curve, the today-marker and "no laws yet" (HO 838).
  if (sPrev.length === 0) {
    return (
      <p
        className="py-8 text-center text-[length:var(--fs-13)]"
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

  // The current Congress's "today": weeks since its Jan 3 start. The marker
  // tracks the calendar, independent of when the last law happened to be
  // enacted.
  const todayWeek = Math.min(
    maxWeek,
    Math.max(
      0,
      Math.floor(
        (Date.now() - congressTermDates(current).start.getTime()) / WEEK_MS,
      ),
    ),
  );
  const lastCur = sCur.length > 0 ? sCur[sCur.length - 1]! : null;
  // The previous Congress's cumulative total at the same point in its term.
  const atPrev =
    [...sPrev].reverse().find((r) => r.weekOfSession <= todayWeek)
      ?.cumulativeLaws ?? 0;

  // The previous Congress's years for the legend, "2023–25".
  const prevTerm = congressTermDates(previous);
  const prevYears = `${prevTerm.start.getUTCFullYear()}–${String(prevTerm.end.getUTCFullYear()).slice(2)}`;

  // x-axis labels every 13 weeks (≈ quarterly), with the final week pinned.
  const weekTicks: number[] = [];
  for (let w = 0; w <= maxWeek; w += 13) weekTicks.push(w);
  if (weekTicks[weekTicks.length - 1] !== maxWeek) weekTicks.push(maxWeek);

  const markerX = xScale(todayWeek);
  const labelOnLeft = todayWeek / maxWeek > 0.55;
  const anchor = labelOnLeft ? "end" : "start";
  const labelDx = labelOnLeft ? -6 : 6;

  // Each marker line's leading words are one text node, so the server HTML
  // keeps the node boundaries the literal "119th · wk " had before HO 838.
  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full"
        role="img"
        aria-label={`Cumulative laws enacted, ${ordinal(current)} Congress versus ${ordinal(previous)}, by week of session`}
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
          fill={C_CUR}
          fontFamily="var(--font-mono)"
        >
          {`${ordinal(current)} · wk `}{todayWeek} · {lastCur ? lastCur.cumulativeLaws.toLocaleString() : "no laws yet"}{lastCur ? " laws" : null}
        </text>
        <text
          x={markerX + labelDx}
          y={PAD.top - 3}
          textAnchor={anchor}
          fontSize="11"
          fill="var(--text-muted)"
          fontFamily="var(--font-mono)"
        >
          {`${ordinal(previous)} by wk `}{todayWeek}: {atPrev.toLocaleString()}
        </text>

        {/* previous Congress — full term, muted reference */}
        <polyline
          fill="none"
          stroke={C_PREV}
          strokeWidth={2}
          strokeLinejoin="round"
          points={points(sPrev)}
        />
        {/* current Congress — partial, the live curve (none before its
            first law). Two conditionals, not a fragment, so today's element
            tree is the one the chart had before HO 838. */}
        {lastCur ? (
          <polyline
            fill="none"
            stroke={C_CUR}
            strokeWidth={2.5}
            strokeLinejoin="round"
            points={points(sCur)}
          />
        ) : null}
        {lastCur ? (
          <circle
            cx={xScale(lastCur.weekOfSession)}
            cy={yScale(lastCur.cumulativeLaws)}
            r={4}
            fill={C_CUR}
          />
        ) : null}
      </svg>

      <SvgLegend
        items={[
          { label: `${ordinal(current)} (current)`, color: C_CUR },
          { label: `${ordinal(previous)} (${prevYears})`, color: C_PREV },
        ]}
        trailing="cumulative laws enacted"
      />
    </div>
  );
}
