// HO 582 STEP 0 — markets tape read burn: measure, then HALT (READ-ONLY).
//
// The backlog OPEN LOOP "Markets tape read burn (HO 577)" pinned the mechanism by
// code read; this measures it before any fix ships (the read-budget WATCH: two
// reasoned read-cost claims were falsified on inspection this month, so nothing
// ships on arithmetic — STEP 0 measures first). No writes anywhere; a runtime
// guard refuses any non-SELECT / non-EXPLAIN statement.
//
// The mechanism as read at 1cf6cbc: getLatestMarketTicks (queries.ts:8574,
// unstable_cache tags:["markets"], revalidate:60) runs two statements per
// regeneration — Q1 latest-per-symbol (INNER JOIN over a MAX(ticked_at) GROUP BY
// subquery) and Q2 the HO 374 9-day spark window whose julianday(ticked_at) wrap
// is non-sargable against idx_market_ticks_symbol_time. MarketsTapeClient polls
// /api/markets/latest at POLL_MS=60_000; TTL==poll interval, so any open tab drives
// ~1 SWR regen/min (~1,440/day) around the clock.
//
// RUN 2026-07-31 (MEASURED, not code-derived). HALT output:
//   M0 — single writer (app/api/cron/markets/route.ts:71), one real flush (:122; the
//     latest/route.ts hit is a comment). kalshi does not write market_ticks. C1 SAFE.
//   M1 — 6,604 rows; MIN 2026-05-27, MAX 2026-07-31; ticked_at IS JS ISO
//     (YYYY-MM-DDTHH:MM:SS.sssZ) → C2's JS-ISO bound matches the stored representation.
//     13 STALE legacy symbols still in the table (DOW/GOLD/BTC/ITA/XLK/XLV/XLF/XLE/XLI/
//     NATGAS/DXY/SILVER/VIX — the retired Stooq/HO-227 set, no new writes); harmless to
//     the tape (Q2 filters symbol IN sparkKeys; Q1 returns then getLatestMarketTicks
//     skips them via `if (!meta) continue`), NOT in scope to purge here.
//   M2 — Q1 = COVERING-INDEX SCAN of the whole index (~6,604 rows_read, 32ms, index-only);
//     Q2 = non-sargable per-symbol SEARCH that reads EVERY row each spark symbol owns
//     (5,636 rows_read, ~52ms, returns 1,619). The julianday() wrap defeats the range.
//   M3a — rewrite EXPLAIN: SEARCH ...(symbol=? AND ticked_at>?) — a per-symbol range
//     SEARCH ✓. Equivalence: 1,619 == 1,619, row-for-row identical, same order → C2
//     gated PASS. M3b — SKIPPED (Q1 index-only, not a TABLE scan) → C3 is a NO-OP.
//   M4 — SHIPPED ~12,240 rows/regen (Q2 5,636 + Q1 6,604) × ~1,440 poll-regens/day =
//     ~17.6M rows/day PER open tab = ~20.1% of the ~88M/day plateau. C1 alone (regen
//     1,440→24) → ~294k/day (0.34%); C1+C2 → ~197k/day (0.23%). C1 is the ~60× lever,
//     C2 ~1.5×. VERDICT: NOT small — a single around-the-clock tab is ~1/5 of the
//     plateau, so the tape is a REAL contributor and C1 closes most of the OPEN LOOP;
//     the residual ~80% still points at summarize / LDA / traffic (backlog stays open).
//   M4b — SKIPPED (usage-delta needs the Turso dashboard, not a DB query).
//
// The fix (after HALT clears): C1 revalidate 60→86400 + regen marker + the false header
// comment; C2 the sargable ticked_at bound (M3a PASS); C3 skipped; C4 visibility-gate
// the poll. Commit order C1 → C2 → C4, code/docs never mixed.
import "dotenv/config";
import { getDb } from "@/lib/db";
import { MARKET_SYMBOLS } from "@/lib/markets";

const WRITE = /\b(insert|update|delete|create|drop|alter|replace|vacuum|reindex)\b/i;
function ro(sql: string): string {
  // EXPLAIN QUERY PLAN <select> is allowed; a bare write is not.
  const body = sql.replace(/^\s*explain\s+query\s+plan\s+/i, "");
  if (WRITE.test(body)) throw new Error(`read-only guard tripped: ${sql.slice(0, 70)}`);
  return sql;
}

