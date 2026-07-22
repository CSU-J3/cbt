import { BillRow } from "@/components/BillRow";
import { FillerWatchStrip } from "@/components/FillerWatchStrip";
import { GroupTabs } from "@/components/GroupTabs";
import { HeaderBar } from "@/components/HeaderBar";
import { PatternBars } from "@/components/PatternBars";
import { PatternDrilldownPanel } from "@/components/PatternDrilldownPanel";
import { PatternLegend } from "@/components/PatternLegend";
import {
  getClusterDrilldown,
  getClusterStats,
  getFillerWatch,
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
  // HO 490: one page-computed clock threaded to the drilldown's compact feed
  // rows so relative-age buckets match across SSR/hydration (#418).
  const nowMs = Date.now();
  const includeCeremonial = sanitizeIncludeCeremonial(params.ceremonial);

  const [stats, unmatched, filler] = await Promise.all([
    getClusterStats(),
    getUnmatchedClusterCount(includeCeremonial),
    getFillerWatch(),
  ]);

  // HO 347 — auto-select the top (highest-count) pattern when the URL carries
  // none, so the right column is never blank. stats is count-DESC, so [0] is
  // the leader (Awareness designation today). A ?selected= still overrides.
  const selected = sanitizeClusterId(params.selected) ?? stats[0]?.id ?? null;

  // HO 346 — meta-line figures, computed live (both move every sync). Denominator
  // is the page's OWN matched + unmatched (≈16,469), NOT the corpus / BILLS
  // TRACKED figure (≈16,538) — using the corpus count makes the 8.6% stop
  // reconciling with the unmatched number. The one-offs stay implied by total.
  const matched = stats.reduce((s, c) => s + c.count, 0);
  const patternTotal = matched + unmatched;
  const matchedPct =
    patternTotal > 0 ? ((matched / patternTotal) * 100).toFixed(1) : "0.0";

  // Right column when a pattern is selected: top-10 recent bills, with
  // watchlist membership pre-resolved so the inline star renders correctly
  // on first paint (matches the rest of the feed-shape pages).
  const selectedDrilldown = selected ? await getClusterDrilldown(selected) : null;
  const watchedIds = selected ? await getWatchedBillIds() : [];
  const watchedSet = new Set(watchedIds);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/patterns" />

      <main className="w-full flex-1 px-4 py-4">
        <GroupTabs group="patterns" active="patterns" />
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h1
            className="text-[14px] uppercase tracking-[0.5px]"
            style={{ color: "var(--accent-amber)" }}
          >
            Legislative patterns
          </h1>
          <span
            className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
            style={{ color: "var(--text-muted)" }}
          >
            {matched.toLocaleString()} measures in {stats.length} forms · out of{" "}
            {patternTotal.toLocaleString()} · {matchedPct}%
          </span>
        </div>

        {/* HO 348 — Filler Watch strip: between the meta line and the blurb. */}
        <FillerWatchStrip data={filler} />

        <p
          className="mb-3 text-[12px] leading-snug"
          style={{ color: "var(--text-muted)", fontFamily: "var(--sans)" }}
        >
          The same forms of legislation, filed again and again. Click one to see
          the measures.
        </p>

        <div className="patterns-layout">
          <div className="patterns-left">
            {/* HO 347 — ranked bars replace the bubble + absorb the ALL
                PATTERNS table; the detail strip drops in below, always (a
                pattern is always selected). */}
            <PatternBars stats={stats} selected={selected} />
            <PatternLegend />
            {selected ? (
              <PatternDrilldownPanel clusterId={selected} />
            ) : null}
          </div>

          <aside className="patterns-right">
            <div
              className="pattern-right-header text-[11px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-muted)" }}
            >
              Recent bills{selected ? ` · ${selected}` : ""}
            </div>
            {selectedDrilldown && selectedDrilldown.recentBills.length > 0 ? (
              <ul className="pattern-recent-bills">
                {selectedDrilldown.recentBills.map((b) => (
                  <BillRow
                    key={b.id}
                    bill={b}
                    nowMs={nowMs}
                    compact
                    onWatchlist={watchedSet.has(b.id)}
                  />
                ))}
              </ul>
            ) : (
              <div
                className="px-3 py-6 text-[12px]"
                style={{ color: "var(--text-dim)" }}
              >
                No bills match this pattern yet.
              </div>
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}
