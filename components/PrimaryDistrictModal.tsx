"use client";

// HO 226: the PRIMARIES district modal — sibling of the HO 225 Races modal, same
// minimal shell (dimmed backdrop, amber panel, ×/click-away/Esc). State district
// overview (via the cached /api/races/district-geo/[state] route — geometry is
// chamber-agnostic, shared with Races), pick chips per district, and a two-party-
// column primary card in the detail panel. A scrubber row echoes the national
// month control. Map fills are recency (voted/not-yet/none) — NOT results-colored
// (HO 205 verdict; results-coloring is a later layer). No news anywhere.
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MetroLeaderLines, metroCenterX } from "@/components/MetroLeaderLines";
import { PrimaryDistrictCard } from "@/components/PrimaryDistrictCard";
import type { CartogramContest } from "@/lib/cartogram-data";
import type { DistrictShape, StateDistrictGeometry } from "@/lib/district-geo";
import { formatDateLong } from "@/lib/format";
import { STATE_ABBR_TO_NAME } from "@/lib/states";

export const SCRUB_SEGMENTS = [
  { label: "MAR", m: 3 },
  { label: "JUN", m: 6 },
  { label: "AUG", m: 8 },
  { label: "SEP", m: 9 },
] as const;

export function PrimaryScrubber({
  month,
  onMonth,
}: {
  month: number | null;
  onMonth: (m: number | null) => void;
}) {
  return (
    <div className="prim-scrubber" role="tablist" aria-label="primary month">
      {[...SCRUB_SEGMENTS, { label: "ALL", m: null }].map((seg) => (
        <button
          key={seg.label}
          type="button"
          className="prim-scrub-seg"
          data-active={month === seg.m}
          onClick={() => onMonth(seg.m)}
        >
          {seg.label}
        </button>
      ))}
    </div>
  );
}

// Group a state's primary contests by district key (raceId). A house district
// with a D + R primary yields two contests under one key → the card's two columns.
function groupByDistrict(contests: CartogramContest[]): Map<string, CartogramContest[]> {
  const m = new Map<string, CartogramContest[]>();
  for (const c of contests) {
    if (!c.raceId) continue;
    const arr = m.get(c.raceId);
    if (arr) arr.push(c);
    else m.set(c.raceId, [c]);
  }
  return m;
}

function districtLabel(label: string): string {
  return label.replace(/ [DR]$/, "");
}

function isVoted(cs: CartogramContest[]): boolean {
  return cs.some((c) => c.primary?.candidates.some((x) => x.vote_pct != null));
}

function buildReport(districtKey: string, cs: CartogramContest[]): string {
  const L: string[] = [`# ${districtLabel(cs[0]!.label)} — 2026 primary report`, ""];
  for (const c of cs) {
    const p = c.primary;
    if (!p) continue;
    const head = p.party === "D" ? "DEM PRIMARY" : p.party === "R" ? "REP PRIMARY" : "OPEN PRIMARY";
    L.push(`## ${head}`);
    const voted = p.candidates.some((x) => x.vote_pct != null);
    if (!voted) {
      L.push(`- SCHEDULED · votes ${p.primary_date ?? "TBD"}`);
      for (const x of p.candidates) L.push(`- ${x.name} [${x.party}]${x.incumbent ? " (incumbent)" : ""}`);
    } else {
      const sorted = [...p.candidates].sort((a, b) => (b.vote_pct ?? 0) - (a.vote_pct ?? 0));
      for (const x of sorted)
        L.push(`- ${x.name} [${x.party}] — ${x.vote_pct != null ? x.vote_pct.toFixed(1) + "%" : "—"}${x.status === "winner" ? " ★ advanced" : ""}`);
    }
    L.push("");
  }
  return L.join("\n").trimEnd() + "\n";
}

