// Runoff section for the race page (handoff 107). Additive block — renders
// nothing when the race had no runoff. Reuses the bordered-panel chrome of the
// Incumbent / Candidates sections and the candidate-row layout of
// RaceCandidates; no new design tokens or row layouts.
//
// Louisiana's closed-primary system runs a separate runoff per party, so
// `runoffs` can hold two PrimaryWithCandidates rows (D and R) for one race.
import Link from "next/link";
import { daysUntil, formatDateLong } from "@/lib/format";
import type { PrimaryWithCandidates } from "@/lib/queries";

function partyColor(party: string): string {
  if (party === "R") return "var(--party-republican)";
  if (party === "D") return "var(--party-democrat)";
  if (party === "I") return "var(--party-independent)";
  return "var(--text-dim)";
}

function partyLabel(party: string): string {
  if (party === "R") return "Republican";
  if (party === "D") return "Democratic";
  if (party === "I") return "Independent";
  return party;
}

function relativeLabel(date: string): string {
  const d = daysUntil(date);
  if (d === 0) return "today";
  if (d > 0) return `in ${d} ${d === 1 ? "day" : "days"}`;
  const ago = -d;
  return `${ago} ${ago === 1 ? "day" : "days"} ago`;
}

// A runoff candidate is 'running' (pending) until results land post-election,
// then 'winner' / 'loser'. vote_pct fills the reserved slot once counted.
function resultLabel(status: string, votePct: number | null): string {
  const pct = votePct != null ? `${votePct.toFixed(1)}%` : null;
  if (status === "winner") return pct ? `${pct} · won` : "Won";
  if (status === "loser") return pct ? `${pct} · lost` : "Lost";
  return pct ?? "Pending"; // 'running'
}

export function RaceRunoffs({
  runoffs,
}: {
  runoffs: PrimaryWithCandidates[];
}) {
  if (runoffs.length === 0) return null;

  // Every runoff row for a race shares one election date.
  const runoffDate = runoffs[0]?.primary_date ?? null;

  return (
    <section
      className="mt-6 border"
      style={{ borderColor: "var(--border-strong)" }}
    >
      <div
        className="flex items-baseline justify-between gap-3 px-4 py-3"
        style={{
          backgroundColor: "var(--bg-panel)",
          borderBottom: "0.5px solid var(--border-strong)",
        }}
      >
        <h2 className="text-[12px] uppercase tracking-[0.5px]">
          <span
            className="inline-block border px-2 py-[1px]"
            style={{
              color: "var(--accent-amber-bright)",
              borderColor: "var(--accent-amber)",
            }}
          >
            Runoff
          </span>
        </h2>
        {runoffDate ? (
          <span
            className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
            style={{ color: "var(--accent-amber-bright)" }}
          >
            {formatDateLong(runoffDate)} · {relativeLabel(runoffDate)}
          </span>
        ) : null}
      </div>

      <div className="px-4 pb-2">
        {runoffs.map((r) => (
          <div
            key={r.id}
            className="border-t pt-1 first:border-t-0"
            style={{ borderColor: "var(--border-soft)" }}
          >
            <p
              className="pt-3 pb-1 text-[12px] uppercase tracking-[0.5px]"
              style={{ color: partyColor(r.party) }}
            >
              {partyLabel(r.party)} runoff
            </p>
            <ul className="flex flex-col">
              {r.candidates.map((c) => {
                const color = partyColor(c.party);
                const pending = c.status === "running";
                return (
                  <li
                    key={c.name}
                    className="flex items-center gap-3 py-2 text-[14px]"
                    style={{
                      color: "var(--text-primary)",
                      borderTop: "0.5px solid var(--border-soft)",
                    }}
                  >
                    <span aria-hidden style={{ color }}>
                      ●
                    </span>
                    <span
                      className="w-6 text-[12px] uppercase tracking-[0.5px] tabular-nums"
                      style={{ color }}
                    >
                      {c.party}
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
                      className="text-[12px] uppercase tracking-[0.5px] tabular-nums"
                      style={{
                        color: pending
                          ? "var(--text-dim)"
                          : "var(--text-muted)",
                      }}
                    >
                      {resultLabel(c.status, c.vote_pct)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
