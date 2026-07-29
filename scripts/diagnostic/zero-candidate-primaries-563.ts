// HO 563 STEP 0 — the 143 zero-candidate past primaries + the House erasure
// hazard. READ-ONLY: SELECT + live Ballotpedia GET only, no mutations, no
// schema, no cron, no cache writes. The write-keyword grep on this file must be
// empty. Ballotpedia pacing is 1100ms between every fetch, no concurrency.
//
//   M1 — characterize the 143 from the DB alone (no network).
//   M2 — what scrapeHouseCandidates returns for those districts LIVE (deciding).
//   M3 — size the erasure hazard: resulted House districts that now fail to parse.
//   M4 — cache participation (does .cache/ change M2's numbers?).
//   M5 — visit recency vs the cursor.
//
// scrapeHouseCandidates is imported (already exported); nothing new is exported
// from the sync/scrape modules (HO 563 §4.2). The cursor→unit mapping is
// reimplemented here rather than importing buildScrapeUnits (not exported).
//
//   npx tsx scripts/diagnostic/zero-candidate-primaries-563.ts
import "dotenv/config";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createClient, type Client, type Row } from "@libsql/client";
import { scrapeHouseCandidates } from "../../lib/primary-candidates-scrape";
import { stateName } from "../../lib/states";

// SENATE_STATES_2026, verbatim from lib/primaries-sync.ts:44 (not exported) —
// for the M5 cursor→unit mapping (unit 0 = calendar, 1..35 = senate).
const SENATE_STATES_2026 = [
  "AL", "AK", "AR", "CO", "DE", "GA", "ID", "IL", "IA", "KS",
  "KY", "LA", "ME", "MA", "MI", "MN", "MS", "MT", "NE", "NH",
  "NJ", "NM", "NC", "OK", "OR", "RI", "SC", "SD", "TN", "TX",
  "VA", "WV", "WY",
  "FL", "OH",
];
const CURSOR_KEY = "primaries_cron_cursor";
const CACHE_DIR = join(process.cwd(), ".cache", "ballotpedia");

