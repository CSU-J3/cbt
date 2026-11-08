// Best-effort matcher from the names a disclosure feed prints to bioguide ids
// (handoff 70; source-neutral since HO 806). An alias table, then three layers
// in order; the strategy errs toward returning null rather than risk
// misattribution. Audit unmatched rows with
// `SELECT * FROM stock_trades WHERE bioguide_id IS NULL` and decide if the
// matcher needs additional rules.

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
// to build the comparison key and to extract last names. Accents fold before
// lower-casing (HO 806: a feed printing "Sanchez" meets `members`' "Sánchez"),
// so both sides of every comparison fold.
function normalizeTokens(raw: string): string[] {
  const cleaned = stripPunctuation(raw)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const tokens = cleaned.split(/\s+/).filter(Boolean);
  // Drop honorifics anywhere they appear (covers "Sen. John Doe" and
  // "John Doe Jr.").
  return tokens.filter((t) => !PREFIXES.has(t) && !SUFFIXES.has(t));
}

// A feed may print a name as "Last, First" or as "First Last". Normalize
// both to first-last order so downstream comparison is a single string.
function rebalanceFirstLast(rawName: string): string {
  const commaIdx = rawName.indexOf(",");
  if (commaIdx === -1) return rawName;
  const last = rawName.slice(0, commaIdx).trim();
  const rest = rawName.slice(commaIdx + 1).trim();
  return `${rest} ${last}`;
}

// HO 806: credentials a filer prints inside the name ("Neal Patrick MD, Facs
// Dunn"), each removed with the comma before it, so the comma rule above can't
// read them as "Last, First". `DO` is left out on purpose: Do is a surname.
const POST_NOMINALS =
  /(?:,\s*)?\b(?:M\.?D|F\.?A\.?C\.?[SPC]|Ph\.?D|D\.?D\.?S|D\.?M\.?D|D\.?V\.?M|J\.?D|Esq|C\.?P\.?A|M\.?B\.?A|R\.?N)\b\.?/gi;

export function stripPostNominals(raw: string): string {
  return raw.replace(POST_NOMINALS, "").replace(/\s+/g, " ").trim();
}

function tokensOf(rawName: string): string[] {
  return normalizeTokens(rebalanceFirstLast(stripPostNominals(rawName)));
}

function exactKey(rawName: string): string {
  return tokensOf(rawName).join(" ");
}

function lastNameOf(rawName: string): string | null {
  const tokens = tokensOf(rawName);
  if (tokens.length === 0) return null;
  return tokens[tokens.length - 1] ?? null;
}

// HO 806: for a source that prints a member without a surname. Keyed
// `${chamber}|${STATE}|${exactKey(raw)}` and mapped to a name the layers below
// place; applied before Layer 1.
export const NAME_ALIASES: Readonly<Record<string, string>> = {
  // CapitolStockWatch files Mitch McConnell under his legal first names (HO 805).
  "senate|KY|a mitchell": "Mitch McConnell",
};

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
  const hint = (stateHint ?? "").trim().toUpperCase();
  const name = NAME_ALIASES[`${chamber}|${hint}|${exactKey(rawName)}`] ?? rawName;
  const target = exactKey(name);
  if (!target) return null;
  const targetLast = lastNameOf(name);
  const chamberMembers = members.filter((m) => m.chamber === chamber);

  // Layer 1: normalized exact "first last" match within chamber.
  for (const m of chamberMembers) {
    const first = (m.first_name ?? "").trim();
    const last = (m.last_name ?? "").trim();
    if (!first || !last) continue;
    const candidate = exactKey(`${first} ${last}`);
    if (candidate === target) return m.bioguide_id;
  }

  // Layer 2: the surname as the tail of the raw name's tokens, one token or
  // several ("van epps", "mcclain delaney", HO 806). The longest surname that
  // matches wins; one candidate matches. A one-token surname reads as it did
  // before HO 806: unique within the chamber.
  if (targetLast) {
    const rawTokens = tokensOf(name);
    let byLast: MatchableMember[] = [];
    let longest = 0;
    for (const m of chamberMembers) {
      const surname = tokensOf(m.last_name ?? "");
      const k = surname.length;
      if (k === 0 || k > rawTokens.length || surname[k - 1] !== targetLast) continue;
      const offset = rawTokens.length - k;
      if (!surname.every((t, i) => t === rawTokens[offset + i])) continue;
      if (k > longest) {
        byLast = [m];
        longest = k;
      } else if (k === longest) {
        byLast.push(m);
      }
    }
    if (byLast.length === 1 && byLast[0]) return byLast[0].bioguide_id;

    // Layer 3: several surnames tie; the state hint (the feed's state, passed
    // by the ingest) picks one.
    if (byLast.length > 1 && hint) {
      const byState = byLast.filter(
        (m) => (m.state ?? "").toUpperCase() === hint,
      );
      if (byState.length === 1 && byState[0]) return byState[0].bioguide_id;
    }
  }

  return null;
}
