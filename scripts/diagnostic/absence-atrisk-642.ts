// HO 642 §8 — absence AT-RISK threshold probe. Read-only. BUILDS NOTHING.
//
// THE QUESTION. The owner asked to add "the ppl who are in danger of being MIA"
// to the Absence Watch band. That tier cannot be specified yet, because the
// shipped query CANNOT SEE THOSE MEMBERS AT ALL. `queryAbsenceWatch`'s Phase A is
//
//     WHERE vote_id IN (<the most recent ABSENCE_WINDOW = 30 rolls>)
//     GROUP BY bioguide_id
//     HAVING nv = n AND nv > 0
//
// so a member on a 15-roll streak fails `nv = n` over 30 rolls and never becomes a
// candidate — Phase B's exact walk never runs for them. The at-risk tier therefore
// needs Phase A WIDENED, and widening Phase A grows the candidate set that Phase B
// walks against ABSENCE_WALK_BOUND = 120 rolls. That is a cost, and the HO 624/625
// ledger discipline says measure it BEFORE committing to it, in ROWS.
//
// WHAT "WIDEN" MEANS HERE, stated so a re-run measures the same thing: for a given
// WARN, Phase A's candidate window becomes the last WARN rolls rather than the last
// 30. Everything else is the shipped shape verbatim — Phase B still walks the same
// 120-roll bound under the same HO 588 streak rule (an explicit `not_voting`
// extends, any other explicit position breaks, a MISSING row is NO-DATA and is
// skipped), and the population is still the strip's.
//
// WHY RAW HTTP AND NOT @libsql/client: v0.14.0 does not surface per-statement
// `rows_read`; Turso's hrana `/v2/pipeline` does. Harness lifted verbatim from
// `absence-card-cost-630.ts` (itself from `bills-agg-cost-624.ts`) — same DB, same
// credentials, read-only.
//
// THE INSTRUMENT'S TRAP, restated because it is easy to re-enter: a BARE `COUNT(*)`
// is answered from B-tree interior pages and under-reports scan cost by orders of
// magnitude (624 M0 measured member_votes 366,496 rows -> rows_read 1,617). Nothing
// below prices a scan by a bare count — every rows_read figure here is the real
// statement the shipped path would run, and the Phase A aggregate is measured as
// executed rather than approximated by a count of its output.
//
// THE SQL BELOW IS COPIED VERBATIM FROM `lib/queries.ts::queryAbsenceWatch` AS OF
// 4a13db6. A verbatim copy is a dependency with no compiler edge, so RECONCILE IT
// AGAINST THAT FUNCTION BEFORE TRUSTING A RE-RUN — a stale copy and a current one
// emit identical green (HO 554 -> 557). Reconciled at HO 642: the population read,
// the roll-call read (`ORDER BY vote_date DESC, id DESC LIMIT 120`), the Phase A
// `HAVING nv = n AND nv > 0`, and the Phase B two-IN-list select are byte-for-byte
// the shipped statements. The delegate carve lives IN the population SQL here, as
// it does in the shipped helper (`getParticipationStrip` keeps the flag instead
// because it discloses a count it renders; this surface has no reason to).
//
//   npx tsx scripts/diagnostic/absence-atrisk-642.ts
import "dotenv/config";

const PARTICIPATION_FLOOR = 50; // lib/queries.ts, the strip's population floor
const ABSENCE_STREAK_MIN = 30; // lib/queries.ts, the shipped MIA tier
const ABSENCE_WINDOW = 30; // lib/queries.ts, the shipped Phase A window
const ABSENCE_WALK_BOUND = 120; // lib/queries.ts, the Phase B walk ceiling
const CHAMBERS = ["house", "senate"] as const;
const WARN_SWEEP = [10, 15, 20] as const;

// The ruling criteria, fixed HERE and in the handoff BEFORE the numbers exist so
// they cannot be fitted to the result.
const VIABLE_MAX_POOLED = 6; // pooled [WARN, 30) set must be <= this
const COST_MULTIPLE = 2; // Phase B rows_read must be within this x the shipped read

type Exec = { rows: unknown[][]; rowsRead: number; ms: number };

let httpUrl = "";
let token = "";
let stmtCount = 0;
let totalRowsRead = 0;

