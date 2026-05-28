import { Tooltip } from "@/components/Tooltip";
import { STAGES, type Swatch, TOPIC_GROUPS } from "@/lib/color-key";

// HO 150: the inline legend is trimmed to STAGES + TOPICS only; the `?`
// badge popover (HO 147) is now the canonical home for PARTIES, BILL
// TYPES, and ACCENT. Deleting BILL TYPES from the inline view also
// removes the prior wrap-clip glitch by construction.
const LEGEND_TOOLTIP_BODY =
  "R · D · I dots are party colors on member chips. Bill-type tags (HR, S, HJRES, SJRES…) mark each bill rail; amber ▸ marks the active filter or any clickable highlight.";

// Boxed top-right legend on the home header. Vertical row stack — each
// row = 52px label column + indicators that flow inside the right
// column and wrap when they overflow the box's inner width.
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
      <div className="color-key-header">
        <span className="color-key-header-label">LEGEND</span>
        <Tooltip
          variant="badge"
          ariaLabel="Show parties, bill types, and accent legend"
          content={{
            kind: "text",
            label: "PARTIES · BILL TYPES · ACCENT",
            body: LEGEND_TOOLTIP_BODY,
          }}
        />
      </div>
      <Row heading="STAGES" items={STAGES} />
      <Row heading="TOPICS" items={TOPIC_GROUPS} />
    </aside>
  );
}
