"use client";

// HO 210 Pass 2: the RACES pinned-state card body — a Senate-first
// click-to-expand accordion (single-open, HO 148 idiom). BASIC + null-safe:
// every rated race has a resolved incumbent + photo (verified 137/137), so the
// collapsed row always populates. race_candidates is empty for 133/137 races,
// so the expanded view shows the incumbent + a challenger PLACEHOLDER until the
// rich-card HO lands a real challenger feed. No 2024-margin column exists yet, so
// the margin bar is intentionally absent (insertion point below).

import Link from "next/link";
import { useState } from "react";
import type { CartogramChallenger, CartogramContest } from "@/lib/cartogram-data";
import type { PartyKey } from "@/lib/queries";

function partyColor(p: PartyKey | null | undefined): string {
  if (p === "R") return "var(--party-republican)";
  if (p === "D") return "var(--party-democrat)";
  if (p === "I") return "var(--party-independent)";
  return "var(--text-dim)";
}

// Same palette as the /races list ratingColor (Toss Up amber; partisan by lean).
function ratingColor(rating: string | null | undefined): string {
  if (!rating) return "var(--text-dim)";
  if (rating === "Toss Up") return "var(--accent-amber-bright)";
  if (rating.endsWith(" D")) return "var(--party-democrat)";
  if (rating.endsWith(" R")) return "var(--party-republican)";
  return "var(--text-muted)";
}

function initials(name: string): string {
  const parts = name.split(/[\s,]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function Face({
  url,
  name,
  party,
}: {
  url: string | null | undefined;
  name: string;
  party: PartyKey | null | undefined;
}) {
  const [err, setErr] = useState(false);
  if (url && !err) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      <img
        src={url}
        alt={name}
        className="racecard-face"
        onError={() => setErr(true)}
      />
    );
  }
  return (
    <span
      className="racecard-face racecard-face--initials"
      style={{ color: partyColor(party) }}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

function ChallengerRow({ c }: { c: CartogramChallenger }) {
  const dim = c.status === "withdrew";
  return (
    <div className="racecard-cand" style={dim ? { opacity: 0.5 } : undefined}>
      <span
        className="racecard-cand-dot"
        style={{ background: partyColor(c.party) }}
        aria-hidden
      />
      {c.bioguideId ? (
        <Link href={`/members/${c.bioguideId}`} className="racecard-cand-name">
          {c.name}
        </Link>
      ) : (
        <span className="racecard-cand-name" style={{ color: "var(--text-primary)" }}>
          {c.name}
        </span>
      )}
      <span className="racecard-cand-meta" style={{ color: "var(--text-dim)" }}>
        {c.party ?? "?"}
        {c.status && c.status !== "running" ? ` · ${c.status.replace(/_/g, " ")}` : ""}
      </span>
    </div>
  );
}

function RaceCardRow({
  contest,
  open,
  onToggle,
}: {
  contest: CartogramContest;
  open: boolean;
  onToggle: () => void;
}) {
  const incName = contest.incumbent?.name ?? "Open seat";
  const challengers = contest.challengers ?? [];

  return (
    <li className="racecard-row">
      <div
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={onToggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onToggle();
          }
        }}
        className="racecard-head"
      >
        <span
          className="racecard-chevron"
          aria-hidden
          style={{ color: open ? "var(--accent-amber)" : "var(--text-dim)" }}
        >
          {open ? "▾" : "▸"}
        </span>
        <Face
          url={contest.incumbentDepictionUrl}
          name={incName}
          party={contest.party}
        />
        <span className="racecard-seat">
          <span style={{ color: partyColor(contest.party) }}>
            [{contest.party ?? "?"}]
          </span>{" "}
          {contest.label}
        </span>
        <span className="racecard-name">{incName}</span>
        <span
          className="racecard-rating"
          style={{ color: ratingColor(contest.rating) }}
        >
          {contest.rating ?? "—"}
        </span>
      </div>

      {open ? (
        <div className="racecard-expand">
          {/* Incumbent (always present for rated races) */}
          <div className="racecard-cand">
            <Face
              url={contest.incumbentDepictionUrl}
              name={incName}
              party={contest.party}
            />
            {contest.incumbent?.bioguideId ? (
              <Link
                href={`/members/${contest.incumbent.bioguideId}`}
                className="racecard-cand-name"
              >
                {incName}
              </Link>
            ) : (
              <span
                className="racecard-cand-name"
                style={{ color: "var(--text-primary)" }}
              >
                {incName}
              </span>
            )}
            <span
              className="racecard-cand-meta"
              style={{ color: partyColor(contest.party) }}
            >
              {contest.party ?? "?"} · incumbent
            </span>
          </div>

          {/* Challengers, or the honest null-safe placeholder (133/137 today) */}
          {challengers.length > 0 ? (
            challengers.map((c) => <ChallengerRow key={c.name} c={c} />)
          ) : (
            <div className="racecard-placeholder">
              Challenger field not yet available
            </div>
          )}

          {/* margin bar omitted — no 2024-margin data yet (rich-card HO).
              Rich-card insertion points: ●N news flag · Kalshi · cash ·
              rater spread · trend sparkline · per-race news. */}

          {contest.href ? (
            <Link href={contest.href} className="racecard-hublink">
              Race hub →
            </Link>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function RaceMapCard({ contests }: { contests: CartogramContest[] }) {
  // Single-open within the card. Contests arrive Senate-first from the builder.
  const [openLabel, setOpenLabel] = useState<string | null>(null);
  if (contests.length === 0) {
    return (
      <div className="racecard-placeholder">No competitive races in this state.</div>
    );
  }
  return (
    <ul className="racecard-list">
      {contests.map((c) => (
        <RaceCardRow
          key={c.label}
          contest={c}
          open={openLabel === c.label}
          onToggle={() =>
            setOpenLabel((cur) => (cur === c.label ? null : c.label))
          }
        />
      ))}
    </ul>
  );
}
