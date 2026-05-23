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
