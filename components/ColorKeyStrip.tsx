import { STAGES, type Swatch } from "@/lib/color-key";

// HO 179: the `?` LegendBadge was removed from the masthead (clutter — HO 167
// moved the stage/topic keys into the chart panels and the party-dot/bill-type
// meanings read as self-evident). HO 180 removed the TOPICS key too (bubbles are
// now per-topic colored with a hover popover). This file exports only StageKey.

// One legend row = 52px label column + indicators that flow in the second
// column and wrap when they overflow the available width.
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

// HO 167: the STAGES key moved out of the (now-removed) dashboard footer into
// its own chart panel — under the Stage Distribution funnel — as one `Row`
// inside a `.panel-key` strip. (It earns its place beside the self-labeling
// funnel by documenting the ▸-glyph progression used on bill-row rails app-
// wide.) The TOPICS sibling was removed in HO 180.
export function StageKey() {
  return (
    <div className="panel-key" aria-label="Stage color key">
      <Row heading="STAGES" items={STAGES} />
    </div>
  );
}
