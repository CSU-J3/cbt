import Link from "next/link";
import type { AmendmentVote } from "@/lib/queries";
import { partyColor } from "@/lib/race-colors";

// HO 537 — the shared amendment vote-line vocabulary, extracted from
// BillAmendments.tsx (HO 530) so the /bill/[id] hub row AND the /amendments corpus
// feed row (AmendmentRow.tsx) render the identical line + dot. AmendmentRow.tsx had
// re-declared dispositionColor with a comment explaining the duplication was left
// alone to avoid touching two working components; the corpus feed becoming the third
// consumer (the "voted" cut, HO 537) is the trigger the backlog banked this on. Pure
// consolidation — no markup or token change; the acceptance test is byte-identical
// output (the HO 468 shape).

// Derived from source (not a re-typed union) so it can't drift — the median.ts /
// NEWS_ARTICLE_KEY_SQL / MISSED_CARVE_EXPR anti-duplication rule.
type Disposition = AmendmentVote["disposition"];

// Disposition dot color. Reuses the vote-outcome pair (HO 79) — an amendment
// being agreed to / not agreed to IS a floor-vote outcome, and these tokens are
// deliberately decoupled from party color, so a Democrat's failed amendment
// doesn't render Republican-red. "other" (the ~91% with no top-level action, or
// ambiguous text) stays muted.
export function dispositionColor(d: Disposition): string {
  if (d === "agreed") return "var(--vote-yea)";
  if (d === "failed") return "var(--vote-nay)";
  return "var(--text-muted)";
}

// Concise amendment-outcome verb from the derived disposition (the raw
// votes.result — "Amendment Agreed to" / "Amendment Rejected" — is verbose; the
// disposition abstracts a motion-to-table-agreed into the amendment's real fate).
export function voteVerb(d: Disposition): string {
  if (d === "agreed") return "Agreed";
  if (d === "failed") return "Rejected";
  return "Voted";
}

// HO 530 — the amendment vote line: tally + result verb, then the party split (the
// analytical headline — did it break on party lines). One dim mono line under the
// action text; absent entirely where no vote (the ~99% common case — the absence is
// the signal, HO 527 omit-don't-state). `moreVotes` > 0 flags a procedural+
// substantive pair without building a nested list (v1).
export function VoteLine({ vote, moreVotes }: { vote: AmendmentVote; moreVotes: number }) {
  const p = vote.party;
  // Suppress the party split when it's entirely zero (member_votes not yet synced
  // for the newest roll calls, e.g. house-119-2-269) — an all-zero split would
  // falsely read "0 D / 0 R voted" on a vote with a real tally (HO 533;
  // wrong-worse-than-absent, the HO 448 disposition-dot principle). The tally +
  // result always render; the split self-heals when member positions sync.
  const splitTotal = p.D.yea + p.D.nay + p.R.yea + p.R.nay + p.I.yea + p.I.nay;
  return (
    <div
      className="mt-1 text-[length:var(--fs-11)] tabular-nums"
      style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}
    >
      {/* HO 540 — the tally IS the anchor to the roll-call page (not a separate
          "details" affordance). One edit here lights the drill on BOTH /bill/[id]
          and the /amendments corpus feed (the HO 537 C2 extraction paying off). */}
      <Link href={`/vote/${vote.voteId}`} className="no-underline hover:underline" style={{ color: "var(--text-secondary)" }}>
        {voteVerb(vote.disposition)} {vote.yea}–{vote.nay}
      </Link>
      {vote.present > 0 ? ` · ${vote.present} present` : ""}
      {vote.notVoting > 0 ? ` · ${vote.notVoting} not voting` : ""}
      {splitTotal > 0 ? (
        <>
          {" · "}
          <span style={{ color: partyColor("D") }}>
            D {p.D.yea}–{p.D.nay}
          </span>
          {" · "}
          <span style={{ color: partyColor("R") }}>
            R {p.R.yea}–{p.R.nay}
          </span>
          {p.I.yea + p.I.nay > 0 ? (
            <>
              {" · "}
              <span style={{ color: partyColor("I") }}>
                I {p.I.yea}–{p.I.nay}
              </span>
            </>
          ) : null}
        </>
      ) : null}
      {moreVotes > 0 ? ` · +${moreVotes} earlier` : ""}
    </div>
  );
}
