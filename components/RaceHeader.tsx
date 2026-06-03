import { RatingChip } from "./RatingChip";
import { daysToElection, ordinal } from "@/lib/format";
import { stateName } from "@/lib/states";
import type { Race, RaceRating } from "@/lib/queries";

function raceName(r: Race): string {
  const state = stateName(r.state);
  if (r.chamber === "senate") return `${state} Senate Seat`;
  if (r.district === null) return `${state} House Seat`;
  if (r.district === 0) return `${state} At-Large Congressional District`;
  return `${state} ${ordinal(r.district)} Congressional District`;
}

// HO 185 — compact label for the breadcrumb masthead's race detail segment:
// the 2-letter state abbreviation + a short office (e.g. "GA Senate", "GA 8th",
// "GA At-Large"). Distinct from raceName above, which uses the full state name
// + long office for the race page's own H1.
export function raceLabelCompact(r: Race): string {
  if (r.chamber === "senate") return `${r.state} Senate`;
  if (r.district === null) return `${r.state} House`;
  if (r.district === 0) return `${r.state} At-Large`;
  return `${r.state} ${ordinal(r.district)}`;
}

export function RaceHeader({
  race,
  ratings = [],
}: {
  race: Race;
  ratings?: RaceRating[];
}) {
  const days = daysToElection(race.cycle);
  const countdown =
    days < 0
      ? "Election concluded"
      : days === 0
        ? "Election today"
        : `${days.toLocaleString()} day${days === 1 ? "" : "s"} to election`;

  return (
    <div className="race-header">
      <h1
        className="text-[16px] uppercase tracking-[0.5px]"
        style={{ color: "var(--text-primary)" }}
      >
        {raceName(race)}
      </h1>
      <div
        className="mt-1 text-[13px] uppercase tracking-[0.5px]"
        style={{ color: "var(--text-muted)" }}
      >
        {race.cycle} General Election <span aria-hidden> · </span>
        <span
          style={{
            color: days < 0 ? "var(--text-dim)" : "var(--accent-amber)",
          }}
        >
          {countdown}
        </span>
      </div>
      {ratings.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {ratings.map((r, i) => (
            <span key={r.id} className="inline-flex items-center gap-2">
              {i > 0 ? (
                <span aria-hidden style={{ color: "var(--text-dim)" }}>
                  ·
                </span>
              ) : null}
              <RatingChip rating={r} />
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
