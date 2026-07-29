// HO 559 STEP 0 — primaries VOTED-classification reachability + re-poll cycle.
// READ-ONLY. BUILDS NOTHING. Zero writes of any kind (SELECT-only), no schema
// mutation, no cron touch — the write-keyword grep on this file must be empty.
//
// Two backlog premises, both written before HO 333 consolidated Races+Primaries
// onto /electoral, both load-bearing for a build that would otherwise edit
// unreachable code:
//   A — "the card + map bands classify VOTED by results-presence, so they
//        misrender past-but-uningested contests."
//   B — "a slow/mid-count state is never re-polled."
//
//   M1 — static reachability of the primaries-cartogram cluster (no DB).
//   M2 — the past-by-date vs voted-by-results population, re-measured + split.
//   M3 — where the has-roster-no-shares gap actually renders now.
//   M4 — cursor cycle time from cron_runs, measured not estimated.
//   M5 — refresh proof (post-date rewrites) + the SC 2026 special.
//
// Same idiom as the HO 554/557 probes: raw @libsql/client, SELECT only, dotenv,
// npx tsx. M1 walks the source tree (fs), needs no DB; M2–M5 need the CBT .env.
//
//   npx tsx scripts/diagnostic/primaries-voted-classification-559.ts
import "dotenv/config";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { createClient, type Client, type Row } from "@libsql/client";

const ROOT = process.cwd();
function s(row: Row | undefined, k: string): string { return String((row as Row)?.[k] ?? ""); }
function num(row: Row | undefined, k: string): number { return Number((row as Row)?.[k] ?? 0); }

// ── M1 — static reachability (filesystem, no DB) ────────────────────────────
// Walk app/ + components/ + lib/, strip comments, and for each cluster symbol
// enumerate every non-comment reference outside its own defining file. This is
// the reproducible form of the by-hand grep the handoff §1 did — so next
// session re-runs it instead of re-greping.

const SCAN_DIRS = ["app", "components", "lib"];

function walk(dir: string, out: string[]): void {
  let entries: string[];
  try { entries = readdirSync(dir); } catch { return; }
  for (const e of entries) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e)) out.push(p);
  }
}

// Blank out /* */ blocks (preserving newlines so line numbers hold), then strip
// // line comments per line — but NOT a `//` that is part of `://` (URLs).
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
}
function stripLineComment(line: string): string {
  return line.replace(/(^|[^:])\/\/.*$/, "$1");
}

type Ref = { file: string; line: number; text: string };
type Target = { name: string; def: string; re: RegExp };

const TARGETS: Target[] = [
  { name: "buildPrimariesCartogram", def: "lib/cartogram-data.ts", re: /\bbuildPrimariesCartogram\b/ },
  { name: "PrimaryMapCard", def: "components/PrimaryMapCard.tsx", re: /\bPrimaryMapCard\b/ },
  { name: "PrimaryDistrictCard", def: "components/PrimaryDistrictCard.tsx", re: /\bPrimaryDistrictCard\b/ },
  { name: "PrimaryRow", def: "components/PrimaryRow.tsx", re: /\bPrimaryRow\b/ },
  { name: "primariesFill", def: "components/CartogramShell.tsx", re: /\bprimariesFill\b/ },
  { name: "PrimariesLegend", def: "components/CartogramShell.tsx", re: /\bPrimariesLegend\b/ },
  { name: 'CartogramVariant "primaries"', def: "lib/cartogram-data.ts", re: /variant\b[^\n]{0,8}"primaries"/ },
];

