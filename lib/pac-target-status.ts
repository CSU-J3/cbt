// HO 691 — is a PAC independent-expenditure target still IN the race?
//
// A pac_ie_spending row is a fact about a filing: "UDP spent supporting X" /
// "…opposing Y". It is true forever. What ages is the TENSE the card renders it
// in: `backing Stevens` was a claim about the Michigan Democratic primary, and
// once that primary was decided against her it reads as a present-tense claim
// about the general that is simply false. The dashboard renders the current
// state of the race (Corey, 2026-09-03); history lives on the races surface.
// This module is the one place that decides which of those a target is.
//
// LEAF MODULE ON PURPOSE — no next/cache, no DB, no React — so the query layer,
// the render, and scripts/diagnostic/* all import ONE implementation. A second
// copy of this ladder is exactly the drift the shared-matcher rule exists to
// prevent (lib/amendment-vote-key.ts precedent).
//
// ── THE EVIDENCE, AND THE TWO THINGS THE HANDOFF GOT WRONG ────────────────────
//
// `primary_candidates.status` has NO `loser` value. Measured corpus-wide at
// HO 691: `running` 1,732 / `winner` 804, exactly as scripts/migrate.ts's
// comment says. `backfill:primary-results` writes `winner` on advancers and
// leaves everyone else `running`, so a candidate who lost a primary is a
// `running` row carrying a `vote_pct`. Any classifier that looks for `loser`
// matches zero rows, calls every stale target `unknown`, and — because `unknown`
// renders as today — ships without changing anything.
//
// So LOST is DERIVED: the contest is past-dated, results are posted, and the
// target is present in it and is not its winner. That is self-limiting by
// construction — it can only fire where the source actually published shares,
// so a mid-count or never-scraped contest stays silent rather than declaring
// somebody out.
//
// And there is no "a running incumbent is active" shortcut. Thomas Massie is the
// KY-04 incumbent, carries status `running`, and LOST the 2026-05-19 Republican
// primary 45.1% to Ed Gallrein's 54.9%. An incumbent who loses a primary is out
// of the race; the rule that would have kept his line present-tense is deleted
// rather than narrowed.
//
// ── THE ROUND DIMENSION (architect ruling, 2026-09-04) ────────────────────────
//
// A `winner` in a PRIMARY round that was followed by a RUNOFF means *advanced*,
// not *nominated*. So rungs 1 and 2 evaluate the target against their LATEST
// resulted contest for the seat, runoff over primary.
//
// The live set has no runoff contest ROW at all — measured HO 691, the corpus
// holds 3 runoff rows total (the LA + GA hand-seeds) and zero for Texas. But
// TX-23's round-1 rows carry `runoff_date = 2026-05-26`, which is the forward
// link the schema documents. So the seat KNOWS a later round happened and we
// have no result for it. That is the case rung 1b exists for: a primary winner
// whose seat has a past-dated `runoff_date` and no resulted runoff row is
// `unknown`, not `active` — we know he advanced and we do not know what
// happened next, and the honest rendering of that is the present tense we were
// already showing.
//
// ── WHY THE CONTEST BEATS THE ROSTER, AND IT IS NOT A STYLE CALL ─────────────
//
// `race_candidates` sentinel rows (`source_url='harvest:primary_winner'`) are
// DERIVED FROM `primary_candidates.status='winner'` by the HO 660 harvest, so
// they carry the same blind spot: TX-23's roster says Herrera `won_primary`
// because the primary round says `winner`. Consulting the roster first would let
// a copy overrule the source it was copied from and silently undo rung 1b. So
// contest evidence is authoritative WHERE IT EXISTS, and the roster is consulted
// only when the target has no contest rows at all — where it is genuinely
// additive, because a CURATED `nominee` (the convention route, HO 638) can never
// come from the harvest.
import { pacSurname } from "@/lib/pac-ie";
import { nameKey } from "@/lib/race-colors";

export type TargetStatus = "active" | "lost" | "withdrew" | "unknown";

