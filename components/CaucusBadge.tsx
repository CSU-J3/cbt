import { CAUCUS_CONFIG, type CaucusOrg } from "@/lib/caucus-config";

// Pill with party-colored border + colored text on transparent background.
// The border + text combo distinguishes caucus badges from topic tags (text
// only, no border) so the two don't blur visually when rendered side by side.
export function CaucusBadge({ org }: { org: CaucusOrg }) {
  const info = CAUCUS_CONFIG[org];
  return (
    <span
      className="inline-block px-2 py-[1px] text-[12px] uppercase tracking-[0.5px] tabular-nums"
      style={{
        color: info.color,
        border: `1px solid ${info.color}`,
        borderRadius: "2px",
      }}
      title={info.fullName}
    >
      {info.display}
    </span>
  );
}
