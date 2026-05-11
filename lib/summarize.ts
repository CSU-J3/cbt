import { GoogleGenAI } from "@google/genai";
import {
  ALLOWED_STAGES,
  ALLOWED_STAGES_SET,
  ALLOWED_TOPICS,
  ALLOWED_TOPICS_SET,
} from "./enums";

export { ALLOWED_STAGES, ALLOWED_TOPICS };

export const SUMMARY_MODEL = "gemini-2.5-flash";

const TEXT_LIMIT = 8000;

const SYSTEM_PROMPT = `You are summarizing a US Congress bill for a personal tracking dashboard. Write a 2-3 sentence summary in plain English that explains what the bill would actually change if enacted. Avoid legalese, avoid the bill's marketing title, avoid editorial language. State who is affected and how.

Then output a JSON block with:
- topics: array of 1-3 topic tags from this list: [${ALLOWED_TOPICS.join(", ")}]
- stage: one of [introduced, committee, floor, other_chamber, president, enacted]

Determine \`stage\` from the latest_action_text. The action text is ground truth; do NOT infer stage from the bill's content or title. Apply these rules in order and stop at the first match:

1. action text contains "Became Public Law" or "Signed by President" → enacted
2. action text contains "Presented to President" or "to the President" → president
3. action text contains BOTH "Passed Senate" AND "Passed House" → other_chamber
4. action text contains "Passed Senate" or "Passed House" (only one) → floor
5. action text contains "Reported", "Ordered Reported", or "Committee Consideration" → committee
6. action text contains "Referred to" with no further action mentioned → committee
7. otherwise → introduced

The bill's content is written as a proposal even after it becomes law — never let that mislead you. If the action text says it became public law, the stage is enacted regardless of how the bill text reads.

Respond in this exact format:

SUMMARY:
<2-3 sentences>

JSON:
{"topics": [...], "stage": "..."}`;

export type BillRow = {
  id: string;
  congress: number;
  bill_type: string;
  bill_number: number;
  title: string;
  latest_action_text: string | null;
};

export type SummarizeResult = {
  summary: string;
  topics: string[];
  stage: string;
};

export type BillContext = {
  billText: string;
  crsSummary: string;
};

function stripHtml(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, { headers: { Accept: "text/html,*/*" } });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.text();
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return (await res.json()) as T;
}

type TextVersion = {
  type?: string;
  date?: string;
  formats?: Array<{ type?: string; url?: string }>;
};
type TextResp = { textVersions?: TextVersion[] };
type SummariesResp = {
  summaries?: Array<{ actionDate?: string; text?: string }>;
};

export async function fetchBillContext(
  bill: BillRow,
  apiKey: string,
): Promise<BillContext> {
  const base = `https://api.congress.gov/v3/bill/${bill.congress}/${bill.bill_type}/${bill.bill_number}`;
  const auth = `format=json&api_key=${encodeURIComponent(apiKey)}`;

  let billText = "";
  try {
    const tr = await fetchJson<TextResp>(`${base}/text?${auth}`);
    const versions = (tr.textVersions ?? []).slice().sort((a, b) =>
      (b.date ?? "").localeCompare(a.date ?? ""),
    );
    const latest = versions[0];
    const formatted = latest?.formats?.find((f) => f.type === "Formatted Text");
    if (formatted?.url) {
      const html = await fetchText(formatted.url);
      billText = stripHtml(html).slice(0, TEXT_LIMIT);
    }
  } catch {
    // bills without text yet are still summarizable from title + CRS
  }

  let crsSummary = "";
  try {
    const sr = await fetchJson<SummariesResp>(`${base}/summaries?${auth}`);
    const list = (sr.summaries ?? []).slice().sort((a, b) =>
      (b.actionDate ?? "").localeCompare(a.actionDate ?? ""),
    );
    const latest = list[0];
    if (latest?.text) crsSummary = stripHtml(latest.text);
  } catch {
    // CRS summaries are optional
  }

  return { billText, crsSummary };
}

function parseResponse(text: string): SummarizeResult | null {
  const idx = text.indexOf("JSON:");
  if (idx < 0) return null;

  const summaryPart = text.slice(0, idx);
  const summaryMatch = summaryPart.match(/SUMMARY:\s*([\s\S]*)/i);
  const summary = (summaryMatch?.[1] ?? "").trim();
  if (!summary) return null;

  const jsonPart = text.slice(idx + "JSON:".length);
  const jsonMatch = jsonPart.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonMatch[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as { topics?: unknown; stage?: unknown };
  const topics = Array.isArray(obj.topics)
    ? obj.topics.filter((t): t is string => typeof t === "string")
    : null;
  const stage = typeof obj.stage === "string" ? obj.stage : null;
  if (!topics || topics.length === 0 || !stage) return null;

  return { summary, topics, stage };
}

export type SummarizeOutput = {
  result: SummarizeResult | null;
  promptTokens: number;
  outputTokens: number;
};

export async function summarizeBill(
  client: GoogleGenAI,
  bill: BillRow,
  context: BillContext,
): Promise<SummarizeOutput> {
  const userPrompt = `Bill title: ${bill.title}
Latest action: ${bill.latest_action_text ?? "(none)"}
CRS summary (if any): ${context.crsSummary || "(none)"}
Bill text (truncated): ${context.billText || "(text not yet available)"}`;

  const response = await client.models.generateContent({
    model: SUMMARY_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const promptTokens = response.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;

  const text = response.text;
  if (!text) return { result: null, promptTokens, outputTokens };
  const parsed = parseResponse(text);
  if (!parsed) return { result: null, promptTokens, outputTokens };

  const valid: string[] = [];
  const invalid: string[] = [];
  for (const t of parsed.topics) {
    if (ALLOWED_TOPICS_SET.has(t)) valid.push(t);
    else invalid.push(t);
  }
  if (invalid.length > 0) {
    console.warn(`invalid-topic ${bill.id}: dropped ${invalid.join(",")}`);
  }
  const topics = valid.length > 0 ? valid : ["other"];

  let stage = parsed.stage;
  if (!ALLOWED_STAGES_SET.has(stage)) {
    console.warn(`invalid-stage ${bill.id}: dropped ${stage}`);
    stage = "introduced";
  }

  return {
    result: { summary: parsed.summary, topics, stage },
    promptTokens,
    outputTokens,
  };
}
