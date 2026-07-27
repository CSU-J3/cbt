// HO 540 — /vote/[id], the roll-call detail page. The banked per-member drill,
// built as a page: a roll call is an entity CBT stores (votes + member_votes) with
// no home; "who voted how" is a question about it and had nowhere to be asked.
// Flat sectioned page (NOT RecordTabs — a single position list doesn't want tabs).
// The id is the TEXT composite (senate-119-1-3 / house-119-2-269), already
// URL-safe, so it's the route param directly; an unknown id → notFound().
import { notFound } from "next/navigation";
import Link from "next/link";
import { HeaderBar } from "@/components/HeaderBar";
import { VotePositionList } from "@/components/VotePositionList";
import { formatBillId, formatDateLong } from "@/lib/format";
import { partyColor } from "@/lib/race-colors";
import { getVoteAmendmentContext, getVoteById, getVoteMemberPositions } from "@/lib/queries";

export default async function VotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [vote, positions, amdCtx] = await Promise.all([
    getVoteById(id),
    getVoteMemberPositions(id),
    getVoteAmendmentContext(id),
  ]);
  if (!vote) notFound();

  const chamberLabel = vote.chamber === "house" ? "House" : "Senate";

  // Party split from the positions — the SAME aggregate getBillAmendmentVotes
  // computes (same member_votes ⋈ members), so the numbers agree with the vote line
  // that linked here by construction.
  const split = { D: { yea: 0, nay: 0 }, R: { yea: 0, nay: 0 }, I: { yea: 0, nay: 0 } };
  for (const p of positions) {
    if (!p.party) continue;
    if (p.position === "yea") split[p.party].yea++;
    else if (p.position === "nay") split[p.party].nay++;
  }
  const splitSum =
    split.D.yea + split.D.nay + split.R.yea + split.R.nay + split.I.yea + split.I.nay;

  const tallySum =
    vote.yeaCount + vote.nayCount + (vote.presentCount ?? 0) + (vote.notVotingCount ?? 0);
  const hasPositions = positions.length > 0;

  // Bill link: votes.bill_id ?? the amendment's amended_bill_id (both chambers —
  // the amendment context is fetched unconditionally, HO 540 C1).
  const billLinkId = vote.billId ?? amdCtx?.amendedBillId ?? null;
  let billLinkLabel: string | null = amdCtx?.amendedBillLabel ?? null;
  if (!billLinkLabel && vote.billId) {
    const parts = vote.billId.split("-"); // "119-hr-27"
    billLinkLabel = parts.length === 3 ? formatBillId(parts[1]!, Number(parts[2])) : vote.billId;
  }

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath={`/vote/${vote.id}`} detail={`${vote.chamber === "house" ? "H" : "S"} ${vote.rollCall}`} />

      <main className="w-full flex-1 px-4 py-4">
        {/* HEAD */}
        <div className="border p-[14px]" style={{ borderColor: "var(--border-strong)" }}>
          <div className="text-[11px] uppercase tracking-[0.5px] tabular-nums" style={{ color: "var(--text-muted)" }}>
            {chamberLabel} · {vote.congress}th Congress · Session {vote.session} · Roll Call {vote.rollCall}
          </div>

          <h1 className="mt-1 text-[15px]" style={{ color: "var(--text-primary)", fontFamily: "var(--sans)" }}>
            {vote.question ?? vote.description ?? `Roll Call ${vote.rollCall}`}
          </h1>

          <div className="mt-1 text-[13px]" style={{ color: "var(--text-secondary)" }}>
            {vote.result ? <span style={{ color: "var(--text-primary)" }}>{vote.result}</span> : null}
            {vote.result ? " · " : ""}
            {formatDateLong(vote.voteDate)}
          </div>

          {/* amendment context + bill link */}
          {amdCtx ? (
            <div className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
              On amendment{" "}
              <span style={{ color: "var(--text-secondary)" }}>{amdCtx.amendmentLabel}</span>
              {billLinkId && billLinkLabel ? (
                <>
                  {" to "}
                  <Link href={`/bill/${billLinkId}`} className="tabular-nums no-underline" style={{ color: "var(--accent-amber)" }}>
                    {billLinkLabel}
                  </Link>
                </>
              ) : null}
            </div>
          ) : billLinkId && billLinkLabel ? (
            <div className="mt-1 text-[12px]" style={{ color: "var(--text-muted)" }}>
              On{" "}
              <Link href={`/bill/${billLinkId}`} className="tabular-nums no-underline" style={{ color: "var(--accent-amber)" }}>
                {billLinkLabel}
              </Link>
              {vote.billTitle ? <span> · {vote.billTitle}</span> : null}
            </div>
          ) : null}

          {/* tally + party split — suppressed on a by-name/procedural row (tally 0);
              the split is suppressed when positions haven't synced (HO 533 guard). */}
          {tallySum > 0 ? (
            <div className="mt-2 text-[13px] tabular-nums" style={{ fontFamily: "var(--font-mono)", color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--vote-yea)" }}>{vote.yeaCount} Yea</span>
              {" · "}
              <span style={{ color: "var(--vote-nay)" }}>{vote.nayCount} Nay</span>
              {vote.presentCount ? <span style={{ color: "var(--vote-present)" }}> · {vote.presentCount} Present</span> : null}
              {vote.notVotingCount ? <span style={{ color: "var(--text-dim)" }}> · {vote.notVotingCount} Not Voting</span> : null}
              {splitSum > 0 ? (
                <span style={{ color: "var(--text-muted)" }}>
                  {"  ·  "}
                  <span style={{ color: partyColor("D") }}>D {split.D.yea}–{split.D.nay}</span>
                  {" · "}
                  <span style={{ color: partyColor("R") }}>R {split.R.yea}–{split.R.nay}</span>
                  {split.I.yea + split.I.nay > 0 ? (
                    <>
                      {" · "}
                      <span style={{ color: partyColor("I") }}>I {split.I.yea}–{split.I.nay}</span>
                    </>
                  ) : null}
                </span>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* POSITIONS — the reason the page exists, or one of two empty states. */}
        {hasPositions ? (
          <VotePositionList positions={positions} />
        ) : tallySum > 0 ? (
          // LAG: a real tally but no positions — member detail syncs behind the
          // vote list (HO 533). Says pending, never renders as an empty roll.
          <div className="mt-4 border p-[14px] text-[13px]" style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}>
            Member positions haven&rsquo;t synced yet for this roll call. The tally is recorded; the
            per-member breakdown appears once the vote-member detail catches up.
          </div>
        ) : (
          // NOT lag: no tally AND no positions (e.g. a by-name Election of the
          // Speaker roll call). Nothing is pending — different copy, not "syncing".
          <div className="mt-4 border p-[14px] text-[13px]" style={{ borderColor: "var(--border-strong)", color: "var(--text-muted)" }}>
            This roll call has no recorded per-member positions (a by-name or procedural vote); the result above is the outcome.
          </div>
        )}
      </main>
    </div>
  );
}
