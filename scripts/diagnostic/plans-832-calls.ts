// HO 832 § 1 — the loader calls plans-832.ts's capture mode makes, over the
// handoff's inputs. Each call is the page's own call with the page's own
// arguments, as the page trees read at 79484ad (docs/handoffs/832-artifacts/
// map-832.md): the same filter object literals, the same row limits, the same
// constants. The capture runs them in order against prod, through the guard.
//
// Imported only by plans-832.ts (capture mode), after the guard wraps the
// client; lib/queries' getDb() returns that same wrapped client.
import * as Q from "../../lib/queries";
import { ALLOWED_STAGES, ALLOWED_TOPICS } from "../../lib/enums";

type Call = [string, () => Promise<unknown>];
export const CALLS: Call[] = [];
const add = (label: string, f: () => Promise<unknown>) => CALLS.push([label, f]);

const STAGES = [...ALLOWED_STAGES];
const TOPIC = "healthcare";
const TERM = "tax";
const CLUSTER = "facility-naming";
if (!ALLOWED_TOPICS.includes(TOPIC)) throw new Error("topic moved");

// ---- /bills (app/bills/page.tsx:160-183; HeaderBar's getCorpusStats(true)) ----------------
// feedFilters, the nine keys of page.tsx:160-170. direction is "asc" only for
// stage=president with no explicit sort (page.tsx:142-144); every input here
// leaves sort unset, so sanitizeSort gives "action" unless named.
type FF = Parameters<typeof Q.getFeedBills>[0];
const bills = (o: Partial<FF> & { sortExplicit?: boolean }): FF => {
  const { sortExplicit, ...rest } = o;
  const stage = rest.stage;
  return {
    topics: [],
    stage: undefined,
    q: undefined,
    sponsor: undefined,
    sort: "action",
    chamber: undefined,
    includeCeremonial: false,
    cluster: undefined,
    direction: stage === "president" && !sortExplicit ? "asc" : undefined,
    ...rest,
  } as FF;
};
const billsPage = (label: string, f: FF) => {
  add(`/bills ${label} · getFeedBills`, () => Q.getFeedBills(f, { page: 1, pageSize: Q.FEED_PAGE_SIZE }));
  add(`/bills ${label} · getBillTopicRailCounts`, () => Q.getBillTopicRailCounts(f));
};
add("HeaderBar · getCorpusStats(true)", () => Q.getCorpusStats(true));
billsPage("(no filter)", bills({}));
billsPage("chamber=house", bills({ chamber: "house" }));
billsPage(`topics=${TOPIC}`, bills({ topics: [TOPIC] }));
billsPage(`q=${TERM}`, bills({ q: TERM }));
billsPage(`cluster=${CLUSTER}`, bills({ cluster: CLUSTER }));
billsPage("ceremonial=1", bills({ includeCeremonial: true }));
billsPage("sort=introduced", bills({ sort: "introduced", sortExplicit: true }));
for (const stage of STAGES) {
  billsPage(`stage=${stage}`, bills({ stage }));
  billsPage(`stage=${stage}&chamber=house`, bills({ stage, chamber: "house" }));
  billsPage(`stage=${stage}&chamber=senate`, bills({ stage, chamber: "senate" }));
  billsPage(`stage=${stage}&topics=${TOPIC}`, bills({ stage, topics: [TOPIC] }));
  billsPage(`stage=${stage}&q=${TERM}`, bills({ stage, q: TERM }));
  billsPage(`stage=${stage}&cluster=${CLUSTER}`, bills({ stage, cluster: CLUSTER }));
  billsPage(`stage=${stage}&ceremonial=1`, bills({ stage, includeCeremonial: true }));
  billsPage(`stage=${stage}&sort=introduced`, bills({ stage, sort: "introduced", sortExplicit: true }));
}

