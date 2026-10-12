"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { IncumbentQualifier } from "@/lib/incumbent-qualifier";
import { REASON_TAG, seatOf, tagWords } from "@/lib/incumbent-tag";

// HO 759 (ruled C on docs/design/mock-moved-incumbent.html) — the tag beside a
// stored incumbent the race's ballot doesn't carry (lib/incumbent-qualifier.ts
// decides which, lib/incumbent-tag.ts holds the words). The house qualifier
// family, the 2028 outlook's (components/SeatOutlookList.tsx), not a new
// recipe: a reason is the NOT RUNNING tag's `.so-tag--open` (amber, solid
// border), a kind is the MicroTag's `.micro-tag` (dim, --border-strong), and
// both sit in `.so-qual`. RUNNING IN <seat> and RUNNING FOR SENATE link the race
// they are printed in, except where the tag sits inside a whole-card link
// (RaceCard), which passes link={false}: an anchor inside an anchor is invalid
// markup. The link stops its click and its keydown, so a clickable row
// (RaceListView, RaceMapCard) neither toggles on the click nor cancels the
// link's Enter with its own key handler (HO 759's review). HO 779: past election
// day a kind says how its own race went (lib/incumbent-tag.ts tagWords), and
// `data-incumbent-outcome` names it; the words arrive with the clock applied.
export function IncumbentTag({ q, link = true }: { q: IncumbentQualifier; link?: boolean }) {
  const reason = q.kind === "none" && q.reason !== "absent";
  const key = q.kind === "none" ? q.reason : q.kind;
  let body: ReactNode;
  let title: string;
  let outcome: string | undefined;
  if (q.kind === "moved" || q.kind === "senate") {
    const { lead, target, tail } = tagWords(q);
    outcome = q.outcome;
    title = q.outcome
      ? `Printed on the ${seatOf(q.raceId)} ballot, not this seat's; its result as Ballotpedia marks it`
      : `Printed on the ${seatOf(q.raceId)} ballot, not this seat's (Ballotpedia)`;
    body = (
      <>
        {lead}{" "}
        {link ? (
          <Link
            href={`/race/${q.raceId}`}
            className="transition hover:text-[var(--accent-amber-bright)]"
            style={{ color: "var(--accent-amber)" }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
          >
            {target}
          </Link>
        ) : (
          target
        )}
        {tail ? (
          <>
            {" "}
            {tail}
          </>
        ) : null}
      </>
    );
  } else if (q.kind === "governor") {
    // HO 779: a kind, so the kinds' dim style; unlinked (CBT reads no governor race).
    body = tagWords(q).lead;
    outcome = q.ran ? "ran" : undefined;
    title = `Curated: on the ${q.state} governor ballot, Nov 3${q.ran ? "; CBT reads no governor race's result" : ""}`;
  } else {
    body = REASON_TAG[q.reason].text;
    title = REASON_TAG[q.reason].title;
  }
  return (
    <span className="so-qual" data-incumbent-tag={key} data-incumbent-outcome={outcome}>
      <span className={reason ? "so-tag so-tag--open" : "micro-tag"} title={title}>
        {body}
      </span>
    </span>
  );
}
