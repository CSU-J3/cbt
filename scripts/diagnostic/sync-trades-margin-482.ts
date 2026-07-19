// Diagnostic (read-only, HO 482): /api/sync margin probe — sync-tail + trades.
//
// Measure → classify → recommend. WRITES NOTHING to prod (the Part B insert
// benchmark collides on the PK and is IGNORED → zero rows written; the FMP
// probe is GET-only). Does NOT run ingestTrades / writeDashboardLead.
//
// Answers: HO 480/481 collapsed the sync lead step to ~1-3s, yet tick #3446
// still landed at 50.0s (~10s over the post-fix wall prediction of 33-40s).
// This names where that ~10s lives — sync-tail past the 30s budget, trades, or
// unaccounted residual — and lands a fix-or-watch call with a numeric trigger.
//
// Run: `npx tsx scripts/diagnostic/sync-trades-margin-482.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";

// ---------------------------------------------------------------------------
// Constants that mirror the live route / cron wrapper so the math is grounded.
const SYNC_BUDGET_MS = 30_000; // app/api/sync/route.ts
const SOFT_CAP_MS = 55_000; // lib/cron-log.ts DEFAULT_SOFT_TIMEOUT_MS
const POST_FIX_MIN_ID = 3446; // HO 481 post-deploy verified tick (5bf9354)
const POST_FIX_LEAD_MS = 5_000; // cohort split: post-fix DB lead is ~1-3s
// Regression FLAG is separate + looser: the lead step also wraps the Gemini
// generateDashboardLead call (variable ~1-5s), so a 5s lead is Gemini jitter,
// not the OR-lure DB stall. Only flag a climb genuinely TOWARD the 14-20s band.
const LEAD_REGRESSION_FLAG_MS = 10_000;
const ANCHOR_IDS = [3446, 3499, 3558]; // the three hand-verified post-fix ticks

// FMP endpoint mirror of lib/fmp.ts (BASE + *-latest paths are not exported).
const FMP_BASE = "https://financialmodelingprep.com/stable";
const FMP_ENDPOINTS: Record<"senate" | "house", string> = {
  senate: "senate-latest",
  house: "house-latest",
};
const FMP_PROBE_CEILING_MS = 20_000; // per-fetch soft ceiling (Part B)
const INSERT_ROUNDTRIP_TRIALS = 20;
const TRADES_ATTEMPTED_INSERTS = 200; // ~100 rows/chamber page-0 × 2 chambers

// ---------------------------------------------------------------------------
// Stats helpers.
type Num = number;
function sortedAsc(xs: Num[]): Num[] {
  return [...xs].sort((a, b) => a - b);
}
function quantile(xs: Num[], p: number): Num | null {
  if (xs.length === 0) return null;
  const s = sortedAsc(xs);
  // nearest-rank
  const rank = Math.ceil(p * s.length);
  return s[Math.min(s.length - 1, Math.max(0, rank - 1))] ?? null;
}
function minOf(xs: Num[]): Num | null {
  return xs.length ? sortedAsc(xs)[0]! : null;
}
function maxOf(xs: Num[]): Num | null {
  return xs.length ? sortedAsc(xs)[xs.length - 1]! : null;
}
function dist(xs: Num[]): {
  n: number;
  min: Num | null;
  p50: Num | null;
  p90: Num | null;
  max: Num | null;
} {
  return {
    n: xs.length,
    min: minOf(xs),
    p50: quantile(xs, 0.5),
    p90: quantile(xs, 0.9),
    max: maxOf(xs),
  };
}
function ms(x: Num | null): string {
  if (x == null) return "—";
  return `${Math.round(x)}ms`;
}
function secs(x: Num | null): string {
  if (x == null) return "—";
  return `${(x / 1000).toFixed(1)}s`;
}

