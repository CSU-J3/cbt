// HO 762 legs: the child scripts/diagnostic/runoff-route-legs-762.ts spawns for the cron's own path
// (syncSenateCandidates reads getDb()), so it runs where TURSO_DATABASE_URL is a `file:` copy and never
// prod; it refuses anything else. Its Ballotpedia answers come from runoff-pages-shim-761.cjs, whose
// map the driver points S-SC at the live page saved at HO 761's FF go.
//   sync --code head|tree --senate SC     syncSenateCandidates; the last line is `RESULT <json>`
import { pathToFileURL } from "node:url";

const argAt = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function main() {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("file:") || !url.endsWith("-762-legs.db")) throw new Error(`refused: the child runs on a *-762-legs.db file: copy only (got ${url.slice(0, 12)}…)`);
  const code = argAt("--code");
  if (process.argv[2] !== "sync" || (code !== "head" && code !== "tree")) throw new Error("sync --code head|tree --senate ST,…");
  const mod = code === "tree" ? await import("@/lib/primaries-sync") : await import(pathToFileURL(`${process.env.LEGS_762_HEAD_DIR}/head-primaries-sync-762.ts`).href);
  const s = await mod.syncSenateCandidates((argAt("--senate") ?? "").split(",").filter(Boolean));
  console.log(`RESULT ${JSON.stringify(s)}`);
}
main().catch((e) => {
  console.error(e?.stack ?? String(e));
  process.exit(1);
});
