// HO 225 — per-state district geometry for the /races district modal. The
// projection (lib/district-geo.ts) is server-only (d3-geo + the cd119 TopoJSON
// must stay off the client bundle), so the client modal fetches path strings
// from here on open, matching the /api/bill/[id]/panel lazy pattern.
//
// CACHED: the geometry is fully static per state (derived from a committed
// asset), so it must project ONCE and be served from cache thereafter — never
// reproject on every modal-open. unstable_cache keyed by state, long revalidate,
// tag "district-geo" (invalidate only if the committed asset is ever replaced).
import { unstable_cache } from "next/cache";
import { NextResponse } from "next/server";
import {
  getStateDistrictGeometry,
  type MetroPanelGeometry,
  overviewBoxForSubset,
} from "@/lib/district-geo";
import { metroPanelsForState } from "@/lib/metro-panels";
import { STATE_FIPS_TO_ABBR } from "@/lib/states";

const VALID_ABBRS = new Set(Object.values(STATE_FIPS_TO_ABBR));

// HO 236: the base overview geometry plus any configured metro inset panels,
// each re-fit through the same subset parameter (no new projection path). Same
// cache wrapper / tag / per-state key — extending the payload, not the key.
const getCachedStateGeometry = unstable_cache(
  async (abbr: string) => {
    const base = getStateDistrictGeometry(abbr);
    if (!base) return null;
    const metros: MetroPanelGeometry[] = [];
    for (const panel of metroPanelsForState(abbr)) {
      const subset = new Set(panel.districtIds);
      const sub = getStateDistrictGeometry(abbr, subset);
      if (sub) {
        metros.push({
          label: panel.label,
          viewBox: sub.viewBox,
          polygons: sub.districts,
          // HO 237: source region in overview coords (the rect + leader-line
          // anchor). Same projection as the base overview above.
          overviewBox: overviewBoxForSubset(abbr, subset) ?? undefined,
        });
      }
    }
    return { ...base, ...(metros.length > 0 ? { metros } : {}) };
  },
  ["district-geo"],
  { revalidate: 60 * 60 * 24 * 30, tags: ["district-geo"] },
);

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ state: string }> },
) {
  const { state } = await params;
  const abbr = state.toUpperCase();
  if (!VALID_ABBRS.has(abbr)) {
    return NextResponse.json({ error: "unknown state" }, { status: 400 });
  }
  const geometry = await getCachedStateGeometry(abbr);
  if (!geometry) {
    return NextResponse.json({ error: "no geometry" }, { status: 404 });
  }
  return NextResponse.json(geometry);
}
