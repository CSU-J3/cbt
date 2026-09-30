// HO 759 — the incumbent tag's words, pure (no Next, no DB), so the server
// builders (lib/cartogram-data.ts's hover meta) and the client components
// (components/IncumbentTag.tsx, the district report's markdown) share one
// vocabulary. The rule that picks the qualifier is lib/incumbent-qualifier.ts.
import type { IncumbentQualifier, IncumbentReason } from "./incumbent-qualifier";

export const REASON_TAG: Record<IncumbentReason, { text: string; title: string }> = {
  retiring: { text: "RETIRING", title: "Curated as not running for re-election" },
  withdrew: { text: "WITHDREW", title: "Listed as withdrawn or disqualified on a 2026 ballot (Ballotpedia)" },
  lost_primary: { text: "LOST PRIMARY", title: "Unmarked in a decided 2026 primary (Ballotpedia)" },
  absent: { text: "NOT ON THE BALLOT", title: "Not printed on this seat's 2026 ballot (Ballotpedia)" },
};

// "TX-37-2026" → "TX-37", "WY-AL-2026" → "WY-AL", "S-IA-2026" → "S-IA".
export const seatOf = (raceId: string) => raceId.replace(/-\d{4}$/, "");

// The tag as plain text, for a surface that prints a string.
export function incumbentTagText(q: IncumbentQualifier): string {
  if (q.kind === "moved") return `RUNNING IN ${seatOf(q.raceId)}`;
  if (q.kind === "senate") return "RUNNING FOR SENATE";
  return REASON_TAG[q.reason].text;
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
