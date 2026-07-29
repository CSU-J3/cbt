import Link from "next/link";
import { formatDateLong } from "@/lib/format";
import type { AmendmentListRow, AmendmentMotion } from "@/lib/queries";
import { partyColor } from "@/lib/race-colors";
import { VoteLine, dispositionColor } from "@/components/AmendmentVoteLine";
import { MotionLine } from "@/components/AmendmentMotionLine";

// HO 461 — one row of the /amendments corpus feed. A bare row the page maps (the
// member-page MemberAmendmentRow idiom, not the self-boxing BillAmendments). The
// corpus feed fixes neither bill nor sponsor, so each row carries BOTH the
// party-colored sponsor AND the amended-bill link. Disposition dot + semantics
// match the bill-hub / member-hub surfaces exactly.
//
// HO 537: dispositionColor now imported from the shared components/AmendmentVoteLine.tsx
// (the banked tidy — the corpus feed becoming the third consumer was the trigger).

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

export function AmendmentRow({
  amendment: a,
  motions = [],
}: {
  amendment: AmendmentListRow;
  // HO 557 — motion roll calls for this amendment, attached PAGE-SCOPED by the page
  // (not by getAmendments — scope guard 5 keeps that query's filter/hydration/counts
  // untouched). Rendered only where the row has no decisive vote.
  motions?: AmendmentMotion[];
}) {
  // Where a recorded vote exists, the dot follows the vote outcome (authoritative,
  // from votes.result); else the latest_action_text keyword scan (a.disposition) —
  // the hub's exact rule. list[0] is the canonical (latest) vote.
  const vote = a.votes[0] ?? null;
  const moreVotes = Math.max(0, a.votes.length - 1);
  const dotDisposition = vote ? vote.disposition : a.disposition;
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
            backgroundColor: dispositionColor(dotDisposition),
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

      {/* Decisive vote OR motion lines, never both (the anchored-suppression rule). */}
      {vote ? (
        <VoteLine vote={vote} moreVotes={moreVotes} />
      ) : (
        motions.map((m) => <MotionLine key={m.voteId} motion={m} />)
      )}

      {a.amendsLabel ? (
        <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          ↳ amends {a.amendsLabel}
        </div>
      ) : null}
    </div>
  );
}
