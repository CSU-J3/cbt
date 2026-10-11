// HO 773 — a Ballotpedia title or link as a comparable key, in a module that
// imports nothing. Moved here from lib/primary-candidates-scrape.ts (which
// re-exports all three, so its importers are unchanged) when the incumbent
// qualifier (lib/incumbent-qualifier.ts) began keying a member's title: the
// qualifier reaches client bundles through lib/queries.ts (components/
// SearchTabs.tsx imports SEARCH_TABS from it), and the scrape module's
// `node:fs` import fails a browser chunk. Turbopack: "the chunking context
// (unknown) does not support external modules (request: node:fs)", on
// /search/page at 0a7725e's Preview.

export function decodeEntities(s: string): string {
  return s
    .replace(/&#0?39;/g, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#0?34;/g, '"')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "-")
    .trim();
}

// ── identity ───────────────────────────────────────────────────────────────
// A person link's title, as a comparable key: HTML entities decoded (reading the
// attribute), the origin dropped, percent-decoded, spaces as underscores. The
// stored side is `https://ballotpedia.org/` + the member's title (HO 751:
// COALESCE(ballotpedia_title_resolved, ballotpedia_title)) through the same
// function, so both sides are percent-decoded before they are compared. This key
// is `general_ballot.person_key` and, since HO 764, `primary_candidates.person_key`.
// Moved to lib/primary-candidates-scrape.ts from lib/general-ballot.ts at HO 764
// (which re-exports both), so the primary parser can key its rows without
// importing the reader, which imports that file; and here at HO 773.
const BP = "https://ballotpedia.org/";
export function hrefKey(href: string | null | undefined): string | null {
  if (!href) return null;
  let s = decodeEntities(href);
  if (s.startsWith(BP)) s = s.slice(BP.length);
  try {
    s = decodeURIComponent(s);
  } catch {
    // a malformed escape stays raw rather than failing the page
  }
  return s.replace(/ /g, "_");
}
export const titleKey = (title: string) => hrefKey(BP + title.replace(/ /g, "_"));