// One primary_candidates row joined to its contest. `round` is
// primaries.election_round; `runoffDate` is the round-1 forward link.
export type ContestRow = {
  primaryId: string;
  primaryDate: string | null;
  runoffDate: string | null;
  round: string;
  name: string;
  status: string | null;
  votePct: number | null;
};

export type RosterRow = { name: string; status: string | null };

// Mirrors lib/race-matchup.ts's NOMINATED. Kept as its own constant rather than
// imported because that module pulls the whole matchup/market surface in; the
// two sets must move together if a status is ever added (the same standing
// obligation the getRaceCandidates ORDER BY ladder carries).
const ROSTER_NOMINATED = new Set(["won_primary", "nominee"]);
const ROSTER_WITHDRAWN = new Set(["withdrew", "withdrawn"]);

// FEC `candidate_name` is "LAST, FIRST …"; roster and primary names are
// "First Last". So the two sides need DIFFERENT surname extractors — pacSurname
// takes the part before the comma, nameKey takes the last token — and running
// either one over both sides is silently wrong ("STEVENS, HALEY" → "Haley").
// Diacritics are folded for the COMPARISON only; hyphens are kept, because they
// are part of the name (CONYEARS-ERVIN matches Conyears-Ervin).
function fold(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}
export const fecTargetKey = (fecName: string) => fold(pacSurname(fecName));
export const rosterKey = (name: string) => fold(nameKey(name));

// Latest first: by contest date desc, then runoff ahead of primary on a tie.
function roundRank(round: string): number {
  return round === "runoff" ? 1 : 0;
}

export type Classification = { status: TargetStatus; why: string };

export function classifyTarget(
  fecCandidateName: string,
  seatContests: ContestRow[],
  seatRoster: RosterRow[],
  today: string,
): Classification {
  const key = fecTargetKey(fecCandidateName);
  const mine = seatContests.filter((c) => rosterKey(c.name) === key);
  const rosterMatches = seatRoster.filter((r) => rosterKey(r.name) === key);

  if (mine.length > 0) {
    // The target's own latest appearance.
    const latest = [...mine].sort((a, b) => {
      const d = (b.primaryDate ?? "").localeCompare(a.primaryDate ?? "");
      return d !== 0 ? d : roundRank(b.round) - roundRank(a.round);
    })[0]!;
    const siblings = seatContests.filter((c) => c.primaryId === latest.primaryId);
    const past = !!latest.primaryDate && latest.primaryDate < today;
    const resulted = siblings.some((c) => c.votePct != null);

    if (!past || !resulted) {
      return {
        status: "unknown",
        why: `latest contest ${latest.primaryId} not resulted (past=${past}, resultsPosted=${resulted})`,
      };
    }
    if (latest.status === "winner") {
      // Rung 1b — advanced, outcome unrecorded.
      const runoffPast = !!latest.runoffDate && latest.runoffDate < today;
      const haveRunoff = seatContests.some(
        (c) => c.round === "runoff" && c.votePct != null,
      );
      if (latest.round !== "runoff" && runoffPast && !haveRunoff) {
        return {
          status: "unknown",
          why: `winner in ${latest.primaryId} but that contest names a runoff on ${latest.runoffDate} with no resulted row — advanced, outcome unrecorded`,
        };
      }
      return { status: "active", why: `winner in ${latest.primaryId}` };
    }
    return {
      status: "lost",
      why: `${latest.primaryId} resulted ${latest.primaryDate}, target present at ${latest.votePct ?? "—"}% and not its winner`,
    };
  }

  // No contest evidence — the roster is additive here, not a copy.
  const nominated = rosterMatches.find((r) =>
    ROSTER_NOMINATED.has(r.status ?? ""),
  );
  if (nominated)
    return {
      status: "active",
      why: `race_candidates status=${nominated.status} (no contest row)`,
    };
  const withdrew = rosterMatches.find((r) => ROSTER_WITHDRAWN.has(r.status ?? ""));
  if (withdrew) return { status: "withdrew", why: "race_candidates status=withdrew" };

  return {
    status: "unknown",
    why: `no contest row and no roster row for "${fecCandidateName}"`,
  };
}
