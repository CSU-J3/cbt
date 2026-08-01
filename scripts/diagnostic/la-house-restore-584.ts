// HO 584 STEP 0 — LA House 2026 restore: measure the six rows, what the unlock
// would write, the November-date blast radius, and the live roster (READ-ONLY).
//
// The backlog precondition ("remove LA from HOUSE_PRIMARY_SUSPENDED when writing a
// real date") is necessary but NOT sufficient: the moment the lock comes off, the
// non-suspended ON CONFLICT branch (primaries-sync.ts:1100-1102) writes
// COALESCE(excluded.primary_date, …) from calByState, and calByState now reads the
// CLEAN statewide senate row (2026-05-16) — LA HAS one. So the unlock would clobber
// all six LA House rows with the SENATE's May-16 date and (via excluded.primary_type)
// its type. This measures whether that's real before any build. No writes anywhere.
//
// RESULTS (M1–M4) are filled into this header after the run, then HALT.
import "dotenv/config";
import { getDb } from "@/lib/db";
import { scrapeHouseCandidates } from "@/lib/primary-candidates-scrape";

const WRITE = /\b(insert|update|delete|create|drop|alter|replace|vacuum|reindex)\b/i;
function ro(sql: string): string {
  if (WRITE.test(sql)) throw new Error(`read-only guard tripped: ${sql.slice(0, 70)}`);
  return sql;
}
const TODAY = new Date().toISOString().slice(0, 10);
function hr() {
  console.log("─".repeat(72));
}

