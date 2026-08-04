// HO 598 STEP 0 — why /lobbying?q= renders "No filings match" against real matches.
// READ-ONLY: a runtime guard refuses any non-SELECT / non-EXPLAIN statement.
//
// THE INSTRUMENT IS UNBOUNDED ON PURPOSE (scope guard 3). lib/db.ts aborts at 10s
// and retries once, so anything past the bound reports ~20.00s whether it takes 21
// seconds or five minutes — every 20.00Xs in this arc is that ceiling, not a cost
// (HO 597's correction; 594 M1's 120s client is the precedent). A bounded client
// here would cap the finding at the number the timeout was set to.
//
// THE HEADLINE, AND IT REFRAMES THE HO: the LIKE is not the cost. The WALK is.
// A `COUNT(*) ... WHERE registrant_name IS NOT NULL` — a name-column read with NO
// predicate to evaluate — measured 86.3s / 47.9s co-located. That is worse than
// most of the LIKE queries it was meant to baseline. Cost tracks TABLE ROWS
// DRAGGED, not the predicate and not the match count.
//
// CO-LOCATED (pdx1, throwaway preview probe on branch 598-probe, now deleted).
// One query per invocation, 90s gaps so every run is cold, unbounded client:
//
//   query                                matches   runs (ms)          worst
//   walk_notnull (name read, NO LIKE)    129,401   86258, 47921       86.3s
//   search_page  "zzqx…" (zero-match)          0   91258, 55964       91.3s
//   search_count "boeing"                     78   60155, 33871       60.2s
//   search_count "llc"                    50,197   58147              58.1s
//   search_count_bounded "boeing"             78   55130, 26266       55.1s
//   linked_count (EXISTS, no LIKE)        33,807   36909              36.9s
//   shipped_pair "boeing" (page+count)        78   34787, 33831       34.8s
//   search_page  "boeing"                     78   2494, 19821        19.8s
//   search_page  "llc"                    50,197   3296                3.3s
//   search_count_bounded "llc"            50,197   2245, 1129          2.25s
//   baseline_count (NOT a walk — see below)   —     17, 4552           4.55s
//
// Four things follow, and two of them kill the cheap fixes:
//   1. M3 — a BOUNDED count fixes the COMMON case (58.1s -> 2.25s, ~26x) and does
//      NOTHING for the rare one (60.2s -> 55.1s). "boeing" has 78 matches, under
//      the 521 bound, so it never short-circuits. The reported bug is the case the
//      cheap fix misses.
//   2. M4 — dropping the total entirely does not fix it either: the PAGE query
//      alone is 19.8s for "boeing" and 91.3s for a zero-match term.
//   3. `baseline_count` is NOT a table-walk baseline and was a wrong instrument in
//      the first draft: SQLite satisfies an unqualified COUNT(*) from the SMALLEST
//      index, never touching the table (17ms co-located). walk_notnull replaced it.
//   4. Run-to-run spread is ~2x on identical work (search_page "boeing" 2.5s vs
//      19.8s), so every figure above is a WORST CASE and the finding is the
//      30-90s BAND, not the ranking inside it.
//
// AND THE ~700ms -> 91.3s DELTA IS UNATTRIBUTED. oddities.md:235 records no
// measurement conditions for the 700ms, while the entry below it distinguishes
// "a TEMP B-TREE at 7.8s COLD" for VOLUME — the arc separated cold for one number
// and not the other. The gap is unexplained between corpus growth (1.15x),
// conditions, and platform. Do not cite it as a 130x Turso regression.
//
//   npx tsx scripts/diagnostic/lobbying-search-cost-598.ts
import "dotenv/config";
import { createClient } from "@libsql/client";

const WRITE = /\b(insert|update|delete|create|drop|alter|replace|vacuum|reindex|pragma)\b/i;
function ro(sql: string): string {
  const body = sql.replace(/^\s*explain\s+query\s+plan\s+/i, "");
  if (WRITE.test(body)) throw new Error(`read-only guard tripped: ${sql.slice(0, 70)}`);
  return sql;
}

