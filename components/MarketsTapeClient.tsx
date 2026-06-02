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
import type { MarketTick } from "@/lib/queries";

const STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000;
// HO 168: target marquee speed. The duration is computed from the measured
// track-half width (durationSec = width / this), so the crawl reads at a
// constant ~40px/sec no matter how many symbols ship.
const MARQUEE_PX_PER_SEC = 40;
// HO 172: client poll interval for fresh prices.
const POLL_MS = 60_000;

function formatPrice(price: number, format: MarketTick["format"]): string {
  if (format === "yield") return `${price.toFixed(2)}%`;
  return price.toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatChangePct(pct: number): string {
  const abs = Math.abs(pct).toFixed(2);
  return `${pct >= 0 ? "+" : "−"}${abs}%`;
}

// HO 169: 12-hour with AM/PM (UTC zone kept). e.g. "3:33 PM".
function formatHHMM(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  const h24 = d.getUTCHours();
  const period = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m} ${period}`;
}

function TickItem({ tick, stale }: { tick: MarketTick; stale: boolean }) {
  const pct = tick.changePct;
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
  const colorVar =
    dir === "up"
      ? "var(--market-up)"
      : dir === "down"
        ? "var(--market-down)"
        : dir === "flat"
          ? "var(--text-secondary)"
          : "var(--text-dim)";
  // Inline change shows only for a real move; flat/stale leave the reserved slot
  // empty. The popover always states the change explicitly.
  const inlineChange =
    !stale && pct !== null && dir !== "flat" ? formatChangePct(pct) : "";
  const detailChange = pct !== null ? formatChangePct(pct) : "—";
  return (
    <span className="markets-tape-item">
      <span className="markets-tape-symbol">{tick.symbol}</span>
      <span
        className="markets-tape-price"
        style={{ color: stale ? "var(--text-dim)" : "var(--text-secondary)" }}
      >
        {formatPrice(tick.price, tick.format)}
      </span>
      <span className="markets-tape-arrow" style={{ color: colorVar }}>
        <span className="markets-tape-arrow-glyph">{arrow}</span>
        <span className="markets-tape-change tabular-nums">{inlineChange}</span>
      </span>
      {/* HO 175: hover-expand detail. Full instrument name + day change + the
          trading day it represents. No range — market_ticks stores only
          price + change. aria-hidden: decorative hover enhancement (the symbol
          + price are already in the accessible row). */}
      <span className="markets-tape-detail" aria-hidden>
        <span className="markets-tape-detail-name">{tick.label}</span>
        <span className="markets-tape-detail-meta">
          <span style={{ color: colorVar }}>{detailChange}</span>
          {" · as of "}
          {tick.marketDate}
        </span>
      </span>
    </span>
  );
}

export function MarketsTapeClient({ ticks }: { ticks: MarketTick[] }) {
  // Live tick values. Seeded from the server-rendered prop; the poll updates it
  // in place. Re-synced if the server re-renders with newer ticks.
  const [currentTicks, setCurrentTicks] = useState<MarketTick[]>(ticks);
  useEffect(() => {
    setCurrentTicks(ticks);
  }, [ticks]);

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
        if (!cancelled && Array.isArray(json) && json.length > 0) {
          setCurrentTicks(json);
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
  }, []);

  const { latestTickedAt, stale } = useMemo(() => {
    if (currentTicks.length === 0) {
      return { latestTickedAt: null as string | null, stale: false };
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
    if (latest === null) return { latestTickedAt: null, stale: false };
    return {
      latestTickedAt: latest,
      stale: now - max > STALE_THRESHOLD_MS,
    };
  }, [currentTicks, now]);

  // HO 168/172: measure the track-half width → marquee duration (~40px/sec).
  // Deps are the item COUNT and the stale↔live branch, NOT the tick values:
  // a price refresh must not re-measure (which would restart the animation).
  const halfRef = useRef<HTMLDivElement>(null);
  const [marqueeDurationSec, setMarqueeDurationSec] = useState<number | null>(
    null,
  );
  const itemCount = currentTicks.length;
  useEffect(() => {
    const el = halfRef.current;
    if (!el) return;
    const w = el.offsetWidth;
    if (w > 0) setMarqueeDurationSec(w / MARQUEE_PX_PER_SEC);
  }, [itemCount, stale]);

  // No-data branch — empty fetch or all rows had unparseable tickedAt.
  if (currentTicks.length === 0 || latestTickedAt === null) {
    return (
      <div className="markets-tape markets-tape--no-data" aria-label="Markets">
        <div className="markets-tape-track-static">
          {["SPX", "WTI", "TNX", "ITA", "XLK", "XLV", "GOLD", "VIX"].map((s) => (
            <span key={s} className="markets-tape-item">
              <span className="markets-tape-symbol">{s}</span>
              <span
                className="markets-tape-price"
                style={{ color: "var(--text-dim)" }}
              >
                —
              </span>
            </span>
          ))}
        </div>
        <div className="markets-tape-meta">MARKET DATA UNAVAILABLE</div>
      </div>
    );
  }

  // Stale and live both render the same item list; stale just freezes the
  // track and dims the colors (TickItem reads `stale` for its own swap).
  const items = currentTicks.map((t) => (
    <TickItem key={t.symbol} tick={t} stale={stale} />
  ));

  return (
    <div
      className={`markets-tape${stale ? " markets-tape--stale" : ""}`}
      aria-label="Markets"
    >
      {stale ? (
        <div className="markets-tape-track-static">{items}</div>
      ) : (
        <div
          className="markets-tape-track"
          // HO 168: measured-width duration (see MARQUEE_PX_PER_SEC) overrides
          // the CSS fallback so the speed is constant for any symbol count.
          // HO 172: hover-to-pause is CSS-only (.markets-tape-track:hover).
          style={
            marqueeDurationSec
              ? { animationDuration: `${marqueeDurationSec}s` }
              : undefined
          }
        >
          {/* Double-track for a seamless wrap at any symbol count: the
              animation translates 0 → -50% across the combined track, so the
              second (identical) copy slides into view as the first slides out.
              The first half is measured to scale the duration. */}
          <div className="markets-tape-track-half" ref={halfRef}>
            {items}
          </div>
          <div className="markets-tape-track-half" aria-hidden>
            {items}
          </div>
        </div>
      )}
      <div className="markets-tape-meta">
        <span className="markets-tape-stamp">
          AS OF {formatHHMM(latestTickedAt)} UTC
          {stale ? (
            <span className="markets-tape-stale-flag"> · STALE</span>
          ) : null}
        </span>
      </div>
    </div>
  );
}
