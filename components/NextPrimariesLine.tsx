"use client";

import Link from "next/link";
import { useState } from "react";
import type { DashboardPrimariesData } from "@/lib/queries";

// HO 657 — the primaries residue of the merged races panel. The COMPETITIVE|
// PRIMARIES sub-tabs, the 6-month tick timeline, the 2×2 date grid and the
// primaries count badge all died here; what survives is one line above the
// competitive body plus a click-open detail row.
//
// This island holds the open-state useState and NOTHING else, mirroring what
// RacesPanelTabs was (a toggle). The data is the UNCHANGED getDashboardPrimaries
// payload: `cards` is already the four soonest dates with states/counts/marquee
// seats, and `strip` carries the per-date `soon` flag the amber keys off.
//
// The type import is TYPE-ONLY on purpose — a runtime import from lib/queries
// drags next/cache into the client bundle (the standing rule).
//
// NO CLOCK: fmtDate parses the stored ISO date and never reads the current time,
// so this component is outside the HO 490 nowMs discipline by construction
// rather than by convention.

// Matches the retired card's overflow rule (was MAX_CARD_STATES in
// DashboardPrimaries) so the line abbreviates states the same way the grid did.
const MAX_LINE_STATES = 4;

function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const month = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `${month.toUpperCase()} ${d.getUTCDate()}`;
}

function statesLabel(states: string[]): string {
  return states.length > MAX_LINE_STATES
    ? `${states.slice(0, MAX_LINE_STATES).join("·")} +${states.length - MAX_LINE_STATES}`
    : states.join("·");
}

export function NextPrimariesLine({
  data,
  allHref,
}: {
  data: DashboardPrimariesData;
  allHref: string;
}) {
  const [openDate, setOpenDate] = useState<string | null>(null);
  const { cards, strip } = data;

  // DELIBERATE SEASONAL DEATH — an empty window renders NOTHING, not a "no
  // upcoming primaries" notice. In the merged panel the competitive battlefield
  // IS the body, so an empty-state line is pure noise between the chrome and the
  // thing the reader came for. Do not add an empty state back: the absence is
  // the correct signal, and it is what the primaries calendar looks like for
  // most of a cycle.
  if (cards.length === 0) return null;

  const soonByDate = new Map(strip.map((p) => [p.date, p.soon]));
  const open = cards.find((c) => c.date === openDate) ?? null;

  return (
    <>
      <div className="prim-line">
        <span className="prim-line-k">NEXT PRIMARIES</span>
        {cards.map((c) => {
          const isOpen = c.date === openDate;
          return (
            <button
              key={c.date}
              type="button"
              id={`prim-date-${c.date}`}
              className={`prim-date${soonByDate.get(c.date) ? " prim-date--soon" : ""}`}
              aria-expanded={isOpen}
              onClick={() => setOpenDate(isOpen ? null : c.date)}
            >
              <span className="prim-date-d">{fmtDate(c.date)}</span>{" "}
              {statesLabel(c.states)}{" "}
              <span className="prim-date-n">{c.count.toLocaleString()}</span>
            </button>
          );
        })}
        <Link className="prim-line-all" href={allHref}>
          ALL →
        </Link>
      </div>

      {open ? (
        <div
          className="prim-open"
          role="group"
          aria-labelledby={`prim-date-${open.date}`}
        >
          <div className="prim-open-hd">
            <span className="prim-open-d">{fmtDate(open.date)}</span>
            <button
              type="button"
              className="prim-open-x"
              aria-label={`Close ${fmtDate(open.date)} detail`}
              onClick={() => setOpenDate(null)}
            >
              ×
            </button>
          </div>
          <div className="prim-open-row">
            {open.states.join(" · ")} · <b>{open.count.toLocaleString()}</b>{" "}
            contest{open.count === 1 ? "" : "s"}
          </div>
          {open.seats.length > 0 ? (
            <div className="prim-open-row">
              {open.seats.map((seat, i) => (
                <span
                  key={seat.label}
                  style={{
                    color: seat.rated
                      ? "var(--accent-amber)"
                      : "var(--text-muted)",
                  }}
                >
                  {i > 0 ? " · " : ""}
                  {seat.label}
                </span>
              ))}
              {open.moreSeats > 0 ? (
                <span style={{ color: "var(--text-dim)" }}> · +{open.moreSeats}</span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}
