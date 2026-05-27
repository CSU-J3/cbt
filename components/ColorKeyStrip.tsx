import {
  BILL_TYPES,
  PARTIES,
  STAGES,
  type Swatch,
  TOPIC_GROUPS,
} from "@/lib/color-key";

// Boxed top-right legend on the home header (home-dashboard-cleanup).
// Vertical row stack — each row = 52px label column + indicators that
// flow inside the right column and wrap when they overflow the box's
// inner width. 5 rows: STAGES, TOPICS, PARTIES, BILL TYPES, ACCENT.
// (HO 134 added BILL TYPES; kept here even though the cleanup handoff
// originally listed 4 rows — corrected scope per session decision.)
//
// Replaces the prior horizontal `.color-key-strip` flow that sat
// full-width below the nav. Section labels stay tight in their column,
// chips wrap freely inside the box, no overflow past the box edge.
function Row({
  heading,
  items,
  subhead,
}: {
  heading: string;
  items: Swatch[];
  subhead?: string;
}) {
  return (
    <div className="color-key-row">
      <span className="color-key-row-label">
        {heading}
        {subhead ? (
          <span className="color-key-row-subhead"> {subhead}</span>
        ) : null}
      </span>
      <span className="color-key-row-indicators">
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
    </div>
  );
}

export function ColorKeyStrip() {
  return (
    <aside className="color-key-box" aria-label="Color key">
      <Row heading="STAGES" items={STAGES} />
      <Row heading="TOPICS" items={TOPIC_GROUPS} />
      <Row heading="PARTIES" items={PARTIES} />
      <Row heading="BILL TYPES" subhead="(rail)" items={BILL_TYPES} />
      <div className="color-key-row">
        <span className="color-key-row-label">ACCENT</span>
        <span className="color-key-row-indicators">
          <span
            className="color-key-strip-chip"
            style={{ color: "var(--accent-amber)" }}
            title="Active filter or clickable highlight"
            aria-label="Accent amber — active filter or clickable highlight"
          >
            <span aria-hidden>▸</span> AMBER
          </span>
        </span>
      </div>
    </aside>
  );
}
