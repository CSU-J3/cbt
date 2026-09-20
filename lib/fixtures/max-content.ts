// HO 740 — THE FIXTURE SEAM: the conditional bands render at max content on
// request, so the narrow gate stops measuring whatever the day's data happens to
// be.
//
// WHY THIS EXISTS. `e2e/narrow.spec.ts` crawls real pages, so a band whose box
// exists only when data creates it is measured only on the days that data
// exists, and its WORST case is unmeasured by construction. Two readings, both
// taken rather than reasoned: HO 716 read `home` at 390 as `over=0` at 23:06Z
// and `over=3` at 00:03Z on identical CSS, because the week's enacted count went
// 0 -> 4 and `.weekly-band-ids` had not existed before; and at the HO 740 STEP 0
// (2026-09-20) prod's enacted box held TWO chips, both `S` — the narrowest token
// a chip can carry — with the `+N` overflow link absent, while
// `/committee/hlig00` carried the recorded-vote pointer twice in the DOM and
// rendered it ZERO times at 430 and 390.
//
// THE SHAPE. A request-scoped fixture on the PRODUCT ROUTE itself
// (`?fixture=max`), honoured only when a server-side env var the Preview scope
// carries and Production never does says so. The data is TYPED against the real
// types and substituted at the page/component prop boundary, then rendered
// through the shipped component on the shipped page — so markup cannot drift
// from the component, and a schema or prop change breaks `typecheck` rather than
// quietly rendering something else.
//
// SUBSTITUTE AFTER, NOT SKIP THE QUERY. The page and the band run their real
// reads and then one ternary swaps the result. The code path is otherwise
// identical and a fixture render costs what a normal render costs — which is the
// point, because the thing under test is the LAYOUT the real component produces,
// not a cheaper stand-in for it.
//
// THE TWO PRECEDENTS THIS DEPARTS FROM, so nobody re-derives them.
//   * HO 504's fixture DB — a seeded libSQL database behind the crawl — was
//     probed and DECLINED: hundreds of rows against a 132-statement schema,
//     guarded by `test.skip`-on-empty, false-green by construction. This is
//     three typed constants at a prop boundary: no DB, no rows, no schema, and
//     no skip anywhere (`e2e/narrow.spec.ts` asserts hard in both directions).
//   * HO 714's `app/_fixture-714/` — a throwaway route segment created and
//     deleted inside one session. That convention is for a CAPTURE. A standing
//     gate needs a seam that is in the tree, and a search param on the product
//     route that is dead unless the server env says otherwise is the smallest
//     one.
import type { EnactedBill } from "@/lib/enacted-this-week";
import { watchState } from "@/lib/hearings";
import { hasRecordedVotes } from "@/lib/meeting-documents";
import type {
  AbsenceWatch,
  AbsentMember,
  CommitteeMeeting,
} from "@/lib/queries";

/**
 * The one place the gate lives: BOTH conditions, so there is no second reading
 * of either half anywhere in the tree.
 *
 * `CBT_FIXTURES` is server-side and Preview-scoped (never `NEXT_PUBLIC_`, never
 * Production). The check is `=== "1"` and nothing looser — a truthy test would
 * honour `"0"` and `"false"`. A deployment's env is frozen at BUILD time, so a
 * Preview whose variable landed after its build renders no fixture; the spec's
 * first assertion names exactly that case.
 */
export function fixtureRequested(
  sp: { fixture?: string } | undefined,
): "max" | null {
  if (process.env.CBT_FIXTURES !== "1") return null;
  return sp?.fixture === "max" ? "max" : null;
}

// ---------------------------------------------------------------------------
// WeeklyBand — the enacted id chips and their overflow link
// ---------------------------------------------------------------------------

// ENACTED_ID_CAP is 3 (components/WeeklyBand.tsx:42) and the band shows
// `enacted.slice(0, CAP)` plus a `+N` link for the rest, so CAP + k entries with
// a two-digit k renders three chips and a two-digit overflow.
const ENACTED_FIXTURE_EXTRA = 12;

