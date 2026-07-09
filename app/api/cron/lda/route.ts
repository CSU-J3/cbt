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
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import { syncLda } from "@/lib/lda-sync";
import {
  computeLdaRollup,
  uncappedLdaClient,
  writeLdaRollup,
} from "@/lib/lda-rollup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Stop starting new pages at 280s, leaving ~20s for the final upsert + cron-log
// writes under the 300s ceiling.
const LDA_BUDGET_MS = 280_000;

// HO 437 — the /lobbying rollup precompute runs AFTER the sync, with an UNCAPPED
// client (the aggregate is 30-90s+ cold — see lib/lda-rollup.ts). Only run it
// when enough of the 300s ceiling remains: on a quarterly-burst day the sync eats
// the budget, so the rollup is skipped and the blob stays a day stale (accepted).
// Most days the sync sits at the DB frontier in seconds and the full budget is
// free. The blob write is a single atomic upsert at the very end, so even a 300s
// SIGKILL mid-compute leaves the prior blob intact (never a half-written rollup).
const ROUTE_CEILING_MS = 300_000;
const ROLLUP_RESERVE_MS = 220_000; // don't START the rollup with less than this left

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

      // HO 437 — recompute the /lobbying rollup blob (non-fatal; a failure here
      // never fails the sync). Budget-gated so it can't push past the 300s wall.
      let rollup: { ran: boolean; ok?: boolean; ms?: number } = { ran: false };
      const msLeft = ROUTE_CEILING_MS - (Date.now() - routeStart);
      if (msLeft >= ROLLUP_RESERVE_MS) {
        const t0 = Date.now();
        try {
          const client = uncappedLdaClient();
          const blob = await computeLdaRollup(client, new Date().toISOString());
          await writeLdaRollup(client, blob);
          client.close();
          revalidateTag("lda");
          rollup = { ran: true, ok: true, ms: Date.now() - t0 };
          console.log(
            `[lda] rollup ok in ${rollup.ms}ms: ${blob.issues.length} issues, ` +
              `${Object.keys(blob.drill).length} drills`,
          );
        } catch (e) {
          rollup = { ran: true, ok: false, ms: Date.now() - t0 };
          console.error(`[lda] rollup failed after ${rollup.ms}ms: ${(e as Error).message}`);
        }
      } else {
        console.log(`[lda] rollup skipped (only ${msLeft}ms left, need ${ROLLUP_RESERVE_MS})`);
      }

      // Chronic-err pattern (HO 139): non-fatal conditions surface in
      // cron_runs.error_message on success rows.
      const parts: string[] = [];
      if (r.fetchErrors > 0) parts.push(`lda fetch errors: ${r.fetchErrors}`);
      if (r.deadlineHit) parts.push(`deadline hit (resumes from DB frontier next run)`);
      if (rollup.ran && !rollup.ok) parts.push(`lda rollup failed`);
      const chronicErr = parts.length > 0 ? parts.join("; ") : undefined;
      return { payload: { ...r, rollup }, chronicErr };
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
