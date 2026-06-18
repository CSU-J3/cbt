"use client";

// HO 267 (Piece 4 of 5) — the secondary-cut wrapper: the Piece 1 meeting row in
// a scoped section, with single-open expand shared across all rows (and across
// the optional group bands, so opening one row closes any other). Used by the
// committee detail page (UPCOMING / RECENT groups) and the bill hub (one group,
// bill-chip column dropped). The server page does the grouping/capping + section
// chrome; this owns only the rows + open state.
import { useState } from "react";
import { HearingRow } from "@/components/HearingRow";
import type { CommitteeMeeting } from "@/lib/queries";

export type HearingEmbedGroup = {
  key: string;
  label?: string;
  meetings: CommitteeMeeting[];
};

export function HearingMeetingsEmbed({
  groups,
  committeeNames,
  nowMs,
  hideBills = false,
}: {
  groups: HearingEmbedGroup[];
  committeeNames: Record<string, string>;
  nowMs: number;
  hideBills?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="hearings-embed">
      {groups.map((g) =>
        g.meetings.length === 0 ? null : (
          <div key={g.key} className="hearings-embed-group">
            {g.label ? (
              <div className="hearings-embed-grouphead">{g.label}</div>
            ) : null}
            <ul>
              {g.meetings.map((m) => (
                <HearingRow
                  key={m.eventId}
                  m={m}
                  committeeName={
                    m.committeeSystemCode
                      ? (committeeNames[m.committeeSystemCode] ?? null)
                      : null
                  }
                  nowMs={nowMs}
                  hideBills={hideBills}
                  isOpen={openId === m.eventId}
                  onToggle={() =>
                    setOpenId((prev) => (prev === m.eventId ? null : m.eventId))
                  }
                />
              ))}
            </ul>
          </div>
        ),
      )}
    </div>
  );
}