function s(row: Row | undefined, k: string): string { return String((row as Row)?.[k] ?? ""); }
function num(row: Row | undefined, k: string): number { return Number((row as Row)?.[k] ?? 0); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Parse a House primary id → {state, district}. `house-CA-05-2026-D` → CA / 5.
function houseIdParts(id: string): { state: string; district: number } | null {
  const m = id.match(/^house-([A-Z]{2})-(\d{2})-2026-/);
  if (!m) return null;
  return { state: m[1]!, district: parseInt(m[2]!, 10) };
}

async function scrapeDistrict(state: string, district: number, bypassCache: boolean) {
  const slug = stateName(state).replace(/ /g, "_");
  return scrapeHouseCandidates(state, slug, district, { bypassCache });
}

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) { console.log("TURSO_DATABASE_URL not set — run with the CBT .env."); return 1; }
  const db: Client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

  // ── M1 — the 143, from the DB alone ─────────────────────────────────────
  console.log("══ M1 — zero-candidate past primaries (election_round='primary', date<today, 0 candidates) ══");
  const zero = (await db.execute(`
    SELECT p.id, p.state, p.district, p.chamber, p.party, p.primary_date, p.updated_at
      FROM primaries p
     WHERE p.election_round='primary' AND p.primary_date < date('now')
       AND NOT EXISTS (SELECT 1 FROM primary_candidates pc WHERE pc.primary_id = p.id)
     ORDER BY p.primary_date, p.state, p.id
  `)).rows;
  const senate = zero.filter((r) => s(r, "chamber") === "senate");
  const house = zero.filter((r) => s(r, "chamber") === "house");
  console.log(`   total=${zero.length} · senate=${senate.length} · house=${house.length}`);

  // by state
  const byState = new Map<string, number>();
  for (const r of zero) byState.set(s(r, "state"), (byState.get(s(r, "state")) ?? 0) + 1);
  console.log(`   by state: ${[...byState.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}=${v}`).join(" · ")}`);

  // by primary_date
  const byDate = new Map<string, number>();
  for (const r of zero) byDate.set(s(r, "primary_date"), (byDate.get(s(r, "primary_date")) ?? 0) + 1);
  console.log(`   by date: ${[...byDate.entries()].sort().map(([k, v]) => `${k}=${v}`).join(" · ")}`);

  // House: both D and R empty vs one only (per district)
  const houseByDistrict = new Map<string, Set<string>>(); // "ST-DD" -> set of empty parties
  for (const r of house) {
    const p = houseIdParts(s(r, "id"));
    if (!p) continue;
    const key = `${p.state}-${String(p.district).padStart(2, "0")}`;
    const set = houseByDistrict.get(key) ?? new Set<string>();
    set.add(s(r, "party"));
    houseByDistrict.set(key, set);
  }
  // Which of those districts also have a NON-empty sibling row (the other party)?
  let bothEmpty = 0, oneEmpty = 0;
  const oneEmptyDetail: string[] = [];
  for (const [key, empties] of houseByDistrict) {
    // count how many contests this district has total (rows in primaries)
    const [st, dd] = key.split("-");
    const totalRows = (await db.execute({
      sql: `SELECT COUNT(*) c FROM primaries WHERE id LIKE ?`,
      args: [`house-${st}-${dd}-2026-%`],
    })).rows[0];
    const total = num(totalRows, "c");
    if (empties.size >= total) bothEmpty++;
    else { oneEmpty++; oneEmptyDetail.push(`${key}(empty:${[...empties].join("/")} of ${total})`); }
  }
  console.log(`   House distinct districts touched: ${houseByDistrict.size} · both-contests-empty: ${bothEmpty} · only-one-empty: ${oneEmpty}`);
  if (oneEmptyDetail.length) console.log(`     one-empty detail: ${oneEmptyDetail.slice(0, 25).join(" · ")}${oneEmptyDetail.length > 25 ? " …" : ""}`);

  // whole-state failure vs scattered: for each (state,date) affected, do sibling
  // districts in the same state+date have rosters?
  console.log("   whole-state-vs-scattered (per affected state+date):");
  const stateDates = new Map<string, Set<string>>(); // state -> dates
  for (const r of house) {
    const st = s(r, "state"); const dt = s(r, "primary_date");
    const set = stateDates.get(st) ?? new Set<string>(); set.add(dt); stateDates.set(st, set);
  }
  for (const [st, dates] of stateDates) {
    for (const dt of dates) {
      const tot = (await db.execute({
        sql: `SELECT COUNT(DISTINCT district) c FROM primaries WHERE chamber='house' AND state=? AND primary_date=?`,
        args: [st, dt],
      })).rows[0];
      const rostered = (await db.execute({
        sql: `SELECT COUNT(DISTINCT p.district) c FROM primaries p
               WHERE p.chamber='house' AND p.state=? AND p.primary_date=?
                 AND EXISTS (SELECT 1 FROM primary_candidates pc WHERE pc.primary_id=p.id)`,
        args: [st, dt],
      })).rows[0];
      const empty = (await db.execute({
        sql: `SELECT COUNT(DISTINCT p.district) c FROM primaries p
               WHERE p.chamber='house' AND p.state=? AND p.primary_date=?
                 AND NOT EXISTS (SELECT 1 FROM primary_candidates pc WHERE pc.primary_id=p.id)`,
        args: [st, dt],
      })).rows[0];
      console.log(`     ${st} ${dt}: districts total=${num(tot, "c")} · rostered=${num(rostered, "c")} · empty=${num(empty, "c")}`);
    }
  }

  // updated_at − primary_date distribution (how recently sync touched these rows)
  const recBuckets: Record<string, number> = { "≤7d after": 0, "8-30d after": 0, "31-90d after": 0, "90d+ after": 0, "before/na": 0 };
  for (const r of zero) {
    const up = Date.parse(s(r, "updated_at")); const pd = Date.parse(`${s(r, "primary_date")}T00:00:00Z`);
    let bucket: string;
    if (!Number.isFinite(up) || !Number.isFinite(pd)) bucket = "before/na";
    else {
      const d = Math.floor((up - pd) / 86_400_000);
      bucket = d < 0 ? "before/na" : d <= 7 ? "≤7d after" : d <= 30 ? "8-30d after" : d <= 90 ? "31-90d after" : "90d+ after";
    }
    recBuckets[bucket] = (recBuckets[bucket] ?? 0) + 1;
  }
  console.log(`   updated_at − primary_date: ${Object.entries(recBuckets).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  console.log("");

  // Distinct House districts among the 143.
  const houseDistricts = [...new Set(house.map((r) => {
    const p = houseIdParts(s(r, "id")); return p ? `${p.state}:${p.district}` : "";
  }).filter(Boolean))];

  // ── M2 — live scrape of those districts (the deciding measurement) ───────
  console.log(`══ M2 — live scrapeHouseCandidates (bypassCache) for the ${houseDistricts.length} distinct empty House districts ══`);
  const m2buckets: Record<string, number> = { ok: 0, no_section: 0, no_candidates: 0, no_page: 0, special: 0 };
  for (const key of houseDistricts) {
    const [st, dStr] = key.split(":"); const district = parseInt(dStr!, 10);
    const res = await scrapeDistrict(st!, district, true);
    const cc = res.candidates.length;
    m2buckets[res.status] = (m2buckets[res.status] ?? 0) + 1;
    console.log(`   ${st}-${String(district).padStart(2, "0")}: ${res.status}${res.status === "ok" ? ` (${cc} cand)` : ""}${res.httpStatus != null ? ` http=${res.httpStatus}` : ""}`);
    await sleep(1100);
  }
  console.log(`   M2 buckets: ${Object.entries(m2buckets).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  console.log("");

  // ── M3 — size the erasure hazard: resulted House districts that fail to parse ──
  console.log("══ M3 — resulted House districts (≥1 vote_pct) that now fail a live parse (cap 40, stratified) ══");
  const resultedRows = (await db.execute(`
    SELECT DISTINCT p.state, p.district FROM primaries p
     WHERE p.chamber='house' AND p.election_round='primary'
       AND EXISTS (SELECT 1 FROM primary_candidates pc WHERE pc.primary_id=p.id AND pc.vote_pct IS NOT NULL)
     ORDER BY p.state, p.district
  `)).rows;
  // stratify: round-robin across states so no single state dominates.
  const byStateList = new Map<string, number[]>();
  for (const r of resultedRows) {
    const st = s(r, "state"); const d = num(r, "district");
    const arr = byStateList.get(st) ?? []; arr.push(d); byStateList.set(st, arr);
  }
  const sample: { state: string; district: number }[] = [];
  const stateKeys = [...byStateList.keys()];
  let idx = 0;
  while (sample.length < 40) {
    let added = false;
    for (const st of stateKeys) {
      const arr = byStateList.get(st)!;
      if (idx < arr.length) { sample.push({ state: st, district: arr[idx]! }); added = true; if (sample.length >= 40) break; }
    }
    if (!added) break;
    idx++;
  }
  console.log(`   resulted House districts total=${resultedRows.length}; sampling ${sample.length} across ${stateKeys.length} states`);
  const m3fails: string[] = [];
  const m3buckets: Record<string, number> = { ok: 0, no_section: 0, no_candidates: 0, no_page: 0, special: 0 };
  for (const { state, district } of sample) {
    const res = await scrapeDistrict(state, district, true);
    m3buckets[res.status] = (m3buckets[res.status] ?? 0) + 1;
    if (res.status === "no_section" || res.status === "no_candidates" || res.status === "special") {
      m3fails.push(`${state}-${String(district).padStart(2, "0")} (${res.status})`);
    }
    await sleep(1100);
  }
  console.log(`   M3 buckets: ${Object.entries(m3buckets).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  console.log(`   AT-RISK (resulted rosters one visit from erasure): ${m3fails.length}${m3fails.length ? " → " + m3fails.join(", ") : ""}`);
  console.log("   (every listed district currently carries results — a non-parsing scrape would delete-then-insert-nothing)");
  console.log("");

  // ── M4 — cache participation ────────────────────────────────────────────
  console.log("══ M4 — .cache/ participation (is M2 a property of Ballotpedia or a local artifact?) ══");
  const cacheExists = existsSync(CACHE_DIR);
  const cacheFiles = cacheExists ? readdirSync(CACHE_DIR).length : 0;
  console.log(`   local ${CACHE_DIR}: exists=${cacheExists} files=${cacheFiles}`);
  console.log("   (deployed env sees only git-committed files; check `git ls-files .cache` separately — reported in the summary)");
  const m4sample = houseDistricts.slice(0, 5);
  console.log(`   bypassCache vs default on ${m4sample.length} districts:`);
  for (const key of m4sample) {
    const [st, dStr] = key.split(":"); const district = parseInt(dStr!, 10);
    const live = await scrapeDistrict(st!, district, true); await sleep(1100);
    const def = await scrapeDistrict(st!, district, false); await sleep(1100);
    const diff = live.status !== def.status || live.candidates.length !== def.candidates.length;
    console.log(`   ${st}-${String(district).padStart(2, "0")}: bypass=${live.status}/${live.candidates.length} default=${def.status}/${def.candidates.length}${diff ? "  ⚠ DIVERGES" : "  (same)"}`);
  }
  console.log("");

  // ── M5 — cursor value + unit, and visit recency for the M1 districts ─────
  console.log("══ M5 — cursor position + visit recency ══");
  const cur = (await db.execute({ sql: `SELECT value FROM dashboard_state WHERE key=?`, args: [CURSOR_KEY] })).rows[0];
  const cursor = num(cur, "value");
  let unit: string;
  if (cursor === 0) unit = "calendar";
  else if (cursor <= SENATE_STATES_2026.length) unit = `senate[${SENATE_STATES_2026[cursor - 1]}]`;
  else unit = `house[offset ${cursor - 1 - SENATE_STATES_2026.length} of 435]`;
  console.log(`   cursor=${cursor} → unit=${unit} (calendar=0 · senate=1..${SENATE_STATES_2026.length} · house=${SENATE_STATES_2026.length + 1}..470)`);
  console.log("   (already reported in M1: updated_at − primary_date distribution = when the sync last wrote these rows)");
  const newest = zero.reduce((mx, r) => Math.max(mx, Date.parse(s(r, "updated_at")) || 0), 0);
  const oldest = zero.reduce((mn, r) => Math.min(mn, Date.parse(s(r, "updated_at")) || Infinity), Infinity);
  if (newest) console.log(`   M1 rows updated_at range: ${new Date(oldest).toISOString().slice(0, 10)} … ${new Date(newest).toISOString().slice(0, 10)}`);
  console.log("");

  console.log("══ SUMMARY ══");
  console.log(`   M1 zero-candidate: total=${zero.length} (senate=${senate.length} house=${house.length}), ${houseDistricts.length} distinct House districts`);
  console.log(`   M2 buckets: ${Object.entries(m2buckets).map(([k, v]) => `${k}=${v}`).join(" · ")}`);
  console.log(`   M3 at-risk resulted districts: ${m3fails.length}/${sample.length} sampled`);
  console.log(`   M4 local cache files: ${cacheFiles}`);
  console.log(`   M5 cursor=${cursor} (${unit})`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
