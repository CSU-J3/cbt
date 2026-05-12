"use client";

import { useState } from "react";

function initials(name: string): string {
  const noPrefix = name
    .replace(/^(Rep\.|Sen\.|Del\.|Res\.)\s*/i, "")
    .replace(/\s*\[.*\]$/, "")
    .trim();
  const parts = noPrefix.split(/[\s,]+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const last = parts[1]?.[0] ?? "";
  return (first + last).toUpperCase() || "?";
}

export function SponsorPhoto({
  bioguideId,
  name,
  partyColor,
}: {
  bioguideId: string | null;
  name: string;
  partyColor: string;
}) {
  const [errored, setErrored] = useState(false);
  const url = bioguideId
    ? `https://bioguide.congress.gov/bioguide/photo/${bioguideId[0]}/${bioguideId}.jpg`
    : null;

  if (!url || errored) {
    return (
      <div
        className="flex aspect-[3/4] w-[150px] shrink-0 items-center justify-center text-[36px] font-medium uppercase tracking-[1px]"
        style={{
          backgroundColor: "var(--bg-base)",
          color: partyColor,
          border: `0.5px solid var(--border-strong)`,
        }}
        aria-label={`${name} (no photo available)`}
      >
        {initials(name)}
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={name}
      loading="lazy"
      onError={() => setErrored(true)}
      className="aspect-[3/4] w-[150px] shrink-0 object-cover"
      style={{
        backgroundColor: "var(--bg-base)",
        border: `0.5px solid var(--border-strong)`,
      }}
    />
  );
}
