"use client";

// HO 428: polarization-over-time chart (ideology surface 3 of 3, the last of the
// arc) — the historical D/R median gap on DW-NOMINATE dim1, per Congress. The 4th
// live hand-rolled SVG chart, so it rides the HO 428-A shared scaffold (ChartFrame
// + SvgAxisX + SvgGridY's signed-domain `min`), not a 5th re-declaration.
//
// THE CAUCUS/REGISTRATION SEAM (decided in HO 427): the historical LINE runs
// through the 118th from `polarization_history` (caucus, party_code 100/200); the
// current-Congress DOT (2025 / 119th) is a separate live pair from
// `getPolarizationBand` (registration). They agree to three decimals, so the seam
// doesn't render — but the two sources are NOT line-connected across 2023→2025.
//
// Visuals from docs/design/ideology-polarization-over-time.html; the DATA follows
// the prose spec where they differ: line to the 118th (not 2025), the midcentury
// low COMPUTED per chamber (not the mockup's hardcoded 1961), the current gap read
// live (not the mockup's illustrative 0.81/0.88), no prose caption.
import { useState } from "react";
import { ChartFrame } from "@/components/svg/ChartFrame";
import { SvgAxisX } from "@/components/svg/SvgAxisX";
import { SvgGridY } from "@/components/svg/SvgGridY";
import type { PolarizationHistoryRow, PolarizationRail } from "@/lib/queries";

// viewBox geometry from the mockup.
const W = 1140;
const H = 384;
const PAD = { left: 52, right: 70, top: 20, bottom: 42 };
const IW = W - PAD.left - PAD.right; // 1018
const IH = H - PAD.top - PAD.bottom; // 322
const X_DOM: [number, number] = [1879, 2025];
// Symmetric, 0-centered so SvgGridY's default fraction ticks land on round values
// (−0.6/−0.3/0/+0.3/+0.6) with 0 a gridline. Real range over the drawn era is
// −0.457..+0.562 (incl. the live current dot), so it fits with margin.
const Y_DOM: [number, number] = [-0.6, 0.6];
const START_CONGRESS = 46; // 1879, the mockup's post-Reconstruction start
const LINE_END_CONGRESS = 118; // history line ends at the 118th (2023)
const CURRENT_YEAR = 2025; // the 119th dot, from the live band
const X_GRID_YEARS = [1880, 1900, 1920, 1940, 1960, 1980, 2000, 2020];

function xs(year: number): number {
  return PAD.left + ((year - X_DOM[0]) / (X_DOM[1] - X_DOM[0])) * IW;
}
function ys(v: number): number {
  return PAD.top + ((Y_DOM[1] - v) / (Y_DOM[1] - Y_DOM[0])) * IH;
}
function fmt(v: number): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
}

type Chamber = "house" | "senate";
type Pt = { year: number; d: number; r: number };

