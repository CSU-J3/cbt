// HO 689 STEP 0 — READ-ONLY. The payload the three-sentence week summary would
// receive, real samples in two voices, and the grounding gate with its control.
//
// WRITES NOTHING — no DB writes, no files. It reads our own tables, prints the
// payload, optionally calls Gemini, and prints the gate verdict.
//
// THE GROUNDING RULE IS THE PRODUCT'S INTEGRITY, so it is mechanical rather than
// aspirational: every numeral in the generated text must already appear in the
// payload. The gate is built and CONTROLLED here (a deliberately corrupted
// output must go red) before anything is wired into the pipeline — an
// untriggered guard is unproven, not protection.
//
// WINDOW NOTE, and it is the STEP 0 finding this file exists to make concrete:
// the payload is a CALENDAR WEEK (matching `reports`), NOT the dashboard band's
// trailing-7d. The two disagree by construction and the numbers below prove it.
//
//   npx tsx scripts/diagnostic/week-summary-689.ts            # payloads only
//   npx tsx scripts/diagnostic/week-summary-689.ts --generate # + real samples
import "dotenv/config";
import { GoogleGenAI } from "@google/genai";
import { getDb } from "@/lib/db";
import { SUMMARY_MODEL } from "@/lib/summarize";
// HO 689 — IMPORTED, NOT MIRRORED. This file carried its own copies of the
// payload builder, the grounding gate and the sentence counter while it was the
// only implementation (STEP 0, before lib/week-summary.ts existed). Keeping them
// after the real module shipped would have made this a diagnostic pinning a
// verbatim copy of production logic with no compiler edge between them — the
// exact drift SKILL warns about, where a stale copy and a current one emit
// identical green. The controls below therefore exercise the SHIPPED gate.
import {
  buildWeekSummaryPayload,
  groundingGate,
  sentenceCount,
  type WeekSummaryPayload,
} from "@/lib/week-summary";

type Db = ReturnType<typeof getDb>;

type Payload = WeekSummaryPayload;

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
function monDd(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// ── the grounding gate ───────────────────────────────────────────────────────
//
// Every numeral in the output must appear in the payload. Bill ids are split on
// non-digits so "119-hr-1234" contributes 119, 1234 — a summary may cite a bill
// number it was given. Percent signs and commas are stripped before comparison
// so "16%" matches 16 and "1,234" matches 1234.
// ── sentence cap ─────────────────────────────────────────────────────────────
//
// REJECT, never truncate: cutting sentence 3 mid-thought is worse than absence,
// and a truncated summary still reads as a finished one.
const VOICES: { name: string; instruction: string }[] = [
  {
    name: "terminal-dry",
    instruction:
      "Voice: terminal-dry. Flat, factual, no adjectives of judgement, no scene-setting. " +
      "Read like an instrument reporting. Never use words like 'notably', 'significant', 'busy', 'quiet'.",
  },
  {
    name: "analyst-warm",
    instruction:
      "Voice: analyst-warm. Plain but human, the way a knowledgeable colleague would " +
      "summarize it aloud. Still no hype, no editorialising about whether anything is good or bad.",
  },
];

function buildPrompt(p: Payload, voice: string): string {
  return `You are writing a three-sentence summary of one week in the US Congress for a tracking dashboard.

HARD RULES:
- EXACTLY three sentences. Not two, not four.
- Use ONLY the numbers and names in the DATA below. Invent nothing.
- Every numeral you write must appear in the DATA. If you are unsure of a number, describe without it.
- No opening throat-clearing ("This week saw..."). Lead with what happened.
- Do not restate all the numbers; pick what carries the week.
${voice}

DATA (week of ${p.weekLabel}, ${p.weekStart} to ${p.weekEnd}):
${JSON.stringify(p, null, 2)}

Respond with the three sentences and nothing else.`;
}

async function main() {
  const db = getDb();
  const doGenerate = process.argv.includes("--generate");

  // The last three COMPLETED calendar weeks that have a reports row.
  const rs = await db.execute(
    "SELECT slug FROM reports ORDER BY week_start DESC LIMIT 3",
  );
  const weeks = rs.rows.map((r) => String(r.slug));

  console.log("HO 689 STEP 0 — week-summary payloads");
  console.log(`  weeks: ${weeks.join(", ")}   model: ${SUMMARY_MODEL}\n`);

  const client = doGenerate
    ? new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? "" })
    : null;

  for (const w of weeks) {
    const p = await buildWeekSummaryPayload(db, w);
    console.log(`══ week ${w} (${p.weekLabel}) ══`);
    console.log(JSON.stringify(p, null, 2));

    if (!client) {
      console.log("");
      continue;
    }
    for (const v of VOICES) {
      const t0 = Date.now();
      const res = await client.models.generateContent({
        model: SUMMARY_MODEL,
        contents: buildPrompt(p, v.instruction),
        config: { thinkingConfig: { thinkingBudget: 0 } },
      });
      const text = (res.text ?? "").trim();
      const gate = groundingGate(p, text);
      const um = res.usageMetadata;
      console.log(`\n  ── voice: ${v.name}  (${Date.now() - t0}ms)`);
      console.log(`  ${text.replace(/\n+/g, "\n  ")}`);
      console.log(
        `  sentences=${sentenceCount(text)}  gate=${gate.ok ? "PASS" : `FAIL offenders=[${gate.offenders.join(", ")}]`}` +
          `  tokens in/out=${um?.promptTokenCount ?? "?"}/${um?.candidatesTokenCount ?? "?"}`,
      );
    }
    console.log("");
  }

  // ── the gate's control: a deliberately corrupted output MUST go red ────────
  if (weeks.length > 0) {
    const p = await buildWeekSummaryPayload(db, weeks[0]!);
    const corrupt =
      "Congress introduced 9999 bills this week and enacted 4242 of them. " +
      "The Senate held 777 hearings. Nothing else moved.";
    const g = groundingGate(p, corrupt);
    console.log("=== GATE CONTROL (corrupted output, must FAIL) ===");
    console.log(`  text: ${corrupt}`);
    console.log(`  verdict: ${g.ok ? "PASS — CONTROL BROKEN, gate is not a gate" : `FAIL (correct) offenders=[${g.offenders.join(", ")}]`}`);
    const clean = `Introductions ran to ${p.billsIntroduced} for the week.`;
    const g2 = groundingGate(p, clean);
    console.log(`  known-good: "${clean}" → ${g2.ok ? "PASS (correct)" : `FAIL offenders=[${g2.offenders.join(", ")}]`}`);
  }
}

main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
