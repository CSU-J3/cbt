// HO 637 GATE — the maturation bias under disposition (4), + the (1)-not-(2)
// classification. READ-ONLY. Date: 2026-08-11. Companion to
// stage-count-anchor-637.ts (same cohort, same one bounded read).
//
// A. SETTLING CURVE. Under (4) a week's count keeps growing as late
//    observations arrive, because the predicate still requires
//    stage_observed_at IS NOT NULL. So set (2) for a closed window, read at the
//    moment the window closed, is a SUBSET of what it reads today. Reconstruct
//    the count at maturity m (observation <= window end + m days) for a ladder
//    of m, per window and pooled, and read the WoW bias off it as
//    f(m+7) - f(m) — the current half sits at maturity N, the comparison half
//    at N+7.
//
// B. THE (1)-NOT-(2) CLASSIFICATION. Same treatment as (2)-not-(1) got: how far
//    does each row's latest action predate its observation? A large lag is a
//    backfill discovery that (1) counts as a transition in a window where
//    nothing happened, and that (4) correctly rebins out.
//
//   npx tsx scripts/diagnostic/stage-count-settling-637.ts
import "dotenv/config";
import { getDb } from "../../lib/db";

const DAY_MS = 86_400_000;
const WEEKS = 8; // w0..w7, so the maturity ladder reaches ~35d
const MATURITIES = [0, 1, 2, 3, 5, 7, 10, 14, 21, 28, 35];

type Row = {
  id: string;
  stage: string | null;
  observedAt: string;
  observedMs: number;
  actionDate: string | null;
};

function parseInstant(v: string): number {
  const iso = v.includes("T") ? v : v.replace(" ", "T");
  return Date.parse(/[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
}
function sqlDatetime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}
function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}
const f2 = (n: number) => (Number.isNaN(n) ? "—" : n.toFixed(2));
const pct = (n: number) => (Number.isNaN(n) ? "  —  " : (100 * n).toFixed(1).padStart(5));

