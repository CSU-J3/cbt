import Link from "next/link";
import { HeaderBar } from "@/components/HeaderBar";
import { Pagination } from "@/components/Pagination";
import { TradeRow } from "@/components/TradeRow";
import { getMember, getMostTradedTickers, getRecentTrades } from "@/lib/queries";

// Reads the DB; opt out of static prerender. unstable_cache still applies.
export const dynamic = "force-dynamic";

const PAGE_SIZE = 50;
const TICKER_WINDOW_DAYS = 90;

type SearchParams = {
  page?: string;
  member?: string;
};

function parsePage(raw: string | undefined): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

// bioguide ids are alphanumeric (e.g. "S000033") — guard the URL input.
function parseMember(raw: string | undefined): string | undefined {
  return typeof raw === "string" && /^[A-Za-z0-9]+$/.test(raw) ? raw : undefined;
}

export default async function TradesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const page = parsePage(params.page);
  const bioguideId = parseMember(params.member);

  // Ticker rollup is corpus-wide ("who's trading what, lately") — only on the
  // unscoped index. A member-scoped view shows that member's feed instead.
  const [feed, member, topTickers] = await Promise.all([
    getRecentTrades({ bioguideId, page, pageSize: PAGE_SIZE }),
    bioguideId ? getMember(bioguideId) : Promise.resolve(null),
    bioguideId
      ? Promise.resolve([])
      : getMostTradedTickers(TICKER_WINDOW_DAYS, 12),
  ]);

  const carry = new URLSearchParams();
  if (bioguideId) carry.set("member", bioguideId);

  const tickerMax = topTickers.reduce((m, t) => Math.max(m, t.tradeCount), 0);

  const scopedName = member?.name ?? feed.trades[0]?.memberNameRaw ?? null;

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/trades" />

      <main className="w-full flex-1 px-4 py-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            {bioguideId && scopedName ? `${scopedName} · trades` : "Stock trades"}
          </h1>
          <span
            className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {feed.total.toLocaleString()} disclosure
            {feed.total === 1 ? "" : "s"}
            {bioguideId ? " on file" : " across Congress · most recent first"}
          </span>
          {bioguideId ? (
            <Link
              href="/trades"
              className="text-[12px] uppercase tracking-[0.5px] transition hover:text-[var(--accent-amber-bright)]"
              style={{ color: "var(--text-dim)" }}
            >
              ← All trades
            </Link>
          ) : null}
        </div>

        {topTickers.length > 0 ? (
          <section
            className="mb-4 border"
            style={{ borderColor: "var(--border-strong)" }}
          >
            <div
              className="flex items-baseline justify-between px-4 py-2"
              style={{
                backgroundColor: "var(--bg-panel)",
                borderBottom: "0.5px solid var(--border-strong)",
              }}
            >
              <h2
                className="text-[12px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-secondary)" }}
              >
                Most-traded tickers
              </h2>
              <span
                className="text-[11px] uppercase tracking-[0.5px]"
                style={{ color: "var(--text-dim)" }}
              >
                Last {TICKER_WINDOW_DAYS} days
              </span>
            </div>
            <ul className="flex flex-col gap-1.5 px-4 py-3">
              {topTickers.map((t) => {
                const pct =
                  tickerMax > 0 ? (t.tradeCount / tickerMax) * 100 : 0;
                return (
                  <li
                    key={t.ticker}
                    className="grid items-center gap-3"
                    style={{ gridTemplateColumns: "70px 1fr 150px" }}
                  >
                    <span
                      className="text-[13px] font-semibold tracking-[0.5px]"
                      style={{ color: "var(--text-primary)" }}
                    >
                      {t.ticker}
                    </span>
                    <span
                      className="block h-[10px] overflow-hidden rounded-[2px]"
                      style={{ backgroundColor: "var(--bg-row-hover)" }}
                    >
                      <span
                        className="block h-full rounded-[2px]"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: "var(--accent-amber)",
                        }}
                      />
                    </span>
                    <span
                      className="text-right text-[12px] tabular-nums"
                      style={{ color: "var(--text-muted)" }}
                    >
                      {t.tradeCount.toLocaleString()} trade
                      {t.tradeCount === 1 ? "" : "s"} · {t.memberCount}{" "}
                      {t.memberCount === 1 ? "member" : "members"}
                    </span>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        <div className="border" style={{ borderColor: "var(--border-strong)" }}>
          {feed.trades.length === 0 ? (
            <div
              className="px-6 py-12 text-center text-[13px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              No disclosed trades on file
            </div>
          ) : (
            <>
              <div className="trade-header-row trade-header-row--with-member px-4">
                <span>Member</span>
                <span className="trade-date">Disclosed</span>
                <span className="chamber-chip">Ch.</span>
                <span>Ticker</span>
                <span className="asset-description">Asset</span>
                <span>Type</span>
                <span className="amount">Amount</span>
              </div>
              <ul>
                {feed.trades.map((t) => (
                  <li key={t.id} className="px-4">
                    <TradeRow trade={t} showMember />
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>

        {feed.totalPages > 1 ? (
          <Pagination
            currentPage={feed.page}
            totalPages={feed.totalPages}
            carry={carry}
            basePath="/trades"
          />
        ) : null}
      </main>
    </div>
  );
}
