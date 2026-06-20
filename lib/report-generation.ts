import { GoogleGenAI } from "@google/genai";
import { getDb } from "./db";
import { ALLOWED_TOPICS_SET, stageRank } from "./enums";
import { formatBillId } from "./format";
import { withGeminiRetry } from "./gemini-retry";
import { hearingBadge } from "./hearings";
import { SUMMARY_MODEL } from "./summarize";

// HO 160: transient-retry backoff for the weekly-report Gemini call. Truncated
// from summarize's [2000,4000,8000,16000] to 3 steps so the worst case (two
// ~15s Flash calls + ~14s total backoff ≈ 51s) clears the Vercel 60s ceiling.
const REPORT_RETRY_BACKOFF_MS = [2000, 4000, 8000];

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
// HO 268: markup blocks lead the COMMITTEE ACTIVITY section (the bill-movers).
// Only markups carrying bills get a block; cap the block count + bills/block so
// a dense week doesn't wall the report. ~4 markups-with-bills/week observed.
const MARKUP_BLOCK_LIMIT = 6;
const MARKUP_BILLS_LIMIT = 5;
const MOST_TALKED_LIMIT = 5;
// HO 111: news-signal confidence gate. Every news_mentions row is
// matched_via='llm_match'; the matcher emits match_confidence bimodally — a
// 1.0 "confident" cluster and a 0.5-0.7 "uncertain" cluster, nothing between.
// 0.7 cleanly separates them, and `match_confidence >= 0.7` also drops the
// NULL-confidence rows (a confidence-population gap, ~21/47 at audit time —
// not regex matches) since `NULL >= 0.7` is false in SQL. A bill needs >= 2
// mentions to count as "talked about" rather than merely "appeared once".
export const NEWS_CONFIDENCE_FLOOR = 0.7;
const NEWS_MIN_MENTIONS = 2;
// avg_confidence >= this renders as the 'high' tier in the prompt context.
const NEWS_HIGH_TIER = 0.9;

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

