import Link from "next/link";
import { formatDateLong } from "@/lib/format";
import type { BillAmendment } from "@/lib/queries";
import { partyColor } from "@/lib/race-colors";

// HO 448 — the /bill/[id] AMENDMENTS section body. Mirrors BillLobbying's
// grammar (same border box, top stat line, 0.5px row dividers). Server
// component, fed rows: BillAmendment[]; the page omits the whole section when
// getBillAmendments returns null. No embed-foot: there's no /amendments surface
// to link yet (banks as the aggregate fork), so a foot would be a dead link.
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

function AmendmentRow({ a }: { a: BillAmendment }) {
  const purpose = a.purpose ?? a.description;
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

      {a.amendsLabel ? (
        <div className="mt-1 text-[11px]" style={{ color: "var(--text-muted)" }}>
          ↳ amends {a.amendsLabel}
        </div>
      ) : null}
    </div>
  );
}

export function BillAmendments({ rows }: { rows: BillAmendment[] }) {
  const agreed = rows.filter((r) => r.disposition === "agreed").length;
  const failed = rows.filter((r) => r.disposition === "failed").length;
  const shown = rows.slice(0, RENDER_CAP);
  const overflow = rows.length - shown.length;

  const stat = [`${rows.length.toLocaleString()} amendments`];
  if (agreed > 0) stat.push(`${agreed.toLocaleString()} agreed`);
  if (failed > 0) stat.push(`${failed.toLocaleString()} failed`);

  return (
    <div className="border" style={{ borderColor: "var(--border-strong)" }}>
      <div
        className="px-[14px] py-[9px] text-[12px] tabular-nums"
        style={{ color: "var(--text-muted)", borderBottom: "0.5px solid var(--border-strong)" }}
      >
        {stat.join(" · ")}
      </div>

      {shown.map((a) => (
        <AmendmentRow key={a.id} a={a} />
      ))}

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
