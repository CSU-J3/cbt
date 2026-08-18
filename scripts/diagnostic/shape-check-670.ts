import { AsyncLocalStorage } from "node:async_hooks";
import "dotenv/config";
(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;
(globalThis as Record<string, unknown>).__incrementalCache = {
  isOnDemandRevalidate: false,
  generateCacheKey: async (k: string) => k,
  get: async () => null,
  set: async () => {},
};
async function main() {
  const q = await import("../../lib/queries");
  const races = await q.getMostCompetitiveRaces(2026, 3);
  console.log("RACES:", JSON.stringify(races.map((r) => ({ id: r.raceId, ch: r.chamber, inc: r.incumbentName, p: r.incumbentParty, n: r.ratings.length, r0: r.ratings[0]?.rating, s0: r.ratings[0]?.source, score: r.competitivenessScore })), null, 1));
  const members = await q.getMembersRanked({}, "volume", 1, 3);
  console.log("MEMBERS:", JSON.stringify(members.map((m) => ({ n: m.name, p: m.party, s: m.state, c: m.chamber, d: m.district, t: m.total, e: m.enacted })), null, 1));
  const meetings = await q.getUpcomingMeetings();
  console.log("MEETINGS:", JSON.stringify(meetings.map((m) => ({ d: m.meetingDate, t: m.title.slice(0, 50), ch: m.chamber, ty: m.meetingType, st: m.meetingStatus, cc: m.committeeSystemCode, bills: m.bills.length })), null, 1));
  const recent = await q.getRecentMeetings(14);
  console.log("RECENT MEETINGS:", recent.length, JSON.stringify(recent.slice(0, 2).map((m) => ({ d: m.meetingDate, t: m.title.slice(0, 40), ch: m.chamber, ty: m.meetingType, st: m.meetingStatus })), null, 1));
  const news = await q.getBreakingNewsForHome({ limit: 3, hours: 72 });
  console.log("NEWS:", JSON.stringify(news.map((n) => ({ src: n.source, t: n.title.slice(0, 50), bill: n.billId, at: n.publishedAt, other: n.otherBills.length })), null, 1));
  const clusters = await q.getClusterStats();
  console.log("CLUSTERS:", JSON.stringify(clusters.map((c) => ({ id: c.id, n: c.name, d: c.description.slice(0, 40), c: c.count, pc: c.pastCommittee, e: c.enacted })), null, 1));
  const stale = await q.getStaleBills({}, 3);
  console.log("STALE:", JSON.stringify(stale.map((b) => ({ id: b.id, t: b.bill_type, n: b.bill_number, stage: b.stage, la: b.latest_action_date, sp: b.sponsor_name, last: b.sponsor_last_name, party: b.sponsor_party, st: b.sponsor_state })), null, 1));
  const enacted = await q.getFeedBills({ stage: "enacted" }, { page: 1, pageSize: 3 });
  console.log("ENACTED:", JSON.stringify(enacted.bills.map((b) => ({ id: b.id, t: b.bill_type, n: b.bill_number, la: b.latest_action_date, last: b.sponsor_last_name, party: b.sponsor_party, st: b.sponsor_state })), null, 1));
  const roll = await q.getLobbyingRollup();
  const drills = roll ? Object.values(roll.drill) : [];
  const filings = drills.flatMap((d) => d.recent.map((f) => ({ code: d.code, display: d.display, ...f })));
  filings.sort((a, b) => (a.dtPosted < b.dtPosted ? 1 : -1));
  console.log("LDA FILINGS total:", filings.length);
  console.log(JSON.stringify(filings.slice(0, 3).map((f) => ({ code: f.code, disp: f.display, client: f.clientName, reg: f.registrantName, inc: f.income, exp: f.expenses, dt: f.dtPosted, bills: f.billIds.length, period: f.filingPeriod })), null, 1));
}
main().catch((e) => { console.error("FAILED:", e); process.exit(1); });
