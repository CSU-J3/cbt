// HO 635 — `bills.stage_observed_at` is an OBSERVATION clock. Read-only probe.
// Measured 2026-08-10 against prod Turso at HEAD `33e5910`.
//
// WHAT THIS MEASURES. HO 634 established from code that both write sites stamp
// the wall clock of the sync run (`lib/sync.ts:235`, `lib/summarize-runner.ts:314`)
// and confirmed it on 40 rows. This probe prices the exposure:
//   Step 0  the sanity read HO 634 did not do — rows where the stamp PRECEDES the
//           action it purports to record. Nonzero would change the premise.
//   M2      lag distribution, plus the share where the ET CALENDAR DAY differs,
//           which is the figure that decides whether the day-grouping is visibly
//           wrong or wrong only in principle (HO 632's comparable number: 17%).
//   M3      whether an occurrence date is recoverable at all, and what
//           `stage_transitions` actually holds.
//   M4      ENACTED and STAGE TRANSITIONS for four weeks, computed on the
//           observation clock (as shipped) and on the best available occurrence
//           proxy, with any sync gap in `cron_runs` named.
//
// A PREMISE THE HANDOFF ASSUMES AND THE SCHEMA DOES NOT SUPPORT — read this before
// trusting M2/M3. HO 635 asks for lag against "the stage-advancing action", using
// `computeStage`'s own predicate over "the bill's own actions". THERE IS NO ACTIONS
// TABLE: the schema has 48 tables and none stores per-bill action rows, and
// `computeStage(latestActionText)` (lib/enums.ts:97) takes a single TEXT, not a
// list. So the advancing action's date is not derivable from the DB, and this probe
// does NOT re-implement it (guard 3 forbids that, and there is nothing to
// re-implement it against). It measures against `latest_action_date` instead and
// LABELS IT AS A PROXY with its known bias — it is the MOST RECENT action, so where
// a bill has moved on since the advance, lag is UNDERSTATED. One subset escapes the
// bias and is reported separately: for `stage = 'enacted'`, the latest action IS the
// enacting action, so lag there is exact.
import "dotenv/config";
import { getDb } from "../../lib/db";
// guard 3: classify with the product's own stage predicate, never a re-implementation.
import { computeStage } from "../../lib/enums";

// Ordering only — used to ask "is this action's computed stage BEYOND the current
// one?", which is the monotonicity `decideStage` enforces (HO 239).
const STAGE_RANK: Record<string, number> = {
  introduced: 0,
  committee: 1,
  floor: 2,
  other_chamber: 3,
  president: 4,
  enacted: 5,
};

const SAMPLE = Number(process.env.PROBE_SAMPLE ?? 400);
const ET = "America/New_York";

const etDay = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  // en-CA renders ISO-ordered YYYY-MM-DD
  return d.toLocaleDateString("en-CA", { timeZone: ET });
};

const quantiles = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))]!;
  return { min: s[0]!, med: at(0.5), p90: at(0.9), max: s[s.length - 1]!, n: s.length };
};

const fmtQ = (q: ReturnType<typeof quantiles>) =>
  q ? `min ${q.min.toFixed(2)} · median ${q.med.toFixed(2)} · p90 ${q.p90.toFixed(2)} · max ${q.max.toFixed(2)}  (n=${q.n})` : "(empty)";

const pct = (num: number, den: number) => (den ? ((100 * num) / den).toFixed(1) + "%" : "—");
const rule = (s: string) => console.log("\n" + "=".repeat(104) + `\n${s}\n` + "=".repeat(104));

