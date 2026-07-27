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
import { walkAmendmentVotes } from "@/lib/amendment-votes-walk";
import { materializeSenateAmendmentVotes } from "@/lib/amendment-votes-senate";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Budget carve (HO 532): the sync gets ~240s, the House amendment-vote walk gets the
// remainder to ~280s (its own sub-deadline), leaving ~20s for flush + cron-log under
// the 300s ceiling. AMENDMENTS_BUDGET_MS 280s < soft timeout 290s < 300s (the LDA
// layering). The HAMDT delta is usually 0, so the walk rarely does work.
const SYNC_BUDGET_MS = 240_000;
const AMENDMENTS_BUDGET_MS = 280_000;
// Cap HAMDTs walked per tick — a new/changed HAMDT trickle-links over a tick or two.
const WALK_LIMIT = 40;

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
      const r = await syncAmendments({ deadlineMs: routeStart + SYNC_BUDGET_MS });
      console.log(
        `[amendments] mode=${r.mode} upserted=${r.upserted} listPages=${r.listPages} ` +
          `detailErrors=${r.detailErrors} throttled429=${r.throttled429} deadlineHit=${r.deadlineHit} ` +
          `frontier=${r.frontier} apiTotal=${r.apiTotal}`,
      );

      revalidateTag("amendments");

      // HO 537: materialize the Senate amendment→vote links BEFORE the House walk.
      // Cheap, deterministic, DB-only (no API) — runs first so a starved / deadline-
      // hit walk can never leave the Senate links stale (that would be a silent
      // staleness bug). Non-fatal, folded into chronicErr like the walk.
      let senateMat: Awaited<ReturnType<typeof materializeSenateAmendmentVotes>> | null = null;
      let senateErr: string | undefined;
      try {
        senateMat = await materializeSenateAmendmentVotes();
        console.log(
          `[amendment-votes:senate] scanned=${senateMat.scanned} matched=${senateMat.matched} ` +
            `linksWritten=${senateMat.linksWritten} changed=${senateMat.changed} ` +
            `unmatchedQuestions=${senateMat.unmatchedQuestions}`,
        );
        // Flush `votes` (read by HO 535 participation queries) only when the link
        // set actually moved — the recompute rewrites every row, so linksWritten is
        // always > 0 and would make this an always-true no-op guard.
        if (senateMat.changed > 0) revalidateTag("votes");
      } catch (e) {
        senateErr = `senate amendment-vote materialize failed: ${(e as Error).message}`;
        console.error(`[amendment-votes:senate] ${senateErr}`);
      }

      // HO 532: bounded House amendment-vote walk after the sync (nominations
      // sync→hydrate split). Non-fatal — the sync already succeeded; a walk failure
      // surfaces in chronicErr, never fails the tick.
      let walk: Awaited<ReturnType<typeof walkAmendmentVotes>> | null = null;
      let walkErr: string | undefined;
      try {
        walk = await walkAmendmentVotes({
          limit: WALK_LIMIT,
          deadlineMs: routeStart + AMENDMENTS_BUDGET_MS,
        });
        console.log(
          `[amendment-votes] walked=${walk.walked} linksInserted=${walk.linksInserted} ` +
            `hamdtWithVote=${walk.hamdtWithVote} fetchErrors=${walk.fetchErrors} ` +
            `remaining=${walk.remaining} deadlineHit=${walk.deadlineHit}`,
        );
        // Flush getBillAmendmentVotes when new House links landed (revalidateTag
        // "amendments" above also covers it; this is the explicit votes-tag path).
        if (walk.linksInserted > 0) revalidateTag("votes");
      } catch (e) {
        walkErr = `amendment-vote walk failed: ${(e as Error).message}`;
        console.error(`[amendment-votes] ${walkErr}`);
      }

      // Chronic-err pattern (HO 139): non-fatal conditions surface in
      // cron_runs.error_message on success rows.
      const parts: string[] = [];
      if (r.detailErrors > 0) parts.push(`amendments detail errors: ${r.detailErrors}`);
      if (r.deadlineHit) parts.push(`deadline hit (resumes from DB frontier next run)`);
      if (senateMat && senateMat.unmatchedQuestions > 0)
        parts.push(`senate amendment-vote unmatched questions: ${senateMat.unmatchedQuestions}`);
      if (senateErr) parts.push(senateErr);
      if (walk && walk.fetchErrors > 0) parts.push(`amendment-vote walk fetch errors: ${walk.fetchErrors}`);
      if (walkErr) parts.push(walkErr);
      const chronicErr = parts.length > 0 ? parts.join("; ") : undefined;
      return { payload: { ...r, senateMat, walk }, chronicErr };
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
