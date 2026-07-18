// HO 479 — /api/sync trailing-step timeout probe. READ-ONLY.
// No INSERT/UPDATE/DELETE, no writeDashboardLead, no ingestTrades, no route
// touch. Reads cron_runs, replicates gatherLeadData's reads to cold-time them,
// times the Gemini lead call and the FMP trade fetches, prints the numbers,
// and classifies the overrun. Sibling to markets-cadence-474.ts /
// lda-bill-cost-439.ts / amendments-actions-probe-452.ts.
//   npx tsx scripts/diagnostic/sync-trailing-cost-479.ts
//
// The load-bearing structural finding is printed in Part A: wrapCronRoute
// writes the handler payload (which carries `timings`) ONLY on the success
// branch. On the timeout branch it writes the error-shape body {ok,elapsedMs,
// error,status} — so the per-step timings are absent on exactly the rows that
// timed out. Part A therefore reconstructs the overrun from the SUCCESS-row
// distribution + the (uninformative) timeout elapsed_ms, and Part B confirms
// the cause by cold-timing the two trailing steps in isolation.
import "dotenv/config";
import { createClient } from "@libsql/client";
import { generateDashboardLead } from "@/lib/dashboard-lead";
import { fetchHouseTrades, fetchSenateTrades } from "@/lib/fmp";
import { getDb } from "@/lib/db";

const SYNC_BUDGET_MS = 30_000; // route.ts
const SOFT_CAP_MS = 55_000; // cron-log.ts DEFAULT_SOFT_TIMEOUT_MS
const PART_B_GUARD_MS = 20_000; // handoff: ceiling per Part B call so an FMP hang can't wedge the probe

// ── small stats helpers ────────────────────────────────────────────────────
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}
function dist(values: number[]): string {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return "(no data)";
  const f = (n: number) => `${Math.round(n)}`.padStart(6);
  return `n=${String(v.length).padStart(2)}  min=${f(v[0]!)}  p50=${f(pct(v, 0.5))}  p90=${f(pct(v, 0.9))}  max=${f(v[v.length - 1]!)}`;
}

type Timings = { reportCatchup: number | null; sync: number | null; lead: number | null; trades: number | null };
type Row = {
  id: number;
  startedAt: string;
  status: string;
  elapsedMs: number;
  timings: Timings | null;
  syncCounters: Record<string, unknown> | null;
  catchupGenerated: string | null;
};

function parseRow(raw: {
  id: unknown;
  started_at: unknown;
  status: unknown;
  elapsed_ms: unknown;
  payload: unknown;
}): Row {
  const base: Row = {
    id: Number(raw.id),
    startedAt: String(raw.started_at),
    status: String(raw.status),
    elapsedMs: Number(raw.elapsed_ms ?? 0),
    timings: null,
    syncCounters: null,
    catchupGenerated: null,
  };
  try {
    const p = JSON.parse(String(raw.payload)) as Record<string, unknown>;
    // Success shape: { ok:true, elapsedMs, payload:{ timings, sync, reportCatchup } }
    // Timeout/error shape: { ok:false, elapsedMs, error, status } — no inner payload.
    const inner = p.payload as Record<string, unknown> | undefined;
    if (inner && inner.timings) {
      const t = inner.timings as Record<string, number | null>;
      base.timings = {
        reportCatchup: t.reportCatchup ?? null,
        sync: t.sync ?? null,
        lead: t.lead ?? null,
        trades: t.trades ?? null,
      };
      base.syncCounters = (inner.sync as Record<string, unknown>) ?? null;
      const rc = inner.reportCatchup as Record<string, unknown> | undefined;
      base.catchupGenerated = (rc?.generated as string | null) ?? null;
    }
  } catch {
    /* leave timings null */
  }
  return base;
}

