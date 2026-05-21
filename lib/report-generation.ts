import { GoogleGenAI } from "@google/genai";
import { getDb } from "./db";
import { ALLOWED_TOPICS_SET } from "./enums";
import { formatBillId } from "./format";
import { SUMMARY_MODEL } from "./summarize";

// Non-ceremonial gate, same convention as buildFeedWhere. NULL = visible.
const NON_CEREMONIAL = "(is_ceremonial = 0 OR is_ceremonial IS NULL)";

const TITLE_TRUNCATE = 80;
const STAGE_MOVEMENT_LIMIT = 10;
// HO 110: "Newly stalled" trimmed from a 10-topic ID-wall to the top 3 topics
// by stall volume, max 3 bill IDs each (<=9 IDs total). Stalls earn a place
// in the report but not the bulk they had.
const DEAD_TOPIC_LIMIT = 3;
const DEAD_BILLS_PER_TOPIC = 3;
// Matches /stale page threshold — consistency matters more than count optics.
const DEAD_STALE_DAYS = 60;
const NOTABLE_LIMIT = 5;
const TOPIC_BREAKDOWN_LIMIT = 7;
const MOST_TALKED_LIMIT = 5;

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

// Cuts at the last whitespace before character n so titles don't end mid-word
// ("…Committee on Foreign Investment in t…"). Falls back to hard truncation
// when no whitespace exists in the first n characters (pathological titles).
function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  const slice = s.slice(0, n);
  const lastSpace = slice.lastIndexOf(" ");
  if (lastSpace > 0) return `${slice.slice(0, lastSpace)}…`;
  return `${s.slice(0, n - 1)}…`;
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

type TopicIntroduction = { topic: string; count: number };

type MostTalkedAbout = {
  billId: string;
  title: string;
  sponsorName: string | null;
  mentionCount: number;
};

