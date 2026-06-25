// HO 185 — maps a page's basePath (the route identity every page already hands
// to HeaderBar) to the PowerShell-path breadcrumb segments rendered in the
// unified masthead: `Congressional Terminal:\ 119TH \ <segments> >_`. Returns the
// SECTION segments only — the congress root ("119TH") is prepended by
// BreadcrumbMasthead, and detail-page labels (HR 9081, a member last name, a
// committee name, …) are appended via `opts.detail` since they need data the
// page already fetched (no new queries).
//
// IA notes baked in here: Committees nests under Members; Primaries under
// Races; Trends/Stale under Patterns; Changes + President are legislation views
// (Legislation \ Changes / Legislation \ President); Reports is its own top-level
// section. NOTE: the display label is "Legislation" (HO 362 rename); the route
// stays /bills and the `mode`/key identifiers stay "bills".

export type BreadcrumbOpts = {
  // /bills tracks its toggle: bills → "Legislation", news → "News".
  mode?: "bills" | "news";
  // The /bills?stage=president alias view → "Legislation \ President".
  presidentAlias?: boolean;
  // Detail-page last segment (bill number, member last name, race label,
  // committee name, report title). Appended after the section.
  detail?: string;
};

function sectionFor(basePath: string, mode?: "bills" | "news"): string[] {
  if (basePath === "/") return ["Dashboard"];
  // "/bills" exact must precede the "/bill/" detail prefix; note "/bills" does
  // not start with "/bill/" (the char after "/bill" is "s"), so order is safe.
  if (basePath === "/bills") return [mode === "news" ? "News" : "Legislation"];
  if (basePath === "/bill" || basePath.startsWith("/bill/")) return ["Legislation"];
  if (basePath === "/changes") return ["Legislation", "Changes"];
  // HO 359: /president is now a real in-surface page (the president's-desk
  // sub-tab), not the redirect alias — filed under Legislation to match its
  // sibling Changes and the /bills?stage=president alias crumb (both
  // "Legislation \ President").
  if (basePath === "/president") return ["Legislation", "President"];
  // HO 264: /hearings standalone section (the later calendar/detail pieces
  // append their own segment via opts.detail).
  if (basePath === "/hearings" || basePath.startsWith("/hearings/"))
    return ["Hearings"];
  if (basePath === "/watchlist") return ["Watchlist"];
  if (basePath === "/members" || basePath.startsWith("/members/"))
    return ["Members"];
  // "/committees" exact precedes the "/committee/" detail prefix (same
  // trailing-char safety as bills/bill).
  if (basePath === "/committees") return ["Members", "Committees"];
  if (basePath === "/committee" || basePath.startsWith("/committee/"))
    return ["Members", "Committees"];
  // HO 333: Races + Primaries consolidated into one Electoral surface. /races
  // and /primaries 308-redirect to /electoral (so their crumbs are dead), but
  // /race/[id] still renders and lights Electoral.
  if (basePath === "/electoral") return ["Electoral"];
  if (basePath === "/races") return ["Electoral"];
  if (basePath.startsWith("/race/")) return ["Electoral"];
  if (basePath === "/primaries") return ["Electoral"];
  if (basePath === "/patterns") return ["Patterns"];
  if (basePath === "/trends") return ["Patterns", "Trends"];
  if (basePath === "/stale") return ["Patterns", "Stale"];
  if (basePath === "/reports" || basePath.startsWith("/reports/"))
    return ["Reports"];
  if (basePath === "/search") return ["Search"];
  return [];
}

export function breadcrumbSegments(
  basePath: string,
  opts: BreadcrumbOpts = {},
): string[] {
  const segs = sectionFor(basePath, opts.mode);
  if (opts.presidentAlias) segs.push("President");
  if (opts.detail) segs.push(opts.detail);
  return segs;
}
