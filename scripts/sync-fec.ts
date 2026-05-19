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
  fetchFecTotals,
  logResolvedFecKey,
  resolveFecCandidateId,
} from "../lib/fec";

const CYCLE = 2026;
const STALE_DAYS = 7;
const DELAY_MS = 300;

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
                 mf.ingested_at AS fundraising_ingested_at
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

  for (const m of members) {
    if (!m.state || !m.lastName) {
      // Can't even submit a search without state + last name; skip silently.
      continue;
    }

    // Skip if the totals row is fresh (cron-ish behavior; lets the script
    // double as a "refresh stale rows" workflow without flags).
    if (ageInDays(m.fundraisingIngestedAt) < STALE_DAYS) {
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

      await sleep(DELAY_MS);
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

    await sleep(DELAY_MS);
    const totals = await fetchFecTotals(candidateId, CYCLE);
    if (!totals) {
      totalsFailed++;
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

  console.log(
    `\ndone — resolved_new=${resolved} cached=${cachedHit} no_match=${noMatch} ` +
      `api_errors=${apiErrors} totals_upserted=${totalsUpserted} ` +
      `totals_failed=${totalsFailed} skipped_fresh=${totalsSkippedFresh}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
