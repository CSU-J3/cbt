import "dotenv/config";
import { createClient } from "@libsql/client";
import { extractBillIds } from "../../lib/bill-id-extract";
import { getCurrentCongress } from "../../lib/congress";

const db = createClient({ url: process.env.TURSO_DATABASE_URL!, authToken: process.env.TURSO_AUTH_TOKEN });
const BASE = "https://lda.gov/api/v1";

type Activity = { general_issue_code: string; general_issue_code_display: string; description: string | null };
type Filing = { filing_uuid: string; filing_type_display: string; lobbying_activities: Activity[] };

async function pull(filingType: string, pages: number): Promise<Filing[]> {
  const out: Filing[] = [];
  for (let p = 1; p <= pages; p++) {
    await new Promise((res) => setTimeout(res, 800)); // pace to avoid anon throttle/RST
    const url = `${BASE}/filings/?filing_year=2025&filing_type=${filingType}&page=${p}&page_size=250`;
    let r: Response;
    try { r = await fetch(url, { headers: { Accept: "application/json" } }); }
    catch (e) { console.log(`  ${filingType} p${p}: network error ${(e as Error).message}, backing off 30s`); await new Promise((res) => setTimeout(res, 30000)); try { r = await fetch(url, { headers: { Accept: "application/json" } }); } catch { console.log("  still failing, stopping"); break; } }
    console.log(`  ${filingType} p${p}: HTTP ${r.status} ratelimit-remaining=${r.headers.get("x-ratelimit-remaining") ?? r.headers.get("ratelimit-remaining") ?? "?"} retry-after=${r.headers.get("retry-after") ?? "-"}`);
    if (r.status === 429) { console.log(`  THROTTLED, backing off 60s once...`); await new Promise((res) => setTimeout(res, 60000)); const r2 = await fetch(url, { headers: { Accept: "application/json" } }); if (!r2.ok) { console.log(`  still ${r2.status}, stopping ${filingType}`); break; } const j2 = await r2.json() as { results: Filing[] }; out.push(...j2.results); continue; }
    if (!r.ok) { console.log(`  stopping ${filingType}`); break; }
    const j = await r.json() as { results: Filing[] };
    out.push(...j.results);
  }
  return out;
}

console.log("Pulling LD-2 sample (Q1+Q2 2025, up to 2 pages each = ~400 filings)...");
const filings = [...await pull("Q1", 7), ...await pull("Q2", 7)];
console.log(`Pulled ${filings.length} filings\n`);

// Join test
let filingsWithBill = 0, activitiesTotal = 0, activitiesWithBill = 0;
const allIds = new Set<string>();
const idsPerFiling: string[][] = [];
const issueCodeCounts: Record<string, number> = {};

for (const f of filings) {
  const filingIds = new Set<string>();
  for (const a of f.lobbying_activities || []) {
    activitiesTotal++;
    issueCodeCounts[a.general_issue_code] = (issueCodeCounts[a.general_issue_code] || 0) + 1;
    const ids = extractBillIds(a.description || "");
    if (ids.length) activitiesWithBill++;
    ids.forEach((id) => { filingIds.add(id); allIds.add(id); });
  }
  if (filingIds.size) filingsWithBill++;
  idsPerFiling.push([...filingIds]);
}

// Join to bills
const uniqueIds = [...allIds];
let joined = 0;
const joinedIds = new Set<string>();
const CH = 200;
for (let i = 0; i < uniqueIds.length; i += CH) {
  const chunk = uniqueIds.slice(i, i + CH);
  const ph = chunk.map(() => "?").join(",");
  const rs = await db.execute({ sql: `SELECT id FROM bills WHERE id IN (${ph})`, args: chunk });
  rs.rows.forEach((r) => { joined++; joinedIds.add(r.id as string); });
}

const pct = (n: number, d: number) => d ? ((100 * n) / d).toFixed(1) + "%" : "n/a";
console.log(`Current congress: ${getCurrentCongress()}`);
console.log("=== JOIN TEST ===");
console.log(`Filings with >=1 parseable bill ID: ${filingsWithBill}/${filings.length} = ${pct(filingsWithBill, filings.length)}`);
console.log(`Activities with >=1 bill ID:        ${activitiesWithBill}/${activitiesTotal} = ${pct(activitiesWithBill, activitiesTotal)}`);
console.log(`Unique extracted IDs:               ${uniqueIds.length}`);
console.log(`  ...that join to a bills row:      ${joinedIds.size}/${uniqueIds.length} = ${pct(joinedIds.size, uniqueIds.length)}`);

console.log("\n=== top issue codes in sample ===");
Object.entries(issueCodeCounts).sort((a,b)=>b[1]-a[1]).slice(0,12).forEach(([k,v])=>console.log(`  ${k}: ${v}`));

console.log("\n=== 12 bill-CITING specific-issue texts (hand-read) ===");
let shownBill = 0;
for (const f of filings) {
  for (const a of f.lobbying_activities || []) {
    if (shownBill >= 12) break;
    const d = (a.description || "").replace(/\s+/g, " ").trim();
    const ids = extractBillIds(d);
    if (!ids.length) continue;
    console.log(`\n[${a.general_issue_code}] ids=${JSON.stringify(ids)} joined=${ids.filter((i)=>joinedIds.has(i))}`);
    console.log(`  "${d.slice(0, 360)}"`);
    shownBill++;
  }
  if (shownBill >= 12) break;
}

// Bare-title / acronym references the regex CAN'T catch (Act/bill words, no number)
console.log("\n=== texts naming an 'Act' but with NO parseable bill ID (missed by regex) ===");
let shownMiss = 0;
for (const f of filings) {
  for (const a of f.lobbying_activities || []) {
    if (shownMiss >= 8) break;
    const d = (a.description || "").replace(/\s+/g, " ").trim();
    if (!d || extractBillIds(d).length) continue;
    if (!/\bAct\b/.test(d)) continue;
    console.log(`\n[${a.general_issue_code}]  "${d.slice(0, 300)}"`);
    shownMiss++;
  }
  if (shownMiss >= 8) break;
}
process.exit(0);
