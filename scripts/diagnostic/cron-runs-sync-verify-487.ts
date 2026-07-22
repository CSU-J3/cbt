// HO 487 Step 1 — verify the 482/483 trades batch-fix claim against real prod
// cron rows (read-only, no writes).
//
// The claim on record: "warm trades wall dropped 5-11.5s -> 320ms" after the
// ~200 sequential db.execute round-trips in lib/trades-ingest.ts ingestChamber
// were collapsed into one db.batch(statements, "write"). It was measured at fix
// time and never checked across multiple prod days. This pulls /api/sync rows
// over 14 days and reports:
//   - overall route elapsed_ms: p50 / p90 / max, run count, non-ok statuses
//   - the trades-specific timing lifted from payload.timings.trades (the number
//     the 320ms claim is actually about)
//   - hour-of-day grouping to test the banked 00:00-UTC contention oddity
//
//   npx tsx scripts/diagnostic/cron-runs-sync-verify-487.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const str = (v: unknown): string => String(v ?? "");
const num = (v: unknown): number => Number(v ?? 0);

// nearest-rank percentile over an ascending-sorted number[]
function pct(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}
function line(label: string, vals: number[]): string {
  const s = [...vals].sort((a, b) => a - b);
  return `  ${label}: p50=${pct(s, 50)}  p90=${pct(s, 90)}  max=${s[s.length - 1] ?? 0}  (n=${s.length})`;
}

