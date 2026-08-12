"use client";

// HO 630/645 — the Absence Watch band's interactive shell. Owner ruling, the same
// product logic as HO 627's: THE DRILL MOVES ONE LEVEL IN, NOT AWAY. A plain
// click opens the member's card back; the member page stays reachable by
// modifier-click on the name.
//
// HO 645 — THE BAND IS A CARD RACK NOW (docs/design/mock-645-absence-cards-v6.html).
// Each member is a 126px trading card — mat, photo face, streak disc, name plate,
// two stat cells — and the expand is a 330px BACK that hangs off the bottom edge
// of the rack with a notch pointing at the card that opened it. What went away
// with the row: the packed-left claim/evidence clauses (they are the back's ruled
// stat rows now) and SponsorExpandedPanel (the back is its own component, see
// AbsenceCardBack — SponsorExpandedPanel is untouched and still serves /members).
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
// WHY THE BACK ARRIVES AS A ReactNode.
// AbsenceCardBack is a SERVER component, and a client island cannot import one.
// The server band renders each back and passes it down as a prop; this island
// only decides which one to mount and where to put it. That is the ActivityTabs
// idiom, and it is what keeps `lib/queries` — and with it `next/cache` — out of
// the client bundle.
//
// THE CARD IS A div[role="button"], NOT THE MOCK'S <button>, and the deviation is
// forced rather than stylistic: §1a of the handoff keeps HO 627's plain-click-
// expands / modified-click-navigates split on the NAME, and an <a> nested inside
// a <button> is invalid HTML (and is dropped or re-parented by real browsers). A
// focusable div carrying role=button + aria-expanded is the same idiom the row
// used, so the focus return on Esc keeps working unchanged.
import {
  type ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { partyColor, surname } from "@/lib/race-colors";
import { SponsorPhoto } from "@/components/SponsorPhoto";

// The card's own geometry, in one place because three of these four numbers are
// load-bearing twice — once here (the photo is sized in px, so it must match the
// face) and once in globals.css (.abw-card / .abw-card-face). Change one, change
// both.
const FACE_W = 112; // 126 card - 2*1 card border - 2*5 mat padding - 2*1 face border
const FACE_H = 132; // 134 face - 2*1 face border
const BACK_W = 330; // .abw-cardback width
const PAD = 12; // the rack's own horizontal padding, and the panel's clamp margin
const NOTCH_MIN = 9; // the notch's own left bound inside the panel

export type AbsenceCardData = {
  bioguideId: string;
  name: string;
  party: string | null;
  state: string;
  chamber: string;
  /** Server-formatted; see the clock note above. */
  sinceLabel: string;
  atBound: boolean;
  streak: number;
  missedPct: number;
  back: ReactNode;
};

// HO 627 §4, verbatim: a PLAIN click expands, a MODIFIED click navigates. The
// element stays a real <a href> so new-tab, "copy link address", middle-click and
// screen-reader link semantics keep working — only the DEFAULT navigation is
// suppressed on the unmodified case.
//
// The stopPropagation on the modified branch is NOT optional and is the mirrored
// defect HO 627 caught on its first honest gate run: letting the browser do its
// normal thing is not enough, because the event still bubbles to the card's
// toggle, so a ctrl-click opened the member in a background tab AND left the card
// expanded behind it — one affordance, two outcomes, which is the whole defect
// inverted.
function nameLinkClick(e: React.MouseEvent<HTMLAnchorElement>) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) {
    e.stopPropagation();
    return;
  }
  e.preventDefault();
}

