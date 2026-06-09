"use client";

// HO 222: the /races LIST view — a consensus-led, toss-ups-first row list that
// replaces the old 5-column rating matrix. Lives inside CartogramShell's
// `listSlot` (one MAP/LIST toggle away from the map). Client island for the
// HO 148 single-open accordion — but NOT the bill panel-fetch path: every field
// the expand needs already rides on RaceIndexRow, so there's no lazy fetch.
//
// Rows arrive Senate-first, toss-ups-first within each chamber (getRacesIndex's
// sort). Severity rail + consensus chip + the 3-segment rater spread + the
// Kalshi-vs-rater divergence flag + the 2024 House margin + incumbent cash all
// render from the shared lib/race-colors + components/race-cells helpers (same
// source the MAP card uses).
//
// DROPPED PREMISES (HO 222 Phase 1): the `● N` news flag, the expand's "NEWS
// MAPPED TO THIS RACE" block, and the state breaking strip — there is no
// race→news linkage in the data layer (news_mentions is bill-keyed; a race has
// no bills), and building one is outside the scope fence. Degrade to neutral,
// never fake a value.
//
// CASH (HO 222 CHECK 2): the toss-up+lean cash-on-hand distribution showed no
// natural break (House rises smoothly $0→$10.8M; Senate n=6, ~10× scale), so
// cash renders plain --text-secondary everywhere — no amber "thin" threshold.

import Link from "next/link";
import { useState } from "react";
import { KalshiLine, MarginBar, SpreadBar, formatCash } from "@/components/race-cells";
import {
  kalshiDivergesFromConsensus,
  partyColor,
  ratingBorderColor,
  ratingColor,
  type RosterEntry,
} from "@/lib/race-colors";
import type { RaceIndexRow } from "@/lib/queries";

function seatLabel(r: RaceIndexRow): string {
  if (r.chamber === "senate") return `${r.state} SEN`;
  return `${r.state}-${String(r.district ?? 0).padStart(2, "0")}`;
}

// Severity rail: amber-bright toss-up, amber lean, dim likely/solid — lets the
// eye find competitive rows without reading the chip.
function railColor(score: number | null): string {
  const a = score == null ? 99 : Math.abs(score);
  if (a === 0) return "var(--accent-amber-bright)";
  if (a === 1) return "var(--accent-amber)";
  return "var(--text-dim)";
}

// Roster for Kalshi name-market party resolution + divergence — the LIST row
// carries only the incumbent (race_candidates challengers aren't on RaceIndexRow).
function rosterOf(r: RaceIndexRow): RosterEntry[] {
  return r.incumbentName
    ? [{ name: r.incumbentName, party: r.incumbentParty }]
    : [];
}

function bucket(score: number | null): "toss" | "lean" | "likely" {
  const a = score == null ? 99 : Math.abs(score);
  if (a === 0) return "toss";
  if (a === 1) return "lean";
  return "likely";
}

function ConsensusChip({ rating }: { rating: string | null }) {
  return (
    <span
      className="race-list-chip"
      style={{
        border: `1px solid ${ratingBorderColor(rating)}`,
        color: ratingColor(rating),
      }}
    >
      {rating ?? "—"}
    </span>
  );
}

function MarginCell({ race }: { race: RaceIndexRow }) {
  if (race.chamber === "senate")
    return <span className="race-list-margin-na">— senate</span>;
  if (race.margin2024 == null)
    return <span className="race-list-margin-na">— no data</span>;
  return <MarginBar margin={race.margin2024} />;
}

function RaterLine({ src, rating }: { src: string; rating: string | null }) {
  return (
    <span className="race-list-rater">
      <span className="race-list-rater-src">{src}:</span>{" "}
      <span style={{ color: ratingColor(rating) }}>{rating ?? "—"}</span>
    </span>
  );
}

