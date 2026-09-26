// HO 748 — the legs for the two harvest fixes, on `file:` copies of prod, each
// seen red before green.
//
//   npx tsx scripts/diagnostic/harvest-null-jungle-legs-748.ts [--base <sha>]
//
// Runs `harvestChallengers` itself, the function the cron and the npm script
// share, in two versions in one process: BASE, loaded from
// `git show <base>:lib/harvest-challengers.ts` (default 38c49a6, before HO 748),
// and HEAD, the working tree's `lib/harvest-challengers.ts`. Before the fix is
// applied, both are today's code and every green leg reads red, which is the
// point: the legs can fail.
//
//   Leg 1, the NULL fix. FL-20 stores no incumbent; its Democratic nominee's row
//     carries a bioguide. BASE drops her (red), HEAD publishes her (green).
//     Control: a race that stores an incumbent whose own winner row carries that
//     bioguide stays excluded under both. The fix must not publish incumbents.
//   Leg 2, the jungle skip. One Louisiana `jungle` candidate is marked `winner`
//     on the copy. BASE publishes them as `won_primary` (red); HEAD publishes
//     nothing for Louisiana's jungle House seats, LA-01..LA-06 (green). The
//     Senate seat is out of the leg's scope. Control: a winner under a
//     NULL-typed primary publishes under both, so `IS NOT 'jungle'` is seen
//     keeping NULL.
//   Leg 3, the whole table. On the unperturbed copy, the sentinel rows under
//     BASE and under HEAD differ by exactly the rows STEP 0 predicted.
//
// Prod is read through a reader that refuses anything but SELECT. The copies'
// URLs are built as `file:${abs}` from paths that must end in -748-control.db,
// and every database write in this file goes through `copyWrite` or through
// `harvestChallengers` on a client built by `copyClient`, both of which refuse a
// URL that is not `file:` and print the scheme they ran against. The three
// filesystem writes stay inside docs/handoffs/748-artifacts/: the directory is
// made, a stale copy is removed only after its -748-control.db suffix check, and
// BASE's module is written there to be imported.
import { config } from "dotenv";
import { createClient, type Client, type InArgs, type ResultSet } from "@libsql/client";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import * as HEAD from "@/lib/harvest-challengers";

config({ path: ".env", quiet: true });

const ART = "docs/handoffs/748-artifacts";
const argAt = (flag: string) => {
  const i = process.argv.indexOf(flag);
  return i === -1 ? undefined : process.argv[i + 1];
};
const BASE_SHA = argAt("--base") ?? "38c49a6";
type Harvest = typeof HEAD.harvestChallengers;

function reader(db: Client) {
  return (sql: string, args?: InArgs): Promise<ResultSet> => {
    const kw = sql.trim().split(/\s+/)[0]!.toUpperCase();
    if (kw !== "SELECT") throw new Error(`read-only: refused ${kw}`);
    return db.execute({ sql, args: args ?? [] });
  };
}

function schemeGuard(url: string, what: string): string {
  const scheme = url.split(":")[0]!;
  if (scheme !== "file") throw new Error(`refused: ${what} runs against file: only (got ${scheme}:)`);
  return scheme;
}
function copyClient(url: string, what: string): Client {
  console.log(`    [${what}] scheme ${schemeGuard(url, what)}:`);
  return createClient({ url });
}
async function copyWrite(url: string, stmts: { sql: string; args: InArgs }[], what: string): Promise<number[]> {
  const c = copyClient(url, what);
  try {
    return (await c.batch(stmts, "write")).map((r) => r.rowsAffected);
  } finally {
    c.close();
  }
}

