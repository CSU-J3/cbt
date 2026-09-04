// HO 691 — READ-ONLY enumeration of the PAC-spending targets and their status.
// WRITES NOTHING. No network. DB reads only.
//
// It imports `classifyTarget` from lib/pac-target-status.ts — the SAME function
// getPacIeSpending calls — rather than restating the ladder. A diagnostic that
// pins a verbatim copy of shipped logic is a dependency with no compiler edge
// and no test, so a stale copy and a current one emit identical green; this one
// cannot drift because there is nothing here to drift.
//
// Reports, per row: the seat, the direction, the FEC target name, the surname
// key, the verdict, and the classifier's own `why` string — so a verdict can be
// audited without re-deriving it. Then the seat rollup: which surfaces each seat
// reaches, and what the two render variants will do with it.
//
//   npx tsx scripts/diagnostic/pac-target-status-691.ts
import "dotenv/config";
import { getDb } from "@/lib/db";
import { PAC_IE_CYCLE, pacSurname } from "@/lib/pac-ie";
import {
  type ContestRow,
  type RosterRow,
  classifyTarget,
  fecTargetKey,
} from "@/lib/pac-target-status";

async function main() {
  const db = getDb();
  const today = new Date().toISOString().slice(0, 10);
  console.log(`HO 691 — PAC target status (read-only)   today=${today}\n`);

  const pacRs = await db.execute({
    sql: `SELECT race_id, candidate_id, candidate_name, support_oppose,
                 earliest_date, latest_date, as_of
          FROM pac_ie_spending WHERE cycle = ?
          ORDER BY race_id, support_oppose DESC, earliest_date ASC`,
    args: [PAC_IE_CYCLE],
  });
  const pac = pacRs.rows;
  const seatIds = [...new Set(pac.map((r) => r.race_id as string))];
  console.log(`── ROW 1 — pac_ie_spending, cycle ${PAC_IE_CYCLE}: ${pac.length} rows / ${seatIds.length} races\n`);
  console.log("   race_id        | S/O | candidate_name                | earliest   | latest     | as_of");
  for (const p of pac)
    console.log(
      `   ${(p.race_id as string).padEnd(14)} |  ${p.support_oppose}  | ${(p.candidate_name as string).padEnd(29)} | ${((p.earliest_date as string | null) ?? "—").padEnd(10)} | ${((p.latest_date as string | null) ?? "—").padEnd(10)} | ${(p.as_of as string).slice(0, 10)}`,
    );

  const marks = seatIds.map(() => "?").join(",");
  // Same two reads, same joins, same CTE+CROSS JOIN drive order as
  // getPacIeSpending — see the comment there for why the shape is load-bearing.
  // Mirrored deliberately: this probe exists to report what the query layer
  // sees, so a different shape here would report a different thing.
  const contestRs = await db.execute({
    sql: `WITH seat AS (
            SELECT id, state, chamber, district FROM races WHERE id IN (${marks})
          )
          SELECT r.id AS race_id, p.id AS primary_id, p.primary_date,
                 p.runoff_date, p.election_round, pc.name, pc.status, pc.vote_pct
          FROM seat r
          CROSS JOIN primaries p
            ON p.state = r.state AND p.chamber = r.chamber
           AND ((p.district IS NULL AND r.district IS NULL)
                OR CAST(p.district AS INTEGER) = r.district)
          CROSS JOIN primary_candidates pc ON pc.primary_id = p.id`,
    args: seatIds,
  });
  const rosterRs = await db.execute({
    sql: `SELECT race_id, name, status, source_url FROM race_candidates
          WHERE race_id IN (${marks})`,
    args: seatIds,
  });
  const contests: Record<string, ContestRow[]> = {};
  for (const c of contestRs.rows)
    (contests[c.race_id as string] ??= []).push({
      primaryId: c.primary_id as string,
      primaryDate: (c.primary_date as string | null) ?? null,
      runoffDate: (c.runoff_date as string | null) ?? null,
      round: c.election_round as string,
      name: c.name as string,
      status: (c.status as string | null) ?? null,
      votePct: (c.vote_pct as number | null) ?? null,
    });
  const roster: Record<string, RosterRow[]> = {};
  for (const c of rosterRs.rows)
    (roster[c.race_id as string] ??= []).push({
      name: c.name as string,
      status: (c.status as string | null) ?? null,
    });

  // Rounds present per seat — the round dimension is silent unless you look for
  // it, and a seat whose runoff row was never scraped looks identical to a seat
  // that never had one except for the round-1 row's `runoff_date` forward link.
  console.log("\n\n── ROUNDS per seat (the round dimension)");
  for (const id of seatIds) {
    const cs = contests[id] ?? [];
    const rounds = [...new Set(cs.map((c) => c.round))];
    const runoffDates = [
      ...new Set(cs.map((c) => c.runoffDate).filter(Boolean)),
    ];
    console.log(
      `   ${id.padEnd(14)} rounds={${rounds.join(",") || "none"}}  runoff_date forward-links: ${runoffDates.join(",") || "none"}${runoffDates.length && !rounds.includes("runoff") ? "   <<< later round known, NO resulted row" : ""}`,
    );
  }

  console.log("\n\n── ROW 2 — target status, via lib/pac-target-status::classifyTarget\n");
  const tally: Record<string, number> = {};
  const bySeat: Record<string, { so: string; name: string; status: string }[]> = {};
  for (const p of pac) {
    const raceId = p.race_id as string;
    const name = p.candidate_name as string;
    const c = classifyTarget(name, contests[raceId] ?? [], roster[raceId] ?? [], today);
    tally[c.status] = (tally[c.status] ?? 0) + 1;
    (bySeat[raceId] ??= []).push({
      so: p.support_oppose as string,
      name,
      status: c.status,
    });
    console.log(
      `   ${raceId.padEnd(14)} ${p.support_oppose}  ${name.padEnd(29)} key=${fecTargetKey(name).padEnd(16)} → ${c.status.toUpperCase()}`,
    );
    console.log(`        ${c.why}`);
  }
  console.log("\n   tally:");
  for (const k of ["active", "lost", "withdrew", "unknown"])
    console.log(`     ${k.padEnd(9)} ${tally[k] ?? 0}`);

  // What each surface will render. Rated seats reach /electoral (getRacesIndex
  // INNER JOINs race_ratings); every seat reaches its own /race/[id] hub.
  console.log("\n\n── ROW 5 — per seat: surfaces + what each variant renders\n");
  for (const id of seatIds) {
    const rr = await db.execute({
      sql: `SELECT COUNT(*) n FROM race_ratings WHERE race_id = ? AND cycle = ?`,
      args: [id, PAC_IE_CYCLE],
    });
    const rated = Number(rr.rows[0]!.n) > 0;
    const rows = bySeat[id] ?? [];
    const current = rows.filter(
      (r) => r.status === "active" || r.status === "unknown",
    );
    // Mirror the component: pacSurname for the label, and dedup on
    // direction+surname+status (NJ-11 carries two candidate_ids for Malinowski,
    // which renders ONCE). Without both, this preview disagrees with the screen
    // and the disagreement looks like a defect in the screen.
    const seen = new Set<string>();
    const glance =
      current.length === 0
        ? "(ABSENT)"
        : current
            .map((r) => ({
              verb: r.so === "S" ? "backing" : "opposing",
              sn: pacSurname(r.name),
              st: r.status,
            }))
            .filter((r) => {
              const k = `${r.verb}:${r.sn}:${r.st}`;
              if (seen.has(k)) return false;
              seen.add(k);
              return true;
            })
            .map((r) => `${r.verb} ${r.sn}`)
            .join(", ");
    console.log(
      `   ${id.padEnd(14)} rated=${rated ? "YES → /electoral + hub" : "no  → hub only"}${rated ? " (+dashboard if featured)" : ""}`,
    );
    console.log(`        rows: ${rows.map((r) => `${r.so}:${r.name.split(",")[0]}=${r.status}`).join("  ")}`);
    console.log(`        glance → AIPAC super PAC · ${glance}`);
  }

  console.log("\n\n── ROW 6 — harvest currency");
  const stamp = await db.execute(
    `SELECT updated_at, COUNT(*) n FROM race_candidates
     WHERE source_url = 'harvest:primary_winner' GROUP BY updated_at
     ORDER BY updated_at DESC LIMIT 5`,
  );
  for (const r of stamp.rows)
    console.log(`   ${(r.updated_at as string | null) ?? "NULL"}  ${r.n} sentinel rows`);
  const gap = await db.execute(`
    SELECT COUNT(*) n FROM primary_candidates pc
    JOIN primaries p ON p.id = pc.primary_id
    JOIN races r ON r.state = p.state AND r.chamber = p.chamber
      AND ((p.district IS NULL AND r.district IS NULL)
           OR CAST(p.district AS INTEGER) = r.district)
      AND r.cycle = 2026
    WHERE pc.status = 'winner' AND p.election_round = 'primary'
      AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = 2026)
      AND (r.incumbent_bioguide_id IS NULL OR pc.bioguide_id IS NULL
           OR pc.bioguide_id <> r.incumbent_bioguide_id)
      AND NOT EXISTS (SELECT 1 FROM race_candidates rc
                      WHERE rc.race_id = r.id AND rc.name = pc.name)`);
  console.log(
    `   rated-set primary winners with no race_candidates counterpart: ${gap.rows[0]!.n}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
