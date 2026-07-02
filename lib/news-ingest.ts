// News ingestion orchestrator (handoff 64, +86 LLM fallback, +117 budget).
// Pulls each RSS feed, runs the bill-id matcher chain against title + summary:
//   1. regex match via extractBillIds — fast, free, ~100% precision when
//      bill IDs are spelled out in the subhead (rare in practice — RSS
//      subheads cite by topic not by ID)
//   2. LLM match via matchBillsToArticle — only fires when regex returns
//      nothing AND a candidate bill survives the keyword pre-filter
// Matched ids are looked up against `bills` and idempotently upserted into
// news_mentions. Per-source errors are caught and returned in the
// IngestResult so the cron caller can log them without failing the run.
//
// HO 117: now bounded. The caller (route /api/cron/news) passes a
// `deadlineMs` so the loop stops starting new articles once the budget is
// near-exhausted. Each LLM call is wrapped in a 8s AbortController on top
// of that, so the deadline + per-article cap together guarantee the cron
// function never crosses Vercel's 60s ceiling.
import { GoogleGenAI } from "@google/genai";
import { extractBillIds } from "./bill-id-extract";
import { getDb } from "./db";
import {
  type ExtractedNames,
  type MatchConfidence,
  matchBillsToArticle,
} from "./news-matcher";
import { NEWS_SOURCES } from "./news-sources";
// HO 394: additive dual-write of each article as a watchcore Observation.
import { dualWriteObservation, loadEntityLookups } from "./news-to-observation";
import { getCandidateBills } from "./queries";
import { fetchAndParseRss } from "./rss-parse";

// Polite delay between LLM calls. With 55 articles/day and most filtered
// out by the keyword pre-filter, this keeps us well under Gemini Flash's
// free-tier rate limits (15 RPM as of 2026-05).
const LLM_INTERVAL_MS = 250;
// HO 117: per-article hard cap. Observed p95 was 760ms locally and max
// 1053ms in HO 117 Phase 1; 8s is ~10× p95 — generous but tight enough
// to bound a hung Gemini call so it can't burn the whole tick.
const PER_ARTICLE_TIMEOUT_MS = 8_000;

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
  // HO 117: subset of llmErrors where the per-article AbortController
  // fired (signal.aborted true at catch). Defensive metric — observed 0
  // in Phase 1 measurement.
  llmTimeouts: number;
  // HO 117: wall-clock for this feed (RSS fetch + per-article loop + DB
  // writes). Surfaced into cron_runs.payload.timings by the route caller.
  wallMs: number;
  // HO 117: true if the deadline interrupted this feed's article loop.
  // Distinguishable from "completed cleanly" so the caller can spot a
  // half-processed feed in logs.
  budgetStopped: boolean;
  errors: string[];
}

