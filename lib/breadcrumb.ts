// HO 185 — maps a page's basePath (the route identity every page already hands
// to HeaderBar) to the PowerShell-path breadcrumb segments rendered in the
// unified masthead: `Congress Terminal:\ 119TH \ <segments> >_`. Returns the
// SECTION segments only — the congress root ("119TH") is prepended by
// BreadcrumbMasthead, and detail-page labels (HR 9081, a member last name, a
// committee name, …) are appended via `opts.detail` since they need data the
// page already fetched (no new queries).
//
// IA notes baked in here: Committees nests under Members; Primaries under
// Races; Trends/Stale under Patterns; Changes + President are bill views
// (Bills \ Changes / Bills \ President); Reports is its own top-level section.

export type BreadcrumbOpts = {
  // /bills tracks its toggle: bills → "Bills", news → "News".
  mode?: "bills" | "news";
  // The /bills?stage=president alias view → "Bills \ President".
  presidentAlias?: boolean;
  // Detail-page last segment (bill number, member last name, race label,
  // committee name, report title). Appended after the section.
  detail?: string;
};

function sectionFor(basePath: string, mode?: "bills" | "news"): string[] {
  if (basePath === "/") return ["Dashboard"];
  // "/bills" exact must precede the "/bill/" detail prefix; note "/bills" does
  // not start with "/bill/" (the char after "/bill" is "s"), so order is safe.
  if (basePath === "/bills") return [mode === "news" ? "News" : "Bills"];
  if (basePath === "/bill" || basePath.startsWith("/bill/")) return ["Bills"];
  if (basePath === "/changes") return ["Bills", "Changes"];
  if (basePath === "/watchlist") return ["Watchlist"];
  if (basePath === "/members" || basePath.startsWith("/members/"))
    return ["Members"];
  // "/committees" exact precedes the "/committee/" detail prefix (same
  // trailing-char safety as bills/bill).
  if (basePath === "/committees") return ["Members", "Committees"];
  if (basePath === "/committee" || basePath.startsWith("/committee/"))
    return ["Members", "Committees"];
  if (basePath === "/races") return ["Races"];
  if (basePath.startsWith("/race/")) return ["Races"];
  if (basePath === "/primaries") return ["Races", "Primaries"];
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
