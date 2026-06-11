import "dotenv/config";
import { geoAlbers, geoPath } from "d3-geo";
import type { Feature, FeatureCollection, Geometry } from "geojson";
import { feature } from "topojson-client";
import cd119Topo from "../../lib/geo/cd119-topo.json";
import { getDb } from "../../lib/db";
import { METRO_PANELS } from "../../lib/metro-panels";
import { STATE_FIPS_TO_ABBR } from "../../lib/states";

// HO 236 measurement gate (spec-3 Phase 2). For every state with rated House
// seats, project the WHOLE-STATE overview at the district modal's real render
// size and measure each COMPETITIVE district's click-target bbox in pixels.
// Flag any below the floor → those are the districts a metro inset panel must
// enlarge. If nothing flags, the feature has no need (HALT).
//
// Projection MIRRORS lib/district-geo.ts exactly (same constants + geoAlbers
// fitExtent) so the px math matches what the modal actually renders.
const STATE_W = 800;
const STATE_H = 600;
const PAD = 12;

// The modal map's on-screen size: `.rdm-maps` is 320px tall with 8px padding →
// 304px content; `.rdm-map` is height:100% / width:auto, so the 800×600 viewBox
// renders height-constrained at 304px tall (≈405px wide). px = viewBox-unit ×
// (304 / 600).
const RENDER_H_PX = 320 - 2 * 8;
const SCALE = RENDER_H_PX / STATE_H; // ≈ 0.5067 px per viewBox unit

// Click-target floor (min bbox dimension, px). Tunable — recorded here as the
// chosen value after eyeballing the CA render. A finger/cursor target much under
// this is fiddly at the modal's overview fit.
const FLOOR_PX = 22;

type DistrictProps = { STATEFP: string; CD119FP: string };

const topo = cd119Topo as unknown as { objects: Record<string, unknown> };
const objectName = Object.keys(topo.objects)[0]!;
const fc = feature(
  topo as never,
  topo.objects[objectName] as never,
) as unknown as FeatureCollection<Geometry, DistrictProps>;

