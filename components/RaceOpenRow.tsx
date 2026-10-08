"use client";

// HO 767 — the open row on /electoral's LIST (mock-767 v18: OPEN ROW 2, TEXT 2,
// PHOTO 2, GRADE AS chip, NEWS 2). Three parts, laid out by the main column's
// width (three columns from 1,560px, two below, one under 880px):
//   - ON THE BALLOT, every name in full with how it got there; under a rule,
//     the seat: who holds it when the ballot doesn't carry them, a special
//     election, the three raters, the Kalshi line (odds), the AIPAC block;
//   - ON THE BALLOT · IN CONGRESS NOW, each sitting member on the ballot with
//     what the member page knows about them;
//   - NEWS, up to five items about those members (30 days), and the race page.
// Past election day (row.result) the ballot reads the result in HO 758's
// words. Every figure comes from the page's batched reads (lib/electoral-rows.ts,
// lib/electoral-general.ts); nothing here fetches.
import Link from "next/link";
import { useState } from "react";
import { GradeChip } from "@/components/GradeCard";
import { PacSpendingLine } from "@/components/PacSpendingLine";
import { KalshiLine } from "@/components/race-cells";
import type { BallotEntry, MemberFacts, PalestinePools } from "@/lib/queries";
import type { ElectoralRow } from "@/lib/electoral-rows";
import { formatDollarsCompact, formatRelativeAge } from "@/lib/format";
import { ratingColor } from "@/lib/race-colors";
import { districtToken } from "@/lib/race-id";
import { seatOf } from "@/lib/incumbent-tag";

// The race page's palette: D and R by party, every other party the
// independents' purple (components/RaceCandidates.tsx).
export function partyClass(p: string | null | undefined): "d" | "r" | "o" {
  const k = (p ?? "").slice(0, 1).toUpperCase();
  return k === "D" ? "d" : k === "R" ? "r" : "o";
}

const monthDay = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const pct1 = (n: number) => String(Number(n.toFixed(1)));

// RaceNewsRow's age tiers: fresh amber, then secondary, then muted past a day.
export function ageColor(iso: string, nowMs: number): string {
  const h = (nowMs - Date.parse(iso)) / 3_600_000;
  if (h < 6) return "var(--accent-amber-bright)";
  if (h < 24) return "var(--text-secondary)";
  return "var(--text-muted)";
}

// SponsorPhoto's initials: the first letters of the name's first two words.
function initials(name: string): string {
  const parts = name.replace(/\s*\[.*\]$/, "").trim().split(/[\s,]+/).filter(Boolean);
  return (((parts[0] ?? "")[0] ?? "") + ((parts[1] ?? "")[0] ?? "")).toUpperCase() || "?";
}

// The race page's incumbent-card crop (.member-photo, an 80px square, cover);
// no photo, or one that fails to load, is the initials in party colour.
export function Face({ url, name, party, small = false }: { url: string | null; name: string; party: string | null; small?: boolean }) {
  const [failed, setFailed] = useState(false);
  const cls = `rl-face${small ? " rl-face--sm" : ""}`;
  if (!url || failed)
    return (
      <span className={`${cls} rl-face--ini ${partyClass(party)}`} role="img" aria-label={`${name} (no photo)`}>
        {initials(name)}
      </span>
    );
  // eslint-disable-next-line @next/next/no-img-element
  return <img className={cls} src={url} alt={name} onError={() => setFailed(true)} />;
}

function Tile({ label, value, sub, className = "", title }: { label: string; value: React.ReactNode; sub?: React.ReactNode; className?: string; title?: string }) {
  return (
    <div className={`rl-tile ${className}`} title={title}>
      <span className="rl-tl">{label}</span>
      <span className="rl-tv">{value}</span>
      {sub ? <span className="rl-ts">{sub}</span> : null}
    </div>
  );
}

