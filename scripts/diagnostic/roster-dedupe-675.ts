// HO 675 STEP 0 (cont.) — the duplicate-target finding C5 surfaced. READ-ONLY.
import "dotenv/config";
import { createClient } from "@libsql/client";
const SEN = new Set(["s","sjres","sconres","sres"]);
const ALL = new Set(["hr","hjres","hconres","hres","s","sjres","sconres","sres"]);
const ch = (id: string) => { const p = id.split("-");
  return p.length===3 && p[1] && ALL.has(p[1]) ? (SEN.has(p[1])?"senate":"house") : null; };
async function main(){
  const c = createClient({url:process.env.TURSO_DATABASE_URL!,authToken:process.env.TURSO_AUTH_TOKEN});
  const line=(s="")=>console.log(s);
  const rows = await c.execute(`SELECT bill_id, related_bill_id, relationship_type FROM bill_related_bills`);

  line("─── D1  same (bill, target) pair carrying MORE THAN ONE type ────────");
  const pair = new Map<string,string[]>();
  for(const r of rows.rows){
    const k = `${r.bill_id}|${r.related_bill_id}`;
    (pair.get(k) ?? pair.set(k,[]).get(k)!).push(r.relationship_type as string);
  }
  const dupPairs=[...pair.entries()].filter(([,v])=>v.length>1);
  line(`  distinct (bill,target) pairs      ${pair.size}`);
  line(`  relationship rows                 ${rows.rows.length}`);
  line(`  pairs carrying >1 type            ${dupPairs.length}`);
  const combo = new Map<string,number>();
  for(const [,v] of dupPairs){ const k=v.slice().sort().join(" + "); combo.set(k,(combo.get(k)??0)+1); }
  [...combo.entries()].sort((a,b)=>b[1]-a[1]).forEach(([k,v])=>line(`    ${k}  -> ${v}`));

  line();
  line("─── D2  the same pair carrying TWO IDENTICAL-matching types ─────────");
  const bothIdent = dupPairs.filter(([,v]) => v.filter(t=>t.toLowerCase().includes("identical")).length>1);
  line(`  pairs where >1 type matches the identical predicate: ${bothIdent.length}`);
  bothIdent.slice(0,10).forEach(([k,v])=>line(`    ${k}  [${v.join(" | ")}]`));

  line();
  line("─── D3  promoted-block size, counted by DISTINCT TARGET ─────────────");
  const byRow = new Map<string,number>(); const byTgt = new Map<string,Set<string>>();
  for(const r of rows.rows){
    const b=r.bill_id as string, t=r.related_bill_id as string;
    if(!(r.relationship_type as string).toLowerCase().includes("identical")) continue;
    const cb=ch(b), ct=ch(t);
    if(!cb||!ct||cb===ct) continue;
    byRow.set(b,(byRow.get(b)??0)+1);
    if(!byTgt.has(b)) byTgt.set(b,new Set());
    byTgt.get(b)!.add(t);
  }
  const multiRow=[...byRow.values()].filter(n=>n>1).length;
  const multiTgt=[...byTgt.values()].filter(s=>s.size>1).length;
  line(`  bills with >=1 cross-chamber identical            ${byTgt.size}`);
  line(`  ... with >1 such ROW      (the earlier figure)    ${multiRow}`);
  line(`  ... with >1 DISTINCT TARGET (what the block draws) ${multiTgt}   <- THE ANSWER`);
  const d=new Map<number,number>(); for(const s of byTgt.values()) d.set(s.size,(d.get(s.size)??0)+1);
  line(`  block-size distribution by distinct target: ` +
    [...d.entries()].sort((a,b)=>a[0]-b[0]).map(([k,v])=>`${k}->${v}`).join("  "));
  line(`  examples (>1 distinct target): ` +
    [...byTgt.entries()].filter(([,s])=>s.size>1).slice(0,6).map(([b,s])=>`${b}(${[...s].join(",")})`).join("  "));

  line();
  line("─── D4  same-chamber identical, by distinct target (stays BELOW) ────");
  const sameT=new Map<string,Set<string>>();
  for(const r of rows.rows){
    const b=r.bill_id as string,t=r.related_bill_id as string;
    if(!(r.relationship_type as string).toLowerCase().includes("identical")) continue;
    const cb=ch(b),ct=ch(t); if(!cb||!ct||cb!==ct) continue;
    if(!sameT.has(b)) sameT.set(b,new Set()); sameT.get(b)!.add(t);
  }
  line(`  bills with >=1 same-chamber identical: ${sameT.size}`);
  line(`  bills with BOTH a cross and a same-chamber identical: ` +
    [...sameT.keys()].filter(b=>byTgt.has(b)).length);
  line(`  example same-chamber-only bills: ` +
    [...sameT.keys()].filter(b=>!byTgt.has(b)).slice(0,6).join(", "));
  line();
}
main().catch(e=>{console.error(e);process.exit(1);});
