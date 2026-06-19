// HO 276 — THROWAWAY cold-start probe for /dashboard-v2. Read-only. Revert after.
//
// Runs each /dashboard-v2 query's RAW SQL sequentially against a RAW libsql client
// (NO boundedFetch, so a slow query reports its true ms instead of the production
// 10s abort+retry doubling), returning {name, ms, ok, cached, v2Only}. The point is
// to find which queries breach the 10s DB abort on a COLD container before HO 277
// prescribes a fix. Hit it as the first request on a cold container (after idle, or
// right after a fresh deploy) for cold numbers, then again for warm.
//
// Pairs each summary-gated v2 aggregate with its ungated `/` counterpart so the
// mis-plan question is directly testable: if warm-gated >> warm-ungated, the
// `AND summary IS NOT NULL` predicate defeats the HO 241 covering index (which has
// no `summary` column) and there's no INDEXED BY hint to force a good plan.
//
// SEQUENTIAL caveat: the production page fires these in Promise.all (PARALLEL), so
// on a cold `bills` table they cold-scan concurrently and can't warm each other —
// this sequential probe UNDER-represents that amplification (the first bills scan
// warms the table for the rest here). Read the first-vs-rest split as signal.
import { createClient } from "@libsql/client";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Single execution per query (no retry), capped just above the production 10s
// abort so a breach reports ~PER_QUERY_TIMEOUT_MS+error rather than eating the
// whole function budget. Stop starting new queries past TOTAL_BUDGET_MS so the
// endpoint always returns a (possibly partial) JSON body under Hobby's 60s.
const PER_QUERY_TIMEOUT_MS = 18_000;
const TOTAL_BUDGET_MS = 50_000;

const FUNNEL = ["introduced", "committee", "floor", "other_chamber", "president", "enacted"];
const CER = "(is_ceremonial = 0 OR is_ceremonial IS NULL)";
const MEETING_COLS =
  "event_id, congress, chamber, meeting_date, meeting_type, meeting_status, title, location_building, location_room, video_url, committee_system_code";

type Probe = {
  name: string;
  // `cached` = the production page wraps this in unstable_cache (informational —
  // this probe runs the raw SQL uncached on purpose).
  cached: boolean;
  // `v2Only` = /dashboard-v2 runs it but `/` does not (or runs the ungated twin).
  v2Only: boolean;
  sql: string;
  args?: (string | number)[];
};

