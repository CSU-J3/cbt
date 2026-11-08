// HO 807 STEP 0, claim 5 — what the member hub's election cell will say after
// election day, read through the shipped functions the cell and the race page
// run (lib/race-id.ts raceIdFromMember, lib/race-result.ts readRaceResult +
// raceResultView, lib/incumbent-qualifier.ts readIncumbentQualifiers,
// lib/incumbent-tag.ts incumbentTagAt + incumbentTagText), over every current
// House and Senate member whose next_election_year is the cycle.
//
// READ-ONLY. The client is wrapped so every statement the shipped readers send
// must be a SELECT (or WITH … SELECT); anything else throws before it leaves the
// box, and the wrapper's planted controls run before the first read. Prints:
//   · the count;
//   · members whose raceId is null (the two-year delegates), named;
//   · members with no races row (claim 5's HALT: their cell would vanish);
//   · races whose stored incumbent isn't the member (recorded, listed);
//   · the cell's word by kind (each tag's text, each qualifier, each header),
//     one bioguide per word.
//   npx tsx scripts/diagnostic/election-cell-807.ts [--cycle 2026]
import { config } from "dotenv";
import { createClient, type Client, type InStatement } from "@libsql/client";
import { raceIdFromMember } from "../../lib/race-id";
import { raceResultView, readRaceResult } from "../../lib/race-result";
import { readIncumbentQualifiers } from "../../lib/incumbent-qualifier";
import { incumbentTagAt, incumbentTagText } from "../../lib/incumbent-tag";
import { clockNowMs } from "../../lib/clock";
import { redactSecrets } from "../../lib/redact";

config({ path: ".env", quiet: true });
const say = (s = "") => console.log(redactSecrets(s));
const cycleArg = process.argv.indexOf("--cycle");
const CYCLE = cycleArg >= 0 ? Number(process.argv[cycleArg + 1]) : 2026;

// ── the read-only wrapper
// Whole words only: without the closing \b, COMMIT matches `committee_meetings`.
const WRITE = /\b(INSERT\s+(OR\s+\w+\s+)?INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|REPLACE\s+INTO|CREATE|DROP|ALTER|ATTACH|DETACH|VACUUM|REINDEX|PRAGMA\s+\w+\s*=|BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE)\b/i;
function readOnly(sql: string): void {
  if (!/^\s*(SELECT|WITH)\b/i.test(sql) || WRITE.test(sql) || /;\s*\S/.test(sql)) {
    throw new Error(`read-only: refused "${sql.replace(/\s+/g, " ").slice(0, 80)}"`);
  }
}
const sqlOf = (s: InStatement) => (typeof s === "string" ? s : s.sql);
function guarded(db: Client): Client {
  return new Proxy(db, {
    get(target, prop, recv) {
      if (prop === "execute") {
        return (s: InStatement) => {
          readOnly(sqlOf(s));
          return target.execute(s);
        };
      }
      if (prop === "batch") {
        return (stmts: InStatement[], mode?: never) => {
          for (const s of stmts) readOnly(sqlOf(s));
          return target.batch(stmts, mode);
        };
      }
      if (prop === "transaction" || prop === "executeMultiple" || prop === "migrate") {
        return () => {
          throw new Error(`read-only: ${String(prop)} refused`);
        };
      }
      return Reflect.get(target, prop, recv);
    },
  });
}
function controls(): void {
  const refuse = [
    "UPDATE races SET id = id WHERE 0",
    "DELETE FROM races WHERE 0",
    "INSERT INTO races (id) VALUES ('x')",
    "SELECT 1; DELETE FROM races",
    "PRAGMA foreign_keys = OFF",
  ];
  const pass = ["SELECT REPLACE(id, '-', '') FROM races LIMIT 0", "WITH x AS (SELECT 1 AS n) SELECT n FROM x"];
  let refused = 0;
  for (const s of refuse) {
    try {
      readOnly(s);
    } catch {
      refused += 1;
    }
  }
  let passed = 0;
  for (const s of pass) {
    try {
      readOnly(s);
      passed += 1;
    } catch {
      /* refused */
    }
  }
  say(`the read-only wrapper: ${refused} of ${refuse.length} planted writes refused, ${passed} of ${pass.length} reads passed`);
  if (refused !== refuse.length || passed !== pass.length) throw new Error("a control failed: nothing read");
}

type Member = { bioguide: string; name: string; chamber: "house" | "senate"; state: string | null; district: number | null };

