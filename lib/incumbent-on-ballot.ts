// HO 750 — the race page's lookup, uncached: is the seat's stored incumbent
// printed on the race's November ballot? lib/queries.ts wraps this in
// unstable_cache under the `general-ballot` and `races` tags
// (getIncumbentOnBallot), and
// HO 750's leg 5 calls it directly on a `file:` copy, so the lookup the legs
// read is the lookup the page runs.
//   onBallot true   the rule in lib/ballot-incumbent.ts finds the incumbent on
//                   a row (identity, or the underline-and-surname fallback);
//            false  the race has a `box` read and the incumbent is on no row;
//            null   no `box` read (Louisiana's jungle seats, FL-10's canceled
//                   general, a race not read yet), or no stored incumbent.
import type { Client } from "@libsql/client";
import { findIncumbentOnBallot, type IncumbentRoute } from "./ballot-incumbent";

export type IncumbentOnBallotReading = { onBallot: boolean | null; route: IncumbentRoute | null };

export async function readIncumbentOnBallot(db: Client, raceId: string): Promise<IncumbentOnBallotReading> {
  const [raceRs, readRs, rowsRs] = await db.batch(
    [
      {
        sql: `SELECT r.incumbent_bioguide_id, m.last_name
                FROM races r LEFT JOIN members m ON m.bioguide_id = r.incumbent_bioguide_id
               WHERE r.id = ?`,
        args: [raceId],
      },
      { sql: `SELECT status FROM general_ballot_reads WHERE race_id = ?`, args: [raceId] },
      {
        sql: `SELECT person_key, name, bioguide_id, incumbent_marked, on_ballot
                FROM general_ballot WHERE race_id = ?`,
        args: [raceId],
      },
    ],
    "read",
  );
  const inc = raceRs!.rows[0]?.incumbent_bioguide_id;
  if (inc == null || readRs!.rows[0]?.status !== "box") return { onBallot: null, route: null };
  const lastName = raceRs!.rows[0]?.last_name;
  const found = findIncumbentOnBallot(
    rowsRs!.rows.map((r) => ({
      person_key: String(r.person_key),
      name: String(r.name),
      bioguide_id: r.bioguide_id == null ? null : String(r.bioguide_id),
      incumbent_marked: Number(r.incumbent_marked),
      on_ballot: Number(r.on_ballot),
    })),
    { bioguideId: String(inc), lastName: lastName == null ? null : String(lastName) },
  );
  return { onBallot: found.route !== "none", route: found.route };
}