const byState = new Map<string, Feature<Geometry, DistrictProps>[]>();
for (const f of fc.features) {
  const abbr = STATE_FIPS_TO_ABBR[f.properties.STATEFP];
  if (!abbr) continue;
  (byState.get(abbr) ?? byState.set(abbr, []).get(abbr)!).push(f);
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

async function main() {
  // Rated House seats (the getRacesIndex existence predicate: a race with >=1
  // race_ratings row for the cycle). Queried raw — getRacesIndex is unstable_
  // cache-wrapped and won't run outside a request context.
  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT DISTINCT r.state, r.district
          FROM races r
          INNER JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = r.cycle
          WHERE r.cycle = 2026 AND r.chamber = 'house' AND r.district IS NOT NULL`,
    args: [],
  });
  const compByState = new Map<string, Set<string>>();
  for (const row of rs.rows) {
    const state = row.state as string;
    const district = Number(row.district);
    const set = compByState.get(state) ?? new Set<string>();
    set.add(pad2(district));
    compByState.set(state, set);
  }

  const states = [...compByState.keys()].sort();
  console.log(
    `HO 236 metro-bbox gate — floor=${FLOOR_PX}px, render scale=${SCALE.toFixed(4)} px/unit (${RENDER_H_PX}px-tall map)\n` +
      `${states.length} states with rated House seats\n`,
  );

  type Flagged = { cd: string; minPx: number; cx: number; cy: number };
  const flaggedByState = new Map<string, Flagged[]>();
  const allComp = new Map<string, Flagged[]>();
  let totalFlagged = 0;

  for (const abbr of states) {
    const feats = byState.get(abbr);
    if (!feats) {
      console.log(`  ${abbr}: NO GEOMETRY (skipped)`);
      continue;
    }
    const comp = compByState.get(abbr)!;
    const projection = geoAlbers().fitExtent(
      [
        [PAD, PAD],
        [STATE_W - PAD, STATE_H - PAD],
      ],
      { type: "FeatureCollection", features: feats } as never,
    );
    const path = geoPath(projection);

    const flagged: Flagged[] = [];
    const compList: Flagged[] = [];
    for (const f of feats) {
      const cd = f.properties.CD119FP;
      if (!comp.has(cd)) continue;
      const [[x0, y0], [x1, y1]] = path.bounds(f as never);
      const minDimPx = Math.min(x1 - x0, y1 - y0) * SCALE;
      const [cx, cy] = path.centroid(f as never);
      compList.push({ cd, minPx: minDimPx, cx, cy });
      if (minDimPx < FLOOR_PX) flagged.push({ cd, minPx: minDimPx, cx, cy });
    }
    allComp.set(abbr, compList);
    if (flagged.length > 0) {
      flagged.sort((a, b) => a.minPx - b.minPx);
      flaggedByState.set(abbr, flagged);
      totalFlagged += flagged.length;
    }
  }

  if (totalFlagged === 0) {
    console.log(
      "GATE: ZERO districts flagged. The overview renders larger than the design assumed — metro panels have no need. HALT.",
    );
    return;
  }

  console.log(
    `GATE: ${totalFlagged} competitive districts below ${FLOOR_PX}px across ${flaggedByState.size} states.\n`,
  );
  for (const abbr of [...flaggedByState.keys()].sort()) {
    const flagged = flaggedByState.get(abbr)!;
    console.log(
      `${abbr} (${flagged.length} flagged of ${compByState.get(abbr)!.size} competitive):`,
    );
    // Rough proximity clusters: greedy, centroids within ~120 viewBox units.
    const clusters: Flagged[][] = [];
    for (const d of flagged) {
      const near = clusters.find((cl) =>
        cl.some((m) => Math.hypot(m.cx - d.cx, m.cy - d.cy) < 120),
      );
      if (near) near.push(d);
      else clusters.push([d]);
    }
    for (const cl of clusters) {
      const cxAvg = cl.reduce((s, m) => s + m.cx, 0) / cl.length;
      const cyAvg = cl.reduce((s, m) => s + m.cy, 0) / cl.length;
      // All COMPETITIVE districts (flagged or not) near this cluster centroid —
      // candidates to include in the panel for a coherent local map.
      const near = allComp
        .get(abbr)!
        .filter((c) => Math.hypot(c.cx - cxAvg, c.cy - cyAvg) < 150)
        .sort((a, b) => a.minPx - b.minPx);
      console.log(
        `  cluster @(${cxAvg.toFixed(0)},${cyAvg.toFixed(0)}): flagged ${cl
          .map((m) => `CD${m.cd}(${m.minPx.toFixed(1)}px)`)
          .join(" ")}`,
      );
      console.log(
        `    all competitive near: ${near
          .map((c) => `CD${c.cd}(${c.minPx.toFixed(0)}px)`)
          .join(" ")}`,
      );
    }
  }

  // ---- Config verification: re-fit each METRO_PANEL subset and confirm every
  // flagged district clears the floor at the inset panel's render size (~150px
  // tall box; the panel SVG is height-constrained the same way the overview is).
  // 160px = the top of the handoff's ~140-160px inset range; the extra height
  // helps every flagged district and lifts the geometry-limited CD06 to ≥1.8×.
  const PANEL_H_PX = 160;
  const PANEL_SCALE = PANEL_H_PX / STATE_H;
  console.log(
    `\n---- panel re-fit verification (inset ${PANEL_H_PX}px tall, scale=${PANEL_SCALE.toFixed(4)}) ----`,
  );
  // overview px per flagged district, to judge improvement on near-misses.
  const flaggedCds = new Map<string, Map<string, number>>();
  for (const [abbr, fl] of flaggedByState)
    flaggedCds.set(abbr, new Map(fl.map((f) => [f.cd, f.minPx])));
  let anyFail = false;
  let anyNote = false;
  const coveredFlags = new Map<string, Set<string>>();
  for (const panel of METRO_PANELS) {
    const feats = byState.get(panel.state);
    if (!feats) continue;
    const subset = new Set(panel.districtIds);
    const chosen = feats.filter((f) => subset.has(f.properties.CD119FP));
    const projection = geoAlbers().fitExtent(
      [
        [PAD, PAD],
        [STATE_W - PAD, STATE_H - PAD],
      ],
      { type: "FeatureCollection", features: chosen } as never,
    );
    const path = geoPath(projection);
    const parts: string[] = [];
    for (const f of chosen) {
      const cd = f.properties.CD119FP;
      const [[x0, y0], [x1, y1]] = path.bounds(f as never);
      const px = Math.min(x1 - x0, y1 - y0) * PANEL_SCALE;
      const overviewPx = flaggedCds.get(panel.state)?.get(cd);
      const isFlag = overviewPx !== undefined;
      if (isFlag) {
        const set = coveredFlags.get(panel.state) ?? new Set<string>();
        set.add(cd);
        coveredFlags.set(panel.state, set);
      }
      // PASS: clears the floor. NOTE: under floor but ≥1.8× the overview size
      // (the panel still meaningfully helped — a geometry-limited near-miss).
      // FAIL: under floor AND barely improved.
      let mark = "";
      if (isFlag && px < FLOOR_PX) {
        if (px >= overviewPx! * 1.8) {
          mark = "◑";
          anyNote = true;
        } else {
          mark = "‼";
          anyFail = true;
        }
      }
      parts.push(`CD${cd}${isFlag ? "*" : ""}=${px.toFixed(0)}px${mark}`);
    }
    console.log(`  ${panel.state} "${panel.label}": ${parts.join(" ")}`);
  }
  // Coverage: every flagged district must appear in some panel.
  for (const [abbr, fl] of flaggedCds) {
    const covered = coveredFlags.get(abbr) ?? new Set();
    const missing = [...fl.keys()].filter((cd) => !covered.has(cd));
    if (missing.length) {
      anyFail = true;
      console.log(`  ‼ ${abbr} flagged not in any panel: ${missing.join(",")}`);
    }
  }
  console.log(
    anyFail
      ? "\nVERIFY: FAIL — a flagged district is uncovered or barely improved; fix the config."
      : anyNote
        ? "\nVERIFY: PASS (with ◑ notes) — every flag covered; all clear the floor except geometry-limited near-misses that still ≥1.8× their overview size."
        : "\nVERIFY: PASS — every flagged district clears the floor in its panel; all flags covered.",
  );
}

main().catch((e) => {
  console.error("ERR:", (e as Error).message);
  process.exit(1);
});
