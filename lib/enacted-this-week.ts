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
  const rs = await db.execute(
    `SELECT id, bill_type, bill_number FROM bills
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