async function main(): Promise<void> {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!/^(libsql|https?):\/\//.test(url) && !url.startsWith("file:")) throw new Error("TURSO_DATABASE_URL is not set");
  controls();
  const db = guarded(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN }));
  const nowMs = clockNowMs();
  say(`HO 807 claim 5 · cycle ${CYCLE} · now ${new Date(nowMs).toISOString()} · ${url.startsWith("file:") ? "a file copy" : "prod"}`);

  const rs = await db.execute({
    sql: `SELECT bioguide_id, name, chamber, state, district FROM members
           WHERE is_current = 1 AND chamber IN ('house', 'senate') AND next_election_year = ?
           ORDER BY chamber, state, district, bioguide_id`,
    args: [CYCLE],
  });
  const members: Member[] = rs.rows.map((r) => ({
    bioguide: String(r.bioguide_id),
    name: String(r.name),
    chamber: r.chamber as "house" | "senate",
    state: (r.state as string | null) ?? null,
    district: r.district == null ? null : Number(r.district),
  }));
  say(`members: ${members.length} (house ${members.filter((m) => m.chamber === "house").length}, senate ${members.filter((m) => m.chamber === "senate").length})`);

  const withRace = members.map((m) => ({ m, raceId: raceIdFromMember({ chamber: m.chamber, state: m.state, district: m.district, nextElectionYear: CYCLE }) }));
  const noRaceId = withRace.filter((x) => x.raceId === null);
  say(`raceId null: ${noRaceId.length}${noRaceId.length ? ` · ${noRaceId.map((x) => `${x.m.bioguide} ${x.m.name} (${x.m.state})`).join(" · ")}` : ""}`);

  const ids = [...new Set(withRace.map((x) => x.raceId).filter((x): x is string => x !== null))];
  const races = new Map<string, string | null>();
  for (let i = 0; i < ids.length; i += 100) {
    const part = ids.slice(i, i + 100);
    const r = await db.execute({ sql: `SELECT id, incumbent_bioguide_id FROM races WHERE id IN (${part.map(() => "?").join(", ")})`, args: part });
    for (const row of r.rows) races.set(String(row.id), (row.incumbent_bioguide_id as string | null) ?? null);
  }
  const noRow = withRace.filter((x) => x.raceId !== null && !races.has(x.raceId));
  say(`no races row: ${noRow.length}${noRow.length ? ` · ${noRow.map((x) => `${x.m.bioguide} ${x.m.name} → ${x.raceId}`).join(" · ")}` : ""}`);
  const mismatch = withRace.filter((x) => x.raceId !== null && races.has(x.raceId) && races.get(x.raceId) !== x.m.bioguide);
  say(`stored incumbent isn't the member: ${mismatch.length}${mismatch.length ? ` · ${mismatch.map((x) => `${x.m.bioguide} ${x.m.name} → ${x.raceId} (stored ${races.get(x.raceId!) ?? "none"})`).join(" · ")}` : ""}`);

  const qualifiers = await readIncumbentQualifiers(db, CYCLE);
  const cells = withRace.filter((x) => x.raceId !== null && races.has(x.raceId));
  type Word = { kind: "tag" | "qualifier" | "header"; word: string; header: string | null };
  const words = new Map<string, { kind: Word["kind"]; word: string; n: number; example: string; headers: Map<string, number> }>();
  let passed = 0;
  const queue = [...cells];
  async function worker(): Promise<void> {
    for (let x = queue.shift(); x; x = queue.shift()) {
      const raceId = x.raceId!;
      const reading = await readRaceResult(db, raceId);
      const view = raceResultView(reading, CYCLE, nowMs);
      if (view.passed) passed += 1;
      const mine = races.get(raceId) === x.m.bioguide;
      const tag = mine ? incumbentTagAt(qualifiers[raceId] ?? null, CYCLE, nowMs) : null;
      const w: Word = tag
        ? { kind: "tag", word: incumbentTagText(tag), header: view.header }
        : mine && view.qualifier
          ? { kind: "qualifier", word: view.qualifier, header: view.header }
          : { kind: "header", word: view.header ?? "(no header: dormant)", header: null };
      const key = `${w.kind}|${w.word}`;
      const e = words.get(key) ?? { kind: w.kind, word: w.word, n: 0, example: x.m.bioguide, headers: new Map<string, number>() };
      e.n += 1;
      if (w.header) e.headers.set(w.header, (e.headers.get(w.header) ?? 0) + 1);
      words.set(key, e);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  say(`cells read: ${cells.length} · election day passed on ${passed}`);
  say(`the cell's word by kind (count · one bioguide · the sub line's headers):`);
  const order = { tag: 0, qualifier: 1, header: 2 } as const;
  for (const e of [...words.values()].sort((a, b) => order[a.kind] - order[b.kind] || b.n - a.n || a.word.localeCompare(b.word))) {
    const hs = [...e.headers.entries()].sort((a, b) => b[1] - a[1]).map(([h, n]) => `${h} ${n}`).join(" · ");
    say(`  ${e.kind.padEnd(9)} ${e.word.padEnd(28)} ${String(e.n).padStart(4)} · ${e.example}${hs ? ` · ${hs}` : ""}`);
  }
  say(noRow.length ? `HALT: ${noRow.length} member(s) with no races row` : `no member without a races row`);
}

main().catch((e) => {
  console.error(redactSecrets(String((e as Error)?.stack ?? e)));
  process.exit(1);
});
