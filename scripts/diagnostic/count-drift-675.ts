// HO 675 STEP 0 — the visible consequence of HO 674's filed 13.8% drift. The
// handoff forbids "fixing" bills.cosponsor_count here, so the count row keeps
// the stale column while the party groups come from the roster. This measures
// how loudly those two disagree ON SCREEN. READ-ONLY.
import "dotenv/config";
import { createClient } from "@libsql/client";
async function main(){
  const c = createClient({url:process.env.TURSO_DATABASE_URL!,authToken:process.env.TURSO_AUTH_TOKEN});
  const line=(s="")=>console.log(s);
  const r = await c.execute(
    `SELECT b.id, b.cosponsor_count col,
            (SELECT COUNT(*) FROM bill_cosponsors x
              WHERE x.bill_id=b.id AND x.sponsorship_withdrawn_date IS NULL) roster
       FROM bills b
      WHERE b.cosponsor_count IS NOT NULL`);
  let dis=0, tot=0, sumDelta=0; const deltas:number[]=[]; const ex:string[]=[];
  for(const x of r.rows){
    const col=Number(x.col), ros=Number(x.roster);
    tot++;
    if(col!==ros){ dis++; const d=ros-col; deltas.push(d); sumDelta+=d;
      if(ex.length<10) ex.push(`${x.id}  count row ${col}  vs  groups sum ${ros}  (${d>0?"+":""}${d})`); }
  }
  deltas.sort((a,b)=>a-b);
  const q=(p:number)=>deltas[Math.min(deltas.length-1,Math.floor(p*deltas.length))];
  line("─── N1  count row vs the sum of the party groups ────────────────────");
  line(`  bills with a non-null cosponsor_count : ${tot}`);
  line(`  bills where the two DISAGREE          : ${dis}  (${((dis/tot)*100).toFixed(2)}%)`);
  line(`  net                                   : ${sumDelta>0?"+":""}${sumDelta}`);
  line(`  delta distribution (roster - column)  : min ${deltas[0]} · p25 ${q(0.25)} · p50 ${q(0.5)} · p75 ${q(0.75)} · p95 ${q(0.95)} · max ${deltas[deltas.length-1]}`);
  const buckets = [1,2,3,5,10,25,50,100];
  line(`  |delta| <= k : ` + buckets.map(k=>`${k}:${deltas.filter(d=>Math.abs(d)<=k).length}`).join("  "));
  line(`  |delta| >  10: ${deltas.filter(d=>Math.abs(d)>10).length} bills`);
  ex.forEach(s=>line(`    ${s}`));
  // CONTROL: a zero here would be indistinguishable from "the tables are empty".
  const ctl = await c.execute(`SELECT COUNT(*) n FROM bill_cosponsors`);
  line(`  CONTROL bill_cosponsors rows: ${Number(ctl.rows[0]!.n)} (non-zero, so a 0 above would be a reading)`);

  // The two bills STEP 3 must open, per the HO 675 STEP 0 review: one at the
  // median (+1) and one at the tail (the maximum), so the on-screen severity of
  // the disagreement is judged from a capture rather than from this table.
  line();
  line("─── N2  the two STEP 3 capture targets ──────────────────────────────");
  const ranked = r.rows
    .map((x) => ({ id: String(x.id), col: Number(x.col), ros: Number(x.roster) }))
    .filter((x) => x.col !== x.ros)
    .sort((a, b) => b.ros - b.col - (a.ros - a.col));
  const withSummary = await c.execute(
    `SELECT id FROM bills WHERE summary IS NOT NULL`);
  const hasSummary = new Set(withSummary.rows.map((x) => String(x.id)));
  const show = (label: string, x: { id: string; col: number; ros: number } | undefined) =>
    line(x ? `  ${label.padEnd(22)} ${x.id}  count row ${x.col}  groups sum ${x.ros}  (+${x.ros - x.col})`
           : `  ${label.padEnd(22)} (none)`);
  show("MAX delta", ranked.find((x) => hasSummary.has(x.id)));
  show("median delta (+1)", ranked.find((x) => x.ros - x.col === 1 && x.ros >= 4 && x.ros <= 25 && hasSummary.has(x.id)));
  line();
}
main().catch(e=>{console.error(e);process.exit(1);});
