import Link from "next/link";
import type { ReactNode } from "react";
import { PacSpendingLine } from "@/components/PacSpendingLine";
import { RaceMovedIndicator } from "@/components/RaceMovedIndicator";
import {
  RaceNewIndicator,
  type RaceNewsHead,
} from "@/components/RaceNewIndicator";
import { SourceTag } from "@/components/SourceTag";
import { formatDollarsCompact } from "@/lib/format";
import type {
  PacIeRow,
  PartyKey,
  RaceCandidate,
  RaceIndexRow,
  RaceMove,
} from "@/lib/queries";
import {
  kalshiActive,
  partyColor,
  ratingColor,
  resolveKalshiFavoriteParty,
  type RosterEntry,
} from "@/lib/race-colors";
import { deriveMatchup, displaySurname, marketFavorite } from "@/lib/race-matchup";
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
// (the full raceId, matching the Battlefield featured markers). HO 658: this is
// the ONLY competitive-races card now — the `default`-variant cards this line
// used to hold itself apart from are deleted.

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

// Single-letter party for the dense meta lines ("D · inc. 2021").
function partyLetter(p: PartyKey | null): string {
  return p === "R" || p === "D" || p === "I" ? p : "—";
}

type MarketFav = { name: string; party: PartyKey | null } | null;

// HO 684 — the K/P line, collapsing HO 305's two-column KALSHI | POLYMARKET
// stat block onto ONE line in the ODDS-tape dual-source idiom (HO 287/303):
//
//   K Ossoff 94% · P 94%          both venues, same favorite (the name dedupes)
//   K Ossoff 94% · P Smith 61%    both venues, different favorites
//   K Mendoza 85% · P n/a         House — no Polymarket market for the seat
//
// The K/P letters are the shared <SourceTag> (brand-colored --kalshi / --poly),
// the percentages are --text-primary, and the favorite name keeps the party
// color it already had. THE DEDUPE COMPARES THE RENDERED NAME, not the raw
// `favorite_label`: marketFavorite resolves a candidate-named market against the
// seat's roster and returns a SURNAME, so comparing labels would miss a match
// that renders identically. Measured at HO 684 on the six featured seats — all
// three Senate cards name the same favorite on both venues (94/94, 69/70,
// 64/65); the three House cards carry Kalshi only.
//
// This replaces .rc-stats / .rc-stat / .rc-stat-k / .rc-stat-v, which had this
// one render site and no other consumer (grepped before deleting).
function KpLine({
  kalshiFav,
  kalshiPct,
  polyFav,
  polyPct,
}: {
  kalshiFav: MarketFav;
  kalshiPct: number | null;
  polyFav: MarketFav;
  polyPct: number | null;
}) {
  const sameFavorite =
    !!kalshiFav &&
    !!polyFav &&
    kalshiFav.name.trim().toLowerCase() === polyFav.name.trim().toLowerCase();

  return (
    <div className="rc-kpline">
      <span className="rc-kp">
        <SourceTag source="kalshi" />
        {kalshiFav ? (
          <>
            <span style={{ color: partyColor(kalshiFav.party) }}>
              {kalshiFav.name}
            </span>
            <span className="rc-kp-pct">{kalshiPct}%</span>
          </>
        ) : (
          <span className="rc-kp-na">n/a</span>
        )}
      </span>
      <span className="rc-kp-sep" aria-hidden="true">
        ·
      </span>
      <span className="rc-kp">
        <SourceTag source="polymarket" />
        {polyFav ? (
          <>
            {/* Name suppressed when both venues name the same person — the K
                half already said it, and repeating it is what made the old
                two-column block wide for no information. */}
            {sameFavorite ? null : (
              <span style={{ color: partyColor(polyFav.party) }}>
                {polyFav.name}
              </span>
            )}
            <span className="rc-kp-pct">{polyPct}%</span>
          </>
        ) : (
          <span className="rc-kp-na">n/a</span>
        )}
      </span>
    </div>
  );
}