const PROBES: Probe[] = [
  { name: "warmup_select1", cached: false, v2Only: false, sql: "SELECT 1" },

  // --- summary-gated v2 aggregates vs their ungated `/` twins (mis-plan test) ---
  { name: "corpus_ungated", cached: true, v2Only: false, sql: `SELECT COUNT(*) AS total, MAX(update_date) AS last_sync FROM bills WHERE ${CER}` },
  { name: "corpus_gated_v2", cached: true, v2Only: true, sql: `SELECT COUNT(*) AS total, MAX(update_date) AS last_sync FROM bills WHERE ${CER} AND summary IS NOT NULL` },

  { name: "stage_ungated", cached: true, v2Only: false, sql: `SELECT stage, COUNT(*) AS count FROM bills WHERE ${CER} AND stage IN (?,?,?,?,?,?) GROUP BY stage`, args: [...FUNNEL] },
  { name: "stage_gated_v2", cached: true, v2Only: true, sql: `SELECT stage, COUNT(*) AS count FROM bills WHERE ${CER} AND stage IN (?,?,?,?,?,?) AND summary IS NOT NULL GROUP BY stage`, args: [...FUNNEL] },

  { name: "stage_offpath_ungated", cached: true, v2Only: false, sql: `SELECT COUNT(*) AS n FROM bills WHERE ${CER} AND (stage = 'other' OR stage IS NULL)` },
  { name: "stage_offpath_gated_v2", cached: true, v2Only: true, sql: `SELECT COUNT(*) AS n FROM bills WHERE ${CER} AND (stage = 'other' OR stage IS NULL) AND summary IS NOT NULL` },

  { name: "topic_ungated", cached: true, v2Only: false, sql: `SELECT je.value AS topic, COUNT(*) AS count FROM bills, json_each(bills.topics) je WHERE bills.topics IS NOT NULL AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL) GROUP BY je.value ORDER BY count DESC` },
  { name: "topic_gated_v2", cached: true, v2Only: true, sql: `SELECT je.value AS topic, COUNT(*) AS count FROM bills, json_each(bills.topics) je WHERE bills.topics IS NOT NULL AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL) AND bills.summary IS NOT NULL GROUP BY je.value ORDER BY count DESC` },

  // --- indexed control: cheap even cold (forced INDEXED BY). Isolates "is it the
  //     bills table, or just any DB call" from connection-setup cost. ---
  { name: "new_bills_indexed", cached: true, v2Only: false, sql: `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_introduced_date WHERE ${CER} AND introduced_date IS NOT NULL AND introduced_date > date('now', '-7 days')` },

  // --- v2-only races fan-out (the rich cards + battlefield) ---
  { name: "races_index_v2", cached: true, v2Only: true, sql: `SELECT r.id, r.chamber, r.state, r.district, r.cycle, r.incumbent_bioguide_id, r.margin_2024, r.incumbent_running, m.name AS incumbent_name, m.party AS incumbent_party, m.depiction_url AS incumbent_depiction_url, m.terms_json AS incumbent_terms_json, mf.cash_on_hand AS incumbent_cash_on_hand, ko.event_ticker, ko.implied_pct AS ko_implied_pct, ko.favorite_label, ko.favorite_is_party, ko.favorite_party, ko.open_interest, ko.close_time, pm.implied_pct AS pm_implied_pct, pm.slug, pm.favorite_label AS pm_favorite_label, pm.favorite_is_party AS pm_favorite_is_party, pm.favorite_party AS pm_favorite_party, pm.volume, pm.liquidity, pm.end_date, MAX(CASE WHEN rr.source = 'cook' THEN rr.rating END) AS cook_rating, MAX(CASE WHEN rr.source = 'cook' THEN rr.rating_score END) AS cook_score, MAX(CASE WHEN rr.source = 'sabato' THEN rr.rating END) AS sabato_rating, MAX(CASE WHEN rr.source = 'sabato' THEN rr.rating_score END) AS sabato_score, MAX(CASE WHEN rr.source = 'inside_elections' THEN rr.rating END) AS ie_rating, MAX(CASE WHEN rr.source = 'inside_elections' THEN rr.rating_score END) AS ie_score FROM races r INNER JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = r.cycle LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id LEFT JOIN member_fundraising mf ON mf.bioguide_id = r.incumbent_bioguide_id AND mf.cycle = r.cycle LEFT JOIN kalshi_odds ko ON ko.race_id = r.id LEFT JOIN polymarket_odds pm ON pm.race_id = r.id WHERE r.cycle = ? GROUP BY r.id`, args: [2026] },
  { name: "battlefield_v2", cached: true, v2Only: true, sql: `SELECT r.id, r.chamber, r.incumbent_running, m.party AS incumbent_party, MAX(CASE WHEN rr.source = 'cook' THEN rr.rating END) AS cook_rating, MAX(CASE WHEN rr.source = 'sabato' THEN rr.rating END) AS sabato_rating, MAX(CASE WHEN rr.source = 'inside_elections' THEN rr.rating END) AS ie_rating FROM races r INNER JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = r.cycle LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id WHERE r.cycle = ? GROUP BY r.id`, args: [2026] },

  // --- v2-only hearings tab (both tabs render server-side; /hearings is a known
  //     cold-500 sibling). committees_index aggregates the ~22k committee_bills. ---
  { name: "committees_index_v2", cached: true, v2Only: true, sql: `SELECT c.system_code, c.name, c.chamber, c.committee_type, c.parent_system_code, c.url, COALESCE(cm.member_count, 0) AS member_count, COALESCE(cb.recent_count, 0) AS recent_count FROM committees c LEFT JOIN (SELECT committee_system_code, COUNT(*) AS member_count FROM committee_members GROUP BY committee_system_code) cm ON cm.committee_system_code = c.system_code LEFT JOIN (SELECT committee_system_code, COUNT(DISTINCT bill_id) AS recent_count FROM committee_bills WHERE activity_date >= datetime('now', '-30 days') GROUP BY committee_system_code) cb ON cb.committee_system_code = c.system_code WHERE c.is_current = 1 ORDER BY recent_count DESC, c.name ASC` },
  { name: "upcoming_meetings_v2", cached: true, v2Only: true, sql: `SELECT ${MEETING_COLS} FROM committee_meetings WHERE meeting_date IS NOT NULL AND meeting_date >= ? ORDER BY meeting_date ASC`, args: [new Date(0).toISOString()] },
];

export async function GET(req: Request) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) return NextResponse.json({ error: "no TURSO_DATABASE_URL" }, { status: 500 });
  // RAW client — deliberately NO boundedFetch, so a slow query reports its true
  // duration instead of the production 10s abort+retry.
  const db = createClient({ url, authToken });

  const t0 = Date.now();
  const results: Array<{
    name: string;
    ms: number;
    ok: boolean;
    rows?: number;
    error?: string;
    cached: boolean;
    v2Only: boolean;
  }> = [];

  for (const p of PROBES) {
    if (Date.now() - t0 > TOTAL_BUDGET_MS) {
      results.push({ name: p.name, ms: -1, ok: false, error: "skipped (budget)", cached: p.cached, v2Only: p.v2Only });
      continue;
    }
    const s = Date.now();
    try {
      // Race the query against a per-query cap so one hung/stalled call can't
      // ride to the 60s SIGKILL with no response. The orphaned query keeps
      // running server-side, but the loop moves on (fine for a throwaway probe).
      const rs = await Promise.race([
        db.execute({ sql: p.sql, args: p.args ?? [] }),
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error(`>${PER_QUERY_TIMEOUT_MS}ms (capped)`)), PER_QUERY_TIMEOUT_MS),
        ),
      ]);
      results.push({ name: p.name, ms: Date.now() - s, ok: true, rows: rs.rows.length, cached: p.cached, v2Only: p.v2Only });
    } catch (e) {
      results.push({ name: p.name, ms: Date.now() - s, ok: false, error: String((e as Error)?.message ?? e).slice(0, 140), cached: p.cached, v2Only: p.v2Only });
    }
  }

  const totalMs = Date.now() - t0;
  const v2OnlyMs = results.filter((r) => r.v2Only && r.ok).reduce((a, r) => a + r.ms, 0);
  return NextResponse.json(
    {
      note: "HO 276 throwaway cold-start probe — raw uncached SQL, sequential. Revert after.",
      totalMs,
      v2OnlyMs,
      results,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
