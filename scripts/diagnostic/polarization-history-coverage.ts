// HO 427 — polarization-history coverage diagnostic (READ-ONLY). Confirms the
// HSall aggregation landed and, critically, cross-checks the 119th history medians
// against the band's live method. No writes.
//
// THE GATE: history filters party by Voteview party_code (100/200 = CAUCUS);
// getPolarizationBand filters members.party (REGISTRATION). Those are different
// populations for caucusing independents (Kiley -> R, King + Sanders -> D) and for
// mid-term-departed 119th members (in HSall, absent from the current roster). This
// check prints both sides and ATTRIBUTES the delta to that known accounting — it
// does not force equality. If the delta is fully explained by those members, the
// method is sound; a larger or differently-sourced delta is the bug this catches.
// The median is robust to a handful of added members, so the gap likely still reads
// ~0.92/0.92 with the divergence in the third decimal — but the numbers print
// either way.
//
// The band side is replicated INLINE here (the identical query + median method as
// getPolarizationBand), not imported — the cached query isn't callable outside a
// Next request context.
//
// Run after `sync:polarization-history`:
//   npx tsx scripts/diagnostic/polarization-history-coverage.ts
import "dotenv/config";
import { getDb } from "../../lib/db";
import { fetchVoteview119 } from "../voteview-source";
import { median } from "../../lib/median";

type Db = ReturnType<typeof getDb>;

function fmt(v: number | null): string {
  return v == null ? "  null " : (v >= 0 ? "+" : "") + v.toFixed(3);
}
function gapOf(dem: number | null, rep: number | null): number | null {
  return dem != null && rep != null ? Math.abs(rep - dem) : null;
}

