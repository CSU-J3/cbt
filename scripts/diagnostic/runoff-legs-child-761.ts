// HO 761 legs: the child that scripts/diagnostic/runoff-rounds-legs-761.ts spawns for work that must
// run through getDb() (the sync, the race page's runoff read), so it runs in a process whose
// TURSO_DATABASE_URL is a `file:` copy and never prod. It refuses anything else. Its cwd is an empty
// scratch directory, so scrapeHouseCandidates finds no `.cache/ballotpedia` (the dev cache holds a
// pre-results TX-18 page); its Ballotpedia answers come from runoff-pages-shim-761.cjs.
//   sync    --code head|tree --senate GA,TX --house TX-18,TX-33   syncSenateCandidates, then syncHouseDistricts
//   render  --code head|tree --race S-GA-2026                     getRunoffsForRace (the tree's), rendered by
//                                                                 HEAD's or the tree's RaceRunoffs, as text
//   pac     --code tree                                           getPacIeSpending(2026): every target's status
// render and pac import lib/queries.ts, so they run under next-cache-stub-757.mjs (unstable_cache a
// passthrough).
// The last line printed is `RESULT <json>`.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { pathToFileURL } from "node:url";

const argAt = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const task = process.argv[2];
const code = argAt("--code");
const HEAD_DIR = process.env.LEGS_761_HEAD_DIR ?? "";

async function main() {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("file:") || !url.endsWith("-761-legs.db")) throw new Error(`refused: the child runs on a *-761-legs.db file: copy only (got ${url.slice(0, 12)}…)`);
  if (code !== "head" && code !== "tree") throw new Error("--code head|tree");
  const head = (f: string) => import(pathToFileURL(`${HEAD_DIR}/${f}`).href);

  if (task === "sync") {
    const mod = code === "tree" ? await import("@/lib/primaries-sync") : await head("head-primaries-sync-761.ts");
    const senate = (argAt("--senate") ?? "").split(",").filter(Boolean);
    const house = (argAt("--house") ?? "").split(",").filter(Boolean).map((s) => ({ state: s.slice(0, 2), district: Number(s.slice(3)) }));
    const s = senate.length ? await mod.syncSenateCandidates(senate) : null;
    const h = house.length ? await mod.syncHouseDistricts(house, "legs-761") : null;
    console.log(`RESULT ${JSON.stringify({ senate: s, house: h })}`);
    return;
  }
  if (task === "render") {
    const race = argAt("--race")!;
    const { getRunoffsForRace } = await import("@/lib/queries");
    const rows = await getRunoffsForRace(race);
    const { RaceRunoffs } = code === "tree" ? await import("@/components/RaceRunoffs") : await head("head-RaceRunoffs-761.tsx");
    const html = renderToStaticMarkup(createElement(RaceRunoffs, { runoffs: rows }));
    // One line per candidate row: the <li>'s text.
    const lis = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    const heads = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map((m) => m[1]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    console.log(`RESULT ${JSON.stringify({ race, rows: rows.map((r) => ({ id: r.id, date: r.primary_date, candidates: r.candidates.map((c) => `${c.name} ${c.status} ${c.vote_pct}`) })), heads, lis })}`);
    return;
  }
  if (task === "pac") {
    // The page's own read (getPacIeSpending, under next-cache-stub-757.mjs): every PAC target's status.
    const { getPacIeSpending } = await import("@/lib/queries");
    const byRace = await getPacIeSpending(2026);
    const rows = Object.values(byRace).flat().map((r) => `${r.raceId} · ${r.candidateName} (${r.supportOppose}) · ${r.targetStatus}`).sort();
    console.log(`RESULT ${JSON.stringify({ rows })}`);
    return;
  }
  throw new Error(`unknown task ${task}`);
}
main().catch((e) => {
  console.error(e?.stack ?? String(e));
  process.exit(1);
});
