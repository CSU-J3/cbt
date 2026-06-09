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

// FIPS state code → postal abbr (HO 224). The Census cd119 geometry keys
// districts by STATEFP (FIPS, e.g. "37"); the `/races` seat IDs key by abbr
// ("NC"), so the district→seat join needs this bridge. 50 states + DC; the
// committed geometry already drops DC + territories, so only the 50 states are
// exercised, but DC is mapped for defensiveness.
export const STATE_FIPS_TO_ABBR: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO",
  "09": "CT", "10": "DE", "11": "DC", "12": "FL", "13": "GA", "15": "HI",
  "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY",
  "22": "LA", "23": "ME", "24": "MD", "25": "MA", "26": "MI", "27": "MN",
  "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH",
  "40": "OK", "41": "OR", "42": "PA", "44": "RI", "45": "SC", "46": "SD",
  "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA",
  "54": "WV", "55": "WI", "56": "WY",
};

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