export function RaceCard({
  row,
  // HO 274: the seat's full candidate roster (getRaceCandidates), so a
  // candidate-named Kalshi/Polymarket market (e.g. ME "Graham Platner", NJ-07
  // "Rebecca Bennett") resolves to its party lean rather than falling through to
  // the surname. Incumbent-only resolution left the K/P pair uncomparable
  // (candidate label beside a party label). v2 general-election cards only.
  candidates = [],
  // HO 272, RESHAPED HO 684: this race's latest rating MOVE (getRecentRaceMoves)
  // as { date, source, to, from }; undefined when it hasn't moved. Was a bare ISO
  // date — the chip then had nothing to render but the seat's CURRENT CONSENSUS,
  // which is not the move, so it echoed an unchanged value whenever one source
  // moved and the consensus didn't. The client RaceMovedIndicator compares
  // `date` against the frozen display stamp to render, and against the last-open
  // stamp to feed the tab badge.
  move,
  // HO 432, RESHAPED HO 684: the head of this race's incumbent-linked news
  // (hubs[i].news[0]) as { observedAt, title }; undefined for a seat with no news
  // or an open seat. Was the bare timestamp — the chip could say NEWS but not
  // what the news was. No new fetch: `title` was already on the object the
  // timestamp came off.
  news,
  // HO 305: page-level ambiguous surnames (e.g. "collins" — Susan Collins ME +
  // Mike Collins GA). Surnames in this set render with a first initial. Computed
  // once by CompetitiveRacesStrip across all four cards.
  ambiguous = new Set<string>(),
  // HO 393: UDP IE direction rows for this seat → the non-linked PAC SPENDING
  // glance line (the card is a whole <Link>, so no nested FEC anchors here; the
  // clickable version lives on the /race hub + /electoral expands).
  pac,
}: {
  row: RaceIndexRow;
  candidates?: RaceCandidate[];
  move?: RaceMove | null;
  news?: RaceNewsHead | null;
  ambiguous?: Set<string>;
  pac?: PacIeRow[];
}) {
  const isSenate = row.chamber === "senate";
  const open = row.incumbentRunning === 0; // HO 221: explicit 0 only

  // HO 305: incumbent-vs-challenger matchup. Active roster + market favorite →
  // the challenger line shape + which line carries the edge accent.
  const matchup = deriveMatchup(row, candidates);
  const { challenger, favoredIsIncumbent, favorite } = matchup;
  const edgeColor = favorite ? partyColor(favorite.party) : null;
  const sn = (name: string) => displaySurname(name, ambiguous);

  // Roster (incumbent + challengers) for the spread-bar diamonds (HO 274) — kept
  // separate from the matchup roster (different shape).
  const roster: RosterEntry[] = [
    ...(row.incumbentName
      ? [{ name: row.incumbentName, party: row.incumbentParty }]
      : []),
    ...candidates
      .filter((c) => c.name)
      .map((c) => ({ name: c.name, party: c.party })),
  ];

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

  // HO 305: incumbent cash folds onto the incumbent line; suppressed on an open
  // seat (no incumbent-cash story — HO 221). Challenger cash is never shown.
  const cashText =
    open || row.incumbentCashOnHand == null
      ? null
      : formatDollarsCompact(row.incumbentCashOnHand);

  // Market strip favorites — named + party-colored. Kalshi rides both chambers;
  // Polymarket is Senate-only (House renders a dim n/a cell).
  const kalshiFav = kalshiActive(row.kalshiOdds)
    ? marketFavorite(row.kalshiOdds, matchup.roster)
    : null;
  const kalshiPct = row.kalshiOdds?.impliedPct ?? null;
  const polyFav = row.polymarketOdds
    ? marketFavorite(row.polymarketOdds, matchup.roster)
    : null;
  const polyPct = row.polymarketOdds?.impliedPct ?? null;

  // Per-rater pills (present raters only), each colored by its own rating.
  const raterPills = [
    { src: "COOK", rating: row.cookRating },
    { src: "SABATO", rating: row.sabatoRating },
    { src: "IE", rating: row.ieRating },
  ].filter((p) => p.rating);

  // The challenger line content, one of four shapes (HO 305). The market-favored
  // challenger gets the dagger; cash never appears here (the missing figure is
  // the signal).
  const dot = (party: PartyKey | null) => (
    <span className="rc-dot8" style={{ background: partyColor(party) }} />
  );
  let challengerInner: ReactNode;
  if (challenger.kind === "empty") {
    challengerInner = (
      <>
        <span className="rc-dot8 is-hollow" />
        <span className="rc-nm rc-nm--empty">no challenger filed</span>
        <span className="rc-line-meta">—</span>
      </>
    );
  } else if (challenger.kind === "unknown") {
    // HO 644 — the seat has no roster at all, so the card knows nothing about the
    // challenger field and says so instead of asserting a negative it has never
    // earned. The STRING IS VERBATIM from components/RaceMapCard.tsx:216, which
    // has always rendered this state correctly on /electoral: one state, two
    // surfaces, and their divergence WAS the defect. If it ever has to be
    // shortened, shorten BOTH sites in the same commit.
    // Same classes as `empty` above — a hedge and a negative finding are both
    // absences and read the same, so no new CSS.
    challengerInner = (
      <>
        <span className="rc-dot8 is-hollow" />
        <span className="rc-nm rc-nm--empty">
          Challenger field not yet available
        </span>
        <span className="rc-line-meta">—</span>
      </>
    );
  } else if (challenger.kind === "nominee") {
    challengerInner = (
      <>
        {dot(challenger.party)}
        <span className="rc-nm">{sn(challenger.fullName)}</span>
        <span className="rc-line-meta">
          {partyLetter(challenger.party)} · nominee
        </span>
      </>
    );
  } else if (challenger.kind === "leader") {
    const other =
      challenger.others.length === 1
        ? sn(challenger.others[0]!)
        : `${challenger.others.length} others`;
    challengerInner = (
      <>
        {dot(challenger.party)}
        <span className="rc-nm">
          {challenger.fullName}
          <span className="rc-dagger">†</span>
        </span>
        <span className="rc-line-meta">
          <span className="rc-meta-lead">
            {partyLetter(challenger.party)} · leads
          </span>{" "}
          · {other}
        </span>
      </>
    );
  } else {
    // no-lead: surnames dot-joined, degrading to "{N} candidates" when long.
    const joined = challenger.fullNames.map(sn).join(" · ");
    const label = joined.length > 24 ? `${challenger.count} candidates` : joined;
    challengerInner = (
      <>
        {dot(challenger.party)}
        <span className="rc-nm">{label}</span>
        <span className="rc-line-meta">
          {partyLetter(challenger.party)} · primary ({challenger.count})
        </span>
      </>
    );
  }
  const challengerEdge = !favoredIsIncumbent && favorite != null;

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

      <div className="rc-matchup">
        {/* Incumbent line: dot · name · {P} · inc. {YYYY} · cash right-aligned.
            The subhead + cash fold up here so the card doesn't grow (the
            INCUMBENT badge is gone — HO 305 supersedes the HO 304 swap). */}
        <div
          className={`rc-line${favoredIsIncumbent ? " rc-line--edge" : ""}`}
          style={
            favoredIsIncumbent && edgeColor
              ? { borderLeftColor: edgeColor }
              : undefined
          }
        >
          {dot(row.incumbentParty)}
          <span className="rc-nm">{row.incumbentName ?? "Open seat"}</span>
          <span className="rc-line-meta">
            {partyLetter(row.incumbentParty)}
            {open
              ? " · retiring"
              : row.incumbentFirstElected
                ? ` · inc. ${row.incumbentFirstElected}`
                : " · inc."}
          </span>
          {cashText ? (
            <span className="rc-cash">
              <span className="rc-cash-k">CASH</span>
              <span className="rc-cash-v">{cashText}</span>
            </span>
          ) : open ? (
            <span className="rc-open-tag">OPEN</span>
          ) : null}
        </div>

        {/* Challenger line: one of four shapes; the favored line carries the
            edge accent (exactly one per card). */}
        <div
          className={`rc-line${challengerEdge ? " rc-line--edge" : ""}`}
          style={
            challengerEdge && edgeColor
              ? { borderLeftColor: edgeColor }
              : undefined
          }
        >
          {challengerInner}
        </div>
      </div>

      <RaceMovedIndicator raceId={row.raceId} move={move} />

      <RaceNewIndicator raceId={row.raceId} news={news} />

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

      {/* HO 305 market strip, COLLAPSED TO ONE LINE at HO 684 — see KpLine.
          Cash moved up to the incumbent line back at HO 305, so this block has
          been two cells (not the three "WAR CHEST | KALSHI | POLYMARKET" that
          SKILL described until HO 684 corrected it) for a long while. Senate
          carries both venues; House carries Kalshi + a dim n/a. */}
      <KpLine
        kalshiFav={kalshiFav}
        kalshiPct={kalshiPct}
        polyFav={isSenate ? polyFav : null}
        polyPct={isSenate ? polyPct : null}
      />

      {/* HO 393: PAC SPENDING glance line — non-linked (whole card is a
          <Link>). Renders only when the seat carries UDP IE rows. */}
      <PacSpendingLine rows={pac} variant="glance" />
    </Link>
  );
}
