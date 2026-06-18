"use client";

// HO 264 (Piece 1 of 5) — the grouped /hearings list with single-open
// click-to-expand rows. Server hands down the already-banded meetings, a
// systemCode→name map, and a frozen `nowMs` (so badge/watch-state/day math is
// identical on server render and client hydration — no Date.now() drift). This
// component owns only the open-row state; all derivation is the shared lib.
import { useState } from "react";
import { HearingRow } from "@/components/HearingRow";
import { etDayKey, etDayLabel, etRelativeDay } from "@/lib/hearings";
import type { CommitteeMeeting } from "@/lib/queries";

export type HearingsBand = {
  key: string;
  label: string;
  meetings: CommitteeMeeting[];
};

export function HearingsList({
  bands,
  committeeNames,
  nowMs,
}: {
  bands: HearingsBand[];
  committeeNames: Record<string, string>;
  nowMs: number;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  if (bands.length === 0) {
    return <div className="hearings-empty">No meetings match these filters.</div>;
  }

  return (
    <div>
      {bands.map((band) => {
        // group this band's meetings into ET calendar days, preserving the
        // helper's date order (upcoming ASC / recent DESC) within each day.
        const days: { key: string; meetings: CommitteeMeeting[] }[] = [];
        const byKey = new Map<string, CommitteeMeeting[]>();
        for (const m of band.meetings) {
          const key = etDayKey(m.meetingDate);
          let arr = byKey.get(key);
          if (!arr) {
            arr = [];
            byKey.set(key, arr);
            days.push({ key, meetings: arr });
          }
          arr.push(m);
        }

        return (
          <section key={band.key}>
            <h2 className="hearings-band-head">
              {band.label}
              <span className="hearings-band-rule" aria-hidden />
            </h2>
            {days.map((day) => {
              const first = day.meetings[0]!;
              const rel = etRelativeDay(first.meetingDate, nowMs);
              return (
                <div key={day.key} className="hearings-list">
                  <div className="hearings-day-head">
                    <span>
                      {etDayLabel(first.meetingDate)}
                      {rel ? (
                        <>
                          {" "}
                          <span className="today">· {rel}</span>
                        </>
                      ) : null}
                    </span>
                    <span className="day-count">{day.meetings.length}</span>
                  </div>
                  <ul>
                    {day.meetings.map((m) => (
                      <HearingRow
                        key={m.eventId}
                        m={m}
                        committeeName={
                          m.committeeSystemCode
                            ? (committeeNames[m.committeeSystemCode] ?? null)
                            : null
                        }
                        nowMs={nowMs}
                        isOpen={openId === m.eventId}
                        onToggle={() =>
                          setOpenId((prev) =>
                            prev === m.eventId ? null : m.eventId,
                          )
                        }
                      />
                    ))}
                  </ul>
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
