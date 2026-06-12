export const ALLOWED_TOPICS = [
  "healthcare",
  "immigration",
  "taxes",
  "defense",
  "energy",
  "environment",
  "education",
  "labor",
  "technology",
  "civil_rights",
  "criminal_justice",
  "agriculture",
  "trade",
  "housing",
  "transportation",
  "foreign_policy",
  "veterans",
  "elections",
  "budget",
  "financial_services",
  "government_operations",
  "consumer_protection",
  "social_security",
  "other",
] as const;

export type Topic = (typeof ALLOWED_TOPICS)[number];
export const ALLOWED_TOPICS_SET = new Set<string>(ALLOWED_TOPICS);

// Confident aliases for LLM-suggested topic tags outside the canonical
// taxonomy (HO 121). Applied at summarize-time validation so a Gemini
// response carrying e.g. `public_health` lands as `healthcare` rather than
// getting dropped. Roadmap argument: comprehension over coverage — 22
// canonical topics is already busy, expanding the enum dilutes the existing
// color + abbreviation system. Aliases catch the *confident* cases; anything
// genuinely ambiguous (`animal_welfare`, `small_business`, `manufacturing`,
// `ethics`, `infrastructure`, `business`, `poverty`) keeps dropping with
// the `invalid-topic` logger so the recurrence count is the evidence for
// any future taxonomy decision.
export const TOPIC_ALIASES: Record<string, Topic> = {
  public_health: "healthcare",
  human_rights: "civil_rights",
  native_americans: "civil_rights",
  native_american_affairs: "civil_rights",
  disability_rights: "civil_rights",
  homeland_security: "defense",
  humanitarian_aid: "foreign_policy",
  urban_development: "housing",
  law_enforcement: "criminal_justice",
  food_security: "agriculture",
  occupational_safety_and_health: "labor",
};

export const ALLOWED_STAGES = [
  "introduced",
  "committee",
  "floor",
  "other_chamber",
  "president",
  "enacted",
] as const;

export type Stage = (typeof ALLOWED_STAGES)[number];
export const ALLOWED_STAGES_SET = new Set<string>(ALLOWED_STAGES);

// Canonical legislative-progression rank, derived from ALLOWED_STAGES order
// (introduced=0 → … → enacted=5). Single source of truth for "does stage B sit
// ahead of stage A in the pipeline" — used by the report's transition-direction
// copy (lib/report-generation.ts) and the HO 239 stage-monotonicity guard
// (lib/summarize-runner.ts). null/undefined/unlisted → -1.
export function stageRank(stage: string | null | undefined): number {
  if (stage == null) return -1;
  return ALLOWED_STAGES.indexOf(stage as Stage);
}

// Display-name maps used by native `title` attributes for readability (HO
// 123). Native tooltips are the right tool here — no JS, no a11y regression,
// and the same pattern HO 118's `[+N]` pill already established. Surfaces
// that need rich tooltip content (links, charts) would justify a real
// tooltip component; the maps below intentionally keep their values short
// enough for the browser default.

// Bill-type acronyms a new reader can't decode (HCONRES, HJRES, SJRES…).
// Matches the slug map in lib/format.ts but with display-name casing.
export const BILL_TYPE_LABELS: Record<string, string> = {
  hr: "House Bill",
  s: "Senate Bill",
  hjres: "House Joint Resolution",
  sjres: "Senate Joint Resolution",
  hconres: "House Concurrent Resolution",
  sconres: "Senate Concurrent Resolution",
  hres: "House Simple Resolution",
  sres: "Senate Simple Resolution",
};

// One short active-voice clause per stage — "what's happening to this bill,"
// not the abstract stage name. Matched to StageIndicator's six-stage
// vocabulary (introduced → enacted) so the tooltip explains the glyph the
// reader is looking at.
export const STAGE_LABELS: Record<Stage, string> = {
  introduced: "Introduced; filed but not yet referred to committee",
  committee: "In committee; under review",
  floor: "On the floor of the originating chamber",
  other_chamber: "Passed to the other chamber",
  president: "On the president's desk",
  enacted: "Enacted into law",
};

// Rating-source codes shown on race chips and competitive-races blocks.
// Keys match the `source` enum stored in race_ratings.source.
export const RACE_RATING_SOURCES: Record<string, string> = {
  cook: "Cook Political Report",
  sabato: "Sabato's Crystal Ball (UVA Center for Politics)",
  inside_elections: "Inside Elections with Nathan L. Gonzales",
};
