// HO 306 — the dashboard (`/`) HEARINGS tab content. Server wrapper that fetches
// the meetings (recent widened to 14d so the ribbon's week-over-week delta is
// honest) and hands them to the tab's interior.
//
// HO 610 (P3 slice 3): that interior is now HearingsDaySchedule — the mock's
// day-schedule + week ribbon — instead of the shared HearingsCalendar in
// `embedded` mode. The five-column week grid reserved a 358px "No meetings" box
// per empty day (the C4 defect, and every M2 hit on `/`); the ribbon gives an
// empty day one dash. /hearings keeps the full calendar, one click away via the
// panel's → ALL link, and the two surfaces still share the per-meeting detail
// card (HearingDetailCard) so they cannot drift on what a meeting looks like.
// The tab's TYPE/CHAMBER filter bar goes with the grid: this is a glance
// surface, and /hearings carries the filters.
import { HearingsDaySchedule } from "@/components/HearingsDaySchedule";
import {
  getCommitteesIndex,
  getRecentMeetings,
  getUpcomingMeetings,
} from "@/lib/queries";

const RECENT_DAYS = 14;

export async function HearingsTab() {
  const [upcoming, recent, committees] = await Promise.all([
    getUpcomingMeetings(),
    getRecentMeetings(RECENT_DAYS),
    getCommitteesIndex(),
  ]);
  const committeeNames: Record<string, string> = {};
  for (const c of committees) committeeNames[c.systemCode] = c.name;

  return (
    <HearingsDaySchedule
      meetings={[...upcoming, ...recent]}
      committeeNames={committeeNames}
      nowMs={Date.now()}
    />
  );
}
