import Link from "next/link";
import { BillRow } from "@/components/BillRow";
import { HeaderBar } from "@/components/HeaderBar";
import { PatternBubbleSVG } from "@/components/PatternBubbleSVG";
import { PatternDrilldownPanel } from "@/components/PatternDrilldownPanel";
import { PatternLegend } from "@/components/PatternLegend";
import {
  getClusterDrilldown,
  getClusterStats,
  getUnmatchedClusterCount,
  getWatchedBillIds,
  sanitizeClusterId,
  sanitizeIncludeCeremonial,
} from "@/lib/queries";

type SearchParams = {
  ceremonial?: string;
  selected?: string;
};

export default async function PatternsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const includeCeremonial = sanitizeIncludeCeremonial(params.ceremonial);
  const selected = sanitizeClusterId(params.selected) ?? null;

  const [stats, unmatched] = await Promise.all([
    getClusterStats(),
    getUnmatchedClusterCount(includeCeremonial),
  ]);

  const matched = stats.reduce((s, c) => s + c.count, 0);

  // Right column when a pattern is selected: top-10 recent bills, with
  // watchlist membership pre-resolved so the inline star renders correctly
  // on first paint (matches the rest of the feed-shape pages).
  const selectedDrilldown = selected ? await getClusterDrilldown(selected) : null;
  const watchedIds = selected ? await getWatchedBillIds() : [];
  const watchedSet = new Set(watchedIds);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar />

      <main className="w-full flex-1 px-4 py-4">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            Bill patterns
          </h1>
          <span
            className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {stats.length} patterns · {matched.toLocaleString()} bills matched ·{" "}
            {unmatched.toLocaleString()} unmatched
          </span>
        </div>

        <p
          className="mb-3 text-[12px] leading-snug"
          style={{ color: "var(--text-muted)" }}
        >
          Pattern-matched cluster identities for bills that share a structural
          pattern. Click a bubble to drill in; click again to deselect.
        </p>

        <div className="patterns-layout">
          <div className="patterns-left">
            <PatternBubbleSVG stats={stats} selected={selected} />
            <PatternLegend />
            {selected ? (
              <PatternDrilldownPanel clusterId={selected} />
            ) : null}
          </div>

          <aside className="patterns-right">
            {selected && selectedDrilldown ? (
              <>
                <div
                  className="pattern-right-header text-[11px] uppercase tracking-[0.5px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  Recent bills · {selected}
                </div>
                {selectedDrilldown.recentBills.length === 0 ? (
                  <div
                    className="px-3 py-6 text-[12px]"
                    style={{ color: "var(--text-dim)" }}
                  >
                    No bills match this pattern yet.
                  </div>
                ) : (
                  <ul className="pattern-recent-bills">
                    {selectedDrilldown.recentBills.map((b) => (
                      <BillRow
                        key={b.id}
                        bill={b}
                        compact
                        onWatchlist={watchedSet.has(b.id)}
                      />
                    ))}
                  </ul>
                )}
              </>
            ) : (
              <>
                <div
                  className="pattern-right-header text-[11px] uppercase tracking-[0.5px]"
                  style={{ color: "var(--text-muted)" }}
                >
                  All patterns
                </div>
                <p
                  className="px-3 pt-1 pb-2 text-[12px]"
                  style={{ color: "var(--text-dim)" }}
                >
                  Click a bubble to drill in.
                </p>
                <div
                  className="border-t"
                  style={{ borderColor: "var(--border-strong)" }}
                >
                  <div className="cluster-header-row">
                    <span>Pattern</span>
                    <span className="text-right">Count</span>
                    <span>Example</span>
                  </div>
                  <ul>
                    {stats.map((c) => {
                      const href = `/patterns?selected=${encodeURIComponent(c.id)}`;
                      return (
                        <li key={c.id}>
                          <Link
                            href={href}
                            scroll={false}
                            className="cluster-row"
                            title={c.description}
                          >
                            <span className="flex flex-col leading-tight">
                              <span
                                className="text-[14px] font-medium"
                                style={{ color: "var(--text-primary)" }}
                              >
                                {c.name}
                              </span>
                              <span
                                className="text-[12px]"
                                style={{ color: "var(--text-dim)" }}
                              >
                                {c.id}
                              </span>
                            </span>
                            <span
                              className="text-right text-[14px] font-medium tabular-nums"
                              style={{
                                color:
                                  c.count > 0
                                    ? "var(--accent-amber-bright)"
                                    : "var(--text-dim)",
                              }}
                            >
                              {c.count.toLocaleString()}
                            </span>
                            <span
                              className="truncate text-[13px]"
                              style={{ color: "var(--text-secondary)" }}
                            >
                              {c.exampleTitle ?? "—"}
                            </span>
                          </Link>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
