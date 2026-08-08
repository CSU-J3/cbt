"use client";

// HO 630 — the Absence Watch band's interactive shell. Owner ruling, the same
// product logic as HO 627's: THE DRILL MOVES ONE LEVEL IN, NOT AWAY. A plain
// click expands the member's card under the row; the member page stays reachable
// by modifier-click on the name and from the card's own buttons.
//
// WHY THIS ISLAND HOLDS NO CLOCK.
// The HO 574/589 constraint is that this band derives no time on the client, and
// HO 490's is that a relative age is computed once per page and prop-drilled. The
// band's one time derivation — formatSince, which appends a year only when it
// differs from the current one — therefore stays in the SERVER component and
// arrives here as a finished string (`sinceLabel`).
//
// THE GATE, and it is stated so it stays greppable: this file must contain no
// timestamp constructor and no current-time read. The check is a search for those
// two identifiers over this file, and it is expected to return zero lines —
// including this comment, which is why neither is spelled out here.
//
// WHY THE CARD ARRIVES AS A ReactNode.
// SponsorExpandedPanel is a SERVER component (no "use client"), and it is reused
// VERBATIM here — no absence-specific variant, per the handoff. A client island
// cannot import and render a server component, so the server band renders each
// panel and passes it down as a prop; this island only decides whether to mount
// it. That is the ActivityTabs idiom (server-rendered content into a client tab
// shell), and it is what keeps `lib/queries` — and with it `next/cache` — out of
// the client bundle.
//
// Single-open is the feed's contract (useSingleOpenPanel's shape, hand-rolled
// here because there is no lazy fetch to cache: the props are already present).
import { type ReactNode, useState } from "react";
import { partyColor } from "@/lib/race-colors";

export type AbsenceRowData = {
  bioguideId: string;
  name: string;
  party: string | null;
  state: string;
  /** Server-formatted; see the clock note above. */
  sinceLabel: string;
  atBound: boolean;
  streak: number;
  missedPct: number;
  /** null = the HO 630 identity-only degrade; the row renders without an expand. */
  card: ReactNode | null;
};

// HO 627 §4, verbatim: a PLAIN click expands, a MODIFIED click navigates. The
// element stays a real <a href> so new-tab, "copy link address", middle-click and
// screen-reader link semantics keep working — only the DEFAULT navigation is
// suppressed on the unmodified case.
//
// The stopPropagation on the modified branch is NOT optional and is the mirrored
// defect HO 627 caught on its first honest gate run: letting the browser do its
// normal thing is not enough, because the event still bubbles to the row's toggle,
// so a ctrl-click opened the member in a background tab AND left the row expanded
// behind it — one affordance, two outcomes, which is the whole defect inverted.
function nameLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
    e.stopPropagation();
    return;
  }
  e.preventDefault();
}

export function AbsenceWatchRows({ rows }: { rows: AbsenceRowData[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <ul className="abw-rows">
      {rows.map((m) => {
        const expandable = m.card !== null;
        const open = expandable && expandedId === m.bioguideId;
        const toggle = () =>
          setExpandedId((cur) => (cur === m.bioguideId ? null : m.bioguideId));

        const inner = (
          <>
            {/* Leading disclosure glyph, the v2f-disc idiom (HO 627 §3): LEADING,
                never far-right — a right-anchored caret is the exact C1 defect
                that HO 609 removed from the feed row. aria-hidden because the row
                already carries role=button + aria-expanded, which is what
                assistive tech reads. Absent entirely on an identity-only row: a
                row that advertises an affordance it cannot honor is the 627
                defect again. */}
            {expandable ? (
              <span className="abw-disc" aria-hidden>
                ▸
              </span>
            ) : null}
            <a
              className="abw-name"
              href={`/members/${m.bioguideId}`}
              onClick={nameLinkClick}
            >
              {m.name}
            </a>
            <span className="abw-party" style={{ color: partyColor(m.party) }}>
              {(m.party ?? "?").toUpperCase()}-{m.state}
            </span>
            <span className="abw-claim">
              NO VOTE CAST SINCE{m.atBound ? " BEFORE" : ""} {m.sinceLabel}
            </span>
            <span className="abw-ev">
              · {m.streak}
              {m.atBound ? "+" : ""} CONSECUTIVE ROLL CALLS
            </span>
            <span className="abw-ev">· {m.missedPct.toFixed(1)}% OF 119TH VOTES</span>
          </>
        );

        return (
          <li key={m.bioguideId} className={open ? "abw-li is-open" : "abw-li"}>
            {expandable ? (
              <div
                className="abw-row"
                role="button"
                tabIndex={0}
                aria-expanded={open}
                onClick={toggle}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle();
                  }
                }}
              >
                {inner}
              </div>
            ) : (
              // Identity-only: no glyph, no role=button, no aria-expanded. The
              // name is still a plain link, so the member page stays reachable.
              <div className="abw-row abw-row--flat">{inner}</div>
            )}
            {open ? <div className="abw-card-wrap">{m.card}</div> : null}
          </li>
        );
      })}
    </ul>
  );
}
