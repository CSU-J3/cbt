"use client";

import Link from "next/link";
import { useState } from "react";
import { CaucusBadge } from "./CaucusBadge";
import { PalestineBadge } from "./PalestineBadge";
import { isPalestineGrade } from "@/lib/palestine-config";
import type {
  Member,
  MemberAffiliation,
  PalestineScorecard,
  RaceRating,
} from "@/lib/queries";
import { raceIdFromMember } from "@/lib/race-id";

function partyColor(party: Member["party"]): string {
  if (party === "R") return "var(--party-republican)";
  if (party === "D") return "var(--party-democrat)";
  if (party === "I") return "var(--party-independent)";
  return "var(--text-dim)";
}

function initials(name: string): string {
  const parts = name.split(/[\s,]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts[1]?.[0] ?? "";
  return (first + last).toUpperCase() || "?";
}

function metaLine(m: Member): string {
  const parts: string[] = [];
  const id =
    [m.party, m.state, m.district != null ? String(m.district) : null]
      .filter(Boolean)
      .join("-");
  if (id) parts.push(id);
  if (m.birthYear) parts.push(`Born ${m.birthYear}`);
  return parts.join(" · ");
}

// Inline rating color on the seat-up chip. No source attribution here — at
// the member-hub level the chip is a glance signal; the full source-attributed
// chip lives on /race/[id]. Mirrors the color map in RatingChip.tsx — keep
// them in sync when a new rater vocabulary is added.
function ratingColor(rating: string): string {
  switch (rating) {
    case "Solid D":
    case "Safe D":
    case "Likely D":
    case "Lean D":
    case "Tilt D":
      return "var(--party-democrat)";
    case "Toss Up":
      return "var(--accent-amber-bright)";
    case "Tilt R":
    case "Lean R":
    case "Likely R":
    case "Solid R":
    case "Safe R":
      return "var(--party-republican)";
    default:
      return "var(--text-muted)";
  }
}

export function MemberHeader({
  member,
  affiliations = [],
  rating = null,
  scorecard = null,
}: {
  member: Member;
  affiliations?: MemberAffiliation[];
  rating?: RaceRating | null;
  scorecard?: PalestineScorecard | null;
}) {
  const [photoErrored, setPhotoErrored] = useState(false);
  const showPhoto = member.depictionUrl && !photoErrored;
  const pColor = partyColor(member.party);
  // Header surfaces only the top two by priority — the rest live on the full
  // affiliations row below the stats block.
  const topBadges = affiliations.slice(0, 2);
  // Race link target. The backfill produces a row for every member with a
  // non-null next_election_year, so the link should always resolve; the
  // /race/[id] page handles the missing-row case with its own empty state.
  const raceId = raceIdFromMember({
    chamber: member.chamber,
    state: member.state,
    district: member.district,
    nextElectionYear: member.nextElectionYear,
  });
  const electionChipBase =
    "ml-1 border px-2 py-[1px] text-[12px] transition";
  const electionChipStyle = {
    color: "var(--accent-amber)",
    borderColor: "var(--accent-amber)",
  };

  return (
    <div className="member-header">
      {showPhoto ? (
        // Plain <img> rather than next/image — Congress.gov host isn't
        // configured in next.config.ts's remotePatterns, and the page only
        // ever loads one photo.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={member.depictionUrl!}
          alt={member.name}
          className="member-photo"
          onError={() => setPhotoErrored(true)}
          style={{
            backgroundColor: "var(--bg-base)",
            border: "0.5px solid var(--border-strong)",
          }}
        />
      ) : (
        <div
          className="member-photo flex items-center justify-center text-[24px] font-medium uppercase tracking-[1px]"
          style={{
            backgroundColor: "var(--bg-row-hover)",
            color: "var(--text-secondary)",
            border: "0.5px solid var(--border-strong)",
          }}
          aria-label={`${member.name} (no photo)`}
        >
          {initials(member.name)}
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h1
          className="text-[16px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-primary)" }}
        >
          {member.name}
        </h1>
        <div
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-muted)" }}
        >
          <span style={{ color: pColor }} aria-hidden>
            ●
          </span>
          <span>{metaLine(member)}</span>
          {member.nextElectionYear ? (
            member.nextElectionYear >= new Date().getFullYear() ? (
              raceId ? (
                <Link
                  href={`/race/${raceId}`}
                  className={`${electionChipBase} hover:bg-[var(--bg-row-hover)]`}
                  style={electionChipStyle}
                >
                  Next election {member.nextElectionYear}
                  {rating ? (
                    <>
                      <span aria-hidden style={{ color: "var(--text-dim)" }}>
                        {" · "}
                      </span>
                      <span style={{ color: ratingColor(rating.rating) }}>
                        {rating.rating}
                      </span>
                    </>
                  ) : null}
                </Link>
              ) : (
                <span className={electionChipBase} style={electionChipStyle}>
                  Next election {member.nextElectionYear}
                  {rating ? (
                    <>
                      <span aria-hidden style={{ color: "var(--text-dim)" }}>
                        {" · "}
                      </span>
                      <span style={{ color: ratingColor(rating.rating) }}>
                        {rating.rating}
                      </span>
                    </>
                  ) : null}
                </span>
              )
            ) : (
              <span
                className="ml-1 text-[12px]"
                style={{ color: "var(--text-muted)" }}
              >
                Former member
              </span>
            )
          ) : null}
          {topBadges.length > 0 ? (
            <>
              <span aria-hidden style={{ color: "var(--text-dim)" }}>
                ·
              </span>
              {topBadges.map((a) => (
                <CaucusBadge key={a.org} org={a.org} />
              ))}
            </>
          ) : null}
          {scorecard && isPalestineGrade(scorecard.grade) ? (
            <PalestineBadge
              grade={scorecard.grade}
              rank={scorecard.rank}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
