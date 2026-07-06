// HO 419 — ideology coverage diagnostic (READ-ONLY). Retires the "~60% native
// via ICPSR" assumption by reporting the real match rate of member_ideology vs
// CURRENT members, plus the estimate-quality counts and the party_code quirks. No
// writes.
//
// Re-fetches the Voteview file (same source as the sync) for the two numbers that
// aren't stored in member_ideology: the off-roster skip count and the party_code-
// vs-members.party disagreements. Mirrors crosswalk-coverage-402.ts.
//
// Run after `sync:ideology`:  npx tsx scripts/diagnostic/ideology-coverage-419.ts
import "dotenv/config";
import { getDb } from "../../lib/db";
import { fetchVoteview119 } from "../voteview-source";

type Db = ReturnType<typeof getDb>;

async function scalar(db: Db, sql: string): Promise<number> {
  const r = await db.execute(sql);
  const v = r.rows[0] ? Object.values(r.rows[0])[0] : 0;
  return typeof v === "number" ? v : Number(v ?? 0);
}

// Voteview party_code -> the members.party letter (100=D, 200=R, 328=I). Anything
// else is a minor/independent code — treat as 'I' for the comparison.
function partyLetter(code: number | null): "D" | "R" | "I" {
  if (code === 100) return "D";
  if (code === 200) return "R";
  return "I";
}

// Independents who caucus with a major party. DW-NOMINATE's party_code follows
// CAUCUS, not registration, so these disagree with members.party='I' by design
// (e.g. Kiley switched R->I 2026-03-09 but still caucuses R, so Voteview codes 200).
// Only independents caucusing with a major party need an entry; a newly seated one
// surfaces as a disagreement until added — intended fail-loud, not a silent skip.
const INDEPENDENT_CAUCUS: Record<string, "D" | "R"> = {
  K000383: "D", // Angus King (ME) -> caucuses Democratic
  S000033: "D", // Bernie Sanders (VT) -> caucuses Democratic
  K000401: "R", // Kevin Kiley (CA) -> reg I since 2026-03-09, caucuses Republican
};

async function main() {
  const db = getDb();

  const current = await scalar(
    db,
    "SELECT COUNT(*) FROM members WHERE is_current = 1",
  );
  const matched = await scalar(db, "SELECT COUNT(*) FROM member_ideology");
  const nullDim1 = await scalar(
    db,
    "SELECT COUNT(*) FROM member_ideology WHERE nominate_dim1 IS NULL",
  );
  const provisional = await scalar(
    db,
    "SELECT COUNT(*) FROM member_ideology WHERE conditional = 1",
  );

  // Membership set + party letter for the off-roster + party-disagreement passes.
  const memRes = await db.execute(
    "SELECT bioguide_id, name, party FROM members",
  );
  const party = new Map<string, string | null>();
  const nameOf = new Map<string, string>();
  for (const r of memRes.rows) {
    const b = r.bioguide_id as string;
    party.set(b, (r.party as string | null) ?? null);
    nameOf.set(b, (r.name as string | null) ?? "");
  }

  // Re-fetch Voteview: off-roster skips (raw rows, matching the sync counter) and
  // party_code disagreements (against the gated-in, votes-deduped pick).
  const rows = await fetchVoteview119();
  let offRoster = 0;
  const best = new Map<string, (typeof rows)[number]>();
  for (const m of rows) {
    if (!m.bioguide_id || !party.has(m.bioguide_id)) {
      offRoster++;
      continue;
    }
    const prev = best.get(m.bioguide_id);
    if (!prev || (m.number_of_votes ?? -1) > (prev.number_of_votes ?? -1)) {
      best.set(m.bioguide_id, m);
    }
  }

  const disagreements: { bioguide: string; name: string; vv: string; mem: string }[] =
    [];
  for (const m of best.values()) {
    const mem = party.get(m.bioguide_id) ?? null;
    const vv = partyLetter(m.party_code);
    const caucus = INDEPENDENT_CAUCUS[m.bioguide_id];
    // Flag only when Voteview's letter matches NEITHER registration NOR caucus.
    // This suppresses the structural reg-vs-caucus gap (King/Sanders VV=I=reg;
    // Kiley VV=R=caucus) while still catching a genuine sync/ID mismatch
    // (VV=D but reg=R and caucus=R -> matches neither -> flagged).
    if (mem && vv !== mem && vv !== caucus) {
      disagreements.push({
        bioguide: m.bioguide_id,
        name: nameOf.get(m.bioguide_id) ?? m.bioname,
        vv,
        mem,
      });
    }
  }
  disagreements.sort((a, b) => a.bioguide.localeCompare(b.bioguide));

  const pct = (n: number, d: number) =>
    d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "—";

  console.log("=== HO 419 IDEOLOGY COVERAGE ===\n");
  console.log(`members current (is_current=1) ............ ${current}`);
  console.log(
    `member_ideology rows (matched) ............ ${matched}   (${pct(matched, current)} vs CURRENT)   <- retires the 60% assumption`,
  );
  console.log(
    `  nominate_dim1 IS NULL (no estimate yet) . ${nullDim1}   <- freshmen / too few votes`,
  );
  console.log(
    `  conditional = 1 (provisional estimate) .. ${provisional}`,
  );
  console.log(
    `off-roster skips (Voteview 119th not in members)  ${offRoster}   <- departed mid-term / President`,
  );
  console.log(
    `party_code vs members.party disagreements . ${disagreements.length}   <- genuine party mismatches (registration/caucus gap suppressed)`,
  );
  for (const d of disagreements) {
    console.log(
      `      ${d.bioguide}  ${d.name.padEnd(26)} voteview=${d.vv}  members=${d.mem}`,
    );
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
