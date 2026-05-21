import Link from "next/link";
import { SvgGridY } from "@/components/svg/SvgGridY";
import { SvgLegend } from "@/components/svg/SvgLegend";
import { getSponsorProductivity } from "@/lib/queries";

const CHART_HEIGHT = 360;
const PAD = { top: 24, right: 24, bottom: 48, left: 56 };
const VB_WIDTH = 1000;
const DOT_RADIUS = 4;
const LABEL_OFFSET = 8;
const TOP_N_LABELS = 5;

const PARTY_COLORS: Record<string, string> = {
  R: "var(--party-republican)",
  D: "var(--party-democrat)",
  I: "var(--party-independent)",
};

const NAME_SUFFIXES = new Set(["Jr.", "Sr.", "II", "III", "IV"]);

// Display-only short label for dot annotations. Handles both Congress.gov
// shapes — comma-first ("Crow, Jason") and prefix-honorific ("Rep. John A.
// Smith Jr."). Trailing `[R-CA]` bracket suffixes are stripped first.
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

export async function SponsorProductivityScatter() {
  const rows = await getSponsorProductivity();

  if (rows.length === 0) {
    return (
      <p
        className="py-8 text-center text-[13px]"
        style={{ color: "var(--text-dim)" }}
      >
        No data yet.
      </p>
    );
  }

  // Outliers along both dimensions get labeled; deduped on bioguide_id (or
  // name, when no id is known) so a sponsor in both lists is labeled once.
  const sponsorKey = (r: { bioguideId: string | null; name: string }) =>
    r.bioguideId ?? r.name;
  const topByVolume = [...rows]
    .sort((a, b) => b.billCount - a.billCount)
    .slice(0, TOP_N_LABELS);
  const topByPassRate = [...rows]
    .sort(
      (a, b) =>
        b.passRate - a.passRate ||
        b.billCount - a.billCount,
    )
    .slice(0, TOP_N_LABELS);
  const labelKeys = new Set(
    [...topByVolume, ...topByPassRate].map(sponsorKey),
  );

  const maxVolume = Math.max(...rows.map((r) => r.billCount));
  const xAxisMax = Math.max(10, Math.ceil(maxVolume / 10) * 10);
  const maxRate = Math.max(...rows.map((r) => r.passRate));
  // Cap at 1.0; round up to nearest 0.1 so the chart fills space when
  // nobody hits 100%.
  const yAxisMax = Math.min(1, Math.max(0.1, Math.ceil(maxRate * 10) / 10));

  const innerWidth = VB_WIDTH - PAD.left - PAD.right;
  const innerHeight = CHART_HEIGHT - PAD.top - PAD.bottom;
  const xScale = (n: number) => PAD.left + (n / xAxisMax) * innerWidth;
  const yScale = (n: number) =>
    PAD.top + (1 - n / yAxisMax) * innerHeight;

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${VB_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="h-auto w-full"
        role="img"
        aria-label="Sponsor productivity: bills sponsored versus pass rate"
      >
        <SvgGridY
          padLeft={PAD.left}
          padTop={PAD.top}
          innerWidth={innerWidth}
          innerHeight={innerHeight}
          max={yAxisMax}
          format={(v) => `${Math.round(v * 100)}%`}
          labelGap={8}
        />

        {[0, 0.25, 0.5, 0.75, 1].map((t) => {
          const x = PAD.left + innerWidth * t;
          const value = Math.round(xAxisMax * t);
          return (
            <text
              key={`x-${t}`}
              x={x}
              y={CHART_HEIGHT - PAD.bottom + 18}
              textAnchor="middle"
              fontSize="11"
              fill="var(--text-muted)"
              fontFamily="var(--font-mono)"
            >
              {value}
            </text>
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
          BILLS SPONSORED
        </text>
        <text
          x={14}
          y={PAD.top + innerHeight / 2}
          textAnchor="middle"
          fontSize="11"
          fill="var(--text-muted)"
          fontFamily="var(--font-mono)"
          letterSpacing="0.5"
          transform={`rotate(-90, 14, ${PAD.top + innerHeight / 2})`}
        >
          PASS RATE
        </text>

        {rows.map((row) => {
          const key = sponsorKey(row);
          const x = xScale(row.billCount);
          const y = yScale(row.passRate);
          const color = row.party ? PARTY_COLORS[row.party]! : "var(--text-dim)";
          const labeled = labelKeys.has(key);
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
              <title>
                {row.name} · {row.billCount} bills · {Math.round(row.passRate * 100)}%
              </title>
            </circle>
          );
          return (
            <g key={`g-${key}`}>
              {row.bioguideId ? (
                <Link href={`/members/${row.bioguideId}`}>{dot}</Link>
              ) : (
                dot
              )}
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
        trailing={`${rows.length} sponsors · 3+ bills · non-ceremonial`}
      />
    </div>
  );
}
