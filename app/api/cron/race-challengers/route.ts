// HO 660: the challenger harvest gets a clock. Daily Vercel cron at
// `30 12 * * *` — thirty minutes after the 12:00 UTC `/api/cron/primaries`
// tick, whose writes are this harvest's ENTIRE input. US primary results post in
// the 00:00–06:00 UTC band, so the 12:00 tick is the one that reads them
// settled and 12:30 harvests what it just wrote. A winner marked by the 00:00
// tick waits at most 12.5h; that is the stated price of keeping this at ONE
// daily fire instead of quietly over-provisioning it to two.
//
// No cron-lock, as a decision rather than an oversight: the primaries tick is
// deadline-bounded at 50s inside a 60s ceiling so it is done by ~12:01, and
// nothing else writes `race_candidates` on a schedule (the seed is manual).
//
// Pure DB-to-DB (no Ballotpedia fetch), idempotent under its sentinel — which
// is why HO 656 could price it as its own slot rather than as work chained onto
// the primaries cursor's budget. revalidateTag("races") fires UNCONDITIONALLY:
// every run clears and re-derives, so every run is a write, and gating the
// flush on `inserted > 0` would serve a stale roster after a run that legitimately
// re-derived the same rows.
import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { wrapCronRoute } from "@/lib/cron-log";
import { getDb } from "@/lib/db";
import { harvestChallengers } from "@/lib/harvest-challengers";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

  const result = await wrapCronRoute("/api/cron/race-challengers", async () => {
    const summary = await harvestChallengers(getDb());
    revalidateTag("races");
    console.log(
      `[race-challengers] cleared=${summary.cleared} inserted=${summary.inserted} ` +
        `rows=${summary.rows} races=${summary.races} of ${summary.ratedIndex} rated ` +
        `stamp=${summary.runStamp}`,
    );
    return { payload: summary };
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
