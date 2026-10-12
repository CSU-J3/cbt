// HO 759 — the incumbent tag's words, pure (no Next, no DB), so the server
// builders (lib/cartogram-data.ts's hover meta) and the client components
// (components/IncumbentTag.tsx, the district report's markdown) share one
// vocabulary. The rule that picks the qualifier is lib/incumbent-qualifier.ts.
// HO 779: every tag's words live here, the open row's holder line's too, and
// so does the one helper that applies the clock at the merge points.
import { daysToElection } from "./format";
import type { IncumbentQualifier, IncumbentReason, TagOutcome } from "./incumbent-qualifier";

export const REASON_TAG: Record<IncumbentReason, { text: string; title: string }> = {
  retiring: { text: "RETIRING", title: "Curated as not running for re-election" },
  withdrew: { text: "WITHDREW", title: "Listed as withdrawn or disqualified on a 2026 ballot (Ballotpedia)" },
  lost_primary: { text: "LOST PRIMARY", title: "Unmarked in a decided 2026 primary (Ballotpedia)" },
  absent: { text: "NOT ON THE BALLOT", title: "Not printed on this seat's 2026 ballot (Ballotpedia)" },
};

// "TX-37-2026" → "TX-37", "WY-AL-2026" → "WY-AL", "S-IA-2026" → "S-IA".
export const seatOf = (raceId: string) => raceId.replace(/-\d{4}$/, "");

// HO 779 (Corey's ruling): a `senate` or `moved` tag past election day says how
// its own race went, in the words `/electoral`'s member rows use, in capitals.
// `target` is the part a tag links (SENATE, the seat) wherever it links today.
const OUTCOME_WORDS: Record<"senate" | "moved", Record<TagOutcome | "running", [string, string | null]>> = {
  senate: {
    running: ["RUNNING FOR", null],
    elected: ["ELECTED TO THE", null],
    lost: ["LOST THE", "RACE"],
    runoff: ["IN THE", "RUNOFF"],
    out_of_runoff: ["OUT OF THE", "RUNOFF"],
  },
  moved: {
    running: ["RUNNING IN", null],
    elected: ["ELECTED IN", null],
    lost: ["LOST IN", null],
    runoff: ["IN THE", "RUNOFF"],
    out_of_runoff: ["OUT OF THE", "RUNOFF"],
  },
};

// The tag's words: what comes before the linked part, the linked part (null
// where the tag links nothing), and what follows it.
export type TagWords = { lead: string; target: string | null; tail: string | null };
export function tagWords(q: IncumbentQualifier): TagWords {
  if (q.kind === "moved" || q.kind === "senate") {
    const [lead, tail] = OUTCOME_WORDS[q.kind][q.outcome ?? "running"];
    return { lead, target: q.kind === "moved" ? seatOf(q.raceId) : "SENATE", tail };
  }
  // HO 779: unlinked; past election day RAN, since CBT reads no governor race.
  if (q.kind === "governor") return { lead: q.ran ? "RAN FOR GOVERNOR" : "RUNNING FOR GOVERNOR", target: null, tail: null };
  return { lead: REASON_TAG[q.reason].text, target: null, tail: null };
}

// The tag as plain text, for a surface that prints a string.
export function incumbentTagText(q: IncumbentQualifier): string {
  const w = tagWords(q);
  return [w.lead, w.target, w.tail].filter(Boolean).join(" ");
}

// The /electoral open row's holder line (components/RaceOpenRow.tsx): the same
// words in lower case. A seat button or link stands where `target` is, the
// Senate's being its state's "XX SEN" after the words: "elected to the Senate"
// AL SEN →, "in the" TX-37 "runoff".
const HOLDER_SENATE: Record<TagOutcome | "running", string> = {
  running: "running for Senate",
  elected: "elected to the Senate",
  lost: "lost the Senate race",
  runoff: "in the Senate runoff",
  out_of_runoff: "out of the Senate runoff",
};
const HOLDER_REASON: Record<IncumbentReason, string> = { retiring: "retiring", withdrew: "withdrew", lost_primary: "lost the primary", absent: "not on the ballot" };
export function holderWords(q: IncumbentQualifier): TagWords {
  if (q.kind === "senate") return { lead: HOLDER_SENATE[q.outcome ?? "running"], target: `${seatOf(q.raceId).replace(/^S-/, "")} SEN`, tail: null };
  if (q.kind === "moved") {
    const [lead, tail] = OUTCOME_WORDS.moved[q.outcome ?? "running"];
    return { lead: lead.toLowerCase(), target: seatOf(q.raceId), tail: tail?.toLowerCase() ?? null };
  }
  if (q.kind === "governor") return { lead: q.ran ? "ran for governor" : "running for governor", target: null, tail: null };
  return { lead: HOLDER_REASON[q.reason], target: null, tail: null };
}

// HO 779: THE CLOCK, applied on the server at the four merge points (the race
// page, /electoral, /'s competitive block, /welcome), by the race page's gate
// (lib/race-result.ts raceResultView): until election day has passed a tag
// says what it says today, whatever its race's marks; past it, the outcome
// the cached read carries, and a governor's tag RAN FOR GOVERNOR. Never in a
// client component (HO 490).
export function incumbentTagAt(q: IncumbentQualifier | null, cycle: number, nowMs: number): IncumbentQualifier | null {
  if (!q) return q;
  const passed = daysToElection(cycle, nowMs) < 0;
  if (q.kind === "governor") return passed ? { ...q, ran: true } : q;
  if (passed) return q;
  if ((q.kind === "moved" || q.kind === "senate") && q.outcome) {
    const { outcome: _outcome, ...today } = q;
    return today;
  }
  return q;
}
export function incumbentTagsAt(tags: Record<string, IncumbentQualifier>, cycle: number, nowMs: number): Record<string, IncumbentQualifier> {
  return Object.fromEntries(Object.entries(tags).map(([id, q]) => [id, incumbentTagAt(q, cycle, nowMs)!]));
}

// The compact surfaces' merge: their rows come from reads with their own cache
// tags (getRacesIndex's race-ratings/races), so the tag rides beside them from
// getIncumbentQualifiers rather than inside them.
export function withIncumbentTags<T extends { raceId: string }>(
  rows: T[],
  tags: Record<string, IncumbentQualifier>,
): (T & { incumbentTag: IncumbentQualifier | null })[] {
  return rows.map((r) => ({ ...r, incumbentTag: tags[r.raceId] ?? null }));
}
