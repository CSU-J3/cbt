"use client";

// HO 149 — the marquee, staleness check, and reduced-motion handling. Server
// (MarketsTape) hands in the MarketTicks; everything time-sensitive (is-stale,
// AS OF) is computed client-side against real Date.now() so the page-cache TTL
// can't pretend stale data is fresh.
//
// HO 172 — hover-to-pause (CSS `:hover`, no JS pause state) and live numbers:
// the tape polls /api/markets/latest every 60s and maps fresh prices onto the
// existing items (keyed by symbol) so React reconciles in place — the animated
// track never remounts and the scroll never restarts. The duration is only
// re-measured when the item COUNT (or the stale↔live branch) changes, never on
// a value update, so a price refresh can't jump the marquee.
//
// HO 175 — the marquee still jumped on a poll, but NOT from React identity (the
// reconciliation above holds). The real cause was geometry: the keyframe is
// translateX(-50%) of a `width: max-content` track, so when a polled value
// changed an item's rendered width (price digit crossing, arrow flat↔directional
// toggling the change slot in/out), the track width changed and -50% mapped to a
// new pixel offset mid-scroll → visible jump. Fix is CSS-only (globals.css):
// every item reserves fixed ch-based slot widths and always renders the
// arrow + change slots, so item width is invariant to values → track width is
// constant after first paint → -50% is stable. TickItem below renders the
// always-present slots; the hover-detail popover is also added here (HO 175).
import { useEffect, useMemo, useRef, useState } from "react";
import { isMarketOpen } from "@/lib/market-hours";
import type { MarketTick } from "@/lib/queries";
import { formatInZone, useZoneCycle } from "@/lib/zone-cycle";

const STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000;
// HO 172: client poll interval for fresh prices.
const POLL_MS = 60_000;

// HO 176: per-symbol price-slot width (ch), sized to each instrument's value
// band so small values aren't padded to the global max (HO 175's flat 8ch made
// VIX/WTI/TNX read sparse and uneven). STATIC per symbol → value-independent →
// the rendered width can't change on a poll, so the HO 175 jump fix stays dead.
// Right-aligned + tabular-nums (CSS) so digits never reflow within the slot, and
// a value shrinking below a digit boundary (e.g. VIX 10.20→9.85) sits inside the
// unchanged slot. WTI gets hundreds-headroom for an oil run past $100. Default
// 8ch (thousands) for any future symbol.
// HO 227: the 9 live symbols (Stooq died → indices on FMP, the rest FRED EOD;
// the 6 sector ETFs + SILVER + DXY were dropped). Indices NDQ/DOW are 5-digit
// ("51,317.60" = 9ch); BTC 10ch (stable across $100,000); WTI 6ch (oil past
// $100); VIX/TNX 5ch; NATGAS 5ch (~$3, headroom to teens).
// HO 251: the 8-symbol econ/prediction set. Indices NDQ ~5-digit (9ch); SPX 8ch;
// WTI 6ch (oil past $100); TNX 5ch; the four %-format symbols (CPI/UNEMP/SHUTDOWN/
// FEDCUT) render "NN.N%" → 6ch.
const PRICE_SLOT_CH: Record<string, number> = {
  SPX: 8,
  NDQ: 9,
  TNX: 5,
  CPI: 5,
  UNEMP: 5,
  SHUTDOWN: 6, // "100.0%" headroom
  FEDCUT: 5,
  WTI: 6,
};
const DEFAULT_PRICE_SLOT_CH = 8;

// HO 258: marquee scroll speed (px/sec), count-agnostic (HO 168 lesson) — the
// animation duration is derived from the measured half-width / this, so a 4-symbol
// SIGNALS strip and an 8-symbol set crawl at the same visual pace.
const SCROLL_SPEED_PX_S = 42;

// HO 251 monthly-overdue threshold: a monthly print older than this reads as a
// genuinely stalled series (the next month's release is well past due), so it
// washes even though the cron keeps re-inserting it with a fresh tickedAt. ~40d
// covers the normal <=~45d release lag without false-flagging a current print.
const MONTHLY_OVERDUE_MS = 40 * 24 * 60 * 60 * 1000;

