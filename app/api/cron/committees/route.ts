// Committees sync cron (handoff 143). Three operations per tick; since HO 756 the list
// and members steps each run in their own `try`: a failed step is named in `chronicErr`
// and the walk still runs, and the tick records `success` whenever the walk did its job.
// Before HO 756 an 8s abort in a step before the walk errored the whole tick with no bill
// walked: 18 of 60 ticks in the 30 days to 2026-09-29, 15 of them on the 12:00Z tick, and
// by their 8.03-8.81s elapsed the committees list fetch for nearly all (the rows do not
// name the step). The walk records `error` when it met an outage or a rejected key
// (`bills.outage` / `bills.authFailed`), and in that case charges no bill.
//
// 1. Committees list — full refresh from `/committee/{N}`, N derived (HO 712).
//    One paginated pass, sub-second.
// 2. Committee members — full refresh from unitedstates/congress-
//    legislators YAML. One HTTP fetch + parse + upsert per committee.
// 3. Committee bills — keyed per bill (HO 753): walks the 119th bills that
//    carry committees.count > 0 and were never walked or changed since their
//    last walk (`committees_walked_at` against `changed_at`), fetching every
//    page of `/bill/{congress}/{type}/{number}/committees`. A bill is stamped
//    only when its rows land; a failed fetch leaves it selected, and five
//    running set it aside, named in the payload's `gaveUp`. Time-budgeted: stops
//    starting new bills 240s after the route starts, and a fetch in flight then is
//    cut 3s later (HO 756). The fill of every never-walked bill is
//    `npm run repair:committee-bills`.
//
// The committee-meetings step HO 263 folded in after the bills step moved to
// its own route, /api/cron/committee-meetings (HO 754).
//
// Schedule: every 6h at :05 (`5 */6 * * *`, vercel.json), since HO 756, a minute no
// other cron uses and five minutes after /api/sync, whose writes the walk follows.
// Until HO 756 it ran `0 */12`, in the :00 minute it shared with /api/sync,
// primaries, the bare markets, summarize and news, where a bill took a median 0.63s
// (max 4.23s, over the 38 success ticks with a walk count) against 0.34s off-peak. (The
// daily 11:30 UTC slot this header named before HO 753 was stale.)
import { expireTag } from "@/lib/cache/expire-tag";
import { NextResponse } from "next/server";
import {
  GIVE_UP_AT,
  syncCommitteeBills,
  syncCommitteeMembers,
  syncCommitteesList,
} from "@/lib/committees-sync";
import { wrapCronRoute } from "@/lib/cron-log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// HO 756: stop starting new per-bill fetches 240s after route start. A fetch in
// flight then is cut 3s later (lib/committees-sync.ts), so the step ends by about
// 243s. Layering: 240s budget (+3s cap) < 290s soft timeout < 300s maxDuration.
const BILLS_BUDGET_MS = 240_000;
const SOFT_TIMEOUT_MS = 290_000;

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
    // HO 756: each step fails alone. A list or members failure is named in
    // chronicErr and the walk still runs; the walk is the tick's job, so its own
    // failure still throws and records `error`.
    const steps: Record<"list" | "members" | "bills", "ran" | "failed"> = { list: "failed", members: "failed", bills: "failed" };
    const stepErrors: string[] = [];
    const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

    const t1 = Date.now();
    let list: Awaited<ReturnType<typeof syncCommitteesList>> | null = null;
    try {
      list = await syncCommitteesList();
      steps.list = "ran";
    } catch (err) {
      stepErrors.push(`committees list step failed: ${message(err)}`);
      console.warn("[committees] list step failed (non-fatal):", message(err));
    }
    timings.list = Date.now() - t1;

    const t2 = Date.now();
    let members: Awaited<ReturnType<typeof syncCommitteeMembers>> | null = null;
    try {
      members = await syncCommitteeMembers();
      steps.members = "ran";
    } catch (err) {
      stepErrors.push(`committee members step failed: ${message(err)}`);
      console.warn("[committees] members step failed (non-fatal):", message(err));
    }
    timings.members = Date.now() - t2;

    const t3 = Date.now();
    const bills = await syncCommitteeBills({
      deadlineMs: routeStart + BILLS_BUDGET_MS,
    });
    timings.bills = Date.now() - t3;
    // HO 756 (review): with the list step failing alone, an outage or a rejected key no
    // longer stops the tick before the walk. The walk then charges nothing, and the tick
    // must still read as an error, or /api/health would stay green through it.
    if (bills.authFailed || bills.outage) {
      throw new Error(
        `committees walk stopped, nothing charged: ${bills.authFailed ? "the key was rejected or missing" : `${bills.fetchErrors} bill fetches failed and none walked (an outage)`}${stepErrors.length ? `; ${stepErrors.join("; ")}` : ""}`,
      );
    }
    steps.bills = "ran";

    if (list) {
      console.log(
        `[committees] list: pages=${list.pages} upserted=${list.upserted}`,
      );
    }
    if (members) {
      console.log(
        `[committees] members: committees=${members.committeesSeen} upserted=${members.membersUpserted} mapped=${members.mappedCommittees.length} notInCommittees=${members.unknownCommittees.length}`,
      );
      if (members.unknownCommittees.length > 0) {
        console.warn(
          `[committees] membership YAML codes not in committees (Congress.gov's list as last stored): ${members.unknownCommittees.slice(0, 10).join(", ")}${members.unknownCommittees.length > 10 ? " ..." : ""}`,
        );
      }
    }
    console.log(
      `[committees] bills: processed=${bills.billsProcessed} walked=${bills.billsWalked} rows=${bills.rowsUpserted} remaining=${bills.remaining} failed=${bills.failed.count}${bills.failed.ids.length ? ` (${bills.failed.ids.join(",")})` : ""} gaveUp=${bills.gaveUp.count} deadlineHit=${bills.deadlineHit} capHit=${bills.capHit} rateLimited=${bills.rateLimited}`,
    );

    expireTag("committees");

    const payload = {
      steps, // HO 756: which of the three steps ran
      timings,
      list,
      members: members
        ? {
            committeesSeen: members.committeesSeen,
            membersUpserted: members.membersUpserted,
            unknownCommittees: members.unknownCommittees,
            mappedCommittees: members.mappedCommittees, // HO 766 — HS… select bodies mapped to hl…
            rosterDeletesRefused: members.rosterDeletesRefused, // HO 568 — surface into cron_runs.payload
          }
        : null,
      bills,
    };

    // Chronic-err pattern (HO 139): non-fatal conditions surface in
    // cron_runs.error_message on success rows. A failed step comes first.
    const parts: string[] = [...stepErrors];
    if (members && members.unknownCommittees.length > 0) {
      parts.push(
        // HO 766: after the HS→hl select-body retry, what is left is not in
        // `committees`, Congress.gov's list as the list step last stored it (an
        // upsert, never a delete; a failed list step is named first, above).
        `membership YAML codes not in committees (Congress.gov's list as last stored): ${members.unknownCommittees.length} (${members.unknownCommittees.slice(0, 3).join(", ")}${members.unknownCommittees.length > 3 ? ", …" : ""})`,
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
    const chronicErr = parts.length > 0 ? parts.join("; ") : undefined;

    return { payload, chronicErr };
  }, { softTimeoutMs: SOFT_TIMEOUT_MS });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
