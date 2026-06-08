// HO 220: rating-history change-detect cron. Daily Vercel cron (0 15 * * *,
// after news at 14:00) that logs a rating_history row only when a race_ratings
// value MOVES. First run logs the baseline (one row per current rating); static
// days log zero. Daily Vercel cron — NOT the GitHub-Actions high-freq path:
// ratings move quarterly, daily is already generous. No revalidate — nothing
// reads rating_history yet (the sparkline is a future handoff). Bearer
// CRON_SECRET, mirrors the other cron routes.
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import { getDb } from "@/lib/db";
import { logRatingHistory } from "@/lib/rating-history";

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

  const result = await wrapCronRoute("/api/cron/rating-history", async () => {
    const summary = await logRatingHistory(getDb());
    console.log(
      `[rating-history] logged=${summary.logged} unchanged=${summary.unchanged} total=${summary.total}`,
    );
    return { payload: summary };
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
