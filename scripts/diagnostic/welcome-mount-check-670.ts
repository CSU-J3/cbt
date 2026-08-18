// HO 670 STEP 3.3 — the three-panel mount check. READ-ONLY.
//
// A panel that renders its header and no rows is the failure mode this catches:
// mid-crossfade a screenshot hides it, and a "the page returned 200" assertion
// says nothing about whether nine datasets actually mounted. So: fetch the served
// /welcome HTML, independently re-read each dataset from the DB, and count how
// many of that dataset's REAL row titles appear in the markup.
//
// Controls are part of the run, because a zero is only trustworthy if the
// instrument can produce a non-zero: a string known to be present (the headline)
// must read > 0 and a string known to be absent must read 0.
//
//   npx tsx scripts/diagnostic/welcome-mount-check-670.ts [url]
import { AsyncLocalStorage } from "node:async_hooks";
import "dotenv/config";

(globalThis as Record<string, unknown>).AsyncLocalStorage = AsyncLocalStorage;
(globalThis as Record<string, unknown>).__incrementalCache = {
  isOnDemandRevalidate: false,
  generateCacheKey: async (k: string) => k,
  get: async () => null,
  set: async () => {},
};

// The page renders titles as HTML text, so the needles need the same escaping
// the renderer applies before they can be found in the markup.
function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function count(hay: string, needle: string): number {
  if (needle.length === 0) return 0;
  let n = 0;
  let i = hay.indexOf(needle);
  while (i !== -1) {
    n += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}

async function main() {
  const url = process.argv[2] ?? "http://localhost:3110/welcome";
  const res = await fetch(url);
  const html = await res.text();
  console.log("=".repeat(96));
  console.log(`HO 670 STEP 3.3 — panel mount check against ${url}`);
  console.log(`  status ${res.status} · ${html.length.toLocaleString()} bytes`);
  console.log("=".repeat(96));

  console.log("\n-- controls --");
  const present = count(html, "WTF is going on in Congress?");
  const absent = count(html, "A STRING THAT IS NOT ON THIS PAGE 670");
  console.log(`  known-present headline           ${present}  (expect > 0)`);
  console.log(`  known-absent sentinel            ${absent}  (expect 0)`);
  if (present === 0 || absent !== 0) {
    console.log("  !! CONTROL FAILED — the counts below mean nothing");
  }

  const q = await import("../../lib/queries");
  const [
    movers,
    stalls,
    enacted,
    members,
    lobbying,
    upcoming,
    recentMeetings,
    news,
    races,
    clusters,
  ] = await Promise.all([
    q.getStageChanges({}, 7, 12),
    q.getStaleBills({}, 12),
    q.getFeedBills({ stage: "enacted" }, { page: 1, pageSize: 12 }),
    q.getMembersRanked({}, "volume", 1, 12),
    q.getLobbyingRollup(),
    q.getUpcomingMeetings(),
    q.getRecentMeetings(14),
    q.getBreakingNewsForHome({ limit: 12, hours: 72 }),
    q.getMostCompetitiveRaces(2026, 12),
    q.getClusterStats(),
  ]);

  const seen = new Set<string>();
  const lobbyTitles = (lobbying ? Object.values(lobbying.drill) : [])
    .flatMap((d) => d.recent)
    .sort((a, b) => (a.dtPosted < b.dtPosted ? 1 : -1))
    .filter((f) => {
      if (seen.has(f.filingUuid)) return false;
      seen.add(f.filingUuid);
      return true;
    })
    .slice(0, 14)
    .map((f) => f.clientName ?? "(client not named)");

  const datasets: { panel: string; label: string; titles: string[] }[] = [
    { panel: "1", label: "Bills · movers 7d", titles: movers.map((b) => b.title) },
    { panel: "1", label: "Stalls", titles: stalls.map((b) => b.title) },
    { panel: "1", label: "Enacted", titles: enacted.bills.map((b) => b.title) },
    { panel: "2", label: "Members", titles: members.map((m) => m.name) },
    { panel: "2", label: "Lobbying (LDA)", titles: lobbyTitles },
    {
      panel: "2",
      label: "Hearings",
      titles: [...upcoming, ...recentMeetings].slice(0, 16).map((m) => m.title),
    },
    { panel: "3", label: "News", titles: news.map((n) => n.title) },
    {
      panel: "3",
      label: "Races",
      titles: races.map((r) => r.incumbentName ?? "OPEN SEAT"),
    },
    { panel: "3", label: "Patterns", titles: clusters.map((c) => c.name) },
  ];

  console.log("\n-- per-dataset mount counts (each row title duplicated 2x by the marquee track) --");
  let failed = 0;
  for (const d of datasets) {
    const hits = d.titles.filter((t) => count(html, esc(t)) > 0).length;
    const occurrences = d.titles.reduce((a, t) => a + count(html, esc(t)), 0);
    const ok = hits > 0 && hits === d.titles.length;
    if (!ok) failed += 1;
    console.log(
      `  P${d.panel} ${d.label.padEnd(20)} rows ${String(d.titles.length).padStart(2)}` +
        ` · matched ${String(hits).padStart(2)}` +
        ` · occurrences ${String(occurrences).padStart(3)}` +
        `  ${ok ? "OK" : hits === 0 ? "!! EMPTY PANEL DATASET" : "!! PARTIAL"}`,
    );
  }

  console.log("\n-- fixed strings --");
  for (const s of [
    "IN BETA",
    "ENTER TERMINAL",
    "LOGIN",
    "No account needed",
    "Want your own watchlist",
    "AS OF",
    "synced 4",
  ]) {
    console.log(`  ${s.padEnd(26)} ${count(html, s)}`);
  }

  console.log(
    `\n  VERDICT: ${failed === 0 ? "all nine datasets mounted with every row present" : `${failed} dataset(s) did not fully mount`}`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("FAILED:", e);
  process.exit(1);
});
