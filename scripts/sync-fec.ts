// FEC fundraising sync (handoff 83). Resolves each current member to an
// FEC candidate_id (cached on members.fec_candidate_id), pulls cycle totals,
// upserts into member_fundraising. Idempotent; per-member sleep keeps us
// well under FEC's 1000/hr api.data.gov limit even across the full ~544
// members on the first run (~10 min wall clock).
//
// Storage: member_fundraising (reused from the reverted HO 65 OpenSecrets
// scaffold — schema is already cents-keyed and cycle-aware). The
// `coverage_end_date` column was added in scripts/migrate.ts for this
// handoff.
//
// Re-run semantics: skips members whose member_fundraising row was
// ingested within STALE_DAYS. Members that never resolved to an FEC
// candidate also get skipped if `fec_resolved_at` is fresh, so the no-match
// tail (retirees, post-resignation appointees who haven't filed) doesn't
// keep burning API calls.
import "dotenv/config";
import { getDb } from "../lib/db";
import {
  type FecResolveInput,
  fetchFecBySize,
  fetchFecTotals,
  logResolvedFecKey,
  resolveFecCandidateId,
} from "../lib/fec";

const CYCLE = 2026;
const STALE_DAYS = 7;
// api.data.gov standard tier is 60 req/hr — the K0Ue key never got the 1000/hr
// upgrade (HO 416; upgrade needs an email to their support, no ETA). Two guards
// keep a run inside that ceiling:
//   DELAY_MS — pace every call ~1.1s apart so the run spreads across the window
//     instead of bursting (a burst is what trips the internal 429 retry in
//     lib/fec.ts, which then fans one logical call into up-to-4 uncounted hits).
//   CALL_CAP — hard stop at 55 logical calls (resolve + totals + by_size all
//     count), leaving ~5 of the 60 as headroom for stray totals-failed retries
//     that share the same rolling hour. When hit, the run exits cleanly and the
//     existing skipped_fresh skip acts as the resume cursor: the next window
//     picks up only the still-missing set, spending zero calls on what landed.
const DELAY_MS = 1100;
const CALL_CAP = 55;

type Db = ReturnType<typeof getDb>;

type MemberRow = {
  bioguideId: string;
  name: string;
  firstName: string | null;
  lastName: string | null;
  state: string | null;
  chamber: "house" | "senate";
  fecCandidateId: string | null;
  fecResolvedAt: string | null;
  fundraisingIngestedAt: string | null;
  bySizePresent: boolean; // member_fundraising.small_dollar already populated
  nextElectionYear: number | null; // HO 411 class-derived + specials-aware cycle
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchPendingMembers(db: Db): Promise<MemberRow[]> {
  // Drive off `members` — sync:members already filters to currentMember-ish
  // (it pulls only sponsors of 119th bills). No `in_office` column exists;
  // chamber-not-null is a proxy because state/chamber are required to even
  // submit an FEC search.
  const r = await db.execute({
    sql: `SELECT m.bioguide_id, m.name, m.first_name, m.last_name, m.state,
                 m.chamber, m.fec_candidate_id, m.fec_resolved_at,
                 m.next_election_year AS next_election_year,
                 mf.ingested_at AS fundraising_ingested_at,
                 mf.small_dollar AS small_dollar
          FROM members m
          LEFT JOIN member_fundraising mf
                 ON mf.bioguide_id = m.bioguide_id AND mf.cycle = ?
          WHERE m.chamber IN ('house', 'senate')
            AND m.state IS NOT NULL
          ORDER BY m.last_name, m.first_name`,
    args: [CYCLE],
  });
  return r.rows.map((row) => ({
    bioguideId: row.bioguide_id as string,
    name: row.name as string,
    firstName: (row.first_name as string | null) ?? null,
    lastName: (row.last_name as string | null) ?? null,
    state: (row.state as string | null) ?? null,
    chamber: row.chamber as "house" | "senate",
    fecCandidateId: (row.fec_candidate_id as string | null) ?? null,
    fecResolvedAt: (row.fec_resolved_at as string | null) ?? null,
    fundraisingIngestedAt:
      (row.fundraising_ingested_at as string | null) ?? null,
    bySizePresent: (row.small_dollar as number | null) != null,
    nextElectionYear: (row.next_election_year as number | null) ?? null,
  }));
}

function ageInDays(iso: string | null): number {
  if (!iso) return Number.POSITIVE_INFINITY;
  const ms = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(ms)) return Number.POSITIVE_INFINITY;
  return ms / 86_400_000;
}