// ---------------------------------------------------------------------------
// Row shape after parsing cron_runs.payload.
//
// wrapCronRoute stores responseBody = { ok, elapsedMs, payload: <handler payload> }
// so the handler's { timings, sync, reportCatchup } live at payload.payload.*.
// error/timeout rows store { ok:false, elapsedMs, error, status } — NO inner
// payload, hence no timings.
interface SyncRow {
  id: number;
  startedAt: string;
  status: string;
  elapsedMs: number | null; // cron_runs.elapsed_ms column (DB-computed total)
  wrapperElapsedMs: number | null; // payload.elapsedMs (wrapper-measured)
  timings: {
    reportCatchup: number | null;
    sync: number | null;
    lead: number | null;
    trades: number | null;
  } | null;
  sync: {
    seen?: number;
    upserted?: number;
    skipped?: number;
    failed?: number;
    timedOut?: number;
    budgetStopped?: boolean;
  } | null;
  reportCatchupGenerated: string | null;
}

function parseRow(r: Record<string, unknown>): SyncRow {
  const id = Number(r.id);
  const status = String(r.status ?? "");
  const elapsedMs = r.elapsed_ms == null ? null : Number(r.elapsed_ms);
  let wrapperElapsedMs: number | null = null;
  let timings: SyncRow["timings"] = null;
  let sync: SyncRow["sync"] = null;
  let reportCatchupGenerated: string | null = null;
  const raw = r.payload;
  if (typeof raw === "string" && raw.length > 0) {
    try {
      const outer = JSON.parse(raw) as Record<string, unknown>;
      if (typeof outer.elapsedMs === "number") wrapperElapsedMs = outer.elapsedMs;
      const inner = outer.payload as Record<string, unknown> | undefined;
      if (inner && typeof inner === "object") {
        const t = inner.timings as Record<string, unknown> | undefined;
        if (t) {
          timings = {
            reportCatchup: t.reportCatchup == null ? null : Number(t.reportCatchup),
            sync: t.sync == null ? null : Number(t.sync),
            lead: t.lead == null ? null : Number(t.lead),
            trades: t.trades == null ? null : Number(t.trades),
          };
        }
        const s = inner.sync as Record<string, unknown> | undefined;
        if (s) sync = s as SyncRow["sync"];
        const rc = inner.reportCatchup as Record<string, unknown> | undefined;
        if (rc && rc.generated != null) reportCatchupGenerated = String(rc.generated);
      }
    } catch {
      /* leave nulls */
    }
  }
  return {
    id,
    startedAt: String(r.started_at ?? ""),
    status,
    elapsedMs,
    wrapperElapsedMs,
    timings,
    sync,
    reportCatchupGenerated,
  };
}

function residualOf(row: SyncRow): number | null {
  if (row.elapsedMs == null || !row.timings) return null;
  const { reportCatchup, sync, lead, trades } = row.timings;
  if (reportCatchup == null || sync == null || lead == null || trades == null)
    return null;
  return row.elapsedMs - (reportCatchup + sync + lead + trades);
}

