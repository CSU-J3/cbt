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
// already showing. HO 761 ingests the runoff rounds Ballotpedia prints (33 on
// HO 747's saved pages, Texas's among them), so the corpus now holds resulted
// runoff rows; TX-23's R runoff prints no box, so TX-23 is still this case for
// the contest. Since HO 765 rung 0 reads the ballot first, and Herrera is
// printed on it, so he reads `active`; rung 1b holds only where the ballot does
// not name the target.
//
// ── THE BALLOT BEATS THE CONTEST, THE CONTEST BEATS THE ROSTER (HO 765) ──────
//
// A PAC target's status asks one question: is this person running in November?
// Three sources answer it, and each rung answers only what its source knows.
//
// Rung 0, THE BALLOT, where the race has a `box` read (general_ballot_reads,
// HO 749), matched on the target's surname and first name (firstAgrees, below):
// a row of the box's results table (`on_ballot = 1`, not a write-in) is
// `active`, printed on the November ballot; a row only in the box's withdrawn
// block (`withdrawn = 1`, `on_ballot = 0`) is `withdrew`. The ballot is the
// authority on November, so it outranks a contest that cannot see what happened
// after it: a nominee who withdrew after winning (the contest still says
// `winner`), a replacement nominee with no primary row, and a first-round
// advancer whose runoff the page never printed (TX-23's Herrera, rung 1b's case,
// printed on the ballot, so he is `active`). A target the ballot never names
// falls through: a lost primary or runoff still reads `lost` from the contest,
// and a race with no `box` read (Louisiana's jungle seats, a `no_box` page)
// reads exactly as before. After election day the rung still reads `active`
// for a printed row, marked or not: what a decided race does to a PAC target is
// not this rung's question, and its `why` says where the race stands by the
// box's marks: not yet called, decided, or a runoff.
//
// Rung 1, THE CONTEST, for a target the ballot does not settle. `race_candidates`
// sentinel rows (`source_url='harvest:primary_winner'`) are DERIVED FROM
// `primary_candidates.status='winner'` by the HO 660 harvest, so they carry the
// contest's blind spot: TX-23's roster said Herrera `won_primary` because the
// primary round says `winner`. Consulting such a roster first would let a copy
// overrule the source it was copied from and silently undo rung 1b. So the
// contest outranks the roster. Since HO 750 a race with a `box` read publishes
// the ballot as its roster (`harvest:general_ballot`), not a copy of the
// contest, but rung 0 now reads that ballot directly, so the roster rung keeps
// its one job.
//
// Rung 2, THE ROSTER, only when the target has no contest row at all: there it
// is genuinely additive, because a CURATED `nominee` (the convention route,
// HO 638) can never come from the harvest. HO 750 deferred this order to the
// backlog ("lib/pac-target-status.ts consults primary contest evidence before a
// roster that is now ballot-sourced…"); HO 765 settles it with rung 0.
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

// HO 765 — one general_ballot row of the race (HO 749/758), as rung 0 reads it.
export type BallotRow = {
  name: string;
  onBallot: boolean;
  withdrawn: boolean;
  writeIn: boolean;
  marked: boolean;
};

// Mirrors lib/race-matchup.ts's NOMINATED. Kept as its own constant rather than
// imported because that module pulls the whole matchup/market surface in; the
// two sets must move together if a status is ever added (the same standing
// obligation the getRaceCandidates ORDER BY ladder carries). THREE copies now,
// not two: this one, race-matchup.ts:NOMINATED, and the SQL ladders in
// lib/queries.ts — HO 736 added 'advanced' to all of them in one commit. (HO
// 757: three SQL ladders since getRaceRoster; its rung 0 is the same set.)
// 'advanced' belongs here for the reason the other two do: an advancer is on
// the November ballot, so a PAC target who advanced is still in the race.
// HO 757: `on_ballot` is deliberately NOT here (on the ballot, not nominated),
// and the roster read that feeds this file excludes it in SQL
// (getPacIeSpending's race_candidates read).
const ROSTER_NOMINATED = new Set(["won_primary", "nominee", "advanced"]);
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

// HO 765 — rung 0's first-name check, beyond the handoff's surname key (its
// review found the gap): an FEC name's first token after the comma ("STEVENS,
// HALEY" → "haley"; an honorific after it, "GOMEZ, JIMMY REP.", is ignored) and
// a ballot name's first token must agree, whole or as a prefix of three letters
// or more either way (HO 751's rule in lib/ballot-incumbent.ts tokenCheck). So
// an independent "Joe Stevens" printed on S-MI's ballot cannot read a target who
// lost the D primary as `active`. A disagreement only declines rung 0: the
// contest and roster rungs read as before. All 8 printed targets of the live
// set agree at HO 765's STEP 0.
const firstToken = (s: string) => fold(s.trim().split(/\s+/)[0] ?? "").replace(/[^a-z-]/g, "");
const fecFirstName = (fecName: string) => firstToken(fecName.split(",")[1] ?? "");
const ballotFirstName = (name: string) => firstToken(name);
function firstAgrees(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && long.startsWith(short);
}

// Latest first: by contest date desc, then runoff ahead of primary on a tie.
function roundRank(round: string): number {
  return round === "runoff" ? 1 : 0;
}

export type Classification = { status: TargetStatus; why: string };

// `seatBallot` is the race's general_ballot rows when the race has a `box` read,
// and null when it has none (no read, `no_box`, `ambiguous`): rung 0 runs only
// on a box. `electionDate` (YYYY-MM-DD, lib/format.ts electionDay) lets rung 0's
// `why` say the race is decided once `today` is past it; the caller reads
// `today` from lib/clock.ts clockNowMs (HO 758), the one now election-day logic
// reads.
export function classifyTarget(
  fecCandidateName: string,
  seatContests: ContestRow[],
  seatRoster: RosterRow[],
  today: string,
  seatBallot: BallotRow[] | null = null,
  electionDate: string | null = null,
): Classification {
  const key = fecTargetKey(fecCandidateName);
  const mine = seatContests.filter((c) => rosterKey(c.name) === key);
  const rosterMatches = seatRoster.filter((r) => rosterKey(r.name) === key);

  // Rung 0 — the ballot, where the race has a box read. A row speaks for the
  // target only when its first name agrees too (firstAgrees, below), so a
  // namesake printed on the ballot cannot (HO 765's review).
  if (seatBallot) {
    const first = fecFirstName(fecCandidateName);
    const named = seatBallot.filter((b) => rosterKey(b.name) === key && firstAgrees(first, ballotFirstName(b.name)));
    const printed = named.find((b) => b.onBallot && !b.writeIn);
    if (printed) {
      // Past election day the status stays `active` (what a decided race does to
      // a PAC target is not this rung's question); the `why` says where the race
      // stands, from the box's marks: none (not yet called), one (decided), two
      // (a runoff's advancers).
      const past = !!electionDate && today > electionDate;
      const marks = seatBallot.filter((b) => b.marked).length;
      const mine = printed.marked ? "marked" : "not marked";
      return {
        status: "active",
        why: !past
          ? "printed on the November ballot"
          : marks === 0
            ? "printed on the November ballot; election day has passed and the race is not yet called"
            : marks === 1
              ? `printed on the November ballot; the race is decided (${mine})`
              : `printed on the November ballot; the race goes to a runoff (${mine})`,
      };
    }
    if (named.some((b) => b.withdrawn && !b.onBallot)) {
      return { status: "withdrew", why: "in the ballot's withdrawn block" };
    }
  }

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
