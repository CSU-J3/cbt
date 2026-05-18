import Link from "next/link";
import { NewsRow } from "@/components/NewsRow";
import { getBreakingNews } from "@/lib/queries";

// Empty state intentionally hides the entire banner — the dashboard
// shouldn't carry a "nothing happened" placeholder. Hide-or-show is the
// signal.
export async function BreakingNewsBanner() {
  const mentions = await getBreakingNews(24, 5);
  if (mentions.length === 0) return null;

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
          style={{
            color: "var(--accent-amber)",
            letterSpacing: "0.5px",
          }}
        >
          Breaking · Last 24h
        </span>
        <Link
          href="/news"
          className="text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
          style={{ color: "var(--text-muted)" }}
        >
          [View all →]
        </Link>
      </div>
      <ul>
        {mentions.map((m) => (
          <li key={m.id}>
            <NewsRow mention={m} showFullHeadline={false} />
          </li>
        ))}
      </ul>
    </section>
  );
}
