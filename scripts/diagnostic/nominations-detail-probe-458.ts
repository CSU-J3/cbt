// HO 458 read-only nominations DETAIL probe. The QUEUED committee cross-link's
// probe half: HO 455/456 shipped the pillar list-only, leaving
// `committee_system_code` NULLABLE for "a later detail-hydration HO." This
// characterizes that hydration before HO 459 builds it. Three ordered questions:
//   Q1 (A) — part-specific detail shape: for a multi-part civilian PN, does each
//     stored part-row's own raw_json.url resolve to a DISTINCT record (own
//     citation/committees), or collapse to the base /nomination/{c}/{n}? Is
//     `committees` embedded or a sub-resource {count,url}? Sets the populate rule.
//   Q2 (B) — civilian committee-referral resolution measured on the CORRECT
//     (part-keyed) record: referral presence %, resolution vs tracked committees,
//     distinct/unresolved codes, cardinality. THE GO/NO-GO.
//   Q3 (C) — hydration cost: fetches/PN, per-fetch latency (mean+p90), projected
//     ~830-civilian wall-clock; military nomineeCount one-line rider.
// NO writes, NO schema, NO sync, NO surface — sibling to
// nominations-source-probe-454.ts. Seeds from the populated `nominations` table.
//
//   npx tsx scripts/diagnostic/nominations-detail-probe-458.ts
import "dotenv/config";
import { createClient } from "@libsql/client";
import { getCurrentCongress } from "../../lib/congress";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});

const API = "https://api.congress.gov/v3";
const KEY = process.env.CONGRESS_API_KEY;
if (!KEY) throw new Error("CONGRESS_API_KEY is not set");
const CONGRESS = getCurrentCongress(); // 119
const TALLY_SAMPLE = 150;

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Network-only fetch timings (excludes the 120ms pace) — Q3's latency series.
const fetchMs: number[] = [];