// How a name got onto the ballot, and the line under it (a runoff's share, a
// printed party). Past election day the result reads first.
function how(e: BallotEntry, row: ElectoralRow): { status: string; cls: string; under: string[] } {
  const under: string[] = [];
  let status =
    e.how === "incumbent"
      ? "incumbent"
      : e.how === "won_primary"
        ? `won primary${e.primaryDate ? ` ${monthDay(e.primaryDate)}` : ""}`
        : e.how === "advanced"
          ? `advanced${e.primaryDate ? ` ${monthDay(e.primaryDate)}` : ""}`
          : e.how === "nominee"
            ? "nominee"
            : e.how === "running" || e.how === "declared"
              ? e.how
              : "";
  if (e.runoff) {
    status = `${e.how === "incumbent" ? "incumbent · " : ""}won runoff ${monthDay(e.runoff.date)}`;
    // A primary runoff's shares would read as the general's once there is one.
    if (!row.result && e.runoff.pct != null)
      under.push(
        `${pct1(e.runoff.pct)}% to ${e.runoff.loser ?? "the runner-up"}${e.runoff.loserPct != null ? `'s ${pct1(e.runoff.loserPct)}%` : ""}`,
      );
  }
  if (e.printedParty) {
    if (status) under.push(e.printedParty);
    else status = e.printedParty;
  }
  let cls = "rl-how";
  const r = row.result;
  if (r?.kind === "won" && r.winnerKeys.includes(e.key)) {
    status = e.incumbent ? "re-elected" : "Elected";
    cls += " rl-how--el";
  } else if (r?.kind === "won" && e.incumbent) {
    status = "defeated";
  } else if (r?.kind === "runoff" && r.winnerKeys.includes(e.key)) {
    status = "runoff";
    cls += " rl-how--ro";
  }
  return { status, cls, under };
}

function Ballot({ row }: { row: ElectoralRow }) {
  let entries = row.ballot;
  // Past election day the winner, or a runoff's two, lead (HO 758's roster).
  if (row.result?.winnerKeys.length) {
    const lead = new Set(row.result.winnerKeys);
    entries = [...entries.filter((e) => lead.has(e.key)), ...entries.filter((e) => !lead.has(e.key))];
  }
  return (
    <div className="rl-ballot">
      <span className="rl-tl">On the ballot</span>
      <div className="rl-bv">
        {entries.length === 0 ? (
          <div className="rl-none">No ballot on file for this seat yet.</div>
        ) : (
          <div className="rl-bal">
            {entries.map((e) => {
              const h = how(e, row);
              return (
                <div key={e.key} className="rl-bal-row">
                  <span className={`rl-pt ${partyClass(e.party)}`}>[{e.party ?? "?"}]</span>
                  {e.bioguideId ? (
                    <Link href={`/members/${e.bioguideId}`} className="rl-nm rl-nm--link">
                      {e.name}
                    </Link>
                  ) : (
                    <span className="rl-nm">{e.name}</span>
                  )}
                  <span className={h.cls}>{h.status}</span>
                  {h.under.length ? <span className="rl-hd">{h.under.join(" · ")}</span> : null}
                </div>
              );
            })}
            {row.withdrew.length ? (
              <span className="rl-hd rl-hd--wd">
                Withdrew: {row.withdrew.map((w) => `${w.name} (${w.party ?? "?"})`).join(", ")}
              </span>
            ) : null}
          </div>
        )}
        {row.result?.provenance ? <div className="rl-prov">{row.result.provenance}</div> : null}
      </div>
    </div>
  );
}

