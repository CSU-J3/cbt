// HO 219: chamber-control hero band for /races (Variant A — single stat row).
// Pure server presentational component — the page fetches the data and passes
// it in. Static readout, no interactions.
//
// HO 767 (mock-767 v18, TOP none): two cells, KALSHI's HOUSE CONTROL and SENATE
// CONTROL. SEATS IN PLAY is gone (the tabs carry each chamber's count in LIST,
// the count line in MAP), and so is the band whenever it would hold nothing
// (C4): with no control market for either chamber it renders nothing, and with
// odds off the whole band hides (HO 692 site 9, the gate on the band itself).
import type { ChamberOdds, ChamberControl } from "@/lib/kalshi";

function partyColor(p: "D" | "R" | "I"): string {
  if (p === "R") return "var(--party-republican)";
  if (p === "D") return "var(--party-democrat)";
  return "var(--party-independent)";
}

// `→ {FAV} {NN}%  {OTHER} {NN}%` — favored party letter+pct in its color, the
// loser trailing in --text-dim. Data-driven: whichever pct is higher is the
// fav (the helper already ordered them), so a market flip re-colors for free.
function ControlValue({ odds }: { odds: ChamberOdds | null }) {
  if (!odds) {
    return (
      <span className="races-hero-val races-hero-val--empty">—</span>
    );
  }
  return (
    <span className="races-hero-val">
      <span aria-hidden style={{ color: "var(--text-dim)" }}>
        →{" "}
      </span>
      <span style={{ color: partyColor(odds.favParty) }}>
        {odds.favParty} {odds.favPct}%
      </span>
      <span style={{ color: "var(--text-dim)" }}>
        {"  "}
        {odds.otherParty} {odds.otherPct}%
      </span>
    </span>
  );
}

export function RacesHeroBand({ control }: { control: ChamberControl | null }) {
  if (!control?.house && !control?.senate) return null;
  return (
    // HO 692 site 9 — the KALSHI control cells, gated on the BAND, not on the
    // cells: with SEATS IN PLAY gone every cell is a market cell, and hiding
    // only the cells left the band's own border and panel as an empty strip
    // (C4). The band's parent is not a grid, so `display: none` re-flows
    // nothing; the HO 692 re-shape rule for the cells has retired with them.
    <div className="races-hero-band odds-only" data-market="kalshi">
      <div className="races-hero-cell">
        <div className="races-hero-cap">
          <span className="races-hero-kalshi">KALSHI</span>
          <span className="races-hero-label">HOUSE CONTROL</span>
          <span className="races-hero-live">LIVE</span>
        </div>
        <ControlValue odds={control?.house ?? null} />
      </div>

      <div className="races-hero-cell">
        <div className="races-hero-cap">
          <span className="races-hero-kalshi">KALSHI</span>
          <span className="races-hero-label">SENATE CONTROL</span>
        </div>
        <ControlValue odds={control?.senate ?? null} />
      </div>
    </div>
  );
}
