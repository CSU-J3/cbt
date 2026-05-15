export type ClusterPattern = {
  id: string;
  name: string;
  description: string;
  regex: RegExp;
  billTypes?: string[];
};

// Order matters: first match wins. CRA + facility-naming lead because they're
// the most specific signatures. Honoring sits last because it's the broadest.
export const CLUSTER_PATTERNS: ClusterPattern[] = [
  {
    id: "cra-disapproval",
    name: "CRA disapproval",
    description:
      "Resolutions disapproving a federal rule under the Congressional Review Act.",
    regex: /providing for congressional disapproval under chapter 8 of title 5/i,
    billTypes: ["hjres", "sjres"],
  },
  {
    id: "facility-naming",
    name: "Facility naming",
    description:
      "Bills designating or renaming post offices, federal buildings, courthouses, VA centers, ATC towers, and similar facilities.",
    // Calibrated against handoff 52 sample. Original required ≥1 char
    // between "the " and the facility-type word, but real titles are
    // "to designate the facility of USPS..." with "facility" flush after
    // "the". The corpus also uses "to name the VA clinic..." for VA
    // facility renamings. Anchor on the verb + a quoted target name
    // (`as (the )?"`) — substantive bills phrase the target with an
    // article ("as a transnational organized crime group", "as an
    // authorized flag", "as components of the Wilderness Preservation
    // System") so they fail the quote anchor. Misses unquoted renamings
    // (e.g. "as Denali") — acceptable trade-off; the structural quote
    // signal keeps false-positive rate low.
    regex: /^(a bill )?to (designate|rename|name) .+ as (the )?"/i,
  },
  {
    id: "awareness-designation",
    name: "Awareness designation",
    description:
      "Resolutions designating, recognizing, or supporting a Day, Week, or Month for a cause.",
    // Three anchor phrases ("designation of", "recognition of",
    // "goals and ideals of") plus "designating/recognizing ... as" forms.
    // Bare "recognizing" without "as" would catch honoring resolutions
    // ("Recognizing John Smith on his 90th birthday"); the "as" gate keeps
    // those out. \b on (day|week|month) prevents "birthday" from matching.
    regex:
      /(designation of|recognition of|goals and ideals of|designating .+? as|recognizing .+? as) .+?\b(day|week|month)\b/i,
  },
  {
    id: "sense-of-congress",
    name: "Sense of Congress",
    description:
      "Resolutions expressing the sense of the House, Senate, or Congress without legal effect.",
    regex: /^(expressing the sense|a resolution expressing the sense) of/i,
  },
  {
    id: "honoring-resolution",
    name: "Honoring resolution",
    description:
      "Resolutions honoring, recognizing, celebrating, commemorating, or congratulating individuals, groups, or events.",
    regex: /^(honoring|recognizing|celebrating|commemorating|congratulating) /i,
  },
];

export const CLUSTER_IDS = new Set<string>(CLUSTER_PATTERNS.map((p) => p.id));

export function classifyCluster(title: string, billType: string): string | null {
  for (const p of CLUSTER_PATTERNS) {
    if (p.billTypes && !p.billTypes.includes(billType)) continue;
    if (p.regex.test(title)) return p.id;
  }
  return null;
}

export function getClusterPattern(id: string): ClusterPattern | undefined {
  return CLUSTER_PATTERNS.find((p) => p.id === id);
}