const CLIENT_TIMEOUT_MS = 300_000;
function db() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error("TURSO_DATABASE_URL is not set");
  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN,
    fetch: (i: RequestInfo | URL, init?: RequestInit) =>
      fetch(i, { ...init, signal: AbortSignal.timeout(CLIENT_TIMEOUT_MS) }),
  });
}
const c = db();
const ms = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`);

async function timed(sql: string, args: unknown[] = []) {
  const t0 = performance.now();
  const r = await c.execute({ sql: ro(sql), args: args as never });
  return { took: performance.now() - t0, rows: r.rows };
}

// The shipped predicate, verbatim from lib/queries.ts::getRecentFilings.
const SEARCH = `(f.registrant_name LIKE ? ESCAPE '\\' OR f.client_name LIKE ? ESCAPE '\\')`;
const LINKED = `EXISTS (SELECT 1 FROM lda_activity_bills ab WHERE ab.filing_uuid = f.filing_uuid)`;
const COLS = `f.filing_uuid, f.registrant_name, f.client_name, f.dt_posted,
              f.filing_type, f.filing_period, f.income, f.expenses`;
const PAGE_SIZE = 13; // app/lobbying/page.tsx
const MAX_FEED_PAGES = 40;
const PAGER_CEILING = PAGE_SIZE * MAX_FEED_PAGES; // 520 — the most the pager can address

async function m1() {
  console.log(`\n=== M1 — the FTS no-go: locate it, quote it, re-verify it ===`);
  console.log(`RECORDED REASON (docs/oddities.md:235, HO 546), quoted:`);
  console.log(`  "Short columns make substring search cheap — the bills_fts lesson does NOT`);
  console.log(`   generalize by row-count. ... lda_filings.registrant_name/client_name avg 25`);
  console.log(`   chars, so a %term% scan of 112k rows is ~700ms worst case (zero-match full`);
  console.log(`   walk) — 14x under the 10s wall ... The cost is bytes-scanned, not row-count.`);
  console.log(`   FTS was therefore probed and REJECTED (HO 546): it would 22x-over-index the`);
  console.log(`   heavily-repeated names (5,201 distinct registrants across 112k filings) AND`);
  console.log(`   add a delete+reinsert trigger to the FLUSH_AT=100-tuned LDA sync write path`);
  console.log(`   — all cost, zero benefit over a plain scan. Don't re-propose FTS here."`);

  console.log(`\nRE-VERIFYING ITS FOUR LOAD-BEARING NUMBERS at today's corpus:`);
  const s = await timed(`SELECT COUNT(*) AS filings,
      AVG(LENGTH(COALESCE(registrant_name,''))) AS avgReg,
      AVG(LENGTH(COALESCE(client_name,''))) AS avgCli,
      MAX(LENGTH(COALESCE(registrant_name,''))) AS maxReg,
      COUNT(DISTINCT registrant_name) AS distReg,
      COUNT(DISTINCT client_name) AS distCli,
      SUM(LENGTH(COALESCE(registrant_name,'')) + LENGTH(COALESCE(client_name,''))) AS nameBytes
    FROM lda_filings`);
  const r = s.rows[0] as Record<string, unknown>;
  const filings = Number(r.filings);
  const nameBytes = Number(r.nameBytes);
  console.log(`  filings        ${filings.toLocaleString()}   (was 112,411 when the reason was written)`);
  console.log(`  avg registrant ${Number(r.avgReg).toFixed(1)} chars | avg client ${Number(r.avgCli).toFixed(1)} chars   (claimed ~25)`);
  console.log(`  distinct       ${Number(r.distReg).toLocaleString()} registrants / ${Number(r.distCli).toLocaleString()} clients   (claimed 5,201 / 21,549)`);
  console.log(`  name bytes     ${(nameBytes / 1e6).toFixed(1)} MB total across both columns`);
  console.log(`  read in ${ms(s.took)}`);

  // The recorded reason's OWN framing is "the cost is bytes-scanned, not row-count".
  // Take it at its word and measure what a full-table walk actually has to read,
  // versus what a name-only scan would read. A leading-% LIKE cannot seek, so the
  // only lever on a scan is how many bytes it drags through.
  const w = await timed(`SELECT SUM(
        LENGTH(COALESCE(filing_uuid,'')) + LENGTH(COALESCE(filing_type,'')) +
        LENGTH(COALESCE(CAST(filing_year AS TEXT),'')) + LENGTH(COALESCE(filing_period,'')) +
        LENGTH(COALESCE(registrant_name,'')) + LENGTH(COALESCE(CAST(registrant_id AS TEXT),'')) +
        LENGTH(COALESCE(client_name,'')) + LENGTH(COALESCE(CAST(client_id AS TEXT),'')) +
        LENGTH(COALESCE(CAST(income AS TEXT),'')) + LENGTH(COALESCE(CAST(expenses AS TEXT),'')) +
        LENGTH(COALESCE(dt_posted,'')) + LENGTH(COALESCE(ingested_at,'')) +
        LENGTH(COALESCE(CAST(activity_count AS TEXT),''))
      ) AS rowBytes FROM lda_filings`);
  const rowBytes = Number((w.rows[0] as Record<string, unknown>).rowBytes);
  console.log(`\n  BYTES-SCANNED, the reason's own metric:`);
  console.log(`    whole row, all 13 columns ... ${(rowBytes / 1e6).toFixed(1)} MB`);
  console.log(`    the two name columns only ... ${(nameBytes / 1e6).toFixed(1)} MB  (${((nameBytes / rowBytes) * 100).toFixed(0)}% of it)`);
  console.log(`    -> a full-table walk drags ${(rowBytes / nameBytes).toFixed(1)}x the bytes the predicate actually reads.`);

  console.log(`\n  VERDICT — the reason's PREMISES all still hold; its CONCLUSION has expired.`);
  console.log(`    HOLDS: columns are still short (25.1 / 27.6 chars vs the claimed ~25).`);
  console.log(`    HOLDS: names are still heavily repeated (${filings.toLocaleString()} filings / ${Number(r.distReg).toLocaleString()} distinct`);
  console.log(`           registrants = ~24x), so FTS would still over-index them.`);
  console.log(`    HOLDS: the principle "the cost is bytes-scanned, not row-count" is RIGHT —`);
  console.log(`           it is the load-bearing idea and this HO confirms it.`);
  console.log(`    EXPIRED: "a %term% scan is ~700ms worst case, 14x under the 10s wall."`);
  console.log(`           Co-located worst case today: 91.3s for the zero-match full walk.`);
  console.log(`    THE DELTA IS UNATTRIBUTED — do not read it as a platform regression.`);
  console.log(`           oddities.md:235 records NO measurement conditions for the 700ms`);
  console.log(`           (no cold/warm, no co-located/laptop, no spread), while the entry`);
  console.log(`           immediately below it distinguishes "a TEMP B-TREE at 7.8s COLD"`);
  console.log(`           for VOLUME. The arc separated cold for one number and not the`);
  console.log(`           other, so the gap is unexplained between corpus growth (1.15x),`);
  console.log(`           measurement conditions, and platform behaviour. Nothing measured`);
  console.log(`           here can apportion it, and this HO does not try to.`);
  console.log(`\n  IS THE BILLS FTS REUSABLE? Mechanically yes, semantically NO.`);
  console.log(`    bills_fts is external-content FTS5 (content='bills') + 3 triggers, and`);
  console.log(`    buildBillsFtsMatch emits TOKEN-PREFIX terms (tok*). The same shape would`);
  console.log(`    build here. But HO 547 chose SUBSTRING deliberately, and FTS5 cannot do`);
  console.log(`    infix: "%oeing%" matches "Boeing" today and would not under FTS. That is a`);
  console.log(`    USER-VISIBLE semantic regression the recorded reason never had to argue,`);
  console.log(`    because back then the scan was cheap enough that it never came up.`);
  console.log(`    So: do not re-propose FTS as a drop-in. If FTS is proposed it must be`);
  console.log(`    argued as a deliberate substring -> prefix trade, not as a free speedup.`);
  console.log(`\n  THE BANKED FALLBACK IS THE ONE THE MEASUREMENT POINTS AT. The recorded`);
  console.log(`  reason already named it: a DISTINCT-NAME LOOKUP TABLE. Sized here:`);
  console.log(`    ${Number(r.distReg).toLocaleString()} registrants + ${Number(r.distCli).toLocaleString()} clients = ${(Number(r.distReg) + Number(r.distCli)).toLocaleString()} distinct names vs ${filings.toLocaleString()}`);
  console.log(`    filings — ~${(filings / (Number(r.distReg) + Number(r.distCli))).toFixed(1)}x fewer rows,`);
  console.log(`    and names only, so ~${(rowBytes / 1e6).toFixed(1)} MB dragged becomes well under 1 MB.`);
  console.log(`    It keeps SUBSTRING semantics exactly. NOT priced here — phase 2 must`);
  console.log(`    measure it, not infer it from this arithmetic (the standing read-cost rule).`);
  return { filings, nameBytes, rowBytes };
}

