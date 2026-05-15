import { GoogleGenAI } from "@google/genai";
import { getDb } from "./db";
import { ALLOWED_TOPICS_SET } from "./enums";
import { formatBillId } from "./format";
import { SUMMARY_MODEL } from "./summarize";

// Non-ceremonial gate, same convention as buildFeedWhere. NULL = visible.
const NON_CEREMONIAL = "(is_ceremonial = 0 OR is_ceremonial IS NULL)";

const TITLE_TRUNCATE = 80;
const STAGE_MOVEMENT_LIMIT = 10;
const DEAD_TOPIC_LIMIT = 10;
const DEAD_BILLS_PER_TOPIC = 3;
const DEAD_STALE_DAYS = 30;
const NOTABLE_LIMIT = 5;

export type WeekRange = {
  start: string; // ISO date, Monday
  end: string; // ISO date, Sunday
};

// ---- date helpers ------------------------------------------------------

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

// Returns the Mon-Sun calendar week immediately before the week containing
// `date`. The cron runs on Monday, so getPriorWeek(thatMonday) yields the
// week that just ended. All math in UTC to match the 09:00 UTC cron tick.
export function getPriorWeek(date: Date = new Date()): WeekRange {
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // getUTCDay: 0=Sun..6=Sat. Days back to this week's Monday.
  const daysFromMonday = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - daysFromMonday - 7);
  const start = isoDate(d);
  return { start, end: addDays(start, 6) };
}

const titleFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "long",
  day: "numeric",
  year: "numeric",
});

// "May 11, 2026" — used as `Week of ${formatWeekTitle(weekStart)}`.
export function formatWeekTitle(weekStart: string): string {
  return titleFormatter.format(new Date(`${weekStart}T00:00:00Z`));
}

// ---- text helpers ------------------------------------------------------

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const STAGE_PREFIX: Record<string, string> = {
  introduced: "▸",
  committee: "▸",
  floor: "▸▸",
  other_chamber: "▸▸▸",
  president: "▸▸▸▸",
  enacted: "✓",
};

const STAGE_LABEL: Record<string, string> = {
  introduced: "INTRO",
  committee: "COMMITTEE",
  floor: "FLOOR",
  other_chamber: "OTHER CHAMBER",
  president: "PRESIDENT",
  enacted: "ENACTED",
};

function stageGlyph(stage: string | null): string {
  if (!stage) return "?";
  const prefix = STAGE_PREFIX[stage] ?? "▸";
  const label = STAGE_LABEL[stage] ?? stage.toUpperCase();
  return `${prefix} ${label}`;
}

