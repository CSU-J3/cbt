import Link from "next/link";
import { PartyTag } from "@/components/PartyTag";
import { searchMembers } from "@/lib/queries";

export async function SearchResultsMembers({ q }: { q: string }) {
  const members = await searchMembers(q);

  return (
    <ul className="search-results-members">
      {members.map((m) => (
        <li key={m.bioguide_id}>
          <Link
            href={`/members/${encodeURIComponent(m.bioguide_id)}`}
            className="member-search-row"
          >
            <span
              className="member-search-name truncate text-[14px]"
              style={{ color: "var(--text-primary)" }}
              title={m.name}
            >
              {m.name}
            </span>
            <span className="member-search-party text-[12px]">
              <PartyTag party={m.party} state={m.state} />
            </span>
            <span
              className="member-search-chamber text-[11px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              {m.chamber ?? ""}
            </span>
            <span
              className="member-search-count text-right text-[13px] tabular-nums"
              style={{ color: "var(--text-muted)" }}
            >
              {m.total.toLocaleString()} bills
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
