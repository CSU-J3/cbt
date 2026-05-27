// Committees sync cron (handoff 143). Three operations per tick:
//
// 1. Committees list — full refresh from `/committee/119`. One paginated
//    pass, sub-second. Always runs.
// 2. Committee members — full refresh from unitedstates/congress-
//    legislators YAML. One HTTP fetch + parse + upsert per committee.
//    Always runs.
// 3. Committee bills — incremental against an update_date cursor in
//    `dashboard_state`. Walks 119th bills whose `bills.update_date` is
//    newer than the cursor and that carry committees.count > 0 in
//    raw_json; fetches `/bill/{congress}/{type}/{number}/committees` for
//    each and upserts. Time-budgeted: stops starting new bills at 45s
//    wall-clock, leaving 10s for finalize. Initial backfill of ~16K bills
//    happens via scripts/backfill-committee-bills.ts before the route is
//    expected to keep up incrementally.
//
// Schedule: 11:30 UTC daily (gap between sync-race-ratings at 11:00 Wed
// and primaries at 12:00). Doesn't collide with any existing cron.
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import {
  syncCommitteeBills,
  syncCommitteeMembers,
  syncCommitteesList,
} from "@/lib/committees-sync";
import { wrapCronRoute } from "@/lib/cron-log";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Stop starting new per-bill fetches once we cross this offset from
// route start. 55s wrapper soft timeout - 10s buffer for finalize = 45s
// deadline for the bills loop.
const BILLS_BUDGET_MS = 45_000;

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
      `[committees] bills: processed=${bills.billsProcessed} rows=${bills.rowsUpserted} cursor=${bills.cursorStart} → ${bills.cursorEnd} deadlineHit=${bills.deadlineHit} errors=${bills.fetchErrors}`,
    );

    revalidateTag("committees");

    const payload = {
      timings,
      list,
      members: {
        committeesSeen: members.committeesSeen,
        membersUpserted: members.membersUpserted,
        unknownCommittees: members.unknownCommittees,
      },
      bills,
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
