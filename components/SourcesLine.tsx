import { Fragment } from "react";

// HO 786: the sources line. A surface that renders an upstream's data names it
// where the data sits, one group per kind of data: "<label> via <name>", the
// label and "via" in --text-dim, the name in --text-muted, groups parted by the
// hidden dot RatingSourcesLine uses (HO 784). A name with an href links out as
// `source-link`, one rule with `rater-link` in app/globals.css so it looks as
// ruled at HO 784, in a new tab; without one it's a plain span. The raters keep
// their own line (RatingSourcesLine), and the out-link URLs live once, in
// lib/source-links.ts.
//
// Presentational, with no hooks and no server-only import, because
// ElectoralBoard, a client component, renders it.

export type SourcesGroup = {
  label: string;
  sources: { name: string; href?: string }[];
};

export function SourcesLine({
  groups,
  className,
}: {
  groups: readonly SourcesGroup[];
  className?: string;
}) {
  return (
    <p
      data-sources
      className={`text-[length:var(--fs-12)] uppercase tracking-[0.5px]${className ? ` ${className}` : ""}`}
    >
      {groups.map((g, i) => (
        <Fragment key={g.label}>
          {/* The spaces sit outside the hidden dot, so a screen reader and a copy
              still part the groups. */}
          {i > 0 ? (
            <>
              {" "}
              <span aria-hidden style={{ color: "var(--text-dim)" }}>
                ·
              </span>{" "}
            </>
          ) : null}
          <span style={{ color: "var(--text-dim)" }}>{g.label} via </span>
          {g.sources.map((s, j) => (
            <Fragment key={s.name}>
              {j > 0 ? (
                <span style={{ color: "var(--text-dim)" }}>
                  {j === g.sources.length - 1 ? " and " : ", "}
                </span>
              ) : null}
              {s.href ? (
                <a
                  className="source-link"
                  style={{ color: "var(--text-muted)" }}
                  href={s.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {s.name}
                </a>
              ) : (
                <span style={{ color: "var(--text-muted)" }}>{s.name}</span>
              )}
            </Fragment>
          ))}
        </Fragment>
      ))}
    </p>
  );
}
