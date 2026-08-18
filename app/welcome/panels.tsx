import type { ReactNode } from "react";
import { formatRelativeAge } from "@/lib/format";
import {
  type ClusterStat,
  type CommitteeMeeting,
  type CompetitiveRace,
  type FeedBill,
  type MemberRanking,
  type NewsMention,
  getBreakingNewsForHome,
  getClusterStats,
  getFeedBills,
  getLobbyingRollup,
  getMembersRanked,
  getMostCompetitiveRaces,
  getRecentMeetings,
  getStageChanges,
  getStaleBills,
  getUpcomingMeetings,
} from "@/lib/queries";
import styles from "./landing.module.css";

// HO 670 — the three cycling demo panels of the /welcome board.
//
// Nine datasets, three per panel, each scrolling on its own loop while the three
// crossfade on a 45s cycle (the CSS in landing.module.css owns both motions; this
// module owns the data and the row shapes). Every dataset reads an EXISTING
// query — no new query lands here — and the whole board was priced before it was
// built: 94,270 rows_read against the pre-rebuild page's 57,699, a 1.63x multiple
// under the 3x ceiling (STEP 0.3, scripts/diagnostic/welcome-read-budget-670.ts).
//
// TWO DATASETS ARE NOT THE ONES THE SPEC NAMED, and the reason is live data:
//   - ENACTED reads the enacted-stage feed slice, not getEnactedThisWeek(), which
//     returns ZERO rows in a week with no enactments (a panel that renders its
//     header and no rows is the failure this arrangement exists to avoid).
//   - HEARINGS reads upcoming AND the last 14 days: the whole forward calendar is
//     3 rows during recess, and a track shorter than its 420px viewport breaks the
//     -50% scroll loop. The label says SCHEDULED + RECENT rather than claiming a
//     week that isn't there.
// A third label is honest rather than literal: MEMBERS ranks by bills sponsored
// this Congress (getMembersRanked's `volume` sort). There is no 30-day member
// window in lib/queries, and writing one is a new query — out of scope here.

export type PanelRow = {
  key: string;
  ident: ReactNode;
  title: string;
  meta: ReactNode;
};

export type PanelDataset = {
  label: string;
  note: string;
  // Seconds for one full -50% translateY loop. Per-dataset so no two columns
  // ever drift in lockstep.
  durationS: number;
  rows: PanelRow[];
};

export type PanelSpec = {
  key: string;
  // Panel 2 scrolls DOWN (animation-direction: reverse).
  reverse: boolean;
  // -0s / -15s / -30s into the shared 45s crossfade, so no two panels swap
  // datasets at the same moment.
  delay: 0 | 1 | 2;
  datasets: PanelDataset[];
};

const STAGE_LABEL: Record<string, { label: string; color: string }> = {
  introduced: { label: "INTRO", color: "var(--stage-introduced)" },
  committee: { label: "CMTE", color: "var(--stage-committee)" },
  floor: { label: "FLOOR", color: "var(--stage-floor)" },
  other_chamber: { label: "OTHER", color: "var(--stage-other-chamber)" },
  president: { label: "PRES", color: "var(--stage-president)" },
  enacted: { label: "LAW", color: "var(--stage-enacted)" },
};

function surname(b: FeedBill): string {
  if (b.sponsor_last_name) return b.sponsor_last_name.toUpperCase();
  const n = b.sponsor_name ?? "";
  const last = n.split(",")[0]?.trim();
  return (last || n).toUpperCase();
}

function partyClass(party: string | null): string {
  const p = (party ?? "").toUpperCase();
  if (p.startsWith("D")) return styles.d ?? "";
  if (p.startsWith("R")) return styles.r ?? "";
  return styles.i ?? "";
}

function partyTag(party: string | null, state: string | null): ReactNode {
  if (!party) return null;
  const p = party.toUpperCase().slice(0, 1);
  return (
    <span className={partyClass(party)}>
      [{p}
      {state ? `-${state}` : ""}]
    </span>
  );
}

function billIdent(b: FeedBill): ReactNode {
  return (
    <>
      <span className={styles.identType}>{b.bill_type.toUpperCase()}</span>{" "}
      <span className={styles.identNum}>{b.bill_number}</span>
    </>
  );
}

