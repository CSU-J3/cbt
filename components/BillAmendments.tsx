import Link from "next/link";
import { formatDateLong } from "@/lib/format";
import type { AmendmentVote, BillAmendment } from "@/lib/queries";
import { partyColor } from "@/lib/race-colors";

// HO 448 — the /bill/[id] AMENDMENTS section body. Mirrors BillLobbying's
// grammar (same border box, 0.5px row dividers). Server component, fed rows:
// BillAmendment[]; the page omits the whole section when getBillAmendments
// returns null. No embed-foot: the header out-link to the /amendments aggregate
// (shipped HO 461) is the page's section-shell concern (HO 507), not this box's.
//
// HO 507: the top stat line ("N amendments · X agreed · Y failed") moved UP into
// the section-shell header on /bill/[id] (the count duplicated the shell's), so
// this component no longer renders it — it owns only the rows + overflow foot.
//
// Render cap: the worst magnet bill carries ~1,100 amendments (119-sconres-7),
// too many to dump into the DOM, so cap at the top 60 in the query's recency
// order and note the overflow. Low-count bills (the common case) fall well under
// and render whole.
const RENDER_CAP = 60;

// Disposition dot color. Reuses the vote-outcome pair (HO 79) — an amendment
// being agreed to / not agreed to IS a floor-vote outcome, and these tokens are
// deliberately decoupled from party color, so a Democrat's failed amendment
// doesn't render Republican-red. "other" (the ~91% with no top-level action, or
// ambiguous text) stays muted.
function dispositionColor(d: BillAmendment["disposition"]): string {
  if (d === "agreed") return "var(--vote-yea)";
  if (d === "failed") return "var(--vote-nay)";
  return "var(--text-muted)";
}

// Concise amendment-outcome verb from the derived disposition (the raw
// votes.result — "Amendment Agreed to" / "Amendment Rejected" — is verbose; the
// disposition abstracts a motion-to-table-agreed into the amendment's real fate).
function voteVerb(d: AmendmentVote["disposition"]): string {
  if (d === "agreed") return "Agreed";
  if (d === "failed") return "Rejected";
  return "Voted";
}

// HO 530 — the Senate amendment vote line: tally + result verb, then the party
// split (the analytical headline — did it break on party lines). One dim mono line
// under the action text; absent entirely where no vote (the ~99% common case — the
// absence is the signal, HO 527 omit-don't-state). `moreVotes` > 0 flags a
// procedural+substantive pair without building a nested list (v1).
function VoteLine({ vote, moreVotes }: { vote: AmendmentVote; moreVotes: number }) {
  const p = vote.party;
  // Suppress the party split when it's entirely zero (member_votes not yet synced
  // for the newest roll calls, e.g. house-119-2-269) — an all-zero split would
  // falsely read "0 D / 0 R voted" on a vote with a real tally (HO 533;
  // wrong-worse-than-absent, the HO 448 disposition-dot principle). The tally +
  // result always render; the split self-heals when member positions sync.
  const splitTotal = p.D.yea + p.D.nay + p.R.yea + p.R.nay + p.I.yea + p.I.nay;
  return (
    <div
      className="mt-1 text-[11px] tabular-nums"
      style={{ fontFamily: "var(--font-mono)", color: "var(--text-muted)" }}
    >
      <span style={{ color: "var(--text-secondary)" }}>
        {voteVerb(vote.disposition)} {vote.yea}–{vote.nay}
      </span>
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

function Sponsor({ a }: { a: BillAmendment }) {
  // Committee/manager amendments carry a name but no bioguide (~1.2%): plain
  // muted text, no link. A resolved member gets a party-colored member link.
  if (!a.sponsorBioguideId) {
    return a.sponsorName ? (
      <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
        {a.sponsorName}
      </span>
    ) : null;
  }
  // sponsor_name already carries the "[D-CT]" party-state bracket, so don't
  // re-append sponsorState (it'd read "...[D-CT] · CT"). The link color conveys
  // party; the name conveys identity + state.
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

function AmendmentRow({
  a,
  vote,
  moreVotes,
}: {
  a: BillAmendment;
  vote: AmendmentVote | null;
  moreVotes: number;
}) {
  const purpose = a.purpose ?? a.description;
  // Where a real vote exists, the dot follows the vote outcome (authoritative);
  // else it falls back to the latest_action_text keyword scan (a.disposition). A
  // neutral dot beside a "Rejected 45–53" line would be incoherent — HO 530.
  const dotDisposition = vote ? vote.disposition : a.disposition;
  return (
    <div className="px-[14px] py-[9px]" style={{ borderTop: "0.5px solid var(--border-soft)" }}>
      <div className="flex items-center gap-2">
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
      </div>

      {purpose ? (
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
          {purpose}
        </div>
      ) : null}

      <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
        {a.latestActionText
          ? `${a.latestActionText}${a.latestActionDate ? ` · ${formatDateLong(a.latestActionDate)}` : ""}`
          : `Submitted ${formatDateLong(a.submittedDate)} · no floor action yet`}
      </div>

      {vote ? <VoteLine vote={vote} moreVotes={moreVotes} /> : null}

      {a.amendsLabel ? (
        <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          ↳ amends {a.amendsLabel}
        </div>
      ) : null}
    </div>
  );
}

export function BillAmendments({
  rows,
  votes,
}: {
  rows: BillAmendment[];
  // Plain object keyed by amendmentId (NOT a Map — getBillAmendmentVotes is
  // unstable_cache'd, which serializes a Map to {}; HO 533).
  votes: Record<string, AmendmentVote[]>;
}) {
  const shown = rows.slice(0, RENDER_CAP);
  const overflow = rows.length - shown.length;

  return (
    <div className="border" style={{ borderColor: "var(--border-strong)" }}>
      {shown.map((a) => {
        const list = votes[a.id] ?? [];
        return (
          <AmendmentRow
            key={a.id}
            a={a}
            vote={list[0] ?? null}
            moreVotes={Math.max(0, list.length - 1)}
          />
        );
      })}

      {overflow > 0 ? (
        <div
          className="px-[14px] py-2 text-[11px]"
          style={{ color: "var(--text-muted)", borderTop: "0.5px solid var(--border-soft)" }}
        >
          {overflow.toLocaleString()} more
        </div>
      ) : null}
    </div>
  );
}
