// Amendments sync cron (handoff 447). Runs the SAME syncAmendments() the local
// `npm run sync:amendments` CLI runs — here in incremental mode. There is NO
// stored cursor: syncAmendments derives its resume frontier straight from the DB
// (MAX(update_date) over amendments), so the tick just fetches everything updated
// past that frontier. The full historical backfill is a manual/local run (~6,800
// paced requests, ~17 min); after it, each tick faces only the incremental delta.
//
// Deadline backstop: if a delta can't fully drain inside the budget, the tick
// stops cleanly at the current DB frontier and the NEXT tick re-derives that
// frontier and continues — no gap, no cursor to advance (upserts are idempotent).
//
// SYNC ONLY — no rollup/precompute step. The LDA cron precomputes its /lobbying
// blob because request-time aggregation is non-viable at 10⁵; amendments are
// bills-scale (~6,800), so whether the surface needs precompute is a cold-latency
// question for the surface handoff, not assumed here. One revalidateTag on the
// tag the future surface will read.
//
// Schedule: 07:00 UTC daily — clear of the 06:00 sync and the 08:00 lda cron.
// Auth mirrors the other cron routes (Bearer CRON_SECRET).
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import { syncAmendments } from "@/lib/amendments-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Stop starting new pages at 280s, leaving ~20s for the final flush + cron-log
// writes under the 300s ceiling. Layering mirrors the LDA route:
// AMENDMENTS_BUDGET_MS 280s < soft timeout 290s < 300s.
const AMENDMENTS_BUDGET_MS = 280_000;

function authorize(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured on the server" }, { status: 500 });
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
    "/api/cron/amendments",
    async () => {
      const routeStart = Date.now();
      const r = await syncAmendments({ deadlineMs: routeStart + AMENDMENTS_BUDGET_MS });
      console.log(
        `[amendments] mode=${r.mode} upserted=${r.upserted} listPages=${r.listPages} ` +
          `detailErrors=${r.detailErrors} throttled429=${r.throttled429} deadlineHit=${r.deadlineHit} ` +
          `frontier=${r.frontier} apiTotal=${r.apiTotal}`,
      );

      revalidateTag("amendments");

      // Chronic-err pattern (HO 139): non-fatal conditions surface in
      // cron_runs.error_message on success rows.
      const parts: string[] = [];
      if (r.detailErrors > 0) parts.push(`amendments detail errors: ${r.detailErrors}`);
      if (r.deadlineHit) parts.push(`deadline hit (resumes from DB frontier next run)`);
      const chronicErr = parts.length > 0 ? parts.join("; ") : undefined;
      return { payload: r, chronicErr };
    },
    { softTimeoutMs: 290_000 },
  );

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
