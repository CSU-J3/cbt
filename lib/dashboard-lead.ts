import { GoogleGenAI } from "@google/genai";
import { getDb } from "./db";
import { SUMMARY_MODEL } from "./summarize";

const LEAD_KEY = "weekly_lead";
const LEAD_DAYS = 7;
const TITLE_TRUNCATE = 60;

// Non-ceremonial gate, same convention as buildFeedWhere. NULL = visible.
const NON_CEREMONIAL = "(is_ceremonial = 0 OR is_ceremonial IS NULL)";

const STAGE_ABBR: Record<string, string> = {
  introduced: "INTRO",
  committee: "COMMITTEE",
  floor: "FLOOR",
  other_chamber: "OTHER CHAMBER",
  president: "PRESIDENT",
  enacted: "ENACTED",
};

const SYSTEM_PROMPT = `You are writing the daily lead for a Congress tracking dashboard. Write exactly 3 sentences, max 60 words total, describing what's happening in Congress right now based on the data below. Reference at least 2 specific bill IDs (e.g. "HR 2702"). Use exact numbers from the data. Avoid generic openers ("This week, Congress..."), avoid editorial framing, avoid marketing titles for bills. Plain numbers, plain language, terminal voice.`;

type Transition = { id: string; title: string; transition: string };

type LeadData = {
  total: number;
  transitionsCount: number;
  topTransitions: Transition[];
  enactmentsCount: number;
  topEnactments: string[];
  introductionsCount: number;
  topTopic: { topic: string; count: number } | null;
};

function formatBillId(billType: string, billNumber: number): string {
  return `${billType.toUpperCase()} ${billNumber}`;
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function stageLabel(stage: string | null): string {
  if (!stage) return "?";
  return STAGE_ABBR[stage] ?? stage.toUpperCase();
}

async function gatherLeadData(): Promise<LeadData> {
  const db = getDb();

  const totalRs = await db.execute(
    `SELECT COUNT(*) AS n FROM bills WHERE ${NON_CEREMONIAL}`,
  );

  const transRs = await db.execute(
    `SELECT id, bill_type, bill_number, title, stage, previous_stage
     FROM bills
     WHERE ${NON_CEREMONIAL}
       AND stage_changed_at IS NOT NULL
       AND stage_changed_at > datetime('now', '-${LEAD_DAYS} days')
     ORDER BY stage_changed_at DESC`,
  );
  const topTransitions: Transition[] = transRs.rows.slice(0, 5).map((r) => ({
    id: formatBillId(r.bill_type as string, r.bill_number as number),
    title: truncate(r.title as string, TITLE_TRUNCATE),
    transition: `${stageLabel(r.previous_stage as string | null)} → ${stageLabel(
      r.stage as string | null,
    )}`,
  }));

  const enactRs = await db.execute(
    `SELECT id, bill_type, bill_number FROM bills
     WHERE ${NON_CEREMONIAL}
       AND stage = 'enacted'
       AND stage_changed_at IS NOT NULL
       AND stage_changed_at > datetime('now', '-${LEAD_DAYS} days')
     ORDER BY stage_changed_at DESC`,
  );
  const topEnactments = enactRs.rows
    .slice(0, 3)
    .map((r) => formatBillId(r.bill_type as string, r.bill_number as number));

  const introRs = await db.execute(
    `SELECT COUNT(*) AS n FROM bills
     WHERE ${NON_CEREMONIAL}
       AND introduced_date >= date('now', '-${LEAD_DAYS} days')`,
  );

  const topicRs = await db.execute(
    `SELECT je.value AS topic, COUNT(*) AS n
     FROM bills, json_each(bills.topics) je
     WHERE (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL)
       AND bills.topics IS NOT NULL
       AND bills.stage_changed_at IS NOT NULL
       AND bills.stage_changed_at > datetime('now', '-${LEAD_DAYS} days')
     GROUP BY je.value
     ORDER BY n DESC
     LIMIT 1`,
  );
  const topicRow = topicRs.rows[0];

  return {
    total: Number(totalRs.rows[0]?.n ?? 0),
    transitionsCount: transRs.rows.length,
    topTransitions,
    enactmentsCount: enactRs.rows.length,
    topEnactments,
    introductionsCount: Number(introRs.rows[0]?.n ?? 0),
    topTopic: topicRow
      ? { topic: topicRow.topic as string, count: Number(topicRow.n ?? 0) }
      : null,
  };
}

function buildUserPrompt(d: LeadData): string {
  const transitionLines =
    d.topTransitions.length > 0
      ? d.topTransitions
          .map((t) => `  - ${t.id}: ${t.title} (${t.transition})`)
          .join("\n")
      : "  - (none)";
  const enactments =
    d.topEnactments.length > 0 ? d.topEnactments.join(", ") : "(none)";
  const topTopic = d.topTopic
    ? `${d.topTopic.topic} (${d.topTopic.count} transitions)`
    : "(none)";

  return `DATA:
- Corpus size: ${d.total} non-ceremonial bills tracked
- Stage transitions (last 7d): ${d.transitionsCount} total
- Top 5 recent transitions:
${transitionLines}
- Enactments (last 7d): ${d.enactmentsCount} bills, including ${enactments}
- New introductions (last 7d): ${d.introductionsCount} bills
- Topic with most activity: ${topTopic}

Write the lead:`;
}

// Gathers recent-activity data, prompts Gemini, returns the 3-sentence lead.
// Throws on missing key or empty response — callers (cron) treat failure as
// non-fatal and keep the prior lead in the DB.
export async function generateDashboardLead(): Promise<string> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error("GEMINI_API_KEY is not set");

  const data = await gatherLeadData();
  const client = new GoogleGenAI({ apiKey: geminiKey });

  const response = await client.models.generateContent({
    model: SUMMARY_MODEL,
    contents: buildUserPrompt(data),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = response.text?.trim();
  if (!text) throw new Error("Gemini returned an empty lead");
  return text;
}

// Upserts the lead under key = 'weekly_lead'. Timestamp is JS-side ISO to
// match the rest of the codebase (summary_updated_at, watchlist.added_at).
export async function writeDashboardLead(text: string): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO dashboard_state (key, value, updated_at)
          VALUES (?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = excluded.value,
            updated_at = excluded.updated_at`,
    args: [LEAD_KEY, text, new Date().toISOString()],
  });
}
