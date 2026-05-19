// LLM-based news → bill matcher (handoff 86). Fallback layer when the
// regex matcher in `lib/bill-id-extract.ts` returns nothing because the
// RSS subhead refers to legislation by topic ("immigration enforcement
// bill") rather than citation ("HR 1234"). Walks a recent-bills candidate
// set, narrows by keyword overlap against the article text, then asks
// Gemini to pick the bills the article is genuinely about.
//
// Uses the same GoogleGenAI client pattern as lib/summarize.ts and
// lib/report-generation.ts so the api-key/model wiring stays in one
// place. Caller is responsible for rate-limiting between calls — see
// `LLM_INTERVAL_MS` in lib/news-ingest.ts.
import { GoogleGenAI } from "@google/genai";
import type { CandidateBill } from "./queries";
import { SUMMARY_MODEL } from "./summarize";

// Keep the prompt focused and cheap. Per-article cost target: ~500
// input tokens + ~30 output tokens against Gemini Flash. Pre-filter
// keeps most articles below this budget.
const MAX_CANDIDATES_PER_CALL = 30;
const MIN_WORD_LENGTH_FOR_OVERLAP = 5;

const SYSTEM_PROMPT = `You are matching a US news article to specific US Congress bills it might be about.

Return ONLY a JSON array of bill IDs from the candidate list. Examples of valid output:
["119-hr-1234"]
["119-hr-1234", "119-s-567"]
[]

Rules:
- Return [] if no candidate is clearly the subject of the article.
- Do not include bills that are only tangentially related (e.g. mentioned as background context).
- Do not invent bill IDs that aren't in the candidate list.
- Output the JSON array only — no prose, no markdown fences, no commentary.`;

function normalizeWords(s: string): Set<string> {
  const out = new Set<string>();
  for (const word of s.toLowerCase().split(/[^a-z0-9]+/)) {
    if (word.length >= MIN_WORD_LENGTH_FOR_OVERLAP) out.add(word);
  }
  return out;
}

// Keep candidates whose title shares at least one non-stopword token with
// the article. Stop-like 4-letter and shorter words are dropped via the
// length floor in normalizeWords. Pure in-memory — no LLM cost.
function preFilter(
  articleText: string,
  candidates: CandidateBill[],
): CandidateBill[] {
  const articleWords = normalizeWords(articleText);
  if (articleWords.size === 0) return [];
  const out: CandidateBill[] = [];
  for (const c of candidates) {
    const titleWords = normalizeWords(c.title);
    for (const w of titleWords) {
      if (articleWords.has(w)) {
        out.push(c);
        break;
      }
    }
  }
  return out;
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
}

export type MatchOutcome =
  | { kind: "no_pre_filter_hits" }
  | { kind: "matched"; billIds: string[] }
  | { kind: "no_match" }
  | { kind: "api_error"; reason: string };

export async function matchBillsToArticle(
  client: GoogleGenAI,
  articleTitle: string,
  articleSummary: string | null,
  candidates: CandidateBill[],
): Promise<MatchOutcome> {
  const articleText = `${articleTitle}\n${articleSummary ?? ""}`;
  const filtered = preFilter(articleText, candidates);
  if (filtered.length === 0) return { kind: "no_pre_filter_hits" };

  const top = filtered.slice(0, MAX_CANDIDATES_PER_CALL);
  const candidateList = top
    .map(
      (c) =>
        `- ${c.id}: ${c.title}${c.summary ? ` | ${c.summary.slice(0, 100)}` : ""}`,
    )
    .join("\n");

  const userPrompt = `Article title: ${articleTitle}
Article summary: ${articleSummary ?? "(none)"}

Candidate bills (${top.length}):
${candidateList}`;

  let text: string | undefined;
  try {
    const response = await client.models.generateContent({
      model: SUMMARY_MODEL,
      contents: userPrompt,
      config: {
        systemInstruction: SYSTEM_PROMPT,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    text = response.text?.trim();
  } catch (err) {
    return {
      kind: "api_error",
      reason: (err as Error).message ?? "generateContent threw",
    };
  }
  if (!text) return { kind: "api_error", reason: "empty response" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripFences(text));
  } catch {
    return { kind: "api_error", reason: `unparseable: ${text.slice(0, 80)}` };
  }
  if (!Array.isArray(parsed)) {
    return { kind: "api_error", reason: "not a JSON array" };
  }
  // Validate every id is actually in the candidate set we passed — guards
  // against hallucinated bill ids (Gemini Flash occasionally invents
  // plausibly-shaped ids when uncertain).
  const validIds = new Set(top.map((c) => c.id));
  const matched: string[] = [];
  for (const v of parsed) {
    if (typeof v === "string" && validIds.has(v)) matched.push(v);
  }
  return matched.length > 0
    ? { kind: "matched", billIds: matched }
    : { kind: "no_match" };
}
