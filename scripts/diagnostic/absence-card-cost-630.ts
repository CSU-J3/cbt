// HO 630 STEP 0 — the prefetched member card's read cost. Read-only. BUILDS NOTHING.
//
// THE QUESTION. HO 630 makes the Absence Watch band prefetch each absent member's
// full card bundle so a click can expand in place instead of navigating. That adds
// five reads per band member inside `getAbsenceWatch`, which is cached on the
// `votes` tag at one regeneration a day. The ledger discipline (HO 624/625) says
// price it in ROWS, not milliseconds, and state the delta rather than assert it is
// small — the whole point of that rule is that "index-only, 96ms" and "a quarter of
// the account's monthly budget" were true of the same query.
//
// WHY RAW HTTP AND NOT @libsql/client: `@libsql/client` v0.14.0 does not surface
// per-statement `rows_read`; Turso's hrana `/v2/pipeline` does. Technique lifted
// verbatim from `bills-agg-cost-624.ts` — same DB, same credentials, read-only.
//
// THE INSTRUMENT'S TRAP, restated because it is easy to re-enter: a BARE `COUNT(*)`
// is answered from B-tree interior pages and under-reports scan cost by orders of
// magnitude (624 M0 measured member_votes 366,496 rows -> rows_read 1,617). Nothing
// here prices a scan by a bare count; every figure below is the real statement.
//
//   npx tsx scripts/diagnostic/absence-card-cost-630.ts
import "dotenv/config";

// THE SQL BELOW IS COPIED VERBATIM FROM THE SHIPPED HELPERS AT HO 630 (`lib/queries.ts`
// getSponsorStats / getSponsorTopTopics / getSponsorRecentBills / getMemberCommittees /
// getMemberAffiliations, assembled by getMemberCardExpansion). A verbatim copy is a
// dependency with no compiler edge, so RECONCILE IT AGAINST THOSE FIVE BEFORE TRUSTING
// A RE-RUN — a stale copy and a current one emit identical green (HO 554 -> 557).
//
// Reconciling it the first time already corrected two paraphrases that would have
// UNDERSTATED the delta, which is the whole reason the rule exists:
//   · getSponsorRecentBills has NO LIMIT — it returns every summarized bill the
//     member sponsored, ordered by action date; RECENT_BILLS_CAP = 7 is a
//     RENDER-ONLY slice in SponsorExpandedPanel. A probe with a LIMIT prices a
//     query the app does not run.
//   · getSponsorTopTopics does NOT aggregate in SQL — it selects raw `topics` for
//     every matching bill and counts in JS, so its read is the full row set, not
//     a 3-row GROUP BY.
const PARTICIPATION_FLOOR = 50; // lib/queries.ts, the strip's population floor

type Exec = { rows: unknown[][]; rowsRead: number; ms: number };

let httpUrl = "";
let token = "";

async function exec(sql: string, args: (string | number)[] = []): Promise<Exec> {
  const res = await fetch(`${httpUrl}/v2/pipeline`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      requests: [
        {
          type: "execute",
          stmt: {
            sql,
            args: args.map((a) =>
              typeof a === "number"
                ? { type: "integer", value: String(a) }
                : { type: "text", value: a },
            ),
          },
        },
        { type: "close" },
      ],
    }),
  });
  const j = (await res.json()) as {
    results?: { type: string; response?: { result?: Record<string, unknown> }; error?: unknown }[];
  };
  const r = j.results?.[0];
  if (!r || r.type !== "ok" || !r.response?.result) {
    throw new Error(
      `query failed: ${JSON.stringify(r?.error ?? r).slice(0, 400)}\n  sql: ${sql.slice(0, 200)}`,
    );
  }
  const q = r.response.result as {
    rows: { value: unknown }[][];
    rows_read: number;
    query_duration_ms: number;
  };
  return {
    rows: q.rows.map((row) => row.map((c) => c?.value)),
    rowsRead: q.rows_read,
    ms: q.query_duration_ms,
  };
}