function stageTag(stage: string | null | undefined): ReactNode {
  const s = stage ? STAGE_LABEL[stage] : undefined;
  if (!s) return null;
  return (
    <span style={{ color: s.color }}>{s.label}</span>
  );
}

function daysSinceLabel(iso: string | null, nowMs: number): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  return `${Math.max(0, Math.floor((nowMs - t) / 86_400_000))}d`;
}

const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];

// Date-only rendering off an ISO string, UTC-sliced: these are calendar dates
// (action dates, meeting dates), and re-projecting them into the viewer's zone is
// how a hearing lands on the wrong day.
function dayStamp(iso: string | null): { day: string; month: string } {
  if (!iso) return { day: "—", month: "" };
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return { day: "—", month: "" };
  const mon = MONTHS[Number(m[2]) - 1] ?? "";
  return { day: String(Number(m[3])), month: mon };
}

function memberIdent(m: MemberRanking): ReactNode {
  const seat =
    m.chamber === "senate"
      ? "SEN"
      : m.district === null
        ? "AL"
        : String(m.district).padStart(2, "0");
  return (
    <>
      <span className={styles.identType}>{m.state ?? "??"}</span>{" "}
      <span className={styles.identNum}>{seat}</span>
    </>
  );
}

function sourceTag(source: string): string {
  return source.replace(/_/g, " ").toUpperCase();
}

// ── the nine datasets ────────────────────────────────────────────────────────

export type BoardData = {
  panels: PanelSpec[];
  // The banner readout's MOVED/7d figure rides along — same count the panel
  // header note prints, read once.
  moved7d: number;
};

