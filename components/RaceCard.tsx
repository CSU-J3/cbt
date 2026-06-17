import Link from "next/link";
import { formatDollarsCompact } from "@/lib/format";
import type { PartyKey, RaceIndexRow } from "@/lib/queries";
import {
  kalshiActive,
  partyColor,
  ratingColor,
  resolveKalshiFavoriteParty,
  type RosterEntry,
  surname,
} from "@/lib/race-colors";
import {
  axisPos,
  divergenceChip,
  type MarketDot,
  marketRPos,
  ratingToAxisScore,
  resolveFavoriteParty,
} from "@/lib/race-spread";

// HO 260 — the v2 COMPETITIVE rich race card (the mock's `.race-card`). Pure
// server render from one getRacesIndex row (the corrected incumbent join + cash
// + margin + 3 ratings + Kalshi + Polymarket). The card↔battlefield cross-
// highlight is wired by the RaceCrossHighlight client wrapper off `data-seat`
// (the full raceId, matching the Battlefield featured markers). v2-only — `/`'s
// cards (CompetitiveRacesStrip default variant) are untouched.

// Human-readable seat label from a deterministic race id (lib/race-id.ts):
//   S-GA-2026 → "GA SENATE" · FL-23-2026 → "FL-23 HOUSE".
function seatLabel(raceId: string): string {
  if (raceId.startsWith("S-")) {
    const st = raceId.split("-")[1];
    return st ? `${st} SENATE` : raceId;
  }
  const m = raceId.match(/^([A-Z]{2})-(\d{2})-\d{4}$/);
  if (m) return `${m[1]}-${m[2]} HOUSE`;
  return raceId;
}

// Title-case party word for the sub-line ("Democrat · since 2021").
function partyLong(p: PartyKey | null): string {
  if (p === "R") return "Republican";
  if (p === "D") return "Democrat";
  if (p === "I") return "Independent";
  return "—";
}

// A market stat cell value ("D 56%" colored, surname for a name market, dim N/A
// when absent). `party` is the resolved favored party (null for a name/Indy
// market the roster couldn't place).
function marketCell(
  present: boolean,
  party: PartyKey | null,
  label: string,
  pct: number,
): { text: string; color: string } {
  if (!present) return { text: "N/A", color: "var(--text-dim)" };
  if (party === "D" || party === "R" || party === "I") {
    return { text: `${party} ${pct}%`, color: partyColor(party) };
  }
  return { text: `${surname(label)} ${pct}%`, color: "var(--text-secondary)" };
}

