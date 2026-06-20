// HO 288 — THROWAWAY prod-egress FMP probe (revert after capture). Confirms
// which of the 8 specced equities FMP /stable/quote serves under the PROD key
// from Vercel egress (the local key 402s RTX/NOC/GD — this checks prod's tier).
// CRON_SECRET-gated so it can't be used to burn the FMP quota. Delete after use.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TICKERS = ["NVDA", "AAPL", "MSFT", "GOOGL", "LMT", "RTX", "NOC", "GD"];

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = process.env.FMP_API_KEY;
  if (!key) return NextResponse.json({ error: "FMP_API_KEY not set in this env" });

  const out: Record<string, unknown> = {};
  for (const sym of TICKERS) {
    try {
      const res = await fetch(
        `https://financialmodelingprep.com/stable/quote?symbol=${sym}&apikey=${key}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      const body = await res.text();
      if (!res.ok) {
        out[sym] = { status: res.status, body: body.slice(0, 100) };
        continue;
      }
      let q: Record<string, unknown> | null = null;
      try {
        const arr = JSON.parse(body);
        q = Array.isArray(arr) ? arr[0] : null;
      } catch {
        q = null;
      }
      out[sym] =
        q && q.price != null
          ? { status: 200, price: q.price, change: q.change }
          : { status: res.status, body: body.slice(0, 100) };
    } catch (e) {
      out[sym] = { status: "ERR", error: (e as Error).message };
    }
  }
  return NextResponse.json({ keyLen: key.length, quotes: out });
}