// HO 274: implausible-daily-move guard. A daily change beyond ±8% on a major
// index/commodity/rate is almost certainly bad data, not a real session move.
// The concrete trigger: FRED's WTI series (DCOILWTICO) publishes with a multi-day
// lag, so the markets cron's "prior session" diff can compare against a row that's
// a week stale — printing a 7-day move (95.0 → 84.65 = −10.9%) as if it were one
// session. The faithful PRICE still shows; only the misleading change is suppressed
// (the cron has no clean way to know its prior row was stale, so the guard lives at
// render where it also covers already-stored rows + every future lag-jump).
const MAX_PLAUSIBLE_DAILY_MOVE_PCT = 8;

function formatPrice(price: number, format: MarketTick["format"]): string {
  if (format === "yield") return `${price.toFixed(2)}%`;
  // HO 251: CPI/UNEMP/SHUTDOWN/FEDCUT — one decimal (4.2% / 49.0% / 2.0%).
  if (format === "percent") return `${price.toFixed(1)}%`;
  return price.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// HO 251: format the monthly print date as "May 2026" (from "2026-05-01"); the
// kalshi resolution date as "Oct 1, 2026". Falls back to the raw string.
function formatMonth(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
function formatResolveDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatChangePct(pct: number): string {
  const abs = Math.abs(pct).toFixed(2);
  return `${pct >= 0 ? "+" : "−"}${abs}%`;
}

// HO 259: the meeting/deadline MONTH for a dual-source label ("FED CUT JUL"),
// derived from the primary tick's resolution date — no new data.
function monthAbbrUpper(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return "";
  return d
    .toLocaleDateString("en-US", { month: "short", timeZone: "UTC" })
    .toUpperCase();
}

// HO 259: a dual-source SIGNALS pair. `primary` is the Kalshi symbol (the "K"
// half), `secondary` the Polymarket symbol (the "P" half). The secondary is
// fetched/polled like any symbol but is NOT drawn standalone — it renders inside
// the primary's item. `label` is the base display text; `showMonth` appends the
// resolution month (FED CUT → "FED CUT JUL").
export type TapePair = {
  primary: string;
  secondary: string;
  label: string;
  showMonth?: boolean;
};

// HO 259: one dual-source item — `LABEL K x% P y%`. A missing source (no tick:
// stale-out or a ghost market that never ticked) renders dim `N/A` in its slot
// and the pair stays intact, so a designated dual-source item never collapses to
// single-source. Reuses the .markets-tape-price slot (fixed-width, tabular-nums)
// so a daily value change can't jump the marquee. The hover spells out both full
// source names, each value, and the resolve date.
function PairItem({
  pair,
  primary,
  secondary,
  stale,
}: {
  pair: TapePair;
  primary: MarketTick | undefined;
  secondary: MarketTick | undefined;
  stale: boolean;
}) {
  const month =
    pair.showMonth && primary ? monthAbbrUpper(primary.marketDate) : "";
  const display = month ? `${pair.label} ${month}` : pair.label;
  const kVal = primary ? formatPrice(primary.price, primary.format) : "N/A";
  const pVal = secondary ? formatPrice(secondary.price, secondary.format) : "N/A";
  const valColor = (present: boolean) =>
    stale || !present ? "var(--text-dim)" : "var(--text-secondary)";
  const resolveSrc = primary ?? secondary;
  const resolve = resolveSrc ? formatResolveDate(resolveSrc.marketDate) : null;
  return (
    <span className="markets-tape-item">
      <span className="markets-tape-symbol">{display}</span>
      <span className="markets-tape-pair-grp">
        <span className="markets-tape-src">K</span>
        <span
          className="markets-tape-price"
          style={{ minWidth: "5ch", color: valColor(!!primary) }}
        >
          {kVal}
        </span>
      </span>
      <span className="markets-tape-pair-grp">
        <span className="markets-tape-src">P</span>
        <span
          className="markets-tape-price"
          style={{ minWidth: "5ch", color: valColor(!!secondary) }}
        >
          {pVal}
        </span>
      </span>
      <span className="markets-tape-detail" aria-hidden>
        <span className="markets-tape-detail-name">
          {primary?.fullName ?? display}
        </span>
        <span className="markets-tape-detail-meta">
          Kalshi {kVal} · Polymarket {pVal}
          {resolve ? ` · resolves ${resolve}` : ""}
        </span>
      </span>
    </span>
  );
}

function TickItem({
  tick,
  stale,
  closed,
}: {
  tick: MarketTick;
  stale: boolean;
  // HO 234: market-hours CLOSED wash. Mutually exclusive with `stale` (the
  // caller only sets closed when !stale — STALE wins). Last-session values keep
  // displaying; only the color flips to --ticker-closed.
  closed: boolean;
}) {
  // HO 274: suppress an implausible daily move (see MAX_PLAUSIBLE_DAILY_MOVE_PCT)
  // — render the price but no arrow/change, the same shape as a no-prior-reference
  // symbol. Daily-cadence only; monthly/kalshi already carry a null change.
  const rawPct = tick.changePct;
  const implausible =
    tick.cadence === "daily" &&
    rawPct !== null &&
    Math.abs(rawPct) > MAX_PLAUSIBLE_DAILY_MOVE_PCT;
  const pct = implausible ? null : rawPct;
  const dir =
    !stale && pct !== null
      ? pct > 0
        ? "up"
        : pct < 0
          ? "down"
          : "flat"
      : "stale";
  // HO 175: arrow + change slots ALWAYS render (empty glyph / empty change when
  // flat or stale) so an item's width never toggles — the CSS min-widths reserve
  // the space. That width invariance is what keeps the marquee from jumping on a
  // poll (see the geometry note in globals.css).
  const arrow =
    dir === "up" ? "▲" : dir === "down" ? "▼" : dir === "flat" ? "•" : "";
  // HO 234: when closed, prices + changes + arrows all wash to --ticker-closed
  // (the directional glyph/value still shows last session's move, just dormant).
  const colorVar = closed
    ? "var(--ticker-closed)"
    : dir === "up"
      ? "var(--market-up)"
      : dir === "down"
        ? "var(--market-down)"
        : dir === "flat"
          ? "var(--text-secondary)"
          : "var(--text-dim)";
  // Inline change shows only for a real move; flat leaves the reserved slot
  // empty. The popover always states the change explicitly.
  const inlineChange = dir === "flat" ? "" : formatChangePct(pct as number);
  const detailChange = pct !== null ? formatChangePct(pct) : "—";
  const priceSlotCh = PRICE_SLOT_CH[tick.symbol] ?? DEFAULT_PRICE_SLOT_CH;
  // HO 179.1: a symbol with a value keeps the reserved arrow+change slots so
  // flat↔directional toggling never changes its width (the HO 175 jump fix).
  // But a null-change symbol (first tick, no prior session — dir "stale") would
  // otherwise render ~8ch of EMPTY reserved slot, leaving big gaps across the
  // tape. Omit the slots entirely for those (zero width) → dense. Tradeoff: when
  // such a symbol first gets a value (next session) its width grows once — a
  // one-time settle, not the every-60s jump.
  const showSlots = dir !== "stale";
  // HO 227/251: small per-symbol cadence tag. EOD = FRED end-of-day (10Y/WTI);
  // MO = monthly econ print (CPI/UNEMP) so a non-moving monthly value doesn't
  // read as broken. Kalshi probabilities carry no tag (the value is live odds).
  const tagText = tick.eod ? "EOD" : tick.cadence === "monthly" ? "MO" : null;
  const tagTitle = tick.eod
    ? "End-of-day value"
    : tick.cadence === "monthly"
      ? "Monthly release"
      : undefined;
  // HO 251: cadence-aware freshness wording in the hover.
  const freshnessText =
    tick.cadence === "monthly"
      ? `monthly · as of ${formatMonth(tick.marketDate)}`
      : tick.cadence === "kalshi"
        ? `resolves ${formatResolveDate(tick.marketDate)}`
        : `as of ${tick.marketDate}${tick.eod ? " · end of day" : ""}`;
  return (
    <span className="markets-tape-item">
      <span className="markets-tape-symbol">{tick.symbol}</span>
      {tagText ? (
        <span className="markets-tape-eod" title={tagTitle}>
          {tagText}
        </span>
      ) : null}
      <span
        className="markets-tape-price"
        style={{
          minWidth: `${priceSlotCh}ch`,
          color: stale
            ? "var(--text-dim)"
            : closed
              ? "var(--ticker-closed)"
              : "var(--text-secondary)",
        }}
      >
        {formatPrice(tick.price, tick.format)}
      </span>
      {showSlots ? (
        <span className="markets-tape-arrow" style={{ color: colorVar }}>
          <span className="markets-tape-arrow-glyph">{arrow}</span>
          <span className="markets-tape-change tabular-nums">
            {inlineChange}
          </span>
        </span>
      ) : null}
      {/* HO 175/177: hover-expand detail. HO 177 promotes the full instrument
          name (tick.fullName) to the prominent line; the short group label sits
          in the meta line with change + as-of, dropped when it just repeats the
          name (e.g. SPX where label === fullName). No range — market_ticks
          stores only price + change. aria-hidden: decorative hover enhancement
          (the symbol + price are already in the accessible row). */}
      <span className="markets-tape-detail" aria-hidden>
        <span className="markets-tape-detail-name">{tick.fullName}</span>
        <span className="markets-tape-detail-meta">
          {tick.label !== tick.fullName ? `${tick.label} · ` : ""}
          {/* Change only for daily symbols — monthly/kalshi carry null (no
              meaningful % move), so skip the "—" noise. */}
          {pct !== null ? (
            <>
              <span style={{ color: colorVar }}>{detailChange}</span>
              {" · "}
            </>
          ) : null}
          {freshnessText}
        </span>
      </span>
    </span>
  );
}

export function MarketsTapeClient({
  ticks,
  placeholderSymbols,
  showMeta = true,
  kind = "markets",
  pairs,
  scroll = false,
}: {
  ticks: MarketTick[];
  // HO 178: the symbols this tape owns — drives the no-data placeholder row and
  // the poll filter so a grouped tape only ever updates its own symbols.
  placeholderSymbols?: string[];
  // HO 179.1: render the AS OF meta? Both dashboard tapes poll the same data, so
  // only the bottom tape shows the single shared stamp (top passes false).
  // Single-tape pages keep the default.
  showMeta?: boolean;
  // HO 253: "signals" strips (Kalshi odds + monthly econ) have no market-hours
  // close — they never wash/flag CLOSED and right-pin a green LIVE dot. STALE
  // (a dead cron, 26h) still wins over LIVE.
  kind?: "markets" | "signals";
  // HO 259: dual-source pairs (v2 SIGNALS). Each entry's `secondary` symbol is
  // owned/polled but rendered inside the `primary`'s item as the "P" half.
  pairs?: readonly TapePair[];
  // HO 258: restore the marquee crawl, scoped to v2's two tapes. Default false =
  // the HO 251 static full-width row (so `/` + inner pages stay static and are
  // NOT regressed). When true, the items render in a transform-animated double-
  // track (seamless -50% loop, hover-pause, reduced-motion-safe via CSS). The
  // CLOSED/LIVE/STALE meta + right-pin stay outside the scrolling track.
  scroll?: boolean;
}) {
  // Live tick values. Seeded from the server-rendered prop; the poll updates it
  // in place. Re-synced if the server re-renders with newer ticks.
  const [currentTicks, setCurrentTicks] = useState<MarketTick[]>(ticks);
  useEffect(() => {
    setCurrentTicks(ticks);
  }, [ticks]);

  // HO 178: the symbol set this tape renders. Falls back to the served ticks'
  // own symbols when no explicit list is passed (the single-tape case).
  const ownSymbols = useMemo(
    () => new Set(placeholderSymbols ?? ticks.map((t) => t.symbol)),
    [placeholderSymbols, ticks],
  );

  // HO 183: the AS OF stamp cycles through US zones (ET→CT→MT→PT→UTC). The hook
  // is clock-derived, so this tape and the masthead LAST SYNC show the same zone
  // at the same instant. Display-only — it changes only the meta text (not the
  // track), so it never triggers the marquee re-measure (deps below exclude it)
  // and the meta layer is position:absolute, so the zone-label width swap can't
  // reflow the track. Reduced-motion pins it to MT. Called unconditionally even
  // when showMeta is false (top tape) — hooks must not be conditional.
  const zone = useZoneCycle();

  // Re-check staleness every minute so a long-lived dashboard tab eventually
  // flips to stale without needing a reload at the 26h boundary.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  // HO 172: poll for fresh numbers and update values in place (no remount).
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const res = await fetch("/api/markets/latest");
        if (!res.ok) return;
        const json = (await res.json()) as MarketTick[];
        // HO 178: /api/markets/latest returns ALL symbols; keep only the ones
        // this tape owns so a grouped tape doesn't pull in the other group.
        const mine = Array.isArray(json)
          ? json.filter((t) => ownSymbols.has(t.symbol))
          : [];
        if (!cancelled && mine.length > 0) {
          setCurrentTicks(mine);
        }
      } catch {
        // Keep the current ticks on a failed poll.
      }
    };
    const id = window.setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [ownSymbols]);

  // HO 258: marquee geometry. Measure ONE set's width + the container width, then
  // fill each of the two animated halves with enough copies to span the viewport
  // (so a short SIGNALS set has no gap before the wrap) and derive the duration
  // from the half-width so the pace is count-agnostic (HO 168). Set widths are
  // value-invariant (HO 175/176 PRICE_SLOT_CH + always-render slots), so a poll
  // never changes the geometry → the -50% loop can't jump. Re-measures on resize.
  const containerRef = useRef<HTMLDivElement>(null);
  const setRef = useRef<HTMLDivElement>(null);
  const [reps, setReps] = useState(2);
  const [durationS, setDurationS] = useState(28);
  useEffect(() => {
    if (!scroll) return;
    const measure = () => {
      const setEl = setRef.current;
      const cont = containerRef.current;
      if (!setEl || !cont) return;
      const setW = setEl.getBoundingClientRect().width;
      const contW = cont.getBoundingClientRect().width;
      if (setW < 1) return;
      const r = Math.max(2, Math.ceil(contW / setW) + 1);
      setReps(r);
      setDurationS((r * setW) / SCROLL_SPEED_PX_S);
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [scroll, currentTicks]);

  // HO 251: STRIP-level staleness = tape-wide on the freshest tickedAt. Catches a
  // fully-dead cron (nothing ticked in 26h → whole strip washes + AS OF · STALE).
  // It does NOT flag a monthly symbol that's simply unchanged (the cron re-inserts
  // it daily with a fresh tickedAt) — that's the per-item monthly-overdue check.
  const { latestTickedAt, stripStale } = useMemo(() => {
    if (currentTicks.length === 0) {
      return { latestTickedAt: null as string | null, stripStale: false };
    }
    let max = 0;
    let latest: string | null = null;
    for (const t of currentTicks) {
      const ms = Date.parse(t.tickedAt);
      if (!Number.isFinite(ms)) continue;
      if (ms > max) {
        max = ms;
        latest = t.tickedAt;
      }
    }
    if (latest === null) return { latestTickedAt: null, stripStale: false };
    return { latestTickedAt: latest, stripStale: now - max > STALE_THRESHOLD_MS };
  }, [currentTicks, now]);

  // HO 234: market-hours CLOSED signal, recomputed off the same minute `now` tick
  // so the strip flips live at 9:30/16:00 ET without a reload. STALE wins — a
  // broken pipeline must not read as a healthy closed wash. HO 253: a "signals"
  // strip never closes (prediction/econ series run 24/7), so force it false —
  // this also keeps every item out of the per-item closed wash below.
  const marketHoursClosed = useMemo(() => !isMarketOpen(new Date(now)), [now]);
  const closed = kind === "signals" ? false : marketHoursClosed && !stripStale;

  // HO 251: per-symbol state. Monthly (CPI/UNEMP) washes only when its print is
  // genuinely overdue (>~40d) — never just for not moving; daily/kalshi follow the
  // strip's 26h rule. The market-hours CLOSED wash applies only to daily symbols
  // (CPI prints and Kalshi odds don't follow NYSE trading hours).
  const itemState = (t: MarketTick): { stale: boolean; closed: boolean } => {
    if (t.cadence === "monthly") {
      const md = Date.parse(`${t.marketDate.slice(0, 10)}T00:00:00Z`);
      const overdue = Number.isFinite(md) && now - md > MONTHLY_OVERDUE_MS;
      return { stale: stripStale || overdue, closed: false };
    }
    return { stale: stripStale, closed: closed && t.cadence === "daily" };
  };

  // No-data branch — empty fetch or all rows had unparseable tickedAt.
  if (currentTicks.length === 0 || latestTickedAt === null) {
    return (
      <div className="markets-tape markets-tape--no-data" aria-label="Markets">
        <div className="markets-tape-row markets-tape-row--placeholder">
          {(placeholderSymbols ?? ["SPX", "NDQ", "TNX", "CPI", "WTI"]).map(
            (s) => (
              <span key={s} className="markets-tape-item">
                <span className="markets-tape-symbol">{s}</span>
                <span
                  className="markets-tape-price"
                  style={{ color: "var(--text-dim)" }}
                >
                  —
                </span>
              </span>
            ),
          )}
        </div>
        {showMeta ? (
          <div className="markets-tape-meta">MARKET DATA UNAVAILABLE</div>
        ) : null}
      </div>
    );
  }

  // HO 251: STATIC full-width row — no marquee. The 8-symbol trim is what lets a
  // non-crawling strip fit; dropping the crawl also drops all the HO 168/175/179
  // geometry (duration/copies/double-track) since there's no scroll to keep
  // jump-proof. Closed/STALE treatment is now per-item (itemState).
  //
  // Render the FULL owned set in order; a symbol with no tick at all (a brand-new
  // symbol whose first fetch failed, or one the cron couldn't fetch and never
  // seeded) shows N/A — never a fabricated zero, and the slot stays so the layout
  // is stable. A previously-seeded symbol that later fails keeps its last value
  // and washes to STALE via the 26h rule. The cron surfaces the miss in
  // cron_runs either way (it doesn't insert on a fetch failure).
  const bySymbol = new Map(currentTicks.map((t) => [t.symbol, t]));
  // HO 259: dual-source pairs. The secondary (Polymarket) symbols are owned for
  // fetch+poll but never drawn standalone — they render inside their primary's
  // PairItem. Drop them from the render order; map each primary to its pair.
  const pairByPrimary = new Map((pairs ?? []).map((p) => [p.primary, p]));
  const secondarySet = new Set((pairs ?? []).map((p) => p.secondary));
  const ordered = (placeholderSymbols ?? currentTicks.map((t) => t.symbol)).filter(
    (sym) => !secondarySet.has(sym),
  );
  const items = ordered.map((sym) => {
    const pair = pairByPrimary.get(sym);
    if (pair) {
      return (
        <PairItem
          key={sym}
          pair={pair}
          primary={bySymbol.get(pair.primary)}
          secondary={bySymbol.get(pair.secondary)}
          stale={stripStale}
        />
      );
    }
    const t = bySymbol.get(sym);
    if (!t) {
      return (
        <span key={sym} className="markets-tape-item">
          <span className="markets-tape-symbol">{sym}</span>
          <span
            className="markets-tape-price"
            style={{ color: "var(--text-dim)" }}
            title="No data available"
          >
            N/A
          </span>
        </span>
      );
    }
    const st = itemState(t);
    return (
      <TickItem key={t.symbol} tick={t} stale={st.stale} closed={st.closed} />
    );
  });

  const metaNode = showMeta ? (
    <div className="markets-tape-meta">
      <span className="markets-tape-stamp">
        AS OF {formatInZone(latestTickedAt, zone)}
        {stripStale ? (
          <span className="markets-tape-stale-flag"> · STALE</span>
        ) : kind === "signals" ? (
          // HO 253: prediction/econ signals never close — a static green LIVE
          // dot stands in for the MARKETS strip's · CLOSED.
          <span className="markets-tape-live-flag">
            {" · "}
            <span className="markets-tape-live-dot" aria-hidden>
              ●
            </span>{" "}
            LIVE
          </span>
        ) : closed ? (
          <span className="markets-tape-closed-flag"> · CLOSED</span>
        ) : null}
      </span>
    </div>
  ) : null;

  // HO 258: marquee (v2 only). Two animated halves, each `reps` copies of the
  // ordered set, translateX 0 → -50% so the second half lands exactly where the
  // first began — a seamless, gapless wrap. Hover-pause + reduced-motion live in
  // CSS. The meta sits outside the track (absolute, solid bg) so CLOSED/LIVE/STALE
  // + the right-pin stay put while the items scroll behind it.
  if (scroll) {
    return (
      <div
        ref={containerRef}
        className={`markets-tape markets-tape--scroll${
          stripStale ? " markets-tape--stale" : ""
        }${closed ? " markets-tape--closed" : ""}`}
        aria-label="Markets"
      >
        <div
          className="markets-tape-track"
          style={{ animationDuration: `${durationS}s` }}
        >
          {[0, 1].map((half) => (
            <div className="markets-tape-half" key={half}>
              {Array.from({ length: reps }).map((_, i) => {
                const canonical = half === 0 && i === 0;
                return (
                  <div
                    key={i}
                    className="markets-tape-set"
                    ref={canonical ? setRef : undefined}
                    aria-hidden={canonical ? undefined : true}
                  >
                    {items}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        {metaNode}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`markets-tape markets-tape--static${
        stripStale ? " markets-tape--stale" : ""
      }${closed ? " markets-tape--closed" : ""}`}
      aria-label="Markets"
    >
      <div className="markets-tape-row">{items}</div>
      {metaNode}
    </div>
  );
}
