// HO 754 legs: every meeting reader, called for real against a `file:` copy, and
// which of the given event ids each returns. Spawned by the legs driver as
//   node --import tsx --import ./scripts/diagnostic/next-cache-stub-754.mjs \
//     scripts/diagnostic/committee-meetings-queries-754.ts <json args>
// with TURSO_DATABASE_URL=file:<copy> and no token. It refuses any other scheme.
// Args: { ids: string[], committees: string[], bills: string[] }. Prints one JSON line.
import {
  getMeetingsByCommittee,
  getMeetingsForBill,
  getRecentMeetings,
  getUpcomingMeetings,
  getWeeklyBandHearingBreakdown,
  getWeeklyBandHearings,
  getWeeklyBandHistory,
} from "@/lib/queries";

const url = process.env.TURSO_DATABASE_URL ?? "";
if (!url.startsWith("file:") || process.env.TURSO_AUTH_TOKEN) {
  console.error(`refused: the query probe reads a file: copy with no token (got ${url.split(":")[0]}:)`);
  process.exit(2);
}
const a = JSON.parse(process.argv[2] ?? "{}") as { ids: string[]; committees: string[]; bills: string[] };
const hit = (ms: { eventId: string }[]) => a.ids.filter((id) => ms.some((m) => String(m.eventId) === id));

const out: Record<string, unknown> = {};
out.upcoming = hit(await getUpcomingMeetings());
out.upcoming7 = hit(await getUpcomingMeetings({ days: 7 }));
out.recent7 = hit(await getRecentMeetings(7));
out.recent14 = hit(await getRecentMeetings(14));
out.byCommittee = Object.fromEntries(await Promise.all(a.committees.map(async (c) => [c, hit(await getMeetingsByCommittee(c))] as const)));
out.byCommitteeUpcoming = Object.fromEntries(await Promise.all(a.committees.map(async (c) => [c, hit(await getMeetingsByCommittee(c, { upcomingOnly: true }))] as const)));
out.forBill = Object.fromEntries(await Promise.all(a.bills.map(async (b) => [b, hit(await getMeetingsForBill(b))] as const)));
out.band = await getWeeklyBandHearings();
const br = await getWeeklyBandHearingBreakdown();
out.breakdown = br;
out.breakdownSum = br.byType.HEARINGS + br.byType.MARKUPS + br.byType.BUSINESS;
out.history = (await getWeeklyBandHistory()).map((h) => ({ weekStart: h.weekStart, hearings: h.hearings }));
console.log(JSON.stringify(out));
process.exit(0);
