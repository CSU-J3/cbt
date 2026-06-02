// HO 172 — lightweight poll target for the live markets tape. Returns the same
// getLatestMarketTicks() payload the dashboard server-renders, so the client
// can refresh the tape numbers in place every ~60s without a full page reload.
// The query is unstable_cache(tag "markets"); the markets cron's
// revalidateTag("markets") flushes it, so this surfaces fresh prices as soon
// as the cron writes — no per-request DB hit between writes.
import { NextResponse } from "next/server";
import { getLatestMarketTicks } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const ticks = await getLatestMarketTicks();
  return NextResponse.json(ticks);
}
