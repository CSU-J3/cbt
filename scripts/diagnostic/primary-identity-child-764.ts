// HO 764 legs: the child scripts/diagnostic/primary-identity-legs-764.ts spawns for everything that runs
// the code under test, so it runs where TURSO_DATABASE_URL is a `file:` copy and never prod; it refuses
// anything else. Runs under next-cache-stub-757.mjs (lib/queries imports next/cache), in a cwd with no
// .cache/ballotpedia; a page fetch is answered by runoff-pages-shim-761.cjs from HO 747's saved pages.
// HEAD's files are `git cat-file` copies the driver writes to LEGS_764_HEAD_DIR, with the matcher's
// private functions exported by an appended line (the copy only).
//   parse   --code head|tree --file <gz>    parseCandidatesPage on one saved page: its kept rows
//   rule    --code head|tree --list <json>  the member match for every row in the list (the saved pages'
//                                           kept rows): row key -> bioguide
//   sync    --code head|tree --districts ST-N,..  syncHouseDistricts over those districts: its review list
//   repair  [--write] [--saved <dir>] [--live]  repairPrimaryIdentity (the tree's); --live reads pages the
//                                           saved set lacks through the shim at a 0ms gap
//   rematch                                 rematchPrimaryCandidates (the tree's): its printed changes
//   runoffs --races A,B                     getRunoffsForRace (the tree's) for each race
//   qualifier                               readIncumbentQualifierReadings(db, 2026)
//   harvest                                 harvestChallengers(db) (writes race_candidates on the copy)
// The last line printed is `RESULT <json>`.
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { pathToFileURL } from "node:url";

const argAt = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const head = (f: string) => import(pathToFileURL(`${process.env.LEGS_764_HEAD_DIR}/${f}`).href);

