// HO 765 legs: the child scripts/diagnostic/pac-ballot-legs-765.ts spawns for everything that runs the
// code under test, so it runs where TURSO_DATABASE_URL is a `file:` copy and never prod; it refuses
// anything else. Runs under next-cache-stub-757.mjs (lib/queries imports next/cache). HEAD's
// lib/queries.ts and lib/pac-target-status.ts are `git cat-file` copies the driver writes to
// LEGS_765_HEAD_DIR, HEAD's queries importing HEAD's pac-target-status.
//   pac  --code head|tree                     getPacIeSpending(2026): race|candidate_id|S/O -> status
//   why  --code head|tree --targets <json>    classifyTarget with each target's seat inputs, read here by
//                                             the tree caller's three statements (contest, roster, ballot):
//                                             head passes four arguments, the tree six
// CBT_CLOCK_NOW (honoured by lib/clock.ts on a file: copy only) moves the tree's clock.
// The last line printed is `RESULT <json>`.
import { createClient } from "@libsql/client";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const argAt = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const head = (f: string) => import(pathToFileURL(`${process.env.LEGS_765_HEAD_DIR}/${f}`).href);

async function main() {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url.startsWith("file:") || !url.endsWith("-765-legs.db")) throw new Error(`refused: the child runs on a *-765-legs.db file: copy only (got ${url.slice(0, 12)}…)`);
  if (process.env.TURSO_AUTH_TOKEN) throw new Error("refused: the child runs with an empty TURSO_AUTH_TOKEN");
  const code = argAt("--code") ?? "tree";
  const task = process.argv[2];
  const out = (r: unknown) => console.log(`RESULT ${JSON.stringify(r)}`);
  if (task === "pac") {
    const q = code === "tree" ? await import("@/lib/queries") : await head("head-queries-765.ts");
    const res = (await q.getPacIeSpending(2026)) as Record<string, { candidateId: string; supportOppose: string; candidateName: string; targetStatus: string }[]>;
    const flat: Record<string, string> = {};
    for (const [race, rows] of Object.entries(res)) for (const r of rows) flat[`${race}|${r.candidateId}|${r.supportOppose}|${r.candidateName}`] = r.targetStatus;
    out(flat);
    return;
  }
  if (task === "why") {
    const m = code === "tree" ? await import("@/lib/pac-target-status") : await head("head-pac-target-status-765.ts");
    const { clockNowMs } = await import("@/lib/clock");
    const { electionDay } = await import("@/lib/format");
    const targets = JSON.parse(readFileSync(argAt("--targets")!, "utf8")) as { race: string; name: string }[];
    const db = createClient({ url });
    const today = new Date(clockNowMs()).toISOString().slice(0, 10);
    const electionDate = electionDay(2026).toISOString().slice(0, 10);
    const res: Record<string, { status: string; why: string }> = {};
    for (const t of targets) {
      const contests = (
        await db.execute({
          sql: `WITH seat AS (SELECT id, state, chamber, district FROM races WHERE id = ?)
                SELECT p.id AS primary_id, p.primary_date, p.runoff_date, p.election_round, pc.name, pc.status, pc.vote_pct
                  FROM seat r CROSS JOIN primaries p ON p.state = r.state AND p.chamber = r.chamber
                   AND ((p.district IS NULL AND r.district IS NULL) OR CAST(p.district AS INTEGER) = r.district)
                 CROSS JOIN primary_candidates pc ON pc.primary_id = p.id`,
          args: [t.race],
        })
      ).rows.map((c) => ({ primaryId: String(c.primary_id), primaryDate: (c.primary_date as string | null) ?? null, runoffDate: (c.runoff_date as string | null) ?? null, round: String(c.election_round), name: String(c.name), status: (c.status as string | null) ?? null, votePct: (c.vote_pct as number | null) ?? null }));
      const roster = (await db.execute({ sql: `SELECT name, status FROM race_candidates WHERE race_id = ? AND status IS NOT 'on_ballot'`, args: [t.race] })).rows.map((r) => ({ name: String(r.name), status: (r.status as string | null) ?? null }));
      const ballotRs = (await db.execute({ sql: `SELECT g.name, g.on_ballot, g.withdrawn, g.write_in, g.marked FROM general_ballot_reads r LEFT JOIN general_ballot g ON g.race_id = r.race_id WHERE r.race_id = ? AND r.status = 'box'`, args: [t.race] })).rows;
      const ballot = ballotRs.length === 0 ? null : ballotRs.filter((b) => b.name != null).map((b) => ({ name: String(b.name), onBallot: Number(b.on_ballot) === 1, withdrawn: Number(b.withdrawn) === 1, writeIn: Number(b.write_in) === 1, marked: Number(b.marked) === 1 }));
      res[`${t.race}|${t.name}`] = code === "tree" ? m.classifyTarget(t.name, contests, roster, today, ballot, electionDate) : m.classifyTarget(t.name, contests, roster, today);
    }
    db.close();
    out({ today, electionDate, res });
    return;
  }
  if (task === "guard") {
    // The tree's pure function on a synthetic seat: Haley Stevens lost the D primary (47.5%); the ballot
    // prints one Stevens. Joe (a namesake) must not speak for her; Haley would.
    const m = await import("@/lib/pac-target-status");
    const contests = [
      { primaryId: "senate-MI-2026-D", primaryDate: "2026-08-04", runoffDate: null, round: "primary", name: "Haley Stevens", status: "running", votePct: 47.5 },
      { primaryId: "senate-MI-2026-D", primaryDate: "2026-08-04", runoffDate: null, round: "primary", name: "Abdul El-Sayed", status: "winner", votePct: 52.5 },
    ];
    const printed = (name: string) => [{ name, onBallot: true, withdrawn: false, writeIn: false, marked: false }];
    out({
      joe: m.classifyTarget("STEVENS, HALEY", contests, [], "2026-10-01", printed("Joe Stevens"), "2026-11-03"),
      haley: m.classifyTarget("STEVENS, HALEY", contests, [], "2026-10-01", printed("Haley Stevens"), "2026-11-03"),
    });
    return;
  }
  throw new Error(`unknown task ${task}`);
}
main().catch((e) => {
  console.error(e?.stack ?? String(e));
  process.exit(1);
});
