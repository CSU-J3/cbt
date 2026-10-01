// HO 763 legs: the child scripts/diagnostic/runoff-seat-legs-763.ts spawns for reads that go through
// getDb() (getRunoffsForRace, the primaries cron tick), so they run where TURSO_DATABASE_URL is a
// `file:` copy and never prod; it refuses anything else. Runs under next-cache-stub-757.mjs (lib/queries
// imports next/cache), in a cwd with no .cache/ballotpedia; the tick's pages come from
// runoff-pages-shim-761.cjs.
//   runoffs --code head|tree     getRunoffsForRace for every race: race id -> the round ids it draws
//   tick    --code head|tree     runPrimariesCronTick(): the payload
// The last line printed is `RESULT <json>`.
import { createClient } from "@libsql/client";
import { pathToFileURL } from "node:url";

const argAt = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function main() {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("file:") || !url.endsWith("-763-legs.db")) throw new Error(`refused: the child runs on a *-763-legs.db file: copy only (got ${url.slice(0, 12)}…)`);
  const code = argAt("--code");
  if (code !== "head" && code !== "tree") throw new Error("--code head|tree");
  const head = (f: string) => import(pathToFileURL(`${process.env.LEGS_763_HEAD_DIR}/${f}`).href);
  const task = process.argv[2];
  if (task === "runoffs") {
    const q = code === "tree" ? await import("@/lib/queries") : await head("head-queries-763.ts");
    const db = createClient({ url });
    const ids = (await db.execute(`SELECT id FROM races ORDER BY id`)).rows.map((r) => String(r.id));
    db.close();
    const out: Record<string, string[]> = {};
    for (const id of ids) {
      const rows = (await q.getRunoffsForRace(id)) as { id: string }[];
      if (rows.length) out[id] = rows.map((r) => r.id);
    }
    console.log(`RESULT ${JSON.stringify({ races: ids.length, drawn: out })}`);
    return;
  }
  if (task === "tick") {
    const s = code === "tree" ? await import("@/lib/primaries-sync") : await head("head-primaries-sync-763.ts");
    const r = await s.runPrimariesCronTick();
    console.log(`RESULT ${JSON.stringify(r)}`);
    return;
  }
  throw new Error(`unknown task ${task}`);
}
main().catch((e) => {
  console.error(e?.stack ?? String(e));
  process.exit(1);
});
