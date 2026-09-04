"use client";

// HO 692 — the ODDS ON / OFF control, mounted on the masthead meta row of BOTH
// headers (DashboardV2Header and HeaderBar), middot-joined after LOGIN.
//
// THE LABEL IS RENDERED BY CSS, NOT BY STATE, and that is the whole trick. Both
// words are in the markup; `html[data-odds="off"]` decides which one is visible,
// exactly as it decides every other gated site. So the button reads correctly in
// the FIRST PAINT of a reader who has odds off, with no state read during render
// — which is also why there is no hydration exposure here: the server and the
// first client render emit the same two spans, and the pre-paint script has
// already set the attribute that picks between them.
//
// `aria-pressed` is the one thing CSS cannot express, so it is set post-mount
// (HO 690's rule: the visible state is CSS, the ARIA state is an effect). It is
// `undefined` until then rather than a guessed value — announcing "not pressed"
// to a reader whose odds are off would be worse than announcing nothing for a
// frame.
//
// NO CLOCK, NO RANDOM, NO `window.*` AT RENDER (SKILL, clock discipline). The
// only browser read is inside the effect and the click handler.
import { useEffect, useState } from "react";
import { readPref, writePref } from "@/lib/prefs";

export function OddsToggle() {
  const [on, setOn] = useState<boolean | null>(null);

  useEffect(() => {
    setOn(readPref("odds") === "on");
  }, []);

  return (
    <button
      type="button"
      className="odds-toggle"
      // Undefined until mounted — see the note above.
      aria-pressed={on === null ? undefined : on}
      aria-label="Toggle prediction market odds"
      onClick={() => {
        const next = readPref("odds") === "on" ? "off" : "on";
        writePref("odds", next);
        setOn(next === "on");
      }}
    >
      ODDS{" "}
      <span className="odds-toggle-state odds-only">ON</span>
      <span className="odds-toggle-state odds-off-only">OFF</span>
    </button>
  );
}
