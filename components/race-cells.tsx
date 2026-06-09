// HO 222: shared presentational cells for the /races MAP card + LIST. Pure
// (no hooks/state) so both the client RaceMapCard and the client RaceListView
// import them; each maps its own row shape to the primitive props. Color/party/
// Kalshi resolution lives in lib/race-colors.ts.
import { formatDollarsCompact } from "@/lib/format";
import type { KalshiOdds } from "@/lib/kalshi";
import type { PartyKey } from "@/lib/queries";
import {
  kalshiActive,
  partyColor,
  partyWord,
  ratingColor,
  resolveKalshiFavoriteParty,
  type RosterEntry,
  surname,
} from "@/lib/race-colors";

// HO 214: 2024 House general-election margin bar. `margin` is SIGNED pct points
// — positive = R-won, negative = D-won. Magnitude drives width; winner party
// drives color + label. null → render nothing (Senate / RCV / unresolved).
export function MarginBar({ margin }: { margin: number | null | undefined }) {
  if (margin == null || !Number.isFinite(margin)) return null;
  const mag = Math.abs(margin);
  const party: PartyKey = margin > 0 ? "R" : "D";
  const even = mag < 0.1; // only a true tie reads EVEN; a 0.2-pt win shows R+0.2
  const color = even ? "var(--text-muted)" : partyColor(party);
  const label = even ? "EVEN" : `${party}+${mag.toFixed(1)}`;
  const width = Math.min(100, Math.max(2, mag * 5)); // ~20pts fills the track
  return (
    <div
      className="racecard-margin"
      title="2024 general-election margin (winner − runner-up)"
    >
      <span className="racecard-margin-tag">2024</span>
      <span className="racecard-margin-track" aria-hidden>
        <span
          className="racecard-margin-fill"
          style={{ width: `${width}%`, background: color }}
        />
      </span>
      <span className="racecard-margin-val" style={{ color }}>
        {label}
      </span>
    </div>
  );
}

// HO 218: per-seat Kalshi market line. Named-favorite with a party degrade.
// Party-labeled market → "KALSHI · Dem 72%"; name-labeled → surname, party
// resolved against the roster for color else neutral; null/closed → nothing.
export function KalshiLine({
  odds,
  roster,
}: {
  odds: KalshiOdds | null | undefined;
  roster: RosterEntry[];
}) {
  if (!kalshiActive(odds)) return null;
  const party = resolveKalshiFavoriteParty(odds, roster);
  const text = odds.favoriteIsParty
    ? party
      ? partyWord(party)
      : odds.favoriteLabel
    : surname(odds.favoriteLabel);
  const color = party ? partyColor(party) : "var(--text-secondary)";
  return (
    <div
      className="racecard-kalshi"
      title={`Kalshi market — ${odds.favoriteLabel} ${odds.impliedPct}% implied probability`}
    >
      <span className="racecard-kalshi-tag">KALSHI</span>
      <span className="racecard-kalshi-val" style={{ color }}>
        {text} <span className="tabular-nums">{odds.impliedPct}%</span>
      </span>
    </div>
  );
}

// HO 222: 3-segment rater spread, fixed order Cook · Sabato · Inside Elections,
// each segment colored by THAT rater's own rating (lean-only palette). Three
// matching = consensus; an outlier segment = a rater dissents on direction.
// Missing rater → the segment is --bg-base (empty slot) so a half-rated seat
// reads as partial, not as data.
export function SpreadBar({
  cook,
  sabato,
  ie,
}: {
  cook: string | null;
  sabato: string | null;
  ie: string | null;
}) {
  const segs = [
    { src: "Cook", rating: cook },
    { src: "Sabato", rating: sabato },
    { src: "Inside Elections", rating: ie },
  ];
  return (
    <span
      className="race-spread"
      title={segs.map((s) => `${s.src}: ${s.rating ?? "—"}`).join(" · ")}
    >
      {segs.map((s) => (
        <span
          key={s.src}
          className="race-spread-seg"
          style={{
            background: s.rating ? ratingColor(s.rating) : "var(--bg-base)",
          }}
        />
      ))}
    </span>
  );
}

// Incumbent cash-on-hand (FEC, cents). Shared formatter; the LIST renders it as
// a plain right-aligned column cell. null handled by the caller (omit).
export function formatCash(cents: number): string {
  return formatDollarsCompact(cents);
}