export type IngestOptions = {
  /**
   * HO 117: absolute epoch-millis past which ingestNews stops *starting*
   * new articles. The 8s per-article AbortController bounds the in-flight
   * article on top of this. Route passes routeStart + 45_000; combined
   * with the 8s cap and ~2s of cron-log writes, the function stays inside
   * the 60s Vercel ceiling.
   */
  deadlineMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function ingestNews(
  options: IngestOptions = {},
): Promise<IngestResult[]> {
  const db = getDb();
  const results: IngestResult[] = [];
  const ingestedAt = new Date().toISOString();
  const deadlineMs = options.deadlineMs;

  // LLM fallback setup. If GEMINI_API_KEY isn't present we skip the
  // fallback entirely — regex-only mode is the original behavior and
  // shouldn't be blocked by a missing key. The candidate pool is fetched
  // once per ingest run and reused across articles (in-memory pre-filter
  // is cheap; refetching per article would dominate latency).
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  const llmClient = geminiKey ? new GoogleGenAI({ apiKey: geminiKey }) : null;
  const candidates = llmClient ? await getCandidateBills(30) : [];

  // HO 394: entity-resolution lookups (members + committees), loaded once per
  // run like `candidates` and reused across articles, for the observation
  // dual-write's deterministic resolver.
  const lookups = await loadEntityLookups(db);

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

  feedLoop: for (const source of NEWS_SOURCES) {
    // HO 117: check the deadline before starting a new feed — if budget is
    // exhausted, don't even pay for the RSS fetch on the remaining feeds.
    if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
      console.log(
        `[news] budget reached before ${source.slug}; skipping remaining feeds`,
      );
      results.push({
        source: source.slug,
        itemsFetched: 0,
        mentionsInserted: 0,
        mentionsSkippedUnknownBill: 0,
        llmCalls: 0,
        llmMatches: 0,
        llmErrors: 0,
        llmTimeouts: 0,
        wallMs: 0,
        budgetStopped: true,
        errors: ["budget reached before feed started"],
      });
      continue;
    }

    const feedStart = Date.now();
    const result: IngestResult = {
      source: source.slug,
      itemsFetched: 0,
      mentionsInserted: 0,
      mentionsSkippedUnknownBill: 0,
      llmCalls: 0,
      llmMatches: 0,
      llmErrors: 0,
      llmTimeouts: 0,
      wallMs: 0,
      budgetStopped: false,
      errors: [],
    };

    try {
      const items = await fetchAndParseRss(source.feedUrl);
      result.itemsFetched = items.length;

      for (const item of items) {
        // HO 117: deadline check before starting a new article so the only
        // thing that can push us past `deadlineMs` is the 8s per-article
        // AbortController.
        if (deadlineMs !== undefined && Date.now() >= deadlineMs) {
          result.budgetStopped = true;
          console.log(
            `[news] budget reached mid-${source.slug}; stopping after ${result.itemsFetched - items.indexOf(item)} unprocessed`,
          );
          // Wrap up this feed's stats, then bail out of the outer loop —
          // feeds after this won't even start (the feed-loop check above
          // catches them).
          result.wallMs = Date.now() - feedStart;
          results.push(result);
          break feedLoop;
        }

        const text = `${item.title}\n${item.summary ?? ""}`;
        // Regex hits store NULL confidence (deterministic — a spelled-out
        // bill ID is not a probabilistic match); LLM hits carry a REAL.
        let billMatches: { billId: string; confidence: number | null }[] =
          extractBillIds(text).map((id) => ({ billId: id, confidence: null }));
        let matchedVia: "bill_id_regex" | "llm_match" = "bill_id_regex";

        // HO 394: entity extraction rides the SAME LLM call. `extracted` holds
        // the raw people/org name mentions; `obsTags` records why the LLM was
        // NOT called (so the coverage diagnostic can size the population that
        // extraction never sees — the only thing decoupling the gate would fix).
        let extracted: ExtractedNames = { people: [], orgs: [] };
        let obsTags: string[] = [];
        if (billMatches.length > 0) {
          // Regex fast-path: LLM skipped, so no member/committee extraction.
          obsTags = ["no_llm_call:regex"];
        }

        // LLM fallback fires only when regex misses AND we have a key set.
        // No-pre-filter-hits short-circuits BEFORE counting an LLM call so
        // the llmCalls metric reflects actual Gemini round-trips.
        if (billMatches.length === 0 && llmClient && candidates.length > 0) {
          // HO 117: per-article AbortController. The 8s cap is enforced by
          // the timer; on abort the matcher's catch returns api_error, and
          // the post-call signal.aborted check separates a timeout from a
          // genuine model error.
          const ac = new AbortController();
          const timer = setTimeout(() => ac.abort(), PER_ARTICLE_TIMEOUT_MS);
          let outcome;
          try {
            outcome = await matchBillsToArticle(
              llmClient,
              item.title,
              item.summary,
              candidates,
              ac.signal,
            );
          } finally {
            clearTimeout(timer);
          }
          if (outcome.kind === "matched") {
            result.llmCalls++;
            result.llmMatches++;
            billMatches = outcome.matches.map((m) => ({
              billId: m.billId,
              confidence: CONFIDENCE_REAL[m.confidence],
            }));
            matchedVia = "llm_match";
            extracted = outcome.extracted;
            await sleep(LLM_INTERVAL_MS);
          } else if (outcome.kind === "no_match") {
            result.llmCalls++;
            extracted = outcome.extracted;
            await sleep(LLM_INTERVAL_MS);
          } else if (outcome.kind === "api_error") {
            result.llmCalls++;
            obsTags = ["llm_error"];
            if (ac.signal.aborted) {
              result.llmTimeouts++;
              result.errors.push(
                `llm timeout (${PER_ARTICLE_TIMEOUT_MS}ms): ${item.title.slice(0, 60)}`,
              );
            } else {
              result.llmErrors++;
              result.errors.push(`llm match: ${outcome.reason}`);
            }
            await sleep(LLM_INTERVAL_MS);
          } else {
            // no_pre_filter_hits: no LLM call, no metric bump, no sleep.
            obsTags = ["no_llm_call:prefilter"];
          }
        } else if (billMatches.length === 0) {
          // No LLM client / no candidates → no call could be made.
          obsTags = ["no_llm_call:no_client"];
        }

        // news_mentions write — UNCHANGED (bill-keyed, the live UI source). Only
        // articles with a bill match write a mention; the rest fall through.
        const recordedBillIds: string[] = [];
        if (billMatches.length > 0) {
          for (const m of billMatches) {
            const inserted = await recordMention(
              m.billId,
              source.slug,
              item,
              matchedVia,
              m.confidence,
            );
            if (inserted) {
              result.mentionsInserted++;
              recordedBillIds.push(m.billId);
            } else {
              result.mentionsSkippedUnknownBill++;
            }
          }
        }

        // HO 394 dual-write: EVERY article becomes one Observation (incl. the
        // ~76% news_mentions drops — the rescue population). Bill entities are
        // the ids that actually exist (recordMention-confirmed). Guarded so a
        // mapper/store failure can never break the news cron (Gate C) — the
        // news_mentions write above has already succeeded.
        try {
          await dualWriteObservation(
            db,
            item,
            source,
            recordedBillIds,
            extracted,
            lookups,
            ingestedAt,
            obsTags,
          );
        } catch (err) {
          result.errors.push(
            `obs write (${item.title.slice(0, 40)}): ${(err as Error).message}`,
          );
        }
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(msg);
    }

    result.wallMs = Date.now() - feedStart;
    results.push(result);
  }

  return results;
}
