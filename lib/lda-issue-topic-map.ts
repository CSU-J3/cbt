// HO 444 — the CBT-topic crosswalk for LDA lobbying issue codes. Maps LDA's
// `general_issue_code` values (the ~79-code Senate LDA taxonomy) onto CBT's 24
// `Topic` union so the /lobbying corpus can be expressed in the SAME vocabulary
// as the dashboard's bill-topic distribution — the first time "what's lobbied"
// and "what's legislated" are readable in one set of units.
//
// This is a PARALLEL, additive lens, NOT a replacement for the native issue
// bars (HO 437/442 kept those deliberately un-crosswalked because the mapping is
// lossy). The lossiness is disclosed by showing both side by side.
//
// Authoring rule (mirrors the TOPIC_ALIASES "comprehension over coverage"
// philosophy in enums.ts): map a code to a CBT policy topic only when the code's
// subject IS that policy area; route genuine industry/profession sectors and
// truly-contested codes to `other` rather than forcing a bad fit. Every code
// maps to something (a confident topic or `other`), so nothing silently drops.
// The domain below is the ACTUAL corpus domain (79 codes present in
// lda_activities as of the HO 444 recon), not the theoretical LDA list.
//
// Debatable calls carry a one-line comment. `elections` has no member here on
// purpose: no LDA issue code corresponds to it (campaign/election law isn't a
// registered-lobbying issue area) — an honest gap, not a forcing.
import type { Topic } from "./enums";

