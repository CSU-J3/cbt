import Link from "next/link";
import { TopStallsList } from "@/components/TopStallsList";
import { V2FeedList } from "@/components/V2FeedList";
import { getStaleBills } from "@/lib/queries";

// HO 126 — home-page quadrant answering "what's stuck?" Pairs with
// BREAKING (above) and ACTIVITY (next quadrant) to give a complete WTF
// snapshot. Drives off the same getStaleBills helper /stale uses, with
// limit=5; the rendered leader row should match /stale's top entry.
//
// Format is deliberately *not* the HO 125 compact BillRow — at a 2x2
// quadrant width (~720px at 1440px viewport, narrower at smaller
// breakpoints), the title + stage strip + sponsor strip stack of compact
// BillRow stops being scannable. This is a 3-column one-line row:
//
//   [HR-9011 chip]  truncated bill title…       505d
//
// The chip inherits HO 125's chamber tint (--rail-house cyan /
// --rail-senate purple) so chamber identity carries through the home page
// without introducing a new color vocabulary.
//
// HO 164: the row layout is unchanged, but rows now click-to-expand into the
// full BillExpandedPanel (the list + accordion state live in the TopStallsList
// client island). This stays a server component for the data fetch.

const ROW_LIMIT = 5;

export async function TopStalls({ variant }: { variant?: "v2" }) {
  const bills = await getStaleBills({}, ROW_LIMIT);

  if (bills.length === 0) {
    return (
      <div
        className="flex flex-1 items-center justify-center px-6 py-12 text-center text-[13px]"
        style={{ color: "var(--text-dim)" }}
      >
        Nothing stuck — every tracked bill has moved recently.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      {variant === "v2" ? (
        <V2FeedList bills={bills} metricMode="stalls" />
      ) : (
        <TopStallsList bills={bills} />
      )}
      <Link href="/stale" className="home-expander">
        [ View all stale → ]
      </Link>
    </div>
  );
}