function topicLabel(topic: string): string {
  const spaced = topic.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function sponsorSuffix(
  name: string | null,
  party: string | null,
  state: string | null,
): string {
  if (!name) return "";
  const partyState = party && state ? `, ${party}-${state}` : "";
  return ` (${name}${partyState})`;
}

// ---- data gathering ----------------------------------------------------

type StageMovement = {
  billId: string;
  title: string;
  prevStage: string | null;
  newStage: string | null;
  sponsorName: string | null;
  sponsorParty: string | null;
  sponsorState: string | null;
};

type Enactment = { billId: string; title: string };

type DeadTopic = { topic: string; count: number; billIds: string[] };

type NotableIntro = {
  billId: string;
  title: string;
  sponsorName: string | null;
  sponsorParty: string | null;
  sponsorState: string | null;
};

type TopicMovement = { topic: string; count: number };

type ReportData = {
  transitionsCount: number;
  stageMovements: StageMovement[];
  enactmentsCount: number;
  enactments: Enactment[];
  introductionsCount: number;
  deadByTopic: DeadTopic[];
  notableIntros: NotableIntro[];
  topicMovements: TopicMovement[];
};

async function gatherReportData(week: WeekRange): Promise<ReportData> {
  const db = getDb();

  // 1. Stage transitions within the week.
  const transRs = await db.execute({
    sql: `SELECT id, bill_type, bill_number, title, previous_stage, stage,
            sponsor_name, sponsor_party, sponsor_state
          FROM bills
          WHERE stage_changed_at IS NOT NULL
            AND date(stage_changed_at) BETWEEN ? AND ?
            AND ${NON_CEREMONIAL}
          ORDER BY stage_changed_at DESC`,
    args: [week.start, week.end],
  });
  const stageMovements: StageMovement[] = transRs.rows
    .slice(0, STAGE_MOVEMENT_LIMIT)
    .map((r) => ({
      billId: formatBillId(r.bill_type as string, r.bill_number as number),
      title: r.title as string,
      prevStage: (r.previous_stage as string | null) ?? null,
      newStage: (r.stage as string | null) ?? null,
      sponsorName: (r.sponsor_name as string | null) ?? null,
      sponsorParty: (r.sponsor_party as string | null) ?? null,
      sponsorState: (r.sponsor_state as string | null) ?? null,
    }));

  // 2. Enactments within the week — full list, no limit.
  const enactRs = await db.execute({
    sql: `SELECT bill_type, bill_number, title
          FROM bills
          WHERE stage = 'enacted'
            AND latest_action_date BETWEEN ? AND ?
          ORDER BY latest_action_date DESC`,
    args: [week.start, week.end],
  });
  const enactments: Enactment[] = enactRs.rows.map((r) => ({
    billId: formatBillId(r.bill_type as string, r.bill_number as number),
    title: r.title as string,
  }));

  // 3. New introductions count.
  const introRs = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM bills
          WHERE introduced_date BETWEEN ? AND ?
            AND ${NON_CEREMONIAL}`,
    args: [week.start, week.end],
  });

  // 4. Dead in committee — no action in 30+ days as of week end, by topic.
  // json_each UNNESTs the topics array, same pattern as getTopicDistribution.
  const deadRs = await db.execute({
    sql: `SELECT je.value AS topic, b.bill_type, b.bill_number
          FROM bills b, json_each(b.topics) je
          WHERE b.topics IS NOT NULL
            AND ${NON_CEREMONIAL.replace(/is_ceremonial/g, "b.is_ceremonial")}
            AND b.stage IN ('introduced', 'committee')
            AND b.latest_action_date IS NOT NULL
            AND b.latest_action_date < date(?, '-${DEAD_STALE_DAYS} days')
          ORDER BY b.latest_action_date ASC`,
    args: [week.end],
  });
  const deadMap = new Map<string, string[]>();
  for (const r of deadRs.rows) {
    const topic = r.topic as string;
    if (!ALLOWED_TOPICS_SET.has(topic)) continue;
    const billId = formatBillId(
      r.bill_type as string,
      r.bill_number as number,
    );
    const list = deadMap.get(topic) ?? [];
    list.push(billId);
    deadMap.set(topic, list);
  }
  const deadByTopic: DeadTopic[] = [...deadMap.entries()]
    .map(([topic, billIds]) => ({
      topic,
      count: billIds.length,
      billIds: billIds.slice(0, DEAD_BILLS_PER_TOPIC),
    }))
    .sort((a, b) => b.count - a.count || a.topic.localeCompare(b.topic))
    .slice(0, DEAD_TOPIC_LIMIT);

  // 5. Notable introductions — top substantive intros by summary length.
  // Summary length is a weak substantiveness proxy until text_length lands.
  const notableRs = await db.execute({
    sql: `SELECT bill_type, bill_number, title,
            sponsor_name, sponsor_party, sponsor_state
          FROM bills
          WHERE introduced_date BETWEEN ? AND ?
            AND ${NON_CEREMONIAL}
            AND (cluster_id IS NULL OR cluster_id = 'cra-disapproval')
            AND summary IS NOT NULL
          ORDER BY LENGTH(summary) DESC
          LIMIT ?`,
    args: [week.start, week.end, NOTABLE_LIMIT],
  });
  const notableIntros: NotableIntro[] = notableRs.rows.map((r) => ({
    billId: formatBillId(r.bill_type as string, r.bill_number as number),
    title: r.title as string,
    sponsorName: (r.sponsor_name as string | null) ?? null,
    sponsorParty: (r.sponsor_party as string | null) ?? null,
    sponsorState: (r.sponsor_state as string | null) ?? null,
  }));

  // 6. Topic breakdown — stage transitions per topic for the week.
  const topicRs = await db.execute({
    sql: `SELECT je.value AS topic, COUNT(*) AS n
          FROM bills b, json_each(b.topics) je
          WHERE b.topics IS NOT NULL
            AND ${NON_CEREMONIAL.replace(/is_ceremonial/g, "b.is_ceremonial")}
            AND b.stage_changed_at IS NOT NULL
            AND date(b.stage_changed_at) BETWEEN ? AND ?
          GROUP BY je.value
          ORDER BY n DESC`,
    args: [week.start, week.end],
  });
  const topicMovements: TopicMovement[] = [];
  for (const r of topicRs.rows) {
    const topic = r.topic as string;
    if (!ALLOWED_TOPICS_SET.has(topic)) continue;
    topicMovements.push({ topic, count: Number(r.n ?? 0) });
  }

  return {
    transitionsCount: transRs.rows.length,
    stageMovements,
    enactmentsCount: enactments.length,
    enactments,
    introductionsCount: Number(introRs.rows[0]?.n ?? 0),
    deadByTopic,
    notableIntros,
    topicMovements,
  };
}

// ---- LLM prompt --------------------------------------------------------

const SYSTEM_PROMPT = `You are writing the weekly Congress report for a personal tracking dashboard.

Generate prose for the following sections based on the data provided. Each section's prose must reference specific bill IDs (e.g. "HR 2702") and use exact numbers from the data. Avoid generic openers ("This week, Congress..."), avoid marketing titles for bills, avoid editorial framing. Plain numbers, plain language, terminal voice.

Output in this exact format:

LEAD:
<2-3 sentences, max 60 words>

STAGE_COMMENTARY:
<2-3 sentences about the stage movements>

ENACTMENTS_COMMENTARY:
<1-2 sentences about the enactments; output exactly "_No bills became law this week._" if the enactments count is zero>

TOPIC_COMMENTARY:
<1-2 sentences about the topic breakdown>`;

function buildUserPrompt(week: WeekRange, d: ReportData): string {
  const transitionLines =
    d.stageMovements.length > 0
      ? d.stageMovements
          .slice(0, 5)
          .map(
            (t) =>
              `  - ${t.billId}: ${truncate(t.title, 70)} (${stageGlyph(
                t.prevStage,
              )} → ${stageGlyph(t.newStage)})`,
          )
          .join("\n")
      : "  - (none)";
  const enactmentIds =
    d.enactments.length > 0
      ? d.enactments
          .slice(0, 3)
          .map((e) => e.billId)
          .join(", ")
      : "(none)";
  const topTopic = d.topicMovements[0]
    ? `${d.topicMovements[0].topic} (${d.topicMovements[0].count} transitions)`
    : "(none)";

  return `WEEK DATA (${week.start} to ${week.end}):
- Total stage transitions: ${d.transitionsCount}
- Top 5 transitions:
${transitionLines}
- Enactments: ${d.enactmentsCount} bills, including ${enactmentIds}
- New introductions: ${d.introductionsCount}
- Top topic by activity: ${topTopic}

Write the report sections:`;
}

type ReportCommentary = {
  lead: string;
  stageCommentary: string;
  enactmentsCommentary: string;
  topicCommentary: string;
};

const REPORT_MARKERS = [
  "LEAD",
  "STAGE_COMMENTARY",
  "ENACTMENTS_COMMENTARY",
  "TOPIC_COMMENTARY",
] as const;

function parseReportResponse(text: string): ReportCommentary | null {
  const values: Partial<Record<(typeof REPORT_MARKERS)[number], string>> = {};
  for (const [i, marker] of REPORT_MARKERS.entries()) {
    const startMatch = new RegExp(`${marker}:\\s*`, "i").exec(text);
    if (!startMatch) return null;
    const from = startMatch.index + startMatch[0].length;
    let to = text.length;
    const next = REPORT_MARKERS[i + 1];
    if (next) {
      const nextMatch = new RegExp(`${next}:`, "i").exec(text.slice(from));
      if (nextMatch) to = from + nextMatch.index;
    }
    const value = text.slice(from, to).trim();
    if (!value) return null;
    values[marker] = value;
  }
  const { LEAD, STAGE_COMMENTARY, ENACTMENTS_COMMENTARY, TOPIC_COMMENTARY } =
    values;
  if (!LEAD || !STAGE_COMMENTARY || !ENACTMENTS_COMMENTARY || !TOPIC_COMMENTARY)
    return null;
  return {
    lead: LEAD,
    stageCommentary: STAGE_COMMENTARY,
    enactmentsCommentary: ENACTMENTS_COMMENTARY,
    topicCommentary: TOPIC_COMMENTARY,
  };
}

// ---- markdown assembly -------------------------------------------------

function assembleMarkdown(
  title: string,
  d: ReportData,
  c: ReportCommentary,
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`, "");
  lines.push(c.lead, "");

  // Stage movements
  lines.push(`## Stage movements (${d.transitionsCount})`, "");
  lines.push(c.stageCommentary, "");
  if (d.stageMovements.length > 0) {
    for (const m of d.stageMovements) {
      lines.push(
        `- ${m.billId} — ${stageGlyph(m.prevStage)} → ${stageGlyph(
          m.newStage,
        )}${sponsorSuffix(m.sponsorName, m.sponsorParty, m.sponsorState)}`,
      );
    }
    lines.push("");
  } else {
    lines.push("_No stage movements this week._", "");
  }

  // Enactments — when count is zero the commentary IS the placeholder line.
  lines.push(`## Enactments (${d.enactmentsCount})`, "");
  lines.push(c.enactmentsCommentary, "");
  if (d.enactments.length > 0) {
    for (const e of d.enactments) {
      lines.push(`- ${e.billId} — ${truncate(e.title, TITLE_TRUNCATE)}`);
    }
    lines.push("");
  }

  // Dead in committee
  lines.push("## Dead in committee", "");
  lines.push(
    "Bills with no action in 30+ days as of week end, grouped by topic.",
    "",
  );
  if (d.deadByTopic.length > 0) {
    for (const t of d.deadByTopic) {
      lines.push(
        `- **${topicLabel(t.topic)}** (${t.count}): ${t.billIds.join(", ")}`,
      );
    }
    lines.push("");
  } else {
    lines.push("_No bills stalled in committee as of week end._", "");
  }

  // Notable introductions
  lines.push("## Notable introductions", "");
  lines.push("Top 5 substantive bills introduced this week.", "");
  if (d.notableIntros.length > 0) {
    for (const n of d.notableIntros) {
      const sponsor = n.sponsorName ? ` — ${n.sponsorName}` : "";
      lines.push(
        `- ${n.billId} — ${truncate(n.title, TITLE_TRUNCATE)}${sponsor}`,
      );
    }
    lines.push("");
  } else {
    lines.push("_No substantive bills introduced this week._", "");
  }

  // Topic breakdown
  lines.push("## Topic breakdown", "");
  lines.push(c.topicCommentary, "");
  if (d.topicMovements.length > 0) {
    lines.push("| Topic | Movement |", "|---|---|");
    for (const t of d.topicMovements) {
      lines.push(`| ${topicLabel(t.topic)} | ${t.count} |`);
    }
    lines.push("");
  } else {
    lines.push("_No topic activity this week._", "");
  }

  // Most talked about — stub until theme 4 ships.
  lines.push("## Most talked about", "");
  lines.push("_News mentions coming when theme 4 ships._", "");

  return lines.join("\n");
}

