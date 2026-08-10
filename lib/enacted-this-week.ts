import type { getDb } from "./db";

// HO 232: single source for the "enacted this week" slice. Two consumers:
// the dashboard lead generator (lib/dashboard-lead.ts, runs in the cron with
// a fresh raw read) and the ENACTED THIS WEEK banner (getEnactedThisWeek in
// lib/queries.ts, request-time + unstable_cache). The cron must NOT consume
// the cached wrapper — it reads after sync/summarize but before
// revalidateTag("bills"), so a cached read would be stale; both layers call
// this raw query directly instead.
export const ENACTED_THIS_WEEK_DAYS = 7;

export type EnactedBill = {
  id: string;
  billType: string;
  billNumber: number;
};

// HO 635 — THE WINDOW IS `latest_action_date`, NOT `stage_observed_at`.
//
// `stage_observed_at` is an OBSERVATION clock: both write sites stamp the wall
// clock of the sync run (`lib/sync.ts:235`, `lib/summarize-runner.ts:314`), so a
// count windowed on it counts things WE NOTICED this week, and its week-over-week
// delta partly measures sync behaviour rather than congressional behaviour.
// Measured at HO 635 against the true advancing action (Congress.gov actions,
// n=40): the stamp bins a row into the right week 60% of the time,
// `latest_action_date` 85%, and matches the advancing action exactly 82.5%.
//
// FOR ENACTED THE ANCHOR IS NOT A PROXY — IT IS EXACT. An enacted bill's latest
// action IS its enactment ("Became Public Law"), so `latest_action_date` is the
// enactment date, full stop. That is why this reader moves first and alone; the
// other class-(C) readers window on transitions generally, where the latest action
// is only usually the advancing one.
//
// AND WHY THE `stage_observed_at IS NOT NULL` GUARD IS DROPPED HERE, when the
// general (4) shape keeps it: that guard exists to prove a transition HAPPENED,
// because nothing else records one. `stage = 'enacted'` already proves it — the
// bill is enacted, and the enacting action is its latest. Requiring the stamp as
// well would silently exclude any bill enacted before observation tracking began
// (2026-05-11), which is a population limit with no purpose here.
//
// BOTH HALVES MOVE TOGETHER — this-week and prior-week. A delta whose two sides
// read different clocks is the same defect one level up.
//
// Non-ceremonial, enacted, enactment falling within the window, newest first.
// `days` is a numeric constant interpolated into the SQL (same pattern as the
// other dashboard recency windows) — never a user value.
export async function queryEnactedThisWeek(
  db: ReturnType<typeof getDb>,
  days = ENACTED_THIS_WEEK_DAYS,
): Promise<EnactedBill[]> {
  // HO 481: INDEXED BY forces the partial enacted index — the 5th sibling of
  // the HO 405/407/480 OR-lure. Unhinted, the `is_ceremonial=0 OR IS NULL`
  // predicate lures the stateless Turso planner into a MULTI-INDEX OR over
  // idx_bills_dash_stage + a temp b-tree sort, which cold-stalls the
  // boundedFetch wall. idx_bills_enacted is `WHERE stage='enacted'` and the
  // query carries `AND stage='enacted'`, so the hint qualifies: scan the small
  // partial enacted set (a few hundred rows), filter the window + sort in
  // memory (trivial at that count). NB idx_bills_enacted keys
  // (congress, latest_action_date), not stage_observed_at, so a residual temp
  // sort remains — correcting the stale HO 335 read that this rode it cleanly.
  // HO 635: the window column is now `latest_action_date`, which IS the index's
  // second key — but without a `congress` constraint that is still a partial-index
  // scan, not a seek, so the hint's rationale above is UNCHANGED and no plan
  // improvement is claimed.
  const rs = await db.execute(
    `SELECT id, bill_type, bill_number FROM bills INDEXED BY idx_bills_enacted
     WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
       AND stage = 'enacted'
       AND latest_action_date IS NOT NULL
       AND latest_action_date > date('now', '-${days} days')
     ORDER BY latest_action_date DESC`,
  );
  return rs.rows.map((r) => ({
    id: r.id as string,
    billType: r.bill_type as string,
    billNumber: r.bill_number as number,
  }));
}

// HO 283: prior-week count of the SAME enacted slice, for the weekly band's
// week-over-week delta. Mirrors queryEnactedThisWeek's predicate exactly (kept
// in this file so the two can't drift), shifted to the immediately preceding
// 7-day window — (now-2*days, now-days] — adjacent to the this-week window with
// no overlap or gap. Count only; the band needs the number, not the rows.
export async function queryEnactedPriorWeekCount(
  db: ReturnType<typeof getDb>,
  days = ENACTED_THIS_WEEK_DAYS,
): Promise<number> {
  // HO 481: same OR-lure, same hint (shared predicate with queryEnactedThisWeek).
  // COUNT-only, no ORDER BY, so the plan collapses to a clean partial-index scan
  // with no temp b-tree.
  // HO 635: moved to `latest_action_date` IN LOCKSTEP with queryEnactedThisWeek.
  // These two are the two sides of one delta; if only one moved, the WoW figure
  // would subtract an occurrence count from an observation count.
  const rs = await db.execute(
    `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_enacted
     WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
       AND stage = 'enacted'
       AND latest_action_date IS NOT NULL
       AND latest_action_date > date('now', '-${days * 2} days')
       AND latest_action_date <= date('now', '-${days} days')`,
  );
  return Number(rs.rows[0]?.n ?? 0);
}
