// HO 576 STEP 0 — getPrimaryForRace coverage + soonest-future delta (READ-ONLY).
//
// The bug: lib/queries.ts:1535-1537 reconstructs the primaries row id by string
// (`senate-${state}-2026-${party}`), so it structurally cannot reach the
// `-special-` ids (primaries-sync.ts:511) or the `-open` ids (primaries-sync.ts:344).
// The caller (app/members/[bioguideId]/page.tsx:225) always passes district=null,
// so the House id branch is dead in practice — every member reads the statewide
// senate row as a proxy for their own primary date (documented at the call site).
//
// This file WRITES NOTHING. Every db.execute below is a SELECT; a runtime guard
// asserts no INSERT/UPDATE/DELETE/CREATE/DROP/ALTER/REPLACE string is ever executed.
// The PRIMARY_SELECT mirror used for M5 timing is copied from lib/queries.ts at
// a364b48 (candidate GROUP_CONCAT included) purely to price the real query shape.
import "dotenv/config";
import { getDb } from "@/lib/db";

const TODAY = new Date().toISOString().slice(0, 10);

type Prim = {
  id: string;
  state: string;
  district: string | null;
  chamber: string;
  party: string;
  primary_date: string | null;
  election_round: string;
};
type Mem = {
  bioguide: string;
  name: string;
  chamber: string;
  state: string;
  district: number | null;
  party: string;
};

// Read-only guard: refuse to run any non-SELECT statement.
const WRITE = /\b(insert|update|delete|create|drop|alter|replace)\b/i;
function readOnly(sql: string): string {
  if (WRITE.test(sql)) throw new Error(`read-only guard tripped: ${sql.slice(0, 60)}`);
  return sql;
}

// The CURRENT point-lookup id — caller always passes district=null → senate row.
const currentId = (state: string, party: string) => `senate-${state}-2026-${party}`;

// The PROPOSED structured pick: same state + party, election_round='primary',
// soonest FUTURE first, most-recent PAST as fallback (so a member whose primary
// already happened keeps a chip). election_round filter keeps runoff rows out.
// `statewide` (district IS NULL) restricts to the senate-prefixed statewide row
// the current code reconstructs — WITHOUT it the query leaks per-district house
// rows (the HO 576 STEP 0 finding).
function structuredPick(
  rows: Prim[],
  state: string,
  party: string,
  statewide: boolean,
): Prim | null {
  const c = rows.filter(
    (r) =>
      r.state === state &&
      r.party === party &&
      r.election_round === "primary" &&
      (!statewide || r.district == null),
  );
  if (!c.length) return null;
  const future = c
    .filter((r) => r.primary_date != null && r.primary_date >= TODAY)
    .sort((a, b) => a.primary_date!.localeCompare(b.primary_date!));
  if (future.length) return future[0]!;
  const past = c
    .filter((r) => r.primary_date != null && r.primary_date < TODAY)
    .sort((a, b) => b.primary_date!.localeCompare(a.primary_date!));
  if (past.length) return past[0]!;
  return c[0]!; // only null-date rows for this state+party
}

// mirrors lib/queries.ts PRIMARY_SELECT + PRIMARY_CANDIDATE_FIELDS @ a364b48 (M5 only)
const CAND =
  "pc.id || '|' || pc.name || '|' || pc.party || '|' || " +
  "pc.incumbent || '|' || COALESCE(pc.bioguide_id,'') || '|' || " +
  "pc.status || '|' || COALESCE(pc.vote_pct,'')";
const SEL =
  `SELECT p.id, p.state, p.district, p.chamber, p.party,
     p.primary_date, p.runoff_date, p.primary_type, p.race_id,
     GROUP_CONCAT(${CAND}, '~~') AS candidates_raw,
     (SELECT m.bioguide_id FROM members m
        WHERE m.is_current = 1 AND m.chamber = 'house'
          AND m.state = p.state AND m.district = CAST(p.district AS INTEGER)
        LIMIT 1) AS seat_incumbent_bioguide
   FROM primaries p
   LEFT JOIN primary_candidates pc ON pc.primary_id = p.id`;

