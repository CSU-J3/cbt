import Link from "next/link";
import type { ClusterStat } from "@/lib/queries";

// HO 347 — ranked horizontal bar list, replacing the HO 128 PatternBubbleSVG.
// Five patterns read better as bars (length lands without effort) and the row
// absorbs the former standalone ALL PATTERNS table. Server component: selection
// is URL-driven via ?selected=, so each row is a plain <Link> (no client island).
//
// Bar length = bill count (linear). Bar color = % past committee on the SAME
// STALLED→MOVING ramp the bubbles used: #6b7280 (--text-dim) → #10b981
// (--stage-enacted), saturating at 30%. Inline hex stops, not new tokens.
const DIM: [number, number, number] = [0x6b, 0x72, 0x80];
const MOVING: [number, number, number] = [0x10, 0xb9, 0x81];
const PCT_CEILING = 0.3;

function rampColor(fracPastCommittee: number): string {
  const t = Math.max(0, Math.min(1, fracPastCommittee / PCT_CEILING));
  const r = Math.round(DIM[0] + (MOVING[0] - DIM[0]) * t);
  const g = Math.round(DIM[1] + (MOVING[1] - DIM[1]) * t);
  const b = Math.round(DIM[2] + (MOVING[2] - DIM[2]) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export function PatternBars({
  stats,
  selected,
}: {
  stats: ClusterStat[];
  selected: string | null;
}) {
  const maxCount = Math.max(1, ...stats.map((s) => s.count));

  return (
    <div className="pattern-bars">
      <div className="pattern-bars-header">
        <span>Pattern</span>
        <span aria-hidden />
        <span className="text-right">Bills</span>
        <span className="text-right">% past</span>
      </div>
      <ul>
        {stats.map((s) => {
          const isSelected = s.id === selected;
          const frac = s.count > 0 ? s.pastCommittee / s.count : 0;
          const widthPct = (s.count / maxCount) * 100;
          return (
            <li key={s.id}>
              <Link
                href={`/patterns?selected=${encodeURIComponent(s.id)}`}
                scroll={false}
                className={`pattern-bar-row${isSelected ? " selected" : ""}`}
                aria-current={isSelected ? "true" : undefined}
                title={s.description}
              >
                <span className="pattern-bar-label">
                  <span className="pattern-bar-name">{s.name}</span>
                  <span className="pattern-bar-slug">{s.id}</span>
                </span>
                <span className="pattern-bar-track" aria-hidden>
                  <span
                    className="pattern-bar-fill"
                    style={{
                      width: `${widthPct}%`,
                      background: rampColor(frac),
                    }}
                  />
                </span>
                <span className="pattern-bar-count tabular-nums">
                  {s.count.toLocaleString()}
                </span>
                <span className="pattern-bar-pct tabular-nums">
                  {Math.round(frac * 100)}%
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