async function recordResolveAttempt(
  db: Db,
  bioguideId: string,
  candidateId: string | null,
): Promise<void> {
  const now = new Date().toISOString();
  if (candidateId) {
    await db.execute({
      sql: `UPDATE members SET fec_candidate_id = ?, fec_resolved_at = ?
            WHERE bioguide_id = ?`,
      args: [candidateId, now, bioguideId],
    });
  } else {
    // Cache the no-match so the next run doesn't retry constantly. Don't
    // clear an existing candidate_id — a transient API miss must not
    // invalidate prior good data.
    await db.execute({
      sql: `UPDATE members SET fec_resolved_at = ?
            WHERE bioguide_id = ?`,
      args: [now, bioguideId],
    });
  }
}

const UPSERT_FUNDRAISING_SQL = `
INSERT INTO member_fundraising (
  bioguide_id, cycle, total_raised, total_spent, cash_on_hand, debts,
  source_url, ingested_at, coverage_end_date
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(bioguide_id, cycle) DO UPDATE SET
  total_raised = excluded.total_raised,
  total_spent = excluded.total_spent,
  cash_on_hand = excluded.cash_on_hand,
  debts = excluded.debts,
  source_url = excluded.source_url,
  ingested_at = excluded.ingested_at,
  coverage_end_date = excluded.coverage_end_date
`;

