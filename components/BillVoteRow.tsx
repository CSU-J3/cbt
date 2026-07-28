import Link from "next/link";
import { formatDateShort } from "@/lib/format";
import type { Vote } from "@/lib/queries";

// HO 542 — one of a bill's OWN passage/procedural roll calls on the /bill/[id]
// VOTES tab. A small summary row (tally · date · label · roll#), NOT MemberVoteRow
// (member-scoped [YEA] chip) nor VotePositionList (the heavy per-member breakdown):
// the bill hub carries no per-member context. The #{rollCall} anchors to the
// /vote/[id] entity page (HO 540) where the full per-member breakdown lives — the
// row already links there via the number, so the row itself isn't the anchor.
export function BillVoteRow({ vote }: { vote: Vote }) {
  const label = vote.question ?? vote.description ?? "—";
  const labelLine = vote.result ? `${label} · ${vote.result}` : label;

  // Suppress the tally on an all-zero roll call — a by-name / procedural vote
  // (a Speaker election etc.), where "0–0" is meaningless (the HO 540 empty-state
  // rule). yea/nay are non-null by schema; present/not_voting are nullable.
  const hasTally =
    vote.yeaCount + vote.nayCount + (vote.presentCount ?? 0) + (vote.notVotingCount ?? 0) > 0;

  return (
    <div className="bvote-row">
      <span className="bvote-tally">
        {hasTally ? (
          <>
            <span className="bvote-yea">{vote.yeaCount}</span>
            <span className="bvote-dash">–</span>
            <span className="bvote-nay">{vote.nayCount}</span>
          </>
        ) : (
          <span className="bvote-none" title="A by-name or procedural vote — no yea/nay tally">
            —
          </span>
        )}
      </span>
      <span className="bvote-date">{formatDateShort(vote.voteDate)}</span>
      <span className="bvote-label" title={labelLine}>
        {labelLine}
      </span>
      <Link className="bvote-roll" href={`/vote/${vote.id}`} title="View roll call">
        #{vote.rollCall}
      </Link>
    </div>
  );
}
