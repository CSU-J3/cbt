"use client";

// HO 203 — Primaries row. Upgrades the bare "N candidates" count to a
// candidate-field list (top-3 + "+N others", incumbent flagged) and a
// click-to-expand full field (HO 148 idiom). NO share bar / no poll-share —
// there is no polling data model and `vote_pct` (results) is 100% NULL across
// the corpus, so a bar would be rendered against empty data; "never fake an
// even-split bar" forces no bar (HO 203 Phase 1). Client-side expand (not
// URL-driven) because past primaries live inside a native <details> that a
// navigation re-render would collapse.
import {
  createContext,
  type ReactNode,
  useContext,
  useState,
} from "react";
import Link from "next/link";
import { formatDateShort } from "@/lib/format";
import type { PrimaryCandidate, PrimaryWithCandidates } from "@/lib/queries";
import { stateName } from "@/lib/states";

const FIELD_CAP = 3;

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
  const toggle = (id: string) =>
    setOpenId((cur) => (cur === id ? null : id));
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

// ★ = the actual seat incumbent (the candidate whose bioguide matches the
// seat's current officeholder, `seatBio`). This is distinct from the per-
// candidate `incumbent` flag ("is a sitting member of Congress"), which is true
// for >1 candidate in top-two / redraw contests (CA-40 Calvert+Kim, TX-18
// Menefee+Green) and still drives the member-page LINK. Falls back to the
// `incumbent` flag only when seatBio is unresolved (at-large/senate/open) —
// where it's ≤1 anyway, so no multi-star.
function isSeatIncumbent(c: PrimaryCandidate, seatBio: string | null): boolean {
  return seatBio ? c.bioguide_id === seatBio : c.incumbent;
}

// Lead with the seat incumbent, then other sitting members, then alphabetical.
function ordered(
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

function lastName(name: string): string {
  const parts = name.trim().split(/\s+/);
  return parts[parts.length - 1] ?? name;
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
  const cands = ordered(p.candidates, seatBio);
  const shown = cands.slice(0, FIELD_CAP);
  const more = cands.length - shown.length;
  const hasField = cands.length > 0;

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
        className="flex items-baseline justify-between gap-3 px-3 py-1.5"
        style={{ cursor: hasField ? "pointer" : "default" }}
      >
        <span className="flex min-w-0 items-baseline gap-2">
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
          {hasField ? (
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
                    {isSeatIncumbent(c, seatBio) ? "★ " : ""}
                    {lastName(c.name)}
                  </span>
                </span>
              ))}
              {more > 0 ? (
                <span style={{ color: "var(--text-dim)" }}>
                  {" · "}+{more} other{more === 1 ? "" : "s"}
                </span>
              ) : null}
            </span>
          ) : (
            <span className="text-[12px]" style={{ color: "var(--text-dim)" }}>
              roster pending
            </span>
          )}
        </span>
        <span
          className="flex shrink-0 items-baseline gap-3 text-[12px] tabular-nums"
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
            {cands.map((c) => (
              <li key={c.id} className="flex items-baseline gap-2 text-[13px]">
                {isSeatIncumbent(c, seatBio) ? (
                  <span
                    className="shrink-0 text-[10px] uppercase tracking-[0.5px]"
                    style={{ color: "var(--accent-amber)" }}
                  >
                    ★ inc
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
                {c.status && c.status !== "running" ? (
                  <span
                    className="text-[11px] uppercase tracking-[0.5px]"
                    style={{ color: "var(--text-dim)" }}
                  >
                    {c.status.replace(/_/g, " ")}
                  </span>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
