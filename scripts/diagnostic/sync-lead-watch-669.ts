// HO 669 — the carried HO 667 sync WATCH read (READ-ONLY, no writes).
//
// The HO 667 chore retired the weekly-lead pipeline out of `/api/sync`. The WATCH
// asks a single question of the durable record: do POST-DEPLOY `/api/sync` ticks
// still carry a `lead` timing key, and is the total consistent with the HO 668
// rider's MEASURED yardstick (~1.7–2.4s of lead off a ~4.6–7.3s run) rather than
// the entry's HO 139 ~25s headline?
//
// TWO instrument traps this file exists to have already paid for (both faked a
// clean pass on the first cut):
//   1. `timings` is NOT at the payload root. The cron_runs.payload envelope is
//      {ok, elapsedMs, payload:{timings, sync, …}} — reading `p.timings` returns
//      undefined for EVERY row, pre- and post-deploy alike, which reads as "lead
//      is gone" and closes the WATCH on nothing. Read `p.payload.timings`.
//   2. String-comparing an ISO instant against a space-separated boundary is not
//      a date comparison: "…T18:01Z" > "… 21:44" because "T" > " ". Compare
//      epoch ms only.
// Hence the CONTROL below: a pre-deploy tick MUST print a non-null lead on the
// same invocation before any post-deploy zero is trusted.
//
// Prints id · started_at · elapsed_ms · status · lead · the payload's `timings`
// keys, for the recent `/api/sync` window, marking the HO 667 deploy boundary.
// Nothing imports it; it writes nothing and triggers no route.
// Run: npx tsx --env-file=.env scripts/diagnostic/sync-lead-watch-669.ts
import "dotenv/config";
import { getDb } from "../../lib/db";

// 52145c1 "docs: HO 667 — weekly_lead row deleted", 2026-08-15 21:44:33 UTC.
// The HO 667 CODE change landed before it, so this boundary is conservative.
const DEPLOY_BOUNDARY_MS = new Date("2026-08-15T21:44:33Z").getTime();

type Row = {
  id: number;
  startedAt: string;
  elapsedMs: number | null;
  status: string;
  isPost: boolean;
  lead: number | null;
  keys: string;
};

async function main() {
  const db = getDb();
  const rs = await db.execute(
    `SELECT id, started_at, elapsed_ms, status, error_message, payload
       FROM cron_runs
      WHERE route = '/api/sync'
   ORDER BY started_at DESC
      LIMIT 24`,
  );

  const rows: Row[] = [];
  for (const r of rs.rows) {
    const startedAt = String(r.started_at ?? "");
    let lead: number | null = null;
    let keys = "(no timings object)";
    try {
      const env = JSON.parse(String(r.payload ?? "{}"));
      // Trap 1: the envelope nests the real payload one level down.
      const t = env?.payload?.timings;
      if (t && typeof t === "object") {
        keys = Object.keys(t).join(",");
        lead = typeof t.lead === "number" ? t.lead : null;
      }
    } catch {
      keys = "(payload unparseable)";
    }
    rows.push({
      id: Number(r.id),
      startedAt,
      elapsedMs: r.elapsed_ms == null ? null : Number(r.elapsed_ms),
      status: String(r.status ?? "—"),
      // Trap 2: epoch comparison only.
      isPost: new Date(startedAt).getTime() >= DEPLOY_BOUNDARY_MS,
      lead,
      keys,
    });
  }

  console.log(`===== cron_runs WHERE route='/api/sync' (last ${rows.length}) =====`);
  console.log(`HO 667 deploy boundary: 2026-08-15T21:44:33Z (52145c1)`);
  console.log("");
  for (const r of rows) {
    console.log(
      `${r.isPost ? "POST" : "pre "} #${String(r.id).padEnd(6)} ${r.startedAt.padEnd(26)} ` +
        `elapsed_ms=${String(r.elapsedMs ?? "—").padEnd(7)} ${r.status.padEnd(8)} ` +
        `lead=${String(r.lead ?? "ABSENT").padEnd(7)} timings=[${r.keys}]`,
    );
  }

  const pre = rows.filter((r) => !r.isPost);
  const post = rows.filter((r) => r.isPost);
  const preWithLead = pre.filter((r) => r.lead != null);
  const sample = preWithLead[0];
  console.log("");
  console.log("===== CONTROL (must pass before any post-deploy zero is trusted) =====");
  console.log(
    `pre-deploy ticks in window: ${pre.length}; of those carrying a numeric lead: ` +
      `${preWithLead.length}${sample ? ` (e.g. #${sample.id} lead=${sample.lead}ms)` : ""}`,
  );
  console.log(
    preWithLead.length > 0
      ? "CONTROL PASS — the reader can see a lead key when one is present."
      : "CONTROL FAIL — reader sees no lead anywhere; a post-deploy zero proves NOTHING.",
  );
  console.log("");
  console.log("===== VERDICT =====");
  console.log(`post-deploy ticks found: ${post.length}`);
  console.log(`post-deploy ticks still carrying lead: ${post.filter((r) => r.lead != null).length}`);
  if (post.length) {
    const totals = post.map((r) => r.elapsedMs ?? 0).sort((a, b) => a - b);
    console.log(
      `post-deploy elapsed_ms range: ${totals[0]}–${totals[totals.length - 1]} ` +
        `(median ${totals[Math.floor(totals.length / 2)]})`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
