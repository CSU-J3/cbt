"use client";

// HO 425: /members polarization dotplot strip (ideology surface 2 of 3). A
// compact ~180px Wilkinson dotplot of every scored member on DW-NOMINATE dim1 —
// the population shape + the party gap, before you scroll into the browser.
// Hand-rolled SVG (the BillsTimeSeries / CommitteeActivityChart family), NOT the
// divs+CSS rail: the coordinate space is dim1 × stack height. The SVG primitive
// is deliberately NOT extracted here — that happens at the 4th chart (ship 3).
//
// Median method is PINNED INLINE (identical to the HO 424 band): strict D/R only
// (independents plot as dots but sit in neither median), sort ascending, odd →
// middle, even → mean of the two middle. Same method + same data means the
// strip's ticks match the band's rails by construction. It's inline (not imported
// from lib/queries) because this is a client island — importing the band's helper
// would pull next/cache into the client bundle.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { IdeologyDot } from "@/lib/queries";

// viewBox geometry (from the mockup). NO 2% inset — the inset is the band/hub
// rail rule; the cloud runs full width.
const W = 1140;
const H = 132;
const L = 18;
const R = 18;
const T = 6;
const B = 24;
const IW = W - L - R; // 1104
const IH = H - T - B; // 102
const BASE = H - B; // 108 — baseline the stacks sit on
const BINW = 0.02;

function xs(v: number): number {
  return L + ((v + 1) / 2) * IW;
}

// Strict D/R median, pinned to the band's method.
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const hi = s[mid] as number;
  return s.length % 2 === 0 ? ((s[mid - 1] as number) + hi) / 2 : hi;
}

const PARTY_FILL: Record<string, string> = {
  D: "var(--party-democrat)",
  R: "var(--party-republican)",
  I: "var(--party-independent)",
};
function fillFor(party: string | null): string {
  return PARTY_FILL[party ?? "I"] ?? "var(--party-independent)";
}
// Draw order within a bin: R → I → D (R at the bottom of the stack).
const PARTY_ORDER: Record<string, number> = { R: 0, I: 1, D: 2 };
function orderFor(party: string | null): number {
  return PARTY_ORDER[party ?? "I"] ?? 1;
}