// migrate.ts shapes (:140 races, :454 primaries, :466 primary_candidates, :158
// race_candidates with its PRIMARY KEY, :336 race_ratings), cut to the columns
// the harvest and these legs read.
const TABLES: { table: string; ddl: string; cols: string[]; select: string }[] = [
  {
    table: "races",
    ddl: `CREATE TABLE races (id TEXT PRIMARY KEY, cycle INTEGER NOT NULL, chamber TEXT NOT NULL, state TEXT NOT NULL,
            district INTEGER, incumbent_bioguide_id TEXT)`,
    cols: ["id", "cycle", "chamber", "state", "district", "incumbent_bioguide_id"],
    select: `SELECT id, cycle, chamber, state, district, incumbent_bioguide_id FROM races`,
  },
  {
    table: "primaries",
    ddl: `CREATE TABLE primaries (id TEXT PRIMARY KEY, state TEXT NOT NULL, district TEXT, chamber TEXT NOT NULL,
            party TEXT NOT NULL, primary_date TEXT, primary_type TEXT, election_round TEXT)`,
    cols: ["id", "state", "district", "chamber", "party", "primary_date", "primary_type", "election_round"],
    select: `SELECT id, state, district, chamber, party, primary_date, primary_type, election_round FROM primaries`,
  },
  {
    table: "primary_candidates",
    ddl: `CREATE TABLE primary_candidates (id INTEGER PRIMARY KEY, primary_id TEXT NOT NULL, name TEXT NOT NULL,
            party TEXT NOT NULL, incumbent INTEGER, bioguide_id TEXT, status TEXT)`,
    cols: ["id", "primary_id", "name", "party", "incumbent", "bioguide_id", "status"],
    select: `SELECT id, primary_id, name, party, incumbent, bioguide_id, status FROM primary_candidates`,
  },
  {
    table: "race_candidates",
    ddl: `CREATE TABLE race_candidates (race_id TEXT NOT NULL, name TEXT NOT NULL, party TEXT, bioguide_id TEXT,
            status TEXT, source_url TEXT, updated_at TEXT, PRIMARY KEY (race_id, name))`,
    cols: ["race_id", "name", "party", "bioguide_id", "status", "source_url", "updated_at"],
    select: `SELECT race_id, name, party, bioguide_id, status, source_url, updated_at FROM race_candidates`,
  },
  {
    table: "race_ratings",
    ddl: `CREATE TABLE race_ratings (id TEXT PRIMARY KEY, race_id TEXT NOT NULL, source TEXT, rating TEXT, cycle INTEGER NOT NULL)`,
    cols: ["id", "race_id", "source", "rating", "cycle"],
    select: `SELECT id, race_id, source, rating, cycle FROM race_ratings`,
  },
];

type Seed = { table: string; ddl: string; cols: string[]; rows: Record<string, unknown>[] };
async function readSeed(): Promise<Seed[]> {
  const prodUrl = process.env.TURSO_DATABASE_URL ?? "";
  if (!prodUrl.startsWith("libsql://")) throw new Error("the seed reads prod; TURSO_DATABASE_URL must be the prod libsql:// URL");
  const prod = createClient({ url: prodUrl, authToken: process.env.TURSO_AUTH_TOKEN });
  const read = reader(prod);
  const out: Seed[] = [];
  for (const t of TABLES) out.push({ table: t.table, ddl: t.ddl, cols: t.cols, rows: (await read(t.select)).rows.map((r) => ({ ...r })) });
  prod.close();
  return out;
}
async function seedCopy(name: string, seed: Seed[]): Promise<string> {
  const abs = path.resolve(ART, name);
  if (!abs.endsWith("-748-control.db")) throw new Error(`refused: a copy must be a *-748-control.db file (got ${abs})`);
  if (existsSync(abs)) rmSync(abs);
  const url = `file:${abs}`;
  await copyWrite(url, seed.map((s) => ({ sql: s.ddl, args: [] })), `ddl ${name}`);
  for (const s of seed) {
    for (let i = 0; i < s.rows.length; i += 500) {
      await copyWrite(
        url,
        s.rows.slice(i, i + 500).map((r) => ({
          sql: `INSERT INTO ${s.table} (${s.cols.join(",")}) VALUES (${s.cols.map(() => "?").join(",")})`,
          args: s.cols.map((c) => (r[c] ?? null) as never),
        })),
        `seed ${name} ${s.table}`,
      );
    }
  }
  return url;
}

async function loadBase(): Promise<Harvest> {
  const src = execFileSync("git", ["show", `${BASE_SHA}:lib/harvest-challengers.ts`], { encoding: "utf8" });
  const file = path.resolve(ART, `harvest-challengers-base-${BASE_SHA}.ts`);
  writeFileSync(file, src);
  const mod = (await import(pathToFileURL(file).href)) as { harvestChallengers: Harvest };
  return mod.harvestChallengers;
}

type Row = { race_id: string; name: string; party: string | null; bioguide_id: string | null; status: string | null };
async function harvestOn(url: string, fn: Harvest, what: string): Promise<Row[]> {
  const c = copyClient(url, what);
  try {
    const res = await fn(c);
    console.log(`    [${what}] cleared ${res.cleared} · inserted ${res.inserted} · rows ${res.rows} · races ${res.races}`);
    const rs = await c.execute({
      sql: `SELECT race_id, name, party, bioguide_id, status FROM race_candidates WHERE source_url = ? ORDER BY race_id, name`,
      args: [HEAD.HARVEST_SOURCE],
    });
    return rs.rows.map((r) => ({
      race_id: String(r.race_id),
      name: String(r.name),
      party: r.party == null ? null : String(r.party),
      bioguide_id: r.bioguide_id == null ? null : String(r.bioguide_id),
      status: r.status == null ? null : String(r.status),
    }));
  } finally {
    c.close();
  }
}
const has = (rows: Row[], race: string, name: string) => rows.some((r) => r.race_id === race && r.name === name);
const key = (r: Row) => JSON.stringify([r.race_id, r.name, r.party, r.bioguide_id, r.status]);

