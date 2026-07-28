"use client";

import { useState } from "react";

// HO 545 — the /lobbying expand-panel LD-2 description, line-clamped to 4 lines
// closed with an explicit SHOW MORE / SHOW LESS reveal. The SOLE client boundary
// extracted from the (server) FilingExpandPanel — the FillerWatchStrip (HO 348)
// precedent: a small collapsible island on an otherwise server page.
//
// The toggle rides a dedicated <button>, NOT the text block: these are lobbying
// descriptions researchers copy, so a <details>/<summary> route (where selecting
// text toggles the panel) is an active regression — rejected for exactly this.
//
// Conditional clamp: descriptions run p50 95 chars (HO 485), so most are 1–2
// lines and a control under them is pure noise. The affordance appears when EITHER
// the char length exceeds the box (~250 ≈ 4 lines; the /lobbying column CDP-measured
// at 56 chars/line, so 4 lines ≈ 224 chars) OR the hard-newline count exceeds 4
// line-segments (LD-2 free text carries breaks).
//
// Rendered line count isn't knowable server-side, so BELOW threshold the text
// renders UNCLAMPED (the --open state), NOT the bare clamped base — because
// `white-space: pre-wrap` makes the 4-line clamp count hard newlines as lines, so
// a short-but-wrapping (or mid-text-break) description in the clamped base would
// silently clip with no reveal. Unclamped-below-threshold is clip-proof regardless
// of column width or break placement; short text never reaches the 420px bound, so
// it renders identically to a short filing today. The threshold then only decides
// when a description is long enough to be worth OFFERING to collapse.

const CLAMP_CHAR_THRESHOLD = 250;
const CLAMP_LINE_THRESHOLD = 4;

// text mirrors FilingActivity.description (string | null); the probe found 0%
// empty, but the type is nullable, so a null falls through the plain branch.
export function FilingDescription({ text }: { text: string | null }) {
  const [open, setOpen] = useState(false);

  const needsClamp =
    text != null &&
    (text.length > CLAMP_CHAR_THRESHOLD ||
      text.split("\n").length > CLAMP_LINE_THRESHOLD);

  if (!needsClamp) {
    return <div className="lob-exp-desc lob-exp-desc--open">{text}</div>;
  }

  return (
    <>
      <div
        className={open ? "lob-exp-desc lob-exp-desc--open" : "lob-exp-desc"}
      >
        {text}
      </div>
      <button
        type="button"
        className="lob-exp-desc-more"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? "SHOW LESS" : "SHOW MORE"}
      </button>
    </>
  );
}
