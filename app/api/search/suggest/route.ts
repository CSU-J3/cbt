// HO 821 — THE DASHBOARD SEARCH'S RESULTS, AS DATA. Corey, 12:47 PM MST
// 2026-11-16: "Dashboard needs a search bar in a good location both on mobile
// and web. and when you search, have it activity pulling stuff …", ruled on
// mock-821 v2, kept under docs/design (A · C · Z). The island
// (components/DashboardSearch.tsx) asks this route as the reader types.
//
// /SEARCH OWNS THE MATCHING. Every read here is /search's own (lib/queries.ts):
// `sanitizeQ`, the four `search*Count`s and the four `search*` lists, and the
// `parseBillRef` fast path's `getBillById`. Each list is /search's cached 50,
// sliced to its first 4, so a group is the head of the tab /search would show,
// in its order, and the counts are the tab counts /search prints. Change the
// match there, and this follows.
//
// `ref`: when `q` parses as a bill number (`parseBillRef`, the current Congress,
// as /search's fast path builds it) and CT holds that bill, its id, and the bill
// leads `bills` without a duplicate, keeping 4 by dropping the last. The check is
// /search's own `getBillById`, which has no visibility filter, so a ceremonial
// or summary-less bill can lead a list /search's LEGISLATION tab never shows.
//
// Read-only. Under 2 characters after `sanitizeQ`: 400 with no read (the route's
// own floor; /search has none). A database error: 503 `{"error":"unavailable"}`
// and nothing else, the message logged through `redactSecrets` (HO 679). The 200
// is cached at the CDN for a minute; every error answers `no-store`, so a 503
// is never cached.
import { NextResponse, type NextRequest } from "next/server";
import { parseBillRef } from "@/lib/bill-ref";
import { getCurrentCongress } from "@/lib/congress";
import { formatBillId } from "@/lib/format";
import { labelFromBillId } from "@/lib/bill-rosters-view";
import { redactSecrets } from "@/lib/redact";
import {
  getBillById,
  sanitizeQ,
  searchBills,
  searchBillsCount,
  searchMembers,
  searchMembersCount,
  searchNews,
  searchNewsCount,
  searchReports,
  searchReportsCount,
  type FeedBill,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const ROWS = 4;
const MIN_Q = 2;
const OK_CACHE = "public, s-maxage=60, stale-while-revalidate=300";
const NO_STORE = "no-store";

// The short sponsor name /search's bill rows draw: a copy of `shortSponsor`
// (components/BillRow.tsx), which is private to that module.
function shortSponsor(name: string | null): string {
  if (!name) return "";
  const noPrefix = name.replace(/^(Rep\.|Sen\.|Del\.|Res\.)\s*/i, "").trim();
  const lastName = noPrefix.split(",")[0]?.trim();
  return lastName ?? noPrefix;
}

function billRow(b: FeedBill) {
  return {
    id: b.id,
    label: formatBillId(b.bill_type, b.bill_number),
    title: b.title,
    sponsor: shortSponsor(b.sponsor_name),
    party: b.sponsor_party,
    state: b.sponsor_state,
  };
}

export async function GET(request: NextRequest) {
  const q = sanitizeQ(request.nextUrl.searchParams.get("q"));
  if (q.length < MIN_Q) {
    return NextResponse.json(
      { error: "q too short" },
      { status: 400, headers: { "Cache-Control": NO_STORE } },
    );
  }

  const parsed = parseBillRef(q);
  const refId = parsed
    ? `${getCurrentCongress()}-${parsed.type}-${parsed.number}`
    : null;

  try {
    const [
      billsCount,
      membersCount,
      newsCount,
      reportsCount,
      bills,
      members,
      news,
      reports,
      refBill,
    ] = await Promise.all([
      searchBillsCount(q),
      searchMembersCount(q),
      searchNewsCount(q),
      searchReportsCount(q),
      searchBills(q),
      searchMembers(q),
      searchNews(q),
      searchReports(q),
      refId ? getBillById(refId) : Promise.resolve(null),
    ]);

    const billRows = bills.map(billRow);
    const ref = refBill ? refBill.id : null;
    const ledBills = refBill
      ? [billRow(refBill), ...billRows.filter((b) => b.id !== refBill.id)]
      : billRows;

    return NextResponse.json(
      {
        q,
        ref,
        counts: {
          bills: billsCount,
          members: membersCount,
          news: newsCount,
          reports: reportsCount,
        },
        bills: ledBills.slice(0, ROWS),
        members: members.slice(0, ROWS).map((m) => ({
          bioguide: m.bioguide_id,
          name: m.name,
          party: m.party,
          state: m.state,
          chamber: m.chamber,
        })),
        news: news.slice(0, ROWS).map((n) => ({
          id: n.id,
          headline: n.title,
          // NewsRow's display of the source slug (components/NewsRow.tsx).
          source: n.source.replace(/_/g, " "),
          publishedAt: n.publishedAt,
          bill: { id: n.billId, label: labelFromBillId(n.billId) },
        })),
        reports: reports.slice(0, ROWS).map((r) => ({
          slug: r.slug,
          label: r.title,
        })),
      },
      { headers: { "Cache-Control": OK_CACHE } },
    );
  } catch (err) {
    console.error(
      "[search/suggest] read failed:",
      redactSecrets(err instanceof Error ? err.message : String(err)),
    );
    return NextResponse.json(
      { error: "unavailable" },
      { status: 503, headers: { "Cache-Control": NO_STORE } },
    );
  }
}
