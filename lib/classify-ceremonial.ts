import { GoogleGenAI } from "@google/genai";

export const CLASSIFIER_MODEL = "gemini-2.5-flash";

const SYSTEM_PROMPT = `You are classifying US Congress bills as ceremonial or substantive.

CEREMONIAL: primary purpose is symbolic. Examples:
- Awareness days/weeks/months ("designating X as National Y Day")
- Renaming federal buildings, post offices, highways, military installations
- Recognizing achievements, anniversaries, or individuals
- Congratulatory or memorial resolutions
- Expressing the sense of Congress with no legal effect

SUBSTANTIVE: changes law, appropriates funds, creates or modifies programs,
alters rights, sets policy, or directs an agency — even narrowly scoped.

Respond with JSON only: {"is_ceremonial": true|false}`;

export type ClassifyInput = {
  id: string;
  title: string;
  latest_action_text: string | null;
};

export type ClassifyResult = { is_ceremonial: boolean };

function parseResponse(text: string): ClassifyResult | null {
  const m = text.match(/\{[\s\S]*?\}/);
  if (!m) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const obj = parsed as { is_ceremonial?: unknown };
  if (typeof obj.is_ceremonial !== "boolean") return null;
  return { is_ceremonial: obj.is_ceremonial };
}

export async function classifyCeremonial(
  client: GoogleGenAI,
  input: ClassifyInput,
): Promise<ClassifyResult | null> {
  const userPrompt = `Bill: ${input.title}
Latest action: ${input.latest_action_text ?? "(none)"}`;

  const response = await client.models.generateContent({
    model: CLASSIFIER_MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = response.text;
  if (!text) return null;
  return parseResponse(text);
}
