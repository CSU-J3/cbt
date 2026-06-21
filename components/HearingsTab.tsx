// HO 306 — the dashboard-v2 HEARINGS tab content. Server wrapper that fetches
// the meetings (recent widened to 14d for the week stat's prior-week delta) and
// renders the SHARED HearingsCalendar in embedded mode: single week, capped per
// day, height-pinned to the RACES footprint by the B4 box CSS. Replaces the
// standalone OnTheHillBand so /hearings and the tab can't drift.
import { HearingsCalendar } from "@/components/HearingsCalendar";
import {
  getCommitteesIndex,
  getRecentMeetings,
  getUpcomingMeetings,
} from "@/lib/queries";

const RECENT_DAYS = 14;
const DAY_CAP = 6;

export async function HearingsTab() {
  const [upcoming, recent, committees] = await Promise.all([
    getUpcomingMeetings(),
    getRecentMeetings(RECENT_DAYS),
    getCommitteesIndex(),
  ]);
  const committeeNames: Record<string, string> = {};
  for (const c of committees) committeeNames[c.systemCode] = c.name;

  return (
    <HearingsCalendar
      meetings={[...upcoming, ...recent]}
      committeeNames={committeeNames}
      nowMs={Date.now()}
      weeks={1}
      embedded
      cap={DAY_CAP}
    />
  );
}
