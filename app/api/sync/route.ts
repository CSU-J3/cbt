import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import {
  generateDashboardLead,
  writeDashboardLead,
} from "@/lib/dashboard-lead";
import {
  generateWeeklyReport,
  getPriorWeek,
  writeReport,
} from "@/lib/report-generation";
import { runSummarize } from "@/lib/summarize-runner";
import { runSync } from "@/lib/sync";

// Sync + summarize can take many seconds; opt out of static optimization.
// 60s matches the Vercel Hobby ceiling. Summarize is throttled at 400ms +
// can hit Gemini 429/503 backoffs, which empirically caps us at ~12 bills
// per run inside the 60s window. The previous 50 was aspirational and
// caused timeouts; with timeouts, the post-sync revalidateTag never flushed
// and the dashboard caches went stale for a full TTL.
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
  // Invalidate after sync writes new bill rows, even if the summarize step
  // below later runs long and the 60s function ceiling kills us. Without
  // this, a timeout would leave stale caches for up to an hour.
  revalidateTag("bills");

  let summarize: Awaited<ReturnType<typeof runSummarize>> | null = null;
  try {
    summarize = await runSummarize({ limit: 12 });
    revalidateTag("bills");
  } catch (err) {
    console.error("[sync] summarize step failed:", err);
  }

  // Regenerate the dashboard lead from the freshly synced data. Non-fatal:
  // if Gemini errors or rate-limits, the prior lead stays in the DB and the
  // dashboard keeps rendering it. revalidateTag flushes the cached lead.
  try {
    const lead = await generateDashboardLead();
    await writeDashboardLead(lead);
    revalidateTag("bills");
  } catch (err) {
    console.warn("[sync] lead generation failed; keeping prior lead", err);
  }

  // Weekly report — generated on Monday for the prior calendar week. The
  // Monday check is UTC because the cron runs at 09:00 UTC. Non-fatal: on
  // failure no row is written, the cron's other steps still complete, and
  // manual recovery is `npm run report`.
  const now = new Date();
  if (now.getUTCDay() === 1) {
    try {
      const week = getPriorWeek(now);
      const report = await generateWeeklyReport(week);
      await writeReport({
        slug: report.slug,
        weekStart: week.start,
        weekEnd: week.end,
        title: report.title,
        contentMd: report.content_md,
      });
      revalidateTag("reports");
    } catch (err) {
      console.warn("[cron] report generation failed; skipping", err);
    }
  }

  return NextResponse.json({
    ok: true,
    sync,
    summarize: summarize
      ? {
          ok: summarize.ok,
          failed: summarize.failed,
          promptTokens: summarize.promptTokens,
          outputTokens: summarize.outputTokens,
        }
      : null,
  });
}

export async function POST(request: Request) {
  return handle(request);
}

// Vercel Cron sends GET; support it so the same schedule works in production.
export async function GET(request: Request) {
  return handle(request);
}
