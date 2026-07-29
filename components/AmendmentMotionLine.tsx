import Link from "next/link";
import type { AmendmentMotion } from "@/lib/queries";
import { partyColor } from "@/lib/race-colors";

// HO 557 — the motion line: a SECOND line under an amendment whose only floor roll
// call is a MOTION about it (tabling / cloture / chair / budget waiver), not an
// up-or-down vote. A NEW sibling of AmendmentVoteLine.tsx, NOT a widened VoteLine
// (scope guard 3): VoteLine's verbs are amendment-framed ("Agreed 52–47") and would
// be a LIE here — a tabling motion agreed is a KILL, not an "agreed" amendment. Same
// visual idiom (one dim mono 11px line, tally → /vote/[id], party split), motion-framed
// grammar. It renders ONLY where the amendment has no anchored decisive vote (the two
// render sites gate on `list.length === 0`), so a MotionLine and a VoteLine are
// mutually exclusive on a row — they can never stack.

const MOTION_LABEL: Record<AmendmentMotion["motion"], string> = {
  table: "Motion to table",
  cloture: "Cloture",
  chair: "Decision of the chair",
  waiver: "Budget waiver",
};

// The MOTION's own verb (honest about the motion regardless of the amendment's fate).
function motionVerb(outcome: AmendmentMotion["outcome"]): string {
  if (outcome === "agreed") return "agreed";
  if (outcome === "failed") return "rejected";
  return "voted";
}

export function MotionLine({ motion }: { motion: AmendmentMotion }) {
  const p = motion.party;
  // Same all-zero suppression as VoteLine (HO 533) — these roll calls lag member_votes
  // too, and a false "D 0–0 · R 0–0" is the same lie here.
  const splitTotal = p.D.yea + p.D.nay + p.R.yea + p.R.nay + p.I.yea + p.I.nay;
  return (
    <div
      className="mt-1 text-[11px] tabular-nums"
      style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}
    >
      <Link
        href={`/vote/${motion.voteId}`}
        className="no-underline hover:underline"
        style={{ color: "var(--text-secondary)" }}
      >
        {MOTION_LABEL[motion.motion]} {motionVerb(motion.outcome)} {motion.yea}–{motion.nay}
      </Link>
      {/* Fate clause renders ONLY on "killed" (HO 557 §1 ruling — kill-direction only).
          "undecided" (a failed tabling / an agreed waiver — not killed by THIS motion)
          and "orthogonal" (cloture / chair) render the tally with no arrow and no fate
          word: claiming a fate there is the exact error this model exists to avoid. */}
      {motion.fate === "killed" ? " → amendment killed" : ""}
      {motion.present > 0 ? ` · ${motion.present} present` : ""}
      {motion.notVoting > 0 ? ` · ${motion.notVoting} not voting` : ""}
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
    </div>
  );
}
