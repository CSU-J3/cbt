// HO 402 — ID crosswalk sync from unitedstates/congress-legislators.
//
// Enriches the bioguide-keyed `members` roster with the authoritative external
// IDs every future cross-source join needs: FEC candidate IDs (money), ICPSR
// (Voteview ideology), Wikipedia/Ballotpedia titles (attention), plus GovTrack,
// LIS, C-SPAN, Wikidata, etc. Additive and reversible: writes only member_ids +
// member_fec_ids, never touches `members`.
//
// The source is YAML-only (no JSON build upstream), parsed with the existing
// js-yaml — one raw file GET + local parse, no pagination, no per-record network,
// no LLM. Runtime is seconds.
//
// GATE (the "never a source of new members" guarantee): load the known bioguide
// set from `members` first; skip + count any current-legislators record whose
// bioguide isn't in it (delegates / resident commissioner / drift). libSQL runs
// foreign_keys OFF, so the REFERENCES constraints are documentation — this gate
// is what actually prevents orphan inserts.
//
// Manual, paired with `sync:members` (HO 94, quarterly-plus). Run right after any
// `sync:members`. Source barely churns, so no cron in v1.
import "dotenv/config";
import yaml from "js-yaml";
import { getDb } from "../lib/db";

const RAW =
  "https://raw.githubusercontent.com/unitedstates/congress-legislators/main";

// The per-record `id` block. All fields optional except `bioguide`. `fec` is an
// ARRAY of candidate IDs (one per office sought over a career). Numeric IDs parse
// as JS numbers, string IDs (lis/thomas/wikidata/titles/opensecrets) as strings.
type IdBlock = {
  bioguide?: string;
  thomas?: string;
  lis?: string;
  govtrack?: number;
  opensecrets?: string;
  votesmart?: number;
  fec?: string[];
  cspan?: number;
  wikipedia?: string;
  house_history?: number;
  ballotpedia?: string;
  maplight?: number;
  icpsr?: number;
  wikidata?: string;
  google_entity_id?: string;
  pictorial?: number;
};

type Legislator = { id?: IdBlock };

async function main() {
  const db = getDb();

  // 1. Fetch + parse the current-legislators roster.
  const res = await fetch(`${RAW}/legislators-current.yaml`);
  if (!res.ok) {
    throw new Error(`legislators-current.yaml HTTP ${res.status}`);
  }
  const records = yaml.load(await res.text()) as Legislator[];
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("parsed legislators-current.yaml is empty — aborting");
  }
  console.log(`Parsed ${records.length} current-legislators records`);

  // 2. The gate: known bioguides from `members`.
  const memRes = await db.execute("SELECT bioguide_id FROM members");
  const known = new Set(memRes.rows.map((r) => r.bioguide_id as string));
  console.log(`Known bioguides in members: ${known.size}`);

  const fetchedAt = new Date().toISOString();
  let matched = 0;
  let skippedNoMember = 0;
  let fecRows = 0;
  const skipped: string[] = [];

  // 3. Upsert each record whose bioguide is in `members`; skip + count the rest.
  for (const rec of records) {
    const id = rec.id;
    const bioguide = id?.bioguide;
    if (!bioguide) continue; // malformed record, no key
    if (!known.has(bioguide)) {
      skippedNoMember++;
      skipped.push(bioguide);
      continue;
    }

    await db.execute({
      sql: `INSERT INTO member_ids (
              bioguide_id, icpsr, govtrack, lis, thomas, cspan, votesmart,
              wikidata, wikipedia_title, ballotpedia_title, google_entity_id,
              opensecrets, maplight, house_history, pictorial, raw_json, fetched_at
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(bioguide_id) DO UPDATE SET
              icpsr = excluded.icpsr,
              govtrack = excluded.govtrack,
              lis = excluded.lis,
              thomas = excluded.thomas,
              cspan = excluded.cspan,
              votesmart = excluded.votesmart,
              wikidata = excluded.wikidata,
              wikipedia_title = excluded.wikipedia_title,
              ballotpedia_title = excluded.ballotpedia_title,
              google_entity_id = excluded.google_entity_id,
              opensecrets = excluded.opensecrets,
              maplight = excluded.maplight,
              house_history = excluded.house_history,
              pictorial = excluded.pictorial,
              raw_json = excluded.raw_json,
              fetched_at = excluded.fetched_at`,
      args: [
        bioguide,
        id?.icpsr ?? null,
        id?.govtrack ?? null,
        id?.lis ?? null,
        id?.thomas ?? null,
        id?.cspan ?? null,
        id?.votesmart ?? null,
        id?.wikidata ?? null,
        id?.wikipedia ?? null,
        id?.ballotpedia ?? null,
        id?.google_entity_id ?? null,
        id?.opensecrets ?? null,
        id?.maplight ?? null,
        id?.house_history ?? null,
        id?.pictorial ?? null,
        // raw_json: the entire id block, a fidelity copy so a later handoff that
        // wants a field we didn't column-ize doesn't need a re-sync.
        JSON.stringify(id ?? {}),
        fetchedAt,
      ],
    });
    matched++;

    // member_fec_ids: delete-then-insert the whole fec array for this bioguide
    // (idempotent re-ingest, the observation_entities idiom). Absent array → the
    // delete clears any stale rows and nothing is inserted.
    await db.execute({
      sql: "DELETE FROM member_fec_ids WHERE bioguide_id = ?",
      args: [bioguide],
    });
    for (const candId of id?.fec ?? []) {
      await db.execute({
        sql: `INSERT INTO member_fec_ids (bioguide_id, fec_candidate_id)
              VALUES (?, ?)
              ON CONFLICT(bioguide_id, fec_candidate_id) DO NOTHING`,
        args: [bioguide, candId],
      });
      fecRows++;
    }
  }

  console.log("\n=== Crosswalk sync — HO 402 ===");
  console.log(`matched (member_ids upserted): ${matched}`);
  console.log(`skipped_no_member:             ${skippedNoMember}`);
  if (skipped.length > 0) console.log(`  ${skipped.join(", ")}`);
  console.log(`fec_rows (member_fec_ids):     ${fecRows}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
