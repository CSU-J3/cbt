import Link from "next/link";
import { AmendmentRow } from "@/components/AmendmentRow";
import { HeaderBar } from "@/components/HeaderBar";
import { Pagination } from "@/components/Pagination";
import { partyColor } from "@/lib/race-colors";
import { getAmendments, getAmendmentsSummary } from "@/lib/queries";

// Reads the DB (live summary GROUP BYs + filtered feed); opt out of static prerender.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;
const TYPES = ["SAMDT", "HAMDT", "SUAMDT"] as const;
const DISPOSITIONS = ["acted", "filed"] as const;

type SearchParams = { type?: string; disposition?: string; bill?: string; page?: string };

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

// URL-driven filter href (null clears one), resetting page. No client island.
function filterHref(
  base: { type?: string; disposition?: string; bill?: string },
  override: { type?: string | null; disposition?: string | null; bill?: string | null },
): string {
  const sp = new URLSearchParams();
  const type = "type" in override ? override.type : base.type;
  const disposition = "disposition" in override ? override.disposition : base.disposition;
  const bill = "bill" in override ? override.bill : base.bill;
  if (type) sp.set("type", type);
  if (disposition) sp.set("disposition", disposition);
  if (bill) sp.set("bill", bill);
  const qs = sp.toString();
  return qs ? `/amendments?${qs}` : "/amendments";
}

const CHIP_CLASS = "rounded-[3px] px-2 py-0.5 text-[11px] uppercase tracking-[0.5px] no-underline";
function chipStyle(active: boolean) {
  return {
    border: "0.5px solid var(--border-strong)",
    color: active ? "var(--accent-amber-bright)" : "var(--text-secondary)",
    backgroundColor: active ? "var(--bg-row-hover)" : undefined,
  } as const;
}

// A ranked bar row (the /nominations agency-facet idiom) — a Link with a label,
// a proportional bar, and a right-aligned count.
function RankRow({
  href,
  label,
  sub,
  count,
  widthPct,
  dotColor,
}: {
  href: string;
  label: string;
  sub?: string | null;
  count: number;
  widthPct: number;
  dotColor?: string;
}) {
  return (
    <li>
      <Link
        href={href}
        className="grid items-center gap-x-[14px] px-[14px] py-[9px] no-underline transition hover:bg-[var(--bg-row-hover)]"
        style={{
          gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 2fr) 56px",
          borderBottom: "0.5px solid var(--border-soft)",
        }}
      >
        <span className="flex min-w-0 items-center gap-1.5">
          {dotColor ? (
            <span aria-hidden style={{ width: 7, height: 7, flexShrink: 0, borderRadius: "50%", backgroundColor: dotColor }} />
          ) : null}
          <span className="truncate text-[12px]" style={{ color: "var(--text-primary)" }}>
            {label}
          </span>
          {sub ? (
            <span className="truncate text-[11px]" style={{ color: "var(--text-muted)" }}>
              {sub}
            </span>
          ) : null}
        </span>
        <span className="block h-[10px] overflow-hidden rounded-[2px]" style={{ backgroundColor: "var(--bg-row-hover)" }} aria-hidden>
          <span className="block h-full rounded-[2px]" style={{ width: `${widthPct}%`, backgroundColor: "var(--accent-amber)", opacity: 0.55 }} />
        </span>
        <span className="text-right text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>
          {count.toLocaleString()}
        </span>
      </Link>
    </li>
  );
}