// ===========================================================================
// PART A — prod telemetry.
async function partA(db: ReturnType<typeof getDb>): Promise<{
  postFix: SyncRow[];
  p90Elapsed: number | null;
}> {
  console.log("\n============================================================");
  console.log("PART A — prod telemetry (the primary answer)");
  console.log("============================================================");

  const rs = await db.execute(
    `SELECT id, started_at, status, elapsed_ms, payload
     FROM cron_runs
     WHERE route = '/api/sync'
     ORDER BY id DESC
     LIMIT 40`,
  );
  const rows = rs.rows.map((r) => parseRow(r as Record<string, unknown>));
  console.log(`\nPulled ${rows.length} most-recent /api/sync rows.`);

  // Cohort isolation: id >= POST_FIX_MIN_ID vs lead < 5000.
  const byId = rows.filter((r) => r.id >= POST_FIX_MIN_ID);
  const byLead = rows.filter(
    (r) => r.timings?.lead != null && r.timings.lead < POST_FIX_LEAD_MS,
  );
  const byIdSet = new Set(byId.map((r) => r.id));
  const byLeadSet = new Set(byLead.map((r) => r.id));
  const idOnly = Array.from(byIdSet).filter((x) => !byLeadSet.has(x));
  const leadOnly = Array.from(byLeadSet).filter((x) => !byIdSet.has(x));
  console.log(
    `\nCohort isolation: id>=${POST_FIX_MIN_ID} → ${byId.length} rows; ` +
      `lead<${POST_FIX_LEAD_MS}ms → ${byLead.length} rows.`,
  );
  if (idOnly.length === 0 && leadOnly.length === 0) {
    console.log("  ✓ The two filters name the SAME set (as HO 481 predicted).");
  } else {
    console.log(
      `  ⚠ DISAGREEMENT — id-only: [${idOnly.join(", ")}]  lead-only: [${leadOnly.join(", ")}]`,
    );
    console.log(
      "    (id-only rows are post-fix ticks with no lead timing — usually timeout/error rows;",
    );
    console.log("     lead-only rows would be pre-3446 ticks already fast — investigate if present.)");
  }

  // Post-fix cohort = id>=POST_FIX_MIN_ID (the durable key; superset that also
  // catches timeout/error post-fix rows). Distribution work uses only rows that
  // actually carry timings.
  const postFix = byId;
  const preFix = rows.filter((r) => r.id < POST_FIX_MIN_ID);
  const postFixTimed = postFix.filter((r) => r.timings != null);
  console.log(
    `\nPre/post split: ${preFix.length} pre-fix, ${postFix.length} post-fix ` +
      `(${postFixTimed.length} post-fix carry step timings).`,
  );

  // Full per-row table for transparency.
  console.log("\n--- Post-fix rows (per-step breakdown) ---");
  console.table(
    postFix.map((r) => ({
      id: r.id,
      status: r.status,
      started: r.startedAt.replace("T", " ").slice(0, 19),
      elapsed: secs(r.elapsedMs),
      catchup: ms(r.timings?.reportCatchup ?? null),
      sync: ms(r.timings?.sync ?? null),
      lead: ms(r.timings?.lead ?? null),
      trades: ms(r.timings?.trades ?? null),
      residual: ms(residualOf(r)),
      budgetStopped: r.sync?.budgetStopped ?? "—",
      seen: r.sync?.seen ?? "—",
      upserted: r.sync?.upserted ?? "—",
    })),
  );

  // §1 Lead regression guard — over ALL post-fix rows that carry a lead.
  const leadVals = postFixTimed
    .map((r) => r.timings!.lead)
    .filter((x): x is number => x != null);
  const leadD = dist(leadVals);
  console.log("\n§1 LEAD REGRESSION GUARD (all post-fix rows)");
  console.log(
    `  lead  n=${leadD.n}  min=${ms(leadD.min)}  p50=${ms(leadD.p50)}  p90=${ms(leadD.p90)}  max=${ms(leadD.max)}`,
  );
  if ((leadD.max ?? 0) >= LEAD_REGRESSION_FLAG_MS) {
    console.log(
      `  ⚠ FINDING: a post-fix lead reached ${ms(leadD.max)} (≥${LEAD_REGRESSION_FLAG_MS}ms, toward the 14-20s stall band) — the hint may not be holding on some plan. HIGHER PRIORITY than the margin question.`,
    );
  } else if ((leadD.max ?? 0) >= POST_FIX_LEAD_MS) {
    console.log(
      `  ✓ Hint holding: leads ${ms(leadD.min)}-${ms(leadD.max)}. The high sample (${ms(leadD.max)}) is Gemini-generation jitter (the lead step wraps the generateDashboardLead call), not the OR-lure DB stall (14-20s). HO 480/481 confirmed.`,
    );
  } else {
    console.log(`  ✓ All post-fix leads < ${POST_FIX_LEAD_MS}ms — hint holding, HO 480/481 confirmed.`);
  }

  // §2 Post-fix step distribution.
  const syncVals = postFixTimed.map((r) => r.timings!.sync).filter((x): x is number => x != null);
  const tradesVals = postFixTimed.map((r) => r.timings!.trades).filter((x): x is number => x != null);
  const catchupVals = postFixTimed
    .map((r) => r.timings!.reportCatchup)
    .filter((x): x is number => x != null);
  const elapsedVals = postFixTimed.map((r) => r.elapsedMs).filter((x): x is number => x != null);
  const residualVals = postFixTimed
    .map((r) => residualOf(r))
    .filter((x): x is number => x != null);
  console.log("\n§2 POST-FIX STEP DISTRIBUTION (min / p50 / p90 / max)");
  const tbl2 = {
    reportCatchup: dist(catchupVals),
    sync: dist(syncVals),
    lead: leadD,
    trades: dist(tradesVals),
    elapsed_ms: dist(elapsedVals),
    residual: dist(residualVals),
  };
  console.table(
    Object.fromEntries(
      Object.entries(tbl2).map(([k, d]) => [
        k,
        { n: d.n, min: ms(d.min), p50: ms(d.p50), p90: ms(d.p90), max: ms(d.max) },
      ]),
    ),
  );

  // §3 Sync-tail check — the core margin question.
  const tailRows = postFixTimed.filter((r) => (r.timings!.sync ?? 0) > SYNC_BUDGET_MS);
  const overshoots = tailRows.map((r) => (r.timings!.sync ?? 0) - SYNC_BUDGET_MS);
  const oD = dist(overshoots);
  console.log("\n§3 SYNC-TAIL CHECK (timings.sync > 30_000)");
  console.log(
    `  rows over budget: ${tailRows.length}/${postFixTimed.length}` +
      (tailRows.length
        ? `  overshoot min=${ms(oD.min)} p90=${ms(oD.p90)} max=${ms(oD.max)}`
        : ""),
  );
  if (tailRows.length) {
    console.table(
      tailRows.map((r) => ({
        id: r.id,
        sync: ms(r.timings!.sync),
        overshoot: ms((r.timings!.sync ?? 0) - SYNC_BUDGET_MS),
        budgetStopped: r.sync?.budgetStopped ?? "—",
        seen: r.sync?.seen ?? "—",
        upserted: r.sync?.upserted ?? "—",
        elapsed: secs(r.elapsedMs),
      })),
    );
    const stoppedTail = tailRows.filter((r) => r.sync?.budgetStopped === true).length;
    console.log(
      `  cross-tab: ${stoppedTail}/${tailRows.length} over-budget rows have budgetStopped=true (in-flight-bill tail eating lead+trades headroom).`,
    );
    // crude correlation: overshoot vs (seen) — report side by side, small n
    console.log("  overshoot vs delta (seen/upserted) — inspect the table above for a size→tail relationship.");
  } else {
    console.log("  ✓ No post-fix tick ran sync past the 30s budget — the tail is not the margin driver.");
  }

  // §4 Trades wall spread.
  console.log("\n§4 TRADES WALL SPREAD");
  const tD = dist(tradesVals);
  console.log(
    `  trades  n=${tD.n}  min=${ms(tD.min)}  p50=${ms(tD.p50)}  p90=${ms(tD.p90)}  max=${ms(tD.max)}`,
  );
  const fatTrades = postFixTimed.filter((r) => (r.timings!.trades ?? 0) > 10_000);
  if (fatTrades.length) {
    console.log(`  ⚠ FINDING: ${fatTrades.length} post-fix tick(s) with trades > 10s:`);
    console.table(
      fatTrades.map((r) => ({ id: r.id, trades: ms(r.timings!.trades), elapsed: secs(r.elapsedMs) })),
    );
    console.log("    (insert-count scaling or an FMP behavior change — cross-check Part B page probe.)");
  } else {
    console.log("  ✓ No post-fix trades tick > 10s.");
  }

  // §5 Residual audit.
  console.log("\n§5 RESIDUAL AUDIT (elapsed_ms − Σ four steps)");
  const rD = dist(residualVals);
  console.log(
    `  residual  n=${rD.n}  min=${ms(rD.min)}  p50=${ms(rD.p50)}  p90=${ms(rD.p90)}  max=${ms(rD.max)}`,
  );
  if ((rD.p90 ?? 0) > 3_000) {
    console.log(
      `  ⚠ Residual p90=${ms(rD.p90)} is large+positive — cost lives OUTSIDE the four timed steps ` +
        "(post-sync revalidateTag, wrapCronRoute finalize, Promise.race, the startCronRun round-trip in elapsed_ms). Changes the fix.",
    );
  } else {
    console.log("  ✓ Residual small — the four timed steps account for ~all of elapsed_ms.");
  }
  console.log(
    "  NOTE: elapsed_ms (DB column) brackets startCronRun→finishCronRun, so it includes ~1 extra Turso",
  );
  console.log(
    "  round-trip vs the handler's own clock. wrapperElapsedMs (payload.elapsedMs) is the tighter bracket;",
  );
  console.log("  both are printed in §6 so the residual's composition is transparent.");

  // §6 Anchor decomposition.
  console.log("\n§6 ANCHOR DECOMPOSITION — #3446 / #3499 / #3558");
  const anchorRs = await db.execute(
    `SELECT id, started_at, status, elapsed_ms, payload
     FROM cron_runs WHERE route='/api/sync' AND id IN (${ANCHOR_IDS.join(",")})
     ORDER BY id ASC`,
  );
  const anchors = anchorRs.rows.map((r) => parseRow(r as Record<string, unknown>));
  if (anchors.length === 0) {
    console.log("  ⚠ None of the anchor ids are present in cron_runs (aged out?).");
  } else {
    console.table(
      anchors.map((r) => ({
        id: r.id,
        status: r.status,
        elapsed_ms: secs(r.elapsedMs),
        wrapperElapsed: secs(r.wrapperElapsedMs),
        catchup: ms(r.timings?.reportCatchup ?? null),
        sync: ms(r.timings?.sync ?? null),
        lead: ms(r.timings?.lead ?? null),
        trades: ms(r.timings?.trades ?? null),
        residual: ms(residualOf(r)),
        budgetStopped: r.sync?.budgetStopped ?? "—",
        seen: r.sync?.seen ?? "—",
        upserted: r.sync?.upserted ?? "—",
        catchupGen: r.reportCatchupGenerated ?? "—",
      })),
    );
    // Name where #3446's time went.
    const a3446 = anchors.find((r) => r.id === 3446);
    if (a3446 && a3446.timings) {
      const t = a3446.timings;
      const parts: Array<[string, number | null]> = [
        ["reportCatchup", t.reportCatchup],
        ["sync", t.sync],
        ["lead", t.lead],
        ["trades", t.trades],
        ["residual", residualOf(a3446)],
      ];
      const dominant = parts
        .filter((p) => p[1] != null)
        .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
      console.log(
        `\n  #3446 total ${secs(a3446.elapsedMs)}. Dominant contributor: ${dominant?.[0]} = ${ms(dominant?.[1] ?? null)}.`,
      );
      const tailOver = t.sync != null && t.sync > SYNC_BUDGET_MS ? t.sync - SYNC_BUDGET_MS : 0;
      console.log(
        `  vs the 33-40s prediction, the excess is: sync-tail ${ms(tailOver)} over budget · ` +
          `trades ${ms(t.trades)} · residual ${ms(residualOf(a3446))} · reportCatchup ${ms(t.reportCatchup)}` +
          (a3446.reportCatchupGenerated ? " (GAP DAY — full report gen ran)" : ""),
      );
    }
  }

  return { postFix, p90Elapsed: quantile(elapsedVals, 0.9) };
}

