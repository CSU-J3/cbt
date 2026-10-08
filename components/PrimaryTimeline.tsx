"use client";

// HO 333 — the primary-calendar timeline band on the Electoral surface. One bar
// per primary date across the cycle's window, bar height = total contests that
// date (Sen + House COMBINED). Cyan = voted (date ≤ today), amber = upcoming.
// Hovering a bar previews that date's states as an outline on the map; clicking
// toggles the date into the locked highlight set. Selected bars carry an amber
// outline. Static — no transitions, no motion (the dashboard's cursor-blink-
// only rule).
//
// HO 767 (mock-767 v18, CALENDAR 2): the window is the cycle's Mar 1 to
// Nov 15, past election day, so Louisiana's Nov-3 contests and the TODAY line
// fall inside it (the 2026-literal Mar 1 → Sep 30 put both off the right edge),
// and the bars carry no numbers: the list under them prints every count.
//
// Hand-rolled SVG per house convention (BillsIntroTimeline / BillsTimeSeries):
// only d3-geo / d3-hierarchy are installed — no d3-scale/time/array — so the
// time + linear scales are computed inline.
import type { PrimaryCalendarDate } from "@/lib/queries";

const VB_WIDTH = 1100;
const VB_HEIGHT = 165;
const M = { top: 22, right: 18, bottom: 28, left: 18 };
const BAR_W = 9;

// The cycle's calendar domain: Mar 1 to mid-November.
const domainStart = (cycle: number) => `${cycle}-03-01`;
const domainEnd = (cycle: number) => `${cycle}-11-15`;

// HO 603: these two hues were inherited from CartogramShell's primariesFill(),
// which was deleted with the primaries map fork. They are now DEFINED HERE —
// this component is the last consumer of the primaries recency palette, so
// there is no shared source to keep them in step with.
const VOTED = "#0e7490"; // primaries cyan — a date that has voted
const UPCOMING = "#b45309"; // primaries amber — a date still ahead
const AMBER_BRIGHT = "#fbbf24"; // --accent-amber-bright

const MON = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

// 'YYYY-MM-DD' → epoch-day integer (UTC), the metric the time scale runs on.
function dayNum(iso: string): number {
  return Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);
}

export function PrimaryTimeline({
  cycle,
  calendar,
  todayISO,
  locked,
  onHover,
  onToggle,
}: {
  cycle: number;
  calendar: PrimaryCalendarDate[];
  todayISO: string;
  locked: ReadonlySet<string>;
  onHover: (date: string | null) => void;
  onToggle: (date: string) => void;
}) {
  const d0 = dayNum(domainStart(cycle));
  const d1 = dayNum(domainEnd(cycle));
  const span = Math.max(1, d1 - d0);
  const today = dayNum(todayISO);

  const innerW = VB_WIDTH - M.left - M.right;
  const baseY = VB_HEIGHT - M.bottom;
  const xOf = (iso: string) =>
    M.left + ((dayNum(iso) - d0) / span) * innerW;
  const xOfDay = (d: number) => M.left + ((d - d0) / span) * innerW;

  const maxCount = Math.max(1, ...calendar.map((c) => c.contestCount));
  const yOf = (n: number) => M.top + (1 - n / maxCount) * (baseY - M.top);

  // Month gridlines + labels: Mar … Nov (the first of each month in-domain).
  const months: { x: number; label: string }[] = [];
  for (let m = 2; m <= 10; m++) {
    // m = 0-based month index; Mar(2) … Nov(10) of the cycle
    const iso = `${cycle}-${String(m + 1).padStart(2, "0")}-01`;
    months.push({ x: xOf(iso), label: MON[m]! });
  }

  // Outside the window (before Mar 1, after Nov 15) the TODAY line has no
  // place on the axis, so it isn't drawn rather than drawn off the edge.
  const todayInDomain = today >= d0 && today <= d1;
  const todayX = xOfDay(today);

  return (
    <svg
      viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label={`${cycle} primary calendar — contests per date, click a date to highlight its states on the map`}
    >
      {/* month gridlines */}
      {months.map((mo) => (
        <line
          key={mo.label}
          x1={mo.x}
          x2={mo.x}
          y1={M.top - 4}
          y2={baseY}
          stroke="var(--border-soft)"
        />
      ))}
      {months.map((mo) => (
        <text
          key={`lbl-${mo.label}`}
          x={mo.x + 4}
          y={baseY + 15}
          fill="var(--text-dim)"
          fontSize={11}
          fontFamily="var(--font-mono)"
        >
          {mo.label}
        </text>
      ))}

      {/* baseline */}
      <line
        x1={M.left}
        x2={VB_WIDTH - M.right}
        y1={baseY}
        y2={baseY}
        stroke="var(--border-strong)"
      />

      {/* bars — one per primary date */}
      {calendar.map((c) => {
        const x = xOf(c.date);
        const y = yOf(c.contestCount);
        const isVoted = c.date <= todayISO;
        const isLocked = locked.has(c.date);
        const d = new Date(`${c.date}T00:00:00Z`);
        return (
          <g key={c.date}>
            <rect
              x={x - BAR_W / 2}
              y={y}
              width={BAR_W}
              height={baseY - y}
              fill={isVoted ? VOTED : UPCOMING}
              stroke={isLocked ? AMBER_BRIGHT : "none"}
              strokeWidth={isLocked ? 1.5 : 0}
              style={{ cursor: "pointer" }}
              onMouseEnter={() => onHover(c.date)}
              onMouseLeave={() => onHover(null)}
              onFocus={() => onHover(c.date)}
              onBlur={() => onHover(null)}
              onClick={() => onToggle(c.date)}
              tabIndex={0}
              role="button"
              aria-pressed={isLocked}
            >
              <title>{`${MON[d.getUTCMonth()]} ${d.getUTCDate()} · ${c.states.length} states · ${c.contestCount} contests`}</title>
            </rect>
          </g>
        );
      })}

      {/* dashed TODAY line */}
      {todayInDomain ? (
        <>
          <line
            x1={todayX}
            x2={todayX}
            y1={M.top - 10}
            y2={baseY}
            stroke={AMBER_BRIGHT}
            strokeWidth={1}
            strokeDasharray="3 3"
          />
          <text
            x={todayX}
            y={M.top - 13}
            textAnchor="middle"
            fill={AMBER_BRIGHT}
            fontSize={10}
            fontFamily="var(--font-mono)"
          >
            TODAY
          </text>
        </>
      ) : null}
    </svg>
  );
}
