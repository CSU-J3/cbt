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

// Non-ceremonial, stage reached `enacted` within the window, newest first.
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
  // (congress, latest_action_date), not stage_changed_at, so a residual temp
  // sort remains — correcting the stale HO 335 read that this rode it cleanly.
  const rs = await db.execute(
    `SELECT id, bill_type, bill_number FROM bills INDEXED BY idx_bills_enacted
     WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
       AND stage = 'enacted'
       AND stage_changed_at IS NOT NULL
       AND stage_changed_at > datetime('now', '-${days} days')
     ORDER BY stage_changed_at DESC`,
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
  const rs = await db.execute(
    `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_enacted
     WHERE (is_ceremonial = 0 OR is_ceremonial IS NULL)
       AND stage = 'enacted'
       AND stage_changed_at IS NOT NULL
       AND stage_changed_at > datetime('now', '-${days * 2} days')
       AND stage_changed_at <= datetime('now', '-${days} days')`,
  );
  return Number(rs.rows[0]?.n ?? 0);
}
