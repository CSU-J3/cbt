import Link from "next/link";
import { type DashboardFilters, getTopicDistribution } from "@/lib/queries";
import { topicColor, topicFullLabel, topicLabel } from "@/lib/topic-colors";

// Toggle `topics` in the dashboard URL, preserving an active stage filter.
function buildHref(topic: string, filters?: DashboardFilters): string {
  const params = new URLSearchParams();
  if (filters?.topic !== topic) params.set("topics", topic);
  if (filters?.stage) params.set("stage", filters.stage);
  const qs = params.toString();
  return qs ? `/?${qs}` : "/";
}

export async function TopicDistribution({
  filters,
}: {
  filters?: DashboardFilters;
}) {
  const rows = await getTopicDistribution(filters);

  if (rows.length === 0) {
    return (
      <p
        className="px-6 py-8 text-center text-[13px]"
        style={{ color: "var(--text-dim)" }}
      >
        No classified bills yet.
      </p>
    );
  }

  const maxCount = rows[0]?.count ?? 0;
  const activeTopic = filters?.topic;

  return (
    // HO 133 v5: cap chart width at 1200px and center inside the cell so
    // bar lengths stay comparable at the eye-scale even at 2560+ wide
    // viewports. The .home-quadrant cell itself stays full-width — only
    // the chart inside is constrained.
    <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-0.5">
      {rows.map((r) => {
        const color = topicColor(r.topic);
        const width = maxCount > 0 ? (r.count / maxCount) * 100 : 0;
        const dimmed = !!activeTopic && activeTopic !== r.topic;
        return (
          <Link
            key={r.topic}
            href={buildHref(r.topic, filters)}
            title={topicFullLabel(r.topic)}
            className="topic-dist-row"
            style={{ opacity: dimmed ? 0.4 : 1 }}
          >
            <span
              className="text-[12px] uppercase tracking-[0.5px]"
              style={{ color }}
            >
              {topicLabel(r.topic)}
            </span>
            <span className="topic-dist-bar-track">
              <span
                className="topic-dist-bar-fill"
                style={{ width: `${width}%`, backgroundColor: color }}
                aria-hidden
              />
            </span>
            <span
              className="text-right text-[13px] tabular-nums"
              style={{ color: "var(--text-secondary)" }}
            >
              {r.count.toLocaleString()}
            </span>
          </Link>
        );
      })}
    </div>
  );
}
