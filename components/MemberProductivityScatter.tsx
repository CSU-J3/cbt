import Link from "next/link";
import { SvgGridY } from "@/components/svg/SvgGridY";
import { SvgLegend } from "@/components/svg/SvgLegend";
import { type Chamber, getSponsorProductivity } from "@/lib/queries";

// HO 152 — readable scatter per chamber. Renamed from
// SponsorProductivityScatter; same hand-rolled-SVG idiom (HO 66/99,
// matching BillsTimeSeries), but with the three readability fixes spec 7
// called for: log-x so the long-tail many-bill outliers don't crush the
// pack into the left edge; y zoomed to 0–30% where pass rates actually
// live, with a ▲ marker above any dot that would otherwise clamp; and
// chamber-split so HOUSE and SENATE each get their own half-width chart.
//
// Tooltips stay native <title> per Phase 1 sign-off — HO 147 Tooltip is
// HTML-trigger-based and isn't directly usable inside SVG without
// foreignObject. The hover content carries the four fields spec 7 named
// (name · N bills · M% pass rate · K enacted).

const CHART_HEIGHT = 320;
const PAD = { top: 24, right: 16, bottom: 48, left: 48 };
const VB_WIDTH = 600;
const DOT_RADIUS = 4;
const LABEL_OFFSET = 8;
// HO 197: labels are threshold-gated (not top-N) then collision-dodged.
// A point earns a label only if it's a real outlier on either axis…
const LABEL_PASS_THRESHOLD = 0.1; // > 10% pass rate, OR
const LABEL_BILLS_THRESHOLD = 100; // > 100 bills.
// …and only if no already-kept label sits within this many px (euclidean on
// rendered x/y, sized for the 10px label font) — kills the residual stacks.
const COLLISION_PX = 16;
// Presentational vertical jitter for the 0%-pass mass (see seededJitter).
const JITTER_PX = 3;

const Y_ZOOM_MAX = 0.3;
const X_TICKS: readonly number[] = [1, 10, 100, 500];
// log10(v + 1) — keeps log defined at v=0 even though our HAVING ≥ 3 means
// we never actually see one. The +1 shift also gives a 1-tick that lands
// inside the panel rather than on the y-axis.
const xLog = (v: number) => Math.log10(v + 1);
const X_RANGE_MIN = xLog(1);

const PARTY_COLORS: Record<string, string> = {
  R: "var(--party-republican)",
  D: "var(--party-democrat)",
  I: "var(--party-independent)",
};

const NAME_SUFFIXES = new Set(["Jr.", "Sr.", "II", "III", "IV"]);

function shortName(full: string): string {
  const noHonorific = full.replace(
    /^(Rep\.|Sen\.|Del\.|Res\.|Hon\.)\s+/i,
    "",
  );
  const noParty = noHonorific.replace(/\s*\[[^\]]+\]\s*$/, "").trim();
  const commaIdx = noParty.indexOf(",");
  if (commaIdx > 0) return noParty.slice(0, commaIdx).trim();
  const parts = noParty.split(/\s+/);
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i]!;
    if (!NAME_SUFFIXES.has(p)) return p.replace(/[.,]$/, "");
  }
  return noParty;
}

function chamberLabel(chamber: Chamber): string {
  return chamber === "house" ? "HOUSE" : "SENATE";
}

// HO 197 — deterministic ±JITTER_PX from a member key. This component is a
// SERVER component that re-renders on every request (the page awaits
// searchParams), so Math.random() would re-jitter the dots on every page load.
// Seeding off the stable sponsorKey keeps the offset identical across renders —
// a static presentational nudge, never animated, never re-randomized.
function seededJitter(key: string): number {
  let h = 0;
  for (let i = 0; i < key.length; i++) {
    h = (h * 31 + key.charCodeAt(i)) | 0;
  }
  const unit = (h >>> 0) % 1000 / 999; // 0..1, stable per key
  return (unit * 2 - 1) * JITTER_PX; // -JITTER_PX..+JITTER_PX
}

