"use client";

// HO 690 — the week-summary row, extracted out of WeeklyBand into a client
// island so it can collapse, and so the collapse PERSISTS (ruled by Corey
// 2026-09-03, "4. yes to the new one", against docs/design/mock-690-chrome.html
// § 04). HO 689 shipped the row itself; everything about what the text is and
// why it carries its own week label lives in WeeklyBand's comment above the
// render, not here.
//
// THE VISIBLE STATE IS CSS, NOT REACT. `lib/prefs.ts`'s pre-paint script has
// already put `data-week-summary="collapsed"` on <html> before anything paints,
// and globals.css hides the text and flips the chevron off that attribute. This
// component's `open` state exists for ARIA ONLY: it starts `null` so SSR and the
// first client render agree on `aria-expanded={undefined}`, and the effect
// corrects it after mount. Reading the preference during render instead would be
// the HO 490 clock class in a different costume — the server cannot read
// localStorage, so the two renders would disagree.
//
// TWO SIBLINGS, NOT A LINK INSIDE A BUTTON. The mock draws the report link
// inside the toggle's <button>; an <a> inside a <button> is invalid HTML and the
// nesting makes "click the link" and "click the row" the same event. The row is
// a flex container holding the button and the link side by side, the link pinned
// right with `margin-left: auto`. A click on the link navigates; a click anywhere
// else on the row toggles.
//
// The toggle re-reads the stored value on every click rather than trusting local
// state, so a second tab that changed the preference cannot leave this one
// writing the value it already has.

import Link from "next/link";
import { useEffect, useState } from "react";
import { readPref, writePref } from "@/lib/prefs";

export function WeekSentences({
  weekStart,
  stale,
  text,
  report,
}: {
  /** MON DD of the COMPLETED week the text describes — already formatted by the
   *  server, so this island holds no clock (HO 490 / HO 574). */
  weekStart: string;
  stale: boolean;
  text: string;
  /** The latest report, or null when none exists. Its week can legitimately
   *  differ from `weekStart` on a stale summary — that difference is the honest
   *  reading, not a defect to reconcile. */
  report: { slug: string; weekStart: string } | null;
}) {
  const [open, setOpen] = useState<boolean | null>(null);
  useEffect(() => {
    setOpen(readPref("weekSummary") === "open");
  }, []);

  const toggle = () => {
    const next = readPref("weekSummary") !== "open";
    writePref("weekSummary", next ? "open" : "collapsed");
    setOpen(next);
  };

  return (
    <section className="week-sentences" aria-label="Week summary">
      <div className="week-sentences-row">
        <button
          type="button"
          className="week-sentences-toggle"
          onClick={toggle}
          aria-expanded={open ?? undefined}
          aria-controls="week-sentences-text"
        >
          <span className="week-sentences-label">
            Week of{" "}
            <span className="tabular-nums week-sentences-week">{weekStart}</span>{" "}
            · summary
            {stale ? (
              <span className="week-sentences-stale"> · last generated week</span>
            ) : null}
          </span>
          {/* Both glyphs are rendered and CSS shows exactly one, keyed on the
              same attribute as the text — so the chevron is already right at
              first paint, with no JS and no flash. */}
          <span className="week-sentences-chev" aria-hidden>
            <span className="week-sentences-chev-open">▾</span>
            <span className="week-sentences-chev-collapsed">▸</span>
          </span>
        </button>
        {report ? (
          <Link
            href={`/reports/${report.slug}`}
            className="week-sentences-report"
          >
            {report.weekStart} report →
          </Link>
        ) : null}
      </div>
      <p className="week-sentences-text" id="week-sentences-text">
        {text}
      </p>
    </section>
  );
}
