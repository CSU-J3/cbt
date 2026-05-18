// Best-effort matcher for FMP-supplied congressional names to bioguide ids
// (handoff 70). Three layers in order; the strategy intentionally errs on
// the side of returning null rather than risk misattribution. After the
// first sync, audit unmatched rows with
// `SELECT * FROM stock_trades WHERE bioguide_id IS NULL` and decide if
// the matcher needs additional rules.

const SUFFIXES = new Set(["jr", "sr", "ii", "iii", "iv"]);
const PREFIXES = new Set([
  "sen",
  "sen.",
  "senator",
  "rep",
  "rep.",
  "representative",
  "hon",
  "hon.",
  "honorable",
  "dr",
  "dr.",
  "mr",
  "mr.",
  "mrs",
  "mrs.",
  "ms",
  "ms.",
]);

function stripPunctuation(s: string): string {
  return s.replace(/[.,'`"!?()\[\]]/g, " ");
}

// Normalize to a list of lowercase tokens minus titles/suffixes. Used both
// to build the comparison key and to extract last names.
function normalizeTokens(raw: string): string[] {
  const cleaned = stripPunctuation(raw).toLowerCase();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  // Drop honorifics anywhere they appear (covers "Sen. John Doe" and
  // "John Doe Jr.").
  return tokens.filter((t) => !PREFIXES.has(t) && !SUFFIXES.has(t));
}

// FMP sometimes returns names as "Last, First" (Senate filings) and
// sometimes as "First Last" (House feeds). Normalize both to first-last
// order so downstream comparison is a single string.
function rebalanceFirstLast(rawName: string): string {
  const commaIdx = rawName.indexOf(",");
  if (commaIdx === -1) return rawName;
  const last = rawName.slice(0, commaIdx).trim();
  const rest = rawName.slice(commaIdx + 1).trim();
  return `${rest} ${last}`;
}

function exactKey(rawName: string): string {
  return normalizeTokens(rebalanceFirstLast(rawName)).join(" ");
}

function lastNameOf(rawName: string): string | null {
  const tokens = normalizeTokens(rebalanceFirstLast(rawName));
  if (tokens.length === 0) return null;
  return tokens[tokens.length - 1] ?? null;
}

export type MatchableMember = {
  bioguide_id: string;
  first_name: string | null;
  last_name: string | null;
  state: string | null;
  chamber: string | null;
};

export function matchMemberName(
  rawName: string,
  members: MatchableMember[],
  chamber: "senate" | "house",
  stateHint?: string | null,
): string | null {
  const target = exactKey(rawName);
  if (!target) return null;
  const targetLast = lastNameOf(rawName);
  const chamberMembers = members.filter((m) => m.chamber === chamber);

  // Layer 1: normalized exact "first last" match within chamber.
  for (const m of chamberMembers) {
    const first = (m.first_name ?? "").trim();
    const last = (m.last_name ?? "").trim();
    if (!first || !last) continue;
    const candidate = exactKey(`${first} ${last}`);
    if (candidate === target) return m.bioguide_id;
  }

  // Layer 2: last name unique within chamber.
  if (targetLast) {
    const byLast = chamberMembers.filter(
      (m) => exactKey(m.last_name ?? "") === targetLast,
    );
    if (byLast.length === 1 && byLast[0]) return byLast[0].bioguide_id;

    // Layer 3: last name + state hint (FMP `office` sometimes carries state).
    if (byLast.length > 1 && stateHint) {
      const normHint = stateHint.trim().toUpperCase();
      const byState = byLast.filter(
        (m) => (m.state ?? "").toUpperCase() === normHint,
      );
      if (byState.length === 1 && byState[0]) return byState[0].bioguide_id;
    }
  }

  return null;
}
