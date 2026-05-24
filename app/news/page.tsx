import Link from "next/link";
import { HeaderBar } from "@/components/HeaderBar";
import { NewsRow } from "@/components/NewsRow";
import { formatBillId } from "@/lib/format";
import {
  getBreakingNews,
  getNewsForBill,
  sanitizeBillId,
} from "@/lib/queries";

type SearchParams = {
  bill?: string;
};

function billIdLabel(billId: string): string {
  const parts = billId.split("-");
  if (parts.length !== 3) return billId;
  const [, type, num] = parts as [string, string, string];
  const n = Number(num);
  if (Number.isNaN(n)) return billId;
  return formatBillId(type, n);
}

// HO 130: `?bill=<id>` filters mentions to a single bill. Invalid value
// falls back to the unfiltered last-24h view (no 404). Same chrome either
// way — only the result list + the title chip differ.
export default async function NewsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const billId = sanitizeBillId(params.bill);
  const mentions = billId
    ? await getNewsForBill(billId)
    : await getBreakingNews(24, 50);

  const pageTitle = billId
    ? `News mentions · ${billIdLabel(billId)}`
    : "Breaking news · Last 24h";
  const emptyHint = billId
    ? `No news mentions yet for ${billIdLabel(billId)}.`
    : "No news mentions in the last 24 hours.";

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        basePath="/news"
        pageTitle={pageTitle}
        pageCount={mentions.length}
        pageCountLabel="mentions"
      />

      <main className="w-full flex-1 px-4 py-4">
        {billId ? (
          <div className="mb-3 flex items-baseline gap-3 text-[12px] uppercase tracking-[0.5px]">
            <span style={{ color: "var(--text-muted)" }}>
              Filtered to{" "}
              <Link
                href={`/bill/${encodeURIComponent(billId)}`}
                style={{ color: "var(--accent-amber)" }}
                className="hover:underline"
              >
                {billIdLabel(billId)}
              </Link>
            </span>
            <Link
              href="/news"
              className="hover:underline"
              style={{ color: "var(--text-dim)" }}
            >
              [ Clear filter → all recent news ]
            </Link>
          </div>
        ) : null}

        {mentions.length === 0 ? (
          <p
            className="py-16 text-center text-[13px]"
            style={{ color: "var(--text-muted)" }}
          >
            {emptyHint}
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