async function main() {
  const db = getDb();

  const nowRs = await db.execute(`SELECT datetime('now') AS dt`);
  const nowSql = String(nowRs.rows[0]!.dt);
  const nowMs = Date.parse(nowSql.replace(" ", "T") + "Z");

  const rs = await db.execute(`
    SELECT id, stage, stage_observed_at, latest_action_date
    FROM bills INDEXED BY idx_bills_stage_observed_at
    WHERE stage_observed_at IS NOT NULL
      AND summary IS NOT NULL
      AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`);
  const cohort: Row[] = rs.rows.map((r) => {
    const observedAt = String(r.stage_observed_at);
    return {
      id: String(r.id),
      stage: (r.stage as string | null) ?? null,
      observedAt,
      observedMs: parseInstant(observedAt),
      actionDate: (r.latest_action_date as string | null) ?? null,
    };
  });
  console.log(`SQLite now (UTC) ${nowSql} · cohort ${cohort.length} rows\n`);

  const windows = Array.from({ length: WEEKS }, (_, i) => {
    const hiMs = nowMs - i * 7 * DAY_MS;
    const loMs = nowMs - (i + 1) * 7 * DAY_MS;
    return {
      i,
      label: i === 0 ? "w0 (open)" : `w${i}`,
      openTop: i === 0,
      loMs,
      hiMs,
      loDt: sqlDatetime(loMs),
      hiDt: sqlDatetime(hiMs),
    };
  });

  const inAct = (r: Row, w: (typeof windows)[number]) =>
    r.actionDate !== null &&
    r.actionDate > w.loDt &&
    (w.openTop || r.actionDate <= w.hiDt);

  // ── A. settling curve ────────────────────────────────────────────────────
  console.log("── A · SETTLING CURVE — set (2) at maturity m vs today ─────────");
  console.log(
    "  maturity m = observation arrived within m days of the window CLOSING.",
  );
  console.log("  'today' is itself not final, so every share is an UPPER bound.\n");

  const header =
    "  window  today  " +
    MATURITIES.map((m) => `m=${m}`.padStart(6)).join("") +
    "   closed";
  console.log(header);

  // perWindow[i] = { today, atM: Map<m, count|null> }
  const perWindow = new Map<
    number,
    { today: number; atM: Map<number, number | null>; closedDaysAgo: number }
  >();

  for (const w of windows) {
    if (w.openTop) continue;
    const set2 = cohort.filter((r) => inAct(r, w));
    const closedDaysAgo = (nowMs - w.hiMs) / DAY_MS;
    const atM = new Map<number, number | null>();
    for (const m of MATURITIES) {
      if (w.hiMs + m * DAY_MS > nowMs) {
        atM.set(m, null); // not yet observable
        continue;
      }
      atM.set(
        m,
        set2.filter((r) => r.observedMs <= w.hiMs + m * DAY_MS).length,
      );
    }
    perWindow.set(w.i, { today: set2.length, atM, closedDaysAgo });
    console.log(
      `  ${w.label.padEnd(7)} ${String(set2.length).padStart(5)}  ` +
        MATURITIES.map((m) => {
          const v = atM.get(m);
          return (v === null ? "·" : String(v)).padStart(6);
        }).join("") +
        `   ${closedDaysAgo.toFixed(1)}d ago`,
    );
  }

  // Pooled share f(m), over exactly the windows observable at that m.
  console.log("\n  pooled settled share f(m)  (n = windows contributing)");
  const fm = new Map<number, { share: number; n: number }>();
  for (const m of MATURITIES) {
    let num = 0;
    let den = 0;
    let n = 0;
    for (const [, v] of perWindow) {
      const a = v.atM.get(m);
      if (a === null || a === undefined) continue;
      num += a;
      den += v.today;
      n++;
    }
    if (den > 0) fm.set(m, { share: num / den, n });
  }
  console.log(
    "    " +
      MATURITIES.map((m) => `m=${m}`.padStart(7)).join("") +
      "\n    " +
      MATURITIES.map((m) => {
        const e = fm.get(m);
        return (e ? pct(e.share) + "%" : "     —").padStart(7);
      }).join("") +
      "\n    " +
      MATURITIES.map((m) => {
        const e = fm.get(m);
        return (e ? `n=${e.n}` : "").padStart(7);
      }).join(""),
  );

  // The WoW bias itself: the current half sits at maturity N, the prior half at
  // N+7, so the delta is biased by f(N+7) - f(N) even with zero real change.
  console.log(
    "\n  WoW MATURITY GAP at settling lag N  — f(N+7) − f(N), the bias floor",
  );
  for (const N of [0, 3, 7, 14, 21]) {
    const a = fm.get(N);
    const b = fm.get(N + 7);
    if (!a || !b) continue;
    const gap = b.share - a.share;
    console.log(
      `    N=${String(N).padStart(2)}d   f(N)=${pct(a.share)}%  f(N+7)=${pct(b.share)}%  ` +
        `gap ${(100 * gap).toFixed(1).padStart(5)}pp   ` +
        `⇒ a flat week reads ${gap > 0 ? "−" : "+"}${Math.abs(100 * gap).toFixed(1)}% WoW`,
    );
  }

  // ── w0's outstanding tail + the equal-maturity delta ─────────────────────
  const w0 = windows[0]!;
  const w1 = windows[1]!;
  const w0Today = cohort.filter((r) => inAct(r, w0)).length;
  const w1Today = cohort.filter((r) => inAct(r, w1)).length;
  const f0 = fm.get(0)?.share ?? NaN;
  const f7 = fm.get(7)?.share ?? NaN;

  console.log("\n── A2 · what this does to the live w0-vs-w1 delta ──────────────");
  console.log(`  w0 as it reads today (maturity 0)        ${w0Today}`);
  console.log(`  w1 as it reads today (maturity ~7d+)     ${w1Today}`);
  console.log(
    `  naive WoW delta                          ${w0Today - w1Today >= 0 ? "+" : ""}${w0Today - w1Today}  ` +
      `(${(((w0Today - w1Today) / w1Today) * 100).toFixed(1)}%)`,
  );
  console.log(
    `  w0 projected to full settlement (÷f(0))  ~${Math.round(w0Today / f0)}   [f(0)=${pct(f0)}%]`,
  );
  const w1AtM0 = perWindow.get(1)?.atM.get(0) ?? null;
  if (w1AtM0 !== null) {
    console.log(
      `  EQUAL MATURITY, both at m=0:  w0 ${w0Today} vs w1 ${w1AtM0}  ` +
        `⇒ ${w0Today - w1AtM0 >= 0 ? "+" : ""}${w0Today - w1AtM0} ` +
        `(${(((w0Today - w1AtM0) / w1AtM0) * 100).toFixed(1)}%)`,
    );
  }
  console.log(
    `  for reference, the SHIPPED clock has no maturation term — its window and\n` +
      `  its stamp are the same event, so f(0) = 100% by construction.`,
  );

  // Freshness cost of a settling lag: how stale is the newest data shown.
  console.log("\n  freshness cost of a settling lag N (window ends N days back):");
  for (const N of [0, 3, 7, 14]) {
    const e = fm.get(N);
    if (!e) continue;
    console.log(
      `    N=${String(N).padStart(2)}d  newest action shown is ${N}d old  ` +
        `· ${pct(e.share)}% of that week's eventual rows are in hand`,
    );
  }

  // ── C. pricing (4d) DISCLOSE-DON'T-DELAY ─────────────────────────────────
  // Keep the window trailing-7d on latest_action_date; mark the current week as
  // still settling rather than delaying it. The LEVEL is current; the DELTA
  // stays biased. Three questions: is the m=0 level stable enough to render at
  // all, can the prior half carry a settled delta, and what does the strip
  // actually read week to week under the scheme.
  console.log("\n── C1 · is the m=0 LEVEL stable enough to render? ──────────────");
  console.log("  per window: what the strip would have read on close day vs settled today");
  const ratios: number[] = [];
  console.log("    window   m=0   settled   m=0/settled   shipped-clock");
  for (const w of windows) {
    if (w.openTop) continue;
    const v = perWindow.get(w.i)!;
    const at0 = v.atM.get(0)!;
    const shipped = cohort.filter(
      (r) => r.observedAt > w.loDt && r.observedAt <= w.hiDt,
    ).length;
    const ratio = at0 / v.today;
    ratios.push(ratio);
    console.log(
      `    ${w.label.padEnd(6)} ${String(at0).padStart(5)} ${String(v.today).padStart(9)}` +
        `${pct(ratio).padStart(13)}%   ${String(shipped).padStart(11)}`,
    );
  }
  const rs2 = [...ratios].sort((a, b) => a - b);
  console.log(
    `\n    completeness at close ranges ${pct(rs2[0]!)}% .. ${pct(rs2[rs2.length - 1]!)}%  ` +
      `(${(rs2[rs2.length - 1]! / rs2[0]!).toFixed(1)}x spread)  med ${pct(quantile(rs2, 0.5))}%`,
  );
  console.log(
    `    ⇒ a single "still settling" caveat cannot describe the number: the same\n` +
      `      mark would sit over a reading that is ${pct(rs2[rs2.length - 1]!)}% complete one week and\n` +
      `      ${pct(rs2[0]!)}% complete the next.`,
  );

  // Why so unstable: observation is BATCHED, so whether a batch landed before
  // or after the week boundary swings the close-day reading.
  console.log("\n── C2 · why: observation is batched, not continuous ────────────");
  const byDay = new Map<string, number>();
  const spanStart = windows[WEEKS - 1]!.loMs;
  for (const r of cohort) {
    if (r.observedMs < spanStart) continue;
    const d = r.observedAt.slice(0, 10);
    byDay.set(d, (byDay.get(d) ?? 0) + 1);
  }
  const days = [...byDay.entries()].sort();
  const counts = days.map(([, n]) => n).sort((a, b) => a - b);
  const spanDays = Math.round((nowMs - spanStart) / DAY_MS);
  console.log(
    `  ${spanDays}-day span · ${days.length} days carry any observation · ` +
      `${spanDays - days.length} days carry none`,
  );
  console.log(
    `  per-observing-day count: min ${counts[0]}  med ${quantile(counts, 0.5)}  ` +
      `p90 ${quantile(counts, 0.9)}  max ${counts[counts.length - 1]}`,
  );
  const top = [...days].sort((a, b) => b[1] - a[1]).slice(0, 5);
  console.log(`  five heaviest days: ${top.map(([d, n]) => `${d} (${n})`).join("  ")}`);

  // ── C3 · the simulated strip ─────────────────────────────────────────────
  // At the close of window w_i, w_{i+1} has matured exactly 7d and w_{i+2}
  // exactly 14d — so a "settled prior-week delta" is structurally f(7) vs
  // f(14), not two settled numbers.
  console.log("\n── C3 · the strip under (4d), week by week ─────────────────────");
  console.log(
    "  as-of each week close: CURRENT level (m=0, marked) · PRIOR delta (m=7 vs m=14)",
  );
  console.log(
    "    as-of   current(m=0)  settles to   miss   |  prior Δ shown   prior Δ settled",
  );
  const at = (i: number, m: number) => {
    const w = windows[i]!;
    return cohort.filter(
      (r) => inAct(r, w) && r.observedMs <= w.hiMs + m * DAY_MS,
    ).length;
  };
  const todayCount = (i: number) =>
    cohort.filter((r) => inAct(r, windows[i]!)).length;
  for (let i = 0; i + 2 < WEEKS; i++) {
    const cur = i === 0 ? todayCount(0) : at(i, 0);
    const eventual = todayCount(i);
    const miss = eventual > 0 ? 1 - cur / eventual : NaN;
    const shownA = at(i + 1, 7);
    const shownB = at(i + 2, 14);
    const shownDelta = shownB > 0 ? (shownA - shownB) / shownB : NaN;
    const trueA = todayCount(i + 1);
    const trueB = todayCount(i + 2);
    const trueDelta = trueB > 0 ? (trueA - trueB) / trueB : NaN;
    console.log(
      `    ${windows[i]!.label.padEnd(7)} ${String(cur).padStart(9)}` +
        `${String(eventual).padStart(13)}` +
        `${(Number.isNaN(miss) ? "—" : `−${(100 * miss).toFixed(0)}%`).padStart(8)}   |` +
        `${(Number.isNaN(shownDelta) ? "—" : `${shownDelta >= 0 ? "+" : ""}${(100 * shownDelta).toFixed(0)}%`).padStart(14)}` +
        `${(Number.isNaN(trueDelta) ? "—" : `${trueDelta >= 0 ? "+" : ""}${(100 * trueDelta).toFixed(0)}%`).padStart(17)}`,
    );
  }
  const g714 = (fm.get(7)?.share ?? NaN) - (fm.get(14)?.share ?? NaN);
  console.log(
    `\n  the PRIOR-week delta is not settled either: its two halves sit at\n` +
      `  f(7)=${pct(fm.get(7)?.share ?? NaN)}% and f(14)=${pct(fm.get(14)?.share ?? NaN)}%, a ` +
      `${(100 * g714).toFixed(1)}pp floor. A genuinely\n` +
      `  settled delta needs both halves at m>=14 — i.e. the 14-day staleness\n` +
      `  relocated from the level into the delta, not removed.`,
  );

  // ── B. the (1)-not-(2) classification ────────────────────────────────────
  console.log("\n── B · (1)-NOT-(2): how far does the action predate the stamp? ──");
  const inObs = (r: Row, w: (typeof windows)[number]) =>
    r.observedAt > w.loDt && (w.openTop || r.observedAt <= w.hiDt);

  const allLags: number[] = [];
  for (const w of windows.slice(0, 4)) {
    const only1 = cohort.filter((r) => inObs(r, w) && !inAct(r, w));
    const lags: number[] = [];
    let laterAction = 0;
    let nullAction = 0;
    for (const r of only1) {
      if (r.actionDate === null) {
        nullAction++;
        continue;
      }
      const obsDay = r.observedAt.slice(0, 10);
      const d =
        (Date.parse(obsDay + "T00:00:00Z") -
          Date.parse(r.actionDate + "T00:00:00Z")) /
        DAY_MS;
      if (d < 0) laterAction++;
      else lags.push(d);
    }
    lags.sort((a, b) => a - b);
    allLags.push(...lags);
    const b = (lo: number, hi: number) =>
      lags.filter((d) => d >= lo && d < hi).length;
    console.log(
      `\n  ${w.label}  (1)\\(2) n=${only1.length}   ` +
        `action-later ${laterAction}  action-null ${nullAction}`,
    );
    if (lags.length > 0) {
      console.log(
        `    action predates stamp by (days): min ${f2(lags[0]!)}  ` +
          `p25 ${f2(quantile(lags, 0.25))}  med ${f2(quantile(lags, 0.5))}  ` +
          `p75 ${f2(quantile(lags, 0.75))}  p90 ${f2(quantile(lags, 0.9))}  ` +
          `max ${f2(lags[lags.length - 1]!)}`,
      );
      console.log(
        `    buckets: 0–7d ${b(0, 8)}  8–30d ${b(8, 31)}  31–90d ${b(31, 91)}  ` +
          `91–180d ${b(91, 181)}  >180d ${lags.filter((d) => d > 180).length}`,
      );
      console.log(
        `    beyond the p90 observation lag (16.01d) — a BACKFILL DISCOVERY, ` +
          `not a late notice: ${lags.filter((d) => d > 16.01).length}/${only1.length}`,
      );
    }
  }

  // The 28-day aggregate: rows (1) counts somewhere in the span whose action
  // falls OUTSIDE the span entirely. These are the phantoms (4) rebins away.
  const spanLo = windows[3]!.loDt;
  const spanLoMs = windows[3]!.loMs;
  const in1Span = cohort.filter((r) => r.observedAt > spanLo);
  const phantoms = in1Span.filter(
    (r) => r.actionDate === null || r.actionDate <= spanLo,
  );
  const pl = phantoms
    .filter((r) => r.actionDate !== null)
    .map(
      (r) =>
        (Date.parse(r.observedAt.slice(0, 10) + "T00:00:00Z") -
          Date.parse(r.actionDate! + "T00:00:00Z")) /
        DAY_MS,
    )
    .sort((a, b) => a - b);
  console.log("\n── B2 · the 28-day aggregate — the gap the block describes ─────");
  console.log(`  (1) over the 28d span              ${in1Span.length}`);
  console.log(
    `  (2) over the 28d span              ${cohort.filter((r) => r.actionDate !== null && r.actionDate > spanLo).length}`,
  );
  console.log(
    `  in (1), action OUTSIDE the span    ${phantoms.length}  ` +
      `(action predates ${spanLo.slice(0, 10)}, or is NULL)`,
  );
  if (pl.length > 0) {
    console.log(
      `    their action predates the stamp by: min ${f2(pl[0]!)}  ` +
        `med ${f2(quantile(pl, 0.5))}  p90 ${f2(quantile(pl, 0.9))}  ` +
        `max ${f2(pl[pl.length - 1]!)} days`,
    );
    const olderThan = (d: number) => pl.filter((x) => x > d).length;
    console.log(
      `    older than 30d ${olderThan(30)}   90d ${olderThan(90)}   ` +
        `180d ${olderThan(180)}   365d ${olderThan(365)}`,
    );
    const oldest = phantoms
      .filter((r) => r.actionDate !== null)
      .sort((a, b) => (a.actionDate! < b.actionDate! ? -1 : 1))
      .slice(0, 5);
    console.log(`    oldest five:`);
    for (const r of oldest) {
      console.log(
        `      ${r.id.padEnd(18)} action ${r.actionDate}  observed ${r.observedAt.slice(0, 10)}  stage ${r.stage}`,
      );
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
