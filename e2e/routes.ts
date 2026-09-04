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
  { slug: "welcome", path: "/welcome" },
  { slug: "bills", path: "/bills" },
  { slug: "members", path: "/members" },
  { slug: "members-pass-rate", path: "/members/pass-rate" },
  { slug: "races", path: "/races" },
  { slug: "electoral", path: "/electoral" },
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
