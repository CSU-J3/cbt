import Link from "next/link";
import { V2FeedList } from "@/components/V2FeedList";
import { type Chamber, getStaleBills } from "@/lib/queries";

// HO 126 — home-page quadrant answering "what's stuck?" Pairs with
// BREAKING (above) and ACTIVITY (next quadrant) to give a complete WTF
// snapshot. Drives off the same getStaleBills helper /stale uses, with
// limit=5; the rendered leader row should match /stale's top entry.
//
// RECORD (HO 126, renderer deleted at HO 664 — kept because the reasoning is
// why this tab exists, not a claim about what it renders today): the row was
// deliberately *not* the HO 125 compact BillRow. At a 2x2 quadrant width the
// compact row's stacked title + stage strip + sponsor strip stopped being
// scannable, so TopStallsList rendered a 3-column one-line row
// `[HR-9011 chip] truncated title… 505d`, the chip carrying HO 125's chamber
// tint (--rail-house / --rail-senate). That island and its `.top-stalls-row` /
// `.bill-chip` CSS went with the dead non-v2 arm; the tab now renders
// V2FeedList like the other two, and the tint survives only in BillIdRail.
//
// HO 164 gave the rows a click-to-expand accordion in the client island named
// in the RECORD above; HO 664 deleted it with the dead non-v2 arm that was its
// only caller. This stays a server component for the data fetch, and the rows
// are V2FeedList's.

// HO 627: this one is a CEILING, not a target. The stale set under the default
// /stale scope (past-committee, 60+ days, procedural filtered) is SMALL — 5 rows
// at the time of writing — so raising the limit renders everything there is and
// the tab simply stays short until the corpus produces more. That is the honest
// behaviour, and it is why this tab carries no [+N MORE] arithmetic. No variant
// split — see the ActivityTicker note.
const ROW_LIMIT = 60;

export async function TopStalls({
  chamber,
  nowMs,
}: {
  // HO 642: the dashboard feed panel's chamber selector. buildStaleWhere composes
  // on buildFeedWhere, which already emits the bill_type predicate — so this needs
  // no query work, only a populated first argument.
  chamber?: Chamber;
  // HO 490: page-computed clock threaded to the feed's client rows.
  nowMs: number;
}) {
  const bills = await getStaleBills({ chamber }, ROW_LIMIT);

  if (bills.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[length:var(--fs-13)]"
        style={{ color: "var(--text-dim)" }}
      >
        Nothing stuck — every tracked bill has moved recently.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0">
      <V2FeedList bills={bills} metricMode="stalls" nowMs={nowMs} />
      <Link href="/stale" className="home-expander v2f-foot">
        [ View all stale → ]
      </Link>
    </div>
  );
}
