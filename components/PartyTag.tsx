function partyColor(party: string | null): string {
  switch (party) {
    case "R":
      return "var(--party-republican)";
    case "D":
      return "var(--party-democrat)";
    case "I":
    case "ID":
      return "var(--party-independent)";
    default:
      return "var(--text-dim)";
  }
}

export function PartyTag({
  party,
  state,
}: {
  party: string | null;
  state: string | null;
}) {
  if (!party && !state) return null;
  const text = `[${party ?? "?"}-${state ?? "?"}]`;
  return (
    <span style={{ color: partyColor(party) }}>{text}</span>
  );
}
