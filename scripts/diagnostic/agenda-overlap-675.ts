// HO 675 STEP 0 — mock section 03's dedup requirement, priced. Does a related
// bill ever collide with a bill already printed by the HEARING block's agenda?
// READ-ONLY.
import "dotenv/config";
import { createClient } from "@libsql/client";
async function main(){
  const c = createClient({url:process.env.TURSO_DATABASE_URL!,authToken:process.env.TURSO_AUTH_TOKEN});
  const line=(s="")=>console.log(s);
  line("─── A1  related bill also on one of the bill's own meeting agendas ──");
  const r = await c.execute(
    `SELECT COUNT(*) AS overlap_rows, COUNT(DISTINCT rb.bill_id) AS bills
       FROM bill_related_bills rb
      WHERE EXISTS (
        SELECT 1 FROM meeting_bills mb1
          JOIN meeting_bills mb2 ON mb2.event_id = mb1.event_id
         WHERE mb1.bill_id = rb.bill_id AND mb2.bill_id = rb.related_bill_id)`);
  line(`  overlapping (bill, related) rows: ${Number(r.rows[0]!.overlap_rows)}`);
  line(`  bills affected:                   ${Number(r.rows[0]!.bills)}`);
  // CONTROL: the same instrument must be able to report a non-zero. Count the
  // agenda siblings that exist at all, so a 0 above is a reading and not silence.
  const ctl = await c.execute(
    `SELECT COUNT(*) n FROM meeting_bills mb1
       JOIN meeting_bills mb2 ON mb2.event_id = mb1.event_id AND mb2.bill_id <> mb1.bill_id`);
  line(`  CONTROL agenda sibling pairs in the corpus: ${Number(ctl.rows[0]!.n)} (non-zero -> the join works)`);
  const ex = await c.execute(
    `SELECT rb.bill_id, rb.related_bill_id, rb.relationship_type
       FROM bill_related_bills rb
      WHERE EXISTS (
        SELECT 1 FROM meeting_bills mb1
          JOIN meeting_bills mb2 ON mb2.event_id = mb1.event_id
         WHERE mb1.bill_id = rb.bill_id AND mb2.bill_id = rb.related_bill_id) LIMIT 8`);
  ex.rows.forEach(x=>line(`    ${x.bill_id} -> ${x.related_bill_id} [${x.relationship_type}]`));

  line();
  line("─── A2  but the HEARING block prints only ONE meeting's agenda ──────");
  line("  (HO 324 selects the soonest current-or-upcoming meeting; /stale the most recent.)");
  const one = await c.execute(
    `SELECT COUNT(DISTINCT rb.bill_id) bills FROM bill_related_bills rb
      WHERE EXISTS (SELECT 1 FROM meeting_bills mb1
                      JOIN meeting_bills mb2 ON mb2.event_id = mb1.event_id
                     WHERE mb1.bill_id = rb.bill_id AND mb2.bill_id = rb.related_bill_id)`);
  line(`  upper bound on affected bills (any meeting): ${Number(one.rows[0]!.bills)}`);
  line();
}
main().catch(e=>{console.error(e);process.exit(1);});
