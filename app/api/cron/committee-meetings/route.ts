// Committee meetings (hearings) cron (HO 754). Split out of /api/cron/committees,
// where the meetings step ran after the bills step and got whatever the bills step
// left of the 50s (HO 752 read 29 of 43 success ticks hitting the bills deadline), and
// ran not at all when that route errored before it.
//
// One operation: `syncMeetings` (lib/meetings-sync.ts) reads each chamber's whole
// committee-meeting list, refreshes every event with no stored row or an older stored
// update_date, oldest first, and marks a stored row the list no longer carries
// `absent_upstream_at` (kept, never deleted, hidden by the meeting queries). No new
// detail, page or retry starts past 50s of the route's lifetime; an attempt in flight
// is cut 3s after, inside the wrapper's 55s soft timeout. Events not reached stay owed.
// A detail gets two tries; both failing on their own clock charges it, and five running
// set it aside, so one detail that never answers cannot hold the queue. A run that reads
// no list page at all records `error`. `npm run sync:meetings` runs the same function with
// no deadline.
//
// Schedule: `50 */12 * * *` (vercel.json), 45 minutes after the committees route's
// 00:05 and 12:05 runs (it runs every 6h at :05 since HO 756).
import { expireTag } from "@/lib/cache/expire-tag";
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import { GIVE_UP_AT, syncMeetings } from "@/lib/meetings-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const MEETINGS_BUDGET_MS = 50_000;

function authorize(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server" },
      { status: 500 },
    );
  }
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

async function handle(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  const result = await wrapCronRoute("/api/cron/committee-meetings", async () => {
    const routeStart = Date.now();
    const meetings = await syncMeetings({ deadlineMs: routeStart + MEETINGS_BUDGET_MS });

    console.log(
      `[meetings] stop=${meetings.stopReason} pages=house:${meetings.pages.house},senate:${meetings.pages.senate} list=house:${meetings.listSize.house}/${meetings.listCount.house},senate:${meetings.listSize.senate}/${meetings.listCount.senate} refreshed=${meetings.refreshed} unchanged=${meetings.unchanged} remaining=${meetings.remaining} failed=${meetings.failed.count}${meetings.failed.ids.length ? ` (${meetings.failed.ids.join(",")})` : ""} gaveUp=${meetings.gaveUp.count} absent=+${meetings.absent.stamped}/-${meetings.absent.cleared} documents_stored=${meetings.documentsStored} recorded_vote_docs=${meetings.recordedVoteDocs}`,
    );

    expireTag("meetings");

    // Chronic-err pattern (HO 139): non-fatal conditions surface in
    // cron_runs.error_message on success rows.
    const parts: string[] = [];
    if (meetings.failed.count > 0) {
      parts.push(`meeting detail failures: ${meetings.failed.count} (e.g. ${meetings.failed.ids.slice(0, 3).join(", ")})`);
    }
    if (meetings.gaveUp.count > 0) {
      parts.push(`meetings set aside after ${GIVE_UP_AT} failed details: ${meetings.gaveUp.count} (e.g. ${meetings.gaveUp.ids.slice(0, 3).join(", ")})`);
    }
    if (meetings.listErrors.length > 0) {
      parts.push(`meetings list read failed: ${meetings.listErrors.join("; ")}`);
    }
    if (meetings.absent.refused.length > 0) {
      parts.push(`absent stamp refused: ${meetings.absent.refused.join("; ")}`);
    }
    if (meetings.stopReason === "rate-limited") {
      parts.push("meetings walk ended on a 429");
    }
    // Review: a stop at the deadline with owed events left is visible here, not only in
    // the payload; the next run picks them up.
    if (meetings.stopReason === "deadline" && meetings.remaining > 0) {
      parts.push(`meetings walk stopped at the deadline with ${meetings.remaining} owed events not reached`);
    }
    const chronicErr = parts.length > 0 ? parts.join("; ") : undefined;

    return { payload: meetings, chronicErr };
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