async function main() {
  const db = getDb();

  // ── corpus size + date, attached to every figure (guard 5) ────────────────
  const corpus = await db.execute({
    sql: `SELECT COUNT(*) AS total,
                 SUM(CASE WHEN stage_observed_at IS NOT NULL THEN 1 ELSE 0 END) AS tracked,
                 SUM(CASE WHEN stage_observed_at IS NULL AND stage IS NOT NULL AND stage != 'introduced' THEN 1 ELSE 0 END) AS legacy_null,
                 MIN(date(stage_observed_at)) AS first_tracked,
                 MAX(date(stage_observed_at)) AS last_tracked
          FROM bills`,
    args: [],
  });
  const c = corpus.rows[0]!;
  rule("HO 635 — stage_observed_at observation-clock probe   read-only   prod Turso");
  console.log(`   run at            : ${new Date().toISOString()}`);
  console.log(`   corpus            : ${c.total} bills`);
  console.log(`   stage_observed_at  : ${c.tracked} non-null (${pct(Number(c.tracked), Number(c.total))} of corpus)`);
  console.log(`   legacy NULL cohort: ${c.legacy_null} rows past 'introduced' with NO stamp (StagePillStrip case 3)`);
  console.log(`   tracking window   : ${c.first_tracked} .. ${c.last_tracked}`);

  // ── Step 0 — does the stamp ever PRECEDE the action? ──────────────────────
  //
  // HO 635 asks for this as an expect-zero test. A FIRST CUT OF IT WAS THE WRONG
  // TEST and read 59: it compared the stamp to `latest_action_date`, which MOVES
  // FORWARD after an advance. A bill that reaches committee on the 8th (stamped
  // then) and picks up a cosponsor on the 9th has a stamp EARLIER than its latest
  // action by construction — the handoff's own §M2 says exactly this about why
  // latest_action_date is the wrong anchor, so a test built on it cannot answer an
  // anomaly question. Both halves below are tests the anchor can actually support.
  rule("STEP 0 — does the stamp ever precede the thing it records?");

  // (a) The real anomaly test: a stamp before the bill was introduced is
  //     impossible under either clock. Expect zero and MEAN it.
  const preIntro = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM bills
          WHERE stage_observed_at IS NOT NULL AND introduced_date IS NOT NULL
            AND date(stage_observed_at) < introduced_date`,
    args: [],
  });
  const preIntroN = Number(preIntro.rows[0]?.n ?? 0);
  console.log(`   (a) stamp EARLIER than introduced_date : ${preIntroN}   ${preIntroN === 0 ? "PREMISE HOLDS" : "ANOMALY — investigate before M2"}`);

  // (b) The 59 that the wrong test flagged, explained rather than waved off.
  //     `decideStage` is monotonic (HO 239), so a later action computing to a
  //     LOWER stage leaves `stage` and its stamp untouched while
  //     `latest_action_date` advances past them. Classify with computeStage
  //     ITSELF (guard 3) rather than re-implementing its predicate.
  const preRows = await db.execute({
    sql: `SELECT id, stage, stage_observed_at, latest_action_date, latest_action_text
          FROM bills
          WHERE stage_observed_at IS NOT NULL AND latest_action_date IS NOT NULL
            AND date(stage_observed_at) < latest_action_date`,
    args: [],
  });
  let benign = 0;
  const odd: string[] = [];
  for (const r of preRows.rows) {
    const computed = computeStage(r.latest_action_text as string | null);
    const cur = String(r.stage ?? "");
    // benign iff the latest action does NOT compute to a stage beyond the current
    // one — i.e. it is a non-advancing action that arrived after the advance.
    if (STAGE_RANK[computed] !== undefined && STAGE_RANK[cur] !== undefined && STAGE_RANK[computed]! <= STAGE_RANK[cur]!) benign++;
    else odd.push(`${r.id}: stage=${cur} but latest action computes ${computed} @ ${r.latest_action_date}`);
  }
  console.log(`   (b) stamp earlier than latest_action_date : ${preRows.rows.length}`);
  console.log(`       of which BENIGN (a later non-advancing action, monotonic guard held): ${benign}`);
  console.log(`       unexplained: ${odd.length}`);
  for (const o of odd.slice(0, 10)) console.log(`          ${o}`);
  console.log(
    `       READ: (b) is EXPECTED behaviour, not an anomaly — it is the proxy bias the handoff names,\n` +
      `       observed from the other side. It is reported because the expect-zero framing would otherwise\n` +
      `       read as a broken premise.`,
  );

  // ── M2 premise — is an actions list recoverable from raw_json? ────────────
  rule("M2 PREMISE — is the stage-advancing action recoverable? (schema has no actions table)");
  const rj = await db.execute({
    sql: `SELECT id, raw_json FROM bills
          WHERE raw_json IS NOT NULL AND stage_observed_at IS NOT NULL
          ORDER BY stage_observed_at DESC LIMIT 2`,
    args: [],
  });
  for (const r of rj.rows) {
    let keys = "(unparseable)";
    let actions = "(absent)";
    try {
      const raw = JSON.parse(String(r.raw_json)) as Record<string, unknown>;
      keys = Object.keys(raw).sort().join(", ");
      if (raw.actions) actions = JSON.stringify(raw.actions).slice(0, 220);
    } catch {
      /* reported as unparseable */
    }
    console.log(`   ${r.id}\n      keys    : ${keys}\n      actions : ${actions}`);
  }

  // ── M2 — lag, against latest_action_date (PROXY) ──────────────────────────
  rule(`M2 — lag distribution, sample of ${SAMPLE} most-recent tracked rows (bounded, guard 4)`);
  const rs = await db.execute({
    sql: `SELECT id, stage, previous_stage, stage_observed_at, latest_action_date, introduced_date
          FROM bills INDEXED BY idx_bills_stage_observed_at
          WHERE stage_observed_at IS NOT NULL
          ORDER BY stage_observed_at DESC LIMIT ?`,
    args: [SAMPLE],
  });

  const lags: number[] = [];
  const lagsEnacted: number[] = [];
  let dayDiffers = 0;
  let geOneDay = 0;
  let withAnchor = 0;
  const byMinute = new Map<string, number>();
  const byStage = new Map<string, number[]>();

  for (const r of rs.rows) {
    const sca = String(r.stage_observed_at ?? "");
    byMinute.set(sca.slice(0, 16), (byMinute.get(sca.slice(0, 16)) ?? 0) + 1);
    const lad = r.latest_action_date ? String(r.latest_action_date) : "";
    if (!lad) continue;
    withAnchor++;
    // action date is date-only; compare at day granularity in ET
    const lagDays = (Date.parse(sca) - Date.parse(lad + "T00:00:00Z")) / 86_400_000;
    lags.push(lagDays);
    if (lagDays >= 1) geOneDay++;
    if (etDay(sca) !== lad) dayDiffers++;
    const st = String(r.stage ?? "?");
    if (!byStage.has(st)) byStage.set(st, []);
    byStage.get(st)!.push(lagDays);
    if (st === "enacted") lagsEnacted.push(lagDays);
  }

  console.log(`   rows with an anchor: ${withAnchor} of ${rs.rows.length}`);
  console.log(`   lag (days)         : ${fmtQ(quantiles(lags))}`);
  console.log(`   lag >= 1 day       : ${geOneDay} (${pct(geOneDay, withAnchor)})`);
  console.log(
    `   ET CALENDAR DAY DIFFERS: ${dayDiffers} (${pct(dayDiffers, withAnchor)})  <-- the figure that decides the day-grouping`,
  );
  console.log(
    `      SAFE LOWER BOUND against the TRUE anchor: ${geOneDay} (${pct(geOneDay, withAnchor)}).\n` +
      `      Reasoning, because the raw figure above is measured against the wrong anchor: the advancing\n` +
      `      action is at or before the latest action, so any row whose stamp is >= 1 day AFTER the latest\n` +
      `      action is >= 1 day after the advancing action too, and therefore lands on a different ET day.\n` +
      `      The proxy can only UNDERSTATE this. HO 632's comparable number, UTC-vs-ET bucketing, was 17%.`,
  );
  console.log(`\n   EXACT SUBSET — stage='enacted', where latest_action IS the advancing action (no proxy bias):`);
  console.log(`      ${fmtQ(quantiles(lagsEnacted))}`);
  console.log(`\n   by current stage (proxy-biased downward for non-terminal stages):`);
  for (const [st, arr] of [...byStage.entries()].sort((a, b) => b[1].length - a[1].length))
    console.log(`      ${st.padEnd(14)} ${fmtQ(quantiles(arr))}`);

  console.log(`\n   BATCH SHAPE — distinct minute-stamps across the sample: ${byMinute.size} for ${rs.rows.length} rows`);
  for (const [m, n] of [...byMinute.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6))
    console.log(`      ${m}   ${n} row(s)`);

  // ── M3 — stage_transitions: a better clock, or the same one? ──────────────
  rule("M3 — stage_transitions: does it hold a better timestamp?");
  const stMeta = await db.execute({
    sql: `SELECT COUNT(*) AS n, MIN(date(observed_at)) AS first, MAX(date(observed_at)) AS last,
                 COUNT(DISTINCT bill_id) AS bills
          FROM stage_transitions`,
    args: [],
  });
  const m = stMeta.rows[0]!;
  console.log(`   rows ${m.n} across ${m.bills} bills, window ${m.first} .. ${m.last}`);
  const stJoin = await db.execute({
    sql: `SELECT COUNT(*) AS n,
                 SUM(CASE WHEN st.observed_at = b.stage_observed_at THEN 1 ELSE 0 END) AS identical
          FROM stage_transitions st JOIN bills b ON b.id = st.bill_id
          WHERE b.stage_observed_at IS NOT NULL AND st.to_stage = b.stage`,
    args: [],
  });
  const j = stJoin.rows[0]!;
  console.log(
    `   current-stage rows joinable: ${j.n} · byte-identical timestamp to bills.stage_observed_at: ${j.identical} (${pct(Number(j.identical), Number(j.n))})`,
  );
  console.log(
    `   READ: both writers pass the SAME wall-clock value to the bills UPDATE and the stage_transitions\n` +
      `   INSERT (lib/sync.ts:271, lib/summarize-runner.ts:344), so this table carries the SAME observation\n` +
      `   clock — it is a history of WHEN WE LOOKED, not a better timestamp. No join recovers occurrence.`,
  );

  // ── M4 — the counts, both ways ────────────────────────────────────────────
  rule("M4 — ENACTED and STAGE TRANSITIONS, four weeks, observation clock vs occurrence proxy");
  console.log("   occurrence proxy = latest_action_date. For ENACTED this is EXACT (latest action = enactment).");
  console.log("   For TRANSITIONS it is a proxy and understates movement of rows that acted again after advancing.\n");
  console.log("   week (days ago)   ENACTED obs   ENACTED occ   TRANSITIONS obs   TRANSITIONS occ");
  const weeks = [0, 1, 2, 3];
  const enactedObs: number[] = [];
  const enactedOcc: number[] = [];
  const txObs: number[] = [];
  const txOcc: number[] = [];
  for (const w of weeks) {
    const lo = (w + 1) * 7;
    const hi = w * 7;
    const hiClause = hi === 0 ? "" : ` AND stage_observed_at <= datetime('now','-${hi} days')`;
    const hiClauseOcc = hi === 0 ? "" : ` AND latest_action_date <= date('now','-${hi} days')`;
    const [eo, ec, to, tc] = await Promise.all([
      db.execute(`SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_stage_observed_at
                  WHERE stage='enacted' AND stage_observed_at IS NOT NULL
                    AND stage_observed_at > datetime('now','-${lo} days')${hiClause}`),
      db.execute(`SELECT COUNT(*) AS n FROM bills
                  WHERE stage='enacted' AND latest_action_date IS NOT NULL
                    AND latest_action_date > date('now','-${lo} days')${hiClauseOcc}`),
      db.execute(`SELECT COUNT(*) AS n FROM bills INDEXED BY idx_bills_stage_observed_at
                  WHERE summary IS NOT NULL AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
                    AND stage_observed_at IS NOT NULL
                    AND stage_observed_at > datetime('now','-${lo} days')${hiClause}`),
      db.execute(`SELECT COUNT(*) AS n FROM bills
                  WHERE summary IS NOT NULL AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
                    AND stage_observed_at IS NOT NULL AND latest_action_date IS NOT NULL
                    AND latest_action_date > date('now','-${lo} days')${hiClauseOcc}`),
    ]);
    const v = [eo, ec, to, tc].map((x) => Number(x.rows[0]?.n ?? 0));
    enactedObs.push(v[0]!); enactedOcc.push(v[1]!); txObs.push(v[2]!); txOcc.push(v[3]!);
    console.log(
      `   ${(w === 0 ? "this week" : `-${w}w`).padEnd(17)} ${String(v[0]).padStart(11)} ${String(v[1]).padStart(13)} ${String(v[2]).padStart(17)} ${String(v[3]).padStart(17)}`,
    );
  }
  const delta = (a: number[]) => (a.length > 1 ? a[0]! - a[1]! : 0);
  console.log(
    `\n   WoW DELTA — the number the strip exists to show:` +
      `\n      ENACTED      obs ${delta(enactedObs) >= 0 ? "+" : ""}${delta(enactedObs)}   occ ${delta(enactedOcc) >= 0 ? "+" : ""}${delta(enactedOcc)}` +
      `\n      TRANSITIONS  obs ${delta(txObs) >= 0 ? "+" : ""}${delta(txObs)}   occ ${delta(txOcc) >= 0 ? "+" : ""}${delta(txOcc)}`,
  );

  // ── sync gaps over the span ───────────────────────────────────────────────
  rule("M4b — sync cadence over the same span (a catch-up run reading as congressional activity)");
  const runs = await db.execute({
    sql: `SELECT date(started_at) AS d, COUNT(*) AS n,
                 SUM(CASE WHEN error_message IS NOT NULL THEN 1 ELSE 0 END) AS errs
          FROM cron_runs
          WHERE started_at > datetime('now','-28 days')
          GROUP BY date(started_at) ORDER BY d DESC`,
    args: [],
  });
  console.log(`   distinct days with cron_runs in the last 28: ${runs.rows.length} (a missing day is a gap)`);
  const days = runs.rows.map((r) => String(r.d));
  console.log(`   most recent: ${days.slice(0, 8).join(" ")}`);
  const missing: string[] = [];
  for (let i = 0; i < 28; i++) {
    const d = new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10);
    if (!days.includes(d)) missing.push(d);
  }
  console.log(`   MISSING days: ${missing.length ? missing.join(" ") : "none"}`);
}

main();
