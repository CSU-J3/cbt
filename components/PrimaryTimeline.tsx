"use client";

// HO 333 — the primary-calendar timeline band on the Electoral surface. One bar
// per primary date across the 2026 window (Mar 1 → Sep 30), bar height = total
// contests that date (Sen + House COMBINED). Cyan = voted (date ≤ today), amber
// = upcoming. Hovering a bar previews that date's states as an outline on the
// map; clicking toggles the date into the locked highlight set. Selected bars
// carry an amber outline. Static — no transitions, no motion (the dashboard's
// cursor-blink-only rule).
//
// Hand-rolled SVG per house convention (BillsIntroTimeline / BillsTimeSeries):
// only d3-geo / d3-hierarchy are installed — no d3-scale/time/array — so the
// time + linear scales are computed inline.
import type { PrimaryCalendarDate } from "@/lib/queries";

const VB_WIDTH = 1100;
const VB_HEIGHT = 165;
const M = { top: 22, right: 18, bottom: 28, left: 18 };
const BAR_W = 9;
const COUNT_LABEL_MIN = 60; // mock threshold: label bars with ≥60 contests

// Fixed calendar domain (matches the mock — the 2026 primary window).
const DOMAIN_START = "2026-03-01";
const DOMAIN_END = "2026-09-30";

const VOTED = "#0e7490"; // primaries cyan (= primariesFill VOTED)
const UPCOMING = "#b45309"; // primaries amber (= primariesFill SOON)
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
  calendar,
  todayISO,
  locked,
  onHover,
  onToggle,
}: {
  calendar: PrimaryCalendarDate[];
  todayISO: string;
  locked: ReadonlySet<string>;
  onHover: (date: string | null) => void;
  onToggle: (date: string) => void;
}) {
  const d0 = dayNum(DOMAIN_START);
  const d1 = dayNum(DOMAIN_END);
  const span = Math.max(1, d1 - d0);
  const today = dayNum(todayISO);

  const innerW = VB_WIDTH - M.left - M.right;
  const baseY = VB_HEIGHT - M.bottom;
  const xOf = (iso: string) =>
    M.left + ((dayNum(iso) - d0) / span) * innerW;
  const xOfDay = (d: number) => M.left + ((d - d0) / span) * innerW;

  const maxCount = Math.max(1, ...calendar.map((c) => c.contestCount));
  const yOf = (n: number) => M.top + (1 - n / maxCount) * (baseY - M.top);

  // Month gridlines + labels: Mar … Sep (the first of each month in-domain).
  const months: { x: number; label: string }[] = [];
  for (let m = 2; m <= 8; m++) {
    // m = 0-based month index; Mar(2) … Sep(8) of 2026
    const iso = `2026-${String(m + 1).padStart(2, "0")}-01`;
    months.push({ x: xOf(iso), label: MON[m]! });
  }

  const todayX = xOfDay(today);

  return (
    <svg
      viewBox={`0 0 ${VB_WIDTH} ${VB_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ width: "100%", height: "auto", display: "block" }}
      role="img"
      aria-label="2026 primary calendar — contests per date, click a date to highlight its states on the map"
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
            {c.contestCount >= COUNT_LABEL_MIN ? (
              <text
                x={x}
                y={y - 5}
                textAnchor="middle"
                fill="var(--text-secondary)"
                fontSize={10}
                fontFamily="var(--font-mono)"
                pointerEvents="none"
              >
                {c.contestCount}
              </text>
            ) : null}
          </g>
        );
      })}

      {/* dashed TODAY line */}
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
    </svg>
  );
}