// ---- public API --------------------------------------------------------

// Gathers the week's data, prompts Gemini for section prose, assembles the
// Markdown body. Throws on missing key, empty response, or parse failure —
// callers (cron) treat failure as non-fatal and write no row.
export async function generateWeeklyReport(week: WeekRange): Promise<{
  slug: string;
  title: string;
  content_md: string;
}> {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) throw new Error("GEMINI_API_KEY is not set");

  const data = await gatherReportData(week);
  const client = new GoogleGenAI({ apiKey: geminiKey });

  const response = await client.models.generateContent({
    model: SUMMARY_MODEL,
    contents: buildUserPrompt(week, data),
    config: {
      systemInstruction: SYSTEM_PROMPT,
      thinkingConfig: { thinkingBudget: 0 },
    },
  });

  const text = response.text?.trim();
  if (!text) throw new Error("Gemini returned an empty report");

  const commentary = parseReportResponse(text);
  if (!commentary) {
    throw new Error(
      `Failed to parse report response (missing section markers):\n${text}`,
    );
  }

  const title = `Week of ${formatWeekTitle(week.start)}`;
  return {
    slug: week.start,
    title,
    content_md: assembleMarkdown(title, data, commentary),
  };
}

// Upserts the report keyed by slug (the ISO week-start date). Re-running the
// CLI for the same week overwrites rather than erroring. created_at is
// JS-side ISO, matching the rest of the codebase.
export async function writeReport(report: {
  slug: string;
  weekStart: string;
  weekEnd: string;
  title: string;
  contentMd: string;
}): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO reports (slug, week_start, week_end, title, content_md, created_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(slug) DO UPDATE SET
            week_start = excluded.week_start,
            week_end = excluded.week_end,
            title = excluded.title,
            content_md = excluded.content_md,
            created_at = excluded.created_at`,
    args: [
      report.slug,
      report.weekStart,
      report.weekEnd,
      report.title,
      report.contentMd,
      new Date().toISOString(),
    ],
  });
}