function fmt(v: number): string {
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}`;
}

type Placed = IdeologyDot & { cx: number; cy: number; r: number };

const AXIS_TICKS: { v: number; label: string }[] = [
  { v: -1, label: "−1" },
  { v: -0.5, label: "−0.5" },
  { v: 0, label: "0" },
  { v: 0.5, label: "+0.5" },
  { v: 1, label: "+1" },
];

export function IdeologyStrip({ dots }: { dots: IdeologyDot[] }) {
  const router = useRouter();
  const [hover, setHover] = useState<Placed | null>(null);

  // Bin the dots (Wilkinson): fixed 0.02 bins across the −1..+1 domain, stacked.
  const nbins = Math.round(2 / BINW);
  const bins = new Map<number, IdeologyDot[]>();
  for (const d of dots) {
    const k = Math.max(0, Math.min(nbins - 1, Math.floor((d.dim1 + 1) / BINW)));
    const arr = bins.get(k) ?? [];
    arr.push(d);
    bins.set(k, arr);
  }
  let maxStack = 1;
  for (const arr of bins.values()) maxStack = Math.max(maxStack, arr.length);
  const step = Math.min(4, (IH - 4) / maxStack);
  const rDot = Math.max(1.4, Math.min(1.9, step * 0.48));

  const placed: Placed[] = [];
  for (const [k, arr] of bins) {
    const binCenter = -1 + (k + 0.5) * BINW;
    const cx = xs(binCenter);
    const sorted = [...arr].sort((a, b) => orderFor(a.party) - orderFor(b.party));
    sorted.forEach((d, j) => {
      placed.push({ ...d, cx, cy: BASE - step * j - step / 2, r: rDot });
    });
  }

  // Strict D/R medians over exactly the drawn dots.
  const dem = median(dots.filter((d) => d.party === "D").map((d) => d.dim1));
  const rep = median(dots.filter((d) => d.party === "R").map((d) => d.dim1));
  const gap = dem != null && rep != null ? Math.abs(rep - dem) : null;

  // Hover tip geometry (kept in viewBox units; clamped to the plot).
  const tipW = hover ? Math.max(64, hover.name.length * 4.6 + 20) : 0;
  const tipH = 22;
  const tipX = hover
    ? Math.max(L, Math.min(L + IW - tipW, hover.cx - tipW / 2))
    : 0;
  const tipYBelow = hover ? hover.cy + hover.r + 3 : 0;
  const tipAbove = hover ? tipYBelow + tipH > BASE : false;
  const tipY = hover ? (tipAbove ? hover.cy - hover.r - 3 - tipH : tipYBelow) : 0;

  function medianTick(value: number, party: "D" | "R") {
    const x = xs(value);
    return (
      <g key={party}>
        <line
          x1={x}
          x2={x}
          y1={BASE + 2}
          y2={T + 4}
          stroke={fillFor(party)}
          strokeWidth={1.5}
        />
        <text
          x={x}
          y={T + 1}
          textAnchor="middle"
          fontSize={8}
          fontWeight={700}
          fill={fillFor(party)}
        >
          {party}
        </text>
      </g>
    );
  }

  return (
    <section className="ideo-strip" aria-label="Every scored member on DW-NOMINATE first dimension">
      <div className="ideo-strip-head">
        <span className="ideo-strip-title">POLARIZATION</span>
        <span className="ideo-strip-desc">every scored member on dim1 · party medians ticked</span>
        <span className="ideo-strip-spacer" />
        <span
          className="ideo-strip-how"
          title="DW-NOMINATE dim1 — the economic left–right axis from Voteview's roll-call vote analysis of the 119th Congress. Lower = liberal, higher = conservative."
        >
          how it&apos;s scored →
        </span>
      </div>

      <svg
        className="ideo-strip-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Distribution of ${dots.length} members on DW-NOMINATE first dimension, −1 liberal to +1 conservative`}
      >
        {/* end labels */}
        <text x={L} y={T + 6} fontSize={8} fill="var(--text-dim)" letterSpacing="0.5">
          LIBERAL
        </text>
        <text x={L + IW} y={T + 6} textAnchor="end" fontSize={8} fill="var(--text-dim)" letterSpacing="0.5">
          CONSERVATIVE
        </text>

        {/* emphasized center-zero line + baseline rule */}
        <line x1={xs(0)} x2={xs(0)} y1={T} y2={BASE} stroke="var(--text-dim)" strokeWidth={0.75} opacity={0.7} />
        <line x1={L} x2={L + IW} y1={BASE} y2={BASE} stroke="var(--border-strong)" strokeWidth={1} />

        {/* x-axis ticks + numeric labels */}
        {AXIS_TICKS.map((t) => (
          <g key={t.v}>
            <line x1={xs(t.v)} x2={xs(t.v)} y1={BASE} y2={BASE + 3} stroke="var(--border-strong)" strokeWidth={1} />
            <text x={xs(t.v)} y={BASE + 13} textAnchor="middle" fontSize={8} fill="var(--text-dim)">
              {t.label}
            </text>
          </g>
        ))}

        {/* the cloud */}
        {placed.map((p) => (
          <circle key={p.bioguideId} cx={p.cx} cy={p.cy} r={p.r} fill={fillFor(p.party)} fillOpacity={0.82} />
        ))}

        {/* median ticks (strict D/R) + empty-center annotation */}
        {dem != null ? medianTick(dem, "D") : null}
        {rep != null ? medianTick(rep, "R") : null}
        {dem != null && rep != null ? (
          <text
            x={xs((dem + rep) / 2)}
            y={BASE - IH * 0.5}
            textAnchor="middle"
            fontSize={8}
            fill="var(--text-muted)"
          >
            ↑ empty center
          </text>
        ) : null}

        {/* transparent hit targets on top (dots are tiny) */}
        {placed.map((p) => (
          <circle
            key={`hit-${p.bioguideId}`}
            cx={p.cx}
            cy={p.cy}
            r={Math.max(p.r, 3.2)}
            fill="transparent"
            style={{ cursor: "pointer" }}
            onMouseEnter={() => setHover(p)}
            onMouseLeave={() => setHover((h) => (h?.bioguideId === p.bioguideId ? null : h))}
            onClick={() => router.push(`/members/${p.bioguideId}`)}
          />
        ))}

        {/* hover tip */}
        {hover ? (
          <g pointerEvents="none">
            <rect
              x={tipX}
              y={tipY}
              width={tipW}
              height={tipH}
              rx={2}
              fill="var(--bg-panel)"
              stroke="var(--border-strong)"
              strokeWidth={0.75}
            />
            <text x={tipX + 6} y={tipY + 9} fontSize={7.5} fill="var(--text-primary)">
              {hover.name}
            </text>
            <text x={tipX + 6} y={tipY + 18} fontSize={7.5} fill="var(--text-muted)">
              <tspan fill={fillFor(hover.party)}>{fmt(hover.dim1)}</tspan>
              <tspan> · → hub</tspan>
            </text>
          </g>
        ) : null}
      </svg>

      <div className="ideo-strip-foot">
        <span className="tabular-nums">{dots.length.toLocaleString()}</span> scored
        {dem != null ? (
          <>
            {" · "}
            <span style={{ color: "var(--party-democrat)" }}>D med {fmt(dem)}</span>
          </>
        ) : null}
        {rep != null ? (
          <>
            {" · "}
            <span style={{ color: "var(--party-republican)" }}>R med {fmt(rep)}</span>
          </>
        ) : null}
        {gap != null ? (
          <>
            {" · "}
            <span style={{ color: "var(--accent-amber-bright)" }}>gap {gap.toFixed(2)}</span>
          </>
        ) : null}
        <span className="ideo-strip-foot-hint"> · HOUSE/SENATE toggle below rescopes this</span>
      </div>
    </section>
  );
}
