import type { MemberStats as MemberStatsType } from "@/lib/queries";

function formatAvgCosponsors(n: number | null): string {
  if (n === null) return "—";
  // Round to whole when the value is integer-ish; otherwise one decimal.
  const rounded = Math.round(n);
  return Math.abs(n - rounded) < 0.05 ? `${rounded}` : n.toFixed(1);
}

export function MemberStats({ stats }: { stats: MemberStatsType }) {
  const pct = stats.billsSponsored > 0
    ? `${(stats.enactedRate * 100).toFixed(1)}%`
    : "—";

  return (
    <div className="member-stats">
      <div className="member-stat">
        <span className="member-stat-label">Bills sponsored</span>
        <span className="member-stat-value">
          {stats.billsSponsored.toLocaleString()}
        </span>
      </div>
      <div className="member-stat">
        <span className="member-stat-label">Bills enacted</span>
        <span className="member-stat-value">
          {stats.billsEnacted}
          {stats.billsSponsored > 0 ? (
            <span
              className="ml-2 text-[13px]"
              style={{ color: "var(--text-muted)" }}
            >
              ({pct})
            </span>
          ) : null}
        </span>
      </div>
      <div className="member-stat">
        <span className="member-stat-label">Avg cosponsors</span>
        <span className="member-stat-value">
          {formatAvgCosponsors(stats.avgCosponsorCount)}
        </span>
      </div>
    </div>
  );
}
