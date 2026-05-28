// HO 148 — lazy panel data for the click-to-expand BillRow accordion. The
// feed query already carries summary + sponsor + dates on `FeedBill`;
// committees and news are the two reads that would bloat a 50-rows-per-
// page feed query if pre-rendered. This route runs them on first expand
// only; BillRowList caches the result per row so re-expanding the same
// row is free.
import { NextResponse } from "next/server";
import {
  getBillCommittees,
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

  const [committees, news] = await Promise.all([
    getBillCommittees(billId),
    getNewsForBill(billId, NEWS_LIMIT),
  ]);

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
  });
}
