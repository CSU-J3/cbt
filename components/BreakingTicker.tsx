"use client";

import { useEffect, useState } from "react";
import { BREAKING_FLAVOR } from "@/lib/landing-flavor";

// HO 361 — the /welcome BREAKING strip's rotating flavor line. Cycles
// BREAKING_FLAVOR every ~8s with a subtle fade (the fade keyframe + the
// reduced-motion kill live in the landing CSS module, applied via lineClassName).
// prefers-reduced-motion → one static pick, no cycle.
//
// SSR/first-paint renders index 0 deterministically so hydration matches; the
// effect then either starts the interval (normal) or, under reduced-motion,
// swaps to a single random pick and stops. The keyed inner span remounts on each
// index change, replaying the CSS fade-in.
const CYCLE_MS = 8000;

export function BreakingTicker({
  txtClassName,
  lineClassName,
}: {
  txtClassName: string;
  lineClassName: string;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

    if (reduce) {
      // Static pick, no cycle. Random chosen client-side (post-hydration) so it
      // varies per load without an SSR mismatch.
      setIndex(Math.floor(Math.random() * BREAKING_FLAVOR.length));
      return;
    }

    const id = setInterval(() => {
      setIndex((i) => (i + 1) % BREAKING_FLAVOR.length);
    }, CYCLE_MS);
    return () => clearInterval(id);
  }, []);

  return (
    <span className={txtClassName} aria-live="polite">
      <span key={index} className={lineClassName}>
        {BREAKING_FLAVOR[index]}
      </span>
    </span>
  );
}