// ---- /stale (app/stale/page.tsx:45-98) ----------------------------------------------------
// feedFilters, page.tsx:52-59; the footer count takes them minus stage, and
// isn't read under stage=committee (page.tsx:87).
const stale = (o: Partial<FF>): FF => ({ topics: [], stage: undefined, q: undefined, chamber: undefined, includeCeremonial: false, cluster: undefined, ...o }) as FF;
const stalePage = (label: string, f: FF) => {
  add(`/stale ${label} · getStaleBills`, () => Q.getStaleBills(f, 50));
  if (f.stage !== "committee") {
    const { stage: _ignored, ...countFilters } = f;
    void _ignored;
    add(`/stale ${label} · getStaleCommitteeCount`, () => Q.getStaleCommitteeCount(countFilters as FF));
  }
};
stalePage("(no filter)", stale({}));
for (const chamber of ["house", "senate"] as const) stalePage(`chamber=${chamber}`, stale({ chamber }));
stalePage(`topics=${TOPIC}`, stale({ topics: [TOPIC] }));
stalePage(`q=${TERM}`, stale({ q: TERM }));
stalePage(`cluster=${CLUSTER}`, stale({ cluster: CLUSTER }));
stalePage("ceremonial=1", stale({ includeCeremonial: true }));
for (const stage of ["introduced", "committee", "floor", "other_chamber"]) {
  stalePage(`stage=${stage}`, stale({ stage }));
  stalePage(`stage=${stage}&chamber=house`, stale({ stage, chamber: "house" }));
}

// ---- / (app/page.tsx:97-151 and the panels it renders) -----------------------------------
// DashboardFilters { stage, topic }; chamber narrows MOVERS / TOP STALLS / NEW
// only (page.tsx:101-108).
type DF = { stage?: string; topic?: string };
const home = (label: string, filters: DF, chamber?: "house" | "senate") => {
  const f = filters as never;
  add(`/ ${label} · getStageDistribution(filters, true)`, () => Q.getStageDistribution(f, true));
  add(`/ ${label} · getTopicDistribution(filters, true)`, () => Q.getTopicDistribution(f, true));
  add(`/ ${label} · getBreakingNewsForHomeCount`, () => Q.getBreakingNewsForHomeCount({ hours: 72, minConfidence: 0.7, filters: f }));
  add(`/ ${label} · getStageChangesCount({chamber}, 7, filters)`, () => Q.getStageChangesCount({ chamber } as never, 7, f));
  add(`/ ${label} · getNewBillsThisWeekCount(chamber)`, () => Q.getNewBillsThisWeekCount(chamber));
  add(`/ ${label} · getStaleBillsCount(chamber)`, () => Q.getStaleBillsCount(chamber));
  add(`/ ${label} · getBreakingNewsForHome (BreakingNewsBlock)`, () => Q.getBreakingNewsForHome({ hours: 72, minConfidence: 0.7, limit: 10, filters: f }));
  add(`/ ${label} · getStageChanges (ActivityTicker)`, () => Q.getStageChanges({ chamber } as never, 7, 30, f));
  add(`/ ${label} · getStaleBills (TopStalls)`, () => Q.getStaleBills({ chamber } as never, 60));
  add(`/ ${label} · getNewBillsThisWeek (NewThisWeek)`, () => Q.getNewBillsThisWeek(30, chamber));
};
add("/ · getStageDistribution(undefined, true)", () => Q.getStageDistribution(undefined, true));
add("/ · getAbsenceWatch", () => Q.getAbsenceWatch());
add("/ HearingsTab · getUpcomingMeetings()", () => Q.getUpcomingMeetings());
add("/ HearingsTab · getRecentMeetings(14)", () => Q.getRecentMeetings(14));
add("/ WeeklyBand · getEnactedThisWeek", () => Q.getEnactedThisWeek());
add("/ WeeklyBand · getStageChangesCount({}, 7)", () => Q.getStageChangesCount({} as never, 7));
add("/ WeeklyBand · getNewBillsThisWeekCount()", () => Q.getNewBillsThisWeekCount());
add("/ WeeklyBand · getWeeklyBandFiller", () => Q.getWeeklyBandFiller());
add("/ WeeklyBand · getWeeklyBandPriorWeek", () => Q.getWeeklyBandPriorWeek());
add("/ WeeklyBand · getWeeklyBandTransitionLadder", () => Q.getWeeklyBandTransitionLadder());
add("/ WeeklyBand · getWeeklyBandNewBillsBreakdown", () => Q.getWeeklyBandNewBillsBreakdown());
add("/ WeeklyBand · getMostRecentEnacted", () => Q.getMostRecentEnacted());
home("(no filter)", { stage: undefined, topic: undefined });
home("chamber=house", { stage: undefined, topic: undefined }, "house");
home(`topics=${TOPIC}`, { stage: undefined, topic: TOPIC });
for (const stage of STAGES) home(`stage=${stage}`, { stage, topic: undefined });

