// HO 675 STEP 3 — do any of the 25 multi-target promoted blocks carry MIXED
// labels (one twin became law, another did not)? Decides whether the block can
// be ONE bordered element with the label printed once, per ruling 3's wording,
// or must stay one element per target to keep the distinction. READ-ONLY.
import "dotenv/config";
import { createClient } from "@libsql/client";
import { chamberOfBillId, isIdenticalRelationship } from "../../lib/bill-rosters-view";

async function main() {
  const c = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
  const rs = await c.execute(`SELECT bill_id, related_bill_id, relationship_type FROM bill_related_bills`);
  // target -> becameLaw, per source bill, restricted to promoted rows.
  const byBill = new Map<string, Map<string, boolean>>();
  for (const r of rs.rows) {
    const b = String(r.bill_id), t = String(r.related_bill_id), ty = String(r.relationship_type);
    if (!isIdenticalRelationship(ty)) continue;
    const cb = chamberOfBillId(b), ct = chamberOfBillId(t);
    if (!cb || !ct || cb === ct) continue;
    if (!byBill.has(b)) byBill.set(b, new Map());
    const m = byBill.get(b)!;
    m.set(t, (m.get(t) ?? false) || ty.toLowerCase().includes("became law"));
  }
  const multi = [...byBill.entries()].filter(([, m]) => m.size > 1);
  const mixed = multi.filter(([, m]) => new Set([...m.values()]).size > 1);
  console.log(`  bills promoting >1 distinct target : ${multi.length}`);
  console.log(`  ... with MIXED became-law labels   : ${mixed.length}`);
  mixed.slice(0, 10).forEach(([b, m]) =>
    console.log(`    ${b} -> ${[...m.entries()].map(([t, l]) => t + (l ? " (law)" : "")).join(", ")}`));
  // CONTROL: the instrument can see a became-law target at all.
  const anyLaw = [...byBill.values()].filter((m) => [...m.values()].some(Boolean)).length;
  console.log(`  CONTROL bills with >=1 became-law promoted target: ${anyLaw} (non-zero -> mixed=0 is a reading)`);
}
main().catch((e) => { console.error(e); process.exit(1); });
