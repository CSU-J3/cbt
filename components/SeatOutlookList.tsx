// HO 710 → 718 — the following cycle as a report: a dateline, NEWS, a gated
// ODDS line, COUNT, then one roster per chamber split by party, with every
// fact carried on the incumbent's name. A depth-1 snapshot (SKILL, "Information
// architecture — The rule"): the race hub is unchanged and the member link is
// the existing bridge, so there is no fourth bucket here.
// Ruled layout: docs/design/mock-718-electoral-report-v8.html
//
// THE LABEL RULE: a label on this page names the electoral fact in words a
// Ballotpedia reader already has, and it is true of every row it sits over.
// Never the schema (`open_signal` read as "signals on file", false for two of
// the three rows under it at HO 718's v3), never a category CBT invented
// ("status known", "holder", "statement on file"). Definitions live in `title`.
//
// Facts ride on the name; there are no tiers. Two independent axes per
// incumbent (lib/queries.ts getSeatOutlook): a STATEMENT (NOT RUNNING / MAY NOT
// RUN) and an APPOINTEE fact (APPOINTED · SPECIAL <MON YYYY>). A row can carry
// both.
//
// Server component throughout. Nothing on this surface needs client state: the
// cycle lives in the URL, the toggle is a pair of links, and the ODDS gate is
// the global `html[data-odds="off"] .odds-only` rule.
import Link from "next/link";
import type { ReactNode } from "react";
import { MicroTag } from "@/components/MicroTag";
import { getCurrentCongress, ordinal } from "@/lib/congress";
import { senateClassForCycle } from "@/lib/derive-term";
import { electionDay } from "@/lib/format";
import type {
  CycleMarketCoverage,
  ObservationNewsItem,
  SeatOutlookRow,
} from "@/lib/queries";
import { partyColor } from "@/lib/race-colors";
import { districtToken } from "@/lib/race-id";

// Dated copy, never present tense: "MAY NOT RUN · MAY 2025" says WHEN the
// statement was made, so a stale one reads as stale rather than as current.
// The date is the statement's, parsed from the stored ISO date, not the
// article's.
const MONTHS = [
  "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
  "JUL", "AUG", "SEP", "OCT", "NOV", "DEC",
];

