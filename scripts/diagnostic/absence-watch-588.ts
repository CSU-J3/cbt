// HO 588 STEP 0 — absence-watch rule probe: read-only. BUILDS NOTHING.
//
// A new front-page rule surface: a member who has missed >= X votes gets promoted
// onto `/` (a conditional "ABSENCE WATCH" strip). Before any build leaf/query/
// component exists, this probe measures the threshold X, the rule SHAPE, and the
// read cost of the one data path that doesn't exist yet. Three candidate shapes:
//
//   R1 — cumulative count.  SUM(not_voting) >= X over the 119th (the literal ask).
//   R2 — cumulative rate.   missed_pct >= X% over the 119th (what getParticipationStrip
//                           already computes — shared cache entry, ~0 marginal read).
//   R3 — recent window.     missed >= k of the chamber's last N roll calls (the
//                           "absent NOW" signal — NEW query, cost must be measured).
//
// The design tension R2-vs-R3: a cumulative rule is STICKY (a member at 29% trips
// forever, even after returning) and BLIND (a member at 4% cumulative who missed the
// last 25 straight never trips). M2's divergence sets measure whether either failure
// mode is real in the current corpus or hypothetical.
//
// STREAK / WINDOW RULE (M2/M3b): a member with NO member_votes row on a given roll
// (mid-window entrant, unsworn, left seat) counts as NO DATA, not a miss. Window
// counts and consecutive-miss streaks only count EXPLICIT `not_voting` rows. Walking
// the streak newest->oldest: a not_voting row extends it, any other explicit position
// (yea/nay/present) breaks it, a missing row is skipped (neither extends nor breaks).
//
// Facts copied verbatim (NOT imported — no queries.ts touch, HO 588 §3).
// RECONCILED TO HEAD ba03e51 AT HO 621 — every ref below re-read, not trusted:
//   - population predicate = getParticipationStrip (queries.ts:4734-4766). MECHANISM
//     CHANGED at HO 595, SEMANTICS DID NOT. The strip no longer aggregates
//     member_votes live; it reads the materialized `member_participation` table:
//       FROM member_participation p JOIN members m ON m.bioguide_id = p.bioguide_id
//       WHERE m.is_current = 1 AND p.total >= PARTICIPATION_FLOOR
//     and that table's writer (lib/participation-refresh.ts:109-115) computes exactly
//     COUNT(*) AS total + SUM(position='not_voting') AS nv GROUP BY bioguide_id — the
//     same two integers this probe used to compute inline. So the OLD predicate and
//     the NEW one select the same members and the same rate, and differ ONLY by the
//     table's freshness. THIS PROBE NOW READS THE MATERIALIZED TABLE (M1), because the
//     ruling turns on the probe's population being the STRIP's population, and adds M1.0
//     to measure the staleness that is now the only way the two can diverge.
//   - delegate carve = the strip's isDelegate CASE (queries.ts:4740-4742) /
//     MISSED_CARVE_EXPR (queries.ts:6033). UNCHANGED, byte-for-byte:
//     chamber='house' AND state IN ('DC','AS','GU','MP','PR','VI').
//   - PARTICIPATION_FLOOR = 50 (queries.ts:7925). UNCHANGED value; it is still a
//     QUERY-TIME constant, not stored in the materialized table — member_participation
//     holds every bioguide in member_votes (~554) and each reader applies `total >= 50`
//     itself. So the floor did not migrate into the materializer.
//   - zero-roster instrument = HO 566/540 lag query (vote-detail-cost-540.ts:68).
//     UNCHANGED in shape (line moved by one).
//
// HO 621 §1 question — is `member_participation` per-roll or windowed?
// NO. It is CUMULATIVE-ONLY, as expected. The DDL (scripts/migrate.ts:425-430) is
// (bioguide_id PK, total, not_voting, refreshed_at) — four columns, one row per
// member, no vote_id, no date, no window. There is no per-roll or recency structure
// anywhere in it. CONSEQUENCE FOR THE RULING: R1/R2 read a resident ~554-row table
// (their cost premise got STRONGER than 588 priced — see M3a), while R3's window
// query remains a genuinely NEW read path over member_votes that nothing materializes,
// and M3b below is the live price of it.
//
// Same idiom as motion-outcome-model-554.ts: raw @libsql/client, SELECT/EXPLAIN only,
// dotenv/config, npx tsx. Bounded aggregate SELECTs — no per-member query loops.
//
//   npx tsx scripts/diagnostic/absence-watch-588.ts
import "dotenv/config";
import { createClient, type Client, type Row } from "@libsql/client";

