// HO 393 — pro-Israel-PAC independent-expenditure DIRECTION sync. Pulls UDP's
// raw FEC Schedule E, collapses to distinct (target × support/oppose) with
// MIN/MAX(expenditure_date), resolves each to a tracked race by table lookup,
// and upserts into pac_ie_spending. NO dollar aggregation, NO dedup, NO
// reconciliation gate — we ship DIRECTION (a per-row fact) and deep-link the
// magnitude to FEC (Schedule E has no clean dollar source; see
// docs/oddities.md). `amount` is left NULL, reserved for a future audited
// backfill.
//
// Standalone/manual like sync:fec (there is no FEC cron to fold into today —
// sync:fec is itself a manual script). Reuses the FEC client / FEC_API_KEY from
// lib/fec.ts; minds the shared api.data.gov 1000/hr budget via fetchScheduleE's
// per-page politeness sleep. Run: `npm run sync:pac-ie`.
import "dotenv/config";
import { getDb } from "../lib/db";
import { type FecScheduleERow, fetchScheduleE, logResolvedFecKey } from "../lib/fec";
import { PAC_IE_CYCLE, UDP_COMMITTEE_ID, UDP_SPENDER } from "../lib/pac-ie";

type Db = ReturnType<typeof getDb>;

type Group = {
  candidateId: string;
  candidateName: string;
  supportOppose: "S" | "O";
  office: string | null;
  state: string | null;
  district: string | null;
  earliest: string | null;
  latest: string | null;
};

function collapse(rows: FecScheduleERow[]): Group[] {
  const groups = new Map<string, Group>();
  for (const row of rows) {
    const candidateId = row.candidate_id ?? null;
    const so = row.support_oppose_indicator ?? null;
    if (!candidateId || (so !== "S" && so !== "O")) continue; // skip malformed
    const key = `${candidateId}:${so}`;
    const date = row.expenditure_date ?? null;
    const g = groups.get(key);
    if (g) {
      if (date) {
        if (!g.earliest || date < g.earliest) g.earliest = date;
        if (!g.latest || date > g.latest) g.latest = date;
      }
    } else {
      groups.set(key, {
        candidateId,
        candidateName: row.candidate_name ?? candidateId,
        supportOppose: so,
        office: row.candidate_office ?? null,
        state: row.candidate_office_state ?? null,
        district: row.candidate_office_district ?? null,
        earliest: date,
        latest: date,
      });
    }
  }
  return [...groups.values()];
}

// Resolve office/state/district → races.id by table lookup (NOT string-building
// — members.fec_candidate_id would be the wrong, incumbent-only join). House
// districts are stored as INTEGER; the FEC district is 2-digit zero-padded, so
// coerce '05' → 5. Senate has no district (races.district IS NULL). Non-H/S
// offices (President) and unresolved seats return null → the target is dropped
// and logged.
async function resolveRaceId(
  db: Db,
  g: Group,
  cycle: number,
): Promise<string | null> {
  if (!g.state) return null;
  const chamber = g.office === "S" ? "senate" : g.office === "H" ? "house" : null;
  if (!chamber) return null;
  if (chamber === "senate") {
    const r = await db.execute({
      sql: `SELECT id FROM races
            WHERE chamber = 'senate' AND state = ? AND district IS NULL AND cycle = ?
            LIMIT 1`,
      args: [g.state, cycle],
    });
    return r.rows[0] ? (r.rows[0].id as string) : null;
  }
  const districtNum = g.district != null ? Number.parseInt(g.district, 10) : Number.NaN;
  if (!Number.isFinite(districtNum)) return null;
  const r = await db.execute({
    sql: `SELECT id FROM races
          WHERE chamber = 'house' AND state = ? AND district = ? AND cycle = ?
          LIMIT 1`,
    args: [g.state, districtNum, cycle],
  });
  return r.rows[0] ? (r.rows[0].id as string) : null;
}

const UPSERT_SQL = `
INSERT INTO pac_ie_spending (
  committee_id, spender, race_id, candidate_id, candidate_name,
  support_oppose, amount, earliest_date, latest_date, cycle, as_of
) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
ON CONFLICT(committee_id, candidate_id, support_oppose, cycle) DO UPDATE SET
  race_id = excluded.race_id,
  candidate_name = excluded.candidate_name,
  earliest_date = excluded.earliest_date,
  latest_date = excluded.latest_date,
  as_of = excluded.as_of
`;

async function main(): Promise<void> {
  logResolvedFecKey();
  const db = getDb();
  const cycle = PAC_IE_CYCLE;

  const raw = await fetchScheduleE(UDP_COMMITTEE_ID, cycle);
  if (raw === null) {
    console.error(
      `Schedule E fetch failed (transient) for ${UDP_COMMITTEE_ID} cycle ${cycle} — no write, prior rows untouched.`,
    );
    process.exit(1);
  }
  console.log(`fetched ${raw.length} raw Schedule E rows for ${UDP_COMMITTEE_ID}`);

  const groups = collapse(raw);
  console.log(`collapsed to ${groups.length} distinct (target × support/oppose) groups`);

  const now = new Date().toISOString();
  let stored = 0;
  const dropped: string[] = [];

  for (const g of groups) {
    const raceId = await resolveRaceId(db, g, cycle);
    const office = `${g.office ?? "?"}-${g.state ?? "??"}-${g.district ?? "??"}`;
    const dir = g.supportOppose === "S" ? "support" : "oppose";
    if (!raceId) {
      // Coverage gap: a real UDP target outside the rated/tracked race set
      // (MD-05, NJ-11 today). Logged, not shown — visible so gaps stay honest.
      dropped.push(`${office} ${g.candidateName} (${dir})`);
      continue;
    }
    await db.execute({
      sql: UPSERT_SQL,
      args: [
        UDP_COMMITTEE_ID,
        UDP_SPENDER,
        raceId,
        g.candidateId,
        g.candidateName,
        g.supportOppose,
        g.earliest,
        g.latest,
        cycle,
        now,
      ],
    });
    stored++;
    console.log(
      `  stored ${raceId} ← ${office} ${g.candidateName} (${dir}) · ${g.earliest}..${g.latest}`,
    );
  }

  console.log(`\ndone — stored=${stored} dropped=${dropped.length}`);
  if (dropped.length > 0) {
    console.log("dropped (no tracked race — coverage gap, logged not shown):");
    for (const d of dropped) console.log(`  - ${d}`);
  }

  // Flush the race-surface reads (getPacIeSpending rides the `races` tag). CLI
  // scripts can't revalidateTag the Next runtime directly, so POST the deployed
  // /api/revalidate route (same pattern as sync:fec). Soft-fail when unset.
  const revalidateUrl = process.env.REVALIDATE_URL;
  const secret = process.env.CRON_SECRET;
  if (revalidateUrl && secret) {
    try {
      await fetch(`${revalidateUrl}?tag=races`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      console.log("Flushed `races` cache tag.");
    } catch (e) {
      console.warn("Revalidate POST failed (non-fatal):", e);
    }
  } else {
    console.log(
      "REVALIDATE_URL / CRON_SECRET not set — flush the `races` tag manually.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
