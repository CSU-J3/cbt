// US state and territory full-name ↔ two-letter postal code lookups.
// Single source of truth used by sync-members (name → abbr when normalizing
// Congress.gov data into `members.state`) and by race-page rendering
// (abbr → name when composing "Colorado 8th Congressional District").

export const STATE_NAME_TO_ABBR: Record<string, string> = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR",
  California: "CA", Colorado: "CO", Connecticut: "CT", Delaware: "DE",
  Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID",
  Illinois: "IL", Indiana: "IN", Iowa: "IA", Kansas: "KS",
  Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD",
  Massachusetts: "MA", Michigan: "MI", Minnesota: "MN", Mississippi: "MS",
  Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV",
  "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM",
  "New York": "NY", "North Carolina": "NC", "North Dakota": "ND",
  Ohio: "OH", Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA",
  "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
  Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT",
  Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY",
  "District of Columbia": "DC",
  "American Samoa": "AS", Guam: "GU", "Northern Mariana Islands": "MP",
  "Puerto Rico": "PR", "Virgin Islands": "VI",
};

export const STATE_ABBR_TO_NAME: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAME_TO_ABBR).map(([name, abbr]) => [abbr, name]),
);

export function stateAbbr(name: string | null | undefined): string | null {
  if (!name) return null;
  return STATE_NAME_TO_ABBR[name] ?? null;
}

// Falls back to the abbreviation itself for unknown codes — keeps the UI
// rendering something stable rather than an empty string. Live data should
// always be present in the map; the fallback covers display layers that
// receive untrusted input (URL slugs, etc.).
export function stateName(abbr: string | null | undefined): string {
  if (!abbr) return "";
  return STATE_ABBR_TO_NAME[abbr] ?? abbr;
}
