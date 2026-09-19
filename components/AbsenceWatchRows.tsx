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
//
// HO 631 — THE CARD IS AN OVERLAY NOW, and the structural consequence is that it
// is no longer rendered inside the <li> whose row opened it. It is a sibling of
// the whole <ul>, positioned against the BAND (see the CSS): anchoring on the row
// would have put the pop over the band's own second row and footnote, and the
// point of the overlay is that everything the band says stays readable while a
// card is open. So this island renders a fragment — the rows, then the one open
// card — and the band's `position: relative` is what they are both measured from.
import { type ReactNode, useEffect, useRef, useState } from "react";
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
  // Keyed by bioguide so Esc can hand focus back to the row that opened the card
  // — a card that closes into nowhere strands a keyboard reader at the top of the
  // document, which is the whole reason this map exists.
  const rowRefs = useRef(new Map<string, HTMLDivElement | null>());

  // CLOSE SEMANTICS. Both listeners are registered only while a card is open, and
  // both live on `document` rather than on the band.
  //
  // The outside click is a BUBBLE-phase `click` with no preventDefault, and that
  // is the whole ruling: the target's own behaviour has already run by the time
  // this fires (React's root handler sits below document in the tree), so one
  // click both closes the card and does the thing that was clicked. Clicking a
  // feed bill row while a card is open expands that bill AND closes the card —
  // one click, not two. A `mousedown` listener, or a capture-phase one, or
  // anything calling preventDefault, would take the first click away from the
  // page and is the defect this is written against.
  //
  // The in-band test is `closest('.abw')`, not a ref to the <ul>: the header and
  // the footnote are inside the band and clicking them must not close, and the
  // pop itself is inside the band so its links keep working.
  useEffect(() => {
    if (!expandedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const row = rowRefs.current.get(expandedId);
      setExpandedId(null);
      row?.focus();
    };
    const onDocClick = (e: MouseEvent) => {
      const t = e.target;
      if (t instanceof Element && t.closest(".abw")) return;
      setExpandedId(null);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("click", onDocClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", onDocClick);
    };
  }, [expandedId]);

  const openRow =
    (expandedId ? rows.find((r) => r.bioguideId === expandedId) : null) ?? null;

  return (
    <>
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
                ref={(el) => {
                  rowRefs.current.set(m.bioguideId, el);
                }}
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
          </li>
        );
      })}
      </ul>

      {/* THE OVERLAY. One card, a sibling of the rows rather than a child of any
          one of them, so it hangs off the band's bottom edge and the rows above
          it — and the footnote's delegate disclosure — stay on screen. It is
          absolutely positioned, so nothing below the band moves when it opens;
          that is the property the zero-reflow instrument measures. */}
      {openRow ? (
        <div
          className="abw-card-pop"
          role="region"
          aria-label={`${openRow.name} — member card`}
        >
          <div className="abw-card-wrap">{openRow.card}</div>
        </div>
      ) : null}
    </>
  );
}