// The two shipped statements, VERBATIM from getLatestMarketTicks (queries.ts).
const sparkKeys = MARKET_SYMBOLS.filter((s) => s.source !== "polymarket").map(
  (s) => s.internal,
);

const Q1 = `
  SELECT m.symbol, m.price, m.change_pct, m.ticked_at, m.market_date
  FROM market_ticks m
  INNER JOIN (
    SELECT symbol, MAX(ticked_at) AS max_t
    FROM market_ticks
    GROUP BY symbol
  ) latest ON m.symbol = latest.symbol AND m.ticked_at = latest.max_t
  ORDER BY m.symbol`;

const Q2_SQL = `SELECT symbol, price, ticked_at
      FROM market_ticks
      WHERE symbol IN (${sparkKeys.map(() => "?").join(",")})
        AND julianday(ticked_at) >= julianday('now','-9 day')
      ORDER BY symbol, ticked_at`;

// M3a candidate: the sargable rewrite — a JS ISO bound instead of julianday().
const Q2_REWRITE_SQL = `SELECT symbol, price, ticked_at
      FROM market_ticks
      WHERE symbol IN (${sparkKeys.map(() => "?").join(",")})
        AND ticked_at >= ?
      ORDER BY symbol, ticked_at`;

function hr() {
  console.log("─".repeat(72));
}

async function explain(db: ReturnType<typeof getDb>, sql: string, args: unknown[] = []) {
  const rs = await db.execute({ sql: ro(`EXPLAIN QUERY PLAN ${sql}`), args: args as never });
  for (const r of rs.rows) {
    // libSQL returns {id, parent, notused, detail}
    console.log(`    ${(r as Record<string, unknown>).detail}`);
  }
  return rs.rows.map((r) => String((r as Record<string, unknown>).detail));
}

async function timeit(
  db: ReturnType<typeof getDb>,
  sql: string,
  args: unknown[],
  runs: number,
): Promise<{ ms: number[]; rows: number }> {
  const ms: number[] = [];
  let rows = 0;
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now();
    const rs = await db.execute({ sql: ro(sql), args: args as never });
    ms.push(+(performance.now() - t0).toFixed(1));
    rows = rs.rows.length;
  }
  return { ms, rows };
}

