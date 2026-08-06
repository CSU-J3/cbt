"use client";

import { useState } from "react";
import { CaucusBadge } from "./CaucusBadge";
import { PalestineBadge } from "./PalestineBadge";
import { isPalestineGrade } from "@/lib/palestine-config";
import type {
  Member,
  MemberAffiliation,
  PalestineScorecard,
} from "@/lib/queries";
import { partyColor } from "@/lib/race-colors";

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

export function MemberHeader({
  member,
  affiliations = [],
  scorecard = null,
}: {
  member: Member;
  affiliations?: MemberAffiliation[];
  scorecard?: PalestineScorecard | null;
}) {
  const [photoErrored, setPhotoErrored] = useState(false);
  const showPhoto = member.depictionUrl && !photoErrored;
  const pColor = partyColor(member.party);
  // Header surfaces only the top two by priority — the rest live on the full
  // affiliations row below the stats block.
  const topBadges = affiliations.slice(0, 2);

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
          className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[length:var(--fs-13)] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-muted)" }}
        >
          <span style={{ color: pColor }} aria-hidden>
            ●
          </span>
          <span>{metaLine(member)}</span>
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
