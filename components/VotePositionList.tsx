import Link from "next/link";
import type { VoteMemberPosition, VotePosition } from "@/lib/queries";
import { partyColor, surname } from "@/lib/race-colors";

// HO 540 — the per-member position list on /vote/[id]. Server component (no client
// state — a static grouped list). Position-major grouping (Yea / Nay / Present /
// Not Voting), and WITHIN each group sorted by party then surname so cross-party
// defectors cluster at the party boundary rather than scattering alphabetically —
// that ordering is the analytical value (the handoff's rule). Names party-colored
// through the shared partyColor (HO 468), linking to the member hub. Position colors
// are the existing vote tokens; NOT Voting uses --text-dim (there is no not-voting
// token — don't mint one).
const GROUPS: { key: VotePosition; label: string; color: string }[] = [
  { key: "yea", label: "Yea", color: "var(--vote-yea)" },
  { key: "nay", label: "Nay", color: "var(--vote-nay)" },
  { key: "present", label: "Present", color: "var(--vote-present)" },
  { key: "not_voting", label: "Not Voting", color: "var(--text-dim)" },
];

// Party order within a group (D, R, I, then unknown) so the majority party fills
// first and the minority (the defectors) clusters at the tail.
const PARTY_ORDER: Record<string, number> = { D: 0, R: 1, I: 2 };
const partyRank = (p: string | null): number => (p && p in PARTY_ORDER ? PARTY_ORDER[p]! : 3);

function MemberItem({ p }: { p: VoteMemberPosition }) {
  // Unmatched bioguide (no members row — a departed / unsynced member; 1 corpus-wide
  // today, and the schema guarantees the case): plain muted text, NO link (the
  // /members page would 404) and no party bracket. The member still voted; the roll
  // call must not hide them. The BillAmendments Sponsor idiom (no resolved member →
  // muted text, no link).
  if (!p.name) {
    return (
      <li className="break-inside-avoid py-[2px] text-[12px] tabular-nums" style={{ fontFamily: "var(--font-mono)", color: "var(--text-dim)" }}>
        {p.bioguideId}
      </li>
    );
  }
  return (
    <li className="break-inside-avoid py-[2px] text-[12px]" style={{ fontFamily: "var(--font-mono)" }}>
      <Link href={`/members/${p.bioguideId}`} className="no-underline" style={{ color: partyColor(p.party) }}>
        {p.name}
      </Link>
      <span className="ml-1" style={{ color: "var(--text-dim)" }}>
        [{p.party ?? "?"}-{p.state ?? "?"}]
      </span>
    </li>
  );
}

export function VotePositionList({ positions }: { positions: VoteMemberPosition[] }) {
  const byPos = new Map<VotePosition, VoteMemberPosition[]>();
  for (const p of positions) {
    const list = byPos.get(p.position) ?? byPos.set(p.position, []).get(p.position)!;
    list.push(p);
  }
  for (const list of byPos.values()) {
    list.sort(
      (a, b) =>
        partyRank(a.party) - partyRank(b.party) ||
        surname(a.name ?? a.bioguideId).localeCompare(surname(b.name ?? b.bioguideId)),
    );
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      {GROUPS.map((g) => {
        const list = byPos.get(g.key) ?? [];
        if (list.length === 0) return null; // omit an empty position group (noise)
        return (
          <section key={g.key} className="border" style={{ borderColor: "var(--border-strong)" }}>
            <h2
              className="px-[14px] py-2 text-[12px] uppercase tracking-[0.5px] tabular-nums"
              style={{ color: g.color, borderBottom: "0.5px solid var(--border-soft)" }}
            >
              {g.label} · {list.length}
            </h2>
            {/* CSS multi-column so a 374-member Nay group flows across columns
                rather than one very tall column; break-inside-avoid keeps a row whole. */}
            <ul className="columns-2 gap-x-6 px-[14px] py-2 sm:columns-3 lg:columns-4">
              {list.map((p) => (
                <MemberItem key={p.bioguideId} p={p} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