// ---- /welcome (app/welcome/page.tsx:140-158, panels.tsx:205-218) --------------------------
add("/welcome · getStageChangesCount({}, 7)", () => Q.getStageChangesCount({} as never, 7));
add("/welcome · getStageDistribution(undefined, true)", () => Q.getStageDistribution(undefined, true));
add("/welcome · getStageChanges({}, 7, 12)", () => Q.getStageChanges({} as never, 7, 12));
add("/welcome · getStaleBills({}, 12)", () => Q.getStaleBills({} as never, 12));
add("/welcome · getFeedBills({stage: enacted}, 12)", () => Q.getFeedBills({ stage: "enacted" } as never, { page: 1, pageSize: 12 }));
add("/welcome · getMembersRanked({}, volume, 1, 12)", () => Q.getMembersRanked({} as never, "volume", 1, 12));
add("/welcome · getBreakingNewsForHome({limit: 12, hours: 72})", () => Q.getBreakingNewsForHome({ limit: 12, hours: 72 }));
add("/welcome · getClusterStats", () => Q.getClusterStats());

// ---- /electoral (app/electoral/page.tsx:139, the 2026 branch) ----------------------------
add("/electoral · getBallotMemberFacts(getGeneralBallots(2026).memberIds, the current congress)", async () => {
  const general = await Q.getGeneralBallots(2026);
  // HO 839: the votes' Congress is the caller's argument now (app/electoral/page.tsx).
  const { getCurrentCongress } = await import("../../lib/congress");
  return Q.getBallotMemberFacts(general.memberIds, getCurrentCongress());
});

// ---- /members (app/members/page.tsx:117-238) ------------------------------------------------
const memberFilters = { chamber: undefined, party: undefined, state: undefined, q: undefined, includeCeremonial: false };
add("/members · getMembersTopicMix(false)", () => Q.getMembersTopicMix(false));
add("/members ceremonial=1 · getMembersTopicMix(true)", () => Q.getMembersTopicMix(true));
add("/members · getMembersRanked(filters, volume, 1, 600)", () => Q.getMembersRanked(memberFilters as never, "volume", 1, 600));
add("/members · getUpcomingMeetings({days: 7})", () => Q.getUpcomingMeetings({ days: 7, chamber: undefined }));
// ?committee and ?expanded take real ids, read from prod at run time.
add("/members committee=<the first committee> · getCommitteeRoster", async () => {
  const idx = (await Q.getCommitteesIndex({} as never)) as unknown as { systemCode?: string; system_code?: string }[];
  const code = idx.map((c) => c.systemCode ?? c.system_code).find(Boolean);
  if (!code) throw new Error("no committee to scope");
  return Q.getCommitteeRoster(code, "volume", false);
});
add("/members expanded=<the top-ranked member> · getMemberCardExpansion", async () => {
  const ranked = (await Q.getMembersRanked(memberFilters as never, "volume", 1, 1)) as unknown as { bioguide_id: string }[];
  if (!ranked[0]) throw new Error("no member to expand");
  return Q.getMemberCardExpansion(ranked[0].bioguide_id, false);
});