async function main() {
  const raw = process.env.TURSO_DATABASE_URL ?? "";
  token = process.env.TURSO_AUTH_TOKEN ?? "";
  if (!raw || !token) throw new Error("TURSO_DATABASE_URL / TURSO_AUTH_TOKEN required");
  httpUrl = raw.replace(/^libsql:/, "https:");

  console.log("=".repeat(96));
  console.log("HO 630 STEP 0 — Absence Watch card prefetch: rows_read delta. Read-only.");
  console.log("=".repeat(96));
  console.log(`  target: ${httpUrl.replace(/\/\/.*@/, "//")}\n`);

  // ── Who is actually in the band right now ──────────────────────────────────
  // Reproduces Phase A + the population filter only far enough to name the
  // members; the streak walk is the shipped code's job, not this probe's.
  const pop = await exec(
    `SELECT p.bioguide_id AS bio
       FROM member_participation p
       JOIN members m ON m.bioguide_id = p.bioguide_id
      WHERE m.is_current = 1 AND p.total >= ?
        AND NOT (m.chamber = 'house' AND m.state IN ('DC','AS','GU','MP','PR','VI'))`,
    [PARTICIPATION_FLOOR],
  );
  console.log(`  M0  population read           rows_read ${String(pop.rowsRead).padStart(7)}  (${pop.rows.length} floored members)`);

  // The live band, taken from the running app rather than re-derived here — the
  // two members the streak rule returns today (HO 622/623: McConnell, Wilson).
  const BAND = (process.env.BAND ?? "M000355,W000808").split(",").filter(Boolean);
  console.log(`  band under test: ${BAND.join(", ")}  (${BAND.length} members)\n`);

  console.log("  M1 — the five helpers getMemberCardExpansion assembles, per member");
  console.log("  " + "-".repeat(92));

  let total = 0;
  for (const bio of BAND) {
    // getSponsorStats
    const stats = await exec(
      `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN stage = 'enacted' THEN 1 ELSE 0 END) AS enacted,
          SUM(CASE WHEN stage = 'introduced' THEN 1 ELSE 0 END) AS introduced,
          SUM(CASE WHEN stage = 'committee' THEN 1 ELSE 0 END) AS committee,
          SUM(CASE WHEN stage = 'floor' THEN 1 ELSE 0 END) AS floor_count,
          SUM(CASE WHEN stage = 'other_chamber' THEN 1 ELSE 0 END) AS other_chamber,
          SUM(CASE WHEN stage = 'president' THEN 1 ELSE 0 END) AS president
        FROM bills INDEXED BY idx_bills_sponsor_agg
        WHERE sponsor_bioguide_id = ? AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`,
      [bio],
    );
    // getSponsorTopTopics — selects raw `topics` per bill; the top-3 is JS-side.
    const topics = await exec(
      `SELECT topics FROM bills INDEXED BY idx_bills_sponsor_topics
            WHERE sponsor_bioguide_id = ?
              AND topics IS NOT NULL AND (is_ceremonial = 0 OR is_ceremonial IS NULL)`,
      [bio],
    );
    // getSponsorRecentBills — NO LIMIT; the 7-row cap is render-only.
    const recent = await exec(
      `SELECT id, congress, bill_type, bill_number, title,
      sponsor_name, sponsor_party, sponsor_state, introduced_date,
      latest_action_date, latest_action_text, update_date,
      summary, topics, stage, stage_observed_at
      FROM bills INDEXED BY idx_bills_sponsor_agg
      WHERE sponsor_bioguide_id = ?
        AND summary IS NOT NULL AND (is_ceremonial = 0 OR is_ceremonial IS NULL)
      ORDER BY latest_action_date DESC NULLS LAST`,
      [bio],
    );
    // getMemberCommittees
    const cmte = await exec(
      `SELECT cm.role, cm.party_side, cm.rank,
                   c.system_code, c.name, c.chamber, c.committee_type,
                   c.parent_system_code,
                   p.name AS parent_name
            FROM committee_members cm
            JOIN committees c ON c.system_code = cm.committee_system_code
            LEFT JOIN committees p ON p.system_code = c.parent_system_code
            WHERE cm.bioguide_id = ? AND c.is_current = 1
            ORDER BY
              c.parent_system_code IS NOT NULL ASC,
              CASE c.committee_type
                WHEN 'Standing' THEN 1
                WHEN 'Select' THEN 2
                WHEN 'Joint' THEN 3
                WHEN 'Task Force' THEN 4
                ELSE 5
              END,
              COALESCE(p.name, '') ASC,
              c.name ASC`,
      [bio],
    );
    // getMemberAffiliations
    const aff = await exec(
      `SELECT org, category, source_url, last_verified
            FROM affiliations
            WHERE bioguide_id = ?`,
      [bio],
    );

    const per = stats.rowsRead + topics.rowsRead + recent.rowsRead + cmte.rowsRead + aff.rowsRead;
    total += per;
    console.log(
      `    ${bio}  stats ${String(stats.rowsRead).padStart(5)} · topics ${String(topics.rowsRead).padStart(5)} · ` +
        `recent ${String(recent.rowsRead).padStart(4)} · committees ${String(cmte.rowsRead).padStart(4)} · ` +
        `affiliations ${String(aff.rowsRead).padStart(3)}   = ${String(per).padStart(6)}`,
    );
  }

  // The palestine scalars the band also picks up (one batched read, not per member).
  const ph = BAND.map(() => "?").join(",");
  const score = await exec(
    `SELECT bioguide_id, grade, rank, total_score FROM palestine_scorecard WHERE bioguide_id IN (${ph})`,
    BAND,
  );
  total += score.rowsRead;
  console.log(`    palestine_scorecard (batched, 1 read for the whole band)                        = ${String(score.rowsRead).padStart(6)}`);

  console.log("  " + "-".repeat(92));
  console.log(`  DELTA per getAbsenceWatch regeneration: ${total} rows read, for ${BAND.length} members`);
  console.log(`  per member: ~${Math.round(total / Math.max(1, BAND.length))}`);
  console.log("");
  console.log("  Cadence: getAbsenceWatch is unstable_cache(revalidate 3600, tags ['votes']),");
  console.log("  so this is paid on regeneration — not per request, and not per expand");
  console.log("  (the expand is a client toggle over prefetched props: zero reads).");
  console.log("");
  console.log("  Scaling: linear in band membership, which ABSENCE_STREAK_MIN = 30 bounds to");
  console.log("  a handful. Re-run with BAND=<bio,bio> if the band grows.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
