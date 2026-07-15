import Link from "next/link";
import { formatDateLong } from "@/lib/format";
import type { AmendmentListRow } from "@/lib/queries";
import { partyColor } from "@/lib/race-colors";

// HO 461 — one row of the /amendments corpus feed. A bare row the page maps (the
// member-page MemberAmendmentRow idiom, not the self-boxing BillAmendments). The
// corpus feed fixes neither bill nor sponsor, so each row carries BOTH the
// party-colored sponsor AND the amended-bill link. Disposition dot + semantics
// match the bill-hub / member-hub surfaces exactly.
//
// dispositionColor is re-declared locally (it's currently local to
// BillAmendments.tsx); extracting it to a shared module would touch two working
// components, so that's a banked tidy, not folded into this feature.
function dispositionColor(d: AmendmentListRow["disposition"]): string {
  if (d === "agreed") return "var(--vote-yea)";
  if (d === "failed") return "var(--vote-nay)";
  return "var(--text-muted)";
}

function Sponsor({ a }: { a: AmendmentListRow }) {
  // Committee/manager amendments carry a name but no bioguide: plain muted text,
  // no link. A resolved member gets a party-colored member link.
  if (!a.sponsorBioguideId) {
    return a.sponsorName ? (
      <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
        {a.sponsorName}
      </span>
    ) : null;
  }
  // sponsor_name already carries the "[D-CT]" party-state bracket — don't append
  // sponsorState (it'd read "...[D-CT] · CT"). Link color conveys party.
  return (
    <Link
      href={`/members/${a.sponsorBioguideId}`}
      className="text-[12px]"
      style={{ color: partyColor(a.sponsorParty) }}
    >
      {a.sponsorName ?? a.sponsorBioguideId}
    </Link>
  );
}

export function AmendmentRow({ amendment: a }: { amendment: AmendmentListRow }) {
  return (
    <div className="px-4 py-[9px]" style={{ borderTop: "0.5px solid var(--border-soft)" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden
          style={{
            width: 8,
            height: 8,
            flexShrink: 0,
            borderRadius: "50%",
            backgroundColor: dispositionColor(a.disposition),
          }}
        />
        <span
          className="text-[13px] tabular-nums"
          style={{ fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}
        >
          {a.label}
        </span>
        <Sponsor a={a} />
        {a.amendedBillId && a.amendedBillLabel ? (
          <>
            <span className="text-[11px]" style={{ color: "var(--text-dim)" }}>
              on
            </span>
            <Link
              href={`/bill/${a.amendedBillId}`}
              className="text-[12px] tabular-nums"
              style={{ fontFamily: "var(--font-mono)", color: "var(--accent-amber)" }}
            >
              {a.amendedBillLabel}
            </Link>
          </>
        ) : null}
      </div>

      {a.purpose ? (
        <div
          className="mt-1 text-[13px]"
          style={{
            color: "var(--text-secondary)",
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          {a.purpose}
        </div>
      ) : null}

      <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {a.latestActionText
          ? `${a.latestActionText}${a.latestActionDate ? ` · ${formatDateLong(a.latestActionDate)}` : ""}`
          : `Submitted ${formatDateLong(a.submittedDate)} · no floor action yet`}
      </div>

      {a.amendsLabel ? (
        <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          ↳ amends {a.amendsLabel}
        </div>
      ) : null}
    </div>
  );
}
