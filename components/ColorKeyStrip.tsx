import { Tooltip } from "@/components/Tooltip";
import { STAGES, type Swatch, TOPIC_GROUPS } from "@/lib/color-key";

// HO 150: the inline legend is trimmed to STAGES + TOPICS only; the `?`
// badge popover (HO 147) is now the canonical home for PARTIES, BILL
// TYPES, and ACCENT. Deleting BILL TYPES from the inline view also
// removes the prior wrap-clip glitch by construction.
const LEGEND_TOOLTIP_BODY =
  "R · D · I dots are party colors on member chips. Bill-type tags (HR, S, HJRES, SJRES…) mark each bill rail; amber ▸ marks the active filter or any clickable highlight.";

// HO 162: standalone text-only `?` badge for the dashboard header. When the
// full STAGES/TOPICS legend moved to the footer, this kept above-the-fold
// quick reference for PARTIES / BILL TYPES / ACCENT without duplicating the
// swatch grid — deliberately not extended to render swatches (a short scroll
// to the footer covers STAGES/TOPICS).
export function LegendBadge() {
  return (
    <Tooltip
      variant="badge"
      ariaLabel="Show parties, bill types, and accent legend"
      content={{
        kind: "text",
        label: "PARTIES · BILL TYPES · ACCENT",
        body: LEGEND_TOOLTIP_BODY,
      }}
    />
  );
}

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

// HO 162: relocated from the masthead's boxed top-right rail to a full-width
// muted footer at the bottom of the scrollable dashboard. STAGES + TOPICS
// swatch rows only; PARTIES / BILL TYPES / ACCENT live behind the header's
// LegendBadge now, so the LEGEND header + `?` badge no longer ride here.
export function ColorKeyStrip() {
  return (
    <div className="color-key-footer" aria-label="Color key">
      <Row heading="STAGES" items={STAGES} />
      <Row heading="TOPICS" items={TOPIC_GROUPS} />
    </div>
  );
}
