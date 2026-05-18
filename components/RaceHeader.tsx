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
