import { BILL_TYPE_LABELS, STAGE_LABELS } from "@/lib/enums";

// HO 131 + HO 133: read-only legend of every color in active use. Five
// sections: STAGES (6), TOPICS (8 color groups), PARTIES (3), BILL TYPES
// (8 chips on the 2-color chamber palette), and ACCENT (single-line note).
// Every chip gains a `title=` tooltip whose copy comes from the canonical
// source (STAGE_LABELS, BILL_TYPE_LABELS, hand-curated for topic groups
// and parties). Section spacing tightened in HO 133 so the block fits a
// header-band column at 1920x1080 without scroll.
type Swatch = {
  label: string;
  color: string;
  prefix?: string;
  tooltip: string;
};

const STAGES: Swatch[] = [
  { label: "INTRO", prefix: "▸", color: "var(--stage-introduced)", tooltip: STAGE_LABELS.introduced },
  { label: "COMMITTEE", prefix: "▸", color: "var(--stage-committee)", tooltip: STAGE_LABELS.committee },
  { label: "FLOOR", prefix: "▸▸", color: "var(--stage-floor)", tooltip: STAGE_LABELS.floor },
  { label: "OTHER CHAMBER", prefix: "▸▸▸", color: "var(--stage-other-chamber)", tooltip: STAGE_LABELS.other_chamber },
  { label: "PRESIDENT", prefix: "▸▸▸▸", color: "var(--stage-president)", tooltip: STAGE_LABELS.president },
  { label: "ENACTED", prefix: "✓", color: "var(--stage-enacted)", tooltip: STAGE_LABELS.enacted },
];

const TOPIC_GROUPS: Swatch[] = [
  {
    label: "FIN/COMM",
    color: "#a78bfa",
    tooltip: "Financial services · taxes · budget · trade · consumer protection",
  },
  { label: "TECH", color: "#22d3ee", tooltip: "Technology" },
  {
    label: "DEF/FOR",
    color: "#34d399",
    tooltip: "Defense · foreign policy · veterans",
  },
  {
    label: "ENV/ENERGY",
    color: "#65a30d",
    tooltip: "Environment · energy · agriculture",
  },
  {
    label: "SOC/LABOR",
    color: "#f472b6",
    tooltip: "Healthcare · education · labor · housing · social security",
  },
  {
    label: "JUSTICE",
    color: "#fb7185",
    tooltip: "Civil rights · criminal justice · immigration · elections",
  },
  {
    label: "INFRA/GOV",
    color: "#f59e0b",
    tooltip: "Transportation · government operations",
  },
  { label: "OTHER", color: "#6b7280", tooltip: "Catchall for unclassified" },
];

const PARTIES: Swatch[] = [
  { label: "DEM", color: "var(--party-democrat)", tooltip: "Democrat" },
  { label: "REP", color: "var(--party-republican)", tooltip: "Republican" },
  { label: "IND", color: "var(--party-independent)", tooltip: "Independent" },
];

// Bill types are color-grouped by chamber-of-origin on the BillRow rail
// (cyan=House, purple=Senate). The 8 chips here share those 2 colors but
// each carries the type acronym readers actually see on a row, plus a
// full-name tooltip from BILL_TYPE_LABELS.
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
const BILL_TYPES: Swatch[] = BILL_TYPE_ORDER.map((t) => ({
  label: t.toUpperCase(),
  color: SENATE_TYPES.has(t) ? "var(--rail-senate)" : "var(--rail-house)",
  tooltip: BILL_TYPE_LABELS[t] ?? t.toUpperCase(),
}));

function Chip({ swatch }: { swatch: Swatch }) {
  return (
    <span
      className="color-key-chip"
      style={{ color: swatch.color }}
      title={swatch.tooltip}
      aria-label={swatch.tooltip}
    >
      {swatch.prefix ? (
        <span aria-hidden>{swatch.prefix} </span>
      ) : (
        <span
          className="color-key-dot"
          style={{ backgroundColor: swatch.color }}
          aria-hidden
        />
      )}
      {swatch.label}
    </span>
  );
}

function Section({
  heading,
  subhead,
  items,
}: {
  heading: string;
  subhead?: string;
  items: Swatch[];
}) {
  return (
    <div className="color-key-section">
      <p className="color-key-heading">
        {heading}
        {subhead ? <span className="color-key-subhead"> · {subhead}</span> : null}
      </p>
      <div className="color-key-row">
        {items.map((s) => (
          <Chip key={s.label} swatch={s} />
        ))}
      </div>
    </div>
  );
}

export function ColorKey() {
  return (
    <div className="color-key">
      <Section heading="Stages" items={STAGES} />
      <Section heading="Topics" items={TOPIC_GROUPS} />
      <Section heading="Parties" items={PARTIES} />
      <Section
        heading="Bill Types"
        subhead="rail color = chamber-of-origin"
        items={BILL_TYPES}
      />
      <div className="color-key-section">
        <p className="color-key-heading">Accent</p>
        <p className="color-key-accent-note">
          <span style={{ color: "var(--accent-amber)" }}>▸ AMBER</span>{" "}
          <span style={{ color: "var(--text-muted)" }}>
            = active filter or clickable highlight
          </span>
        </p>
      </div>
    </div>
  );
}