function runM1(): void {
  console.log("══ M1 — static reachability of the primaries-cartogram cluster (no DB) ══");
  const files: string[] = [];
  for (const d of SCAN_DIRS) walk(join(ROOT, d), files);
  console.log(`   scanned ${files.length} .ts/.tsx files under ${SCAN_DIRS.join(" / ")}\n`);

  // Precompute cleaned lines per file once.
  const cleaned = new Map<string, string[]>();
  for (const f of files) {
    const raw = readFileSync(f, "utf8");
    cleaned.set(f, stripComments(raw).split("\n").map(stripLineComment));
  }
  const rawLines = new Map<string, string[]>();
  for (const f of files) rawLines.set(f, readFileSync(f, "utf8").split("\n"));

  for (const t of TARGETS) {
    const refs: Ref[] = [];
    for (const f of files) {
      const rel = relative(ROOT, f).replace(/\\/g, "/");
      if (rel === t.def) continue; // exclude the defining file
      const lines = cleaned.get(f)!;
      for (let i = 0; i < lines.length; i++) {
        if (t.re.test(lines[i]!)) {
          refs.push({ file: rel, line: i + 1, text: (rawLines.get(f)![i] ?? "").trim() });
        }
      }
    }
    const verdict = refs.length === 0 ? "ORPHAN" : `LIVE (${refs.length} ref${refs.length === 1 ? "" : "s"})`;
    console.log(`   ${t.name.padEnd(30)} ${verdict}`);
    for (const r of refs) console.log(`        ${r.file}:${r.line}  ${r.text.slice(0, 96)}`);
  }

  // Enumerate every <CartogramShell> call site + its literal variant prop.
  console.log("\n   ── <CartogramShell> call sites (the fork that gates the whole cluster) ──");
  for (const f of files) {
    const rel = relative(ROOT, f).replace(/\\/g, "/");
    const lines = rawLines.get(f)!;
    for (let i = 0; i < lines.length; i++) {
      if (/<CartogramShell\b/.test(lines[i]!)) {
        let variant = "(not found within 15 lines)";
        for (let j = i; j < Math.min(i + 15, lines.length); j++) {
          const m = lines[j]!.match(/variant\s*=\s*(?:\{)?\s*"([a-z]+)"/);
          if (m) { variant = `"${m[1]}"`; break; }
        }
        console.log(`        ${rel}:${i + 1}  variant=${variant}`);
      }
    }
  }
  console.log("");
}

// resultLabel — verbatim mirror of components/RaceRunoffs.tsx:36-41 as shipped
// at 754569f (HEAD this HO). Per the HO 558 pinned-probe-copy convention: this
// is a copy of shipped render logic; the mirrored SHA is named so a reader can
// diff it in one `git log`, and re-running this probe includes reconciling it.
function resultLabel(status: string, votePct: number | null): string {
  const pct = votePct != null ? `${votePct.toFixed(1)}%` : null;
  if (status === "winner") return pct ? `${pct} · won` : "Won";
  if (status === "loser") return pct ? `${pct} · lost` : "Lost";
  return pct ?? "Pending"; // 'running'
}

// seatId derivation — the same shape buildPrimariesCartogram (dead) and the
// /race + member surfaces use: senate → S-{ST}-2026, house → {ST}-{DD}-2026.
function seatIdOf(chamber: string, state: string, district: string | null): string {
  if (chamber === "senate") return `S-${state}-2026`;
  const dd = district != null && district !== "" ? String(district).padStart(2, "0") : "??";
  return `${state}-${dd}-2026`;
}

async function runDb(db: Client): Promise<void> {
  // ── M2 — the population, re-measured ──────────────────────────────────────
  console.log("══ M2 — past-by-date vs voted-by-results (election_round='primary') ══");
  console.log("   baseline (Jun 12): 482 past · 407 voted · 75 gap\n");
  const rows = (await db.execute(`
    SELECT p.id, p.chamber, p.state, p.district, p.party, p.primary_date, p.race_id,
           CAST(julianday('now') - julianday(p.primary_date) AS INTEGER) AS days_since,
           COUNT(pc.id) AS cand_count,
           SUM(CASE WHEN pc.vote_pct IS NOT NULL THEN 1 ELSE 0 END) AS voted_cands
      FROM primaries p
      LEFT JOIN primary_candidates pc ON pc.primary_id = p.id
     WHERE p.election_round = 'primary' AND p.primary_date < date('now')
     GROUP BY p.id
  `)).rows;

  const past = rows.length;
  const voted = rows.filter((r) => num(r, "voted_cands") > 0);
  const gap = rows.filter((r) => num(r, "voted_cands") === 0);
  const zeroCand = gap.filter((r) => num(r, "cand_count") === 0);
  const hasRosterNoShares = gap.filter((r) => num(r, "cand_count") > 0);
  console.log(`   past-by-date=${past} · voted-by-results=${voted.length} · GAP=${gap.length}`);
  console.log(`   gap split: zero-candidate (roster never populated)=${zeroCand.length} · has-roster-no-shares=${hasRosterNoShares.length}`);

  const byChamber = (set: Row[], ch: string) => set.filter((r) => s(r, "chamber") === ch).length;
  console.log(`   GAP by chamber: senate=${byChamber(gap, "senate")} · house=${byChamber(gap, "house")}`);
  console.log(`   has-roster-no-shares by chamber: senate=${byChamber(hasRosterNoShares, "senate")} · house=${byChamber(hasRosterNoShares, "house")}`);

  const bucket = (d: number) => (d <= 14 ? "0-14" : d <= 42 ? "15-42" : d <= 90 ? "43-90" : "90+");
  const buckets: Record<string, number> = { "0-14": 0, "15-42": 0, "43-90": 0, "90+": 0 };
  for (const r of gap) buckets[bucket(num(r, "days_since"))]!++;
  console.log(`   GAP by days-since: 0-14=${buckets["0-14"]} · 15-42=${buckets["15-42"]} · 43-90=${buckets["43-90"]} · 90+=${buckets["90+"]}`);
  const hrBuckets: Record<string, number> = { "0-14": 0, "15-42": 0, "43-90": 0, "90+": 0 };
  for (const r of hasRosterNoShares) hrBuckets[bucket(num(r, "days_since"))]!++;
  console.log(`   has-roster-no-shares by days-since: 0-14=${hrBuckets["0-14"]} · 15-42=${hrBuckets["15-42"]} · 43-90=${hrBuckets["43-90"]} · 90+=${hrBuckets["90+"]}`);
  // Truncation note (do NOT change getPastPrimaries — §4.6): flag if past > 200.
  console.log(`   NOTE getPastPrimaries limit=200 → ${past > 200 ? `past ${past} EXCEEDS it (${past - 200} truncated from the /primaries Past list)` : `past ${past} within it`}`);
  console.log("");

  // ── M3 — where the has-roster-no-shares gap renders now ───────────────────
  console.log("══ M3 — the 10 largest-days-since has-roster-no-shares rows: surfaces + resultLabel ══");
  console.log("   Surface reality at HEAD (measured, corrects the §1 M3 sketch):");
  console.log("     · /race/[id] renders RaceRunoffs, fed by getRunoffsForRace = election_round='runoff' ONLY");
  console.log("       → an election_round='primary' row NEVER reaches resultLabel there.");
  console.log("     · getPrimaryForRace is used on the MEMBER page (senate, district=null) and renders a");
  console.log("       date-only chip ('Primary Dem: <date>') — no results-presence branch.");
  console.log("     · The live results-presence classifier is PrimaryTimeline (c.date <= todayISO, date-driven).");
  console.log("   resultLabel(status, null) below is the hypothetical /race value IF such a row were a runoff.\n");
  const top10 = [...hasRosterNoShares]
    .sort((a, b) => num(b, "days_since") - num(a, "days_since"))
    .slice(0, 10);
  for (const r of top10) {
    const id = s(r, "id");
    const seatId = seatIdOf(s(r, "chamber"), s(r, "state"), s(r, "district") || null);
    const cands = (await db.execute({
      sql: `SELECT status, COUNT(*) AS c FROM primary_candidates WHERE primary_id = ? GROUP BY status`,
      args: [id],
    })).rows;
    const statusDist = cands.map((c) => `${s(c, "status")}×${num(c, "c")}`).join(", ");
    const labels = [...new Set(cands.map((c) => resultLabel(s(c, "status"), null)))].join(" / ");
    console.log(`   ${seatId.padEnd(14)} ${s(r, "primary_date")} · ${num(r, "days_since")}d ago · ${num(r, "cand_count")} cand`);
    console.log(`        id=${id} · status: ${statusDist} · resultLabel(·, null) → ${labels}`);
  }
  console.log("");

  // ── M4 — cursor cycle time, measured not estimated ────────────────────────
  console.log("══ M4 — cron cursor cycle time (last 45 /api/cron/primaries runs) ══");
  const SENATE_UNITS = 35; // SENATE_STATES_2026.length (source, lib/primaries-sync.ts:44)
  const cronRows = (await db.execute(`
    SELECT id, started_at, elapsed_ms, status, payload
      FROM cron_runs WHERE route = '/api/cron/primaries'
     ORDER BY started_at DESC LIMIT 45
  `)).rows;
  console.log(`   rows read: ${cronRows.length}`);
  if (cronRows.length === 0) {
    console.log("   (no /api/cron/primaries rows — cycle unmeasurable from cron_runs)");
  } else {
    let totalUnits = 0;
    const advances: number[] = [];
    let budgetStops = 0, wraps = 0, suspicious = 0;
    const perUnitKind: Record<string, number> = {};
    console.log("   ── per tick (newest first) ──");
    for (const cr of cronRows) {
      // cron_runs.payload wraps the PrimariesCronResult under an outer
      // {ok, elapsedMs, payload:{…}} envelope (wrapCronRoute) — unwrap it.
      let outer: Record<string, unknown> = {};
      try { outer = JSON.parse(s(cr, "payload") || "{}"); } catch { /* keep {} */ }
      const p = (outer.payload && typeof outer.payload === "object"
        ? outer.payload : outer) as Record<string, unknown>;
      const tu = Number(p.totalUnits ?? 0);
      if (tu > totalUnits) totalUnits = tu;
      const cs = Number(p.cursorStart ?? NaN);
      const ce = Number(p.cursorEnd ?? NaN);
      const unit = String(p.unit ?? "?");
      perUnitKind[unit] = (perUnitKind[unit] ?? 0) + 1;
      const bstop = p.budgetStopped === true;
      if (bstop) budgetStops++;
      const ff = Array.isArray(p.fetchFailures) ? p.fetchFailures.length : 0;
      // advance = forward distance cursorStart→cursorEnd, wrap-aware.
      let adv = Number.NaN;
      let flag = "";
      if (Number.isFinite(cs) && Number.isFinite(ce) && tu > 0) {
        adv = ce >= cs ? ce - cs : tu - cs + ce;
        advances.push(adv);
        if (ce < cs) {
          // ce<cs is a boundary WRAP if the start was within a full slice of the
          // end of the list; otherwise a genuine backward move worth flagging.
          if (cs >= tu - 20) { wraps++; flag = " WRAP"; }
          else { suspicious++; flag = " ⚠REGRESSION"; }
        }
      }
      console.log(`   #${s(cr, "id")} ${s(cr, "started_at").slice(0, 16)} ${unit.padEnd(8)} cur ${cs}→${ce} (Δ${Number.isFinite(adv) ? adv : "?"})${flag} budgetStop=${bstop} ff=${ff} ${num(cr, "elapsed_ms")}ms ${s(cr, "status")}`);
    }
    const houseUnits = totalUnits > 0 ? totalUnits - 1 - SENATE_UNITS : 0;
    console.log(`\n   buildScrapeUnits().length (from payload.totalUnits) = ${totalUnits}`);
    console.log(`   split: calendar=1 · senate=${SENATE_UNITS} · house=${houseUnits}`);
    const sum = advances.reduce((a, b) => a + b, 0);
    const mean = advances.length ? sum / advances.length : 0;
    const sorted = [...advances].sort((a, b) => a - b);
    const p50 = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : 0;
    console.log(`   units advanced/tick: mean=${mean.toFixed(2)} · p50=${p50} · (n=${advances.length} ticks with cursor data)`);
    console.log(`   budget-stop rate: ${budgetStops}/${cronRows.length} · boundary wraps observed: ${wraps} · suspicious regressions: ${suspicious}`);
    console.log(`   unit-kind mix: ${Object.entries(perUnitKind).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
    if (mean > 0 && totalUnits > 0) {
      const ticksPerCycle = totalUnits / mean;
      console.log(`   OBSERVED days per full cycle @ daily cadence ≈ ${ticksPerCycle.toFixed(1)} days (totalUnits/mean-advance)`);
      console.log(`   vs the item's ~6-week (42-day) ask: ${ticksPerCycle <= 42 ? "INSIDE" : "OUTSIDE"} the window`);
    }
  }
  console.log("");

  // ── M5(a) — refresh proof: post-date rewrites of resulted contests ────────
  console.log("══ M5(a) — do resulted contests get re-polled? MAX(updated_at) − primary_date ══");
  const resulted = (await db.execute(`
    SELECT p.id, p.primary_date,
           MAX(pc.updated_at) AS max_upd,
           COUNT(pc.id) AS cand_count
      FROM primaries p
      JOIN primary_candidates pc ON pc.primary_id = p.id
     WHERE p.election_round = 'primary' AND p.primary_date < date('now')
       AND pc.vote_pct IS NOT NULL
     GROUP BY p.id
  `)).rows;
  const dayDelta = (maxUpd: string, date: string): number | null => {
    if (!maxUpd || !date) return null;
    const a = Date.parse(maxUpd), b = Date.parse(`${date}T00:00:00Z`);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    return Math.floor((a - b) / 86_400_000);
  };
  const deltas = resulted.map((r) => dayDelta(s(r, "max_upd"), s(r, "primary_date"))).filter((d): d is number => d != null);
  const dBuckets: Record<string, number> = { "≤0 (never rewritten past date)": 0, "1-7": 0, "8-30": 0, "31-90": 0, "90+": 0 };
  for (const d of deltas) {
    if (d <= 0) dBuckets["≤0 (never rewritten past date)"]!++;
    else if (d <= 7) dBuckets["1-7"]!++;
    else if (d <= 30) dBuckets["8-30"]!++;
    else if (d <= 90) dBuckets["31-90"]!++;
    else dBuckets["90+"]!++;
  }
  console.log(`   resulted contests: ${resulted.length}`);
  console.log(`   days from primary_date → last row rewrite (MAX updated_at):`);
  for (const [k, v] of Object.entries(dBuckets)) console.log(`        ${k.padEnd(34)} ${v}`);
  const postDate = deltas.filter((d) => d > 0).length;
  console.log(`   post-date rewrites (delta>0, proves a re-poll landed AFTER election day): ${postDate}/${deltas.length}`);
  console.log(`   NOTE: delete-rebuild overwrites every row's updated_at, so "rewritten >once" is not`);
  console.log(`   distinguishable from a single timestamp — the post-date-delta distribution IS the`);
  console.log(`   falsifiable signal (all-recent = re-polled every cycle; all ≈0 = frozen at first landing).`);
  console.log("");

  // ── M5(b) — the SC 2026 senate special (HO 520 parked) ────────────────────
  console.log("══ M5(b) — SC 2026 senate rows: is the Aug 11 special present, or still the June 9 regular? ══");
  const sc = (await db.execute(`
    SELECT p.id, p.primary_date, p.runoff_date, p.election_round, p.party, p.chamber, p.district,
           COUNT(pc.id) AS cand_count,
           SUM(CASE WHEN pc.vote_pct IS NOT NULL THEN 1 ELSE 0 END) AS voted_cands
      FROM primaries p
      LEFT JOIN primary_candidates pc ON pc.primary_id = p.id
     WHERE p.state = 'SC'
     GROUP BY p.id
     ORDER BY p.chamber, p.primary_date, p.party
  `)).rows;
  if (sc.length === 0) {
    console.log("   (no SC rows at all)");
  } else {
    for (const r of sc) {
      console.log(`   ${s(r, "id").padEnd(26)} ${s(r, "chamber")}${s(r, "district") ? "-" + s(r, "district") : ""} ${s(r, "party")} · date=${s(r, "primary_date")} runoff=${s(r, "runoff_date") || "—"} round=${s(r, "election_round")} · ${num(r, "cand_count")} cand (${num(r, "voted_cands")} voted)`);
    }
    const senateRows = sc.filter((r) => s(r, "chamber") === "senate");
    const hasAug = senateRows.some((r) => s(r, "primary_date") >= "2026-08-01");
    const hasJune = senateRows.some((r) => s(r, "primary_date").startsWith("2026-06"));
    console.log(`   → SC senate: Aug-special present=${hasAug} · June-regular present=${hasJune}` +
      (hasAug ? "" : " ⚠ the Aug 11 special is NOT represented (HO 520 parked stands)"));
  }
  console.log("");
}

async function main(): Promise<number> {
  runM1(); // filesystem only — always runs

  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    console.log("TURSO_DATABASE_URL not set — M2–M5 need the CBT .env (local working tree). M1 above is complete.");
    return 1;
  }
  const db: Client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  await runDb(db);
  console.log("══ done — read-only, no writes ══");
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
