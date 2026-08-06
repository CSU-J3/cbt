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
              className="member-search-name truncate text-[length:var(--fs-14)]"
              style={{ color: "var(--text-primary)" }}
              title={m.name}
            >
              {m.name}
            </span>
            <span className="member-search-party text-[length:var(--fs-12)]">
              <PartyTag party={m.party} state={m.state} />
            </span>
            <span
              className="member-search-chamber text-[length:var(--fs-11)] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              {m.chamber ?? ""}
            </span>
            <span
              className="member-search-count text-right text-[length:var(--fs-13)] tabular-nums"
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