async function main(): Promise<void> {
  logResolvedFecKey();
  const db = getDb();
  const members = await fetchPendingMembers(db);
  console.log(`considering ${members.length} current members for cycle ${CYCLE}`);

  let resolved = 0;
  let cachedHit = 0;
  let noMatch = 0;
  let apiErrors = 0;
  let totalsFailed = 0;
  let totalsUpserted = 0;
  let totalsSkippedFresh = 0;
  let bySizeUpserted = 0;
  let bySizeEmpty = 0; // valid ID, correct cycle, but FEC has no Schedule A rows
  let bySizeFailed = 0;
  let apiCalls = 0; // logical FEC calls this run — gated against CALL_CAP
  let capped = false;

  for (const m of members) {
    if (!m.state || !m.lastName) {
      // Can't even submit a search without state + last name; skip silently.
      continue;
    }

    // Skip only when there's nothing left to do — totals fresh AND the by_size
    // split already stored. A fresh-totals row missing its split (the HO 390
    // backfill case) still falls through and fetches by_size below without
    // re-pulling totals.
    const totalsFresh = ageInDays(m.fundraisingIngestedAt) < STALE_DAYS;
    if (totalsFresh && m.bySizePresent) {
      totalsSkippedFresh++;
      continue;
    }

    let candidateId = m.fecCandidateId;
    if (!candidateId) {
      // Skip transiently if we already tried and failed within STALE_DAYS —
      // the FEC corpus doesn't grow new candidates daily.
      if (
        m.fecCandidateId === null &&
        ageInDays(m.fecResolvedAt) < STALE_DAYS
      ) {
        noMatch++;
        continue;
      }

      if (apiCalls >= CALL_CAP) {
        capped = true;
        break;
      }
      await sleep(DELAY_MS);
      apiCalls++;
      const input: FecResolveInput = {
        lastName: m.lastName,
        firstName: m.firstName ?? "",
        state: m.state,
        chamber: m.chamber,
        cycle: CYCLE,
      };
      let outcome;
      try {
        outcome = await resolveFecCandidateId(input);
      } catch (err) {
        console.error(`resolve ${m.name}: ${(err as Error).message}`);
        outcome = { kind: "api_error", reason: "exception" } as const;
      }
      if (outcome.kind === "api_error") {
        // Don't cache — let the next run retry. Transient failures (429,
        // network) must not lock the member out of fundraising for
        // STALE_DAYS.
        apiErrors++;
        continue;
      }
      await recordResolveAttempt(
        db,
        m.bioguideId,
        outcome.kind === "match" ? outcome.candidateId : null,
      );
      if (outcome.kind === "no_match") {
        noMatch++;
        console.log(`  no FEC match: ${m.name} (${m.state})`);
        continue;
      }
      candidateId = outcome.candidateId;
      resolved++;
    } else {
      cachedHit++;
    }

    // Totals — refresh only when stale (idempotent upsert). A fresh-totals
    // member that's only here for the by_size backfill skips this call.
    if (!totalsFresh) {
      if (apiCalls >= CALL_CAP) {
        capped = true;
        break;
      }
      await sleep(DELAY_MS);
      apiCalls++;
      const totals = await fetchFecTotals(candidateId, CYCLE);
      if (!totals) {
        totalsFailed++;
        // Name the failures so the sweep can tell a stable staleness thread
        // (same members every pass) from transient retry churn.
        console.log(`  totals empty @${CYCLE}: ${m.name} (${m.state}) [${candidateId}]`);
        continue;
      }

      await db.execute({
        sql: UPSERT_FUNDRAISING_SQL,
        args: [
          m.bioguideId,
          CYCLE,
          totals.totalRaised,
          totals.totalSpent,
          totals.cashOnHand,
          totals.debts,
          totals.sourceUrl,
          new Date().toISOString(),
          totals.coverageEndDate,
        ],
      });
      totalsUpserted++;
      if (totalsUpserted % 25 === 0) {
        console.log(`  upserted ${totalsUpserted} fundraising rows`);
      }
    }

    // HO 390 — small/large-dollar split, NON-FATAL (a by_size failure must
    // never fail the run or undo the totals upsert). Updates the row in place
    // (it exists: either just upserted above, or fresh from a prior run).
    // Same candidate_id — by_candidate aggregates the authorized committees.
    try {
      if (apiCalls >= CALL_CAP) {
        capped = true;
        break;
      }
      await sleep(DELAY_MS);
      apiCalls++;
      // HO 417 — schedule_a/by_size/by_candidate is keyed to the candidate's
      // ELECTION cycle, not the 2026 reporting cycle. Off-cycle senators (Classes
      // 1 & 3, up 2028/2030) file their current Schedule A under 2028/2030, so a
      // fixed cycle=2026 query returned empty for all 67 of them (HO 416
      // diagnosis). members.next_election_year is HO 411's single source of truth
      // — class-derived AND specials-aware, so OH/FL 2026 specials (Husted/Moody,
      // Class 3) correctly read 2026 here rather than their class default 2030.
      // House + Class-2 senators already resolve to 2026, so they're untouched.
      // Totals stay on CYCLE (2026): that endpoint is reporting-cycle keyed and
      // already returns the rolling data — only by_size needed the election cycle.
      const bySizeCycle = m.nextElectionYear ?? CYCLE;
      const bySize = await fetchFecBySize(candidateId, bySizeCycle);
      if (bySize) {
        await db.execute({
          sql: `UPDATE member_fundraising
                SET small_dollar = ?, large_dollar = ?
                WHERE bioguide_id = ? AND cycle = ?`,
          args: [bySize.smallDollar, bySize.largeDollar, m.bioguideId, CYCLE],
        });
        bySizeUpserted++;
      } else {
        // Correct cycle, still no rows — a genuine floor (hasn't filed / no
        // itemized Schedule A breakdown), not a cycle-key miss. Name off-cycle
        // cases so the residual floor is auditable by member.
        bySizeEmpty++;
        if (bySizeCycle !== CYCLE) {
          console.log(`  by_size empty @${bySizeCycle}: ${m.name} (${m.state})`);
        }
      }
    } catch (err) {
      bySizeFailed++;
      console.warn(`by_size ${m.name}: ${(err as Error).message}`);
    }
  }

  console.log(
    `\ndone — resolved_new=${resolved} cached=${cachedHit} no_match=${noMatch} ` +
      `api_errors=${apiErrors} totals_upserted=${totalsUpserted} ` +
      `totals_failed=${totalsFailed} skipped_fresh=${totalsSkippedFresh} ` +
      `bysize_upserted=${bySizeUpserted} bysize_empty=${bySizeEmpty} ` +
      `bysize_failed=${bySizeFailed} ` +
      `api_calls=${apiCalls}/${CALL_CAP}` +
      `${capped ? " (CAPPED — rerun next window to resume)" : ""}`,
  );

  // Flush the member-hub fundraising line so freshly-written totals + the HO 390
  // small/large split appear without waiting out the 24h cache TTL. CLI scripts
  // can't revalidateTag the Next runtime directly, so POST the deployed
  // /api/revalidate route (same pattern as backfill-report-counts /
  // classify-ceremonial). Soft-fail when the env isn't configured.
  const revalidateUrl = process.env.REVALIDATE_URL;
  const secret = process.env.CRON_SECRET;
  if (revalidateUrl && secret) {
    try {
      await fetch(`${revalidateUrl}?tag=member-fundraising`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      console.log("Flushed `member-fundraising` cache tag.");
    } catch (e) {
      console.warn("Revalidate POST failed (non-fatal):", e);
    }
  } else {
    console.log(
      "REVALIDATE_URL / CRON_SECRET not set — flush the `member-fundraising` tag manually.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
