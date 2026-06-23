// /hearings — committee hearings calendar (HO 264 → redesigned HO 306). The
// calendar is now the ONLY view (the LIST view + VIEW toggle are retired; a
// stale `?view=` is ignored so old links still resolve to the calendar). The
// TYPE/CHAMBER filter is client-state inside the shared HearingsCalendar, so the
// page just fetches the meetings (recent widened to 14d for the week stat's
// prior-week delta), builds the systemCode→name map, and hands them down with a
// frozen `nowMs`.
import { HearingsCalendar } from "@/components/HearingsCalendar";
import { HeaderBar } from "@/components/HeaderBar";
import { getCurrentCongress, ordinal } from "@/lib/congress";
import {
  addDaysToKey,
  etDayKey,
  etTodayKey,
  mondayOfKey,
} from "@/lib/hearings";
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

  const nowMs = Date.now();
  const all = [...upcoming, ...recent];

  // Masthead summary over the calendar's visible scope (this week + next week).
  const currentMon = mondayOfKey(etTodayKey(nowMs));
  const nextFri = addDaysToKey(currentMon, 11); // wk1 Mon..Fri = 0..4, wk2 Fri = 11
  const inRange = all.filter((m) => {
    const k = etDayKey(m.meetingDate);
    return k >= currentMon && k <= nextFri;
  });
  const total = inRange.length;
  const houseN = inRange.filter((m) => m.chamber === "house").length;
  const senateN = inRange.filter((m) => m.chamber === "senate").length;
  const congress = ordinal(getCurrentCongress()).toUpperCase();

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar basePath="/hearings" />

      <main className="w-full flex-1 px-4 py-4">
        <div className="hearings-page-masthead">
          <span className="hearings-prompt">
            Hearings
            <span className="prompt-accent" aria-hidden>
              {":\\"}
            </span>
            <span className="prompt-accent" aria-hidden>
              {">"}
            </span>
            <span className="home-cursor-caret" aria-hidden>
              _
            </span>
          </span>
          <span className="hearings-subhead">
            · <span className="num">{total.toLocaleString()}</span> MEETINGS ·
            HOUSE <span className="num">{houseN.toLocaleString()}</span> / SENATE{" "}
            <span className="num">{senateN.toLocaleString()}</span> · {congress}{" "}
            CONGRESS
          </span>
        </div>

        <HearingsCalendar
          meetings={all}
          committeeNames={committeeNames}
          nowMs={nowMs}
          weeks={2}
        />
      </main>
    </div>
  );
}
