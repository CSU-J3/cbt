// HO 477 cron-health pull surface. An external uptime monitor (UptimeRobot /
// cron-job.org / Better Uptime) watches this and alerts on non-200 — the only
// layer that catches a silently-stopped cron (a stopped cron logs no Vercel
// function error to alert on; the freshness has to be PULLED).
//
// Returns 200 when the whole fleet is fresh, 503 when any watched route is
// stale or hard-failing (see lib/cron-health.ts for the liveness rule).
//
// Deliberately NOT wrapped in wrapCronRoute — this is a monitor, not a cron; it
// must not log itself into cron_runs. Read-only, cheap (index-backed reads),
// and force-dynamic + no-store so a cached 200 can never mask a live outage.
//
// Unauthed public GET: health checks conventionally are, and this exposes only
// cron freshness + timestamps, nothing sensitive.
import { NextResponse } from "next/server";
import { computeCronHealth } from "@/lib/cron-health";
import { redactSecrets } from "@/lib/redact";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const health = await computeCronHealth();
    return NextResponse.json(health, {
      status: health.healthy ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch (err) {
    // The check itself failed (DB unreachable, etc.) — that's an outage from a
    // monitor's point of view, so surface it as 503, never a misleading 200.
    // HO 679. This route is deliberately NOT wrapCronRoute-wrapped (it is a
    // monitor, not a cron), so neither the row sink nor the body sink reaches
    // it — and it is the one response body that leaves the project's own
    // consumers. Redact at the call site. Ruled HO 679 STEP 0.
    const message = redactSecrets(
      err instanceof Error ? err.message : String(err),
    );
    return NextResponse.json(
      { healthy: false, checkedAt: new Date().toISOString(), error: message },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
