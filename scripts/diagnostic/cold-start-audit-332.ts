// HO 332 — site-wide cold-start misplan audit. READ-ONLY.
//
// The class (HO 241/246/277/278/279/329/331): a query reads the fat `bills`
// table (~16.5k), carries no forced INDEXED BY, and the stateless Turso planner
// (ANALYZE blocked) grabs idx_bills_is_ceremonial (MULTI-INDEX OR) or a full
// SCAN instead of a covering index. Warm ~200ms; cold seconds-to-abort → a 500
// off the 10s DB_REQUEST_TIMEOUT (lib/db.ts, HO 238).
//
// EXPLAIN QUERY PLAN is chosen at prepare time, so a WARM explain against prod
// reveals every latent misplanner at once. This probe enumerates every distinct
// request-path SQL statement reading bills/news_mentions (SQL copied verbatim
// from lib/queries.ts + lib/enacted-this-week.ts, dynamic builders concretized
// with representative bound params), EXPLAINs each against prod Turso, and
// classifies GOOD/BAD. NO fix, NO index creation, NO writes.
import "dotenv/config";
import { createClient } from "@libsql/client";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const CER = "(is_ceremonial = 0 OR is_ceremonial IS NULL)";
const CER_AND = " AND " + CER;
const HOUSE = "'hr','hjres','hconres','hres'";
const MENTION_WINDOW_DAYS = 7;
const NEWS_FLOOR = 0.7; // NEWS_CONFIDENCE_FLOOR
const MENTION_SUBQUERY = `LEFT JOIN (
  SELECT bill_id, COUNT(*) AS n FROM news_mentions
  WHERE published_at >= datetime('now', '-${MENTION_WINDOW_DAYS} days')
    AND match_confidence >= ${NEWS_FLOOR}
  GROUP BY bill_id
) nm ON nm.bill_id = bills.id`;
const MENTION_SELECT = "COALESCE(nm.n, 0) AS mention_count_7d";
const ENRICH_SELECT = `bills.sponsor_bioguide_id, bills.cosponsor_count,
  msp.depiction_url AS sponsor_depiction_url, msp.first_name AS sponsor_first_name,
  msp.last_name AS sponsor_last_name, msp.district AS sponsor_district`;
const ENRICH_JOIN =
  "LEFT JOIN members msp ON msp.bioguide_id = bills.sponsor_bioguide_id";
const FEED_COLS = `id, congress, bill_type, bill_number, title,
  sponsor_name, sponsor_party, sponsor_state, introduced_date,
  latest_action_date, latest_action_text, update_date,
  summary, topics, stage, stage_changed_at`;
const FUNNEL = ["introduced", "committee", "floor", "other_chamber", "president", "enacted"];
const STALE_ELIGIBLE = ["introduced", "committee", "floor", "other_chamber", "other"];

type Q = {
  fn: string;
  route: string;
  cache: string;
  sql: string;
  args: (string | number)[];
  // HO 335: accepted BAD-by-letter — a MULTI-INDEX OR the audit deliberately did
  // NOT fix. Either selective (a stage= constant bounds it to a tiny row set) or
  // index-only via a covering idx_bills_dash_* on the dying /dashboard-classic
  // route. Flagged so a NEW idx_bills_is_ceremonial/SCAN regression stands out.
  accept?: boolean;
};

function badPlan(plan: string[]): { bad: boolean; why: string } {
  // The HO 332/335 failure signal, exactly: (a) the planner fell to
  // idx_bills_is_ceremonial (always a fat row-fetch — it carries only that one
  // column), or (b) a SCAN of the fat table with no index. A MULTI-INDEX OR is
  // NOT bad on its own: `(is_ceremonial=0 OR IS NULL)` forces a two-branch union,
  // and when both branches ride a COVERING non-ceremonial index (dash_stage /
  // dash_topics / chamber_topics) the plan is index-only — the target, not a miss.
  const text = plan.join(" | ");
  const reasons: string[] = [];
  if (/idx_bills_is_ceremonial/.test(text)) reasons.push("idx_bills_is_ceremonial");
  // "SCAN bills" with no index = full table scan. "SCAN ... USING [COVERING]
  // INDEX" is an index-only scan and is fine.
  for (const line of plan) {
    if (/SCAN (bills|b )/i.test(line) && !/USING (COVERING )?INDEX/i.test(line)) {
      reasons.push("SCAN bills (no index)");
    }
  }
  return { bad: reasons.length > 0, why: reasons.join(", ") };
}

