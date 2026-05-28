import Link from "next/link";

// HO 151 — reusable bordered segmented toggle, extracted from the
// ChamberToggle idiom (which has carried it since HO 90). Mono uppercase
// chips, active = --accent-amber-bright on --bg-row-hover, inactive =
// --text-muted on --bg-base, 0.5px border-left between chips. Used by
// the BILLS|NEWS feed-mode toggle here; HO 152 plugs the same component
// into the members VOLUME|PASS RATE toggle. ChamberToggle and
// SponsorSortToggle still hand-roll their own — HO 154 cleanup migrates
// them so existing call sites stay untouched in this pass.

export type Segment<V extends string> = {
  value: V;
  label: string;
};

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
