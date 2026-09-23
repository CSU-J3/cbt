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
// HO 744 — TWO LEGS UNDER THE CLOCK, AND A HUNG HOST LANDS AS `error`. The two
// scrapes run together under Promise.allSettled and the writes stay
// House-then-Senate (lib/race-ratings-sync.ts); every fetch, page and widget,
// both chambers, is capped at 8s (FETCH_TIMEOUT_MS, lib/race-ratings-scrape.ts).
// BUILT, not parked behind the 30,000 ms trigger this header used to carry,
// because the barrier and the cap are one change: allSettled alone lets one
// hung fetch hold BOTH chambers' writes to the soft timeout below, which
// records `timeout`, and /api/health counts `timeout` as alive — a green run
// with nothing written. With the cap the hang rejects its own scrape, the other
// chamber writes, and the run records `error`.
//
// THE BUDGET IS 55s, NOT THE 60 BELOW: wrapCronRoute races the handler against
// DEFAULT_SOFT_TIMEOUT_MS (lib/cron-log.ts). The FETCH term is structural: at
// most 2 × 8s per leg (a page answering just inside the cap, then a widget that
// never does), legs overlapped = 16s. The WRITE term is measured, not bounded:
// sequential Turso round trips, ~330 House (#19499) + ~75 on the Senate leg's
// first run = ~405, or ~627 in a week where every rating moved, plus the cron
// row's INSERT (inside the window; the reaper before it and the finish after it
// count against the 60 only). At ~13 ms a round trip, today's rate: 16 + 5.3 =
// 21s, and ~24s for an every-rating week. At ~74 ms, the worst rate measured
// on this region (#7557, 2026-08-05): this week's mix is 16 + 30 = 46s, 9s
// under 55, and an every-rating week is ~62s, which is the residual below and
// not a fetch. A 20s cap puts this week's mix at 70s on that rate; 10s at 50s.
//
// MEASURED, by path — `cron_runs.elapsed_ms`, House-only runs; the TWO-LEG
// total is UNMEASURED until the first run after the FF:
//   widget path, every run since 09-20: #18881 4,967 · #18897 4,301 ·
//     #19499 4,263 ms.
//   page path on pdx1, 06-24 → 09-02: 2,707-11,579 ms, and #7557 at 27,629.
//   page path on iad1, before the 06-11 region pin (5c549a1): #45 23,293 ·
//     #103 26,302 · #193 28,814 ms.
// The slow ones were DB round trips, not the fetch. The per-row loop is the
// same at every SHA; three runs whose loop did nothing put the fetch and parse
// at 187-437 ms (#325, #16049, #17773); and the step-downs sit at the region
// pin and after the 08-04/05 DB degradation (#7218 "Server database capacity
// temporarily exceeded"), not at any change to this code. So the overlap saves
// at most the shorter scrape; what the pair buys is the bound. (This header
// and fc72316 said "~5-7s" and "the network is the clock risk, parse and
// writes are milliseconds"; both are wrong on these numbers.)
//
// RESIDUAL, named: a run that crosses 55s for a NON-fetch reason — the writes
// under a degraded DB (an every-rating week at #7557's rate), or a stalled
// Turso request (lib/db.ts caps each at 10s and retries once) — still records
// `timeout`, and /api/health still counts that as alive. That is a cron-health
// question, not this route's; it is an OPEN LOOP in docs/backlog.md.
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
