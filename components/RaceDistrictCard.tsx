"use client";

// HO 225: the /races district-modal detail card — incumbent-anchored, three
// cases (incumbent-only / + challenger row / open-seat), one component picking
// its fill from what's present. Reuses the RaceMapCard incumbent idiom + the
// HO 222 helpers (race-colors / race-cells). NEVER reserves space it can't fill
// — no VS divider, no empty second column. No news block (no race→news link).
import Link from "next/link";
import { useState } from "react";
import { KalshiLine, MarginBar, SpreadBar, formatCash } from "@/components/race-cells";
import type { CartogramChallenger, CartogramContest } from "@/lib/cartogram-data";
import {
  partyColor,
  ratingBorderColor,
  ratingColor,
  type RosterEntry,
} from "@/lib/race-colors";
import type { PartyKey } from "@/lib/queries";

const CYCLE = 2026;

function initials(name: string): string {
  const p = name.split(/[\s,]+/).filter(Boolean);
  return ((p[0]?.[0] ?? "") + (p[1]?.[0] ?? "")).toUpperCase() || "?";
}

function Face({
  url,
  name,
  party,
}: {
  url: string | null | undefined;
  name: string;
  party: PartyKey | null | undefined;
}) {
  const [err, setErr] = useState(false);
  if (url && !err) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} className="rdc-face" onError={() => setErr(true)} />;
  }
  return (
    <span className="rdc-face rdc-face--initials" style={{ color: partyColor(party) }} aria-hidden>
      {initials(name)}
    </span>
  );
}

function ConsensusChip({ rating }: { rating: string | null }) {
  return (
    <span
      className="race-list-chip"
      style={{ border: `1px solid ${ratingBorderColor(rating)}`, color: ratingColor(rating) }}
    >
      {rating ?? "—"}
    </span>
  );
}

function rosterOf(c: CartogramContest): RosterEntry[] {
  return c.incumbent ? [{ name: c.incumbent.name, party: c.party ?? null }] : [];
}

// 2024 general result as a plain line. House-only; Senate has no 2024 House run.
function resultLine(margin: number | null | undefined, chamber: "house" | "senate"): string {
  if (chamber === "senate") return "Senate seat — last contested 2020";
  if (margin == null || !Number.isFinite(margin)) return "2024 result not on file";
  const mag = Math.abs(margin);
  if (mag < 0.1) return "2024 general: even";
  return `2024 general: ${margin > 0 ? "R" : "D"}+${mag.toFixed(1)}`;
}

function humanStatus(status: string | null): string {
  if (!status || status === "running") return "running";
  return status.replace(/_/g, " ").replace("won primary", "primary winner");
}

function ChallengerRow({ c, openSeat }: { c: CartogramChallenger; openSeat?: boolean }) {
  const dim = c.status === "withdrew";
  return (
    <div className="rdc-chal" style={dim ? { opacity: 0.5 } : undefined}>
      <span className="rdc-chal-dot" style={{ background: partyColor(c.party) }} aria-hidden />
      <span className="rdc-chal-label">{openSeat ? "CANDIDATE" : "CHALLENGER"}</span>
      {c.bioguideId ? (
        <Link href={`/members/${c.bioguideId}`} className="rdc-chal-name">
          {c.name}
        </Link>
      ) : (
        <span className="rdc-chal-name">{c.name}</span>
      )}
      <span className="rdc-chal-party" style={{ color: partyColor(c.party) }}>
        [{c.party ?? "?"}]
      </span>
      <span className="rdc-chal-status">{humanStatus(c.status)} · no fundraising record on file</span>
    </div>
  );
}

