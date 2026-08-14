// HO 642 continuation P1 — rated-seat roster coverage. Read-only. BUILDS NOTHING.
//
// THE QUESTION. `race_candidates` for S-MI-2026 is empty and the card renders
// `no challenger filed` — a POSITIVE CLAIM — while Kalshi, Polymarket and the PAC
// line on the same card all name people. Before anything is fixed, measure how many
// rated seats are in that state: a one-seat staleness and a sixty-seat class have
// different fixes, and the fix cannot be chosen from an exhibit.
//
// THE DISTINCTION THE RENDER CANNOT MAKE, which is what M4 sizes. `ChallengerShape`
// collapses two different facts into `{ kind: "empty" }`:
//   (a) roster PRESENT, nobody active  → "no challenger filed" is TRUE
//   (b) roster ABSENT (0 rows)          → nothing is known, and the card asserts a
//                                          negative it has no evidence for
// Same pixels, opposite epistemics. This probe counts each.
//
// WHY RAW HTTP AND NOT @libsql/client: v0.14.0 does not surface per-statement
// `rows_read`; Turso's hrana /v2/pipeline does. Harness lifted verbatim from
// absence-atrisk-642.ts / absence-card-cost-630.ts — same DB, read-only.
//
// THE INSTRUMENT'S TRAP: a BARE `COUNT(*)` is answered from B-tree interior pages
// and under-reports scan cost by 227-416x (HO 624 M0). Every count below is either
// predicated or derived in JS from rows actually returned — nothing here is sized
// by a bare count.
//
// SQL COPIED VERBATIM, AND FROM WHERE (reconcile before trusting a re-run — a
// verbatim copy is a dependency with no compiler edge, HO 554 -> 557):
//   · the rated-set predicate      lib/queries.ts::getRacesIndex (INNER JOIN
//                                  race_ratings ON race_id AND cycle, WHERE cycle=?)
//   · the harvest join             lib/harvest-challengers.ts HARVEST_FROM_WHERE,
//                                  at 23fa9fa. RECONCILED HO 663: HO 660 moved the
//                                  harvest out of scripts/backfill-race-challengers.ts
//                                  (which now only wraps it), so the old pointer
//                                  dangled. The SQL itself is UNCHANGED — HO 660's
//                                  byte-identical claim verified term-by-term, not
//                                  inherited. The NOT EXISTS curated-roster guard is
//                                  still deliberately dropped here (see M2).
//   · the withdrawn-status set     lib/race-matchup.ts WITHDRAWN
//   · the active-challenger filter lib/race-matchup.ts activeChallengers
//   · the kalshi close-time gate   lib/race-colors.ts kalshiActive
//
//   npx tsx scripts/diagnostic/roster-coverage-642.ts
import "dotenv/config";

const CYCLE = 2026;
const HARVEST_SOURCE = "harvest:primary_winner";
// lib/race-matchup.ts WITHDRAWN, verbatim.
const WITHDRAWN = new Set(["withdrew", "withdrawn", "lost", "loser", "eliminated"]);

type Exec = { rows: unknown[][]; cols: string[]; rowsRead: number; ms: number };
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
      `query failed: ${JSON.stringify(r?.error ?? r).slice(0, 400)}\n  sql: ${sql.slice(0, 240)}`,
    );
  }
  const q = r.response.result as {
    cols: { name: string }[];
    rows: { value: unknown }[][];
    rows_read: number;
    query_duration_ms: number;
  };
  stmtCount++;
  totalRowsRead += q.rows_read;
  return {
    cols: q.cols.map((c) => c.name),
    rows: q.rows.map((row) => row.map((c) => c?.value)),
    rowsRead: q.rows_read,
    ms: q.query_duration_ms,
  };
}

// column-name access, so a SELECT reorder can't silently shift a field
function obj(e: Exec): Record<string, unknown>[] {
  return e.rows.map((r) => {
    const o: Record<string, unknown> = {};
    e.cols.forEach((c, i) => {
      o[c] = r[i];
    });
    return o;
  });
}
const S = (v: unknown): string => (v === null || v === undefined ? "" : String(v));
const N = (v: unknown): number => Number(v ?? 0);
const pad = (v: string | number, w: number): string => String(v).padEnd(w);
const padL = (v: string | number, w: number): string => String(v).padStart(w);
function list(ids: string[], perLine = 6): void {
  for (let i = 0; i < ids.length; i += perLine) {
    console.log(`        ${ids.slice(i, i + perLine).map((x) => pad(x, 14)).join(" ")}`);
  }
}

