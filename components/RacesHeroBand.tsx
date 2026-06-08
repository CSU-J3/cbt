// HO 219: chamber-control hero band for /races (Variant A — single stat row).
// Three cells: HOUSE CONTROL · SENATE CONTROL · SEATS IN PLAY. Pure server
// presentational component — the page fetches the data and passes it in.
// Static readout, no interactions. RACES route only (it's just not mounted on
// /primaries — separate route, no conditional needed).
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

export function RacesHeroBand({
  control,
  ratedCount,
  senateCount,
  houseCount,
}: {
  control: ChamberControl | null;
  ratedCount: number;
  senateCount: number;
  houseCount: number;
}) {
  return (
    <div className="races-hero-band">
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

      <div className="races-hero-cell">
        <div className="races-hero-cap">
          <span className="races-hero-label">SEATS IN PLAY</span>
        </div>
        <div className="races-hero-count">
          <span className="races-hero-bignum tabular-nums">{ratedCount}</span>
          <span className="races-hero-sub">rated</span>
        </div>
        <div className="races-hero-split tabular-nums">
          {senateCount} SEN · {houseCount} HOUSE
        </div>
      </div>
    </div>
  );
}