export async function loadBoard(nowMs: number, moved7d: number): Promise<BoardData> {
  const [
    movers,
    stalls,
    enacted,
    members,
    lobbying,
    upcoming,
    recentMeetings,
    news,
    races,
    clusters,
  ] = await Promise.all([
    getStageChanges({}, 7, 12),
    getStaleBills({}, 12),
    getFeedBills({ stage: "enacted" }, { page: 1, pageSize: 12 }),
    getMembersRanked({}, "volume", 1, 12),
    getLobbyingRollup(),
    getUpcomingMeetings(),
    getRecentMeetings(14),
    getBreakingNewsForHome({ limit: 12, hours: 72 }),
    getMostCompetitiveRaces(2026, 12),
    getClusterStats(),
  ]);

  const billsRows: PanelRow[] = movers.map((b) => ({
    key: `mv-${b.id}`,
    ident: billIdent(b),
    title: b.title,
    meta: (
      <>
        <span className={styles.who}>{surname(b)}</span>{" "}
        {partyTag(b.sponsor_party, b.sponsor_state)} ·{" "}
        {stageTag(b.stage)} ·{" "}
        {formatRelativeAge(b.stage_observed_at ?? b.latest_action_date, nowMs)}
      </>
    ),
  }));

  const stallRows: PanelRow[] = stalls.map((b) => ({
    key: `st-${b.id}`,
    ident: billIdent(b),
    title: b.title,
    meta: (
      <>
        <span className={styles.who}>{surname(b)}</span>{" "}
        {partyTag(b.sponsor_party, b.sponsor_state)} · {stageTag(b.stage)} ·{" "}
        {daysSinceLabel(b.latest_action_date, nowMs)} SINCE ACTION
      </>
    ),
  }));

  const enactedRows: PanelRow[] = enacted.bills.map((b) => {
    const d = dayStamp(b.latest_action_date);
    return {
      key: `en-${b.id}`,
      ident: billIdent(b),
      title: b.title,
      meta: (
        <>
          <span className={styles.who}>{surname(b)}</span>{" "}
          {partyTag(b.sponsor_party, b.sponsor_state)} · {stageTag("enacted")} ·{" "}
          {d.day} {d.month}
        </>
      ),
    };
  });

  const memberRows: PanelRow[] = members.map((m) => ({
    key: `mb-${m.bioguide_id}`,
    ident: memberIdent(m),
    title: m.name,
    meta: (
      <>
        {partyTag(m.party, m.state)} · {m.total.toLocaleString()} SPONSORED ·{" "}
        {m.enacted.toLocaleString()} ENACTED
      </>
    ),
  }));

  // The LDA rollup blob carries per-issue drills, each with its own `recent`
  // filings — the same filing can appear under several issue codes, so dedupe on
  // the filing uuid before taking the newest.
  const seenFiling = new Set<string>();
  const lobbyRows: PanelRow[] = (lobbying ? Object.values(lobbying.drill) : [])
    .flatMap((d) => d.recent.map((f) => ({ code: d.code, filing: f })))
    .sort((a, b) => (a.filing.dtPosted < b.filing.dtPosted ? 1 : -1))
    .filter(({ filing }) => {
      if (seenFiling.has(filing.filingUuid)) return false;
      seenFiling.add(filing.filingUuid);
      return true;
    })
    .slice(0, 14)
    .map(({ code, filing }) => {
      const spend =
        filing.income != null
          ? `$${filing.income.toLocaleString()}`
          : filing.expenses != null
            ? `$${filing.expenses.toLocaleString()}`
            : "UNDISCLOSED";
      return {
        key: `ld-${filing.filingUuid}`,
        ident: <span className={styles.identType}>{code}</span>,
        title: filing.clientName ?? "(client not named)",
        meta: (
          <>
            <span className={styles.who}>{filing.registrantName ?? "—"}</span> ·{" "}
            {spend}
            {filing.billIds.length > 0
              ? ` · ${filing.billIds.length} BILL${filing.billIds.length === 1 ? "" : "S"}`
              : ""}
          </>
        ),
      };
    });

  const meetingRow = (m: CommitteeMeeting, held: boolean): PanelRow => {
    const d = dayStamp(m.meetingDate);
    return {
      key: `hg-${m.eventId}`,
      ident: (
        <>
          <span className={styles.identType}>{d.month}</span>{" "}
          <span className={styles.identNum}>{d.day}</span>
        </>
      ),
      title: m.title,
      meta: (
        <>
          <span className={styles.who}>{m.chamber.toUpperCase()}</span> ·{" "}
          {m.meetingType.toUpperCase()} ·{" "}
          <span style={{ color: held ? undefined : "var(--stage-floor)" }}>
            {held ? "HELD" : "SCHEDULED"}
          </span>
          {m.bills.length > 0 ? ` · ${m.bills.length} BILLS` : ""}
        </>
      ),
    };
  };
  const hearingRows: PanelRow[] = [
    ...upcoming.map((m) => meetingRow(m, false)),
    ...recentMeetings.map((m) => meetingRow(m, true)),
  ].slice(0, 16);

  const newsRows: PanelRow[] = news.map((n: NewsMention) => ({
    key: `nw-${n.id}`,
    ident: <span className={styles.identType}>{sourceTag(n.source)}</span>,
    title: n.title,
    meta: (
      <>
        <span className={styles.who}>{n.billId.replace(/^\d+-/, "").toUpperCase().replace("-", " ")}</span>
        {n.otherBills.length > 0 ? ` +${n.otherBills.length}` : ""} ·{" "}
        {formatRelativeAge(n.publishedAt, nowMs)}
      </>
    ),
  }));

  const raceRows: PanelRow[] = races.map((r: CompetitiveRace) => {
    const seat = r.raceId.replace(/-\d{4}$/, "");
    const ratings = [...new Set(r.ratings.map((x) => x.rating.toUpperCase()))];
    return {
      key: `rc-${r.raceId}`,
      ident: <span className={styles.identType}>{seat}</span>,
      title: r.incumbentName ?? "OPEN SEAT",
      meta: (
        <>
          {r.incumbentParty ? partyTag(r.incumbentParty, null) : null}{" "}
          <span className={styles.who}>{ratings.join(" · ")}</span> ·{" "}
          {r.ratings.length} RATER{r.ratings.length === 1 ? "" : "S"}
        </>
      ),
    };
  });

  const patternRows: PanelRow[] = clusters.map((c: ClusterStat) => ({
    key: `pt-${c.id}`,
    ident: <span className={styles.identNum}>{c.count.toLocaleString()}</span>,
    title: c.name,
    meta: (
      <>
        <span className={styles.who}>{c.pastCommittee.toLocaleString()} PAST CMTE</span>{" "}
        · {c.enacted.toLocaleString()} ENACTED · {c.ceremonial.toLocaleString()}{" "}
        CEREMONIAL
      </>
    ),
  }));

  return {
    moved7d,
    panels: [
      {
        key: "p1",
        reverse: false,
        delay: 0,
        datasets: [
          {
            label: "Bills",
            note: `${moved7d.toLocaleString()} moved · 7d`,
            durationS: 26,
            rows: billsRows,
          },
          {
            label: "Stalls",
            note: "longest since action",
            durationS: 30,
            rows: stallRows,
          },
          {
            label: "Enacted",
            note: `became law · ${enacted.total.toLocaleString()} total`,
            durationS: 24,
            rows: enactedRows,
          },
        ],
      },
      {
        key: "p2",
        reverse: true,
        delay: 1,
        datasets: [
          {
            label: "Members",
            note: "most bills sponsored",
            durationS: 31,
            rows: memberRows,
          },
          {
            label: "Lobbying",
            note: lobbying
              ? `${lobbying.stats.filings.toLocaleString()} LDA filings`
              : "LDA filings",
            durationS: 27,
            rows: lobbyRows,
          },
          {
            label: "Hearings",
            note: "scheduled + recent",
            durationS: 33,
            rows: hearingRows,
          },
        ],
      },
      {
        key: "p3",
        reverse: false,
        delay: 2,
        datasets: [
          {
            label: "News",
            note: "matched to bills",
            durationS: 23,
            rows: newsRows,
          },
          {
            label: "Races",
            note: "2026 · rated",
            durationS: 28,
            rows: raceRows,
          },
          {
            label: "Patterns",
            note: "corpus",
            durationS: 25,
            rows: patternRows,
          },
        ],
      },
    ],
  };
}