async function plan(sql: string, args: (string | number)[]): Promise<string[]> {
  const rs = await db.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args });
  return rs.rows.map((r) => r.detail as string);
}

async function main() {
  // ---- 0. Confirm the fat set: prod row counts for every table -----------
  console.log("=== 0. Prod table row counts (confirm the fat set) ===");
  const tbls = await db.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
  );
  const counts: Record<string, number> = {};
  for (const t of tbls.rows) {
    const name = t.name as string;
    try {
      const c = await db.execute(`SELECT COUNT(*) AS n FROM "${name}"`);
      counts[name] = Number(c.rows[0]?.n ?? 0);
    } catch (e) {
      counts[name] = -1;
    }
  }
  for (const [n, c] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    const fat = c >= 1000 ? "  <-- FAT (>=1k)" : "";
    console.log(`  ${c.toString().padStart(7)}  ${n}${fat}`);
  }

  // ---- 1. Live index set on the fat tables (authoritative) ---------------
  console.log("\n=== 1. Indexes actually present on prod (bills, news_mentions) ===");
  const idx = await db.execute(
    `SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index'
       AND tbl_name IN ('bills','news_mentions') ORDER BY tbl_name, name`,
  );
  for (const r of idx.rows) {
    console.log(`  ${r.tbl_name}.${r.name}`);
    if (r.sql) console.log(`      ${(r.sql as string).replace(/\s+/g, " ")}`);
  }

  // ---- discover representative params -------------------------------------
  const heavyRs = await db.execute(
    `SELECT sponsor_bioguide_id AS bid, COUNT(*) AS n FROM bills
     WHERE sponsor_bioguide_id IS NOT NULL GROUP BY sponsor_bioguide_id
     ORDER BY n DESC LIMIT 1`,
  );
  const HEAVY = (heavyRs.rows[0]?.bid as string) ?? "P000197";
  const clRs = await db.execute(
    `SELECT cluster_id AS c, COUNT(*) AS n FROM bills WHERE cluster_id IS NOT NULL
     GROUP BY cluster_id ORDER BY n DESC LIMIT 1`,
  );
  const CLUSTER = (clRs.rows[0]?.c as string) ?? "postoffice";
  const tpRs = await db.execute(
    `SELECT je.value AS t, COUNT(*) AS n FROM bills, json_each(bills.topics) je
     WHERE bills.topics IS NOT NULL GROUP BY je.value ORDER BY n DESC LIMIT 1`,
  );
  const TOPIC = (tpRs.rows[0]?.t as string) ?? "government_operations";
  const stRs = await db.execute(
    `SELECT sponsor_state AS s, COUNT(*) AS n FROM bills WHERE sponsor_state IS NOT NULL
     GROUP BY sponsor_state ORDER BY n DESC LIMIT 1`,
  );
  const STATE = (stRs.rows[0]?.s as string) ?? "CA";
  const cmRs = await db.execute(
    `SELECT committee_system_code AS c, COUNT(*) AS n FROM committee_bills
     GROUP BY committee_system_code ORDER BY n DESC LIMIT 1`,
  );
  const COMMITTEE = (cmRs.rows[0]?.c as string) ?? "hsju00";
  const billRs = await db.execute(
    `SELECT bill_id AS b, COUNT(*) AS n FROM news_mentions GROUP BY bill_id ORDER BY n DESC LIMIT 1`,
  );
  const BILLID = (billRs.rows[0]?.b as string) ?? "119-hr-1";
  console.log(
    `\nParams: HEAVY=${HEAVY} CLUSTER=${CLUSTER} TOPIC=${TOPIC} STATE=${STATE} COMMITTEE=${COMMITTEE} BILLID=${BILLID}`,
  );

  // ---- 2. The query surface ----------------------------------------------
  const Q: Q[] = [
    // ===== already-hinted bills aggregates (re-verify GOOD) =====
    { fn: "getFeedStats (bare)", route: "HeaderBar (every inner page)", cache: "1h, tag bills",
      sql: `SELECT COUNT(*) AS total, MAX(update_date) AS last FROM bills INDEXED BY idx_bills_summary_feed WHERE summary IS NOT NULL${CER_AND}`, args: [] },
    { fn: "getFeedStats (?cluster)", route: "HeaderBar w/ cluster", cache: "1h, tag bills",
      sql: `SELECT COUNT(*) AS total, MAX(update_date) AS last FROM bills WHERE summary IS NOT NULL AND cluster_id = ?`, args: [CLUSTER] },
    { fn: "getCorpusStats(true) gated", route: "/ HomeHeader (v2)", cache: "1h, tag bills",
      sql: `SELECT COUNT(*) AS total, MAX(update_date) AS last_sync FROM bills INDEXED BY idx_bills_summary_feed WHERE ${CER} AND summary IS NOT NULL`, args: [] },
    { fn: "getCorpusStats() ungated", route: "/dashboard-classic (sunset)", cache: "1h, tag bills", accept: true,
      sql: `SELECT COUNT(*) AS total, MAX(update_date) AS last_sync FROM bills WHERE ${CER}`, args: [] },
    { fn: "getStageDistribution gated bars", route: "/ stage funnel (v2)", cache: "1h, tag bills",
      sql: `SELECT stage, COUNT(*) AS count FROM bills INDEXED BY idx_bills_summary_stage WHERE ${CER} AND stage IN (${FUNNEL.map(() => "?").join(",")}) AND summary IS NOT NULL GROUP BY stage`, args: [...FUNNEL] },
    { fn: "getStageDistribution gated offPath", route: "/ stage funnel (v2)", cache: "1h, tag bills",
      sql: `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_summary_stage WHERE ${CER} AND (stage = 'other' OR stage IS NULL) AND summary IS NOT NULL`, args: [] },
    { fn: "getStageDistribution ungated bars", route: "/dashboard-classic funnel (sunset)", cache: "1h, tag bills", accept: true,
      sql: `SELECT stage, COUNT(*) AS count FROM bills WHERE ${CER} AND stage IN (${FUNNEL.map(() => "?").join(",")}) GROUP BY stage`, args: [...FUNNEL] },
    { fn: "getTopicDistribution gated", route: "/ topic pane (v2)", cache: "1h, tag bills",
      sql: `SELECT je.value AS topic, COUNT(*) AS count FROM bills INDEXED BY idx_bills_summary_topics, json_each(bills.topics) je WHERE bills.topics IS NOT NULL AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL) AND bills.summary IS NOT NULL GROUP BY je.value ORDER BY count DESC`, args: [] },
    { fn: "getTopicDistribution ungated", route: "/dashboard-classic topic pane (sunset)", cache: "1h, tag bills", accept: true,
      sql: `SELECT je.value AS topic, COUNT(*) AS count FROM bills, json_each(bills.topics) je WHERE bills.topics IS NOT NULL AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL) GROUP BY je.value ORDER BY count DESC`, args: [] },
    { fn: "getNewBillsThisWeekCount", route: "/ weekly band", cache: "1h, tag bills",
      sql: `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_introduced_date WHERE ${CER} AND introduced_date IS NOT NULL AND introduced_date > date('now', '-7 days')`, args: [] },
    { fn: "getNewBillsThisWeek (rows)", route: "/bills NEW tab, / band", cache: "1h, tag bills",
      sql: `SELECT ${FEED_COLS}, ${ENRICH_SELECT}, ${MENTION_SELECT} FROM bills INDEXED BY idx_bills_introduced_date ${MENTION_SUBQUERY} ${ENRICH_JOIN} WHERE ${CER} AND introduced_date IS NOT NULL AND introduced_date > date('now', '-7 days') ORDER BY introduced_date DESC LIMIT ?`, args: [5] },
    { fn: "billsAggCte (getMembersRanked)", route: "/members ranked list", cache: "1d, tag members,bills",
      sql: `WITH bills_agg AS (SELECT sponsor_bioguide_id, COUNT(*) AS total, SUM(CASE WHEN stage='enacted' THEN 1 ELSE 0 END) AS enacted, CAST(SUM(CASE WHEN stage='enacted' THEN 1 ELSE 0 END) AS REAL)/COUNT(*) AS passrate FROM bills INDEXED BY idx_bills_sponsor_agg WHERE sponsor_bioguide_id IS NOT NULL${CER_AND} GROUP BY sponsor_bioguide_id) SELECT m.bioguide_id, COALESCE(b.total,0) AS total FROM members m LEFT JOIN bills_agg b ON b.sponsor_bioguide_id = m.bioguide_id WHERE m.is_current = 1 LIMIT 50`, args: [] },
    { fn: "getMembersTopicMix", route: "/members topic bars", cache: "1d, tag bills",
      sql: `SELECT sponsor_bioguide_id AS bid, je.value AS topic, COUNT(*) AS n FROM bills INDEXED BY idx_bills_sponsor_topics, json_each(bills.topics) je WHERE sponsor_bioguide_id IS NOT NULL AND topics IS NOT NULL${CER_AND} GROUP BY sponsor_bioguide_id, je.value`, args: [] },
    { fn: "getStageChanges (rows)", route: "/changes, ActivityTicker", cache: "1h, tag bills",
      sql: `SELECT ${FEED_COLS}, previous_stage, ${ENRICH_SELECT}, ${MENTION_SELECT} FROM bills INDEXED BY idx_bills_stage_changed_at ${MENTION_SUBQUERY} ${ENRICH_JOIN} WHERE summary IS NOT NULL${CER_AND} AND stage_changed_at IS NOT NULL AND stage_changed_at > datetime('now', '-7 days') ORDER BY stage_changed_at DESC LIMIT ?`, args: [200] },
    { fn: "getStageChangesCount", route: "/changes, ACTIVITY badge", cache: "1h, tag bills",
      sql: `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_stage_changed_at WHERE summary IS NOT NULL${CER_AND} AND stage_changed_at IS NOT NULL AND stage_changed_at > datetime('now', '-7 days')`, args: [] },
    { fn: "getWeeklyBandPriorWeek intro", route: "/ weekly band WoW", cache: "1h, tag bills",
      sql: `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_introduced_date WHERE ${CER} AND introduced_date IS NOT NULL AND introduced_date > date('now', '-14 days') AND introduced_date <= date('now', '-7 days')`, args: [] },
    { fn: "getSponsorStats (HO331 GOOD ref)", route: "/members?expanded", cache: "1h, tag bills",
      sql: `SELECT COUNT(*) AS total, SUM(CASE WHEN stage='enacted' THEN 1 ELSE 0 END) AS enacted FROM bills INDEXED BY idx_bills_sponsor_agg WHERE sponsor_bioguide_id = ?${CER_AND}`, args: [HEAVY] },
    { fn: "getSponsorTopTopics (HO331 GOOD ref)", route: "/members?expanded", cache: "1h, tag bills",
      sql: `SELECT topics FROM bills INDEXED BY idx_bills_sponsor_topics WHERE sponsor_bioguide_id = ? AND topics IS NOT NULL${CER_AND}`, args: [HEAVY] },
    { fn: "getSponsorRecentBills (HO331 GOOD ref)", route: "/members?expanded", cache: "1h, tag bills",
      sql: `SELECT ${FEED_COLS} FROM bills INDEXED BY idx_bills_sponsor_agg WHERE sponsor_bioguide_id = ? AND summary IS NOT NULL${CER_AND} ORDER BY latest_action_date DESC NULLS LAST`, args: [HEAVY] },

    // ===== UNHINTED bills queries (suspects) =====
    { fn: "getTopicMixByChamber", route: "/trends chamber topic mix", cache: "1h, tag bills",
      sql: `SELECT je.value AS topic, SUM(CASE WHEN bills.bill_type IN (${HOUSE}) THEN 1 ELSE 0 END) AS house_count, SUM(CASE WHEN bills.bill_type IN ('s','sjres','sconres','sres') THEN 1 ELSE 0 END) AS senate_count FROM bills INDEXED BY idx_bills_chamber_topics, json_each(bills.topics) je WHERE bills.topics IS NOT NULL AND (bills.is_ceremonial = 0 OR bills.is_ceremonial IS NULL) GROUP BY je.value ORDER BY (house_count + senate_count) DESC`, args: [] },
    { fn: "getBillsByMonth", route: "/trends time series", cache: "1d, tag bills",
      sql: `SELECT substr(introduced_date,1,7) AS month, COALESCE(json_extract(topics,'$[0]'),'other') AS topic, COUNT(*) AS count FROM bills INDEXED BY idx_bills_trends_month WHERE introduced_date IS NOT NULL${CER_AND} AND topics IS NOT NULL AND congress = (SELECT MAX(congress) FROM bills) GROUP BY month, topic ORDER BY month, topic`, args: [] },
    { fn: "getIntroductionsByMonth", route: "/trends timeline", cache: "1d, tag bills",
      sql: `SELECT substr(introduced_date,1,7) AS month, COUNT(*) AS n FROM bills INDEXED BY idx_bills_trends_month WHERE introduced_date IS NOT NULL${CER_AND} AND topics IS NOT NULL AND congress = (SELECT MAX(congress) FROM bills) GROUP BY month ORDER BY month`, args: [] },
    { fn: "getLawsEnactedBySessionWeek (119)", route: "/reports laws chart", cache: "1d, tag bills",
      sql: `SELECT latest_action_date AS d FROM bills INDEXED BY idx_bills_enacted WHERE congress = 119 AND stage = 'enacted' AND latest_action_date IS NOT NULL`, args: [] },
    { fn: "getMemberStats", route: "/members/[id] hub", cache: "1d, tag members",
      sql: `SELECT COUNT(*) AS bills_sponsored, SUM(CASE WHEN stage='enacted' THEN 1 ELSE 0 END) AS bills_enacted, AVG(cosponsor_count) AS avg_cosponsor_count FROM bills WHERE sponsor_bioguide_id = ?${CER_AND}`, args: [HEAVY] },
    { fn: "getMemberBills", route: "/members/[id] hub", cache: "1d, tag members,bills",
      sql: `SELECT ${FEED_COLS} FROM bills WHERE sponsor_bioguide_id = ? ORDER BY latest_action_date DESC NULLS LAST, id DESC LIMIT ?`, args: [HEAVY, 10] },
    { fn: "queryEnactedThisWeek (getEnactedThisWeek)", route: "/ ENACTED banner", cache: "1h, tag bills", accept: true,
      sql: `SELECT id, bill_type, bill_number FROM bills WHERE ${CER} AND stage = 'enacted' AND stage_changed_at IS NOT NULL AND stage_changed_at > datetime('now', '-7 days') ORDER BY stage_changed_at DESC`, args: [] },
    // getSponsorsRanked / getSponsorCount deleted in HO 335 (dead code) — dropped.
    { fn: "getSponsorStates", route: "(sponsor state dropdown)", cache: "uncached",
      sql: `SELECT DISTINCT sponsor_state FROM bills WHERE summary IS NOT NULL AND sponsor_state IS NOT NULL AND sponsor_state != '' ORDER BY sponsor_state ASC`, args: [] },
    { fn: "getStaleBills (rows)", route: "/stale", cache: "1h, tag bills",
      sql: `SELECT ${FEED_COLS}, ${ENRICH_SELECT}, ${MENTION_SELECT} FROM bills INDEXED BY idx_bills_latest_action ${MENTION_SUBQUERY} ${ENRICH_JOIN} WHERE summary IS NOT NULL${CER_AND} AND latest_action_date IS NOT NULL AND latest_action_date < date('now', '-60 days') AND stage IN (${STALE_ELIGIBLE.map(() => "?").join(",")}) ORDER BY latest_action_date ASC LIMIT ?`, args: [...STALE_ELIGIBLE, 50] },
    // getStaleCount deleted in HO 335 (dead code) — dropped from the probe.
    { fn: "getFeedBills count (bare)", route: "/bills default", cache: "1d, tag bills",
      sql: `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_summary_feed WHERE summary IS NOT NULL${CER_AND}`, args: [] },
    { fn: "getFeedBills count (?stage)", route: "/bills?stage=", cache: "1d, tag bills",
      sql: `SELECT COUNT(*) AS n FROM bills WHERE summary IS NOT NULL AND stage = ?${CER_AND}`, args: ["committee"] },
    { fn: "getFeedBills count (?chamber)", route: "/bills?chamber=", cache: "1d, tag bills",
      sql: `SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_chamber_feed WHERE summary IS NOT NULL AND bill_type IN (${HOUSE})${CER_AND}`, args: [] },
    { fn: "getFeedBills SELECT (bare, action sort)", route: "/bills default rows", cache: "1d, tag bills",
      sql: `SELECT ${FEED_COLS}, sponsor_bioguide_id, cosponsor_count, msp.depiction_url AS sponsor_depiction_url, msp.first_name, msp.last_name, msp.district, ${MENTION_SELECT} FROM bills INDEXED BY idx_bills_latest_action ${MENTION_SUBQUERY} LEFT JOIN members msp ON msp.bioguide_id = bills.sponsor_bioguide_id WHERE summary IS NOT NULL${CER_AND} ORDER BY latest_action_date DESC NULLS LAST, id DESC LIMIT ? OFFSET ?`, args: [25, 0] },
    { fn: "getFeedBills SELECT (bare, introduced sort)", route: "/bills?sort=introduced", cache: "1d, tag bills",
      sql: `SELECT ${FEED_COLS}, ${MENTION_SELECT} FROM bills INDEXED BY idx_bills_introduced_date ${MENTION_SUBQUERY} WHERE summary IS NOT NULL${CER_AND} ORDER BY introduced_date DESC NULLS LAST, id DESC LIMIT ? OFFSET ?`, args: [25, 0] },
    { fn: "getFeedBills SELECT (?chamber)", route: "/bills?chamber= rows", cache: "1d, tag bills",
      sql: `SELECT ${FEED_COLS}, ${MENTION_SELECT} FROM bills INDEXED BY idx_bills_latest_action ${MENTION_SUBQUERY} WHERE summary IS NOT NULL AND bill_type IN (${HOUSE})${CER_AND} ORDER BY latest_action_date DESC NULLS LAST, id DESC LIMIT ? OFFSET ?`, args: [25, 0] },
    { fn: "getFeedBills SELECT (?stage)", route: "/bills?stage= rows", cache: "1d, tag bills",
      sql: `SELECT ${FEED_COLS}, sponsor_bioguide_id, cosponsor_count, msp.depiction_url AS sponsor_depiction_url, ${MENTION_SELECT} FROM bills ${MENTION_SUBQUERY} LEFT JOIN members msp ON msp.bioguide_id = bills.sponsor_bioguide_id WHERE summary IS NOT NULL AND stage = ?${CER_AND} ORDER BY latest_action_date DESC NULLS LAST, id DESC LIMIT ? OFFSET ?`, args: ["committee", 25, 0] },
    { fn: "searchBills", route: "/search?tab=bills", cache: "10m, tag bills",
      sql: `SELECT ${FEED_COLS} FROM bills INDEXED BY idx_bills_summary_feed WHERE summary IS NOT NULL${CER_AND} AND (LOWER(id) LIKE ? OR LOWER(title) LIKE ? OR LOWER(sponsor_name) LIKE ? OR LOWER(summary) LIKE ? OR REPLACE(LOWER(id),'-','') LIKE ?) ORDER BY latest_action_date DESC NULLS LAST, id DESC LIMIT ?`, args: ["%tax%", "%tax%", "%tax%", "%tax%", "%tax%", 50] },
    { fn: "getClusterStats agg", route: "/patterns", cache: "1h, tag bills",
      sql: `SELECT cluster_id, COUNT(*) AS total, SUM(CASE WHEN stage IS NOT NULL AND stage <> 'introduced' AND stage <> 'committee' THEN 1 ELSE 0 END) AS past_committee FROM bills WHERE cluster_id IS NOT NULL GROUP BY cluster_id`, args: [] },
    { fn: "getUnmatchedClusterCount", route: "/patterns", cache: "1h, tag bills",
      sql: `SELECT COUNT(*) AS n FROM bills WHERE cluster_id IS NULL${CER_AND}`, args: [] },
    { fn: "getClusterDrilldown headline", route: "/patterns drill-in", cache: "1h, tag bills",
      sql: `SELECT COUNT(*) AS total, SUM(CASE WHEN stage='enacted' THEN 1 ELSE 0 END) AS enacted FROM bills WHERE cluster_id = ?`, args: [CLUSTER] },
    { fn: "getClusterDrilldown recent", route: "/patterns drill-in", cache: "1h, tag bills",
      sql: `SELECT ${FEED_COLS} FROM bills WHERE cluster_id = ? ORDER BY latest_action_date DESC NULLS LAST, id DESC LIMIT 10`, args: [CLUSTER] },
    { fn: "getBillById", route: "/bills/[id]", cache: "uncached",
      sql: `SELECT id, congress, bill_type, bill_number, title, sponsor_name, summary, raw_json FROM bills WHERE id = ? LIMIT 1`, args: [BILLID] },

    // ===== news_mentions reads =====
    { fn: "getNewsForBill", route: "/news?bill=", cache: "10m, tag news-breaking",
      sql: `SELECT m.id, m.bill_id, b.title FROM news_mentions m INNER JOIN bills b ON b.id = m.bill_id WHERE m.bill_id = ? AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL) ORDER BY m.published_at DESC, m.id DESC LIMIT ?`, args: [BILLID, 50] },
    { fn: "getBreakingNewsForHome", route: "/ BREAKING tab", cache: "10m, tag news-breaking",
      sql: `WITH ranked AS (SELECT m.id, m.bill_id, m.match_confidence, b.title, COALESCE(m.article_url, m.article_title) AS ak, ROW_NUMBER() OVER (PARTITION BY COALESCE(m.article_url, m.article_title) ORDER BY m.match_confidence DESC, m.bill_id ASC) AS rn FROM news_mentions m INDEXED BY idx_news_mentions_published INNER JOIN bills b ON b.id = m.bill_id WHERE m.published_at >= datetime('now', '-' || ? || ' hours') AND m.match_confidence >= ? AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)) SELECT * FROM ranked WHERE rn = 1 LIMIT ?`, args: [72, 0.7, 3] },
    { fn: "getNewsFeed count (windowed)", route: "/bills?mode=news", cache: "10m, tag news-breaking",
      sql: `SELECT COUNT(DISTINCT COALESCE(m.article_url, m.article_title || '|' || m.source || '|' || m.published_at)) AS n FROM news_mentions m INDEXED BY idx_news_mentions_published INNER JOIN bills b ON b.id = m.bill_id WHERE m.published_at >= datetime('now', '-' || ? || ' hours') AND m.match_confidence >= ? AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL)`, args: [72, 0.7] },
    { fn: "searchNews", route: "/search?tab=news", cache: "10m, tag news-breaking",
      sql: `SELECT m.id, m.bill_id, b.title FROM news_mentions m INDEXED BY idx_news_mentions_published INNER JOIN bills b ON b.id = m.bill_id WHERE (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL) AND (LOWER(m.article_title) LIKE ? OR LOWER(m.article_summary) LIKE ? OR LOWER(m.source) LIKE ?) ORDER BY m.published_at DESC, m.id DESC LIMIT ?`, args: ["%tax%", "%tax%", "%tax%", 50] },
    { fn: "MENTION_SUBQUERY (standalone)", route: "every feed-shape query", cache: "n/a",
      sql: `SELECT bill_id, COUNT(*) AS n FROM news_mentions WHERE published_at >= datetime('now', '-${MENTION_WINDOW_DAYS} days') AND match_confidence >= ${NEWS_FLOOR} GROUP BY bill_id`, args: [] },

    // ===== bills joined via PK from a small driver (expected GOOD) =====
    { fn: "getWatchlistBills", route: "/watchlist", cache: "1h, tag watchlist,bills",
      sql: `SELECT b.id, b.title, COALESCE(nm.n,0) AS mention_count_7d FROM bills b INNER JOIN watchlist w ON w.bill_id = b.id LEFT JOIN (SELECT bill_id, COUNT(*) AS n FROM news_mentions WHERE published_at >= datetime('now', '-${MENTION_WINDOW_DAYS} days') AND match_confidence >= ${NEWS_FLOOR} GROUP BY bill_id) nm ON nm.bill_id = b.id WHERE 1=1 ORDER BY b.latest_action_date DESC NULLS LAST, b.id DESC`, args: [] },
    { fn: "getMemberVotes (LEFT JOIN bills)", route: "/members/[id] votes", cache: "1h, tag votes",
      sql: `SELECT v.id, v.bill_id, b.title AS bill_title, mv.position FROM votes v LEFT JOIN bills b ON b.id = v.bill_id INNER JOIN member_votes mv ON mv.vote_id = v.id WHERE mv.bioguide_id = ? ORDER BY v.vote_date DESC, v.id DESC LIMIT ? OFFSET ?`, args: [HEAVY, 25, 0] },
    { fn: "getCommitteeBills (JOIN bills PK)", route: "/committee/[code]", cache: "1h, tag committees",
      sql: `WITH cb AS (SELECT bill_id, MAX(activity_date) AS latest_activity FROM committee_bills WHERE committee_system_code = ? GROUP BY bill_id) SELECT bills.id, bills.title, cb.latest_activity FROM cb JOIN bills ON bills.id = cb.bill_id ORDER BY cb.latest_activity DESC NULLS LAST, bills.update_date DESC LIMIT ?`, args: [COMMITTEE, 50] },
    { fn: "getCommitteeActivityByPeriod (JOIN bills)", route: "/committee/[code] chart", cache: "1h, tag committees",
      sql: `SELECT substr(cb.activity_date,1,7) AS month, COUNT(*) AS n FROM committee_bills cb JOIN bills b ON b.id = cb.bill_id WHERE cb.committee_system_code = ? AND cb.activity_date IS NOT NULL AND b.congress = (SELECT MAX(congress) FROM bills) GROUP BY month`, args: [COMMITTEE] },
    { fn: "getCommitteeTopicMix (JOIN bills)", route: "/committee/[code] topics", cache: "1h, tag committees",
      sql: `SELECT je.value AS topic, COUNT(DISTINCT cb.bill_id) AS n FROM committee_bills cb JOIN bills b ON b.id = cb.bill_id, json_each(b.topics) je WHERE cb.committee_system_code = ? AND b.topics IS NOT NULL AND (b.is_ceremonial = 0 OR b.is_ceremonial IS NULL) GROUP BY je.value ORDER BY n DESC`, args: [COMMITTEE] },
  ];

  console.log(`\n=== 2. EXPLAIN QUERY PLAN — ${Q.length} request-path statements ===`);
  // bads = UNEXPECTED regressions (a BAD plan on a query not flagged `accept`).
  // After HO 335 this list should be EMPTY. The 4 `accept`-flagged entries still
  // print as BAD-ACCEPTED (selective or covering on the dying /dashboard-classic).
  const bads: { fn: string; route: string; cache: string; why: string }[] = [];
  for (const q of Q) {
    let p: string[];
    try {
      p = await plan(q.sql, q.args);
    } catch (e) {
      console.log(`\n[ERR] ${q.fn}: ${(e as Error).message}`);
      continue;
    }
    const v = badPlan(p);
    // Covering vs non-covering is read straight off the plan text: "USING
    // COVERING INDEX idx_bills_dash_*" is index-only (fast even when MULTI-INDEX
    // OR); "USING INDEX idx_bills_is_ceremonial" / "SCAN bills" row-fetch the fat
    // table (the cold-abort signature). EXPLAIN-only — no heavy query execution.
    const tag = !v.bad ? "GOOD" : q.accept ? `BAD-ACCEPTED (${v.why})` : `BAD (${v.why})`;
    console.log(`\n${tag}  ${q.fn}  [${q.route}]  (${q.cache})`);
    for (const line of p) console.log(`    ${line}`);
    if (v.bad && !q.accept) bads.push({ fn: q.fn, route: q.route, cache: q.cache, why: v.why });
  }

  console.log(`\n=== 3. SUMMARY: ${bads.length} UNEXPECTED BAD of ${Q.length} (target: 0) ===`);
  if (bads.length === 0) console.log("  none — every fixed query plans index-only; accepted set unchanged.");
  for (const b of bads) {
    console.log(`  REGRESSION  ${b.fn}  [${b.route}]  (${b.cache})  -> ${b.why}`);
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
