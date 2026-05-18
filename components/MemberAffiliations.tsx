import { CaucusBadge } from "./CaucusBadge";
import type { MemberAffiliation } from "@/lib/queries";

// Full affiliations row under the stats block. Renders nothing when the
// member has zero affiliations — saves vertical space; the header meta
// line is the only surface that ever changes for an unaffiliated member.
export function MemberAffiliations({
  affiliations,
}: {
  affiliations: MemberAffiliation[];
}) {
  if (affiliations.length === 0) return null;

  return (
    <div
      className="py-4"
      style={{ borderTop: "0.5px solid var(--border-soft)" }}
    >
      <div
        className="mb-2 text-[12px] uppercase tracking-[0.5px]"
        style={{ color: "var(--text-dim)" }}
      >
        Affiliations
      </div>
      <div className="flex flex-wrap gap-2">
        {affiliations.map((a) => (
          <CaucusBadge key={a.org} org={a.org} />
        ))}
      </div>
    </div>
  );
}
