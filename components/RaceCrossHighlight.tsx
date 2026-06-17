"use client";

import { useEffect, useRef } from "react";

// HO 260 — card ↔ battlefield-marker cross-highlight, mirroring the mock's JS.
// A thin client wrapper around the v2 COMPETITIVE content (Battlefield + the
// rich card grid, both server-rendered). On mount it pairs each `.race-card`
// with the `.cm` marker carrying the same `data-seat` (the full raceId) and
// toggles `.hl` on BOTH when either is hovered — card hover lights its marker,
// and the marker's dot/label hover lights the card. No render output of its own
// beyond the `[data-races]` scoping container (matches the mock's selector root).
export function RaceCrossHighlight({
  children,
}: {
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const cleanups: Array<() => void> = [];
    root
      .querySelectorAll<HTMLElement>(".race-card[data-seat]")
      .forEach((card) => {
        const seat = card.dataset.seat;
        if (!seat) return;
        const marker = root.querySelector<HTMLElement>(
          `.cm[data-seat="${CSS.escape(seat)}"]`,
        );
        if (!marker) return;
        const on = () => {
          marker.classList.add("hl");
          card.classList.add("hl");
        };
        const off = () => {
          marker.classList.remove("hl");
          card.classList.remove("hl");
        };
        card.addEventListener("mouseenter", on);
        card.addEventListener("mouseleave", off);
        const hovers = marker.querySelectorAll<HTMLElement>(".cm-dot, .cm-lbl");
        hovers.forEach((e) => {
          e.addEventListener("mouseenter", on);
          e.addEventListener("mouseleave", off);
        });
        cleanups.push(() => {
          card.removeEventListener("mouseenter", on);
          card.removeEventListener("mouseleave", off);
          hovers.forEach((e) => {
            e.removeEventListener("mouseenter", on);
            e.removeEventListener("mouseleave", off);
          });
          off();
        });
      });
    return () => cleanups.forEach((c) => c());
  }, []);
  return (
    <div ref={ref} data-races>
      {children}
    </div>
  );
}