function RaceListRow({
  race,
  open,
  onToggle,
}: {
  race: RaceIndexRow;
  open: boolean;
  onToggle: () => void;
}) {
  const isOpen = race.incumbentRunning === 0; // HO 221 retirement flag
  const roster = rosterOf(race);
  const diverges = kalshiDivergesFromConsensus(
    race.kalshiOdds,
    race.consensusScore,
    roster,
  );
  const cashShown = !isOpen && race.incumbentCashOnHand != null;

  const incumbentEl =
    race.incumbentName == null ? (
      <span style={{ color: "var(--text-dim)" }}>OPEN SEAT</span>
    ) : isOpen ? (
      <span style={{ color: "var(--text-dim)" }}>
        {race.incumbentName}{" "}
        <span className="racecard-retiring">(retiring)</span>
      </span>
    ) : race.incumbentBioguideId ? (
      <Link
        href={`/members/${race.incumbentBioguideId}`}
        className="race-list-inc-link"
        onClick={(e) => e.stopPropagation()}
      >
        {race.incumbentName}
      </Link>
    ) : (
      <span style={{ color: "var(--text-primary)" }}>{race.incumbentName}</span>
    );

  return (
    <li className="race-list-item">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="race-list-row"
        style={{ borderLeftColor: railColor(race.consensusScore) }}
      >
        <span className="race-list-seat tabular-nums">{seatLabel(race)}</span>

        <span className="race-list-cand">
          {race.incumbentName != null ? (
            isOpen ? (
              <span className="race-list-open-glyph" aria-hidden>
                ○
              </span>
            ) : (
              <span
                className="race-list-party"
                style={{ color: partyColor(race.incumbentParty) }}
              >
                [{race.incumbentParty ?? "?"}]
              </span>
            )
          ) : null}
          <span className="race-list-name">{incumbentEl}</span>
          {isOpen ? <span className="racecard-open-tag">OPEN</span> : null}
        </span>

        <ConsensusChip rating={race.consensusRating} />

        <SpreadBar
          cook={race.cookRating}
          sabato={race.sabatoRating}
          ie={race.ieRating}
        />

        <span
          className="race-list-diverge"
          title={
            diverges ? "Kalshi market favors the opposite party from the raters" : ""
          }
          style={{ color: diverges ? "var(--accent-amber)" : "transparent" }}
          aria-hidden={!diverges}
        >
          ◆
        </span>

        <span className="race-list-margin">
          <MarginCell race={race} />
        </span>

        <span
          className="race-list-cash tabular-nums"
          style={{ color: cashShown ? "var(--text-secondary)" : "var(--text-dim)" }}
        >
          {cashShown ? formatCash(race.incumbentCashOnHand!) : "—"}
        </span>

        <span
          className="race-list-chevron"
          aria-hidden
          style={{ color: open ? "var(--accent-amber)" : "var(--text-dim)" }}
        >
          {open ? "▾" : "▸"}
        </span>
      </div>

      {open ? (
        <div className="race-list-expand">
          <div className="race-list-raters">
            <RaterLine src="Cook" rating={race.cookRating} />
            <span className="race-list-rater-sep">·</span>
            <RaterLine src="Sabato" rating={race.sabatoRating} />
            <span className="race-list-rater-sep">·</span>
            <RaterLine src="Inside" rating={race.ieRating} />
          </div>
          <KalshiLine odds={race.kalshiOdds} roster={roster} />
          <Link
            href={`/race/${race.raceId}`}
            className="racecard-hublink"
            onClick={(e) => e.stopPropagation()}
          >
            Race hub →
          </Link>
        </div>
      ) : null}
    </li>
  );
}

function Section({
  title,
  races,
  openId,
  setOpenId,
}: {
  title: string;
  races: RaceIndexRow[];
  openId: string | null;
  setOpenId: (id: string | null) => void;
}) {
  return (
    <section className="mb-6">
      <div className="race-list-sechead">
        <span>
          {title} · {races.length} rated
        </span>
      </div>
      {races.length === 0 ? (
        <div className="race-list-empty">No rated races tracked.</div>
      ) : (
        <ul className="race-list">
          {races.map((r) => (
            <RaceListRow
              key={r.raceId}
              race={r}
              open={openId === r.raceId}
              onToggle={() =>
                setOpenId(openId === r.raceId ? null : r.raceId)
              }
            />
          ))}
        </ul>
      )}
    </section>
  );
}

export function RaceListView({
  senate,
  house,
}: {
  senate: RaceIndexRow[];
  house: RaceIndexRow[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const all = [...senate, ...house];
  const total = all.length;
  let toss = 0;
  let lean = 0;
  let likely = 0;
  let diverge = 0;
  for (const r of all) {
    const b = bucket(r.consensusScore);
    if (b === "toss") toss++;
    else if (b === "lean") lean++;
    else likely++;
    if (kalshiDivergesFromConsensus(r.kalshiOdds, r.consensusScore, rosterOf(r)))
      diverge++;
  }

  return (
    <div>
      <div className="race-list-summary">
        <span className="tabular-nums" style={{ color: "var(--text-primary)" }}>
          {total}
        </span>{" "}
        ·{" "}
        <span style={{ color: "var(--accent-amber-bright)" }}>
          {toss} toss-up
        </span>{" "}
        ·{" "}
        <span style={{ color: "var(--accent-amber)" }}>{lean} lean</span> ·{" "}
        <span style={{ color: "var(--text-muted)" }}>
          {likely} likely/solid
        </span>
        {diverge > 0 ? (
          <>
            {" · "}
            <span style={{ color: "var(--accent-amber)" }}>
              ◆ {diverge} market{diverge === 1 ? "" : "s"} disagree with raters
            </span>
          </>
        ) : null}
      </div>

      <Section
        title="Senate"
        races={senate}
        openId={openId}
        setOpenId={setOpenId}
      />
      <Section title="House" races={house} openId={openId} setOpenId={setOpenId} />
    </div>
  );
}
