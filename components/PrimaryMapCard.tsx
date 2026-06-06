"use client";

// HO 210 Pass 2: the PRIMARIES pinned-state card body. Per contest:
//   VOTED  (any candidate vote_pct) → the HO 207 ShareBar, reused AS-IS.
//   UNVOTED                          → "SCHEDULED · <full date>" + field list, no bar.
// The raw PrimaryWithCandidates rides on contest.primary (attached in the
// builder), so this renders without a refetch.

import Link from "next/link";
import { ShareBar } from "@/components/PrimaryRow";
import type { CartogramContest } from "@/lib/cartogram-data";
import { formatDateLong } from "@/lib/format";
import type { PrimaryCandidate } from "@/lib/queries";

const FIELD_CAP = 4;

function partyTint(party: string): string {
  if (party === "D") return "var(--party-democrat)";
  if (party === "R") return "var(--party-republican)";
  return "var(--accent-amber)"; // open / nonpartisan
}

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

function PrimaryCardRow({ contest }: { contest: CartogramContest }) {
  const p = contest.primary;
  if (!p) return null;
  const voted = p.candidates.some((c) => c.vote_pct != null);
  const tint = partyTint(p.party);

  // Un-voted field: seat incumbent first, then other sitting members, then name.
  const seatBio = p.seat_incumbent_bioguide;
  const isSeatInc = (c: PrimaryCandidate) =>
    seatBio ? c.bioguide_id === seatBio : c.incumbent;
  const field = [...p.candidates].sort(
    (a, b) =>
      Number(isSeatInc(b)) - Number(isSeatInc(a)) ||
      Number(b.incumbent) - Number(a.incumbent) ||
      a.name.localeCompare(b.name),
  );
  const shown = field.slice(0, FIELD_CAP);
  const more = field.length - shown.length;

  return (
    <li className="primcard-row">
      <div className="primcard-head">
        <span className="primcard-seat" style={{ color: tint }}>
          {contest.label}
        </span>
      </div>
      {voted ? (
        <ShareBar cands={p.candidates} tint={tint} />
      ) : (
        <div className="primcard-sched">
          <span className="primcard-sched-label">
            SCHEDULED · {p.primary_date ? formatDateLong(p.primary_date) : "TBD"}
          </span>
          {field.length > 0 ? (
            <span className="primcard-field">
              {shown.map((c, i) => (
                <span key={c.id}>
                  {i > 0 ? " · " : ""}
                  {c.bioguide_id ? (
                    <Link
                      href={`/members/${c.bioguide_id}`}
                      style={
                        isSeatInc(c)
                          ? { color: "var(--accent-amber)" }
                          : { color: "var(--text-muted)" }
                      }
                    >
                      {lastName(c.name)}
                    </Link>
                  ) : (
                    <span
                      style={
                        isSeatInc(c)
                          ? { color: "var(--accent-amber)" }
                          : { color: "var(--text-muted)" }
                      }
                    >
                      {lastName(c.name)}
                    </span>
                  )}
                </span>
              ))}
              {more > 0 ? (
                <span style={{ color: "var(--text-dim)" }}> · +{more}</span>
              ) : null}
            </span>
          ) : (
            <span className="primcard-field" style={{ color: "var(--text-dim)" }}>
              roster pending
            </span>
          )}
        </div>
      )}
    </li>
  );
}

export function PrimaryMapCard({ contests }: { contests: CartogramContest[] }) {
  if (contests.length === 0) {
    return <div className="racecard-placeholder">No primaries in this state.</div>;
  }
  return (
    <ul className="primcard-list">
      {contests.map((c) => (
        <PrimaryCardRow key={c.label} contest={c} />
      ))}
    </ul>
  );
}