function SeatHeldBy({
  row,
  facts,
  pools,
  onSeat,
  onPage,
}: {
  row: ElectoralRow;
  facts: MemberFacts | undefined;
  pools: PalestinePools;
  onSeat: (raceId: string) => void;
  onPage: (raceId: string) => boolean;
}) {
  const h = row.holder!;
  const q = h.tag;
  let why: React.ReactNode = null;
  if (q?.kind === "moved" || q?.kind === "senate") {
    const target = q.kind === "senate" ? `${seatOf(q.raceId).replace(/^S-/, "")} SEN` : seatOf(q.raceId);
    const lead = q.kind === "senate" ? "running for Senate" : "running in";
    why = (
      <span className="nb">
        {lead}{" "}
        {onPage(q.raceId) ? (
          <button type="button" className="rl-seatbtn" onClick={() => onSeat(q.raceId)}>
            {target}
          </button>
        ) : (
          <Link href={`/race/${q.raceId}`} className="rl-lk">
            {target} →
          </Link>
        )}
      </span>
    );
  } else if (q?.kind === "none") {
    why = { retiring: "retiring", withdrew: "withdrew", lost_primary: "lost the primary", absent: "not on the ballot" }[q.reason];
  }
  const grade = facts?.grade;
  const party = <span className={partyClass(h.party)}>({h.party ?? "?"})</span>;
  return (
    <div className="rl-blk">
      <span className="rl-tl">Seat held by</span>
      <div className="rl-bv rl-sh">
        <Face url={h.depictionUrl} name={h.name} party={h.party} small />
        <span>
          <Link href={`/members/${h.bioguideId}`} className="rl-nm rl-nm--link">
            {h.name}
          </Link>{" "}
          {grade ? (
            // The party, the chip and the comma travel as one piece.
            <span className="nb">
              {party}{" "}
              <GradeChip
                name={h.name}
                grade={grade.grade}
                rank={grade.rank}
                total={grade.total}
                sponsor={grade.sponsor}
                voting={grade.voting}
                chamber={facts?.chamber ?? null}
                pool={facts?.chamber === "senate" ? pools.senate : pools.house}
                syncedAt={pools.syncedAt}
              />
              {why ? "," : ""}
            </span>
          ) : (
            <>
              {party}
              {why ? "," : ""}
            </>
          )}{" "}
          {why}
        </span>
      </div>
    </div>
  );
}

// Where a member sits now and what this ballot is for them, held whole at each
// dot so a phone breaks the line there. Past election day: how it went.
function roleParts(m: MemberFacts, isInc: boolean, row: ElectoralRow, entryKey: string | null): string[] {
  const chamber = m.chamber === "senate" ? "Senate" : "House";
  const ownSeat = m.chamber === "senate" ? `${m.state} SEN` : `${m.state}-${districtToken(m.district)}`;
  const sen = row.chamber === "senate";
  const r = row.result;
  if (!r) return isInc ? [chamber, "running to keep the seat"] : [chamber, ownSeat, sen ? "running for Senate" : `running in ${row.seat}`];
  const mine = entryKey != null && r.winnerKeys.includes(entryKey);
  const out =
    r.kind === "won"
      ? mine
        ? isInc ? "re-elected" : sen ? "elected to the Senate" : `elected in ${row.seat}`
        : isInc ? "defeated" : sen ? "lost the Senate race" : `lost in ${row.seat}`
      : r.kind === "runoff"
        ? mine
          ? isInc ? "in the runoff" : sen ? "in the Senate runoff" : `in the ${row.seat} runoff`
          : "out of the runoff"
        : isInc ? "not yet called" : sen ? "Senate race not yet called" : `${row.seat} not yet called`;
  return isInc ? [chamber, out] : [chamber, ownSeat, out];
}

