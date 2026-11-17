// HO 821 — THE DASHBOARD SEARCH'S PICK, AS DATA. Corey, 12:47 PM MST
// 2026-11-16: "… when selecting, it stays on the dashboard displaying whatever
// info we selected, with a button to go to whatever that page is", ruled on
// mock-821 v2, kept under docs/design (Z: the card opens under the bar).
// The island (components/DashboardSearch.tsx) asks this route for `?pick=`.
//
// `pick` is `<kind>:<key>`, each key anchored to its own format: a bill id
// (`119-s-4964`, up to six digits so a number CT can't hold reaches the lookup
// and answers 404), a bioguide id (`A000055`), a news mention's id, a report's
// slug (its Monday, `2026-08-31`). Anything else: 400 `{"error":"bad pick"}`.
// Not found: 404 `{"error":"not found"}`, on the same null returns the bill,
// member and report pages read (the member and report pages draw "not found"
// pages rather than 404s).
//
// /SEARCH OWNS THE MATCHING, and the pages own the fields: each card reads what
// its page reads, and nothing else.
// - bill: `getBillById` (the bill page's read). `chamber` from
//   `chamberOfBillId`, since `bills` has none; `stage` the bill page's key, null
//   when the page draws no track (null or off the path); `stages` the six labels
//   the page draws; the sponsor's name with the page's bracket strip.
// - member: `getMember`, `getMemberStats` and `getMemberVoteStats`, the member
//   page's three; `missedPct` is the page's `round(notVoting / total * 100)` for
//   the current Congress, null at 0 votes, where the page shows none.
// - news: `getNewsMentionById`, searchNews's row by its id (the STEP 0 ruling's
//   one new read); `source` as NewsRow draws it.
// - report: `getReport` (the report page's read); `excerpt` is
//   `extractReportLead`, the reports list's lead, at its own 180 characters.
//
// Read-only. A database error: 503 `{"error":"unavailable"}` and nothing else,
// the message logged through `redactSecrets` (HO 679). The 200 is cached at the
// CDN for five minutes; every error answers `no-store`.
import { NextResponse, type NextRequest } from "next/server";
import { ALLOWED_STAGES, ALLOWED_STAGES_SET, type Stage } from "@/lib/enums";
import { formatBillId, parseTopics } from "@/lib/format";
import { chamberOfBillId, labelFromBillId } from "@/lib/bill-rosters-view";
import { extractReportLead } from "@/lib/report-lead";
import { topicLabel } from "@/lib/topic-colors";
import { redactSecrets } from "@/lib/redact";
import {
  getBillById,
  getMember,
  getMemberStats,
  getMemberVoteStats,
  getNewsMentionById,
  getReport,
} from "@/lib/queries";

export const dynamic = "force-dynamic";

const OK_CACHE = "public, s-maxage=300, stale-while-revalidate=900";
const NO_STORE = "no-store";

type Kind = "bill" | "member" | "news" | "report";
const PICK = /^(bill|member|news|report):(.+)$/;
const KEY: Record<Kind, RegExp> = {
  bill: /^[0-9]{1,4}-(hr|s|hjres|sjres|hconres|sconres|hres|sres)-[1-9][0-9]{0,5}$/,
  member: /^[A-Z][0-9]{6}$/,
  news: /^[1-9][0-9]{0,14}$/,
  report: /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/,
};

// The six labels the bill page draws: a fourth copy of `STAGE_BAR_LABEL`
// (components/BillExpandPanel.tsx, module-private in a client file), beside
// lib/report-generation.ts's and components/StageIndicator.tsx's. The smoke
// spec's S2 holds this list equal to the bill page's, in order, so it can't
// drift unread.
const STAGE_LABEL: Record<Stage, string> = {
  introduced: "INTRO",
  committee: "COMMITTEE",
  floor: "FLOOR",
  other_chamber: "OTHER CHAMBER",
  president: "PRESIDENT",
  enacted: "ENACTED",
};
const STAGES = ALLOWED_STAGES.map((s) => STAGE_LABEL[s]);

// The bill page's sponsor strip: a copy of `sponsorDisplayName`
// (app/bill/[id]/page.tsx), which drops sponsor_name's trailing "[R-KS]".
function sponsorDisplayName(name: string): string {
  return name.replace(/\s*\[[^\]]*\]\s*$/, "").trim() || name;
}

const json = (body: unknown, status: number, cache: string) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": cache } });

async function readCard(kind: Kind, key: string): Promise<unknown | null> {
  if (kind === "bill") {
    const bill = await getBillById(key);
    if (!bill) return null;
    return {
      kind,
      id: bill.id,
      label: formatBillId(bill.bill_type, bill.bill_number),
      title: bill.title,
      chamber: chamberOfBillId(bill.id),
      stage: bill.stage && ALLOWED_STAGES_SET.has(bill.stage) ? bill.stage : null,
      stages: STAGES,
      sponsor: bill.sponsor_name
        ? {
            name: sponsorDisplayName(bill.sponsor_name),
            party: bill.sponsor_party,
            state: bill.sponsor_state,
          }
        : null,
      cosponsors: bill.cosponsor_count ?? null,
      introduced: bill.introduced_date,
      lastAction:
        bill.latest_action_date || bill.latest_action_text
          ? { date: bill.latest_action_date, text: bill.latest_action_text }
          : null,
      summary: bill.summary,
      topics: parseTopics(bill.topics).map((t) => ({ key: t, label: topicLabel(t) })),
      href: `/bill/${bill.id}`,
    };
  }
  if (kind === "member") {
    const [member, stats, votes] = await Promise.all([
      getMember(key),
      getMemberStats(key),
      getMemberVoteStats(key),
    ]);
    if (!member) return null;
    return {
      kind,
      bioguide: member.bioguideId,
      name: member.name,
      party: member.party,
      state: member.state,
      chamber: member.chamber,
      sponsored: stats.billsSponsored,
      enacted: stats.billsEnacted,
      missedPct:
        votes.total > 0 ? Math.round((votes.notVoting / votes.total) * 100) : null,
      href: `/members/${member.bioguideId}`,
    };
  }
  if (kind === "news") {
    const n = await getNewsMentionById(Number(key));
    if (!n) return null;
    return {
      kind,
      id: n.id,
      headline: n.title,
      source: n.source.replace(/_/g, " "),
      publishedAt: n.publishedAt,
      url: n.url,
      bill: {
        id: n.billId,
        label: labelFromBillId(n.billId),
        title: n.billTitle,
        href: `/bill/${n.billId}`,
      },
    };
  }
  const report = await getReport(key);
  if (!report) return null;
  return {
    kind,
    slug: report.slug,
    label: report.title,
    excerpt: extractReportLead(report.contentMd),
    href: `/reports/${report.slug}`,
  };
}

export async function GET(request: NextRequest) {
  const m = PICK.exec(request.nextUrl.searchParams.get("pick") ?? "");
  const kind = m?.[1] as Kind | undefined;
  const key = m?.[2] ?? "";
  if (!kind || !KEY[kind].test(key)) {
    return json({ error: "bad pick" }, 400, NO_STORE);
  }
  try {
    const card = await readCard(kind, key);
    if (!card) return json({ error: "not found" }, 404, NO_STORE);
    return json(card, 200, OK_CACHE);
  } catch (err) {
    console.error(
      "[search/card] read failed:",
      redactSecrets(err instanceof Error ? err.message : String(err)),
    );
    return json({ error: "unavailable" }, 503, NO_STORE);
  }
}
