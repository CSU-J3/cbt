import "dotenv/config";
import { createClient } from "@libsql/client";

// A dedicated UNBOUNDED client (not lib/db's getDb). getDb wraps every request
// in a 10s AbortSignal.timeout (HO 238) sized for co-located Vercel egress;
// from a laptop against Turso us-west-2 a corpus COUNT can exceed that and
// abort. This run-once backfill isn't latency-sensitive, so it skips the bound.
function getDb() {
  const url = process.env.TURSO_DATABASE_URL;
  const authToken = process.env.TURSO_AUTH_TOKEN;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({ url, authToken });
}

// HO 242 Part B — one-time backfill of reports.laws_count / intro_count /
// moves_count on rows generated before the columns existed. (New reports get
// the columns at generation time; this only fills the historical rows.)
//
// Source of truth, per count — chosen for fidelity to what the report SHOWS:
//
//  - laws / moves: parsed from the report's own `## Enactments (N)` /
//    `## Stage movements (N)` header. That N is the exact generation-time
//    value the reader sees, so the strip will agree with the body. This is
//    NOT a fresh recompute on purpose: `moves` is derived at generation from
//    the SINGLE-SLOT bills.stage_changed_at, which later transitions
//    overwrite — so recomputing an old week now would UNDERCOUNT. The header
//    is the only faithful record. `laws` is stable either way (enacted is
//    terminal) but is taken from the header for the same agree-with-the-body
//    reason.
//
//  - intro: recomputed with the SAME predicate the generation pipeline uses
//    (introduced_date BETWEEN week AND non-ceremonial). introduced_date is
//    immutable, so the recompute equals the generation-time value exactly;
//    there is no header to parse (the count lives in the lead prose). Safe to
//    inline the predicate here because this is a run-once script — future
//    reports never touch this path.
//
// DRY RUN by default — prints a parity table and writes nothing. Pass
// `--commit` to perform the UPDATEs. Eyeball first (the handoff guard: don't
// write a wrong value across every row).

const NON_CEREMONIAL = "(is_ceremonial = 0 OR is_ceremonial IS NULL)";

function parseHeaderCount(md: string, header: string): number | null {
  const re = new RegExp(`^##\\s+${header}\\s*\\((\\d+)\\)`, "m");
  const m = re.exec(md);
  return m ? Number(m[1]) : null;
}

async function main() {
  const commit = process.argv.includes("--commit");
  const db = getDb();

  const rs = await db.execute(
    `SELECT slug, week_start, week_end, content_md, laws_count, intro_count, moves_count
     FROM reports
     ORDER BY week_start DESC`,
  );

  console.log(`${rs.rows.length} reports. Mode: ${commit ? "COMMIT" : "DRY RUN"}\n`);
  console.log("week        | LAWS  INTRO  MOVES | source");
  console.log("-".repeat(54));

  const updates: {
    slug: string;
    laws: number;
    intro: number;
    moves: number;
  }[] = [];
  let skipped = 0;

  for (const r of rs.rows) {
    const slug = r.slug as string;
    const weekStart = r.week_start as string;
    const weekEnd = r.week_end as string;
    const md = (r.content_md as string) ?? "";

    const laws = parseHeaderCount(md, "Enactments");
    const moves = parseHeaderCount(md, "Stage movements");

    const introRs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM bills
            WHERE introduced_date BETWEEN ? AND ?
              AND ${NON_CEREMONIAL}`,
      args: [weekStart, weekEnd],
    });
    const intro = Number(introRs.rows[0]?.n ?? 0);

    if (laws === null || moves === null) {
      skipped++;
      console.log(
        `${weekStart} | ${String(laws).padStart(4)}  ${String(intro).padStart(5)}  ${String(moves).padStart(5)} | SKIP (header unparsable)`,
      );
      continue;
    }

    console.log(
      `${weekStart} | ${String(laws).padStart(4)}  ${String(intro).padStart(5)}  ${String(moves).padStart(5)} | header+calc`,
    );
    updates.push({ slug, laws, intro, moves });
  }

  console.log("-".repeat(54));
  console.log(
    `\n${updates.length} row(s) ready; ${skipped} skipped (no parseable header).`,
  );

  if (!commit) {
    console.log("\nDRY RUN — nothing written. Re-run with --commit to apply.");
    return;
  }

  for (const u of updates) {
    await db.execute({
      sql: `UPDATE reports SET laws_count = ?, intro_count = ?, moves_count = ? WHERE slug = ?`,
      args: [u.laws, u.intro, u.moves, u.slug],
    });
  }
  console.log(`\nUpdated ${updates.length} rows.`);

  const revalidateUrl = process.env.REVALIDATE_URL;
  const secret = process.env.CRON_SECRET;
  if (revalidateUrl && secret) {
    try {
      await fetch(`${revalidateUrl}?tag=reports`, {
        method: "POST",
        headers: { Authorization: `Bearer ${secret}` },
      });
      console.log("Flushed `reports` cache tag.");
    } catch (e) {
      console.warn("Revalidate POST failed (non-fatal):", e);
    }
  } else {
    console.log(
      "REVALIDATE_URL / CRON_SECRET not set — flush the `reports` tag manually.",
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