async function main() {
  console.log("=== HO 487 Step 1 — /api/sync cron_runs verification (14d) ===\n");
  const db = createClient({
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const rs = await db.execute(`
    SELECT route, started_at, elapsed_ms, status, payload
    FROM cron_runs
    WHERE route LIKE '%sync%'
      AND started_at >= datetime('now', '-14 days')
    ORDER BY started_at DESC
  `);

  // route breakdown — %sync% catches /api/sync plus any sync-* siblings.
  const byRoute = new Map<string, number>();
  for (const r of rs.rows) byRoute.set(str(r.route), (byRoute.get(str(r.route)) ?? 0) + 1);
  console.log("--- routes matched by LIKE '%sync%' ---");
  for (const [route, c] of [...byRoute.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${route}: ${c}`);
  }

  // Fix boundaries INSIDE the 14d window — the read must be split, not pooled:
  //   HO 480/481 lead-query hint sweep shipped 2026-07-18 14:32 (route timeout)
  //   HO 483 trades batch collapse shipped   2026-07-19 17:28 (trades step)
  const FIX_480_481 = "2026-07-18T14:33:00.000Z";
  const FIX_483 = "2026-07-19T17:29:00.000Z";

  // Focus on /api/sync (where ingestTrades runs).
  const syncAll = rs.rows.filter((r) => str(r.route) === "/api/sync");
  const sync = syncAll; // full-window alias kept for the hour breakdowns below

  const reportRoute = (label: string, rows: typeof syncAll) => {
    const el = rows.map((r) => num(r.elapsed_ms)).filter((n) => n > 0);
    const st = new Map<string, number>();
    for (const r of rows) st.set(str(r.status), (st.get(str(r.status)) ?? 0) + 1);
    const to = rows.filter((r) => str(r.status) === "timeout").length;
    console.log(`  ${label} (n=${rows.length}): ${line("elapsed", el).trim()}`);
    console.log(
      `    status: ${[...st.entries()].map(([s, c]) => `${s}=${c}`).join("  ")}  ` +
        `| timeout rate ${rows.length ? ((to / rows.length) * 100).toFixed(0) : "0"}%`,
    );
  };

  console.log(`\n--- /api/sync overall route elapsed_ms — SPLIT at HO 480/481 fix ---`);
  reportRoute("FULL 14d", syncAll);
  reportRoute("PRE-fix  (< 07-18 14:33)", syncAll.filter((r) => str(r.started_at) < FIX_480_481));
  reportRoute("POST-fix (>= 07-18 14:33)", syncAll.filter((r) => str(r.started_at) >= FIX_480_481));

  const elapsed = syncAll.map((r) => num(r.elapsed_ms)).filter((n) => n > 0);

  // status distribution + non-ok rows.
  const byStatus = new Map<string, number>();
  for (const r of sync) byStatus.set(str(r.status), (byStatus.get(str(r.status)) ?? 0) + 1);
  console.log("  status counts:", [...byStatus.entries()].map(([s, c]) => `${s}=${c}`).join("  "));
  // "success" is the ok status here; timeout/orphaned/error are the non-ok set.
  const nonOk = sync.filter((r) => str(r.status) !== "success");
  if (nonOk.length) {
    console.log(`  NON-OK rows (${nonOk.length}):`);
    for (const r of nonOk.slice(0, 20)) {
      console.log(`    ${str(r.started_at)}  status=${str(r.status)}  elapsed=${num(r.elapsed_ms)}ms`);
    }
  } else {
    console.log("  NON-OK rows: none");
  }

  // trades-specific timing from payload.timings.trades — the 320ms claim.
  // NB: timings.trades is the WHOLE ingestTrades step (FMP page fetches for up
  // to 3 pages x 2 chambers + name matching + the batch DB write), NOT the
  // isolated DB-write portion the batch collapse targeted. Only present on
  // success rows (a timeout is reaped before the step returns).
  const tradesMsOf = (r: (typeof syncAll)[number]): number | null => {
    if (r.payload == null) return null;
    try {
      const parsed = JSON.parse(String(r.payload));
      const t = parsed?.payload?.timings?.trades ?? parsed?.timings?.trades;
      return t == null ? null : Number(t);
    } catch {
      return null;
    }
  };
  const reportTrades = (label: string, rows: typeof syncAll) => {
    const vals = rows.map(tradesMsOf).filter((v): v is number => v != null);
    const s = [...vals].sort((a, b) => a - b);
    console.log(`  ${label}: ${line("trades ms", vals).trim()}` + (s.length ? `  min=${s[0]}` : ""));
  };
  console.log(`\n--- trades step timing (payload.timings.trades) — SPLIT at HO 483 fix ---`);
  reportTrades("FULL 14d", syncAll);
  reportTrades("PRE-483  (< 07-19 17:29)", syncAll.filter((r) => str(r.started_at) < FIX_483));
  reportTrades("POST-483 (>= 07-19 17:29)", syncAll.filter((r) => str(r.started_at) >= FIX_483));
  const tradeMs = syncAll.map(tradesMsOf).filter((v): v is number => v != null);

  // hour-of-day grouping for the 00:00-UTC contention oddity.
  // NOTE: raw elapsed_ms is near-useless here because most runs are pinned at
  // the ~55s soft-timeout cap — every slot reads ~55s. The cleaner signal is
  // the trades-step ms and the success-only elapsed, grouped by hour.
  const hourOf = (r: (typeof sync)[number]) => str(r.started_at).slice(11, 13);
  const tradesOf = (r: (typeof sync)[number]): number | null => {
    if (r.payload == null) return null;
    try {
      const parsed = JSON.parse(String(r.payload));
      const t = parsed?.payload?.timings?.trades ?? parsed?.timings?.trades;
      return t == null ? null : Number(t);
    } catch {
      return null;
    }
  };

  console.log(`\n--- elapsed_ms by hour-of-day (UTC) — cap-bound, low signal ---`);
  const byHour = new Map<string, number[]>();
  for (const r of sync) {
    const e = num(r.elapsed_ms);
    if (e <= 0) continue;
    const hh = hourOf(r);
    if (!byHour.has(hh)) byHour.set(hh, []);
    byHour.get(hh)!.push(e);
  }
  for (const hh of [...byHour.keys()].sort()) {
    const marker = hh === "00" ? "  <-- midnight slot" : "";
    console.log(line(`${hh}:00 UTC`, byHour.get(hh)!) + marker);
  }

  console.log(`\n--- trades-step ms by hour-of-day (UTC) — the real contention read ---`);
  const tradesByHour = new Map<string, number[]>();
  for (const r of sync) {
    const t = tradesOf(r);
    if (t == null) continue;
    const hh = hourOf(r);
    if (!tradesByHour.has(hh)) tradesByHour.set(hh, []);
    tradesByHour.get(hh)!.push(t);
  }
  for (const hh of [...tradesByHour.keys()].sort()) {
    const marker = hh === "00" ? "  <-- midnight slot" : "";
    console.log(line(`${hh}:00 UTC trades`, tradesByHour.get(hh)!) + marker);
  }

  console.log(`\n--- success-only elapsed_ms by hour-of-day (UTC) ---`);
  const okByHour = new Map<string, number[]>();
  for (const r of sync) {
    if (str(r.status) !== "success") continue;
    const e = num(r.elapsed_ms);
    if (e <= 0) continue;
    const hh = hourOf(r);
    if (!okByHour.has(hh)) okByHour.set(hh, []);
    okByHour.get(hh)!.push(e);
  }
  for (const hh of [...okByHour.keys()].sort()) {
    const marker = hh === "00" ? "  <-- midnight slot" : "";
    console.log(line(`${hh}:00 UTC ok`, okByHour.get(hh)!) + marker);
  }

  // re-probe trigger check: 52s breach, trades p90 > ~13s.
  console.log(`\n--- re-probe trigger proximity ---`);
  const routeMax = elapsed.length ? Math.max(...elapsed) : 0;
  const tradesP90 = tradeMs.length ? pct([...tradeMs].sort((a, b) => a - b), 90) : 0;
  console.log(`  route max elapsed=${routeMax}ms   (52s breach line = 52000ms)  ${routeMax >= 52000 ? "*** BREACH ***" : "clear"}`);
  console.log(`  trades p90=${tradesP90}ms   (re-probe line ~13000ms)  ${tradesP90 > 13000 ? "*** OVER ***" : "clear"}`);

  await db.close();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