export function PrimaryDistrictModal({
  abbr,
  contests,
  month,
  onMonth,
  onClose,
}: {
  abbr: string;
  contests: CartogramContest[];
  month: number | null;
  onMonth: (m: number | null) => void;
  onClose: () => void;
}) {
  const [geo, setGeo] = useState<StateDistrictGeometry | null>(null);
  const [selected, setSelected] = useState<string | null>(null); // raceId
  const [hovered, setHovered] = useState<string | null>(null);
  const bandRef = useRef<HTMLDivElement | null>(null);
  const overviewSvgRef = useRef<SVGSVGElement | null>(null);

  const byDistrict = groupByDistrict(contests);
  const districtKeys = [...byDistrict.keys()]; // contest order (senate-first)

  // HO 237: order the inset row left→right by source-region x-center.
  const orderedMetros = [...(geo?.metros ?? [])].sort(
    (a, b) => metroCenterX(a) - metroCenterX(b),
  );

  useEffect(() => {
    let alive = true;
    fetch(`/api/races/district-geo/${abbr}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setGeo(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [abbr]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const stateName = STATE_ABBR_TO_NAME[abbr] ?? abbr;
  const selectedContests = selected ? byDistrict.get(selected) ?? null : null;

  // Shared polygon render (recency fill) — used by the state overview AND each
  // HO 236 metro inset, so selection syncs across overview ↔ panels ↔ chips.
  const renderDistricts = (polys: DistrictShape[]) => (
    <>
      {polys.map((d) => {
        const cs = d.seatId ? byDistrict.get(d.seatId) : undefined;
        const has = !!cs && cs.length > 0;
        const voted = has && isVoted(cs);
        const sel = !!selected && d.seatId === selected;
        const hov = !!hovered && d.seatId === hovered;
        return (
          <path
            key={d.cd}
            d={d.d}
            fill={!has ? "#11161f" : voted ? "#0e7490" : "#b45309"}
            stroke={
              sel ? "var(--accent-amber-bright)" : hov && has ? "var(--accent-amber)" : "#0a0e14"
            }
            strokeWidth={sel ? 2 : hov && has ? 1.5 : 0.6}
            style={has ? { cursor: "pointer" } : undefined}
            onClick={has ? () => setSelected(d.seatId) : undefined}
            onMouseEnter={has ? () => setHovered(d.seatId) : undefined}
            onMouseLeave={has ? () => setHovered((h) => (h === d.seatId ? null : h)) : undefined}
          >
            <title>{d.cd + (has ? (voted ? " · voted" : " · upcoming") : "")}</title>
          </path>
        );
      })}
      {polys.map((d) => {
        const has = d.seatId ? byDistrict.has(d.seatId) : false;
        return (
          <text
            key={`l${d.cd}`}
            x={d.cx}
            y={d.cy}
            className="rdm-dlabel"
            fill={has ? "#e5e7eb" : "#475569"}
            pointerEvents="none"
          >
            {d.cd}
          </text>
        );
      })}
    </>
  );

  function downloadReport() {
    if (!selected || !selectedContests) return;
    const blob = new Blob([buildReport(selected, selectedContests)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${districtLabel(selectedContests[0]!.label).replace(/\s+/g, "-")}-primary-report.md`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="rdm-backdrop" onClick={onClose}>
      <div
        className="rdm-panel"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={`${stateName} primaries`}
      >
        <div className="rdm-header">
          <div>
            <div className="rdm-title">
              {stateName.toUpperCase()} · {districtKeys.length} PRIMARY CONTEST
              {districtKeys.length === 1 ? "" : "S"}
            </div>
            <div className="rdm-sub">2026 PRIMARY · CLICK A DISTRICT ON THE MAP</div>
          </div>
          <button className="rdm-close" onClick={onClose} aria-label="close">
            ×
          </button>
        </div>

        <div className="rdm-scrubrow">
          <PrimaryScrubber month={month} onMonth={onMonth} />
        </div>

        {/* HO 237: positioned band wrapping overview + insets for the overlay. */}
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

          {/* HO 236 metro insets — same band as the Races modal (DUPLICATED
              render, different fill rule). HO 237 reorders L→R + adds the leader
              lines below. Null-safe on stale caches / unconfigured states. */}
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
            {districtKeys.map((k) => {
              const cs = byDistrict.get(k)!;
              return (
                <button
                  key={k}
                  className="rdm-chip"
                  data-active={selected === k}
                  onClick={() => setSelected(k)}
                >
                  {districtLabel(cs[0]!.label)}
                </button>
              );
            })}
          </div>
          <div className="rdm-actions">
            <button className="rdm-action" disabled={!selectedContests} onClick={downloadReport}>
              ↓ EXPORT REPORT
            </button>
            {selectedContests?.[0]?.href ? (
              <Link href={selectedContests[0].href} className="rdm-action">
                RACE HUB →
              </Link>
            ) : (
              <span className="rdm-action rdm-action--disabled">RACE HUB →</span>
            )}
          </div>
        </div>

        <div className="rdm-detail">
          {selectedContests ? (
            <PrimaryDistrictCard contests={selectedContests} />
          ) : (
            <div className="rdm-empty">CLICK A DISTRICT</div>
          )}
        </div>
      </div>
    </div>
  );
}
