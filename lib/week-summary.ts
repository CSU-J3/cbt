// HO 689 — the week in three sentences.
//
// The roadmap's framing section asks for a 30-second answer to "WTF is going on
// in Congress," and its first bullet is three sentences at the top of the
// primary surface, generated from the underlying data. This is that generation.
//
// WINDOW — READ THIS BEFORE CHANGING ANYTHING HERE. The summary describes a
// COMPLETED CALENDAR WEEK: the same window `reports` is keyed on, the same one
// `getPriorWeek` yields, and it is deliberately NOT the dashboard band's window.
// Measured at HO 689 STEP 0, `components/WeeklyBand.tsx` carries THREE distinct
// windows under one header: its label is the Monday of the CURRENT in-progress
// week (`weekStartISO()`), its metrics are TRAILING 7 DAYS
// (`getStageChangesCount({}, 7)`, `priorDateISO = today − 7d`), and its report
// link is the prior complete week. On 2026-09-03 the band read 72 new bills and
// 107 transitions while the latest complete week (2026-08-24) held 47 and 71.
//
// A weekly-generated summary therefore CANNOT agree with the band's numbers —
// the band moves every day and the text does not. That is not a defect to fix
// here; it is why the ruled placement (Corey, 2026-09-03) is a line of its own
// ABOVE the band carrying its own week label. Putting this text inside the band
// row would sit "47 introduced" directly beneath a metric reading 72 under a
// single header, every number correct and the strip visibly self-contradicting.
// If a future HO moves this text inside the band, it must first make the band a
// calendar week — not the other way round.
//
// GROUNDING IS MECHANICAL, NOT ASPIRATIONAL. The generator receives only
// materialized numbers and named entities from our own tables, and every
// numeral it writes must already appear in that payload. A summary that fails
// the gate is NOT stored — there is no silent retry loop and no partial render.
import { GoogleGenAI } from "@google/genai";
import { getDb } from "./db";
import { SUMMARY_MODEL } from "./summarize";

export const WEEK_SUMMARY_SENTENCES = 3;

