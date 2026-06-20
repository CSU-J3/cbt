// HO 296 — B6 mover-feed diagnostic (read-only). Confirms the data each B6 row
// addition needs before the build. Run: npx tsx scripts/diagnostic/b6-mover-feed-296.ts
//
// Findings (2026-06-20): RELATED=NEWS wired but sparse on the feed slices;
// RELATED=HEARINGS wired (8/38 movers carry a meeting); RELATED=ODDS has NO
// bill↔market data (markets are macro/per-race, never per-bill); sponsor photos
// 535/536; the is_ceremonial classifier exists but only ~1.4k of 16.5k bills are
// classified (15k NULL pass as visible) — the TOP STALLS gate is weak today.
import "dotenv/config";
import { getDb } from "../../lib/db";

async function main() {
  const db = getDb();
  const q = async (label: string, sql: string) => {
    const r = await db.execute(sql);
    console.log(label, JSON.stringify(r.rows[0]));
  };

  console.log("=== RELATED=NEWS (news_mentions, bill-keyed) ===");
  await q(
    "corpus:",
    `SELECT COUNT(*) mentions, COUNT(DISTINCT bill_id) bills_with_news,
            (SELECT COUNT(DISTINCT bill_id) FROM news_mentions WHERE match_confidence>=0.7) bills_conf07
     FROM news_mentions`,
  );

  console.log("\n=== RELATED=HEARINGS (meeting_bills, bill->meeting reverse) ===");
  await q(
    "corpus:",
    `SELECT COUNT(*) joins, COUNT(DISTINCT bill_id) bills_with_meeting FROM meeting_bills`,
  );

  console.log("\n=== overlap on the three feed slices ===");
  for (const [label, where] of [
    ["movers(7d)", `b.stage_changed_at IS NOT NULL AND date(b.stage_changed_at)>=date('now','-7 days') AND (b.is_ceremonial=0 OR b.is_ceremonial IS NULL)`],
    ["new(7d)", `b.introduced_date>=date('now','-7 days') AND (b.is_ceremonial=0 OR b.is_ceremonial IS NULL)`],
  ] as const) {
    await q(
      `${label}:`,
      `SELECT COUNT(*) n,
              SUM(CASE WHEN EXISTS(SELECT 1 FROM news_mentions x WHERE x.bill_id=b.id) THEN 1 ELSE 0 END) with_news,
              SUM(CASE WHEN EXISTS(SELECT 1 FROM meeting_bills x WHERE x.bill_id=b.id) THEN 1 ELSE 0 END) with_hearing
       FROM bills b WHERE ${where}`,
    );
  }

  console.log("\n=== RELATED=ODDS (any bill<->market linkage?) ===");
  const t = await db.execute(
    `SELECT name FROM sqlite_master WHERE type='table' AND (name LIKE '%market%' OR name LIKE '%odds%')`,
  );
  console.log("market/odds tables:", t.rows.map((r) => r.name).join(", "));
  for (const tbl of ["market_ticks", "kalshi_odds", "polymarket_odds"]) {
    const c = await db.execute(`PRAGMA table_info(${tbl})`);
    const hasBill = c.rows.some((r) =>
      /bill/i.test(String((r as Record<string, unknown>).name)),
    );
    console.log(`  ${tbl}: bill_id column? ${hasBill}`);
  }

  console.log("\n=== Sponsor photos (members.depiction_url) ===");
  await q(
    "current members:",
    `SELECT COUNT(*) total, SUM(CASE WHEN depiction_url IS NOT NULL AND depiction_url<>'' THEN 1 ELSE 0 END) with_photo FROM members WHERE is_current=1`,
  );

  console.log("\n=== TOP STALLS ceremonial classifier coverage (is_ceremonial) ===");
  await q(
    "classification:",
    `SELECT COUNT(*) total,
            SUM(CASE WHEN is_ceremonial IS NULL THEN 1 ELSE 0 END) unclassified_null,
            SUM(CASE WHEN is_ceremonial=1 THEN 1 ELSE 0 END) ceremonial,
            SUM(CASE WHEN is_ceremonial=0 THEN 1 ELSE 0 END) substantive
     FROM bills`,
  );
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
