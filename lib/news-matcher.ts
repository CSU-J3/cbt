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

const SYSTEM_PROMPT = `You are matching a US news article to specific US Congress bills it is about.

The article TITLE is the primary signal — it states what the article is actually about. The article summary is context only: do NOT match a bill if the connection to it exists solely in the summary teaser and is not reflected in the title's subject.

Reject matches based on topical adjacency. A bill must be what the article is ABOUT, not what it is NEAR. If the headline is about topic X and a bill addresses topic Y, do not match that bill even if the summary briefly mentions Y.

A bill IS what the article is about when it directly enacts, funds, or governs the specific policy or fight the headline covers — match it even if the article never cites it by name. A bill is merely NEAR when it only shares a broad subject area. (A "ballroom security funding" headline is about the bills that fund or authorize that ballroom; a "people losing health coverage" headline is NOT about an unrelated new health-grant program.)

For each bill you match, assign a confidence:
- "high": the article title directly references the bill's subject.
- "medium": the title implies the subject but isn't explicit, and the summary corroborates.
- "low": an uncertain but defensible match — prefer omitting a bill over including it at "low".

Return ONLY a JSON object of this exact shape — no prose, no markdown fences, no commentary:
{"matches": [{"bill_id": "119-hr-1234", "confidence": "high"}]}

Return {"matches": []} if no candidate is clearly the subject of the article.

Rules:
- Use only bill IDs from the candidate list. Never invent IDs.
- Do not include bills that are only tangential or mentioned as background context.`;

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

// Coarse confidence buckets (HO 104). Three labels, not a numeric score —
// an LLM's raw 0-100 is noisy and poorly calibrated; buckets give downstream
// code a clean threshold. The ingest layer maps these to the REAL stored in
// news_mentions.match_confidence.
export type MatchConfidence = "high" | "medium" | "low";

export type BillMatch = { billId: string; confidence: MatchConfidence };

export type MatchOutcome =
  | { kind: "no_pre_filter_hits" }
  | { kind: "matched"; matches: BillMatch[] }
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
  const rawMatches =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).matches
      : undefined;
  if (!Array.isArray(rawMatches)) {
    return { kind: "api_error", reason: "no matches array in response" };
  }
  // Validate every id against the candidate set we passed — guards against
  // hallucinated ids (Gemini Flash occasionally invents plausibly-shaped ids
  // when uncertain). A missing/garbled confidence falls back to "low" rather
  // than dropping an otherwise-valid match.
  const validIds = new Set(top.map((c) => c.id));
  const matches: BillMatch[] = [];
  const seen = new Set<string>();
  for (const m of rawMatches) {
    if (!m || typeof m !== "object") continue;
    const o = m as Record<string, unknown>;
    const billId = o.bill_id;
    if (typeof billId !== "string" || !validIds.has(billId)) continue;
    if (seen.has(billId)) continue;
    seen.add(billId);
    const c = o.confidence;
    const confidence: MatchConfidence =
      c === "high" || c === "medium" || c === "low" ? c : "low";
    matches.push({ billId, confidence });
  }
  return matches.length > 0
    ? { kind: "matched", matches }
    : { kind: "no_match" };
}
