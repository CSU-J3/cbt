// Weekly report cron (handoff 139). Split out of /api/sync because the
// Monday 09:00 UTC tick was running sync + lead + trades + report inside a
// single 60s function and never reached the report step in production —
// the only `reports` rows in the DB came from a manual 5-19 backfill, and
// 5-25 09:35 finished as an orphaned cron_runs row. On its own route the
// report has the full 60s budget.
//
// KNOWN ISSUE (deferred to HO 141): the underlying generateWeeklyReport()
// call measured 88s end-to-end during HO 139 verification — Gemini Flash
// with thinkingBudget=8192 dominates. The 55s soft timeout in wrapCronRoute
// fires before the call completes, so this cron consistently finalizes as
// status='timeout' (HTTP 504, no `reports` row) instead of orphaning. That
// is strictly better than the pre-HO-139 SIGKILL behavior — the row is
// durable and the failure mode is named — but the cron does not yet produce
// new reports. Rows still come from manual `npm run report`. HO 141 tracks
// the perf fix (likely lowering thinkingBudget or splitting the LLM call).
//
// Schedule: Monday 09:30 UTC — 30 min after /api/sync. Data inputs for
// the prior calendar week (stage transitions, enactments, news mentions)
// all close out by Sunday 23:59 UTC; nothing from Monday's 09:00 sync is
// required. Auth: Bearer CRON_SECRET, identical to the other cron routes.
//
// revalidateTag("reports") flushes both getReports and getReportCount so
// the /reports index picks up the new row on the next request.
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import {
  generateWeeklyReport,
  getPriorWeek,
  writeReport,
} from "@/lib/report-generation";

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

  const result = await wrapCronRoute("/api/cron/weekly-report", async () => {
    const week = getPriorWeek(new Date());
    const report = await generateWeeklyReport(week);
    await writeReport({
      slug: report.slug,
      weekStart: week.start,
      weekEnd: week.end,
      title: report.title,
      contentMd: report.content_md,
    });
    revalidateTag("reports");
    return {
      payload: {
        report: {
          slug: report.slug,
          weekStart: week.start,
          weekEnd: week.end,
          title: report.title,
        },
      },
    };
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
