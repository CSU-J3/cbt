// HO 410/411 — READ-ONLY audit: senator election-year integrity vs terms[].class.
// No writes. Finds wrong next_election_year / current_term_end_year across
// current senators and traces which S-*-2026 race cards backfill-races would
// corrupt. Class comes from unitedstates/congress-legislators
// legislators-current.yaml (last terms[] entry).
//
// HO 411 promoted this to the PERMANENT regression guard for the derive-from-
// class fix (sync-members.ts). The expected year-pairs are computed from the
// SAME helper the sync uses (lib/derive-term.ts::senateYearsFromClass), so this
// guard does NOT re-rot after November — and OH/FL-style special elections are
// EXPECTED exceptions, sourced from data/senate-special-elections.json (they
// legitimately break ney = ctey-1) and won't flag when correct. Success = 0
// flagged mismatches in §2, §1 impossible-values = 0, §4 clean.
//
//   npx tsx scripts/diagnostic/senator-year-audit-410.ts
import "dotenv/config";
import yaml from "js-yaml";
import specialElectionsData from "../../data/senate-special-elections.json";
import { getDb } from "../../lib/db";
import { isPastElectionDay, senateYearsFromClass } from "../../lib/derive-term";

const RAW =
  "https://raw.githubusercontent.com/unitedstates/congress-legislators/main";

const NOW = new Date();

// Cycle-scoped special elections (data/senate-special-elections.json), keyed by
// bioguide, dropping any already-voted — the exact gate sync-members applies.
type SpecialElection = {
  state?: string;
  bioguide?: string;
  next_election_year?: number;
  current_term_end_year?: number;
};
const specialFloor = NOW.getUTCFullYear() + (isPastElectionDay(NOW) ? 1 : 0);
const SPECIAL_BY_BIOGUIDE = new Map<string, SpecialElection>();
for (const e of specialElectionsData as SpecialElection[]) {
  if (!e.bioguide || e.next_election_year == null) continue;
  if (e.next_election_year < specialFloor) continue;
  SPECIAL_BY_BIOGUIDE.set(e.bioguide, e);
}
const SPECIAL_STATES = new Set(
  [...SPECIAL_BY_BIOGUIDE.values()].map((e) => e.state),
);

// Expected (ney, ctey) for a senator: special election wins, else class default.
function expectedYears(
  bioguide: string,
  cls: number | undefined,
): { ney: number | undefined; ctey: number | undefined } {
  const sp = SPECIAL_BY_BIOGUIDE.get(bioguide);
  if (sp) return { ney: sp.next_election_year, ctey: sp.current_term_end_year };
  const y = cls != null ? senateYearsFromClass(cls, NOW) : null;
  return { ney: y?.nextElection, ctey: y?.termEnd };
}

type Term = { type?: string; class?: number; end?: string; state?: string };
type Legislator = {
  id?: { bioguide?: string };
  name?: { official_full?: string; first?: string; last?: string };
  terms?: Term[];
};

type YamlSen = {
  bioguide: string;
  name: string;
  state: string;
  cls: number | undefined;
  termEndYear: number | undefined;
};

type MemRow = {
  bioguide: string;
  name: string;
  state: string;
  is_current: number;
  ney: number | null;
  ctey: number | null;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  return Number(v);
}

