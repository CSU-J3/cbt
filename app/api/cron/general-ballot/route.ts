// General-ballot reader cron (HO 749). Runs the SAME runGeneralBallot() the
// local `npm run sync:general-ballot` CLI runs, here in write mode through
// generalBallotTick(), which is the one caller that passes it. The module is
// read-only by default precisely so that this is a deliberate line rather than
// a default.
//
// WHAT IT WRITES: `general_ballot` and `general_ballot_reads` (scripts/
// migrate.ts), and nothing else. WHO READS THEM (HO 750): the challenger
// harvest publishes rosters from them on its own cron, and the race page's stub
// reads them through the `general-ballot` cache tag, which generalBallotTick
// expires once per tick that wrote a READ. It does not expire `races`.
//
// WHY ITS OWN ROUTE AND THIS CADENCE: every request goes to Ballotpedia, whose
// wall HO 747 measured (a 202 challenge at request #43 at one request a second;
// 387 of 387 read at six seconds start to start). `20 */2 * * *` is 12 ticks a
// day of at most 40 races, one full pass of the 470 2026 races a day at about
// 470 requests, and clear of /api/cron/primaries, which also reads Ballotpedia,
// at :00. The bounds and the pacing live in lib/general-ballot.ts beside the
// measurement that set them.
//
// Auth mirrors the other cron routes (Bearer CRON_SECRET).
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { generalBallotTick } from "@/lib/general-ballot";
import { wrapCronRoute } from "@/lib/cron-log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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

  // The 240s budget and the 40-race cap are applied inside generalBallotTick
  // (TICK_BUDGET_MS, TICK_CAP). 290s is 5s under the 300s ceiling, so the
  // wrapper finalizes the cron_runs row cleanly before Vercel's SIGKILL.
  const result = await wrapCronRoute(
    "/api/cron/general-ballot",
    () => generalBallotTick(getDb()),
    { softTimeoutMs: 290_000 },
  );

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
