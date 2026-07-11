// HO 446 read-only amendments source probe. Measures field shape, corpus size,
// amendedBill vs amendedAmendment resolution, and action vocabulary for the
// 119th Congress amendment corpus. NO writes, NO schema, NO sync — sibling to
// lda-lobbying-probe-434.ts. The GO/NO-GO for the amendments pillar (HO 447).
//
//   npx tsx scripts/diagnostic/amendments-probe-446.ts
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
const PAGE_SIZE = 250;
const TYPES = ["hamdt", "samdt", "suamdt"] as const;

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");

// 429-backoff mirroring fetchJson in lib/sync.ts, plus light pacing so a ~55-call
// probe never trips the anon/throttle path.
async function fetchJson<T>(url: string, attempt = 0): Promise<T> {
  await new Promise((r) => setTimeout(r, 120));
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 429 && attempt < 3) {
    const wait = 2000 * (attempt + 1);
    console.warn(`  rate limited, sleeping ${wait}ms`);
    await new Promise((r) => setTimeout(r, wait));
    return fetchJson<T>(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

type ListItem = { congress: number; type: string; number: string; url?: string; latestAction?: { text?: string }; description?: string };
type AmendedRef = { congress: number; type: string; number: string | number; title?: string };
type Detail = {
  congress: number;
  type: string;
  number: string;
  amendedBill?: AmendedRef;
  amendedAmendment?: AmendedRef;
  latestAction?: { actionDate?: string; text?: string };
  purpose?: string;
  description?: string;
  sponsors?: { bioguideId?: string; fullName?: string }[];
  cosponsors?: { count?: number };
  actions?: { count?: number; url?: string };
  amendmentsToAmendment?: { count?: number };
};

const listUrl = (type: string, offset: number, limit: number) =>
  `${API}/amendment/${CONGRESS}/${type}?limit=${limit}&offset=${offset}&format=json&api_key=${KEY}`;
const detailUrl = (type: string, number: string | number) =>
  `${API}/amendment/${CONGRESS}/${String(type).toLowerCase()}/${number}?format=json&api_key=${KEY}`;
const billId = (r: AmendedRef) => `${r.congress}-${String(r.type).toLowerCase()}-${r.number}`;

// ---------------------------------------------------------------------------
console.log(`=== HO 446 amendments probe (Congress ${CONGRESS}) ===\n`);

// 1. Corpus size + type split (cheap: limit=1, read pagination.count per type).
console.log("=== corpus size + type split ===");
const counts: Record<string, number> = {};
for (const t of TYPES) {
  const r = await fetchJson<{ pagination?: { count?: number }; amendments?: ListItem[] }>(listUrl(t, 0, 1));
  counts[t] = r.pagination?.count ?? 0;
  console.log(`  ${t.toUpperCase()}: ${counts[t]}  (list-item keys: ${Object.keys(r.amendments?.[0] ?? {}).join(",") || "—"})`);
}
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`  TOTAL: ${total}`);

// 2. Stratified sample: low + high numbers across the populated types (lifecycle
//    variety — freshly-submitted vs. long-disposed). SUAMDT is 0 in the 119th,
//    so the sample naturally collapses to HAMDT + SAMDT; per-type sizes scale to
//    roughly the corpus mix while guaranteeing HAMDT representation.
const PLAN: Record<string, { low: number; high: number }> = {
  hamdt: { low: 6, high: 6 },
  samdt: { low: 14, high: 14 },
  suamdt: { low: 0, high: 0 },
};
const sample: ListItem[] = [];
for (const t of TYPES) {
  const n = counts[t];
  if (!n) continue;
  const { low, high } = PLAN[t] ?? { low: 0, high: 0 };
  if (low) {
    const r = await fetchJson<{ amendments?: ListItem[] }>(listUrl(t, 0, low));
    sample.push(...(r.amendments ?? []));
  }
  if (high && n > low) {
    const off = Math.max(low, n - high);
    const r = await fetchJson<{ amendments?: ListItem[] }>(listUrl(t, off, high));
    sample.push(...(r.amendments ?? []));
  }
}
console.log(`\n=== stratified sample: ${sample.length} amendments (detail-hydrating each) ===`);

// 3. Hydrate details.
const details: Detail[] = [];
const fieldPresence: Record<string, number> = {};
for (const it of sample) {
  const d = (await fetchJson<{ amendment?: Detail }>(detailUrl(it.type, it.number))).amendment;
  if (!d) continue;
  details.push(d);
  for (const k of Object.keys(d)) fieldPresence[k] = (fieldPresence[k] ?? 0) + 1;
}
const N = details.length;

console.log("\n=== detail field presence across sample (n=" + N + ") ===");
Object.entries(fieldPresence)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`  ${k}: ${v}/${N} = ${pct(v, N)}`));

// 4. Join reality: amendedBill vs amendedAmendment vs neither, then resolve
//    amendedBill against the live bills table.
let hasBill = 0, hasAmend = 0, neither = 0;
const constructedIds = new Set<string>();
const billTypeCounts: Record<string, number> = {};
for (const d of details) {
  if (d.amendedBill) {
    hasBill++;
    const id = billId(d.amendedBill);
    constructedIds.add(id);
    const bt = String(d.amendedBill.type).toLowerCase();
    billTypeCounts[bt] = (billTypeCounts[bt] ?? 0) + 1;
  } else if (d.amendedAmendment) {
    hasAmend++;
  } else {
    neither++;
  }
}

