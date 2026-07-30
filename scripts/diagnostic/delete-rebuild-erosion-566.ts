// HO 566 STEP 0 — the delete-rebuild erosion class across the roster + roll-call
// syncs. READ-ONLY: local Turso SELECTs + exactly ONE network GET (M1b's
// membership YAML, the same source committees-sync ingests). No Congress.gov /
// Senate.gov / Ballotpedia calls; M2's expected counts are stored on the vote
// rows. The read-only grep on this file must be empty (no write keywords).
//
//   M1 — committee_members: zero rosters, source-vs-DB diff, staleness.
//   M2 — member_votes deficits (tally on the row minus stored positions).
//   M3 — revisit semantics: does a stored vote get re-wiped? (code-read verdict).
//   M4 — amendment_votes Senate drift (recompute vs materialized).
//   M5 — one count: meetings with zero meeting_bills, past/future.
//
// thomasToSystemCode + the membership URL are reimplemented verbatim from
// lib/committees-sync.ts (neither is exported) — the HO 563 genre convention.
//
//   npx tsx scripts/diagnostic/delete-rebuild-erosion-566.ts
import "dotenv/config";
import { createClient, type Client, type Row } from "@libsql/client";
import yaml from "js-yaml";
import { SENATE_AMDT_QUESTION_LIKE, parseSenateAmendmentNumber } from "../../lib/amendment-vote-key";

// verbatim from lib/committees-sync.ts:30 (not exported)
const MEMBERSHIP_YAML_URL =
  "https://raw.githubusercontent.com/unitedstates/congress-legislators/main/committee-membership-current.yaml";
// verbatim from lib/committees-sync.ts:249 (not exported)
function thomasToSystemCode(thomas: string): string {
  const lower = thomas.toLowerCase();
  return lower.length === 4 ? `${lower}00` : lower;
}

function s(row: Row | undefined, k: string): string { return String((row as Row)?.[k] ?? ""); }
function num(row: Row | undefined, k: string): number { return Number((row as Row)?.[k] ?? 0); }

function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(a.length / 2);
  return a.length % 2 ? a[mid]! : (a[mid - 1]! + a[mid]!) / 2;
}

