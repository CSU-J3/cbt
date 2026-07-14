import Link from "next/link";
import { HeaderBar } from "@/components/HeaderBar";
import {
  DISPOSITION_LABEL,
  dispositionColor,
} from "@/components/NominationDispositionBadge";
import { NominationRow } from "@/components/NominationRow";
import { Pagination } from "@/components/Pagination";
import { getCommitteeBySystemCode, getNominations, getNominationsSummary } from "@/lib/queries";

// Reads the DB (live GROUP BY + filtered list); opt out of static prerender.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const AGENCY_FACET_CAP = 15;

type SearchParams = { agency?: string; disposition?: string; committee?: string; page?: string };

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

// Build a /nominations href with the given filter overrides (null clears one),
// resetting page. Keeps the surface URL-driven (no client island).
function filterHref(
  base: { agency?: string; disposition?: string; committee?: string },
  override: { agency?: string | null; disposition?: string | null; committee?: string | null },
): string {
  const sp = new URLSearchParams();
  const agency = "agency" in override ? override.agency : base.agency;
  const disposition = "disposition" in override ? override.disposition : base.disposition;
  const committee = "committee" in override ? override.committee : base.committee;
  if (agency) sp.set("agency", agency);
  if (disposition) sp.set("disposition", disposition);
  if (committee) sp.set("committee", committee);
  const qs = sp.toString();
  return qs ? `/nominations?${qs}` : "/nominations";
}

