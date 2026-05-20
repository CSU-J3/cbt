// Race-ratings sync cron entry (handoff 88). Scrapes 2026 House Sabato
// ratings from Ballotpedia weekly. Separate route + cron because the
// cadence is weekly (Sabato updates mid-week) while /api/sync is daily,
// and the work is unrelated to the bill pipeline.
//
// Auth mirrors /api/sync and /api/sync-votes exactly: Bearer CRON_SECRET.
// revalidateTag("race-ratings") flushes the cached race query helpers so
// the /races page picks up rating moves without waiting on the backstop.
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
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

  let stats: Awaited<ReturnType<typeof runRaceRatingsSync>> | null = null;
  try {
    stats = await runRaceRatingsSync();
    // race-ratings tag is separate from races/bills — the rating seed and
    // now this scrape refresh on their own cadence.
    revalidateTag("race-ratings");
  } catch (err) {
    console.error("[sync-race-ratings] failed:", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, stats });
}

export async function POST(request: Request) {
  return handle(request);
}

// Vercel Cron sends GET; support both.
export async function GET(request: Request) {
  return handle(request);
}
