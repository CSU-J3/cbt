// HO 236 (spec-3 Phase 2) — metro-zoom panel config. Pure DATA: which dense-state
// district clusters get an inset panel at their own fitSize so districts that
// render too small to click at the state-overview fit (< the diagnostic's ~22px
// floor) become comfortably clickable. Seeded from
// scripts/diagnostic/metro-bbox-236.ts (the measurement gate): every flagged
// competitive district lands in some panel; panels add nearby competitive
// neighbors for a coherent local map. Cap: 2 panels per state.
//
// No rendering logic here — the [state] geometry route re-fits each panel via
// getStateDistrictGeometry's existing `subset` parameter (HO 224 Decision 1).
// districtIds are CD119FP codes (zero-padded 2-digit).
export type MetroPanelConfig = {
  state: string;
  label: string;
  districtIds: string[];
};

export const METRO_PANELS: readonly MetroPanelConfig[] = [
  // CA — 3 flag clusters merged to 2 (the cap): SoCal, and a Central Valley +
  // Sacramento strip (the two closest NorCal clusters).
  { state: "CA", label: "SOUTHERN CALIFORNIA", districtIds: ["40", "45"] },
  // CD06 (Sacramento) is geographically isolated from CA's other flags (OC + the
  // Central Valley), so within the 2-panel cap it can only ride a valley panel
  // spanning Sacramento→Fresno. CD13 (Stockton) sits between for context. CD06
  // reaches ~15px in the inset (≈2× its 8px overview) — the one flag that can't
  // hit the full 22px floor without a 3rd CA panel; documented, not forced.
  { state: "CA", label: "CENTRAL CALIFORNIA", districtIds: ["06", "13", "21"] },
  // FL — Miami-Dade/Broward, and Tampa Bay.
  { state: "FL", label: "SOUTH FLORIDA", districtIds: ["22", "23", "25", "27"] },
  { state: "FL", label: "TAMPA BAY", districtIds: ["13", "14", "16"] },
  // MI — the competitive lower peninsula spreads west↔east; two tight panels
  // zoom the flagged CD03 (Grand Rapids) and CD10 (Macomb/Detroit) past the floor.
  { state: "MI", label: "WEST MICHIGAN", districtIds: ["03", "04"] },
  { state: "MI", label: "DETROIT METRO", districtIds: ["07", "08", "10"] },
  // MO — Kansas City (CD05). Lone competitive flag; CD02 (the other competitive
  // MO seat) is across the state, so a single-district panel.
  { state: "MO", label: "KANSAS CITY", districtIds: ["05"] },
  // NV — Las Vegas / Clark County.
  { state: "NV", label: "LAS VEGAS", districtIds: ["01", "03"] },
  // NY — Long Island (Nassau/Suffolk).
  { state: "NY", label: "LONG ISLAND", districtIds: ["02", "03", "04"] },
  // TX — Houston (CD02/09 + Fort Bend CD22), and Dallas (CD32).
  { state: "TX", label: "HOUSTON", districtIds: ["02", "09"] },
  { state: "TX", label: "DALLAS", districtIds: ["32"] },
] as const;

// Panels for a state (≤2), in config order. Empty for unconfigured states.
export function metroPanelsForState(abbr: string): MetroPanelConfig[] {
  return METRO_PANELS.filter((p) => p.state === abbr);
}