function signalMonth(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-\d{2}$/.exec(iso);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${m[1]}` : null;
}

// "10 SEP 2026" from any string that starts YYYY-MM-DD (a date or an ISO
// timestamp). Read off the string, not through Date, so no timezone moves it.
function dayMonthYear(iso: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${m[3]} ${month} ${m[1]}` : null;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// WI · AL-01 · AK-AL. HO 711: the district token is districtToken's, which
// treats NULL (members' shape) and 0 (races' shape) as the same at-large seat.
// The chamber is carried by the section, so a Senate seat is the state alone.
function seatLabel(row: SeatOutlookRow): string {
  if (row.chamber === "senate") return row.state;
  return `${row.state}-${districtToken(row.district)}`;
}

const PARTY_NAMES: Record<string, string> = {
  R: "REPUBLICAN",
  D: "DEMOCRAT",
  I: "INDEPENDENT",
};

function partyKey(party: string | null): string {
  const p = (party ?? "").trim().toUpperCase();
  return p === "ID" ? "I" : p || "?";
}

// Qualified first — not running, may not run, appointed — then everyone else.
// A row carrying both axes ranks by its statement.
function qualifierRank(row: SeatOutlookRow): number {
  if (row.status === "open") return 0;
  if (row.status === "likely") return 1;
  if (row.awaitingSpecial !== null) return 2;
  return 3;
}

function byQualifiedThenSeat(a: SeatOutlookRow, b: SeatOutlookRow): number {
  return (
    qualifierRank(a) - qualifierRank(b) ||
    a.state.localeCompare(b.state) ||
    (a.district ?? 0) - (b.district ?? 0)
  );
}

function SourceMark({ url }: { url: string | null }) {
  if (!url) return null;
  const host = hostOf(url);
  return (
    <a
      className="so-src"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={host ? `Source: ${host}` : "Source"}
    >
      ↗
    </a>
  );
}

function StatementQualifier({ row }: { row: SeatOutlookRow }) {
  const when = signalMonth(row.openSignalDate);
  if (row.status === "open") {
    // Bare `NOT RUNNING` when the row carries no date: the fixture renders it,
    // prod never should (backlog: a bare tag is a curation defect).
    return (
      <span className="so-qual">
        <span
          className="so-tag so-tag--open"
          title="The incumbent has announced they will not run for re-election"
        >
          NOT RUNNING{when ? ` · ${when}` : ""}
        </span>
        <SourceMark url={row.openSignalUrl} />
      </span>
    );
  }
  if (row.status === "likely") {
    return (
      <span className="so-qual">
        <span
          className="so-tag so-tag--likely"
          title="The incumbent has said they may not run, short of an announcement"
        >
          MAY NOT RUN{when ? ` · ${when}` : ""}
        </span>
        <SourceMark url={row.openSignalUrl} />
      </span>
    );
  }
  // No statement renders nothing: absence is the signal (the HO 221
  // `incumbent_running` NULL rule carried forward).
  return null;
}

function AppointeeQualifier({ row }: { row: SeatOutlookRow }) {
  if (row.awaitingSpecial === null) return null;
  const special = electionDay(row.awaitingSpecial);
  const label = `APPOINTED · SPECIAL ${MONTHS[special.getUTCMonth()]} ${special.getUTCFullYear()}`;
  const title = `Appointed to the seat; the ${MONTHS[special.getUTCMonth()]} ${special.getUTCDate()}, ${special.getUTCFullYear()} special election decides who holds it first`;
  return (
    <span className="so-qual">
      <MicroTag label={label} title={title} />
      {/* Links the deciding contest's hub when that row exists; plain text
          otherwise, rather than a link that 404s. */}
      {row.decidingRaceId ? (
        <Link
          className="so-src"
          href={`/race/${row.decidingRaceId}`}
          title={`The ${row.awaitingSpecial} special election`}
        >
          →
        </Link>
      ) : null}
    </span>
  );
}

function NameRow({ row }: { row: SeatOutlookRow }) {
  return (
    <div className="so-name-row">
      <span className="so-seat">{seatLabel(row)}</span>{" "}
      <span className="so-name">
        <Link href={`/members/${row.bioguideId}`}>{row.name}</Link>
      </span>{" "}
      <StatementQualifier row={row} /> <AppointeeQualifier row={row} />
    </div>
  );
}

function Section({
  label,
  className,
  children,
  ...rest
}: {
  label: ReactNode;
  className?: string;
  children: ReactNode;
  "data-market"?: string;
}) {
  return (
    <section className={`so-sec${className ? ` ${className}` : ""}`} {...rest}>
      {/* The span keeps the label ONE flex item, so a count inside it is not
          split from its text by the gap before the hairline. */}
      <div className="so-sec-label">
        <span>{label}</span>
      </div>
      {children}
    </section>
  );
}

function RosterSection({
  label,
  rows,
}: {
  label: ReactNode;
  rows: SeatOutlookRow[];
}) {
  const groups = new Map<string, SeatOutlookRow[]>();
  for (const r of rows) {
    const k = partyKey(r.party);
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  // Size descending, then party letter.
  const ordered = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
  );
  return (
    <Section label={label}>
      <div className="so-roster">
        {ordered.map(([key, members]) => (
          <div className="so-group" key={key}>
            <div className="so-group-label">
              <span style={{ color: partyColor(key) }}>
                {PARTY_NAMES[key] ?? key}
              </span>{" "}
              · {members.length}
            </div>
            <div className="so-group-names">
              {[...members].sort(byQualifiedThenSeat).map((row) => (
                <NameRow row={row} key={row.bioguideId} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

export function SeatOutlookList({
  rows,
  news,
  coverage,
  cycle,
}: {
  rows: SeatOutlookRow[];
  news: ObservationNewsItem[];
  coverage: CycleMarketCoverage;
  cycle: number;
}) {
  // One source: every count derives from the same array the roster renders
  // from, so COUNT cannot disagree with what is below it. A self-consistency
  // check, not a correctness one — correctness is the roster reading.
  const senate = rows.filter((r) => r.chamber === "senate");
  const house = rows.filter((r) => r.chamber === "house");
  const notRunning = rows.filter((r) => r.status === "open").length;
  const mayNotRun = rows.filter((r) => r.status === "likely").length;
  const appointed = rows.filter((r) => r.awaitingSpecial !== null).length;

  const senateClass = senateClassForCycle(cycle);
  const election = electionDay(cycle);
  const electionLabel = `${MONTHS[election.getUTCMonth()]} ${election.getUTCDate()}, ${election.getUTCFullYear()}`;
  // The Congress that begins in January of the year before the cycle (120 for
  // 2028), and the day it begins.
  const congress = getCurrentCongress(new Date(Date.UTC(cycle - 1, 0, 4)));
  const houseJoinDate = `JAN 3, ${cycle - 1}`;
  const houseJoinDateSentence = `Jan 3, ${cycle - 1}`;

  // The 712 label rule: a label over a date derives from the rows that
  // produced it. Only rows carrying a statement stamp this line, and it is
  // omitted when none does.
  const statementStamps = rows
    .filter((r) => r.status !== "none" && r.lastVerified)
    .map((r) => r.lastVerified as string)
    .sort();
  const lastChecked = dayMonthYear(
    statementStamps[statementStamps.length - 1] ?? null,
  );

  // HO 711: the gate is `raceId == null`, not `district == null` — at-large
  // seats HAVE a race row. Expected never to fire on a voting seat.
  const hasNoRaceRecord = house.some((r) => r.raceId == null);

  const seatByBioguide = new Map(rows.map((r) => [r.bioguideId, seatLabel(r)]));
  const oddsZero =
    coverage.kalshi === 0 && coverage.polymarket === 0 && coverage.ratings === 0;

  return (
    <div className="so-report">
      <p className="so-dateline">
        {senateClass ? `CLASS ${senateClass} · ` : ""}
        {electionLabel}
        {house.length === 0
          ? ` · HOUSE SEATS JOIN WHEN THE ${ordinal(congress).toUpperCase()} CONGRESS BEGINS, ${houseJoinDate}`
          : ""}
      </p>
      {lastChecked ? (
        <p className="so-dateline">RETIREMENT STATEMENTS LAST CHECKED {lastChecked}</p>
      ) : null}

      <div className="so-top">
        <div className="so-col">
          <Section label="NEWS">
            {news.length === 0 ? (
              <p className="so-empty">no news in the feed for these seats</p>
            ) : (
              <ul className="so-news">
                {news.map((n) => {
                  const seats = n.bioguides
                    .map((b) => seatByBioguide.get(b))
                    .filter((s): s is string => !!s);
                  return (
                    <li className="so-news-item" key={n.obsId}>
                      <span className="so-dim">{dayMonthYear(n.observedAt)}</span>
                      {seats.length > 0 ? (
                        <span className="so-dim"> · {seats.join(" ")}</span>
                      ) : null}
                      {" · "}
                      <a
                        className="so-news-title"
                        href={n.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {n.title}
                      </a>
                      {n.publisher ? (
                        <span className="so-dim"> — {n.publisher} ↗</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>

          {/* The ODDS line is one gated element, label included: `odds-only`
              hides it on OFF (display:none is safe — it is not a direct child
              of a fixed-track grid, it sits in this column's flow), and
              `data-market` is what the OFF crawl reads. It renders no odds;
              it states the cycle's market coverage. */}
          <Section label="ODDS" className="so-odds odds-only" data-market="coverage">
            <p className="so-odds-line">
              {oddsZero ? (
                <>
                  <span className="so-odds-none">none</span> · no {cycle} race in
                  the Kalshi or Polymarket feed · no ratings on file
                </>
              ) : (
                <>
                  KALSHI {coverage.kalshi} · POLYMARKET {coverage.polymarket} ·
                  RATINGS {coverage.ratings}
                </>
              )}
            </p>
          </Section>
        </div>

        <Section label="COUNT">
          <div className="so-count">
            <div className="so-count-row">
              <span className="so-count-label">NOT RUNNING FOR RE-ELECTION</span>
              <span className="so-count-value">{notRunning}</span>
            </div>
            <div className="so-count-row">
              <span className="so-count-label">MAY NOT RUN</span>
              <span className="so-count-value">{mayNotRun}</span>
            </div>
            <div className="so-count-row">
              <span className="so-count-label">APPOINTED · SPECIAL FIRST</span>
              <span className="so-count-value">{appointed}</span>
            </div>
            {house.length === 0 ? (
              <div className="so-count-row">
                <span className="so-count-label">HOUSE</span>
                <span className="so-count-value">
                  0{" "}
                  <span className="so-dim">added after {houseJoinDateSentence}</span>
                </span>
              </div>
            ) : null}
          </div>
          {hasNoRaceRecord ? (
            <p className="so-empty">
              Some House seats here have no race record, so a qualifier cannot
              attach to them however the statement record stands.
            </p>
          ) : null}
        </Section>
      </div>

      {senate.length > 0 ? (
        <RosterSection
          label={
            <>
              SENATE{senateClass ? ` · CLASS ${senateClass}` : ""} ·{" "}
              <span className="so-sec-count">{senate.length}</span>
            </>
          }
          rows={senate}
        />
      ) : null}
      {house.length > 0 ? (
        <RosterSection
          label={
            <>
              HOUSE · <span className="so-sec-count">{house.length}</span>
            </>
          }
          rows={house}
        />
      ) : null}
    </div>
  );
}