export type WeekSummaryPayload = {
  weekStart: string;
  weekEnd: string;
  weekLabel: string;
  billsIntroduced: number | null;
  stageTransitions: number | null;
  lawsEnacted: number | null;
  hearingsHeld: number;
  fillerPct: number;
  enacted: { billId: string; title: string }[];
  topAdvances: { billId: string; title: string; toStage: string; count: number }[];
  topTopics: { topic: string; count: number }[];
};

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function monDd(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/**
 * Everything the prompt is allowed to know, read from our own tables.
 *
 * The three headline counts come from the `reports` row's own materialized
 * columns (HO 242), so the summary and the /reports strip cannot disagree about
 * the same week — they are literally the same numbers.
 */
export async function buildWeekSummaryPayload(
  db: ReturnType<typeof getDb>,
  weekStart: string,
): Promise<WeekSummaryPayload> {
  const base = Date.parse(`${weekStart}T00:00:00Z`);
  const weekEnd = new Date(base + 6 * 864e5).toISOString().slice(0, 10);
  const endEx = new Date(base + 7 * 864e5).toISOString().slice(0, 10);

  const rep = await db.execute({
    sql: `SELECT laws_count, intro_count, moves_count FROM reports WHERE slug = ?`,
    args: [weekStart],
  });
  const r0 = rep.rows[0];

  const enacted = await db.execute({
    sql: `SELECT id, title FROM bills
           WHERE stage = 'enacted' AND latest_action_date >= ? AND latest_action_date < ?
           ORDER BY latest_action_date DESC LIMIT 5`,
    args: [weekStart, endEx],
  });

  // Advances past committee, on the OBSERVATION clock (HO 635) — the same clock
  // the band's "TRANSITIONS OBSERVED" label exists to disclose.
  const adv = await db.execute({
    sql: `SELECT st.bill_id AS id, b.title AS title, st.to_stage AS to_stage, COUNT(*) AS n
            FROM stage_transitions st JOIN bills b ON b.id = st.bill_id
           WHERE st.observed_at >= ? AND st.observed_at < ?
             AND st.to_stage IN ('floor','other_chamber','president','enacted')
           GROUP BY st.bill_id, st.to_stage
           ORDER BY CASE st.to_stage WHEN 'enacted' THEN 4 WHEN 'president' THEN 3
                                      WHEN 'other_chamber' THEN 2 ELSE 1 END DESC,
                    b.update_date DESC
           LIMIT 5`,
    args: [weekStart, endEx],
  });

  const hearings = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM committee_meetings
           WHERE meeting_date >= ? AND meeting_date < ?`,
    args: [weekStart, endEx],
  });

  const filler = await db.execute({
    sql: `SELECT SUM(CASE WHEN is_ceremonial = 1 THEN 1 ELSE 0 END) AS cer, COUNT(*) AS tot
            FROM bills WHERE introduced_date >= ? AND introduced_date < ?`,
    args: [weekStart, endEx],
  });
  const cer = Number(filler.rows[0]?.cer ?? 0);
  const tot = Number(filler.rows[0]?.tot ?? 0);

  const topics = await db.execute({
    sql: `SELECT je.value AS topic, COUNT(*) AS n
            FROM bills b, json_each(b.topics) je
           WHERE b.introduced_date >= ? AND b.introduced_date < ?
             AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)
           GROUP BY je.value ORDER BY n DESC LIMIT 3`,
    args: [weekStart, endEx],
  });

  return {
    weekStart,
    weekEnd,
    weekLabel: `${monDd(weekStart)}–${monDd(weekEnd)}`,
    billsIntroduced: r0 ? Number(r0.intro_count) : null,
    stageTransitions: r0 ? Number(r0.moves_count) : null,
    lawsEnacted: r0 ? Number(r0.laws_count) : null,
    hearingsHeld: Number(hearings.rows[0]?.n ?? 0),
    fillerPct: tot === 0 ? 0 : Math.round((cer / tot) * 100),
    enacted: enacted.rows.map((x) => ({ billId: String(x.id), title: String(x.title) })),
    topAdvances: adv.rows.map((x) => ({
      billId: String(x.id),
      title: String(x.title),
      toStage: String(x.to_stage),
      count: Number(x.n),
    })),
    topTopics: topics.rows.map((x) => ({ topic: String(x.topic), count: Number(x.n) })),
  };
}

/**
 * THE GROUNDING GATE. Every numeral in the text must already appear in the
 * payload.
 *
 * Bill ids split on non-digits, so `119-hr-1234` contributes 119 and 1234 — a
 * summary may cite a bill number it was handed. Thousands separators are
 * stripped so "1,234" matches 1234; a `%` is simply not a digit.
 *
 * KNOWN LIMIT, stated because a future reader will otherwise over-trust it:
 * this is a SUBSET check, not a semantic one. It catches an invented magnitude
 * ("9999 bills"); it cannot catch a MISATTRIBUTED one — "technology with 15"
 * passes when 15 belongs to a different topic, because 15 is in the payload.
 * Closing that needs numeral↔label pairing (backlog).
 */
export function groundingGate(
  payload: WeekSummaryPayload,
  text: string,
): { ok: boolean; offenders: string[] } {
  const allowed = new Set<string>();
  for (const m of JSON.stringify(payload).matchAll(/\d+/g)) {
    allowed.add(m[0].replace(/^0+(?=\d)/, ""));
  }
  const offenders: string[] = [];
  for (const m of text.replace(/,(?=\d{3}\b)/g, "").matchAll(/\d+/g)) {
    const n = m[0].replace(/^0+(?=\d)/, "");
    if (!allowed.has(n)) offenders.push(n);
  }
  return { ok: offenders.length === 0, offenders: [...new Set(offenders)] };
}

/** Terminal sentence punctuation followed by whitespace or end-of-text. */
export function sentenceCount(text: string): number {
  return (text.trim().match(/[.!?](\s|$)/g) ?? []).length;
}

// VOICE: terminal-dry, ruled by Corey 2026-09-03 from the STEP 0 samples. The
// alternative (analyst-warm) opened with the exact throat-clearing this prompt
// bans and returned FOUR sentences on one of three weeks — which is also why
// the cap below is enforced structurally rather than by asking.
function buildPrompt(p: WeekSummaryPayload, corrective?: string): string {
  return `You are writing a three-sentence summary of one week in the US Congress for a tracking dashboard.

HARD RULES:
- EXACTLY three sentences. Not two, not four.
- Use ONLY the numbers and names in the DATA below. Invent nothing.
- Every numeral you write must appear in the DATA. If you are unsure of a number, describe without it.
- No opening throat-clearing ("This week saw...", "In Congress this week..."). Lead with what happened.
- Do not restate every number; pick what carries the week.
- Voice: flat, factual, no adjectives of judgement, no scene-setting. Read like an instrument reporting. Never use words like "notably", "significant", "busy", "quiet".
${corrective ? `\nYOUR PREVIOUS ATTEMPT WAS REJECTED: ${corrective}\n` : ""}
DATA (week of ${p.weekLabel}, ${p.weekStart} to ${p.weekEnd}):
${JSON.stringify(p, null, 2)}

Respond with the three sentences and nothing else.`;
}

export type WeekSummaryResult =
  | { ok: true; text: string; attempts: number }
  | { ok: false; reason: string; attempts: number };

/**
 * Generate, validate, and either return a storable summary or refuse.
 *
 * REJECT, NEVER TRUNCATE. Cutting sentence three mid-thought is worse than
 * absence, because a truncated summary still reads as a finished one. One
 * corrective retry (the HO 112.2 regenerate-on-violation precedent used by the
 * report prose), then give up and store nothing — a failed generation degrades
 * to the previous week's row, which renders under its OWN week label.
 */
export async function generateWeekSummary(
  client: GoogleGenAI,
  payload: WeekSummaryPayload,
): Promise<WeekSummaryResult> {
  let corrective: string | undefined;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = await client.models.generateContent({
      model: SUMMARY_MODEL,
      contents: buildPrompt(payload, corrective),
      config: { thinkingConfig: { thinkingBudget: 0 } },
    });
    const text = (res.text ?? "").trim().replace(/\s*\n+\s*/g, " ");
    if (!text) {
      corrective = "you returned nothing.";
      continue;
    }
    const sentences = sentenceCount(text);
    if (sentences !== WEEK_SUMMARY_SENTENCES) {
      corrective = `you wrote ${sentences} sentences; write exactly ${WEEK_SUMMARY_SENTENCES}.`;
      continue;
    }
    const gate = groundingGate(payload, text);
    if (!gate.ok) {
      corrective = `these numbers are not in the DATA and must not appear: ${gate.offenders.join(", ")}.`;
      continue;
    }
    return { ok: true, text, attempts: attempt };
  }
  return {
    ok: false,
    reason: corrective ?? "unknown",
    attempts: 2,
  };
}
