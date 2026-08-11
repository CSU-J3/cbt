import Link from "next/link";
import type { Chamber, DashboardFilters } from "@/lib/queries";

// Renders between HeaderBar and the dashboard grid. Hidden entirely when no
// filter is active. Provides the two escapes from a filtered dashboard:
// clear back to the dashboard (`basePath`, default `/` — the only live caller
// since HO 608 removed the classic dashboard, which passed its own path), or
// carry the filters into /bills.
export function ActiveFilterStrip({
  filters,
  chamber,
  basePath = "/",
}: {
  filters: DashboardFilters;
  // HO 642: NOT a filter this strip announces — the chamber selector shows its
  // own state, and a strip for it would be C5 (the same fact twice). It is here
  // only so the two escapes don't silently drop it.
  chamber?: Chamber;
  basePath?: string;
}) {
  const { stage, topic } = filters;
  // Chamber alone renders no strip, deliberately: the early return stays keyed on
  // stage/topic only.
  if (!stage && !topic) return null;

  const feedParams = new URLSearchParams();
  if (stage) feedParams.set("stage", stage);
  if (topic) feedParams.set("topics", topic);
  // /bills reads the same key, so carry it across rather than losing the
  // selection at the boundary.
  if (chamber) feedParams.set("chamber", chamber);
  const feedHref = `/bills?${feedParams.toString()}`;
  // × Clear drops the stage/topic filters this strip is about; hrefing bare
  // basePath would ALSO drop a chamber selection the strip never mentioned.
  const clearHref = chamber ? `${basePath}?chamber=${chamber}` : basePath;

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
        <Link href={clearHref} className="active-filter-link">
          × Clear
        </Link>
        <Link href={feedHref} className="active-filter-link">
          View in /bills →
        </Link>
      </span>
    </div>
  );
}
