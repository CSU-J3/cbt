"use client";

// HO 225: the /races district modal — map-as-control. Opens on a national-map
// state click (CartogramShell onStatePick → RacesMap). Maps band selects, card
// shows detail; no scrolling seat-list. Per-state district geometry is fetched
// lazily from /api/races/district-geo/[state] (server-only projection, cached);
// the response carries a server-resolved seatId per polygon, so this client
// never imports the server-only district-geo module — it matches seatId against
// the state's contests for clickability + highlight.
//
// Minimal modal shell (no shipped drawer exists to reuse — HO 225 FLAG 1):
// dimmed backdrop + amber-bordered panel + ×/click-away/Esc, existing tokens.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MetroLeaderLines, metroCenterX } from "@/components/MetroLeaderLines";
import { RaceDistrictCard } from "@/components/RaceDistrictCard";
import { formatCash } from "@/components/race-cells";
import type { CartogramContest } from "@/lib/cartogram-data";
import type { DistrictShape, StateDistrictGeometry } from "@/lib/district-geo";
import { ratingColor } from "@/lib/race-colors";
import { STATE_ABBR_TO_NAME } from "@/lib/states";

function humanStatus(status: string | null): string {
  if (!status || status === "running") return "running";
  return status.replace(/_/g, " ").replace("won primary", "primary winner");
}

// Client-side markdown report from data already on the card. No news section
// (no race→news linkage) and no new pipeline — just serialize the contest.
function buildReport(c: CartogramContest): string {
  const L: string[] = [`# ${c.label} — 2026 race report`, ""];
  L.push(`**Consensus rating:** ${c.rating ?? "—"}`);
  const s = c.raterSpread;
  if (s)
    L.push(`**Raters:** Cook ${s.cook ?? "—"} · Sabato ${s.sabato ?? "—"} · Inside Elections ${s.ie ?? "—"}`);
  if (c.chamber === "house" && c.margin2024 != null)
    L.push(`**2024 margin:** ${c.margin2024 > 0 ? "R" : "D"}+${Math.abs(c.margin2024).toFixed(1)}`);
  if (c.kalshiOdds) L.push(`**Kalshi market:** ${c.kalshiOdds.favoriteLabel} ${c.kalshiOdds.impliedPct}%`);
  if (c.incumbent) {
    L.push("", "## Incumbent", `- ${c.incumbent.name} [${c.party ?? "?"}]${c.isOpen ? " (retiring)" : ""}`);
    if (c.incumbentFirstElected) L.push(`- First elected: ${c.incumbentFirstElected}`);
    if (c.incumbentCashOnHand != null) L.push(`- Cash on hand: ${formatCash(c.incumbentCashOnHand)}`);
  }
  const ch = c.challengers ?? [];
  if (ch.length) {
    L.push("", c.isOpen ? "## Field" : "## Challengers");
    for (const x of ch) L.push(`- ${x.name} [${x.party ?? "?"}] — ${humanStatus(x.status)}`);
  }
  return L.join("\n") + "\n";
}