export function RaceCard({ row }: { row: RaceIndexRow }) {
  const isSenate = row.chamber === "senate";
  const open = row.incumbentRunning === 0; // HO 221: explicit 0 only
  const roster: RosterEntry[] = row.incumbentName
    ? [{ name: row.incumbentName, party: row.incumbentParty }]
    : [];

  // Spread-bar rater dots: one per present rater at its mapped axis position.
  const raterPositions = [row.cookRating, row.sabatoRating, row.ieRating]
    .map(ratingToAxisScore)
    .filter((s): s is number => s !== null)
    .map(axisPos);
  const bandMin = raterPositions.length ? Math.min(...raterPositions) : null;
  const bandMax = raterPositions.length ? Math.max(...raterPositions) : null;

  // Market diamonds. Kalshi rides both chambers; Polymarket is Senate-only and
  // only when a live market exists. A diamond renders only where the favorite
  // party resolves to a D↔R axis position.
  let kalshiDot: MarketDot | null = null;
  if (kalshiActive(row.kalshiOdds)) {
    const party = resolveKalshiFavoriteParty(row.kalshiOdds, roster);
    kalshiDot = { party, rPos: marketRPos(party, row.kalshiOdds.impliedPct) };
  }
  let polyDot: MarketDot | null = null;
  if (isSenate && row.polymarketOdds) {
    const party = resolveFavoriteParty(row.polymarketOdds, roster);
    polyDot = { party, rPos: marketRPos(party, row.polymarketOdds.impliedPct) };
  }

  const diverge = divergenceChip(kalshiDot, polyDot, row.consensusScore);

  // Stat cells.
  const cashText =
    row.incumbentCashOnHand == null
      ? null
      : formatDollarsCompact(row.incumbentCashOnHand);
  const kalshiParty = kalshiDot?.party ?? null;
  const kalshiCell = marketCell(
    kalshiActive(row.kalshiOdds),
    kalshiParty,
    row.kalshiOdds?.favoriteLabel ?? "",
    row.kalshiOdds?.impliedPct ?? 0,
  );
  const polyCell = marketCell(
    !!row.polymarketOdds,
    polyDot?.party ?? null,
    row.polymarketOdds?.favoriteLabel ?? "",
    row.polymarketOdds?.impliedPct ?? 0,
  );

  // Per-rater pills (present raters only), each colored by its own rating.
  const raterPills = [
    { src: "COOK", rating: row.cookRating },
    { src: "SABATO", rating: row.sabatoRating },
    { src: "IE", rating: row.ieRating },
  ].filter((p) => p.rating);

  return (
    <Link
      href={`/race/${row.raceId}`}
      className="race-card"
      data-seat={row.raceId}
    >
      <div className="rc-top">
        <span className="rc-seat">{seatLabel(row.raceId)}</span>
        {!isSenate && row.margin2024 != null ? (
          <span className="rc-margin">
            2024{" "}
            <span
              style={{
                color: partyColor(row.margin2024 >= 0 ? "R" : "D"),
                fontWeight: 600,
              }}
            >
              {row.margin2024 >= 0 ? "R" : "D"}+{Math.abs(row.margin2024).toFixed(1)}
            </span>
          </span>
        ) : null}
      </div>

      <div className="rc-inc">
        <span
          className="rc-dot8"
          style={{ background: partyColor(row.incumbentParty) }}
        />
        <span className="rc-nm">{row.incumbentName ?? "Open seat"}</span>
        {open ? (
          <span className="rc-tag rc-tag-open">OPEN</span>
        ) : row.incumbentName ? (
          <span className="rc-tag">INCUMBENT</span>
        ) : null}
      </div>
      <div className="rc-sub">
        {partyLong(row.incumbentParty)}
        {open ? " · retiring" : ""}
        {row.incumbentFirstElected ? ` · since ${row.incumbentFirstElected}` : ""}
      </div>

      <div className="sb-wrap">
        <div className="sb-ends">
          <span>D</span>
          <span>TOSS UP</span>
          <span>R</span>
        </div>
        <div className="sb">
          <span className="sb-track" />
          <span className="sb-cent" />
          {bandMin != null && bandMax != null && bandMax > bandMin ? (
            <span
              className="sb-band"
              style={{ left: `${bandMin}%`, width: `${bandMax - bandMin}%` }}
            />
          ) : null}
          {raterPositions.map((pos, i) => (
            <span key={i} className="sb-rater" style={{ left: `${pos}%` }} />
          ))}
          {kalshiDot?.rPos != null ? (
            <span
              className="sb-mkt sb-mkt-kals"
              style={{ left: `${kalshiDot.rPos}%` }}
              title="Kalshi market"
            >
              ◇
            </span>
          ) : null}
          {polyDot?.rPos != null ? (
            <span
              className="sb-mkt sb-mkt-poly"
              style={{ left: `${polyDot.rPos}%` }}
              title="Polymarket market"
            >
              ◆
            </span>
          ) : null}
        </div>
      </div>

      <div className="rc-raters">
        {raterPills.map((p, i) => (
          <span key={p.src}>
            {i > 0 ? " · " : ""}
            {p.src}{" "}
            <span style={{ color: ratingColor(p.rating) }}>{p.rating}</span>
          </span>
        ))}
        {diverge ? (
          <>
            <br />
            <span className="rc-diverge">
              {diverge.glyph} {diverge.text}
            </span>
          </>
        ) : null}
      </div>

      <div className="rc-stats">
        <div className="rc-stat">
          <div className="rc-stat-k">War Chest</div>
          <div
            className="rc-stat-v"
            style={cashText ? undefined : { color: "var(--text-dim)" }}
          >
            {cashText ?? "N/A"}
          </div>
        </div>
        <div className="rc-stat">
          <div className="rc-stat-k">Kalshi</div>
          <div className="rc-stat-v" style={{ color: kalshiCell.color }}>
            {kalshiCell.text}
          </div>
        </div>
        {isSenate ? (
          <div className="rc-stat">
            <div className="rc-stat-k">Polymarket</div>
            <div className="rc-stat-v" style={{ color: polyCell.color }}>
              {polyCell.text}
            </div>
          </div>
        ) : null}
      </div>
    </Link>
  );
}
