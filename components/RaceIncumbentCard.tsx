"use client";

import Link from "next/link";
import { useState } from "react";
import type { Member, Race } from "@/lib/queries";

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

function locator(member: Member, race: Race): string {
  const party = member.party ?? "?";
  if (race.chamber === "senate") return `${party}-${race.state}`;
  const district = race.district ?? member.district;
  if (district === null || district === undefined)
    return `${party}-${race.state}`;
  return `${party}-${race.state}-${String(district).padStart(2, "0")}`;
}

export function RaceIncumbentCard({
  member,
  race,
}: {
  member: Member | null;
  race: Race;
}) {
  const [photoErrored, setPhotoErrored] = useState(false);

  if (!member) {
    return (
      <div
        className="flex items-center gap-4 py-3"
        style={{ color: "var(--text-muted)" }}
      >
        <div
          className="member-photo flex items-center justify-center text-[14px] uppercase tracking-[1px]"
          style={{
            backgroundColor: "var(--bg-row-hover)",
            color: "var(--text-dim)",
            border: "0.5px solid var(--border-strong)",
          }}
          aria-hidden
        >
          —
        </div>
        <div className="flex flex-col gap-1">
          <span
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--text-secondary)" }}
          >
            Open Seat
          </span>
          <span className="text-[12px]" style={{ color: "var(--text-dim)" }}>
            No incumbent on file
          </span>
        </div>
      </div>
    );
  }

  const showPhoto = member.depictionUrl && !photoErrored;
  const pColor = partyColor(member.party);

  return (
    <div className="flex items-center gap-4 py-3">
      {showPhoto ? (
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
          className="member-photo flex items-center justify-center text-[20px] font-medium uppercase tracking-[1px]"
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

      <div className="flex min-w-0 flex-col gap-1">
        <span
          className="text-[14px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-primary)" }}
        >
          {member.name}
        </span>
        <span
          className="text-[12px] uppercase tracking-[0.5px]"
          style={{ color: pColor }}
        >
          {locator(member, race)}
        </span>
        <Link
          href={`/members/${member.bioguideId}`}
          className="mt-1 text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
          style={{ color: "var(--accent-amber)" }}
        >
          View member profile →
        </Link>
      </div>
    </div>
  );
}
