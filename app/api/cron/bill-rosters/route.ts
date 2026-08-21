// Bill-roster refresh cron (HO 676). Runs the SAME refreshBillRosters() the
// local `npm run refresh:bill-rosters` CLI runs — here in write mode, which is
// the ONE caller that passes it. The module is read-only by default precisely so
// that this is a deliberate line rather than a default.
//
// WHY ITS OWN ROUTE, not a step inside /api/sync: this is fetch-heavy (~2
// Congress.gov requests per bill, ~1.4s per bill measured) and /api/sync has hit
// 53s of its 60s ceiling (SKILL, HO 135 watch). Adding it there is the exact
// starvation the four earlier cron splits exist to prevent.
//
// WHAT IT EXISTS FOR: HO 674 ingested `bill_cosponsors` / `bill_related_bills`
// and HO 675 surfaced them, but neither shipped a refresh — the backfill script
// was the only writer and no cron called it, so every bill /api/sync ingested
// arrived with an empty roster and kept it. The triggers and the measurements
// behind them are in lib/bill-rosters-refresh.ts.
//
// Auth mirrors the other cron routes (Bearer CRON_SECRET).
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { refreshBillRosters } from "@/lib/bill-rosters-refresh";
import { wrapCronRoute } from "@/lib/cron-log";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// The budget, priced against MEASURED throughput rather than the 20,000/hr
// ceiling — HO 674 predicted 1.5h from the ceiling and took 4h, because the
// binding constraint is per-request latency. Measured on a representative
// 20-bill sample: 1,437ms per bill for both fetches plus pacing (~5,010
// requests/hr), against the backfill's realised ~6,100/hr.
//
// 120 bills x ~1.4s = ~172s, inside the 240s carve; the DEADLINE is the real
// bound and the cap is the backstop, since api.congress.gov is intermittently
// slow (a 10.3s outlier in the same sample).
//
// At 8 ticks/day (`40 */3`) that is 960 bills/day and ~1,940 requests/day — ~81
// requests/hr averaged, ~2,500/hr instantaneous inside a tick. The full 17,728-
// bill corpus recycles in ~18.5 days.
const REFRESH_BUDGET_MS = 240_000;
const TICK_CAP = 120;

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

  const result = await wrapCronRoute(
    "/api/cron/bill-rosters",
    async () => {
      const routeStart = Date.now();
      // `write: true` — the one call site that mutates. Everything else that
      // invokes this module (the CLI's default, `--check`) does not.
      const r = await refreshBillRosters({
        write: true,
        cap: TICK_CAP,
        deadlineMs: routeStart + REFRESH_BUDGET_MS,
      });

      console.log(
        `[bill-rosters] selected=${r.selected} ` +
          `(never=${r.byTrigger["never-checked"]} countAhead=${r.byTrigger["count-ahead"]} sweep=${r.byTrigger.sweep}) ` +
          `fetched=${r.fetched} requests=${r.requests} changed=${r.changedBills} ` +
          `cosW=${r.cosponsorRowsWritten} cosD=${r.cosponsorRowsDeleted} ` +
          `relW=${r.relatedRowsWritten} relD=${r.relatedRowsDeleted} ` +
          `countsW=${r.countsWritten} ` +
          `stamped=${r.stamped} deferred=${r.deferred} deadlineHit=${r.deadlineHit}`,
      );

      // GUARDED ON `changedBills`, NOT ON ROWS WRITTEN (HO 671). `INSERT OR
      // REPLACE` rewrites every row of an UNCHANGED roster, so a row count is
      // non-zero on essentially every tick and this flush would become the cost
      // multiplier that HO 671 removed from summarize — where 296 of 300 ticks
      // flushed having written nothing. `changedBills` is incremented inside the
      // same branch that performs the write, and that branch is selected by the
      // diff being non-empty, so it cannot be truthy while nothing was written.
      if (r.changedBills > 0) revalidateTag("bill-rosters");
      // NOTE (HO 677): `countsWritten` deliberately does NOT flush `bills`.
      // The corrected column reaches the panel through the feed row payload,
      // which is `bills`-tagged, so a correction surfaces on the next `bills`
      // flush (~7.3/day, mean gap ~3.3h) rather than immediately. Flushing here
      // would add up to 8 scheduled flushes/day at ~89,090 rows each for a
      // handful of bills — the HO 671 multiplier, re-created. The reasoning
      // lives at the write site in lib/bill-rosters-refresh.ts.

      // Non-fatal, surfaced rather than swallowed: a deferred bill keeps its old
      // watermark and retries next tick, and an empty-payload skip is a delete
      // this run declined to make (HO 564).
      const chronic: string[] = [];
      if (r.deferred > 0) {
        chronic.push(`bill-rosters deferred ${r.deferred}: ${r.errors.slice(0, 5).join("; ")}`);
      }
      if (r.emptyPayloadSkips.length > 0) {
        chronic.push(
          `bill-rosters empty-payload skips ${r.emptyPayloadSkips.length}: ` +
            r.emptyPayloadSkips.slice(0, 5).join(","),
        );
      }

      return {
        payload: { ...r, flushed: r.changedBills > 0 },
        chronicErr: chronic.length ? chronic.join(" | ") : undefined,
      };
    },
    // 290s, 5s under the 300s ceiling, so the wrapper finalizes the cron_runs
    // row cleanly before Vercel's SIGKILL (the lda / amendments shape).
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