export const LDA_ISSUE_TO_TOPIC: Record<string, Topic> = {
  // --- Confident, direct maps ---
  BUD: "budget", // Budget/Appropriations
  TAX: "taxes", // Taxation/Internal Revenue Code
  HCR: "healthcare", // Health Issues
  MMM: "healthcare", // Medicare/Medicaid
  PHA: "healthcare", // Pharmacy
  MED: "healthcare", // Medical/Disease Research/Clinical Labs
  DEF: "defense", // Defense
  HOM: "defense", // Homeland Security (matches the homeland_security topic alias)
  TRD: "trade", // Trade (domestic/foreign)
  TAR: "trade", // Tariff (miscellaneous tariff bills)
  ENG: "energy", // Energy/Nuclear
  FUE: "energy", // Fuel/Gas/Oil
  TRA: "transportation", // Transportation
  AVI: "transportation", // Aviation/Airlines/Airports
  RRR: "transportation", // Railroads
  ROD: "transportation", // Roads/Highway
  TRU: "transportation", // Trucking/Shipping
  EDU: "education", // Education
  AGR: "agriculture", // Agriculture
  ENV: "environment", // Environment/Superfund
  CAW: "environment", // Clean Air and Water (quality)
  WAS: "environment", // Waste (hazardous/solid/interstate/nuclear)
  FIN: "financial_services", // Financial Institutions/Investments/Securities
  BAN: "financial_services", // Banking
  BNK: "financial_services", // Bankruptcy
  LBR: "labor", // Labor Issues/Antitrust/Workplace
  SCI: "technology", // Science/Technology
  CPI: "technology", // Computer Industry
  GOV: "government_operations", // Government Issues
  HOU: "housing", // Housing
  URB: "housing", // Urban Development/Municipalities (matches urban_development alias)
  CSP: "consumer_protection", // Consumer Issues/Safety/Products
  IMM: "immigration", // Immigration
  LAW: "criminal_justice", // Law Enforcement/Crime/Criminal Justice
  FOR: "foreign_policy", // Foreign Relations
  VET: "veterans", // Veterans
  CIV: "civil_rights", // Civil Rights/Civil Liberties
  IND: "civil_rights", // Indian/Native American Affairs (matches native_americans alias)

  // --- Debatable calls (routed deliberately to the closest single CBT home) ---
  INT: "defense", // Intelligence — the intelligence community reads as national security → defense
  TEC: "technology", // Telecommunications — telecom infrastructure/policy → technology (no telecom topic)
  CPT: "technology", // Copyright/Patent/Trademark — IP/patent has a real tech home (patents, software IP)
  NAT: "environment", // Natural Resources — public-lands/conservation → environment (no natural-resources topic)
  UTI: "energy", // Utilities — electric/gas utilities dominate → energy (water is the stretch)
  RES: "housing", // Real Estate/Land Use/Conservation — real-estate/land-use lead → housing
  INS: "financial_services", // Insurance — general insurance is a financial service (health-ins would be healthcare)
  CDT: "financial_services", // Commodities (big ticket) — commodity markets/CFTC → financial_services over ag
  MON: "financial_services", // Minting/Money/Gold Standard — currency/monetary policy → financial_services
  FOO: "agriculture", // Food Industry (safety/labeling) — food system → agriculture (consumer_protection is the alt)
  FIR: "criminal_justice", // Firearms/Guns/Ammunition — gun policy → criminal_justice (2A-as-civil-liberty is the alt)
  ALC: "healthcare", // Alcohol and Drug Abuse — substance abuse reads as public health → healthcare
  FAM: "healthcare", // Family issues/Abortion/Adoption — family/adoption/family-medical → healthcare as the closest single home
  RET: "social_security", // Retirement — retirement/pension security → CBT's social_security bucket
  UNM: "labor", // Unemployment — jobless/unemployment insurance → labor (workforce)
  REL: "civil_rights", // Religion — religious liberty → civil_rights
  DIS: "government_operations", // Disaster Planning/Emergencies — FEMA/emergency management → government_operations
  CON: "government_operations", // Constitution — structural/constitutional issues → government_operations
  POS: "government_operations", // Postal — USPS, a government entity → government_operations
  DOC: "government_operations", // District of Columbia — DC governance → government_operations

  // --- Routed to `other`: industry/profession sectors with no CBT policy-topic
  // home, plus genuinely-contested codes. Comprehension over coverage — not forced. ---
  MAN: "other", // Manufacturing — a sector, not a policy topic (explicit ambiguous in enums.ts)
  SMB: "other", // Small Business — explicit ambiguous in enums.ts; no CBT home
  ECN: "other", // Economics/Economic Development — broad macro, no single CBT home
  MAR: "other", // Marine/Maritime/Boating/Fisheries — maritime + fisheries mix, no clean home
  COM: "other", // Communications/Broadcasting/Radio/TV — media/broadcasting, no CBT media topic
  AER: "other", // Aerospace — spans defense + aviation + manufacturing, no single home
  AUT: "other", // Automotive Industry — a sector, no CBT home
  CHM: "other", // Chemicals/Chemical Industry — a sector (regulation leans environment), no home
  ANI: "other", // Animals — animal_welfare is explicit ambiguous in enums.ts
  SPO: "other", // Sports/Athletics — a sector, no CBT home
  TOB: "other", // Tobacco — a sector, no CBT home
  TOU: "other", // Travel/Tourism — a sector, no CBT home
  GAM: "other", // Gaming/Gambling/Casino — a sector, no CBT home
  ART: "other", // Arts/Entertainment — media-adjacent, no CBT home
  ACC: "other", // Accounting — a profession, not a policy topic
  TOR: "other", // Torts — tort/litigation reform, no CBT home
  WEL: "other", // Welfare — safety-net programs; no CBT welfare/poverty topic (poverty is ambiguous in enums.ts)
  BEV: "other", // Beverage Industry — a sector, no CBT home
  MIA: "other", // Media (information/publishing) — no CBT media topic
  ADV: "other", // Advertising — a sector, no CBT home
  APP: "other", // Apparel/Clothing Industry/Textiles — a sector, no CBT home
};

// Map one LDA general_issue_code to its CBT Topic. Unknown codes (a code that
// appears in a future corpus but isn't in the map above) fall to `other`, so
// nothing ever silently drops — the crosswalk's coverage assert guards against
// a new code slipping in un-reviewed.
export function topicForCode(code: string): Topic {
  return LDA_ISSUE_TO_TOPIC[code] ?? "other";
}
