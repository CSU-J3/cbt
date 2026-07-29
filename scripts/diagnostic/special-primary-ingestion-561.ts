// HO 561 STEP 0 — special-primary registry + senate page-availability sweep.
// READ-ONLY. Zero writes (SELECT + GET only). Reports the four blocks that
// scope the special-page ingestion build; HALT condition is called out in S2.
//
//   S1 — seeded special registry (the opt-in set / blast radius).
//   S2 — which SENATE_STATES_2026 serve off the SPECIAL url today (regression
//        surface — FL/OH expected; any such state that ALSO has a seeded
//        -special- row would flip routing and HALTs §3).
//   S3 — the SC special page: status, and if 200 whether a roster/shares exist.
//   S4 — guard interaction, reasoned from the predicate (read, not run).
//
//   npx tsx scripts/diagnostic/special-primary-ingestion-561.ts
import "dotenv/config";
import { createClient, type Client, type Row } from "@libsql/client";
import {
  parseCandidatesPage,
  senatePageUrl,
  senateSpecialPageUrl,
} from "../../lib/primary-candidates-scrape";
import { stateName } from "../../lib/states";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

// Verbatim from lib/primaries-sync.ts:44 (SENATE_STATES_2026 is not exported).
const SENATE_STATES_2026 = [
  "AL", "AK", "AR", "CO", "DE", "GA", "ID", "IL", "IA", "KS",
  "KY", "LA", "ME", "MA", "MI", "MN", "MS", "MT", "NE", "NH",
  "NJ", "NM", "NC", "OK", "OR", "RI", "SC", "SD", "TN", "TX",
  "VA", "WV", "WY",
  "FL", "OH",
];

function s(row: Row | undefined, k: string): string { return String((row as Row)?.[k] ?? ""); }
function num(row: Row | undefined, k: string): number { return Number((row as Row)?.[k] ?? 0); }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function headStatus(url: string): Promise<number> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: controller.signal });
    return res.status;
  } catch {
    return 0; // timeout / network
  } finally {
    clearTimeout(timer);
  }
}

async function main(): Promise<number> {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) { console.log("TURSO_DATABASE_URL not set — run with the CBT .env."); return 1; }
  const db: Client = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });

  // ── S1 — seeded special registry ────────────────────────────────────────
  console.log("══ S1 — seeded special-primary registry (id LIKE senate-%-2026-special-%) ══");
  const reg = (await db.execute(`
    SELECT p.id, p.state, p.party, p.primary_date, p.runoff_date,
           (SELECT COUNT(*) FROM primary_candidates pc WHERE pc.primary_id = p.id) AS roster,
           (SELECT COUNT(*) FROM primary_candidates pc WHERE pc.primary_id = p.id AND pc.vote_pct IS NOT NULL) AS shares
      FROM primaries p WHERE p.id LIKE 'senate-%-2026-special-%' ORDER BY p.id
  `)).rows;
  console.log(`   seeded special rows: ${reg.length}`);
  for (const r of reg) {
    console.log(`   ${s(r, "id").padEnd(28)} state=${s(r, "state")} party=${s(r, "party")} primary=${s(r, "primary_date")} runoff=${s(r, "runoff_date") || "—"} roster=${num(r, "roster")} shares=${num(r, "shares")}`);
  }
  const specialStates = new Set(reg.map((r) => s(r, "state")));
  console.log("");

  // ── S2 — who serves off the SPECIAL url today ───────────────────────────
  console.log("══ S2 — senatePageUrl() availability across SENATE_STATES_2026 (non-200 = served off special) ══");
  const servesOffSpecial: string[] = [];
  for (const abbr of SENATE_STATES_2026) {
    const slug = stateName(abbr).replace(/ /g, "_");
    const st = await headStatus(senatePageUrl(slug));
    if (st !== 200) { servesOffSpecial.push(`${abbr}(${st})`); console.log(`   ${abbr}: ${st}  ← standard page not 200`); }
    await sleep(400);
  }
  console.log(`   states whose standard page is NOT 200 (roster comes off the special page → base ids): ${servesOffSpecial.join(", ") || "none"}`);
  const collide = [...specialStates].filter((st) => servesOffSpecial.some((x) => x.startsWith(st + "(")));
  console.log(`   ⚠ HALT check — states that serve-off-special AND have a seeded -special- row: ${collide.join(", ") || "none"}`);
  console.log(`   ${collide.length === 0 ? "✓ no collision — §3 routing-by-seed is safe" : "⚠⚠ HALT — a seeded state flips routing, needs its own ruling"}`);
  console.log("");

  // ── S3 — the SC special page ────────────────────────────────────────────
  console.log("══ S3 — SC senate special page ══");
  const scUrl = senateSpecialPageUrl("South_Carolina");
  console.log(`   url: ${scUrl}`);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  let status = 0; let html = "";
  try {
    const res = await fetch(scUrl, { headers: { "User-Agent": UA, Accept: "text/html" }, redirect: "follow", signal: controller.signal });
    status = res.status;
    if (res.ok) html = await res.text();
  } catch { status = 0; } finally { clearTimeout(timer); }
  console.log(`   status: ${status}`);
  if (status === 200 && html) {
    const parsed = parseCandidatesPage(html, "SC", scUrl);
    const withShare = parsed.candidates.filter((c) => c.votePct != null).length;
    console.log(`   parse status=${parsed.status} · candidates=${parsed.candidates.length} · with a share=${withShare}`);
    if (parsed.candidates.length > 0) {
      console.log("   ⚠⚠ THE FIELD IS PUBLISHING — this HO shifts from 'build the pipe' to 'build and run it':");
      for (const c of parsed.candidates.slice(0, 20)) console.log(`      [${c.contest}] ${c.name} (${c.party}) votePct=${c.votePct ?? "null"} winner=${c.isWinner}`);
    }
  } else {
    console.log("   → not 200: the field is not yet published (HO 560 saw 404). Pipe ships un-run; C1's 404 skip is the live path.");
  }
  console.log("");

  // ── S4 — guard interaction (reasoned from the predicate, not run) ────────
  console.log("══ S4 — C2 settled-guard interaction with -special- ids (read, not run) ══");
  console.log("   Predicate (HO 560 C2): settled ⇔ primary_date < today AND EXISTS a candidate with vote_pct NOT NULL.");
  console.log("   • A rosterless / shareless -special- row has NO vote_pct-bearing candidate → EXISTS is false");
  console.log("     → NOT settled → the special-page pass is free to write it before results land. ✓");
  console.log("   • Post-Aug-11, once shares land AND primary_date < today → settled=true → it freezes");
  console.log("     like any other decided contest, protected from a later clobber. ✓");
  console.log("   → the same guard serves both phases with no special-casing (HO 561 §3 C1).");
  console.log("");
  console.log("══ SUMMARY ══");
  console.log(`   S1 seeded specials: ${reg.length} (${[...specialStates].join(",")})`);
  console.log(`   S2 serves-off-special: ${servesOffSpecial.join(",") || "none"} · collisions: ${collide.length}`);
  console.log(`   S3 SC special page: HTTP ${status}`);
  return 0;
}

main().then((c) => process.exit(c)).catch((e) => { console.error(e); process.exit(1); });
