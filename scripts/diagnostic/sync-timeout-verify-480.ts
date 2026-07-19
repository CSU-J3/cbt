// HO 480/481 sync-timeout verification pull (read-only).
// Pulls every /api/sync cron_runs row after the 5bf9354 deploy cutoff and
// reports per-tick: outcome (status/elapsed vs the 55s soft cap), the lever
// (timings.lead — was the 14-20s gatherLeadData cold-stall, target ~1-3s),
// and correctness (did dashboard_state.weekly_lead.updated_at advance —
// i.e. did the lead step actually SUCCEED, not just run fast-and-fail).
//
// Payload shape note: wrapCronRoute stores responseBody = {ok, elapsedMs,
// payload:{timings, sync, reportCatchup}}, so timings live at
// $.payload.timings.* (NOT $.timings.*). Timed-out rows carry the error
// responseBody with NO timings — reported separately, kept OUT of success stats.
//   npx tsx scripts/diagnostic/sync-timeout-verify-480.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const ROUTE = "/api/sync";
// 5bf9354 landed 2026-07-18 20:36:30 UTC. Use ISO-T form so the string compare
// against started_at ('...T...Z') is correct — a space here sorts BELOW 'T'
// (0x20 < 0x54), so a "space" cutoff wrongly admits every same-day pre-deploy row.
const DEPLOY_CUTOFF = "2026-07-18T20:36:30Z";
const SOFT_CAP_MS = 55_000;
const LEAD_BAND_HI_MS = 3_000; // instruction's in-band target upper bound

function n(v: unknown): number | null {
  if (v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) {
    console.log("CHECK BROKEN: TURSO_DATABASE_URL not set in this env.");
    console.log("Run on a machine carrying the CBT .env (the local working tree).");
    return 3;
  }
  const db = createClient({ url, authToken });

  const rs = await db.execute({
    sql: `SELECT id, started_at, ended_at, status, elapsed_ms, error_message,
                 json_extract(payload,'$.payload.timings.reportCatchup') AS t_catchup,
                 json_extract(payload,'$.payload.timings.sync')          AS t_sync,
                 json_extract(payload,'$.payload.timings.lead')          AS t_lead,
                 json_extract(payload,'$.payload.timings.trades')        AS t_trades,
                 json_extract(payload,'$.payload.reportCatchup.ok')      AS catchup_ok,
                 json_extract(payload,'$.payload.sync.upserted')         AS sync_upserted
          FROM cron_runs
          WHERE route = ? AND started_at > ?
          ORDER BY started_at ASC`,
    args: [ROUTE, DEPLOY_CUTOFF],
  });

  const lead = await db.execute({
    sql: `SELECT updated_at, substr(value,1,120) AS snippet
          FROM dashboard_state WHERE key = 'weekly_lead'`,
    args: [],
  });
  const leadUpdatedAt = (lead.rows[0]?.updated_at as string | undefined) ?? null;
  const leadSnippet = (lead.rows[0]?.snippet as string | undefined) ?? null;

  console.log(`=== HO 480/481 /api/sync verification — cutoff ${DEPLOY_CUTOFF} UTC ===\n`);

  if (rs.rows.length === 0) {
    console.log("no post-deploy tick yet. /api/sync cadence is 0 */6 → next fires 00/06/12/18:00 UTC.");
    db.close();
    return 0;
  }

  const successRows: { id: number; lead: number | null; elapsed: number | null }[] = [];
  const otherRows: Record<string, unknown>[] = [];

  for (const r of rs.rows) {
    const status = r.status as string;
    const elapsed = n(r.elapsed_ms);
    const tLead = n(r.t_lead);
    const tSync = n(r.t_sync);
    const tTrades = n(r.t_trades);
    const tCatchup = n(r.t_catchup);

    console.log(`#${r.id}  ${r.started_at}  status=${status}  elapsed=${elapsed ?? "-"}ms`);
    if (status === "success") {
      const leadBand =
        tLead == null ? "no-timing" : tLead <= LEAD_BAND_HI_MS ? "IN-BAND ✓" : "OUT-OF-BAND ✗";
      const capFlag = elapsed != null && elapsed < SOFT_CAP_MS ? "under-cap ✓" : "AT/OVER-CAP ✗";
      console.log(
        `      timings: catchup=${tCatchup ?? "-"}  sync=${tSync ?? "-"}  ` +
          `lead=${tLead ?? "-"}  trades=${tTrades ?? "-"}  (ms)`,
      );
      console.log(
        `      lever: lead=${tLead ?? "-"}ms → ${leadBand}   outcome: ${capFlag}   ` +
          `catchup.ok=${r.catchup_ok ?? "-"}  sync.upserted=${r.sync_upserted ?? "-"}`,
      );
      successRows.push({ id: Number(r.id), lead: tLead, elapsed });
    } else {
      // timeout / error / orphaned — no timings payload; attribution not possible.
      console.log(
        `      NO timings payload (${status}). err=${r.error_message ?? "none"} ` +
          `— cause not attributable from telemetry; kept OUT of success stats.`,
      );
      otherRows.push(r as Record<string, unknown>);
    }
    console.log("");
  }

  // --- Summary ---
  console.log("--- summary ---");
  console.log(`rows since deploy: ${rs.rows.length}  (success=${successRows.length}, other=${otherRows.length})`);

  const inBand = successRows.filter((s) => s.lead != null && s.lead <= LEAD_BAND_HI_MS);
  const leadVals = successRows.map((s) => s.lead).filter((x): x is number => x != null);
  if (leadVals.length) {
    console.log(
      `lead_ms across success rows: min=${Math.min(...leadVals)} max=${Math.max(...leadVals)}  ` +
        `(${inBand.length}/${successRows.length} in-band ≤${LEAD_BAND_HI_MS}ms)`,
    );
  }

  console.log(`\ndashboard_state.weekly_lead.updated_at = ${leadUpdatedAt ?? "MISSING"}`);
  const latestSuccessStart = rs.rows
    .filter((r) => r.status === "success")
    .map((r) => r.started_at as string)
    .pop();
  if (leadUpdatedAt && latestSuccessStart) {
    const advanced = leadUpdatedAt > DEPLOY_CUTOFF.replace(" ", "T");
    console.log(
      `  ${advanced ? "ADVANCED ✓" : "STALE ✗"} vs deploy cutoff; latest success tick started ${latestSuccessStart}`,
    );
    console.log(`  lead snippet: ${leadSnippet ?? "-"}`);
  }

  // --- Verdict ---
  const consecutiveInBand = inBand.length;
  console.log("\n--- verdict ---");
  if (consecutiveInBand >= 2) {
    console.log(
      `LOOP CLOSED (provisional): ${consecutiveInBand} success ticks with lead in-band. ` +
        `Confirm the weekly_lead timestamp advanced (correctness) above.`,
    );
  } else {
    console.log(
      `NOT YET: only ${consecutiveInBand} in-band success tick(s). ` +
        `Want 2-3 consecutive (timeout baseline was ~80%, not 100%).`,
    );
  }

  db.close();
  return 0;
}

main()
  .then((code) => (process.exitCode = code))
  .catch((err) => {
    console.log(`CHECK BROKEN: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
    process.exitCode = 3;
  });