/**
 * The widest enacted box the band can draw.
 *
 * WIDTH CEILING, MEASURED (HO 740 STEP 0, 2026-09-20):
 *   SELECT bill_type, LENGTH(bill_type) FROM bills GROUP BY bill_type
 *     ORDER BY 2 DESC   ->  `hconres` / `sconres`, 7 chars, the widest tokens.
 *   SELECT bill_type, bill_number FROM bills
 *     ORDER BY LENGTH(bill_type) + LENGTH(bill_number) DESC
 *                       ->  `HCONRES 100`, 11 rendered chars, the widest id
 *                           prod has ever drawn.
 * The chips below use four-digit numbers, so each is `HCONRES 1234` — 12 chars,
 * ONE above that ceiling. Deliberate: the chips are the width-bearing part and a
 * fixture sitting just past the observed maximum is a gate that sees the case
 * before production does.
 */
export function enactedMax(): EnactedBill[] {
  const shown: EnactedBill[] = [
    { id: "119-hconres-1234", billType: "hconres", billNumber: 1234 },
    { id: "119-sconres-1234", billType: "sconres", billNumber: 1234 },
    { id: "119-hconres-1235", billType: "hconres", billNumber: 1235 },
  ];
  // Only the first three are drawn as chips; the rest exist to make the `+N`
  // link render (and to give the popover breakdown a full list).
  const rest: EnactedBill[] = Array.from(
    { length: ENACTED_FIXTURE_EXTRA },
    (_, i) => ({
      id: `119-hconres-${2000 + i}`,
      billType: "hconres",
      billNumber: 2000 + i,
    }),
  );
  return [...shown, ...rest];
}

// ---------------------------------------------------------------------------
// AbsenceWatchBand — the card rack at both tiers
// ---------------------------------------------------------------------------

// THE WIDTH-BEARING CEILING IS THE SURNAME, NOT THE NAME. The card front prints
// `surname(m.name)` (components/AbsenceWatchCards.tsx:265) under
// `white-space: nowrap` (globals.css:10877-10887), and the full name reaches
// only the card BACK, which the crawl never opens.
//
// MEASURED (HO 740 STEP 0, 2026-09-20): over the 539 rows of
//   SELECT name FROM members WHERE is_current = 1
// with the real `surname()` from lib/race-colors.ts applied, the longest surname
// is 14 chars — `Krishnamoorthi` (Raja Krishnamoorthi, D-IL). For contrast,
// MAX(LENGTH(name)) is 30 (`Charles J. "Chuck" Fleischmann`) and its surname is
// 11, which is why the full-name figure is the wrong ceiling to build against.
//
// So every fixture surname below is 14 characters AND says FIXTURE on the card
// itself: a synthetic member rendered as MIA on a live URL must be unmistakable
// to anyone who sees it, and the front plate is the only place a reader looks.
// `FIXTURE-` is eight capitals, so these run at or above the 14-char ceiling.
const FIXTURE_SURNAMES = [
  "FIXTURE-Alpha1",
  "FIXTURE-Bravo2",
  "FIXTURE-Charl3",
  "FIXTURE-Delta4",
] as const;

function fixtureMember(
  i: number,
  tier: "mia" | "warn",
  chamber: "house" | "senate",
  party: "R" | "D" | "I",
  state: string,
  streak: number,
  nowMs: number,
): AbsentMember {
  const lastCastDate = new Date(nowMs - (streak + 3) * 86_400_000)
    .toISOString()
    .slice(0, 10);
  return {
    // `FX` prefix so a fixture id can never collide with a real bioguide id
    // (real ones are a letter followed by six digits).
    bioguideId: `FX${String(i).padStart(5, "0")}`,
    name: `Fixture Member ${FIXTURE_SURNAMES[i]!}`,
    party,
    state,
    chamber,
    streak,
    tier,
    atBound: false,
    lastCastDate,
    missedPct: tier === "mia" ? 88.8 : 44.4,
    missedVotes: tier === "mia" ? 888 : 444,
    totalVotes: 1000,
    congress: 119,
    // The expand-in-place card back. HO 645 made the back render from
    // base-query data, so its two `card`-reading blocks self-omit on null, and
    // every other field above is populated — a fixture that renders a broken
    // back is a fixture somebody will click.
    card: null,
    palestineGrade: null,
    palestineRank: null,
    palestineScore: null,
  };
}

/**
 * The rack at max content: both tiers populated (2 `mia`, 2 `warn`), both
 * chambers' roll windows set, every surname at the measured ceiling.
 *
 * The cards are 126px and WRAP (HO 645), so the count does not drive the band's
 * width — the header's two counted segments and the longest surname do, which is
 * what this builds to.
 */
