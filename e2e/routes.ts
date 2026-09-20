// HO 694 — THE CRAWL LIST, extracted from `smoke.spec.ts` so a second spec can
// walk the same routes without a second copy of them.
//
// WHY A MODULE AND NOT A COPY. Every other cross-spec helper in `e2e/` is
// deliberately duplicated per spec (the collectors, `settle`, `GATE_COOKIE` —
// see the fit-finish note in SKILL), and that duplication is defensible because
// each copy is a few lines a reader can check against its neighbour at a glance.
// A ROUTE LIST is the opposite shape: it is the definition of "every route", and
// a second copy that drifts does not read as wrong — it reads as a shorter
// crawl, which is exactly what a silently-narrowed gate looks like. So this one
// is shared, and the near-miss cases stay copied.
//
// The seeds keep their `SEED_*` env overrides so both specs answer to the same
// environment they always did. Nothing here imports Playwright, so it is a plain
// data module and can be read by a diagnostic script too.

export type Route = { slug: string; path: string };

// Real seeds pulled from Turso (HO 379 recon), env-overridable for other data.
export const BILL = process.env.SEED_BILL ?? "119-s-2";
export const MEMBER = process.env.SEED_MEMBER ?? "A000055";
export const RACE = process.env.SEED_RACE ?? "AL-01-2026";
export const COMMITTEE = process.env.SEED_COMMITTEE ?? "hlig00";
export const REPORT = process.env.SEED_REPORT ?? "2026-06-15";
// HO 548 — a Senate roll call with member positions AND a bill link (119-sjres-180),
// so the /vote/[id] page renders both the positions list and the bill back-link.
export const VOTE = process.env.SEED_VOTE ?? "senate-119-2-207";

// Enumerated from the live app/ tree (every page.tsx), not the handoff seed list.
// The six stage-filtered home variants exercise the `?stage=` deep links that the
// gate is known to drop. other_chamber (not "other") is the real OTHER bar value.
export const STAGES = [
  "introduced",
  "committee",
  "floor",
  "other_chamber",
  "president",
  "enacted",
] as const;

export const ROUTES: Route[] = [
  { slug: "home", path: "/" },
  ...STAGES.map((s) => ({ slug: `home-stage-${s}`, path: `/?stage=${s}` })),
  // HO 740 — the ActiveFilterStrip at its widest, as a REAL PRODUCT URL.
  // `other_chamber` is the longest stage token above and `government_operations`
  // the longest of ALLOWED_TOPICS (lib/enums.ts), and the strip renders both
  // with underscores as spaces. The band is URL-reachable, so it needs no
  // fixture seam at all — it needs a route, and it belongs in the SHARED list
  // because it is an ordinary page a reader can land on. +2 smoke documents a
  // day, named against the standing 74/run WATCH.
  { slug: "home-filtered-max", path: "/?stage=other_chamber&topics=government_operations" },
  // HO 740 — a POPULATED search, for the same reason: `/search` with no `q`
  // renders only `.search-empty-hint`, so every result row was unmeasured at
  // both gate widths. Measured on prod before it became a gate (the HO 694
  // rule): 200 twice, TTFB 1.27s cold / 0.25s warm, 50 rows, over=0 at 430 and
  // 390 — so the HO 335 `LIKE`-scan 500 does not reproduce on the bills_fts
  // path. `appropriations` is a term every Congress answers.
  { slug: "search-populated", path: "/search?q=appropriations" },
  { slug: "welcome", path: "/welcome" },
  { slug: "bills", path: "/bills" },
  { slug: "members", path: "/members" },
  { slug: "members-pass-rate", path: "/members/pass-rate" },
  { slug: "races", path: "/races" },
  { slug: "electoral", path: "/electoral" },
  // HO 710: the 2028 seat outlook is a distinct render (no band/board/calendar),
  // so it rides the smoke crawl and BOTH narrow widths on its own entry.
  { slug: "electoral-2028", path: "/electoral?cycle=2028" },
  { slug: "primaries", path: "/primaries" },
  { slug: "reports", path: "/reports" },
  { slug: "hearings", path: "/hearings" },
  { slug: "news", path: "/news" },
  { slug: "changes", path: "/changes" },
  { slug: "stale", path: "/stale" },
  { slug: "trends", path: "/trends" },
  { slug: "patterns", path: "/patterns" },
  { slug: "search", path: "/search" },
  { slug: "president", path: "/president" },
  // HO 461/456/437/389 aggregate surfaces — shipped after the HO 379 crawler was
  // written, never before in the console/failed-request sweep (HO 472).
  { slug: "amendments", path: "/amendments" },
  { slug: "nominations", path: "/nominations" },
  { slug: "lobbying", path: "/lobbying" },
  { slug: "trades", path: "/trades" },
  { slug: "committees-redirect", path: "/committees" }, // redirects → /members
  { slug: "watchlist", path: "/watchlist" }, // anonymous: empty/sign-in, not a 500
  { slug: "dashboard-v2", path: "/dashboard-v2" },
  // dynamic detail routes (real IDs)
  { slug: "bill-detail", path: `/bill/${BILL}` },
  { slug: "member-detail", path: `/members/${MEMBER}` },
  { slug: "race-detail", path: `/race/${RACE}` },
  { slug: "committee-detail", path: `/committee/${COMMITTEE}` },
  { slug: "report-detail", path: `/reports/${REPORT}` },
  // HO 548 — the newest route (HO 540), not previously in ROUTES; inherits the
  // double-hit + lands in the daily prod crawl.
  { slug: "vote", path: `/vote/${VOTE}` },
];

// HO 740 — THE FIXTURE ROUTES, AND WHY THEY ARE NOT IN `ROUTES`.
//
// These two carry `?fixture=max`, which renders the conditional bands at max
// content — but ONLY on a server whose env carries `CBT_FIXTURES=1`, which is
// the Preview scope and never Production. They are kept OUT of `ROUTES` on
// purpose: `smoke.spec.ts` crawls that list twice a day against the production
// domain, where these two are by construction identical to their plain
// counterparts, so crawling them there buys nothing and costs two documents a
// run.
//
// `e2e/narrow.spec.ts` is the only consumer. It walks `[...ROUTES,
// ...FIXTURE_ROUTES]` and asserts in BOTH directions: the marker must be absent
// everywhere else, always; present here when the run says fixtures are expected;
// and absent here when it does not — which is every Production run, and is the
// leak control on shipped bytes.
export const FIXTURE_ROUTES: Route[] = [
  { slug: "fixture-home-max", path: "/?fixture=max" },
  { slug: "fixture-committee-max", path: `/committee/${COMMITTEE}?fixture=max` },
];
