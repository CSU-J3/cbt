"use client";

// HO 527: /members participation dotplot — the population twin of IdeologyStrip,
// on the 119th missed-vote rate. A compact ~180px Wilkinson dotplot of every
// floored current member: the concentration + the identifiable high-miss tail,
// before you scroll into the browser. Hand-rolled SVG (the IdeologyStrip family),
// NOT the shared components/svg/ scaffold — the coordinate space is rate × stack
// height, the same deliberate-holdout reasoning as its ideology sibling.
//
// Two things differ from IdeologyStrip by the metric change: (1) the domain is a
// LOCKED 0..CAP (missed-rate has no natural ±1), CAP=30 just above the non-delegate
// max 29.02% (HO 527 STEP 0); (2) the split that matters here is CHAMBER, not party
// — House votes far more often than the Senate, so their baselines differ, so the
// median ticks are HSE/SEN (neutral amber), while the DOTS stay party-colored so
// party clustering in the tail is visible (roadmap lens #4). Median method is the
// shared median() (same as getChamberParticipationContext), over the same floored
// population, so the ticks echo B1's hub-context medians by construction.
//
// DELEGATE CARVE-OUT (the load-bearing rule): non-voting delegates are structurally
// ineligible on final passage, so their not_voting is not absenteeism. They're
// excluded from the cloud AND the median and the count is disclosed in the footer —
// a population-correctness rule, never a silent drop. A member's own hub rate keeps
// no carve-out (B1/B2); this is the first surface the rank-population rule binds.
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { ParticipationDot } from "@/lib/queries";
import { median } from "@/lib/median";

// viewBox geometry — identical to IdeologyStrip (reused, not re-derived).
const W = 1140;
const H = 132;
const L = 18;
const R = 18;
const T = 6;
const B = 24;
const IW = W - L - R; // 1104
const IH = H - T - B; // 102
const BASE = H - B; // 108 — baseline the stacks sit on

// Locked at HO 527 STEP 0 (paste-and-lock): CAP just above the non-delegate max
// (29.02%) so nothing clips; BINW 0.5 → 60 bins, ~18px each, 12 across the dense
// 0–6% region.
const CAP = 30;
const BINW = 0.5;

