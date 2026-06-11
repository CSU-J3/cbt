// HO 224: server-only congressional-district geometry. Mirrors lib/us-map-geo.ts
// — statically imports the committed cd119 TopoJSON (119th Congress, Census 20m
// cartographic boundary, simplified), projects each state to its OWN
// geoAlbers().fitSize() (NOT a slice of the national geoAlbersUsa composite —
// slicing a composite distorts), and emits plain <path d> strings so the client
// that renders them carries ZERO map-library code (the us-map-geo discipline).
//
// d3-geo / topojson-client must stay OFF the client bundle: only a *type* from
// here may be imported by a client component.
//
// The optional district-ID subset makes spec-3 Phase-2 metro panels a no-op
// extension — same code path, a different fitSize over fewer districts.
import { geoAlbers, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import cd119Topo from "@/lib/geo/cd119-topo.json";
import { STATE_FIPS_TO_ABBR } from "@/lib/states";

// Single-state fit canvas. The consuming surface scales the viewBox; the Albers
// fit handles centering + scale so the aspect just needs to be roomy.
const STATE_W = 800;
const STATE_H = 600;
const PAD = 12;

type DistrictProps = { STATEFP: string; CD119FP: string };

export type DistrictShape = {
  cd: string; // CD119FP, zero-padded 2-digit ("01"); "00" = at-large
  seatId: string | null; // {ST}-{DD}-{cycle}; null for at-large/render-only
  d: string; // SVG path
  cx: number; // projected centroid x (label anchor)
  cy: number; // projected centroid y
};

// HO 236: a metro inset panel — the same polygon shape as the overview (path +
// seatId), re-fit to its own subset extent via getStateDistrictGeometry's
// `subset`. The viewBox is the standard STATE_W×STATE_H canvas; the polygons
// fill it at the subset's fitExtent.
export type MetroPanelGeometry = {
  label: string;
  viewBox: string;
  polygons: DistrictShape[];
};

export type StateDistrictGeometry = {
  abbr: string;
  viewBox: string;
  atLarge: boolean; // single "00" district → render as a state outline
  districts: DistrictShape[];
  // HO 236: configured dense-state inset panels. Absent on stale 30-day cached
  // payloads (pre-236) → clients MUST treat as optional and render no panels.
  metros?: MetroPanelGeometry[];
};

// HO 224 step 5: 120th-Congress mid-decade redraw states. Their committed
// geometry is the 119th boundary (seat IDs are 119th-keyed, so clicks still
// resolve to the right race), but it does NOT match the actual Nov-2026 lines.
// The consuming modal MAY render state-outline + pick-chips here instead of the
// stale polygon. This HO only exposes the flag; default behavior draws the 119th
// polygon for every state.
export const DISPLAY_STALE_STATES: ReadonlySet<string> = new Set([
  "TX",
  "CA",
  "MO",
  "OH",
  "UT",
  "NC",
]);
export function isDisplayStale(abbr: string): boolean {
  return DISPLAY_STALE_STATES.has(abbr);
}

// Build the FeatureCollection once at module load (server-side), grouped by abbr.
const topo = cd119Topo as unknown as {
  objects: Record<string, unknown>;
};
const objectName = Object.keys(topo.objects)[0]!;
const fc = feature(
  topo as never,
  topo.objects[objectName] as never,
) as unknown as FeatureCollection<Geometry, DistrictProps>;

const byState = new Map<string, Feature<Geometry, DistrictProps>[]>();
for (const f of fc.features) {
  const abbr = STATE_FIPS_TO_ABBR[f.properties.STATEFP];
  if (!abbr) continue; // territory/delegate already filtered; defensive
  const list = byState.get(abbr);
  if (list) list.push(f);
  else byState.set(abbr, [f]);
}

// district → seat-ID. At-large ("00") returns null (render-only, no race row).
export function districtSeatId(
  abbr: string,
  cd119fp: string,
  cycle = 2026,
): string | null {
  if (cd119fp === "00") return null;
  return `${abbr}-${cd119fp}-${cycle}`;
}

// Inverse, for the pick-chip → highlight-polygon path. Parses the canonical
// {ST}-{DD}-{YYYY} House seat ID; returns null for Senate ("S-..") / malformed.
export function seatIdToDistrict(
  seatId: string,
): { abbr: string; cd: string } | null {
  const m = /^([A-Z]{2})-(\d{2})-\d{4}$/.exec(seatId);
  return m ? { abbr: m[1]!, cd: m[2]! } : null;
}

export function listDistrictStates(): string[] {
  return [...byState.keys()].sort();
}

// Per-state geometry, each fit to its OWN Albers projection. `subset` (a set of
// CD119FP codes) narrows to a metro cluster for Phase 2 — undefined = whole state.
export function getStateDistrictGeometry(
  abbr: string,
  subset?: ReadonlySet<string>,
): StateDistrictGeometry | null {
  const feats = byState.get(abbr);
  if (!feats || feats.length === 0) return null;

  const chosen = subset
    ? feats.filter((f) => subset.has(f.properties.CD119FP))
    : feats;
  if (chosen.length === 0) return null;

  const atLarge =
    feats.length === 1 && feats[0]!.properties.CD119FP === "00";

  const collection: FeatureCollection<Geometry, DistrictProps> = {
    type: "FeatureCollection",
    features: chosen,
  };
  const projection = geoAlbers().fitExtent(
    [
      [PAD, PAD],
      [STATE_W - PAD, STATE_H - PAD],
    ],
    collection as never,
  );
  const path = geoPath(projection);

  const districts: DistrictShape[] = chosen.map((f) => {
    const cd = f.properties.CD119FP;
    const [cx, cy] = path.centroid(f as never);
    return {
      cd,
      seatId: districtSeatId(abbr, cd),
      d: path(f as never) ?? "",
      cx,
      cy,
    };
  });

  return {
    abbr,
    viewBox: `0 0 ${STATE_W} ${STATE_H}`,
    atLarge,
    districts,
  };
}
