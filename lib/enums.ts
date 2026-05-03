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
