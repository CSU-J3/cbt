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
import { fetchChamberControl, fetchKalshiSeatOdds } from "@/lib/kalshi";
import { fetchPolymarketSeatOdds } from "@/lib/polymarket";

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

    // HO 219: chamber-control (House/Senate balance of power) — two fixed event
    // reads, stored as one dashboard_state JSON blob (both exact pcts per
    // chamber). Non-fatal: a failed read just leaves the prior blob in place.
    const control = await fetchChamberControl();
    await db.execute({
      sql: `INSERT INTO dashboard_state (key, value, updated_at)
            VALUES ('kalshi_chamber_control', ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [JSON.stringify(control), now],
    });

    // HO 256: per-seat Polymarket Senate odds, parallel to kalshi_odds. A scan
    // of all 35 Senate-2026 seats by Gamma slug (~34 hit today). Non-fatal — a
    // Polymarket failure leaves the prior polymarket_odds in place and never
    // breaks the Kalshi write above. Batched upsert, same as kalshi_odds.
    let polySeats = 0;
    try {
      const poly = await fetchPolymarketSeatOdds();
      polySeats = poly.length;
      const polyStmts = poly.map((p) => ({
        sql: `INSERT INTO polymarket_odds
                (race_id, cycle, slug, implied_pct, favorite_label,
                 favorite_is_party, favorite_party, volume, liquidity, end_date, updated_at)
              VALUES (?, 2026, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(race_id) DO UPDATE SET
                slug = excluded.slug,
                implied_pct = excluded.implied_pct,
                favorite_label = excluded.favorite_label,
                favorite_is_party = excluded.favorite_is_party,
                favorite_party = excluded.favorite_party,
                volume = excluded.volume,
                liquidity = excluded.liquidity,
                end_date = excluded.end_date,
                updated_at = excluded.updated_at`,
        args: [
          p.raceId,
          p.slug,
          p.impliedPct,
          p.favoriteLabel,
          p.favoriteIsParty ? 1 : 0,
          p.favoriteParty,
          p.volume,
          p.liquidity,
          p.endDate,
          now,
        ],
      }));
      if (polyStmts.length > 0) await db.batch(polyStmts, "write");
    } catch (err) {
      console.warn("[cron/kalshi] polymarket fetch failed (non-fatal):", err);
    }

    revalidateTag("races");
    return {
      payload: {
        seats: odds.length,
        polymarketSeats: polySeats,
        house: control.house,
        senate: control.senate,
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