// ===========================================================================
// PART B — isolate the two live suspects.
async function partB(db: ReturnType<typeof getDb>): Promise<void> {
  console.log("\n============================================================");
  console.log("PART B — isolate the two live suspects (confirm cause)");
  console.log("============================================================");

  // --- Trades fetch half (confirms the 402 finding). ---
  console.log("\n§B1 TRADES FETCH HALF — cold-time FMP GETs, pages 0/1/2 (GET-only, no insert loop).");
  console.log(
    "  Raw GET mirroring lib/fmp.ts fetchPage URL (bypasses the fetcher's 60s backoff);",
  );
  console.log(`  20s soft ceiling per fetch. Expected: page 0 rows, pages 1-2 → 402/empty.`);
  const key = process.env.FMP_API_KEY;
  if (!key) {
    console.log("  ⚠ FMP_API_KEY not set — skipping the fetch probe (can't confirm the 402 finding).");
  } else {
    let anyLatePage = false;
    for (const chamber of ["senate", "house"] as const) {
      const endpoint = FMP_ENDPOINTS[chamber];
      for (const page of [0, 1, 2]) {
        const url = `${FMP_BASE}/${endpoint}?page=${page}&apikey=${key}`;
        const t0 = Date.now();
        let statusStr = "";
        let rowCount: number | string = "";
        let tripped = false;
        try {
          const res = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(FMP_PROBE_CEILING_MS),
          });
          statusStr = String(res.status);
          const body = await res.text();
          if (res.ok) {
            try {
              const parsed = JSON.parse(body) as unknown;
              rowCount = Array.isArray(parsed) ? parsed.length : `non-array(${typeof parsed})`;
              if (page >= 1 && Array.isArray(parsed) && parsed.length > 0) anyLatePage = true;
            } catch {
              rowCount = "parse-error";
            }
          } else {
            rowCount = `body:${body.slice(0, 60).replace(/\s+/g, " ")}`;
          }
        } catch (e) {
          tripped = e instanceof Error && e.name === "TimeoutError";
          statusStr = tripped ? "TIMEOUT(>20s)" : `ERR:${(e as Error).name}`;
          rowCount = tripped ? "" : (e as Error).message.slice(0, 60);
          if (tripped) anyLatePage = true; // fetch stall is itself a finding
        }
        const dt = Date.now() - t0;
        console.log(
          `  ${chamber.padEnd(6)} page ${page}: ${statusStr.padEnd(14)} ${String(dt).padStart(6)}ms  rows/${rowCount}`,
        );
        if (tripped) console.log(`    ⚠ FINDING: fetch tripped the 20s ceiling — a fetch stall, not a page-count issue.`);
      }
    }
    if (anyLatePage) {
      console.log(
        "\n  ⚠ FINDING: a page ≥1 returned data (or stalled). FMP CHANGED — trades will scale with page count. Re-litigate maxPagesPerChamber.",
      );
    } else {
      console.log(
        "\n  ✓ Pages 1-2 return 402/empty — the maxPagesPerChamber:3 no-op (HO 480) STILL HOLDS. page-0-only per chamber.",
      );
    }
  }

  // --- Trades insert cost (estimate — don't run the loop). ---
  console.log("\n§B2 TRADES INSERT COST — per-tick insert volume + single round-trip benchmark (est., no ingest loop).");

  // Per-tick insert volume from stock_trades. ingested_at is set once per
  // chamber-run, so grouping by exact ingested_at ≈ inserts-per-run (per tick).
  const perRun = await db.execute(
    `SELECT ingested_at, COUNT(*) AS n
     FROM stock_trades GROUP BY ingested_at ORDER BY ingested_at DESC LIMIT 20`,
  );
  const perRunCounts = perRun.rows.map((r) => Number(r.n));
  console.log(
    `  Recent inserts-per-run (distinct ingested_at, newest 20): [${perRunCounts.join(", ")}]`,
  );
  const prD = dist(perRunCounts);
  console.log(
    `  inserts/run  n=${prD.n}  min=${prD.min}  p50=${prD.p50}  p90=${prD.p90}  max=${prD.max}`,
  );
  const totalRs = await db.execute(
    `SELECT COUNT(*) AS n, MIN(disclosure_date) AS mn, MAX(disclosure_date) AS mx FROM stock_trades`,
  );
  console.log(
    `  stock_trades total=${totalRs.rows[0]?.n}  disclosure_date ${totalRs.rows[0]?.mn} … ${totalRs.rows[0]?.mx}`,
  );
  console.log(
    `  NOTE: trades-time is bound by ATTEMPTED INSERT OR IGNOREs (~${TRADES_ATTEMPTED_INSERTS}: page-0 ~100 rows/chamber × 2),`,
  );
  console.log("  most colliding→ignored (rowsAffected 0) but each a full round-trip — NOT by newly-inserted rows.");

  // Single INSERT OR IGNORE round-trip benchmark — collide on an existing PK
  // so it is IGNORED and writes NOTHING.
  const sampleRs = await db.execute(`SELECT id FROM stock_trades LIMIT 1`);
  const existingId = sampleRs.rows[0]?.id as string | undefined;
  if (!existingId) {
    console.log("  ⚠ stock_trades empty — cannot benchmark a colliding insert.");
  } else {
    console.log(
      `\n  Benchmarking ${INSERT_ROUNDTRIP_TRIALS} INSERT OR IGNORE round-trips (PK collision → IGNORED, ZERO WRITES)...`,
    );
    const trips: number[] = [];
    for (let i = 0; i < INSERT_ROUNDTRIP_TRIALS; i++) {
      const t0 = Date.now();
      const r = await db.execute({
        sql: `INSERT OR IGNORE INTO stock_trades
                (id, member_name_raw, chamber, raw_json, ingested_at)
              VALUES (?, ?, ?, ?, ?)`,
        args: [existingId, "ho482-probe", "senate", "{}", "1970-01-01T00:00:00.000Z"],
      });
      trips.push(Date.now() - t0);
      if ((r.rowsAffected ?? 0) !== 0) {
        console.log(`  ⚠ UNEXPECTED: rowsAffected=${r.rowsAffected} on a colliding insert — investigate.`);
      }
    }
    const tripD = dist(trips);
    console.log(
      `  round-trip  min=${ms(tripD.min)}  p50=${ms(tripD.p50)}  p90=${ms(tripD.p90)}  max=${ms(tripD.max)}  (all rowsAffected=0, nothing written)`,
    );
    const projP50 = (tripD.p50 ?? 0) * TRADES_ATTEMPTED_INSERTS;
    const projP90 = (tripD.p90 ?? 0) * TRADES_ATTEMPTED_INSERTS;
    console.log(
      `  PROJECTION: ${TRADES_ATTEMPTED_INSERTS} × p50 ≈ ${secs(projP50)} · × p90 ≈ ${secs(projP90)} of trades wall-time from inserts alone.`,
    );
    console.log(
      "  Compare to Part A §4 trades p50/p90 — if they align, trades is insert-round-trip-bound (Turso latency × ~200), confirming the roadmap.",
    );
  }

  console.log("\n  (Sync tail is already answered by Part A §3 — payload.sync counters are persisted; no isolation run.)");
}

