import { BILL_TYPE_LABELS, STAGE_LABELS } from "@/lib/enums";

// HO 134: shared swatch constants for the dashboard color keys. STAGES feeds the
// StageKey panel key (HO 167; the TOPIC_GROUPS sibling was removed in HO 180 when
// the topic bubbles went per-color). Single source of truth — STAGE_LABELS /
// BILL_TYPE_LABELS feed the tooltip copy; CSS vars feed colors so palette tweaks
// stay in globals.css. Chips with
// no `prefix` render a small filled dot in the chip color; chips
// with a `prefix` render the prefix glyph instead (used for stages,
// where the arrow vocabulary doubles as the row-rail symbol).
export type Swatch = {
  label: string;
  color: string;
  prefix?: string;
  tooltip: string;
};

export const STAGES: Swatch[] = [
  { label: "INTRO", prefix: "▸", color: "var(--stage-introduced)", tooltip: STAGE_LABELS.introduced },
  { label: "COMMITTEE", prefix: "▸", color: "var(--stage-committee)", tooltip: STAGE_LABELS.committee },
  { label: "FLOOR", prefix: "▸▸", color: "var(--stage-floor)", tooltip: STAGE_LABELS.floor },
  { label: "OTHER CHAMBER", prefix: "▸▸▸", color: "var(--stage-other-chamber)", tooltip: STAGE_LABELS.other_chamber },
  { label: "PRESIDENT", prefix: "▸▸▸▸", color: "var(--stage-president)", tooltip: STAGE_LABELS.president },
  { label: "ENACTED", prefix: "✓", color: "var(--stage-enacted)", tooltip: STAGE_LABELS.enacted },
];

// HO 180: TOPIC_GROUPS (the 7-bucket topics legend) was removed — the Topic
// Distribution bubbles are now per-topic colored with a hover popover, so the
// group legend is both wrong and redundant. STAGES stays (funnel legend).

export const PARTIES: Swatch[] = [
  { label: "DEM", color: "var(--party-democrat)", tooltip: "Democrat" },
  { label: "REP", color: "var(--party-republican)", tooltip: "Republican" },
  { label: "IND", color: "var(--party-independent)", tooltip: "Independent" },
];

// Bill types are color-grouped by chamber-of-origin on the BillRow rail
// (cyan=House, purple=Senate). Each chip carries the type acronym readers
// actually see on a row, with the full-name tooltip from BILL_TYPE_LABELS.
const SENATE_TYPES = new Set(["s", "sres", "sjres", "sconres"]);
const BILL_TYPE_ORDER = [
  "s",
  "hr",
  "hjres",
  "sjres",
  "hres",
  "sres",
  "hconres",
  "sconres",
] as const;

export const BILL_TYPES: Swatch[] = BILL_TYPE_ORDER.map((t) => ({
  label: t.toUpperCase(),
  color: SENATE_TYPES.has(t) ? "var(--rail-senate)" : "var(--rail-house)",
  tooltip: BILL_TYPE_LABELS[t] ?? t.toUpperCase(),
}));
