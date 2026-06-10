"use client";

// HO 210 Pass 1: the shared US-map index shell, built once and fed two
// DELIBERATELY-SEPARATE coloring functions by `variant`. Map-first — the literal
// geoAlbersUsa choropleth (geometry computed server-side in lib/us-map-geo.ts) is
// the default view; the existing spectrum-bar list (passed in as `listSlot`) is
// one MAP/LIST toggle away and is NOT rebuilt.
//
// FORM HISTORY: an in-session tile-grid cartogram was REJECTED in design
// ("squares are lifeless, don't read as 'my state' — geographic legibility won").
// This is the literal map. Do NOT "optimize" it back to squares.
//
// PALETTE DISCIPLINE (do NOT unify the two schemes, now or in any cleanup):
//   racesFill()     = purple ramp by COUNT of competitive races (magnitude).
//   primariesFill()  = three recency hues — cyan VOTED / amber SOON / slate LATER.
// They are TWO separate functions on purpose — never a single parameterized
// colorer. The two tabs never share a meaningful color; legends are
// self-contained; you never see both at once.
//
// Phase-1 report stub stays until Pass 2 (the basic null-safe card).

import { useEffect, useMemo, useRef, useState } from "react";
import { PrimaryMapCard } from "@/components/PrimaryMapCard";
import { RaceMapCard } from "@/components/RaceMapCard";
import type {
  CartogramCell,
  CartogramVariant,
  PrimaryBand,
} from "@/lib/cartogram-data";
import { STATE_ABBR_TO_NAME } from "@/lib/states";
import type { UsMapGeometry } from "@/lib/us-map-geo";

type FillStyle = { fill: string; label: string };

const INACTIVE: FillStyle = { fill: "#1a2030", label: "#475569" };

// RACES — purple ramp by competitive-race COUNT (brightened so count-1 reads
// against the base; 27 states sit at count-1).
function racesFill(count: number): FillStyle {
  if (count <= 0) return INACTIVE;
  if (count === 1) return { fill: "#3b3585", label: "#e5e7eb" };
  if (count === 2) return { fill: "#5048b0", label: "#e5e7eb" };
  if (count === 3) return { fill: "#6a60d0", label: "#0a0e14" };
  return { fill: "#8b82e8", label: "#0a0e14" };
}

// PRIMARIES — recency bands (HO 226 recolor: deeper teal/amber so the bands sit
// distinctly from the races purple ramp, with a primaries-specific NONE darker
// than the shared INACTIVE). VOTED / SOON / LATER / NONE.
function primariesFill(band: PrimaryBand | null): FillStyle {
  if (band === "voted") return { fill: "#0e7490", label: "#e5e7eb" };
  if (band === "soon") return { fill: "#b45309", label: "#e5e7eb" };
  if (band === "later") return { fill: "#1e2740", label: "#94a3b8" };
  return { fill: "#11161f", label: "#475569" };
}

function RacesLegend() {
  const items = [
    { swatch: "#3b3585", label: "1" },
    { swatch: "#5048b0", label: "2" },
    { swatch: "#6a60d0", label: "3" },
    { swatch: "#8b82e8", label: "4+" },
  ];
  return (
    <div className="cart-legend">
      <span style={{ color: "var(--text-dim)" }}>COMPETITIVE RACES</span>
      {items.map((i) => (
        <span key={i.label} className="cart-legend-item">
          <span className="cart-legend-swatch" style={{ background: i.swatch }} />
          {i.label}
        </span>
      ))}
      <span className="cart-legend-item">
        <span
          className="cart-legend-swatch"
          style={{ background: INACTIVE.fill, borderColor: "#2a3344" }}
        />
        none
      </span>
    </div>
  );
}

function PrimariesLegend() {
  const items = [
    { swatch: "#0e7490", border: "#0e7490", label: "VOTED" },
    { swatch: "#b45309", border: "#b45309", label: "SOON" },
    { swatch: "#1e2740", border: "#1f2937", label: "LATER" },
  ];
  return (
    <div className="cart-legend">
      {items.map((i) => (
        <span key={i.label} className="cart-legend-item">
          <span
            className="cart-legend-swatch"
            style={{ background: i.swatch, borderColor: i.border }}
          />
          {i.label}
        </span>
      ))}
      <span className="cart-legend-item" style={{ color: "var(--accent-amber)" }}>
        ● N multiple primaries
      </span>
    </div>
  );
}

