// Primary-candidates cron entry (handoff 97). The full primary-tracker corpus
// is ~470 scrape units (1 calendar + 34 Senate + 435 House); at ~1.5-2s per
// district the Ballotpedia politeness sleep alone puts any whole region well
// past the 60s Vercel Hobby function ceiling (West measured 153s). So this
// route does NOT scrape a region per tick — runPrimariesCronTick walks a
// persistent cursor (stored in dashboard_state), refreshing the Senate in one
// tick and CRON_HOUSE_SLICE House districts per tick, cycling the whole
// corpus every ~3 weeks. See lib/primaries-sync.ts.
//
// Auth mirrors /api/sync, /api/sync-votes, /api/sync-race-ratings exactly:
// Bearer CRON_SECRET. The cron runs twice daily (`0 0,12`, vercel.json); the day-of-week dispatch the
// handoff sketched is unused — a 7-slot dispatch can't address the ~23 ticks
// the 60s ceiling forces, so the cursor does the slicing instead.
//
// HO 139: migrated to wrapCronRoute; inline reaper sweeps stale rows from
// prior SIGKILLs (5-22 / 5-23 ticks both got reaped during this handoff).
//
// HO 778: `?state=XX` reads that state's House districts live, now, and nothing
// else (runPrimariesStateTarget): no cursor, no priority pass, no calendar. A
// state outside the House list, or with more than CRON_HOUSE_SLICE districts,
// is refused with 400 before any run row. Its row logs under
// `/api/cron/primaries?state=XX`, so the watchdog's `/api/cron/primaries`
// (lib/cron-health.ts, an exact route match) reads only the scheduled tick.
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import { resolveHouseTarget, runPrimariesCronTick, runPrimariesStateTarget } from "@/lib/primaries-sync";

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

  const state = new URL(request.url).searchParams.get("state");
  if (state !== null) {
    const target = resolveHouseTarget(state);
    if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 });
    const targeted = await wrapCronRoute(`/api/cron/primaries?state=${target.state}`, async () => {
      const t0 = Date.now();
      const r = await runPrimariesStateTarget(target, t0);
      console.log(
        `[cron-primaries] unit=house-target state=${r.state} ` +
          `attempted=${r.house.attempted} parsedOk=${r.house.parsedOk} ` +
          `elapsedMs=${Date.now() - t0}`,
      );
      return { payload: r };
    });
    return NextResponse.json(targeted.body, { status: targeted.httpStatus });
  }

  const result = await wrapCronRoute("/api/cron/primaries", async () => {
    const t0 = Date.now();
    // HO 120: pass the route start so the 50s wall-clock deadline reflects
    // the function's full lifetime. Combined with per-unit cursor commit
    // inside runPrimariesCronTick, a tick that budget-stops mid-slice keeps
    // the units it did finish.
    const tickResult = await runPrimariesCronTick(t0);
    const elapsedMs = Date.now() - t0;

    // elapsedMs is the budget gauge — if it trends toward 60000, lower
    // CRON_HOUSE_SLICE in lib/primaries-sync.ts.
    console.log(
      `[cron-primaries] unit=${tickResult.unit} ` +
        `cursor=${tickResult.cursorStart}->${tickResult.cursorEnd}/${tickResult.totalUnits} ` +
        `elapsedMs=${elapsedMs}`,
    );

    return { payload: tickResult };
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

// Vercel Cron sends GET; support both so the same path works in production
// and from manual curl.
export async function GET(request: Request) {
  return handle(request);
}
