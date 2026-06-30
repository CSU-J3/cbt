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
// Floor-rung semantics (resolved in HO 385): `floor` means a bill PASSED (or had
// a recorded vote/motion on) its originating chamber's floor — NOT merely "reached
// floor stage". This is consistent with the existing "Passed House/Senate" → floor
// and "Reported" → committee rules, and with how the LLM majority-stored these
// texts. So calendar placement (reported-out, awaiting a floor vote) maps to
// `committee`, not `floor`.
export function computeStage(latestActionText: string | null | undefined): Stage {
  const t = (latestActionText ?? "").toLowerCase();
  if (!t) return "introduced";

  // 1. signed into law. HO 385: "Became Private Law" is also enacted law (a
  // private law is narrow but still enacted) — the LLM stored these enacted.
  if (
    t.includes("became public law") ||
    t.includes("became private law") ||
    t.includes("signed by president")
  )
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
  // 3. passed to the other chamber.
  const passedSenate = t.includes("passed senate");
  const passedHouse = t.includes("passed house");
  if (passedSenate && passedHouse) return "other_chamber";
  // HO 385: cross-chamber receipt. A measure "Received in the Senate/House" was
  // passed by its originating chamber and is now before the second chamber, so it
  // has passed to the other chamber. 384's would-regress review showed the LLM
  // under-read these as floor/committee. Sits above the floor + committee rules so
  // a trailing "...and referred to the Committee on X" can't pin it to committee.
  if (t.includes("received in the senate") || t.includes("received in the house"))
    return "other_chamber";
  // 4. acted on the originating chamber's floor.
  if (passedSenate || passedHouse) return "floor";
  // guard (b): a post-passage procedural motion means the chamber already
  // acted — classify `floor`, never the committee/introduced rules below.
  if (
    t.includes("motion to reconsider") ||
    t.includes("motion to table") ||
    t.includes("laid on the table")
  )
    return "floor";
  // HO 385: floor-stage dispositions the rules above miss. A resolution "agreed
  // to" on the floor, a suspension-of-the-rules passage vote, a cloture or
  // motion-to-proceed vote, and a failed passage are all floor votes/motions.
  if (
    t.includes("considered, and agreed to") ||
    t.includes("considered and agreed to") ||
    t.includes("agreed to in senate") ||
    t.includes("agreed to in house") ||
    t.includes("on agreeing to") ||
    t.includes("suspend the rules") ||
    t.includes("cloture") ||
    t.includes("motion to proceed") ||
    t.includes("failed of passage")
  )
    return "floor";
  // HO 385: "Held at the desk" implies the originating chamber passed the measure
  // (it has been messaged over). Conservatively `floor` — the bare phrase names no
  // chamber, so we do not assert other_chamber.
  if (t.includes("held at the desk")) return "floor";
  // 5. acted on in committee ("reported" also covers "Ordered Reported").
  if (t.includes("reported") || t.includes("committee consideration"))
    return "committee";
  // HO 385: committee-activity patterns the rules above miss. Calendar placement
  // (reported-out, per the floor-rung note); subcommittee activity; named-committee
  // actions ("Committee on X. Hearings held."); markups; discharge petitions (the
  // bill is still in committee). "committee on" is used rather than bare "committee"
  // so floor "Committee of the Whole" actions are not swept in.
  if (t.includes("placed on") && t.includes("calendar")) return "committee";
  if (t.includes("hearings held")) return "committee";
  if (t.includes("subcommittee")) return "committee";
  if (t.includes("committee on")) return "committee";
  if (t.includes("markup") || t.includes("mark up")) return "committee";
  if (t.includes("motion to discharge")) return "committee";
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
