// Nominations sync cron (handoff 455). Runs the SAME syncNominations() the local
// `npm run sync:nominations` CLI runs — here in incremental mode off the DB
// frontier. LIST-ONLY (HO 454): no per-PN detail fetch, so a tick is ~8 list
// pages of upserts — fast, a 60s function is ample (unlike the amendments 300s
// route, which pays a per-amendment detail fetch). The full historical backfill
// is a manual/local run; the cron only ever faces the incremental delta.
//
// Deadline backstop: if a delta can't fully drain inside the budget, the tick
// stops cleanly at the current DB frontier and the NEXT tick re-derives that
// frontier and continues — no gap, no cursor (upserts are idempotent).
//
// Auth mirrors the other cron routes (Bearer CRON_SECRET).
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import { syncNominations } from "@/lib/nominations-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Stop starting new pages at 50s, leaving ~10s for the final flush + cron-log
// writes under the 60s ceiling. Layering mirrors the amendments route:
// NOMINATIONS_BUDGET_MS 50s < soft timeout 55s < 60s.
const NOMINATIONS_BUDGET_MS = 50_000;

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
    "/api/cron/nominations",
    async () => {
      const routeStart = Date.now();
      const r = await syncNominations({ deadlineMs: routeStart + NOMINATIONS_BUDGET_MS });
      console.log(
        `[nominations] mode=${r.mode} upserted=${r.upserted} listPages=${r.listPages} ` +
          `throttled429=${r.throttled429} deadlineHit=${r.deadlineHit} ` +
          `dispositionResidual=${r.dispositionResidual} frontier=${r.frontier} apiTotal=${r.apiTotal}`,
      );

      revalidateTag("nominations");

      // Chronic-err pattern (HO 139): non-fatal conditions surface in
      // cron_runs.error_message on success rows.
      const parts: string[] = [];
      if (r.deadlineHit) parts.push(`deadline hit (resumes from DB frontier next run)`);
      if (r.dispositionResidual > 0) parts.push(`disposition residual: ${r.dispositionResidual}`);
      const chronicErr = parts.length > 0 ? parts.join("; ") : undefined;
      return { payload: r, chronicErr };
    },
    { softTimeoutMs: 55_000 },
  );

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