export function PolarizationOverTime({
  history,
  current,
  initialChamber,
}: {
  history: PolarizationHistoryRow[];
  current: { house: PolarizationRail; senate: PolarizationRail };
  initialChamber: Chamber;
}) {
  const [open, setOpen] = useState(false);
  const [chamber, setChamber] = useState<Chamber>(initialChamber);
  const [hover, setHover] = useState<{ pt: Pt; gap: number } | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });

  // The historical line: selected chamber, 1879 (46th) through the 118th, both
  // medians present. Caucus source.
  const series: Pt[] = history
    .filter(
      (r) =>
        r.chamber === chamber &&
        r.congress >= START_CONGRESS &&
        r.congress <= LINE_END_CONGRESS &&
        r.demMedian != null &&
        r.repMedian != null,
    )
    .map((r) => ({
      year: r.year,
      d: r.demMedian as number,
      r: r.repMedian as number,
    }));

  // Data-derived midcentury low: the min-gap Congress in the drawn line, per
  // chamber (House ~1947 / Senate ~1943 on real data — NOT the mockup's 1961).
  let low: Pt | null = null;
  let lowGap = Infinity;
  for (const p of series) {
    const g = Math.abs(p.r - p.d);
    if (g < lowGap) {
      lowGap = g;
      low = p;
    }
  }

  // Current-Congress dot (2025 / 119th) from the live band (registration source).
  const cur = current[chamber];

  const dLine = series
    .map((p, i) => `${i ? "L" : "M"}${xs(p.year)} ${ys(p.d)}`)
    .join(" ");
  const rLine = series
    .map((p, i) => `${i ? "L" : "M"}${xs(p.year)} ${ys(p.r)}`)
    .join(" ");
  const gapPts = [
    ...series.map((p) => `${xs(p.year)},${ys(p.r)}`),
    ...[...series].reverse().map((p) => `${xs(p.year)},${ys(p.d)}`),
  ].join(" ");

  const curGapLabel =
    cur.gap != null ? `${chamber.toUpperCase()} gap ${cur.gap.toFixed(2)} today` : null;

  return (
    <section className="pol-time" aria-label="Party polarization over time">
      <div className="pol-time-head">
        <button
          type="button"
          className="pol-time-toggle"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
        >
          <span className="pol-time-chev">{open ? "▾" : "▸"}</span>
          <span className="pol-time-title">POLARIZATION OVER TIME · 1879–2025</span>
          <span className="pol-time-desc">party median on dim1 · per Congress</span>
        </button>
        <span className="pol-time-spacer" />
        {open ? (
          <span className="pol-time-seg">
            <button
              type="button"
              data-on={chamber === "house"}
              onClick={() => setChamber("house")}
            >
              HOUSE
            </button>
            <button
              type="button"
              data-on={chamber === "senate"}
              onClick={() => setChamber("senate")}
            >
              SENATE
            </button>
          </span>
        ) : (
          <span className="pol-time-collapsed-hint">
            {curGapLabel ? `${curGapLabel} · a century of history →` : "show history →"}
          </span>
        )}
      </div>

      {open ? (
        <>
          <div className="pol-time-body">
            <ChartFrame
              ariaLabel={`${chamber} party median on DW-NOMINATE dim1 per Congress, 1879 to 2025`}
              vbWidth={W}
              height={H}
            >
              <SvgGridY
                padLeft={PAD.left}
                padTop={PAD.top}
                innerWidth={IW}
                innerHeight={IH}
                min={Y_DOM[0]}
                max={Y_DOM[1]}
                format={fmt}
              />
              {/* emphasized zero line over the soft gridlines */}
              <line
                x1={PAD.left}
                x2={PAD.left + IW}
                y1={ys(0)}
                y2={ys(0)}
                stroke="var(--border-strong)"
                strokeWidth={1}
              />
              {/* x gridlines */}
              {X_GRID_YEARS.map((yr) => (
                <line
                  key={yr}
                  x1={xs(yr)}
                  x2={xs(yr)}
                  y1={PAD.top}
                  y2={PAD.top + IH}
                  stroke="var(--border-soft)"
                  strokeWidth={1}
                />
              ))}
              <SvgAxisX
                y={H - 12}
                fontSize={9}
                items={X_GRID_YEARS.map((yr) => ({ x: xs(yr), label: String(yr) }))}
              />

              {/* shaded gap between the two medians */}
              <polygon points={gapPts} fill="var(--accent-amber)" fillOpacity={0.07} />
              <path d={dLine} fill="none" stroke="var(--party-democrat)" strokeWidth={1.6} />
              <path d={rLine} fill="none" stroke="var(--party-republican)" strokeWidth={1.6} />

              {/* midcentury low guide (data-derived, per chamber) */}
              {low ? (
                <g>
                  <line
                    x1={xs(low.year)}
                    x2={xs(low.year)}
                    y1={ys(low.r) - 4}
                    y2={ys(low.d) + 4}
                    stroke="var(--text-dim)"
                    strokeWidth={1}
                    strokeDasharray="2 2"
                    strokeOpacity={0.7}
                  />
                  <text
                    x={xs(low.year)}
                    y={ys(low.d) + 18}
                    textAnchor="middle"
                    fontSize={9}
                    fill="var(--text-dim)"
                    fontFamily="var(--font-mono)"
                  >
                    midcentury low · gap {lowGap.toFixed(2)}
                  </text>
                </g>
              ) : null}

              {/* current-Congress dot pair (2025 / 119th) from the live band, with
                  the gap bracket — a distinct live source, NOT line-connected. */}
              {cur.dem != null && cur.rep != null ? (
                <g>
                  <circle cx={xs(CURRENT_YEAR)} cy={ys(cur.dem)} r={3} fill="var(--party-democrat)" />
                  <circle cx={xs(CURRENT_YEAR)} cy={ys(cur.rep)} r={3} fill="var(--party-republican)" />
                  <line
                    x1={xs(CURRENT_YEAR) + 8}
                    x2={xs(CURRENT_YEAR) + 8}
                    y1={ys(cur.rep)}
                    y2={ys(cur.dem)}
                    stroke="var(--accent-amber)"
                    strokeWidth={1}
                    strokeOpacity={0.9}
                  />
                  {cur.gap != null ? (
                    <text
                      x={xs(CURRENT_YEAR) + 11}
                      y={(ys(cur.rep) + ys(cur.dem)) / 2 - 2}
                      fontSize={13}
                      fill="var(--accent-amber-bright)"
                      fontFamily="var(--font-mono)"
                    >
                      {cur.gap.toFixed(2)}
                    </text>
                  ) : null}
                  <text
                    x={xs(CURRENT_YEAR) + 11}
                    y={(ys(cur.rep) + ys(cur.dem)) / 2 + 11}
                    fontSize={8}
                    fill="var(--text-dim)"
                    fontFamily="var(--font-mono)"
                  >
                    GAP · 119TH
                  </text>
                </g>
              ) : null}

              <text
                x={14}
                y={PAD.top + IH / 2}
                textAnchor="middle"
                fontSize={9.5}
                fill="var(--text-muted)"
                fontFamily="var(--font-mono)"
                letterSpacing="0.6"
                transform={`rotate(-90,14,${PAD.top + IH / 2})`}
              >
                DIM1 MEDIAN
              </text>

              {/* hover hit layer: one column per drawn Congress */}
              {series.map((p) => (
                <rect
                  key={p.year}
                  x={xs(p.year) - 4}
                  y={PAD.top}
                  width={8}
                  height={IH}
                  fill="transparent"
                  style={{ cursor: "crosshair" }}
                  onMouseEnter={() => setHover({ pt: p, gap: Math.abs(p.r - p.d) })}
                  onMouseMove={(e) => setPos({ x: e.clientX, y: e.clientY })}
                  onMouseLeave={() =>
                    setHover((h) => (h?.pt.year === p.year ? null : h))
                  }
                />
              ))}
            </ChartFrame>
          </div>

          <div className="pol-time-foot">
            <span>
              <span className="d">DEMOCRAT median</span> ·{" "}
              <span className="r">REPUBLICAN median</span> · shaded = the gap
            </span>
            <span className="src">
              Voteview HSall · {chamber === "house" ? "House" : "Senate"}
            </span>
          </div>

          {hover ? (
            <div
              className="pol-time-tip"
              style={{ left: pos.x + 12, top: pos.y + 12 }}
            >
              {hover.pt.year} · <span className="d">D {fmt(hover.pt.d)}</span> ·{" "}
              <span className="r">R {fmt(hover.pt.r)}</span> ·{" "}
              <span className="h">gap</span> {hover.gap.toFixed(2)}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
