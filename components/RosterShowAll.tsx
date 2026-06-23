"use client";

// HO 328: the scoped-roster overflow disclosure. The right pane caps a scoped
// committee roster at ~10 rows; rows 11+ are passed as children and revealed by
// a "▾ SHOW ALL N MEMBERS (M more)" toggle. defaultOpen starts expanded when the
// currently-expanded member is in the overflow (so a deep-linked ?expanded row
// in the tail isn't hidden). Ephemeral client state — the cap is a display
// concern, not URL-shareable (the dashboard-accordion idiom).
import { useState } from "react";

export function RosterShowAll({
  total,
  more,
  defaultOpen = false,
  children,
}: {
  total: number;
  more: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (more <= 0) return <>{children}</>;
  return (
    <>
      {open ? children : null}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mc-roster-showall"
      >
        {open ? "▴ SHOW FEWER" : `▾ SHOW ALL ${total} MEMBERS (${more} more)`}
      </button>
    </>
  );
}
