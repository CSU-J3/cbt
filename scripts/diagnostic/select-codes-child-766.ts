// HO 766 legs: the child scripts/diagnostic/select-codes-legs-766.ts spawns to run the members step, HEAD's
// (a `git cat-file` copy in LEGS_766_HEAD_DIR) or the tree's, where TURSO_DATABASE_URL is a `file:` copy and
// never prod; it refuses anything else. The YAML comes from committee-yaml-shim-766.cjs.
//   members --code head|tree     syncCommitteeMembers(): its result
// The last line printed is `RESULT <json>`.
import { pathToFileURL } from "node:url";

const argAt = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};

async function main() {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("file:") || !url.endsWith("-766-legs.db")) throw new Error(`refused: the child runs on a *-766-legs.db file: copy only (got ${url.slice(0, 12)}…)`);
  if (process.env.TURSO_AUTH_TOKEN) throw new Error("refused: the child runs with an empty TURSO_AUTH_TOKEN");
  if (!process.env.SHIM_766_YAML) throw new Error("refused: no YAML shim");
  const code = argAt("--code") ?? "tree";
  if (process.argv[2] !== "members") throw new Error(`unknown task ${process.argv[2]}`);
  const s = code === "tree" ? await import("@/lib/committees-sync") : await import(pathToFileURL(`${process.env.LEGS_766_HEAD_DIR}/head-committees-sync-766.ts`).href);
  const r = await s.syncCommitteeMembers();
  console.log(`RESULT ${JSON.stringify(r)}`);
}
main().catch((e) => {
  console.error(e?.stack ?? String(e));
  process.exit(1);
});