function Member({
  bio,
  row,
  facts,
  pools,
  median,
}: {
  bio: string;
  row: ElectoralRow;
  facts: MemberFacts;
  pools: PalestinePools;
  median: number | null;
}) {
  const entry = row.ballot.find((e) => e.bioguideId === bio) ?? null;
  const isInc = entry?.incumbent ?? false;
  const shown = row.majors.find((m) => m.key === entry?.key)?.surname ?? facts.lastName ?? facts.name;
  const role = roleParts(facts, isInc, row, entry?.key ?? null);
  const r = row.result;
  const outcomeIdx = r ? role.length - 1 : -1;
  const won = r && entry && r.winnerKeys.includes(entry.key);
  const info = [facts.tookOffice ? `took office ${facts.tookOffice}` : null, facts.birthYear ? `born ${facts.birthYear}` : null].filter(Boolean).join(" · ");
  const f = facts.fundraising;
  const g = facts.grade;
  const dim1 = facts.dim1;
  return (
    <div className="rl-mem has-face">
      <Face url={facts.depictionUrl} name={facts.name} party={facts.party} />
      <div className="rl-mh">
        <span className={`rl-mn ${partyClass(facts.party)}`}>
          {shown}{" "}
          <span className="nb">
            ({facts.party ?? "?"})
            {g ? (
              <>
                {" "}
                <GradeChip
                  name={facts.name}
                  grade={g.grade}
                  rank={g.rank}
                  total={g.total}
                  sponsor={g.sponsor}
                  voting={g.voting}
                  chamber={facts.chamber}
                  pool={facts.chamber === "senate" ? pools.senate : pools.house}
                  syncedAt={pools.syncedAt}
                />
              </>
            ) : null}
          </span>
        </span>
        <Link href={`/members/${bio}`} className="rl-lk">
          Member page →
        </Link>
        <span className="rl-mi rl-mr">
          {role.map((p, i) => (
            <span key={i} className={`nb${i === outcomeIdx && won ? " rl-ok" : ""}`}>
              {p}
              {i < role.length - 1 ? " ·" : ""}{" "}
            </span>
          ))}
        </span>
        {info ? <span className="rl-mi">{info}</span> : null}
      </div>
      {f ? (
        <div className="rl-tiles">
          <div className="rl-tile">
            <span className="rl-tl">Raised</span>
            <span className="rl-tv">{f.raised != null ? formatDollarsCompact(f.raised) : "—"}</span>
            {f.cashOnHand != null ? (
              // Cash on hand rides under RAISED; the incumbent's is the row's to
              // show (C5), so theirs prints here only where the row drops it.
              <span className={`rl-ts rl-spill rl-cash${isInc ? " rl-cash--inc" : ""}`}>
                {formatDollarsCompact(f.cashOnHand)} on hand
              </span>
            ) : null}
          </div>
          <Tile label="On hand" value={f.cashOnHand != null ? formatDollarsCompact(f.cashOnHand) : "—"} className="rl-tile--cash" />
          <Tile label="Small-dollar" value={f.smallPct != null ? `${f.smallPct}%` : "—"} title="donors who gave under $200" />
          <Tile
            label="FEC as of"
            value={
              f.coverageEnd ? (
                f.sourceUrl ? (
                  <a href={f.sourceUrl} target="_blank" rel="noopener noreferrer" className="rl-lk">
                    {monthDay(f.coverageEnd)} ↗
                  </a>
                ) : (
                  monthDay(f.coverageEnd)
                )
              ) : (
                "—"
              )
            }
          />
          {f.isSenateCampaign ? (
            // HO 416's tag, as the member page prints it: a House member's
            // committee here is their Senate campaign's.
            <span className="rl-camp">Senate {f.cycle} campaign</span>
          ) : null}
        </div>
      ) : (
        <div className="rl-none">No FEC totals on file.</div>
      )}
      <div className="rl-tiles rl-rec">
        <Tile
          label="Missed · 119th"
          value={facts.missed ? `${facts.missed.pct}%` : "—"}
          sub={median != null ? `${facts.chamber === "senate" ? "Senate" : "House"} median ${median.toFixed(1)}%` : undefined}
        />
        {dim1 != null ? (
          <div className="rl-tile" title="liberal −1 … +1 conservative">
            <span className="rl-tl">DW-NOMINATE</span>
            <span className="rl-tv">{dim1 > 0 ? "+" : dim1 < 0 ? "−" : ""}{Math.abs(dim1).toFixed(3)}</span>
            <span className="rl-ideo" aria-hidden>
              <i className={partyClass(facts.party)} style={{ left: `${(((dim1 + 1) / 2) * 100).toFixed(1)}%` }} />
            </span>
          </div>
        ) : (
          <Tile label="DW-NOMINATE" value={<span className="rl-dash">—</span>} sub="too few votes" />
        )}
        <Tile label="Sponsored" value={facts.sponsored} sub={`${facts.enacted} enacted`} />
      </div>
    </div>
  );
}

