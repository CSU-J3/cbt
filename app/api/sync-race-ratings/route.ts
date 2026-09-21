// Race-ratings sync cron entry (handoff 88). Scrapes 2026 House AND Senate
// Cook / Inside Elections / Sabato ratings from Ballotpedia weekly (HO 744;
// House-only before that). Separate route + cron because the cadence is
// weekly (Sabato updates mid-week) while /api/sync is daily, and the work is
// unrelated to the bill pipeline.
//
// Auth mirrors /api/sync and /api/sync-votes exactly: Bearer CRON_SECRET.
// expireTag("race-ratings") flushes the cached race query helpers so
// the /races page picks up rating moves without waiting on the backstop.
//
// HO 744 — ORDERING UNDER THE 60s CLOCK. The two legs run sequentially, House
// first (`CHAMBERS` in lib/race-ratings-sync.ts). The asymmetry is real and
// dormant: runs of this route have been ~5-7s against the 60s ceiling below
// (House-only runs — read off `cron_runs.elapsed_ms` for this route), so
// neither leg is near starving. The order is deliberate, not incidental —
// House is the larger chamber and the deploy-visible index, so if one leg ever
// has to starve under a slow widget host, the 35-row Senate leg is the one to
// lose. TRIGGER: if `cron_runs.elapsed_ms` for this route ever exceeds 30,000,
// the remedy is `Promise.allSettled` over the two SCRAPES — the network is the
// clock risk, parse and writes are milliseconds — with the writes kept
// House-then-Senate. Not built now.
//
// HO 139: migrated to wrapCronRoute.
import { expireTag } from "@/lib/cache/expire-tag";
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import { runRaceRatingsSync } from "@/lib/race-ratings-sync";

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

  const result = await wrapCronRoute("/api/sync-race-ratings", async () => {
    // HO 744: both chambers, each leg's outcome carried into the payload. The
    // sync throws if either leg failed — after both have run — so a recorded
    // `error` here still means the surviving chamber's writes landed, and the
    // message names which chamber failed and what the other one did.
    const chambers = await runRaceRatingsSync();
    // race-ratings tag is separate from races/bills — the rating seed and
    // now this scrape refresh on their own cadence. One tag, both chambers.
    expireTag("race-ratings");
    return { payload: { chambers } };
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

// Vercel Cron sends GET; support both.
export async function GET(request: Request) {
  return handle(request);
}