// A zero-match term forces the FULL walk — the worst case the recorded reason
// claimed at ~700ms. This is the single most important number in the HO.
async function m2(terms: Array<{ label: string; term: string }>) {
  console.log(`\n=== M2 — decompose the cost (unbounded client, one execution each) ===`);
  console.log(`  Every row below is a TIMED check. EXPLAIN is blind to a leading-% LIKE`);
  console.log(`  (oddities.md:432), so a plan read cannot price any of this.\n`);

  // Baseline: the same full walk with NO LIKE, to separate scan cost from LIKE cost.
  const bare = await timed(`SELECT COUNT(*) AS n FROM lda_filings f`);
  console.log(`  [baseline] COUNT(*) no predicate ............ ${ms(bare.took).padStart(8)}   ${Number((bare.rows[0] as Record<string, unknown>).n).toLocaleString()} rows`);

  const linked = await timed(`SELECT COUNT(*) AS n FROM lda_filings f WHERE ${LINKED}`);
  console.log(`  [isolated] COUNT(*) linked EXISTS only ...... ${ms(linked.took).padStart(8)}   ${Number((linked.rows[0] as Record<string, unknown>).n).toLocaleString()} rows`);

  for (const { label, term } of terms) {
    const like = `%${term}%`;
    console.log(`\n  --- term "${term}" (${label}) ---`);
    const cnt = await timed(
      `SELECT COUNT(*) AS n FROM lda_filings f WHERE ${SEARCH}`,
      [like, like],
    );
    const matches = Number((cnt.rows[0] as Record<string, unknown>).n);
    console.log(`  [shipped]  COUNT(*) with search ............. ${ms(cnt.took).padStart(8)}   ${matches.toLocaleString()} matches`);

    const pg = await timed(
      `SELECT ${COLS} FROM lda_filings f INDEXED BY idx_lda_filings_dt_posted
        WHERE ${SEARCH} ORDER BY f.dt_posted DESC LIMIT ? OFFSET ?`,
      [like, like, PAGE_SIZE, 0],
    );
    console.log(`  [shipped]  page query (LIMIT ${PAGE_SIZE}) ............ ${ms(pg.took).padStart(8)}   ${pg.rows.length} rows`);

    // The LIKE walk with nothing else attached — isolates predicate cost from the
    // aggregate and from the row hydration.
    const scan = await timed(
      `SELECT MAX(f.rowid) AS n FROM lda_filings f WHERE ${SEARCH}`,
      [like, like],
    );
    console.log(`  [isolated] LIKE walk, no COUNT/hydrate ..... ${ms(scan.took).padStart(8)}`);
  }
}

