// /hearings — committee hearings list view (HO 264, Piece 1 of 5). Standalone
// surface: masthead + the global nav/tape chrome, a TYPE/CHAMBER filter bar
// (state in the URL), and a grouped chronological list (THIS WEEK / NEXT WEEK /
// RECENTLY HELD) of committee meetings with click-to-expand rows. Server
// component: it reads the URL filters, pulls the HO 263 helpers, bands + filters
// the meetings, and hands a frozen `nowMs` to the client list so badge / watch-
// state / day math can't drift between render and hydration.
import Link from "next/link";
import { HeaderBar } from "@/components/HeaderBar";
import { HearingsCalendar } from "@/components/HearingsCalendar";
import { HearingsList, type HearingsBand } from "@/components/HearingsList";
import { getCurrentCongress, ordinal } from "@/lib/congress";
import {
  hearingBadge,
  sanitizeHearingType,
  sanitizeHearingView,
  typeFilterBadge,
  type HearingTypeFilter,
  type HearingView,
} from "@/lib/hearings";
import {
  getCommitteesIndex,
  getRecentMeetings,
  getUpcomingMeetings,
  sanitizeChamber,
  type Chamber,
  type CommitteeMeeting,
} from "@/lib/queries";

const RECENT_DAYS = 7;
const WEEK_MS = 7 * 86_400_000;

type SearchParams = {
  view?: string;
  type?: string;
  chamber?: string;
};

const VIEW_OPTS: ReadonlyArray<{ value: HearingView; label: string }> = [
  { value: "list", label: "LIST" },
  { value: "cal", label: "CALENDAR" },
];

const TYPE_OPTS: ReadonlyArray<{ value: HearingTypeFilter | ""; label: string }> =
  [
    { value: "", label: "ALL" },
    { value: "hearing", label: "HEARINGS" },
    { value: "markup", label: "MARKUPS" },
    { value: "business", label: "BUSINESS" },
  ];

const CHAMBER_OPTS: ReadonlyArray<{ value: Chamber | ""; label: string }> = [
  { value: "", label: "ALL" },
  { value: "house", label: "HOUSE" },
  { value: "senate", label: "SENATE" },
];

// view/type/chamber all round-trip through the URL; LIST is the default so it's
// omitted (the canonical /hearings URL stays clean).
function buildHref(next: {
  view?: HearingView;
  type?: string;
  chamber?: string;
}): string {
  const sp = new URLSearchParams();
  if (next.view && next.view !== "list") sp.set("view", next.view);
  if (next.type) sp.set("type", next.type);
  if (next.chamber) sp.set("chamber", next.chamber);
  const qs = sp.toString();
  return qs ? `/hearings?${qs}` : "/hearings";
}

function FilterGroup<T extends string>({
  label,
  opts,
  current,
  hrefFor,
}: {
  label: string;
  opts: ReadonlyArray<{ value: T | ""; label: string }>;
  current: T | undefined;
  hrefFor: (value: T | "") => string;
}) {
  return (
    <span className="hearings-filter-group">
      <span className="hearings-filter-label">{label}</span>
      {opts.map((o) => {
        const isActive = (current ?? "") === o.value;
        return (
          <Link
            key={o.value || "all"}
            href={hrefFor(o.value)}
            scroll={false}
            className={`hearings-filter-opt${isActive ? " is-active" : ""}`}
            aria-current={isActive ? "true" : undefined}
          >
            {o.label}
          </Link>
        );
      })}
    </span>
  );
}

export default async function HearingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const view = sanitizeHearingView(params.view);
  const type = sanitizeHearingType(params.type);
  const chamber = sanitizeChamber(params.chamber);

  const [upcoming, recent, committees] = await Promise.all([
    getUpcomingMeetings(),
    getRecentMeetings(RECENT_DAYS),
    getCommitteesIndex(),
  ]);

  const committeeNames: Record<string, string> = {};
  for (const c of committees) committeeNames[c.systemCode] = c.name;

  // Apply the URL filters in JS — TYPE filters on the normalized badge (raw
  // meetingType has 9 variants, Phase 1), so it can't be pushed into the helper
  // SQL, and CHAMBER rides along the same pass for one filter site.
  const wantBadge = type ? typeFilterBadge(type) : null;
  const keep = (m: CommitteeMeeting) =>
    (!chamber || m.chamber === chamber) &&
    (!wantBadge || hearingBadge(m.meetingType) === wantBadge);

  const nowMs = Date.now();
  const cutoff = nowMs + WEEK_MS;

  const upcomingKept = upcoming.filter(keep);
  const thisWeek = upcomingKept.filter(
    (m) => Date.parse(m.meetingDate) < cutoff,
  );
  const nextWeek = upcomingKept.filter(
    (m) => Date.parse(m.meetingDate) >= cutoff,
  );
  const recentKept = recent.filter(keep);

  const bands: HearingsBand[] = [
    { key: "this", label: "This Week", meetings: thisWeek },
    { key: "next", label: "Next Week", meetings: nextWeek },
    { key: "recent", label: "Recently Held", meetings: recentKept },
  ].filter((b) => b.meetings.length > 0);

  const shown = [...thisWeek, ...nextWeek, ...recentKept];
  const total = shown.length;
  const houseN = shown.filter((m) => m.chamber === "house").length;
  const senateN = shown.filter((m) => m.chamber === "senate").length;
  const congress = ordinal(getCurrentCongress()).toUpperCase();

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        basePath="/hearings"
        pageTitle="HEARINGS"
        pageCount={total}
        pageCountLabel="meetings"
      />

      <main className="w-full flex-1 px-4 py-4">
        {/* Masthead — page-level mono prompt + subhead */}
        <div className="hearings-page-masthead">
          <span className="hearings-prompt">
            Hearings
            <span className="prompt-accent" aria-hidden>
              {":\\"}
            </span>
            <span className="prompt-accent" aria-hidden>
              {">"}
            </span>
            <span className="home-cursor-caret" aria-hidden>
              _
            </span>
          </span>
          <span className="hearings-subhead">
            · <span className="num">{total.toLocaleString()}</span> MEETINGS ·
            HOUSE <span className="num">{houseN.toLocaleString()}</span> / SENATE{" "}
            <span className="num">{senateN.toLocaleString()}</span> · {congress}{" "}
            CONGRESS
          </span>
        </div>

        {/* Filter bar — VIEW toggle (left) + TYPE + CHAMBER, state in the URL.
            Filters stay applied across both views (HO 265 Phase 1 decision). */}
        <div className="hearings-filterbar">
          <FilterGroup
            label="VIEW"
            opts={VIEW_OPTS}
            current={view}
            hrefFor={(value) =>
              buildHref({ view: (value || "list") as HearingView, type, chamber })
            }
          />
          <FilterGroup
            label="TYPE"
            opts={TYPE_OPTS}
            current={type}
            hrefFor={(value) =>
              buildHref({ view, type: value || undefined, chamber })
            }
          />
          <FilterGroup
            label="CHAMBER"
            opts={CHAMBER_OPTS}
            current={chamber}
            hrefFor={(value) =>
              buildHref({ view, type, chamber: value || undefined })
            }
          />
          <span className="hearings-filter-count">
            {total.toLocaleString()} MEETINGS
          </span>
        </div>

        {view === "cal" ? (
          <HearingsCalendar meetings={shown} nowMs={nowMs} />
        ) : (
          <HearingsList
            bands={bands}
            committeeNames={committeeNames}
            nowMs={nowMs}
          />
        )}
      </main>
    </div>
  );
}