export default async function AmendmentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const type = params.type && (TYPES as readonly string[]).includes(params.type) ? params.type : undefined;
  const disposition =
    params.disposition && (DISPOSITIONS as readonly string[]).includes(params.disposition) ? params.disposition : undefined;
  const bill = params.bill || undefined;

  const summary = await getAmendmentsSummary();

  if (!summary || summary.total === 0) {
    return (
      <div className="flex min-h-screen flex-col">
        <HeaderBar basePath="/amendments" />
        <main className="w-full flex-1 px-4 py-4">
          <h1 className="text-[14px] uppercase tracking-[0.5px]" style={{ color: "var(--accent-amber)" }}>
            Amendments
          </h1>
          <p className="mt-6 text-[13px]" style={{ color: "var(--text-dim)" }}>
            Amendments data is being prepared. Check back shortly.
          </p>
        </main>
      </div>
    );
  }

  const list = await getAmendments({ type, disposition, bill, page: parsePage(params.page) });
  const totalPages = Math.max(1, Math.ceil(list.total / PAGE_SIZE));
  const page = Math.min(list.page, totalPages);

  // Resolve the bill pill label from the feed (all rows share the bill) → formatBillId; raw id fallback.
  const billLabel = bill ? (list.rows[0]?.amendedBillLabel ?? bill) : null;

  const billMax = Math.max(1, ...summary.topBills.map((b) => b.count));
  const sponsorMax = Math.max(1, ...summary.topSponsors.map((s) => s.count));

  // status segments (sum == total): agreed · failed · otherActed · filedOnly
  const segments = [
    { key: "agreed", count: summary.agreed, color: "var(--vote-yea)" },
    { key: "failed", count: summary.failed, color: "var(--vote-nay)" },
    { key: "other", count: summary.otherActed, color: "var(--text-secondary)" },
    { key: "filed", count: summary.filedOnly, color: "var(--bg-row-hover)" },
  ];

  const carry = new URLSearchParams();
  if (type) carry.set("type", type);
  if (disposition) carry.set("disposition", disposition);
  if (bill) carry.set("bill", bill);

  const base = { type, disposition, bill };

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/amendments" />

      <main className="w-full flex-1 px-4 py-4">
        {/* Header + blurb */}
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1 className="text-[14px] uppercase tracking-[0.5px]" style={{ color: "var(--accent-amber)" }}>
            Amendments
          </h1>
          <span className="text-[12px] uppercase tracking-[0.5px] tabular-nums" style={{ color: "var(--text-muted)" }}>
            {summary.total.toLocaleString()} filed · {summary.acted.toLocaleString()} acted
          </span>
        </div>
        <p className="mb-4 max-w-[70ch] text-[12px] leading-snug" style={{ color: "var(--text-muted)", fontFamily: "var(--sans)" }}>
          Floor amendments to bills — who's amending what, and the sliver that actually gets voted on.
          Most are filed in Senate budget vote-a-ramas and never called up: only{" "}
          {((100 * summary.acted) / summary.total).toFixed(1)}% carry any floor action.
        </p>

        {/* By status — the hero */}
        <section className="mb-5">
          <h2 className="mb-2 text-[12px] uppercase tracking-[0.5px]" style={{ color: "var(--text-secondary)" }}>
            By status
          </h2>
          <div className="mb-2 flex h-[12px] w-full overflow-hidden rounded-[2px]" style={{ backgroundColor: "var(--bg-row-hover)" }}>
            {segments.map((s) =>
              s.count > 0 ? (
                <div
                  key={s.key}
                  title={`${s.key} · ${s.count.toLocaleString()}`}
                  style={{ width: `${(s.count / summary.total) * 100}%`, backgroundColor: s.color, opacity: 0.85 }}
                />
              ) : null,
            )}
          </div>
          <div className="text-[12px] tabular-nums" style={{ color: "var(--text-muted)" }}>
            {summary.total.toLocaleString()} filed · {summary.acted.toLocaleString()} acted (
            <span style={{ color: "var(--vote-yea)" }}>{summary.agreed.toLocaleString()} agreed</span> ·{" "}
            <span style={{ color: "var(--vote-nay)" }}>{summary.failed.toLocaleString()} failed</span> ·{" "}
            {summary.otherActed.toLocaleString()} other) · {summary.filedOnly.toLocaleString()} awaiting floor action
          </div>
          <div className="mt-0.5 text-[11px] uppercase tracking-[0.5px] tabular-nums" style={{ color: "var(--text-dim)" }}>
            {summary.byChamber.senate.toLocaleString()} Senate · {summary.byChamber.house.toLocaleString()} House
          </div>
        </section>

        <div className="mb-5 grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* Most-amended bills */}
          <section>
            <h2 className="mb-2 text-[12px] uppercase tracking-[0.5px]" style={{ color: "var(--text-secondary)" }}>
              Most-amended bills
            </h2>
            <div className="border" style={{ borderColor: "var(--border-strong)" }}>
              <ul>
                {summary.topBills.map((b) => (
                  <RankRow
                    key={b.billId}
                    href={`/bill/${b.billId}`}
                    label={b.billLabel}
                    sub={b.billTitle}
                    count={b.count}
                    widthPct={(b.count / billMax) * 100}
                  />
                ))}
              </ul>
            </div>
          </section>

          {/* Top amenders */}
          <section>
            <h2 className="mb-2 text-[12px] uppercase tracking-[0.5px]" style={{ color: "var(--text-secondary)" }}>
              Top amenders
            </h2>
            <div className="border" style={{ borderColor: "var(--border-strong)" }}>
              <ul>
                {summary.topSponsors.map((s) => (
                  <RankRow
                    key={s.bioguideId}
                    href={`/members/${s.bioguideId}`}
                    label={s.name}
                    sub={`[${s.party ?? "?"}-${s.state ?? "?"}]`}
                    count={s.count}
                    widthPct={(s.count / sponsorMax) * 100}
                    dotColor={partyColor(s.party)}
                  />
                ))}
              </ul>
            </div>
          </section>
        </div>

        {/* Feed */}
        <section>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <h2 className="text-[12px] uppercase tracking-[0.5px]" style={{ color: "var(--text-secondary)" }}>
              {list.total.toLocaleString()} {type || disposition || bill ? "matching" : ""} amendments
            </h2>
            {/* type chips */}
            <div className="flex items-center gap-1">
              <Link href={filterHref(base, { type: null })} scroll={false} className={CHIP_CLASS} style={chipStyle(!type)}>
                All
              </Link>
              {(["SAMDT", "HAMDT"] as const).map((t) => (
                <Link
                  key={t}
                  href={filterHref(base, { type: type === t ? null : t })}
                  scroll={false}
                  className={CHIP_CLASS}
                  style={chipStyle(type === t)}
                >
                  {t}
                </Link>
              ))}
            </div>
            {/* disposition chips */}
            <div className="flex items-center gap-1">
              <Link
                href={filterHref(base, { disposition: disposition === "acted" ? null : "acted" })}
                scroll={false}
                className={CHIP_CLASS}
                style={chipStyle(disposition === "acted")}
              >
                Acted
              </Link>
              <Link
                href={filterHref(base, { disposition: disposition === "filed" ? null : "filed" })}
                scroll={false}
                className={CHIP_CLASS}
                style={chipStyle(disposition === "filed")}
              >
                Filed-only
              </Link>
            </div>
            {/* bill pill */}
            {bill ? (
              <Link
                href={filterHref(base, { bill: null })}
                scroll={false}
                className="rounded-[3px] px-2 py-0.5 text-[11px] no-underline"
                style={{ border: "0.5px solid var(--border-strong)", color: "var(--text-secondary)" }}
              >
                {billLabel} ✕
              </Link>
            ) : null}
            {type || disposition || bill ? (
              <Link href="/amendments" scroll={false} className="text-[11px] uppercase tracking-[0.5px] no-underline" style={{ color: "var(--accent-amber)" }}>
                clear
              </Link>
            ) : null}
          </div>
          <div className="border" style={{ borderColor: "var(--border-strong)" }}>
            {list.rows.length > 0 ? (
              list.rows.map((a) => <AmendmentRow key={a.id} amendment={a} />)
            ) : (
              <div className="px-4 py-12 text-center text-[13px] uppercase tracking-[0.5px]" style={{ color: "var(--text-dim)" }}>
                No matching amendments
              </div>
            )}
          </div>
          {totalPages > 1 ? (
            <Pagination currentPage={page} totalPages={totalPages} carry={carry} basePath="/amendments" />
          ) : null}
        </section>
      </main>
    </div>
  );
}