function downloadReport(c: CartogramContest): void {
  const blob = new Blob([buildReport(c)], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${c.label.replace(/\s+/g, "-")}-race-report.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function RaceDistrictModal({
  abbr,
  contests,
  onClose,
}: {
  abbr: string;
  contests: CartogramContest[];
  onClose: () => void;
}) {
  const [geo, setGeo] = useState<StateDistrictGeometry | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // raceId
  const [hovered, setHovered] = useState<string | null>(null);
  const bandRef = useRef<HTMLDivElement | null>(null);
  const overviewSvgRef = useRef<SVGSVGElement | null>(null);

  const byRaceId = new Map<string, CartogramContest>();
  for (const c of contests) if (c.raceId) byRaceId.set(c.raceId, c);

  // HO 237: order the inset row left→right by source-region x-center so the
  // leader lines can't cross.
  const orderedMetros = [...(geo?.metros ?? [])].sort(
    (a, b) => metroCenterX(a) - metroCenterX(b),
  );

  useEffect(() => {
    let alive = true;
    fetch(`/api/races/district-geo/${abbr}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (alive) setGeo(d);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [abbr]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stateName = STATE_ABBR_TO_NAME[abbr] ?? abbr;
  const districtCount = geo?.districts.length ?? null;
  const selectedContest = selected ? byRaceId.get(selected) ?? null : null;

  // Shared polygon render — used by the state overview AND each metro inset, so
  // both fill/select/hover identically and selection syncs across all of them.
  const renderDistricts = (polys: DistrictShape[]) => (
    <>
      {polys.map((d) => {
        const contest = d.seatId ? byRaceId.get(d.seatId) : undefined;
        const comp = !!contest;
        const sel = !!selected && d.seatId === selected;
        const hov = !!hovered && d.seatId === hovered;
        return (
          <path
            key={d.cd}
            d={d.d}
            fill={comp ? ratingColor(contest.rating) : "#1c2433"}
            stroke={
              sel
                ? "var(--accent-amber-bright)"
                : hov && comp
                  ? "var(--accent-amber)"
                  : "#0a0e14"
            }
            strokeWidth={sel ? 2 : hov && comp ? 1.5 : 0.6}
            style={comp ? { cursor: "pointer" } : undefined}
            onClick={comp ? () => setSelected(d.seatId) : undefined}
            onMouseEnter={comp ? () => setHovered(d.seatId) : undefined}
            onMouseLeave={comp ? () => setHovered((h) => (h === d.seatId ? null : h)) : undefined}
          >
            <title>
              {d.cd}
              {comp ? ` · ${contest.rating}` : ""}
            </title>
          </path>
        );
      })}
      {polys.map((d) => {
        const comp = d.seatId ? byRaceId.has(d.seatId) : false;
        return (
          <text
            key={`l${d.cd}`}
            x={d.cx}
            y={d.cy}
            className="rdm-dlabel"
            fill={comp ? "#e5e7eb" : "#475569"}
            pointerEvents="none"
          >
            {d.cd}
          </text>
        );
      })}
    </>
  );

  return (
    <div className="rdm-backdrop" onClick={onClose}>
      <div
        className="rdm-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${stateName} races`}
      >
        <div className="rdm-header">
          <div>
            <div className="rdm-title">
              {stateName.toUpperCase()} · {contests.length} COMPETITIVE
              {districtCount ? ` OF ${districtCount}` : ""}
            </div>
            <div className="rdm-sub">2026 GENERAL · CLICK A DISTRICT ON THE MAP</div>
          </div>
          <button className="rdm-close" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>

        {/* HO 237: positioned band wrapping the overview + insets so the
            leader-line overlay can span both. */}
        <div className="rdm-mapsband" ref={bandRef}>
          <div className="rdm-maps">
            {geo ? (
              <svg
                ref={overviewSvgRef}
                viewBox={geo.viewBox}
                className="rdm-map"
                role="group"
                aria-label={`${stateName} districts`}
              >
                {renderDistricts(geo.districts)}
                {/* HO 237: source-region rect ringing each metro's cluster
                    (overview viewBox coords; non-scaling stroke → crisp 1px). */}
                {orderedMetros.map((m) =>
                  m.overviewBox ? (
                    <rect
                      key={`src-${m.label}`}
                      x={m.overviewBox.x}
                      y={m.overviewBox.y}
                      width={m.overviewBox.w}
                      height={m.overviewBox.h}
                      className="rdm-source-rect"
                      vectorEffect="non-scaling-stroke"
                    />
                  ) : null,
                )}
              </svg>
            ) : (
              <div className="rdm-maploading">loading map…</div>
            )}
          </div>

          {/* HO 236 metro insets (HO 237 reorders L→R by source x-center so the
              leader lines never cross). Same seatId-keyed fill/hover/click as the
              overview → selection syncs overview ↔ panel ↔ chips. Null-safe on
              stale caches / unconfigured states. This band render is DUPLICATED
              in PrimaryDistrictModal (different fill); not extracted here. */}
          {orderedMetros.length ? (
            <div className="rdm-metros">
              {orderedMetros.map((m) => (
                <div className="rdm-metro" key={m.label}>
                  <span className="rdm-metro-label">{m.label}</span>
                  <svg viewBox={m.viewBox} className="rdm-metromap" role="group" aria-label={m.label}>
                    {renderDistricts(m.polygons)}
                  </svg>
                </div>
              ))}
            </div>
          ) : null}

          {/* HO 237: leader-line frustum overlay (render-only, pointer-events:none). */}
          {orderedMetros.length ? (
            <MetroLeaderLines
              bandRef={bandRef}
              overviewSvgRef={overviewSvgRef}
              metros={orderedMetros}
            />
          ) : null}
        </div>

        <div className="rdm-pickrow">
          <div className="rdm-chips">
            {contests.map((c) => (
              <button
                key={c.raceId ?? c.label}
                className="rdm-chip"
                data-active={selected === c.raceId}
                onClick={() => setSelected(c.raceId ?? null)}
              >
                {c.label}
              </button>
            ))}
          </div>
          <div className="rdm-actions">
            <button
              className="rdm-action"
              disabled={!selectedContest}
              onClick={() => selectedContest && downloadReport(selectedContest)}
            >
              ↓ EXPORT REPORT
            </button>
            {selectedContest ? (
              <Link href={`/race/${selectedContest.raceId}`} className="rdm-action">
                RACE HUB →
              </Link>
            ) : (
              <span className="rdm-action rdm-action--disabled">RACE HUB →</span>
            )}
          </div>
        </div>

        <div className="rdm-detail">
          {selectedContest ? (
            <RaceDistrictCard contest={selectedContest} />
          ) : (
            <div className="rdm-empty">CLICK A COMPETITIVE DISTRICT</div>
          )}
        </div>
      </div>
    </div>
  );
}
