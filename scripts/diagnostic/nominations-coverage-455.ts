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

  // Landed-clean keys on the DISTINCT-ENUMERABLE set, not pagination.count: the
  // /nomination list carries exact-duplicate entries (HO 455: 5 in the 119th), so
  // pagination.count > distinct ids and a deduped store can never reach it. Mirror
  // the repair gate — enumerate the full list, dedupe by (congress, pn, part), and
  // report the drift rather than chasing it.
  let live = -1;
  let distinctLive = -1;
  if (KEY) {
    try {
      const partOf = (it: { partNumber?: string }) =>
        it.partNumber != null && String(it.partNumber).length > 0 ? String(it.partNumber) : "00";
      const ids = new Set<string>();
      let offset = 0;
      for (;;) {
        const res = await fetch(
          `${API}/nomination/${CONGRESS}?sort=updateDate asc&limit=250&offset=${offset}&format=json&api_key=${KEY}`,
          { headers: { Accept: "application/json" } },
        );
        const j = (await res.json()) as {
          pagination?: { count?: number };
          nominations?: { congress?: number; number?: number; partNumber?: string }[];
        };
        if (live < 0) live = j.pagination?.count ?? -1;
        const items = j.nominations ?? [];
        if (!items.length) break;
        for (const it of items) ids.add(`${it.congress ?? CONGRESS}-pn${it.number}-${partOf(it)}`);
        offset += items.length;
        if (items.length < 250) break;
        await new Promise((r) => setTimeout(r, 120));
      }
      distinctLive = ids.size;
    } catch (e) {
      console.warn(`  live enumeration failed: ${(e as Error).message}`);
    }
  }
  const dupes = live >= 0 && distinctLive >= 0 ? live - distinctLive : 0;
  console.log(
    `stored rows: ${total}   distinct-live: ${distinctLive >= 0 ? distinctLive : "(no CONGRESS_API_KEY)"}   ` +
      `pagination.count: ${live >= 0 ? live : "—"}`,
  );
  if (distinctLive >= 0) {
    const clean = total >= distinctLive;
    console.log(
      `  landed-clean: ${clean ? "YES" : `NO — missing ${distinctLive - total}`}` +
        (dupes > 0 ? ` (${distinctLive} distinct; ${dupes} API duplicate${dupes === 1 ? "" : "s"} in pagination.count)` : ""),
    );
  }

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
