import { STAGES, type Swatch, TOPIC_GROUPS } from "@/lib/color-key";

// HO 179: the `?` LegendBadge was removed from the masthead (clutter — HO 167
// moved the stage/topic keys into the chart panels and the party-dot/bill-type
// meanings read as self-evident). This file now exports only StageKey/TopicKey.

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

// HO 167: the STAGES and TOPICS keys moved out of the (now-removed) dashboard
// footer into their own chart panels — STAGES under the Stage Distribution
// funnel, TOPICS under the Topic Distribution bubbles — so each key sits with
// the chart it decodes. Each is one `Row` inside a `.panel-key` footer strip.
// (The STAGES key earns its place beside the self-labeling funnel by
// documenting the ▸-glyph progression used on bill-row rails app-wide.)
export function StageKey() {
  return (
    <div className="panel-key" aria-label="Stage color key">
      <Row heading="STAGES" items={STAGES} />
    </div>
  );
}

export function TopicKey() {
  return (
    <div className="panel-key" aria-label="Topic color key">
      <Row heading="TOPICS" items={TOPIC_GROUPS} />
    </div>
  );
}
