export const TOPIC_COLORS: Record<string, string> = {
  // Financial / commerce — purple
  financial_services: "#a78bfa",
  taxes: "#a78bfa",
  budget: "#a78bfa",
  trade: "#a78bfa",
  consumer_protection: "#a78bfa",

  // Tech — cyan
  technology: "#22d3ee",

  // Defense / foreign — teal
  defense: "#34d399",
  foreign_policy: "#34d399",
  veterans: "#34d399",

  // Environment / energy / agriculture — green
  environment: "#65a30d",
  energy: "#65a30d",
  agriculture: "#65a30d",

  // Social / labor — pink
  healthcare: "#f472b6",
  education: "#f472b6",
  labor: "#f472b6",
  housing: "#f472b6",
  social_security: "#f472b6",

  // Justice / civil — red-pink
  civil_rights: "#fb7185",
  criminal_justice: "#fb7185",
  immigration: "#fb7185",
  elections: "#fb7185",

  // Infrastructure / ops — amber
  transportation: "#f59e0b",
  government_operations: "#f59e0b",

  // Catchall
  other: "#6b7280",
};

export const TOPIC_LABELS: Record<string, string> = {
  healthcare: "HLTH",
  immigration: "IMM",
  taxes: "TAX",
  defense: "DEF",
  energy: "ENRG",
  environment: "ENV",
  education: "EDU",
  labor: "LAB",
  technology: "TECH",
  civil_rights: "CIV",
  criminal_justice: "CRIM",
  agriculture: "AGR",
  trade: "TRD",
  housing: "HSG",
  transportation: "TRNS",
  foreign_policy: "FOR",
  veterans: "VET",
  elections: "ELEC",
  budget: "BDGT",
  financial_services: "FIN",
  government_operations: "GOV",
  consumer_protection: "CONS",
  social_security: "SS",
  other: "OTHR",
};

export function topicColor(topic: string): string {
  return TOPIC_COLORS[topic] ?? TOPIC_COLORS.other!;
}

export function topicLabel(topic: string): string {
  return TOPIC_LABELS[topic] ?? topic.toUpperCase();
}
