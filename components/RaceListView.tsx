"use client";

// HO 222: the /races LIST view — a consensus-led, toss-ups-first row list that
// replaces the old 5-column rating matrix. Lives inside CartogramShell's
// `listSlot` (one MAP/LIST toggle away from the map).
//
// HO 767 (mock-767 v18, ruled "as set"): /electoral's body in the general
// window. LIST 2 · CHAMBERS tabs · BOX fit · WHERE rows+beside:
//   - line 2 of the controls: SENATE and HOUSE as tabs, each with its race
//     count and its 7-day news count, then the three tier switches; the rows,
//     the switches and RACE NEWS follow the tab, and the search box on line 1
//     (CartogramShell, through ListQueryContext) filters as you type in both
//     chambers and jumps to the tab with the match;
//   - each row leads with who's on the ballot, not with the seat's holder; a
//     second line carries MOVED, PAC and NEWS, beside the facts where the main
//     column is 1,560px or wider;
//   - the rows scroll in a box that ends at the window's bottom edge (its top
//     measured here), column heads pinned; RACE NEWS sits beside it from
//     1,150px; under 900px the box is off and the page scrolls;
//   - a row opens into RaceOpenRow, one at a time (the HO 148 accordion).
// Every field arrives built (lib/electoral-rows.ts): no fetch.
//
// Superseded: the HO 222 header's dropped premise ("there is no race→news
// linkage in the data layer") stopped being true with the observation layer
// (HO 394) and HO 718's getSeatNews; NEWS here is the members on the ballot's
// (R2).

import { useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { GRADE_CARDS_CLOSE_EVENT } from "@/components/GradeCard";
import { IncumbentTag } from "@/components/IncumbentTag";
import { ELECTORAL_LAYOUT_EVENT, ListQueryContext } from "@/components/ListQueryContext";
import { PacSpendingLine } from "@/components/PacSpendingLine";
import { RaceNewsPanel } from "@/components/RaceNewsPanel";
import { RaceOpenRow, ageColor, partyClass } from "@/components/RaceOpenRow";
import { MarginBar, SpreadBar, formatCash } from "@/components/race-cells";
import type { ElectoralRow, RaceNews, Tier } from "@/lib/electoral-rows";
import { formatRelativeAge } from "@/lib/format";
import { kalshiDivergesFromConsensus, ratingBorderColor, ratingColor } from "@/lib/race-colors";
import type { MemberFacts, PacIeRow, PalestinePools } from "@/lib/queries";

const TIERS: { key: Tier; label: string }[] = [
  { key: "toss", label: "TOSS-UP" },
  { key: "lean", label: "LEAN" },
  { key: "likely", label: "LIKELY/SOLID" },
];

// RaceMovedIndicator's short forms of rating_history's source keys.
const SOURCE_SHORT: Record<string, string> = { cook: "COOK", sabato: "SABATO", inside_elections: "IE" };

// Severity rail: amber-bright toss-up, amber lean, dim likely/solid — lets the
// eye find competitive rows without reading the chip.
const RAIL: Record<Tier, string> = {
  toss: "var(--accent-amber-bright)",
  lean: "var(--accent-amber)",
  likely: "var(--text-dim)",
};

// The box's floor and ceiling (mock-767's): a short window still shows rows,
// a tall one doesn't stretch the box into a wall.
const BOX_MIN = 320;
const BOX_MAX = 1100;

const monthDay = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

// PacSpendingLine's glance rule: a current target (active, or unknown — a
// missing status reads as current) is what the line prints; none, no line.
const hasCurrentPac = (rows: PacIeRow[] | null) =>
  !!rows?.some((r) => ["active", "unknown"].includes(r.targetStatus ?? "unknown"));

function ConsensusChip({ rating }: { rating: string | null }) {
  return (
    <span
      className="race-list-chip"
      style={{
        border: `1px solid ${ratingBorderColor(rating)}`,
        color: ratingColor(rating),
      }}
    >
      {rating ?? "—"}
    </span>
  );
}

function ResultChip({ row }: { row: ElectoralRow }) {
  const r = row.result!;
  const cls = r.kind === "won" ? `rl-res--${partyClass(r.chipParty)}` : r.kind === "runoff" ? "rl-res--ro" : "rl-res--nc";
  const title = r.kind === "runoff" ? "Ballotpedia marks two: a runoff" : (r.provenance ?? undefined);
  return (
    <span className={`race-list-chip rl-res ${cls}`} title={title} data-result={r.kind}>
      {r.chip}
    </span>
  );
}

function MarginCell({ row }: { row: ElectoralRow }) {
  if (row.chamber === "senate") return <span className="race-list-margin-na">— senate</span>;
  if (row.margin2024 == null) return <span className="race-list-margin-na">— no data</span>;
  return <MarginBar margin={row.margin2024} />;
}

// The ballot cell: the majors by surname, "· N others" beside a lone major,
// the OPEN pill, then the holder the ballot doesn't carry with HO 759's tag.
// Past election day the winner's name carries the check and the others dim; a
// winner the majors don't name leads the cell.
function BallotCell({ row }: { row: ElectoralRow }) {
  const won = row.result?.kind === "won" ? row.result : null;
  const name = (key: string, surname: string) => {
    if (!won) return <span className="rl-nm">{surname}</span>;
    return won.winnerKeys.includes(key) ? (
      <span className="rl-wn">
        <span className="rl-nm">{surname}</span>
        <span className="rl-ck" title="Called by Ballotpedia">
          ✓
        </span>
      </span>
    ) : (
      <span className="rl-nm rl-nm--dim">{surname}</span>
    );
  };
  return (
    <span className="rl-mu">
      {won?.unnamed ? (
        <>
          <span className={`rl-pt ${partyClass(won.unnamed.party)}`}>[{won.unnamed.party ?? "?"}]</span>
          <span className="rl-wn">
            <span className="rl-nm">{won.unnamed.surname}</span>
            <span className="rl-ck" title="Called by Ballotpedia">
              ✓
            </span>
          </span>
          {row.majors.length ? <span className="rl-v">v</span> : null}
        </>
      ) : null}
      {row.majors.length === 0 && !won?.unnamed ? <span className="rl-nm rl-nm--dim">no ballot on file</span> : null}
      {row.majors.map((m, i) => (
        <span key={m.key} className="rl-maj">
          {i > 0 ? <span className="rl-v">v</span> : null}
          <span className={`rl-pt ${partyClass(m.party)}`}>[{m.party ?? "?"}]</span>
          {name(m.key, m.surname)}
          {m.incumbent ? <span className="rl-inc">inc.</span> : null}
        </span>
      ))}
      {row.othersCount > 0 && row.majors.length === 1 ? (
        <span className="rl-q">
          · {row.othersCount} other{row.othersCount === 1 ? "" : "s"} on the ballot
        </span>
      ) : null}
      {row.open ? <span className="racecard-open-tag">OPEN</span> : null}
      {row.holder ? (
        <span className="rl-holder">
          <span className="rl-q">{row.holder.surname}</span>
          {row.holder.tag ? <IncumbentTag q={row.holder.tag} /> : null}
        </span>
      ) : null}
    </span>
  );
}

// The second line: MOVED (14 days, R3), the dashboard's PAC glance line, and
// the newest NEWS of the last 30 days with how many more (R2).
function SignalLine({ row, nowMs }: { row: ElectoralRow; nowMs: number }) {
  const mv = row.move;
  const pac = hasCurrentPac(row.pac);
  const news = row.news[0];
  if (!mv && !pac && !news) return null;
  const src = mv ? (SOURCE_SHORT[mv.source] ?? mv.source.toUpperCase()) : "";
  return (
    <div className="rl-sig">
      {mv ? (
        <span
          className="rl-sg"
          data-moved={mv.observedAt}
          title={`Logged ${monthDay(mv.observedAt)}${mv.ratingDate ? ` · ${src}'s rating dated ${monthDay(mv.ratingDate)}` : ""}`}
        >
          <span className="rl-lab rl-lab--mv">MOVED</span>
          <span>
            {src} {mv.from ?? "—"} → {mv.to}
          </span>
          <span className="rl-age">{formatRelativeAge(mv.observedAt, nowMs)}</span>
        </span>
      ) : null}
      {pac ? (
        <span className="rl-sg">
          <span className="rl-lab rl-lab--pac">PAC</span>
          <PacSpendingLine rows={row.pac ?? undefined} variant="glance" />
        </span>
      ) : null}
      {news ? (
        <span className="rl-sg">
          <span className="rl-lab rl-lab--news">NEWS</span>
          <a
            href={news.url}
            target="_blank"
            rel="noopener noreferrer"
            className="rl-hl"
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {news.title}
          </a>
          <span className="rl-src">{news.publisher}</span>
          <span className="rl-age" style={{ color: ageColor(news.observedAt, nowMs) }}>
            {formatRelativeAge(news.observedAt, nowMs)}
          </span>
          {row.news.length > 1 ? <span className="rl-moreN">+{row.news.length - 1}</span> : null}
        </span>
      ) : null}
    </div>
  );
}

function RaceListRow({
  row,
  open,
  flash,
  onToggle,
  nowMs,
  children,
}: {
  row: ElectoralRow;
  open: boolean;
  flash: boolean;
  onToggle: () => void;
  nowMs: number;
  children: React.ReactNode;
}) {
  const diverges = !row.result?.called && kalshiDivergesFromConsensus(row.kalshiOdds, row.consensusScore, row.roster);
  return (
    <li className={`race-list-item${flash ? " rl-flash" : ""}`} id={`row-${row.raceId}`} data-race={row.raceId}>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget) return;
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="race-list-row rl-grid"
        data-tier={row.tier}
        style={{ borderLeftColor: RAIL[row.tier] }}
      >
        <span className="race-list-seat tabular-nums">{row.seat}</span>
        <span className="race-list-cand">
          <BallotCell row={row} />
        </span>
        <span className="rl-chipcell">{row.result ? <ResultChip row={row} /> : <ConsensusChip rating={row.consensusRating} />}</span>
        <SpreadBar cook={row.cook} sabato={row.sabato} ie={row.ie} final={row.result != null} />
        <span
          // HO 692 site 10 — NO `odds-only` class here: this is a direct child of
          // the fixed-track `.race-list-row` grid, and removing a grid item
          // re-flows every following item one track earlier. Its own attribute
          // rule uses `visibility: hidden` so the cell keeps its box. Measured
          // at HO 692: `display:none` grew the row 40->64px and moved cash
          // x 1304->1140. HO 767: a called seat's market blanks it (R6) the same
          // way, by ink, never by unmounting the track.
          className="race-list-diverge"
          data-market="1"
          title={diverges ? "Kalshi market favors the opposite party from the raters" : ""}
          style={{ color: diverges ? "var(--accent-amber)" : "transparent" }}
          aria-hidden={!diverges}
        >
          ◆
        </span>
        <span className="race-list-margin">
          <MarginCell row={row} />
        </span>
        <span
          className="race-list-cash tabular-nums"
          style={{ color: row.cash != null ? "var(--text-secondary)" : "var(--text-dim)" }}
        >
          {row.cash != null ? formatCash(row.cash) : "—"}
        </span>
        <span className="race-list-chevron" aria-hidden style={{ color: open ? "var(--accent-amber)" : "var(--text-dim)" }}>
          {open ? "▾" : "▸"}
        </span>
        <SignalLine row={row} nowMs={nowMs} />
      </div>
      {open ? children : null}
    </li>
  );
}

export function RaceListView({
  rows,
  raceNews,
  members,
  pools,
  medians,
  nowMs,
  passed,
}: {
  rows: ElectoralRow[];
  raceNews: RaceNews;
  members: Record<string, MemberFacts>;
  pools: PalestinePools;
  medians: { house: number | null; senate: number | null };
  nowMs: number;
  passed: boolean;
}) {
  const { query, setQuery } = useContext(ListQueryContext);
  const [tab, setTab] = useState<"senate" | "house">("senate");
  const [tiers, setTiers] = useState<ReadonlySet<Tier>>(new Set(["toss", "lean", "likely"]));
  const [openId, setOpenId] = useState<string | null>(null);
  const [flashId, setFlashId] = useState<string | null>(null);
  const [boxH, setBoxH] = useState<number | null>(null);
  const [newsH, setNewsH] = useState<number | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const asideRef = useRef<HTMLDivElement | null>(null);
  const revealRef = useRef<string | null>(null);

  const q = query.trim().toLowerCase();
  const byChamber = useMemo(
    () => ({ senate: rows.filter((r) => r.chamber === "senate"), house: rows.filter((r) => r.chamber === "house") }),
    [rows],
  );
  const matches = useCallback(
    (ch: "senate" | "house") => byChamber[ch].filter((r) => tiers.has(r.tier) && (!q || r.search.includes(q))),
    [byChamber, tiers, q],
  );
  const shown = matches(tab);
  const seatLabels = useMemo(() => Object.fromEntries(rows.map((r) => [r.raceId, r.seat])), [rows]);
  const onPage = useCallback((id: string) => seatLabels[id] != null, [seatLabels]);

  // A search looks in both chambers and jumps to the tab with the match.
  useEffect(() => {
    if (!q) return;
    const other = tab === "senate" ? "house" : "senate";
    if (matches(tab).length === 0 && matches(other).length > 0) setTab(other);
  }, [q, tab, matches]);

  // Any re-render that moves the rows closes an open grade card (§6).
  const tiersKey = [...tiers].sort().join(",");
  useEffect(() => {
    window.dispatchEvent(new Event(GRADE_CARDS_CLOSE_EVENT));
  }, [tab, tiersKey, q, openId]);

  // BOX fit: the box's top is measured here, its bottom is the window's less
  // the page's bottom padding; RACE NEWS beside it shares that bottom edge.
  // Whether the box applies at all (900px and up) and whether the column sits
  // beside it (1,150px and up) is the stylesheet's call, so the server render
  // and the first client render agree.
  const measure = useCallback(() => {
    const box = boxRef.current;
    if (!box) return;
    const main = box.closest("main");
    const pad = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 16;
    const top = box.getBoundingClientRect().top + window.scrollY;
    const h = Math.min(BOX_MAX, Math.max(BOX_MIN, Math.round(window.innerHeight - top - pad)));
    setBoxH(h);
    const aside = asideRef.current;
    if (aside) setNewsH(Math.max(BOX_MIN, Math.round(top + h - (aside.getBoundingClientRect().top + window.scrollY))));
  }, []);
  useLayoutEffect(() => {
    measure();
  }, [measure, tab]);
  useEffect(() => {
    window.addEventListener("resize", measure);
    window.addEventListener(ELECTORAL_LAYOUT_EVENT, measure);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener(ELECTORAL_LAYOUT_EVENT, measure);
    };
  }, [measure]);

  // An opened row comes wholly into view: inside the box when the rows
  // scroll there, else in the window.
  useEffect(() => {
    const id = revealRef.current;
    if (!id) return;
    revealRef.current = null;
    const li = document.getElementById(`row-${id}`);
    const box = boxRef.current;
    if (!li || !box) return;
    if (box.scrollHeight <= box.clientHeight + 1 || getComputedStyle(box).overflowY === "visible") {
      li.scrollIntoView({ block: "nearest" });
      return;
    }
    const b = box.getBoundingClientRect();
    const r = li.getBoundingClientRect();
    const heads = box.querySelector<HTMLElement>("[data-sticky-heads]")?.offsetHeight ?? 0;
    const top = r.top - b.top - heads;
    if (r.bottom > b.bottom - 6) box.scrollTop += Math.min(top, r.bottom - b.bottom + 6);
    else if (top < 0) box.scrollTop += top;
  });

  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 1200);
    return () => clearTimeout(t);
  }, [flashId]);

  const toggleRow = (id: string) => {
    const next = openId === id ? null : id;
    setOpenId(next);
    if (next) revealRef.current = next;
  };

  // A seat tag in RACE NEWS, or a holder's RUNNING FOR seat: that seat's tab,
  // its tier back on, the search cleared, the row open and brought into view.
  const openSeat = useCallback(
    (id: string) => {
      const row = rows.find((r) => r.raceId === id);
      if (!row) return;
      setTab(row.chamber);
      setQuery("");
      setTiers((t) => (t.has(row.tier) ? t : new Set([...t, row.tier])));
      setOpenId(id);
      setFlashId(id);
      revealRef.current = id;
    },
    [rows, setQuery],
  );

  const toggleTier = (t: Tier) =>
    setTiers((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });

  const all = byChamber[tab];
  const tierTotal = (t: Tier) => all.filter((r) => r.tier === t).length;
  const onTotal = all.filter((r) => tiers.has(r.tier)).length;
  const said = q ? `${shown.length} match “${query.trim()}”` : onTotal < all.length ? `showing ${onTotal} of ${all.length}` : "";
  const diverge = all.filter((r) => !r.result?.called && kalshiDivergesFromConsensus(r.kalshiOdds, r.consensusScore, r.roster)).length;
  const label = tab === "senate" ? "Senate" : "House";

  return (
    <div className="rl-list">
      {/* Line 2: the tabs, then the tier switches (LIST 2, CHAMBERS tabs). */}
      <div className="rl-lt">
        <nav className="rl-tabs" role="tablist" aria-label="Senate or House">
          {(["senate", "house"] as const).map((ch) => {
            const n = raceNews[ch].length;
            return (
              <button
                key={ch}
                type="button"
                role="tab"
                aria-selected={tab === ch}
                className={tab === ch ? "rl-tab is-active" : "rl-tab"}
                onClick={() => {
                  setTab(ch);
                  setOpenId(null);
                }}
              >
                {ch === "senate" ? "SENATE" : "HOUSE"}
                {q ? (
                  <span className="rl-tc">{matches(ch).length} match</span>
                ) : (
                  <span className="rl-tn">{byChamber[ch].length}</span>
                )}
                {n > 0 && !q ? <span className="rl-tnews">· {n} news</span> : null}
              </button>
            );
          })}
        </nav>
        <div className="rl-tiers" role="group" aria-label="Rating tiers">
          {TIERS.map((t) => (
            <button
              key={t.key}
              type="button"
              className={`rl-f rl-f--${t.key}${tiers.has(t.key) ? " is-on" : ""}`}
              aria-pressed={tiers.has(t.key)}
              onClick={() => toggleTier(t.key)}
            >
              {tierTotal(t.key)} {t.label}
            </button>
          ))}
          {said ? <span className="rl-showing">{said}</span> : null}
          {diverge > 0 ? (
            // HO 692 site 11 — the separator goes inside the gate with the
            // clause; left outside, odds-off would leave a dangling " · " after
            // the switches. HO 767 (R4): it rides line 2 now, over the tab's rows.
            <span className="odds-only rl-diverge-note" data-market="1">
              {" · "}
              <span style={{ color: "var(--accent-amber)" }}>
                ◆ {diverge} market{diverge === 1 ? "" : "s"} disagree with raters
              </span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="rl-two">
        <div className="rl-main">
          <div
            ref={boxRef}
            className="rl-box"
            data-scroll-box
            tabIndex={0}
            role="region"
            aria-label="Race list"
            style={boxH != null ? { maxHeight: boxH } : undefined}
          >
            <div className="rl-heads rl-grid" data-sticky-heads>
              <span>Seat</span>
              <span>On the ballot</span>
              <span>{passed ? "Result" : "Consensus"}</span>
              <span className="rl-h-s" title="Cook · Sabato · Inside Elections">
                C · S · I
              </span>
              <span aria-hidden />
              <span className="rl-h-m">2024 House</span>
              <span className="rl-h-c">Inc. cash</span>
              <span aria-hidden />
              <span className="rl-h-x">Latest</span>
            </div>
            <ul className="race-list">
              {shown.map((r) => (
                <RaceListRow
                  key={r.raceId}
                  row={r}
                  open={openId === r.raceId}
                  flash={flashId === r.raceId}
                  onToggle={() => toggleRow(r.raceId)}
                  nowMs={nowMs}
                >
                  <RaceOpenRow
                    row={r}
                    members={members}
                    pools={pools}
                    medians={medians}
                    nowMs={nowMs}
                    onSeat={openSeat}
                    onPage={onPage}
                  />
                </RaceListRow>
              ))}
            </ul>
            {q && shown.length === 0 ? (
              <div className="rl-stub">
                no {label} row matches “{query.trim()}”
              </div>
            ) : null}
            {!q && !tiers.has("likely") && tierTotal("likely") > 0 ? (
              <div className="rl-stub">
                {tierTotal("likely")} likely/solid {label} rows off ·{" "}
                <button type="button" onClick={() => toggleTier("likely")}>
                  show
                </button>
              </div>
            ) : null}
          </div>
        </div>
        <aside className="rl-aside" ref={asideRef}>
          <RaceNewsPanel
            chamber={tab}
            items={raceNews[tab]}
            seatLabels={seatLabels}
            nowMs={nowMs}
            onSeat={openSeat}
            maxHeight={newsH}
          />
        </aside>
      </div>
    </div>
  );
}
