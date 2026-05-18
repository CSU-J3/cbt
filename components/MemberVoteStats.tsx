import type { MemberVoteStats as MemberVoteStatsType } from "@/lib/queries";

// Percentages are out of `total`, not `total - notVoting`. That keeps YEA
// and NAY shares additive with MISSED so the line reads as a complete
// breakdown rather than three independent percentages.
function pct(n: number, total: number): string {
  if (total <= 0) return "0%";
  return `${Math.round((n / total) * 100)}%`;
}

export function MemberVoteStats({
  stats,
  chamber,
}: {
  stats: MemberVoteStatsType;
  chamber: "house" | "senate" | null;
}) {
  const chamberLabel = chamber === "senate" ? "Senate votes" : "House votes";

  if (stats.total === 0) {
    return (
      <div
        className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
        style={{ color: "var(--text-dim)" }}
      >
        {chamberLabel} · No votes recorded
      </div>
    );
  }

  const parts = [
    chamberLabel,
    `${stats.total.toLocaleString()} total`,
    `${stats.yea.toLocaleString()} yea (${pct(stats.yea, stats.total)})`,
    `${stats.nay.toLocaleString()} nay (${pct(stats.nay, stats.total)})`,
    `${stats.present.toLocaleString()} present`,
    `${stats.notVoting.toLocaleString()} missed (${pct(stats.notVoting, stats.total)})`,
  ];

  return (
    <div
      className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
      style={{ color: "var(--text-dim)" }}
    >
      {parts.join(" · ")}
    </div>
  );
}
