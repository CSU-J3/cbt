// Vote sync cron entry (handoff 87). Separated from /api/sync because the
// vote pipelines (House Congress.gov + Senate senate.gov XML) can run into
// minutes on busy weeks — well past the 60s function ceiling that
// /api/sync already pushes against with bill sync + summarize + news +
// trades + Monday reports. Even at 60s here, the vote sync is incremental
// (watermark-based per session) so a single tick can resume from where
// the last one ended — eventually catches up.
//
// Auth mirrors /api/sync exactly: Bearer CRON_SECRET. Failures are caught
// per chamber so a House outage doesn't strand the Senate sync (and vice
// versa). revalidateTag("votes") flushes all five vote-related query
// helpers in lib/queries.ts on success.
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { startCronRun, finishCronRun } from "@/lib/cron-log";
import { runSenateVotesSync } from "@/lib/senate-votes-sync";
import { runVotesSync } from "@/lib/votes-sync";

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

  // Durable cron logging (handoff 105). The per-chamber failures below are
  // swallowed (a House outage must not strand the Senate sync), so the run
  // status stays 'success' — the persisted payload carries null house/senate
  // when a chamber failed, which is where that failure is visible.
  const runId = await startCronRun("/api/sync-votes");
  try {
    let house: Awaited<ReturnType<typeof runVotesSync>> | null = null;
    try {
      house = await runVotesSync();
    } catch (err) {
      console.error("[sync-votes] house failed:", err);
    }

    let senate: Awaited<ReturnType<typeof runSenateVotesSync>> | null = null;
    try {
      senate = await runSenateVotesSync();
    } catch (err) {
      console.error("[sync-votes] senate failed:", err);
    }

    // Flush all vote-tagged query caches (getRecentVotes, getMemberVotes,
    // getMemberVoteStats, etc.) so the member hub picks up new positions
    // without waiting on the 1h backstop revalidate.
    if (house || senate) revalidateTag("votes");

    const responseBody = { ok: true, house, senate };
    await finishCronRun(runId, "success", responseBody);
    return NextResponse.json(responseBody);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await finishCronRun(runId, "error", null, message);
    throw err; // let Next.js return the 500 as before
  }
}

export async function POST(request: Request) {
  return handle(request);
}

// Vercel Cron sends GET; support both so the same path works in production
// and from manual curl.
export async function GET(request: Request) {
  return handle(request);
}