function PeekCard({
  cell,
  variant,
}: {
  cell: CartogramCell;
  variant: CartogramVariant;
}) {
  const stateName = STATE_ABBR_TO_NAME[cell.state] ?? cell.state;
  const headline =
    variant === "races"
      ? `${cell.count} competitive`
      : (cell.band ?? "").toUpperCase();
  const shown = cell.contests.slice(0, 8);
  const extra = cell.contests.length - shown.length;
  return (
    <div className="us-map-peek">
      <div className="cart-peek-head">
        <span style={{ color: "var(--text-primary)" }}>{stateName}</span>
        <span style={{ color: "var(--text-dim)" }}>{headline}</span>
      </div>
      {shown.map((c) => (
        <div key={c.label} className="cart-peek-row">
          <span style={{ color: "var(--text-secondary)" }}>{c.label}</span>
          <span style={{ color: "var(--text-dim)" }}>{c.meta}</span>
        </div>
      ))}
      {extra > 0 ? (
        <div className="cart-peek-row" style={{ color: "var(--text-dim)" }}>
          +{extra} more
        </div>
      ) : null}
    </div>
  );
}

export function CartogramShell({
  variant,
  cells,
  summary,
  geometry,
  listSlot,
  onStatePick,
  dimmedStates,
}: {
  variant: CartogramVariant;
  cells: CartogramCell[];
  summary: string;
  geometry: UsMapGeometry;
  listSlot: React.ReactNode;
  // HO 225 (additive, /races only): when provided, clicking an active state
  // calls this instead of pinning the inline report — the district modal opens.
  // Omitted on /primaries, which keeps the pin→inline-card behavior unchanged.
  onStatePick?: (abbr: string) => void;
  // HO 226 (additive, /primaries only): states NOT in the active scrubber month
  // are dimmed. Undefined (e.g. /races) → no dimming.
  dimmedStates?: ReadonlySet<string>;
}) {
  const [view, setView] = useState<"map" | "list">("map");
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchMiss, setSearchMiss] = useState(false);
  const reportRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [wrapW, setWrapW] = useState(0);

  // Measure the rendered map width so the peek can be clamped in real pixels
  // (percentage-only positioning can't account for the peek's fixed 224px box
  // or the interior NE-label gutter — finding #1).
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => setWrapW(el.getBoundingClientRect().width);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [view]);

  const cellByState = useMemo(() => {
    const m = new Map<string, CartogramCell>();
    for (const c of cells) m.set(c.state, c);
    return m;
  }, [cells]);

  const leaderSet = useMemo(
    () => new Set(geometry.leaderLabels.map((l) => l.abbr)),
    [geometry],
  );

  // Peek anchor per state: centroid for in-map states, the gutter label point
  // for leader states (that's where the cursor actually is).
  const anchorByState = useMemo(() => {
    const m = new Map<string, { x: number; y: number }>();
    for (const s of geometry.states) m.set(s.abbr, { x: s.cx, y: s.cy });
    for (const l of geometry.leaderLabels) m.set(l.abbr, { x: l.x, y: l.y });
    return m;
  }, [geometry]);

  useEffect(() => {
    if (pinned && reportRef.current) {
      reportRef.current.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [pinned]);

  function resolveSearch(raw: string): string | null {
    const q = raw.trim().toLowerCase();
    if (!q) return null;
    const up = q.toUpperCase();
    if (up.length === 2 && cellByState.get(up)?.active) return up;
    for (const c of cells) {
      if (!c.active) continue;
      for (const con of c.contests) {
        if (con.searchTerms.some((t) => t.toLowerCase().includes(q))) return c.state;
      }
    }
    for (const c of cells) {
      if (!c.active) continue;
      if ((STATE_ABBR_TO_NAME[c.state] ?? "").toLowerCase().includes(q)) return c.state;
    }
    return null;
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const hit = resolveSearch(query);
    if (hit) {
      setSearchMiss(false);
      setView("map");
      setPinned(hit);
    } else {
      setSearchMiss(true);
    }
  }

  const pinnedCell = pinned ? cellByState.get(pinned) ?? null : null;
  const hoveredCell = hovered ? cellByState.get(hovered) ?? null : null;

  function tileHandlers(abbr: string, active: boolean) {
    if (!active) return {};
    return {
      onMouseEnter: () => setHovered(abbr),
      onMouseLeave: () => setHovered((h) => (h === abbr ? null : h)),
      onFocus: () => setHovered(abbr),
      onBlur: () => setHovered((h) => (h === abbr ? null : h)),
      onClick: () => (onStatePick ? onStatePick(abbr) : setPinned(abbr)),
      tabIndex: 0,
      role: "button" as const,
      style: { cursor: "pointer" },
    };
  }

  // Peek placement (finding #1): position in real pixels and clamp to the map
  // area so the card never (a) runs off-screen or (b) overlaps the NE leader
  // gutter. Flip LEFT whenever a right-placement would reach the gutter/edge —
  // which also handles NE labels whose anchor already sits inside the gutter.
  const PEEK_W = 232; // 224 box + border/padding slack
  const GAP = 12;
  let peekStyle: React.CSSProperties | null = null;
  if (hovered && hoveredCell && wrapW > 0) {
    const a = anchorByState.get(hovered);
    if (a) {
      const scale = wrapW / geometry.width;
      const wrapH = (geometry.height / geometry.width) * wrapW;
      const px = a.x * scale;
      const py = a.y * scale;
      // Right edge of the renderable map (left of the NE label gutter).
      const gutterPx = (geometry.mapWidth / geometry.width) * wrapW;
      // Prefer right; flip left if that would reach the gutter or run past it.
      const wantRight = px + GAP + PEEK_W <= gutterPx;
      let left = wantRight ? px + GAP : px - GAP - PEEK_W;
      left = Math.max(4, Math.min(left, wrapW - PEEK_W - 4));
      // Vertical: estimate height from the row count, then clamp on-screen.
      const rows = Math.min(hoveredCell.contests.length, 8);
      const extra = hoveredCell.contests.length > 8 ? 1 : 0;
      const estH = 30 + (rows + extra) * 17 + 8;
      let topPx = py - 8;
      topPx = Math.max(4, Math.min(topPx, Math.max(4, wrapH - estH - 4)));
      peekStyle = { left: `${left}px`, top: `${topPx}px` };
    }
  }

  return (
    <div>
      {/* Control row: MAP/LIST toggle · search · count summary */}
      <div className="cart-controls">
        <div className="cart-viewtoggle" role="tablist" aria-label="map or list view">
          {(["map", "list"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="tab"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className="cart-viewtoggle-btn"
              data-active={view === v}
            >
              {v.toUpperCase()}
            </button>
          ))}
        </div>
        <form onSubmit={onSearchSubmit} className="cart-search">
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSearchMiss(false);
            }}
            placeholder={
              variant === "races"
                ? "name, seat (PA-07), or state…"
                : "name, seat, or state…"
            }
            aria-label="search the map"
            spellCheck={false}
          />
          {searchMiss ? <span className="cart-search-miss">no match</span> : null}
        </form>
        <span className="cart-summary">{summary}</span>
      </div>

      {variant === "races" ? <RacesLegend /> : <PrimariesLegend />}

      {view === "map" ? (
        <>
          <div className="us-map-wrap" ref={wrapRef}>
            <svg
              className="us-map"
              viewBox={geometry.viewBox}
              role="group"
              aria-label="US state map"
            >
              {/* State shapes */}
              {geometry.states.map((s) => {
                const cell = cellByState.get(s.abbr) ?? null;
                const active = !!cell?.active;
                const style =
                  variant === "races"
                    ? racesFill(cell?.count ?? 0)
                    : primariesFill(cell?.band ?? null);
                const isLeader = leaderSet.has(s.abbr);
                const isDC = s.abbr === "DC";
                const handlers = tileHandlers(s.abbr, active);
                const labelText =
                  variant === "races" && active && hovered === s.abbr && cell?.count
                    ? `${s.abbr} ${cell.count}`
                    : variant === "primaries" && active && (cell?.count ?? 0) > 1
                      ? `${s.abbr} ●${cell.count}`
                      : s.abbr;
                return (
                  <g
                    key={s.abbr}
                    {...(dimmedStates
                      ? { opacity: dimmedStates.has(s.abbr) ? 0.28 : 1 }
                      : {})}
                  >
                    {isDC ? (
                      // DC has no visible polygon at this zoom — fixed marker.
                      <rect
                        x={s.cx - 6}
                        y={s.cy - 6}
                        width={12}
                        height={12}
                        fill={style.fill}
                        stroke="#0a0e14"
                        strokeWidth={0.75}
                        className={active ? "us-map-state" : "us-map-state--inactive"}
                        {...handlers}
                      />
                    ) : (
                      <path
                        d={s.d}
                        fill={style.fill}
                        stroke="#0a0e14"
                        strokeWidth={0.75}
                        className={active ? "us-map-state" : "us-map-state--inactive"}
                        aria-label={`${STATE_ABBR_TO_NAME[s.abbr] ?? s.abbr}`}
                        {...handlers}
                      />
                    )}
                    {/* In-map label for non-leader, non-DC states */}
                    {!isLeader && !isDC ? (
                      <text
                        x={s.cx}
                        y={s.cy}
                        className="us-map-label"
                        fill={style.label}
                        {...(active
                          ? {
                              onClick: () =>
                                onStatePick
                                  ? onStatePick(s.abbr)
                                  : setPinned(s.abbr),
                            }
                          : {})}
                      >
                        {labelText}
                      </text>
                    ) : null}
                  </g>
                );
              })}

              {/* Leader-line labels for the small NE/mid-Atlantic states */}
              {geometry.leaderLabels.map((l) => {
                const cell = cellByState.get(l.abbr) ?? null;
                const active = !!cell?.active;
                const handlers = tileHandlers(l.abbr, active);
                const labelColor = active ? "#e5e7eb" : "#475569";
                const labelText =
                  variant === "races" && active && hovered === l.abbr && cell?.count
                    ? `${l.abbr} ${cell.count}`
                    : variant === "primaries" && active && (cell?.count ?? 0) > 1
                      ? `${l.abbr} ●${cell.count}`
                      : l.abbr;
                return (
                  <g
                    key={`lead-${l.abbr}`}
                    {...(dimmedStates
                      ? { opacity: dimmedStates.has(l.abbr) ? 0.28 : 1 }
                      : {})}
                  >
                    <line
                      x1={l.cx}
                      y1={l.cy}
                      x2={l.x - 6}
                      y2={l.y}
                      className="us-map-leader"
                    />
                    <text
                      x={l.x}
                      y={l.y}
                      className="us-map-leaderlabel"
                      fill={labelColor}
                      {...handlers}
                    >
                      {labelText}
                    </text>
                  </g>
                );
              })}
            </svg>

            {peekStyle && hoveredCell ? (
              <div className="us-map-peek-wrap" style={peekStyle}>
                <PeekCard cell={hoveredCell} variant={variant} />
              </div>
            ) : null}
          </div>

          {/* Pinned report — Pass 2 basic null-safe card (per variant). */}
          {pinnedCell ? (
            <div ref={reportRef} className="cart-report">
              <div className="cart-report-head">
                <span style={{ color: "var(--accent-amber)" }}>
                  {STATE_ABBR_TO_NAME[pinnedCell.state] ?? pinnedCell.state}
                </span>
                <span style={{ color: "var(--text-muted)" }}>
                  {variant === "races"
                    ? `${pinnedCell.count} competitive race${pinnedCell.count === 1 ? "" : "s"}`
                    : `${(pinnedCell.band ?? "").toUpperCase()} · ${pinnedCell.contests.length} contest${pinnedCell.contests.length === 1 ? "" : "s"}`}
                </span>
                <button
                  type="button"
                  className="cart-report-close"
                  onClick={() => setPinned(null)}
                  aria-label="close report"
                >
                  ×
                </button>
              </div>
              {variant === "races" ? (
                <RaceMapCard contests={pinnedCell.contests} />
              ) : (
                <PrimaryMapCard contests={pinnedCell.contests} />
              )}
            </div>
          ) : null}
        </>
      ) : (
        <div className="cart-listslot">{listSlot}</div>
      )}
    </div>
  );
}
