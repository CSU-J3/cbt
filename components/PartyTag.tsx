import { partyColor } from "@/lib/race-colors";

// The canonical [P-ST] party bracket (HO 468). Color comes from the one shared
// partyColor; `className` lets a call-site pass its own layout/spacing classes
// (e.g. the feed's .v2f-subline-bracket, the members list's .mc-brk).
export function PartyTag({
  party,
  state,
  className,
}: {
  party: string | null;
  state: string | null;
  className?: string;
}) {
  if (!party && !state) return null;
  return (
    <span className={className} style={{ color: partyColor(party) }}>
      [{party ?? "?"}-{state ?? "?"}]
    </span>
  );
}