async function main() {
  const db = getDb();
  console.log(`HO 576 — getPrimaryForRace probe (READ-ONLY). today=${TODAY}\n`);

  const prims: Prim[] = (
    await db.execute(
      readOnly(
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
  const byId = new Map(prims.map((p) => [p.id, p]));

  const members: Mem[] = (
    await db.execute(
      readOnly(
        "SELECT bioguide_id, name, chamber, state, district, party FROM members WHERE is_current = 1 AND party IN ('D','R')",
      ),
    )
  ).rows.map((r) => ({
    bioguide: String(r.bioguide_id),
    name: String(r.name),
    chamber: String(r.chamber),
    state: String(r.state),
    district: r.district == null ? null : Number(r.district),
    party: String(r.party),
  }));

  const rounds = new Map<string, number>();
  for (const p of prims) rounds.set(p.election_round, (rounds.get(p.election_round) ?? 0) + 1);
  console.log(`primaries rows: ${prims.length} | current D/R members: ${members.length}`);
  console.log(`election_round: ${[...rounds].map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  console.log(
    `id shapes: -open=${prims.filter((p) => p.id.endsWith("-2026-open")).length} · -special-=${prims.filter((p) => p.id.includes("-special-")).length}\n`,
  );

  // ── M1 — today's coverage ────────────────────────────────────────────────
  const nulls: Mem[] = [];
  let hit = 0;
  for (const m of members) {
    if (byId.get(currentId(m.state, m.party))) hit++;
    else nulls.push(m);
  }
  console.log("=== M1 — today's coverage (current point-lookup, district=null) ===");
  console.log(`  row returned: ${hit} | null: ${nulls.length}\n`);

  // ── M2 — why the nulls (per distinct state+party) ────────────────────────
  console.log("=== M2 — why the nulls (per distinct state+party) ===");
  const seen = new Set<string>();
  const m2 = { noState: [] as string[], onlySpecial: [] as string[], onlyOpen: [] as string[], other: [] as string[] };
  for (const m of nulls) {
    const k = `${m.state}-${m.party}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const sr = prims.filter((p) => p.state === m.state);
    const ids = sr.map((p) => p.id);
    if (!sr.length) m2.noState.push(k);
    else if (sr.every((p) => p.id.includes("-special-"))) m2.onlySpecial.push(`${k} [${ids.join(",")}]`);
    else if (sr.some((p) => p.party === "open") && !sr.some((p) => /^senate-[A-Z]{2}-2026-[DR]$/.test(p.id)))
      m2.onlyOpen.push(`${k} [${ids.filter((i) => i.endsWith("-2026-open")).join(",")}]`);
    else m2.other.push(`${k} [${ids.join(",")}]`);
  }
  console.log(`  (a) no row for state (${m2.noState.length}): ${m2.noState.join(", ") || "—"}`);
  console.log(`  (b) only -special- rows (${m2.onlySpecial.length}): ${m2.onlySpecial.join(" ; ") || "—"}`);
  console.log(`  (c) only an -open row (${m2.onlyOpen.length}): ${m2.onlyOpen.join(" ; ") || "—"}`);
  console.log(`  (d) other id shape (${m2.other.length}): ${m2.other.join(" ; ") || "—"}\n`);

  // ── M3 — the delta (current vs proposed structured pick), BOTH variants ──
  const runDelta = (statewide: boolean) => {
    const b = { unchanged: 0, newly: 0, changed: [] as string[], lost: [] as string[] };
    const changedKeys = new Set<string>();
    for (const m of members) {
      const cur = byId.get(currentId(m.state, m.party)) ?? null;
      const str = structuredPick(prims, m.state, m.party, statewide);
      const cd = cur?.primary_date ?? null;
      const sd = str?.primary_date ?? null;
      if (cur == null && str == null) b.unchanged++;
      else if (cur == null && str != null) b.newly++;
      else if (cur != null && str == null) b.lost.push(`${m.chamber} ${m.state}-${m.party}`);
      else if (cd === sd && cur!.id === str!.id) b.unchanged++;
      else {
        const key = `${m.state}-${m.party}`;
        if (!changedKeys.has(key)) {
          changedKeys.add(key);
          const chambers = [...new Set(members.filter((x) => x.state === m.state && x.party === m.party).map((x) => x.chamber))].join("+");
          b.changed.push(`    ${m.state}-${m.party} (${chambers}): ${cur!.id}@${cd} → ${str!.id}@${sd}`);
        }
      }
    }
    return b;
  };
  console.log("=== M3 — delta: current point-lookup vs proposed structured pick ===");
  for (const [label, statewide] of [["M3a NAIVE (state+party+round — as handoff proposed)", false], ["M3b STATEWIDE (+ district IS NULL — the senate-proxy the caller wants)", true]] as const) {
    const b = runDelta(statewide);
    console.log(`  ${label}:`);
    console.log(`    unchanged: ${b.unchanged} | newly-populated: ${b.newly} | date-changed keys: ${b.changed.length} | lost-chip: ${b.lost.length}`);
    console.log(b.changed.length ? b.changed.join("\n") : "    (no date changes)");
    if (b.lost.length) console.log(`    LOST-CHIP (regression): ${b.lost.join(", ")}`);
  }
  console.log(
    "  NOTE: M3a's extra 'newly-populated' + GA change come from per-district `house-*` rows leaking in (no chamber/district filter); M3b restricts to the statewide senate row and isolates the true delta.\n",
  );

  // ── M4 — the SC case, concretely ─────────────────────────────────────────
  console.log("=== M4 — SC case ===");
  for (const id of ["senate-SC-2026-R", "senate-SC-2026-D", "senate-SC-2026-special-R", "senate-SC-2026-special-D"]) {
    const p = byId.get(id);
    console.log(`  ${id}: ${p ? `date=${p.primary_date} round=${p.election_round}` : "ABSENT"}`);
  }
  const scMembers = members.filter((m) => m.state === "SC");
  const scSen = scMembers.filter((m) => m.chamber === "senate").slice(0, 2);
  const scHouse = scMembers.filter((m) => m.chamber === "house").slice(0, 2);
  for (const m of [...scSen, ...scHouse]) {
    const cur = byId.get(currentId(m.state, m.party)) ?? null;
    const str = structuredPick(prims, m.state, m.party, true); // statewide (design-correct)
    console.log(`  ${m.chamber.padEnd(6)} ${m.party} ${m.name}: today=${cur?.primary_date ?? "null"} (${cur?.id ?? "—"}) → after(statewide)=${str?.primary_date ?? "null"} (${str?.id ?? "—"})`);
  }
  console.log("  (SC House members are NOT in the Senate special — showing them Aug 11 is the design question the HALT must decide.)\n");

  // ── M5 — cost (point-lookup vs structured), warm-ish, a few iterations ───
  console.log("=== M5 — cost: current point-lookup vs proposed structured query ===");
  const sampleId = "senate-SC-2026-R";
  const pointSql = readOnly(`${SEL} WHERE p.id = ? GROUP BY p.id`);
  const structSql = readOnly(
    `${SEL} WHERE p.state = ? AND p.party = ? AND p.election_round = 'primary'
     GROUP BY p.id
     ORDER BY (CASE WHEN p.primary_date >= ? THEN 0 ELSE 1 END),
              (CASE WHEN p.primary_date >= ? THEN p.primary_date END) ASC,
              p.primary_date DESC
     LIMIT 1`,
  );
  const time = async (label: string, run: () => Promise<unknown>) => {
    const ts: number[] = [];
    for (let i = 0; i < 6; i++) {
      const t0 = performance.now();
      await run();
      ts.push(performance.now() - t0);
    }
    ts.sort((a, b) => a - b);
    console.log(`  ${label}: min=${ts[0]!.toFixed(0)}ms median=${ts[3]!.toFixed(0)}ms max=${ts[5]!.toFixed(0)}ms`);
  };
  await time("point-lookup (WHERE p.id=?)", () => db.execute({ sql: pointSql, args: [sampleId] }));
  await time("structured  (state+party+round, ORDER+LIMIT)", () =>
    db.execute({ sql: structSql, args: ["SC", "R", TODAY, TODAY] }),
  );
  console.log("");

  console.log("callers of getPrimaryForRace: app/members/[bioguideId]/page.tsx:225 (import :34) — sole caller confirmed by grep.");
}

main().catch((e) => {
  console.error(String(e));
  process.exitCode = 1;
});
