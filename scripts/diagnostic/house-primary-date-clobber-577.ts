// HO 577 STEP 0 — house primary date clobber scope + guard asymmetry (READ-ONLY).
//
// RUN 2026-07-31 (reads restored — Turso upgraded/unblocked). Results below are
// MEASURED, not code-derived. HALT (M1a–M7 output):
//   M1a — 3 states poisoned: LA, GA, SC (NOT SC-only).
//   M1c — 48 house rows carry the wrong date (GA 28, SC 14, LA 6).
//   M1b — cause tally special=2 (SC), runoff=3 (LA×2, GA×1), house=48. The house
//     bucket DOMINATES: the special/runoff SEEDED the poison, but the house rows have
//     absorbed it and now WIN MAX themselves — the loop is already self-sustaining and
//     the special/runoff are no longer the active cause. This is why excluding only
//     special+runoff from the MAX is insufficient; the house rows (round=primary) must
//     be excluded too (district IS NULL), and the poisoned rows must be repaired.
//   M7 — 15 states own house rows but have NO clean statewide senate row (AZ CA CT HI
//     IN MD MO ND NV NY PA UT VT WA WI). None of the 3 poisoned states is in this set,
//     but it forces Part 1 (b): a district-IS-NULL MAX filter alone would NULL those 15
//     states' house dates (the HO 209 regression), so the statewide date must come from
//     the scraped calendar (all-50 source), not a DB aggregate over `primaries`.
//   M6 — all 3 repairable by UPDATE (correct date = the regular senate row's date,
//     derivable, no re-fetch). SC still future-dated (2026-08-11) → repair window intact.
//
// The bug: `calByState` = `MAX(primary_date) GROUP BY state` (primaries-sync.ts:905)
// with NO filter does not compute "this state's primary date" — it computes "the latest
// date on ANY row this state has," so a SPECIAL, a RUNOFF, or a previously-poisoned
// HOUSE row wins by construction. The defect class is a table deriving its writes from
// an unfiltered aggregate over itself. The MISSING `isSettled` guard on the House write
// (:1062, unlike the Senate path :707) explains why the bad value PROPAGATED; the MAX
// explains why there was a bad value at all. Fix is two-part and ordered: MAX first
// (stop poisoning — district IS NULL + round=primary + non-special, plus calendar-
// sourcing for the M7 gap states), then the guard; the M6 UPDATE repair is separate and
// load-bearing (a repaired shareless past row is not isSettled).
//
// This file WRITES NOTHING. A runtime guard refuses any non-SELECT statement.
import "dotenv/config";
import { getDb } from "@/lib/db";

const TODAY = new Date().toISOString().slice(0, 10);
const WRITE = /\b(insert|update|delete|create|drop|alter|replace)\b/i;
function ro(sql: string): string {
  if (WRITE.test(sql)) throw new Error(`read-only guard tripped: ${sql.slice(0, 60)}`);
  return sql;
}

type Prim = {
  id: string;
  state: string;
  district: string | null;
  chamber: string;
  party: string;
  primary_date: string | null;
  election_round: string;
};

const isSpecial = (id: string) => id.includes("-special-");
const isRegularSenate = (p: Prim) =>
  p.chamber === "senate" && p.election_round === "primary" && !isSpecial(p.id);