function HeaderStrip({ contest, isOpen }: { contest: CartogramContest; isOpen: boolean }) {
  return (
    <div className="rdc-header">
      <div className="rdc-idblock">
        <span className="rdc-seat">{contest.label}</span>
        <ConsensusChip rating={contest.rating ?? null} />
        {isOpen ? <span className="racecard-open-tag">OPEN SEAT</span> : null}
      </div>
      <div className="rdc-signals">
        {contest.chamber === "senate" ? (
          <span className="race-list-margin-na">— senate</span>
        ) : (
          <MarginBar margin={contest.margin2024} />
        )}
        <KalshiLine odds={contest.kalshiOdds} roster={rosterOf(contest)} />
        <SpreadBar
          cook={contest.raterSpread?.cook ?? null}
          sabato={contest.raterSpread?.sabato ?? null}
          ie={contest.raterSpread?.ie ?? null}
        />
      </div>
    </div>
  );
}

export function RaceDistrictCard({ contest }: { contest: CartogramContest }) {
  const isOpen = contest.isOpen ?? false;
  const challengers = contest.challengers ?? [];
  const incName = contest.incumbent?.name ?? null;

  // ── Case 3 — open seat, no incumbent ──────────────────────────────────────
  if (isOpen) {
    return (
      <div className="rdc">
        <HeaderStrip contest={contest} isOpen />
        <div className="rdc-open">
          <div className="rdc-open-head">OPEN SEAT · NO INCUMBENT</div>
          <p className="rdc-open-explain">
            The {contest.rating ?? "current"} rating reflects the seat&apos;s partisan lean, not a
            head-to-head matchup{incName ? ` — ${incName} is not running` : ""}.
          </p>
          <div className="rdc-stats">
            <div className="rdc-stat">
              <span className="rdc-stat-label">2024 RESULT</span>
              <span className="rdc-stat-val">{resultLine(contest.margin2024, contest.chamber)}</span>
            </div>
            <div className="rdc-stat">
              <span className="rdc-stat-label">FIELD</span>
              <span className="rdc-stat-val">resolves after the primary</span>
            </div>
          </div>
          {challengers.length > 0 ? (
            <div className="rdc-challengers">
              {challengers.map((c) => (
                <ChallengerRow key={c.name} c={c} openSeat />
              ))}
            </div>
          ) : null}
        </div>
      </div>
    );
  }

  // ── Case 1 / 2 — incumbent anchor ─────────────────────────────────────────
  const fe = contest.incumbentFirstElected ?? null;
  const tenure = fe ? `${CYCLE - fe} yrs in office` : null;
  const seatSince = fe ? `seat since ${fe}` : null;
  const meta = [tenure, seatSince].filter(Boolean).join(" · ");

  return (
    <div className="rdc">
      <HeaderStrip contest={contest} isOpen={false} />
      <div className="rdc-incumbent">
        <Face url={contest.incumbentDepictionUrl} name={incName ?? "?"} party={contest.party} />
        <div className="rdc-inc-body">
          <div className="rdc-role" style={{ color: partyColor(contest.party) }}>
            [{contest.party ?? "?"}] · INCUMBENT
          </div>
          <div className="rdc-name">{incName ?? "—"}</div>
          {meta ? <div className="rdc-meta">{meta}</div> : null}
          <div className="rdc-bio">{resultLine(contest.margin2024, contest.chamber)}</div>
          <div className="rdc-stats">
            <div className="rdc-stat">
              <span className="rdc-stat-label">CASH ON HAND</span>
              <span className="rdc-stat-val">
                {contest.incumbentCashOnHand != null ? formatCash(contest.incumbentCashOnHand) : "—"}
              </span>
            </div>
            <div className="rdc-stat">
              <span className="rdc-stat-label">FIRST ELECTED</span>
              <span className="rdc-stat-val">{fe ?? "—"}</span>
            </div>
          </div>
          {contest.incumbent?.bioguideId ? (
            <Link href={`/members/${contest.incumbent.bioguideId}`} className="rdc-memberlink">
              View member →
            </Link>
          ) : null}
        </div>
      </div>

      {challengers.length > 0 ? (
        <div className="rdc-challengers">
          {challengers.map((c) => (
            <ChallengerRow key={c.name} c={c} />
          ))}
        </div>
      ) : (
        <div className="rdc-noopp">
          ▸ No declared challenger on file. Opponent appears here once the field is set.
        </div>
      )}
    </div>
  );
}
