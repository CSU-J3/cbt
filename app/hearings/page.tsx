// /hearings — committee hearings calendar (HO 264 → redesigned HO 306 → header
// consolidated HO 366). The calendar is the ONLY view. The redundant secondary
// `Hearings:\>` title (which echoed the breadcrumb directly above it) is gone;
// its meeting count relocated into the calendar's filter bar as a filter-reactive
// corpus readout (`showCorpus`). The TYPE/CHAMBER filter + week stat are all
// client-state inside the shared HearingsCalendar, so the page just fetches the
// meetings (recent widened to 14d for the week stat's prior-week delta), builds
// the systemCode→name map, and hands them down with a frozen `nowMs`.
import { HearingsCalendar } from "@/components/HearingsCalendar";
import { HeaderBar } from "@/components/HeaderBar";
import {
  getCommitteesIndex,
  getRecentMeetings,
  getUpcomingMeetings,
} from "@/lib/queries";

// Live status + the meeting set are time-sensitive, so render at request time.
export const dynamic = "force-dynamic";

const RECENT_DAYS = 14;

export default async function HearingsPage() {
  const [upcoming, recent, committees] = await Promise.all([
    getUpcomingMeetings(),
    getRecentMeetings(RECENT_DAYS),
    getCommitteesIndex(),
  ]);

  const committeeNames: Record<string, string> = {};
  for (const c of committees) committeeNames[c.systemCode] = c.name;

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/hearings" />

      <main className="w-full flex-1 px-4 py-4">
        <HearingsCalendar
          meetings={[...upcoming, ...recent]}
          committeeNames={committeeNames}
          nowMs={Date.now()}
          weeks={2}
          showCorpus
        />
      </main>
    </div>
  );
}
