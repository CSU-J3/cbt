// HO 117 Phase 1 — measure news ingestion cost shape without writing.
// Mirrors ingestNews()'s per-feed / per-article loop: RSS fetch+parse → regex
// extract → on regex miss, LLM matcher with the keyword pre-filter. Skips
// the news_mentions INSERT entirely. Read-only: safe to run repeatedly.
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { extractBillIds } from "../../lib/bill-id-extract";
import { matchBillsToArticle } from "../../lib/news-matcher";
import { NEWS_SOURCES } from "../../lib/news-sources";
import { getCandidateBills } from "../../lib/queries";
import { fetchAndParseRss } from "../../lib/rss-parse";

const LLM_INTERVAL_MS = 250; // match ingestNews

function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx]!;
}

async function main() {
  const geminiKey = process.env.GEMINI_API_KEY?.trim();
  if (!geminiKey) throw new Error("GEMINI_API_KEY not set");
  const client = new GoogleGenAI({ apiKey: geminiKey });
  const candidates = await getCandidateBills(30);
  console.log(`candidate pool: ${candidates.length} bills (last 30 days)`);

  const allLlmTimings: number[] = [];
  let grandTotalMs = 0;

  for (const source of NEWS_SOURCES) {
    console.log(`\n--- ${source.slug} (${source.feedUrl}) ---`);
    const t0 = Date.now();
    const tFetch0 = Date.now();
    let items;
    try {
      items = await fetchAndParseRss(source.feedUrl);
    } catch (e) {
      console.log(`  RSS fetch FAILED: ${(e as Error).message}`);
      continue;
    }
    const fetchMs = Date.now() - tFetch0;
    console.log(`  RSS fetch+parse: ${fetchMs}ms (${items.length} items)`);

    let regexHits = 0;
    let preFilterMisses = 0;
    let llmCalls = 0;
    let llmMatches = 0;
    let llmNoMatch = 0;
    let llmErrors = 0;
    const llmTimings: number[] = [];

    for (const item of items) {
      const text = `${item.title}\n${item.summary ?? ""}`;
      const regexIds = extractBillIds(text);
      if (regexIds.length > 0) {
        regexHits++;
        continue;
      }
      const l0 = Date.now();
      const outcome = await matchBillsToArticle(
        client,
        item.title,
        item.summary,
        candidates,
      );
      const lMs = Date.now() - l0;
      if (outcome.kind === "no_pre_filter_hits") {
        preFilterMisses++;
        // no LLM call, no sleep, mirror ingestNews
        continue;
      }
      // LLM call actually fired
      llmCalls++;
      llmTimings.push(lMs);
      allLlmTimings.push(lMs);
      if (outcome.kind === "matched") llmMatches++;
      else if (outcome.kind === "no_match") llmNoMatch++;
      else if (outcome.kind === "api_error") {
        llmErrors++;
        console.log(`    api_error: ${outcome.reason.slice(0, 80)}`);
      }
      await new Promise((r) => setTimeout(r, LLM_INTERVAL_MS));
    }

    const totalMs = Date.now() - t0;
    grandTotalMs += totalMs;
    const sortedL = [...llmTimings].sort((a, b) => a - b);
    const sumL = llmTimings.reduce((s, n) => s + n, 0);
    console.log(
      `  per-article: regex=${regexHits} preFilterMiss=${preFilterMisses} ` +
        `llm_calls=${llmCalls} (matched=${llmMatches} no_match=${llmNoMatch} errors=${llmErrors})`,
    );
    if (llmTimings.length > 0) {
      console.log(
        `  llm latency: avg=${Math.round(sumL / llmTimings.length)}ms ` +
          `min=${sortedL[0]} p50=${pct(sortedL, 50)} p95=${pct(sortedL, 95)} max=${sortedL[sortedL.length - 1]}ms`,
      );
    }
    console.log(
      `  feed total: ${totalMs}ms ` +
        `(rss=${fetchMs}ms + ${llmCalls} llm calls + ${llmCalls} × ${LLM_INTERVAL_MS}ms throttle)`,
    );
  }

  console.log(`\n=== aggregate ===`);
  const sortedAll = [...allLlmTimings].sort((a, b) => a - b);
  const sumAll = allLlmTimings.reduce((s, n) => s + n, 0);
  console.log(`grand total wall (3 feeds, serial): ${grandTotalMs}ms`);
  if (allLlmTimings.length > 0) {
    console.log(
      `llm latency across all feeds (${allLlmTimings.length} calls): ` +
        `avg=${Math.round(sumAll / allLlmTimings.length)}ms ` +
        `min=${sortedAll[0]} p50=${pct(sortedAll, 50)} p95=${pct(sortedAll, 95)} max=${sortedAll[sortedAll.length - 1]}ms`,
    );
    const projThrottle = allLlmTimings.length * LLM_INTERVAL_MS;
    console.log(
      `pure-LLM-cost model: ${allLlmTimings.length} calls × avg ${Math.round(sumAll / allLlmTimings.length)}ms ` +
        `+ throttle ${projThrottle}ms = ${Math.round((sumAll + projThrottle) / 1000)}s`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
