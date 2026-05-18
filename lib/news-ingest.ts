// News ingestion orchestrator (handoff 64). Pulls each RSS feed, runs the
// bill-id matcher against title + summary, looks up matched ids against
// the bills table, and idempotently writes (bill_id, article_url) rows
// to news_mentions. Per-source errors are caught and returned in the
// IngestResult so the cron caller can log them without failing the run.
import { extractBillIds } from "./bill-id-extract";
import { getDb } from "./db";
import { NEWS_SOURCES } from "./news-sources";
import { fetchAndParseRss } from "./rss-parse";

export interface IngestResult {
  source: string;
  itemsFetched: number;
  mentionsInserted: number;
  mentionsSkippedUnknownBill: number;
  errors: string[];
}

export async function ingestNews(): Promise<IngestResult[]> {
  const db = getDb();
  const results: IngestResult[] = [];
  const ingestedAt = new Date().toISOString();

  for (const source of NEWS_SOURCES) {
    const result: IngestResult = {
      source: source.slug,
      itemsFetched: 0,
      mentionsInserted: 0,
      mentionsSkippedUnknownBill: 0,
      errors: [],
    };

    try {
      const items = await fetchAndParseRss(source.feedUrl);
      result.itemsFetched = items.length;

      for (const item of items) {
        const text = `${item.title}\n${item.summary ?? ""}`;
        const billIds = extractBillIds(text);
        if (billIds.length === 0) continue;

        for (const billId of billIds) {
          const exists = await db.execute({
            sql: "SELECT 1 FROM bills WHERE id = ? LIMIT 1",
            args: [billId],
          });
          if (exists.rows.length === 0) {
            result.mentionsSkippedUnknownBill++;
            continue;
          }

          // ON CONFLICT DO NOTHING makes re-ingestion safe; the cron
          // re-fetches feeds every tick and most items will already be
          // present from the previous run.
          await db.execute({
            sql: `INSERT INTO news_mentions
                    (bill_id, source, article_url, article_title,
                     article_summary, published_at, matched_via,
                     match_confidence, ingested_at)
                  VALUES (?, ?, ?, ?, ?, ?, 'bill_id_regex', NULL, ?)
                  ON CONFLICT(bill_id, article_url) DO NOTHING`,
            args: [
              billId,
              source.slug,
              item.url,
              item.title,
              item.summary,
              item.publishedAt,
              ingestedAt,
            ],
          });
          result.mentionsInserted++;
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(msg);
    }

    results.push(result);
  }

  return results;
}
