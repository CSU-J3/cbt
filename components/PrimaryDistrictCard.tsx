"use client";

// HO 226: the PRIMARIES district-modal detail card — TWO party columns
// (D primary | R primary; one column for a single/open primary), each in one of
// three RESULTS-era states (supersedes spec-4's dead polling card): VOTED+DECIDED
// / VOTED+RUNOFF / NOT-YET-VOTED. No portrait, no front-runner/polling framing,
// no news. Voted columns lead with the EXTRACTED HO 207 ShareBar (shared, not
// rebuilt). Columns bottom-align via a flex spacer that pushes the status footer
// flush — the footer (WON / RUNOFF / no results yet) replaces the deferred
// news-pin as the alignment anchor.
import Link from "next/link";
import { ShareBar } from "@/components/ShareBar";
import type { CartogramContest } from "@/lib/cartogram-data";
import { formatDateLong, formatDateShort } from "@/lib/format";
import type { PrimaryCandidate, PrimaryWithCandidates } from "@/lib/queries";

function partyTint(party: string): string {
  if (party === "D") return "var(--party-democrat)";
  if (party === "R") return "var(--party-republican)";
  return "var(--accent-amber)"; // open / nonpartisan
}
function partyHead(party: string): string {
  if (party === "D") return "DEM PRIMARY";
  if (party === "R") return "REP PRIMARY";
  return "OPEN PRIMARY";
}
function partyOrder(party: string): number {
  return party === "D" ? 0 : party === "R" ? 1 : 2;
}

type ColState = "decided" | "runoff" | "notyet";
function colState(p: PrimaryWithCandidates): ColState {
  const voted = p.candidates.some((c) => c.vote_pct != null);
  if (!voted) return "notyet";
  const winners = p.candidates.filter((c) => c.status === "winner").length;
  return winners >= 2 ? "runoff" : "decided";
}

function isSeatInc(c: PrimaryCandidate, seatBio: string | null): boolean {
  return seatBio ? c.bioguide_id === seatBio : c.incumbent;
}

// Strip the trailing party tag from a contest label ("AL-01 D" → "AL-01",
// "TX SEN R" → "TX SEN", "CA-22" → "CA-22" for open).
function districtLabel(label: string): string {
  return label.replace(/ [DR]$/, "");
}

function NotYetRoster({ p }: { p: PrimaryWithCandidates }) {
  const seatBio = p.seat_incumbent_bioguide;
  const ordered = [...p.candidates].sort(
    (a, b) =>
      Number(isSeatInc(b, seatBio)) - Number(isSeatInc(a, seatBio)) ||
      Number(b.incumbent) - Number(a.incumbent) ||
      a.name.localeCompare(b.name),
  );
  if (ordered.length === 0)
    return <div className="pdc-empty">roster pending</div>;
  return (
    <ul className="pdc-roster">
      {ordered.map((c) => (
        <li key={c.id} className="pdc-cand">
          {c.bioguide_id ? (
            <Link href={`/members/${c.bioguide_id}`} className="pdc-cand-name">
              {c.name}
            </Link>
          ) : (
            <span className="pdc-cand-name">{c.name}</span>
          )}
          <span className="pdc-cand-party" style={{ color: partyTint(c.party) }}>
            [{c.party}]
          </span>
          {isSeatInc(c, seatBio) ? <span className="pdc-cand-inc">INC</span> : null}
        </li>
      ))}
    </ul>
  );
}

function Column({ contest }: { contest: CartogramContest }) {
  const p = contest.primary;
  if (!p) return null;
  const tint = partyTint(p.party);
  const st = colState(p);

  const footer =
    st === "decided"
      ? "WON · advances to Nov"
      : st === "runoff"
        ? `RUNOFF · top 2 advance${p.runoff_date ? ` ${formatDateShort(p.runoff_date)}` : ""}`
        : `no results yet · ${p.candidates.length} filed`;

  return (
    <div className="pdc-col">
      <div className="pdc-col-head" style={{ color: tint }}>
        {partyHead(p.party)}
      </div>
      <div className="pdc-col-body">
        {st === "notyet" ? (
          <>
            <div className="pdc-sched">
              SCHEDULED · votes {p.primary_date ? formatDateLong(p.primary_date) : "TBD"}
            </div>
            <NotYetRoster p={p} />
          </>
        ) : (
          <div className="pdc-barwrap">
            <ShareBar cands={p.candidates} tint={tint} />
          </div>
        )}
      </div>
      {/* spacer pushes the footer flush to the bottom → columns bottom-align */}
      <div className="pdc-col-spacer" />
      <div className="pdc-col-footer" data-state={st}>
        {footer}
      </div>
    </div>
  );
}

export function PrimaryDistrictCard({ contests }: { contests: CartogramContest[] }) {
  const cols = [...contests]
    .filter((c) => c.primary)
    .sort((a, b) => partyOrder(a.primary!.party) - partyOrder(b.primary!.party));
  if (cols.length === 0)
    return <div className="pdc-empty">No primary on file for this district.</div>;

  return (
    <div className="pdc">
      <div className="pdc-head">{districtLabel(cols[0]!.label)}</div>
      <div className="pdc-cols" data-cols={cols.length}>
        {cols.map((c) => (
          <Column key={c.label} contest={c} />
        ))}
      </div>
    </div>
  );
}
