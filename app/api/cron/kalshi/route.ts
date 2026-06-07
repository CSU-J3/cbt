// HO 218 per-seat Kalshi odds cron. Scans the Kalshi open-events feed for 2026
// House/Senate general markets, parses each ticker to our raceId, keeps the
// favored outcome, and upserts kalshi_odds. Like /api/cron/markets it's driven
// by GitHub Actions (.github/workflows/kalshi-tick.yml), not Vercel cron —
// odds move intraday and Hobby caps cron at daily. Auth mirrors the cron routes
// (Bearer CRON_SECRET). The full-feed scan (~37 pages, throttled) runs ~20-30s,
// comfortably under wrapCronRoute's 55s soft timeout; a slow tick finalizes as
// status='timeout' and the prior odds persist (the batch upsert is at the end).
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import { getDb } from "@/lib/db";
import { fetchKalshiSeatOdds } from "@/lib/kalshi";

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

  const result = await wrapCronRoute("/api/cron/kalshi", async () => {
    const odds = await fetchKalshiSeatOdds();
    const db = getDb();
    const now = new Date().toISOString();

    // One batched write so ~390 upserts are a single round-trip, not 390.
    const stmts = odds.map((o) => ({
      sql: `INSERT INTO kalshi_odds
              (race_id, cycle, event_ticker, implied_pct, favorite_label,
               favorite_is_party, favorite_party, open_interest, close_time, updated_at)
            VALUES (?, 2026, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(race_id) DO UPDATE SET
              event_ticker = excluded.event_ticker,
              implied_pct = excluded.implied_pct,
              favorite_label = excluded.favorite_label,
              favorite_is_party = excluded.favorite_is_party,
              favorite_party = excluded.favorite_party,
              open_interest = excluded.open_interest,
              close_time = excluded.close_time,
              updated_at = excluded.updated_at`,
      args: [
        o.raceId,
        o.eventTicker,
        o.impliedPct,
        o.favoriteLabel,
        o.favoriteIsParty ? 1 : 0,
        o.favoriteParty,
        o.openInterest,
        o.closeTime,
        now,
      ],
    }));
    if (stmts.length > 0) await db.batch(stmts, "write");

    revalidateTag("races");
    return { payload: { seats: odds.length } };
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