async function main() {
  const db = getDb();
  console.log("HO 584 STEP 0 — LA House 2026 restore (READ-ONLY)\n");
  console.log(`today = ${TODAY}\n`);

  // ── M1 — the six rows as they stand ──────────────────────────────────────────
  hr();
  console.log("M1 — house-LA-% ROWS AS THEY STAND");
  const rows = (
    await db.execute(
      ro(`SELECT id, district, election_round, primary_date, runoff_date, primary_type, updated_at
          FROM primaries WHERE id LIKE 'house-LA-%' ORDER BY id`),
    )
  ).rows;
  console.log(`  row count = ${rows.length}`);
  for (const r of rows) {
    const x = r as Record<string, unknown>;
    const shares = (
      await db.execute({
        sql: ro(`SELECT COUNT(*) AS n, SUM(CASE WHEN vote_pct IS NOT NULL THEN 1 ELSE 0 END) AS withShare
                 FROM primary_candidates WHERE primary_id = ?`),
        args: [x.id as string],
      })
    ).rows[0] as Record<string, unknown>;
    console.log(
      `    ${(x.id as string).padEnd(24)} round=${x.election_round} date=${JSON.stringify(x.primary_date)} runoff=${JSON.stringify(x.runoff_date)} type=${JSON.stringify(x.primary_type)} cands=${shares.n} withShare=${shares.withShare}`,
    );
  }
  const allOpen = rows.every((r) => String((r as Record<string, unknown>).id).endsWith("-open"));
  const allNullDate = rows.every((r) => (r as Record<string, unknown>).primary_date == null);
  const anyShare = rows.length > 0; // recomputed below
  console.log(`  VERDICT: 6 rows? ${rows.length === 6} | all -open? ${allOpen} | all primary_date NULL? ${allNullDate}`);
  const withShareTotal = (
    await db.execute(
      ro(`SELECT COUNT(*) AS n FROM primary_candidates pc
          JOIN primaries p ON p.id = pc.primary_id
          WHERE p.id LIKE 'house-LA-%' AND pc.vote_pct IS NOT NULL`),
    )
  ).rows[0] as Record<string, unknown>;
  console.log(`  candidates carrying a share across all LA House rows = ${withShareTotal.n} (a share here would mean a result recorded for a contest that hasn't happened → changes the plan)`);
  void anyShare;

  // ── M2 — what the unlock would write (calByState for LA, verbatim) ────────────
  hr();
  console.log("M2 — WHAT THE UNLOCK WOULD WRITE (calByState for LA, the syncHouseDistricts SELECT verbatim)");
  const cal = (
    await db.execute({
      sql: ro(`SELECT state,
                      MAX(primary_date) AS primary_date,
                      MAX(runoff_date)  AS runoff_date,
                      MAX(primary_type) AS primary_type
                 FROM primaries
                WHERE primary_date IS NOT NULL
                  AND election_round = 'primary'
                  AND district IS NULL
                  AND id NOT LIKE '%-special-%'
                  AND state IN ('LA')
                GROUP BY state`),
      args: [],
    })
  ).rows[0] as Record<string, unknown> | undefined;
  if (!cal) {
    console.log("  calByState[LA] = UNDEFINED — no clean statewide senate row. §0 would be FALSE. STOP + report.");
  } else {
    console.log(`  calByState[LA] = primaryDate=${JSON.stringify(cal.primary_date)} runoffDate=${JSON.stringify(cal.runoff_date)} primaryType=${JSON.stringify(cal.primary_type)}`);
    // show which row(s) that MAX came from
    const src = (
      await db.execute(
        ro(`SELECT id, primary_date, runoff_date, primary_type FROM primaries
            WHERE state='LA' AND election_round='primary' AND district IS NULL
              AND id NOT LIKE '%-special-%' AND primary_date IS NOT NULL
            ORDER BY primary_date DESC`),
      )
    ).rows;
    console.log("  clean statewide LA rows feeding that MAX:");
    for (const r of src) {
      const x = r as Record<string, unknown>;
      console.log(`    ${(x.id as string).padEnd(24)} date=${x.primary_date} runoff=${JSON.stringify(x.runoff_date)} type=${JSON.stringify(x.primary_type)}`);
    }
    const expected = cal.primary_date === "2026-05-16";
    console.log(`  §0 CONFIRMED? primaryDate === 2026-05-16 → ${expected}. On unlock, COALESCE writes this date onto all six -open rows; excluded.primary_type writes ${JSON.stringify(cal.primary_type)}.`);
    console.log(`  → The correct LA House shape is 2026-11-03 / 2026-12-12 / jungle. The unlock writes the WRONG date AND type. This is the §0 clobber; the override (C1) is what prevents it.`);
  }

  // ── M3 — the November-date blast radius (static analysis; report, don't fix) ──
  hr();
  console.log("M3 — NOVEMBER-DATE BLAST RADIUS (consumers of primary_date / runoff_date)");
  console.log("  A 2026-11-03 primary_date is unprecedented (every other contest is spring/summer). Per-consumer:");
  console.log("  1. getPrimaryCalendar → PrimaryTimeline (queries.ts:1617): windowed 2026, GROUP BY primary_date,");
  console.log("     ORDER BY primary_date ASC. A Nov-3 LA row adds a NEW tick (bar height = the 6 -open rows,");
  console.log("     states incl LA). VOTED/UPCOMING is a render-time date<=today compare → UPCOMING (amber),");
  console.log("     a far-right tick. RENDERING PREFERENCE, not an ordering break (dates plot ascending).");
  console.log("  2. getUpcomingPrimaries (primary_date >= today, :1493): the 6 rows list as upcoming. CORRECT.");
  console.log("  3. getPastPrimaries (primary_date < today, :1510): NOT past until Nov 3. CORRECT.");
  console.log("  4. isSettled (primary_date < today AND a recorded share, :449): a future Nov-3 row is NOT settled,");
  console.log("     so it stays OPEN + re-scrapeable — exactly what we want while the November roster fills. CORRECT.");
  console.log("  5. getPrimaryForRace (:1554): pins p.district IS NULL (statewide) — the LA House rows carry a");
  console.log("     district, so they are NEVER selected. It returns the statewide LA SENATE row (05-16, past) as");
  console.log("     the House member's proxy — UNAFFECTED by the Nov date, but ALREADY senate-proxy-stale for LA");
  console.log("     House (the convention break §0 names; NOT this HO's date-write, and not fixed here). The");
  console.log("     future-first ordering CASE handles a Nov date correctly IF one ever entered (it doesn't).");
  console.log("  6. runSpecialPriorityPass ±7d (HO 561): fires only on seeded '-special-' ids; the LA House rows");
  console.log("     are '-open', not specials → untouched. The normal cursor walk re-scrapes LA House on cadence.");
  console.log("  7. runoff_date=2026-12-12 on the -open rows: RaceRunoffs reads separate election_round='runoff'");
  console.log("     rows, not this field; PrimaryRow/PrimaryMapCard render 'runoff <date>' from runoff_date →");
  console.log("     'runoff Dec 12'. CORRECT semantics (Dec 12 = the contest that resolves the Nov primary).");
  console.log("  ORDERING ASSUMPTIONS THAT BREAK: NONE. No consumer models the November GENERAL as a primaries");
  console.log("  row, so there is no 'primary precedes general' or 'runoff precedes general' ordering to violate.");
  console.log("  The only unprecedented property is visual (a late tick). M3 → no blocking finding.");

  // ── M4 — roster expectation (live scrape of one LA district) ──────────────────
  hr();
  console.log("M4 — LIVE ROSTER (scrape LA-01, bypassCache)");
  try {
    const res = await scrapeHouseCandidates("LA", "Louisiana", 1, { bypassCache: true });
    console.log(`  status=${res.status}  candidates=${res.candidates.length}`);
    if (res.candidates.length > 0) {
      for (const c of res.candidates.slice(0, 8)) {
        console.log(`    ${c.name}  contest=${c.contest} party=${(c as { party?: string }).party ?? "—"} incumbent=${c.incumbent}`);
      }
    }
    console.log("  READ: an empty roster here is HONEST (Nov-3 qualifying hasn't happened) — NOT the HO 563");
    console.log("  erasure class. The HO 564 non-empty-roster gate means an empty parse deletes nothing; the row");
    console.log("  stays with its (post-fix) Nov date and fills as candidates qualify. Confirm the status above");
    console.log("  is one of ok / no_section / no_candidates (a reachable page), not a hard failure.");
  } catch (e) {
    console.log(`  scrape threw: ${e instanceof Error ? e.message : String(e)} (Ballotpedia egress can be flaky from a laptop — retry, or note it)`);
  }

  hr();
  console.log("\nHALT — STEP 0 complete. No build code until the halt clears.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
