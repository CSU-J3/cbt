// Committees sync cron (handoff 143). Three operations per tick:
//
// 1. Committees list — full refresh from `/committee/{N}`, N derived (HO 712).
//    One paginated pass, sub-second. Always runs.
// 2. Committee members — full refresh from unitedstates/congress-
//    legislators YAML. One HTTP fetch + parse + upsert per committee.
//    Always runs.
// 3. Committee bills — keyed per bill (HO 753): walks the 119th bills that
//    carry committees.count > 0 and were never walked or changed since their
//    last walk (`committees_walked_at` against `changed_at`), fetching every
//    page of `/bill/{congress}/{type}/{number}/committees`. A bill is stamped
//    only when its rows land; a failed fetch leaves it selected, and five
//    running set it aside, named in the payload's `gaveUp`. Time-budgeted: stops
//    starting new bills at 45s wall-clock, leaving 10s for finalize. The fill
//    of every never-walked bill is `npm run repair:committee-bills`.
//
// Schedule: every 12h (`0 */12`, vercel.json). The "11:30 UTC daily" this
// header used to give was stale (HO 753).
import { expireTag } from "@/lib/cache/expire-tag";
import { NextResponse } from "next/server";
import {
  GIVE_UP_AT,
  syncCommitteeBills,
  syncCommitteeMembers,
  syncCommitteesList,
} from "@/lib/committees-sync";
import { wrapCronRoute } from "@/lib/cron-log";
import { syncMeetings } from "@/lib/meetings-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Stop starting new per-bill fetches once we cross this offset from
// route start. 55s wrapper soft timeout - 10s buffer for finalize = 45s
// deadline for the bills loop.
const BILLS_BUDGET_MS = 45_000;
// HO 263: the meetings step rides this cron AFTER the committee sync. Its own
// deadline (50s of the function's lifetime) so it can't push the route toward
// the 60s ceiling; the heavy ~2,400-call backfill is manual (npm run
// sync:meetings), so the daily delta here is a handful of events.
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

  const result = await wrapCronRoute("/api/cron/committees", async () => {
    const routeStart = Date.now();
    const timings: Record<string, number> = {};

    const t1 = Date.now();
    const list = await syncCommitteesList();
    timings.list = Date.now() - t1;

    const t2 = Date.now();
    const members = await syncCommitteeMembers();
    timings.members = Date.now() - t2;

    const t3 = Date.now();
    const bills = await syncCommitteeBills({
      deadlineMs: routeStart + BILLS_BUDGET_MS,
    });
    timings.bills = Date.now() - t3;

    // HO 263: committee meetings (hearings) daily delta. Non-fatal — a meetings
    // error is logged and never fails the committees run. Deadline-guarded and
    // capped so it can't blow the budget (the backfill is manual, not here).
    const t4 = Date.now();
    let meetings: Awaited<ReturnType<typeof syncMeetings>> | null = null;
    let meetingsErr: string | undefined;
    try {
      meetings = await syncMeetings({
        deadlineMs: routeStart + MEETINGS_BUDGET_MS,
        perTickLimit: 300,
      });
    } catch (err) {
      meetingsErr = err instanceof Error ? err.message : String(err);
      console.warn("[committees] meetings step failed (non-fatal):", meetingsErr);
    }
    timings.meetings = Date.now() - t4;
    if (meetings) {
      console.log(
        `[meetings] upserted=${meetings.meetingsUpserted} billRows=${meetings.billRowsUpserted} documents_stored=${meetings.documentsStored} recorded_vote_docs=${meetings.recordedVoteDocs} errors=${meetings.fetchErrors} deadlineHit=${meetings.deadlineHit}`,
      );
    }

    console.log(
      `[committees] list: pages=${list.pages} upserted=${list.upserted}`,
    );
    console.log(
      `[committees] members: committees=${members.committeesSeen} upserted=${members.membersUpserted} unknownCodes=${members.unknownCommittees.length}`,
    );
    if (members.unknownCommittees.length > 0) {
      console.warn(
        `[committees] unknown committee codes from membership YAML: ${members.unknownCommittees.slice(0, 10).join(", ")}${members.unknownCommittees.length > 10 ? " ..." : ""}`,
      );
    }
    console.log(
      `[committees] bills: processed=${bills.billsProcessed} walked=${bills.billsWalked} rows=${bills.rowsUpserted} remaining=${bills.remaining} failed=${bills.failed.count}${bills.failed.ids.length ? ` (${bills.failed.ids.join(",")})` : ""} gaveUp=${bills.gaveUp.count} deadlineHit=${bills.deadlineHit} capHit=${bills.capHit} rateLimited=${bills.rateLimited}`,
    );

    expireTag("committees");
    expireTag("meetings"); // HO 263

    const payload = {
      timings,
      list,
      members: {
        committeesSeen: members.committeesSeen,
        membersUpserted: members.membersUpserted,
        unknownCommittees: members.unknownCommittees,
        rosterDeletesRefused: members.rosterDeletesRefused, // HO 568 — surface into cron_runs.payload
      },
      bills,
      meetings,
    };

    // Chronic-err pattern (HO 139): non-fatal conditions surface in
    // cron_runs.error_message on success rows.
    const parts: string[] = [];
    if (members.unknownCommittees.length > 0) {
      parts.push(
        `unknown committee codes: ${members.unknownCommittees.length} (e.g. ${members.unknownCommittees.slice(0, 3).join(", ")})`,
      );
    }
    if (bills.fetchErrors > 0) {
      parts.push(`bill committee fetch errors: ${bills.fetchErrors}`);
    }
    // HO 753: a bill set aside after GIVE_UP_AT failed walks is visible here, not silent.
    if (bills.gaveUp.count > 0) {
      parts.push(`bills set aside after ${GIVE_UP_AT} failed walks: ${bills.gaveUp.count} (e.g. ${bills.gaveUp.ids.slice(0, 3).join(", ")})`);
    }
    if (bills.rateLimited) {
      parts.push("bill committee walk ended on a 429");
    }
    if (meetingsErr) {
      parts.push(`meetings step error: ${meetingsErr}`);
    } else if (meetings && meetings.fetchErrors > 0) {
      parts.push(`meeting detail fetch errors: ${meetings.fetchErrors}`);
    }
    const chronicErr = parts.length > 0 ? parts.join("; ") : undefined;

    return { payload, chronicErr };
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
