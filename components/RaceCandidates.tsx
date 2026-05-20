import Link from "next/link";
import type { PartyKey, RaceCandidate } from "@/lib/queries";

function partyColor(party: PartyKey | null): string {
  if (party === "R") return "var(--party-republican)";
  if (party === "D") return "var(--party-democrat)";
  if (party === "I") return "var(--party-independent)";
  return "var(--text-dim)";
}

function statusLabel(status: string | null): string {
  switch (status) {
    case "won_primary":
      return "Won primary";
    case "running":
      return "Running";
    case "declared":
      return "Declared";
    case "withdrew":
      return "Withdrew";
    default:
      return status ?? "—";
  }
}

export function RaceCandidates({
  candidates,
}: {
  candidates: RaceCandidate[];
}) {
  if (candidates.length === 0) {
    return (
      <p
        className="py-3 text-[13px]"
        style={{ color: "var(--text-muted)" }}
      >
        Candidate filings forthcoming.
      </p>
    );
  }

  return (
    <ul className="flex flex-col">
      {candidates.map((c) => {
        const color = partyColor(c.party);
        const dimmed = c.status === "withdrew";
        return (
          <li
            key={c.name}
            className="flex items-center gap-3 py-2 text-[14px]"
            style={{
              color: dimmed ? "var(--text-dim)" : "var(--text-primary)",
              borderTop: "0.5px solid var(--border-soft)",
              opacity: dimmed ? 0.7 : 1,
            }}
          >
            <span aria-hidden style={{ color }}>
              ●
            </span>
            <span
              className="w-6 text-[12px] uppercase tracking-[0.5px] tabular-nums"
              style={{ color }}
            >
              {c.party ?? "—"}
            </span>
            <span className="flex-1">
              {c.bioguide_id ? (
                <Link
                  href={`/members/${c.bioguide_id}`}
                  className="transition hover:text-[var(--accent-amber)]"
                >
                  {c.name}
                </Link>
              ) : (
                c.name
              )}
            </span>
            <span
              className="text-[12px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-muted)" }}
            >
              {statusLabel(c.status)}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