async function exec(sql: string, args: (string | number)[] = []): Promise<Exec> {
  const res = await fetch(`${httpUrl}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          type: "execute",
          stmt: {
            sql,
            args: args.map((a) =>
              typeof a === "number"
                ? { type: "integer", value: String(a) }
                : { type: "text", value: a },
            ),
          },
        },
        { type: "close" },
      ],
    }),
  });
  const j = (await res.json()) as {
    results?: { type: string; response?: { result?: Record<string, unknown> }; error?: unknown }[];
  };
  const r = j.results?.[0];
  if (!r || r.type !== "ok" || !r.response?.result) {
    throw new Error(
      `query failed: ${JSON.stringify(r?.error ?? r).slice(0, 400)}\n  sql: ${sql.slice(0, 200)}`,
    );
  }
  const q = r.response.result as {
    rows: { value: unknown }[][];
    rows_read: number;
    query_duration_ms: number;
  };
  stmtCount++;
  totalRowsRead += q.rows_read;
  return {
    rows: q.rows.map((row) => row.map((c) => c?.value)),
    rowsRead: q.rows_read,
    ms: q.query_duration_ms,
  };
}

const S = (v: unknown): string => String(v ?? "");
const N = (v: unknown): number => Number(v ?? 0);
const pad = (v: string | number, w: number): string => String(v).padEnd(w);
const padL = (v: string | number, w: number): string => String(v).padStart(w);

type Pop = {
  name: string;
  party: string | null;
  state: string;
  chamber: string;
  missedPct: number;
};
type Walked = {
  bioguide: string;
  streak: number;
  atBound: boolean;
  lastCastDate: string;
};
type PhaseResult = {
  candidates: number;
  phaseARows: number;
  phaseAMs: number;
  phaseBRows: number; // rows RETURNED by the Phase B select
  phaseBRowsRead: number; // rows_read — the currency
  phaseBMs: number;
  walked: Walked[];
};

// One WARN, one chamber. `warn` sets ONLY the Phase A window; Phase B is the
// shipped 120-roll walk either way.
async function runPhase(
  chamber: string,
  rollIds: string[],
  rollDates: string[],
  pop: Map<string, Pop>,
  warn: number,
): Promise<PhaseResult> {
  // ── Phase A — candidates over the last `warn` rolls ────────────────────────
  const windowIds = rollIds.slice(0, warn);
  const windowPh = windowIds.map(() => "?").join(",");
  const candRes = await exec(
    `SELECT bioguide_id AS bio,
            COUNT(*) AS n,
            SUM(CASE WHEN position = 'not_voting' THEN 1 ELSE 0 END) AS nv
       FROM member_votes
      WHERE vote_id IN (${windowPh})
      GROUP BY bioguide_id
     HAVING nv = n AND nv > 0`,
    windowIds,
  );
  const candidates = candRes.rows
    .map((r) => S(r[0]))
    .filter((bio) => pop.get(bio)?.chamber === chamber);

  if (candidates.length === 0) {
    return {
      candidates: 0,
      phaseARows: candRes.rowsRead,
      phaseAMs: candRes.ms,
      phaseBRows: 0,
      phaseBRowsRead: 0,
      phaseBMs: 0,
      walked: [],
    };
  }

  // ── Phase B — the bounded walk, ONE query for every candidate ──────────────
  const candPh = candidates.map(() => "?").join(",");
  const boundPh = rollIds.map(() => "?").join(",");
  const walkRes = await exec(
    `SELECT bioguide_id AS bio, vote_id AS voteId, position AS position
       FROM member_votes
      WHERE bioguide_id IN (${candPh})
        AND vote_id IN (${boundPh})`,
    [...candidates, ...rollIds],
  );

  const byMember = new Map<string, Map<string, string>>();
  for (const r of walkRes.rows) {
    const bio = S(r[0]);
    let m = byMember.get(bio);
    if (!m) {
      m = new Map();
      byMember.set(bio, m);
    }
    m.set(S(r[1]), S(r[2]));
  }

  const walked: Walked[] = [];
  for (const bio of candidates) {
    const positions = byMember.get(bio);
    if (!positions) continue;
    let streak = 0;
    let breakIndex = -1;
    for (let i = 0; i < rollIds.length; i++) {
      const pos = positions.get(rollIds[i] ?? "");
      if (pos === undefined) continue; // NO DATA — neither extends nor breaks
      if (pos === "not_voting") {
        streak++;
        continue;
      }
      breakIndex = i;
      break;
    }
    const atBound = breakIndex === -1;
    walked.push({
      bioguide: bio,
      streak,
      atBound,
      lastCastDate: atBound
        ? (rollDates[rollDates.length - 1] ?? "")
        : (rollDates[breakIndex] ?? ""),
    });
  }

  return {
    candidates: candidates.length,
    phaseARows: candRes.rowsRead,
    phaseAMs: candRes.ms,
    phaseBRows: walkRes.rows.length,
    phaseBRowsRead: walkRes.rowsRead,
    phaseBMs: walkRes.ms,
    walked,
  };
}

async function main(): Promise<number> {
  const raw = process.env.TURSO_DATABASE_URL ?? "";
  token = process.env.TURSO_AUTH_TOKEN ?? "";
  if (!raw || !token) {
    console.log("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN required — run with the CBT .env.");
    return 1;
  }
  httpUrl = raw.replace(/^libsql:/, "https:");

  console.log("=".repeat(96));
  console.log("HO 642 §8 — absence AT-RISK threshold probe (read-only)");
  console.log(`  population = getParticipationStrip's, verbatim (is_current=1, total >= ${PARTICIPATION_FLOOR},`);
  console.log("               House delegates DC/AS/GU/MP/PR/VI excluded)");
  console.log(`  Phase A window = WARN rolls (shipped: ${ABSENCE_WINDOW}) · Phase B bound = ${ABSENCE_WALK_BOUND} rolls (shipped)`);
  console.log(`  ruling criteria, fixed before the numbers: pooled [WARN,30) <= ${VIABLE_MAX_POOLED}`);
  console.log(`                                             Phase B rows_read within ${COST_MULTIPLE}x the shipped read`);
  console.log("=".repeat(96));
  console.log("");

  // ── population — verbatim queryAbsenceWatch ────────────────────────────────
  const popRes = await exec(
    `SELECT p.bioguide_id AS bioguideId, m.name AS name, m.party AS party,
            m.state AS state, m.chamber AS chamber,
            p.total AS total, p.not_voting AS nv
       FROM member_participation p
       JOIN members m ON m.bioguide_id = p.bioguide_id
      WHERE m.is_current = 1
        AND p.total >= ?
        AND NOT (m.chamber = 'house'
                 AND m.state IN ('DC','AS','GU','MP','PR','VI'))`,
    [PARTICIPATION_FLOOR],
  );
  const pop = new Map<string, Pop>();
  for (const r of popRes.rows) {
    const total = N(r[5]);
    if (total <= 0) continue;
    pop.set(S(r[0]), {
      name: S(r[1]),
      party: (r[2] as string | null) ?? null,
      state: S(r[3]),
      chamber: S(r[4]),
      missedPct: (N(r[6]) / total) * 100,
    });
  }
  const popByChamber = { house: 0, senate: 0 } as Record<string, number>;
  for (const m of pop.values()) popByChamber[m.chamber] = (popByChamber[m.chamber] ?? 0) + 1;
  console.log(
    `M0  population  ${pop.size} floored non-delegate current members ` +
      `(house ${popByChamber.house ?? 0} · senate ${popByChamber.senate ?? 0})  ` +
      `rows_read ${popRes.rowsRead} · ${popRes.ms}ms`,
  );
  console.log("");

  // ── roll calls per chamber (one read each, serves every WARN) ──────────────
  const rolls: Record<string, { ids: string[]; dates: string[] }> = {};
  for (const chamber of CHAMBERS) {
    const r = await exec(
      `SELECT id, vote_date FROM votes
        WHERE chamber = ?
        ORDER BY vote_date DESC, id DESC
        LIMIT ?`,
      [chamber, ABSENCE_WALK_BOUND],
    );
    rolls[chamber] = {
      ids: r.rows.map((x) => S(x[0])),
      dates: r.rows.map((x) => S(x[1]).slice(0, 10)),
    };
    const d = rolls[chamber]?.dates ?? [];
    console.log(
      `M0  ${pad(chamber, 6)} rolls ${padL(d.length, 3)}  span ${d[d.length - 1] ?? "?"} … ${d[0] ?? "?"}  ` +
        `rows_read ${r.rowsRead} · ${r.ms}ms`,
    );
  }
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // BASELINE — the SHIPPED path (Phase A window = 30). This is the denominator
  // of the 2x cost gate, and it is measured rather than assumed.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("#".repeat(96));
  console.log(`# BASELINE — the shipped path, Phase A window = ABSENCE_WINDOW = ${ABSENCE_WINDOW}`);
  console.log("#".repeat(96));
  let baseB = 0;
  const baseline: Record<string, PhaseResult> = {};
  for (const chamber of CHAMBERS) {
    const rr = rolls[chamber];
    if (!rr || rr.ids.length === 0) continue;
    const res = await runPhase(chamber, rr.ids, rr.dates, pop, ABSENCE_WINDOW);
    baseline[chamber] = res;
    baseB += res.phaseBRowsRead;
    console.log(
      `  ${pad(chamber, 6)}  PhaseA cand ${padL(res.candidates, 3)} (rows_read ${padL(res.phaseARows, 7)}, ${padL(res.phaseAMs, 5)}ms)` +
        `   PhaseB rows ${padL(res.phaseBRows, 6)} rows_read ${padL(res.phaseBRowsRead, 7)} (${padL(res.phaseBMs, 5)}ms)`,
    );
    const mia = res.walked.filter((w) => w.streak >= ABSENCE_STREAK_MIN);
    for (const w of mia) {
      const m = pop.get(w.bioguide);
      console.log(
        `           MIA · ${pad(m?.name ?? w.bioguide, 26)} ${pad(m?.party ?? "?", 2)} ${pad(m?.state ?? "", 3)}` +
          `  streak=${padL(w.streak, 3)}${w.atBound ? "+" : " "}  lastCast=${w.lastCastDate}  missed=${(m?.missedPct ?? 0).toFixed(1)}%`,
      );
    }
  }
  console.log(`  → shipped Phase B rows_read (both chambers) = ${baseB}   [the 2x gate's denominator]`);
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // M-CONTROL — the FULL-POPULATION streak distribution, Phase A bypassed.
  //
  // Added after the first run returned an empty at-risk tier at every threshold,
  // because "0 members in [WARN, 30)" and "a Phase A predicate that cannot select
  // them" produce IDENTICAL output — the same-as-success shape. This walks every
  // floored non-delegate member over the same 120-roll bound under the same streak
  // rule, with NO candidate filter at all, so the tier's emptiness is established
  // independently of the predicate the sweep depends on. If this histogram is also
  // empty in [10, 30), the zero is the corpus, not the instrument.
  //
  // It is the one statement in this probe that is NOT a shipped shape — it is a
  // control, and it is priced separately below so it never lands in the cost gate.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("#".repeat(96));
  console.log("# M-CONTROL — full-population streak histogram (Phase A bypassed)");
  console.log("#".repeat(96));
  const CTRL_BINS = [0, 1, 5, 10, 15, 20, 30, Number.POSITIVE_INFINITY];
  let ctrlRowsRead = 0;
  const ctrlAll: { chamber: string; bio: string; streak: number; atBound: boolean }[] = [];
  // RETAINED for M-OCCUPANCY below — the position matrix this walk already fetched.
  // Keeping it is what lets the 60-cursor replay add ZERO queries; re-deriving it
  // per cursor would be 120 statements for an answer already in memory.
  const matrix = new Map<string, Map<string, Map<string, string>>>();
  for (const chamber of CHAMBERS) {
    const rr = rolls[chamber];
    if (!rr || rr.ids.length === 0) continue;
    const boundPh = rr.ids.map(() => "?").join(",");
    const allRes = await exec(
      `SELECT bioguide_id AS bio, vote_id AS voteId, position AS position
         FROM member_votes
        WHERE vote_id IN (${boundPh})`,
      rr.ids,
    );
    ctrlRowsRead += allRes.rowsRead;
    const byMember = new Map<string, Map<string, string>>();
    for (const r of allRes.rows) {
      const bio = S(r[0]);
      let m = byMember.get(bio);
      if (!m) {
        m = new Map();
        byMember.set(bio, m);
      }
      m.set(S(r[1]), S(r[2]));
    }
    matrix.set(chamber, byMember);
    const streaks: number[] = [];
    for (const [bio, positions] of byMember) {
      if (pop.get(bio)?.chamber !== chamber) continue; // population carve
      let streak = 0;
      let broke = false;
      for (let i = 0; i < rr.ids.length; i++) {
        const pos = positions.get(rr.ids[i] ?? "");
        if (pos === undefined) continue;
        if (pos === "not_voting") {
          streak++;
          continue;
        }
        broke = true;
        break;
      }
      streaks.push(streak);
      ctrlAll.push({ chamber, bio, streak, atBound: !broke });
    }
    console.log(
      `  ${pad(chamber, 6)} members walked ${padL(streaks.length, 4)}  rows ${padL(allRes.rows.length, 6)}  ` +
        `rows_read ${padL(allRes.rowsRead, 7)} (${padL(allRes.ms, 6)}ms)`,
    );
    for (let i = 0; i < CTRL_BINS.length - 1; i++) {
      const lo = CTRL_BINS[i] ?? 0;
      const hi = CTRL_BINS[i + 1] ?? Number.POSITIVE_INFINITY;
      const n = streaks.filter((s) => s >= lo && s < hi).length;
      const label = hi === Number.POSITIVE_INFINITY ? `${lo}+` : `${lo}-${hi - 1}`;
      console.log(`           streak ${pad(label, 8)} ${padL(n, 4)}  ${"#".repeat(Math.min(n, 60))}`);
    }
  }
  const ctrlNotable = ctrlAll.filter((x) => x.streak >= 3).sort((a, b) => b.streak - a.streak);
  console.log(`  ── every member with a streak >= 3 (pooled ${ctrlNotable.length}) ──`);
  if (ctrlNotable.length === 0) {
    console.log("     (none)");
  }
  for (const x of ctrlNotable.slice(0, 25)) {
    const m = pop.get(x.bio);
    console.log(
      `     · ${pad(m?.name ?? x.bio, 26)} ${pad(m?.party ?? "?", 2)} ${pad(m?.state ?? "", 3)} ${pad(x.chamber, 6)}` +
        `  streak=${padL(x.streak, 3)}${x.atBound ? "+" : " "}  missed=${padL((m?.missedPct ?? 0).toFixed(1), 5)}%`,
    );
  }
  const ctrlInBand = ctrlAll.filter((x) => x.streak >= 10 && x.streak < ABSENCE_STREAK_MIN).length;
  console.log(
    `  → CONTROL: ${ctrlInBand} member(s) anywhere in [10, ${ABSENCE_STREAK_MIN}) across the whole population.` +
      ` control rows_read ${ctrlRowsRead} (NOT in the cost gate — this statement is a control, not a shipped shape).`,
  );
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // M-OCCUPANCY — is the [5,30) band EVER occupied? (HO 642 follow-up)
  //
  // The snapshot above answers "who is in the band TODAY" and got 0. That does not
  // answer "is the band ever occupied", because OCCUPANCY OF A TRANSIENT STATE IS
  // NOT MEASURABLE FROM ONE SAMPLE — a member passes through [5,30) on the way to
  // 30+, so a single cursor can easily land between crossings and report an empty
  // band that is in fact routinely occupied. One sample cannot distinguish "never"
  // from "not right now", and a tier declined on the former would be declined on
  // evidence that only supports the latter.
  //
  // So: replay the identical streak rule with the newest-roll cursor set to each of
  // the last OCCUPANCY_CURSORS roll calls, reusing the M-CONTROL matrix. ZERO new
  // queries — the matrix already holds every (member, roll, position) in the bound,
  // and a cursor is just a different starting index into the same roll list.
  //
  // TRUNCATION, stated because it bounds what the far cursors can say: at cursor k
  // only (bound - k) rolls remain visible, so a streak observed there is CENSORED at
  // that length. With bound 120 and 60 cursors the shallowest lookback is 61 rolls —
  // still more than twice the 30 that defines the MIA tier, so neither band is
  // clipped by construction. It would be at, say, 110 cursors.
  //
  // Ruling criteria, fixed in the handoff BEFORE the numbers existed:
  //   VIABLE      median occupancy >= 1 AND max <= 6
  //   DECLINED    max == 0 across every cursor (structurally empty; no threshold
  //               rescues it)
  //   CONDITIONAL anything else (median 0, max > 0) — a band that renders rarely.
  //               Report and stop; whether that earns a slot is an owner call.
  // ══════════════════════════════════════════════════════════════════════════
  const OCCUPANCY_CURSORS = 60;
  const BAND_LO = 5;
  console.log("#".repeat(96));
  console.log(
    `# M-OCCUPANCY — [${BAND_LO},${ABSENCE_STREAK_MIN}) band occupancy across the last ${OCCUPANCY_CURSORS} roll calls`,
  );
  console.log("#".repeat(96));

  type OccChamber = {
    series: number[];
    miaSeries: number[];
    distinct: Set<string>;
    firstDate: string;
    lastDate: string;
    cursors: number;
  };
  const occ: Record<string, OccChamber> = {};

  for (const chamber of CHAMBERS) {
    const rr = rolls[chamber];
    const byMember = matrix.get(chamber);
    if (!rr || !byMember || rr.ids.length === 0) continue;
    const cursors = Math.min(OCCUPANCY_CURSORS, rr.ids.length);
    const series: number[] = [];
    const miaSeries: number[] = [];
    const distinct = new Set<string>();

    for (let k = 0; k < cursors; k++) {
      let inBand = 0;
      let inMia = 0;
      for (const [bio, positions] of byMember) {
        if (pop.get(bio)?.chamber !== chamber) continue; // the same population carve
        let streak = 0;
        for (let i = k; i < rr.ids.length; i++) {
          const pos = positions.get(rr.ids[i] ?? "");
          if (pos === undefined) continue; // NO DATA — neither extends nor breaks
          if (pos === "not_voting") {
            streak++;
            continue;
          }
          break;
        }
        if (streak >= BAND_LO && streak < ABSENCE_STREAK_MIN) {
          inBand++;
          distinct.add(bio);
        } else if (streak >= ABSENCE_STREAK_MIN) {
          inMia++;
        }
      }
      series.push(inBand);
      miaSeries.push(inMia);
    }

    occ[chamber] = {
      series,
      miaSeries,
      distinct,
      firstDate: rr.dates[cursors - 1] ?? "?",
      lastDate: rr.dates[0] ?? "?",
      cursors,
    };

    const sorted = [...series].sort((a, b) => a - b);
    const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))] ?? 0;
    const median = at(0.5);
    const p90 = at(0.9);
    const max = Math.max(...series);

    console.log(
      `  ${pad(chamber, 6)} cursors ${padL(cursors, 3)}  window ${occ[chamber]?.firstDate} … ${occ[chamber]?.lastDate}` +
        `   (cursor 0 = newest roll; cursor ${cursors - 1} sees ${rr.ids.length - cursors + 1} rolls back)`,
    );
    console.log(`         [${BAND_LO},${ABSENCE_STREAK_MIN}) series (newest -> oldest cursor):`);
    for (let i = 0; i < series.length; i += 20) {
      console.log(`            ${series.slice(i, i + 20).map((v) => padL(v, 2)).join(" ")}`);
    }
    console.log(`         >=${ABSENCE_STREAK_MIN} series:`);
    for (let i = 0; i < miaSeries.length; i += 20) {
      console.log(`            ${miaSeries.slice(i, i + 20).map((v) => padL(v, 2)).join(" ")}`);
    }
    console.log(
      `         occupancy  median ${median} · p90 ${p90} · max ${max}   ·   DISTINCT members ever in band: ${distinct.size}`,
    );
    if (distinct.size > 0) {
      for (const bio of distinct) {
        const m = pop.get(bio);
        console.log(`            · ${pad(m?.name ?? bio, 26)} ${pad(m?.party ?? "?", 2)} ${pad(m?.state ?? "", 3)}`);
      }
    }
  }

  // ── pooled, DATE-ALIGNED (not by cursor index) ────────────────────────────
  // The chambers do not vote on the same days: house cursor 0 and senate cursor 0
  // are different DATES (16 days apart at the time of writing, because the House is
  // in recess). Summing series[k] + series[k] would add two different points in
  // time and call it one — so pool on the DATE axis, restricted to the overlap of
  // the two cursor windows, since outside it one chamber contributes no sample and
  // a zero there would read as "nobody absent" rather than "not measured".
  const pooledDistinct = new Set<string>();
  for (const c of CHAMBERS) for (const b of occ[c]?.distinct ?? []) pooledDistinct.add(b);

  const dated: Record<string, { date: string; v: number }[]> = {};
  for (const c of CHAMBERS) {
    const o = occ[c];
    const rr = rolls[c];
    if (!o || !rr) continue;
    dated[c] = o.series.map((v, k) => ({ date: rr.dates[k] ?? "", v }));
  }
  const lo = CHAMBERS.map((c) => occ[c]?.firstDate ?? "").filter(Boolean).sort().at(-1) ?? "";
  const hi = CHAMBERS.map((c) => occ[c]?.lastDate ?? "").filter(Boolean).sort()[0] ?? "";
  const dateSet = new Set<string>();
  for (const c of CHAMBERS)
    for (const d of dated[c] ?? []) if (d.date >= lo && d.date <= hi) dateSet.add(d.date);
  const dates = [...dateSet].sort().reverse();
  const pooledSeries: number[] = [];
  for (const d of dates) {
    let v = 0;
    for (const c of CHAMBERS) {
      // that chamber's most recent cursor at or before this date
      const hit = (dated[c] ?? []).find((x) => x.date <= d);
      v += hit?.v ?? 0;
    }
    pooledSeries.push(v);
  }
  console.log("");
  console.log(
    `  pooled on the DATE axis over the window both chambers cover: ${lo} … ${hi}` +
      ` (${dates.length} distinct roll dates). Cursor-index pooling is NOT used —` +
      ` the chambers' cursor 0 differ by ${Math.round(
        (Date.parse(`${(occ.senate?.lastDate ?? lo)}T00:00:00Z`) -
          Date.parse(`${(occ.house?.lastDate ?? lo)}T00:00:00Z`)) / 86_400_000,
      )} days.`,
  );
  const ps = [...pooledSeries].sort((a, b) => a - b);
  const pAt = (q: number) => ps[Math.min(ps.length - 1, Math.floor(q * (ps.length - 1)))] ?? 0;
  const pMedian = pAt(0.5);
  const pP90 = pAt(0.9);
  const pMax = pooledSeries.length ? Math.max(...pooledSeries) : 0;
  console.log("");
  console.log(
    `  POOLED  median ${pMedian} · p90 ${pP90} · max ${pMax}  ·  distinct members ever in band: ${pooledDistinct.size}`,
  );

  const verdictOcc =
    pMax === 0
      ? "DECLINED"
      : pMedian >= 1 && pMax <= 6
        ? "VIABLE"
        : "CONDITIONAL";
  console.log(`  VERDICT ${verdictOcc}`);
  if (verdictOcc === "DECLINED") {
    console.log(
      `    max occupancy is 0 at EVERY one of the ${pooledSeries.length} sampled dates — the band is`,
    );
    console.log(
      "    structurally empty over the measured window, and no threshold inside it rescues the tier.",
    );
    console.log(
      "    This is the criterion the handoff fixed in advance for exactly this reading; nothing more is swept.",
    );
  } else if (verdictOcc === "CONDITIONAL") {
    // The criteria name CONDITIONAL with the parenthetical "(median 0, max > 0)".
    // That is ONE of the two ways to land here and the branch must not narrate it
    // when the other one fired — a canned explanation that contradicts the numbers
    // above it is worse than no explanation.
    if (pMedian === 0) {
      console.log(
        `    the band is reachable (max ${pMax}) but sits EMPTY at the median — a tier that renders`,
      );
      console.log(
        "    rarely. Reported as that and stopped: whether a rarely-firing band earns its slot is an",
      );
      console.log("    owner call, not a measurement.");
    } else {
      console.log(
        `    NOT the case the criteria's parenthetical anticipated. The band is OCCUPIED at the median`,
      );
      console.log(
        `    (${pMedian}, so the >= 1 half PASSES) and fails on the CEILING instead: max ${pMax} > 6. That ceiling`,
      );
      console.log(
        "    exists so the at-risk tier cannot outnumber the MIA tier and stop the band reading as an",
      );
      console.log(
        `    alarm — and at its peak this band carries ${pMax} at-risk against ${Math.max(
          ...CHAMBERS.map((c) => Math.max(0, ...(occ[c]?.miaSeries ?? [0]))),
        )} MIA. So the failure is over-population,`,
      );
      console.log(
        "    not emptiness, and the lever is a HIGHER threshold than 5, which this probe did not sweep",
      );
      console.log(
        "    because the handoff fixed the band at [5,30). Reported and stopped: the rule shape is the",
      );
      console.log("    owner's call.");
    }
  }

  // The window's reach is load-bearing: a window that only spans idle days measures
  // nothing, so it is stated rather than left for the reader to infer from dates.
  console.log("");
  console.log("  ── window reach (state plainly; an idle window measures nothing) ──");
  for (const chamber of CHAMBERS) {
    const o = occ[chamber];
    const rr = rolls[chamber];
    if (!o || !rr) continue;
    const spanDays = Math.round(
      (Date.parse(`${o.lastDate}T00:00:00Z`) - Date.parse(`${o.firstDate}T00:00:00Z`)) / 86_400_000,
    );
    const idleDays = Math.round(
      (Date.now() - Date.parse(`${o.lastDate}T00:00:00Z`)) / 86_400_000,
    );
    console.log(
      `     ${pad(chamber, 6)} ${o.cursors} cursors span ${o.firstDate} … ${o.lastDate} = ${spanDays} calendar days` +
        ` · newest roll is ${idleDays} days old` +
        `${idleDays > 10 ? "  ⚠ CHAMBER IS IDLE — the newest cursor is not 'today'" : ""}`,
    );
    console.log(
      `            full ${rr.ids.length}-roll bound reaches ${rr.dates[rr.dates.length - 1]}; the cursor window covers` +
        ` ${o.cursors}/${rr.ids.length} of it`,
    );
  }
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // THE SWEEP
  // ══════════════════════════════════════════════════════════════════════════
  type Verdict = {
    warn: number;
    pooledAtRisk: number;
    pooledMia: number;
    pooledBelow: number;
    pooledAtBound: number;
    phaseB: number;
    ratio: number;
  };
  const verdicts: Verdict[] = [];

  for (const warn of WARN_SWEEP) {
    console.log("#".repeat(96));
    console.log(`# WARN = ${warn}   (Phase A window = last ${warn} rolls)`);
    console.log("#".repeat(96));

    let pooledAtRisk = 0;
    let pooledMia = 0;
    let pooledBelow = 0;
    let pooledAtBound = 0;
    let phaseBSum = 0;
    const atRiskRoster: { chamber: string; w: Walked }[] = [];

    for (const chamber of CHAMBERS) {
      const rr = rolls[chamber];
      if (!rr || rr.ids.length === 0) continue;
      const res = await runPhase(chamber, rr.ids, rr.dates, pop, warn);
      phaseBSum += res.phaseBRowsRead;

      // (2) streak distribution of the CANDIDATES after the Phase B walk
      const atRisk = res.walked.filter(
        (w) => w.streak >= warn && w.streak < ABSENCE_STREAK_MIN,
      );
      const mia = res.walked.filter((w) => w.streak >= ABSENCE_STREAK_MIN);
      const below = res.walked.filter((w) => w.streak < warn);
      const atBound = res.walked.filter((w) => w.atBound);

      pooledAtRisk += atRisk.length;
      pooledMia += mia.length;
      pooledBelow += below.length;
      pooledAtBound += atBound.length;
      for (const w of atRisk) atRiskRoster.push({ chamber, w });

      // (1) Phase A candidate count · (5) Phase B row count + rows_read
      console.log(
        `  ${pad(chamber, 6)}  PhaseA cand ${padL(res.candidates, 3)} (rows_read ${padL(res.phaseARows, 7)}, ${padL(res.phaseAMs, 5)}ms)` +
          `   PhaseB rows ${padL(res.phaseBRows, 6)} rows_read ${padL(res.phaseBRowsRead, 7)} (${padL(res.phaseBMs, 5)}ms)`,
      );
      console.log(
        `           streaks: [${warn},${ABSENCE_STREAK_MIN}) = ${padL(atRisk.length, 3)}   ` +
          `>=${ABSENCE_STREAK_MIN} = ${padL(mia.length, 3)}   ` +
          `<${warn} (NO-DATA gaps in the window) = ${padL(below.length, 3)}   ` +
          // (4) atBound — walk exhausted at 120 without observing a cast vote
          `atBound = ${padL(atBound.length, 3)}`,
      );
    }

    // (3) the at-risk roster
    console.log("");
    console.log(`  ── at-risk tier [${warn}, ${ABSENCE_STREAK_MIN}) — pooled ${pooledAtRisk} ──`);
    if (atRiskRoster.length === 0) {
      console.log("     (empty)");
    } else {
      atRiskRoster.sort((a, b) => b.w.streak - a.w.streak);
      for (const { chamber, w } of atRiskRoster) {
        const m = pop.get(w.bioguide);
        console.log(
          `     · ${pad(m?.name ?? w.bioguide, 26)} ${pad(m?.party ?? "?", 2)} ${pad(m?.state ?? "", 3)} ${pad(chamber, 6)}` +
            `  streak=${padL(w.streak, 3)}${w.atBound ? "+" : " "}  lastCast=${w.lastCastDate}` +
            `  missed=${padL((m?.missedPct ?? 0).toFixed(1), 5)}%`,
        );
      }
    }

    const ratio = baseB > 0 ? phaseBSum / baseB : Number.POSITIVE_INFINITY;
    console.log("");
    console.log(
      `  POOLED  [${warn},${ABSENCE_STREAK_MIN}) = ${pooledAtRisk}  ·  >=${ABSENCE_STREAK_MIN} = ${pooledMia}  ·  ` +
        `<${warn} = ${pooledBelow}  ·  atBound = ${pooledAtBound}`,
    );
    console.log(
      `  COST    Phase B rows_read = ${phaseBSum}  vs shipped ${baseB}  =  ${ratio.toFixed(2)}x  ` +
        `(gate: <= ${COST_MULTIPLE}x)`,
    );
    console.log(
      `  VERDICT tier size ${pooledAtRisk <= VIABLE_MAX_POOLED ? "PASS" : "FAIL"} (<= ${VIABLE_MAX_POOLED})  ·  ` +
        `cost ${ratio <= COST_MULTIPLE ? "PASS" : "FAIL"} (<= ${COST_MULTIPLE}x)  ·  ` +
        `${pooledAtRisk <= VIABLE_MAX_POOLED && ratio <= COST_MULTIPLE ? "VIABLE" : "NOT VIABLE"}`,
    );
    console.log("");

    verdicts.push({
      warn,
      pooledAtRisk,
      pooledMia,
      pooledBelow,
      pooledAtBound,
      phaseB: phaseBSum,
      ratio,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  console.log("=".repeat(96));
  console.log("SUMMARY");
  console.log("=".repeat(96));
  console.log(`  ${pad("WARN", 6)}${padL("[W,30)", 8)}${padL(">=30", 6)}${padL("atBound", 9)}${padL("PhaseB rows_read", 18)}${padL("vs shipped", 12)}   verdict`);
  for (const v of verdicts) {
    const ok = v.pooledAtRisk <= VIABLE_MAX_POOLED && v.ratio <= COST_MULTIPLE;
    console.log(
      `  ${pad(v.warn, 6)}${padL(v.pooledAtRisk, 8)}${padL(v.pooledMia, 6)}${padL(v.pooledAtBound, 9)}` +
        `${padL(v.phaseB, 18)}${padL(`${v.ratio.toFixed(2)}x`, 12)}   ${ok ? "VIABLE" : "NOT VIABLE"}`,
    );
  }
  const viable = verdicts.filter(
    (v) => v.pooledAtRisk <= VIABLE_MAX_POOLED && v.ratio <= COST_MULTIPLE,
  );
  console.log("");
  if (viable.length === 0) {
    console.log(
      `  NO threshold in {${WARN_SWEEP.join(", ")}} satisfies both criteria. Reported as such;` +
        " the sweep is NOT extended here — the rule shape is the owner's call, and this is",
    );
    console.log(
      "  already tangled with the open S=30 threshold review gated on the House returning from recess.",
    );
  } else {
    console.log(
      `  Viable: ${viable.map((v) => v.warn).join(", ")}  (both criteria met; the pick among them is the owner's call)`,
    );
  }
  // A DEGENERATE PASS IS NOT A PASS, and the criteria as written cannot say so.
  // Both gates are CEILINGS — "<= 6 members" and "<= 2x cost" — so a tier of ZERO
  // clears them by the widest possible margin while telling you the tier would
  // render nothing. That is a different failure from the one the criteria were
  // written to catch (an at-risk tier that outnumbers the MIA tier), and reporting
  // it as a flat VIABLE would be the same-as-success shape at the ruling layer.
  if (verdicts.every((v) => v.pooledAtRisk === 0)) {
    console.log("");
    console.log("  ⚠ DEGENERATE PASS — every threshold's tier is EMPTY.");
    console.log(
      `    The gates are ceilings, so 0 clears them maximally; it does not mean 10/15/20 is a good`,
    );
    console.log(
      `    threshold, it means NO threshold in this range selects anybody today. The M-CONTROL`,
    );
    console.log(
      `    histogram is the reason and it is independent of Phase A: AT THIS CURSOR the streak`,
    );
    console.log(
      `    distribution is bimodal with an empty middle — a large mass at 0, a short tail at 1-4,`,
    );
    console.log(
      `    nothing from 5 to 29, then the ${verdicts[0]?.pooledMia ?? 0} already-MIA members at ${ABSENCE_STREAK_MIN}+.`,
    );
    console.log("");
    // A SNAPSHOT CANNOT GENERALISE, and an earlier draft of this note did: it read
    // "any WARN in 5..29 selects zero", which is a claim about the corpus made from
    // one sample. M-OCCUPANCY replays the same rule across 60 cursors and refutes
    // it. The note keeps its today-reading and defers the durable answer.
    console.log(
      `    DO NOT READ THAT AS "the band is never occupied" — that is a claim about the corpus and`,
    );
    console.log(
      `    this is one sample. M-OCCUPANCY above replays the same rule across ${pooledSeries.length} sampled dates:`,
    );
    console.log(
      `    occupancy median ${pMedian} / p90 ${pP90} / max ${pMax}, ${pooledDistinct.size} distinct members ever in band,` +
        ` verdict ${verdictOcc}.`,
    );
    console.log(
      "    Today's zero is a between-crossings sample, not an empty band.",
    );
  }
  console.log("");
  console.log(
    `  PROBE COST  statements ${stmtCount} · rows_read ${totalRowsRead}  ` +
      "(real per-statement rows_read via hrana /v2/pipeline — no bare COUNT(*) prices anything here)",
  );
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