function hoursAgo(iso: string, nowMs: number): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? Infinity : (nowMs - t) / 3_600_000;
}

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) { console.log("TURSO_DATABASE_URL not set — run with the CBT .env."); return 1; }
  const db: Client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
  const nowMs = Date.now();

  // ── M1 — committee rosters ──────────────────────────────────────────────
  console.log("\n══ M1 — committee_members (committees-sync wipe-and-rewrite, every 12h, per committee) ══");

  // (a) every committee + its member count, main vs subcommittee.
  const rosterRs = await db.execute(`
    SELECT c.system_code, c.name, c.chamber, c.is_current,
           CASE WHEN c.parent_system_code IS NULL THEN 'main' ELSE 'sub' END AS kind,
           (SELECT COUNT(*) FROM committee_members cm WHERE cm.committee_system_code = c.system_code) AS n,
           (SELECT MAX(cm.updated_at) FROM committee_members cm WHERE cm.committee_system_code = c.system_code) AS max_updated
    FROM committees c
    ORDER BY c.system_code`);
  const rosters = rosterRs.rows;
  const dbCount = new Map<string, number>();
  for (const r of rosters) dbCount.set(s(r, "system_code"), num(r, "n"));

  const mainSizes: number[] = [], subSizes: number[] = [];
  const zeroMember: Row[] = [];
  for (const r of rosters) {
    const n = num(r, "n");
    (s(r, "kind") === "main" ? mainSizes : subSizes).push(n);
    if (n === 0) zeroMember.push(r);
  }
  console.log(`(a) committees=${rosters.length} (main=${mainSizes.length} sub=${subSizes.length})`);
  console.log(`    main roster size   min/median/max = ${Math.min(...mainSizes)} / ${median(mainSizes)} / ${Math.max(...mainSizes)}`);
  console.log(`    sub  roster size   min/median/max = ${subSizes.length ? `${Math.min(...subSizes)} / ${median(subSizes)} / ${Math.max(...subSizes)}` : "n/a"}`);
  const zeroCurrent = zeroMember.filter((r) => num(r, "is_current") === 1);
  console.log(`    zero-member committees: ${zeroMember.length} (is_current=1: ${zeroCurrent.length})`);
  for (const r of zeroMember) {
    console.log(`      ${s(r, "system_code")}  cur=${num(r, "is_current")}  ${s(r, "kind")}  ${s(r, "name")}`);
  }

  // (b) source (YAML) vs DB, scoped to codes present in our committees table
  //     (the sync's knownSet gate). ONE network GET.
  console.log("\n(b) source (committee-membership-current.yaml) vs DB — the single network fetch");
  const res = await fetch(MEMBERSHIP_YAML_URL, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) { console.log(`    FETCH FAILED HTTP ${res.status} — M1b skipped`); }
  else {
    const parsed = yaml.load(await res.text()) as Record<string, Array<{ bioguide?: string }>> | undefined;
    const srcCount = new Map<string, number>();
    let srcCommittees = 0;
    if (parsed && typeof parsed === "object") {
      for (const [thomas, members] of Object.entries(parsed)) {
        if (!Array.isArray(members)) continue;
        const code = thomasToSystemCode(thomas);
        // count only insertable members (the sync skips entries without bioguide)
        const withBio = members.filter((m) => m && m.bioguide).length;
        srcCount.set(code, withBio);
        srcCommittees++;
      }
    }
    console.log(`    source committees parsed: ${srcCommittees}`);
    const emptyInDb: string[] = [];   // source has ≥1, DB has 0, and code is known to our table
    const trailsBy3: string[] = [];   // DB count ≤ source − 3
    for (const [code, src] of srcCount) {
      if (!dbCount.has(code)) continue; // unknown to our committees table → sync skips it (not erosion, M1c territory)
      const db0 = dbCount.get(code)!;
      if (src >= 1 && db0 === 0) emptyInDb.push(`${code} src=${src} db=0`);
      else if (db0 <= src - 3) trailsBy3.push(`${code} src=${src} db=${db0}`);
    }
    console.log(`    source-has≥1-but-DB-empty: ${emptyInDb.length}`);
    for (const line of emptyInDb.slice(0, 20)) console.log(`      ${line}`);
    console.log(`    DB trails source by ≥3: ${trailsBy3.length}`);
    for (const line of trailsBy3.slice(0, 20)) console.log(`      ${line}`);
    // also: codes in source but NOT in our committees table (the unknownCommittees skip)
    const unknown = [...srcCount.keys()].filter((c) => !dbCount.has(c));
    console.log(`    source codes NOT in committees table (unknownCommittees skip): ${unknown.length}`);
  }

  // (c) staleness: MAX(updated_at) per committee vs the 12h cadence.
  console.log("\n(c) roster staleness — MAX(updated_at) per committee vs 12h cadence");
  const stale: { code: string; name: string; hrs: number }[] = [];
  let noStamp = 0;
  const freshHrs: number[] = [];
  for (const r of rosters) {
    const mu = s(r, "max_updated");
    if (!mu) { noStamp++; continue; } // zero-member → no rows → no stamp
    const hrs = hoursAgo(mu, nowMs);
    freshHrs.push(hrs);
    if (hrs > 48) stale.push({ code: s(r, "system_code"), name: s(r, "name"), hrs });
  }
  console.log(`    committees with no member rows (no stamp): ${noStamp}`);
  console.log(`    stamped roster age hrs  min/median/max = ${freshHrs.length ? `${Math.min(...freshHrs).toFixed(1)} / ${median(freshHrs).toFixed(1)} / ${Math.max(...freshHrs).toFixed(1)}` : "n/a"}`);
  console.log(`    committees NOT rewritten in >48h: ${stale.length}`);
  for (const r of stale.slice(0, 20)) console.log(`      ${r.code}  ${r.hrs.toFixed(0)}h  ${r.name}`);

  // ── M2 — member_votes deficits ──────────────────────────────────────────
  console.log("\n══ M2 — member_votes deficits (tally on the row − stored positions) ══");
  const voteRs = await db.execute(`
    SELECT v.id, v.chamber, v.question,
           v.yea_count, v.nay_count, v.present_count, v.not_voting_count,
           (SELECT COUNT(*) FROM member_votes mv WHERE mv.vote_id = v.id) AS mvcount
    FROM votes v`);
  type Def = { id: string; chamber: string; question: string; tally: number; mv: number; deficit: number };
  const defs: Def[] = voteRs.rows.map((r) => {
    const tally = num(r, "yea_count") + num(r, "nay_count") + num(r, "present_count") + num(r, "not_voting_count");
    const mv = num(r, "mvcount");
    return { id: s(r, "id"), chamber: s(r, "chamber"), question: s(r, "question"), tally, mv, deficit: tally - mv };
  });
  const chambers = ["house", "senate"];
  console.log(`total votes=${defs.length}`);
  // (a) positive tally + zero member_votes
  for (const ch of chambers) {
    const z = defs.filter((d) => d.chamber === ch && d.tally > 0 && d.mv === 0);
    console.log(`(a) ${ch}: positive-tally + ZERO member_votes = ${z.length}`);
    for (const d of z.slice(0, 20)) console.log(`      ${d.id}  tally=${d.tally}  ${d.question.slice(0, 70)}`);
  }
  // (b) deficit distribution by chamber
  for (const ch of chambers) {
    const c = defs.filter((d) => d.chamber === ch);
    const b0 = c.filter((d) => d.deficit === 0).length;
    const b14 = c.filter((d) => d.deficit >= 1 && d.deficit <= 4).length;
    const b5 = c.filter((d) => d.deficit >= 5).length;
    const surp = c.filter((d) => d.deficit < 0).length;
    console.log(`(b) ${ch} (n=${c.length}): deficit 0=${b0}  1-4=${b14}  ≥5=${b5}  (surplus<0=${surp})`);
  }
  // (c) deficit ≥5 rows, cap 20
  const big = defs.filter((d) => d.deficit >= 5).sort((a, b) => b.deficit - a.deficit);
  console.log(`(c) deficit ≥5: ${big.length} (cap 20)`);
  for (const d of big.slice(0, 20)) console.log(`      ${d.id}  def=${d.deficit} (tally=${d.tally} mv=${d.mv})  ${d.question.slice(0, 60)}`);
  // (d) surpluses
  const surplus = defs.filter((d) => d.deficit < 0).sort((a, b) => a.deficit - b.deficit);
  console.log(`(d) surpluses (negative deficit — dupes, a different bug): ${surplus.length}`);
  for (const d of surplus.slice(0, 10)) console.log(`      ${d.id}  def=${d.deficit} (tally=${d.tally} mv=${d.mv})`);
  console.log("    benign deficit causes (code read): senate resolver miss (lis/last+state → no bioguide),");
  console.log("    null normalizePosition, missing bioguideID (house) — all skip silently AT FIRST WRITE.");

  // ── M3 — revisit semantics (code-read verdict + data corroboration) ──────
  console.log("\n══ M3 — revisit semantics: can a stored vote's member_votes be re-wiped on a later tick? ══");
  console.log("  house  (lib/votes-sync.ts): selection L354 fromDate = getWatermark = MAX(vote_date);");
  console.log("         skip L388 `existing.has(id) && startDate <= fromDate`; per-vote wipe+rewrite L322.");
  console.log("         → every stored vote has startDate ≤ MAX(vote_date), so the skip ALWAYS fires on a");
  console.log("           cron re-run. member_votes are written ONCE and never re-wiped. VERDICT: WINDOWED");
  console.log("           (condition: unless run with an explicit earlier opts.fromDate — a manual backfill).");
  console.log("  senate (lib/senate-votes-sync.ts): watermark L361 getMaxRollCall = MAX(roll_call) per session;");
  console.log("         skip L373 `rollInt <= lastNum`; per-vote wipe+rewrite L291.");
  console.log("         → a stored roll call has rollInt ≤ lastNum, so it is always skipped on a later tick.");
  console.log("           VERDICT: WINDOWED (thin/empty risk is the FIRST write only, then frozen).");
  // data corroboration: are deficits concentrated in old rolls (frozen) rather than the newest?
  for (const ch of chambers) {
    const withDef = defs.filter((d) => d.chamber === ch && d.deficit > 0);
    console.log(`  corroboration ${ch}: ${withDef.length} votes carry a positive deficit (frozen at first write if WINDOWED holds).`);
  }

  // ── M4 — amendment_votes Senate drift (recompute vs materialized) ────────
  console.log("\n══ M4 — amendment_votes Senate drift (HO 537 pure-recompute contract, first external check) ══");
  const amdRs = await db.execute("SELECT id, congress, amendment_number FROM amendments WHERE amendment_type = 'SAMDT'");
  const amdByKey = new Map<string, string>();
  for (const r of amdRs.rows) amdByKey.set(`${num(r, "congress")}~${num(r, "amendment_number")}`, s(r, "id"));
  const senVoteRs = await db.execute({
    sql: `SELECT id, congress, question FROM votes WHERE chamber = 'senate' AND question LIKE ?`,
    args: [SENATE_AMDT_QUESTION_LIKE],
  });
  const computed = new Set<string>();
  let unmatchedQuestions = 0;
  for (const r of senVoteRs.rows) {
    const n = parseSenateAmendmentNumber(s(r, "question"));
    if (n == null) { unmatchedQuestions++; continue; }
    const amdId = amdByKey.get(`${num(r, "congress")}~${n}`);
    if (!amdId) { unmatchedQuestions++; continue; }
    computed.add(`${amdId}|${s(r, "id")}`);
  }
  const existRs = await db.execute(
    `SELECT av.amendment_id, av.vote_id FROM amendment_votes av JOIN votes v ON v.id = av.vote_id WHERE v.chamber = 'senate'`,
  );
  const existing = new Set(existRs.rows.map((r) => `${s(r, "amendment_id")}|${s(r, "vote_id")}`));
  let added = 0, removed = 0;
  for (const k of computed) if (!existing.has(k)) added++;
  for (const k of existing) if (!computed.has(k)) removed++;
  // procedural residual: senate votes mentioning Amdt but NOT the up-or-down form
  const residual2 = await db.execute({
    sql: `SELECT COUNT(*) AS n FROM votes WHERE chamber='senate' AND question LIKE '%Amdt%' AND question NOT LIKE ?`,
    args: [SENATE_AMDT_QUESTION_LIKE],
  });
  console.log(`  senate up-or-down amendment votes scanned (LIKE match): ${senVoteRs.rows.length}`);
  console.log(`  computed links (parse+resolve): ${computed.size}   [anchor ~97]`);
  console.log(`  materialized Senate links in amendment_votes: ${existing.size}`);
  console.log(`  DRIFT — computed-not-materialized (added): ${added}   materialized-not-computed (removed): ${removed}   [contract: 0 / 0]`);
  console.log(`  unmatched (LIKE hit, parse/resolve miss → corpus drift): ${unmatchedQuestions}`);
  console.log(`  procedural residual (senate '%Amdt%' NOT up-or-down): ${num(residual2.rows[0], "n")}   [anchor ~64]`);
  console.log(`  (anchors age with the corpus; the drift diff does not.)`);

  // ── M5 — meetings with zero meeting_bills (one count) ────────────────────
  console.log("\n══ M5 — committee_meetings with zero meeting_bills (per-event delete-rebuild, smaller radius) ══");
  const meetRs = await db.execute(`
    SELECT CASE WHEN cm.meeting_date IS NULL THEN 'undated'
                WHEN cm.meeting_date >= date('now') THEN 'future' ELSE 'past' END AS bucket,
           COUNT(*) AS n
    FROM committee_meetings cm
    WHERE NOT EXISTS (SELECT 1 FROM meeting_bills mb WHERE mb.event_id = cm.event_id)
    GROUP BY bucket`);
  const totalMeet = num((await db.execute("SELECT COUNT(*) AS n FROM committee_meetings")).rows[0], "n");
  console.log(`  total committee_meetings: ${totalMeet}`);
  for (const r of meetRs.rows) console.log(`  zero meeting_bills — ${s(r, "bucket")}: ${num(r, "n")}`);

  console.log("\n── done (read-only) ──");
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