export function AbsenceWatchCards({ rows }: { rows: AbsenceCardData[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  // Keyed by bioguide so Esc can hand focus back to the card that opened the
  // back — a panel that closes into nowhere strands a keyboard reader at the top
  // of the document, which is the whole reason this map exists. The same refs are
  // what the horizontal placement measures.
  const cardRefs = useRef(new Map<string, HTMLDivElement | null>());
  const rackRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ left: number; notch: number }>({
    left: PAD,
    notch: NOTCH_MIN,
  });

  const close = useCallback(() => {
    setExpandedId((cur) => {
      if (cur) cardRefs.current.get(cur)?.focus();
      return null;
    });
  }, []);

  // CLOSE SEMANTICS. Both listeners are registered only while a back is open, and
  // both live on `document` rather than on the band.
  //
  // The outside click is a BUBBLE-phase `click` with no preventDefault, and that
  // is the whole ruling: the target's own behaviour has already run by the time
  // this fires (React's root handler sits below document in the tree), so one
  // click both closes the panel and does the thing that was clicked. Clicking a
  // feed bill row while a back is open expands that bill AND closes the back —
  // one click, not two. A `mousedown` listener, or a capture-phase one, or
  // anything calling preventDefault, would take the first click away from the
  // page and is the defect this is written against.
  //
  // The in-band test is `closest('.abw')`, not a ref to the rack: the header and
  // the footnote are inside the band and clicking them must not close, and the
  // panel itself is inside the band so its links keep working.
  useEffect(() => {
    if (!expandedId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      const card = cardRefs.current.get(expandedId);
      setExpandedId(null);
      card?.focus();
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

  // HORIZONTAL PLACEMENT — the one measured axis, and only this one.
  //
  // Vertical needs no measurement: the panel sits at the rack's bottom edge in
  // CSS (see .abw-cardback), anchored to the LOWEST card rather than the open one
  // so a wrapped second row can never be covered (HO 631's ruling, carried over).
  // Horizontal cannot be done in CSS at all — the panel is 330px against a card
  // that is 126px and may sit anywhere across the rack — so it is read off the
  // open card and clamped into the rack.
  //
  // useLayoutEffect, not useEffect: it runs after the DOM mutation and BEFORE
  // paint, so the panel never paints once at the default left and then jumps.
  useLayoutEffect(() => {
    if (!expandedId) return;
    const place = () => {
      const rack = rackRef.current;
      const card = cardRefs.current.get(expandedId);
      if (!rack || !card) return;
      const rackW = rack.clientWidth;
      const cardLeft = card.offsetLeft; // offsetParent is the rack (position:relative)
      const cardW = card.offsetWidth;
      // The clamp's upper bound can fall BELOW its lower bound on a rack narrower
      // than the panel; Math.max keeps `left` at PAD there rather than negative.
      const maxLeft = Math.max(PAD, rackW - BACK_W - PAD);
      const left = Math.min(Math.max(PAD, cardLeft), maxLeft);
      const notch = Math.min(
        Math.max(NOTCH_MIN, cardLeft + cardW / 2 - left - 6),
        BACK_W - 21,
      );
      setPos({ left, notch });
    };
    place();
    window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [expandedId]);

  const openRow =
    (expandedId ? rows.find((r) => r.bioguideId === expandedId) : null) ?? null;

  return (
    // The rack is the positioning context for the panel, which is why the panel
    // is a sibling of the <ul> inside it rather than a child of any one <li>: a
    // <div> is not valid inside a <ul>, and anchoring to the open card's own <li>
    // would move the panel's origin every time a different card opened.
    <div className="abw-rack" ref={rackRef}>
      <ul className="abw-cards">
        {rows.map((m) => {
          const open = expandedId === m.bioguideId;
          const toggle = () =>
            setExpandedId((cur) => (cur === m.bioguideId ? null : m.bioguideId));

          return (
            <li key={m.bioguideId}>
              <div
                className="abw-card abw-card--mia"
                role="button"
                tabIndex={0}
                aria-expanded={open}
                ref={(el) => {
                  cardRefs.current.set(m.bioguideId, el);
                }}
                onClick={toggle}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggle();
                  }
                }}
              >
                {/* The MAT is what makes this read as a card rather than a tile —
                    the border printed around a photo, not a border on a box. It
                    is a real element on purpose; collapsing it into a thick
                    border on .abw-card loses the inner frame the face draws. */}
                <div className="abw-card-mat">
                  <div className="abw-card-face">
                    {/* Real portrait, one implementation: SponsorPhoto owns the
                        bioguide URL and the onError->initials fallback for the
                        whole app (HO 645 gave it the explicit-height prop this
                        0.85 face needs). Dim initials rather than party-coloured
                        ones — C3, the surname below is the card's one bright
                        element. */}
                    <SponsorPhoto
                      bioguideId={m.bioguideId}
                      name={m.name}
                      partyColor="var(--text-dim)"
                      width={FACE_W}
                      height={FACE_H}
                      bordered={false}
                    />
                    {/* The streak, in the tier's colour with dark text on it. The
                        `+` is not decoration: at the walk bound the streak is a
                        floor, not a count, and a bare number would overstate what
                        was observed. */}
                    <span className="abw-card-disc">
                      {m.streak}
                      {m.atBound ? "+" : ""}
                    </span>
                    <span className="abw-card-cut" aria-hidden />
                    <span className="abw-card-pos">
                      {m.chamber === "senate" ? "SEN" : "HSE"}
                    </span>
                    <span className="abw-card-plate">
                      <a
                        className="abw-card-name"
                        href={`/members/${m.bioguideId}`}
                        onClick={nameLinkClick}
                      >
                        {surname(m.name)}
                      </a>
                      <span
                        className="abw-card-team"
                        style={{ color: partyColor(m.party) }}
                      >
                        {(m.party ?? "?").toUpperCase()}-{m.state}
                      </span>
                    </span>
                  </div>
                  {/* LAST is the date of the last vote CAST; the leading `<` is
                      the atBound branch ("cast before this date"), spelled out in
                      full on the back. MISSED is the cumulative 119th rate — the
                      band's own evidence clause, not the mock's participation
                      figure, which this corpus does not carry. */}
                  <dl className="abw-card-stats">
                    <div>
                      <dt>LAST</dt>
                      <dd>
                        {m.atBound ? "<" : ""}
                        {m.sinceLabel}
                      </dd>
                    </div>
                    <div>
                      <dt>MISSED</dt>
                      <dd>{m.missedPct.toFixed(1)}%</dd>
                    </div>
                  </dl>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      {openRow ? (
        <div
          className="abw-cardback abw-cardback--mia"
          style={{ left: pos.left }}
          role="region"
          aria-label={`${openRow.name} — member card`}
        >
          <span
            className="abw-cardback-notch"
            style={{ left: pos.notch }}
            aria-hidden
          />
          {/* The close control lives HERE, in the island, rather than in the
              server-rendered back: it needs a handler. Absolutely positioned into
              the back's head row so it reads as part of it. */}
          <button
            type="button"
            className="abw-cardback-close"
            onClick={close}
            aria-label={`Close ${openRow.name} card`}
          >
            ✕
          </button>
          <div className="abw-cardback-inner">{openRow.back}</div>
        </div>
      ) : null}
    </div>
  );
}
