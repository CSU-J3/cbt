// HO 210 Pass 1: literal US-map geometry for the /races + /primaries choropleth
// index. SERVER-ONLY — it statically imports the ~1 MB us-atlas topology and the
// d3-geo / topojson-client libs, all of which must stay OFF the client bundle.
// The pages call getUsMapGeometry() (server) and pass the serializable result
// into CartogramShell, which renders plain <path>/<text> SVG.
//
// Projection note (settled at build, not assumed): us-atlas@3 states-10m ships
// UNPROJECTED (raw lat/long — bbox ≈ [-179..179, -14..71]), so we apply
// geoAlbersUsa().fitSize ourselves. (Some us-atlas builds are pre-projected to
// 975×610; this one is not — verified by probing centroid ranges.) geoAlbersUsa
// composites the AK/HI insets and drops the 5 territories (PR/GU/AS/VI/MP) to a
// null path, so they fall out cleanly — the rendered set is the 50 states + DC.
//
// Name-join (handoff finding #3): the topology keys on the FULL state name
// (properties.name = "Pennsylvania" / "District of Columbia"); the cartogram
// cells key on the 2-letter abbr. We bridge via STATE_NAME_TO_ABBR. Any feature
// whose name doesn't resolve is warned (so no state silently renders uncolored).

import { geoAlbersUsa, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import { STATE_NAME_TO_ABBR } from "@/lib/states";
import statesTopo from "us-atlas/states-10m.json";

export type UsMapState = {
  abbr: string;
  name: string;
  d: string; // SVG path
  cx: number;
  cy: number;
};

export type UsMapLeaderLabel = {
  abbr: string;
  x: number; // gutter label anchor
  y: number;
  cx: number; // state centroid (leader line origin)
  cy: number;
};

export type UsMapGeometry = {
  viewBox: string;
  width: number;
  mapWidth: number;
  height: number;
  states: UsMapState[];
  leaderLabels: UsMapLeaderLabel[];
};

const MAP_W = 975;
const MAP_H = 610;
const GUTTER = 168; // right column that holds the NE leader-line labels
const LABEL_X = MAP_W + 20;

// Small / dense-corner states whose polygon is too small to hover or label in
// place — they get a leader line out to a stacked right-edge label column.
const LEADER_STATES = new Set([
  "VT",
  "NH",
  "MA",
  "RI",
  "CT",
  "NJ",
  "DE",
  "MD",
  "DC",
]);

let _cache: UsMapGeometry | null = null;

export function getUsMapGeometry(): UsMapGeometry {
  if (_cache) return _cache;

  // topojson-specification's Topology type isn't installed; cast loosely.
  const topo = statesTopo as unknown as Parameters<typeof feature>[0];
  const fc = feature(topo, (topo as { objects: Record<string, unknown> }).objects
    .states as never) as unknown as {
    features: Array<{ properties: { name: string } }>;
  };

  const projection = geoAlbersUsa();
  // fitSize over the whole collection — albersUsa drops the territories from its
  // stream, so the fitted bounds are the 50 states + DC + AK/HI insets.
  projection.fitSize([MAP_W, MAP_H], fc as never);
  const path = geoPath(projection);

  const states: UsMapState[] = [];
  const unresolved: string[] = [];
  const dropped: string[] = [];
  for (const f of fc.features) {
    const name = f.properties?.name;
    const d = path(f as never);
    if (!d) {
      // territory / outside albersUsa composite — intentionally not rendered
      dropped.push(name);
      continue;
    }
    const abbr = STATE_NAME_TO_ABBR[name];
    if (!abbr) {
      unresolved.push(name);
      continue;
    }
    const c = path.centroid(f as never);
    if (!Number.isFinite(c[0]) || !Number.isFinite(c[1])) continue;
    states.push({ abbr, name, d, cx: c[0], cy: c[1] });
  }

  if (unresolved.length) {
    console.warn(
      `[us-map-geo] name-join MISS (no abbr, would render uncolored): ${unresolved.join(", ")}`,
    );
  }
  // dropped territories are expected (PR/GU/AS/VI/MP) — log once for the record.
  if (dropped.length) {
    console.info(`[us-map-geo] dropped (outside albersUsa): ${dropped.join(", ")}`);
  }

  // Leader labels: north→south by centroid y so the lines never cross. The
  // stack HUGS the actual latitude cluster (these 9 states' centroids span only
  // ~y130–265) rather than the full map height — otherwise even-spacing over
  // 64..574 stretched the southern labels far below their origins (DC ended at
  // y574, a 310px diagonal leader to empty bottom-right space — the "stray DC
  // label" finding). We center the stack on the cluster's mean cy and only
  // expand it to the minimum needed to keep labels from overlapping, so DC sits
  // just below MD with a short leader.
  const leaderStates = states
    .filter((s) => LEADER_STATES.has(s.abbr))
    .sort((a, b) => a.cy - b.cy);
  const cys = leaderStates.map((s) => s.cy);
  const MIN_STEP = 26; // px between stacked labels (no overlap at 15px text)
  const meanCy = cys.reduce((a, b) => a + b, 0) / (cys.length || 1);
  const naturalSpan = cys.length ? Math.max(...cys) - Math.min(...cys) : 0;
  const span = Math.max(naturalSpan, (leaderStates.length - 1) * MIN_STEP);
  let top = meanCy - span / 2;
  top = Math.max(40, Math.min(top, MAP_H - 40 - span)); // keep within the map
  const step = leaderStates.length > 1 ? span / (leaderStates.length - 1) : 0;
  const leaderLabels: UsMapLeaderLabel[] = leaderStates.map((s, i) => ({
    abbr: s.abbr,
    x: LABEL_X,
    y: top + step * i,
    cx: s.cx,
    cy: s.cy,
  }));

  _cache = {
    viewBox: `0 0 ${MAP_W + GUTTER} ${MAP_H}`,
    width: MAP_W + GUTTER,
    mapWidth: MAP_W,
    height: MAP_H,
    states,
    leaderLabels,
  };
  return _cache;
}