async function main() {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("file:") || !url.endsWith("-764-legs.db")) throw new Error(`refused: the child runs on a *-764-legs.db file: copy only (got ${url.slice(0, 12)}…)`);
  if (process.env.TURSO_AUTH_TOKEN) throw new Error("refused: the child runs with an empty TURSO_AUTH_TOKEN");
  const code = argAt("--code") ?? "tree";
  const task = process.argv[2];
  const db = createClient({ url });
  const out = (r: unknown) => console.log(`RESULT ${JSON.stringify(r)}`);
  try {
    if (task === "parse") {
      const s = code === "tree" ? await import("@/lib/primary-candidates-scrape") : await head("head-scrape-764.ts");
      const html = gunzipSync(readFileSync(argAt("--file")!)).toString("utf8");
      const p = s.parseCandidatesPage(html, "XX", "saved");
      const row = (round: string) => (c: Record<string, unknown>) => ({ round, contest: c.contest, special: c.isSpecial, name: c.name, incumbent: c.incumbent, personKey: c.personKey ?? null, hasKeyField: "personKey" in c });
      out({ status: p.status, rows: [...p.candidates.map(row("primary")), ...(p.runoffs ?? []).flatMap((r: { candidates: Record<string, unknown>[] }) => r.candidates.map(row("runoff")))] });
      return;
    }
    if (task === "parseall") {
      const s = code === "tree" ? await import("@/lib/primary-candidates-scrape") : await head("head-scrape-764.ts");
      const r = await import("@/lib/primary-identity-repair");
      const rows: unknown[] = [];
      const pages = r.savedPageIndex(argAt("--saved")!);
      for (const [raceId, file] of pages) {
        const p = s.parseCandidatesPage(r.readSaved(file), "XX", "saved");
        const row = (round: string) => (c: Record<string, unknown>) => ({ raceId, round, contest: c.contest, special: c.isSpecial, name: c.name, incumbent: c.incumbent, winner: c.isWinner, votePct: c.votePct, party: c.party, personKey: c.personKey ?? null });
        rows.push(...p.candidates.map(row("primary")), ...(p.runoffs ?? []).flatMap((x: { candidates: Record<string, unknown>[] }) => x.candidates.map(row("runoff"))));
      }
      out({ pages: pages.size, rows });
      return;
    }
    if (task === "rule") {
      const list = JSON.parse(readFileSync(argAt("--list")!, "utf8")) as { k: string; chamber: string; state: string; district: number; name: string; incumbent: boolean; personKey: string | null }[];
      const res: Record<string, string | null> = {};
      if (code === "tree") {
        const s = await import("@/lib/primaries-sync");
        const m = await s.loadMemberMatcher(db);
        for (const r of list) res[r.k] = r.chamber === "senate" ? m.senate(r, r.state) : m.house(r, r.state, r.district);
      } else {
        const s = await head("head-primaries-sync-764.ts");
        const senate = await s.buildSenateMatcher(db);
        const { incumbentByDistrict, currentHouseByState } = await s.loadHouseMembers(db, null);
        for (const r of list) res[r.k] = r.chamber === "senate" ? senate(r.name, r.state) : s.matchHouseCandidate(r.name, r.incumbent, r.state, r.district, incumbentByDistrict, currentHouseByState);
      }
      out(res);
      return;
    }
    if (task === "sync") {
      const s = code === "tree" ? await import("@/lib/primaries-sync") : await head("head-primaries-sync-764.ts");
      const districts = argAt("--districts")!.split(",").map((d) => ({ state: d.split("-")[0]!, district: Number(d.split("-")[1]) }));
      const lines: string[] = [];
      const orig = console.log;
      console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
      let summary: unknown;
      try {
        summary = await s.syncHouseDistricts(districts, "legs-764");
      } finally {
        console.log = orig;
      }
      const text = lines.join("\n");
      const i = text.indexOf("6. Incumbents not found");
      const section = i < 0 ? "" : text.slice(i, text.indexOf("\n7.", i));
      out({ summary, matchesLine: text.match(/5\. Incumbent matches: [^\n]*/)?.[0] ?? null, notFound: section.split("\n").slice(1).map((l) => l.trim()).filter(Boolean) });
      return;
    }
    if (task === "repair") {
      const r = await import("@/lib/primary-identity-repair");
      const gb = await import("@/lib/general-ballot");
      const io = process.argv.includes("--live") ? gb.pacedIO(gb.liveIO(), 0).io : null;
      const res = await r.repairPrimaryIdentity(db, { write: process.argv.includes("--write"), savedDir: argAt("--saved") ?? null, io });
      out(res);
      return;
    }
    if (task === "rematch") {
      const s = await import("@/lib/primaries-sync");
      const lines: string[] = [];
      const orig = console.log;
      console.log = (...a: unknown[]) => { lines.push(a.map(String).join(" ")); };
      try {
        await s.rematchPrimaryCandidates(db);
      } finally {
        console.log = orig;
      }
      // HO 94's spot-checks set exitCode 1 on a FAIL; reported, not fatal here (the driver reads them).
      const exitCode = process.exitCode ?? 0;
      process.exitCode = 0;
      out({ lines, exitCode });
      return;
    }
    if (task === "runoffs") {
      const q = await import("@/lib/queries");
      const res: Record<string, unknown> = {};
      for (const id of argAt("--races")!.split(",")) res[id] = await q.getRunoffsForRace(id);
      out(res);
      return;
    }
    if (task === "qualifier") {
      const q = await import("@/lib/incumbent-qualifier");
      out(Object.fromEntries(await q.readIncumbentQualifierReadings(db, 2026)));
      return;
    }
    if (task === "harvest") {
      const h = await import("@/lib/harvest-challengers");
      const r = await h.harvestChallengers(db);
      out({ rows: r.rows, races: r.races, bySource: r.bySource });
      return;
    }
    throw new Error(`unknown task ${task}`);
  } finally {
    db.close();
  }
}
main().catch((e) => {
  console.error(e?.stack ?? String(e));
  process.exit(1);
});
