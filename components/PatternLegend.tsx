// Static color-scale strip for the ranked bars (HO 347, was the bubble
// cluster). The encoding is "% of bills past committee" — flat gray for
// patterns that die in committee, saturating green for ones that actually
// move. Reads as the noise-vs-signal lens at a glance.
export function PatternLegend() {
  return (
    <div className="pattern-legend">
      <span>STALLED</span>
      <span
        className="gradient"
        aria-hidden
        style={{
          background:
            "linear-gradient(to right, #6b7280, #10b981)",
        }}
      />
      <span>MOVING</span>
      <span className="pattern-legend-hint">
        BAR LENGTH = BILL COUNT · COLOR = % PAST COMMITTEE
      </span>
    </div>
  );
}
