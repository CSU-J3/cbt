"use client";

import { useWatchToggle } from "@/components/use-watch-toggle";

// HO 127 — row-level watch toggle. Tiny star button suitable for placing
// in a BillRow's right edge (full variant) or in the compact ticker
// (size="sm"). Glyph swap (☆ → ★) carries the meaning on touch where the
// HO 123 native-tooltip handoff doesn't fire; the title attribute carries
// the same meaning for desktop hovers.
//
// Click goes through the shared useWatchToggle hook: optimistic flip,
// fetch /api/watchlist, revert + show ERR if the server rejects.
// router.refresh() after a successful toggle flushes server-side caches
// tagged "watchlist" so cached queries (getWatchlistBills + the new HO 127
// getWatchedBillIds) re-read on the next render.
export function WatchStar({
  billId,
  initial,
  size = "md",
}: {
  billId: string;
  initial: boolean;
  size?: "sm" | "md";
}) {
  const { isOn, isPending, error, toggle } = useWatchToggle(billId, initial);

  const onColor = "var(--accent-amber-bright)";
  const offColor = "var(--text-dim)";
  const fontSize = size === "sm" ? "14px" : "16px";

  return (
    <button
      type="button"
      onClick={(e) => {
        // The whole BillRow is itself a Link; without stopping propagation
        // a star click would navigate to /bill/[id] in addition to toggling.
        e.preventDefault();
        e.stopPropagation();
        void toggle();
      }}
      disabled={isPending}
      aria-label={isOn ? "Watching" : "Watch this bill"}
      title={error ?? (isOn ? "Watching" : "Watch this bill")}
      className="inline-flex items-center justify-center transition disabled:opacity-50"
      style={{
        color: error ? "var(--party-republican)" : isOn ? onColor : offColor,
        fontSize,
        // Hit area stays comfortable even at sm — 24px square minimum.
        width: size === "sm" ? "20px" : "24px",
        height: size === "sm" ? "20px" : "24px",
        background: "transparent",
        border: "none",
        cursor: isPending ? "wait" : "pointer",
        lineHeight: 1,
      }}
    >
      <span aria-hidden>{isOn ? "★" : "☆"}</span>
    </button>
  );
}
