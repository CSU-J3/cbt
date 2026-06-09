// HO 224 verification (read-only). Three checks on the district-geo helper:
//  1. RENDER: project MT/AZ/CA/NC via getStateDistrictGeometry → one HTML to
//     eyeball each state's own Albers fit (not a composite slice) and that every
//     district is individually shaped + present (esp. CA's LA-basin 26-52).
//  2. JOIN: every getRacesIndex(2026) House seat must resolve to a committed
//     district polygon ({ST}-{DD} ↔ STATEFP/CD119FP), and vice-versa cleanly.
//  3. UNIT: districtSeatId / seatIdToDistrict round-trip + at-large null.
// Run: `npx tsx scripts/diagnostic/district-render-224.ts`
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { getDb } from "../../lib/db";
import {
  districtSeatId,
  getStateDistrictGeometry,
  listDistrictStates,
  seatIdToDistrict,
} from "../../lib/district-geo";

async function main() {
  // ── 1. RENDER ──────────────────────────────────────────────────────────
  const STATES = ["MT", "AZ", "CA", "NC"];
  const FILLS = ["#2b3a55", "#3a4d6e", "#4a6088", "#5a73a2"];
  const cells = STATES.map((abbr) => {
    const g = getStateDistrictGeometry(abbr);
    if (!g) return `<div>NO GEOMETRY ${abbr}</div>`;
    const paths = g.districts
      .map((d, i) => `<path d="${d.d}" fill="${FILLS[i % FILLS.length]}" stroke="#0a0e14" stroke-width="0.6"/>`)
      .join("");
    const labels = g.districts
      .map((d) => `<text x="${d.cx.toFixed(1)}" y="${d.cy.toFixed(1)}" font-size="9" fill="#e5e7eb" text-anchor="middle" dominant-baseline="central">${d.cd}</text>`)
      .join("");
    return `<div><div style="color:#fbbf24;font-size:12px">${abbr} · ${g.districts.length} districts${g.atLarge ? " · AT-LARGE" : ""}</div><svg viewBox="${g.viewBox}" width="460" height="345" style="background:#0a0e14;border:1px solid #1f2937">${paths}${labels}</svg></div>`;
  }).join("");
  writeFileSync(
    "scripts/diagnostic/district-render-224.html",
    `<!doctype html><body style="background:#050709;font-family:monospace;margin:0;padding:16px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">${cells}</div></body>`,
  );
  console.log("RENDER -> scripts/diagnostic/district-render-224.html");
  for (const abbr of STATES) {
    const g = getStateDistrictGeometry(abbr)!;
    const empties = g.districts.filter((d) => !d.d).length;
    console.log(`  ${abbr}: ${g.districts.length} districts · atLarge=${g.atLarge} · emptyPaths=${empties}`);
  }

  // ── 2. JOIN ────────────────────────────────────────────────────────────
  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT r.id, r.state, r.district FROM races r
          INNER JOIN race_ratings rr ON rr.race_id=r.id AND rr.cycle=r.cycle
          WHERE r.cycle=2026 AND r.chamber='house' GROUP BY r.id`,
    args: [],
  });
  let matched = 0;
  const missing: string[] = [];
  for (const row of rs.rows) {
    const st = row.state as string;
    const dd = String(row.district ?? 0).padStart(2, "0");
    const g = getStateDistrictGeometry(st);
    const hit = g?.districts.some((d) => d.cd === dd && d.seatId === (row.id as string));
    if (hit) matched++;
    else missing.push(`${row.id} (looked for ${st}/${dd})`);
  }
  console.log(`\nJOIN: ${matched}/${rs.rows.length} House race rows resolve to a district polygon`);
  if (missing.length) console.log("  MISSING:", missing.join(", "));
  else console.log("  ✓ every House seat resolves");

  // ── 3. UNIT ──────────────────────────────────────────────────────────────
  console.log("\nUNIT:");
  console.log(`  districtSeatId('NC','01') = ${districtSeatId("NC", "01")} (expect NC-01-2026)`);
  console.log(`  districtSeatId('WY','00') = ${districtSeatId("WY", "00")} (expect null — at-large render-only)`);
  console.log(`  seatIdToDistrict('NC-01-2026') = ${JSON.stringify(seatIdToDistrict("NC-01-2026"))}`);
  console.log(`  seatIdToDistrict('S-GA-2026') = ${JSON.stringify(seatIdToDistrict("S-GA-2026"))} (expect null — Senate)`);
  console.log(`  district states covered: ${listDistrictStates().length} (50 expected; at-large states present as single 00)`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
