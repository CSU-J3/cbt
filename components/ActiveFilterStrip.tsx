import Link from "next/link";
import type { DashboardFilters } from "@/lib/queries";

// Renders between HeaderBar and the dashboard grid. Hidden entirely when no
// filter is active. Provides the two escapes from a filtered dashboard:
// clear back to the dashboard (`basePath`, default `/`; `/dashboard-classic`
// passes its own path post-HO-311 swap), or carry the filters into /bills.
export function ActiveFilterStrip({
  filters,
  basePath = "/",
}: {
  filters: DashboardFilters;
  basePath?: string;
}) {
  const { stage, topic } = filters;
  if (!stage && !topic) return null;

  const feedParams = new URLSearchParams();
  if (stage) feedParams.set("stage", stage);
  if (topic) feedParams.set("topics", topic);
  const feedHref = `/bills?${feedParams.toString()}`;

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
        <Link href={basePath} className="active-filter-link">
          × Clear
        </Link>
        <Link href={feedHref} className="active-filter-link">
          View in /bills →
        </Link>
      </span>
    </div>
  );
}
