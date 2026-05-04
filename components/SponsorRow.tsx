import Link from "next/link";
import { formatBillId, formatDateShort } from "@/lib/format";
import {
  type FeedBill,
  normalizePartyVariant,
  type Sponsor,
} from "@/lib/queries";

function partyColorFor(party: string | null): string {
  const key = normalizePartyVariant(party);
  if (key === "R") return "var(--party-republican)";
  if (key === "D") return "var(--party-democrat)";
  if (key === "I") return "var(--party-independent)";
  return "var(--text-dim)";
}

function partyBadge(party: string | null): string {
  return normalizePartyVariant(party) ?? "?";
}

export type SponsorRowFilters = {
  party: string | undefined;
  state: string | undefined;
  q: string | undefined;
};

export function SponsorRow({
  sponsor,
  filters,
  expanded,
  recentBills,
}: {
  sponsor: Sponsor;
  filters: SponsorRowFilters;
  expanded: boolean;
  recentBills: FeedBill[];
}) {
  const slug = encodeURIComponent(sponsor.sponsor_name);

  const params = new URLSearchParams();
  if (filters.party) params.set("party", filters.party);
  if (filters.state) params.set("state", filters.state);
  if (filters.q) params.set("q", filters.q);
  if (!expanded) params.set("expanded", sponsor.sponsor_name);
  const qs = params.toString();
  const href = qs ? `/sponsors?${qs}` : "/sponsors";

  return (
    <li>
      <Link
        href={href}
        replace
        scroll={false}
        prefetch={false}
        className={`sponsor-row ${expanded ? "is-expanded" : ""}`}
      >
        <span
          aria-hidden
          style={{
            color: expanded ? "var(--accent-amber)" : "var(--text-dim)",
          }}
        >
          {expanded ? "▾" : "▸"}
        </span>
        <span
          className="text-[14px] font-medium"
          style={{ color: "var(--text-primary)" }}
        >
          {sponsor.sponsor_name}
        </span>
        <span
          className="text-[13px] font-medium"
          style={{ color: partyColorFor(sponsor.sponsor_party) }}
        >
          {partyBadge(sponsor.sponsor_party)}
        </span>
        <span
          className="text-[13px]"
          style={{ color: "var(--text-muted)" }}
        >
          {sponsor.sponsor_state ?? ""}
        </span>
        <span
          className="text-right text-[14px] font-medium tabular-nums"
          style={{ color: "var(--accent-amber-bright)" }}
        >
          {sponsor.bill_count.toLocaleString()}
        </span>
        <span
          className="text-[13px]"
          style={{ color: "var(--text-muted)" }}
        >
          {formatDateShort(sponsor.latest_action_date)}
        </span>
      </Link>
      {expanded ? (
        <div className="sponsor-expanded-panel">
          {recentBills.length === 0 ? (
            <p
              className="text-[13px]"
              style={{ color: "var(--text-dim)" }}
            >
              No recent bills found.
            </p>
          ) : (
            <ul className="space-y-2">
              {recentBills.map((b) => (
                <li
                  key={b.id}
                  className="flex items-baseline gap-3 text-[14px]"
                >
                  <Link
                    href={`/bill/${b.id}`}
                    className="font-medium whitespace-nowrap"
                    style={{ color: "var(--accent-amber)" }}
                  >
                    {formatBillId(b.bill_type, b.bill_number)}
                  </Link>
                  <span
                    className="min-w-0 flex-1 truncate"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {b.title}
                  </span>
                  <span
                    className="text-[13px] whitespace-nowrap"
                    style={{ color: "var(--text-dim)" }}
                  >
                    {formatDateShort(b.latest_action_date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3">
            <Link
              href={`/?sponsor=${slug}`}
              className="inline-block text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
              style={{ color: "var(--accent-amber)" }}
            >
              [View all {sponsor.bill_count} bills →]
            </Link>
          </div>
        </div>
      ) : null}
    </li>
  );
}
