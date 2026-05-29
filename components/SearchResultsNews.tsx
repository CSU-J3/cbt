import { NewsRow } from "@/components/NewsRow";
import { searchNews } from "@/lib/queries";

// Reuses the NewsRow component from /news. linkBillToDetail=true so a
// bill rail click goes straight to the bill hub rather than to /feed's
// expand panel — search-result intent is "find this thing," not
// "preview it in context."
export async function SearchResultsNews({ q }: { q: string }) {
  const mentions = await searchNews(q);

  return (
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
            <NewsRow mention={m} showFullHeadline />
          </li>
        ))}
      </ul>
    </div>
  );
}
