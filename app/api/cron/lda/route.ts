// LDA lobbying sync cron (handoff 435). Runs the SAME syncLda() the local
// `npm run sync:lda` CLI runs — here in incremental mode. There is NO stored
// cursor: syncLda derives its resume frontier straight from the DB (MAX(dt_posted)
// per filing_year/filing_type), so the tick just fetches everything posted past
// that frontier. The full historical backfill is a manual/local run (thousands of
// paced requests); after it, each tick faces only the incremental delta.
//
// Deadline backstop: if a delta can't fully drain inside the budget, the tick
// stops cleanly at the current DB frontier and the NEXT tick re-derives that
// frontier and continues — no gap, no cursor to advance (upserts are idempotent).
//
// Sizing (HO 435): maxDuration 300 (Fluid) + DAILY cadence. A weekly-60s tick
// (~875 filings) diverges on a quarterly filing burst (~21k landing near a
// deadline, ~1.5k/day peak); daily-300s (~4k/tick, ~4k/day headroom) absorbs the
// burst in a couple ticks and otherwise sits idle at the frontier. The historical
// backfill keeps the frontier current, so the cron only ever sees the delta.
//
// Schedule: 08:00 UTC daily — clear of every existing slot (weekly-report 09:30
// Mon, sync 00/06/12/18, the daily 10/11/12/13/14/15 crons, markets 21:30). Auth
// mirrors the other cron routes (Bearer CRON_SECRET).
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import { syncLda } from "@/lib/lda-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Stop starting new pages at 280s, leaving ~20s for the final upsert + cron-log
// writes under the 300s ceiling.
const LDA_BUDGET_MS = 280_000;

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

  // softTimeoutMs raised to 290s (5s under the 300s ceiling) so the wrapper's
  // default 55s race doesn't kill the handler before it can use the Fluid budget.
  // Layering: LDA_BUDGET_MS 280s (stop starting pages) < soft timeout 290s < 300s.
  const result = await wrapCronRoute(
    "/api/cron/lda",
    async () => {
      const routeStart = Date.now();
      const r = await syncLda({ deadlineMs: routeStart + LDA_BUDGET_MS });
      console.log(
        `[lda] mode=${r.mode} filings=${r.filingsUpserted} activities=${r.activitiesUpserted} ` +
          `billLinks=${r.billLinksUpserted} pages=${r.pagesFetched} errors=${r.fetchErrors} ` +
          `throttled429=${r.throttled429} deadlineHit=${r.deadlineHit}`,
      );
      // Chronic-err pattern (HO 139): non-fatal conditions surface in
      // cron_runs.error_message on success rows.
      const parts: string[] = [];
      if (r.fetchErrors > 0) parts.push(`lda fetch errors: ${r.fetchErrors}`);
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
