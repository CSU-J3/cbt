"use client";

// HO 192 — the sponsor name as a member link plus an additive hover card
// (photo + full name + party-state). Shared by the expanded bill panel
// (BillExpandedPanel) and the collapsed feed row (BillRow). The <a> still
// navigates to /members/[bioguideId]; the card is a pure-CSS hover/focus
// reveal (matches the tape/topic-chip popover idiom), opaque with
// border+shadow, absolute so it overlays without shifting layout.
//
// `label` is the visible trigger text — it differs by surface (the panel
// shows the full "Rep. Harris, Andy [R-MD-1]"; the row shows the short
// "HARRIS") — but the card content is always derived from the bill fields, so
// it reads the same regardless of trigger.
//
// Only mount this where the enclosing click target is NOT an <a> (the
// expandable /bills row is a div role=button; the panel is a div) — nesting an
// anchor inside the compact/link-only row's <Link> would be invalid HTML.
import { useState } from "react";
import type { FeedBill } from "@/lib/queries";

const PARTY_COLOR = {
  R: "var(--party-republican)",
  D: "var(--party-democrat)",
  I: "var(--party-independent)",
} as const;

// Inline party normalization (mirrors lib/queries normalizePartyVariant) —
// kept local so this client component doesn't import a runtime value from
// lib/queries (which would pull next/cache into the client bundle).
function partyColorFor(party: string | null): string {
  if (!party) return "var(--text-muted)";
  const u = party.trim().toUpperCase();
  if (u === "R") return PARTY_COLOR.R;
  if (u === "D") return PARTY_COLOR.D;
  return PARTY_COLOR.I;
}

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

// Small avatar for the card. Same onError→initials pattern as
// SponsorPhoto/MemberHeader, sized for the compact card (not the 150px hub
// portrait).
function SponsorAvatar({
  url,
  name,
  partyColor,
}: {
  url: string | null;
  name: string;
  partyColor: string;
}) {
  const [errored, setErrored] = useState(false);
  if (!url || errored) {
    return (
      <span
        className="sponsor-hover-avatar sponsor-hover-avatar--fallback"
        style={{ color: partyColor }}
        aria-hidden
      >
        {initials(name)}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      className="sponsor-hover-avatar"
      src={url}
      alt=""
      loading="lazy"
      onError={() => setErrored(true)}
    />
  );
}

export function SponsorHoverName({
  bill,
  label,
  anchorClassName = "bill-expanded-link",
}: {
  bill: FeedBill;
  label: string;
  anchorClassName?: string;
}) {
  const name = bill.sponsor_name ?? "";
  const partyColor = partyColorFor(bill.sponsor_party);
  const partyState = [bill.sponsor_party, bill.sponsor_state]
    .filter(Boolean)
    .join("-");
  return (
    <span className="sponsor-hover">
      <a
        href={`/members/${bill.sponsor_bioguide_id}`}
        className={anchorClassName}
        onClick={(e) => e.stopPropagation()}
      >
        {label}
      </a>
      <span className="sponsor-hover-card" role="tooltip">
        <SponsorAvatar
          url={bill.sponsor_depiction_url ?? null}
          name={name}
          partyColor={partyColor}
        />
        <span className="sponsor-hover-info">
          <span className="sponsor-hover-name">{name}</span>
          {partyState ? (
            <span className="sponsor-hover-party" style={{ color: partyColor }}>
              {partyState}
            </span>
          ) : null}
        </span>
      </span>
    </span>
  );
}