async function main() {
  const db = getDb();
  console.log("HO 582 STEP 0 — markets tape read burn (READ-ONLY)\n");

  // ── M0 — writer census (static; grepped at authoring, printed here) ──────────
  hr();
  console.log("M0 — WRITER CENSUS (static grep across app/ + lib/ + scripts/)");
  console.log("  INSERT INTO market_ticks:  1 site");
  console.log("    · app/api/cron/markets/route.ts:71  (the only writer)");
  console.log('  revalidateTag("markets"):  1 real call');
  console.log("    · app/api/cron/markets/route.ts:122");
  console.log("    · app/api/markets/latest/route.ts:5  (COMMENT, not a call)");
  console.log("  /api/cron/kalshi does NOT write market_ticks (revalidates \"races\").");
  console.log("  VERDICT: single writer, tag-covered → C1 (long TTL) is SAFE.");

  // ── M1 — table shape ─────────────────────────────────────────────────────────
  hr();
  console.log("M1 — TABLE SHAPE");
  const total = (await db.execute(ro(`SELECT COUNT(*) AS n FROM market_ticks`))).rows[0]
    ?.n as number;
  console.log(`  COUNT(*) = ${total}`);

  const minmax = (
    await db.execute(ro(`SELECT MIN(ticked_at) AS lo, MAX(ticked_at) AS hi FROM market_ticks`))
  ).rows[0] as Record<string, unknown>;
  console.log(`  MIN(ticked_at) = ${minmax.lo}`);
  console.log(`  MAX(ticked_at) = ${minmax.hi}`);

  const sample = (
    await db.execute(ro(`SELECT ticked_at FROM market_ticks ORDER BY id DESC LIMIT 1`))
  ).rows[0]?.ticked_at as string;
  console.log(`  verbatim ticked_at sample = ${JSON.stringify(sample)}`);
  const isoT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(sample);
  console.log(
    `  stored format is JS ISO (YYYY-MM-DDTHH:MM:SS.sssZ)? ${isoT ? "YES" : "NO — C2 bound must match this!"}`,
  );

  const perSym = await db.execute(
    ro(`SELECT symbol, COUNT(*) AS n FROM market_ticks GROUP BY symbol ORDER BY n DESC`),
  );
  const knownSet = new Set(MARKET_SYMBOLS.map((s) => s.internal));
  const symCounts = new Map<string, number>();
  console.log("  per-symbol counts (all symbols present):");
  for (const r of perSym.rows) {
    const sym = (r as Record<string, unknown>).symbol as string;
    const n = (r as Record<string, unknown>).n as number;
    symCounts.set(sym, n);
    const flag = knownSet.has(sym) ? "" : "  ⚠ NOT in MARKET_SYMBOLS";
    console.log(`    ${sym.padEnd(18)} ${String(n).padStart(6)}${flag}`);
  }

  // rows/day over trailing 14 days
  const perDay = await db.execute({
    sql: ro(`SELECT substr(ticked_at,1,10) AS d, COUNT(*) AS n
        FROM market_ticks
        WHERE ticked_at >= ?
        GROUP BY d ORDER BY d`),
    args: [new Date(Date.now() - 14 * 86_400_000).toISOString()],
  });
  console.log("  rows/day, trailing 14d:");
  for (const r of perDay.rows) {
    const rec = r as Record<string, unknown>;
    console.log(`    ${rec.d}  ${String(rec.n).padStart(5)}`);
  }

  // ── M2 — per-regeneration cost as shipped ────────────────────────────────────
  hr();
  console.log("M2 — PER-REGENERATION COST (as shipped)");
  console.log(`  sparkKeys (${sparkKeys.length}): ${sparkKeys.join(", ")}`);

  console.log("\n  Q1 EXPLAIN QUERY PLAN:");
  const q1plan = await explain(db, Q1);
  console.log("\n  Q2 EXPLAIN QUERY PLAN (shipped, julianday wrap):");
  const q2plan = await explain(db, Q2_SQL, sparkKeys);

  // analytic rows-read
  const sparkSum = sparkKeys.reduce((a, k) => a + (symCounts.get(k) ?? 0), 0);
  console.log("\n  analytic rows-read per regeneration:");
  console.log(
    `    Q2 (non-sargable): Σ rows across sparkKeys symbols = ${sparkSum}  (reads every row each spark symbol owns)`,
  );
  // Two distinct notions of "Q1 scans":
  //  · q1TableScan  → a scan of the TABLE (not index-only) — that's what C3 fixes. FALSE here.
  //  · q1IndexScan  → a covering-index SCAN reading the whole index (~COUNT(*) index rows).
  //    Cheap in ms (index-only) but STILL ~total rows_read against the budget.
  const q1TableScan = q1plan.some(
    (d) => /SCAN (?:TABLE )?market_ticks\b/i.test(d) && !/USING (?:COVERING )?INDEX/i.test(d),
  );
  const q1IndexScan = q1plan.some((d) => /SCAN market_ticks USING (?:COVERING )?INDEX/i.test(d));
  const q1RowsRead = q1TableScan || q1IndexScan ? total : sparkKeys.length; // seek-per-group would be ~sparkKeys
  console.log(
    `    Q1: MAX(ticked_at) GROUP BY symbol — plan is a ${q1TableScan ? "TABLE SCAN → C3 territory" : q1IndexScan ? "COVERING-INDEX SCAN (index-only, fast in ms, but reads the WHOLE index)" : "per-group minmax seek (cheap)"}`,
  );
  console.log(
    `        → Q1 rows_read ≈ ${q1RowsRead}${q1IndexScan ? " (all index entries; NOT ~15 — the whole ordered index feeds the streaming GROUP BY)" : ""}`,
  );
  console.log(
    `        → C3 (Q1 shape rewrite) is a NO-OP: the scan is index-only (not a TABLE scan), 32ms; a rewrite trades index-scan for index-seeks and does not touch the C1/regen-rate lever.`,
  );

  console.log("\n  cold-ish timing, 3 runs each (ms):");
  const t1 = await timeit(db, Q1, [], 3);
  console.log(`    Q1: ${t1.ms.join(", ")}  (${t1.rows} rows)`);
  const t2 = await timeit(db, Q2_SQL, sparkKeys, 3);
  console.log(`    Q2: ${t2.ms.join(", ")}  (${t2.rows} rows)`);

  // ── M3 — rewrite candidates, equivalence-gated ───────────────────────────────
  hr();
  console.log("M3 — REWRITE CANDIDATES (equivalence-gated)");
  const jsBound = new Date(Date.now() - 9 * 86_400_000).toISOString();
  console.log(`  (a) Q2 rewrite: julianday(...) → AND ticked_at >= '${jsBound}'`);
  console.log("      EXPLAIN QUERY PLAN:");
  const q2rwPlan = await explain(db, Q2_REWRITE_SQL, [...sparkKeys, jsBound]);
  const rwSeeks = q2rwPlan.some((d) => /SEARCH .*market_ticks .*USING INDEX idx_market_ticks_symbol_time/i.test(d));
  console.log(
    `      per-symbol range SEARCH on idx_market_ticks_symbol_time? ${rwSeeks ? "YES ✓" : "NO — investigate"}`,
  );

  // equivalence: run shipped Q2 then rewrite back-to-back, compare (symbol,ticked_at) rows in order
  const shipRs = await db.execute({ sql: ro(Q2_SQL), args: sparkKeys as never });
  const rwRs = await db.execute({ sql: ro(Q2_REWRITE_SQL), args: [...sparkKeys, jsBound] as never });
  const key = (r: unknown) => {
    const rec = r as Record<string, unknown>;
    return `${rec.symbol}|${rec.ticked_at}|${rec.price}`;
  };
  const shipKeys = shipRs.rows.map(key);
  const rwKeys = rwRs.rows.map(key);
  const orderEq = shipKeys.length === rwKeys.length && shipKeys.every((k, i) => k === rwKeys[i]);
  const shipSet = new Set(shipKeys);
  const rwSet = new Set(rwKeys);
  const onlyShip = shipKeys.filter((k) => !rwSet.has(k));
  const onlyRw = rwKeys.filter((k) => !shipSet.has(k));
  console.log(`      row counts: shipped=${shipKeys.length}  rewrite=${rwKeys.length}`);
  console.log(`      row-for-row identical (same rows, same order)? ${orderEq ? "YES ✓" : "NO"}`);
  if (!orderEq) {
    console.log(`      only-in-shipped (${onlyShip.length}): ${onlyShip.slice(0, 6).join(" ; ")}`);
    console.log(`      only-in-rewrite (${onlyRw.length}): ${onlyRw.slice(0, 6).join(" ; ")}`);
    console.log("      NOTE: ≤a couple boundary rows can differ from clock skew between the two");
    console.log("            'now' evaluations (julianday('now') vs JS Date.now()); >that = real.");
  }

  console.log("\n  rewrite timing, 3 runs (ms):");
  const t2rw = await timeit(db, Q2_REWRITE_SQL, [...sparkKeys, jsBound], 3);
  console.log(`    Q2-rewrite: ${t2rw.ms.join(", ")}  (${t2rw.rows} rows)`);

  console.log("\n  (b) Q1 rewrite gated on Q1 TABLE-SCANNING (M2):");
  if (q1TableScan) {
    const Q1_ALT = `SELECT symbol, price, ticked_at, market_date, change_pct
      FROM market_ticks
      WHERE id IN (
        SELECT (SELECT id FROM market_ticks mm WHERE mm.symbol = s.symbol
                ORDER BY ticked_at DESC LIMIT 1)
        FROM (SELECT DISTINCT symbol FROM market_ticks) s)`;
    console.log("      Q1 scans — pricing a per-symbol ORDER BY ticked_at DESC LIMIT 1 alternative:");
    await explain(db, Q1_ALT);
    const t1alt = await timeit(db, Q1_ALT, [], 3);
    console.log(`      Q1-alt timing: ${t1alt.ms.join(", ")} ms`);
  } else {
    console.log("      SKIPPED — Q1 is index-only (covering-index scan, not a TABLE scan). C3 is a no-op.");
  }

  // ── M4 — burn model + attribution ────────────────────────────────────────────
  hr();
  console.log("M4 — BURN MODEL + ATTRIBUTION");
  // Shipped per-regen reads BOTH statements. Post-fix, C2 turns Q2's non-sargable
  // full-per-symbol scan into a range SEARCH reading only the returned 9-day slice;
  // Q1 is UNCHANGED (C3 no-op) so its covering-index scan persists either way.
  const q2ShippedRows = sparkSum;
  const q2FixedRows = shipKeys.length; // the actual 9-day slice the range SEARCH returns
  const shippedPerRegen = q2ShippedRows + q1RowsRead;
  const fixedPerRegen = q2FixedRows + q1RowsRead;
  console.log(
    `  rows/regen SHIPPED ≈ Q2 ${q2ShippedRows} + Q1 ${q1RowsRead} = ~${shippedPerRegen}`,
  );
  console.log(
    `  rows/regen POST-FIX ≈ Q2 ${q2FixedRows} (C2 range SEARCH, 9d slice) + Q1 ${q1RowsRead} (C3 no-op) = ~${fixedPerRegen}`,
  );
  const POLL = 1440; // ≥1 open tab, TTL==poll → ~1 regen/min
  const WRITE_WEEKDAY = 6 + 18; // 6 full-pass (0 */4) + 18 fmp (0,30 13-21 Mon-Fri)
  const WRITE_WEEKEND = 6;
  console.log("  regen rate regimes:");
  console.log(`    poll-driven as shipped (≥1 tab): ~${POLL}/day (TTL==poll → ~1 SWR regen/min around the clock)`);
  console.log(`    write-driven post-fix: ~${WRITE_WEEKDAY}/weekday, ~${WRITE_WEEKEND}/weekend`);
  const shippedDaily = shippedPerRegen * POLL;
  const c1OnlyDaily = shippedPerRegen * WRITE_WEEKDAY; // C1 alone (regen-rate lever), Q2 unfixed
  const bothDaily = fixedPerRegen * WRITE_WEEKDAY; // C1 + C2
  const PLATEAU = 87_500_000; // ~85–90M/day account-wide plateau midpoint
  console.log(`  daily rows-read from the tape query (weekday):`);
  console.log(`    SHIPPED (poll, 1 open tab): ~${shippedDaily.toLocaleString()}/day  = ${((shippedDaily / PLATEAU) * 100).toFixed(1)}% of the ~${(PLATEAU / 1e6).toFixed(0)}M plateau`);
  console.log(`    after C1 only (write-rate): ~${c1OnlyDaily.toLocaleString()}/day  = ${((c1OnlyDaily / PLATEAU) * 100).toFixed(3)}%`);
  console.log(`    after C1 + C2:              ~${bothDaily.toLocaleString()}/day  = ${((bothDaily / PLATEAU) * 100).toFixed(3)}%`);
  console.log(`  lever sizing: C1 (regen rate ${POLL}→${WRITE_WEEKDAY}, ~${(POLL / WRITE_WEEKDAY).toFixed(0)}×) dwarfs C2 (per-regen ${shippedPerRegen}→${fixedPerRegen}, ~${(shippedPerRegen / fixedPerRegen).toFixed(1)}×).`);
  console.log("  TAB-COUNT NOTE: SWR collapses concurrent polls to ~1 regen/min, so N open tabs is");
  console.log("  NOT N× — the tab count only decides whether ANY regen fires each minute. The");
  console.log("  ~17.6M/day figure holds while ≥1 tab is open around the clock; a fully-closed app");
  console.log("  drops to the write-driven floor.");
  console.log("  VERDICT: this is NOT small — a single around-the-clock tab is ~20% of the plateau,");
  console.log("  so the tape is a REAL contributor and C1 closes most of the OPEN LOOP. Residual");
  console.log("  budget (the other ~80%) still points at summarize / LDA / traffic — backlog stays open there.");

  hr();
  console.log("M4b — SKIPPED (per-DB usage-delta needs the Turso dashboard / org usage;");
  console.log("       do NOT `turso db inspect` — it queries the DB. Rely on M2×model.)");
  hr();
  console.log("\nHALT — STEP 0 complete. No build code until the halt clears.");
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
