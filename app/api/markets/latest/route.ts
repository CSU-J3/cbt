// HO 172 — lightweight poll target for the live markets tape. Returns the same
// getLatestMarketTicks() payload the dashboard server-renders, so the client
// can refresh the tape numbers in place every ~60s without a full page reload.
// The query is unstable_cache(tag "markets", revalidate 86400); the markets cron's
// revalidateTag("markets") flushes it, so this surfaces fresh prices as soon as the
// cron writes, and serves the cached payload between writes — no per-request DB hit
// on a poll. (HO 582: this comment was false while revalidate==60 — the TTL expired
// every minute, so each poll re-ran the query. C1 set revalidate to a 24h backstop
// and made the tag flush the sole refresh path, so it is true now.)
import { NextResponse } from "next/server";
import { getLatestMarketTicks } from "@/lib/queries";

export const dynamic = "force-dynamic";

export async function GET() {
  const ticks = await getLatestMarketTicks();
  return NextResponse.json(ticks);
}