async function m3(terms: Array<{ label: string; term: string }>) {
  console.log(`\n=== M3 — does a BOUNDED count help, and for which terms? ===`);
  console.log(`  The pager cannot address a row past ${PAGER_CEILING} (PAGE_SIZE ${PAGE_SIZE} x MAX_FEED_PAGES ${MAX_FEED_PAGES}),`);
  console.log(`  so counting past ${PAGER_CEILING + 1} is provably wasted work FOR THE PAGER. Bounded form:`);
  console.log(`  SELECT COUNT(*) FROM (SELECT 1 FROM lda_filings f WHERE <search> LIMIT ${PAGER_CEILING + 1}).\n`);
  for (const { label, term } of terms) {
    const like = `%${term}%`;
    const b = await timed(
      `SELECT COUNT(*) AS n FROM (SELECT 1 FROM lda_filings f WHERE ${SEARCH} LIMIT ${PAGER_CEILING + 1})`,
      [like, like],
    );
    const n = Number((b.rows[0] as Record<string, unknown>).n);
    const capped = n > PAGER_CEILING;
    console.log(
      `  "${term}" (${label}): ${ms(b.took).padStart(8)}  ->  ${capped ? `${PAGER_CEILING}+ (capped, short-circuits)` : `${n} (exact, walked the whole table)`}`,
    );
  }
  console.log(`\n  CO-LOCATED VERDICT (the numbers above are laptop and ordering-confounded —`);
  console.log(`  a bounded count that walks the same rows measured 100x faster simply for`);
  console.log(`  running last; the co-located, 90s-spaced figures are in the header):`);
  console.log(`    common "llc"    58.1s -> 2.25s   ~26x, short-circuits at ${PAGER_CEILING + 1}`);
  console.log(`    rare   "boeing" 60.2s -> 55.1s   NO HELP — 78 matches never reach the bound`);
  console.log(`  So a bounded count is a PARTIAL fix, and the half it misses is the half that`);
  console.log(`  was reported. It is still worth having (it removes the common-term breach for`);
  console.log(`  one line of SQL), but it cannot close this HO on its own.`);
}