// ---- beyond the handoff's list: every other reader of bills the hunt found that
// can be called read-only (docs/handoffs/832-artifacts/map-832.md). Real ids are
// read from prod at run time, once, by idsOf(), under the label of the first call
// that needs it (so that call's statement count includes the lookups): the first
// bill /bills lists, the top-ranked member,
// the first committee, that member's latest vote, the latest news mention.
export const OTHERS: Call[] = [];
const other = (label: string, f: () => Promise<unknown>) => OTHERS.push([label, f]);
type Ids = { bill: string; member: string; committee: string; vote: string | null; mention: number | null; cluster: string | null };
let ids: Ids | null = null;
const idsOf = async (): Promise<Ids> => {
  if (ids) return ids;
  const feed = (await Q.getFeedBills(bills({}), { page: 1, pageSize: Q.FEED_PAGE_SIZE })) as unknown as { bills: { id: string }[] };
  const ranked = (await Q.getMembersRanked(memberFilters as never, "volume", 1, 1)) as unknown as { bioguide_id: string }[];
  const idx = (await Q.getCommitteesIndex({} as never)) as unknown as { systemCode?: string; system_code?: string }[];
  const votes = (await Q.getMemberVotes(ranked[0]!.bioguide_id, { page: 1, pageSize: 20 })) as unknown as { votes?: { id: string }[]; rows?: { id: string }[] } | { id: string }[];
  const voteRows = Array.isArray(votes) ? votes : (votes.votes ?? votes.rows ?? []);
  const news = (await Q.getNewsFeed({ windowHours: 72 } as never, { page: 1, pageSize: 50 })) as unknown as { mentions?: { id: number }[]; items?: { id: number }[]; rows?: { id: number }[] };
  const mentionRows = news.mentions ?? news.items ?? news.rows ?? [];
  const stats = (await Q.getClusterStats()) as unknown as { id?: string; cluster_id?: string }[];
  ids = {
    bill: feed.bills[0]!.id,
    member: ranked[0]!.bioguide_id,
    committee: idx.map((c) => c.systemCode ?? c.system_code).find(Boolean)!,
    vote: voteRows[0]?.id ?? null,
    mention: mentionRows[0]?.id ?? null,
    cluster: stats.map((s) => s.id ?? s.cluster_id).find(Boolean) ?? null,
  };
  return ids;
};
const changes = { topics: [], q: undefined, chamber: undefined, includeCeremonial: false, cluster: undefined } as never;
other("/president · getFeedBills({stage: president, direction: asc})", () => Q.getFeedBills({ stage: "president", direction: "asc" } as never, { page: 1, pageSize: Q.FEED_PAGE_SIZE }));
other("/changes · getStageChanges(filters, 7)", () => Q.getStageChanges(changes, 7));
other("/changes · getStageChangesCount(filters, 7)", () => Q.getStageChangesCount(changes, 7));
other("/patterns · getClusterStats", () => Q.getClusterStats());
other("/patterns · getUnmatchedClusterCount(false)", () => Q.getUnmatchedClusterCount(false));
other("/patterns · getFillerWatch", () => Q.getFillerWatch());
other("/patterns · getClusterDrilldown(<the first cluster>)", async () => {
  const { cluster } = await idsOf();
  if (!cluster) throw new Error("no cluster");
  return Q.getClusterDrilldown(cluster);
});
other(`/search q=${TERM} · searchBillsCount`, () => Q.searchBillsCount(TERM));
other(`/search q=${TERM} · searchBills`, () => Q.searchBills(TERM));
other(`/search q=${TERM} · searchNewsCount`, () => Q.searchNewsCount(TERM));
other(`/search q=${TERM} · searchNews`, () => Q.searchNews(TERM));
other(`/search q=${TERM} · searchMembers`, () => Q.searchMembers(TERM));
other("/bill/[id] · getBillById", async () => Q.getBillById((await idsOf()).bill));
other("/bill/[id] · getNewsForBill(id, 5)", async () => Q.getNewsForBill((await idsOf()).bill, 5));
other("/bill/[id] · getMeetingsForBill", async () => Q.getMeetingsForBill((await idsOf()).bill));
other("/bill/[id] · getVotesByBill", async () => Q.getVotesByBill((await idsOf()).bill));
other("/api/bill/[id]/panel · getBillRelatedBills", async () => Q.getBillRelatedBills((await idsOf()).bill));
other("/api/bill/[id]/panel · getBillCommittees", async () => Q.getBillCommittees((await idsOf()).bill));
other("/committee/[code] · getCommitteeBills(code, 25, 30)", async () => Q.getCommitteeBills((await idsOf()).committee, 25, 30));
other("/committee/[code] · getMeetingsByCommittee", async () => Q.getMeetingsByCommittee((await idsOf()).committee));
other("/committee/[code] · getCommitteeActivityByPeriod", async () => Q.getCommitteeActivityByPeriod((await idsOf()).committee));
other("/committee/[code] · getCommitteeTopicMix", async () => Q.getCommitteeTopicMix((await idsOf()).committee));
other("/members/[id] · getMemberStats", async () => Q.getMemberStats((await idsOf()).member));
other("/members/[id] · getMemberBills(id, 10)", async () => Q.getMemberBills((await idsOf()).member, 10));
other("/members/[id] · getMemberVotes(id, 1, 20)", async () => Q.getMemberVotes((await idsOf()).member, { page: 1, pageSize: 20 }));
other("/members/[id] · getMemberAmendments", async () => Q.getMemberAmendments((await idsOf()).member));
other("/news · getNewsFeed({windowHours: 72}, 1, 50)", () => Q.getNewsFeed({ windowHours: 72 } as never, { page: 1, pageSize: 50 }));
other("/news · getNewsTopicRailCounts({windowHours: 72})", () => Q.getNewsTopicRailCounts({ windowHours: 72 } as never));
other("/amendments · getAmendmentsSummary", () => Q.getAmendmentsSummary());
other("/amendments · getAmendments({page: 1})", () => Q.getAmendments({ page: 1 }));
other("/vote/[id] · getVoteById", async () => {
  const { vote } = await idsOf();
  if (!vote) throw new Error("no vote id");
  return Q.getVoteById(vote);
});
other("/vote/[id] · getVoteAmendmentContext", async () => {
  const { vote } = await idsOf();
  if (!vote) throw new Error("no vote id");
  return Q.getVoteAmendmentContext(vote);
});
other("/api/search/card · getNewsMentionById", async () => {
  const { mention } = await idsOf();
  if (mention == null) throw new Error("no mention id");
  return Q.getNewsMentionById(mention);
});
other("/trends · getBillsByMonth", () => Q.getBillsByMonth());
other("/trends · getTopicMixByChamber", () => Q.getTopicMixByChamber());
other("/reports · getLawsEnactedBySessionWeek", () => Q.getLawsEnactedBySessionWeek());
// The crons' reads that are exported and read-only.
other("/api/cron/news · getCandidateBills(30)", () => Q.getCandidateBills(30));
other("/api/cron/committees · readCommitteeWalkBacklog", async () => (await import("../../lib/committees-sync")).readCommitteeWalkBacklog());
other("/api/cron/weekly-report · buildWeekSummaryPayload(db, last Monday)", async () => {
  const { buildWeekSummaryPayload } = await import("../../lib/week-summary");
  const { getDb } = await import("../../lib/db");
  // The week the Monday cron writes: the Monday a week before this one (MST dates).
  const now = new Date(Date.now() - 7 * 3_600_000);
  const dow = (now.getUTCDay() + 6) % 7;
  const monday = new Date(now.getTime() - (dow + 7) * 864e5).toISOString().slice(0, 10);
  return buildWeekSummaryPayload(getDb(), monday);
});
