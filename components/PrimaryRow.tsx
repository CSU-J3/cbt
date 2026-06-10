"use client";

// HO 203 → HO 207 — Primaries row. HO 203 shipped a candidate-field list +
// single-open expand; HO 207 (now that HO 206 populates `vote_pct`) replaces the
// list with a party-tinted RESULTS share bar for voted primaries, keeping the
// field-list as the "not yet voted" fallback for un-voted ones.
//
// Marker semantics (HO 207 reframe): ★ = ADVANCER (won / advanced — runoffs
// advance two, so two ★s is valid), read from `status==='winner'`. Incumbent is
// a separate signal — amber name in the fallback list, an "INC" badge in the
// expand — so the two never collide on the same glyph. The seat-incumbent
// resolution (HO 203, `seat_incumbent_bioguide`) still drives that incumbent
// cue and the member-page links.
//
// Client-side single-open expand (not URL-driven) because past primaries live
// inside a native <details> a navigation re-render would collapse.
import {
  createContext,
  type ReactNode,
  useContext,
  useState,
} from "react";
import Link from "next/link";
import {
  FIELD_CAP,
  isAdvancer,
  lastName,
  orderedByShare,
  ShareBar,
} from "@/components/ShareBar";
import { formatDateShort } from "@/lib/format";
import type { PrimaryCandidate, PrimaryWithCandidates } from "@/lib/queries";
import { stateName } from "@/lib/states";

// HO 203: single-open expand across the whole calendar (matching the HO 148
// bills/members pattern — opening one row collapses any other). State is lifted
// into a context provider that wraps both the upcoming groups and the past
// <details>, so it stays client-side (survives inside the native <details>)
// while being single-open rather than per-row-independent.
type PrimaryExpandCtx = { openId: string | null; toggle: (id: string) => void };
const PrimaryExpandContext = createContext<PrimaryExpandCtx>({
  openId: null,
  toggle: () => {},
});

export function PrimaryExpandProvider({ children }: { children: ReactNode }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const toggle = (id: string) => setOpenId((cur) => (cur === id ? null : id));
  return (
    <PrimaryExpandContext.Provider value={{ openId, toggle }}>
      {children}
    </PrimaryExpandContext.Provider>
  );
}

function partyChip(party: string): { label: string; color: string } {
  if (party === "D") return { label: "DEM", color: "var(--party-democrat)" };
  if (party === "R") return { label: "REP", color: "var(--party-republican)" };
  return { label: "OPEN", color: "var(--accent-amber)" };
}

// ★ = the actual seat incumbent (the candidate whose bioguide matches the seat's
// current officeholder, `seatBio`) — distinct from the per-candidate `incumbent`
// flag ("is a sitting member of Congress"), which is true for >1 candidate in
// top-two / redraw contests and still drives the member-page LINK. Falls back to
// the `incumbent` flag where seatBio is unresolved (≤1 there).
function isSeatIncumbent(c: PrimaryCandidate, seatBio: string | null): boolean {
  return seatBio ? c.bioguide_id === seatBio : c.incumbent;
}

// Un-voted ordering: lead with the seat incumbent, then other sitting members,
// then alphabetical.
function orderedByIncumbent(
  cands: PrimaryCandidate[],
  seatBio: string | null,
): PrimaryCandidate[] {
  return [...cands].sort(
    (a, b) =>
      Number(isSeatIncumbent(b, seatBio)) -
        Number(isSeatIncumbent(a, seatBio)) ||
      Number(b.incumbent) - Number(a.incumbent) ||
      a.name.localeCompare(b.name),
  );
}