async function main(): Promise<number> {
  mkdirSync(ART, { recursive: true });
  let failures = 0;
  const check = (label: string, ok: boolean, detail: string) => {
    console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}: ${detail}`);
    if (!ok) failures++;
  };
  const BASE = await loadBase();
  console.log(`=== HO 748 legs · BASE = git show ${BASE_SHA}:lib/harvest-challengers.ts · HEAD = the working tree's lib/harvest-challengers.ts ===`);
  const seed = await readSeed();
  console.log(`seed read from prod (SELECT only): ${seed.map((s) => `${s.table} ${s.rows.length}`).join(" · ")}`);
  const urlA = await seedCopy("harvest-a-748-control.db", seed);
  const urlB = await seedCopy("harvest-b-748-control.db", seed);

  // Probes on the unperturbed copy, read-only.
  const a = createClient({ url: urlA });
  const ra = reader(a);
  const fl20 = (await ra(`SELECT pc.name, pc.bioguide_id FROM races r JOIN primaries p ON p.state = r.state AND p.chamber = r.chamber
      AND CAST(p.district AS INTEGER) = r.district JOIN primary_candidates pc ON pc.primary_id = p.id AND pc.status = 'winner'
      WHERE r.id = 'FL-20-2026' AND r.incumbent_bioguide_id IS NULL AND pc.party = 'D' AND pc.bioguide_id IS NOT NULL`)).rows[0];
  const ctl1 = (await ra(`SELECT r.id AS race, pc.name, pc.bioguide_id FROM races r JOIN primaries p ON p.state = r.state AND p.chamber = r.chamber
      AND ( r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district )
      JOIN primary_candidates pc ON pc.primary_id = p.id AND pc.status = 'winner'
      WHERE r.cycle = 2026 AND pc.bioguide_id = r.incumbent_bioguide_id
        AND NOT EXISTS (SELECT 1 FROM race_candidates rc WHERE rc.race_id = r.id AND ( rc.source_url IS NULL OR rc.source_url <> ? ))
      ORDER BY r.id LIMIT 1`, [HEAD.HARVEST_SOURCE])).rows[0];
  const jungle = (await ra(`SELECT pc.id, pc.name, p.id AS primary_id, r.id AS race FROM primary_candidates pc JOIN primaries p ON p.id = pc.primary_id
      JOIN races r ON r.state = p.state AND r.chamber = p.chamber AND CAST(p.district AS INTEGER) = r.district AND r.cycle = 2026
      WHERE p.primary_type = 'jungle' AND pc.bioguide_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM race_candidates rc WHERE rc.race_id = r.id AND ( rc.source_url IS NULL OR rc.source_url <> ? ))
      ORDER BY p.id, pc.id LIMIT 1`, [HEAD.HARVEST_SOURCE])).rows[0];
  const ctl2 = (await ra(`SELECT r.id AS race, pc.name, p.id AS primary_id FROM races r JOIN primaries p ON p.state = r.state AND p.chamber = r.chamber
      AND ( r.chamber = 'senate' OR CAST(p.district AS INTEGER) = r.district )
      JOIN primary_candidates pc ON pc.primary_id = p.id AND pc.status = 'winner'
      WHERE r.cycle = 2026 AND p.primary_type IS NULL AND pc.bioguide_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM race_candidates rc WHERE rc.race_id = r.id AND ( rc.source_url IS NULL OR rc.source_url <> ? ))
      ORDER BY r.id, pc.name LIMIT 1`, [HEAD.HARVEST_SOURCE])).rows[0];
  a.close();
  if (!fl20 || !ctl1 || !jungle || !ctl2) throw new Error(`a leg's subject is missing: fl20 ${!!fl20} ctl1 ${!!ctl1} jungle ${!!jungle} ctl2 ${!!ctl2}`);
  console.log(`subjects: FL-20's D winner "${fl20.name}" (${fl20.bioguide_id}); leg-1 control ${ctl1.race} "${ctl1.name}" (${ctl1.bioguide_id}, the stored incumbent);`);
  console.log(`          leg-2 jungle candidate "${jungle.name}" (${jungle.primary_id}, ${jungle.race}); leg-2 control ${ctl2.race} "${ctl2.name}" (${ctl2.primary_id}, primary_type NULL)`);

  console.log("\n── Leg 1 · the NULL fix (copy A, unperturbed)");
  const aBase = await harvestOn(urlA, BASE, "BASE on A");
  const aHead = await harvestOn(urlA, HEAD.harvestChallengers, "HEAD on A");
  const fName = String(fl20.name);
  console.log(`    FL-20 "${fName}": BASE ${has(aBase, "FL-20-2026", fName) ? "published" : "absent"} · HEAD ${has(aHead, "FL-20-2026", fName) ? "published" : "absent"}`);
  check("leg 1 red: BASE drops FL-20's nominee", !has(aBase, "FL-20-2026", fName), has(aBase, "FL-20-2026", fName) ? "published" : "absent");
  check("leg 1 green: HEAD publishes FL-20's nominee", has(aHead, "FL-20-2026", fName), has(aHead, "FL-20-2026", fName) ? "published" : "absent");
  const c1 = [String(ctl1.race), String(ctl1.name)] as const;
  check(`leg 1 control: ${c1[0]}'s own incumbent "${c1[1]}" stays excluded under both`, !has(aBase, ...c1) && !has(aHead, ...c1), `BASE ${has(aBase, ...c1) ? "published" : "excluded"} · HEAD ${has(aHead, ...c1) ? "published" : "excluded"}`);

  console.log("\n── Leg 2 · the jungle skip (copy B, one Louisiana candidate marked winner)");
  const affected = await copyWrite(urlB, [{ sql: `UPDATE primary_candidates SET status = 'winner' WHERE id = ?`, args: [Number(jungle.id)] }], "leg 2 perturb B");
  console.log(`    rowsAffected ${JSON.stringify(affected)}`);
  const bBase = await harvestOn(urlB, BASE, "BASE on B");
  const bHead = await harvestOn(urlB, HEAD.harvestChallengers, "HEAD on B");
  // House race ids are `LA-0N-2026`; the Senate seat's id does not start `LA-`.
  const laHouse = (rows: Row[]) => rows.filter((r) => r.race_id.startsWith("LA-"));
  const jName = String(jungle.name), jRace = String(jungle.race);
  const jBase = bBase.find((r) => r.race_id === jRace && r.name === jName);
  console.log(`    Louisiana House rows: BASE ${JSON.stringify(laHouse(bBase))} · HEAD ${JSON.stringify(laHouse(bHead))}`);
  check("leg 2 red: BASE publishes the jungle winner as won_primary", jBase?.status === "won_primary", jBase ? `published, ${jBase.status}` : "absent");
  check("leg 2 green: HEAD publishes nothing for Louisiana's jungle House seats (LA-01..LA-06)", laHouse(bHead).length === 0, `${laHouse(bHead).length} LA-0N row(s)`);
  const c2 = [String(ctl2.race), String(ctl2.name)] as const;
  check(`leg 2 control: ${c2[0]} "${c2[1]}" under a NULL-typed primary publishes under both`, has(bBase, ...c2) && has(bHead, ...c2), `BASE ${has(bBase, ...c2) ? "published" : "absent"} · HEAD ${has(bHead, ...c2) ? "published" : "absent"}`);

  console.log("\n── Leg 3 · the whole table (copy A, unperturbed)");
  const bK = new Set(aBase.map(key)), hK = new Set(aHead.map(key));
  const added = aHead.filter((r) => !bK.has(key(r)));
  const removed = aBase.filter((r) => !hK.has(key(r)));
  console.log(`    BASE ${aBase.length} rows · HEAD ${aHead.length} rows · added ${JSON.stringify(added)} · removed ${JSON.stringify(removed)}`);
  const expected = added.length === 1 && removed.length === 0 && added[0]!.race_id === "FL-20-2026" && added[0]!.name === fName && added[0]!.status === "won_primary"
    && added[0]!.party === "D" && added[0]!.bioguide_id === "W000797";
  check("leg 3: the delta is exactly STEP 0's prediction (+1 FL-20 D W000797 won_primary, nothing removed)", expected, `+${added.length} / -${removed.length}`);

  console.log(`\nLEGS: ${failures === 0 ? "ALL GREEN" : `${failures} FAILED`}`);
  return failures === 0 ? 0 : 1;
}

main()
  .then((code) => process.exit(code))
  .catch((e) => {
    console.error(e);
    process.exit(2);
  });
