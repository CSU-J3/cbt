// LDA /lobbying rollup precompute cron (HO 580 — split out of /api/cron/lda).
//
// This does NO LDA API access. It reads the `lda_*` tables the sync writes and
// recomputes the dashboard_state blobs (issue rollup, per-bill drill, top firms,
// topic crosswalk), then revalidateTag("lda") so the surface reflects the new
// blob. It used to run in the tail of the sync route, gated on ROLLUP_RESERVE_MS
// — but the sync spends its whole budget on ~1s/call network round-trips, so on
// any day with new filings the rollup never started and the blob went stale
// until someone ran `npm run lda:rollup` by hand. Giving it its own function and
// schedule removes that competition: the sync owns its full page budget, the
// rollup owns a compute-only window.
//
// The compute is 96-114s cold (a full table scan + in-memory aggregation), hence
// maxDuration 300 and the raised soft timeout. The four blob writes are atomic
// upserts at the very end, so a SIGKILL mid-compute leaves the prior blobs intact
// — never a half-written rollup.
//
// scripts/rollup-lda.ts stays the manual/backfill entry point; it runs the same
// computeLda* path but can't revalidateTag from a CLI (Next-runtime only), which
// is exactly the gap this route closes.
//
// Schedule: 0 22 * * * — clear of every daily cron and the 08:00 LDA sync it
// reads from. Auth mirrors the other cron routes (Bearer CRON_SECRET).
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import {
  computeBillDrill,
  computeIssueRollup,
  computeTopFirms,
  computeTopicCrosswalk,
  readLdaTables,
  uncappedLdaClient,
  writeLdaBillDrill,
  writeLdaRollup,
  writeLdaTopFirms,
  writeLdaTopicCrosswalk,
} from "@/lib/lda-rollup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

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
  // default 55s race doesn't kill the compute before it finishes.
  const result = await wrapCronRoute(
    "/api/cron/lda-rollup",
    async () => {
      const t0 = Date.now();
      // HO 440 — one table read feeds both the issue rollup and the per-bill
      // drill, so this recomputes all four blobs from a single scan.
      const client = uncappedLdaClient();
      const generatedAt = new Date().toISOString();
      const tables = await readLdaTables(client);
      const blob = computeIssueRollup(tables, generatedAt);
      await writeLdaRollup(client, blob);
      const billBlob = computeBillDrill(tables, generatedAt);
      await writeLdaBillDrill(client, billBlob);
      const firmsBlob = computeTopFirms(tables, generatedAt);
      await writeLdaTopFirms(client, firmsBlob);
      const topicBlob = computeTopicCrosswalk(tables, generatedAt);
      await writeLdaTopicCrosswalk(client, topicBlob);
      client.close();
      revalidateTag("lda");

      const ms = Date.now() - t0;
      const billDrills = Object.keys(billBlob.drill).length;
      const topFirms = firmsBlob.firms.length;
      const topics = topicBlob.topics.length;
      console.log(
        `[lda-rollup] rollup ok in ${ms}ms: ${blob.issues.length} issues, ` +
          `${Object.keys(blob.drill).length} drills, ${billDrills} bill drills, ` +
          `${topFirms} top firms, ${topics} topics`,
      );
      return {
        payload: {
          ok: true,
          ms,
          issues: blob.issues.length,
          drills: Object.keys(blob.drill).length,
          billDrills,
          topFirms,
          topics,
        },
      };
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
