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

// HO 394: reframed from bill-only matching to typed-entity extraction. The
// SAME one call now emits bills (unchanged contract) PLUS the members of
// Congress and the committees/caucuses the article is about. `people`/`orgs`
// are raw name strings; a deterministic resolver (lib/news-to-observation.ts)
// canonicalizes them to bioguide_ids / system_codes with precision-over-recall.
// Extracting names here (not ids) is deliberate: the model can't know
// bioguide_ids, and a wrong id poisons the join — so the model proposes, the
// code resolves.
const SYSTEM_PROMPT = `You are analyzing a US Congress news article and extracting what it is ABOUT: the specific bills, the members of Congress, and the congressional committees or caucuses.

The article TITLE is the primary signal — it states what the article is actually about. The summary is context only.

Reject topical adjacency in every category. An entity must be what the article is ABOUT, not merely NEAR or mentioned as background.

BILLS:
A bill IS what the article is about when it directly enacts, funds, or governs the specific policy or fight the headline covers — match it even if the article never cites it by name. A bill is merely NEAR when it only shares a broad subject area. (A "ballroom security funding" headline is about the bills that fund that ballroom; a "people losing health coverage" headline is NOT about an unrelated new health-grant program.) Use ONLY bill IDs from the candidate list; never invent IDs. Per matched bill assign confidence: "high" (title directly references the bill's subject), "medium" (title implies it, summary corroborates), "low" (uncertain but defensible — prefer omitting over "low").

PEOPLE:
Only current US Representatives and Senators the article is about. Give the person's name as commonly written, preferring the full name ("Mike Lawler", "Ruben Gallego") but a bare surname is acceptable when that is all the article gives ("Slotkin", "Kean"). Do NOT include the President, executive-branch officials, private citizens, staffers, or non-members — only sitting members of Congress. Do NOT guess a member who is not clearly a subject.

ORGS:
Congressional committees and caucuses the article is about, by name or by clear context. If the headline says "House panel" or "Senate committee" and the specific committee is determinable ("House Oversight", "Senate Ethics Committee"), name that committee. Include caucuses ("Congressional Black Caucus", "House Freedom Caucus") when they are the subject. Do NOT include executive agencies, parties, or advocacy groups.

Return ONLY a JSON object of this exact shape — no prose, no markdown fences, no commentary:
{"matches": [{"bill_id": "119-hr-1234", "confidence": "high"}], "people": ["Mike Lawler", "Jamie Raskin"], "orgs": ["House Oversight Committee"]}

Every array may be empty. Return all three keys always. If the article is not about Congress at all (e.g. a health or weather story), return {"matches": [], "people": [], "orgs": []}.`;

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

// HO 394: raw entity-name mentions the model extracted (unresolved). The caller
// resolves people → bioguide_id and orgs → committee system_code / caucus slug.
export type ExtractedNames = { people: string[]; orgs: string[] };

export type MatchOutcome =
  | { kind: "no_pre_filter_hits" } // no LLM call → no extraction
  | { kind: "matched"; matches: BillMatch[]; extracted: ExtractedNames }
  | { kind: "no_match"; extracted: ExtractedNames }
  | { kind: "api_error"; reason: string };

// Coerce a parsed JSON value to a clean string[] of trimmed, non-empty,
// de-duplicated names (defensive against the model returning junk shapes).
function toNameArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const v of value) {
    if (typeof v !== "string") continue;
    const s = v.trim();
    if (!s || s.length > 120) continue; // guard against pathological output
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

export async function matchBillsToArticle(
  client: GoogleGenAI,
  articleTitle: string,
  articleSummary: string | null,
  candidates: CandidateBill[],
  signal?: AbortSignal,
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
        // HO 117: per-article 8s timeout from the caller. SDK doc notes the
        // abort is client-side only — it won't stop server-side billing —
        // but for us the value is bounding wall-clock so a hung call can't
        // burn the cron tick. The caller checks `signal.aborted` after to
        // distinguish a timeout from a real api_error.
        abortSignal: signal,
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
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "api_error", reason: "response is not a JSON object" };
  }
  const obj = parsed as Record<string, unknown>;
  // A missing `matches` key is treated as an empty match set (→ no_match), NOT
  // an api_error — so the extraction still lands. news_mentions behavior is
  // unchanged either way (both write zero bill rows).
  const rawMatches = Array.isArray(obj.matches) ? obj.matches : [];
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

  // HO 394: raw people/org name mentions — resolved downstream, kept even when
  // unresolvable (auditable). Bill matches keep their exact prior semantics.
  const extracted: ExtractedNames = {
    people: toNameArray(obj.people),
    orgs: toNameArray(obj.orgs),
  };
  return matches.length > 0
    ? { kind: "matched", matches, extracted }
    : { kind: "no_match", extracted };
}
