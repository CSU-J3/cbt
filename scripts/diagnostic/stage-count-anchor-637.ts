// HO 637 — falsify disposition (4) before it moves eight readers. READ-ONLY.
// Date: 2026-08-10. HEAD 89eb8cb.
//
// Measures, for the current week and the three prior, over the SAME window
// getStageChangesCount uses:
//   (1) the SHIPPED set   — stage_observed_at IS NOT NULL + stage_observed_at in window
//   (2) the (4) set       — stage_observed_at IS NOT NULL + latest_action_date in window
//   (3) the intersection and BOTH differences, and a lag classification of the
//       (2)-not-(1) rows: how long before the window did stage_observed_at fall?
//
// The decision figure is the share of (2) whose stage_observed_at predates the
// window by more than the observation lag itself (HO 635: median 3.76d,
// p90 16.01d, n=40).
//
// Step 0 also reports the storage shape of latest_action_date vs
// stage_observed_at (the date-only / timestamp boundary question).
//
// Reads: 3 bounded queries (2 aggregate probes + 1 cohort pull gated on
// stage_observed_at IS NOT NULL). No writes.
//
//   npx tsx scripts/diagnostic/stage-count-anchor-637.ts
import "dotenv/config";
import { getDb } from "../../lib/db";

// HO 635 observation-lag reference (n=40): median 3.76d, p90 16.01d.
const LAG_MEDIAN = 3.76;
const LAG_P90 = 16.01;

const DAY_MS = 86_400_000;

type Row = {
  id: string;
  stage: string | null;
  previousStage: string | null;
  observedAt: string; // never null in the cohort
  actionDate: string | null;
};

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0]!;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
}

function fmt(n: number): string {
  return Number.isNaN(n) ? "—" : n.toFixed(2);
}

// SQLite's datetime('now','-N days') form, in UTC, so the JS-side compare is
// lexically identical to what the shipped SQL does.
function sqlDatetime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 19);
}
function sqlDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

// stage_observed_at is stored as a full ISO-8601 instant with a trailing Z
// (LENGTH 24). Parse defensively so a space-separated form would also work.
function parseInstant(v: string): number {
  const iso = v.includes("T") ? v : v.replace(" ", "T");
  return Date.parse(/[Zz]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso + "Z");
}

