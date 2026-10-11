// HO 774 — the /search tabs, in a module that imports nothing. Moved verbatim
// from lib/queries.ts (which re-exports both, so its importers are unchanged):
// components/SearchTabs.tsx is a client component, and a value import from
// lib/queries.ts bundles that module's whole import graph for the browser, so
// one `node:` import anywhere in it fails `next build` on /search, as `node:fs`
// did at HO 773.

export const SEARCH_TABS = ["bills", "members", "news", "reports"] as const;
export type SearchTab = (typeof SEARCH_TABS)[number];