const PARTICIPATION_FLOOR = 50; // queries.ts:7726, copied verbatim
const DELEGATE_STATES = ["DC", "AS", "GU", "MP", "PR", "VI"]; // queries.ts:4554 / 5836

function num(row: Row | undefined, k: string): number { return Number((row as Row)?.[k] ?? 0); }
function s(row: Row | undefined, k: string): string { return String((row as Row)?.[k] ?? ""); }
function pct(n: number): string { return `${n.toFixed(1)}%`; }
function pad(v: string | number, w: number): string { return String(v).padEnd(w); }
function padL(v: string | number, w: number): string { return String(v).padStart(w); }

type Member = {
  bioguide: string; name: string; party: string | null; state: string;
  chamber: string; isDelegate: boolean;
  total: number; nv: number; missedPct: number;
};

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.log("TURSO_DATABASE_URL not set — run with the CBT .env (local working tree).");
    return 1;
  }
  const db: Client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  console.log("=== HO 588 STEP 0 — absence-watch rule probe (read-only) ===\n");

  const chambers = ["house", "senate"] as const;

  // ══════════════════════════════════════════════════════════════════════════
  // M1.0 — freshness of the materialized population (HO 621)
  // HO 595 made the strip's population a STORED artifact, so "is the probe reading
  // the strip's population?" stopped being a question about the predicate and became
  // a question about staleness. A stale member_participation renders correct-LOOKING
  // numbers with no error and no visual tell (the reason refreshed_at exists at all),
  // so measure it rather than assume it: print the stamp, then recompute the live
  // aggregate over member_votes and diff. Nonzero drift means the ruling's cumulative
  // figures describe what the STRIP would show, not what the corpus currently is —
  // which is the honest thing to rule on, but it must be visible.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("################ M1.0 — materialized-population freshness (HO 621) ################\n");
  const stampRes = await db.execute(
    `SELECT COUNT(*) AS n, MIN(refreshed_at) AS mn, MAX(refreshed_at) AS mx,
            CAST(julianday('now') - julianday(MAX(refreshed_at)) AS REAL) AS age_days
       FROM member_participation`,
  );
  const stamp = stampRes.rows[0];
  console.log(`   member_participation rows: ${num(stamp, "n")}`);
  console.log(`   refreshed_at: ${s(stamp, "mx")}  (age ${num(stamp, "age_days").toFixed(2)} days)`);
  console.log(`   stamp uniform across rows: ${s(stamp, "mn") === s(stamp, "mx") ? "✓ yes (one atomic batch)" : "⚠ NO — mixed stamps, a partial write"}`);

  // live recompute = exactly what participation-refresh.ts:109-115 writes
  const liveAggRes = await db.execute(
    `SELECT mv.bioguide_id AS bioguide, COUNT(*) AS total,
            SUM(CASE WHEN mv.position = 'not_voting' THEN 1 ELSE 0 END) AS nv
       FROM member_votes mv
      GROUP BY mv.bioguide_id`,
  );
  const live = new Map<string, { total: number; nv: number }>();
  for (const r of liveAggRes.rows) live.set(s(r, "bioguide"), { total: num(r, "total"), nv: num(r, "nv") });
  const storedRes = await db.execute(`SELECT bioguide_id AS bioguide, total, not_voting AS nv FROM member_participation`);
  let driftRows = 0; let driftVotes = 0; let missingFromTable = 0;
  for (const r of storedRes.rows) {
    const l = live.get(s(r, "bioguide"));
    if (!l) continue;
    if (l.total !== num(r, "total") || l.nv !== num(r, "nv")) {
      driftRows++; driftVotes += Math.abs(l.total - num(r, "total"));
    }
  }
  for (const bio of live.keys()) if (!storedRes.rows.some((r) => s(r, "bioguide") === bio)) missingFromTable++;
  console.log(`   live member_votes aggregate: ${live.size} members`);
  console.log(`   drift vs stored: ${driftRows} members differ (${driftVotes} vote-rows) · ${missingFromTable} in member_votes but ABSENT from the table`);
  console.log(`   → ${driftRows === 0 && missingFromTable === 0 ? "✓ table is current — probe population == strip population == corpus" : "⚠ table lags member_votes — M1 below is the STRIP's population (correct for the ruling); the corpus has moved"}`);
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // M1 — cumulative distribution + threshold sweep (R1/R2)
  // Population = getParticipationStrip's EXACT predicate (queries.ts:4734-4750),
  // now the materialized read (HO 595), + m.state so the delegate carve applies here.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("################ M1 — cumulative distribution + threshold sweep (R1/R2) ################\n");
  const popSql = `SELECT p.bioguide_id AS bioguide, m.name AS name, m.party AS party,
                         m.state AS state, m.chamber AS chamber,
                         CASE WHEN m.chamber = 'house'
                               AND m.state IN ('DC','AS','GU','MP','PR','VI')
                              THEN 1 ELSE 0 END AS isDelegate,
                         p.total AS total,
                         p.not_voting AS nv
                    FROM member_participation p
                    JOIN members m ON m.bioguide_id = p.bioguide_id
                   WHERE m.is_current = 1
                     AND p.total >= ?`;
  const popRes = await db.execute({ sql: popSql, args: [PARTICIPATION_FLOOR] });
  console.log(`getParticipationStrip population (is_current=1, total>=${PARTICIPATION_FLOOR}): ${popRes.rows.length} rows read\n`);

  const pop: Member[] = popRes.rows.map((r) => {
    const total = num(r, "total"); const nv = num(r, "nv");
    return {
      bioguide: s(r, "bioguide"), name: s(r, "name"),
      party: (r.party as string | null) ?? null, state: s(r, "state"),
      chamber: s(r, "chamber"), isDelegate: num(r, "isDelegate") === 1,
      total, nv, missedPct: total > 0 ? (nv / total) * 100 : 0,
    };
  });
  const byBio = new Map<string, Member>(pop.map((m) => [m.bioguide, m]));

  // Disclose the delegates (floored, is_current) once — they are excluded from every tripped set.
  const delegates = pop.filter((m) => m.isDelegate);
  console.log(`── Delegates in the floored population (EXCLUDED from every tripped set; disclosed once) ──`);
  console.log(`   count: ${delegates.length}`);
  for (const d of delegates) {
    console.log(`   · ${pad(d.name, 26)} ${pad(d.state, 3)} ${padL(d.nv, 4)}/${padL(d.total, 4)}  ${pct(d.missedPct)}`);
  }
  console.log("");

  const R1_SWEEP = [25, 50, 75, 100, 150];
  const R2_SWEEP = [5, 8, 10, 15, 20, 25];
  // count-histogram bins (8) and rate-histogram bins (8)
  const COUNT_BINS = [0, 10, 25, 50, 75, 100, 150, 200, Infinity];
  const RATE_BINS = [0, 2, 4, 6, 8, 10, 15, 20, Infinity];

  for (const ch of chambers) {
    const nonDel = pop.filter((m) => m.chamber === ch && !m.isDelegate);
    console.log(`════════════ ${ch.toUpperCase()} — ${nonDel.length} non-delegate floored members ════════════\n`);

    // 1. coarse histograms
    console.log(`── missed-COUNT histogram ──`);
    for (let i = 0; i < COUNT_BINS.length - 1; i++) {
      const lo = COUNT_BINS[i]!, hi = COUNT_BINS[i + 1]!;
      const n = nonDel.filter((m) => m.nv >= lo && m.nv < hi).length;
      const label = hi === Infinity ? `${lo}+` : `${lo}-${hi - 1}`;
      console.log(`   ${pad(label, 10)} ${padL(n, 4)}  ${"#".repeat(n)}`);
    }
    console.log(`── missed-RATE histogram ──`);
    for (let i = 0; i < RATE_BINS.length - 1; i++) {
      const lo = RATE_BINS[i]!, hi = RATE_BINS[i + 1]!;
      const n = nonDel.filter((m) => m.missedPct >= lo && m.missedPct < hi).length;
      const label = hi === Infinity ? `${lo}%+` : `${lo}-${hi}%`;
      console.log(`   ${pad(label, 10)} ${padL(n, 4)}  ${"#".repeat(n)}`);
    }
    console.log("");

    // 2. threshold sweep
    console.log(`── threshold sweep (tripped non-delegate members) ──`);
    console.log(`   R1 count:  ${R1_SWEEP.map((x) => `>=${x}: ${nonDel.filter((m) => m.nv >= x).length}`).join("   ")}`);
    console.log(`   R2 rate:   ${R2_SWEEP.map((x) => `>=${x}%: ${nonDel.filter((m) => m.missedPct >= x).length}`).join("   ")}`);
    console.log("");

    // 3. top 12 by rate
    console.log(`── top 12 by rate (non-delegate) ──`);
    const top = [...nonDel].sort((a, b) => b.missedPct - a.missedPct).slice(0, 12);
    for (const m of top) {
      console.log(`   ${pad(m.name, 26)} ${pad(m.party ?? "?", 2)} ${pad(m.state, 3)} ${pad(m.chamber, 6)} ${padL(m.nv, 4)}/${padL(m.total, 4)}  ${pct(m.missedPct)}`);
    }
    console.log("");
  }

  // 4. floor-excluded current members (invisible to the rule)
  // HO 621: driven off member_participation, not a live member_votes subquery — the
  // rule inherits the STRIP's exclusions, and post-595 a member is invisible to it
  // either by falling under the floor OR by having no row in the materialized table
  // at all. COALESCE(...,0) folds both into one honest `total`.
  console.log(`── M1.4 floor-excluded current members (total < ${PARTICIPATION_FLOOR} or absent from member_participation; invisible to the rule) ──`);
  const exclSql = `SELECT m.bioguide_id AS bioguide, m.name AS name, m.chamber AS chamber, m.state AS state,
                          CASE WHEN m.chamber = 'house' AND m.state IN ('DC','AS','GU','MP','PR','VI')
                               THEN 1 ELSE 0 END AS isDelegate,
                          COALESCE(p.total, 0) AS total
                     FROM members m
                     LEFT JOIN member_participation p ON p.bioguide_id = m.bioguide_id
                    WHERE m.is_current = 1`;
  const exclRes = await db.execute(exclSql);
  console.log(`   current members read: ${exclRes.rows.length}`);
  const excluded = exclRes.rows
    .map((r) => ({ name: s(r, "name"), chamber: s(r, "chamber"), state: s(r, "state"), total: num(r, "total"), isDelegate: num(r, "isDelegate") === 1 }))
    .filter((m) => m.total < PARTICIPATION_FLOOR);
  console.log(`   floor-excluded (total < ${PARTICIPATION_FLOOR}): ${excluded.length} (of which ${excluded.filter((m) => m.isDelegate).length} delegate)`);
  if (excluded.length <= 12) {
    for (const m of excluded) console.log(`   · ${pad(m.name, 26)} ${pad(m.chamber, 6)} ${pad(m.state, 3)} total=${m.total}${m.isDelegate ? " [delegate]" : ""}`);
  } else {
    console.log(`   (> 12 — names withheld per HO spec)`);
  }
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // M2 — recency divergence (R3)  +  M3b — cost of the NEW window query
  // ══════════════════════════════════════════════════════════════════════════
  console.log("################ M2 — recency divergence (R3) + M3b window-query cost ################\n");

  // current-member metadata map (for names/party/state/delegate on window rows)
  const memMetaRes = await db.execute(
    `SELECT bioguide_id AS bioguide, name, party, state, chamber,
            CASE WHEN chamber='house' AND state IN ('DC','AS','GU','MP','PR','VI') THEN 1 ELSE 0 END AS isDelegate
       FROM members WHERE is_current = 1`,
  );
  type Meta = { name: string; party: string | null; state: string; chamber: string; isDelegate: boolean };
  const meta = new Map<string, Meta>();
  for (const r of memMetaRes.rows) {
    meta.set(s(r, "bioguide"), {
      name: s(r, "name"), party: (r.party as string | null) ?? null,
      state: s(r, "state"), chamber: s(r, "chamber"), isDelegate: num(r, "isDelegate") === 1,
    });
  }

  type WinRow = { bioguide: string; windowMissed: number; streak: number };
  const winByChamber = new Map<string, Map<string, WinRow>>();
  let m3bTotalRows = 0; let m3bTotalMs = 0; let m3bExplainPrinted = false;

  for (const ch of chambers) {
    console.log(`════════════ ${ch.toUpperCase()} ════════════\n`);

    // last 30 roll calls, newest first (rides idx_votes_chamber_date)
    const rolls = await db.execute({
      sql: `SELECT id, vote_date FROM votes WHERE chamber = ? ORDER BY vote_date DESC LIMIT 30`,
      args: [ch],
    });
    const rollIds = rolls.rows.map((r) => s(r, "id"));
    const dates = rolls.rows.map((r) => s(r, "vote_date"));
    const span = dates.length ? `${dates[dates.length - 1]} … ${dates[0]}` : "(none)";
    console.log(`── M2.1 window = last ${rollIds.length} roll calls · span: ${span} ──`);

    if (rollIds.length === 0) { console.log("   (no rolls — skipping)\n"); continue; }

    // ── M3b: the NEW window query — EXPLAIN QUERY PLAN + cold cost + row count ──
    const placeholders = rollIds.map(() => "?").join(",");
    const winSql = `SELECT vote_id, bioguide_id, position FROM member_votes WHERE vote_id IN (${placeholders})`;
    if (!m3bExplainPrinted) {
      console.log(`   ── M3b: EXPLAIN QUERY PLAN of the NEW window query (member_votes WHERE vote_id IN (30 ids)) ──`);
      const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${winSql}`, args: rollIds });
      for (const p of plan.rows) console.log(`      · ${s(p, "detail")}`);
      m3bExplainPrinted = true;
    }
    const t0 = Date.now();
    const winRes = await db.execute({ sql: winSql, args: rollIds });
    const ms = Date.now() - t0;
    m3bTotalRows += winRes.rows.length; m3bTotalMs += ms;
    console.log(`   ⏱ window query (cold): ${ms}ms · rows read=${winRes.rows.length} (${rollIds.length} rolls × chamber membership)`);
    console.log("");

    // build per-member position-by-roll map
    const byMember = new Map<string, Map<string, string>>();
    for (const r of winRes.rows) {
      const bio = s(r, "bioguide_id");
      let mm = byMember.get(bio);
      if (!mm) { mm = new Map(); byMember.set(bio, mm); }
      mm.set(s(r, "vote_id"), s(r, "position"));
    }

    // per-member window-missed + streak (rollIds already newest-first)
    const winRows = new Map<string, WinRow>();
    for (const [bio, posMap] of byMember) {
      let windowMissed = 0;
      for (const pos of posMap.values()) if (pos === "not_voting") windowMissed++;
      let streak = 0;
      for (const id of rollIds) { // newest -> oldest
        const pos = posMap.get(id);
        if (pos === undefined) continue;          // no data — skip (not a miss, not a break)
        if (pos === "not_voting") { streak++; continue; }
        break;                                     // explicit vote breaks the streak
      }
      winRows.set(bio, { bioguide: bio, windowMissed, streak });
    }
    winByChamber.set(ch, winRows);

    const nonDelWin = [...winRows.values()].filter((w) => {
      const mt = meta.get(w.bioguide); return mt && !mt.isDelegate;
    });

    // M2.2 — window-missed / streak threshold counts
    console.log(`── M2.2 window-missed & streak thresholds (non-delegate) ──`);
    console.log(`   window-missed  >=10: ${nonDelWin.filter((w) => w.windowMissed >= 10).length}   >=20: ${nonDelWin.filter((w) => w.windowMissed >= 20).length}   >=30: ${nonDelWin.filter((w) => w.windowMissed >= 30).length}`);
    console.log(`   streak         >=10: ${nonDelWin.filter((w) => w.streak >= 10).length}   >=20: ${nonDelWin.filter((w) => w.streak >= 20).length}   >=30: ${nonDelWin.filter((w) => w.streak >= 30).length}`);
    console.log("");

    // 21-day date window secondary cut (same join shape, one extra query)
    const rolls21 = await db.execute({
      sql: `SELECT id FROM votes WHERE chamber = ? AND vote_date >= date('now','-21 days')`,
      args: [ch],
    });
    const ids21 = rolls21.rows.map((r) => s(r, "id"));
    console.log(`── M2.1b secondary cut = 21-day date window · ${ids21.length} rolls ──`);
    if (ids21.length > 0) {
      const ph21 = ids21.map(() => "?").join(",");
      const win21 = await db.execute({
        sql: `SELECT bioguide_id, SUM(CASE WHEN position='not_voting' THEN 1 ELSE 0 END) AS nv
                FROM member_votes WHERE vote_id IN (${ph21}) GROUP BY bioguide_id`,
        args: ids21,
      });
      const nd21 = win21.rows
        .map((r) => ({ bio: s(r, "bioguide_id"), nv: num(r, "nv") }))
        .filter((x) => { const mt = meta.get(x.bio); return mt && !mt.isDelegate; });
      console.log(`   21-day window-missed  >=10: ${nd21.filter((x) => x.nv >= 10).length}   >=20: ${nd21.filter((x) => x.nv >= 20).length}   >=30: ${nd21.filter((x) => x.nv >= 30).length}`);
    } else {
      console.log(`   (no rolls in the last 21 days)`);
    }
    console.log("");

    // M2.3 — the divergence sets (the measurement this HO exists for)
    console.log(`── M2.3 DIVERGENCE SETS (non-delegate) ──`);
    // (a) R3-only: window-missed >= 20/30 but cumulative < 10%
    const r3only = nonDelWin
      .filter((w) => w.windowMissed >= 20)
      .filter((w) => { const m = byBio.get(w.bioguide); return m && m.missedPct < 10; })
      .sort((a, b) => b.windowMissed - a.windowMissed);
    console.log(`   (a) R3-ONLY [window-missed >= 20/30 AND cumulative < 10%] — "vanished recently; R2 is blind": ${r3only.length}`);
    for (const w of r3only) {
      const m = byBio.get(w.bioguide); const mt = meta.get(w.bioguide);
      console.log(`       · ${pad(mt?.name ?? w.bioguide, 26)} ${pad(mt?.party ?? "?", 2)} ${pad(mt?.state ?? "", 3)}  window=${w.windowMissed}/30 streak=${w.streak}  cumulative=${pct(m?.missedPct ?? 0)}`);
    }
    // (b) R2-only-stale: cumulative >= 15% but <= 2 missed in the window
    const r2stale = nonDelWin
      .filter((w) => w.windowMissed <= 2)
      .filter((w) => { const m = byBio.get(w.bioguide); return m && m.missedPct >= 15; })
      .sort((a, b) => (byBio.get(b.bioguide)?.missedPct ?? 0) - (byBio.get(a.bioguide)?.missedPct ?? 0));
    console.log(`   (b) R2-ONLY-STALE [cumulative >= 15% AND <= 2 missed in window] — "chronic on paper, present on floor; R2 alert is sticky": ${r2stale.length}`);
    for (const w of r2stale) {
      const m = byBio.get(w.bioguide); const mt = meta.get(w.bioguide);
      console.log(`       · ${pad(mt?.name ?? w.bioguide, 26)} ${pad(mt?.party ?? "?", 2)} ${pad(mt?.state ?? "", 3)}  cumulative=${pct(m?.missedPct ?? 0)}  window=${w.windowMissed}/30`);
    }
    console.log("");

    // M2.4 — last_voted for every member tripping the M1 10% cumulative tier
    console.log(`── M2.4 last_voted for members tripping cumulative >= 10% (non-delegate) ──`);
    const lastVotedRes = await db.execute({
      sql: `SELECT mv.bioguide_id AS bioguide, MAX(v.vote_date) AS last_voted
              FROM member_votes mv JOIN votes v ON v.id = mv.vote_id
             WHERE v.chamber = ? AND mv.position != 'not_voting'
             GROUP BY mv.bioguide_id`,
      args: [ch],
    });
    const lastVoted = new Map<string, string>();
    for (const r of lastVotedRes.rows) lastVoted.set(s(r, "bioguide"), s(r, "last_voted"));
    const trip10 = pop
      .filter((m) => m.chamber === ch && !m.isDelegate && m.missedPct >= 10)
      .sort((a, b) => b.missedPct - a.missedPct);
    console.log(`   tripping >= 10%: ${trip10.length}`);
    for (const m of trip10) {
      const w = winByChamber.get(ch)?.get(m.bioguide);
      console.log(`   · ${pad(m.name, 26)} ${pad(m.party ?? "?", 2)} ${pad(m.state, 3)}  cumulative=${pct(m.missedPct)}  last_voted=${lastVoted.get(m.bioguide) ?? "(never)"}  window=${w ? `${w.windowMissed}/30 streak=${w.streak}` : "n/a"}`);
    }
    console.log("");
  }

  // ══════════════════════════════════════════════════════════════════════════
  // M3 — cost
  // ══════════════════════════════════════════════════════════════════════════
  console.log("################ M3 — cost (rows read is the currency) ################\n");
  console.log(`── M3a (code-read) R1/R2 reuse path — RE-READ AT HO 621, premise STRONGER ──`);
  console.log(`   getParticipationStrip is unstable_cache with key ["getParticipationStrip"] and NO args`);
  console.log(`   (queries.ts:4734-4766), so a dashboard consumer shares the /members cache entry —`);
  console.log(`   marginal regen cost for an R1/R2 rule is ~0 beyond today's participation-strip read.`);
  console.log(`   HO 595 STRENGTHENED this: even on a cache MISS the regen is now a ~554-row read of`);
  console.log(`   the resident member_participation table, not the 366k-row member_votes scan HO 588`);
  console.log(`   priced. R1/R2 read cost is no longer a consideration in the ruling at all.`);
  console.log("");
  console.log(`── M3b (measured) R3 NEW window path ──`);
  console.log(`   cold wall: ${m3bTotalMs}ms across both chambers · total rows read: ${m3bTotalRows} (see EXPLAIN above)`);
  console.log("");
  console.log(`── M3c cadence math (if R3 ships as its own cached query, tag 'votes', flushed by daily sync-votes 0 10 * * *) ──`);
  const rowsPerRegen = m3bTotalRows;
  // revalidate 3600 ceiling => up to 24 regens/day; tag flush adds at most 1 more.
  const regensPerDay = 24;
  console.log(`   rows/regen ≈ ${rowsPerRegen} (both chambers) · regens/day ≈ ${regensPerDay} (revalidate 3600 ceiling)`);
  console.log(`   => rows/day ≈ ${rowsPerRegen * regensPerDay} (worst case; a tag-only cache would regen ~1×/day = ${rowsPerRegen} rows/day)`);
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // M4 — freshness + integrity instruments
  // ══════════════════════════════════════════════════════════════════════════
  console.log("################ M4 — freshness + integrity instruments ################\n");

  console.log(`── M4.1 MAX(vote_date) per chamber + age vs now ──`);
  for (const ch of chambers) {
    const r = (await db.execute({
      sql: `SELECT MAX(vote_date) AS mx, CAST(julianday('now') - julianday(MAX(vote_date)) AS REAL) AS age_days
              FROM votes WHERE chamber = ?`,
      args: [ch],
    })).rows[0];
    console.log(`   ${pad(ch, 6)} MAX(vote_date)=${s(r, "mx")}  age=${num(r, "age_days").toFixed(1)} days  → AS OF stamp would read this today`);
  }
  console.log("");

  console.log(`── M4.2 zero-roster votes (tally > 0 AND NOT EXISTS member_votes; HO 566 instrument — expect 0) ──`);
  const zr = await db.execute(`
    SELECT COUNT(*) AS n FROM votes v
     WHERE NOT EXISTS (SELECT 1 FROM member_votes mv WHERE mv.vote_id = v.id)
       AND (v.yea_count + v.nay_count + COALESCE(v.present_count,0) + COALESCE(v.not_voting_count,0)) > 0`);
  const zrN = num(zr.rows[0], "n");
  console.log(`   zero-roster votes: ${zrN}  ${zrN === 0 ? "✓ clean" : "⚠ DEFLATES every denominator the rule reads — REPORT, do not work around"}`);
  if (zrN > 0) {
    const detail = await db.execute(`
      SELECT v.id, v.chamber, v.vote_date FROM votes v
       WHERE NOT EXISTS (SELECT 1 FROM member_votes mv WHERE mv.vote_id = v.id)
         AND (v.yea_count + v.nay_count + COALESCE(v.present_count,0) + COALESCE(v.not_voting_count,0)) > 0
       ORDER BY v.vote_date DESC LIMIT 12`);
    for (const r of detail.rows) console.log(`     · ${s(r, "id")} (${s(r, "chamber")}) ${s(r, "vote_date")}`);
  }
  console.log("");

  console.log(`── M4.3 position closed-vocabulary check (HO 550 pattern) ──`);
  const posRes = await db.execute(`SELECT position, COUNT(*) AS c FROM member_votes GROUP BY position ORDER BY c DESC`);
  for (const r of posRes.rows) console.log(`   ${pad(s(r, "position"), 14)} ${padL(num(r, "c"), 10)}`);
  const hasNv = posRes.rows.some((r) => s(r, "position") === "not_voting");
  console.log(`   → 'not_voting' present as the sole miss token: ${hasNv ? "✓" : "⚠ NOT FOUND"}`);
  console.log("");

  console.log("################ SUMMARY ################");
  console.log(`   M1 floored population: ${pop.length} (${delegates.length} delegate, ${excluded.length} floor-excluded current)`);
  console.log(`   M3b R3 window cost: ${m3bTotalMs}ms / ${m3bTotalRows} rows both chambers`);
  console.log(`   M4.2 zero-roster: ${zrN} · M4.3 not_voting token: ${hasNv ? "present" : "MISSING"}`);
  console.log(`   (verdict + rule-shape recommendation: written in chat from the numbers above)`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