async function main() {
  const db = getDb();

  // ── Step 0 ──────────────────────────────────────────────────────────────
  console.log("── STEP 0 · storage shapes + cohort size ──────────────────────");

  const shapes = await db.execute(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN stage_observed_at IS NOT NULL THEN 1 ELSE 0 END) AS obs_present,
      SUM(CASE WHEN latest_action_date IS NOT NULL THEN 1 ELSE 0 END) AS lad_present,
      SUM(CASE WHEN latest_action_date IS NOT NULL AND LENGTH(latest_action_date) = 10 THEN 1 ELSE 0 END) AS lad_len10,
      MIN(LENGTH(latest_action_date)) AS lad_minlen,
      MAX(LENGTH(latest_action_date)) AS lad_maxlen,
      MIN(LENGTH(stage_observed_at)) AS obs_minlen,
      MAX(LENGTH(stage_observed_at)) AS obs_maxlen,
      MIN(latest_action_date) AS lad_min,
      MAX(latest_action_date) AS lad_max,
      MIN(stage_observed_at) AS obs_min,
      MAX(stage_observed_at) AS obs_max
    FROM bills`);
  const s = shapes.rows[0]!;
  console.log(`  bills total                    ${s.total}`);
  console.log(`  stage_observed_at present      ${s.obs_present}`);
  console.log(`  latest_action_date present     ${s.lad_present}`);
  console.log(
    `  latest_action_date LENGTH      min ${s.lad_minlen} max ${s.lad_maxlen}  (=10 on ${s.lad_len10} rows)`,
  );
  console.log(`  latest_action_date range       ${s.lad_min} .. ${s.lad_max}`);
  console.log(
    `  stage_observed_at LENGTH       min ${s.obs_minlen} max ${s.obs_maxlen}`,
  );
  console.log(`  stage_observed_at range        ${s.obs_min} .. ${s.obs_max}`);

  const nowRs = await db.execute(
    `SELECT datetime('now') AS dt, date('now') AS d`,
  );
  const nowSql = String(nowRs.rows[0]!.dt);
  console.log(`  SQLite now (UTC)               ${nowSql}`);
  const nowMs = Date.parse(nowSql.replace(" ", "T") + "Z");

  // ── Cohort pull ─────────────────────────────────────────────────────────
  // Both predicates require stage_observed_at IS NOT NULL, and both compose on
  // buildFeedWhere's gate (summary IS NOT NULL + non-ceremonial), so the union
  // of every window's candidate set is exactly this cohort.
  const cohortRs = await db.execute(`
    SELECT id, stage, previous_stage, stage_observed_at, latest_action_date
    FROM bills INDEXED BY idx_bills_stage_observed_at
    WHERE stage_observed_at IS NOT NULL
      AND summary IS NOT NULL
      AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`);
  const cohort: Row[] = cohortRs.rows.map((r) => ({
    id: String(r.id),
    stage: (r.stage as string | null) ?? null,
    previousStage: (r.previous_stage as string | null) ?? null,
    observedAt: String(r.stage_observed_at),
    actionDate: (r.latest_action_date as string | null) ?? null,
  }));
  console.log(`  cohort (gated, obs NOT NULL)   ${cohort.length} rows\n`);

  const noAction = cohort.filter((r) => r.actionDate === null).length;
  if (noAction > 0) {
    console.log(
      `  ! ${noAction} cohort rows carry a NULL latest_action_date — invisible to (4) in EVERY window\n`,
    );
  }

  // ── Windows ─────────────────────────────────────────────────────────────
  // Mirrors getStageChangesCount / getWeeklyBandPriorWeek exactly:
  //   w0 = (now-7d,  now]      w1 = (now-14d, now-7d]
  //   w2 = (now-21d, now-14d]  w3 = (now-28d, now-21d]
  // NOTE the asymmetry, and it is the SHIPPED asymmetry, not a probe choice:
  // getStageChangesCount({},7) has NO upper bound (`> datetime('now','-7 days')`
  // and nothing else), so w0 is open at the top. getWeeklyBandPriorWeek adds
  // `<= datetime('now','-7 days')`, so w1..w3 are half-open exactly as modelled.
  const windows = [0, 1, 2, 3].map((i) => {
    const hiMs = nowMs - i * 7 * DAY_MS;
    const loMs = nowMs - (i + 1) * 7 * DAY_MS;
    return {
      label: i === 0 ? "w0 (current)" : `w${i} (-${i * 7}d..-${(i + 1) * 7}d)`,
      openTop: i === 0,
      loMs,
      hiMs,
      loDt: sqlDatetime(loMs),
      hiDt: sqlDatetime(hiMs),
      loD: sqlDate(loMs),
      hiD: sqlDate(hiMs),
    };
  });

  console.log("── STEP 0b · does datetime() vs date() move the (4) boundary? ──");
  console.log(
    "  For each window, |set(2) under datetime() bound| vs |under date() bound|.",
  );
  for (const w of windows) {
    const viaDt = cohort.filter(
      (r) =>
        r.actionDate !== null &&
        r.actionDate > w.loDt &&
        (w.openTop || r.actionDate <= w.hiDt),
    ).length;
    const viaD = cohort.filter(
      (r) =>
        r.actionDate !== null &&
        r.actionDate > w.loD &&
        (w.openTop || r.actionDate <= w.hiD),
    ).length;
    console.log(
      `  ${w.label.padEnd(22)} datetime ${String(viaDt).padStart(4)}   date ${String(viaD).padStart(4)}   delta ${viaDt - viaD}`,
    );
  }
  console.log();

  // ── Step 0c ─────────────────────────────────────────────────────────────
  // The SHIPPED predicate compares a stored ISO instant ('2026-08-04T02:00:00.000Z')
  // against SQLite's space-separated datetime('now','-7 days') ('2026-08-04 03:27:32').
  // Byte-wise, 'T' (0x54) > ' ' (0x20), so EVERY row on the boundary calendar day
  // passes regardless of time-of-day. Price that against a true-instant compare.
  console.log("── STEP 0c · the shipped window's mixed-format boundary ────────");
  for (const w of windows) {
    const lex = cohort.filter(
      (r) => r.observedAt > w.loDt && (w.openTop || r.observedAt <= w.hiDt),
    );
    const inst = cohort.filter((r) => {
      const t = parseInstant(r.observedAt);
      return t > w.loMs && (w.openTop || t <= w.hiMs);
    });
    const days = (rows: Row[]) => new Set(rows.map((r) => r.observedAt.slice(0, 10))).size;
    console.log(
      `  ${w.label.padEnd(22)} lexical(shipped) ${String(lex.length).padStart(4)} over ${days(lex)} cal-days   ` +
        `true-instant ${String(inst.length).padStart(4)} over ${days(inst)} cal-days   delta ${lex.length - inst.length}`,
    );
  }
  console.log();

  // ── M1 ──────────────────────────────────────────────────────────────────
  console.log("── M1 · three sets per window, + the (2)-not-(1) lag split ─────");
  for (const w of windows) {
    const inObs = (r: Row) =>
      r.observedAt > w.loDt && (w.openTop || r.observedAt <= w.hiDt);
    // Use the datetime() bound so this is what the shipped-shape SQL would do
    // if only the column changed. (Step 0b prices the date() variant.)
    const inAct = (r: Row) =>
      r.actionDate !== null &&
      r.actionDate > w.loDt &&
      (w.openTop || r.actionDate <= w.hiDt);

    const s1 = cohort.filter(inObs);
    const s2 = cohort.filter(inAct);
    const both = cohort.filter((r) => inObs(r) && inAct(r));
    const only2 = cohort.filter((r) => inAct(r) && !inObs(r));
    const only1 = cohort.filter((r) => inObs(r) && !inAct(r));

    console.log(`\n  ${w.label}   ${w.loDt} .. ${w.hiDt}`);
    console.log(
      `    (1) shipped / observation clock  ${String(s1.length).padStart(4)}`,
    );
    console.log(
      `    (2) proposed / latest_action     ${String(s2.length).padStart(4)}`,
    );
    console.log(`    (1)∩(2)                          ${String(both.length).padStart(4)}`);
    console.log(
      `    (2)\\(1)  candidate false pos     ${String(only2.length).padStart(4)}`,
    );
    console.log(
      `    (1)\\(2)  transitions (4) drops   ${String(only1.length).padStart(4)}`,
    );

    // Classify the (2)-not-(1) rows by how far stage_observed_at sits from the
    // window. Positive = observed BEFORE the window opened (staleness).
    // Negative = observed AFTER the window closed (a late notice — (4) working).
    const staleDays: number[] = [];
    let lateNotice = 0;
    let lexArtifact = 0;
    for (const r of only2) {
      const obsMs = parseInstant(r.observedAt);
      if (obsMs > w.hiMs) {
        lateNotice++;
      } else if (obsMs > w.loMs) {
        // Inside the window by true instant, yet absent from (1): excluded by
        // the shipped lexical upper bound (Step 0c), not by staleness.
        lexArtifact++;
      } else {
        staleDays.push((w.loMs - obsMs) / DAY_MS);
      }
    }
    const sorted = [...staleDays].sort((a, b) => a - b);
    const withinMedian = sorted.filter((d) => d <= LAG_MEDIAN).length;
    const withinP90 = sorted.filter((d) => d <= LAG_P90).length;
    const beyondP90 = sorted.filter((d) => d > LAG_P90).length;

    console.log(`      of which observed AFTER window close (late notice): ${lateNotice}`);
    console.log(`      of which excluded by the lexical upper bound:       ${lexArtifact}`);
    console.log(`      of which observed BEFORE window open:               ${sorted.length}`);
    if (sorted.length > 0) {
      console.log(
        `        staleness (days before window open): min ${fmt(sorted[0]!)}  ` +
          `p25 ${fmt(quantile(sorted, 0.25))}  med ${fmt(quantile(sorted, 0.5))}  ` +
          `p75 ${fmt(quantile(sorted, 0.75))}  p90 ${fmt(quantile(sorted, 0.9))}  ` +
          `max ${fmt(sorted[sorted.length - 1]!)}`,
      );
      console.log(
        `        <= median lag (${LAG_MEDIAN}d): ${withinMedian}   ` +
          `<= p90 lag (${LAG_P90}d): ${withinP90}   ` +
          `> p90 lag: ${beyondP90}`,
      );
      const shareOf2 = s2.length > 0 ? (100 * beyondP90) / s2.length : 0;
      console.log(
        `        DECISION FIGURE — share of (2) stale beyond p90 lag: ` +
          `${beyondP90}/${s2.length} = ${shareOf2.toFixed(1)}%`,
      );
      // Histogram of staleness in weeks, so "months earlier" is legible.
      const buckets = new Map<string, number>();
      for (const d of sorted) {
        const k =
          d <= 7 ? "0–7d" : d <= 30 ? "8–30d" : d <= 90 ? "31–90d" : ">90d";
        buckets.set(k, (buckets.get(k) ?? 0) + 1);
      }
      const order = ["0–7d", "8–30d", "31–90d", ">90d"];
      console.log(
        `        buckets: ` +
          order.map((k) => `${k} ${buckets.get(k) ?? 0}`).join("  "),
      );
    }

    // Where does the DROPPED set's action date fall? A drop whose action
    // predates the window is (4) re-dating a late-observed move into an earlier
    // week (a move, not a loss). A drop with a LATER action date is the row
    // being pulled FORWARD by a subsequent minor action — the membership error.
    let dropEarlier = 0;
    let dropLater = 0;
    let dropNull = 0;
    for (const r of only1) {
      if (r.actionDate === null) dropNull++;
      else if (r.actionDate <= w.loDt) dropEarlier++;
      else dropLater++;
    }
    console.log(
      `      (1)\\(2) breakdown: action BEFORE window ${dropEarlier}  ` +
        `action AFTER window ${dropLater}  action NULL ${dropNull}`,
    );

    // Destination-stage split of both sets (the ladder question).
    const ladder = (rows: Row[]) => {
      const m = new Map<string, number>();
      for (const r of rows) {
        const k = r.stage ?? "(null)";
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return [...m.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k} ${v}`)
        .join("  ");
    };
    console.log(`      ladder (1): ${ladder(s1)}`);
    console.log(`      ladder (2): ${ladder(s2)}`);
  }

  // ── Four-week series, for the roadmap cross-check ────────────────────────
  console.log("\n── M1b · four-week series (oldest → newest) ────────────────────");
  const series1 = [...windows]
    .reverse()
    .map(
      (w) =>
        cohort.filter(
          (r) => r.observedAt > w.loDt && (w.openTop || r.observedAt <= w.hiDt),
        ).length,
    );
  const series2 = [...windows]
    .reverse()
    .map(
      (w) =>
        cohort.filter(
          (r) =>
            r.actionDate !== null &&
            r.actionDate > w.loDt &&
            (w.openTop || r.actionDate <= w.hiDt),
        ).length,
    );
  console.log(`  (1) observation clock   ${series1.join(" → ")}`);
  console.log(`  (2) latest_action_date  ${series2.join(" → ")}`);

  // ── M1c · the membership-error population, window-free ──────────────────
  // latest_action_date is the LATEST action of ANY kind, not the advancing one.
  // Every cohort row whose action postdates its observed advance is a row (4)
  // can pull forward into a later week on a non-advancing action. Size it once,
  // corpus-wide, instead of inferring it per window.
  const drift: number[] = [];
  let sameOrEarlier = 0;
  for (const r of cohort) {
    if (r.actionDate === null) continue;
    const obsDay = r.observedAt.slice(0, 10);
    if (r.actionDate > obsDay) {
      drift.push(
        (Date.parse(r.actionDate + "T00:00:00Z") -
          Date.parse(obsDay + "T00:00:00Z")) /
          DAY_MS,
      );
    } else sameOrEarlier++;
  }
  const ds = drift.sort((a, b) => a - b);
  console.log(
    `\n── M1c · rows whose latest action POSTDATES the observed advance ──`,
  );
  console.log(
    `  action on/before observation day  ${sameOrEarlier}   action after  ${ds.length}   ` +
      `(${((100 * ds.length) / cohort.length).toFixed(1)}% of cohort)`,
  );
  if (ds.length > 0) {
    console.log(
      `  days after: min ${fmt(ds[0]!)}  med ${fmt(quantile(ds, 0.5))}  ` +
        `p90 ${fmt(quantile(ds, 0.9))}  max ${fmt(ds[ds.length - 1]!)}`,
    );
    console.log(
      `  of those, >7d after (would land in a LATER week than the advance): ` +
        `${ds.filter((d) => d > 7).length}`,
    );
  }

  // Stamp-age ceiling: the false-positive rate measured above is bounded by how
  // old the oldest stamp can be. State it so the figure is not over-read.
  const oldest = cohort.reduce(
    (m, r) => Math.min(m, parseInstant(r.observedAt)),
    Infinity,
  );
  console.log(
    `  oldest stamp in cohort: ${new Date(oldest).toISOString()} ` +
      `(${((nowMs - oldest) / DAY_MS).toFixed(1)}d ago) — the staleness ceiling`,
  );

  // ── M1d · the pre-tracking leak (gatherReportData's stageTrackingStart) ──
  // gatherReportData gates a named week's "no movements" copy on
  // MIN(date(stage_observed_at)) — the date observation began. Under (4) the
  // week filter reads latest_action_date, so a bill observed after tracking
  // began but whose latest action predates it would count as a "transition" in
  // a week that predates tracking entirely. Size that population.
  const trackStart = new Date(oldest).toISOString().slice(0, 10);
  const preTrack = cohort.filter(
    (r) => r.actionDate !== null && r.actionDate < trackStart,
  );
  console.log(`\n── M1d · pre-tracking leak under (4) ───────────────────────────`);
  console.log(`  observation tracking began   ${trackStart}`);
  console.log(
    `  cohort rows whose latest action PREDATES it: ${preTrack.length} ` +
      `(${((100 * preTrack.length) / cohort.length).toFixed(1)}% of cohort)`,
  );
  if (preTrack.length > 0) {
    const dates = preTrack.map((r) => r.actionDate!).sort();
    console.log(
      `  their action dates span ${dates[0]} .. ${dates[dates.length - 1]} ` +
        `— each would count as a transition in a pre-tracking week`,
    );
  }

  // ── M2 (4b) sizing: stage_transitions coverage ───────────────────────────
  console.log("\n── M2 sizing · stage_transitions coverage (for 4b) ─────────────");
  const stRs = await db.execute(`
    SELECT COUNT(*) AS rows, COUNT(DISTINCT bill_id) AS bills,
           MIN(observed_at) AS first, MAX(observed_at) AS last
    FROM stage_transitions`);
  const st = stRs.rows[0]!;
  console.log(
    `  stage_transitions   ${st.rows} rows / ${st.bills} bills   ${st.first} .. ${st.last}`,
  );
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
