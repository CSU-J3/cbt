// HO 768 — the MOVED guard. Pure: no DB, no Next; lib/electoral-general.ts's
// readRecentRaceMoves reads the rows and asks this file which moves count.
//
// rating_history logs a move on the day the daily tick (/api/cron/rating-history,
// `0 15 * * *`) first sees it, and the ratings sync (/api/sync-race-ratings,
// `0 11 * * 3`) is what changes the ratings. So after a gap in either, the first
// run back logs every change the gap held as if it happened that day: the House
// run of 2026-09-20 23:35Z came 18.5 days after the last House leg that read
// rows, and 47 rated races' newest move was logged on 09-21 (HO 768 STEP 0). A move
// counts only when the runs behind it read as an ordinary week. For a move
// logged on day T (UTC, as observed_at is) in chamber C:
//   P  — the latest rating-history run with status `success` started before
//        day T. The move is fresh only if P started within MOVE_FRESH_DAYS
//        before T, so T's log is not a catch-up after a history gap.
//   S  — the EARLIEST ratings run with C's leg ok started after P and before
//        the end of day T. P's tick would have logged any change written
//        before it, so S is the first reading that could carry the move. (The
//        latest such run would let a re-run vouch for a catch-up: the 09-21
//        batch's two runs, #18881 and #18897, started 67 minutes apart.)
//   S' — the latest leg-ok run started before S. The move is fresh only if S
//        and S' both exist and S − S' ≤ MOVE_FRESH_DAYS: a weekly cadence plus a
//        day, so a missed week (14 days) reads not fresh.
// A leg is ok on a `success` run whose payload has chambers.<C>.ok true and
// chambers.<C>.stats.scraped > 0 (HO 744 on), or, for the House on an earlier
// run, stats.scraped > 0. The column holds wrapCronRoute's response body
// (lib/cron-log.ts), so the handler's payload sits one level down.
// A run that isn't `success` counts for neither leg. The sync throws when
// either leg fails, after both have run, so its row reads `error` though the
// other leg wrote: one leg's failure can hide the other's moves for a week.
// That is the conservative side, and it is chosen.
// A move logged on a day before either route's first cron_runs row passes:
// the guard has nothing to read there.
// HO 770: with one reader per rater, a chamber leg that read no longer says a
// given rater was read, so once Cook or Inside Elections is wired after weeks
// away, Sabato's weekly legs would vouch for its catch-up. A run therefore
// counts for a move only if it read the move's own rater, its leg's
// stats.raters.<source> ok with rows scraped. A run from before HO 770, whose
// one table carried all three raters, counts for each of them on its chamber
// reading.

export const MOVE_FRESH_DAYS = 8;

const DAY_MS = 86_400_000;

export type MoveChamber = "house" | "senate";

// A /api/sync-race-ratings row of cron_runs, the payload column as stored.
export type SyncRunRow = { startedAt: string; status: string; payload: string | null };

// A /api/cron/rating-history row of cron_runs. Only `success` rows count.
export type HistoryRunRow = { startedAt: string; status: string };

// Each route's first cron_runs started_at; null when the route has none.
export type GuardHorizons = { sync: string | null; history: string | null };

type RaterLeg = { ok?: unknown; scraped?: unknown };
type Leg = {
  ok?: unknown;
  stats?: { scraped?: unknown; raters?: Partial<Record<string, RaterLeg | null>> | null } | null;
};

// Did this ratings run read the chamber: a `success` row whose leg scraped rows.
// HO 770: with `source`, did it read that rater in the chamber. A leg carrying
// stats.raters answers for each rater on its own; a leg without it predates
// HO 770 and answers for every rater on the chamber reading, as does the
// pre-HO 744 House shape. Without `source`, the chamber reading.
export function syncLegOk(run: SyncRunRow, chamber: MoveChamber, source?: string): boolean {
  if (run.status !== "success" || run.payload == null) return false;
  let body: unknown;
  try {
    body = JSON.parse(run.payload);
  } catch {
    return false;
  }
  const p = (body as { payload?: unknown } | null)?.payload as
    | { chambers?: Partial<Record<MoveChamber, Leg | null>> | null; stats?: { scraped?: unknown } | null }
    | null
    | undefined;
  if (!p || typeof p !== "object") return false;
  if (p.chambers) {
    const leg = p.chambers[chamber];
    const raters = leg?.stats?.raters;
    if (source !== undefined && raters) {
      const r = raters[source];
      return leg?.ok === true && r?.ok === true && Number(r.scraped ?? 0) > 0;
    }
    return leg?.ok === true && Number(leg.stats?.scraped ?? 0) > 0;
  }
  return chamber === "house" && Number(p.stats?.scraped ?? 0) > 0;
}

// The rule above, for one move: `observedAt` is rating_history's day, and
// `source` (HO 770) the move's rater, so S and S' are runs that read it.
export function isFreshMove(
  observedAt: string,
  chamber: MoveChamber,
  syncRuns: readonly SyncRunRow[],
  historyRuns: readonly HistoryRunRow[],
  horizons: GuardHorizons,
  source?: string,
): boolean {
  const t0 = Date.parse(`${observedAt.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(t0)) return false;
  const first = (iso: string | null) => (iso == null ? Infinity : Date.parse(iso));
  if (t0 < first(horizons.sync) || t0 < first(horizons.history)) return true;

  const bound = MOVE_FRESH_DAYS * DAY_MS;
  let p = -Infinity;
  for (const h of historyRuns) {
    if (h.status !== "success") continue;
    const t = Date.parse(h.startedAt);
    if (t < t0 && t > p) p = t;
  }
  if (!(p >= t0 - bound)) return false;

  const legs = syncRuns
    .filter((r) => syncLegOk(r, chamber, source))
    .map((r) => Date.parse(r.startedAt))
    .filter((t) => Number.isFinite(t))
    .sort((a, b) => a - b);
  const s = legs.find((t) => t > p && t < t0 + DAY_MS);
  if (s === undefined) return false;
  let sPrev = -Infinity;
  for (const t of legs) if (t < s && t > sPrev) sPrev = t;
  return sPrev > -Infinity && s - sPrev <= bound;
}
