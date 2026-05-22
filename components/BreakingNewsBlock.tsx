import Link from "next/link";
import { NewsRow } from "@/components/NewsRow";
import { getBreakingNewsForHome } from "@/lib/queries";

// Home-page breaking-news surface (handoff 114). Params locked in Phase 1:
// 72h window, confidence floor 0.7, top 3 deduped by bill_id. Unlike the
// prior BreakingNewsBanner this never hides — an empty state is shown so the
// home page reflects pipeline state honestly rather than going silently
// blank. Placed above the stage funnel in app/page.tsx.
const WINDOW_HOURS = 72;

export async function BreakingNewsBlock() {
  const mentions = await getBreakingNewsForHome({
    hours: WINDOW_HOURS,
    minConfidence: 0.7,
    limit: 3,
  });

  // Age of the freshest mention, in hours, for the header label. Results are
  // ordered published-desc, so the first row carries the newest mention.
  const newestHours =
    mentions.length > 0
      ? Math.floor(
          Math.max(0, Date.now() - Date.parse(mentions[0]!.publishedAt)) /
            3_600_000,
        )
      : null;

  return (
    <section
      className="border-b px-4 py-2"
      style={{
        backgroundColor: "var(--bg-panel)",
        borderColor: "var(--border-strong)",
      }}
    >
      <div className="mb-1 flex items-baseline justify-between">
        <span
          className="text-[12px] uppercase"
          style={{ color: "var(--accent-amber)", letterSpacing: "0.5px" }}
        >
          Breaking · Last {WINDOW_HOURS}h
          {newestHours !== null ? ` · Newest ${newestHours}h ago` : ""}
        </span>
        <Link
          href="/news"
          className="text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
          style={{ color: "var(--text-muted)" }}
        >
          [View all →]
        </Link>
      </div>
      {mentions.length === 0 ? (
        <p className="py-2 text-[13px]" style={{ color: "var(--text-muted)" }}>
          No breaking news in the last {WINDOW_HOURS}h.
        </p>
      ) : (
        <ul>
          {mentions.map((m) => (
            <li key={m.id}>
              <NewsRow mention={m} showFullHeadline={false} linkBillToDetail />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