export function PrimaryRow({ p }: { p: PrimaryWithCandidates }) {
  const { openId, toggle } = useContext(PrimaryExpandContext);
  const open = openId === p.id;
  const chip = partyChip(p.party);
  const special =
    p.primary_type && p.primary_type !== "open" && p.primary_type !== "closed"
      ? p.primary_type.replace(/_/g, " ")
      : null;

  const seatBio = p.seat_incumbent_bioguide;
  const hasField = p.candidates.length > 0;
  const hasResults = p.candidates.some((c) => c.vote_pct != null);

  // Collapsed field list (un-voted fallback): incumbent-first.
  const listCands = orderedByIncumbent(p.candidates, seatBio);
  const shown = listCands.slice(0, FIELD_CAP);
  const more = listCands.length - shown.length;

  // Expand: results order when voted, incumbent order otherwise.
  const expandCands = hasResults
    ? orderedByShare(p.candidates)
    : listCands;

  return (
    <div style={{ borderBottom: "0.5px solid var(--border-soft)" }}>
      <div
        role={hasField ? "button" : undefined}
        tabIndex={hasField ? 0 : undefined}
        aria-expanded={hasField ? open : undefined}
        onClick={hasField ? () => toggle(p.id) : undefined}
        onKeyDown={
          hasField
            ? (e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  toggle(p.id);
                }
              }
            : undefined
        }
        className="flex items-center gap-3 px-3 py-1.5"
        style={{ cursor: hasField ? "pointer" : "default" }}
      >
        {/* SEAT + PARTY */}
        <span className="flex shrink-0 items-center gap-2">
          <span
            className="inline-block shrink-0 text-[11px] uppercase tracking-[0.5px]"
            style={{ color: chip.color, width: "38px" }}
          >
            {chip.label}
          </span>
          <span
            className="shrink-0 text-[13px]"
            style={{ color: "var(--text-primary)" }}
          >
            {stateName(p.state)}
          </span>
          {special ? (
            <span
              className="shrink-0 text-[11px] uppercase tracking-[0.5px]"
              style={{ color: "var(--text-dim)" }}
            >
              {special}
            </span>
          ) : null}
        </span>

        {/* FIELD: results bar (voted) / field list (un-voted) / roster pending */}
        <span className="flex min-w-0 flex-1 items-center">
          {hasResults ? (
            <ShareBar cands={p.candidates} tint={chip.color} />
          ) : hasField ? (
            <span
              className="truncate text-[12px]"
              style={{ color: "var(--text-muted)" }}
            >
              {shown.map((c, i) => (
                <span key={c.id}>
                  {i > 0 ? " · " : ""}
                  <span
                    style={
                      isSeatIncumbent(c, seatBio)
                        ? { color: "var(--accent-amber)" }
                        : undefined
                    }
                  >
                    {lastName(c.name)}
                  </span>
                </span>
              ))}
              {more > 0 ? (
                <span style={{ color: "var(--text-dim)" }}>
                  {" · "}+{more} other{more === 1 ? "" : "s"}
                </span>
              ) : null}
              <span style={{ color: "var(--text-dim)" }}> — not yet voted</span>
            </span>
          ) : (
            <span className="text-[12px]" style={{ color: "var(--text-dim)" }}>
              roster pending
            </span>
          )}
        </span>

        {/* PRIMARY meta: runoff link + chevron (the date lives on the group header) */}
        <span
          className="flex shrink-0 items-center gap-3 text-[12px] tabular-nums"
          style={{ color: "var(--text-muted)" }}
        >
          {p.runoff_date ? (
            <span style={{ color: "var(--text-dim)" }}>
              runoff {formatDateShort(p.runoff_date)}
            </span>
          ) : null}
          {hasField ? (
            <span
              aria-hidden
              style={{ color: open ? "var(--accent-amber)" : "var(--text-dim)" }}
            >
              {open ? "▾" : "▸"}
            </span>
          ) : null}
        </span>
      </div>

      {open && hasField ? (
        <div
          className="px-3 pb-2 pl-[52px]"
          style={{ backgroundColor: "var(--bg-row-hover)" }}
        >
          <ul className="flex flex-col gap-1 py-1">
            {expandCands.map((c) => (
              <li key={c.id} className="flex items-baseline gap-2 text-[13px]">
                {c.vote_pct != null ? (
                  <span
                    className="w-[44px] shrink-0 text-right text-[12px] tabular-nums"
                    style={{ color: "var(--text-secondary)" }}
                  >
                    {c.vote_pct.toFixed(1)}%
                  </span>
                ) : null}
                {isAdvancer(c) ? (
                  <span
                    className="shrink-0 text-[11px]"
                    style={{ color: "var(--accent-amber)" }}
                    title="Won / advanced"
                  >
                    ★
                  </span>
                ) : null}
                {isSeatIncumbent(c, seatBio) ? (
                  <span
                    className="shrink-0 text-[10px] uppercase tracking-[0.5px]"
                    style={{
                      color: "var(--text-muted)",
                      border: "1px solid var(--border-strong)",
                      borderRadius: "2px",
                      padding: "0 3px",
                    }}
                    title="Incumbent for this seat"
                  >
                    inc
                  </span>
                ) : null}
                {c.bioguide_id ? (
                  <Link
                    href={`/members/${c.bioguide_id}`}
                    className="transition hover:text-[var(--accent-amber-bright)]"
                    style={{ color: "var(--text-primary)" }}
                  >
                    {c.name}
                  </Link>
                ) : (
                  <span style={{ color: "var(--text-primary)" }}>{c.name}</span>
                )}
                <span className="text-[11px]" style={{ color: "var(--text-dim)" }}>
                  {c.party}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
