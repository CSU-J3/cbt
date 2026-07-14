// HO 454 read-only nominations source probe. Characterizes the 119th-Congress
// PN corpus for a candidate new pillar: volume, civilian-vs-military split (two
// axes: PN count + nominee count), the committee-referral join onto tracked
// `committees`, organization cardinality, nominee-ID absence, recordedVotes, and
// latestAction disposition coverage. NO writes, NO schema, NO sync — sibling to
// amendments-probe-446.ts. The GO/NO-GO for the nominations pillar (HO 455+).
//
//   npx tsx scripts/diagnostic/nominations-source-probe-454.ts
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
const PAGE = 250;
const DETAIL_SAMPLE = 80;

const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchJson<T>(url: string, attempt = 0): Promise<T> {
  await sleep(120);
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (res.status === 429 && attempt < 3) {
    const wait = 2000 * (attempt + 1);
    console.warn(`  rate limited, sleeping ${wait}ms`);
    await sleep(wait);
    return fetchJson<T>(url, attempt + 1);
  }
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

// Loose shapes — the raw dumps are the authority; these just type the fields we tally.
interface ListItem {
  number?: number;
  citation?: string;
  description?: string;
  organization?: string;
  receivedDate?: string;
  updateDate?: string;
  nominationType?: { isCivilian?: boolean; isMilitary?: boolean };
  latestAction?: { actionDate?: string; text?: string };
  url?: string;
  [k: string]: unknown;
}
interface Committee { systemCode?: string; name?: string; chamber?: string; url?: string }
interface Nominee { ordinal?: number; firstName?: string; lastName?: string; nomineeCount?: number; positionTitle?: string; [k: string]: unknown }
interface Detail {
  number?: number;
  isList?: boolean;
  citation?: string;
  description?: string;
  organization?: string;
  receivedDate?: string;
  nominationType?: { isCivilian?: boolean; isMilitary?: boolean };
  nominees?: Nominee[] | { count?: number; url?: string };
  committees?: Committee[] | { count?: number; url?: string };
  latestAction?: { actionDate?: string; text?: string; recordedVotes?: unknown[] };
  actions?: { count?: number; url?: string };
  [k: string]: unknown;
}

const listUrl = (offset: number, limit: number, extra = "") =>
  `${API}/nomination/${CONGRESS}?limit=${limit}&offset=${offset}&format=json&api_key=${KEY}${extra}`;
const detailUrl = (number: number) =>
  `${API}/nomination/${CONGRESS}/${number}?format=json&api_key=${KEY}`;

// Military heuristic on list-level fields (a fallback if no clean boolean is
// list-level). The detail sample's nominationType.isMilitary / isList is ground
// truth; this lets us classify corpus-wide cheaply IF it agrees.
const MIL_ORG_RE = /army|navy|air force|marine|space force|coast guard|armed forces|military|national guard|public health service|foreign service|national oceanic/i;
const MIL_DESC_RE = /the following named officers?|to be (general|admiral|colonel|major|captain|lieutenant|brigadier|commander|ensign)/i;
function looksMilitaryListLevel(it: ListItem): boolean {
  if (it.nominationType?.isMilitary === true) return true;
  if (it.nominationType?.isCivilian === true) return false;
  if (it.organization && MIL_ORG_RE.test(it.organization)) return true;
  if (it.description && MIL_DESC_RE.test(it.description)) return true;
  return false;
}

async function main() {
  console.log(`=== HO 454 nominations source probe (Congress ${CONGRESS}) ===\n`);

  // ---------- A. VOLUME & LIST SHAPE ----------
  console.log("=== A. VOLUME & LIST SHAPE ===");
  const head = await fetchJson<{ pagination?: { count?: number }; nominations?: ListItem[] }>(listUrl(0, 3));
  const total = head.pagination?.count ?? 0;
  console.log(`119th PN count (pagination.count): ${total}`);
  console.log(`list-item keys: ${Object.keys(head.nominations?.[0] ?? {}).join(", ") || "—"}`);
  console.log("\n--- raw list items (first 3) ---");
  console.log(JSON.stringify(head.nominations?.slice(0, 3), null, 2));

  // Param support test (for a future resumable frontier sync mirroring sync:amendments)
  console.log("\n--- param support: fromDateTime + sort=updateDate asc ---");
  try {
    const sorted = await fetchJson<{ nominations?: ListItem[] }>(
      listUrl(0, 5, `&fromDateTime=2025-01-01T00:00:00Z&sort=updateDate+asc`),
    );
    const dates = (sorted.nominations ?? []).map((n) => n.updateDate ?? "");
    const ascending = dates.every((d, i) => i === 0 || d >= dates[i - 1]!);
    console.log(`  returned ${dates.length} items; updateDates ascending? ${ascending}`);
    console.log(`  first updateDates: ${dates.slice(0, 5).join(" | ")}`);
  } catch (e) {
    console.log(`  fromDateTime/sort NOT honored (or error): ${(e as Error).message}`);
  }

  // ---------- Full-list pagination (list-level corpus-wide) ----------
  console.log("\n=== paginating full list (list-level fields) ===");
  const items: ListItem[] = [];
  for (let offset = 0; offset < total; offset += PAGE) {
    const pageRes = await fetchJson<{ nominations?: ListItem[] }>(listUrl(offset, PAGE));
    const batch = pageRes.nominations ?? [];
    items.push(...batch);
    process.stdout.write(`\r  collected ${items.length}/${total}`);
    if (batch.length === 0) break;
  }
  console.log(`\n  collected ${items.length} list items`);
  const listHasMilBool = items.some((it) => it.nominationType?.isMilitary != null || it.nominationType?.isCivilian != null);

  // ---------- B. CIVILIAN vs MILITARY — PN-count split (list-level) ----------
  console.log("\n=== B. CIVILIAN vs MILITARY — PN-count split (list-level heuristic) ===");
  console.log(`list-level nominationType.isMilitary/isCivilian present? ${listHasMilBool}`);
  let milPN = 0, civPN = 0;
  for (const it of items) (looksMilitaryListLevel(it) ? milPN++ : civPN++);
  console.log(`  military PNs: ${milPN} (${pct(milPN, items.length)})`);
  console.log(`  civilian PNs: ${civPN} (${pct(civPN, items.length)})`);
  console.log(`  (classifier: ${listHasMilBool ? "nominationType boolean where present, else" : ""} org/description regex fallback)`);

  // ---------- Detail sample (stratified civ/mil) ----------
  console.log(`\n=== sampling ${DETAIL_SAMPLE} details (stratified civ/mil) ===`);
  const mils = items.filter(looksMilitaryListLevel);
  const civs = items.filter((it) => !looksMilitaryListLevel(it));
  const pick = <T,>(arr: T[], n: number): T[] => {
    // even spread (deterministic, no RANDOM dependency)
    if (arr.length <= n) return arr;
    const step = arr.length / n;
    return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]!);
  };
  const sampleCiv = pick(civs, Math.min(DETAIL_SAMPLE / 2, civs.length));
  const sampleMil = pick(mils, DETAIL_SAMPLE - sampleCiv.length);
  const sample = [...sampleCiv.map((it) => ({ it, mil: false })), ...sampleMil.map((it) => ({ it, mil: true }))];

  // committees set for the join
  const cteRows = (await db.execute("SELECT system_code FROM committees")).rows;
  const committeeSet = new Set(cteRows.map((r) => String(r.system_code)));
  console.log(`  tracked committees.system_code: ${committeeSet.size}`);

  const rawDetails: string[] = [];
  const orgCardinality = new Set<string>();
  const orgCounts = new Map<string, number>();
  const dispVocab = new Map<string, number>();
  let dispPresent = 0, detailFetched = 0;
  let nomineeBioguideSeen = false; // does ANY nominee carry a bioguide-style id?
  const nomineeKeys = new Set<string>();
  let recordedVotesSeen = 0;
  // committee join accounting
  const join = {
    civ: { withReferral: 0, resolved: 0, n: 0 },
    mil: { withReferral: 0, resolved: 0, n: 0 },
  };
  // nominee-count split
  let civNominees = 0, milNominees = 0, civDetailN = 0, milDetailN = 0;
  let isListTrue = 0;

  for (const { it, mil } of sample) {
    if (it.number == null) continue;
    let d: Detail;
    try {
      d = (await fetchJson<{ nomination?: Detail }>(detailUrl(it.number))).nomination ?? {};
    } catch (e) {
      console.warn(`\n  detail fail PN${it.number}: ${(e as Error).message}`);
      continue;
    }
    detailFetched++;
    if (rawDetails.length < 3) rawDetails.push(`--- PN ${it.number} (${mil ? "mil?" : "civ?"}) ---\n${JSON.stringify(d, null, 2).slice(0, 2200)}`);
    if (d.isList === true) isListTrue++;

    // organization
    const org = d.organization ?? it.organization ?? "(none)";
    orgCardinality.add(org);
    orgCounts.set(org, (orgCounts.get(org) ?? 0) + 1);

    // disposition
    const disp = d.latestAction?.text ?? it.latestAction?.text ?? null;
    if (disp) {
      dispPresent++;
      const norm = disp.replace(/\s+\d.*$/, "").slice(0, 60); // strip trailing vote counts/dates
      dispVocab.set(norm, (dispVocab.get(norm) ?? 0) + 1);
    }
    if (Array.isArray(d.latestAction?.recordedVotes) && d.latestAction!.recordedVotes!.length > 0) recordedVotesSeen++;

    // nominees (embedded array of positions with nomineeCount; else sub-resource url)
    let nominees: Nominee[] = [];
    if (Array.isArray(d.nominees)) nominees = d.nominees;
    else if (d.nominees && typeof d.nominees === "object" && "url" in d.nominees && (d.nominees as { url?: string }).url) {
      try {
        const u = (d.nominees as { url: string }).url;
        const sub = await fetchJson<{ nominees?: Nominee[] }>(`${u}${u.includes("?") ? "&" : "?"}api_key=${KEY}`);
        nominees = sub.nominees ?? [];
      } catch { /* leave empty */ }
    }
    let nomineeTotal = 0;
    for (const nm of nominees) {
      nomineeTotal += typeof nm.nomineeCount === "number" ? nm.nomineeCount : 1;
      for (const k of Object.keys(nm)) nomineeKeys.add(k);
      if (Object.keys(nm).some((k) => /bioguide/i.test(k))) nomineeBioguideSeen = true;
    }
    // ground-truth mil from detail if present
    const truthMil = d.nominationType?.isMilitary ?? mil;
    if (truthMil) { milNominees += nomineeTotal; milDetailN++; } else { civNominees += nomineeTotal; civDetailN++; }

    // committee referral (embedded array OR sub-resource url)
    let committees: Committee[] = [];
    if (Array.isArray(d.committees)) committees = d.committees;
    else if (d.committees && typeof d.committees === "object" && "url" in d.committees && (d.committees as { url?: string }).url) {
      try {
        const sub = await fetchJson<{ committees?: Committee[] }>(
          `${(d.committees as { url: string }).url}${(d.committees as { url: string }).url.includes("?") ? "&" : "?"}api_key=${KEY}`,
        );
        committees = sub.committees ?? [];
      } catch { /* leave empty */ }
    }
    const bucket = truthMil ? join.mil : join.civ;
    bucket.n++;
    if (committees.length > 0) {
      bucket.withReferral++;
      if (committees.some((c) => c.systemCode && committeeSet.has(c.systemCode))) bucket.resolved++;
    }

    process.stdout.write(".");
  }
  console.log("");

  // ---------- raw details ----------
  console.log("\n--- raw details (first 3, truncated 2.2k) ---");
  for (const r of rawDetails) console.log(r + "\n");

  // ---------- B2. nominee-count split ----------
  console.log("=== B2. NOMINEE-COUNT split (detail sample, projected) ===");
  const civAvg = civDetailN ? civNominees / civDetailN : 0;
  const milAvg = milDetailN ? milNominees / milDetailN : 0;
  console.log(`  sample: civ ${civDetailN} PNs → ${civNominees} nominees (avg ${civAvg.toFixed(1)}/PN)`);
  console.log(`  sample: mil ${milDetailN} PNs → ${milNominees} nominees (avg ${milAvg.toFixed(1)}/PN)`);
  console.log(`  isList=true in sample: ${isListTrue}/${detailFetched}`);
  console.log(
    `  PROJECTED corpus nominees: civ ~${Math.round(civAvg * civPN)} (${civPN} PNs) · ` +
      `mil ~${Math.round(milAvg * milPN)} (${milPN} PNs) — the magnet: ${milPN} military PNs carry the bulk of nominee headcount`,
  );

  // ---------- C. JOIN PROFILE ----------
  console.log("\n=== C. JOIN PROFILE ===");
  const jr = (b: { withReferral: number; resolved: number; n: number }) =>
    `n=${b.n}  has-referral=${b.withReferral} (${pct(b.withReferral, b.n)})  resolves-to-committees=${b.resolved} (${pct(b.resolved, b.n)})`;
  console.log(`  committee referral → committees.system_code:`);
  console.log(`    civilian: ${jr(join.civ)}`);
  console.log(`    military: ${jr(join.mil)}`);
  console.log(`\n  organization cardinality (sample): ${orgCardinality.size} distinct`);
  const topOrgs = [...orgCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  for (const [o, c] of topOrgs) console.log(`    ×${c}  ${o.slice(0, 70)}`);
  console.log(`\n  nominee identity: bioguide-style ID on any nominee? ${nomineeBioguideSeen ? "YES (unexpected — member-spine join possible)" : "NO (name fields only → no member-spine join; the weaker-join premise holds)"}`);
  console.log(`    nominee object keys seen: ${[...nomineeKeys].sort().join(", ") || "(no nominees in sample details)"}`);
  console.log(`  recordedVotes on latestAction (nominee→Senate-vote link): ${recordedVotesSeen}/${detailFetched} details`);

  // ---------- D. DISPOSITION COVERAGE ----------
  console.log("\n=== D. DISPOSITION COVERAGE (the amendments contrast) ===");
  console.log(`  latestAction present: ${dispPresent}/${detailFetched} (${pct(dispPresent, detailFetched)})  [amendments top-level was 8.6%]`);
  console.log("  vocabulary (normalized, by frequency):");
  const vocab = [...dispVocab.entries()].sort((a, b) => b[1] - a[1]);
  for (const [text, count] of vocab) console.log(`    ×${count}  ${text}`);

  db.close();
}

main().catch((e) => {
  console.error(`probe failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