export function RaceOpenRow({
  row,
  members,
  pools,
  medians,
  nowMs,
  onSeat,
  onPage,
}: {
  row: ElectoralRow;
  members: Record<string, MemberFacts>;
  pools: PalestinePools;
  medians: { house: number | null; senate: number | null };
  nowMs: number;
  onSeat: (raceId: string) => void;
  onPage: (raceId: string) => boolean;
}) {
  const inCongress = row.memberIds.filter((b) => members[b]);
  const passed = row.result != null;
  const calls = (
    <>
      <Tile label="Cook" value={<span style={{ color: ratingColor(row.cook) }}>{row.cook ?? "—"}</span>} />
      <Tile label="Sabato" value={<span style={{ color: ratingColor(row.sabato) }}>{row.sabato ?? "—"}</span>} />
      <Tile label="Inside" value={<span style={{ color: ratingColor(row.ie) }}>{row.ie ?? "—"}</span>} />
      {row.chamber === "house" ? (
        // The row drops its 2024 column under 900px; the open row picks it up.
        <Tile
          label="2024 House"
          className="rl-only-narrow"
          value={
            row.margin2024 == null ? (
              <span className="rl-dash">—</span>
            ) : (
              <span className={row.margin2024 > 0 ? "r" : "d"}>
                {row.margin2024 > 0 ? "R" : "D"}+{Math.abs(row.margin2024).toFixed(1)}
              </span>
            )
          }
        />
      ) : null}
    </>
  );
  return (
    <div className={`race-list-expand rl-x${inCongress.length ? " has-p" : ""}`}>
      <div className="rl-xr">
        <Ballot row={row} />
        <div className="rl-seatctx">
          {row.holder ? (
            <SeatHeldBy row={row} facts={members[row.holder.bioguideId]} pools={pools} onSeat={onSeat} onPage={onPage} />
          ) : null}
          {row.special ? (
            <div className="rl-blk">
              <span className="rl-tl">{row.special.label}</span>
              {row.special.termEnds ? <div className="rl-bv">The winner serves out the term ending Jan {row.special.termEnds}.</div> : null}
            </div>
          ) : null}
          {passed ? (
            <div className="rl-blk rl-fc">
              <span className="rl-tl">Final calls</span>
              <div className="rl-tiles">{calls}</div>
            </div>
          ) : (
            <div className="rl-tiles rl-blk">{calls}</div>
          )}
          {/* HO 692 site 12 — the Kalshi line, in this column's flow (not a
              grid child), so the odds-off rule's display:none moves nothing.
              A called seat's market hides on the result (R6), not on its
              close time. */}
          {row.result?.called ? null : <KalshiLine odds={row.kalshiOdds} roster={row.roster} />}
          {row.pac?.length ? (
            <div className="rl-blk rl-pac">
              <PacSpendingLine rows={row.pac} />
            </div>
          ) : null}
          {inCongress.length === 0 ? (
            <div className="rl-none rl-blk">No FEC totals or voting record here: nobody on this ballot holds office.</div>
          ) : null}
        </div>
      </div>
      {inCongress.length ? (
        <div className="rl-xp">
          <span className="rl-tl rl-xp-l">On the ballot · in Congress now</span>
          {inCongress.map((b) => (
            <Member
              key={b}
              bio={b}
              row={row}
              facts={members[b]!}
              pools={pools}
              median={members[b]!.chamber === "senate" ? medians.senate : medians.house}
            />
          ))}
        </div>
      ) : null}
      <div className="rl-xn">
        <span className="rl-tl">News</span>
        {row.news.length ? (
          row.news.map((n) => (
            <div key={n.obsId} className="rl-nw">
              <a href={n.url} target="_blank" rel="noopener noreferrer" className="rl-hl">
                {n.title}
              </a>
              <span className="nb">
                <span className="rl-src">{n.publisher}</span>
                <span className="rl-age" style={{ color: ageColor(n.observedAt, nowMs) }}>
                  {formatRelativeAge(n.observedAt, nowMs)}
                </span>
              </span>
            </div>
          ))
        ) : (
          <div className="rl-none">No news in the feed for anyone on this ballot.</div>
        )}
      </div>
      <div className="rl-xfoot">
        <Link href={`/race/${row.raceId}`} className="rl-hub">
          Full race page →
        </Link>
      </div>
    </div>
  );
}