function xs(v: number): number {
  // v is missedPct 0..CAP; clamp defensively so a future >CAP value can't escape.
  const c = Math.max(0, Math.min(CAP, v));
  return L + (c / CAP) * IW;
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

type Placed = ParticipationDot & { cx: number; cy: number; r: number };

const AXIS_TICKS: number[] = [0, CAP / 4, CAP / 2, (3 * CAP) / 4, CAP];
function axisLabel(v: number): string {
  return `${Number.isInteger(v) ? v : v.toFixed(1)}%`;
}

const TICK_COLOR = "var(--accent-amber)"; // neutral — deliberately NOT a party color

export function ParticipationStrip({ dots }: { dots: ParticipationDot[] }) {
  const router = useRouter();
  const [hover, setHover] = useState<Placed | null>(null);

  // Carve out non-voting delegates: bin, place, and median over voting members only.
  const plotted = dots.filter((d) => !d.isDelegate);
  const delegateN = dots.length - plotted.length;

  // Bin the plotted dots (Wilkinson): fixed 0.5pp bins across 0..CAP, stacked.
  const nbins = Math.round(CAP / BINW);
  const bins = new Map<number, ParticipationDot[]>();
  for (const d of plotted) {
    const k = Math.max(0, Math.min(nbins - 1, Math.floor(d.missedPct / BINW)));
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
    const binCenter = (k + 0.5) * BINW;
    const cx = xs(binCenter);
    const sorted = [...arr].sort((a, b) => orderFor(a.party) - orderFor(b.party));
    sorted.forEach((d, j) => {
      placed.push({ ...d, cx, cy: BASE - step * j - step / 2, r: rDot });
    });
  }

  // Chamber medians over exactly the plotted (voting) dots — the meaningful split
  // here (House vs Senate baselines), computed with the shared median() so they
  // echo getChamberParticipationContext.
  const houseMed = median(
    plotted.filter((d) => d.chamber === "house").map((d) => d.missedPct),
  );
  const senMed = median(
    plotted.filter((d) => d.chamber === "senate").map((d) => d.missedPct),
  );

  // Hover tip geometry (viewBox units, clamped to the plot). Size off the wider of
  // the name and the value line (the "% missed · → hub" line can exceed a short name).
  const valueLine = hover ? `${hover.missedPct.toFixed(1)}% missed · → hub` : "";
  const tipChars = hover ? Math.max(hover.name.length, valueLine.length) : 0;
  const tipW = hover ? Math.max(64, tipChars * 4.6 + 20) : 0;
  const tipH = 22;
  const tipX = hover
    ? Math.max(L, Math.min(L + IW - tipW, hover.cx - tipW / 2))
    : 0;
  const tipYBelow = hover ? hover.cy + hover.r + 3 : 0;
  const tipAbove = hover ? tipYBelow + tipH > BASE : false;
  const tipY = hover ? (tipAbove ? hover.cy - hover.r - 3 - tipH : tipYBelow) : 0;

  // Chamber median ticks: HSE / SEN, neutral amber. When both are present and close
  // (the common case — House ~1.9%, Senate ~2.1% land ~8px apart at CAP=30) the
  // labels would collide, so dodge by position: the left tick's label anchors right
  // (extends left), the right tick's anchors left (extends right). Solo → centered.
  const rawTicks = [
    houseMed != null ? { key: "HSE", x: xs(houseMed) } : null,
    senMed != null ? { key: "SEN", x: xs(senMed) } : null,
  ].filter((t): t is { key: string; x: number } => t != null);
  const anchors: Record<string, "middle" | "start" | "end"> = {};
  if (rawTicks.length === 2) {
    const sorted = [...rawTicks].sort((a, b) => a.x - b.x);
    const close = Math.abs(sorted[0]!.x - sorted[1]!.x) < 44;
    anchors[sorted[0]!.key] = close ? "end" : "middle";
    anchors[sorted[1]!.key] = close ? "start" : "middle";
  } else if (rawTicks.length === 1) {
    anchors[rawTicks[0]!.key] = "middle";
  }

  function chamberTick(t: { key: string; x: number }) {
    const anchor = anchors[t.key] ?? "middle";
    const labelX = anchor === "end" ? t.x - 2 : anchor === "start" ? t.x + 2 : t.x;
    return (
      <g key={t.key}>
        <line
          x1={t.x}
          x2={t.x}
          y1={BASE + 2}
          y2={T + 4}
          stroke={TICK_COLOR}
          strokeWidth={1.5}
        />
        <text
          x={Math.max(L, Math.min(L + IW, labelX))}
          y={T + 1}
          textAnchor={anchor}
          fontSize={8}
          fontWeight={700}
          fill={TICK_COLOR}
        >
          {t.key}
        </text>
      </g>
    );
  }

  const fmtPct = (v: number | null): string => (v == null ? "—" : `${v.toFixed(1)}%`);

  return (
    <section
      className="part-strip"
      aria-label="Every current member's 119th missed-vote rate"
    >
      <div className="part-strip-head">
        <span className="part-strip-title">PARTICIPATION</span>
        <span className="part-strip-desc">
          every current member&apos;s 119th missed-vote rate · chamber medians ticked
        </span>
        <span className="part-strip-spacer" />
        <span
          className="part-strip-how"
          title="Missed rate = share of the member's 119th roll calls recorded not-voting. Non-voting delegates are excluded — they're structurally ineligible on final-passage votes, so their not-voting isn't absenteeism."
        >
          how it&apos;s scored →
        </span>
      </div>

      <svg
        className="part-strip-svg"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label={`Distribution of ${plotted.length} members by 119th missed-vote rate, 0 to ${CAP} percent`}
      >
        {/* end labels */}
        <text x={L} y={T + 6} fontSize={8} fill="var(--text-dim)" letterSpacing="0.5">
          FEWER MISSED
        </text>
        <text
          x={L + IW}
          y={T + 6}
          textAnchor="end"
          fontSize={8}
          fill="var(--text-dim)"
          letterSpacing="0.5"
        >
          MORE MISSED
        </text>

        {/* baseline rule */}
        <line
          x1={L}
          x2={L + IW}
          y1={BASE}
          y2={BASE}
          stroke="var(--border-strong)"
          strokeWidth={1}
        />

        {/* x-axis ticks + numeric % labels */}
        {AXIS_TICKS.map((v) => (
          <g key={v}>
            <line
              x1={xs(v)}
              x2={xs(v)}
              y1={BASE}
              y2={BASE + 3}
              stroke="var(--border-strong)"
              strokeWidth={1}
            />
            <text
              x={xs(v)}
              y={BASE + 13}
              textAnchor="middle"
              fontSize={8}
              fill="var(--text-dim)"
            >
              {axisLabel(v)}
            </text>
          </g>
        ))}

        {/* the cloud — party-colored so tail clustering is visible */}
        {placed.map((p) => (
          <circle
            key={p.bioguideId}
            cx={p.cx}
            cy={p.cy}
            r={p.r}
            fill={fillFor(p.party)}
            fillOpacity={0.82}
          />
        ))}

        {/* chamber median ticks (HSE / SEN, neutral) */}
        {rawTicks.map((t) => chamberTick(t))}

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
            onMouseLeave={() =>
              setHover((h) => (h?.bioguideId === p.bioguideId ? null : h))
            }
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
              <tspan fill={fillFor(hover.party)}>
                {hover.missedPct.toFixed(1)}% missed
              </tspan>
              <tspan> · → hub</tspan>
            </text>
          </g>
        ) : null}
      </svg>

      <div className="part-strip-foot">
        <span className="tabular-nums">{plotted.length.toLocaleString()}</span> members
        {houseMed != null ? (
          <>
            {" · "}
            <span style={{ color: TICK_COLOR }}>HSE med {fmtPct(houseMed)}</span>
          </>
        ) : null}
        {senMed != null ? (
          <>
            {" · "}
            <span style={{ color: TICK_COLOR }}>SEN med {fmtPct(senMed)}</span>
          </>
        ) : null}
        {delegateN > 0 ? (
          <>
            {" · "}
            <span className="tabular-nums">{delegateN}</span> delegates excluded (non-voting)
          </>
        ) : null}
        <span className="part-strip-foot-hint"> · HOUSE/SENATE toggle below rescopes this</span>
      </div>
    </section>
  );
}
