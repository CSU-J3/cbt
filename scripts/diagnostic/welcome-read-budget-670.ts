// HO 670 STEP 0.3 — /welcome read-budget measurement. READ-ONLY.
//
// Instrument: the REAL query functions from lib/queries.ts, called through the
// real lib/db.ts client, with rows_read read off Turso's own pipeline response
// at the transport layer (a globalThis.fetch shim, which lib/db.ts's boundedFetch
// calls). Nothing here reproduces SQL, so the measurement cannot drift from the
// shipped query the way a hand-copied predicate can.
//
// Two shims are needed to run App-Router query code under plain tsx:
//   1. globalThis.AsyncLocalStorage — Next's async-local-storage module asserts it
//   2. globalThis.__incrementalCache — unstable_cache's invariant. The stub is an
//      ALWAYS-MISS cache (get -> null, set -> no-op), which is what we want: every
//      call executes and is measured. A real cache would report 0 on the second
//      call and flatter the budget.
//
//   npx tsx scripts/diagnostic/welcome-read-budget-670.ts
import { AsyncLocalStorage } from "node:async_hooks";
import "dotenv/config";

(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;

let rows = 0;
let statements = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const res = await realFetch(input as never, init as never);
  try {
    const j = (await res.clone().json()) as {
      results?: { response?: { result?: { rows_read?: number } } }[];
    };
    for (const r of j.results ?? []) {
      const rr = r.response?.result?.rows_read;
      if (typeof rr === "number") {
        rows += rr;
        statements += 1;
      }
    }
  } catch {
    /* not a pipeline response — ignore */
  }
  return res;
}) as typeof fetch;

(globalThis as Record<string, unknown>).__incrementalCache = {
  isOnDemandRevalidate: false,
  generateCacheKey: async (k: string) => k,
  get: async () => null,
  set: async () => {},
};

type Measured = {
  label: string;
  rows: number;
  statements: number;
  ms: number;
  note: string;
};

async function measure<T>(
  label: string,
  fn: () => Promise<T>,
  describe: (r: T) => string,
): Promise<Measured> {
  rows = 0;
  statements = 0;
  const t0 = Date.now();
  let note = "";
  try {
    const r = await fn();
    note = describe(r);
  } catch (e) {
    note = "ERROR: " + (e as Error).message.slice(0, 120);
  }
  return { label, rows, statements, ms: Date.now() - t0, note };
}

function table(title: string, out: Measured[]): number {
  console.log("\n-- " + title + " --");
  let total = 0;
  for (const m of out) {
    total += m.rows;
    console.log(
      "  " +
        m.label.padEnd(46) +
        " rows_read " +
        String(m.rows).padStart(8) +
        "  stmts " +
        String(m.statements).padStart(2) +
        "  " +
        String(m.ms).padStart(5) +
        "ms  " +
        m.note,
    );
  }
  console.log("  " + "TOTAL".padEnd(46) + " rows_read " + String(total).padStart(8));
  return total;
}