export function absenceWatchMax(nowMs: number): AbsenceWatch {
  const day = (n: number) =>
    new Date(nowMs - n * 86_400_000).toISOString().slice(0, 10);
  return {
    members: [
      fixtureMember(0, "mia", "house", "R", "TN", 22, nowMs),
      fixtureMember(1, "mia", "senate", "D", "CA", 19, nowMs),
      fixtureMember(2, "warn", "house", "D", "NY", 9, nowMs),
      fixtureMember(3, "warn", "senate", "I", "VT", 8, nowMs),
    ],
    // Non-null on BOTH chambers: `window === null` is the FAILED read and
    // renders `.abw--failed` instead of the rack (AbsenceWatchBand.tsx:134-142).
    window: { house: day(1), senate: day(2) },
  };
}

// ---------------------------------------------------------------------------
// Committee meetings — the recorded-vote pointer in its stacked, narrow form
// ---------------------------------------------------------------------------

// MEASURED (HO 740 STEP 0, 2026-09-20), House only, under RECORDED_VOTE_DOC_SQL:
//   SELECT d.event_id, COUNT(*) FROM committee_meeting_documents d
//     JOIN committee_meetings m ON m.event_id = d.event_id
//    WHERE <RECORDED_VOTE_DOC_SQL> AND m.chamber = 'house'
//    GROUP BY d.event_id ORDER BY 3 DESC   ->  144 (event 118618), then 99, 80.
// So 144 is exactly what prod has rendered at its widest, not a round number
// chosen to look big. If a four-digit count ever appears that is a data event
// worth seeing, not a fixture to pre-empt.
const FIXTURE_RECORDED_VOTE_DOCS = 144;

const FIXTURE_VIDEO_URL = "https://www.youtube.com/watch?v=FIXTURE";

/**
 * The real recent rows with the two fields the narrow form needs forced on.
 *
 * WHY BOTH FIELDS. At <= 720px the full `RECORDED VOTES · n` label is replaced
 * by a bare arrow-and-count that renders ONLY when it can stack under a WATCH
 * link already in the row's auto track; with no WATCH at that width the pointer
 * is `display: none` outright (globals.css:9387-9401). And WATCH itself needs
 * more than a video url: `watchState` returns "none" without one, with a
 * `Canceled`/`Postponed` status, or on an unparseable date
 * (lib/hearings.ts:106-119).
 *
 * MEASURED (HO 740 STEP 0, 2026-09-20): all ten of `hlig00`'s most recent past
 * meetings have `video_url IS NULL`, so on prod the pointer sits in the DOM
 * twice and renders zero times at both gate widths. That is the state this
 * fixture exists to replace, and it is why the confirmation below lives in the
 * builder rather than in the luck of a given committee's data.
 *
 * The check calls the REAL predicates — imported, never re-derived — so a fourth
 * condition added to `watchState` later breaks this builder rather than silently
 * reducing the fixture to today's prod. It does not throw on a committee with no
 * past House rows: it returns the rows it was given and lets the spec's
 * `stacked >= 1` be the sentence about that case.
 */
export function meetingsWithVotesMax(
  meetings: CommitteeMeeting[],
  nowMs: number,
): CommitteeMeeting[] {
  let stacked = false;
  return meetings.map((m) => {
    if (m.chamber !== "house") return m;
    const isPast = Date.parse(m.meetingDate) < nowMs;
    // Only the first PAST House row is given a video; giving every row one would
    // change more of the page's shape than the band under test.
    const takeStack = !stacked && isPast;
    const next: CommitteeMeeting = {
      ...m,
      recordedVoteDocs: FIXTURE_RECORDED_VOTE_DOCS,
      videoUrl: takeStack ? FIXTURE_VIDEO_URL : m.videoUrl,
      // Forced to "Scheduled" on the stacked row, unconditionally. The two
      // statuses that suppress WATCH are `Canceled` and `Postponed`
      // (lib/hearings.ts:106), and overwriting a row that carries neither is a
      // no-op for `watchState`; writing it always is one branch instead of two
      // and the confirmation below reads the result either way.
      meetingStatus: takeStack ? "Scheduled" : m.meetingStatus,
    };
    if (takeStack && watchState(next, nowMs) !== "none" && hasRecordedVotes(next)) {
      stacked = true;
    }
    return next;
  });
}