async function main() {
  const db = getDb();

  // ---- 1. Pull class from the yaml (last terms[] entry). ----
  const res = await fetch(`${RAW}/legislators-current.yaml`);
  if (!res.ok) throw new Error(`legislators-current.yaml HTTP ${res.status}`);
  const records = yaml.load(await res.text()) as Legislator[];
  if (!Array.isArray(records) || records.length === 0)
    throw new Error("empty yaml");

  const yamlSen = new Map<string, YamlSen>();
  const yamlAll = new Set<string>();
  for (const rec of records) {
    const bio = rec.id?.bioguide;
    if (!bio) continue;
    yamlAll.add(bio);
    const terms = rec.terms ?? [];
    const last = terms[terms.length - 1];
    if (!last || last.type !== "sen") continue; // current senators only
    const name =
      rec.name?.official_full ??
      `${rec.name?.first ?? ""} ${rec.name?.last ?? ""}`.trim();
    yamlSen.set(bio, {
      bioguide: bio,
      name,
      state: last.state ?? "",
      cls: typeof last.class === "number" ? last.class : undefined,
      termEndYear: last.end ? Number(last.end.slice(0, 4)) : undefined,
    });
  }
  console.log(
    `yaml: ${records.length} legislators, ${yamlSen.size} current senators`,
  );

  // ---- members senators ----
  const mem = await db.execute(
    "SELECT bioguide_id, name, state, is_current, next_election_year, current_term_end_year FROM members WHERE chamber = 'senate'",
  );
  const senators: MemRow[] = mem.rows.map((r) => ({
    bioguide: String(r.bioguide_id),
    name: String(r.name),
    state: String(r.state),
    is_current: Number(r.is_current),
    ney: num(r.next_election_year),
    ctey: num(r.current_term_end_year),
  }));
  const current = senators.filter((s) => s.is_current === 1);
  console.log(
    `members: ${senators.length} senate rows, ${current.length} is_current=1\n`,
  );

  // ================= SECTION 3 (live impact — first) =================
  console.log("======== SECTION 3 · RACE BLAST RADIUS (S-*-2026) ========");
  const racesRes = await db.execute(
    "SELECT id, state, incumbent_bioguide_id FROM races WHERE id LIKE 'S-%-2026' ORDER BY state",
  );
  // derivation candidates: current senators at ney=2026 per state. This MUST
  // match backfill-races.ts's WHERE (is_current = 1) — the two count the same
  // population, so a clean audit here means backfill can't seed a wrong/dup
  // incumbent from a departed senator's fallback year.
  const derivByState = new Map<string, MemRow[]>();
  for (const s of senators.filter((s) => s.ney === 2026 && s.is_current === 1)) {
    const arr = derivByState.get(s.state) ?? [];
    arr.push(s);
    derivByState.set(s.state, arr);
  }
  const wrongCards: string[] = [];
  const ambiguous: string[] = [];
  console.log(`races S-*-2026: ${racesRes.rows.length}`);
  for (const row of racesRes.rows) {
    const id = String(row.id);
    const state = String(row.state);
    const seeded = row.incumbent_bioguide_id
      ? String(row.incumbent_bioguide_id)
      : "(null)";
    const cands = derivByState.get(state) ?? [];
    if (cands.length !== 1) {
      ambiguous.push(`${id}: ${cands.length} senate rows @ ney=2026`);
    }
    for (const c of cands) {
      const y = yamlSen.get(c.bioguide);
      const cls = y?.cls ?? "?";
      const special = SPECIAL_STATES.has(state);
      const rightSeat = cls === 2 || special;
      const tag = rightSeat
        ? special
          ? "OK (special OH/FL)"
          : "OK"
        : "*** WRONG SEAT ***";
      if (!rightSeat)
        wrongCards.push(
          `${id} → derived ${c.bioguide} ${c.name} (class ${cls}, is_current=${c.is_current})`,
        );
      console.log(
        `  ${id}  seeded=${seeded}  derived=${c.bioguide} ${c.name}  class=${cls}  is_current=${c.is_current}  → ${tag}`,
      );
    }
    if (cands.length === 0)
      console.log(`  ${id}  seeded=${seeded}  derived=(NONE) → ambiguous/none`);
  }
  console.log(`\n  WRONG cards (derived class≠2, not OH/FL): ${wrongCards.length}`);
  wrongCards.forEach((w) => console.log(`    - ${w}`));
  console.log(`  AMBIGUOUS (0 or >1 @ ney=2026): ${ambiguous.length}`);
  ambiguous.forEach((a) => console.log(`    - ${a}`));

  // ---- yaml-truth cross-check: what SHOULD the 2026 races be, vs displayed ----
  console.log("\n  -- yaml-truth vs displayed (the fix worklist) --");
  // true 2026 seats: class-2 senators + OH/FL specials (class-3 up in 2026)
  const true2026 = [...yamlSen.values()].filter(
    (y) => y.cls === 2 || (SPECIAL_STATES.has(y.state) && y.cls === 3),
  );
  const raceById = new Map(
    racesRes.rows.map((r) => [String(r.id), r.incumbent_bioguide_id ? String(r.incumbent_bioguide_id) : "(null)"]),
  );
  const trueStates = new Set(true2026.map((y) => y.state));
  let displayedRight = 0;
  const displayedWrong: string[] = [];
  const missingRace: string[] = [];
  for (const y of true2026) {
    const id = `S-${y.state}-2026`;
    if (!raceById.has(id)) {
      missingRace.push(`${id}: NO race row (true incumbent ${y.bioguide} ${y.name}, class ${y.cls})`);
      continue;
    }
    const shown = raceById.get(id)!;
    if (shown === y.bioguide) displayedRight++;
    else
      displayedWrong.push(
        `${id}: shows ${shown}, should be ${y.bioguide} ${y.name} (class ${y.cls})`,
      );
  }
  // phantom: S-*-2026 race whose state has no true class-2/special seat
  const phantom = racesRes.rows
    .map((r) => ({ id: String(r.id), state: String(r.state) }))
    .filter((r) => !trueStates.has(r.state));
  console.log(`  true 2026 seats (class-2 + OH/FL): ${true2026.length}  | S-*-2026 race rows: ${racesRes.rows.length}`);
  console.log(`  displayed CORRECT: ${displayedRight}`);
  console.log(`  displayed WRONG incumbent: ${displayedWrong.length}`);
  displayedWrong.forEach((w) => console.log(`    - ${w}`));
  console.log(`  MISSING race row (true seat, no card): ${missingRace.length}`);
  missingRace.forEach((m) => console.log(`    - ${m}`));
  console.log(`  PHANTOM race (state not up in 2026): ${phantom.length}`);
  phantom.forEach((p) => console.log(`    - ${p.id} (${p.state})`));

  // ================= SECTION 1 (impossible values) =================
  // ney must be even; ney = ctey-1 for REGULAR seats. Special elections
  // (OH/FL 2026: ney=2026, ctey=2029) legitimately break the invariant, so
  // they're exempt from the ney≠ctey-1 check (but still must have an even ney).
  console.log("\n======== SECTION 1 · IMPOSSIBLE VALUES (current senators) ========");
  const impossible = current.filter((s) => {
    const odd = s.ney != null && s.ney % 2 !== 0;
    const special = SPECIAL_BY_BIOGUIDE.has(s.bioguide);
    const invariant =
      !special && s.ney != null && s.ctey != null && s.ney !== s.ctey - 1;
    return odd || invariant;
  });
  console.log(`count: ${impossible.length}`);
  for (const s of impossible) {
    const why = [];
    if (s.ney != null && s.ney % 2 !== 0) why.push("odd ney");
    if (
      !SPECIAL_BY_BIOGUIDE.has(s.bioguide) &&
      s.ney != null &&
      s.ctey != null &&
      s.ney !== s.ctey - 1
    )
      why.push("ney≠ctey-1");
    console.log(
      `  ${s.bioguide} ${s.name} (${s.state})  ney=${s.ney}  ctey=${s.ctey}  [${why.join(", ")}]`,
    );
  }

  // ================= SECTION 2 (class cross-check) =================
  console.log("\n======== SECTION 2 · CLASS CROSS-CHECK ========");
  let matched = 0;
  const missingFromYaml: MemRow[] = [];
  const flagged: string[] = [];
  const specials: string[] = [];
  console.log(
    "  bioguide · name · state · class · storedNey · expNey · yamlTermEnd · storedCtey · expTermEnd",
  );
  for (const s of current) {
    const y = yamlSen.get(s.bioguide);
    if (!y) {
      missingFromYaml.push(s);
      continue;
    }
    matched++;
    const cls = y.cls;
    const { ney: expNey, ctey: expEnd } = expectedYears(s.bioguide, cls);
    const special = SPECIAL_BY_BIOGUIDE.has(s.bioguide);
    const mismatch = s.ney !== expNey || s.ctey !== expEnd;
    const line = `  ${s.bioguide} ${s.name} ${s.state} · class ${cls} · ney ${s.ney} · exp ${expNey} · yamlEnd ${y.termEndYear} · ctey ${s.ctey} · expEnd ${expEnd}`;
    if (mismatch && special) {
      specials.push(line + "  [OH/FL special]");
    } else if (mismatch) {
      flagged.push(line + "  *** MISMATCH ***");
    }
  }
  console.log(`  senators audited (is_current=1): ${current.length}`);
  console.log(`  matched to yaml: ${matched}`);
  console.log(`  missing from yaml (in members is_current=1, not in yaml senators): ${missingFromYaml.length}`);
  missingFromYaml.forEach((s) =>
    console.log(`    - ${s.bioguide} ${s.name} (${s.state})`),
  );
  console.log(`  FLAGGED mismatches (excl OH/FL): ${flagged.length}`);
  flagged.forEach((f) => console.log(f));
  console.log(`  OH/FL specials listed separately: ${specials.length}`);
  specials.forEach((f) => console.log(f));

  // stored ney=2026 with class≠2 that isn't OH/FL (extra-special / bug surfacing)
  const oddSpecials = current
    .filter((s) => s.ney === 2026)
    .map((s) => ({ s, y: yamlSen.get(s.bioguide) }))
    .filter(({ s, y }) => y?.cls !== 2 && !SPECIAL_STATES.has(s.state));
  console.log(`  stored ney=2026 & class≠2 & not OH/FL: ${oddSpecials.length}`);
  oddSpecials.forEach(({ s, y }) =>
    console.log(`    - ${s.bioguide} ${s.name} (${s.state}) class=${y?.cls ?? "?"}`),
  );

  // ================= SECTION 4 (is_current reconciliation) =================
  console.log("\n======== SECTION 4 · is_current RECONCILIATION ========");
  const inMembersNotYaml = current.filter((s) => !yamlAll.has(s.bioguide));
  console.log(
    `  A. is_current=1 in members but ABSENT from yaml (departed → should be 0): ${inMembersNotYaml.length}`,
  );
  inMembersNotYaml.forEach((s) =>
    console.log(`    - ${s.bioguide} ${s.name} (${s.state})`),
  );
  const memById = new Map(senators.map((s) => [s.bioguide, s]));
  const inYamlNotCurrent: string[] = [];
  for (const [bio, y] of yamlSen) {
    const m = memById.get(bio);
    if (!m) inYamlNotCurrent.push(`${bio} ${y.name} (${y.state}) — MISSING from members`);
    else if (m.is_current !== 1)
      inYamlNotCurrent.push(`${bio} ${y.name} (${y.state}) — is_current=0`);
  }
  console.log(
    `  B. yaml senator but is_current=0/missing in members (should be current): ${inYamlNotCurrent.length}`,
  );
  inYamlNotCurrent.forEach((s) => console.log(`    - ${s}`));

  const mullin = memById.get("M001190");
  console.log(
    `  sanity — Mullin M001190: is_current=${mullin?.is_current ?? "?"}, in yaml=${yamlAll.has("M001190")} (expect is_current=0, not in yaml → correct, not an error)`,
  );
}

main().catch((e) => {
  console.error("ERR", e);
  process.exit(1);
});
