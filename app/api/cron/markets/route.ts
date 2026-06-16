// Markets ticker cron (handoff 142). Fetches the v1 lineup (SPX/TNX/WTI/
// DXY) in parallel — Stooq for SPX/WTI/DXY, FRED for TNX — computes
// percent change vs the most recent prior `market_date` row of the same
// symbol, and appends one row per symbol to `market_ticks`.
//
// Triggered every 30 min during US market hours by a GitHub Actions cron
// (.github/workflows/markets-tick.yml). Vercel Hobby caps cron at once
// daily, so the schedule lives outside Vercel and hits this route as a
// regular HTTP POST. Auth mirrors the Vercel cron routes (Bearer
// CRON_SECRET) so the same secret value works for both.
//
// Per-symbol fetch errors are non-fatal: one bad upstream shouldn't drop
// the other rows. They land in the response payload and, if any happen,
// surface to cron_runs.error_message via the HO 139 chronicErr pattern.
import { revalidateTag } from "next/cache";
import { NextResponse } from "next/server";
import { wrapCronRoute } from "@/lib/cron-log";
import { getDb } from "@/lib/db";
import { MARKET_SYMBOLS, fetchQuote, type MarketSymbol } from "@/lib/markets";

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

type SymbolOutcome =
  | { internal: string; ok: true; price: number; changePct: number | null; marketDate: string }
  | { internal: string; ok: false; error: string };

async function processSymbol(symbol: MarketSymbol): Promise<SymbolOutcome> {
  try {
    const quote = await fetchQuote(symbol);
    const db = getDb();
    // HO 251: no change arrow for monthly econ stats or Kalshi probabilities. A
    // PERCENT change of a YoY-rate or a probability misleads (CPI 3.8→4.2 reads
    // as "+10%"; shutdown 45→49 as "+9%"). Skip the prior-diff entirely and store
    // null → the tape renders no arrow for these. Daily symbols keep the diff.
    let changePct: number | null = null;
    if (symbol.cadence === "daily") {
      // Prior reference = most recent row whose market_date < the new tick's
      // market_date. Skipping equal dates means an intraday refresh on the
      // same trading day diffs against yesterday, not the morning print.
      const prior = await db.execute({
        sql: `SELECT price FROM market_ticks
              WHERE symbol = ? AND market_date < ?
              ORDER BY market_date DESC, ticked_at DESC
              LIMIT 1`,
        args: [symbol.internal, quote.marketDate],
      });
      const priorPrice = prior.rows[0]?.price as number | undefined;
      changePct =
        priorPrice !== undefined && priorPrice !== 0
          ? ((quote.price - priorPrice) / priorPrice) * 100
          : null;
    }

    await db.execute({
      sql: `INSERT INTO market_ticks (symbol, price, change_pct, ticked_at, market_date)
            VALUES (?, ?, ?, ?, ?)`,
      args: [symbol.internal, quote.price, changePct, new Date().toISOString(), quote.marketDate],
    });

    return {
      internal: symbol.internal,
      ok: true,
      price: quote.price,
      changePct,
      marketDate: quote.marketDate,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { internal: symbol.internal, ok: false, error: message };
  }
}

async function handle(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;

  // `?source=<src>` fetches only that source's symbols; no param = all. HO 172
  // used this so the intraday GitHub Actions run polls only the intraday source
  // (FRED is end-of-day — polling it intraday just re-writes the same value). HO
  // 227: Stooq died; the intraday source is now FMP (the indices), so the
  // intraday workflow hits `?source=fmp`; the daily after-close run uses no param
  // and gets everything incl. the FRED EOD symbols. Filter is generic by source.
  const source = new URL(request.url).searchParams.get("source");
  const symbols = source
    ? MARKET_SYMBOLS.filter((s) => s.source === source)
    : MARKET_SYMBOLS;

  const result = await wrapCronRoute("/api/cron/markets", async () => {
    const outcomes = await Promise.all(symbols.map(processSymbol));
    const ticked = outcomes.filter((o) => o.ok).length;
    const failed = outcomes.filter((o) => !o.ok);

    for (const o of outcomes) {
      if (o.ok) {
        console.log(
          `[markets] ${o.internal}: ${o.price} (${o.changePct?.toFixed(2) ?? "—"}%) date=${o.marketDate}`,
        );
      } else {
        console.warn(`[markets] ${o.internal} failed: ${o.error}`);
      }
    }

    // Flush the dashboard ticker cache so the next render picks up the
    // fresh prices. Tag matches the unstable_cache key in
    // getLatestMarketTicks().
    revalidateTag("markets");

    const failSummary = failed
      .map((f) => `${f.internal}=${f.error}`)
      .join("; ");

    // HO 227 — failure honesty. A tick that fetched ZERO of the symbols it
    // exists to fetch did NOT succeed: throw so wrapCronRoute finalizes `error`
    // (HTTP 500) and the breakage shows up in `cron_runs.status` within the
    // 30-min retention window — instead of the old `success` row that hid the
    // Stooq death for days. A PARTIAL tick (some fetched, some failed — e.g.
    // one symbol down, or a just-after-open lag) stays success + chronicErr, so
    // a single flaky upstream doesn't false-alarm the whole run.
    if (symbols.length > 0 && ticked === 0) {
      throw new Error(`markets cron fetched 0/${symbols.length} symbols: ${failSummary}`);
    }

    const payload = { ticked, failed: failed.length, outcomes };
    const chronicErr = failed.length > 0 ? `markets fetch failures: ${failSummary}` : undefined;

    return { payload, chronicErr };
  });

  return NextResponse.json(result.body, { status: result.httpStatus });
}

export async function POST(request: Request) {
  return handle(request);
}

export async function GET(request: Request) {
  return handle(request);
}
