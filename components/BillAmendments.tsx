import Link from "next/link";
import { formatDateLong } from "@/lib/format";
import type { AmendmentMotion, AmendmentVote, BillAmendment } from "@/lib/queries";
import { partyColor } from "@/lib/race-colors";
import { VoteLine, dispositionColor } from "@/components/AmendmentVoteLine";
import { MotionLine } from "@/components/AmendmentMotionLine";

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
// HO 537: VoteLine / voteVerb / dispositionColor moved to the shared leaf
// components/AmendmentVoteLine.tsx (the /amendments corpus feed is the third
// consumer). Imported above; render is byte-identical.
//
// Render cap: the worst magnet bill carries ~1,100 amendments (119-sconres-7),
// too many to dump into the DOM, so cap at the top 60 in the query's recency
// order and note the overflow. Low-count bills (the common case) fall well under
// and render whole.
const RENDER_CAP = 60;

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
  motions,
}: {
  a: BillAmendment;
  vote: AmendmentVote | null;
  moreVotes: number;
  // HO 557 — the amendment's motion roll calls (tabling / cloture / chair / waiver).
  // Rendered ONLY when there is no anchored decisive `vote` (suppression rule), so a
  // MotionLine and a VoteLine are mutually exclusive on a row.
  motions: AmendmentMotion[];
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

export function BillAmendments({
  rows,
  votes,
  motions,
}: {
  rows: BillAmendment[];
  // Plain object keyed by amendmentId (NOT a Map — getBillAmendmentVotes is
  // unstable_cache'd, which serializes a Map to {}; HO 533).
  votes: Record<string, AmendmentVote[]>;
  // HO 557 — motion roll calls keyed by amendmentId (getSenateAmendmentMotions).
  motions: Record<string, AmendmentMotion[]>;
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
            motions={motions[a.id] ?? []}
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