// "Jun 17" — short UTC date for a markup block header (HO 268). UTC to match the
// report's week-granular date math; time-of-day is dropped (a weekly digest).
const shortDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
});
function formatShortDate(iso: string): string {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : shortDateFormatter.format(t);
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

// Legislative-progression direction. Drives stage-transition copy so the prompt
// can tell the LLM a floor→committee move is a setback, not progress (HO 112) —
// the LLM otherwise narrates every transition as forward. Rank order is the
// canonical one derived from ALLOWED_STAGES (HO 239 unified the two copies).
function stageDirection(prev: string | null, next: string | null): string {
  const p = stageRank(prev);
  const n = stageRank(next);
  if (p < 0 || n < 0) return "other";
  if (n > p) return "forward";
  if (n < p) return "backward";
  return "other";
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
  // Confidence summary for the prompt context (HO 111). The LLM sees the
  // tier, never the raw float — a float invites it to recite "0.91".
  confidenceTier: "high" | "medium";
  outlets: string[];
  sampleHeadlines: string[];
};

// HO 268: COMMITTEE ACTIVITY. Fallback version (Gate A probe found no reliable
// markup→stage-change join — bills.stage_changed_at tracking began 2026-05-11
// and doesn't align with markup dates), so markup blocks show bills at their
// CURRENT stage and the firehose VIA annotations are dropped.
type MarkupBill = {
  billId: string;
  title: string;
  stage: string | null;
};
type MarkupBlock = {
  committeeName: string | null;
  committeeSystemCode: string | null;
  date: string; // ISO meeting date
  videoUrl: string | null;
  bills: MarkupBill[]; // capped to MARKUP_BILLS_LIMIT for display
  billTotal: number; // pre-cap count, for "+N more"
};
type CommitteeActivity = {
  meetingsCount: number;
  hearings: number;
  markups: number;
  business: number;
  committees: number;
  markupBlocks: MarkupBlock[];
};

type ReportData = {
  transitionsCount: number;
  stageMovements: StageMovement[];
  committeeActivity: CommitteeActivity;
  // Earliest date(stage_changed_at) in the corpus, or null if nothing has
  // ever been tracked. stage_changed_at is never backfilled, so a report
  // whose week ends before this date legitimately predates tracking — the
  // zero-movements copy says so rather than implying Congress was idle.
  stageTrackingStart: string | null;
  enactmentsCount: number;
  enactments: Enactment[];
  introductionsCount: number;
  // Prior week's non-ceremonial introduction count — the LLM uses the delta
  // as synthesis raw material for the LEAD (HO 112). 0 for the earliest
  // reports, whose prior week predates the corpus.
  priorIntroductionsCount: number;
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

  // 3. New introductions count — this week and the week before, so the LEAD
  // can synthesize a trend ("introductions rose/fell") rather than recite a
  // bare number (HO 112).
  const introRs = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM bills
          WHERE introduced_date BETWEEN ? AND ?
            AND ${NON_CEREMONIAL}`,
    args: [week.start, week.end],
  });
  const priorIntroRs = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM bills
          WHERE introduced_date BETWEEN ? AND ?
            AND ${NON_CEREMONIAL}`,
    args: [addDays(week.start, -7), addDays(week.start, -1)],
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

  // 7. Most talked about — top bills by news_mentions within the report week,
  // confidence-gated (HO 111). The WHERE floor on match_confidence excludes
  // both the 0.5-0.7 "uncertain" band and NULL-confidence rows; the HAVING
  // floor drops bills mentioned only once. Ranked loudest-and-most-confident
  // first: mention count, then average confidence, then recency. news_mentions
  // has UNIQUE(bill_id, article_url) so a count reflects distinct articles.
  const newsRs = await db.execute({
    sql: `SELECT b.bill_type, b.bill_number, b.title, b.sponsor_name,
                 COUNT(nm.id) AS mention_count,
                 AVG(nm.match_confidence) AS avg_confidence,
                 GROUP_CONCAT(DISTINCT nm.source) AS outlets,
                 GROUP_CONCAT(nm.article_title, '~~') AS headlines,
                 MAX(nm.published_at) AS latest_mention
          FROM news_mentions nm
          JOIN bills b ON b.id = nm.bill_id
          WHERE date(nm.published_at) BETWEEN ? AND ?
            AND nm.match_confidence >= ?
          GROUP BY nm.bill_id
          HAVING COUNT(nm.id) >= ?
          ORDER BY mention_count DESC, avg_confidence DESC,
                   latest_mention DESC
          LIMIT ?`,
    args: [
      week.start,
      week.end,
      NEWS_CONFIDENCE_FLOOR,
      NEWS_MIN_MENTIONS,
      MOST_TALKED_LIMIT,
    ],
  });
  const mostTalkedAbout: MostTalkedAbout[] = newsRs.rows.map((r) => {
    const avg = Number(r.avg_confidence ?? 0);
    const outlets = ((r.outlets as string | null) ?? "")
      .split(",")
      .filter(Boolean);
    const sampleHeadlines = ((r.headlines as string | null) ?? "")
      .split("~~")
      .filter(Boolean)
      .slice(0, 3);
    return {
      billId: formatBillId(r.bill_type as string, r.bill_number as number),
      title: r.title as string,
      sponsorName: (r.sponsor_name as string | null) ?? null,
      mentionCount: Number(r.mention_count ?? 0),
      confidenceTier: avg >= NEWS_HIGH_TIER ? "high" : "medium",
      outlets,
      sampleHeadlines,
    };
  });

  // 8. Committee activity (HO 268) — meetings held this week, the type mix, and
  // the markups that carried bills (the bill-movers that lead the section). The
  // committee name is LEFT JOIN'd; meeting dates compared via date() in UTC, the
  // same week-boundary convention as every other query here.
  // Indexed range on the raw ISO timestamp (idx_committee_meetings_date) rather
  // than date(meeting_date) BETWEEN, which wraps the column and forces a scan.
  // meeting_date is ISO-UTC ("2026-05-11T14:30:00Z"), so a lexical range over
  // [start T00:00, end T23:59:59] covers the same Mon–Sun week.
  const meetingsRs = await db.execute({
    sql: `SELECT m.event_id, m.committee_system_code, c.name AS committee_name,
                 m.meeting_date, m.meeting_type, m.video_url
          FROM committee_meetings m
          LEFT JOIN committees c ON c.system_code = m.committee_system_code
          WHERE m.meeting_date >= ? AND m.meeting_date <= ?`,
    args: [`${week.start}T00:00:00Z`, `${week.end}T23:59:59Z`],
  });
  let hearings = 0;
  let markups = 0;
  let business = 0;
  const committeeSet = new Set<string>();
  const markupEvents: {
    eventId: string;
    committeeName: string | null;
    committeeSystemCode: string | null;
    date: string;
    videoUrl: string | null;
  }[] = [];
  for (const r of meetingsRs.rows) {
    const badge = hearingBadge(r.meeting_type as string | null);
    if (badge === "HEARING") hearings += 1;
    else if (badge === "MARKUP") markups += 1;
    else business += 1;
    const code = r.committee_system_code as string | null;
    if (code) committeeSet.add(code);
    if (badge === "MARKUP") {
      markupEvents.push({
        eventId: r.event_id as string,
        committeeName: (r.committee_name as string | null) ?? null,
        committeeSystemCode: code,
        date: r.meeting_date as string,
        videoUrl: (r.video_url as string | null) ?? null,
      });
    }
  }

  // Bills on this week's markup agendas → group by event. Only markups with at
  // least one bill become blocks (the bill-movers); newest first, capped.
  const billsByEvent = new Map<string, MarkupBill[]>();
  if (markupEvents.length > 0) {
    const ids = markupEvents.map((m) => m.eventId);
    const placeholders = ids.map(() => "?").join(",");
    const mbRs = await db.execute({
      sql: `SELECT mb.event_id, b.bill_type, b.bill_number, b.title, b.stage
            FROM meeting_bills mb
            JOIN bills b ON b.id = mb.bill_id
            WHERE mb.event_id IN (${placeholders})
            ORDER BY b.stage_changed_at DESC NULLS LAST`,
      args: ids,
    });
    for (const r of mbRs.rows) {
      const ev = r.event_id as string;
      const arr = billsByEvent.get(ev) ?? [];
      arr.push({
        billId: formatBillId(r.bill_type as string, r.bill_number as number),
        title: r.title as string,
        stage: (r.stage as string | null) ?? null,
      });
      billsByEvent.set(ev, arr);
    }
  }
  const markupBlocks: MarkupBlock[] = markupEvents
    .map((m) => {
      const all = billsByEvent.get(m.eventId) ?? [];
      return {
        committeeName: m.committeeName,
        committeeSystemCode: m.committeeSystemCode,
        date: m.date,
        videoUrl: m.videoUrl,
        bills: all.slice(0, MARKUP_BILLS_LIMIT),
        billTotal: all.length,
      };
    })
    .filter((b) => b.billTotal > 0)
    .sort(
      (a, b) =>
        b.billTotal - a.billTotal || Date.parse(b.date) - Date.parse(a.date),
    )
    .slice(0, MARKUP_BLOCK_LIMIT);

  const committeeActivity: CommitteeActivity = {
    meetingsCount: meetingsRs.rows.length,
    hearings,
    markups,
    business,
    committees: committeeSet.size,
    markupBlocks,
  };

  return {
    transitionsCount: transRs.rows.length,
    stageMovements,
    committeeActivity,
    stageTrackingStart,
    enactmentsCount: enactments.length,
    enactments,
    introductionsCount: Number(introRs.rows[0]?.n ?? 0),
    priorIntroductionsCount: Number(priorIntroRs.rows[0]?.n ?? 0),
    deadByTopic,
    deadBillCount: deadBills.size,
    notableIntros,
    topicIntroductions,
    mostTalkedAbout,
  };
}

// ---- banned-phrase compliance (HO 112.2) -------------------------------

// Single source of truth for the banned single-word list. The SYSTEM_PROMPT
// interpolates these stems and the regenerate-on-violation check enforces
// them, so the prompt and the check cannot drift. Each entry is a stem:
// `\b<stem>\w*\b` matches every morphological variant ("significant",
// "significantly") without matching a prefix-modified word ("insignificant" —
// the leading \b boundary breaks). Multi-word phrases and "critical"
// (legitimate as a bill's actual subject — "critical infrastructure") stay in
// the prompt prose only; a blunt stem regex cannot honor their context, so
// they are deliberately not enforced.
const BANNED_STEMS: string[] = [
  "notewort", // noteworthy
  "notabl", // notable, notably
  "significant", // significant, significantly
  "delv", // delve, delving
  "underscor", // underscore, underscoring
  "leverag", // leverage, leveraging
  "pivotal",
  "crucial",
  "tapestr", // tapestry, tapestries
  "testament", // testament, "testament to"
];

const BANNED_REGEX = BANNED_STEMS.map(
  (stem) => new RegExp(`\\b${stem}\\w*\\b`, "i"),
);

// Scans the full generated report text for banned morphological variants.
// Returns the distinct matched words (first-seen casing), [] when clean.
function scanBanned(text: string): string[] {
  const found: string[] = [];
  const seen = new Set<string>();
  for (const re of BANNED_REGEX) {
    const m = re.exec(text);
    if (!m) continue;
    const key = m[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    found.push(m[0]);
  }
  return found;
}

// ---- LLM prompt --------------------------------------------------------

const SYSTEM_PROMPT = `You are writing the weekly Congress report for a personal tracking dashboard. The reader opens this Monday morning wanting one thing: a sense-making answer to "what actually happened in Congress last week?" — not a list of numbers, an answer.

Voice: terminal, plain, direct. Short sentences. No editorializing, no marketing titles for bills, no newsletter throat-clearing.

THE LEAD is the most important section. It must SYNTHESIZE, not recite. A lead that just lists counts has failed.
- Wrong — these are real rejected leads, never write in this register:
  "This week, 216 new bills were introduced. Government operations was the most active topic."
  "Congress introduced 100 new bills this week."
  "This week recorded 38 total stage transitions."
- Right — name the throughline. What was the week ABOUT? Lead with the specific: a named bill that moved, a topic surge, a notable enactment. Let numbers support the point, never open with one. If three appropriations bills became law, that is the lead. If the week was diffuse, say so and name the one or two things that stood out — by bill ID.

RULES for every section's prose:
- A bulleted list follows the prose in most sections. The prose introduces the SIGNIFICANCE of the section; it does NOT re-name the items the list is about to show. Never write "Three bills became law: S 4465, HR 7147, and HJRES 140" above a list of those three — write what they do or why they matter.
- Never invent counts. You are not told how many items the list holds. Do not write "five transitions" or "all of the top three" — a wrong number is worse than none. Write "the leading transitions" or name specific bills. Cite a number only when the data states it explicitly.
- Reference specific bill IDs (e.g. "HR 2702").
- Banned word stems — never write any word built on these stems, in any inflection or register: ${BANNED_STEMS.join(", ")}. Also never write these phrases: "of particular interest", "stood out", "marked a", "this week saw", "Congress saw", "it's worth noting" — and do not open a sentence by personifying Congress or the week as a thing that "saw" activity; state the activity directly. Do not use "critical" as a value judgment, though "critical infrastructure" as a bill's actual subject is fine. Describe what happened; do not rate its importance with an adjective or adverb.

Output in this exact format:

LEAD:
<2-3 sentences, max 60 words. Synthesis, per the rule above.>

ENACTMENTS_COMMENTARY:
<1-2 sentences on what the new laws DO — not which IDs they are; the list shows IDs. Output exactly "_No bills became law this week._" if the enactments count is zero.>

MOST_TALKED_COMMENTARY:
<2-3 sentences on what drew news coverage and why it might matter; reference specific bill IDs. Each bill carries a confidence label: for 'high', use assertive verbs ("drew coverage in", "was cited by", "received attention from"); for 'medium', hedge ("appeared in", "was mentioned by"). Never write the label itself. Output exactly "_No news mentions tracked for this week._" if the news mention count is zero.>

COMMITTEE_COMMENTARY:
<2-3 sentences on the week's committee work: how many meetings, and which markups put bills on their agenda — name the standout markup by committee and a bill ID it took up. Do NOT claim a markup "advanced" or "reported" a bill to the floor unless the stage-movement data shows it; the markup list tells you a committee took bills up, not where they ended. Output exactly "_No committee meetings tracked for this week._" if the meetings count is zero.>

STAGE_COMMENTARY:
<2-3 sentences on what advanced. Each transition carries a direction (forward / backward / other) — narrate a backward move honestly: a bill returning to committee from the floor is a setback, not progress. Output exactly "_No stage movements this week._" if the transition count is zero.>`;

function buildUserPrompt(week: WeekRange, d: ReportData): string {
  // Each transition carries a derived direction so the LLM can narrate
  // backward moves honestly (HO 112). "Leading" — not "top 5" — so the LLM
  // does not anchor on a count it cannot verify against the rendered list.
  const transitionLines =
    d.stageMovements.length > 0
      ? d.stageMovements
          .slice(0, 5)
          .map(
            (t) =>
              `  - ${t.billId}: ${truncate(t.title, 70)} (${stageGlyph(
                t.prevStage,
              )} → ${stageGlyph(t.newStage)}, direction: ${stageDirection(
                t.prevStage,
                t.newStage,
              )})`,
          )
          .join("\n")
      : "  - (none)";
  // ID + title, so the LLM can write what the new laws DO rather than recite
  // their IDs (the rendered list already carries the IDs).
  const enactmentLines =
    d.enactments.length > 0
      ? d.enactments
          .slice(0, 5)
          .map((e) => `  - ${e.billId}: ${truncate(e.title, 70)}`)
          .join("\n")
      : "  - (none)";
  // topicLabel() here, not the raw enum — buildUserPrompt feeds the LLM, and
  // the LLM copies what it sees. A raw `government_operations` leaked into the
  // 2026-05-04 report's lead this way (HO 110). Top 3, not 1, so the LLM can
  // see whether the week was topic-concentrated or spread.
  const topTopics =
    d.topicIntroductions.length > 0
      ? d.topicIntroductions
          .slice(0, 3)
          .map((t) => `${topicLabel(t.topic)} (${t.count})`)
          .join(", ")
      : "(none)";

  const mostTalkedLines =
    d.mostTalkedAbout.length > 0
      ? d.mostTalkedAbout
          .map((m) => {
            const outlets =
              m.outlets.length > 0 ? m.outlets.join(", ") : "unknown";
            const heads = m.sampleHeadlines
              .map((h) => `"${truncate(h, 70)}"`)
              .join("; ");
            return (
              `  - ${m.billId} (${m.mentionCount} mention${m.mentionCount === 1 ? "" : "s"}, ` +
              `confidence ${m.confidenceTier}, outlets: ${outlets}): ${truncate(m.title, 70)}\n` +
              `      headlines: ${heads}`
            );
          })
          .join("\n")
      : "  - (none — no bills cleared the news-confidence floor this week)";

  const introDelta =
    d.introductionsCount - d.priorIntroductionsCount >= 0 ? "up" : "down";

  // Committee activity (HO 268). The markup list names committee + bill count +
  // a couple of bill IDs so the LLM can cite the standout markup; it is NOT told
  // the bills moved to the floor (the fallback shows current stage only).
  const ca = d.committeeActivity;
  const markupContext =
    ca.markupBlocks.length > 0
      ? ca.markupBlocks
          .map((b) => {
            const ids = b.bills
              .slice(0, 3)
              .map((x) => x.billId)
              .join(", ");
            return `  - ${b.committeeName ?? b.committeeSystemCode ?? "committee"} markup (${b.billTotal} bill${b.billTotal === 1 ? "" : "s"}: ${ids})`;
          })
          .join("\n")
      : "  - (no markups carried bills this week)";

  return `WEEK DATA (${week.start} to ${week.end}):
- New bill introductions: ${d.introductionsCount} (prior week: ${d.priorIntroductionsCount} — ${introDelta})
- Most active topics by introductions: ${topTopics}
- Stage transitions this week: ${d.transitionsCount}. Leading transitions:
${transitionLines}
- Bills enacted into law this week: ${d.enactmentsCount}
${enactmentLines}
- Most talked about (tracked news mentions, confidence-filtered):
${mostTalkedLines}
- Committee meetings this week: ${ca.meetingsCount} (${ca.hearings} hearings, ${ca.markups} markups, ${ca.business} business; ${ca.committees} committees). Markups that took up bills:
${markupContext}

Write the report sections:`;
}

type ReportCommentary = {
  lead: string;
  stageCommentary: string;
  enactmentsCommentary: string;
  mostTalkedCommentary: string;
  committeeCommentary: string;
};

// Order MUST match the SYSTEM_PROMPT output template + the assembleMarkdown
// emit order (HO 242, +COMMITTEE_COMMENTARY HO 268): the parse below finds each
// section's end by searching forward for the NEXT marker in this array, so a
// mismatch would mis-slice section boundaries.
const REPORT_MARKERS = [
  "LEAD",
  "ENACTMENTS_COMMENTARY",
  "MOST_TALKED_COMMENTARY",
  "COMMITTEE_COMMENTARY",
  "STAGE_COMMENTARY",
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
    COMMITTEE_COMMENTARY,
  } = values;
  if (
    !LEAD ||
    !STAGE_COMMENTARY ||
    !ENACTMENTS_COMMENTARY ||
    !MOST_TALKED_COMMENTARY ||
    !COMMITTEE_COMMENTARY
  )
    return null;
  return {
    lead: LEAD,
    stageCommentary: STAGE_COMMENTARY,
    enactmentsCommentary: ENACTMENTS_COMMENTARY,
    mostTalkedCommentary: MOST_TALKED_COMMENTARY,
    committeeCommentary: COMMITTEE_COMMENTARY,
  };
}

// ---- markdown assembly -------------------------------------------------

// Section order (HO 242, reordering HO 110): lead synthesis, then what became
// law FIRST (Design leads the body with enactments), then news, what advanced,
// what notable bills were filed, the topic rollup, and stalls (anti-news) last.
// The SYSTEM_PROMPT output template + REPORT_MARKERS were reordered to match
// this emit order (the parse keys section boundaries off REPORT_MARKERS, so the
// prompt order and this push order must agree). The handoff sketched a "New
// introductions count" trailing section — no such section exists (the count
// lives in the lead), and "Notable introductions" it omitted does exist, so
// the realized order keeps all six real sections rather than inventing/dropping
// any.
function assembleMarkdown(
  title: string,
  week: WeekRange,
  d: ReportData,
  c: ReportCommentary,
): string {
  const lines: string[] = [];
  lines.push(`# ${title}`, "");
  lines.push(c.lead, "");

  // Enactments first (HO 242) — Design leads the body with what became law,
  // ahead of news and movement. Trust the LLM commentary when bills became
  // law; emit the canonical fallback verbatim otherwise.
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

  // Most talked about — the news signal. When news_mentions is empty for the
  // week, emit the canonical fallback verbatim (the LLM occasionally drops the
  // underscores from the literal template, breaking the italic styling);
  // otherwise trust the LLM commentary.
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

  // Committee activity (HO 268) — placed between the news signal and the stage
  // firehose it feeds into. Markup blocks lead (the bill-movers); fallback
  // version shows bills at their CURRENT stage (no VIA tags — Gate A found no
  // reliable markup→stage-change join). Count strip is an inline-code span so
  // ReportMarkdown renders it amber. When the week had no meetings, assembly
  // owns the zero copy (the LLM commentary is ignored, same as enactments).
  const ca = d.committeeActivity;
  lines.push(`## Committee activity (${ca.meetingsCount})`, "");
  if (ca.meetingsCount > 0) {
    lines.push(c.committeeCommentary, "");
    lines.push(
      `\`${ca.hearings} HEARINGS · ${ca.markups} MARKUPS · ${ca.business} BUSINESS · ${ca.committees} COMMITTEES\``,
      "",
    );
    for (const b of ca.markupBlocks) {
      const name = b.committeeName ?? b.committeeSystemCode ?? "Committee";
      const committeePart = b.committeeSystemCode
        ? `[${name}](/committee/${b.committeeSystemCode})`
        : name;
      const recording = b.videoUrl ? ` · [▶ recording](${b.videoUrl})` : "";
      lines.push(
        `${committeePart} · MARKUP · ${formatShortDate(b.date)}${recording}`,
        "",
      );
      for (const bill of b.bills) {
        lines.push(
          `- ${bill.billId} — ${truncate(bill.title, TITLE_TRUNCATE)} · ${stageGlyph(bill.stage)}`,
        );
      }
      const more = b.billTotal - b.bills.length;
      if (more > 0) lines.push(`- _+${more} more_`);
      lines.push("");
    }
  } else {
    lines.push("_No committee meetings tracked for this week._", "");
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

// Wraps the Flash call with a regenerate-on-violation check (HO 112.2). Scans
// the full generated text against BANNED_REGEX; a banned morphological variant
// triggers one retry with a corrective instruction naming the matched
// phrase(s) — models avoid named negatives more reliably than a generic rule
// reminder. Capped at one retry: the Vercel 60s cron ceiling matters, and a
// model that leaks twice rarely self-corrects on a third pass. If the retry
// still leaks, the second output ships and the event is logged.
async function generateReportWithRetry(
  client: GoogleGenAI,
  week: WeekRange,
  userPrompt: string,
): Promise<string> {
  const config = {
    systemInstruction: SYSTEM_PROMPT,
    thinkingConfig: { thinkingBudget: 8192 },
  };

  const callFlash = async (contents: string): Promise<string> => {
    // HO 160: retry transient Gemini 503/429 — this route runs once a week, so
    // a single overloaded response would otherwise strand the whole week's
    // report. Truncated to 3 backoff steps (~14s max) so worst case — two
    // ~15s calls plus backoff — stays under the Vercel 60s cron ceiling.
    const response = await withGeminiRetry(
      () =>
        client.models.generateContent({
          model: SUMMARY_MODEL,
          contents,
          config,
        }),
      {
        backoffMs: REPORT_RETRY_BACKOFF_MS,
        onRetry: ({ attempt, total, waitMs, error }) =>
          console.warn(
            `[REPORT] gemini retry: backoff ${waitMs}ms (attempt ${attempt + 1}/${total}) ${error.message.slice(0, 80)}`,
          ),
      },
    );
    const text = response.text?.trim();
    if (!text) throw new Error("Gemini returned an empty report");
    return text;
  };

  const firstText = await callFlash(userPrompt);
  const firstViolations = scanBanned(firstText);
  if (firstViolations.length === 0) return firstText;

  // Name the specific matched phrase(s) in the corrective prompt — models
  // avoid named negatives more reliably than a generic rule reminder.
  const named = firstViolations.map((v) => `"${v}"`).join(", ");
  const correction =
    `Your previous response used the banned phrase ${named}. Regenerate ` +
    `the report without using that phrase or any morphological variant of it.`;
  const secondText = await callFlash(`${userPrompt}\n\n${correction}`);

  // One retry only — the Vercel 60s cron ceiling matters, and a model that
  // leaks twice rarely self-corrects on a third pass. If the retry still
  // leaks, the second output ships; the log records it for later telemetry.
  console.log(
    `[REPORT-RETRY] week=${week.start} attempt=1 ` +
      `violations=${JSON.stringify(firstViolations)} ` +
      `cleaned=${scanBanned(secondText).length === 0}`,
  );

  return secondText;
}

// Gathers the week's data, prompts Gemini for section prose, assembles the
// Markdown body. Throws on missing key, empty response, or parse failure —
// callers (cron) treat failure as non-fatal and write no row.
export async function generateWeeklyReport(week: WeekRange): Promise<{
  slug: string;
  title: string;
  content_md: string;
  // HO 242: LLM-free per-week counts, persisted so the /reports index strip
  // is queryable without prose-parsing content_md.
  lawsCount: number;
  introCount: number;
  movesCount: number;
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

  const text = await generateReportWithRetry(
    client,
    week,
    buildUserPrompt(week, data),
  );

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
    lawsCount: data.enactmentsCount,
    introCount: data.introductionsCount,
    movesCount: data.transitionsCount,
  };
}

// ---- daily catch-up (HO 285) -------------------------------------------

// How many most-recent completed weeks the daily catch-up inspects. The 284
// probe showed the weekly Monday cron drops a report on any transient hiccup
// (Turso cold-stall, Gemini 503, slow-Gemini >55s) with no retry. This window
// is the safety net: the daily route re-checks the last few weeks and fills
// the most recent missing one, so a dropped week lands on a later day instead
// of being lost. 4 weeks tolerates a multi-week outage without unbounded
// history scanning.
const CATCHUP_WINDOW_WEEKS = 4;

export type CatchupResult = {
  // Weeks inspected (= CATCHUP_WINDOW_WEEKS).
  checked: number;
  // How many of those weeks have no report row.
  missing: number;
  // The week-start slug generated this run, or null when nothing was missing
  // (or a gen was attempted but threw — the caller treats that as non-fatal
  // and the row stays missing for the next day's run).
  generated: string | null;
};

// Returns the last CATCHUP_WINDOW_WEEKS completed Mon-Sun weeks, most recent
// first. getPriorWeek(now) is the most recent week that has fully closed, so
// every entry is safe to generate (past generateWeeklyReport's incomplete-week
// guard) by construction.
function recentCompletedWeeks(now: Date): WeekRange[] {
  const firstStart = getPriorWeek(now).start;
  const weeks: WeekRange[] = [];
  for (let i = 0; i < CATCHUP_WINDOW_WEEKS; i++) {
    const start = addDays(firstStart, -7 * i);
    weeks.push({ start, end: addDays(start, 6) });
  }
  return weeks;
}

// Daily catch-up: inspect the last few completed weeks, and if any report row
// is missing, regenerate exactly ONE — the most recent missing week, so the
// dashboard's READ FULL target is restored first. Idempotent: only generates
// when the row is absent, never overwrites. One gen per run (~15-29s) keeps a
// single daily tick bounded; a multi-week gap fills over consecutive days.
//
// Reuses generateWeeklyReport / writeReport wholesale — no forked gen logic.
// Does NOT revalidate (kept free of next/cache so the lib stays import-safe);
// the caller revalidates the `reports` tag when `generated` is non-null.
export async function runReportCatchup(
  now: Date = new Date(),
): Promise<CatchupResult> {
  const weeks = recentCompletedWeeks(now);
  const db = getDb();
  const placeholders = weeks.map(() => "?").join(",");
  const rs = await db.execute({
    sql: `SELECT slug FROM reports WHERE slug IN (${placeholders})`,
    args: weeks.map((w) => w.start),
  });
  const have = new Set(rs.rows.map((r) => r.slug as string));
  // weeks is already most-recent-first, so the first miss is the newest gap.
  const missing = weeks.filter((w) => !have.has(w.start));
  if (missing.length === 0) {
    return { checked: weeks.length, missing: 0, generated: null };
  }

  const target = missing[0]!;
  const report = await generateWeeklyReport(target);
  await writeReport({
    slug: report.slug,
    weekStart: target.start,
    weekEnd: target.end,
    title: report.title,
    contentMd: report.content_md,
    lawsCount: report.lawsCount,
    introCount: report.introCount,
    movesCount: report.movesCount,
  });
  return { checked: weeks.length, missing: missing.length, generated: target.start };
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
  // HO 242: persisted per-week counts. Optional so a caller without them
  // (none today) degrades to NULL rather than failing.
  lawsCount?: number;
  introCount?: number;
  movesCount?: number;
}): Promise<void> {
  const db = getDb();
  await db.execute({
    sql: `INSERT INTO reports (slug, week_start, week_end, title, content_md, created_at, laws_count, intro_count, moves_count)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(slug) DO UPDATE SET
            week_start = excluded.week_start,
            week_end = excluded.week_end,
            title = excluded.title,
            content_md = excluded.content_md,
            created_at = excluded.created_at,
            laws_count = excluded.laws_count,
            intro_count = excluded.intro_count,
            moves_count = excluded.moves_count`,
    args: [
      report.slug,
      report.weekStart,
      report.weekEnd,
      report.title,
      report.contentMd,
      new Date().toISOString(),
      report.lawsCount ?? null,
      report.introCount ?? null,
      report.movesCount ?? null,
    ],
  });
}
