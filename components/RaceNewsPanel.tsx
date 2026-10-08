"use client";

// HO 767 — RACE NEWS on /electoral's LIST (mock-767 v18, WHERE rows+beside):
// the last 7 days of observations about a sitting member on one of the tab's
// ballots, newest first, each item tagged with every seat of the tab it
// attaches to; a tag opens that row. Beside the rows from 1,150px (the same
// bottom edge as their box, set by the list), stacked above them below that,
// where it shows five and folds the rest. It follows the tab, so its header
// carries no count (C5: the tab does).
import { useState } from "react";
import { ageColor } from "@/components/RaceOpenRow";
import type { RaceNewsItem } from "@/lib/electoral-rows";
import { formatRelativeAge } from "@/lib/format";

const STACKED_CAP = 5;

export function RaceNewsPanel({
  chamber,
  items,
  seatLabels,
  nowMs,
  onSeat,
  maxHeight,
}: {
  chamber: "senate" | "house";
  items: RaceNewsItem[];
  seatLabels: Record<string, string>;
  nowMs: number;
  onSeat: (raceId: string) => void;
  maxHeight: number | null;
}) {
  const [more, setMore] = useState(false);
  return (
    <section
      className="rl-news"
      aria-label={`Race news, ${chamber}`}
      data-more={more ? "" : undefined}
      style={maxHeight != null ? { maxHeight } : undefined}
    >
      <div className="rl-news-head">
        <span className="rl-news-title">RACE NEWS · {chamber === "senate" ? "SENATE" : "HOUSE"}</span>
        <span className="rl-news-meta">7 DAYS</span>
      </div>
      {items.length === 0 ? (
        <div className="rl-news-empty">no news in the feed for these seats</div>
      ) : (
        items.map((n) => (
          <div key={n.obsId} className="rl-news-item">
            <a href={n.url} target="_blank" rel="noopener noreferrer" className="rl-news-h">
              {n.title}
            </a>
            <div className="rl-news-m">
              <span className="rl-age" style={{ color: ageColor(n.observedAt, nowMs) }}>
                {formatRelativeAge(n.observedAt, nowMs)}
              </span>
              <span className="rl-src">{n.publisher}</span>
              {n.seats.map((id) => (
                <button key={id} type="button" className="rl-news-tag" onClick={() => onSeat(id)}>
                  {seatLabels[id] ?? id}
                </button>
              ))}
            </div>
          </div>
        ))
      )}
      {items.length > STACKED_CAP ? (
        // Shown only when the column stacks above the rows (CSS); beside them
        // the column scrolls and shows every item.
        <button type="button" className="rl-news-more" onClick={() => setMore((m) => !m)}>
          {more ? "▾ fewer" : `▸ ${items.length - STACKED_CAP} more`}
        </button>
      ) : null}
    </section>
  );
}
