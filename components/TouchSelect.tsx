import type { ComponentPropsWithoutRef, ReactNode } from "react";

// HO 816 — THE FILTER SELECT'S ONE HOME. StageFilter, SortDropdown, StateFilter
// and PartyFilter render their <select> through this wrapper, and the select's
// className and style live here and nowhere else (they were one string and one
// object, character for character, in all four files at 921c371).
//
// WITH A FINE POINTER NOTHING CHANGES. `.tsel` computes `display: contents`, so
// the select is the flex item it always was, and `.tsel-face` isn't drawn.
//
// ON A TOUCH DEVICE (`@media (pointer: coarse)`, app/globals.css) the wrapper
// draws the face, the segments' 12px uppercase look, and the real select sits on
// top of it at opacity 0: 6px taller above and below, so a 28px face answers a
// 40px touch. The select is still what's tapped, focused and read by a screen
// reader, and HO 815's rule still sets it at 16px, so iOS Safari has no reason
// to zoom. The face is aria-hidden; the select carries the accessible name.
// Ruled C on mock-816 v1 (the ruled mock, kept under docs/design), Corey's
// "c", 12:54 PM MST 2026-11-13.
//
// The caret is U+25BC, as the mock draws it. It has no emoji presentation, so it
// takes no variation selector.
//
// No "use client": the four callers are client components.
export function TouchSelect({
  label,
  faceText,
  children,
  ...select
}: {
  /** The select's accessible name. */
  label: string;
  /** What the face reads: the selected option's label, or the first option's
   *  when no option's value matches. */
  faceText: string;
  children: ReactNode;
} & Omit<ComponentPropsWithoutRef<"select">, "className" | "style" | "aria-label" | "children">) {
  return (
    <span className="tsel">
      <span className="tsel-face" aria-hidden="true">
        <span>{faceText}</span>
        <i className="tsel-caret">▼</i>
      </span>
      <select
        {...select}
        aria-label={label}
        className="rounded-sm border px-2 py-1 text-[length:var(--fs-12)] font-medium uppercase tracking-[0.5px] focus:outline-none"
        style={{
          backgroundColor: "var(--bg-base)",
          color: "var(--text-secondary)",
          borderColor: "var(--border-strong)",
        }}
      >
        {children}
      </select>
    </span>
  );
}
