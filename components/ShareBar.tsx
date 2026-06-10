// HO 226: the HO 207 primaries results share-bar, EXTRACTED from PrimaryRow.tsx
// into a shared component so three surfaces render it from one source — the
// PRIMARIES single list (PrimaryRow), the map pinned card (PrimaryMapCard), and
// the HO 226 district-modal card (PrimaryDistrictCard). Moved VERBATIM (segment
// logic, advancer ★, two-★ runoffs, top-3 + "+N others" --border-strong rollup,
// party tint, voted/not-yet fallback) so the shipped single-list render is
// byte-identical post-extraction. The HO 222 anti-drift move, applied to the two
// (now three) primaries share-bar surfaces.
//
// Pure presentational — no hooks, no context, no module state (depends only on
// its {cands, tint} props), so it renders identically wherever it's mounted.
import type { PrimaryCandidate } from "@/lib/queries";

export const FIELD_CAP = 3;

// HO 207: advancer = the winner-class row from the results parse (status set to
// 'winner' by the sync / backfill). Runoffs advance two.
export function isAdvancer(c: PrimaryCandidate): boolean {
  return c.status === "winner";
}

export function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
}

// Voted ordering: by result share, leader first.
export function orderedByShare(cands: PrimaryCandidate[]): PrimaryCandidate[] {
  return [...cands].sort((a, b) => (b.vote_pct ?? 0) - (a.vote_pct ?? 0));
}

// Brightness rank toward the bar's dark base (cleaner than raw opacity, which
// shows the background through and washes the saturated party reds/blues —
// the HO 207 build-time legibility call). Leader = full tint; trailing darker.
function segColor(tint: string, rank: number): string {
  if (rank === 0) return tint;
  if (rank === 1) return `color-mix(in srgb, ${tint} 62%, var(--bg-base))`;
  return `color-mix(in srgb, ${tint} 40%, var(--bg-base))`;
}

export function ShareBar({
  cands,
  tint,
}: {
  cands: PrimaryCandidate[];
  tint: string;
}) {
  const ranked = orderedByShare(cands.filter((c) => c.vote_pct != null));
  const top = ranked.slice(0, FIELD_CAP);
  const rest = ranked.slice(FIELD_CAP);
  const restShare = rest.reduce((s, c) => s + (c.vote_pct ?? 0), 0);

  return (
    <span
      className="flex h-[18px] w-full overflow-hidden rounded-[2px]"
      style={{ backgroundColor: "var(--bg-base)" }}
    >
      {top.map((c, i) => {
        const pct = c.vote_pct ?? 0;
        return (
          <span
            key={c.id}
            // shrink-0 + minWidth:0 pin the rendered width to vote_pct exactly —
            // without them a flex item won't shrink below its label's min-content,
            // so narrow segments bleed wide and distort the bar. The 1px --bg-base
            // hairline separates adjacent segments so same-hue neighbours (the
            // whole bar is one tint, brightness-stepped) read as distinct rather
            // than one mass (box-sizing:border-box keeps the border inside the %).
            className="flex h-full shrink-0 items-center overflow-hidden px-1.5 text-[10px] whitespace-nowrap"
            style={{
              width: `${pct}%`,
              minWidth: 0,
              backgroundColor: segColor(tint, i),
              color: "var(--text-primary)",
              borderRight: "1px solid var(--bg-base)",
            }}
            title={`${c.name} — ${pct.toFixed(1)}%${isAdvancer(c) ? " · advanced" : ""}`}
          >
            {isAdvancer(c) ? "★ " : ""}
            {lastName(c.name)} {Math.round(pct)}%
          </span>
        );
      })}
      {restShare > 0.5 ? (
        <span
          className="flex h-full shrink-0 items-center overflow-hidden px-1 text-[10px] whitespace-nowrap"
          style={{
            width: `${restShare}%`,
            minWidth: 0,
            backgroundColor: "var(--border-strong)",
            color: "var(--text-dim)",
          }}
          title={`${rest.length} more candidate${rest.length === 1 ? "" : "s"}`}
        >
          +{rest.length}
        </span>
      ) : null}
    </span>
  );
}
