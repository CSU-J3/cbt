import Link from "next/link";
import { NewsRow } from "@/components/NewsRow";
import { getBreakingNewsForHome } from "@/lib/queries";

// Home-page breaking-news surface (handoff 114, restructured HO 131).
// Params locked in HO 114 Phase 1: 72h window, confidence floor 0.7, top
// 3 deduped by bill_id. Unlike the prior BreakingNewsBanner this never
// hides — an empty state is shown so the home page reflects pipeline
// state honestly rather than going silently blank.
//
// HO 131: outer chrome (section / border / heading) moved out to the
// home-quadrant wrapper in app/page.tsx. This component is now just the
// inner content: the View-all link and the row list.
const WINDOW_HOURS = 72;

export async function BreakingNewsBlock() {
  const mentions = await getBreakingNewsForHome({
    hours: WINDOW_HOURS,
    minConfidence: 0.7,
    limit: 3,
  });

  return (
    <div className="flex flex-1 flex-col">
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
      <Link href="/news" className="activity-ticker-footer">
        [ View all news → ]
      </Link>
    </div>
  );
}
