// HO 455 read-only coverage diagnostic. Confirms the nominations backfill landed
// whole and reports the headline stats: stored vs live count, the civ/mil split
// (~833/1,051 from the HO 454 probe), the PERSISTED disposition distribution (the
// differentiator + the residual check), organization cardinality + top-12, and
// the deferred-column NULL rate (100% in v1, confirming the list-only deferral is
// clean). No writes.
//
//   npx tsx scripts/diagnostic/nominations-coverage-455.ts
import "dotenv/config";
import { createClient } from "@libsql/client";
import { getCurrentCongress } from "../../lib/congress";

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN,
});
const API = "https://api.congress.gov/v3";
const KEY = process.env.CONGRESS_API_KEY;
const CONGRESS = getCurrentCongress();

const one = async (sql: string, args: (string | number)[] = []) => (await db.execute({ sql, args })).rows[0];
const many = async (sql: string, args: (string | number)[] = []) => (await db.execute({ sql, args })).rows;
const pct = (n: number, d: number) => (d ? ((100 * n) / d).toFixed(1) + "%" : "n/a");

async function main() {
  console.log("=== nominations coverage (HO 455) ===\n");

  const total = Number((await one("SELECT COUNT(*) AS n FROM nominations"))?.n ?? 0);
  let live = -1;
  if (KEY) {
    try {
      const res = await fetch(`${API}/nomination/${CONGRESS}?limit=1&format=json&api_key=${KEY}`, {
        headers: { Accept: "application/json" },
      });
      live = ((await res.json()) as { pagination?: { count?: number } }).pagination?.count ?? -1;
    } catch (e) {
      console.warn(`  live count fetch failed: ${(e as Error).message}`);
    }
  }
  console.log(`stored rows: ${total}   live pagination.count: ${live >= 0 ? live : "(no CONGRESS_API_KEY)"}`);
  if (live >= 0) console.log(`  landed-clean: ${total >= live ? "YES" : `NO — missing ${live - total}`}`);

  console.log("\n=== civ/mil split (probe: ~833 civ / ~1,051 mil) ===");
  const mil = Number((await one("SELECT COUNT(*) AS n FROM nominations WHERE is_military = 1"))?.n ?? 0);
  const civ = total - mil;
  console.log(`  civilian: ${civ} (${pct(civ, total)})`);
  console.log(`  military: ${mil} (${pct(mil, total)})`);

  console.log("\n=== disposition distribution (PERSISTED enum — headline stat) ===");
  const disp = await many(
    "SELECT disposition, COUNT(*) AS n FROM nominations GROUP BY disposition ORDER BY n DESC",
  );
  for (const r of disp) console.log(`  ${String(r.disposition).padEnd(12)} ${r.n}  (${pct(Number(r.n), total)})`);
  console.log("  civilian-only (the surface's target):");
  const dispCiv = await many(
    "SELECT disposition, COUNT(*) AS n FROM nominations WHERE is_military = 0 GROUP BY disposition ORDER BY n DESC",
  );
  for (const r of dispCiv) console.log(`    ${String(r.disposition).padEnd(12)} ${r.n}  (${pct(Number(r.n), civ)})`);

  console.log("\n=== organization cardinality + top 12 ===");
  const orgCard = Number((await one("SELECT COUNT(DISTINCT organization) AS n FROM nominations"))?.n ?? 0);
  console.log(`  distinct organizations: ${orgCard}`);
  const topOrgs = await many(
    "SELECT COALESCE(organization,'(null)') AS org, COUNT(*) AS n FROM nominations GROUP BY organization ORDER BY n DESC LIMIT 12",
  );
  for (const r of topOrgs) console.log(`    ${String(r.n).padStart(5)}  ${String(r.org).slice(0, 60)}`);

  console.log("\n=== deferred-column NULL rate (expect 100% in v1 list-only) ===");
  const cteNull = Number((await one("SELECT COUNT(*) AS n FROM nominations WHERE committee_system_code IS NULL"))?.n ?? 0);
  const nomNull = Number((await one("SELECT COUNT(*) AS n FROM nominations WHERE nominee_count IS NULL"))?.n ?? 0);
  console.log(`  committee_system_code NULL: ${cteNull}/${total} (${pct(cteNull, total)})`);
  console.log(`  nominee_count NULL:         ${nomNull}/${total} (${pct(nomNull, total)})`);

  console.log("\n=== latest_action_text coverage (the amendments contrast — probe said 100%) ===");
  const actPresent = Number((await one("SELECT COUNT(*) AS n FROM nominations WHERE latest_action_text IS NOT NULL"))?.n ?? 0);
  console.log(`  latest_action_text present: ${actPresent}/${total} (${pct(actPresent, total)})  [amendments was 8.6%]`);

  db.close();
}

main().catch((e) => {
  console.error(`diagnostic failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
