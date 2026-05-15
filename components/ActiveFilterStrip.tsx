import Link from "next/link";
import type { DashboardFilters } from "@/lib/queries";

// Renders between HeaderBar and the dashboard grid. Hidden entirely when no
// filter is active. Provides the two escapes from a filtered dashboard:
// clear back to /, or carry the filters into the full /feed list.
export function ActiveFilterStrip({
  filters,
}: {
  filters: DashboardFilters;
}) {
  const { stage, topic } = filters;
  if (!stage && !topic) return null;

  const feedParams = new URLSearchParams();
  if (stage) feedParams.set("stage", stage);
  if (topic) feedParams.set("topics", topic);
  const feedHref = `/feed?${feedParams.toString()}`;

  return (
    <div className="active-filter-strip">
      <span className="active-filter-summary">
        <span style={{ color: "var(--text-secondary)" }}>Filtered</span>
        {stage ? (
          <>
            <span style={{ color: "var(--text-dim)" }}>·</span>
            <span style={{ color: "var(--text-secondary)" }}>Stage:</span>
            <span style={{ color: "var(--accent-amber)" }}>
              {stage.replace(/_/g, " ")}
            </span>
          </>
        ) : null}
        {topic ? (
          <>
            <span style={{ color: "var(--text-dim)" }}>·</span>
            <span style={{ color: "var(--text-secondary)" }}>Topic:</span>
            <span style={{ color: "var(--accent-amber)" }}>
              {topic.replace(/_/g, " ")}
            </span>
          </>
        ) : null}
      </span>
      <span className="active-filter-actions">
        <Link href="/" className="active-filter-link">
          × Clear
        </Link>
        <Link href={feedHref} className="active-filter-link">
          View in /feed →
        </Link>
      </span>
    </div>
  );
}
