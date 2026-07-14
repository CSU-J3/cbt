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
import { hydrateNominations, syncNominations } from "@/lib/nominations-sync";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Two budgets under the 60s ceiling (HO 459). The list-only sync drains in
// seconds on a normal tick (even a bulk-refresh re-fetch is ~8 pages), so it gets
// the first 45s; the committee hydration delta (tiny — the 830-row initial
// populate is the CLI run, not this) gets to 55s, leaving ~5s for the final flush
// + cron-log writes. SYNC 45s < HYDRATE 55s < soft timeout 55s < 60s.
const SYNC_BUDGET_MS = 45_000;
const HYDRATE_BUDGET_MS = 55_000;
const HYDRATE_CAP_PER_TICK = 40; // worst case ~40×~2 fetches, comfortably inside the wall

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
      const r = await syncNominations({ deadlineMs: routeStart + SYNC_BUDGET_MS });
      console.log(
        `[nominations] mode=${r.mode} upserted=${r.upserted} listPages=${r.listPages} ` +
          `throttled429=${r.throttled429} deadlineHit=${r.deadlineHit} ` +
          `dispositionResidual=${r.dispositionResidual} frontier=${r.frontier} apiTotal=${r.apiTotal}`,
      );

      // Bounded committee-referral hydration after the sync (HO 459). The delta is
      // tiny — new civilian rows insert with committee_hydrated_at NULL and drain a
      // few per tick; the 830-row initial populate is the CLI --hydrate run.
      const h = await hydrateNominations({ deadlineMs: routeStart + HYDRATE_BUDGET_MS, cap: HYDRATE_CAP_PER_TICK });
      console.log(
        `[nominations] hydrate processed=${h.processed} withCommittee=${h.withCommittee} noCommittee=${h.noCommittee} ` +
          `resolved=${h.resolvedAgainstTracked} unresolved=${h.unresolved} dualDropped=${h.dualReferralDropped} ` +
          `fetches=${h.fetches} deadlineHit=${h.deadlineHit} remaining=${h.remaining}`,
      );

      revalidateTag("nominations");

      // Chronic-err pattern (HO 139): non-fatal conditions surface in
      // cron_runs.error_message on success rows.
      const parts: string[] = [];
      if (r.deadlineHit) parts.push(`deadline hit (resumes from DB frontier next run)`);
      if (r.dispositionResidual > 0) parts.push(`disposition residual: ${r.dispositionResidual}`);
      if (h.deadlineHit) parts.push(`hydrate deadline hit (remaining ${h.remaining})`);
      if (h.unresolved > 0) parts.push(`hydrate unresolved: ${h.unresolved}`);
      const chronicErr = parts.length > 0 ? parts.join("; ") : undefined;
      return { payload: { ...r, hydrate: h }, chronicErr };
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
