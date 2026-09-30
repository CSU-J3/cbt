"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import type { IncumbentQualifier } from "@/lib/incumbent-qualifier";
import { REASON_TAG, seatOf } from "@/lib/incumbent-tag";

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
// link's Enter with its own key handler (HO 759's review).
export function IncumbentTag({ q, link = true }: { q: IncumbentQualifier; link?: boolean }) {
  const reason = q.kind === "none" && q.reason !== "absent";
  const key = q.kind === "none" ? q.reason : q.kind;
  let body: ReactNode;
  let title: string;
  if (q.kind === "moved" || q.kind === "senate") {
    const lead = q.kind === "moved" ? "RUNNING IN" : "RUNNING FOR";
    const target = q.kind === "moved" ? seatOf(q.raceId) : "SENATE";
    title = `Printed on the ${seatOf(q.raceId)} ballot, not this seat's (Ballotpedia)`;
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
      </>
    );
  } else {
    body = REASON_TAG[q.reason].text;
    title = REASON_TAG[q.reason].title;
  }
  return (
    <span className="so-qual" data-incumbent-tag={key}>
      <span className={reason ? "so-tag so-tag--open" : "micro-tag"} title={title}>
        {body}
      </span>
    </span>
  );
}
