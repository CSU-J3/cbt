// HO 131: dedicated home quadrant explaining every color in active use.
// Read-only signal — no click targets, no hover-state. Four sections:
//   STAGES — six --stage-* tokens with their funnel prefixes
//   TOPICS — eight color groups from lib/topic-colors.ts (rolled up;
//            the per-topic colors are aliased into 8 buckets there)
//   PARTIES — three --party-* tokens
//   ACCENT — --accent-amber meaning "active filter / clickable highlight"
//
// Each row is a flex-wrap of chips so the block reflows cleanly inside
// whatever width the quadrant lands at.
type Swatch = {
  label: string;
  color: string;
  prefix?: string;
};

const STAGES: Swatch[] = [
  { label: "INTRO", prefix: "▸", color: "var(--stage-introduced)" },
  { label: "COMMITTEE", prefix: "▸", color: "var(--stage-committee)" },
  { label: "FLOOR", prefix: "▸▸", color: "var(--stage-floor)" },
  { label: "OTHER CHAMBER", prefix: "▸▸▸", color: "var(--stage-other-chamber)" },
  { label: "PRESIDENT", prefix: "▸▸▸▸", color: "var(--stage-president)" },
  { label: "ENACTED", prefix: "✓", color: "var(--stage-enacted)" },
];

// Mirrors the bucket groupings in lib/topic-colors.ts. Labels list the
// member topics inline so a reader can match a colored topic-row on the
// feed back to its group without opening the source file.
const TOPIC_GROUPS: Swatch[] = [
  { label: "FIN/COMM", color: "#a78bfa" },
  { label: "TECH", color: "#22d3ee" },
  { label: "DEF/FOR", color: "#34d399" },
  { label: "ENV/ENERGY", color: "#65a30d" },
  { label: "SOC/LABOR", color: "#f472b6" },
  { label: "JUSTICE", color: "#fb7185" },
  { label: "INFRA/GOV", color: "#f59e0b" },
  { label: "OTHER", color: "#6b7280" },
];

const PARTIES: Swatch[] = [
  { label: "DEM", color: "var(--party-democrat)" },
  { label: "REP", color: "var(--party-republican)" },
  { label: "IND", color: "var(--party-independent)" },
];

function Chip({ swatch }: { swatch: Swatch }) {
  return (
    <span className="color-key-chip" style={{ color: swatch.color }}>
      {swatch.prefix ? <span aria-hidden>{swatch.prefix} </span> : (
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

function Section({ heading, items }: { heading: string; items: Swatch[] }) {
  return (
    <div className="color-key-section">
      <p className="color-key-heading">{heading}</p>
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
