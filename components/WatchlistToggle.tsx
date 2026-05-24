"use client";

import { useWatchToggle } from "@/components/use-watch-toggle";

// Full-size watch button used on /bill/[id]. HO 127 refactored this to
// share state semantics with WatchStar via the useWatchToggle hook: same
// optimistic flip, same error revert. The rendered chrome (border, label,
// inverted-fill-when-on) stays as the detail page expects.
export function WatchlistToggle({
  billId,
  initial,
}: {
  billId: string;
  initial: boolean;
}) {
  const { isOn, isPending, error, toggle } = useWatchToggle(billId, initial);

  const baseClass =
    "inline-flex items-center gap-1 border px-2.5 py-1 text-[12px] font-medium uppercase tracking-[0.5px] transition disabled:opacity-50";
  const style = isOn
    ? {
        backgroundColor: "var(--accent-amber)",
        color: "#0a0e14",
        borderColor: "var(--accent-amber)",
      }
    : {
        backgroundColor: "transparent",
        color: "var(--accent-amber)",
        borderColor: "var(--accent-amber)",
      };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={() => void toggle()}
        disabled={isPending}
        className={baseClass}
        style={style}
      >
        <span aria-hidden>★</span>
        <span>{isOn ? "WATCHING" : "WATCH"}</span>
      </button>
      {error ? (
        <span
          className="text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--party-republican)" }}
        >
          {error}
        </span>
      ) : null}
    </span>
  );
}
