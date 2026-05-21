// News ingestion orchestrator (handoff 64, +86 LLM fallback). Pulls each
// RSS feed, runs the bill-id matcher chain against title + summary:
//   1. regex match via extractBillIds — fast, free, ~100% precision when
//      bill IDs are spelled out in the subhead (rare in practice — RSS
//      subheads cite by topic not by ID)
//   2. LLM match via matchBillsToArticle — only fires when regex returns
//      nothing AND a candidate bill survives the keyword pre-filter
// Matched ids are looked up against `bills` and idempotently upserted into
// news_mentions. Per-source errors are caught and returned in the
// IngestResult so the cron caller can log them without failing the run.
import { GoogleGenAI } from "@google/genai";
import { extractBillIds } from "./bill-id-extract";
import { getDb } from "./db";
import { type MatchConfidence, matchBillsToArticle } from "./news-matcher";
import { NEWS_SOURCES } from "./news-sources";
import { getCandidateBills } from "./queries";
import { fetchAndParseRss } from "./rss-parse";

// Polite delay between LLM calls. With 55 articles/day and most filtered
// out by the keyword pre-filter, this keeps us well under Gemini Flash's
// free-tier rate limits (15 RPM as of 2026-05).
const LLM_INTERVAL_MS = 250;

// LLM confidence label → the REAL stored in news_mentions.match_confidence
// (HO 104). The column is REAL (designed for a 0-1 score); the matcher emits
// coarse high/medium/low buckets, and these three values are all the column
// will ever hold from the LLM path. Regex matches store NULL (deterministic).
const CONFIDENCE_REAL: Record<MatchConfidence, number> = {
  high: 1,
  medium: 0.6,
  low: 0.3,
};

export interface IngestResult {
  source: string;
  itemsFetched: number;
  mentionsInserted: number;
  mentionsSkippedUnknownBill: number;
  // Diagnostics for the LLM fallback path (handoff 86). Useful in cron
  // logs for noticing precision drift or budget creep.
  llmCalls: number;
  llmMatches: number;
  llmErrors: number;
  errors: string[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ingestNews(): Promise<IngestResult[]> {
  const db = getDb();
  const results: IngestResult[] = [];
  const ingestedAt = new Date().toISOString();

  // LLM fallback setup. If GEMINI_API_KEY isn't present we skip the
  // fallback entirely — regex-only mode is the original behavior and
  // shouldn't be blocked by a missing key. The candidate pool is fetched
  // once per ingest run and reused across articles (in-memory pre-filter
  // is cheap; refetching per article would dominate latency).
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const llmClient = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null;
  const candidates = llmClient ? await getCandidateBills(30) : [];

  async function recordMention(
    billId: string,
    source: string,
    item: { url: string; title: string; summary: string | null; publishedAt: string },
    matchedVia: "bill_id_regex" | "llm_match",
    matchConfidence: number | null,
  ): Promise<boolean> {
    const exists = await db.execute({
      sql: "SELECT 1 FROM bills WHERE id = ? LIMIT 1",
      args: [billId],
    });
    if (exists.rows.length === 0) return false;
    // ON CONFLICT DO NOTHING makes re-ingestion safe; the cron re-fetches
    // feeds every tick and most items will already be present from the
    // previous run.
    await db.execute({
      sql: `INSERT INTO news_mentions
              (bill_id, source, article_url, article_title,
               article_summary, published_at, matched_via,
               match_confidence, ingested_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(bill_id, article_url) DO NOTHING`,
      args: [
        billId,
        source,
        item.url,
        item.title,
        item.summary,
        item.publishedAt,
        matchedVia,
        matchConfidence,
        ingestedAt,
      ],
    });
    return true;
  }

  for (const source of NEWS_SOURCES) {
    const result: IngestResult = {
      source: source.slug,
      itemsFetched: 0,
      mentionsInserted: 0,
      mentionsSkippedUnknownBill: 0,
      llmCalls: 0,
      llmMatches: 0,
      llmErrors: 0,
      errors: [],
    };

    try {
      const items = await fetchAndParseRss(source.feedUrl);
      result.itemsFetched = items.length;

      for (const item of items) {
        const text = `${item.title}\n${item.summary ?? ""}`;
        // Regex hits store NULL confidence (deterministic — a spelled-out
        // bill ID is not a probabilistic match); LLM hits carry a REAL.
        let billMatches: { billId: string; confidence: number | null }[] =
          extractBillIds(text).map((id) => ({ billId: id, confidence: null }));
        let matchedVia: "bill_id_regex" | "llm_match" = "bill_id_regex";

        // LLM fallback fires only when regex misses AND we have a key set.
        // No-pre-filter-hits short-circuits BEFORE counting an LLM call so
        // the llmCalls metric reflects actual Gemini round-trips.
        if (billMatches.length === 0 && llmClient && candidates.length > 0) {
          const outcome = await matchBillsToArticle(
            llmClient,
            item.title,
            item.summary,
            candidates,
          );
          if (outcome.kind === "matched") {
            result.llmCalls++;
            result.llmMatches++;
            billMatches = outcome.matches.map((m) => ({
              billId: m.billId,
              confidence: CONFIDENCE_REAL[m.confidence],
            }));
            matchedVia = "llm_match";
            await sleep(LLM_INTERVAL_MS);
          } else if (outcome.kind === "no_match") {
            result.llmCalls++;
            await sleep(LLM_INTERVAL_MS);
          } else if (outcome.kind === "api_error") {
            result.llmCalls++;
            result.llmErrors++;
            result.errors.push(`llm match: ${outcome.reason}`);
            await sleep(LLM_INTERVAL_MS);
          }
          // no_pre_filter_hits: no LLM call, no metric bump, no sleep
        }

        if (billMatches.length === 0) continue;

        for (const m of billMatches) {
          const inserted = await recordMention(
            m.billId,
            source.slug,
            item,
            matchedVia,
            m.confidence,
          );
          if (inserted) result.mentionsInserted++;
          else result.mentionsSkippedUnknownBill++;
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
