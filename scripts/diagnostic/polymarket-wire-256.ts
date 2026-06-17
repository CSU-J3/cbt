// Verification (HO 256): run the real fetchPolymarketSeatOdds + the cron's
// upsert path, then read polymarket_odds back. Confirms coverage, party
// resolution, ghost exclusion, and the table write end-to-end.
// Run: `npx tsx scripts/diagnostic/polymarket-wire-256.ts`
import "dotenv/config";
import { getDb } from "../../lib/db";
import { fetchPolymarketSeatOdds } from "../../lib/polymarket";

async function main() {
  console.log("fetching Polymarket Senate seat odds…");
  const odds = await fetchPolymarketSeatOdds();
  const db = getDb();
  const now = new Date().toISOString();

  const stmts = odds.map((p) => ({
    sql: `INSERT INTO polymarket_odds
            (race_id, cycle, slug, implied_pct, favorite_label,
             favorite_is_party, favorite_party, volume, liquidity, end_date, updated_at)
          VALUES (?, 2026, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(race_id) DO UPDATE SET
            slug = excluded.slug, implied_pct = excluded.implied_pct,
            favorite_label = excluded.favorite_label,
            favorite_is_party = excluded.favorite_is_party,
            favorite_party = excluded.favorite_party,
            volume = excluded.volume, liquidity = excluded.liquidity,
            end_date = excluded.end_date, updated_at = excluded.updated_at`,
    args: [
      p.raceId, p.slug, p.impliedPct, p.favoriteLabel,
      p.favoriteIsParty ? 1 : 0, p.favoriteParty, p.volume, p.liquidity, p.endDate, now,
    ],
  }));
  if (stmts.length > 0) await db.batch(stmts, "write");

  const rs = await db.execute(
    "SELECT race_id, implied_pct, favorite_label, favorite_is_party, favorite_party, volume, liquidity FROM polymarket_odds ORDER BY liquidity DESC",
  );
  console.log(`\npolymarket_odds rows: ${rs.rows.length}`);
  console.log(`${"race_id".padEnd(12)} ${"%".padStart(3)} ${"P".padStart(1)} pty ${"favorite".padEnd(22)} ${"vol".padStart(9)} ${"liq".padStart(8)}`);
  for (const r of rs.rows) {
    console.log(
      `${String(r.race_id).padEnd(12)} ${String(r.implied_pct).padStart(3)} ${String(r.favorite_party ?? "—").padStart(1)} ${String(r.favorite_is_party).padStart(3)} ${String(r.favorite_label).slice(0, 22).padEnd(22)} ${String(Math.round(Number(r.volume))).padStart(9)} ${String(Math.round(Number(r.liquidity))).padStart(8)}`,
    );
  }
  const nameOnly = rs.rows.filter((r) => r.favorite_party == null).map((r) => r.race_id);
  console.log(`\nfetched ${odds.length} | stored ${rs.rows.length} | name-only (party null): ${JSON.stringify(nameOnly)}`);
}

main().then(() => process.exit(0));