async function main(): Promise<number> {
  const raw = process.env.TURSO_DATABASE_URL ?? "";
  token = process.env.TURSO_AUTH_TOKEN ?? "";
  if (!raw || !token) {
    console.log("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN required — run with the CBT .env.");
    return 1;
  }
  httpUrl = raw.replace(/^libsql:/, "https:");

  console.log("=".repeat(100));
  console.log("HO 642 P1 — rated-seat roster coverage + the empty-roster render class (read-only)");
  console.log("=".repeat(100));
  console.log("");

  // ── the rated set — getRacesIndex's predicate, verbatim ────────────────────
  const ratedE = await exec(
    `SELECT r.id AS id, r.chamber AS chamber, r.state AS state, r.district AS district,
            r.incumbent_bioguide_id AS inc,
            ko.favorite_label AS ko_label, ko.favorite_is_party AS ko_is_party,
            ko.close_time AS ko_close,
            pm.favorite_label AS pm_label, pm.favorite_is_party AS pm_is_party
       FROM races r
       INNER JOIN race_ratings rr ON rr.race_id = r.id AND rr.cycle = r.cycle
       LEFT JOIN kalshi_odds ko ON ko.race_id = r.id
       LEFT JOIN polymarket_odds pm ON pm.race_id = r.id
      WHERE r.cycle = ?
      GROUP BY r.id`,
    [CYCLE],
  );
  const rated = obj(ratedE);
  console.log(
    `M0  rated set: ${rated.length} seats (getRacesIndex(${CYCLE}) predicate)  rows_read ${ratedE.rowsRead} · ${ratedE.ms}ms`,
  );

  // ── every race_candidates row for those seats ──────────────────────────────
  const rcE = await exec(
    `SELECT rc.race_id AS race_id, rc.name AS name, rc.party AS party,
            rc.bioguide_id AS bioguide_id, rc.status AS status, rc.source_url AS source_url
       FROM race_candidates rc
       INNER JOIN races r ON r.id = rc.race_id AND r.cycle = ?
      WHERE EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = r.cycle)`,
    [CYCLE],
  );
  const rcRows = obj(rcE);
  const byRace = new Map<string, Record<string, unknown>[]>();
  for (const r of rcRows) {
    const id = S(r.race_id);
    const a = byRace.get(id) ?? [];
    a.push(r);
    byRace.set(id, a);
  }
  console.log(
    `M0  race_candidates rows on rated seats: ${rcRows.length} across ${byRace.size} seats  rows_read ${rcE.rowsRead} · ${rcE.ms}ms`,
  );
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // M1 — coverage across the rated set
  // ══════════════════════════════════════════════════════════════════════════
  console.log("#".repeat(100));
  console.log("# M1 — race_candidates coverage across the rated set");
  console.log("#".repeat(100));
  const zero: string[] = [];
  const one: string[] = [];
  const many: string[] = [];
  for (const r of rated) {
    const id = S(r.id);
    const n = byRace.get(id)?.length ?? 0;
    if (n === 0) zero.push(id);
    else if (n === 1) one.push(id);
    else many.push(id);
  }
  console.log(`  0 rows : ${padL(zero.length, 4)}   (${((zero.length / rated.length) * 100).toFixed(1)}% of the rated set)`);
  console.log(`  1 row  : ${padL(one.length, 4)}`);
  console.log(`  2+ rows: ${padL(many.length, 4)}`);
  console.log("");
  console.log(`  ── the 0-row bucket, in full (${zero.length}) ──`);
  list(zero.sort());
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // M2 — which 0-row seats are DERIVABLE by the shipped harvest
  //
  // Uses backfill-race-challengers.ts's HARVEST_FROM_WHERE join verbatim, so
  // "derivable" means exactly "the shipped script would insert a row here", not a
  // looser paraphrase. The NOT EXISTS hand-curated guard is dropped because we are
  // scoping to seats with ZERO rows, where it is vacuously true.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("#".repeat(100));
  console.log("# M2 — of the 0-row seats, which would the shipped harvest fill?");
  console.log("#".repeat(100));
  const harvestE = await exec(
    `SELECT DISTINCT r.id AS race_id, pc.name AS name, pc.party AS party, p.id AS primary_id
       FROM races r
       JOIN primaries p
         ON p.state = r.state AND p.chamber = r.chamber
        AND ( r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district )
       JOIN primary_candidates pc ON pc.primary_id = p.id AND pc.status = 'winner'
      WHERE r.cycle = ?
        AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = ?)
        AND ( pc.bioguide_id IS NULL OR pc.bioguide_id <> r.incumbent_bioguide_id )`,
    [CYCLE, CYCLE],
  );
  const harvestable = new Map<string, string[]>();
  for (const h of obj(harvestE)) {
    const id = S(h.race_id);
    const a = harvestable.get(id) ?? [];
    a.push(`${S(h.name)}${h.party ? ` (${S(h.party)})` : ""}`);
    harvestable.set(id, a);
  }
  const derivable = zero.filter((id) => harvestable.has(id));
  const underivable = zero.filter((id) => !harvestable.has(id));
  console.log(
    `  DERIVABLE   ${padL(derivable.length, 4)}  — a status='winner' row exists; the harvest simply has not reached it`,
  );
  console.log(
    `  UNDERIVABLE ${padL(underivable.length, 4)}  — no winner recorded; the harvest is INERT here (the HO 638 ME shape)`,
  );
  console.log("");
  console.log(`  ── derivable (${derivable.length}) ──`);
  for (const id of derivable.sort()) {
    console.log(`     ${pad(id, 14)} would gain: ${(harvestable.get(id) ?? []).join(" · ")}`);
  }
  console.log("");
  console.log(`  ── underivable (${underivable.length}) ──`);
  list(underivable.sort());
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // M3 — the detector's live exhibit count
  //
  // A "contradicting element" = something on the SAME card that names a PERSON
  // while the roster names nobody. Party-labelled markets ("Dem") do not count —
  // they name no one, so they cannot contradict an empty roster. The kalshi
  // close-time gate is applied (a closed market renders nothing on the card).
  // ══════════════════════════════════════════════════════════════════════════
  console.log("#".repeat(100));
  console.log("# M3 — 0-row seats whose card ALSO names a person (the HO 639 detector's population)");
  console.log("#".repeat(100));
  const pacE = await exec(
    `SELECT race_id, candidate_name, support_oppose FROM pac_ie_spending WHERE cycle = ?`,
    [CYCLE],
  );
  const pacByRace = new Map<string, string[]>();
  for (const p of obj(pacE)) {
    const id = S(p.race_id);
    const a = pacByRace.get(id) ?? [];
    a.push(`${S(p.support_oppose) === "S" ? "backing" : "opposing"} ${S(p.candidate_name)}`);
    pacByRace.set(id, a);
  }
  const now = Date.now();
  let exhibits = 0;
  const exhibitLines: string[] = [];
  for (const id of zero) {
    const r = rated.find((x) => S(x.id) === id);
    if (!r) continue;
    // lib/race-colors.ts kalshiActive, verbatim: a past close_time is inactive.
    const koOpen = !r.ko_close || Date.parse(S(r.ko_close)) >= now;
    const names: string[] = [];
    if (koOpen && N(r.ko_is_party) === 0 && S(r.ko_label)) names.push(`KALSHI ${S(r.ko_label)}`);
    if (N(r.pm_is_party) === 0 && S(r.pm_label)) names.push(`POLY ${S(r.pm_label)}`);
    for (const p of pacByRace.get(id) ?? []) names.push(`PAC ${p}`);
    if (names.length > 0) {
      exhibits++;
      exhibitLines.push(`     ${pad(id, 14)} roster names NOBODY, card names: ${names.join(" · ")}`);
    }
  }
  console.log(
    `  seats where the roster is empty AND at least one card element names a person: ${exhibits}` +
      ` (of ${zero.length} 0-row seats)`,
  );
  console.log("");
  for (const l of exhibitLines) console.log(l);
  console.log("");
  console.log(
    `  → this is the population an HO 639-style contradiction detector would fire on. ${exhibits} is the` +
      " number that decides whether it is worth building.",
  );
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // M4 — the conflation, sized
  //
  // Replays lib/race-matchup.ts::activeChallengers to find every rated seat that
  // reaches `challenger.kind === "empty"`, then splits it on whether the roster
  // was PRESENT (a true "no challenger filed") or ABSENT (an unknown rendered as
  // a finding). Same pixels today; opposite meanings.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("#".repeat(100));
  console.log("# M4 — seats rendering `no challenger filed`, split by whether anything is actually known");
  console.log("#".repeat(100));
  const trueEmpty: string[] = [];
  const unknownEmpty: string[] = [];
  const nonEmptyShape: string[] = [];
  for (const r of rated) {
    const id = S(r.id);
    const inc = S(r.inc);
    const cands = byRace.get(id) ?? [];
    const active = cands.filter(
      (c) =>
        !!S(c.name) &&
        !(S(c.bioguide_id) && S(c.bioguide_id) === inc) &&
        !(S(c.status) && WITHDRAWN.has(S(c.status).toLowerCase())),
    );
    if (active.length > 0) {
      nonEmptyShape.push(id);
      continue;
    }
    if (cands.length > 0) trueEmpty.push(id);
    else unknownEmpty.push(id);
  }
  console.log(`  renders a challenger (kind != "empty")            : ${padL(nonEmptyShape.length, 4)}`);
  console.log(`  kind == "empty", roster PRESENT  → claim is TRUE  : ${padL(trueEmpty.length, 4)}`);
  console.log(`  kind == "empty", roster ABSENT   → UNKNOWN as fact: ${padL(unknownEmpty.length, 4)}`);
  console.log("");
  if (trueEmpty.length > 0) {
    console.log(`  ── roster present, nobody active (a real "no challenger filed") ──`);
    for (const id of trueEmpty.sort()) {
      const cands = byRace.get(id) ?? [];
      console.log(
        `     ${pad(id, 14)} ${cands.length} row(s): ${cands
          .map((c) => `${S(c.name)}[${S(c.status) || "—"}]`)
          .join(" · ")}`,
      );
    }
    console.log("");
  }
  console.log(
    `  → ${unknownEmpty.length} of the ${trueEmpty.length + unknownEmpty.length} seats reaching kind=="empty" have NO evidence for the claim.`,
  );
  if (trueEmpty.length === 0) {
    console.log(
      `    NOTE the shape of that: the TRUE-empty branch has ZERO members. "no challenger filed" has`,
    );
    console.log(
      "    never once meant what it says. This is not a mixed population needing disambiguation —",
    );
    console.log("    every instance is on the wrong side.");
  }
  console.log("");

  // ── SCOPE, so the count above cannot be over-read ──────────────────────────
  // `no challenger filed` lives in components/RaceCard.tsx, and RaceCard is
  // rendered ONLY by CompetitiveRacesStrip variant="v2" — i.e. the dashboard's
  // FEATURED seats, currently 6 (PER_CHAMBER=3). /electoral renders the same
  // underlying state through components/RaceMapCard.tsx, whose string is
  // "Challenger field not yet available" — an ABSENCE, already correctly hedged.
  // So M4's figure is the rated-set POPULATION that would render the claim if
  // featured, NOT a count of cards currently on screen. The two surfaces already
  // disagree in wording, and the one that hedges correctly is the one nobody
  // flagged.
  console.log("  ── scope of the claim (the string is not on every card) ──");
  console.log('     `no challenger filed` is components/RaceCard.tsx only, and RaceCard is rendered');
  console.log("     ONLY by CompetitiveRacesStrip variant=\"v2\" — the dashboard's featured seats.");
  console.log('     /electoral renders the same state via RaceMapCard as "Challenger field not yet');
  console.log('     available" — an absence, correctly hedged. The two surfaces already disagree.');
  console.log("");
  // Featured ids read off the live render at 3de13e6; the set is DYNAMIC (top
  // PER_CHAMBER by competitiveness per chamber), so this is a snapshot, not a key.
  const FEATURED_AT_3DE13E6 = [
    "S-GA-2026",
    "S-ME-2026",
    "S-MI-2026",
    "IA-03-2026",
    "PA-08-2026",
    "PA-10-2026",
  ];
  let featuredEmpty = 0;
  console.log("     featured seats at 3de13e6 (read off the live render; the set is dynamic):");
  for (const id of FEATURED_AT_3DE13E6) {
    const n = byRace.get(id)?.length ?? 0;
    if (n === 0) featuredEmpty++;
    console.log(`       ${pad(id, 14)} race_candidates rows: ${n}${n === 0 ? "   ← renders the unevidenced claim" : ""}`);
  }
  console.log(
    `     → ON SCREEN TODAY: ${featuredEmpty} of ${FEATURED_AT_3DE13E6.length} featured cards print it. The ${unknownEmpty.length} is the`,
  );
  console.log("       population at risk, and it is what the number means.");
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // M5 — freshness
  //
  // RECONCILED HO 663 — THE PREMISE OF THIS SECTION EXPIRED. At HO 642 the comment
  // here read "race_candidates HAS NO TIMESTAMP COLUMN", which is why the freshness
  // question had to be answered behaviourally. HO 659 ADDED `race_candidates.
  // updated_at` (migrate.ts ensureColumn) precisely to close that gap — it is the
  // per-run reach stamp both harvest callers bind. The old claim is now FALSE and is
  // printed below as the correction rather than deleted, so a re-run cannot repeat it.
  //
  // The BEHAVIOURAL bracket is kept, because it measures a different thing and still
  // does: the stamp says WHEN a run touched a row, the bracket says HOW FAR the
  // harvest's derivation reaches. A run that fires on schedule and derives nothing
  // new stamps fresh and reaches no further. Both readings are wanted.
  // The stamp census itself lives in scripts/diagnostic/race-candidates-stamp-659.ts.
  // ══════════════════════════════════════════════════════════════════════════
  console.log("#".repeat(100));
  console.log("# M5 — freshness (stamp + behavioural reach)");
  console.log("#".repeat(100));
  console.log("  race_candidates.updated_at EXISTS (HO 659) — the HO 642 'no timestamp column' note is");
  console.log("  corrected. Stamp census below, then the behavioural reach bracket (a different reading:");
  console.log("  the stamp is when a run touched a row, the bracket is how far its derivation gets).");
  console.log("");
  const stampE = await exec(
    `SELECT updated_at AS u, COUNT(*) AS rows, COUNT(DISTINCT race_id) AS races
       FROM race_candidates WHERE source_url = ?
      GROUP BY updated_at ORDER BY updated_at DESC`,
    [HARVEST_SOURCE],
  );
  const stamps = obj(stampE);
  console.log(`  distinct sentinel updated_at stamps: ${stamps.length}`);
  for (const s of stamps) {
    console.log(
      `     ${pad(S(s.u) || "(NULL — pre-instrumentation)", 30)} ${padL(N(s.rows), 4)} rows / ${padL(N(s.races), 3)} seats`,
    );
  }
  console.log("");
  const sentinelE = await exec(
    `SELECT COUNT(*) AS rows, COUNT(DISTINCT race_id) AS races
       FROM race_candidates WHERE source_url = ?`,
    [HARVEST_SOURCE],
  );
  const sent = obj(sentinelE)[0] ?? {};
  console.log(`  sentinel rows (source_url = '${HARVEST_SOURCE}'): ${N(sent.rows)} across ${N(sent.races)} seats`);

  const reachedE = await exec(
    `SELECT MAX(p.primary_date) AS d
       FROM race_candidates rc
       JOIN races r ON r.id = rc.race_id
       JOIN primaries p ON p.state = r.state AND p.chamber = r.chamber
        AND ( r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district )
       JOIN primary_candidates pc ON pc.primary_id = p.id AND pc.status = 'winner'
      WHERE rc.source_url = ? AND p.primary_date IS NOT NULL`,
    [HARVEST_SOURCE],
  );
  const couldE = await exec(
    `SELECT MAX(p.primary_date) AS d
       FROM races r
       JOIN primaries p ON p.state = r.state AND p.chamber = r.chamber
        AND ( r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district )
       JOIN primary_candidates pc ON pc.primary_id = p.id AND pc.status = 'winner'
      WHERE r.cycle = ?
        AND EXISTS (SELECT 1 FROM race_ratings rr WHERE rr.race_id = r.id AND rr.cycle = ?)
        AND p.primary_date IS NOT NULL`,
    [CYCLE, CYCLE],
  );
  const reached = S(obj(reachedE)[0]?.d);
  const could = S(obj(couldE)[0]?.d);
  console.log(`  newest primary date the harvest HAS reached : ${reached || "(none)"}`);
  console.log(`  newest primary date with a winner it COULD  : ${could || "(none)"}`);
  const pcE = await exec(
    `SELECT MAX(pc.updated_at) AS mx
       FROM primary_candidates pc JOIN primaries p ON p.id = pc.primary_id
      WHERE pc.vote_pct IS NOT NULL AND p.primary_date IS NOT NULL
        AND p.primary_date <= date('now')`,
  );
  console.log(`  newest primary_candidates.updated_at (resulted 2026 contest): ${S(obj(pcE)[0]?.mx) || "(none)"}`);
  console.log("");
  if (reached && could && reached < could) {
    console.log(
      `  → the harvest's reach STOPS at ${reached} while winners exist through ${could}. It has NOT run`,
    );
    console.log(
      "    since the later contests resolved. The inference is now TESTED, not assumed — and it is",
    );
    console.log("    tested on behaviour, which a timestamp column could not have improved on.");
  } else if (reached && could) {
    console.log(
      `  → the harvest's reach (${reached}) MATCHES the newest available winner (${could}), so staleness`,
    );
    console.log("    does NOT explain the 0-row seats. The inference in the HO 642 report is KILLED.");
  }
  console.log("");

  // ══════════════════════════════════════════════════════════════════════════
  // The two seats commit B newly featured
  // ══════════════════════════════════════════════════════════════════════════
  console.log("#".repeat(100));
  console.log("# The featured seats — S-MI-2026 (the exhibit) and PA-10-2026 (nobody has looked)");
  console.log("#".repeat(100));
  for (const id of ["S-MI-2026", "PA-10-2026"]) {
    const r = rated.find((x) => S(x.id) === id);
    const cands = byRace.get(id) ?? [];
    const inc = S(r?.inc);
    const active = cands.filter(
      (c) =>
        !!S(c.name) &&
        !(S(c.bioguide_id) && S(c.bioguide_id) === inc) &&
        !(S(c.status) && WITHDRAWN.has(S(c.status).toLowerCase())),
    );
    const shape =
      active.length === 0
        ? cands.length === 0
          ? 'empty (roster ABSENT — unknown rendered as "no challenger filed")'
          : 'empty (roster present, nobody active — the claim is true)'
        : active.length === 1
          ? `nominee/leader → ${S(active[0]?.name)}`
          : `${active.length} active → leader or nolead`;
    console.log(`  ${pad(id, 14)} race_candidates rows: ${cands.length}   → challenger shape: ${shape}`);
    for (const c of cands) {
      console.log(`       · ${pad(S(c.name), 26)} ${pad(S(c.party) || "?", 2)} status=${pad(S(c.status) || "—", 12)} src=${S(c.source_url) || "—"}`);
    }
    if (harvestable.has(id)) {
      console.log(`       harvest WOULD add: ${(harvestable.get(id) ?? []).join(" · ")}`);
    }
  }
  console.log("");

  console.log("=".repeat(100));
  console.log("SUMMARY");
  console.log("=".repeat(100));
  console.log(`  rated seats ${rated.length}  ·  0-row ${zero.length} (${derivable.length} derivable / ${underivable.length} underivable)`);
  console.log(
    `  seats reaching kind=="empty": ${trueEmpty.length + unknownEmpty.length}` +
      `  (${trueEmpty.length} true · ${unknownEmpty.length} unknown-as-fact) — ${featuredEmpty} of them featured today`,
  );
  console.log(`  contradiction exhibits (roster silent, card names someone): ${exhibits}`);
  console.log(`  PROBE COST  statements ${stmtCount} · rows_read ${totalRowsRead}`);
  console.log("");
  console.log("  Numbers only. Nothing run, nothing edited — the fix shape is recorded in the handoff,");
  console.log("  not authorised here, and takes a number from the sweep that writes 642's block.");
  return 0;
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
