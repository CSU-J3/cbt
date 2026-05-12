import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { runSummarize } from "@/lib/summarize-runner";
import { runSync } from "@/lib/sync";

// Sync + summarize can take many seconds; opt out of static optimization.
// 60s matches the Vercel Hobby ceiling. The summarize step is sliced to 50
// bills/tick (see runSummarize call below) so each cron run finishes well under it.
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

  const sync = await runSync();
  const summarize = await runSummarize({ limit: 50 });

  revalidateTag("feed-stats");

  return NextResponse.json({
    ok: true,
    sync,
    summarize: {
      ok: summarize.ok,
      failed: summarize.failed,
      promptTokens: summarize.promptTokens,
      outputTokens: summarize.outputTokens,
    },
  });
}

export async function POST(request: Request) {
  return handle(request);
}

// Vercel Cron sends GET; support it so the same schedule works in production.
export async function GET(request: Request) {
  return handle(request);
}