// ── render ───────────────────────────────────────────────────────────────────

const CYCLE_CLASS = ["cyc1", "cyc2", "cyc3"] as const;
const DELAY_CLASS = ["d1", "d2", "d3"] as const;

function Row({ row }: { row: PanelRow }) {
  return (
    <div className={styles.row}>
      <div className={styles.rident}>{row.ident}</div>
      <div className={styles.rmain}>
        <div className={styles.rtitle}>{row.title}</div>
        <div className={styles.rmeta}>{row.meta}</div>
      </div>
    </div>
  );
}

export function Panel({ panel }: { panel: PanelSpec }) {
  const delayClass = styles[DELAY_CLASS[panel.delay] ?? "d1"] ?? "";
  return (
    <div className={`${styles.pcol} ${delayClass}`}>
      {/* One grid CELL holds all three labels (grid-area 1/1), so the header
          keeps the height of its tallest label instead of collapsing to bare
          padding — and it paints ABOVE the fades with its own background, or the
          top frost samples the title and dims it. */}
      <div className={styles.colhead}>
        {panel.datasets.map((d, i) => (
          <span
            key={d.label}
            className={`${styles.swaplabel} ${styles[CYCLE_CLASS[i] ?? "cyc1"] ?? ""}`}
          >
            <span className={styles.on}>{d.label}</span>{" "}
            <span className={styles.note}>{d.note}</span>
          </span>
        ))}
      </div>
      <div className={styles.pviewport}>
        {panel.datasets.map((d, i) => (
          <div
            key={d.label}
            className={`${styles.stack} ${styles[CYCLE_CLASS[i] ?? "cyc1"] ?? ""}`}
          >
            <div
              className={`${styles.ptrack} ${panel.reverse ? (styles.rev ?? "") : ""}`}
              style={{ ["--dur" as string]: `${d.durationS}s` }}
            >
              {/* Duplicated EXACTLY twice: the -50% loop is seamless only when
                  the track is two identical halves. */}
              {[0, 1].map((run) => (
                <div key={run} className={styles.runset}>
                  {d.rows.map((r) => (
                    <Row key={`${run}-${r.key}`} row={r} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      {/* Frost, NOT fade: the rows themselves fade by alpha via the viewport's
          mask (glyphs stay sharp all the way out); these two overlays blur the
          panel surface and are themselves masked so they only engage where the
          text has already gone to nothing. A backdrop-filter over live text
          smears the type — that is the bug this split avoids. */}
      <div className={styles.pfadeTop} />
      <div className={styles.pfade} />
    </div>
  );
}