export async function MemberProductivityScatter({
  chamber,
}: {
  chamber: Chamber;
}) {
  const all = await getSponsorProductivity();
  // HO 152: y-axis is enacted/total ("pass rate" in spec 7's sense of "got
  // signed"), not the HO 67 advanced/total. Pre-HO-152 the chart used
  // advanced/total, but ~committee is the dominant destination so that
  // rate clusters above the spec'd 0–30% zoom and the chart turns into a
  // wall of ▲. Switching to enacted/total puts the dots in the band the
  // y-zoom was calibrated for and matches the list's "rank by pass rate"
  // metric exactly.
  const rows = all
    .filter((r) => r.chamber === chamber)
    .map((r) => ({
      ...r,
      passRate: r.billCount > 0 ? r.enactedCount / r.billCount : 0,
    }));

  if (rows.length === 0) {
    return (
      <p
        className="py-8 text-center text-[13px]"
        style={{ color: "var(--text-dim)" }}
      >
        No {chamberLabel(chamber).toLowerCase()} sponsors yet.
      </p>
    );
  }

  const sponsorKey = (r: { bioguideId: string | null; name: string }) =>
    r.bioguideId ?? r.name;

  const maxBills = Math.max(...rows.map((r) => r.billCount));
  const xRangeMax = Math.max(xLog(maxBills), xLog(500));

  const innerWidth = VB_WIDTH - PAD.left - PAD.right;
  const innerHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const xScale = (v: number) =>
    PAD.left +
    ((xLog(v) - X_RANGE_MIN) / (xRangeMax - X_RANGE_MIN)) * innerWidth;
  const yScale = (rate: number) =>
    PAD.top + (1 - Math.min(rate, Y_ZOOM_MAX) / Y_ZOOM_MAX) * innerHeight;

  // HO 197 — pre-pass: rendered positions for every dot, applying the
  // presentational jitter to the 0%-pass mass only. FLAGGED exception to
  // true-value rendering: the jitter offsets the rendered `y` so the long tail
  // reads as a density band instead of a smear on the y=0 line — it does NOT
  // change the data. The dot's <title> + <Link> below stay bound to the true
  // `row` values, so hover and click are unaffected.
  const points = rows.map((row, idx) => {
    const key = sponsorKey(row);
    const x = xScale(row.billCount);
    const baseY = yScale(row.passRate);
    const y = row.passRate === 0 ? baseY + seededJitter(key) : baseY;
    return { row, key, idx, x, y, isOverflow: row.passRate > Y_ZOOM_MAX };
  });

  // HO 197 — labels: threshold-gate (real outlier on either axis), then greedy
  // collision dodge by salience so the residual stacks (Norton/Nadler/Biggs,
  // Hagerty/Capito/Britt) collapse to one survivor. Suppressed points keep
  // their dot + hover; only the in-chart text is dropped.
  //
  // Labeling is per-POINT (by idx), not per-key: getSponsorProductivity can
  // split one member across rows (a sponsor_name variant under the same
  // bioguide — e.g. Begich's 34 bills land as 27 + 7), and a key-based set
  // would flip the label on for both dots when only one clears the threshold.
  // The labeledKeys guard also caps a split member at one label total.
  const labeledIdx = new Set<number>();
  const labeledKeys = new Set<string>();
  const keptPositions: { x: number; y: number }[] = [];
  const candidates = points
    .filter(
      (p) =>
        p.row.passRate > LABEL_PASS_THRESHOLD ||
        p.row.billCount > LABEL_BILLS_THRESHOLD,
    )
    .sort(
      (a, b) =>
        b.row.passRate - a.row.passRate || b.row.billCount - a.row.billCount,
    );
  for (const p of candidates) {
    if (labeledKeys.has(p.key)) continue; // one label per member
    const collides = keptPositions.some(
      (k) => Math.hypot(k.x - p.x, k.y - p.y) < COLLISION_PX,
    );
    if (collides) continue;
    labeledIdx.add(p.idx);
    labeledKeys.add(p.key);
    keptPositions.push({ x: p.x, y: p.y });
  }

  const overFlowCount = rows.filter((r) => r.passRate > Y_ZOOM_MAX).length;

  return (
    <div className="w-full">
      <p
        className="mb-2 text-[12px] uppercase tracking-[0.5px]"
        style={{ color: "var(--text-muted)" }}
      >
        {chamberLabel(chamber)}
      </p>
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full"
        role="img"
        aria-label={`${chamberLabel(chamber)} member productivity: bills sponsored versus pass rate`}
      >
        <SvgGridY
          padLeft={PAD.left}
          padTop={PAD.top}
          innerWidth={innerWidth}
          innerHeight={innerHeight}
          max={Y_ZOOM_MAX}
          format={(v) => `${Math.round(v * 100)}%`}
          labelGap={8}
        />

        {X_TICKS.filter((v) => xLog(v) <= xRangeMax).map((v) => {
          const x = xScale(v);
          return (
            <g key={`x-${v}`}>
              <line
                x1={x}
                x2={x}
                y1={PAD.top + innerHeight}
                y2={PAD.top + innerHeight + 4}
                stroke="var(--border-soft)"
              />
              <text
                x={x}
                y={CHART_HEIGHT - PAD.bottom + 18}
                textAnchor="middle"
                fontSize="11"
                fill="var(--text-muted)"
                fontFamily="var(--font-mono)"
              >
                {v}
              </text>
            </g>
          );
        })}

        <text
          x={PAD.left + innerWidth / 2}
          y={CHART_HEIGHT - 6}
          textAnchor="middle"
          fontSize="11"
          fill="var(--text-muted)"
          fontFamily="var(--font-mono)"
          letterSpacing="0.5"
        >
          BILLS · LOG SCALE
        </text>
        <text
          x={12}
          y={PAD.top + innerHeight / 2}
          textAnchor="middle"
          fontSize="11"
          fill="var(--text-muted)"
          fontFamily="var(--font-mono)"
          letterSpacing="0.5"
          transform={`rotate(-90, 12, ${PAD.top + innerHeight / 2})`}
        >
          PASS RATE · 0–30%
        </text>

        {points.map(({ row, idx, x, y, isOverflow }) => {
          const color = row.party ? PARTY_COLORS[row.party]! : "var(--text-dim)";
          const labeled = labeledIdx.has(idx);
          const titleText = `${row.name} · ${row.billCount} bills · ${Math.round(
            row.passRate * 100,
          )}% pass rate · ${row.enactedCount} enacted`;
          const dot = (
            <circle
              cx={x}
              cy={y}
              r={DOT_RADIUS}
              fill={color}
              fillOpacity={0.7}
              stroke={color}
              strokeOpacity={0.9}
              strokeWidth={1}
            >
              <title>{titleText}</title>
            </circle>
          );
          return (
            <g key={`g-${idx}`}>
              {row.bioguideId ? (
                <Link href={`/members/${row.bioguideId}`}>{dot}</Link>
              ) : (
                dot
              )}
              {isOverflow ? (
                <text
                  x={x}
                  y={y - DOT_RADIUS - 4}
                  textAnchor="middle"
                  fontSize="11"
                  fontFamily="var(--font-mono)"
                  fill={color}
                  aria-hidden
                >
                  ▲
                </text>
              ) : null}
              {labeled ? (
                <text
                  x={x + LABEL_OFFSET}
                  y={y + 3}
                  fontSize="10"
                  fill="var(--text-secondary)"
                  fontFamily="var(--font-mono)"
                >
                  {shortName(row.name)}
                </text>
              ) : null}
            </g>
          );
        })}
      </svg>

      <SvgLegend
        items={(["R", "D", "I"] as const).map((p) => ({
          label: p,
          color: PARTY_COLORS[p]!,
        }))}
        shape="dot"
        trailing={`${rows.length} sponsors · 3+ bills${
          overFlowCount > 0
            ? ` · ${overFlowCount} above 30% ▲`
            : ""
        }`}
      />
    </div>
  );
}
