// HO 301 — THROWAWAY prod-egress FMP probe (revert after capture). Re-checks the
// defense trio RTX/NOC/GD (+LMT control) on /stable/quote under the PROD key, to
// confirm whether the FMP tier changed since 288 (they 402'd then). CRON_SECRET-
// gated. Delete after use.
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const TICKERS = ["RTX", "NOC", "GD", "LMT"];

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const key = process.env.FMP_API_KEY;
  if (!key) return NextResponse.json({ error: "FMP_API_KEY not set" });

  const out: Record<string, unknown> = {};
  for (const sym of TICKERS) {
    try {
      const res = await fetch(
        `https://financialmodelingprep.com/stable/quote?symbol=${sym}&apikey=${key}`,
        { signal: AbortSignal.timeout(15_000) },
      );
      const body = await res.text();
      if (!res.ok) {
        out[sym] = { status: res.status, body: body.slice(0, 90) };
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
          : { status: res.status, body: body.slice(0, 90) };
    } catch (e) {
      out[sym] = { status: "ERR", error: (e as Error).message };
    }
  }
  return NextResponse.json({ keyLen: key.length, quotes: out });
}
