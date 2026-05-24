import Link from "next/link";
import { NewsRow } from "@/components/NewsRow";
import {
  getBreakingNewsForHome,
  getBreakingNewsForHomeCount,
} from "@/lib/queries";

// Home-page breaking-news surface (HO 114, restructured HO 131 + HO 133).
// 72h window, confidence floor 0.7, top 5 deduped by article. The
// expander chrome at the bottom shows the total minus the visible cap,
// linked to /news for the full view.
const WINDOW_HOURS = 72;
const CAP = 5;

export async function BreakingNewsBlock() {
  const [mentions, totalCount] = await Promise.all([
    getBreakingNewsForHome({
      hours: WINDOW_HOURS,
      minConfidence: 0.7,
      limit: CAP,
    }),
    getBreakingNewsForHomeCount({
      hours: WINDOW_HOURS,
      minConfidence: 0.7,
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
        <ul className="flex-1">
          {mentions.map((m) => (
            <li key={m.id}>
              <NewsRow mention={m} showFullHeadline={false} linkBillToDetail />
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