async function main() {
  const db = getDb();

  // ---- 1. Coverage: rows, range per chamber -------------------------------
  const total = await db.execute("SELECT COUNT(*) AS n FROM polarization_history");
  console.log("=== HO 427 POLARIZATION-HISTORY COVERAGE ===\n");
  console.log(`rows written ............... ${total.rows[0]?.n ?? 0}`);

  const perChamber = await db.execute(
    `SELECT chamber, COUNT(*) AS n, MIN(congress) AS lo, MAX(congress) AS hi
       FROM polarization_history GROUP BY chamber ORDER BY chamber`,
  );
  for (const r of perChamber.rows) {
    console.log(
      `  ${String(r.chamber).padEnd(6)} ${r.n} congresses, range ${r.lo}..${r.hi}`,
    );
  }

  // ---- 2. Earliest two-party Congress (both medians present) --------------
  const bothStart = await db.execute(
    `SELECT MIN(congress) AS c FROM polarization_history
      WHERE dem_median IS NOT NULL AND rep_median IS NOT NULL`,
  );
  const twoPartyStart = bothStart.rows[0]?.c ?? null;
  console.log(
    `\nearliest Congress with BOTH a D and an R median ... ${twoPartyStart ?? "—"}   (expect 34th, 1855)`,
  );

  // ---- 3. Missing-party Congresses inside the two-party range -------------
  if (twoPartyStart != null) {
    const missing = await db.execute({
      sql: `SELECT congress, chamber,
                   (dem_median IS NULL) AS d_missing, (rep_median IS NULL) AS r_missing
              FROM polarization_history
             WHERE congress >= ?
               AND (dem_median IS NULL OR rep_median IS NULL)
             ORDER BY congress, chamber`,
      args: [twoPartyStart],
    });
    console.log(
      `Congresses inside [${twoPartyStart}..] missing a party ... ${missing.rows.length}   (report, don't fix)`,
    );
    for (const r of missing.rows) {
      const which = r.d_missing ? "no D" : "no R";
      console.log(`      congress ${r.congress} ${r.chamber}: ${which}`);
    }
  }

  // ---- 4. The 119th cross-check: history vs band, with attribution --------
  console.log("\n--- 119th cross-check: history (caucus) vs band (registration) ---");

  // History side: straight from the table.
  const hist = await db.execute(
    `SELECT chamber, dem_median, rep_median FROM polarization_history WHERE congress = 119`,
  );
  const histBy = new Map<string, { dem: number | null; rep: number | null }>();
  for (const r of hist.rows) {
    histBy.set(r.chamber as string, {
      dem: (r.dem_median as number | null) ?? null,
      rep: (r.rep_median as number | null) ?? null,
    });
  }

  // Band side: replicate getPolarizationBand's exact query + method inline.
  const bandRows = await db.execute(
    `SELECT mi.chamber AS chamber, mi.nominate_dim1 AS dim1, m.party AS party
       FROM member_ideology mi JOIN members m ON m.bioguide_id = mi.bioguide_id
      WHERE mi.nominate_dim1 IS NOT NULL`,
  );
  const bandBuckets: Record<string, { dem: number[]; rep: number[] }> = {
    House: { dem: [], rep: [] },
    Senate: { dem: [], rep: [] },
  };
  for (const r of bandRows.rows) {
    const chamber = r.chamber as string;
    const party = r.party as string | null;
    const v = r.dim1 as number | null;
    if (v == null || !bandBuckets[chamber]) continue;
    if (party === "D") bandBuckets[chamber].dem.push(v);
    else if (party === "R") bandBuckets[chamber].rep.push(v);
  }

  // Print side by side. History stores lowercase; the band uses Voteview 'House'.
  for (const [lc, vv] of [
    ["house", "House"],
    ["senate", "Senate"],
  ] as const) {
    const h = histBy.get(lc) ?? { dem: null, rep: null };
    const b = bandBuckets[vv] ?? { dem: [], rep: [] };
    const bDem = median(b.dem);
    const bRep = median(b.rep);
    const hGap = gapOf(h.dem, h.rep);
    const bGap = gapOf(bDem, bRep);
    console.log(`\n  ${vv}`);
    console.log(
      `    history   D ${fmt(h.dem)}  R ${fmt(h.rep)}  gap ${fmt(hGap)}`,
    );
    console.log(
      `    band      D ${fmt(bDem)}  R ${fmt(bRep)}  gap ${fmt(bGap)}`,
    );
    console.log(
      `    delta     D ${fmt(diff(h.dem, bDem))}  R ${fmt(diff(h.rep, bRep))}  gap ${fmt(diff(hGap, bGap))}`,
    );
  }

  // Attribution: enumerate the 119th members history counts (party_code 100/200)
  // that the band's population (member_ideology JOIN members, party in D/R) drops.
  const mi = await db.execute(
    "SELECT bioguide_id FROM member_ideology WHERE nominate_dim1 IS NOT NULL",
  );
  const scored = new Set(mi.rows.map((r) => r.bioguide_id as string));
  const mem = await db.execute("SELECT bioguide_id, name, party FROM members");
  const memParty = new Map<string, string | null>();
  const memName = new Map<string, string>();
  for (const r of mem.rows) {
    memParty.set(r.bioguide_id as string, (r.party as string | null) ?? null);
    memName.set(r.bioguide_id as string, (r.name as string | null) ?? "");
  }

  const rows119 = await fetchVoteview119();
  const independents: string[] = [];
  const departed: string[] = [];
  const flips: string[] = [];
  for (const m of rows119) {
    if (m.nominate_dim1 == null) continue;
    if (m.party_code !== 100 && m.party_code !== 200) continue;
    if (m.chamber !== "House" && m.chamber !== "Senate") continue;
    const histBucket = m.party_code === 100 ? "D" : "R";
    const b = m.bioguide_id;
    if (!b || !scored.has(b)) {
      departed.push(`${b || "(no-bioguide)"} ${m.bioname} -> history ${histBucket}`);
      continue;
    }
    const reg = memParty.get(b) ?? null;
    if (reg !== "D" && reg !== "R") {
      independents.push(
        `${b} ${memName.get(b) || m.bioname} (members=${reg ?? "null"}) -> history ${histBucket}`,
      );
    } else if (reg !== histBucket) {
      flips.push(
        `${b} ${memName.get(b) || m.bioname} (members=${reg}) -> history ${histBucket}`,
      );
    }
  }

  console.log(
    `\n  attribution of the delta (119th members history counts but the band excludes):`,
  );
  console.log(`    caucusing independents (members.party not D/R) ... ${independents.length}`);
  for (const s of independents) console.log(`        ${s}`);
  console.log(`    mid-term-departed / not in member_ideology ...... ${departed.length}`);
  for (const s of departed) console.log(`        ${s}`);
  if (flips.length) {
    console.log(`    party-bucket flips (registered X, caucus Y) ..... ${flips.length}`);
    for (const s of flips) console.log(`        ${s}`);
  }
  console.log(
    `\n  If the delta above is fully explained by these members, the method is sound.`,
  );
}

function diff(a: number | null, b: number | null): number | null {
  return a != null && b != null ? a - b : null;
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
