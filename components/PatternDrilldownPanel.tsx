import Link from "next/link";
import { getClusterDrilldown } from "@/lib/queries";
import { getClusterPattern } from "@/lib/cluster-patterns";

function shortSponsor(name: string): string {
  const noPrefix = name.replace(/^(Rep\.|Sen\.|Del\.|Res\.)\s*/i, "").trim();
  return noPrefix.split(",")[0]?.trim() ?? noPrefix;
}

function partyColor(party: string | null): string {
  switch (party) {
    case "R":
      return "var(--party-republican)";
    case "D":
      return "var(--party-democrat)";
    case "I":
    case "ID":
      return "var(--party-independent)";
    default:
      return "var(--text-dim)";
  }
}

// Slides in below the bubble SVG when a cluster is selected. Headline line
// summarizes the pattern, sponsor mini-bar surfaces the leaders behind it,
// and the feed-link closes the drill-out path (returns to /feed filtered
// to this cluster, the existing HO 51 convention).
export async function PatternDrilldownPanel({
  clusterId,
}: {
  clusterId: string;
}) {
  const pattern = getClusterPattern(clusterId);
  if (!pattern) return null;

  const drill = await getClusterDrilldown(clusterId);
  const { total, pastCommittee, enacted, ceremonial } = drill.headline;
  const pastPct =
    total > 0 ? Math.round((pastCommittee / total) * 100) : 0;
  const ceremonialPct =
    total > 0 ? Math.round((ceremonial / total) * 100) : 0;

  const maxSponsorCount = drill.topSponsors.reduce(
    (m, s) => Math.max(m, s.count),
    0,
  );

  return (
    <section className="pattern-drilldown">
      <header className="pattern-drilldown-header">
        <span
          className="text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--accent-amber)" }}
        >
          PATTERN
        </span>
        <span
          className="text-[14px] font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          {pattern.name}
        </span>
        <span
          className="text-[12px] tabular-nums"
          style={{ color: "var(--text-muted)" }}
        >
          {total.toLocaleString()} bills · {pastPct}% past committee ·{" "}
          {enacted} enacted · {ceremonialPct}% ceremonial
        </span>
      </header>

      <p
        className="text-[12px] leading-snug"
        style={{ color: "var(--text-dim)" }}
      >
        {pattern.description}
      </p>

      {drill.topSponsors.length > 0 ? (
        <div className="pattern-drilldown-sponsors">
          <div
            className="text-[11px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-muted)" }}
          >
            Top sponsors
          </div>
          <ul>
            {drill.topSponsors.map((s) => {
              const widthPct =
                maxSponsorCount > 0
                  ? (s.count / maxSponsorCount) * 100
                  : 0;
              return (
                <li key={`${s.name}-${s.party}`} className="pattern-sponsor-row">
                  <span
                    className="pattern-sponsor-name"
                    title={s.name}
                  >
                    {shortSponsor(s.name)}
                    <span
                      className="ml-1"
                      style={{ color: partyColor(s.party) }}
                    >
                      [{s.party ?? "?"}]
                    </span>
                  </span>
                  <span className="pattern-sponsor-bar-track" aria-hidden>
                    <span
                      className="pattern-sponsor-bar-fill"
                      style={{
                        width: `${widthPct}%`,
                        background: partyColor(s.party),
                      }}
                    />
                  </span>
                  <span className="pattern-sponsor-count tabular-nums">
                    {s.count}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <Link
        href={`/feed?cluster=${encodeURIComponent(clusterId)}`}
        className="pattern-drilldown-feed-link"
      >
        [ View all {total.toLocaleString()} bills in feed → ]
      </Link>
    </section>
  );
}
