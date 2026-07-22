import Link from "next/link";
import { BreakingRow } from "@/components/BreakingRow";
import {
  type DashboardFilters,
  getBreakingNewsForHome,
  getBreakingNewsForHomeCount,
} from "@/lib/queries";

// Home-page breaking-news surface (HO 114, restructured HO 131 + HO 133,
// filter-rebase added in home-dashboard-cleanup). 72h window, confidence
// floor 0.7, top 5 deduped by article. The expander chrome at the bottom
// shows the total minus the visible cap, linked to /news for the full
// view.
//
// `filters` is the dashboard's click-to-filter state — when stage or
// topic is set, the block rebases to that slice (same article universe
// as the count chip above). Empty filters = corpus-wide, as before.
const WINDOW_HOURS = 72;
const CAP = 5;

export async function BreakingNewsBlock({
  filters,
  nowMs,
}: {
  filters?: DashboardFilters;
  // HO 490: page-computed clock for the breaking-row ages.
  nowMs: number;
}) {
  const [mentions, totalCount] = await Promise.all([
    getBreakingNewsForHome({
      hours: WINDOW_HOURS,
      minConfidence: 0.7,
      limit: CAP,
      filters,
    }),
    getBreakingNewsForHomeCount({
      hours: WINDOW_HOURS,
      minConfidence: 0.7,
      filters,
    }),
  ]);
  const remaining = Math.max(0, totalCount - mentions.length);

  return (
    <div className="flex flex-1 flex-col min-h-0">
      {mentions.length === 0 ? (
        <p
          className="px-1 py-2 text-[13px]"
          style={{ color: "var(--text-muted)" }}
        >
          No breaking news in the last {WINDOW_HOURS}h.
        </p>
      ) : (
        <ul>
          {mentions.map((m) => (
            <li key={m.id}>
              <BreakingRow mention={m} nowMs={nowMs} />
            </li>
          ))}
        </ul>
      )}
      <Link href="/news" className="home-expander">
        {remaining > 0
          ? `[ + ${remaining.toLocaleString()} more → ]`
          : "[ View all news → ]"}
      </Link>
    </div>
  );
}
