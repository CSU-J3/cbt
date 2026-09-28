// HO 263: manual run of the committee-meetings sync. HO 754: the same function
// /api/cron/committee-meetings runs (lib/meetings-sync.ts::syncMeetings), with no
// deadline. It reads each chamber's whole list, refreshes every event with no
// stored row or an older stored update_date, oldest first, and marks a row the
// list no longer carries absent. Re-runnable: the table is the state, so a second
// run refreshes only what is still owed. There is no watermark to resume from.
//
//   npm run sync:meetings              # refresh everything owed
//   npm run sync:meetings -- 500       # cap this run to 500 detail attempts
import "dotenv/config";
import { syncMeetings } from "../lib/meetings-sync";

async function main() {
  const limitArg = process.argv[2];
  const perTickLimit = limitArg ? Number(limitArg) : undefined;
  if (limitArg && !Number.isFinite(perTickLimit)) {
    console.error(`invalid limit: ${limitArg}`);
    process.exit(1);
  }
  const t0 = Date.now();
  const r = await syncMeetings({ perTickLimit });
  console.log(`\n[meetings] done in ${((Date.now() - t0) / 1000).toFixed(1)}s · stop ${r.stopReason}`);
  for (const chamber of ["house", "senate"] as const) {
    console.log(
      `  ${chamber}: pages ${r.pages[chamber]} · list ${r.listSize[chamber]} unique of ${r.listCount[chamber] ?? "?"} · ${r.listComplete[chamber] ? "complete" : "INCOMPLETE"}`,
    );
  }
  console.log(
    `  refreshed ${r.refreshed} · unchanged ${r.unchanged} · remaining ${r.remaining} · failed ${r.failed.count}${r.failed.ids.length ? ` (${r.failed.ids.join(", ")})` : ""} · set aside ${r.gaveUp.count}${r.gaveUp.ids.length ? ` (${r.gaveUp.ids.join(", ")})` : ""}`,
  );
  console.log(
    `  absent: stamped ${r.absent.stamped} · cleared ${r.absent.cleared}${r.absent.refused.length ? ` · refused ${r.absent.refused.join("; ")}` : ""}${r.absent.skipped.length ? ` · skipped ${r.absent.skipped.join("; ")}` : ""}`,
  );
  // HO 717: the documents stored as filed, and how many match the recorded-vote predicate.
  console.log(
    `  meeting_bills rows ${r.billRowsUpserted} · documents_stored=${r.documentsStored} recorded_vote_docs=${r.recordedVoteDocs}`,
  );
  for (const e of r.listErrors) console.log(`  list error ${e}`);
  if (r.stopReason !== "complete") console.log("  (stopped before the end — re-run to continue)");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
