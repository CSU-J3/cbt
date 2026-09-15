import { expireTag } from "@/lib/cache/expire-tag";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function authorize(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured on the server" },
      { status: 500 },
    );
  }
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

const ALLOWED_TAGS = new Set([
  "bills",
  "reports",
  "races",
  "race-ratings",
  "news-breaking",
  // HO 398: race-detail news section (getRaceNews), flushed by the news cron.
  "race-news",
  // HO 414: member-hub news section (getMemberNews), same news-cron flush.
  "member-news",
  "member-trades",
  // HO 390: sync:fec flushes the member-hub fundraising line (totals + the
  // small/large-dollar split) after a backfill.
  "member-fundraising",
  // HO 437: the /lobbying surface (getLobbyingRollup + getRecentFilings). Flushed
  // by the LDA cron after it recomputes the rollup blob, and by a manual backfill.
  "lda",
  // HO 713 → 726: the vote surfaces (getAbsenceWatch, the member vote stats, the
  // participation strip, getRecentVotes; 17 readers). Flushed by /api/sync-votes when
  // a chamber inserted and by the amendments cron on changed Senate materialisation or
  // inserted House links; this entry is the manual path after `npm run sync:votes` or
  // `npm run sync:career-votes`.
  "votes",
  // HO 717 → 726: the committee-meetings readers (getUpcomingMeetings, getRecentMeetings,
  // getMeetingsByCommittee, getMeetingsForBill, the weekly band's hearings; 7 readers).
  // Flushed by /api/cron/committees every 12 h; this entry is the manual path after a
  // reader change or `npm run sync:meetings`.
  "meetings",
]);

export async function POST(request: Request) {
  const denied = authorize(request);
  if (denied) return denied;
  const tag = new URL(request.url).searchParams.get("tag") ?? "bills";
  if (!ALLOWED_TAGS.has(tag)) {
    return NextResponse.json(
      { error: `tag must be one of: ${[...ALLOWED_TAGS].join(", ")}` },
      { status: 400 },
    );
  }
  expireTag(tag);
  return NextResponse.json({ ok: true, tag });
}