// ===========================================================================
// PART C — the margin verdict.
function partC(p90Elapsed: number | null, postFix: SyncRow[]): void {
  console.log("\n============================================================");
  console.log("PART C — the margin verdict (the 'if volumes climb' answer)");
  console.log("============================================================");
  if (p90Elapsed == null) {
    console.log("  ⚠ No post-fix elapsed_ms values — cannot compute a margin. Re-run once post-fix ticks accrue.");
    return;
  }
  const margin = SOFT_CAP_MS - p90Elapsed;
  const worstElapsed = maxOf(
    postFix.map((r) => r.elapsedMs).filter((x): x is number => x != null),
  );
  const tradesVals = postFix
    .map((r) => r.timings?.trades)
    .filter((x): x is number => x != null);
  const syncVals = postFix
    .map((r) => r.timings?.sync)
    .filter((x): x is number => x != null);
  const residualVals = postFix
    .map((r) => residualOf(r))
    .filter((x): x is number => x != null);
  console.log(`\n  p90(elapsed_ms) = ${secs(p90Elapsed)}   worst single tick = ${secs(worstElapsed)}`);
  console.log(`  margin = 55s − p90(elapsed_ms) = ${secs(margin)}`);

  // Where does the margin live? name dominant contributor.
  const tradesP90 = quantile(tradesVals, 0.9);
  const syncP90 = quantile(syncVals, 0.9);
  const residualP90 = quantile(residualVals, 0.9);
  const contributors: Array<[string, number | null]> = [
    ["sync-tail", syncP90 != null ? syncP90 - SYNC_BUDGET_MS : null],
    ["trades", tradesP90],
    ["residual", residualP90],
  ];
  const dominant = contributors
    .filter((c) => c[1] != null)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0];
  console.log(
    `  margin lives in: sync p90=${ms(syncP90)} (over-budget ${ms(syncP90 != null ? syncP90 - SYNC_BUDGET_MS : null)}) · trades p90=${ms(tradesP90)} · residual p90=${ms(residualP90)}`,
  );
  console.log(`  → dominant contributor to the wall: ${dominant?.[0]} (${ms(dominant?.[1] ?? null)})`);

  console.log("\n  VERDICT:");
  if (margin > 12_000) {
    console.log("  margin > ~12s → #3446's 50.0s was a ONE-OFF (a fat-delta sync tail on one tick).");
    console.log("  RECOMMEND: WATCH, no fix.");
    console.log(
      `  Re-probe trigger: re-run if any single /api/sync tick breaches 48s, OR if stock_trades daily insert`,
    );
    console.log("  volume doubles from today's baseline (see Part B §B2 inserts/run baseline printed above).");
  } else if (margin < 8_000) {
    console.log("  margin < ~8s → STRUCTURAL risk; will breach the 55s cap as corpus/disclosure volume climbs.");
    console.log("  RECOMMEND (preference order — this probe builds none):");
    console.log("    1. Split trades to its own cron slot (/api/cron/trades) — cleanest decouple; removes trades' whole 2.4-7.5s+ from the sync wall.");
    console.log("    2. Batch the trades inserts — collapse ~200 sequential INSERT OR IGNORE into one multi-row INSERT/txn (the win if Part B confirms insert-bound).");
    console.log("    3. Tighten the sync tail — bound the in-flight bill fetch so it can't tail ~10s past budgetStopped (the win if §3 shows sync 35-40s).");
    console.log(`  Pick #${dominant?.[0] === "trades" ? "2 (or 1)" : dominant?.[0] === "sync-tail" ? "3" : "1/2"} first — it matches the dominant contributor above.`);
  } else {
    console.log("  8s ≤ margin ≤ 12s → not urgent, but do it before the next volume bump.");
    console.log(`  Dominant contributor is ${dominant?.[0]}; the matching single fix:`);
    if (dominant?.[0] === "trades")
      console.log("    → Batch the trades inserts (or split trades to its own cron slot).");
    else if (dominant?.[0] === "sync-tail")
      console.log("    → Tighten the sync tail (bound the in-flight bill fetch past budgetStopped).");
    else console.log("    → Attack the residual (post-sync revalidate / wrapper finalize overhead).");
    console.log("  Framed as 'do it before the next volume bump,' not 'urgent.'");
  }
}

// ===========================================================================
async function main(): Promise<void> {
  const db = getDb();
  console.log("HO 482 — /api/sync margin probe (sync-tail + trades). READ-ONLY.");
  console.log(`Constants: SYNC_BUDGET=${SYNC_BUDGET_MS}ms  SOFT_CAP=${SOFT_CAP_MS}ms  post-fix id>=${POST_FIX_MIN_ID}`);

  const { postFix, p90Elapsed } = await partA(db);
  await partB(db);
  partC(p90Elapsed, postFix);

  console.log("\n=== done (nothing written to prod) ===");
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
