// HO 710 — the seat outlook for a cycle with no ratings yet. A depth-1 list
// snapshot (SKILL, "Information architecture — The rule"): the race hub is
// unchanged and the member link is the existing bridge, so there is no fourth
// bucket here.
//
// Server component throughout. Nothing on this surface needs client state: the
// cycle lives in the URL and the toggle is a pair of links.
import Link from "next/link";
import { senateClassForCycle } from "@/lib/derive-term";
import type { SeatOutlookRow } from "@/lib/queries";
import { partyColor } from "@/lib/race-colors";

// Dated copy, never present tense: "LIKELY · MAY 2025" says WHEN the signal was
// given, so a stale signal reads as stale rather than as current. The date is
// the statement's, which is why it is parsed from the stored ISO date and not
// from the article.
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

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return null;
  }
}

// WI SEN · AL-01 · AK-AL. At-large House seats store district NULL and get the
// conventional AL designation (Cook / Ballotpedia notation) rather than a blank.
function seatLabel(row: SeatOutlookRow): string {
  if (row.chamber === "senate") return `${row.state} SEN`;
  if (row.district == null) return `${row.state}-AL`;
  return `${row.state}-${String(row.district).padStart(2, "0")}`;
}

function StatusCell({ row }: { row: SeatOutlookRow }) {
  if (row.status === "tbd") {
    const year = row.nextElectionYear;
    const label = `TBD · ${year ?? "—"}`;
    // Links to the deciding contest's hub when that row exists; plain text
    // otherwise, rather than a link that 404s.
    return row.decidingRaceId ? (
      <Link
        className="so-tag so-tag--tbd"
        href={`/race/${row.decidingRaceId}`}
        title={`The ${year} contest decides who holds this seat`}
      >
        {label} →
      </Link>
    ) : (
      <span
        className="so-tag so-tag--tbd"
        title={`The ${year} contest decides who holds this seat`}
      >
        {label}
      </span>
    );
  }

  if (row.status === "open") {
    return (
      <span className="so-tag so-tag--open" title="The incumbent has said they will not seek this seat">
        OPEN
      </span>
    );
  }

  if (row.status === "likely") {
    const when = signalMonth(row.openSignalDate);
    const host = hostOf(row.openSignalUrl);
    return (
      <span className="so-seat-status">
        <span
          className="so-tag so-tag--likely"
          title="A public signal short of an announcement"
        >
          LIKELY{when ? ` · ${when}` : ""}
        </span>
        {row.openSignalUrl ? (
          <a
            className="so-src"
            href={row.openSignalUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={host ? `Source: ${host}` : "Source"}
          >
            ↗
          </a>
        ) : null}
      </span>
    );
  }

  // No tag. Absence is the signal — the `incumbent_running` NULL rule carried
  // forward, so there is deliberately no placeholder here.
  return null;
}

export function SeatOutlookList({
  rows,
  cycle,
}: {
  rows: SeatOutlookRow[];
  cycle: number;
}) {
  // One source for the strip: every count derives from the same array the rows
  // render from, so the strip cannot disagree with what is below it. That makes
  // this a self-consistency check, not a correctness one — correctness is the
  // roster reading in the database.
  const senate = rows.filter((r) => r.chamber === "senate").length;
  const house = rows.filter((r) => r.chamber === "house").length;
  const open = rows.filter((r) => r.status === "open").length;
  const likely = rows.filter((r) => r.status === "likely").length;
  const tbd = rows.filter((r) => r.status === "tbd").length;

  const senateClass = senateClassForCycle(cycle);
  // At-large rows can carry no tag EVER, which is a different fact from "no
  // statement on file" — disclosed in the footnote, and only when such rows are
  // actually present so the 2026 side is untouched.
  const hasAtLarge = rows.some(
    (r) => r.chamber === "house" && r.district == null,
  );

  return (
    <div className="so-wrap">
      <div className="so-strip">
        {rows.length} SEATS · SENATE {senate} · HOUSE {house} · OPEN {open} ·
        LIKELY {likely} · TBD {tbd}
      </div>

      <div className="so-head">
        <span>SEAT</span>
        <span>INCUMBENT</span>
        <span>STATUS</span>
      </div>

      <ul className="so-list">
        {rows.map((row) => (
          <li className="so-row" key={row.bioguideId}>
            <span className="so-seat">{seatLabel(row)}</span>
            <span className="so-name">
              <Link href={`/members/${row.bioguideId}`}>{row.name}</Link>{" "}
              <span
                className="so-party"
                style={{ color: partyColor(row.party) }}
              >
                [{row.party ?? "?"}-{row.state}]
              </span>
            </span>
            <span className="so-status">
              <StatusCell row={row} />
            </span>
          </li>
        ))}
      </ul>

      <p className="so-foot">
        Senate seats are Class {senateClass ?? "—"}. House seats appear once
        the 120th Congress is seated and the roster resyncs. Tags come from
        curated public statements with a source link; no tag means no statement
        on file.
        {hasAtLarge ? (
          <>
            {" "}
            At-large seats (AK, DE, ND, SD, VT, WY) have no race record yet, so a
            tag cannot attach to them until the id gap closes.
          </>
        ) : null}
      </p>
    </div>
  );
}
