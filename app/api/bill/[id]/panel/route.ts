// HO 148 — lazy panel data for the click-to-expand BillRow accordion. The
// feed query already carries summary + sponsor + dates on `FeedBill`;
// committees and news are the two reads that would bloat a 50-rows-per-
// page feed query if pre-rendered. This route runs them on first expand
// only; BillRowList caches the result per row so re-expanding the same
// row is free.
import { NextResponse } from "next/server";
import {
  getBillCommittees,
  getCommitteeBySystemCode,
  getMeetingsForBill,
  getNewsForBill,
  sanitizeBillId,
} from "@/lib/queries";

const NEWS_LIMIT = 5;

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const billId = sanitizeBillId(id);
  if (!billId) {
    return NextResponse.json({ error: "invalid bill id" }, { status: 400 });
  }

  const [committees, news, meetings] = await Promise.all([
    getBillCommittees(billId),
    getNewsForBill(billId, NEWS_LIMIT),
    getMeetingsForBill(billId),
  ]);

  // HO 299: resolve committee names for the meetings' system codes (cached
  // single-row lookups; a bill usually has 1–2 distinct committees, so this is a
  // couple of cached reads, not an N+1).
  const codes = [
    ...new Set(
      meetings
        .map((m) => m.committeeSystemCode)
        .filter((c): c is string => !!c),
    ),
  ];
  const nameByCode = new Map<string, string>();
  await Promise.all(
    codes.map(async (code) => {
      const c = await getCommitteeBySystemCode(code);
      if (c) nameByCode.set(code, c.name);
    }),
  );

  return NextResponse.json({
    committees: committees.map((c) => ({
      systemCode: c.systemCode,
      name: c.name,
      chamber: c.chamber,
      parentName: c.parentName,
      activityType: c.activityType,
      activityDate: c.activityDate,
    })),
    news: news.map((n) => ({
      id: n.id,
      title: n.title,
      source: n.source,
      url: n.url,
      publishedAt: n.publishedAt,
    })),
    meetings: meetings.map((m) => ({
      eventId: m.eventId,
      meetingDate: m.meetingDate,
      committeeSystemCode: m.committeeSystemCode,
      committeeName: m.committeeSystemCode
        ? (nameByCode.get(m.committeeSystemCode) ?? null)
        : null,
    })),
  });
}
