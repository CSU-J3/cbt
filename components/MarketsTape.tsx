// HO 149 — markets ticker tape. Server parent fetches the MarketTicks, then
// hands them to the client marquee for animation + staleness.
//
// RECORD (HO 669) — the BARE shape is gone from the CODE, not just from the
// tree. HO 178 gave the tape a single-symbol-GROUP form; HO 234 (design item 1)
// collapsed the dashboard's dual counter-scrolling pair back to ONE combined
// no-prop line, mounted by HomeHeader (`/dashboard-classic`) and HeaderBar
// (every inner page); HO 251 made that row STATIC (no crawl) on an 8-symbol
// econ/prediction set. HO 323 took it off the inner pages and HO 608–610 deleted
// HomeHeader and `/dashboard-classic` together — which left the bare arm with
// ZERO mounts. HO 669 struck it: `BARE_TAPE_EXCLUDED` (sole reader of
// `lib/markets`' `bareTape` tag, retired with it), the `group` prop (zero callers
// since HO 234), and the whole `lib/markets` import went with the arm. `symbols`
// is now REQUIRED — every mount is explicit — and the only two render sites are
// DashboardV2Header's MARKETS and ODDS strips. `placeholderSymbols` is now just
// that list; it still drives both the no-data placeholder row and the client's
// poll filter, so a tape only ever updates its own symbols. `showMeta` is
// untouched (its `false` path is unreachable from both mounts — filed at HO 669).
import {
  MarketsTapeClient,
  type TapePair,
} from "@/components/MarketsTapeClient";
import { getLatestMarketTicks } from "@/lib/queries";

export async function MarketsTape({
  showMeta = true,
  symbols,
  pairs,
  kind = "markets",
  scroll = false,
  reverse = false,
  label,
  className,
}: {
  showMeta?: boolean;
  // HO 253: the v2 two-tape split. `symbols` is an explicit internal-symbol
  // allowlist (e.g. ["SPX","NDQ","TNX","WTI"]) that ALSO drives render ORDER
  // (the client lays symbols out in this exact sequence), so MARKETS reads
  // S&P / NASDAQ / 10Y / WTI and SIGNALS reads SHUTDOWN / FEDCUT / CPI / UNEMP
  // regardless of MARKET_SYMBOLS order. HO 669 made it REQUIRED when the bare
  // no-`symbols` default arm was struck.
  symbols: readonly string[];
  // HO 259: dual-source pairing (v2 SIGNALS). Each pair renders its primary
  // (Kalshi) and secondary (Polymarket) tick as ONE item — `LABEL K x% P y%` —
  // and the secondary symbol is fetched/polled but not drawn standalone.
  pairs?: readonly TapePair[];
  // `kind="signals"` tells the client this strip has no market-hours close
  // (prediction + monthly-econ series run 24/7): it never washes/flags CLOSED
  // and right-pins a green LIVE dot instead. STALE (dead cron) still applies.
  kind?: "markets" | "signals";
  // HO 258: opt into the marquee crawl (v2's two tapes). Default static so `/`
  // and inner pages stay on the HO 251 static row.
  scroll?: boolean;
  // HO 291: reverse the marquee direction (counter-scroll). v2 ODDS strip only.
  reverse?: boolean;
  // HO 274: left-pinned strip label ("MARKETS" / "SIGNALS"), v2 two-tape only.
  label?: string;
  /** HO 692 — passed through to the tape root; the ODDS strip gets `odds-only`. */
  className?: string;
}) {
  let ticks: Awaited<ReturnType<typeof getLatestMarketTicks>> = [];
  try {
    ticks = await getLatestMarketTicks();
  } catch {
    // Swallow — the client falls through to the no-data state below.
  }
  const symbolSet = new Set(symbols);
  const tapeTicks = ticks.filter((t) => symbolSet.has(t.symbol));
  const placeholderSymbols = [...symbols];
  return (
    <MarketsTapeClient
      // HO 590: server-computed clock, prop-drilled so SSR and first client paint
      // share ONE `now` (it serialises into the RSC payload — the HO 489/490 pattern).
      // The client's useState(() => Date.now()) previously ran a DIFFERENT value at
      // hydration than the server used at SSR, and when the two straddled the 26h
      // stale edge or a 09:30/16:00-ET market boundary the arrow nodes flipped in/out
      // → a structural (args[]=HTML) hydration mismatch. Trade: a cached first paint
      // can show a state one tick stale; the 60s interval corrects it on mount.
      nowMs={Date.now()}
      ticks={tapeTicks}
      placeholderSymbols={placeholderSymbols}
      pairs={pairs}
      showMeta={showMeta}
      kind={kind}
      scroll={scroll}
      reverse={reverse}
      label={label}
      className={className}
    />
  );
}
