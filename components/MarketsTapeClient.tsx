"use client";

// HO 149 — the marquee, staleness check, pause toggle, and reduced-motion
// handling. Server (MarketsTape) hands in the four MarketTicks; everything
// time-sensitive (is-stale, AS OF HH:MM) is computed client-side against
// real Date.now() so the page-cache TTL can't pretend stale data is fresh.
import { useEffect, useMemo, useState } from "react";
import type { MarketTick } from "@/lib/queries";

const STALE_THRESHOLD_MS = 26 * 60 * 60 * 1000;
const PAUSE_STORAGE_KEY = "cbt-tape-paused";

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

function formatHHMM(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const h = d.getUTCHours().toString().padStart(2, "0");
  const m = d.getUTCMinutes().toString().padStart(2, "0");
  return `${h}:${m}`;
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
  const arrow =
    dir === "up" ? "▲" : dir === "down" ? "▼" : dir === "flat" ? "•" : null;
  const colorVar =
    dir === "up"
      ? "var(--market-up)"
      : dir === "down"
        ? "var(--market-down)"
        : dir === "flat"
          ? "var(--text-secondary)"
          : "var(--text-dim)";
  return (
    <span className="markets-tape-item">
      <span className="markets-tape-symbol">{tick.symbol}</span>
      <span
        className="markets-tape-price"
        style={{ color: stale ? "var(--text-dim)" : "var(--text-secondary)" }}
      >
        {formatPrice(tick.price, tick.format)}
      </span>
      {arrow !== null ? (
        <span className="markets-tape-arrow" style={{ color: colorVar }}>
          {arrow}
          {pct !== null && dir !== "flat" ? (
            <span className="markets-tape-change tabular-nums">
              {" "}
              {formatChangePct(pct)}
            </span>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}

export function MarketsTapeClient({ ticks }: { ticks: MarketTick[] }) {
  const [paused, setPaused] = useState(false);
  // Re-check staleness every minute so a long-lived dashboard tab eventually
  // flips to stale without needing a reload at the 26h boundary.
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const stored = window.localStorage.getItem(PAUSE_STORAGE_KEY);
    if (stored === "true" || stored === "false") {
      setPaused(stored === "true");
      return;
    }
    // No stored preference — fall back to the OS reduced-motion default.
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    setPaused(Boolean(reduce));
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);

  const togglePaused = () => {
    setPaused((prev) => {
      const next = !prev;
      window.localStorage.setItem(PAUSE_STORAGE_KEY, String(next));
      return next;
    });
  };

  const { latestTickedAt, stale } = useMemo(() => {
    if (ticks.length === 0) {
      return { latestTickedAt: null as string | null, stale: false };
    }
    let max = 0;
    let latest: string | null = null;
    for (const t of ticks) {
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
  }, [ticks, now]);

  // No-data branch — empty fetch or all rows had unparseable tickedAt.
  if (ticks.length === 0 || latestTickedAt === null) {
    return (
      <div className="markets-tape markets-tape--no-data" aria-label="Markets">
        <div className="markets-tape-track-static">
          {["SPX", "TNX", "WTI", "DXY"].map((s) => (
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
  const items = ticks.map((t) => (
    <TickItem key={t.symbol} tick={t} stale={stale} />
  ));

  return (
    <div
      className={`markets-tape${stale ? " markets-tape--stale" : ""}`}
      data-paused={paused ? "true" : "false"}
      aria-label="Markets"
    >
      {stale ? (
        <div className="markets-tape-track-static">{items}</div>
      ) : (
        <div className="markets-tape-track" aria-hidden={paused}>
          {/* Double-track for a seamless wrap with only four symbols. The
              animation translates 0 → -50% across the combined track, so
              the second copy slides into view as the first slides out. */}
          <div className="markets-tape-track-half">{items}</div>
          <div className="markets-tape-track-half" aria-hidden>
            {items}
          </div>
        </div>
      )}
      <div className="markets-tape-meta">
        {!stale ? (
          <button
            type="button"
            onClick={togglePaused}
            className="markets-tape-toggle"
            aria-label={paused ? "Resume markets tape" : "Pause markets tape"}
            title={paused ? "Resume" : "Pause"}
          >
            {paused ? "▶" : "⏸"}
          </button>
        ) : null}
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
