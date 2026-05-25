import {
  BILL_TYPES,
  PARTIES,
  STAGES,
  type Swatch,
  TOPIC_GROUPS,
} from "@/lib/color-key";

// HO 134 (+ amendment): persistent COLOR KEY strip rendered below the
// home nav row. Five sections — STAGES, TOPICS, PARTIES, BILL TYPES,
// ACCENT — flow as inline-flex clusters so each section's label stays
// tight against its chips while the outer strip wraps gracefully at
// narrow widths. Visual weight is subordinate to the nav (smaller
// font, dashed top border, muted section labels).
function Cluster({
  heading,
  items,
  subhead,
}: {
  heading: string;
  items: Swatch[];
  subhead?: string;
}) {
  return (
    <span className="color-key-strip-cluster">
      <span className="color-key-strip-section">
        {heading} →
        {subhead ? (
          <span className="color-key-strip-subhead"> {subhead}</span>
        ) : null}
      </span>
      {items.map((s) => (
        <span
          key={s.label}
          className="color-key-strip-chip"
          style={{ color: s.color }}
          title={s.tooltip}
          aria-label={s.tooltip}
        >
          {s.prefix ? (
            <span aria-hidden>{s.prefix}</span>
          ) : (
            <span
              className="color-key-strip-dot"
              style={{ backgroundColor: s.color }}
              aria-hidden
            />
          )}
          {s.label}
        </span>
      ))}
    </span>
  );
}

export function ColorKeyStrip() {
  return (
    <div className="color-key-strip" aria-label="Color key">
      <span className="color-key-strip-label">COLOR KEY</span>
      <Cluster heading="STAGES" items={STAGES} />
      <Cluster heading="TOPICS" items={TOPIC_GROUPS} />
      <Cluster heading="PARTIES" items={PARTIES} />
      <Cluster
        heading="BILL TYPES"
        subhead="(rail = chamber)"
        items={BILL_TYPES}
      />
      <span className="color-key-strip-cluster">
        <span className="color-key-strip-section">ACCENT →</span>
        <span
          className="color-key-strip-chip"
          style={{ color: "var(--accent-amber)" }}
          title="Active filter or clickable highlight"
          aria-label="Accent amber — active filter or clickable highlight"
        >
          <span aria-hidden>▸</span> AMBER
        </span>
        <span className="color-key-strip-note">
          = active filter / clickable
        </span>
      </span>
    </div>
  );
}
