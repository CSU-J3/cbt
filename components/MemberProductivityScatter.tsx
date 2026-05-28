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
const TOP_N_LABELS = 5;

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

  // Outlier labels are still top-N-by-volume + top-N-by-pass-rate per
  // chamber, deduped, so each chart highlights its own outliers rather
  // than letting the high-volume House drown out Senate names.
  const sponsorKey = (r: { bioguideId: string | null; name: string }) =>
    r.bioguideId ?? r.name;
  const topByVolume = [...rows]
    .sort((a, b) => b.billCount - a.billCount)
    .slice(0, TOP_N_LABELS);
  const topByPassRate = [...rows]
    .sort(
      (a, b) =>
        b.passRate - a.passRate || b.billCount - a.billCount,
    )
    .slice(0, TOP_N_LABELS);
  const labelKeys = new Set(
    [...topByVolume, ...topByPassRate].map(sponsorKey),
  );

  const maxBills = Math.max(...rows.map((r) => r.billCount));
  const xRangeMax = Math.max(xLog(maxBills), xLog(500));

  const innerWidth = VB_WIDTH - PAD.left - PAD.right;
  const innerHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const xScale = (v: number) =>
    PAD.left +
    ((xLog(v) - X_RANGE_MIN) / (xRangeMax - X_RANGE_MIN)) * innerWidth;
  const yScale = (rate: number) =>
    PAD.top + (1 - Math.min(rate, Y_ZOOM_MAX) / Y_ZOOM_MAX) * innerHeight;

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

        {rows.map((row) => {
          const key = sponsorKey(row);
          const x = xScale(row.billCount);
          const isOverflow = row.passRate > Y_ZOOM_MAX;
          const y = yScale(row.passRate);
          const color = row.party ? PARTY_COLORS[row.party]! : "var(--text-dim)";
          const labeled = labelKeys.has(key);
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
            <g key={`g-${key}`}>
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
