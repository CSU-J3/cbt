import { HeaderBar } from "@/components/HeaderBar";
import { NewsRow } from "@/components/NewsRow";
import { getBreakingNews } from "@/lib/queries";

export default async function NewsPage() {
  const mentions = await getBreakingNews(24, 50);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        basePath="/news"
        pageTitle="Breaking news · Last 24h"
        pageCount={mentions.length}
        pageCountLabel="mentions"
      />

      <main className="w-full flex-1 px-4 py-4">
        {mentions.length === 0 ? (
          <p
            className="py-16 text-center text-[13px]"
            style={{ color: "var(--text-muted)" }}
          >
            No news mentions in the last 24 hours.
          </p>
        ) : (
          <div
            className="border"
            style={{ borderColor: "var(--border-strong)" }}
          >
            <div className="news-header-row px-3">
              <span>Bill</span>
              <span>Headline</span>
              <span className="source">Source</span>
              <span className="age">Age</span>
            </div>
            <ul>
              {mentions.map((m) => (
                <li key={m.id} className="px-3">
                  <NewsRow mention={m} showFullHeadline={true} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </main>
    </div>
  );
}
