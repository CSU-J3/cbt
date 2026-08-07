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
    // HO 619 — data-viz-row. Clause 1: this is a bar chart, not a text table —
    // bar LENGTH is the bill count and bar COLOUR is % past committee, on a
    // shared origin (the `2fr` track), which is what makes five patterns
    // comparable at a glance. Clause 2, the APPLIED curve at 2560: the void is
    // header `Pattern` -> `Bills`, spanning the empty cell over the bar column,
    // and it reads 781px live and gets monotonically WORSE at every cap tried
    // (600 -> 746, 500 -> 846, 420 -> 926, 340 -> 1006, 260 -> 1086, 180 ->
    // 1166) while clipping 0 of 5 labels, because the bar sits in a FRACTIONAL
    // track that absorbs whatever the label column gives up — the TopicCrosswalk
    // shape, not the FirmsLeaderboard one. No cap reaches it. Clause 4: the
    // attribute goes on the TABLE because there IS a column header, and a
    // header's geometry is not independently choosable — it has to sit over the
    // columns it labels. The bar ROWS themselves are never over threshold (14px).
    <div className="pattern-bars" data-viz-row>
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
