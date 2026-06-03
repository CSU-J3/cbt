import Link from "next/link";

// HO 151 — reusable bordered segmented toggle, extracted from the
// ChamberToggle idiom (which has carried it since HO 90). Mono uppercase
// chips, active = --accent-amber-bright on --bg-row-hover, inactive =
// --text-muted on --bg-base, 0.5px border-left between chips. Used by
// the BILLS|NEWS feed-mode toggle and (after HO 154.3) every chamber +
// metric toggle in the app. Per the HO 154 cleanup decision, the
// previously bespoke ChamberToggle was deleted and its 4 callers
// (/bills, /changes, /stale, /watchlist) now mount SegmentedToggle
// directly with CHAMBER_SEGMENTS below.

export type Segment<V extends string> = {
  value: V;
  label: string;
};

// HO 154.3 — shared three-segment ALL | HOUSE | SENATE constant so the
// chamber toggle's labels stay in one place across pages. Each caller
// owns its own buildHref (carry + basePath + page-reset semantics vary
// per surface) so this is the labels-only handoff between the canonical
// SegmentedToggle and the four feed-shaped pages.
export const CHAMBER_SEGMENTS: readonly Segment<"" | "house" | "senate">[] = [
  { value: "", label: "ALL" },
  { value: "house", label: "HOUSE" },
  { value: "senate", label: "SENATE" },
];

export function SegmentedToggle<V extends string>({
  current,
  segments,
  buildHref,
  ariaLabel,
}: {
  current: V;
  segments: readonly Segment<V>[];
  /** Given a segment value, return the href that selects it. The toggle
   *  doesn't try to know about URL state; the parent owns it. */
  buildHref: (value: V) => string;
  ariaLabel: string;
}) {
  return (
    <div
      className="inline-flex items-center overflow-hidden rounded-sm border"
      style={{ borderColor: "var(--border-strong)" }}
      role="group"
      aria-label={ariaLabel}
    >
      {segments.map((seg, i) => {
        const isActive = seg.value === current;
        return (
          <Link
            key={seg.value}
            href={buildHref(seg.value)}
            scroll={false}
            className="px-3 py-1 text-[12px] font-medium uppercase tracking-[0.5px] transition"
            style={{
              backgroundColor: isActive
                ? "var(--bg-row-hover)"
                : "var(--bg-base)",
              color: isActive
                ? "var(--accent-amber-bright)"
                : "var(--text-muted)",
              borderLeft:
                i === 0 ? undefined : "0.5px solid var(--border-strong)",
            }}
            aria-current={isActive ? "true" : undefined}
          >
            {seg.label}
          </Link>
        );
      })}
    </div>
  );
}
