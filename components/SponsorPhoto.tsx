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
  // HO 198: the expanded member card uses a 96px photo; the member hub keeps
  // the original 150px. Initials scale proportionally (36/150 ratio).
  width = 150,
}: {
  bioguideId: string | null;
  name: string;
  partyColor: string;
  width?: number;
}) {
  const [errored, setErrored] = useState(false);
  const url = bioguideId
    ? `https://bioguide.congress.gov/bioguide/photo/${bioguideId[0]}/${bioguideId}.jpg`
    : null;

  if (!url || errored) {
    return (
      <div
        className="flex aspect-[3/4] shrink-0 items-center justify-center font-medium uppercase tracking-[1px]"
        style={{
          width,
          fontSize: Math.round(width * 0.24),
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
      className="aspect-[3/4] shrink-0 object-cover"
      style={{
        width,
        backgroundColor: "var(--bg-base)",
        border: `0.5px solid var(--border-strong)`,
      }}
    />
  );
}
