import { Fragment } from "react";
import { sourceLabel } from "@/components/RatingChip";
import { RACE_RATING_PAGES_2026, RACE_RATING_SOURCES } from "@/lib/enums";
import type { RaterFreshness, RatingSource } from "@/lib/queries";

// HO 784 (docs/design/mock-784-sources-line-v3.html, ruled "this works send it"):
// the ratings sources line. It names the raters in a fixed order, links each name
// as the chip does (RatingChip: the rater's own 2026 page for the chamber,
// `rater-link`, --text-muted, a new tab, the full name as its title; a plain span
// where the chamber has no page), and says in --rating-freshness how old each
// rater's ratings are and where they were read: "· as of <date> · via
// Ballotpedia" or "· direct" (getRaterFreshness, lib/queries.ts). A rater with no
// rows keeps its name and link and drops the clause.
//
// Presentational, with no hooks and no server-only import, because RaceListView,
// a client component, renders it. On /electoral it sits under the list box
// (RaceListView), on /race/[id] under the chip strip (RaceHeader); /welcome's foot
// names the same raters in its own register.

// The line's order, whatever order the raters arrive in.
export const RATER_ORDER: readonly RatingSource[] = ["cook", "inside_elections", "sabato"];

export function RatingSourcesLine({
  freshness,
  chamber,
  sources,
  className,
}: {
  freshness: RaterFreshness;
  chamber: "house" | "senate";
  // The raters to name, all three by default.
  sources?: readonly RatingSource[];
  className?: string;
}) {
  const shown = sources ? RATER_ORDER.filter((s) => sources.includes(s)) : RATER_ORDER;
  return (
    <p
      data-rating-sources
      className={`text-[length:var(--fs-12)] uppercase tracking-[0.5px]${className ? ` ${className}` : ""}`}
    >
      <span style={{ color: "var(--text-dim)" }}>Ratings</span>
      {shown.map((s) => {
        const page = RACE_RATING_PAGES_2026[s]?.[chamber];
        const f = freshness[s];
        return (
          <Fragment key={s}>
            {/* The spaces sit outside the hidden dot, so a screen reader and a copy
                still part the words. */}{" "}
            <span aria-hidden style={{ color: "var(--text-dim)" }}>
              ·
            </span>{" "}
            <span data-rater={s}>
              {page ? (
                <a
                  className="rater-link"
                  style={{ color: "var(--text-muted)" }}
                  title={RACE_RATING_SOURCES[s]}
                  href={page}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {sourceLabel(s)}
                </a>
              ) : (
                <span style={{ color: "var(--text-muted)" }} title={RACE_RATING_SOURCES[s]}>
                  {sourceLabel(s)}
                </span>
              )}
              {f && (f.asOf || f.via) ? (
                <span data-rater-freshness style={{ color: "var(--rating-freshness)" }}>
                  {f.asOf ? (
                    <>
                      {" · as of "}
                      <span className="whitespace-nowrap">{f.asOf}</span>
                    </>
                  ) : null}
                  {f.via === "ballotpedia" ? " · via Ballotpedia" : f.via === "direct" ? " · direct" : null}
                </span>
              ) : null}
            </span>
          </Fragment>
        );
      })}
    </p>
  );
}