export default async function NominationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const agency = params.agency || undefined;
  const disposition = params.disposition || undefined;
  const committee = params.committee || undefined;

  const summary = await getNominationsSummary();

  if (!summary || summary.civilianTotal === 0) {
    return (
      <div className="flex min-h-screen flex-col">
        <HeaderBar basePath="/nominations" />
        <main className="w-full flex-1 px-4 py-4">
          <h1 className="text-[14px] uppercase tracking-[0.5px]" style={{ color: "var(--accent-amber)" }}>
            Nominations
          </h1>
          <p className="mt-6 text-[13px]" style={{ color: "var(--text-dim)" }}>
            Nominations data is being prepared. Check back shortly.
          </p>
        </main>
      </div>
    );
  }

  const list = await getNominations({ agency, disposition, committee, page: parsePage(params.page) });
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const page = Math.min(list.page, totalPages);

  // Resolve the committee code to its name for the chip (cheap cached read); fall
  // back to the raw code if it doesn't resolve (honest — a non-Senate/unknown code).
  const committeeName = committee ? (await getCommitteeBySystemCode(committee))?.name ?? committee : null;

  const dispMax = Math.max(1, ...summary.byDisposition.map((d) => d.count));
  const agencies = summary.byAgency.slice(0, AGENCY_FACET_CAP);
  const agencyMax = Math.max(1, ...agencies.map((a) => a.count));
  const agencyOverflow = summary.byAgency.length - agencies.length;

  const carry = new URLSearchParams();
  if (agency) carry.set("agency", agency);
  if (disposition) carry.set("disposition", disposition);
  if (committee) carry.set("committee", committee);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/nominations" />

      <main className="w-full flex-1 px-4 py-4">
        {/* Header + honest military-exclusion disclosure */}
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1 className="text-[14px] uppercase tracking-[0.5px]" style={{ color: "var(--accent-amber)" }}>
            Nominations
          </h1>
          <span className="text-[12px] uppercase tracking-[0.5px] tabular-nums" style={{ color: "var(--text-muted)" }}>
            {summary.civilianTotal.toLocaleString()} civilian nominations ·{" "}
            {summary.militaryTotal.toLocaleString()} military service nominations excluded
          </span>
        </div>
        <p className="mb-4 max-w-[70ch] text-[12px] leading-snug" style={{ color: "var(--text-muted)", fontFamily: "var(--sans)" }}>
          Who the president is nominating and where each stands — civilian nominees (judges,
          cabinet and agency heads, ambassadors, US Attorneys), by agency and confirmation
          status. Bulk military service promotions are excluded; the 119th filed{" "}
          {summary.militaryTotal.toLocaleString()} of them.
        </p>

        {/* Headline: disposition distribution — segmented bar + clickable legend */}
        <section className="mb-5">
          <h2 className="mb-2 text-[12px] uppercase tracking-[0.5px]" style={{ color: "var(--text-secondary)" }}>
            By status
          </h2>
          <div className="mb-2 flex h-[12px] w-full overflow-hidden rounded-[2px]" style={{ backgroundColor: "var(--bg-row-hover)" }}>
            {summary.byDisposition.map((d) => (
              <Link
                key={d.disposition}
                href={filterHref({ agency, disposition, committee }, { disposition: disposition === d.disposition ? null : d.disposition })}
                scroll={false}
                title={`${DISPOSITION_LABEL[d.disposition]} · ${d.count}`}
                style={{
                  width: `${(d.count / summary.civilianTotal) * 100}%`,
                  backgroundColor: dispositionColor(d.disposition),
                  opacity: disposition && disposition !== d.disposition ? 0.3 : 0.8,
                }}
              />
            ))}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {summary.byDisposition.map((d) => {
              const active = disposition === d.disposition;
              return (
                <Link
                  key={d.disposition}
                  href={filterHref({ agency, disposition, committee }, { disposition: active ? null : d.disposition })}
                  scroll={false}
                  className="inline-flex items-center gap-1.5 text-[11px] no-underline transition hover:opacity-80"
                  style={{ opacity: disposition && !active ? 0.55 : 1 }}
                >
                  <span aria-hidden style={{ width: 8, height: 8, borderRadius: "50%", backgroundColor: dispositionColor(d.disposition) }} />
                  <span style={{ color: active ? "var(--accent-amber-bright)" : "var(--text-secondary)" }}>
                    {DISPOSITION_LABEL[d.disposition]}
                  </span>
                  <span className="tabular-nums" style={{ color: "var(--text-muted)" }}>{d.count.toLocaleString()}</span>
                </Link>
              );
            })}
          </div>
        </section>

        {/* Agency facet — clickable ranked rows (IssueBars idiom) */}
        <section className="mb-5">
          <h2 className="mb-2 text-[12px] uppercase tracking-[0.5px]" style={{ color: "var(--text-secondary)" }}>
            By agency
          </h2>
          <div className="border" style={{ borderColor: "var(--border-strong)" }}>
            <ul>
              {agencies.map((a) => {
                const active = agency === a.organization;
                const widthPct = (a.count / agencyMax) * 100;
                return (
                  <li key={a.organization}>
                    <Link
                      href={filterHref({ agency, disposition, committee }, { agency: active ? null : a.organization })}
                      scroll={false}
                      aria-current={active ? "true" : undefined}
                      className="grid items-center gap-x-[14px] px-[14px] py-[9px] no-underline transition hover:bg-[var(--bg-row-hover)]"
                      style={{
                        gridTemplateColumns: "minmax(0, 1.4fr) minmax(0, 2fr) 56px",
                        borderBottom: "0.5px solid var(--border-soft)",
                        borderLeft: `3px solid ${active ? "var(--accent-amber)" : "transparent"}`,
                        backgroundColor: active ? "var(--bg-row-hover)" : undefined,
                      }}
                    >
                      <span className="truncate text-[12px]" style={{ color: "var(--text-primary)" }}>
                        {a.organization}
                      </span>
                      <span className="block h-[10px] overflow-hidden rounded-[2px]" style={{ backgroundColor: "var(--bg-row-hover)" }} aria-hidden>
                        <span className="block h-full rounded-[2px]" style={{ width: `${widthPct}%`, backgroundColor: "var(--accent-amber)", opacity: 0.55 }} />
                      </span>
                      <span className="text-right text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>
                        {a.count.toLocaleString()}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
            {agencyOverflow > 0 ? (
              <div className="px-[14px] py-2 text-[11px]" style={{ color: "var(--text-muted)", borderTop: "0.5px solid var(--border-soft)" }}>
                {agencyOverflow} more agencies
              </div>
            ) : null}
          </div>
        </section>

        {/* The list */}
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-[12px] uppercase tracking-[0.5px]" style={{ color: "var(--text-secondary)" }}>
              {list.total.toLocaleString()} {agency || disposition || committee ? "matching" : "civilian"} nominations
            </h2>
            {agency ? (
              <Link href={filterHref({ agency, disposition, committee }, { agency: null })} scroll={false} className="rounded-[3px] px-2 py-0.5 text-[11px] no-underline" style={{ border: "0.5px solid var(--border-strong)", color: "var(--text-secondary)" }}>
                {agency} ✕
              </Link>
            ) : null}
            {disposition ? (
              <Link href={filterHref({ agency, disposition, committee }, { disposition: null })} scroll={false} className="rounded-[3px] px-2 py-0.5 text-[11px] no-underline" style={{ border: "0.5px solid var(--border-strong)", color: "var(--text-secondary)" }}>
                {DISPOSITION_LABEL[disposition as keyof typeof DISPOSITION_LABEL] ?? disposition} ✕
              </Link>
            ) : null}
            {committee ? (
              <Link href={filterHref({ agency, disposition, committee }, { committee: null })} scroll={false} className="rounded-[3px] px-2 py-0.5 text-[11px] no-underline" style={{ border: "0.5px solid var(--border-strong)", color: "var(--text-secondary)" }}>
                {committeeName} ✕
              </Link>
            ) : null}
            {agency || disposition || committee ? (
              <Link href="/nominations" scroll={false} className="text-[11px] uppercase tracking-[0.5px] no-underline" style={{ color: "var(--accent-amber)" }}>
                clear
              </Link>
            ) : null}
          </div>
          <div className="border" style={{ borderColor: "var(--border-strong)" }}>
            {list.rows.length > 0 ? (
              list.rows.map((n) => <NominationRow key={n.id} nomination={n} />)
            ) : (
              <div className="px-4 py-12 text-center text-[13px] uppercase tracking-[0.5px]" style={{ color: "var(--text-dim)" }}>
                No matching nominations
              </div>
            )}
          </div>
          {totalPages > 1 ? (
            <Pagination currentPage={page} totalPages={totalPages} carry={carry} basePath="/nominations" />
          ) : null}
        </section>
      </main>
    </div>
  );
}
