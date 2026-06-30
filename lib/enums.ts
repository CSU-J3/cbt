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

// HO 383: deterministic stage from the bill's latest_action_text — the single
// source of truth for stage, ported from the LLM summarization prompt's stage
// rules (lib/summarize.ts SYSTEM_PROMPT). Both write paths now derive stage from
// this (summarize-runner's slot write; sync's gap-window refresh) instead of
// trusting the LLM's emitted `stage`, which only runs at summarize time and so
// leaves stored stage stale between an action advance and re-summarization (the
// 119-s-2393 "Presented to President." bill stuck at `floor`). Matching is
// case-insensitive; returns the FIRST rule that hits, in progression order.
//
// Pure function of the action text. The prompt's two monotonicity guards split:
// guard (b) — post-passage procedural motions imply a floor vote already
// happened, so never fall back below `floor` — is encoded here; guard (a) —
// never regress once advanced — is a cross-state concern enforced at the write
// sites (decideStage in summarize-runner; the monotonic guard in sync's upsert).
export function computeStage(latestActionText: string | null | undefined): Stage {
  const t = (latestActionText ?? "").toLowerCase();
  if (!t) return "introduced";

  // 1. signed into law
  if (t.includes("became public law") || t.includes("signed by president"))
    return "enacted";
  // 2. on the president's desk. "Presented to President." is the canonical
  // phrasing; the looser "to the President" alt excludes the Senate-officer
  // false positives ("President of the Senate", "President pro tempore").
  if (t.includes("presented to president")) return "president";
  if (
    t.includes("to the president") &&
    !t.includes("president of the senate") &&
    !t.includes("president pro tempore")
  )
    return "president";
  // 3. cleared both chambers
  const passedSenate = t.includes("passed senate");
  const passedHouse = t.includes("passed house");
  if (passedSenate && passedHouse) return "other_chamber";
  // 4. passed one chamber
  if (passedSenate || passedHouse) return "floor";
  // guard (b): a post-passage procedural motion means the chamber already
  // acted — classify `floor`, never the committee/introduced rules below.
  if (
    t.includes("motion to reconsider") ||
    t.includes("motion to table") ||
    t.includes("laid on the table")
  )
    return "floor";
  // 5. acted on in committee ("reported" also covers "Ordered Reported")
  if (t.includes("reported") || t.includes("committee consideration"))
    return "committee";
  // 6. referred in
  if (t.includes("referred to")) return "committee";
  // 7. default
  return "introduced";
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
