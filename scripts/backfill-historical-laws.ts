// handoff 101 — one-time backfill of the 118th Congress's enacted laws into
// `historical_laws`, for the laws-enacted comparison chart. Paginates
// Congress.gov `/law/118` and upserts; no LLM calls. `npm run backfill:laws`.
//
// Verified `/law/{congress}` shape (HO 101 pre-flight): the array key is
// `bills` (it returns the originating bill objects); per item the enacted
// date is `latestAction.actionDate`, the law number is `laws[0].number`
// ("118-2" form), and the origin bill is `congress`/`type`/`number`.
//
// The 119th is NOT backfilled — its enacted laws live in `bills`
// (stage='enacted'); the chart query UNIONs the two sources.
import "dotenv/config";
import { getDb } from "../lib/db";

const API_BASE = "https://api.congress.gov/v3";
const PAGE_LIMIT = 250; // Congress.gov list-endpoint maximum
const CONGRESS = 118;

type LawItem = {
  congress: number;
  type?: string; // originating bill type, e.g. "HR", "S"
  number?: string | number; // originating bill number
  title?: string;
  latestAction?: { actionDate?: string; text?: string };
  laws?: { number?: string; type?: string }[];
};

type LawResponse = {
  bills?: LawItem[];
  pagination?: { count?: number; next?: string | null };
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const apiKey = process.env.CONGRESS_API_KEY;
  if (!apiKey) throw new Error("CONGRESS_API_KEY is not set");
  const db = getDb();

  let offset = 0;
  let seen = 0;
  let upserted = 0;
  let skipped = 0;
  let apiCount: number | null = null;

  for (;;) {
    const url =
      `${API_BASE}/law/${CONGRESS}` +
      `?offset=${offset}&limit=${PAGE_LIMIT}&format=json` +
      `&api_key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(
        `/law/${CONGRESS} HTTP ${res.status}: ${body.slice(0, 200)}`,
      );
    }
    const data = (await res.json()) as LawResponse;
    if (apiCount === null) apiCount = data.pagination?.count ?? null;
    const page = data.bills ?? [];

    for (const item of page) {
      seen++;
      const lawNumber = item.laws?.[0]?.number;
      const enactedDate = item.latestAction?.actionDate;
      if (!lawNumber || !enactedDate) {
        skipped++;
        console.warn(
          `  skipped — bill ${item.type ?? "?"} ${item.number ?? "?"}: ` +
            "missing law number or enacted date",
        );
        continue;
      }
      // bills.id format — "118-hr-346" — so the chart can join back if needed.
      const sourceBillId =
        item.type && item.number != null
          ? `${item.congress}-${String(item.type).toLowerCase()}-${item.number}`
          : null;
      await db.execute({
        sql: `INSERT INTO historical_laws
                (congress, law_number, source_bill_id, enacted_date, title)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(congress, law_number) DO UPDATE SET
                source_bill_id = excluded.source_bill_id,
                enacted_date = excluded.enacted_date,
                title = excluded.title`,
        args: [
          item.congress,
          lawNumber,
          sourceBillId,
          enactedDate,
          item.title ?? null,
        ],
      });
      upserted++;
    }

    if (page.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
    await sleep(300); // be polite between pages
  }

  const rowCount = await db.execute({
    sql: "SELECT COUNT(*) AS n FROM historical_laws WHERE congress = ?",
    args: [CONGRESS],
  });

  console.log(`\n=== backfill historical_laws — ${CONGRESS}th Congress ===`);
  console.log(`API pagination.count: ${apiCount ?? "unknown"}`);
  console.log(`Items seen:           ${seen}`);
  console.log(`Upserted:             ${upserted}`);
  console.log(`Skipped (bad fields): ${skipped}`);
  console.log(
    `historical_laws rows (congress=${CONGRESS}): ${rowCount.rows[0]!.n}`,
  );
  if (apiCount !== null && Number(rowCount.rows[0]!.n) !== apiCount) {
    console.warn(
      `WARNING: row count != API count — ${skipped} item(s) were skipped.`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