async function main() {
  if (!process.env.TURSO_DATABASE_URL) {
    throw new Error("TURSO_DATABASE_URL required (.env)");
  }
  const q = await import("../../lib/queries");
  console.log("=".repeat(112));
  console.log(
    "HO 670 STEP 0.3 — /welcome read budget. Read-only; every call measured on a cold (always-miss) cache.",
  );
  console.log("=".repeat(112));

  // -- CONTROLS: run FIRST, before any zero is trusted --------------------
  // A no-DB call must read 0 (else the shim leaks counts across measurements
  // and every number below is worthless); a known-live call must read > 0.
  const ctrlZero = await measure(
    "CONTROL (no DB work - pure sleep)",
    async () => {
      await new Promise((r) => setTimeout(r, 10));
      return null;
    },
    () => "expect rows_read 0",
  );
  const ctrlLive = await measure(
    "CONTROL (getCorpusStats - expect > 0)",
    () => q.getCorpusStats(true),
    (r) => "total=" + r.total,
  );
  table("Controls", [ctrlZero, ctrlLive]);
  if (ctrlZero.rows !== 0) console.log("  !! CONTROL FAILED - shim leaks across calls");
  if (ctrlLive.rows === 0) console.log("  !! CONTROL FAILED - shim sees nothing");

  // -- BASELINE: the CURRENT /welcome, exactly as app/welcome/page.tsx calls it
  const baseline: Measured[] = [];
  baseline.push(
    await measure(
      "getStageChanges({}, 7, 7)",
      () => q.getStageChanges({}, 7, 7),
      (r) => r.length + " rows",
    ),
  );
  baseline.push(
    await measure(
      "getStageChangesCount({}, 7)",
      () => q.getStageChangesCount({}, 7),
      (r) => "total=" + r.total,
    ),
  );
  baseline.push(
    await measure(
      "getCorpusStats(true)",
      () => q.getCorpusStats(true),
      (r) => "total=" + r.total,
    ),
  );
  baseline.push(
    await measure(
      "getStageDistribution(undefined, true)",
      () => q.getStageDistribution(undefined, true),
      (r) => r.bars.length + " bars",
    ),
  );
  baseline.push(
    await measure(
      "getLatestMarketTicks()",
      () => q.getLatestMarketTicks(),
      (r) => r.length + " ticks",
    ),
  );
  const baseTotal = table(
    "BASELINE - current /welcome (app/welcome/page.tsx:137-146)",
    baseline,
  );

  // -- CANDIDATE DATASETS: the nine panels, at panel-sized limits ----------
  const ds: Measured[] = [];
  ds.push(
    await measure(
      "P1a Bills movers 7d  getStageChanges({},7,12)",
      () => q.getStageChanges({}, 7, 12),
      (r) => r.length + " rows",
    ),
  );
  ds.push(
    await measure(
      "P1b Stalls  getStaleBills({}, 12)",
      () => q.getStaleBills({}, 12),
      (r) => r.length + " rows",
    ),
  );
  ds.push(
    await measure(
      "P1c Enacted  getEnactedThisWeek()",
      () => q.getEnactedThisWeek(),
      (r) => r.length + " rows",
    ),
  );
  ds.push(
    await measure(
      "P1c-alt Enacted  getFeedBills({stage:enacted},12)",
      () => q.getFeedBills({ stage: "enacted" }, { page: 1, pageSize: 12 }),
      (r) => r.bills.length + " rows",
    ),
  );
  ds.push(
    await measure(
      "P2a Members active  getMembersRanked({},volume,1,12)",
      () => q.getMembersRanked({}, "volume", 1, 12),
      (r) => r.length + " rows",
    ),
  );
  ds.push(
    await measure(
      "P2b Lobbying  getLobbyingRollup()",
      () => q.getLobbyingRollup(),
      (r) =>
        r
          ? "filings=" +
            r.stats.filings +
            " issues=" +
            r.issues.length +
            " drills=" +
            Object.keys(r.drill).length
          : "NULL",
    ),
  );
  ds.push(
    await measure(
      "P2c Hearings  getUpcomingMeetings({days:7})",
      () => q.getUpcomingMeetings({ days: 7 }),
      (r) => r.length + " rows",
    ),
  );
  ds.push(
    await measure(
      "P3a News  getBreakingNewsForHome({limit:12,hours:72})",
      () => q.getBreakingNewsForHome({ limit: 12, hours: 72 }),
      (r) => r.length + " rows",
    ),
  );
  ds.push(
    await measure(
      "P3b Races  getMostCompetitiveRaces(2026, 12)",
      () => q.getMostCompetitiveRaces(2026, 12),
      (r) => r.length + " rows",
    ),
  );
  ds.push(
    await measure(
      "P3c Patterns  getClusterStats()",
      () => q.getClusterStats(),
      (r) => r.length + " clusters",
    ),
  );
  table("CANDIDATE DATASETS (each measured cold, panel-sized limits)", ds);

  // -- ARITHMETIC ---------------------------------------------------------
  // The rebuild KEEPS four of the five baseline reads (the stat readout + the
  // tape). getStageChanges is re-measured at limit 12 as panel 1's dataset, so
  // it counts ONCE, in the dataset column, not twice.
  const keep = baseline.filter((b) => !b.label.startsWith("getStageChanges({}, 7, 7)"));
  const keepTotal = keep.reduce((a, b) => a + b.rows, 0);
  const chosen = ds.filter((d) => !d.label.startsWith("P1c-alt"));
  const dsTotal = chosen.reduce((a, b) => a + b.rows, 0);
  const rebuilt = keepTotal + dsTotal;
  console.log("\n-- BUDGET ARITHMETIC --");
  console.log("  baseline (current /welcome total)          " + String(baseTotal).padStart(9));
  console.log("  budget ceiling (3 x baseline)              " + String(baseTotal * 3).padStart(9));
  console.log("  rebuilt: kept baseline reads               " + String(keepTotal).padStart(9));
  console.log("  rebuilt: nine datasets                     " + String(dsTotal).padStart(9));
  console.log("  rebuilt TOTAL                              " + String(rebuilt).padStart(9));
  console.log("  multiple of baseline                       " + (rebuilt / baseTotal).toFixed(2) + "x");
  console.log(
    "  verdict: " +
      (rebuilt <= baseTotal * 3
        ? "WITHIN BUDGET"
        : "OVER BUDGET - the table must cut datasets"),
  );

  console.log("\n-- datasets ranked by cost (cut order runs from the top) --");
  for (const d of [...chosen].sort((a, b) => b.rows - a.rows)) {
    console.log("  " + String(d.rows).padStart(8) + "  " + d.label);
  }

  // -- VARIANTS: a dataset that returns ~nothing is an empty panel, which is
  // the STEP 3 failure mode. Price the alternates for the thin ones.
  const alt: Measured[] = [];
  alt.push(
    await measure(
      "ALT hearings  getUpcomingMeetings() (no day cap)",
      () => q.getUpcomingMeetings(),
      (r) => r.length + " rows",
    ),
  );
  alt.push(
    await measure(
      "ALT hearings  getUpcomingMeetings({days:30})",
      () => q.getUpcomingMeetings({ days: 30 }),
      (r) => r.length + " rows",
    ),
  );
  alt.push(
    await measure(
      "ALT hearings  getRecentMeetings(14)",
      () => q.getRecentMeetings(14),
      (r) => r.length + " rows",
    ),
  );
  alt.push(
    await measure(
      "ALT patterns  getTopicDistribution(true)",
      () => q.getTopicDistribution(undefined, true),
      (r) => r.length + " topics",
    ),
  );
  alt.push(
    await measure(
      "ALT patterns  getFillerWatch()",
      () => q.getFillerWatch(),
      (r) => JSON.stringify(r).slice(0, 60),
    ),
  );
  alt.push(
    await measure(
      "ALT members  getMembersRanked({},passrate,1,12)",
      () => q.getMembersRanked({}, "passrate", 1, 12),
      (r) => r.length + " rows",
    ),
  );
  table("ALTERNATES for the thin datasets", alt);

  // -- THE SHIPPING SET ---------------------------------------------------
  // Two datasets are swapped off their first-choice query because the first
  // choice returns ~nothing on live data (an empty panel is the STEP 3 failure
  // mode, and a track shorter than its 420px viewport also breaks the -50%
  // loop): Enacted moves off getEnactedThisWeek (0 rows in the current week) to
  // the enacted-stage feed slice, and Hearings adds the recent-meetings read to
  // the 3-row upcoming calendar (mid-August recess).
  const ship: Measured[] = [];
  ship.push(
    await measure(
      "KEEP  getStageChangesCount({}, 7)",
      () => q.getStageChangesCount({}, 7),
      (r) => "total=" + r.total,
    ),
  );
  ship.push(
    await measure(
      "KEEP  getCorpusStats(true)",
      () => q.getCorpusStats(true),
      (r) => "total=" + r.total,
    ),
  );
  ship.push(
    await measure(
      "KEEP  getStageDistribution(undefined, true)",
      () => q.getStageDistribution(undefined, true),
      (r) => r.bars.length + " bars",
    ),
  );
  ship.push(
    await measure(
      "KEEP  getLatestMarketTicks()  (both tapes, ONE read)",
      () => q.getLatestMarketTicks(),
      (r) => r.length + " ticks",
    ),
  );
  ship.push(
    await measure(
      "P1.1 Bills    getStageChanges({},7,12)",
      () => q.getStageChanges({}, 7, 12),
      (r) => r.length + " rows",
    ),
  );
  ship.push(
    await measure(
      "P1.2 Stalls   getStaleBills({}, 12)",
      () => q.getStaleBills({}, 12),
      (r) => r.length + " rows",
    ),
  );
  ship.push(
    await measure(
      "P1.3 Enacted  getFeedBills({stage:enacted}, 12)",
      () => q.getFeedBills({ stage: "enacted" }, { page: 1, pageSize: 12 }),
      (r) => r.bills.length + " rows",
    ),
  );
  ship.push(
    await measure(
      "P2.1 Members  getMembersRanked({},volume,1,12)",
      () => q.getMembersRanked({}, "volume", 1, 12),
      (r) => r.length + " rows",
    ),
  );
  ship.push(
    await measure(
      "P2.2 Lobbying getLobbyingRollup()  (O(1) blob)",
      () => q.getLobbyingRollup(),
      (r) => (r ? "drills=" + Object.keys(r.drill).length : "NULL"),
    ),
  );
  ship.push(
    await measure(
      "P2.3 Hearings getUpcomingMeetings()",
      () => q.getUpcomingMeetings(),
      (r) => r.length + " rows",
    ),
  );
  ship.push(
    await measure(
      "P2.3 Hearings getRecentMeetings(14)",
      () => q.getRecentMeetings(14),
      (r) => r.length + " rows",
    ),
  );
  ship.push(
    await measure(
      "P3.1 News     getBreakingNewsForHome({limit:12,hours:72})",
      () => q.getBreakingNewsForHome({ limit: 12, hours: 72 }),
      (r) => r.length + " rows",
    ),
  );
  ship.push(
    await measure(
      "P3.2 Races    getMostCompetitiveRaces(2026, 12)",
      () => q.getMostCompetitiveRaces(2026, 12),
      (r) => r.length + " rows",
    ),
  );
  ship.push(
    await measure(
      "P3.3 Patterns getClusterStats()",
      () => q.getClusterStats(),
      (r) => r.length + " clusters",
    ),
  );
  const shipTotal = table("THE SHIPPING SET (what the rebuild actually reads)", ship);
  console.log("\n-- FINAL BUDGET --");
  console.log("  baseline (current /welcome)                " + String(baseTotal).padStart(9));
  console.log("  ceiling  (3 x baseline)                    " + String(baseTotal * 3).padStart(9));
  console.log("  rebuilt  (shipping set)                    " + String(shipTotal).padStart(9));
  console.log("  multiple                                   " + (shipTotal / baseTotal).toFixed(2) + "x");
  console.log(
    "  verdict: " +
      (shipTotal <= baseTotal * 3 ? "WITHIN BUDGET" : "OVER BUDGET - cut datasets"),
  );
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