type ReportData = {
  transitionsCount: number;
  stageMovements: StageMovement[];
  // Earliest date(stage_changed_at) in the corpus, or null if nothing has
  // ever been tracked. stage_changed_at is never backfilled, so a report
  // whose week ends before this date legitimately predates tracking — the
  // zero-movements copy says so rather than implying Congress was idle.
  stageTrackingStart: string | null;
  enactmentsCount: number;
  enactments: Enactment[];
  introductionsCount: number;
  deadByTopic: DeadTopic[];
  // Distinct bills that crossed the staleness threshold this week (deadByTopic
  // fans one bill across every topic it carries, so its counts over-count).
  deadBillCount: number;
  notableIntros: NotableIntro[];
  topicIntroductions: TopicIntroduction[];
  mostTalkedAbout: MostTalkedAbout[];
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

  // 1b. Earliest tracked stage transition in the corpus. Lets assembleMarkdown
  // tell "this week predates stage tracking" apart from "this week was quiet".
  const trackRs = await db.execute(
    `SELECT MIN(date(stage_changed_at)) AS first
     FROM bills WHERE stage_changed_at IS NOT NULL`,
  );
  const stageTrackingStart =
    (trackRs.rows[0]?.first as string | null) ?? null;

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

  // 4. Dead in committee — bills whose staleness threshold was crossed
  // *during* this week, by topic. Sliding window on latest_action_date,
  // shifted back by DEAD_STALE_DAYS: at week start the bill was still in
  // the recent-action window; at week end it has crossed the threshold.
  // Restricted to introduced/committee — floor/other_chamber stalls are
  // whip-count problems, a different phenomenon. json_each UNNESTs the
  // topics array, same pattern as getTopicDistribution.
  const deadRs = await db.execute({
    sql: `SELECT je.value AS topic, b.bill_type, b.bill_number
          FROM bills b, json_each(b.topics) je
          WHERE b.topics IS NOT NULL
            AND ${NON_CEREMONIAL.replace(/is_ceremonial/g, "b.is_ceremonial")}
            AND b.stage IN ('introduced', 'committee')
            AND b.latest_action_date IS NOT NULL
            AND b.latest_action_date > date(?, '-${DEAD_STALE_DAYS} days')
            AND b.latest_action_date <= date(?, '-${DEAD_STALE_DAYS} days')
          ORDER BY b.latest_action_date ASC`,
    args: [week.start, week.end],
  });
  const deadMap = new Map<string, string[]>();
  const deadBills = new Set<string>();
  for (const r of deadRs.rows) {
    const topic = r.topic as string;
    if (!ALLOWED_TOPICS_SET.has(topic)) continue;
    const billId = formatBillId(
      r.bill_type as string,
      r.bill_number as number,
    );
    deadBills.add(billId);
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

  // 5. Notable introductions — top substantive intros by cosponsor support,
  // tiebroken by raw text length (handoff 59). text_length filter excludes
  // short resolutions and one-pagers that slip past the ceremonial+cluster
  // gates; NULL is kept so the filter doesn't go empty during backfill.
  // Cosponsor NULLs sort last; they should be rare once the backfill runs.
  const notableRs = await db.execute({
    sql: `SELECT bill_type, bill_number, title,
            sponsor_name, sponsor_party, sponsor_state,
            cosponsor_count, text_length
          FROM bills
          WHERE introduced_date BETWEEN ? AND ?
            AND ${NON_CEREMONIAL}
            AND (cluster_id IS NULL OR cluster_id = 'cra-disapproval')
            AND summary IS NOT NULL
            AND (text_length IS NULL OR text_length > 5000)
          ORDER BY cosponsor_count DESC NULLS LAST,
                   COALESCE(text_length, 0) DESC,
                   id DESC
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

  // 6. Topic breakdown — what got introduced this week, by topic. Aggregates
  // the topics JSON for bills whose introduced_date falls in the week.
  // (Previously used stage_changed_at, which returned empty when bug 1's
  // first-time-enactment case bypassed the transition write.)
  const topicRs = await db.execute({
    sql: `SELECT je.value AS topic, COUNT(*) AS n
          FROM bills b, json_each(b.topics) je
          WHERE b.topics IS NOT NULL
            AND ${NON_CEREMONIAL.replace(/is_ceremonial/g, "b.is_ceremonial")}
            AND b.introduced_date BETWEEN ? AND ?
          GROUP BY je.value
          ORDER BY n DESC`,
    args: [week.start, week.end],
  });
  const topicIntroductions: TopicIntroduction[] = [];
  for (const r of topicRs.rows) {
    const topic = r.topic as string;
    if (!ALLOWED_TOPICS_SET.has(topic)) continue;
    topicIntroductions.push({ topic, count: Number(r.n ?? 0) });
    if (topicIntroductions.length >= TOPIC_BREAKDOWN_LIMIT) break;
  }

  // 7. Most talked about — top bills by news_mentions row count within the
  // report week. Idempotent and cheap; news_mentions has UNIQUE(bill_id,
  // article_url) so the count reflects distinct articles, not duplicates.
  // Empty result is the common case while the regex matcher is undertuned;
  // the section renders a clean fallback in that case.
  const newsRs = await db.execute({
    sql: `SELECT b.bill_type, b.bill_number, b.title, b.sponsor_name,
                 COUNT(nm.id) AS mention_count
          FROM news_mentions nm
          JOIN bills b ON b.id = nm.bill_id
          WHERE date(nm.published_at) BETWEEN ? AND ?
          GROUP BY nm.bill_id
          ORDER BY mention_count DESC, b.bill_type ASC, b.bill_number ASC
          LIMIT ?`,
    args: [week.start, week.end, MOST_TALKED_LIMIT],
  });
  const mostTalkedAbout: MostTalkedAbout[] = newsRs.rows.map((r) => ({
    billId: formatBillId(r.bill_type as string, r.bill_number as number),
    title: r.title as string,
    sponsorName: (r.sponsor_name as string | null) ?? null,
    mentionCount: Number(r.mention_count ?? 0),
  }));

  return {
    transitionsCount: transRs.rows.length,
    stageMovements,
    stageTrackingStart,
    enactmentsCount: enactments.length,
    enactments,
    introductionsCount: Number(introRs.rows[0]?.n ?? 0),
    deadByTopic,
    deadBillCount: deadBills.size,
    notableIntros,
    topicIntroductions,
    mostTalkedAbout,
  };
}

// ---- LLM prompt --------------------------------------------------------

const SYSTEM_PROMPT = `You are writing the weekly Congress report for a personal tracking dashboard.

Generate prose for the following sections based on the data provided. Each section's prose must reference specific bill IDs (e.g. "HR 2702") and use exact numbers from the data. Avoid generic openers ("This week, Congress..."), avoid marketing titles for bills, avoid editorial framing. Plain numbers, plain language, terminal voice.

Output in this exact format:

LEAD:
<2-3 sentences, max 60 words>

STAGE_COMMENTARY:
<2-3 sentences about the stage movements; output exactly "_No stage movements this week._" if the stage transition count is zero>

ENACTMENTS_COMMENTARY:
<1-2 sentences about the enactments; output exactly "_No bills became law this week._" if the enactments count is zero>

MOST_TALKED_COMMENTARY:
<2-3 sentences on what got media coverage and why it might matter; reference specific bill IDs from the data; output exactly "_No news mentions tracked for this week._" if the news mention count is zero>`;

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
  // topicLabel() here, not the raw enum — buildUserPrompt feeds the LLM, and
  // the LLM copies what it sees. A raw `government_operations` leaked into the
  // 2026-05-04 report's lead this way (HO 110).
  const topTopic = d.topicIntroductions[0]
    ? `${topicLabel(d.topicIntroductions[0].topic)} (${d.topicIntroductions[0].count} introductions)`
    : "(none)";

  const mostTalkedLines =
    d.mostTalkedAbout.length > 0
      ? d.mostTalkedAbout
          .map(
            (m) =>
              `  - ${m.billId} (${m.mentionCount} mention${m.mentionCount === 1 ? "" : "s"}): ${truncate(m.title, 70)}`,
          )
          .join("\n")
      : "  - (none — news_mentions had no matches for this week)";

  return `WEEK DATA (${week.start} to ${week.end}):
- Total stage transitions: ${d.transitionsCount}
- Top 5 transitions:
${transitionLines}
- Enactments: ${d.enactmentsCount} bills, including ${enactmentIds}
- New introductions: ${d.introductionsCount}
- Top topic by activity: ${topTopic}
- Most talked about (by tracked news mentions):
${mostTalkedLines}

Write the report sections:`;
}

type ReportCommentary = {
  lead: string;
  stageCommentary: string;
  enactmentsCommentary: string;
  mostTalkedCommentary: string;
};

const REPORT_MARKERS = [
  "LEAD",
  "STAGE_COMMENTARY",
  "ENACTMENTS_COMMENTARY",
  "MOST_TALKED_COMMENTARY",
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
  const {
    LEAD,
    STAGE_COMMENTARY,
    ENACTMENTS_COMMENTARY,
    MOST_TALKED_COMMENTARY,
  } = values;
  if (
    !LEAD ||
    !STAGE_COMMENTARY ||
    !ENACTMENTS_COMMENTARY ||
    !MOST_TALKED_COMMENTARY
  )
    return null;
  return {
    lead: LEAD,
    stageCommentary: STAGE_COMMENTARY,
    enactmentsCommentary: ENACTMENTS_COMMENTARY,
    mostTalkedCommentary: MOST_TALKED_COMMENTARY,
  };
}

// ---- markdown assembly -------------------------------------------------

// Section order (HO 110) answers "WTF is going on in Congress?" strongest
// signal first: lead synthesis, then news, what advanced, what became law,
// what notable bills were filed, the topic rollup, and stalls (anti-news)
// last. The handoff sketched a "New introductions count" trailing section —
// no such section exists (the count lives in the lead), and "Notable
// introductions" it omitted does exist, so the realized order keeps all six
// real sections rather than inventing/dropping any.
function assembleMarkdown(
  title: string,
  week: WeekRange,
  d: ReportData,
  c: ReportCommentary,
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`, "");
  lines.push(c.lead, "");

  // Most talked about — news signal leads the body. When news_mentions is
  // empty for the week, emit the canonical fallback verbatim (the LLM
  // occasionally drops the underscores from the literal template, breaking
  // the italic styling); otherwise trust the LLM commentary.
  lines.push("## Most talked about", "");
  if (d.mostTalkedAbout.length > 0) {
    lines.push(c.mostTalkedCommentary, "");
    for (const m of d.mostTalkedAbout) {
      const sponsor = m.sponsorName ? ` — ${m.sponsorName}` : "";
      lines.push(
        `- ${m.billId} (${m.mentionCount} mention${m.mentionCount === 1 ? "" : "s"}) — ${truncate(m.title, TITLE_TRUNCATE)}${sponsor}`,
      );
    }
    lines.push("");
  } else {
    lines.push("_No news mentions tracked for this week._", "");
  }

  // Stage movements. The zero case is split (HO 110): a week that predates
  // stage tracking is not a quiet week. stage_changed_at is never backfilled,
  // so a report whose week ends before the first tracked transition has no
  // data — say so rather than implying Congress was idle. When there are
  // movements, the LLM commentary leads; when zero, assembly owns the copy
  // (c.stageCommentary is ignored, same as the enactments zero case).
  lines.push(`## Stage movements (${d.transitionsCount})`, "");
  if (d.stageMovements.length > 0) {
    lines.push(c.stageCommentary, "");
    for (const m of d.stageMovements) {
      lines.push(
        `- ${m.billId} — ${stageGlyph(m.prevStage)} → ${stageGlyph(
          m.newStage,
        )}${sponsorSuffix(m.sponsorName, m.sponsorParty, m.sponsorState)}`,
      );
    }
    lines.push("");
  } else if (d.stageTrackingStart === null || week.end < d.stageTrackingStart) {
    lines.push(
      d.stageTrackingStart
        ? `_Stage transition tracking began ${d.stageTrackingStart}. This report covers an earlier week, so no movements were recorded._`
        : "_Stage transition tracking was not yet active for this week._",
      "",
    );
  } else {
    lines.push("_No stage movements this week._", "");
  }

  // Enactments — trust the LLM commentary when bills became law; emit the
  // canonical fallback verbatim otherwise.
  lines.push(`## Enactments (${d.enactmentsCount})`, "");
  if (d.enactments.length > 0) {
    lines.push(c.enactmentsCommentary, "");
    for (const e of d.enactments) {
      lines.push(`- ${e.billId} — ${truncate(e.title, TITLE_TRUNCATE)}`);
    }
    lines.push("");
  } else {
    lines.push("_No bills became law this week._", "");
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

  // Topic breakdown — purely data-driven (no LLM commentary). Counts come
  // from introduced_date in the week, not stage transitions, so the section
  // can't contradict the introductions count in the lead.
  lines.push("## Topic breakdown", "");
  lines.push("What got introduced this week, by topic.", "");
  if (d.topicIntroductions.length > 0) {
    for (const t of d.topicIntroductions) {
      lines.push(`- **${topicLabel(t.topic)}** (${t.count})`);
    }
    lines.push("");
  } else {
    lines.push("_No bills introduced this week._", "");
  }

  // Newly stalled — last: anti-news, lowest signal. Trimmed (HO 110) from a
  // 10-topic ID-wall to the top 3 topics; the lead line carries the distinct-
  // bill aggregate so the section keeps its shape without the bulk. The
  // per-topic (count) is the full topic total; only the bill IDs are capped.
  lines.push("## Newly stalled", "");
  if (d.deadByTopic.length > 0) {
    lines.push(
      `${d.deadBillCount} bill${d.deadBillCount === 1 ? "" : "s"} crossed the ${DEAD_STALE_DAYS}-day inactivity threshold this week. Top topics by stall volume (a bill with multiple topics counts under each):`,
      "",
    );
    for (const t of d.deadByTopic) {
      lines.push(
        `- **${topicLabel(t.topic)}** (${t.count}): ${t.billIds.join(", ")}`,
      );
    }
    lines.push("");
  } else {
    lines.push("_No bills crossed the staleness threshold this week._", "");
  }

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

  // Incomplete-week guard (HO 110). A report for a week that hasn't ended is
  // near-empty and misleading (the 2026-05-18 backfill row is the artifact).
  // Refuse; the cron treats a thrown error as non-fatal and retries next tick
  // once the week has closed.
  const today = isoDate(new Date());
  if (week.end > today) {
    throw new Error(
      `Refusing to generate report for incomplete week ${week.start}..${week.end}: week_end is in the future (today is ${today}). Retry once the week closes.`,
    );
  }

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
    content_md: assembleMarkdown(title, week, data, commentary),
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
