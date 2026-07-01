import { PacSpendingLine } from "@/components/PacSpendingLine";
import { RaceCandidates } from "@/components/RaceCandidates";
import { RaceHeader } from "@/components/RaceHeader";
import { RaceIncumbentCard } from "@/components/RaceIncumbentCard";
import { RaceRunoffs } from "@/components/RaceRunoffs";
import { formatDateLong } from "@/lib/format";
import type {
  Member,
  PacIeRow,
  PrimaryWithCandidates,
  Race,
  RaceCandidate,
  RaceRating,
} from "@/lib/queries";

// HO 166 — shared race-hub body, rendered both on `/race/[id]` (server,
// server-fetched data) and inside the dashboard competitive-races drawer
// (client, fetched via /api/race/[id]/hub). Pure presentational: no async,
// no DB — every sub-component (RaceHeader / RaceIncumbentCard / RaceRunoffs /
// RaceCandidates) renders from props, so this works in either tree. The page
// chrome (HeaderBar / Back link / <main>) stays in the route; only the body
// content lives here so the two surfaces never drift.

type RatingMeta = { label: string; color: string };

function ratingMeta(rating: string | null): RatingMeta | null {
  if (!rating) return null;
  switch (rating) {
    case "safe_r":
      return { label: "Safe R", color: "var(--party-republican)" };
    case "likely_r":
      return { label: "Likely R", color: "var(--party-republican)" };
    case "lean_r":
      return { label: "Lean R", color: "var(--party-republican)" };
    case "tossup":
      return { label: "Tossup", color: "var(--accent-amber)" };
    case "lean_d":
      return { label: "Lean D", color: "var(--party-democrat)" };
    case "likely_d":
      return { label: "Likely D", color: "var(--party-democrat)" };
    case "safe_d":
      return { label: "Safe D", color: "var(--party-democrat)" };
    default:
      return null;
  }
}

export function RaceHubBody({
  race,
  candidates,
  incumbent,
  ratings,
  runoffs,
  pac,
  preview = false,
}: {
  race: Race;
  candidates: RaceCandidate[];
  incumbent: Member | null;
  ratings: RaceRating[];
  runoffs: PrimaryWithCandidates[];
  // HO 393: UDP IE direction rows for this seat (the PAC SPENDING line). Full
  // hub only — gated `!preview`, so the dashboard popover doesn't need it. This
  // is the surface that actually renders IL-07/KY-04 (competitive PRIMARIES with
  // UDP spend but no forecaster GENERAL rating → absent from the competitive
  // map/list, which is rated-only via getRacesIndex).
  pac?: PacIeRow[];
  // HO 170: drawer-only trim. When true, drops the incumbent photo card and
  // the source/last-verified footer (those stay on /race/[id], which renders
  // with no `preview` prop). Keeps RaceHeader (name + countdown + multi-source
  // chips), the rating block, runoffs, and the candidate roster/stub.
  preview?: boolean;
}) {
  const rating = ratingMeta(race.rating);
  // A race that went to runoff is never a "stub" — runoffs.length guards the
  // "Incumbent running for re-election" placeholder, which would contradict
  // the runoff section (HO 107). HO 171: also key off the multi-source
  // `ratings` array, not just the legacy `races.rating` column — a race whose
  // rating chips render (race_ratings) must never claim "no competitive rating
  // yet."
  const isStub =
    !race.rating &&
    ratings.length === 0 &&
    candidates.length === 0 &&
    runoffs.length === 0;

  return (
    <>
      <RaceHeader race={race} ratings={ratings} />

      {rating ? (
        <div
          className="my-5 grid grid-cols-[120px_1fr] gap-y-2 border-t border-b py-4 text-[12px] uppercase tracking-[0.5px]"
          style={{ borderColor: "var(--border-soft)" }}
        >
          <span style={{ color: "var(--text-dim)" }}>Rating</span>
          <span>
            <span
              className="inline-block border px-2 py-[1px] text-[12px]"
              style={{ color: rating.color, borderColor: rating.color }}
            >
              {rating.label}
            </span>
          </span>
          <span style={{ color: "var(--text-dim)" }}>Source</span>
          <span style={{ color: "var(--text-secondary)" }}>
            {race.rating_source ?? "—"}
            {race.rating_updated_at ? (
              <span style={{ color: "var(--text-dim)" }}>
                {" · updated "}
                {formatDateLong(race.rating_updated_at)}
              </span>
            ) : null}
          </span>
        </div>
      ) : null}

      {!preview && pac && pac.length > 0 ? (
        <div className="mt-5">
          <PacSpendingLine rows={pac} />
        </div>
      ) : null}

      {!preview ? (
        <section
          className="mt-6 border"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <div
            className="px-4 py-3"
            style={{
              backgroundColor: "var(--bg-panel)",
              borderBottom: "0.5px solid var(--border-strong)",
            }}
          >
            <h2
              className="text-[12px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-secondary)" }}
            >
              Incumbent
            </h2>
          </div>
          <div className="px-4">
            <RaceIncumbentCard member={incumbent} race={race} />
          </div>
        </section>
      ) : null}

      <RaceRunoffs runoffs={runoffs} />

      {isStub ? (
        <p
          className="mt-6 text-[12px] uppercase tracking-[0.5px]"
          style={{ color: "var(--text-muted)" }}
        >
          {incumbent
            ? "Incumbent running for re-election. No competitive rating yet."
            : "Open seat. Candidate filings forthcoming."}
        </p>
      ) : (
        <section
          className="mt-6 border"
          style={{ borderColor: "var(--border-strong)" }}
        >
          <div
            className="flex items-baseline justify-between px-4 py-3"
            style={{
              backgroundColor: "var(--bg-panel)",
              borderBottom: "0.5px solid var(--border-strong)",
            }}
          >
            <h2
              className="text-[12px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-secondary)" }}
            >
              Candidates ({candidates.length})
            </h2>
          </div>
          <div className="px-4 pb-2">
            <RaceCandidates candidates={candidates} />
          </div>
        </section>
      )}

      {!preview ? (
        race.source_url ? (
          <div className="mt-6 text-[12px]" style={{ color: "var(--text-dim)" }}>
            <span className="uppercase tracking-[0.5px]">Source: </span>
            <a
              href={race.source_url}
              target="_blank"
              rel="noreferrer"
              className="transition hover:text-[var(--accent-amber-bright)]"
              style={{ color: "var(--accent-amber)" }}
            >
              {race.source_url}
            </a>
            <span> · last verified {formatDateLong(race.last_verified)}</span>
          </div>
        ) : (
          <div className="mt-6 text-[12px]" style={{ color: "var(--text-dim)" }}>
            Last verified {formatDateLong(race.last_verified)}
          </div>
        )
      ) : null}
    </>
  );
}