async function main() {
  const db = getDb();
  console.log(`HO 577 — house primary date clobber probe (READ-ONLY). today=${TODAY}\n`);

  const prims: Prim[] = (
    await db.execute(
      ro(
        "SELECT id, state, district, chamber, party, primary_date, election_round FROM primaries",
      ),
    )
  ).rows.map((r) => ({
    id: String(r.id),
    state: String(r.state),
    district: r.district == null ? null : String(r.district),
    chamber: String(r.chamber),
    party: String(r.party),
    primary_date: r.primary_date == null ? null : String(r.primary_date),
    election_round: String(r.election_round),
  }));

  // Regular statewide date per state = primary_date of a regular (non-special,
  // primary-round) senate-{ST}-2026-{D|R|open} row. This is what calByState SHOULD
  // return for a state's house districts (they share the statewide primary date).
  const regularByState = new Map<string, string | null>();
  for (const p of prims) {
    if (isRegularSenate(p) && !regularByState.has(p.state)) regularByState.set(p.state, p.primary_date);
  }
  // calByState as the sync computes it: MAX(primary_date) GROUP BY state, no filter.
  const maxByState = new Map<string, string | null>();
  for (const p of prims) {
    if (p.primary_date == null) continue;
    const cur = maxByState.get(p.state);
    if (cur == null || p.primary_date > cur) maxByState.set(p.state, p.primary_date);
  }

  // ── M1a — poisoned calByState entries (MAX != regular statewide) ────────────
  console.log("=== M1a — states where calByState MAX(primary_date) != the regular statewide date ===");
  const poisoned: string[] = [];
  for (const [st, reg] of regularByState) {
    const mx = maxByState.get(st) ?? null;
    if (mx !== reg) poisoned.push(st);
  }
  console.log(`  poisoned states: ${poisoned.length} → ${poisoned.join(", ") || "—"}`);
  for (const st of poisoned) console.log(`    ${st}: MAX=${maxByState.get(st)} vs regular=${regularByState.get(st)}`);
  console.log(`  HEADLINE: is this SC-only? ${poisoned.length === 1 && poisoned[0] === "SC" ? "YES — SC only" : poisoned.length === 0 ? "no poisoned states" : "NO — " + poisoned.join("/")}\n`);

  // ── M1b — for each poisoned state, which rows ARE the MAX (special/runoff/?) ─
  console.log("=== M1b — what row supplies the poisoned MAX (special / runoff / other) ===");
  const byCause = { special: [] as string[], runoff: [] as string[], house: [] as string[], other: [] as string[] };
  for (const st of poisoned) {
    const mx = maxByState.get(st);
    const rows = prims.filter((p) => p.state === st && p.primary_date === mx);
    for (const r of rows) {
      // Order matters: specials are senate-id-only and runoff is a round, so a
      // poisoned house-{ST}-{dd} PRIMARY row falls through both and would land in
      // "other" without the house check — but it is the named feedback mechanism.
      const cause = isSpecial(r.id)
        ? "special"
        : r.election_round === "runoff"
          ? "runoff"
          : r.chamber === "house"
            ? "house"
            : "other";
      byCause[cause].push(`${r.id}(${r.election_round})`);
      console.log(`    ${st} MAX=${mx} ← ${r.id} [round=${r.election_round}] → cause=${cause}`);
    }
  }
  console.log(`  cause tally: special=${byCause.special.length} runoff=${byCause.runoff.length} house=${byCause.house.length} other=${byCause.other.length}`);
  console.log(`  → if runoff>0, every state with a post-primary runoff is exposed and this is NOT an SC story.`);
  console.log(`  → if house>0, a house-{ST}-{dd} row won MAX: the loop is ALREADY self-sustaining and the special is no longer the active cause (the most consequential result).\n`);

  // ── M1c — which house rows actually inherited the poison ────────────────────
  console.log("=== M1c — house rows that inherited the poisoned date (repo-wide) ===");
  const inherited = prims.filter(
    (p) => p.chamber === "house" && p.election_round === "primary" && regularByState.has(p.state) && p.primary_date !== regularByState.get(p.state),
  );
  console.log(`  disagreeing house rows: ${inherited.length} across ${[...new Set(inherited.map((p) => p.state))].join(", ") || "—"}`);
  for (const p of inherited) console.log(`    ${p.id}: house=${p.primary_date} vs regular=${regularByState.get(p.state)}`);
  console.log("");

  // ── M2 — what the next sync tick would write (calByState MAX per poisoned state) ─
  console.log("=== M2 — what the next sync tick would write (calByState = MAX) ===");
  for (const st of poisoned.length ? poisoned : ["SC"]) {
    console.log(`  ${st}: would write ${maxByState.get(st)} to every ${st} house row (correct = ${regularByState.get(st)}) → ${maxByState.get(st) === regularByState.get(st) ? "OK" : "CLOBBER — undoes any repair next tick"}`);
  }
  console.log("");

  // ── M3 — guard asymmetry (code fact) ────────────────────────────────────────
  console.log("=== M3 — guard asymmetry (verified in code) ===");
  console.log("  Senate path primaries-sync.ts:707 calls `if (await isSettled(db, primaryId, today)) { continue; }` before the delete-rebuild.");
  console.log("  House path primaries-sync.ts:1062 does `ON CONFLICT(id) DO UPDATE SET primary_date=excluded...` with NO isSettled call.");
  console.log("  → same poisoned calByState input, one path guarded, one not.\n");

  // ── M4 — kill/confirm: isSettled predicate (past-dated AND >=1 recorded share) ─
  console.log("=== M4 — isSettled predicate for the key SC rows (past AND >=1 vote_pct share) ===");
  const settled = async (id: string) => {
    const rs = await db.execute({
      sql: ro(`SELECT (p.primary_date < ?) AS past,
                  EXISTS(SELECT 1 FROM primary_candidates pc WHERE pc.primary_id=p.id AND pc.vote_pct IS NOT NULL) AS hasShare,
                  p.primary_date
               FROM primaries p WHERE p.id = ?`),
      args: [TODAY, id],
    });
    return rs.rows[0];
  };
  for (const id of ["senate-SC-2026-R", "senate-SC-2026-D", "senate-SC-2026-special-R", "house-SC-01-2026-R", "house-SC-01-2026-D"]) {
    const r = await settled(id);
    if (!r) { console.log(`  ${id}: ABSENT`); continue; }
    const isSet = Number(r.past) === 1 && Number(r.hasShare) === 1;
    console.log(`  ${id}: date=${r.primary_date} past=${r.past} hasShare=${r.hasShare} → isSettled=${isSet}`);
  }
  console.log("");

  // ── M5 — live /primaries impact (getUpcomingPrimaries: date>=today & round=primary) ─
  console.log("=== M5 — live /primaries impact ===");
  const wrongUpcoming = prims.filter(
    (p) => p.chamber === "house" && p.election_round === "primary" && p.primary_date != null && p.primary_date >= TODAY && regularByState.has(p.state) && p.primary_date !== regularByState.get(p.state),
  );
  console.log(`  house rows wrongly rendering as UPCOMING (date>=today, round=primary, != regular): ${wrongUpcoming.length} (states: ${[...new Set(wrongUpcoming.map((p) => p.state))].join(",") || "—"})`);
  for (const st of poisoned) {
    const pastHouse = prims.filter((p) => p.state === st && p.chamber === "house" && p.primary_date != null && p.primary_date < TODAY).length;
    console.log(`  ${st} house rows still dated in the PAST (should be the regular ${regularByState.get(st)}): ${pastHouse} → ${pastHouse === 0 ? "the past contest DISAPPEARED from /primaries (row moved forward)" : "some remain"}`);
  }
  console.log("  Member hub is unaffected (HO 576 reads the statewide senate row only; district rows aren't reached) — verify no house-{st} id is queried by getPrimaryForRace.\n");

  // ── M6 — recoverability (check "regular row's date" FIRST) ───────────────────
  console.log("=== M6 — recoverability ===");
  for (const st of poisoned.length ? poisoned : ["SC"]) {
    console.log(`  ${st}: correct house date = the regular statewide row's date = ${regularByState.get(st)} — DERIVABLE from stored data (senate-${st}-2026-* regular row), no re-fetch → repair is an UPDATE.`);
  }
  const scHouseIds = prims.filter((p) => p.state === "SC" && p.chamber === "house").map((p) => p.id);
  if (scHouseIds.length) {
    const shareRs = await db.execute({ sql: ro(`SELECT COUNT(DISTINCT primary_id) AS n FROM primary_candidates WHERE vote_pct IS NOT NULL AND primary_id IN (${scHouseIds.map(() => "?").join(",")})`), args: scHouseIds });
    const rosterRs = await db.execute({ sql: ro(`SELECT COUNT(DISTINCT primary_id) AS n FROM primary_candidates WHERE primary_id IN (${scHouseIds.map(() => "?").join(",")})`), args: scHouseIds });
    console.log(`  SC house rows: ${scHouseIds.length} · roster on ${Number(rosterRs.rows[0]!.n)} · recorded shares on ${Number(shareRs.rows[0]!.n)}.`);
    console.log(`     After repair to ${regularByState.get("SC")}: a SHARELESS past-dated row is NOT isSettled, so an isSettled-only House guard would still NOT protect it — which is exactly why the calByState MAX must be fixed FIRST (root), the guard SECOND (propagation).`);
  }
  console.log("");

  // ── M7 — statewide regular senate row coverage (decides Part 1 (a) vs (b)) ──
  // (a) = MAX filtered by election_round='primary' + non-special + district IS NULL
  // resolves to the calendar-seeded statewide senate row. That is only correct if such
  // a row EXISTS for every state that owns house rows. HO 209 gated senate seeding to
  // 35 states, so the CODE prior is ~15 gaps — but stale pre-gate rows may have
  // survived the gate landing; only prod data settles it.
  console.log("=== M7 — states owning house rows that LACK a clean statewide senate row ===");
  const houseStates = new Set(prims.filter((p) => p.chamber === "house").map((p) => p.state));
  const hasRegularSenate = new Set(
    prims
      .filter((p) => isRegularSenate(p) && p.district == null && p.primary_date != null)
      .map((p) => p.state),
  );
  const m7gaps = [...houseStates].filter((s) => !hasRegularSenate.has(s)).sort();
  console.log(`  states owning house rows: ${houseStates.size}`);
  console.log(`  of those WITH a clean statewide senate row (district NULL, round=primary, non-special): ${[...houseStates].filter((s) => hasRegularSenate.has(s)).length}`);
  console.log(`  GAPS (house rows but NO clean senate source): ${m7gaps.length} → ${m7gaps.join(", ") || "—"}`);
  console.log(`  → 0 gaps: HO 209 objection is stale, Part 1 = (a) [MAX + round=primary + non-special + district IS NULL], no calendar plumbing needed.`);
  console.log(`  → gaps: (b) is forced for the gap states — plumb the scraped calendar into the house sync for those.\n`);

  console.log("Diagnostic is read-only (every db.execute is a guarded SELECT).");
}

main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
