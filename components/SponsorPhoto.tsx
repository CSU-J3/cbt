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
  // HO 645: an explicit height, which REPLACES the 3:4 aspect rather than adding
  // to it. The absence card's face is 112x132 (0.85), not 3:4, and the whole
  // point of this prop is that there stays exactly ONE implementation of the
  // bioguide URL and of the onError->initials fallback — the card must not carry
  // a second copy of either (HO 507's shared-component rule). Omitted, every
  // existing caller renders byte-identically.
  height,
  // The card's face already draws its own 1px inner border, so a second hairline
  // here would double it. Default keeps every prior caller unchanged.
  bordered = true,
}: {
  bioguideId: string | null;
  name: string;
  partyColor: string;
  width?: number;
  height?: number;
  bordered?: boolean;
}) {
  const [errored, setErrored] = useState(false);
  const url = bioguideId
    ? `https://bioguide.congress.gov/bioguide/photo/${bioguideId[0]}/${bioguideId}.jpg`
    : null;
  const box = height === undefined ? { width } : { width, height };
  // Interpolated WITH its trailing space so the DEFAULT class string stays
  // byte-identical to the pre-645 literal — /members renders through this
  // component, and the check that /members is untouched is a byte diff, which a
  // reordered class attribute would fail for no reason at all.
  const aspect = height === undefined ? "aspect-[3/4] " : "";
  const border = bordered ? `0.5px solid var(--border-strong)` : undefined;

  if (!url || errored) {
    return (
      <div
        className={`flex ${aspect}shrink-0 items-center justify-center font-medium uppercase tracking-[1px]`}
        style={{
          ...box,
          fontSize: Math.round(width * 0.24),
          backgroundColor: "var(--bg-base)",
          color: partyColor,
          border,
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
      className={`${aspect}shrink-0 object-cover`}
      style={{
        ...box,
        backgroundColor: "var(--bg-base)",
        border,
      }}
    />
  );
}