// ── Part A ──────────────────────────────────────────────────────────────────
async function partA(db: ReturnType<typeof createClient>): Promise<void> {
  console.log("========================================================");
  console.log("PART A — prod telemetry: last 40 /api/sync cron_runs");
  console.log("========================================================");

  const rs = await db.execute({
    sql: `SELECT id, started_at, status, elapsed_ms, payload
          FROM cron_runs WHERE route='/api/sync'
          ORDER BY started_at DESC LIMIT 40`,
    args: [],
  });
  const rows = rs.rows.map((r) =>
    parseRow(r as unknown as Parameters<typeof parseRow>[0]),
  );
  if (rows.length === 0) {
    console.log("No /api/sync rows found.");
    return;
  }

  const withTimings = rows.filter((r) => r.timings);
  const timeouts = rows.filter((r) => r.status === "timeout");
  const errors = rows.filter((r) => r.status === "error");
  const successes = rows.filter((r) => r.status === "success");

  const span = `${rows[rows.length - 1]!.startedAt.slice(0, 16)} → ${rows[0]!.startedAt.slice(0, 16)}`;
  console.log(`\nrows=${rows.length}  span ${span} (UTC)`);
  console.log(
    `status mix: success=${successes.length}  timeout=${timeouts.length}  error=${errors.length}  other=${rows.length - successes.length - timeouts.length - errors.length}`,
  );

  // Per-row table.
  console.log(
    "\n  id     time(UTC)        status   elapsed   catchup    sync     lead    trades   Σsteps  unacct  largest",
  );
  for (const r of rows) {
    const hhmm = r.startedAt.slice(11, 16);
    if (!r.timings) {
      console.log(
        `  ${String(r.id).padStart(5)}  ${r.startedAt.slice(0, 10)} ${hhmm}  ${r.status.padEnd(8)} ${String(r.elapsedMs).padStart(6)}   — no per-step timings (payload is error-shape; timings discarded on the timeout branch)`,
      );
      continue;
    }
    const t = r.timings;
    const steps: Array<[string, number | null]> = [
      ["catchup", t.reportCatchup],
      ["sync", t.sync],
      ["lead", t.lead],
      ["trades", t.trades],
    ];
    const sum = steps.reduce((a, [, v]) => a + (v ?? 0), 0);
    const unacct = r.elapsedMs - sum;
    let largest = steps[0]!;
    for (const s of steps) if ((s[1] ?? 0) > (largest[1] ?? 0)) largest = s;
    const c = (v: number | null) => String(v ?? "—").padStart(7);
    console.log(
      `  ${String(r.id).padStart(5)}  ${r.startedAt.slice(0, 10)} ${hhmm}  ${r.status.padEnd(8)} ${String(r.elapsedMs).padStart(6)}  ${c(t.reportCatchup)}  ${c(t.sync)}  ${c(t.lead)}  ${c(t.trades)}  ${String(sum).padStart(6)}  ${String(unacct).padStart(6)}  ${largest[0]}=${largest[1]}`,
    );
  }

  // Per-step distribution (SUCCESS rows only — the only rows that carry timings).
  console.log("\n----- per-step distribution (rows WITH timings only) -----");
  console.log(`  reportCatchup  ${dist(withTimings.map((r) => r.timings!.reportCatchup ?? NaN))}`);
  console.log(`  sync           ${dist(withTimings.map((r) => r.timings!.sync ?? NaN))}`);
  console.log(`  lead           ${dist(withTimings.map((r) => r.timings!.lead ?? NaN))}`);
  console.log(`  trades         ${dist(withTimings.map((r) => r.timings!.trades ?? NaN))}`);
  console.log(`  elapsed_ms     ${dist(withTimings.map((r) => r.elapsedMs))}`);

  // Timeout correlation — the structural gap, stated plainly.
  console.log("\n----- timeout correlation -----");
  console.log(
    `  timeout ${timeouts.length} of ${rows.length} rows. INSTRUMENTATION GAP: timeout rows carry NO per-step`,
  );
  console.log(
    "  timings — wrapCronRoute discards the handler payload on the soft-timeout branch (Promise.race",
  );
  console.log(
    "  loses; the {timings} object never returns). 'largest step on timeout rows' is unanswerable from",
  );
  console.log("  the telemetry the route brags about. Timeout elapsed_ms (all pinned at the ~55s soft cap):");
  console.log(`    ${dist(timeouts.map((r) => r.elapsedMs))}`);
  // Largest step across the rows we CAN see (successes) — the proxy answer.
  const largestTally: Record<string, number> = {};
  for (const r of withTimings) {
    const s: Array<[string, number]> = [
      ["catchup", r.timings!.reportCatchup ?? 0],
      ["sync", r.timings!.sync ?? 0],
      ["lead", r.timings!.lead ?? 0],
      ["trades", r.timings!.trades ?? 0],
    ];
    let m = s[0]!;
    for (const x of s) if (x[1] > m[1]) m = x;
    largestTally[m[0]] = (largestTally[m[0]] ?? 0) + 1;
  }
  console.log(
    `  Proxy (largest step among the ${withTimings.length} SUCCESS rows): ` +
      Object.entries(largestTally).map(([k, v]) => `${k}=${v}`).join("  "),
  );

  // Gap-day discriminator.
  console.log("\n----- gap-day discriminator (reportCatchup.generated) -----");
  const gapSucc = withTimings.filter((r) => r.catchupGenerated != null);
  console.log(
    `  Among SUCCESS rows: ${gapSucc.length}/${withTimings.length} had reportCatchup.generated != null (a real weekly-report gen ran).`,
  );
  if (gapSucc.length) {
    console.log(`  Gap-day success rows: ${gapSucc.map((r) => `#${r.id}(catchup=${r.timings!.reportCatchup}ms)`).join(", ")}`);
  }
  console.log(
    "  Timeout rows: generated flag is unknowable (no payload). But reportCatchup on success rows is tiny",
  );
  console.log(
    `  (p50 ${Math.round(pct(withTimings.map((r) => r.timings!.reportCatchup ?? 0).sort((a, b) => a - b), 0.5))}ms) — on non-gap days catchup is exonerated; the overrun lives downstream.`,
  );

  // Sync-tail check.
  console.log("\n----- sync-tail check (timings.sync vs 30s budget) -----");
  const overBudget = withTimings.filter((r) => (r.timings!.sync ?? 0) > SYNC_BUDGET_MS);
  console.log(
    `  ${overBudget.length}/${withTimings.length} success rows had timings.sync > ${SYNC_BUDGET_MS}ms.`,
  );
  if (overBudget.length) {
    console.log(
      `  Overshoot: ${dist(overBudget.map((r) => (r.timings!.sync ?? 0) - SYNC_BUDGET_MS))}  (ms past budget)`,
    );
  }
  for (const r of withTimings) {
    if (r.syncCounters) {
      const s = r.syncCounters;
      console.log(
        `    #${r.id} sync=${r.timings!.sync}ms  seen=${s.seen} upserted=${s.upserted} failed=${s.failed} timedOut=${s.timedOut} budgetStopped=${s.budgetStopped}`,
      );
    }
  }

  // Unaccounted time.
  console.log("\n----- unaccounted time (elapsed − Σsteps, success rows) -----");
  const unacct = withTimings.map(
    (r) =>
      r.elapsedMs -
      ((r.timings!.reportCatchup ?? 0) + (r.timings!.sync ?? 0) + (r.timings!.lead ?? 0) + (r.timings!.trades ?? 0)),
  );
  console.log(`  ${dist(unacct)}  (ms outside the 4 timed steps: revalidateTag ×4, wrapCronRoute overhead)`);
}

// ── Part B ──────────────────────────────────────────────────────────────────
type TimedResult = { ms: number; ok: boolean; timedOut: boolean; note: string };
async function timed<T>(
  label: string,
  fn: () => Promise<T>,
  onValue?: (v: T) => string,
): Promise<TimedResult> {
  const start = Date.now();
  let guard: ReturnType<typeof setTimeout> | null = null;
  const guardP = new Promise<never>((_, rej) => {
    guard = setTimeout(() => rej(new Error(`__GUARD_${PART_B_GUARD_MS}ms`)), PART_B_GUARD_MS);
  });
  try {
    const v = await Promise.race([fn(), guardP]);
    if (guard) clearTimeout(guard);
    const ms = Date.now() - start;
    const note = onValue ? onValue(v as T) : "";
    console.log(`  ${label.padEnd(34)} ${String(ms).padStart(6)}ms  ok   ${note}`);
    return { ms, ok: true, timedOut: false, note };
  } catch (e) {
    if (guard) clearTimeout(guard);
    const ms = Date.now() - start;
    const msg = e instanceof Error ? e.message : String(e);
    const timedOut = msg.startsWith("__GUARD_");
    console.log(
      `  ${label.padEnd(34)} ${String(ms).padStart(6)}ms  ${timedOut ? "GUARD-TRIPPED (>20s — unbounded fetch confirmed; underlying call still running)" : `FAIL ${msg.slice(0, 90)}`}`,
    );
    return { ms, ok: false, timedOut, note: msg };
  }
}

// Read-only replica of the private gatherLeadData() reads (dashboard-lead.ts),
// so we can cold-time the DB half of the lead step separately from Gemini.
const LEAD_DAYS = 7;
const NON_CEREMONIAL = "(is_ceremonial = 0 OR is_ceremonial IS NULL)";
async function timeGatherLeadReads(): Promise<void> {
  const db = getDb();
  await timed("lead DB · transitions query", async () => {
    const rs = await db.execute(
      `SELECT id, bill_type, bill_number, title, stage, previous_stage FROM bills
       WHERE ${NON_CEREMONIAL} AND stage_changed_at IS NOT NULL
         AND stage_changed_at > datetime('now', '-${LEAD_DAYS} days')
       ORDER BY stage_changed_at DESC`,
    );
    return rs.rows.length;
  }, (n) => `${n} rows`);
  await timed("lead DB · enacted-this-week", async () => {
    const rs = await db.execute(
      `SELECT COUNT(*) n FROM bills WHERE ${NON_CEREMONIAL}
         AND stage='enacted' AND stage_changed_at > datetime('now','-${LEAD_DAYS} days')`,
    );
    return Number(rs.rows[0]?.n ?? 0);
  }, (n) => `${n} enacted (approx; real path uses queryEnactedThisWeek)`);
  await timed("lead DB · introductions count", async () => {
    const rs = await db.execute(
      `SELECT COUNT(*) n FROM bills WHERE ${NON_CEREMONIAL}
         AND introduced_date >= date('now','-${LEAD_DAYS} days')`,
    );
    return Number(rs.rows[0]?.n ?? 0);
  }, (n) => `${n} rows`);
  await timed("lead DB · top-topic json_each", async () => {
    const rs = await db.execute(
      `SELECT je.value topic, COUNT(*) n FROM bills, json_each(bills.topics) je
       WHERE ${NON_CEREMONIAL} AND bills.topics IS NOT NULL
         AND bills.stage_changed_at IS NOT NULL
         AND bills.stage_changed_at > datetime('now','-${LEAD_DAYS} days')
       GROUP BY je.value ORDER BY n DESC LIMIT 1`,
    );
    return rs.rows.length;
  }, () => "");
}

async function partB(): Promise<void> {
  console.log("\n\n========================================================");
  console.log("PART B — cold-time the trailing steps in isolation");
  console.log("========================================================");
  console.log(`(${PART_B_GUARD_MS / 1000}s guard per call; read-only — no writeDashboardLead, no ingestTrades)`);

  // LEAD — split DB reads vs Gemini.
  console.log("\n--- lead step ---");
  const hasGemini = !!process.env.GEMINI_API_KEY;
  const leadDbStart = Date.now();
  await timeGatherLeadReads();
  const leadDbMs = Date.now() - leadDbStart;
  console.log(`  → gatherLeadData DB reads total: ${leadDbMs}ms`);
  if (hasGemini) {
    const full = await timed(
      "generateDashboardLead (DB+Gemini)",
      () => generateDashboardLead(),
      (s) => `${String(s).length} chars`,
    );
    if (full.ok) {
      console.log(
        `  → inferred Gemini call: ~${Math.max(0, full.ms - leadDbMs)}ms (full ${full.ms}ms − DB reads ${leadDbMs}ms)`,
      );
    }
  } else {
    console.log("  generateDashboardLead SKIPPED — GEMINI_API_KEY not set.");
  }

  // TRADES — the FMP GETs only, pages 0/1/2 per chamber. No insert loop.
  console.log("\n--- trades step (FMP GETs only, no inserts) ---");
  if (!process.env.FMP_API_KEY) {
    console.log("  SKIPPED — FMP_API_KEY not set.");
    return;
  }
  for (const page of [0, 1, 2]) {
    await timed(
      `fetchSenateTrades page=${page}`,
      () => fetchSenateTrades({ page }),
      (rows) => `${rows.length} rows`,
    );
  }
  for (const page of [0, 1, 2]) {
    await timed(
      `fetchHouseTrades page=${page}`,
      () => fetchHouseTrades({ page }),
      (rows) => `${rows.length} rows`,
    );
  }
}

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.log("CHECK BROKEN: TURSO_DATABASE_URL not set. Run with the CBT .env.");
    return 3;
  }
  const db = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

  await partA(db);
  await partB();

  console.log("\n(Read-only probe complete. Classification + GO/NO-GO is in the handoff writeup, not code.)");
  return 0;
}

main().then((c) => process.exit(c));
