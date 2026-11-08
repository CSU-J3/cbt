// HO 807 — a week's enactments on both clocks, pure of Next (as lib/race-result.ts
// is), so the weekly report, the week summary and the legs read one function.
//
// A law counts in a week when its last action falls in the week OR when CT
// recorded its move to `enacted` in the week (stage_observed_at). The report used
// to count laws by latest_action_date alone while the summary's advances came from
// stage_transitions by observation date, so a law whose last action predated the
// week CT recorded it fell out of the count and still showed as an advance: the
// Oct 26, 2026 week read "No laws were enacted" beside "119-hr-952 advanced to
// enacted" (last action Oct 22, observed Oct 27). See oddities, "One report, two
// clocks".
//
// idx_bills_enacted is the partial index on stage = 'enacted', so the OR filters a
// few hundred rows and can't lure the planner. `start` and `end` are inclusive
// YYYY-MM-DD.
import type { Client } from "@libsql/client";

export type EnactedInWeek = {
  id: string;
  billType: string;
  billNumber: number;
  title: string;
  latestActionDate: string | null;
};

export async function readEnactedInWeek(
  db: Client,
  start: string,
  end: string,
): Promise<EnactedInWeek[]> {
  const rs = await db.execute({
    sql: `SELECT id, bill_type, bill_number, title, latest_action_date
            FROM bills INDEXED BY idx_bills_enacted
           WHERE stage = 'enacted'
             AND (latest_action_date BETWEEN ? AND ?
                  OR (stage_observed_at IS NOT NULL AND date(stage_observed_at) BETWEEN ? AND ?))
           ORDER BY latest_action_date DESC`,
    args: [start, end, start, end],
  });
  return rs.rows.map((r) => ({
    id: String(r.id),
    billType: String(r.bill_type),
    billNumber: Number(r.bill_number),
    title: String(r.title),
    latestActionDate: (r.latest_action_date as string | null) ?? null,
  }));
}