async function fetchJson<T>(url: string, attempt = 0): Promise<T> {
  await sleep(120);
  const t0 = performance.now();
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  const body = await res.text();
  fetchMs.push(performance.now() - t0);
  if (res.status === 429 && attempt < 3) {
    const wait = 2000 * (attempt + 1);
    console.warn(`  rate limited, sleeping ${wait}ms`);
    await sleep(wait);
    return fetchJson<T>(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}: ${body.slice(0, 200)}`);
  return JSON.parse(body) as T;
}

const withKey = (u: string) => `${u}${u.includes("?") ? "&" : "?"}api_key=${KEY}`;
const baseDetailUrl = (number: number) => `${API}/nomination/${CONGRESS}/${number}?format=json&api_key=${KEY}`;

interface Committee { systemCode?: string; name?: string; chamber?: string; url?: string }
interface Detail {
  number?: number;
  isList?: boolean;
  citation?: string;
  partNumber?: string;
  description?: string;
  organization?: string;
  nominationType?: { isCivilian?: boolean; isMilitary?: boolean };
  nominees?: unknown[] | { count?: number; url?: string };
  committees?: Committee[] | { count?: number; url?: string };
  latestAction?: { actionDate?: string; text?: string; recordedVotes?: unknown[] };
  [k: string]: unknown;
}
interface Row {
  id: string;
  pn: number;
  part: string;
  organization: string | null;
  url: string; // per-row raw_json.url (part-keyed)
  citation: string;
}

// Resolve a detail's committees to a concrete array — embedded array, or a
// {count,url} sub-resource (records shape, returns whether a 2nd fetch was
// needed so Q3 can count fetches/PN).
async function resolveCommittees(d: Detail): Promise<{ committees: Committee[]; subFetch: boolean }> {
  if (Array.isArray(d.committees)) return { committees: d.committees, subFetch: false };
  if (d.committees && typeof d.committees === "object" && "url" in d.committees && (d.committees as { url?: string }).url) {
    try {
      const sub = await fetchJson<{ committees?: Committee[] }>(withKey((d.committees as { url: string }).url));
      return { committees: sub.committees ?? [], subFetch: true };
    } catch {
      return { committees: [], subFetch: true };
    }
  }
  return { committees: [], subFetch: false };
}

const trunc = (d: unknown, n = 2500) => JSON.stringify(d, null, 2).slice(0, n);

async function main() {
  console.log(`=== HO 458 nominations DETAIL probe (Congress ${CONGRESS}) ===\n`);

  // committees set for the join
  const cteRows = (await db.execute("SELECT system_code, name FROM committees")).rows;
  const committeeSet = new Set(cteRows.map((r) => String(r.system_code)));
  console.log(`tracked committees.system_code: ${committeeSet.size}`);

  // seed all civilian rows, parse per-row url from raw_json
  const raw = (await db.execute(
    "SELECT id, pn_number, part_number, organization, citation, raw_json FROM nominations WHERE is_military = 0",
  )).rows;
  const rows: Row[] = [];
  for (const r of raw) {
    let url = "";
    try {
      url = String(JSON.parse(String(r.raw_json ?? "{}")).url ?? "");
    } catch { /* skip */ }
    rows.push({
      id: String(r.id),
      pn: Number(r.pn_number),
      part: String(r.part_number),
      organization: r.organization == null ? null : String(r.organization),
      url,
      citation: String(r.citation),
    });
  }
  console.log(`seeded ${rows.length} civilian part-rows (${rows.filter((r) => r.url).length} with a raw_json.url)`);

  // part distribution / multi-part blast radius
  const byPn = new Map<number, Row[]>();
  for (const r of rows) (byPn.get(r.pn) ?? byPn.set(r.pn, []).get(r.pn)!).push(r);
  const singlePartPns = [...byPn.entries()].filter(([, rs]) => rs.length === 1).map(([pn]) => pn);
  const multiPartPns = [...byPn.entries()].filter(([, rs]) => rs.length > 1).map(([pn]) => pn);
  const rowsInMulti = rows.filter((r) => (byPn.get(r.pn)?.length ?? 0) > 1).length;

  // ============================================================
  // A. PART-SPECIFIC DETAIL SHAPE (Q1 — settle first)
  // ============================================================
  console.log("\n=== A. PART-SPECIFIC DETAIL SHAPE (Q1) ===");
  console.log(`distinct civilian PNs: ${byPn.size}  ·  single-part(part="00"): ${singlePartPns.length}  ·  multi-part: ${multiPartPns.length}`);
  console.log(`civilian rows inside multi-part PNs: ${rowsInMulti}/${rows.length} (${pct(rowsInMulti, rows.length)}) — multi-part is ${rowsInMulti / rows.length > 0.5 ? "LOAD-BEARING" : "a small tail"}`);

  // A1 — two single-part PNs: base IS the row; confirm committees present.
  console.log("\n--- A1. single-part: base /nomination/{c}/{n} == the row ---");
  for (const pn of singlePartPns.slice(0, 2)) {
    const row = byPn.get(pn)![0]!;
    const d = (await fetchJson<{ nomination?: Detail }>(baseDetailUrl(pn))).nomination ?? {};
    const rowD = row.url ? (await fetchJson<{ nomination?: Detail }>(withKey(row.url))).nomination ?? {} : {};
    const { committees, subFetch } = await resolveCommittees(d);
    console.log(`\nPN${pn} part=${row.part}  base.citation=${d.citation}  row.url→citation=${rowD.citation}  same=${d.citation === rowD.citation}`);
    console.log(`  committees shape: ${Array.isArray(d.committees) ? "EMBEDDED array" : d.committees ? "SUB-RESOURCE {count,url}" : "ABSENT"}  (subFetch=${subFetch}) → ${committees.length} committee(s): ${committees.map((c) => `${c.systemCode}:${c.name}`).join(" | ") || "—"}`);
    console.log(`  --- base detail (trunc 2.5k) ---\n${trunc(d)}`);
  }

  // A2 — two multi-part PNs: the decisive test. base vs per-part urls.
  console.log("\n--- A2. multi-part: base vs per-part raw_json.url (the decisive test) ---");
  for (const pn of multiPartPns.slice(0, 2)) {
    const parts = byPn.get(pn)!.sort((a, b) => a.part.localeCompare(b.part));
    console.log(`\n########## PN${pn}: ${parts.length} stored parts ##########`);
    // the base record for a multi-part PN
    const base = (await fetchJson<{ nomination?: Detail }>(baseDetailUrl(pn))).nomination ?? {};
    const baseCte = await resolveCommittees(base);
    console.log(`BASE /nomination/${CONGRESS}/${pn}: citation=${base.citation} isList=${base.isList} org=${String(base.organization).slice(0, 40)}`);
    console.log(`  base committees: ${Array.isArray(base.committees) ? "EMBEDDED" : base.committees ? "SUB {count,url}" : "ABSENT"} → ${baseCte.committees.map((c) => c.systemCode).join(",") || "—"}`);
    console.log(`  --- BASE detail (trunc 2.5k) ---\n${trunc(base)}`);
    // first two part rows: follow their own urls
    for (const row of parts.slice(0, 2)) {
      const pd = row.url ? (await fetchJson<{ nomination?: Detail }>(withKey(row.url))).nomination ?? {} : {};
      const pc = await resolveCommittees(pd);
      const distinct = pd.citation !== base.citation;
      console.log(`\n  PART part=${row.part} url→ citation=${pd.citation} (distinct from base? ${distinct}) org=${String(pd.organization).slice(0, 40)}`);
      console.log(`    part committees: ${Array.isArray(pd.committees) ? "EMBEDDED" : pd.committees ? "SUB {count,url}" : "ABSENT"} → ${pc.committees.map((c) => `${c.systemCode}:${c.name}`).join(" | ") || "—"}`);
      console.log(`    --- PART detail (trunc 2.5k) ---\n${trunc(pd)}`);
    }
  }

  // ============================================================
  // B. CIVILIAN COMMITTEE-REFERRAL RESOLUTION (Q2 — the GO/NO-GO)
  // ============================================================
  console.log("\n\n=== B. CIVILIAN COMMITTEE-REFERRAL RESOLUTION (Q2) ===");
  // deterministic even-step sample across organization (no RANDOM), on the
  // part-keyed rows (the record the surface links). Multi-part rows dominate the
  // corpus so the spread carries them naturally.
  const seedable = rows.filter((r) => r.url).sort((a, b) =>
    (a.organization ?? "").localeCompare(b.organization ?? "") || a.pn - b.pn || a.part.localeCompare(b.part),
  );
  const pick = <T,>(arr: T[], n: number): T[] => {
    if (arr.length <= n) return arr;
    const step = arr.length / n;
    return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]!);
  };
  const sample = pick(seedable, Math.min(TALLY_SAMPLE, seedable.length));
  console.log(`sampling ${sample.length} civilian part-rows (even-step across organization)`);

  let withReferral = 0, resolved = 0, fetched = 0, subResourceCount = 0;
  const cardinality = new Map<number, number>(); // #committees on a row -> count
  const seenCodes = new Map<string, { name: string; count: number; resolved: boolean }>();
  let recordedVotesSeen = 0;

  for (const row of sample) {
    let d: Detail;
    try {
      d = (await fetchJson<{ nomination?: Detail }>(withKey(row.url))).nomination ?? {};
    } catch (e) {
      console.warn(`\n  detail fail ${row.citation}: ${(e as Error).message}`);
      continue;
    }
    fetched++;
    const { committees, subFetch } = await resolveCommittees(d);
    if (subFetch) subResourceCount++;
    cardinality.set(committees.length, (cardinality.get(committees.length) ?? 0) + 1);
    if (committees.length > 0) {
      withReferral++;
      let anyResolved = false;
      for (const c of committees) {
        const code = c.systemCode ?? "(none)";
        const isRes = committeeSet.has(code);
        anyResolved = anyResolved || isRes;
        const e = seenCodes.get(code) ?? { name: c.name ?? "?", count: 0, resolved: isRes };
        e.count++;
        seenCodes.set(code, e);
      }
      if (anyResolved) resolved++;
    }
    if (Array.isArray(d.latestAction?.recordedVotes) && d.latestAction!.recordedVotes!.length > 0) recordedVotesSeen++;
    process.stdout.write(".");
  }
  console.log("");

  console.log(`\n  referral presence: ${withReferral}/${fetched} rows carry ≥1 committee (${pct(withReferral, fetched)})`);
  console.log(`  resolution: of those, ${resolved} resolve ≥1 code to tracked committees (${pct(resolved, withReferral)} of referred; ${pct(resolved, fetched)} of sampled)`);
  console.log(`  committees field shape: sub-resource fetch needed on ${subResourceCount}/${fetched} rows (${pct(subResourceCount, fetched)}) → ${subResourceCount === 0 ? "EMBEDDED (1 fetch/row)" : subResourceCount === fetched ? "SUB-RESOURCE (2 fetches/row)" : "MIXED"}`);
  console.log(`  recordedVotes on latestAction: ${recordedVotesSeen}/${fetched}`);
  console.log(`\n  cardinality (# committees per row):`);
  for (const [k, v] of [...cardinality.entries()].sort((a, b) => a[0] - b[0])) console.log(`    ${k} committee(s): ${v} row(s)`);
  console.log(`\n  distinct referral committees seen (${seenCodes.size}):`);
  for (const [code, e] of [...seenCodes.entries()].sort((a, b) => b[1].count - a[1].count)) {
    console.log(`    ×${e.count}  ${code}  ${e.resolved ? "[RESOLVES]" : "[UNRESOLVED ⚠]"}  ${e.name.slice(0, 55)}`);
  }
  const unresolvedCodes = [...seenCodes.entries()].filter(([, e]) => !e.resolved && e.count > 0);
  if (unresolvedCodes.length) {
    console.log(`\n  ⚠ UNRESOLVED codes (referred-to but absent from tracked committees — a silent-drop gap):`);
    for (const [code, e] of unresolvedCodes) console.log(`    ${code} (${e.name}) ×${e.count} — ${/^ss[a-z]{2}\d{2}$/.test(code) ? "looks like a real Senate committee (sync:committees gap)" : "malformed / non-Senate"}`);
  } else {
    console.log(`\n  ✓ no unresolved codes — every referral committee is tracked`);
  }

  // ============================================================
  // C. HYDRATION COST (Q3 — mechanism-setter)
  // ============================================================
  console.log("\n\n=== C. HYDRATION COST (Q3) ===");
  const sorted = [...fetchMs].sort((a, b) => a - b);
  const mean = sorted.reduce((s, x) => s + x, 0) / (sorted.length || 1);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] ?? 0;
  const fetchesPerRow = subResourceCount === 0 ? 1 : subResourceCount === fetched ? 2 : 1 + subResourceCount / fetched;
  console.log(`  measured fetches: ${fetchMs.length} total  ·  network latency mean=${mean.toFixed(0)}ms  p90=${p90.toFixed(0)}ms  (pace +120ms/fetch)`);
  console.log(`  fetches per civilian row: ${fetchesPerRow.toFixed(2)} (${subResourceCount === 0 ? "committees embedded" : "committees sub-resource"})`);
  const N = rows.length; // ~830 civilian part-rows
  const projMs = N * fetchesPerRow * (mean + 120);
  console.log(`  projected full hydration (${N} civ rows × ${fetchesPerRow.toFixed(2)} fetch × (${mean.toFixed(0)}ms net + 120ms pace)) ≈ ${(projMs / 1000).toFixed(0)}s (${(projMs / 60000).toFixed(1)} min)`);
  console.log(`  verdict: ${projMs < 240000 ? "fits a 300s cron step AND a CLI backfill" : "too long for one 300s route — CLI backfill or cron-chunked incremental"}`);

  // Rider — military nomineeCount shape (one-liner, no corpus walk)
  console.log("\n  --- rider: military nomineeCount shape (secondary, not the decision) ---");
  const milRow = (await db.execute("SELECT pn_number, raw_json FROM nominations WHERE is_military=1 AND raw_json IS NOT NULL LIMIT 1")).rows[0];
  if (milRow) {
    let murl = "";
    try { murl = String(JSON.parse(String(milRow.raw_json)).url ?? ""); } catch { /* */ }
    if (murl) {
      const md = (await fetchJson<{ nomination?: Detail }>(withKey(murl))).nomination ?? {};
      const embedded = Array.isArray(md.nominees);
      const nomShape = embedded ? "EMBEDDED array" : md.nominees && typeof md.nominees === "object" ? `SUB {count=${(md.nominees as { count?: number }).count},url}` : "ABSENT";
      // military headcount lives in nominees[].nomineeCount (a "following named officers" batch is one element with a big count)
      const summed = embedded ? (md.nominees as Array<{ nomineeCount?: number }>).reduce((s, n) => s + (typeof n.nomineeCount === "number" ? n.nomineeCount : 1), 0) : undefined;
      console.log(`  military PN${milRow.pn_number}: nominees=${nomShape}  Σnominees[].nomineeCount=${summed ?? "—"} → ${embedded ? "summable on the SAME detail walk (no extra fetch) — 459 can fold military nominee_count in cheaply" : "sub-resource; would need an extra fetch, defer"}`);
    }
  }

  db.close();
}

main().catch((e) => {
  console.error(`probe failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