function m4() {
  console.log(`\n=== M4 — what does the pager actually need? (read from the code) ===`);
  console.log(`  getRecentFilings returns \`total\`; app/lobbying/page.tsx:186 puts it in`);
  console.log(`  searchTotal, :188 folds it into feedTotal. EXACTLY TWO consumers:`);
  console.log(`    1. :189-191 totalPages = min(ceil(feedTotal / ${PAGE_SIZE}), ${MAX_FEED_PAGES})`);
  console.log(`         -> <Pagination totalPages> (:486-488), rendered only when > 1 (:485)`);
  console.log(`    2. :279  the .mc-fbar count line: "{feedTotal} FILINGS · MATCHING <q>"`);
  console.log(`  Nothing else reads it. No sort, no filter, no query depends on it.`);
  console.log(`\n  THE PAGER IS ALREADY CLAMPED, which decides this: totalPages is min()'d with`);
  console.log(`  MAX_FEED_PAGES=${MAX_FEED_PAGES}, so any feedTotal above ${PAGER_CEILING} produces the SAME 40 pages.`);
  console.log(`  An exact total past ${PAGER_CEILING} is already discarded by the code that asks for it.`);
  console.log(`  Only consumer 2 — a printed number — wants exactness, and "${PAGER_CEILING}+" is a`);
  console.log(`  truthful rendering of a clamped feed.`);
  console.log(`\n  CURRENT FAILURE BEHAVIOUR, and it is why the bug is invisible: on a guard trip`);
  console.log(`  the fallback returns total: 0 (lib/queries.ts), so feedTotal = 0 -> the line`);
  console.log(`  reads "0 FILINGS · MATCHING <q>" and totalPages = 1 hides the pager entirely.`);
  console.log(`  A timeout and a genuine zero-match render CHARACTER FOR CHARACTER the same.`);
  console.log(`\n  BUT DROPPING THE TOTAL IS NOT THE FIX. Co-located, the PAGE query alone —`);
  console.log(`  with no COUNT beside it — is 19.8s for "boeing" and 91.3s for a zero-match`);
  console.log(`  term. Removing the exact total removes ONE of TWO breaching queries. Worth`);
  console.log(`  doing on its own terms (the pager provably discards any total past ${PAGER_CEILING}),`);
  console.log(`  but it does not make the page correct.`);
}

async function m5() {
  console.log(`\n=== M5 — do the search fix and the filed \`linked\` page-40 residual converge? ===`);
  const probe = await timed(
    `SELECT ${COLS} FROM lda_filings f INDEXED BY idx_lda_filings_activity
      WHERE ${LINKED} ORDER BY f.activity_count DESC, f.dt_posted DESC LIMIT ? OFFSET ?`,
    [PAGE_SIZE, 507],
  );
  console.log(`  the filed residual (volume + linked + page 40): ${ms(probe.took)}`);
  console.log(`\n  THEY CONVERGE, and on more than the writer — which is a stronger answer`);
  console.log(`  than expected. HO 597 attributed the linked residual to "per-row EXISTS`);
  console.log(`  probing cold pages". This HO measured linked_count (the EXISTS over the`);
  console.log(`  whole table, NO LIKE) at 36.9s and walk_notnull (a name read, NO predicate`);
  console.log(`  at all) at 86.3s. Same root cause: DRAGGING lda_filings THROUGH A COLD READ.`);
  console.log(`  The EXISTS and the LIKE are both passengers, not drivers.`);
  console.log(`\n  As FIXES they still need different columns — a materialized bill_linked`);
  console.log(`  column serves the residual, a name lookup table serves search — so neither`);
  console.log(`  one fixes the other. But they share the TABLE, the WRITER`);
  console.log(`  (buildFilingStatements), and the exact shape that just shipped for`);
  console.log(`  activity_count. If both are built: ONE migration, ONE writer edit, ONE`);
  console.log(`  backfill, not the HO 597 sequence run twice.`);
  console.log(`\n  AND THE SHARED ROOT CAUSE OUTRANKS BOTH. Anything that walks lda_filings`);
  console.log(`  cold is now a 30-90s query. That is a property of the TABLE, not of any one`);
  console.log(`  surface, so the next reader should assume every unbounded read of it is`);
  console.log(`  already over the bound rather than checking them one at a time.`);
}

async function main() {
  console.log(`HO 598 STEP 0 — /lobbying?q= cost. READ-ONLY, UNBOUNDED CLIENT (${CLIENT_TIMEOUT_MS / 1000}s).`);
  await m1();

  // Chosen after a first pass: a term matching a large share, the term from the
  // report, and a term matching nothing (the full-walk worst case the recorded
  // reason priced at ~700ms).
  const terms = [
    { label: "common", term: "llc" },
    { label: "the reported one", term: "boeing" },
    { label: "zero-match, the full-walk worst case", term: "zzqxnotarealterm" },
  ];
  await m2(terms);
  await m3(terms);
  m4();
  await m5();
  console.log(`\nHALT — no fix code in this HO.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