// Resolve constructed IDs against live bills.
const ids = [...constructedIds];
const resolved = new Set<string>();
for (let i = 0; i < ids.length; i += 200) {
  const chunk = ids.slice(i, i + 200);
  const ph = chunk.map(() => "?").join(",");
  const rs = await db.execute({ sql: `SELECT id FROM bills WHERE id IN (${ph})`, args: chunk });
  rs.rows.forEach((r) => resolved.add(r.id as string));
}

console.log("\n=== JOIN REALITY (the load-bearing number) ===");
console.log(`  amendedBill present:      ${hasBill}/${N} = ${pct(hasBill, N)}`);
console.log(`  amendedAmendment present: ${hasAmend}/${N} = ${pct(hasAmend, N)}`);
console.log(`  neither:                  ${neither}/${N} = ${pct(neither, N)}`);
console.log(`  distinct amendedBill IDs: ${ids.length}`);
console.log(`  ...resolving to a tracked bills row: ${resolved.size}/${ids.length} = ${pct(resolved.size, ids.length)}`);
console.log("  amendedBill target-type split:");
Object.entries(billTypeCounts)
  .sort((a, b) => b[1] - a[1])
  .forEach(([k, v]) => console.log(`    ${k}: ${v}  (resolved sample below)`));
const unresolved = ids.filter((id) => !resolved.has(id));
if (unresolved.length) console.log(`  UNRESOLVED IDs (${unresolved.length}): ${unresolved.slice(0, 15).join(", ")}`);

// 5. Action / status vocabulary. Top-level latestAction where present; else walk
//    the actions sub-resource (SAMDT details omit top-level latestAction, so the
//    Senate corpus needs the sub-resource to expose status phrasing).
console.log("\n=== action / status vocabulary ===");
const topLevelText = new Set<string>();
for (const d of details) if (d.latestAction?.text) topLevelText.add(d.latestAction.text.trim());
console.log(`  distinct top-level latestAction.text (${topLevelText.size}):`);
[...topLevelText].slice(0, 30).forEach((t) => console.log(`    • ${t.slice(0, 140)}`));

// Walk actions sub-resource for up to 8 amendments — bias toward those lacking a
// top-level latestAction (the Senate case) so we see raw disposition phrasing.
const walkTargets = [
  ...details.filter((d) => !d.latestAction?.text),
  ...details.filter((d) => d.latestAction?.text),
].slice(0, 8);
const actionText = new Set<string>();
for (const d of walkTargets) {
  if (!d.actions?.url) continue;
  const url = d.actions.url.includes("api_key=") ? d.actions.url : `${d.actions.url}${d.actions.url.includes("?") ? "&" : "?"}api_key=${KEY}`;
  try {
    const r = await fetchJson<{ actions?: { text?: string; type?: string }[] }>(url);
    (r.actions ?? []).forEach((a) => a.text && actionText.add(a.text.trim()));
  } catch (e) {
    console.log(`    (actions walk failed for ${d.type}/${d.number}: ${(e as Error).message.slice(0, 80)})`);
  }
}
console.log(`\n  distinct actions[].text from ${walkTargets.length} walked sub-resources (${actionText.size}):`);
[...actionText].slice(0, 40).forEach((t) => console.log(`    • ${t.slice(0, 140)}`));

// 6. Verbatim detail dumps — 2-3 full JSONs so the real field set is inspectable.
console.log("\n=== verbatim detail dumps ===");
const dumpBill = details.find((d) => d.amendedBill);
const dumpAmend = details.find((d) => d.amendedAmendment);
const dumpNeither = details.find((d) => !d.amendedBill && !d.amendedAmendment);
for (const [label, d] of [["amendedBill", dumpBill], ["amendedAmendment", dumpAmend], ["neither", dumpNeither]] as const) {
  if (!d) { console.log(`\n--- (${label}: none in sample) ---`); continue; }
  console.log(`\n--- ${d.type} ${d.number} (${label}) ---`);
  console.log(JSON.stringify(d, null, 2));
}

// 7. Backfill cost sizing.
console.log("\n=== backfill cost sizing ===");
const listPages = Object.values(counts).reduce((a, c) => a + Math.ceil(c / PAGE_SIZE), 0);
console.log(`  list pages (typed sweep @${PAGE_SIZE}): ${listPages}  [hamdt ${Math.ceil((counts.hamdt ?? 0) / PAGE_SIZE)}, samdt ${Math.ceil((counts.samdt ?? 0) / PAGE_SIZE)}, suamdt ${Math.ceil((counts.suamdt ?? 0) / PAGE_SIZE)}]`);
console.log(`  detail fetches to hydrate every amendment: ${total}`);
console.log(`  list-only requests:                        ${listPages}`);
console.log(`  full hydrate (list + detail):              ${listPages + total} requests`);
console.log(`  NOTE: amendedBill/sponsors are detail-only — a bill-linked surface REQUIRES detail hydration (${total} fetches).`);
console.log(`  Congress.gov default cap is ~5000 req/hr; ~${listPages + total} sequential fetches at ~150ms ≈ ${Math.round(((listPages + total) * 0.15) / 60)} min wall — exceeds one 300s cron ⇒ resumable DB-frontier framing (like sync:lda).`);

process.exit(0);
